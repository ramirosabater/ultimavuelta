-- =====================================================================
-- Última Vuelta · Funciones de la operación
--   Salón: abrir mesa, cargar y confirmar pedidos, comandas, llamados, cobrar.
--   Caja: abrir, gastos con la plata de la caja, cerrar.
--   Stock: compras, mermas, conteos e inventarios, recetas.
--   Plata: pagar deudas, saldos de las cuentas.
-- Cada función revisa el rol de quien la llama. Los precios y costos salen
-- siempre de la base, nunca de lo que manda el navegador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function param(p_clave text, p_defecto text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from parametros where clave = p_clave), p_defecto)
$$;

create or replace function zona() returns text
language sql stable set search_path = public as $$ select param('zona_horaria', 'America/Argentina/Buenos_Aires') $$;

-- La jornada de un momento: lo vendido antes de la hora de corte cuenta para la noche anterior
create or replace function jornada_de(p_ts timestamptz) returns date
language sql stable set search_path = public as $$
  select ((p_ts at time zone zona()) - make_interval(hours => coalesce(nullif(param('corte_jornada'), '')::int, 6)))::date
$$;
create or replace function jornada_actual() returns date
language sql stable set search_path = public as $$ select jornada_de(now()) $$;
create or replace function hoy_local() returns date
language sql stable set search_path = public as $$ select (now() at time zone zona())::date $$;

-- Cantidad a comprar para tener p_limpio después de limpiar (merma de limpieza)
create or replace function bruto(p_limpio numeric, p_merma numeric) returns numeric
language sql immutable as $$ select p_limpio / (1 - least(coalesce(p_merma, 0), 90) / 100.0) $$;

-- Costo de una porción según la receta y el último precio de cada artículo
create or replace function costo_receta(p_producto bigint) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(bruto(r.cantidad, i.merma_pct) * i.costo), 0)
  from receta_items r join insumos i on i.id = r.insumo_id where r.producto_id = p_producto
$$;

create or replace function exigir(p_ok boolean, p_mensaje text) returns void
language plpgsql as $$ begin if not coalesce(p_ok, false) then raise exception '%', p_mensaje using errcode = 'P0001'; end if; end $$;

-- ---------------------------------------------------------------------
-- Salón
-- ---------------------------------------------------------------------
create or replace function abrir_mesa(p_mesa bigint, p_comensales int default null) returns void
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede abrir mesas.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found, 'La mesa no existe.');
  perform exigir(m.estado = 'libre', format('La mesa %s ya está abierta.', m.numero));
  update mesas set estado = 'ocupada', abierta = now(), comensales = nullif(p_comensales, 0), mozo_id = auth.uid() where id = p_mesa;
end $$;

-- Valida los ítems que manda el navegador y devuelve los que se pueden cargar, con precio y estación de la carta
create or replace function items_validos(p_items jsonb)
returns table (producto_id bigint, nombre text, cantidad int, precio numeric, estacion estacion, nota text)
language plpgsql stable security definer set search_path = public as $$
declare x jsonb; p productos; n int := 0;
begin
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 40, 'El pedido está vacío o es demasiado largo.');
  for x in select * from jsonb_array_elements(p_items) loop
    select * into p from productos where id = (x->>'producto_id')::bigint;
    perform exigir(found and p.activo, 'Uno de los productos ya no está en la carta. Actualizá la página.');
    perform exigir(not p.controla_stock or p.stock > 0, format('%s está agotado.', p.nombre));
    perform exigir((x->>'cantidad')::int between 1 and 30, 'Cantidad no válida.');
    n := n + (x->>'cantidad')::int;
    producto_id := p.id; nombre := p.nombre; cantidad := (x->>'cantidad')::int; precio := p.precio; estacion := p.estacion;
    nota := nullif(left(trim(coalesce(x->>'nota', '')), 140), '');
    return next;
  end loop;
  perform exigir(n <= 60, 'El pedido tiene demasiadas unidades.');
end $$;

