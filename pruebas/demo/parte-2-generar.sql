
-- Lo que agregó la carta de ejemplo
insert into datos_prueba select 'productos', id::text from productos where id > (select (datos->>'id')::bigint from datos_prueba_antes where tabla = 'max' and id = 'productos');
insert into datos_prueba select 'insumos', id::text from insumos where id > (select (datos->>'id')::bigint from datos_prueba_antes where tabla = 'max' and id = 'insumos');
insert into datos_prueba select 'proveedores', id::text from proveedores where id > (select (datos->>'id')::bigint from datos_prueba_antes where tabla = 'max' and id = 'proveedores');

-- ---------------------------------------------------------------------
-- El movimiento de un mes
-- ---------------------------------------------------------------------
do $$
declare
  v_admin uuid := (select id from perfiles where rol = 'admin' and activo order by creado limit 1);
  v_hoy date := jornada_actual();
  v_ini date := jornada_actual() - 63;   -- nueve semanas: así los tableros tienen contra qué comparar
  v_z text := zona();
  v_caja bigint := (select id from cuentas where tipo = 'Efectivo' and activa order by orden limit 1);
  v_banco bigint := (select id from cuentas where tipo = 'Banco' and activa order by orden limit 1);
  v_billetera bigint := (select id from cuentas where tipo = 'Billetera virtual' and activa order by orden limit 1);
  v_mozos uuid[] := '{}'; v_enc uuid; v_uid uuid;
  d date; v_dow int; n int; k int; j int; t bigint; v_c bigint; v_p bigint;
  v_hora timestamptz; v_com int; v_mesa int; v_moz uuid; v_sub numeric; v_desc numeric; v_medio text; v_cant int; v_tot numeric;
  v_cocina boolean; v_barra boolean; v_ia bigint; v_ib bigint; v_ta timestamptz; v_tb timestamptz;
  r record; x record; v_cols text; v_vals text; v_sql text; v_mes date; v_freq int; v_f date; v_fac numeric; v_nro int := 1200;
