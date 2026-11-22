-- =====================================================================
-- Última Vuelta · DATOS DE PRUEBA (para mostrar la app)
--   Carga un mes de movimiento inventado: ventas de cada noche, caja, compras, gastos, mermas,
--   control semanal, rendimientos, reservas y mesas abiertas ahora con comandas en curso.
--   Si la carta está vacía, carga también la carta (3-carta.sql) con sus recetas.
--
--   Se pega una vez en Supabase → SQL Editor → Run.
--   Para sacar todo: 6-borrar-datos-de-prueba.sql (deja la base como estaba antes).
--   Antes tienen que estar pegadas las actualizaciones 01 a 05.
-- =====================================================================

do $$ begin
  if to_regclass('public.reservas') is null or to_regclass('public.facturas') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tickets' and column_name = 'sin_factura')
     or to_regprocedure('public.anular_compra(bigint)') is null or to_regclass('public.ticket_pagos') is null then
    raise exception 'Antes de cargar los datos de prueba pegá las actualizaciones 01 a 05 (carpeta actualizaciones).';
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
insert into proveedores (nombre, rubro, plazo_dias) values
  ('Carnicería', 'Carnes y pollo', 7), ('Fiambrería', 'Quesos y fiambres', 0), ('Panadería', 'Panificados', 0),
  ('Verdulería', 'Frutas y verduras', 0), ('Mayorista', 'Almacén', 15), ('Heladería', 'Helado', 0), ('Hielo', 'Hielo', 0),
  ('Distribuidora', 'Bebidas', 30), ('Cervecería', 'Cerveza en barril', 15)
on conflict (nombre) do nothing;

insert into categorias (nombre, estacion, orden) values
  ('Entradas', 'cocina', 1), ('Pizzas', 'cocina', 2), ('Hamburguesas', 'cocina', 3), ('Sándwiches', 'cocina', 4),
  ('Papas', 'cocina', 5), ('Ensaladas', 'cocina', 6), ('Postres', 'cocina', 7),
  ('Tragos', 'barra', 8), ('Cervezas', 'barra', 9), ('Vinos', 'barra', 10), ('Sin alcohol', 'barra', 11)
on conflict (nombre) do nothing;
update categorias c set orden = x.orden, activa = true
from (values ('Entradas', 1), ('Pizzas', 2), ('Hamburguesas', 3), ('Sándwiches', 4), ('Papas', 5), ('Ensaladas', 6), ('Postres', 7),
             ('Tragos', 8), ('Cervezas', 9), ('Vinos', 10), ('Sin alcohol', 11)) x(nombre, orden)
where c.nombre = x.nombre;

