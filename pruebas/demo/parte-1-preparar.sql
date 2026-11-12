-- =====================================================================
-- Última Vuelta · DATOS DE PRUEBA (para mostrar la app)
--   Carga un mes de movimiento inventado: ventas de cada noche, caja, compras, gastos, mermas,
--   control semanal, rendimientos, reservas y mesas abiertas ahora con comandas en curso.
--   Si la carta está vacía, carga también la carta de ejemplo con sus recetas.
--
--   Se pega una vez en Supabase → SQL Editor → Run.
--   Para sacar todo: 6-borrar-datos-de-prueba.sql (deja la base como estaba antes).
--   Antes tienen que estar pegadas las actualizaciones 01 a 04.
-- =====================================================================

do $$ begin
  if to_regclass('public.reservas') is null or to_regclass('public.facturas') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tickets' and column_name = 'sin_factura')
     or to_regprocedure('public.anular_compra(bigint)') is null then
    raise exception 'Antes de cargar los datos de prueba pegá las actualizaciones 01, 02, 03 y 04 (carpeta actualizaciones).';
  end if;
  if to_regclass('public.datos_prueba') is not null then
    raise exception 'Los datos de prueba ya están cargados. Para cargarlos de nuevo, primero corré 6-borrar-datos-de-prueba.sql.';
  end if;
  if not exists (select 1 from perfiles where rol = 'admin' and activo) then
    raise exception 'Primero creá el usuario administrador (2-primer-administrador.sql).';
  end if;
end $$;

-- Qué se cargó (para poder borrarlo) y cómo estaba todo antes (para dejarlo igual)
create table datos_prueba (tabla text not null, id text not null, primary key (tabla, id));
create table datos_prueba_antes (tabla text not null, id text not null, datos jsonb not null, primary key (tabla, id));
alter table datos_prueba enable row level security;
alter table datos_prueba_antes enable row level security;
revoke all on datos_prueba, datos_prueba_antes from anon, authenticated;

insert into datos_prueba_antes
select 'max', t, jsonb_build_object('id', m) from (values
  ('productos', (select coalesce(max(id), 0) from productos)),
  ('insumos', (select coalesce(max(id), 0) from insumos)),
  ('proveedores', (select coalesce(max(id), 0) from proveedores))) v(t, m);
insert into datos_prueba_antes select 'insumos', id::text, jsonb_build_object('cantidad', cantidad, 'costo', costo, 'vence', vence) from insumos;
insert into datos_prueba_antes select 'productos', id::text, jsonb_build_object('stock', stock) from productos;
insert into datos_prueba_antes select 'cuentas', id::text, jsonb_build_object('desde', desde, 'saldo_inicial', saldo_inicial) from cuentas;
insert into datos_prueba_antes select 'mesas', id::text, jsonb_build_object('estado', estado, 'abierta', abierta, 'comensales', comensales, 'mozo_id', mozo_id) from mesas;

-- ---------------------------------------------------------------------
-- Carta de ejemplo (solo agrega lo que falta: si ya cargaron su carta, la respeta)
-- ---------------------------------------------------------------------
