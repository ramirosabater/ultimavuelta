-- =====================================================================
-- Última Vuelta · Carta por QR (pública), sugerencias de Chichito y permisos de las funciones
-- =====================================================================

-- ---------------------------------------------------------------------
-- Carta por QR: lo único que puede usar alguien sin usuario.
-- El QR de cada mesa lleva su código (mesas.token): sin el código no se ve ni se pide nada.
-- ---------------------------------------------------------------------
create or replace function carta_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m mesas;
begin
  select * into m from mesas where token = p_token and activa;
  if not found then return null; end if;
  return jsonb_build_object(
    'local', param('nombre_local', ''), 'bajada', param('bajada_local', ''), 'mesa', m.numero,
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c.nombre, 'productos', ps) order by c.orden, c.nombre), '[]') from categorias c,
       lateral (select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio', p.precio,
                  'agotado', p.controla_stock and p.stock <= 0) order by p.orden, p.nombre) ps
                from productos p where p.categoria_id = c.id and p.activo) z
       where c.activa and ps is not null),
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'hora', p.creado, 'confirmado', p.confirmado,
                  'estado', case when not p.confirmado then 'esperando'
                                 when coalesce(p.est_cocina, 'entregado') = 'entregado' and coalesce(p.est_barra, 'entregado') = 'entregado' then 'entregado'
                                 when coalesce(p.est_cocina, 'listo') in ('listo', 'entregado') and coalesce(p.est_barra, 'listo') in ('listo', 'entregado') then 'listo'
                                 when 'preparando' in (p.est_cocina, p.est_barra) then 'preparando' else 'recibido' end,
                  'items', (select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad)) from pedido_items i where i.pedido_id = p.id))
                  order by p.creado), '[]')
                from pedidos p where p.mesa_id = m.id and p.ticket_id is null and p.creado > now() - interval '8 hours'),
    'llamado', exists (select 1 from llamados where mesa_id = m.id));
end $$;