-- Artículos (unidad · mínimo para la lista de compras · costo estimado · % de merma al limpiar · pack de compra · proveedor)
insert into insumos (nombre, unidad, cantidad, minimo, costo, merma_pct, pack, pack_nombre, proveedor_id)
select x.nombre, x.unidad, 0, x.minimo, x.costo, x.merma, x.pack, x.pack_nombre, (select id from proveedores where nombre = x.prov)
from (values
  -- Quesos y fiambres
  ('Muzzarella', 'kg', 6, 9500, 0, null, null, 'Fiambrería'),
  ('Queso roquefort', 'kg', 1, 18000, 0, null, null, 'Fiambrería'),
  ('Queso parmesano', 'kg', 0.5, 22000, 0, null, null, 'Fiambrería'),
  ('Queso cheddar en fetas', 'kg', 1, 15000, 0, null, null, 'Fiambrería'),
  ('Queso cheddar para salsa', 'kg', 1, 9000, 0, null, null, 'Fiambrería'),
  ('Jamón crudo', 'kg', 1, 30000, 0, null, null, 'Fiambrería'),
  ('Jamón cocido', 'kg', 1, 12000, 0, null, null, 'Fiambrería'),
  ('Panceta', 'kg', 1, 16000, 0, null, null, 'Fiambrería'),
  -- Carnes
  ('Carne picada', 'kg', 4, 8500, 0, null, null, 'Carnicería'),
  ('Carne para milanesa', 'kg', 3, 11000, 8, null, null, 'Carnicería'),
  ('Pechuga de pollo', 'kg', 4, 6500, 10, null, null, 'Carnicería'),
  ('Carne cortada para empanadas', 'kg', 1, 9000, 0, null, null, 'Carnicería'),
  -- Panificados
  ('Pan de hamburguesa', 'u.', 24, 450, 0, 12, 'docena', 'Panadería'),
  ('Pan de sándwich', 'u.', 12, 600, 0, 12, 'docena', 'Panadería'),
  ('Tapas de empanada', 'u.', 24, 120, 0, 12, 'docena', 'Panadería'),
  -- Verdulería
  ('Papas', 'kg', 15, 900, 20, 10, 'bolsa', 'Verdulería'),
  ('Cebolla', 'kg', 4, 1200, 10, null, null, 'Verdulería'),
  ('Tomate', 'kg', 3, 2200, 10, null, null, 'Verdulería'),
  ('Lechuga', 'kg', 1, 2800, 25, null, null, 'Verdulería'),
  ('Rúcula', 'kg', 0.5, 6000, 20, null, null, 'Verdulería'),
  ('Morrón', 'kg', 1, 4000, 15, null, null, 'Verdulería'),
  ('Ajo', 'kg', 0.2, 6000, 10, null, null, 'Verdulería'),
  ('Cebolla de verdeo', 'kg', 0.3, 5000, 20, null, null, 'Verdulería'),
  ('Peras', 'kg', 1, 2500, 15, null, null, 'Verdulería'),
  ('Manzana verde', 'kg', 1, 3000, 15, null, null, 'Verdulería'),
  ('Apio', 'kg', 0.5, 3500, 25, null, null, 'Verdulería'),
  ('Berenjena', 'kg', 1, 3500, 10, null, null, 'Verdulería'),
  ('Limones', 'u.', 15, 150, 0, null, null, 'Verdulería'),
  ('Menta', 'atados', 2, 900, 0, null, null, 'Verdulería'),
  -- Almacén
  ('Harina', 'kg', 10, 900, 0, 1, 'paquete', 'Mayorista'),
  ('Levadura', 'kg', 0.2, 8000, 0, 0.5, 'paquete', 'Mayorista'),
  ('Tomate triturado', 'kg', 4, 2500, 0, 1, 'caja', 'Mayorista'),
  ('Aceite', 'L', 5, 3200, 0, 5, 'bidón', 'Mayorista'),
  ('Aceitunas', 'kg', 0.5, 9000, 0, 1, 'frasco', 'Mayorista'),
  ('Orégano', 'kg', 0.1, 15000, 0, null, null, 'Mayorista'),
  ('Pimentón', 'kg', 0.1, 14000, 0, null, null, 'Mayorista'),
  ('Pan rallado', 'kg', 2, 2500, 0, 1, 'paquete', 'Mayorista'),
  ('Mayonesa', 'kg', 2, 5000, 0, 3, 'balde', 'Mayorista'),
  ('Salsa barbacoa', 'kg', 1, 7000, 0, 1, 'frasco', 'Mayorista'),
  ('Nueces', 'kg', 0.3, 18000, 0, null, null, 'Mayorista'),
  ('Azúcar', 'kg', 1, 1300, 0, 1, 'paquete', 'Mayorista'),
  ('Leche', 'L', 3, 1500, 0, 1, 'sachet', 'Mayorista'),
  ('Huevos', 'u.', 30, 260, 0, 30, 'maple', 'Mayorista'),
  ('Dulce de leche', 'kg', 1, 6500, 0, 1, 'pote', 'Mayorista'),
  ('Crema', 'L', 1, 5200, 0, 0.5, 'pote', 'Mayorista'),
  ('Helado', 'kg', 2, 8000, 0, null, null, 'Heladería'),
  -- Barra
  ('Hielo', 'kg', 10, 500, 0, 15, 'bolsa', 'Hielo'),
  ('Fernet', 'ml', 1500, 20, 0, 750, 'botella', 'Distribuidora'),
  ('Cola', 'ml', 4000, 2.2, 0, 2250, 'botella 2,25 L', 'Distribuidora'),
  ('Gin', 'ml', 700, 26, 0, 700, 'botella', 'Distribuidora'),
  ('Tónica', 'ml', 3000, 4, 0, 1500, 'botella 1,5 L', 'Distribuidora'),
  ('Aperol', 'ml', 750, 22, 0, 750, 'botella', 'Distribuidora'),
  ('Espumante', 'ml', 1500, 10, 0, 750, 'botella', 'Distribuidora'),
  ('Ron blanco', 'ml', 750, 16, 0, 750, 'botella', 'Distribuidora'),
  ('Vino Malbec (por copa)', 'ml', 1500, 11, 0, 750, 'botella', 'Distribuidora'),
  ('Cerveza rubia', 'L', 30, 2400, 5, 50, 'barril', 'Cervecería'),
  ('Cerveza IPA', 'L', 20, 3100, 5, 50, 'barril', 'Cervecería')
) as x(nombre, unidad, minimo, costo, merma, pack, pack_nombre, prov)
on conflict (nombre) do nothing;

