-- =====================================================================
-- Última Vuelta · LA CARTA
--   Pizzas, hamburguesas, sándwiches, papas, ensaladas, entradas y postres, con sus recetas
--   (cuánto lleva cada plato, así la app calcula el costo y descuenta el stock),
--   los artículos que usan y los proveedores. Las bebidas son las de la carta de ejemplo.
--
--   LOS PRECIOS, LOS COSTOS Y LAS PORCIONES SON ESTIMADOS: corríjanlos desde la app
--   (Carta y QR → Carta para los precios, Stock → Recetas para las porciones;
--   el costo de cada artículo se actualiza solo al cargar las compras).
--   El stock arranca en cero: se llena con las compras o con el primer conteo.
--
--   Si ya habían cargado la carta de ejemplo, sus platos de parrilla quedan pausados (no se borran).
--   Si ya cargaron algo con el mismo nombre, lo respeta.
--   Se pega una vez en Supabase → SQL Editor → Run.
-- =====================================================================

do $$ begin
  if to_regclass('public.datos_prueba') is not null then
    raise exception 'Están cargados los datos de prueba. Primero corré 6-borrar-datos-de-prueba.sql, después esta carta y, si quieren, otra vez 5-datos-de-prueba.sql (ya sale con esta carta).';
  end if;
end $$;

-- Los platos de la carta de ejemplo que no van más: quedan pausados
update productos set activo = false
where activo and nombre in ('Provoleta', 'Choripán', 'Morcilla', 'Mollejas', 'Vacío', 'Entraña', 'Bife de chorizo', 'Asado de tira',
                            'Parrillada para 2', 'Papas fritas', 'Ensalada mixta', 'Flan mixto', 'Panqueque con dulce de leche');
update productos set descripcion = 'Frita o al horno', activo = true where nombre = 'Empanada de carne';

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
