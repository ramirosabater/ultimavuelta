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
-- La caja de hoy ya se cerró: estos dos cobros tienen que ir a la jornada siguiente y el cierre no se toca
do $$ begin
  if (select count(*) from tickets where mesa_numero in (2, 4) and jornada = jornada_actual() + 1) <> 2
     or exists (select 1 from tickets where mesa_numero in (2, 4) and jornada = jornada_actual())
     or jornada_caja() <> jornada_actual() + 1 then
    raise exception 'Los cobros con la caja cerrada no pasaron a la jornada siguiente';
  end if;
end $$;
select format('   cobros con la caja cerrada → jornada %s (la de hoy %s quedó cerrada con %s)', jornada_caja(), jornada_actual(),
              (select count(*) from tickets where jornada = jornada_actual()));
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

\echo '9. Rendimientos: receta al plato y lo medido'
-- 0,30 kg de vacío cocido: ÷ 0,70 (cocción) y ÷ 0,88 (limpieza) = 0,487 kg a comprar
select guardar_receta((select id from productos where nombre = 'Vacío'), jsonb_build_array(
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Vacío'), 'cantidad', 0.30, 'cocido', true)));
do $$ declare c numeric := costo_receta((select id from productos where nombre = 'Vacío'));
          e numeric := round(0.30 / 0.70 / 0.88 * (select costo from insumos where nombre = 'Vacío'), 2);
begin
  if abs(c - e) > 0.05 then raise exception 'Costo de receta al plato mal: % en vez de %', c, e; end if;
  if (select count(*) from referencias) < 60 then raise exception 'Falta la tabla de referencia'; end if;
end $$;
select format('   vacío 0,30 kg al plato: compra %s kg, cuesta %s', round(crudo(0.30, true, 12, 0.70), 3), round(costo_receta((select id from productos where nombre = 'Vacío')), 0));
insert into rendimientos (insumo_id, proveedor, crudo, limpio, cocido)
select id, 'Carnicería', 2, 1.6, 1.1 from insumos, generate_series(1, 3) where nombre = 'Entraña';
select '   sugerencia de lo medido: ' || coalesce((select s->>'texto' from sugerencias_ayudante('stock') s where s->>'tema' = 'rendimiento-medido'), 'NO APARECIÓ');
do $$ begin
  if not exists (select 1 from sugerencias_ayudante('stock') s where s->>'tema' = 'rendimiento-medido') then raise exception 'Chichito no avisó del rendimiento medido'; end if;
end $$;
\echo '10. Reservas: la página pública, el cupo y sentar'
select jornada_actual() + 2 as f, jornada_actual() + 90 as lejos \gset
select set_config('prueba.f', :'f', false) is not null as listo \gset
select pg_temp.como('anon');
select '   info: ' || (reservas_info() - 'cerrado' - 'hoy')::text;
select '   horarios: ' || (select string_agg((x->>'hora') || '=' || (x->>'libres'), ' ') from jsonb_array_elements(reservas_disponibles((:'f')::date)) x);
select pedir_reserva('Martina', '297 412-3456', 4, (:'f')::date, '21:00', 'Cumpleaños') as cod1 \gset
select '   reserva hecha, código ' || :'cod1' || ': ' || (ver_reserva(:'cod1') ->> 'estado');
select pg_temp.debe_fallar($q$select count(*) from reservas$q$, 'permission denied');
select pg_temp.debe_fallar(format('select pedir_reserva(''Martina'', ''2974123456'', 2, %L, ''22:00'')', :'f'), 'Ya tenés una reserva');
select pg_temp.debe_fallar(format('select pedir_reserva(''Pedro'', ''123'', 2, %L, ''22:00'')', :'f'), 'Revisá el teléfono');
select pg_temp.debe_fallar(format('select pedir_reserva(''Pedro'', ''2974000001'', 2, %L, ''21:15'')', :'f'), 'Elegí uno de los horarios');
select pg_temp.debe_fallar(format('select pedir_reserva(''Pedro'', ''2974000001'', 14, %L, ''21:00'')', :'f'), 'Para más de 10');
select pg_temp.debe_fallar(format('select pedir_reserva(''Pedro'', ''2974000001'', 2, %L, ''21:00'')', :'lejos'), 'Elegí otra fecha');
select pedir_reserva('Grupo A', '2974000002', 10, (:'f')::date, '21:00');
select pedir_reserva('Grupo B', '2974000003', 10, (:'f')::date, '21:00');
select pg_temp.debe_fallar(format('select pedir_reserva(''Grupo C'', ''2974000004'', 10, %L, ''21:00'')', :'f'), 'No quedan lugares');
select pedir_reserva('Grupo C', '2974000004', 6, (:'f')::date, '21:00') as cod2 \gset
do $$ begin
  if (select (x->>'libres')::int from jsonb_array_elements(reservas_disponibles(current_setting('prueba.f')::date)) x where x->>'hora' = '21:00') <> 0 then raise exception 'El cupo de las 21 tenía que estar lleno'; end if;
end $$;
select cancelar_reserva(:'cod2');
select '   el cliente canceló: ' || (ver_reserva(:'cod2') ->> 'estado') || ', quedan ' ||
  (select x->>'libres' from jsonb_array_elements(reservas_disponibles((:'f')::date)) x where x->>'hora' = '21:00') || ' lugares a las 21';
select pg_temp.debe_fallar(format('select cancelar_reserva(%L)', :'cod2'), 'ya no se puede cancelar');
select pg_temp.como(:'ADMIN');
select '   sugerencias del dueño: ' || string_agg(s->>'tema', ', ') from sugerencias_ayudante('tablero') s;
do $$ begin
  if not exists (select 1 from sugerencias_ayudante() s where s->>'tema' = 'reservas-pendientes') then raise exception 'Chichito no avisó de las reservas por confirmar'; end if;
end $$;
update reservas set estado = 'confirmada', atendido = now() where codigo = :'cod1';
-- Una reserva por teléfono que llega en 20 minutos
insert into reservas (nombre, telefono, personas, fecha, hora, origen, estado, creado_por)
values ('Rodríguez', '2974555555', 3, jornada_actual(), ((now() + interval '20 minutes') at time zone zona())::time(0), 'telefono', 'confirmada', :'ADMIN') returning id as res \gset
select pg_temp.como(:'MOZO');
select '   el mozo ve ' || count(*) || ' reservas' from reservas;
select '   aviso al mozo: ' || coalesce((select s->>'texto' from sugerencias_ayudante('mesas') s where s->>'tema' = 'reserva-llega'), 'NO APARECIÓ');
do $$ begin
  if not exists (select 1 from sugerencias_ayudante('mesas') s where s->>'tema' = 'reserva-llega') then raise exception 'Chichito no avisó al mozo de la reserva'; end if;
end $$;
update reservas set estado = 'cancelada' where id = :res;   -- el mozo no puede cambiarlas: no pasa nada
select (select id from mesas where estado = 'libre' order by numero limit 1) as mesa_libre \gset
select sentar_reserva(:res, :mesa_libre);
select format('   sentada en la mesa %s: %s comensales, reserva %s', m.numero, m.comensales, r.estado) from reservas r join mesas m on m.id = r.mesa_id where r.id = :res;
select pg_temp.debe_fallar(format('select sentar_reserva(%s, %s)', :res, :mesa_libre), 'ya fue sentada');
select pg_temp.como(:'ADMIN');
select '   contexto con reservas: ' || (contexto_ayudante() like '%Reservas de hoy: %Rodríguez%');

\echo '11. Compra a mano y anular una compra mal cargada'
select pg_temp.como(:'ADMIN');
select cantidad as vac0, costo as vacc0 from insumos where nombre = 'Vacío' \gset
select (select coalesce(sum(saldo_cuenta(id)), 0) from cuentas where activa) as saldo0 \gset
select (registrar_compra(jsonb_build_array(
  jsonb_build_object('insumo_id', (select id from insumos where nombre = 'Vacío'), 'cantidad', 4, 'total', 60000)),
  null, null, null, (select id from cuentas order by orden limit 1)::text)->>'compra')::bigint as cmal \gset
select format('   compra mal cargada: vacío %s kg a %s', cantidad, costo) from insumos where nombre = 'Vacío';
select pg_temp.como(:'MOZO');
select pg_temp.debe_fallar(format('select anular_compra(%s)', :cmal), 'anulan compras');
select pg_temp.como(:'ADMIN');
select '   anulada: ' || anular_compra(:cmal)::text;
select set_config('prueba.vac0', :'vac0', false), set_config('prueba.vacc0', :'vacc0', false) \gset
do $$ declare v insumos; begin
  select * into v from insumos where nombre = 'Vacío';
  if v.cantidad <> current_setting('prueba.vac0')::numeric then raise exception 'El stock no volvió: % (era %)', v.cantidad, current_setting('prueba.vac0'); end if;
  if v.costo <> current_setting('prueba.vacc0')::numeric then raise exception 'El costo no volvió: % (era %)', v.costo, current_setting('prueba.vacc0'); end if;
end $$ ;
select format('   vacío de vuelta: %s kg a %s', cantidad, costo) from insumos where nombre = 'Vacío';
do $$ begin if exists (select 1 from gastos where concepto = 'Compra: Vacío' and monto = 60000) then raise exception 'Quedó el gasto de la compra anulada'; end if; end $$;
do $$ begin if exists (select 1 from compras c where not exists (select 1 from movimientos_stock m where m.compra_id = c.id)) then raise exception 'Quedó una compra vacía'; end if; end $$;
select case when (select coalesce(sum(saldo_cuenta(id)), 0) from cuentas where activa) = :saldo0 then '   la plata de la cuenta volvió' else 'ERROR: el saldo no volvió' end;
select pg_temp.debe_fallar(format('select anular_compra(%s)', :cmal), 'No encontramos');
reset role;
\echo 'TODO BIEN'