-- Platos y bebidas (precio estimado · pausado = todavía no se ofrece)
insert into productos (nombre, descripcion, categoria_id, precio, estacion, activo, controla_stock, stock, stock_min, orden)
select x.nombre, x.descr, c.id, x.precio, c.estacion, x.activo, x.ctrl, 0, coalesce(x.smin, 0), x.orden
from (values
  ('Empanada de carne', 'Frita o al horno', 'Entradas', 2800, true, false, null, 1),
  ('Tiras de pollo crocantes', 'Rebozadas y fritas', 'Entradas', 10500, true, false, null, 2),
  ('Aros de cebolla', 'Rebozados y crocantes', 'Entradas', 8500, true, false, null, 3),

  ('Pizza muzzarella', 'Salsa de tomate, muzzarella, orégano y aceitunas', 'Pizzas', 15000, true, false, null, 1),
  ('Fugazzeta', 'Muzzarella y cebolla', 'Pizzas', 16000, true, false, null, 2),
  ('Napolitana', 'Muzzarella, rodajas de tomate y ajo. Se puede pedir sin ajo', 'Pizzas', 17000, true, false, null, 3),
  ('Pizza especial', 'Muzzarella, jamón, morrón y aceitunas', 'Pizzas', 18500, true, false, null, 4),
  ('Pizza rúcula y crudo', 'Muzzarella, jamón crudo, rúcula y parmesano', 'Pizzas', 21000, true, false, null, 5),
  ('Pizza pera y roquefort', 'Muzzarella, peras y roquefort', 'Pizzas', 20000, true, false, null, 6),

  ('Cheeseburger', 'Medallón de carne con doble cheddar', 'Hamburguesas', 13500, true, false, null, 1),
  ('Hamburguesa cheddar y panceta', 'Cheddar, panceta, cebolla caramelizada y salsa barbacoa', 'Hamburguesas', 16000, true, false, null, 2),
  ('Hamburguesa clásica', 'Medallón de carne, queso, lechuga y tomate', 'Hamburguesas', 13000, true, false, null, 3),
  ('Hamburguesa azul', 'Roquefort, rúcula y cebolla', 'Hamburguesas', 16000, true, false, null, 4),

  ('Sándwich de milanesa de carne', 'Con lechuga, tomate y mayonesa', 'Sándwiches', 15000, true, false, null, 1),
  ('Sándwich de milanesa de pollo', 'Con lechuga, tomate y mayonesa', 'Sándwiches', 14000, true, false, null, 2),
  ('Sándwich vegetariano', 'Berenjenas grilladas, rúcula y queso', 'Sándwiches', 12500, false, false, null, 3),

  ('Papas cheddar, panceta y verdeo', null, 'Papas', 11000, true, false, null, 1),
  ('Papas 4 quesos', 'Muzzarella, roquefort, parmesano y cheddar', 'Papas', 11500, true, false, null, 2),
  ('Papas bravas', 'Con salsa brava picante y alioli', 'Papas', 9500, true, false, null, 3),

  ('Ensalada César', 'Lechuga, pollo grillado, croutons, parmesano y aderezo César', 'Ensaladas', 12000, true, false, null, 1),
  ('Ensalada Waldorf', 'Cubos de manzana verde, apio fileteado, nueces tostadas y aderezo cremoso de mayonesa ligera', 'Ensaladas', 11500, true, false, null, 2),

  ('Flan', 'Con dulce de leche o crema', 'Postres', 6000, true, false, null, 1),
  ('Helado', 'Dos bochas', 'Postres', 5500, true, false, null, 2),
  ('Especial de la casa', 'Preguntale al mozo cuál hay hoy', 'Postres', 7500, true, false, null, 3),

  ('Fernet con cola', null, 'Tragos', 7500, true, false, null, 1),
  ('Gin tonic', null, 'Tragos', 9000, true, false, null, 2),
  ('Aperol spritz', null, 'Tragos', 9000, true, false, null, 3),
  ('Mojito', null, 'Tragos', 8500, true, false, null, 4),
  ('Pinta rubia tirada', null, 'Cervezas', 5500, true, false, null, 1),
  ('Pinta IPA tirada', null, 'Cervezas', 6500, true, false, null, 2),
  ('Porrón 1 L', null, 'Cervezas', 7000, true, true, 12, 3),
  ('Copa de Malbec', null, 'Vinos', 5000, true, false, null, 1),
  ('Botella Malbec de la casa', '750 ml', 'Vinos', 18000, true, true, 6, 2),
  ('Botella Cabernet', '750 ml', 'Vinos', 20000, true, true, 4, 3),
  ('Agua mineral', '500 ml', 'Sin alcohol', 3000, true, true, 12, 1),
  ('Gaseosa', '500 ml', 'Sin alcohol', 3500, true, true, 12, 2)
) as x(nombre, descr, cat, precio, activo, ctrl, smin, orden)
join categorias c on c.nombre = x.cat
where not exists (select 1 from productos p where p.nombre = x.nombre);