create or replace function pedir_desde_mesa(p_token text, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  select * into m from mesas where token = p_token and activa for update;
  perform exigir(found, 'Este QR ya no es válido. Pedile al mozo.');
  perform exigir((select count(*) from pedidos where mesa_id = m.id and ticket_id is null and not confirmado) < 3,
                 'Ya hay pedidos esperando que el mozo los confirme. En un momento te atienden.');
  return crear_pedido(m.id, p_items, 'qr', false);
end $$;

create or replace function llamar_mozo(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  select * into m from mesas where token = p_token and activa;
  perform exigir(found, 'Este QR ya no es válido.');
  insert into llamados (mesa_id) values (m.id) on conflict (mesa_id) do nothing;
end $$;

-- Gestión puede generar un QR nuevo para una mesa (el anterior deja de andar)
create or replace function nuevo_qr(p_mesa bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cambian los QR.');
  update mesas set token = v where id = p_mesa;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Sugerencias de Chichito según lo que pasa en el local (cada usuario ve las de su rol)
-- ---------------------------------------------------------------------
create or replace function sugerencias_ayudante(p_area text default null) returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rol rol_usuario := mi_rol(); v_j date := jornada_actual(); v_hoy date := hoy_local(); n int; t text; v_h int := hora_local(now());
begin
  if v_rol is null then return; end if;
  -- Salón: lo urgente primero
  if v_rol in ('admin', 'encargado', 'mozo') then
    for t, n in select string_agg(m.numero::text, ', ' order by l.creado), count(*) from llamados l join mesas m on m.id = l.mesa_id loop
      if n > 0 then return next jsonb_build_object('tema', 'llamado', 'clave', 'llamado-' || t, 'prioridad', 0, 'posponer', 'nada',
        'titulo', case when n = 1 then 'Te llaman' else 'Te llaman de varias mesas' end,
        'texto', format(case when n = 1 then 'La mesa %s está llamando al mozo.' else 'Las mesas %s están llamando al mozo.' end, t),
        'boton', 'Ir a mesas', 'ir', '/mesas'); end if;
    end loop;
    select count(*) into n from pedidos where ticket_id is null and not confirmado;
    if n > 0 then return next jsonb_build_object('tema', 'qr', 'clave', 'qr-' || n, 'prioridad', 0, 'posponer', 'nada', 'titulo', 'Pedidos por QR',
      'texto', format(case when n = 1 then 'Hay un pedido por QR esperando que lo confirmes.' else 'Hay %s pedidos por QR esperando que los confirmes.' end, n),
      'boton', 'Ver pedidos', 'ir', '/mesas'); end if;
    select count(*) into n from pedidos where ticket_id is null and confirmado and 'listo' in (est_cocina, est_barra);
    if n > 0 and coalesce(p_area, '') <> 'mesas' then return next jsonb_build_object('tema', 'listos', 'clave', 'listos-' || n, 'prioridad', 1, 'posponer', 'nada',
      'titulo', 'Para retirar', 'texto', format(case when n = 1 then 'Hay un pedido listo para llevar a la mesa.' else 'Hay %s pedidos listos para llevar a las mesas.' end, n),
      'boton', 'Ir a mesas', 'ir', '/mesas'); end if;
  end if;
  if v_rol not in ('admin', 'encargado') then return; end if;

  select count(*) into n from gastos where estado = 'pendiente' and vence < v_hoy;
  if n > 0 then return next jsonb_build_object('tema', 'vencidos', 'clave', 'vencidos-' || v_hoy, 'prioridad', 1, 'titulo', 'Pagos vencidos',
    'texto', format('Tenés %s pago%s vencido%s por %s.', n, case when n > 1 then 's' else '' end, case when n > 1 then 's' else '' end,
                    to_char((select sum(monto) from gastos where estado = 'pendiente' and vence < v_hoy), 'FM$999G999G999')),
    'boton', 'Ver pagos', 'ir', '/admin/gastos'); end if;

  select string_agg(nombre, ', '), count(*) into t, n from (select nombre from insumos where activo and cantidad > 0 and vence is not null and vence <= v_hoy + 2 order by vence limit 3) z;
  if n > 0 then return next jsonb_build_object('tema', 'por-vencer', 'clave', 'vence-' || v_hoy, 'prioridad', 1, 'titulo', 'Por vencer',
    'texto', format('%s %s por vencer. Usalo primero o registralo como merma.', t, case when n > 1 then 'están' else 'está' end),
    'boton', 'Ver artículos', 'ir', '/stock/articulos'); end if;

  select count(*) into n from insumos where activo and minimo > 0 and cantidad <= minimo;
  if n > 0 then return next jsonb_build_object('tema', 'reponer', 'clave', 'reponer-' || v_hoy, 'prioridad', 2, 'titulo', 'Para reponer',
    'texto', format('%s artículo%s en el mínimo. Te armé la lista de compras.', n, case when n > 1 then 's están' else ' está' end),
    'boton', 'Ver la lista', 'ir', '/stock/compras'); end if;

  if v_h >= 17 and not exists (select 1 from jornadas where fecha = v_j and apertura is not null) then
    return next jsonb_build_object('tema', 'abrir-caja', 'clave', 'caja-' || v_j, 'prioridad', 2, 'titulo', 'La caja',
      'texto', 'Todavía no abriste la caja de hoy. Cargá el efectivo inicial así el cierre da justo.', 'boton', 'Abrir caja', 'ir', '/caja');
  end if;

  select string_agg(nombre, ', '), count(*) into t, n from (select p.nombre from productos p join categorias c on c.id = p.categoria_id
    where p.activo and not p.controla_stock and not exists (select 1 from receta_items where producto_id = p.id) order by c.orden, p.nombre) z;
  if n > 0 then return next jsonb_build_object('tema', 'sin-receta', 'clave', 'sin-receta', 'prioridad', 4, 'titulo', 'Platos sin receta',
    'texto', format('%s plato%s receta, así que no sé cuánto cuesta%s: %s.', n, case when n > 1 then 's no tienen' else ' no tiene' end,
                    case when n > 1 then 'n' else '' end, (select string_agg(x, ', ') from (select unnest(string_to_array(t, ', ')) x limit 3) y)),
    'boton', 'Cargar recetas', 'ir', '/stock/recetas'); end if;

  select string_agg(nombre, ', '), count(*) into t, n from (select nombre from productos where activo and precio > 0
    and costo_receta(id) / precio * 100 > coalesce(nullif(param('costo_objetivo'), '')::numeric, 35) limit 3) z;
  if n > 0 then return next jsonb_build_object('tema', 'caros', 'clave', 'caros-' || t, 'prioridad', 3, 'titulo', 'Platos caros de hacer',
    'texto', format('%s cuesta%s más del %s %% del precio. Revisá el precio o la porción.', t, case when n > 1 then 'n' else '' end, param('costo_objetivo', '35')),
    'boton', 'Ver platos', 'ir', '/stock/recetas'); end if;

  if exists (select 1 from insumos where activo)
     and not exists (select 1 from inventarios where completo and fecha > now() - interval '7 days') then
    return next jsonb_build_object('tema', 'inventario', 'clave', 'inventario-' || v_hoy, 'prioridad', 4, 'titulo', 'Inventario',
      'texto', case when exists (select 1 from inventarios where completo)
                    then 'Pasó más de una semana del último inventario. Contá hoy al cierre así vemos si se pierde algo.'
                    else 'Hacé el primer inventario completo al cierre. Con el segundo te muestro dónde se pierde plata.' end,
      'boton', 'Hacer inventario', 'ir', '/stock/control');
  end if;

  if not exists (select 1 from rendimientos) and exists (select 1 from insumos where activo and unidad = 'kg') then
    return next jsonb_build_object('tema', 'primer-rendimiento', 'clave', 'primer-rendimiento', 'prioridad', 5, 'titulo', 'Rendimientos',
      'texto', 'Con la próxima pieza de carne que llegue, hacé una prueba de rendimiento: pesala cruda y limpia.',
      'boton', 'Cómo se hace', 'circuito', 'rendimiento');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Lo que Chichito sabe del local para responder preguntas (según el rol de quien pregunta)
-- ---------------------------------------------------------------------
create or replace function contexto_ayudante() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_rol rol_usuario := mi_rol(); v_j date := jornada_actual(); s text;
begin
  if v_rol is null then return null; end if;
  s := format('Local: %s (%s), bar y parrilla en Rada Tilly. Hoy es %s, jornada %s. Quien pregunta: %s (rol %s).',
              param('nombre_local'), param('bajada_local'), to_char(now() at time zone zona(), 'TMDay DD/MM/YYYY HH24:MI'), v_j,
              (select nombre from perfiles where id = auth.uid()), v_rol);
  s := s || E'\nCarta: ' || coalesce((select string_agg(format('%s (%s, %s)', p.nombre, c.nombre, to_char(p.precio, 'FM$999G999')), '; ' order by c.orden, p.nombre)
                                      from productos p join categorias c on c.id = p.categoria_id where p.activo), 'vacía');
  s := s || E'\nMesas abiertas ahora: ' || (select count(*) from mesas where estado <> 'libre')
          || '. Pedidos por QR sin confirmar: ' || (select count(*) from pedidos where ticket_id is null and not confirmado) || '.';
  if v_rol not in ('admin', 'encargado') then return s; end if;
  s := s || E'\nVentas de hoy: ' || to_char(coalesce((select sum(total) from tickets where jornada = v_j), 0), 'FM$999G999G999')
          || ' en ' || (select count(*) from tickets where jornada = v_j) || ' mesas.';
  s := s || E'\nÚltimas jornadas: ' || coalesce((select string_agg(format('%s %s (%s mesas)', to_char(jornada, 'TMDy DD/MM'), to_char(v, 'FM$999G999G999'), n), '; ' order by jornada desc)
            from (select jornada, sum(total) v, count(*) n from tickets where jornada >= v_j - 14 and jornada < v_j group by 1) z), 'sin ventas');
  s := s || E'\nMás vendidos (30 días): ' || coalesce((select string_agg(format('%s ×%s', nombre, q), ', ' order by q desc)
            from (select ti.nombre, sum(ti.cantidad) q from ticket_items ti join tickets t on t.id = ti.ticket_id where t.jornada >= v_j - 30 group by 1 order by 2 desc limit 10) z), 'sin datos');
  s := s || E'\nCosto por plato: ' || coalesce((select string_agg(format('%s precio %s costo %s', nombre, to_char(precio, 'FM$999G999'), to_char(costo_receta(id), 'FM$999G999')), '; ')
            from productos where activo and exists (select 1 from receta_items where producto_id = productos.id)), 'sin recetas');
  s := s || E'\nMes: ventas ' || to_char(coalesce((select sum(total) from tickets where jornada >= date_trunc('month', v_j)), 0), 'FM$999G999G999')
          || ', gastos ' || to_char(coalesce((select sum(monto) from gastos where fecha >= date_trunc('month', v_j)), 0), 'FM$999G999G999')
          || '. Deudas a pagar: ' || to_char(coalesce((select sum(monto) from gastos where estado = 'pendiente'), 0), 'FM$999G999G999')
          || '. Plata en cuentas: ' || coalesce((select string_agg(format('%s %s', nombre, to_char(saldo, 'FM$999G999G999')), ', ') from saldos_cuentas()), '—') || '.';
  s := s || E'\nStock en el mínimo: ' || coalesce((select string_agg(nombre, ', ') from insumos where activo and minimo > 0 and cantidad <= minimo), 'nada')
          || '. Por vencer: ' || coalesce((select string_agg(nombre, ', ') from insumos where activo and vence <= hoy_local() + 2 and cantidad > 0), 'nada') || '.';
  s := s || E'\nMermas (30 días): ' || coalesce((select string_agg(format('%s %s', motivo, to_char(v, 'FM$999G999')), ', ')
            from (select motivo, sum(-cantidad * costo_unit) v from movimientos_stock where tipo = 'merma' and jornada >= v_j - 30 group by 1) z), 'ninguna') || '.';
  return s;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de las funciones: solo usuarios con sesión, salvo la carta por QR
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on function carta_publica(text), pedir_desde_mesa(text, jsonb), llamar_mozo(text) to anon;
-- Piezas internas que la app no llama directo
revoke execute on function crear_pedido(bigint, jsonb, text, boolean) from authenticated;
revoke execute on function items_validos(jsonb) from authenticated;