create or replace function crear_pedido(p_mesa bigint, p_items jsonb, p_origen text, p_confirmado boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into pedidos (mesa_id, origen, confirmado, confirmado_en, mozo_id)
  values (p_mesa, p_origen, p_confirmado, case when p_confirmado then now() end, case when p_confirmado then auth.uid() end)
  returning id into v_id;
  insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion, nota)
  select v_id, v.producto_id, v.nombre, v.cantidad, v.precio, v.estacion, v.nota from items_validos(p_items) v;
  update pedidos set
    est_cocina = case when exists (select 1 from pedido_items where pedido_id = v_id and estacion = 'cocina') then 'pendiente'::estado_comanda end,
    est_barra  = case when exists (select 1 from pedido_items where pedido_id = v_id and estacion = 'barra')  then 'pendiente'::estado_comanda end
  where id = v_id;
  return v_id;
end $$;

-- El mozo carga una comanda. Si la mesa estaba libre, la abre.
create or replace function cargar_pedido(p_mesa bigint, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cargar pedidos.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found and m.activa, 'La mesa no existe.');
  if m.estado = 'libre' then
    update mesas set estado = 'ocupada', abierta = now(), mozo_id = auth.uid() where id = p_mesa;
  end if;
  return crear_pedido(p_mesa, p_items, 'mozo', true);
end $$;

-- Un pedido que hizo el cliente por QR: el mozo lo confirma y recién ahí va a parrilla y barra
create or replace function confirmar_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  perform exigir(es_salon(), 'Tu usuario no puede confirmar pedidos.');
  select * into p from pedidos where id = p_pedido for update;
  perform exigir(found and p.ticket_id is null, 'El pedido ya no existe.');
  perform exigir(not p.confirmado, 'El pedido ya estaba confirmado.');
  update pedidos set confirmado = true, confirmado_en = now(), creado = now(), mozo_id = auth.uid() where id = p_pedido;
  update mesas set estado = 'ocupada', abierta = coalesce(abierta, now()), mozo_id = coalesce(mozo_id, auth.uid())
  where id = p.mesa_id and estado = 'libre';
end $$;

-- Rechazar un pedido del QR o anular uno que todavía no empezaron a preparar
create or replace function anular_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  perform exigir(es_salon(), 'Tu usuario no puede anular pedidos.');
  select * into p from pedidos where id = p_pedido for update;
  perform exigir(found and p.ticket_id is null, 'El pedido ya no existe.');
  perform exigir(not p.confirmado or es_gestion()
                 or (coalesce(p.est_cocina, 'pendiente') = 'pendiente' and coalesce(p.est_barra, 'pendiente') = 'pendiente'),
                 'Ya lo están preparando: pedile a un encargado que lo anule.');
  delete from pedidos where id = p_pedido;
end $$;

-- Parrilla y barra avanzan sus comandas; el mozo marca lo entregado
create or replace function avanzar_comanda(p_pedido bigint, p_estacion estacion, p_estado estado_comanda) returns void
language plpgsql security definer set search_path = public as $$
declare v_rol rol_usuario := mi_rol();
begin
  perform exigir(v_rol in ('admin', 'encargado', 'mozo') or v_rol::text = p_estacion::text, 'Esta comanda es de otra estación.');
  if p_estacion = 'cocina' then
    update pedidos set est_cocina = p_estado, t_cocina_listo = case when p_estado = 'listo' then now() else t_cocina_listo end
    where id = p_pedido and confirmado and ticket_id is null and est_cocina is not null;
  else
    update pedidos set est_barra = p_estado, t_barra_listo = case when p_estado = 'listo' then now() else t_barra_listo end
    where id = p_pedido and confirmado and ticket_id is null and est_barra is not null;
  end if;
  perform exigir(found, 'La comanda ya no existe.');
end $$;

-- El mozo retiró lo que estaba listo (de parrilla, de barra o de las dos)
create or replace function entregar_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede marcar entregas.');
  update pedidos set
    est_cocina = case when est_cocina = 'listo' then 'entregado' else est_cocina end,
    est_barra  = case when est_barra  = 'listo' then 'entregado' else est_barra  end
  where id = p_pedido and ticket_id is null;
end $$;

