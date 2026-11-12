-- =====================================================================
-- Última Vuelta · BORRAR LOS DATOS DE PRUEBA
--   Saca todo lo que cargó 5-datos-de-prueba.sql y deja la base como estaba antes:
--   ventas, caja, compras, gastos, mermas, conteos, rendimientos, reservas, personal de prueba,
--   y la carta de ejemplo si la había cargado ese archivo. Vuelve el stock, los costos y las cuentas.
--
--   Lo que ustedes hayan cargado a mano durante la prueba (una mesa nueva que cobraron, un gasto)
--   no se borra solo: revisalo en la app después.
--
--   Se pega una vez en Supabase → SQL Editor → Run.
-- =====================================================================

do $$ begin
  if to_regclass('public.datos_prueba') is null then raise exception 'No hay datos de prueba cargados.'; end if;
end $$;

do $$
begin
  if exists (select 1 from facturas f join datos_prueba d on d.tabla = 'tickets' and d.id = f.ticket_id::text where f.ambiente = 'produccion') then
    raise exception 'Hay facturas reales (producción) hechas sobre ventas de prueba: avisá antes de borrar.';
  end if;
  -- Facturas de prueba (homologación) hechas sobre ventas de prueba: primero las notas de crédito
  delete from facturas f using datos_prueba d where d.tabla = 'tickets' and d.id = f.ticket_id::text and f.tipo = 13;
  delete from facturas f using datos_prueba d where d.tabla = 'tickets' and d.id = f.ticket_id::text;

  -- Lo que está pasando ahora en el salón
  delete from llamados l using datos_prueba d where d.tabla = 'llamados' and d.id = l.mesa_id::text;
  delete from pedidos p using datos_prueba d where d.tabla = 'pedidos' and d.id = p.id::text;
  delete from pedidos p using datos_prueba d where d.tabla = 'tickets' and d.id = p.ticket_id::text;
  update mesas m set estado = (a.datos->>'estado')::estado_mesa, abierta = (a.datos->>'abierta')::timestamptz,
                     comensales = (a.datos->>'comensales')::int, mozo_id = (a.datos->>'mozo_id')::uuid
  from datos_prueba d join datos_prueba_antes a on a.tabla = 'mesas' and a.id = d.id
  where d.tabla = 'mesas' and m.id::text = d.id;

  -- Movimientos de stock, ventas, compras y gastos
  delete from movimientos_stock m using datos_prueba d where d.tabla = 'tickets' and d.id = m.ticket_id::text;
  delete from movimientos_stock m using datos_prueba d where d.tabla = 'compras' and d.id = m.compra_id::text;
  delete from movimientos_stock m using datos_prueba d where d.tabla = 'movimientos_stock' and d.id = m.id::text;
  delete from tickets t using datos_prueba d where d.tabla = 'tickets' and d.id = t.id::text;
  delete from gastos g using datos_prueba d where (d.tabla = 'gastos' and d.id = g.id::text) or (d.tabla = 'compras' and d.id = g.compra_id::text);
  delete from compras c using datos_prueba d where d.tabla = 'compras' and d.id = c.id::text;
  delete from inventarios i using datos_prueba d where d.tabla = 'inventarios' and d.id = i.id::text;
  delete from rendimientos r using datos_prueba d where d.tabla = 'rendimientos' and d.id = r.id::text;
  delete from movimientos_cuenta m using datos_prueba d where d.tabla = 'movimientos_cuenta' and d.id = m.id::text;
  delete from reservas r using datos_prueba d where d.tabla = 'reservas' and d.id = r.id::text;
  delete from jornadas j using datos_prueba d where d.tabla = 'jornadas' and d.id = j.fecha::text;

  -- Stock, costos y cuentas como estaban
  update insumos i set cantidad = (a.datos->>'cantidad')::numeric, costo = (a.datos->>'costo')::numeric, vence = (a.datos->>'vence')::date
  from datos_prueba_antes a where a.tabla = 'insumos' and a.id = i.id::text;
  update productos p set stock = (a.datos->>'stock')::numeric from datos_prueba_antes a where a.tabla = 'productos' and a.id = p.id::text;
  update cuentas c set desde = (a.datos->>'desde')::date, saldo_inicial = (a.datos->>'saldo_inicial')::numeric
  from datos_prueba_antes a where a.tabla = 'cuentas' and a.id = c.id::text;

  -- La carta de ejemplo (si la cargó el archivo de prueba) y el personal de prueba
  delete from productos p using datos_prueba d where d.tabla = 'productos' and d.id = p.id::text;
  delete from insumos i using datos_prueba d where d.tabla = 'insumos' and d.id = i.id::text;
  delete from proveedores p using datos_prueba d where d.tabla = 'proveedores' and d.id = p.id::text;
  delete from auth.users u using datos_prueba d where d.tabla = 'usuarios' and d.id = u.id::text;
end $$;

drop table datos_prueba, datos_prueba_antes;
select 'Datos de prueba borrados. La base quedó como antes.' as resultado;