begin
  perform setseed(0.27);

  -- Personal de prueba (no pueden entrar: no tienen contraseña). Son los mozos que aparecen en las ventas.
  for r in select * from (values ('Flor', 'mozo', 'flor'), ('Nico', 'mozo', 'nico'), ('Agus', 'mozo', 'agus'), ('Pablo', 'encargado', 'pablo')) v(nombre, rol, mail) loop
    v_uid := gen_random_uuid();
    v_cols := 'id, email'; v_vals := format('%L::uuid, %L', v_uid, r.mail || '.prueba@ultimavuelta.invalid');
    for x in select * from (values ('instance_id', '''00000000-0000-0000-0000-000000000000''::uuid'), ('aud', '''authenticated'''), ('role', '''authenticated'''),
        ('confirmation_token', ''''''), ('recovery_token', ''''''), ('email_change_token_new', ''''''), ('email_change_token_current', ''''''),
        ('email_change', ''''''), ('phone_change', ''''''), ('phone_change_token', ''''''), ('reauthentication_token', ''''''),
        ('raw_app_meta_data', '''{"provider":"email","providers":["email"]}''::jsonb'), ('raw_user_meta_data', '''{}''::jsonb'),
        ('created_at', 'now()'), ('updated_at', 'now()')) c(col, val)
      where exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = c.col) loop
      v_cols := v_cols || ', ' || x.col; v_vals := v_vals || ', ' || x.val;
    end loop;
    execute format('insert into auth.users (%s) values (%s)', v_cols, v_vals);
    insert into perfiles (id, nombre, email, rol) values (v_uid, r.nombre, r.mail || '.prueba@ultimavuelta.invalid', r.rol::rol_usuario)
    on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol;
    insert into datos_prueba values ('usuarios', v_uid::text);
    if r.rol = 'mozo' then v_mozos := v_mozos || v_uid; else v_enc := v_uid; end if;
  end loop;

  -- Las cuentas arrancan un poco antes de los datos, con un saldo inicial
  update cuentas set desde = v_ini - 1,
    saldo_inicial = case id when v_caja then 400000 when v_banco then 1500000 when v_billetera then 400000 else saldo_inicial end
  where activa;

  -- Qué se pide más (el resto de la carta sale con peso 1)
  create temp table pesos on commit drop as
  select p.id producto_id, p.nombre, p.precio, p.estacion,
         case when p.estacion = 'barra' then 'bebida' when c.nombre ilike 'guarni%' then 'guarni' when c.nombre ilike 'postre%' then 'postre' else 'plato' end grupo,
         coalesce(w.peso, 1)::numeric peso
  from productos p join categorias c on c.id = p.categoria_id
  left join (values ('Vacío', 3.0), ('Parrillada para 2', 2.0), ('Choripán', 2.5), ('Empanada de carne', 2.0), ('Entraña', 1.6), ('Asado de tira', 1.8),
                    ('Bife de chorizo', 1.4), ('Provoleta', 1.5), ('Papas fritas', 3.0), ('Fernet con cola', 4.0), ('Pinta rubia tirada', 4.0),
                    ('Pinta IPA tirada', 2.5), ('Gin tonic', 2.0), ('Gaseosa', 2.2), ('Agua mineral', 1.5), ('Copa de Malbec', 1.5),
                    ('Botella Malbec de la casa', 1.0), ('Aperol spritz', 1.2), ('Porrón 1 L', 1.5)) w(nombre, peso) on w.nombre = p.nombre
  where p.activo and p.precio > 0;
  create temp table items_t (producto_id bigint, cantidad int) on commit drop;
  create temp table lineas (insumo_id bigint, cantidad numeric, costo numeric) on commit drop;

  -- ------------------------------------------------------------- noches pasadas
  d := v_ini;
  while d < v_hoy loop
    v_dow := extract(dow from d)::int;
    n := case v_dow when 0 then 12 when 1 then 0 when 2 then 6 when 3 then 7 when 4 then 10 when 5 then 20 else 24 end;
    n := round(n * (0.85 + 0.3 * random()) * (0.88 + 0.24 * (d - v_ini) / 63.0));
    if n > 0 then
      insert into jornadas (fecha, apertura, abierta_en, abierta_por) values (d, 50000, (d + time '19:40') at time zone v_z, coalesce(v_enc, v_admin))
      on conflict (fecha) do nothing;
      if found then insert into datos_prueba values ('jornadas', d::text); end if;
      for k in 1..n loop
        truncate items_t;
        v_com := (array[1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 6, 8])[1 + floor(random() * 12)::int];
        -- platos, guarniciones, postres y bebidas según la cantidad de gente
        for j in 1..greatest(1, round(v_com * 0.8 + random() - 0.5)::int) loop
          insert into items_t select producto_id, case when nombre ilike 'empanada%' then 2 + floor(random() * 3)::int else 1 end from pesos where grupo = 'plato' order by -ln(1 - random()) / peso limit 1;
        end loop;
        for j in 1..floor(v_com * 0.45 + random())::int loop insert into items_t select producto_id, 1 from pesos where grupo = 'guarni' order by -ln(1 - random()) / peso limit 1; end loop;
        for j in 1..floor(v_com * 0.25 + random() * 0.8)::int loop insert into items_t select producto_id, 1 from pesos where grupo = 'postre' order by -ln(1 - random()) / peso limit 1; end loop;
        for j in 1..greatest(1, round(v_com * 1.6 + random() * 2)::int) loop insert into items_t select producto_id, 1 from pesos where grupo = 'bebida' order by -ln(1 - random()) / peso limit 1; end loop;
        select sum(i.cantidad * p.precio), bool_or(p.estacion = 'cocina'), bool_or(p.estacion = 'barra') into v_sub, v_cocina, v_barra from items_t i join pesos p using (producto_id);
        continue when v_sub is null;
        v_desc := case when random() < 0.06 then 10 else 0 end;
        v_hora := (d + time '20:30' + ((random() + random()) / 2) * interval '5 hours 40 minutes') at time zone v_z;
        v_moz := v_mozos[1 + floor(random() * array_length(v_mozos, 1))::int];
        select nombre into v_medio from medios_pago where activo
          order by -ln(1 - random()) / case nombre when 'Efectivo' then 3 when 'Débito' then 2.5 when 'Crédito' then 1.5 else 3 end limit 1;
        insert into tickets (jornada, hora, mesa_numero, mesa_abierta, comensales, mozo_id, mozo_nombre, subtotal, descuento_pct, total, medio, cobrado_por, min_cocina, min_barra)
        values (d, v_hora, 1 + floor(random() * 12)::int, v_hora - (35 + random() * 85) * interval '1 minute', v_com, v_moz, (select nombre from perfiles where id = v_moz),
                v_sub, v_desc, round(v_sub * (1 - v_desc / 100), 2), v_medio, coalesce(v_enc, v_admin),
                case when v_cocina then array[round(9 + random() * 11 + case when v_dow in (5, 6) then random() * 12 else 0 end)::int] else '{}' end,
                case when v_barra then array[round(2 + random() * 5 + case when v_dow in (5, 6) then random() * 4 else 0 end)::int] else '{}' end)
        returning id into t;
        insert into datos_prueba values ('tickets', t::text);
        insert into ticket_items (ticket_id, producto_id, nombre, categoria, cantidad, precio, costo_unit)
        select t, p.id, p.nombre, c.nombre, sum(i.cantidad), p.precio, coalesce(costo_receta(p.id), 0)
        from items_t i join productos p on p.id = i.producto_id join categorias c on c.id = p.categoria_id group by p.id, p.nombre, c.nombre, p.precio;
        update tickets set costo = (select coalesce(sum(cantidad * costo_unit), 0) from ticket_items where ticket_id = t) where id = t;
        insert into movimientos_stock (producto_id, tipo, cantidad, jornada, hora, ticket_id)
        select ti.producto_id, 'venta', -sum(ti.cantidad), d, v_hora, t from ticket_items ti join productos p on p.id = ti.producto_id
        where ti.ticket_id = t and p.controla_stock group by ti.producto_id;
        insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, hora, ticket_id)
        select ri.insumo_id, 'venta', -round(sum(ti.cantidad * crudo(ri.cantidad, ri.cocido, i.merma_pct, i.rinde_coccion)), 3), max(i.costo), d, v_hora, t
        from ticket_items ti join receta_items ri on ri.producto_id = ti.producto_id join insumos i on i.id = ri.insumo_id
        where ti.ticket_id = t group by ri.insumo_id;
      end loop;
      -- hielo o algo chico pagado con la caja
      if random() < 0.45 and v_caja is not null then
        insert into gastos (fecha, concepto, categoria, monto, estado, cuenta_id, pagado_el, origen, jornada, usuario_id)
        values (d, (array['Hielo', 'Hielo', 'Servilletas', 'Carbón extra', 'Limones'])[1 + floor(random() * 5)::int], 'Caja chica', round((3000 + random() * 9000) / 500) * 500,
                'pagado', v_caja, d, 'caja', d, coalesce(v_enc, v_admin)) returning id into v_c;
        insert into datos_prueba values ('gastos', v_c::text);
      end if;
      update jornadas set cierre_esperado = efectivo_esperado(d),
        cierre_contado = efectivo_esperado(d) + (array[0, 0, 0, 0, 0, -500, -1500, 1000, -3000])[1 + floor(random() * 9)::int],
        cerrada_en = (d + 1 + time '03:10') at time zone v_z + random() * interval '50 minutes', cerrada_por = coalesce(v_enc, v_admin)
      where fecha = d and exists (select 1 from datos_prueba where tabla = 'jornadas' and id = d::text);
    end if;
    d := d + 1;
  end loop;

  -- ------------------------------------------------------------- compras de cada semana, por proveedor
  for k in 0..8 loop
    for r in select coalesce(i.proveedor_id, 0) prov, pr.nombre, coalesce(pr.plazo_dias, 0) plazo from insumos i left join proveedores pr on pr.id = i.proveedor_id
             where i.activo group by 1, 2, 3 loop
      v_freq := case when r.nombre in ('Carnicería', 'Verdulería', 'Panadería') then 2 else 1 end;
      for j in 1..v_freq loop
        v_f := v_ini + 7 * k + case when j = 1 then 1 else 4 end;   -- martes y viernes
        continue when v_f >= v_hoy;
        -- la carne subió la última semana
        v_fac := (0.90 + 0.10 * k / 8.0) * case when k = 8 and r.nombre = 'Carnicería' then 1.07 else 1 end;
        truncate lineas;
        insert into lineas
        select i.id,
               case when i.pack > 0 then greatest(1, ceil(u.uso / v_freq * (1.02 + random()::numeric * 0.25) / i.pack)) * i.pack
                    else round(u.uso / v_freq * (1.02 + random()::numeric * 0.25), case when i.unidad in ('u.', 'atados') then 0 else 1 end) end,
               round(i.costo * v_fac * (0.98 + random()::numeric * 0.04), 2)
        from insumos i join (select insumo_id, -sum(cantidad) uso from movimientos_stock where tipo = 'venta' and insumo_id is not null
                             and jornada between v_ini + 7 * k and v_ini + 7 * k + 6 group by 1) u on u.insumo_id = i.id
        where coalesce(i.proveedor_id, 0) = r.prov and i.activo and u.uso > 0;
        continue when not exists (select 1 from lineas where cantidad > 0);
        v_nro := v_nro + 1 + floor(random() * 30)::int;
        insert into compras (proveedor_id, numero, fecha, total, usuario_id)
        values (nullif(r.prov, 0), case when random() < 0.8 then format('A-0002-%s', lpad(v_nro::text, 8, '0')) end, v_f,
                (select round(sum(cantidad * costo), 2) from lineas where cantidad > 0), coalesce(v_enc, v_admin)) returning id, total into v_c, v_tot;
        insert into datos_prueba values ('compras', v_c::text);
        insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, hora, compra_id, usuario_id)
        select insumo_id, 'compra', cantidad, costo, v_f, (v_f + time '11:00') at time zone v_z + random() * interval '3 hours', v_c, coalesce(v_enc, v_admin) from lineas where cantidad > 0;
        if r.plazo > 0 then
          v_cocina := v_f + r.plazo < v_hoy - 2 and random() < 0.94;   -- ¿ya se pagó?
          insert into gastos (fecha, concepto, categoria, monto, proveedor_id, estado, cuenta_id, pagado_el, vence, origen, compra_id, usuario_id)
          values (v_f, format('Compra de %s artículos', (select count(*) from lineas where cantidad > 0)), 'Mercadería', v_tot, nullif(r.prov, 0),
                  case when v_cocina then 'pagado' else 'pendiente' end, case when v_cocina then v_banco end, case when v_cocina then v_f + r.plazo end,
                  v_f + r.plazo, 'compra', v_c, coalesce(v_enc, v_admin))
          returning id into v_p;
        else
          insert into gastos (fecha, concepto, categoria, monto, proveedor_id, estado, cuenta_id, pagado_el, origen, compra_id, usuario_id)
          values (v_f, format('Compra de %s artículos', (select count(*) from lineas where cantidad > 0)), 'Mercadería', v_tot, nullif(r.prov, 0),
                  'pagado', case when v_tot < 120000 then v_caja else v_banco end, v_f, 'compra', v_c, coalesce(v_enc, v_admin)) returning id into v_p;
        end if;
        insert into datos_prueba values ('gastos', v_p::text);
      end loop;
    end loop;
  end loop;
  -- El costo de cada artículo queda el de su última compra
  update insumos i set costo = m.costo_unit
  from (select distinct on (insumo_id) insumo_id, costo_unit from movimientos_stock where tipo = 'compra' and insumo_id is not null and costo_unit > 0 order by insumo_id, hora desc) m
  where m.insumo_id = i.id;

  -- ------------------------------------------------------------- mermas
  for r in select * from (values ('Lechuga', 0.6, 'Vencido o en mal estado', null), ('Tomate', 0.8, 'Vencido o en mal estado', null),
      ('Mollejas', 0.4, 'Se quemó o salió mal', 'Se pasaron en la parrilla'), ('Vacío', 0.45, 'Devolución del cliente', 'Lo pidieron jugoso'),
      ('Pan de chorizo', 6, 'Sobrante del día', null), ('Cerveza rubia', 3, 'Rotura o derrame', 'Cambio de barril'), ('Hielo', 5, 'Otro', 'Se derritió en la heladera'),
      ('Papas', 1.5, 'Vencido o en mal estado', 'Brotadas'), ('Fernet', 350, 'Rotura o derrame', 'Se cayó una botella abierta'), ('Crema', 0.5, 'Vencido o en mal estado', null),
      ('Entraña', 0.35, 'Se quemó o salió mal', null), ('Lechuga', 0.4, 'Sobrante del día', null)) v(ins, cant, motivo, nota) loop
    select id, costo into v_p, v_tot from insumos where nombre = r.ins;
    continue when v_p is null;
    d := v_ini + 2 + floor(random() * (v_hoy - v_ini - 3))::int;
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, nota, jornada, hora, usuario_id)
    values (v_p, 'merma', -r.cant, v_tot, r.motivo, r.nota, d, (d + time '23:30') at time zone v_z, coalesce(v_enc, v_admin)) returning id into v_c;
    insert into datos_prueba values ('movimientos_stock', v_c::text);
  end loop;

  -- ------------------------------------------------------------- control semanal: dos conteos completos
  -- los lunes a la mañana (después del domingo a la noche)
  v_f := v_hoy - ((extract(dow from v_hoy)::int + 6) % 7);
  if v_f = v_hoy then v_f := v_f - 7; end if;
  v_ta := (v_f - 7 + time '04:30') at time zone v_z;
  v_tb := (v_f + time '04:30') at time zone v_z;
  create temp table conteo on commit drop as
  select i.id insumo_id, i.costo, i.minimo, i.nombre,
         coalesce(sum(m.cantidad) filter (where m.tipo in ('compra', 'ingreso') and m.hora > v_ta and m.hora <= v_tb), 0) entro_ab,
         coalesce(-sum(m.cantidad) filter (where m.tipo in ('venta', 'merma') and m.hora > v_ta and m.hora <= v_tb), 0) sale_ab,
         coalesce(-sum(m.cantidad) filter (where m.tipo = 'venta' and m.hora > v_ta and m.hora <= v_tb), 0) venta_ab,
         coalesce(sum(m.cantidad) filter (where m.tipo in ('compra', 'ingreso') and m.hora > v_tb), 0) entro_desp,
         coalesce(-sum(m.cantidad) filter (where m.tipo in ('venta', 'merma') and m.hora > v_tb), 0) sale_desp,
         0::numeric a, 0::numeric falta, 0::numeric b
  from insumos i left join movimientos_stock m on m.insumo_id = i.id where i.activo group by i.id, i.costo, i.minimo, i.nombre;
  -- lo que falta sin explicar: un poco de carne y de bebida (lo típico)
  update conteo set falta = round(venta_ab * case when nombre in ('Vacío', 'Entraña', 'Bife de chorizo') then 0.04 + random()::numeric * 0.03
                                                  when nombre in ('Fernet', 'Gin') then 0.05 + random()::numeric * 0.04
                                                  when random()::numeric < 0.3 then random()::numeric * 0.02 else 0 end, 3);
  update conteo set a = round(minimo + sale_ab * 0.7 + random()::numeric * greatest(minimo, 1), case when nombre ilike '%chorizo%' or minimo >= 10 then 0 else 2 end);
  update conteo set a = a + greatest(0, -(a + entro_ab - sale_ab - falta)) + minimo * 0.3;
  update conteo set b = round(a + entro_ab - sale_ab - falta, 3);
  insert into inventarios (fecha, completo, usuario_id, nota) values (v_ta, true, coalesce(v_enc, v_admin), 'Conteo del lunes') returning id into v_ia;
  insert into inventarios (fecha, completo, usuario_id, nota) values (v_tb, true, coalesce(v_enc, v_admin), 'Conteo del lunes') returning id into v_ib;
  insert into datos_prueba values ('inventarios', v_ia::text), ('inventarios', v_ib::text);
  insert into inventario_items (inventario_id, insumo_id, cantidad, sistema) select v_ia, insumo_id, a, a from conteo;
  insert into inventario_items (inventario_id, insumo_id, cantidad, sistema) select v_ib, insumo_id, b, b + falta from conteo;
  for r in select * from conteo where falta > 0 loop
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, jornada, hora, usuario_id)
    values (r.insumo_id, 'conteo', -r.falta, r.costo, 'Diferencia de conteo', v_f - 1, v_tb, coalesce(v_enc, v_admin)) returning id into v_c;
    insert into datos_prueba values ('movimientos_stock', v_c::text);
  end loop;
  -- Lo que hay hoy sale del último conteo más lo que entró y salió después
  update insumos i set cantidad = greatest(0, round(c.b + c.entro_desp - c.sale_desp, 3)) from conteo c where c.insumo_id = i.id;
  -- Algunos quedan justos, para que la lista de compras y Chichito tengan qué decir
  update insumos set cantidad = round(minimo * 0.6, 2) where nombre in ('Entraña', 'Limones', 'Tónica', 'Queso provolone');
  update insumos set cantidad = 0 where nombre = 'Menta';
  update insumos set vence = v_hoy + 1 where nombre = 'Mollejas';
  update insumos set vence = v_hoy where nombre = 'Lechuga';
  update insumos set vence = v_hoy + 4 where nombre in ('Crema', 'Leche');
  update productos set stock = round(stock_min * (0.5 + random() * 2.5)) where controla_stock;
  update productos set stock = round(stock_min * 0.6) where nombre in ('Agua mineral', 'Botella Malbec de la casa');

  -- ------------------------------------------------------------- pruebas de rendimiento
  for r in select * from (values ('Vacío', 6.2, 5.42, 3.85, 'Carnicería', 'Pieza entera, con grasa'), ('Vacío', 5.8, 5.12, null, 'Carnicería', null),
      ('Mollejas', 2.0, 1.46, 1.02, 'Carnicería', 'Limpias y blanqueadas'), ('Papas', 10, 7.95, 4.45, 'Verdulería', 'Bastón, fritas dos veces'),
      ('Entraña', 3.1, 2.86, 2.0, 'Carnicería', null)) v(ins, crudo, limpio, cocido, prov, nota) loop
    select id into v_p from insumos where nombre = r.ins;
    continue when v_p is null;
    insert into rendimientos (insumo_id, proveedor, crudo, limpio, cocido, nota, fecha, usuario_id)
    values (v_p, r.prov, r.crudo, r.limpio, r.cocido, r.nota, now() - (5 + random() * 25) * interval '1 day', coalesce(v_enc, v_admin)) returning id into v_c;
    insert into datos_prueba values ('rendimientos', v_c::text);
  end loop;

  -- ------------------------------------------------------------- gastos fijos (mes pasado y este)
  for k in 0..2 loop
    v_mes := (date_trunc('month', v_hoy::timestamp) - (2 - k) * interval '1 month')::date;
    for r in select * from (values
        ('Alquiler del local', 'Alquiler', 1800000, 5, 'banco'), ('Sueldos', 'Sueldos y cargas', 4800000, 3, 'banco'), ('Cargas sociales', 'Sueldos y cargas', 1000000, 12, 'banco'),
        ('Luz', 'Luz, gas y agua', 520000, 18, 'banco'), ('Gas', 'Luz, gas y agua', 260000, 15, 'banco'), ('Agua', 'Luz, gas y agua', 48000, 20, 'banco'),
        ('Internet', 'Internet y teléfono', 42000, 10, 'banco'), ('Monotributo', 'Impuestos y tasas', 210000, 20, 'banco'), ('Tasa municipal', 'Impuestos y tasas', 95000, 25, 'banco'),
        ('Publicidad en Instagram', 'Publicidad', 120000, 8, 'billetera'), ('Artículos de limpieza', 'Limpieza', 135000, 6, 'caja'),
        ('Service de la parrilla', 'Mantenimiento', 220000, 22, 'caja'), ('Comisiones de tarjetas', 'Comisiones y bancos', 380000, 28, 'banco')) v(concepto, cat, monto, dia, cuenta) loop
      v_f := v_mes + (r.dia - 1);
      continue when v_f < v_ini or (v_f > v_hoy and r.concepto not in ('Luz', 'Internet', 'Gas'));
      insert into gastos (fecha, concepto, categoria, monto, estado, cuenta_id, pagado_el, vence, origen, usuario_id)
      values (least(v_f, v_hoy), r.concepto, r.cat, round(r.monto * (0.95 + random() * 0.1) / 100) * 100,
              case when v_f <= v_hoy then 'pagado' else 'pendiente' end,
              case when v_f <= v_hoy then case r.cuenta when 'caja' then v_caja when 'billetera' then coalesce(v_billetera, v_banco) else v_banco end end,
              case when v_f <= v_hoy then v_f end, case when v_f > v_hoy then v_f end, 'manual', v_admin) returning id into v_c;
      insert into datos_prueba values ('gastos', v_c::text);
    end loop;
  end loop;

  -- La plata de la caja y de la billetera se pasa al banco una vez por semana
  for k in 0..8 loop
    v_f := v_ini + 7 * k + 2;
    continue when v_f >= v_hoy or v_caja is null or v_banco is null;
    insert into movimientos_cuenta (tipo, de_cuenta, a_cuenta, monto, fecha, nota, usuario_id) values ('transferencia', v_caja, v_banco, 1500000, v_f, 'Depósito de la semana', v_admin) returning id into v_c;
    insert into datos_prueba values ('movimientos_cuenta', v_c::text);
    if v_billetera is not null then
      insert into movimientos_cuenta (tipo, de_cuenta, a_cuenta, monto, fecha, nota, usuario_id) values ('transferencia', v_billetera, v_banco, 2500000, v_f, 'Pasaje de Mercado Pago', v_admin) returning id into v_c;
      insert into datos_prueba values ('movimientos_cuenta', v_c::text);
    end if;
  end loop;

  -- ------------------------------------------------------------- reservas
  for r in select * from (values
      (0, '21:00', 'Ferreyra', 6, 'confirmada', 'telefono', 'Mesa cerca de la ventana'), (0, '21:30', 'Martínez', 4, 'confirmada', 'web', null),
      (0, '22:00', 'Gómez', 2, 'pendiente', 'web', 'Es un cumpleaños'), (0, '22:30', 'Romero', 5, 'pendiente', 'web', null),
      (1, '21:00', 'Sosa', 8, 'confirmada', 'telefono', 'Vienen con dos chicos'), (1, '21:30', 'Díaz', 3, 'pendiente', 'web', null),
      (1, '22:00', 'Benítez', 4, 'confirmada', 'web', null), (1, '23:00', 'Acosta', 2, 'pendiente', 'web', null),
      (2, '21:00', 'Álvarez', 10, 'confirmada', 'telefono', 'Despedida, quieren parrillada'), (2, '21:30', 'Pereyra', 4, 'pendiente', 'web', null),
      (2, '22:00', 'Torres', 6, 'confirmada', 'web', 'Uno es celíaco'), (2, '22:30', 'Ruiz', 2, 'pendiente', 'web', null), (2, '22:30', 'Medina', 4, 'pendiente', 'web', null),
      (4, '21:30', 'Herrera', 3, 'pendiente', 'web', null),
      (-1, '21:30', 'Castro', 4, 'sentada', 'web', null), (-1, '22:00', 'Vega', 2, 'no_vino', 'web', null),
      (-2, '21:00', 'Molina', 6, 'sentada', 'telefono', null), (-2, '22:00', 'Ortiz', 3, 'cancelada', 'web', null),
      (-3, '21:30', 'Silva', 5, 'sentada', 'web', null)) v(dia, hora, nombre, personas, estado, origen, nota) loop
    insert into reservas (nombre, telefono, personas, fecha, hora, nota, estado, origen, creado, creado_por, atendido, cancelada_por, mesa_id)
    values (r.nombre, '2974' || lpad(floor(random() * 1000000)::text, 6, '0'), r.personas, v_hoy + r.dia, r.hora::time, r.nota, r.estado::estado_reserva, r.origen,
            now() - (1 + random() * 4) * interval '1 day' + least(r.dia, 0) * interval '1 day', case when r.origen = 'web' then null else coalesce(v_enc, v_admin) end,
            case when r.estado <> 'pendiente' then now() - (0.5 + random()) * interval '1 day' + least(r.dia, 0) * interval '1 day' end,
            case when r.estado = 'cancelada' then 'cliente' end,
            case when r.estado = 'sentada' then (select id from mesas where activa order by random() limit 1) end)
    returning id into v_c;
    insert into datos_prueba values ('reservas', v_c::text);
  end loop;

  -- ------------------------------------------------------------- hoy: caja abierta, algunas mesas cobradas y otras en curso
  insert into jornadas (fecha, apertura, abierta_en, abierta_por) values (v_hoy, 50000, now() - interval '35 minutes', coalesce(v_enc, v_admin))
  on conflict (fecha) do nothing;
  if found then insert into datos_prueba values ('jornadas', v_hoy::text); end if;
  for k in 1..3 loop
    truncate items_t;
    insert into items_t select producto_id, 1 from pesos where grupo = 'plato' order by -ln(1 - random()) / peso limit 2;
    insert into items_t select producto_id, 1 from pesos where grupo = 'bebida' order by -ln(1 - random()) / peso limit 3;
    select sum(i.cantidad * p.precio) into v_sub from items_t i join pesos p using (producto_id);
    v_moz := v_mozos[k]; v_hora := now() - (25 + 25 * k) * interval '1 minute';
    insert into tickets (jornada, hora, mesa_numero, mesa_abierta, comensales, mozo_id, mozo_nombre, subtotal, total, medio, cobrado_por, min_cocina, min_barra)
    values (v_hoy, v_hora, 9 + k, v_hora - interval '70 minutes', 2, v_moz, (select nombre from perfiles where id = v_moz), v_sub, v_sub,
            (array['Efectivo', 'Débito', 'Transferencia / QR'])[k], coalesce(v_enc, v_admin), array[12 + k * 3], array[4])
    returning id into t;
    update tickets set medio = (select nombre from medios_pago where activo order by orden limit 1) where id = t and not exists (select 1 from medios_pago where nombre = tickets.medio and activo);
    insert into datos_prueba values ('tickets', t::text);
    insert into ticket_items (ticket_id, producto_id, nombre, categoria, cantidad, precio, costo_unit)
    select t, p.id, p.nombre, c.nombre, sum(i.cantidad), p.precio, coalesce(costo_receta(p.id), 0)
    from items_t i join productos p on p.id = i.producto_id join categorias c on c.id = p.categoria_id group by p.id, p.nombre, c.nombre, p.precio;
    update tickets set costo = (select coalesce(sum(cantidad * costo_unit), 0) from ticket_items where ticket_id = t) where id = t;
  end loop;

  -- Mesas en curso: cada una muestra un estado distinto en Mesas y en Comandas
  for r in select * from (values
      (1, 4, 50, 'listo', 'entregado', false, false), (2, 2, 6, 'pendiente', 'listo', false, false), (3, 3, 75, 'entregado', 'entregado', false, true),
      (4, 5, 29, 'preparando', 'entregado', false, false), (5, 2, 15, null, null, true, false), (6, 6, 3, null, 'pendiente', false, false),
      (7, 4, 18, 'preparando', 'preparando', false, false)) v(orden, comensales, minutos, cocina, barra, qr, cuenta) loop
    select id into v_p from mesas m where activa and estado = 'libre' and not exists (select 1 from datos_prueba d where d.tabla = 'mesas' and d.id = m.id::text) order by numero limit 1;
    exit when v_p is null;
    v_moz := v_mozos[1 + (r.orden % array_length(v_mozos, 1))];
    update mesas set estado = case when r.cuenta then 'cuenta' else 'ocupada' end::estado_mesa, abierta = now() - (r.minutos + 10) * interval '1 minute',
                     comensales = r.comensales, mozo_id = v_moz where id = v_p;
    insert into datos_prueba values ('mesas', v_p::text);
    truncate items_t;
    if r.cocina is not null or r.qr then
      for j in 1..greatest(1, r.comensales - 1) loop insert into items_t select producto_id, 1 from pesos where grupo in ('plato', 'guarni') order by -ln(1 - random()) / peso limit 1; end loop;
    end if;
    if r.barra is not null or r.qr then
      for j in 1..r.comensales loop insert into items_t select producto_id, 1 from pesos where grupo = 'bebida' order by -ln(1 - random()) / peso limit 1; end loop;
    end if;
    insert into pedidos (mesa_id, origen, confirmado, creado, confirmado_en, mozo_id, est_cocina, est_barra, t_cocina_listo, t_barra_listo)
    values (v_p, case when r.qr then 'qr' else 'mozo' end, not r.qr, now() - r.minutos * interval '1 minute', case when not r.qr then now() - r.minutos * interval '1 minute' end,
            case when not r.qr then v_moz end,
            case when r.qr then null when exists (select 1 from items_t i join pesos p using (producto_id) where p.estacion = 'cocina') then coalesce(r.cocina, 'pendiente')::estado_comanda end,
            case when r.qr then null when exists (select 1 from items_t i join pesos p using (producto_id) where p.estacion = 'barra') then coalesce(r.barra, 'pendiente')::estado_comanda end,
            case when r.cocina in ('listo', 'entregado') then now() - (r.minutos - 14) * interval '1 minute' end,
            case when r.barra in ('listo', 'entregado') then now() - (r.minutos - 4) * interval '1 minute' end)
    returning id into v_c;
    insert into datos_prueba values ('pedidos', v_c::text);
    insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion, nota)
    select v_c, p.producto_id, p.nombre, sum(i.cantidad), p.precio, p.estacion,
           case when p.nombre in ('Vacío', 'Bife de chorizo', 'Entraña') and random() < 0.5 then (array['A punto', 'Jugoso', 'Bien cocido'])[1 + floor(random() * 3)::int] end
    from items_t i join pesos p using (producto_id) group by p.producto_id, p.nombre, p.precio, p.estacion;
    if r.qr then
      insert into llamados (mesa_id, creado) values (v_p, now() - interval '2 minutes') on conflict do nothing;
      insert into datos_prueba values ('llamados', v_p::text) on conflict do nothing;
    end if;
  end loop;
end $$;

select format('Listo: %s ventas en %s noches, %s compras, %s gastos, %s reservas y %s mesas abiertas ahora.',
  (select count(*) from datos_prueba where tabla = 'tickets'), (select count(*) from datos_prueba where tabla = 'jornadas'),
  (select count(*) from datos_prueba where tabla = 'compras'), (select count(*) from datos_prueba where tabla = 'gastos'),
  (select count(*) from datos_prueba where tabla = 'reservas'), (select count(*) from datos_prueba where tabla = 'mesas')) as resultado;