-- Recetas: cuánto lleva cada plato, en la unidad del artículo (kg, L, u., ml)
insert into receta_items (producto_id, insumo_id, cantidad)
select p.id, i.id, x.cant
from (values
  ('Empanada de carne', 'Tapas de empanada', 1), ('Empanada de carne', 'Carne cortada para empanadas', 0.06), ('Empanada de carne', 'Cebolla', 0.02),
  ('Empanada de carne', 'Aceite', 0.02),
  ('Tiras de pollo crocantes', 'Pechuga de pollo', 0.2), ('Tiras de pollo crocantes', 'Pan rallado', 0.05), ('Tiras de pollo crocantes', 'Harina', 0.02),
  ('Tiras de pollo crocantes', 'Huevos', 0.5), ('Tiras de pollo crocantes', 'Aceite', 0.06),
  ('Aros de cebolla', 'Cebolla', 0.25), ('Aros de cebolla', 'Harina', 0.06), ('Aros de cebolla', 'Leche', 0.05), ('Aros de cebolla', 'Pan rallado', 0.03),
  ('Aros de cebolla', 'Aceite', 0.08),

  -- Pizzas: la masa (harina, levadura, aceite) más lo de arriba
  ('Pizza muzzarella', 'Harina', 0.3), ('Pizza muzzarella', 'Levadura', 0.006), ('Pizza muzzarella', 'Aceite', 0.02), ('Pizza muzzarella', 'Tomate triturado', 0.15),
  ('Pizza muzzarella', 'Muzzarella', 0.4), ('Pizza muzzarella', 'Aceitunas', 0.03), ('Pizza muzzarella', 'Orégano', 0.002),
  ('Fugazzeta', 'Harina', 0.3), ('Fugazzeta', 'Levadura', 0.006), ('Fugazzeta', 'Aceite', 0.03), ('Fugazzeta', 'Muzzarella', 0.4),
  ('Fugazzeta', 'Cebolla', 0.3), ('Fugazzeta', 'Orégano', 0.002),
  ('Napolitana', 'Harina', 0.3), ('Napolitana', 'Levadura', 0.006), ('Napolitana', 'Aceite', 0.02), ('Napolitana', 'Tomate triturado', 0.15),
  ('Napolitana', 'Muzzarella', 0.35), ('Napolitana', 'Tomate', 0.25), ('Napolitana', 'Ajo', 0.01), ('Napolitana', 'Orégano', 0.002),
  ('Pizza especial', 'Harina', 0.3), ('Pizza especial', 'Levadura', 0.006), ('Pizza especial', 'Aceite', 0.02), ('Pizza especial', 'Tomate triturado', 0.15),
  ('Pizza especial', 'Muzzarella', 0.35), ('Pizza especial', 'Jamón cocido', 0.12), ('Pizza especial', 'Morrón', 0.12), ('Pizza especial', 'Aceitunas', 0.03),
  ('Pizza rúcula y crudo', 'Harina', 0.3), ('Pizza rúcula y crudo', 'Levadura', 0.006), ('Pizza rúcula y crudo', 'Aceite', 0.02),
  ('Pizza rúcula y crudo', 'Tomate triturado', 0.15), ('Pizza rúcula y crudo', 'Muzzarella', 0.35), ('Pizza rúcula y crudo', 'Jamón crudo', 0.1),
  ('Pizza rúcula y crudo', 'Rúcula', 0.06), ('Pizza rúcula y crudo', 'Queso parmesano', 0.02),
  ('Pizza pera y roquefort', 'Harina', 0.3), ('Pizza pera y roquefort', 'Levadura', 0.006), ('Pizza pera y roquefort', 'Aceite', 0.02),
  ('Pizza pera y roquefort', 'Muzzarella', 0.3), ('Pizza pera y roquefort', 'Peras', 0.25), ('Pizza pera y roquefort', 'Queso roquefort', 0.1),

  -- Hamburguesas: medallón de 180 g
  ('Cheeseburger', 'Pan de hamburguesa', 1), ('Cheeseburger', 'Carne picada', 0.18), ('Cheeseburger', 'Queso cheddar en fetas', 0.04),
  ('Hamburguesa cheddar y panceta', 'Pan de hamburguesa', 1), ('Hamburguesa cheddar y panceta', 'Carne picada', 0.18),
  ('Hamburguesa cheddar y panceta', 'Queso cheddar en fetas', 0.04), ('Hamburguesa cheddar y panceta', 'Panceta', 0.04),
  ('Hamburguesa cheddar y panceta', 'Cebolla', 0.08), ('Hamburguesa cheddar y panceta', 'Azúcar', 0.01), ('Hamburguesa cheddar y panceta', 'Salsa barbacoa', 0.03),
  ('Hamburguesa clásica', 'Pan de hamburguesa', 1), ('Hamburguesa clásica', 'Carne picada', 0.18), ('Hamburguesa clásica', 'Queso cheddar en fetas', 0.02),
  ('Hamburguesa clásica', 'Lechuga', 0.03), ('Hamburguesa clásica', 'Tomate', 0.05), ('Hamburguesa clásica', 'Mayonesa', 0.02),
  ('Hamburguesa azul', 'Pan de hamburguesa', 1), ('Hamburguesa azul', 'Carne picada', 0.18), ('Hamburguesa azul', 'Queso roquefort', 0.04),
  ('Hamburguesa azul', 'Rúcula', 0.03), ('Hamburguesa azul', 'Cebolla', 0.05),

  ('Sándwich de milanesa de carne', 'Pan de sándwich', 1), ('Sándwich de milanesa de carne', 'Carne para milanesa', 0.18),
  ('Sándwich de milanesa de carne', 'Pan rallado', 0.04), ('Sándwich de milanesa de carne', 'Huevos', 0.5), ('Sándwich de milanesa de carne', 'Aceite', 0.05),
  ('Sándwich de milanesa de carne', 'Lechuga', 0.03), ('Sándwich de milanesa de carne', 'Tomate', 0.05), ('Sándwich de milanesa de carne', 'Mayonesa', 0.02),
  ('Sándwich de milanesa de pollo', 'Pan de sándwich', 1), ('Sándwich de milanesa de pollo', 'Pechuga de pollo', 0.18),
  ('Sándwich de milanesa de pollo', 'Pan rallado', 0.04), ('Sándwich de milanesa de pollo', 'Huevos', 0.5), ('Sándwich de milanesa de pollo', 'Aceite', 0.05),
  ('Sándwich de milanesa de pollo', 'Lechuga', 0.03), ('Sándwich de milanesa de pollo', 'Tomate', 0.05), ('Sándwich de milanesa de pollo', 'Mayonesa', 0.02),
  ('Sándwich vegetariano', 'Pan de sándwich', 1), ('Sándwich vegetariano', 'Berenjena', 0.15), ('Sándwich vegetariano', 'Rúcula', 0.03),
  ('Sándwich vegetariano', 'Muzzarella', 0.06), ('Sándwich vegetariano', 'Aceite', 0.02),

  ('Papas cheddar, panceta y verdeo', 'Papas', 0.4), ('Papas cheddar, panceta y verdeo', 'Aceite', 0.06),
  ('Papas cheddar, panceta y verdeo', 'Queso cheddar para salsa', 0.08), ('Papas cheddar, panceta y verdeo', 'Panceta', 0.05),
  ('Papas cheddar, panceta y verdeo', 'Cebolla de verdeo', 0.02),
  ('Papas 4 quesos', 'Papas', 0.4), ('Papas 4 quesos', 'Aceite', 0.06), ('Papas 4 quesos', 'Muzzarella', 0.05), ('Papas 4 quesos', 'Queso roquefort', 0.03),
  ('Papas 4 quesos', 'Queso parmesano', 0.02), ('Papas 4 quesos', 'Queso cheddar para salsa', 0.05), ('Papas 4 quesos', 'Crema', 0.05),
  ('Papas bravas', 'Papas', 0.4), ('Papas bravas', 'Aceite', 0.06), ('Papas bravas', 'Tomate triturado', 0.06), ('Papas bravas', 'Pimentón', 0.003),
  ('Papas bravas', 'Ajo', 0.005), ('Papas bravas', 'Mayonesa', 0.03),

  ('Ensalada César', 'Lechuga', 0.15), ('Ensalada César', 'Pechuga de pollo', 0.12), ('Ensalada César', 'Pan de sándwich', 0.5),
  ('Ensalada César', 'Queso parmesano', 0.02), ('Ensalada César', 'Mayonesa', 0.03), ('Ensalada César', 'Limones', 0.25), ('Ensalada César', 'Ajo', 0.003),
  ('Ensalada Waldorf', 'Manzana verde', 0.2), ('Ensalada Waldorf', 'Apio', 0.1), ('Ensalada Waldorf', 'Nueces', 0.03), ('Ensalada Waldorf', 'Mayonesa', 0.04),

  ('Flan', 'Leche', 0.1), ('Flan', 'Huevos', 1), ('Flan', 'Azúcar', 0.03), ('Flan', 'Dulce de leche', 0.04), ('Flan', 'Crema', 0.03),
  ('Helado', 'Helado', 0.2),

  ('Fernet con cola', 'Fernet', 70), ('Fernet con cola', 'Cola', 230), ('Fernet con cola', 'Hielo', 0.2),
  ('Gin tonic', 'Gin', 60), ('Gin tonic', 'Tónica', 200), ('Gin tonic', 'Limones', 0.25), ('Gin tonic', 'Hielo', 0.2),
  ('Aperol spritz', 'Aperol', 90), ('Aperol spritz', 'Espumante', 90), ('Aperol spritz', 'Hielo', 0.2),
  ('Mojito', 'Ron blanco', 60), ('Mojito', 'Menta', 0.15), ('Mojito', 'Limones', 0.5), ('Mojito', 'Azúcar', 0.02), ('Mojito', 'Hielo', 0.25),
  ('Pinta rubia tirada', 'Cerveza rubia', 0.5), ('Pinta IPA tirada', 'Cerveza IPA', 0.5), ('Copa de Malbec', 'Vino Malbec (por copa)', 150)
) as x(prod, ins, cant)
join productos p on p.nombre = x.prod join insumos i on i.nombre = x.ins
on conflict do nothing;