create or replace function pedir_cuenta(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  update mesas set estado = 'cuenta' where id = p_mesa and estado <> 'libre';
  delete from llamados where mesa_id = p_mesa;
end $$;

create or replace function atender_llamado(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede atender mesas.');
  delete from llamados where mesa_id = p_mesa;
end $$;

-- Cerrar una mesa sin cobrar (se abrió por error o se fueron sin consumir)
create or replace function liberar_mesa(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  perform exigir(not exists (select 1 from pedidos where mesa_id = p_mesa and ticket_id is null and confirmado),
                 'La mesa tiene pedidos: cobrala o anulá los pedidos primero.');
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_mesa;
end $$;

-- Pasar todo de una mesa a otra que esté libre
create or replace function mover_mesa(p_desde bigint, p_hacia bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a mesas; b mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  select * into a from mesas where id = p_desde for update;
  select * into b from mesas where id = p_hacia for update;
  perform exigir(a.id is not null and b.id is not null and b.activa, 'La mesa no existe.');
  perform exigir(b.estado = 'libre' and not exists (select 1 from pedidos where mesa_id = p_hacia and ticket_id is null),
                 format('La mesa %s no está libre.', b.numero));
  update pedidos set mesa_id = p_hacia where mesa_id = p_desde and ticket_id is null;
  update mesas set estado = a.estado, abierta = a.abierta, comensales = a.comensales, mozo_id = a.mozo_id where id = p_hacia;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_desde;
  delete from llamados where mesa_id = p_desde;
end $$;

-- ---------------------------------------------------------------------
-- Cobrar: ticket, costo de mercadería, descuento de stock y mesa libre, todo junto
-- ---------------------------------------------------------------------
create or replace function cobrar_mesa(p_mesa bigint, p_medio text, p_descuento numeric default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m mesas; v_t bigint; v_sub numeric; v_tot numeric; v_j date := jornada_actual(); r record;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cobrar.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found, 'La mesa no existe.');
  perform exigir(exists (select 1 from medios_pago where nombre = p_medio and activo), 'Elegí un medio de pago.');
  p_descuento := coalesce(p_descuento, 0);
  perform exigir(p_descuento between 0 and 100, 'El descuento tiene que estar entre 0 y 100 %.');

  select sum(i.cantidad * i.precio) into v_sub
  from pedido_items i join pedidos p on p.id = i.pedido_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado;
  perform exigir(v_sub is not null, format('La mesa %s no tiene nada para cobrar.', m.numero));
  v_tot := round(v_sub * (1 - p_descuento / 100), 2);

  insert into tickets (jornada, mesa_numero, mesa_abierta, comensales, mozo_id, mozo_nombre, subtotal, descuento_pct, total, medio, cobrado_por,
                       min_cocina, min_barra)
  select v_j, m.numero, m.abierta, m.comensales, m.mozo_id, (select nombre from perfiles where id = m.mozo_id), v_sub, p_descuento, v_tot, p_medio, auth.uid(),
         coalesce(array_agg(round(extract(epoch from p.t_cocina_listo - p.creado) / 60)::int) filter (where p.t_cocina_listo is not null), '{}'),
         coalesce(array_agg(round(extract(epoch from p.t_barra_listo  - p.creado) / 60)::int) filter (where p.t_barra_listo  is not null), '{}')
  from pedidos p where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  returning id into v_t;

  insert into ticket_items (ticket_id, producto_id, nombre, categoria, cantidad, precio, costo_unit)
  select v_t, i.producto_id, i.nombre, c.nombre, sum(i.cantidad), i.precio, coalesce(costo_receta(i.producto_id), 0)
  from pedido_items i join pedidos p on p.id = i.pedido_id
  left join productos pr on pr.id = i.producto_id left join categorias c on c.id = pr.categoria_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  group by i.producto_id, i.nombre, c.nombre, i.precio;

  update tickets set costo = (select coalesce(sum(cantidad * costo_unit), 0) from ticket_items where ticket_id = v_t) where id = v_t;

  -- Bebidas que se cuentan por unidad
  for r in select ti.producto_id, sum(ti.cantidad) q from ticket_items ti join productos p on p.id = ti.producto_id
           where ti.ticket_id = v_t and p.controla_stock group by ti.producto_id loop
    update productos set stock = greatest(0, stock - r.q) where id = r.producto_id;
    insert into movimientos_stock (producto_id, tipo, cantidad, jornada, ticket_id, usuario_id) values (r.producto_id, 'venta', -r.q, v_j, v_t, auth.uid());
  end loop;

  -- Artículos de las recetas (con la merma de limpieza)
  for r in select ri.insumo_id, sum(ti.cantidad * bruto(ri.cantidad, i.merma_pct)) q, max(i.costo) c
           from ticket_items ti join receta_items ri on ri.producto_id = ti.producto_id join insumos i on i.id = ri.insumo_id
           where ti.ticket_id = v_t group by ri.insumo_id loop
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, ticket_id, usuario_id)
    values (r.insumo_id, 'venta', -round(r.q, 3), r.c, v_j, v_t, auth.uid());
    update insumos set cantidad = greatest(0, cantidad - round(r.q, 3)) where id = r.insumo_id;
  end loop;

  -- Los pedidos quedan como historia del ticket; los del QR sin confirmar se descartan
  update pedidos set ticket_id = v_t,
    est_cocina = case when est_cocina is null then null else 'entregado'::estado_comanda end,
    est_barra  = case when est_barra  is null then null else 'entregado'::estado_comanda end
  where mesa_id = p_mesa and ticket_id is null and confirmado;
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_mesa;

  return jsonb_build_object('id', v_t, 'total', v_tot, 'subtotal', v_sub, 'medio', p_medio, 'mesa', m.numero);
end $$;

-- ---------------------------------------------------------------------
-- Caja del día
-- ---------------------------------------------------------------------
create or replace function cuenta_efectivo() returns bigint
language sql stable set search_path = public as $$
  select coalesce((select cuenta_id from medios_pago where nombre = 'Efectivo'),
                  (select id from cuentas where tipo = 'Efectivo' and activa order by orden limit 1))
$$;

create or replace function abrir_caja(p_monto numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_actual();
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados abren la caja.');
  perform exigir(coalesce(p_monto, -1) >= 0, 'Cargá el efectivo inicial (puede ser 0).');
  perform exigir(not exists (select 1 from jornadas where fecha = v_j and apertura is not null), 'La caja de hoy ya está abierta.');
  insert into jornadas (fecha, apertura, abierta_en, abierta_por) values (v_j, p_monto, now(), auth.uid())
  on conflict (fecha) do update set apertura = excluded.apertura, abierta_en = excluded.abierta_en, abierta_por = excluded.abierta_por;
end $$;

create or replace function registrar_gasto_caja(p_concepto text, p_monto numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_actual(); v_c bigint := cuenta_efectivo();
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados sacan plata de la caja.');
  perform exigir(length(trim(coalesce(p_concepto, ''))) > 0 and coalesce(p_monto, 0) > 0, 'Completá concepto y monto.');
  perform exigir(v_c is not null, 'Falta una cuenta de efectivo (Administración → Cuentas).');
  insert into gastos (fecha, concepto, categoria, monto, estado, cuenta_id, pagado_el, origen, jornada, usuario_id)
  values (hoy_local(), trim(p_concepto), 'Caja chica', p_monto, 'pagado', v_c, hoy_local(), 'caja', v_j, auth.uid());
end $$;

-- Lo que debería haber en la caja: inicial + ventas en efectivo − gastos pagados con la caja
create or replace function efectivo_esperado(p_jornada date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select apertura from jornadas where fecha = p_jornada), 0)
       + coalesce((select sum(t.total) from tickets t join medios_pago mp on mp.nombre = t.medio
                   join cuentas c on c.id = mp.cuenta_id where t.jornada = p_jornada and c.tipo = 'Efectivo'), 0)
       - coalesce((select sum(monto) from gastos where jornada = p_jornada and origen = 'caja'), 0)
$$;

create or replace function cerrar_caja(p_contado numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_actual(); v_e numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cierran la caja.');
  perform exigir(coalesce(p_contado, -1) >= 0, 'Cargá el efectivo contado.');
  perform exigir(exists (select 1 from jornadas where fecha = v_j and apertura is not null), 'La caja de hoy no está abierta.');
  v_e := efectivo_esperado(v_j);
  update jornadas set cierre_contado = p_contado, cierre_esperado = v_e, cerrada_en = now(), cerrada_por = auth.uid() where fecha = v_j;
  return jsonb_build_object('contado', p_contado, 'esperado', v_e, 'diferencia', p_contado - v_e);
end $$;

-- ---------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------
-- Una compra (una factura o lo que llegó de un artículo): suma stock, actualiza el costo y deja el gasto
-- p_items: [{insumo_id, cantidad, total, vence}] · p_pago: 'pendiente' o el id de la cuenta con que se pagó
create or replace function registrar_compra(p_items jsonb, p_proveedor bigint default null, p_numero text default null,
                                            p_fecha date default null, p_pago text default 'pendiente',
                                            p_proveedor_nuevo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prov bigint := p_proveedor; v_fecha date := coalesce(p_fecha, hoy_local()); v_c bigint; v_tot numeric := 0;
  x jsonb; i insumos; v_cant numeric; v_monto numeric; v_cu numeric; v_plazo int; v_nombre text; v_n int := 0; v_cuenta bigint;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cargan compras.');
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 80, 'La compra no tiene artículos.');
  if v_prov is null and length(trim(coalesce(p_proveedor_nuevo, ''))) > 0 then
    insert into proveedores (nombre) values (trim(p_proveedor_nuevo))
    on conflict (nombre) do update set nombre = excluded.nombre returning id into v_prov;
  end if;
  if p_pago is not null and p_pago <> 'pendiente' then
    v_cuenta := p_pago::bigint;
    perform exigir(exists (select 1 from cuentas where id = v_cuenta), 'La cuenta no existe.');
  end if;

  insert into compras (proveedor_id, numero, fecha, usuario_id) values (v_prov, nullif(trim(p_numero), ''), v_fecha, auth.uid()) returning id into v_c;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into i from insumos where id = (x->>'insumo_id')::bigint for update;
    perform exigir(found, 'Uno de los artículos no existe.');
    v_cant := (x->>'cantidad')::numeric; v_monto := coalesce(nullif(x->>'total', '')::numeric, 0);
    perform exigir(v_cant > 0 and v_monto >= 0, format('Revisá cantidad y precio de %s.', i.nombre));
    v_cu := case when v_monto > 0 then v_monto / v_cant else i.costo end;
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, compra_id, usuario_id)
    values (i.id, 'compra', v_cant, round(v_cu, 4), jornada_actual(), v_c, auth.uid());
    update insumos set cantidad = cantidad + v_cant, costo = round(v_cu, 4),
      vence = coalesce(nullif(x->>'vence', '')::date, case when cantidad <= 0 then null else vence end),
      proveedor_id = coalesce(proveedor_id, v_prov)
    where id = i.id;
    v_tot := v_tot + case when v_monto > 0 then v_monto else v_cant * i.costo end;
    v_n := v_n + 1; v_nombre := i.nombre;
  end loop;
  update compras set total = round(v_tot, 2) where id = v_c;

  if v_tot > 0 then
    select plazo_dias into v_plazo from proveedores where id = v_prov;
    insert into gastos (fecha, concepto, categoria, monto, proveedor_id, estado, cuenta_id, pagado_el, vence, origen, compra_id, usuario_id)
    values (v_fecha,
            case when nullif(trim(p_numero), '') is not null then 'Factura ' || trim(p_numero)
                 when v_n = 1 then 'Compra: ' || v_nombre else format('Compra de %s artículos', v_n) end,
            'Mercadería', round(v_tot, 2), v_prov,
            case when v_cuenta is null then 'pendiente' else 'pagado' end, v_cuenta,
            case when v_cuenta is null then null else v_fecha end,
            case when v_cuenta is null then v_fecha + coalesce(v_plazo, 0) end, 'compra', v_c, auth.uid());
  end if;
  return jsonb_build_object('compra', v_c, 'total', round(v_tot, 2), 'articulos', v_n, 'proveedor', v_prov);
end $$;

create or replace function registrar_merma(p_insumo bigint, p_cantidad numeric, p_motivo text, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i insumos;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados registran mermas.');
  perform exigir(coalesce(p_cantidad, 0) > 0, 'Cargá la cantidad que se tiró.');
  select * into i from insumos where id = p_insumo for update;
  perform exigir(found, 'El artículo no existe.');
  insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, nota, jornada, usuario_id)
  values (p_insumo, 'merma', -p_cantidad, i.costo, coalesce(nullif(trim(p_motivo), ''), 'Otro'), nullif(trim(p_nota), ''), jornada_actual(), auth.uid());
  update insumos set cantidad = greatest(0, cantidad - p_cantidad) where id = p_insumo;
end $$;

-- Inventario: lo contado pasa a ser lo que hay; las diferencias quedan como movimiento de conteo
-- p_items: [{insumo_id, cantidad}] · p_completo = false para un conteo suelto de un artículo
create or replace function guardar_inventario(p_items jsonb, p_completo boolean default true, p_nota text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; x jsonb; i insumos; v_c numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cargan inventarios.');
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Cargá al menos un artículo contado.');
  insert into inventarios (completo, usuario_id, nota) values (coalesce(p_completo, true), auth.uid(), nullif(trim(p_nota), '')) returning id into v_id;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into i from insumos where id = (x->>'insumo_id')::bigint for update;
    perform exigir(found, 'Uno de los artículos no existe.');
    v_c := (x->>'cantidad')::numeric;
    perform exigir(v_c >= 0, format('La cantidad de %s no puede ser negativa.', i.nombre));
    insert into inventario_items (inventario_id, insumo_id, cantidad, sistema) values (v_id, i.id, v_c, i.cantidad);
    if v_c <> i.cantidad then
      insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, jornada, usuario_id)
      values (i.id, 'conteo', v_c - i.cantidad, i.costo, 'Diferencia de conteo', jornada_actual(), auth.uid());
      update insumos set cantidad = v_c where id = i.id;
    end if;
  end loop;
  return v_id;
end $$;

-- Bebidas por unidad: lo que entra y los ajustes a mano
create or replace function mover_stock_producto(p_producto bigint, p_cantidad numeric, p_tipo text default 'ingreso') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados ajustan el stock.');
  perform exigir(p_tipo in ('ingreso', 'conteo') and coalesce(p_cantidad, 0) <> 0, 'Movimiento no válido.');
  update productos set stock = greatest(0, stock + p_cantidad) where id = p_producto and controla_stock;
  perform exigir(found, 'Ese producto no controla stock por unidad.');
  insert into movimientos_stock (producto_id, tipo, cantidad, jornada, usuario_id) values (p_producto, p_tipo, p_cantidad, jornada_actual(), auth.uid());
end $$;

-- Reemplaza la receta completa de un plato. p_items: [{insumo_id, cantidad}]
create or replace function guardar_receta(p_producto bigint, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cambian recetas.');
  perform exigir(exists (select 1 from productos where id = p_producto), 'El plato no existe.');
  delete from receta_items where producto_id = p_producto;
  insert into receta_items (producto_id, insumo_id, cantidad)
  select p_producto, (x->>'insumo_id')::bigint, sum((x->>'cantidad')::numeric)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where (x->>'cantidad')::numeric > 0 group by 2;
end $$;

-- ---------------------------------------------------------------------
-- Plata
-- ---------------------------------------------------------------------
create or replace function pagar_gasto(p_gasto bigint, p_cuenta bigint, p_fecha date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados registran pagos.');
  perform exigir(exists (select 1 from cuentas where id = p_cuenta), 'Elegí de qué cuenta sale la plata.');
  update gastos set estado = 'pagado', cuenta_id = p_cuenta, pagado_el = coalesce(p_fecha, hoy_local())
  where id = p_gasto and estado = 'pendiente';
  perform exigir(found, 'Ese gasto ya estaba pagado.');
end $$;

-- Saldo de una cuenta: inicial + ventas cobradas con sus medios − gastos pagados desde ella ± transferencias y ajustes
create or replace function saldo_cuenta(p_cuenta bigint, p_hasta date default null) returns numeric
language sql stable security definer set search_path = public as $$
  with c as (select * from cuentas where id = p_cuenta), h as (select coalesce(p_hasta, '9999-12-31'::date) d)
  select (select saldo_inicial from c)
    + coalesce((select sum(t.total) from tickets t join medios_pago mp on mp.nombre = t.medio
                where mp.cuenta_id = p_cuenta and t.jornada >= (select desde from c) and t.jornada <= (select d from h)), 0)
    - coalesce((select sum(monto) from gastos where cuenta_id = p_cuenta and estado = 'pagado'
                and pagado_el >= (select desde from c) and pagado_el <= (select d from h)), 0)
    + coalesce((select sum(case when a_cuenta = p_cuenta then monto else -monto end) from movimientos_cuenta
                where (a_cuenta = p_cuenta or (tipo = 'transferencia' and de_cuenta = p_cuenta))
                and fecha >= (select desde from c) and fecha <= (select d from h)), 0)
$$;

create or replace function saldos_cuentas() returns table (id bigint, nombre text, tipo text, saldo numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre, c.tipo, saldo_cuenta(c.id) from cuentas c where es_gestion() and c.activa order by c.orden, c.nombre
$$;
