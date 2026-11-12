-- Recorre una noche completa contra la base local, con cada rol. Corta en el primer error.
\set ON_ERROR_STOP 1
\set QUIET 1
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.como(p_uid text) returns void language plpgsql as $$
begin
  if p_uid = 'anon' then
    perform set_config('request.jwt.claims', '', false); execute 'set role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
  end if;
end $$;
create or replace function pg_temp.debe_fallar(p_sql text, p_texto text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Tenía que fallar: %', p_sql;
exception when others then
  if sqlerrm not ilike '%' || p_texto || '%' then raise exception 'Falló con otro mensaje: % (esperaba %)', sqlerrm, p_texto; end if;
  return 'ok: ' || sqlerrm;
end $$;
\set ADMIN '00000000-0000-0000-0000-000000000001'
\set MOZO  '00000000-0000-0000-0000-000000000003'
\set PARR  '00000000-0000-0000-0000-000000000004'
\set BARRA '00000000-0000-0000-0000-000000000005'

\echo '1. El mozo abre la mesa 1 y carga una comanda'
select pg_temp.como(:'MOZO');
select abrir_mesa((select id from mesas where numero = 1), 3);
select cargar_pedido((select id from mesas where numero = 1), jsonb_build_array(
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Vacío'), 'cantidad', 2, 'nota', 'jugoso'),
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Papas fritas'), 'cantidad', 1),
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Fernet con cola'), 'cantidad', 3),
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Agua mineral'), 'cantidad', 2))) as pedido \gset
select format('   pedido %s · cocina %s · barra %s', id, est_cocina, est_barra) from pedidos where id = :pedido;
\echo '   el mozo no puede ver ventas ni artículos:'
select '   tickets visibles: ' || count(*) from tickets;
select '   artículos visibles: ' || count(*) from insumos;
select '   ' || pg_temp.debe_fallar('select tablero_resumen()', 'dueños y encargados');
update productos set precio = 1;
select '   precios tocados por el mozo: ' || count(*) from productos where precio = 1;

\echo '2. Parrilla y barra avanzan su parte; parrilla no puede tocar la barra'
select pg_temp.como(:'PARR');
select avanzar_comanda(:pedido, 'cocina', 'preparando');
select avanzar_comanda(:pedido, 'cocina', 'listo');
select '   ' || pg_temp.debe_fallar(format('select avanzar_comanda(%s, %L, %L)', :pedido, 'barra', 'listo'), 'otra estación');
select '   ' || pg_temp.debe_fallar(format('select cobrar_mesa(%s, %L)', (select id from mesas where numero = 1), 'Efectivo'), 'no puede cobrar');
select pg_temp.como(:'BARRA');
select avanzar_comanda(:pedido, 'barra', 'listo');
select pg_temp.como(:'MOZO');
select entregar_pedido(:pedido);
select format('   cocina %s · barra %s', est_cocina, est_barra) from pedidos where id = :pedido;

\echo '3. Un cliente pide por QR en la mesa 4 (sin usuario) y llama al mozo'
reset role;
select token as t4, (select id from productos where nombre = 'Gin tonic') as gin from mesas where numero = 4 \gset
select pg_temp.como('anon');
select pedir_desde_mesa(:'t4', jsonb_build_array(jsonb_build_object('producto_id', :gin, 'cantidad', 2))) as qr \gset
select llamar_mozo(:'t4');
select '   carta pública: ' || jsonb_array_length(carta_publica(:'t4')->'categorias') || ' categorías, pedido ' ||
       (carta_publica(:'t4')->'pedidos'->0->>'estado');
select '   ' || pg_temp.debe_fallar('select count(*) from productos', 'permission denied');
select '   ' || pg_temp.debe_fallar('select abrir_mesa(1, 2)', 'permission denied');
select '   ' || pg_temp.debe_fallar($q$select pedir_desde_mesa('cualquiera', '[]')$q$, 'QR ya no es válido');
select pg_temp.como(:'MOZO');
select '   sugerencias del mozo: ' || string_agg(s->>'tema', ', ') from sugerencias_ayudante('mesas') s;
select confirmar_pedido(:qr);
select atender_llamado((select id from mesas where numero = 4));
select format('   mesa 4: %s', estado) from mesas where numero = 4;

\echo '4. Se cobra la mesa 1 con 10 % de descuento'
select cobrar_mesa((select id from mesas where numero = 1), 'Efectivo', 10) as ticket \gset
select '   ' || :'ticket';
select pg_temp.como(:'ADMIN');
select format('   ticket %s: subtotal %s, total %s, costo %s, min cocina %s', id, subtotal, total, costo, min_cocina) from tickets order by id desc limit 1;
select format('   stock agua: %s · vacío: %s kg', (select stock from productos where nombre = 'Agua mineral'), (select cantidad from insumos where nombre = 'Vacío'));
select format('   movimientos de venta: %s', count(*)) from movimientos_stock where tipo = 'venta';
select format('   mesa 1: %s', estado) from mesas where numero = 1;

\echo '5. Caja: abrir, gasto, cerrar'
select abrir_caja(20000);
select registrar_gasto_caja('Hielo', 3000);
select '   cierre: ' || cerrar_caja(60000)::text;

\echo '6. Compras, merma, inventario, receta'
select '   compra: ' || registrar_compra(jsonb_build_array(
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Vacío'), 'cantidad', 10, 'total', 110000),
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Entraña'), 'cantidad', 5, 'total', 80000)),
  null, 'A-0001-123', null, 'pendiente', 'Frigorífico del Sur')::text;
select format('   vacío ahora %s kg a %s · gasto %s %s vence %s', (select cantidad from insumos where nombre = 'Vacío'), (select costo from insumos where nombre = 'Vacío'),
              concepto, estado, vence) from gastos where origen = 'compra';
select registrar_merma((select id from insumos where nombre = 'Lechuga'), 0.5, 'Vencido o en mal estado');
select '   inventario ' || guardar_inventario((select jsonb_agg(jsonb_build_object('insumo_id', id, 'cantidad', cantidad)) from insumos));
select pg_sleep(0.01);
select guardar_receta((select id from productos where nombre = 'Choripán'), jsonb_build_array(
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Chorizo'), 'cantidad', 1),
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Pan de chorizo'), 'cantidad', 1)));
select pagar_gasto((select id from gastos where origen = 'compra'), (select id from cuentas where nombre = 'Banco'));

\echo '7. Segunda noche: más ventas e inventario con faltante'
select pg_temp.como(:'MOZO');
select cargar_pedido((select id from mesas where numero = 2), jsonb_build_array(
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Parrillada para 2'), 'cantidad', 1),
  jsonb_build_object('producto_id', (select id from productos where nombre = 'Pinta IPA tirada'), 'cantidad', 4)));
select cobrar_mesa((select id from mesas where numero = 2), 'Débito')->>'total';
select cobrar_mesa((select id from mesas where numero = 4), 'Transferencia / QR')->>'total';
select pg_temp.como(:'ADMIN');
select '   inventario ' || guardar_inventario((select jsonb_agg(jsonb_build_object('insumo_id', id,
          'cantidad', case when nombre = 'Vacío' then cantidad - 1.2 else cantidad end)) from insumos));
select format('   control: %s %s sin explicar (%s)', nombre, sin_explicar, plata)
from control_inventario((select id from inventarios order by fecha limit 1), (select id from inventarios order by fecha desc limit 1)) where plata <> 0;

\echo '8. Tableros'
select '   resumen hoy: ' || (tablero_resumen()->'hoy')::text;
select '   alertas: ' || jsonb_array_length(tablero_resumen()->'alertas');
select '   ventas kpi: ' || (tablero_ventas(jornada_actual() - 6, jornada_actual())->'kpi')::text;
select '   productos: ' || jsonb_array_length(tablero_ventas(jornada_actual() - 6, jornada_actual())->'productos');
select '   filtro vacío: ' || (tablero_ventas(jornada_actual(), jornada_actual(), jsonb_build_object('producto', (select id from productos where nombre = 'Vacío')))->'kpi')::text;
select '   costos: ' || (tablero_costos(jornada_actual() - 29, jornada_actual())->'kpi')::text;
select '   costos artículo: ' || (tablero_costos(jornada_actual() - 29, jornada_actual(), jsonb_build_object('insumo', (select id from insumos where nombre = 'Vacío')))->'articulo')::text;
select '   finanzas: ' || (tablero_finanzas(jornada_actual() - 29, jornada_actual())->'kpi')::text || ' disponible ' || (tablero_finanzas(jornada_actual() - 29, jornada_actual())->>'disponible');
select '   finanzas año (por mes): ' || jsonb_array_length(tablero_finanzas(date_trunc('year', jornada_actual())::date, jornada_actual())->'serie'->'puntos');
select '   saldos: ' || string_agg(nombre || ' ' || saldo, ', ') from saldos_cuentas();
select '   previsión: ' || (prevision() - 'insumos')::text;
select '   sugerencias del dueño: ' || string_agg(s->>'tema', ', ') from sugerencias_ayudante('tablero') s;
select '   contexto: ' || length(contexto_ayudante()) || ' caracteres';
reset role;
\echo 'TODO BIEN'
