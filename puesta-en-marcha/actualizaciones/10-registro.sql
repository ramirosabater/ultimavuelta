-- =====================================================================
-- Última Vuelta · Registro de todo lo que pasa
--   Cada acción queda anotada con quién, cuándo, en qué parte de la app y qué cambió:
--   mesas, pedidos, comandas, cobros, facturas, caja, compras, stock, carta, recetas, gastos,
--   usuarios, configuración, reservas e ingresos a la app.
--   Lo sensible (anulaciones, invitaciones, borrados, cambios de precio, sin factura,
--   ajustes de stock, cambios de usuarios y configuración) queda marcado como importante.
--   Solo lo ven los dueños (admin). Se guarda un año.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

create table if not exists registro (
  id          bigint generated always as identity primary key,
  hora        timestamptz not null default now(),
  jornada     date not null default jornada_actual(),
  usuario_id  uuid,
  usuario     text not null,
  rol         text,
  area        text not null,
  accion      text not null check (accion in ('alta', 'cambio', 'baja', 'evento')),
  tabla       text,
  fila        text,
  texto       text not null,
  cambios     jsonb,
  importante  boolean not null default false
);
create index if not exists registro_hora_idx on registro (hora desc);
create index if not exists registro_jornada_idx on registro (jornada, area);
create index if not exists registro_usuario_idx on registro (usuario_id, hora desc);
alter table registro enable row level security;
drop policy if exists registro_admin on registro;
create policy registro_admin on registro for select using ((select es_admin()));
revoke insert, update, delete on registro from anon, authenticated;
grant select on registro to authenticated;

-- ---------------------------------------------------------------- ayudantes
create or replace function plata_txt(n numeric) returns text
language sql immutable as $$ select '$ ' || replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', '.') $$;