-- Parrilla y Guarniciones (de la carta de ejemplo) se esconden si no les queda nada a la venta
update categorias c set activa = false
where c.nombre in ('Parrilla', 'Guarniciones') and not exists (select 1 from productos p where p.categoria_id = c.id and p.activo);

-- Los artículos toman el rinde de cocción de la tabla de referencia (cuando el nombre coincide)
update insumos i set referencia_id = r.id, rinde_coccion = r.rinde_coccion
from referencias r where lower(r.nombre) = lower(i.nombre) and i.referencia_id is null;

-- Lo que agregó la carta
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
         case when p.estacion = 'barra' then 'bebida' when c.nombre ilike 'guarni%' or c.nombre ilike 'papas%' then 'guarni' when c.nombre ilike 'postre%' then 'postre' else 'plato' end grupo,
         coalesce(w.peso, 1)::numeric peso
  from productos p join categorias c on c.id = p.categoria_id
  left join (values ('Pizza muzzarella', 2.6), ('Fugazzeta', 1.6), ('Napolitana', 1.8), ('Pizza especial', 1.4), ('Pizza rúcula y crudo', 1.3),
                    ('Hamburguesa cheddar y panceta', 2.6), ('Cheeseburger', 2.0), ('Hamburguesa clásica', 1.5), ('Sándwich de milanesa de carne', 1.8),
                    ('Sándwich de milanesa de pollo', 1.2), ('Empanada de carne', 2.2), ('Tiras de pollo crocantes', 1.5), ('Aros de cebolla', 1.3),
                    ('Papas cheddar, panceta y verdeo', 2.5), ('Papas bravas', 1.5), ('Fernet con cola', 4.0), ('Pinta rubia tirada', 4.0),
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
        values (d, (array['Hielo', 'Hielo', 'Servilletas', 'Gas envasado', 'Limones'])[1 + floor(random() * 5)::int], 'Caja chica', round((3000 + random() * 9000) / 500) * 500,
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
      ('Carne picada', 0.36, 'Se quemó o salió mal', 'Dos medallones pasados'), ('Muzzarella', 0.4, 'Devolución del cliente', 'Pizza mal cortada, se hizo otra'),
      ('Pan de hamburguesa', 6, 'Sobrante del día', null), ('Cerveza rubia', 3, 'Rotura o derrame', 'Cambio de barril'), ('Hielo', 5, 'Otro', 'Se derritió en la heladera'),
      ('Papas', 1.5, 'Vencido o en mal estado', 'Brotadas'), ('Fernet', 350, 'Rotura o derrame', 'Se cayó una botella abierta'), ('Crema', 0.5, 'Vencido o en mal estado', null),
      ('Rúcula', 0.2, 'Vencido o en mal estado', 'Se marchitó'), ('Lechuga', 0.4, 'Sobrante del día', null)) v(ins, cant, motivo, nota) loop
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
  update conteo set falta = round(venta_ab * case when nombre in ('Muzzarella', 'Jamón crudo', 'Carne picada') then 0.04 + random()::numeric * 0.03
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
  update insumos set cantidad = round(minimo * 0.6, 2) where nombre in ('Jamón crudo', 'Limones', 'Tónica', 'Rúcula');
  update insumos set cantidad = 0 where nombre = 'Menta';
  update insumos set vence = v_hoy + 1 where nombre = 'Carne picada';
  update insumos set vence = v_hoy where nombre = 'Lechuga';
  update insumos set vence = v_hoy + 4 where nombre in ('Crema', 'Leche');
  update productos set stock = round(stock_min * (0.5 + random() * 2.5)) where controla_stock;
  update productos set stock = round(stock_min * 0.6) where nombre in ('Agua mineral', 'Botella Malbec de la casa');

  -- ------------------------------------------------------------- pruebas de rendimiento
  for r in select * from (values ('Carne para milanesa', 5.0, 4.55, 3.6, 'Carnicería', 'Nalga, desgrasada y en fetas'), ('Carne para milanesa', 4.6, 4.25, null, 'Carnicería', null),
      ('Pechuga de pollo', 4.0, 3.55, 2.65, 'Carnicería', 'Sin piel, en tiras'), ('Papas', 10, 7.95, 4.45, 'Verdulería', 'Bastón, fritas dos veces'),
      ('Carne picada', 5.0, 5.0, 3.85, 'Carnicería', 'Medallones de 180 g')) v(ins, crudo, limpio, cocido, prov, nota) loop
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
        ('Service del horno', 'Mantenimiento', 220000, 22, 'caja'), ('Comisiones de tarjetas', 'Comisiones y bancos', 380000, 28, 'banco')) v(concepto, cat, monto, dia, cuenta) loop
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
      (2, '21:00', 'Álvarez', 10, 'confirmada', 'telefono', 'Despedida, quieren pizzas para compartir'), (2, '21:30', 'Pereyra', 4, 'pendiente', 'web', null),
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

  -- Una de las de hoy se pagó con dos medios y dejó propina
  select max(id::bigint) into t from datos_prueba where tabla = 'tickets';
  select total into v_tot from tickets where id = t::bigint;
  if v_caja is not null and exists (select 1 from medios_pago where nombre = 'Débito' and activo) and exists (select 1 from medios_pago where nombre = 'Efectivo' and activo) then
    update tickets set propina = round(v_tot * 0.1 / 100) * 100, medio = 'Débito' where id = t;
    insert into ticket_pagos (ticket_id, medio, monto) values (t, 'Efectivo', 20000), (t, 'Débito', v_tot + round(v_tot * 0.1 / 100) * 100 - 20000);
  end if;
  -- Correcciones de la noche (para la lista de la Caja)
  insert into pedido_cambios (hora, jornada, mesa, tipo, nombre, cantidad, importe, motivo, usuario_id, usuario) values
    (now() - interval '40 minutes', v_hoy, 'Mesa 10', 'sacado', 'Papas bravas', 1, (select precio from productos where nombre = 'Papas bravas'), 'Se equivocó al pedir', v_mozos[1], (select nombre from perfiles where id = v_mozos[1])),
    (now() - interval '30 minutes', v_hoy, 'Mesa 11', 'invitado', 'Flan', 1, (select precio from productos where nombre = 'Flan'), 'Demoró la cocina', coalesce(v_enc, v_admin), (select nombre from perfiles where id = coalesce(v_enc, v_admin)));
  for v_c in select id from pedido_cambios where jornada = v_hoy and hora > now() - interval '1 hour' loop insert into datos_prueba values ('pedido_cambios', v_c::text) on conflict do nothing; end loop;

  -- Pedidos sin mesa en curso: uno para llevar y un delivery
  for r in select * from (values ('llevar', 'Romina', '2974112233', null, 12, 'preparando'), ('delivery', 'Hugo', '2974998877', 'Av. Moyano 1450', 22, 'listo')) v(tipo, nombre, tel, dir, minutos, cocina) loop
    insert into mesas (numero, tipo, nombre, telefono, direccion, temporal, activa, estado, abierta, mozo_id)
    values ((select greatest(1000, max(numero) + 1) from mesas), r.tipo, r.nombre, r.tel, r.dir, true, true, 'ocupada', now() - (r.minutos + 3) * interval '1 minute', v_mozos[1])
    returning id into v_p;
    insert into datos_prueba values ('mesas_nuevas', v_p::text);
    insert into pedidos (mesa_id, origen, confirmado, creado, confirmado_en, mozo_id, est_cocina, t_cocina_listo)
    values (v_p, 'mozo', true, now() - r.minutos * interval '1 minute', now() - r.minutos * interval '1 minute', v_mozos[1], r.cocina::estado_comanda,
            case when r.cocina = 'listo' then now() - 2 * interval '1 minute' end) returning id into v_c;
    insert into datos_prueba values ('pedidos', v_c::text);
    insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion)
    select v_c, producto_id, nombre, 1 + floor(random() * 2)::int, precio, estacion from pesos where grupo in ('plato', 'guarni') order by -ln(1 - random()) / peso limit 3;
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
           case when p.nombre = 'Napolitana' and random() < 0.6 then 'Sin ajo'
                when p.nombre = 'Empanada de carne' then (array['Fritas', 'Al horno'])[1 + floor(random() * 2)::int]
                when p.nombre like 'Hamburguesa%' and random() < 0.3 then 'Sin cebolla' end
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