-- Lo que cambió entre dos filas: {campo: [antes, después]} (sin campos internos ni secretos)
create or replace function diferencias(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select nullif(coalesce(jsonb_object_agg(k, jsonb_build_array(a->k, b->k)), '{}'::jsonb), '{}'::jsonb)
  from (select jsonb_object_keys(coalesce(b, a)) k) x
  where (a->k) is distinct from (b->k)
    and k not in ('id', 'creado', 'token', 'codigo', 'email', 'clave', 'certificado', 'cert', 'csr', 'clave_privada', 'ta', 'ta_vence', 'actualizado')
$$;

create or replace function anotar(p_area text, p_accion text, p_tabla text, p_fila text, p_texto text,
                                  p_cambios jsonb default null, p_importante boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nom text; v_rol text;
begin
  if current_setting('uv.sin_registro', true) = 'on' then return; end if;   -- los datos de prueba no se anotan
  if v_uid is not null then
    select nombre, rol::text into v_nom, v_rol from perfiles where id = v_uid;
  end if;
  insert into registro (usuario_id, usuario, rol, area, accion, tabla, fila, texto, cambios, importante)
  values (v_uid,
          coalesce(v_nom, case when v_uid is not null then 'Usuario sin perfil'
                               when coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role') = 'anon' then 'Cliente (QR o web)'
                               else 'Sistema' end),
          v_rol, p_area, p_accion, p_tabla, p_fila, left(p_texto, 600), p_cambios, coalesce(p_importante, false));
exception when others then
  null;   -- el registro nunca frena una operación
end $$;
revoke execute on function anotar(text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;

-- Para anotar desde la app (por ahora: entrar a la app)
create or replace function registrar_ingreso() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  -- uno cada 6 horas por usuario
  if exists (select 1 from registro where usuario_id = auth.uid() and tabla = 'ingreso' and hora > now() - interval '6 hours') then return; end if;
  perform anotar('Ingresos', 'evento', 'ingreso', auth.uid()::text, 'Entró a la app');
end $$;

-- ---------------------------------------------------------------- registro por fila
create or replace function registrar_fila() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  d jsonb := case when tg_op = 'UPDATE' then diferencias(o, n) end;
  acc text := case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end;
  m mesas; t text; area text; imp boolean := tg_op = 'DELETE'; nom text := coalesce(r->>'nombre', r->>'concepto', r->>'clave', r->>'id');
  k text;
begin
  if tg_op = 'UPDATE' and d is null then return null; end if;

  case tg_table_name
  -- ------------------------------------------------ salón
  when 'mesas' then
    area := 'Salón'; m := coalesce(new, old);
    if tg_op = 'INSERT' then
      t := case when m.temporal then 'Abrió la cuenta ' || nombre_mesa(m) else 'Creó la mesa ' || m.numero end; imp := false;
    elsif tg_op = 'DELETE' then t := 'Borró ' || nombre_mesa(old);
    else
      d := d - 'abierta' - 'mozo_id';
      if d ? 'junta_con' and new.junta_con is not null then
        t := format('Juntó la mesa %s con la %s', new.numero, (select numero from mesas where id = new.junta_con));
      elsif d ? 'junta_con' then
        if new.estado = 'libre' and exists (select 1 from mesas p where p.id = old.junta_con and p.estado = 'libre') then return null; end if;
        t := format('Separó la mesa %s', new.numero);
      elsif d ? 'estado' then
        if new.estado = 'ocupada' and old.estado = 'libre' then
          if new.junta_con is not null then return null; end if;
          t := 'Abrió ' || nombre_mesa(new) || case when new.comensales > 0 then format(' (%s personas)', new.comensales) else '' end;
        elsif new.estado = 'cuenta' then t := nombre_mesa(new) || ' pidió la cuenta';
        elsif new.estado = 'libre' then
          if exists (select 1 from tickets x where x.hora = now() and (x.mesa_numero = new.numero and new.tipo = 'mesa' or x.mesa_nombre = nombre_mesa(new))) then return null; end if;
          if old.junta_con is not null then return null; end if;
          t := 'Liberó ' || nombre_mesa(new) || ' sin cobrar';
        else t := nombre_mesa(new) || ': ' || old.estado || ' → ' || new.estado; end if;
      elsif d ? 'comensales' and d - 'comensales' = '{}'::jsonb then
        t := format('%s: %s personas', nombre_mesa(new), new.comensales);
      elsif d is null or d = '{}'::jsonb then return null;
      else t := 'Cambió ' || nombre_mesa(new); area := 'Carta'; end if;
    end if;

  when 'pedidos' then
    area := 'Salón';
    select * into m from mesas where id = coalesce(new.mesa_id, old.mesa_id);
    if tg_op = 'INSERT' then return null;   -- se anota con los productos (registrar_items)
    elsif tg_op = 'DELETE' then
      if old.ticket_id is not null then return null; end if;
      t := case when old.confirmado then 'Anuló un pedido de ' else 'Rechazó un pedido por QR de ' end || nombre_mesa(m)
           || coalesce(': ' || (select string_agg(i.cantidad || '× ' || i.nombre, ', ') from pedido_items i where i.pedido_id = old.id), '');
    else
      if new.ticket_id is not null and old.ticket_id is null then return null; end if;   -- el cobro
      if d ? 'confirmado' and new.confirmado then t := 'Confirmó el pedido por QR de ' || nombre_mesa(m); imp := false;
      elsif d ? 'mesa_id' then
        if (select junta_con from mesas where id = old.mesa_id) = new.mesa_id or exists (select 1 from mesas where id = old.mesa_id and junta_con is not null) then return null; end if;
        t := format('Pasó un pedido de %s a %s', (select nombre_mesa(x) from mesas x where id = old.mesa_id), nombre_mesa(m));
      elsif d ? 'est_cocina' or d ? 'est_barra' then
        if (d ? 'est_cocina' and old.est_cocina is null) or (d ? 'est_barra' and old.est_barra is null) then return null; end if;   -- el pedido recién cargado
        area := case when d ? 'est_cocina' then 'Cocina' else 'Bebidas' end;
        k := case when d ? 'est_cocina' then new.est_cocina::text else new.est_barra::text end;
        t := case k when 'preparando' then 'Empezó el pedido de ' when 'listo' then 'Marcó listo el pedido de ' when 'entregado' then 'Entregó el pedido de ' else 'Cambió el pedido de ' end || nombre_mesa(m);
        if k = 'entregado' then area := 'Salón'; end if;
      else return null; end if;
    end if;

  when 'llamados' then
    if tg_op <> 'INSERT' then return null; end if;
    area := 'Salón'; select * into m from mesas where id = new.mesa_id;
    t := nombre_mesa(m) || ' llamó al mozo'; acc := 'evento';

  when 'pedido_cambios' then
    area := 'Salón'; imp := true; acc := 'evento';
    t := format('%s %s× %s en %s', initcap(new.tipo), new.cantidad, new.nombre, new.mesa)
         || case when new.importe > 0 then ' (' || plata_txt(new.importe) || ')' else '' end || coalesce(' · motivo: ' || new.motivo, '');

  -- ------------------------------------------------ caja
  when 'tickets' then
    area := 'Caja';
    if tg_op = 'INSERT' then
      t := format('Cobró %s: %s', coalesce(new.mesa_nombre, 'Mesa ' || new.mesa_numero), plata_txt(new.total))
           || case when new.descuento_pct > 0 then format(' con %s %% de descuento', new.descuento_pct::float8) else '' end
           || case when new.propina > 0 then ' + ' || plata_txt(new.propina) || ' de propina' else '' end
           || ' · ' || new.medio || case when new.mesas_juntas is not null then ' · mesas juntas: ' || array_to_string(new.mesas_juntas, ', ') else '' end;
      imp := new.descuento_pct > 0;
    elsif tg_op = 'UPDATE' then
      if not d ? 'sin_factura' then return null; end if;
      t := format('Marcó el ticket N° %s (%s) %s', new.id, plata_txt(new.total), case when new.sin_factura then 'sin factura' else 'para facturar' end); imp := true;
    else t := format('Borró el ticket N° %s (%s)', old.id, plata_txt(old.total)); end if;

  when 'facturas' then
    area := 'Caja';
    if tg_op = 'INSERT' then return null; end if;
    if tg_op = 'UPDATE' then
      if d ? 'anulada' and new.anulada then t := format('Anuló la factura C %s-%s (%s)', new.punto_venta, new.numero, plata_txt(new.total)); imp := true;
      elsif d ? 'estado' and new.estado = 'autorizada' then
        t := format('%s %s-%s autorizada por ARCA: %s', case new.tipo when 13 then 'Nota de crédito C' else 'Factura C' end, new.punto_venta, new.numero, plata_txt(new.total))
             || case when new.ambiente = 'homologacion' then ' (de prueba)' else '' end;
      elsif d ? 'estado' and new.estado = 'rechazada' then t := format('ARCA rechazó una factura de %s', plata_txt(new.total)); imp := true;
      else return null; end if;
    else return null; end if;

  when 'jornadas' then
    area := 'Caja';
    if d ? 'cerrada_en' and new.cerrada_en is not null then
      t := format('Cerró la caja del %s: contado %s, esperado %s', to_char(new.fecha, 'DD/MM'), plata_txt(new.cierre_contado), plata_txt(new.cierre_esperado))
           || case when abs(coalesce(new.cierre_contado, 0) - coalesce(new.cierre_esperado, 0)) >= 1 then ' · diferencia ' || plata_txt(new.cierre_contado - new.cierre_esperado) else '' end;
      imp := abs(coalesce(new.cierre_contado, 0) - coalesce(new.cierre_esperado, 0)) >= 1;
    elsif (tg_op = 'INSERT' or d ? 'abierta_en') and new.abierta_en is not null then
      t := format('Abrió la caja del %s con %s', to_char(new.fecha, 'DD/MM'), plata_txt(new.apertura));
    elsif d ? 'cerrada_en' then t := format('Reabrió la caja del %s', to_char(new.fecha, 'DD/MM')); imp := true;
    else return null; end if;

  -- ------------------------------------------------ stock y compras
  when 'compras' then
    area := 'Stock';
    if tg_op <> 'DELETE' then return null; end if;
    t := format('Anuló la compra de %s', plata_txt(old.total)) || coalesce(' a ' || (select nombre from proveedores where id = old.proveedor_id), '');

  when 'insumos' then
    area := 'Stock';
    if tg_op = 'UPDATE' then
      d := d - 'cantidad';
      if d = '{}'::jsonb or d is null then return null; end if;
      if d ? 'costo' and d - 'costo' = '{}'::jsonb then
        t := format('Costo de %s: %s → %s', new.nombre, plata_txt((d->'costo'->>0)::numeric), plata_txt(new.costo));
      elsif d ? 'activo' then t := case when new.activo then 'Activó el artículo ' else 'Desactivó el artículo ' end || new.nombre;
      else t := 'Editó el artículo ' || new.nombre; end if;
    else t := case when tg_op = 'INSERT' then 'Creó el artículo ' else 'Borró el artículo ' end || nom; end if;

  when 'inventarios' then
    if tg_op <> 'INSERT' then return null; end if;
    area := 'Stock'; acc := 'evento'; t := case when new.completo then 'Hizo el control semanal de stock' else 'Contó un artículo' end;

  when 'rendimientos' then
    area := 'Stock';
    t := case when tg_op = 'DELETE' then 'Borró una prueba de rendimiento de ' else 'Prueba de rendimiento de ' end
         || coalesce((select nombre from insumos where id = coalesce(new.insumo_id, old.insumo_id)), '?');

  when 'referencias' then area := 'Stock'; t := case acc when 'alta' then 'Agregó a la tabla de referencia: ' when 'baja' then 'Sacó de la tabla de referencia: ' else 'Editó en la tabla de referencia: ' end || nom;

  -- ------------------------------------------------ carta
  when 'productos' then
    area := 'Carta';
    if tg_op = 'UPDATE' then
      d := d - 'stock';
      if d = '{}'::jsonb or d is null then return null; end if;
      if d ? 'precio' then t := format('Precio de %s: %s → %s', new.nombre, plata_txt((d->'precio'->>0)::numeric), plata_txt(new.precio)); imp := true;
      elsif d ? 'activo' and d - 'activo' = '{}'::jsonb then t := case when new.activo then 'Puso en la carta ' else 'Pausó ' end || new.nombre;
      else t := 'Editó ' || new.nombre; end if;
    else t := case when tg_op = 'INSERT' then 'Agregó a la carta ' else 'Borró de la carta ' end || nom || coalesce(' (' || plata_txt((r->>'precio')::numeric) || ')', ''); end if;

  when 'categorias' then area := 'Carta'; t := case acc when 'alta' then 'Creó la categoría ' when 'baja' then 'Borró la categoría ' else 'Editó la categoría ' end || nom;

  when 'platos_semana' then
    area := 'Carta';
    if tg_op = 'UPDATE' and d - 'aplicado' = '{}'::jsonb then return null; end if;
    t := case when tg_op = 'DELETE' then format('Sacó el plato del día del %s', to_char(old.fecha, 'DD/MM'))
              else format('Plato del día del %s: %s (%s porciones)', to_char(new.fecha, 'DD/MM'), (select nombre from productos where id = new.producto_id), new.porciones) end;

  -- ------------------------------------------------ administración
  when 'gastos' then
    area := 'Administración';
    if tg_op = 'INSERT' then
      if new.origen = 'compra' then return null; end if;
      t := case when new.origen = 'caja' then 'Pagó con la caja: ' when new.fijo_id is not null then 'Gasto fijo del mes: ' else 'Cargó el gasto ' end
           || new.concepto || case when new.monto > 0 then ' · ' || plata_txt(new.monto) else '' end
           || case when new.estado = 'pendiente' and new.origen <> 'caja' then ' (pendiente)' else '' end;
    elsif tg_op = 'UPDATE' then
      if d ? 'estado' and new.estado = 'pagado' then
        t := format('Pagó %s: %s con %s', new.concepto, plata_txt(new.monto), coalesce((select nombre from cuentas where id = new.cuenta_id), '?'));
      elsif new.origen = 'compra' and d - 'monto' - 'estado' - 'cuenta_id' - 'pagado_el' - 'vence' = '{}'::jsonb and old.monto = 0 then return null;
      else t := 'Editó el gasto ' || new.concepto || case when d ? 'monto' then format(' (%s → %s)', plata_txt((d->'monto'->>0)::numeric), plata_txt(new.monto)) else '' end;
        imp := d ? 'monto'; end if;
    else t := format('Borró el gasto %s (%s)', old.concepto, plata_txt(old.monto));
      if old.compra_id is not null then return null; end if;
    end if;

  when 'gastos_fijos' then area := 'Administración'; t := case acc when 'alta' then 'Creó el gasto fijo ' when 'baja' then 'Borró el gasto fijo ' else 'Editó el gasto fijo ' end || nom;
  when 'proveedores' then area := 'Administración'; t := case acc when 'alta' then 'Agregó el proveedor ' when 'baja' then 'Borró el proveedor ' else 'Editó el proveedor ' end || nom;
  when 'cuentas' then area := 'Administración'; t := case acc when 'alta' then 'Creó la cuenta ' when 'baja' then 'Borró la cuenta ' else 'Editó la cuenta ' end || nom; imp := true;
  when 'medios_pago' then area := 'Administración'; t := case acc when 'alta' then 'Agregó el medio de pago ' when 'baja' then 'Borró el medio de pago ' else 'Editó el medio de pago ' end || nom;
  when 'movimientos_cuenta' then
    area := 'Administración'; imp := true;
    t := case when coalesce(new.tipo, old.tipo) = 'transferencia'
              then format('Pasó %s de %s a %s', plata_txt(coalesce(new.monto, old.monto)), (select nombre from cuentas where id = coalesce(new.de_cuenta, old.de_cuenta)), (select nombre from cuentas where id = coalesce(new.a_cuenta, old.a_cuenta)))
              else format('Ajustó el saldo de %s: %s', (select nombre from cuentas where id = coalesce(new.a_cuenta, old.a_cuenta)), plata_txt(coalesce(new.monto, old.monto))) end
         || case when tg_op = 'DELETE' then ' (borrado)' else '' end;

  when 'perfiles' then
    area := 'Usuarios'; imp := true;
    if tg_op = 'UPDATE' then
      if d ? 'rol' then t := format('Cambió el rol de %s: %s → %s', new.nombre, d->'rol'->>0, new.rol);
      elsif d ? 'activo' then t := case when new.activo then 'Activó al usuario ' else 'Desactivó al usuario ' end || new.nombre;
      else t := 'Editó al usuario ' || new.nombre; end if;
    else t := case when tg_op = 'INSERT' then format('Dio de alta al usuario %s (%s)', new.nombre, new.rol) else 'Borró al usuario ' || old.nombre end; end if;

  when 'parametros' then
    area := 'Configuración'; imp := true;
    t := format('Configuración · %s: %s → %s', case coalesce(new.clave, old.clave)
           when 'nombre_local' then 'nombre' when 'bajada_local' then 'segunda línea' when 'corte_jornada' then 'hora de corte' when 'zona_horaria' then 'zona horaria'
           when 'dias_cerrado' then 'días cerrado' when 'cobertura_dias' then 'comprar para (días)' when 'colchon_pct' then 'colchón de compras (%)'
           when 'costo_objetivo' then 'costo objetivo (%)' when 'alerta_cocina' then 'alertas de cocina' when 'alerta_barra' then 'alertas de bebidas'
           when 'reservas_activas' then 'página de reservas' when 'reservas_horarios' then 'horarios de reserva' when 'reservas_cupo' then 'lugares por horario'
           when 'reservas_max' then 'máximo por reserva' when 'reservas_dias' then 'días de anticipación' when 'reservas_min_horas' then 'horas antes para reservar'
           when 'reservas_telefono' then 'WhatsApp del local' else coalesce(new.clave, old.clave) end, coalesce(old.valor, '—'), coalesce(new.valor, '—'));

  when 'facturacion' then
    area := 'Configuración'; imp := true; d := (select jsonb_object_agg(x, '"(cambió)"'::jsonb) from jsonb_object_keys(coalesce(d, '{}')) x);
    if d is null then return null; end if;
    t := 'Cambió la facturación (' || (select string_agg(x, ', ') from jsonb_object_keys(d) x) || ')';

  when 'reservas' then
    area := 'Reservas';
    if tg_op = 'INSERT' then t := format('Reserva de %s para el %s a las %s (%s personas) · %s', new.nombre, to_char(new.fecha, 'DD/MM'), to_char(new.hora, 'HH24:MI'), new.personas, new.origen);
    elsif tg_op = 'UPDATE' then
      if d ? 'estado' then t := format('Reserva de %s: %s', new.nombre, new.estado) || case when new.cancelada_por is not null then ' por el ' || new.cancelada_por else '' end;
      elsif d - 'atendido' = '{}'::jsonb then return null;
      else t := 'Editó la reserva de ' || new.nombre; end if;
    else t := 'Borró la reserva de ' || old.nombre; end if;

  else
    area := 'Otros'; t := initcap(acc) || ' en ' || tg_table_name || ': ' || coalesce(nom, '');
  end case;

  perform anotar(area, acc, tg_table_name, coalesce(r->>'id', r->>'clave', r->>'fecha'), t, case when tg_op = 'UPDATE' then d end, imp);
  return null;
end $$;

-- ---------------------------------------------------------------- registro por tanda (productos de un pedido, recetas, movimientos de stock)
create or replace function registrar_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare x record;
begin
  if tg_table_name = 'pedido_items' then
    for x in select p.id, p.origen, p.confirmado, m as mesa, string_agg(n.cantidad || '× ' || n.nombre || coalesce(' (' || n.nota || ')', ''), ', ' order by n.id) items
             from nuevos n join pedidos p on p.id = n.pedido_id join mesas m on m.id = p.mesa_id
             where p.ticket_id is null group by p.id, p.origen, p.confirmado, m loop
      perform anotar('Salón', 'alta', 'pedidos', x.id::text,
        case when x.origen = 'qr' and not x.confirmado then 'Pidió por QR en ' else 'Cargó en ' end || nombre_mesa(x.mesa) || ': ' || x.items);
    end loop;
  elsif tg_table_name = 'receta_items' then
    for x in select distinct p.id, p.nombre from nuevos n join productos p on p.id = n.producto_id loop
      perform anotar('Stock', 'cambio', 'receta_items', x.id::text, 'Guardó la receta de ' || x.nombre);
    end loop;
  elsif tg_table_name = 'movimientos_stock' then
    for x in select n.compra_id, count(*) c, sum(n.cantidad * n.costo_unit) total from nuevos n where n.tipo = 'compra' group by 1 loop
      perform anotar('Stock', 'alta', 'compras', x.compra_id::text,
        format('Cargó una compra%s: %s artículo%s, %s', coalesce(' a ' || (select pr.nombre from compras c join proveedores pr on pr.id = c.proveedor_id where c.id = x.compra_id), ''),
               x.c, case when x.c = 1 then '' else 's' end, plata_txt(x.total)));
    end loop;
    for x in select n.*, coalesce(i.nombre, p.nombre) art, coalesce(i.unidad, 'u.') un from nuevos n left join insumos i on i.id = n.insumo_id left join productos p on p.id = n.producto_id
             where n.tipo in ('merma', 'ingreso') loop
      perform anotar('Stock', 'evento', 'movimientos_stock', x.id::text,
        case x.tipo when 'merma' then format('Tiró %s %s de %s', round(abs(x.cantidad), 3)::float8, x.un, x.art) || coalesce(' · ' || x.motivo, '') || ' (' || plata_txt(abs(x.cantidad) * x.costo_unit) || ')'
                    else format('Ingresó %s %s de %s', round(x.cantidad, 3)::float8, x.un, x.art) end, null, x.tipo = 'merma');
    end loop;
    for x in select count(*) c, string_agg(coalesce(i.nombre, p.nombre) || ' ' || case when n.cantidad > 0 then '+' else '' end || round(n.cantidad, 3)::float8, ', ') det, sum(n.cantidad * n.costo_unit) v
             from nuevos n left join insumos i on i.id = n.insumo_id left join productos p on p.id = n.producto_id where n.tipo = 'conteo' having count(*) > 0 loop
      perform anotar('Stock', 'evento', 'movimientos_stock', null, format('Ajuste por conteo en %s artículo%s (%s): %s', x.c, case when x.c = 1 then '' else 's' end, plata_txt(x.v), x.det), null, true);
    end loop;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- los triggers
do $$
declare t text;
begin
  foreach t in array array['mesas', 'pedidos', 'llamados', 'pedido_cambios', 'tickets', 'facturas', 'jornadas', 'compras', 'insumos', 'inventarios',
                           'rendimientos', 'referencias', 'productos', 'categorias', 'platos_semana', 'gastos', 'gastos_fijos', 'proveedores', 'cuentas',
                           'medios_pago', 'movimientos_cuenta', 'perfiles', 'parametros', 'facturacion', 'reservas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', t || '_registro', t);
      execute format('create trigger %I after insert or update or delete on %I for each row execute function registrar_fila()', t || '_registro', t);
    end if;
  end loop;
  foreach t in array array['pedido_items', 'receta_items', 'movimientos_stock'] loop
    execute format('drop trigger if exists %I on %I', t || '_registro', t);
    execute format('create trigger %I after insert on %I referencing new table as nuevos for each statement execute function registrar_items()', t || '_registro', t);
  end loop;
end $$;

-- Se guarda un año: lo más viejo se borra solo al mirar el registro
create or replace function limpiar_registro() returns void
language sql security definer set search_path = public as $$
  delete from registro where hora < now() - interval '1 year' and (select es_admin())
$$;

revoke execute on function registrar_fila(), registrar_items(), plata_txt(numeric), diferencias(jsonb, jsonb) from public, anon;
revoke execute on function registrar_ingreso(), limpiar_registro() from public, anon;
grant execute on function registrar_ingreso(), limpiar_registro() to authenticated, service_role;
