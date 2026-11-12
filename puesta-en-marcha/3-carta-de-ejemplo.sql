-- =====================================================================
-- Carta, artículos, recetas y proveedores de ejemplo (opcional)
-- Sirve para arrancar a probar. Los precios, costos y porciones son estimados:
-- reemplazalos por los reales desde la app (Carta y QR, Stock, Administración).
-- Se puede correr una sola vez; si ya cargaste cosas con el mismo nombre, las saltea.
-- =====================================================================

insert into proveedores (nombre, rubro, plazo_dias) values
  ('Carnicería', 'Carnes', 7), ('Fiambrería', 'Quesos y fiambres', 0), ('Panadería', 'Panificados', 0),
  ('Verdulería', 'Frutas y verduras', 0), ('Mayorista', 'Almacén y carbón', 15), ('Hielo', 'Hielo', 0),
  ('Distribuidora', 'Bebidas', 30), ('Cervecería', 'Cerveza en barril', 15)
on conflict (nombre) do nothing;

insert into insumos (nombre, unidad, cantidad, minimo, costo, merma_pct, pack, pack_nombre, proveedor_id)
select x.nombre, x.unidad, x.cantidad, x.minimo, x.costo, x.merma, x.pack, x.pack_nombre, (select id from proveedores where nombre = x.prov)
from (values
  ('Vacío', 'kg', 18, 6, 9800, 12, null, null, 'Carnicería'),
  ('Entraña', 'kg', 8, 3, 15000, 8, null, null, 'Carnicería'),
  ('Bife de chorizo', 'kg', 10, 4, 12500, 8, null, null, 'Carnicería'),
  ('Asado de tira', 'kg', 15, 5, 8900, 5, null, null, 'Carnicería'),
  ('Mollejas', 'kg', 4, 2, 16000, 25, null, null, 'Carnicería'),
  ('Chorizo', 'u.', 40, 20, 900, 0, 10, 'paquete', 'Carnicería'),
  ('Morcilla', 'u.', 25, 10, 800, 0, 10, 'paquete', 'Carnicería'),
  ('Carne cortada para empanadas', 'kg', 3, 1, 9000, 0, null, null, 'Carnicería'),
  ('Queso provolone', 'kg', 3, 1, 13000, 0, null, null, 'Fiambrería'),
  ('Pan de chorizo', 'u.', 40, 20, 250, 0, 12, 'docena', 'Panadería'),
  ('Tapas de empanada', 'u.', 48, 24, 120, 0, 12, 'docena', 'Panadería'),
  ('Papas', 'kg', 25, 10, 900, 20, 10, 'bolsa', 'Verdulería'),
  ('Lechuga', 'kg', 2, 1, 2800, 25, null, null, 'Verdulería'),
  ('Tomate', 'kg', 4, 2, 2200, 10, null, null, 'Verdulería'),
  ('Cebolla', 'kg', 6, 2, 1200, 10, null, null, 'Verdulería'),
  ('Limones', 'u.', 40, 15, 150, 0, null, null, 'Verdulería'),
  ('Menta', 'atados', 4, 2, 900, 0, null, null, 'Verdulería'),
  ('Aceite', 'L', 10, 4, 3200, 0, 5, 'bidón', 'Mayorista'),
  ('Azúcar', 'kg', 3, 1, 1300, 0, 1, 'paquete', 'Mayorista'),
  ('Harina', 'kg', 5, 2, 900, 0, 1, 'paquete', 'Mayorista'),
  ('Leche', 'L', 6, 3, 1500, 0, 1, 'sachet', 'Mayorista'),
  ('Huevos', 'u.', 30, 12, 260, 0, 30, 'maple', 'Mayorista'),
  ('Dulce de leche', 'kg', 3, 1, 6500, 0, 1, 'pote', 'Mayorista'),
  ('Crema', 'L', 2, 1, 5200, 0, 0.5, 'pote', 'Mayorista'),
  ('Carbón', 'kg', 40, 15, 900, 0, 10, 'bolsa', 'Mayorista'),
  ('Hielo', 'kg', 30, 10, 500, 0, 15, 'bolsa', 'Hielo'),
  ('Fernet', 'ml', 3000, 1500, 20, 0, 750, 'botella', 'Distribuidora'),
  ('Cola', 'ml', 12000, 4000, 2.2, 0, 2250, 'botella 2,25 L', 'Distribuidora'),
  ('Gin', 'ml', 2100, 700, 26, 0, 700, 'botella', 'Distribuidora'),
  ('Tónica', 'ml', 6000, 3000, 4, 0, 1500, 'botella 1,5 L', 'Distribuidora'),
  ('Aperol', 'ml', 1500, 750, 22, 0, 750, 'botella', 'Distribuidora'),
  ('Espumante', 'ml', 3000, 1500, 10, 0, 750, 'botella', 'Distribuidora'),
  ('Ron blanco', 'ml', 1500, 750, 16, 0, 750, 'botella', 'Distribuidora'),
  ('Vino Malbec (por copa)', 'ml', 4500, 1500, 11, 0, 750, 'botella', 'Distribuidora'),
  ('Cerveza rubia', 'L', 60, 30, 2400, 5, 50, 'barril', 'Cervecería'),
  ('Cerveza IPA', 'L', 40, 20, 3100, 5, 50, 'barril', 'Cervecería')
) as x(nombre, unidad, cantidad, minimo, costo, merma, pack, pack_nombre, prov)
on conflict (nombre) do nothing;

insert into productos (nombre, descripcion, categoria_id, precio, estacion, controla_stock, stock, stock_min, orden)
select x.nombre, x.descr, c.id, x.precio, c.estacion, x.ctrl, coalesce(x.stock, 0), coalesce(x.smin, 0), x.orden
from (values
  ('Provoleta', 'Con orégano y aceite de oliva', 'Entradas', 9500, false, null, null, 1),
  ('Empanada de carne', 'Cortada a cuchillo', 'Entradas', 2800, false, null, null, 2),
  ('Choripán', 'Con chimichurri', 'Entradas', 6500, false, null, null, 3),
  ('Morcilla', null, 'Parrilla', 4500, false, null, null, 1),
  ('Mollejas', 'Al limón', 'Parrilla', 15000, false, null, null, 2),
  ('Vacío', '400 g', 'Parrilla', 22000, false, null, null, 3),
  ('Entraña', '350 g', 'Parrilla', 25000, false, null, null, 4),
  ('Bife de chorizo', '450 g', 'Parrilla', 26000, false, null, null, 5),
  ('Asado de tira', null, 'Parrilla', 21000, false, null, null, 6),
  ('Parrillada para 2', 'Asado, vacío, chorizo, morcilla y mollejas', 'Parrilla', 48000, false, null, null, 7),
  ('Papas fritas', null, 'Guarniciones', 7000, false, null, null, 1),
  ('Ensalada mixta', 'Lechuga, tomate y cebolla', 'Guarniciones', 6000, false, null, null, 2),
  ('Flan mixto', 'Con dulce de leche y crema', 'Postres', 6000, false, null, null, 1),
  ('Panqueque con dulce de leche', null, 'Postres', 6000, false, null, null, 2),
  ('Fernet con cola', null, 'Tragos', 7500, false, null, null, 1),
  ('Gin tonic', null, 'Tragos', 9000, false, null, null, 2),
  ('Aperol spritz', null, 'Tragos', 9000, false, null, null, 3),
  ('Mojito', null, 'Tragos', 8500, false, null, null, 4),
  ('Pinta rubia tirada', null, 'Cervezas', 5500, false, null, null, 1),
  ('Pinta IPA tirada', null, 'Cervezas', 6500, false, null, null, 2),
  ('Porrón 1 L', null, 'Cervezas', 7000, true, 48, 12, 3),
  ('Copa de Malbec', null, 'Vinos', 5000, false, null, null, 1),
  ('Botella Malbec de la casa', '750 ml', 'Vinos', 18000, true, 24, 6, 2),
  ('Botella Cabernet', '750 ml', 'Vinos', 20000, true, 12, 4, 3),
  ('Agua mineral', '500 ml', 'Sin alcohol', 3000, true, 36, 12, 1),
  ('Gaseosa', '500 ml', 'Sin alcohol', 3500, true, 36, 12, 2)
) as x(nombre, descr, cat, precio, ctrl, stock, smin, orden)
join categorias c on c.nombre = x.cat
where not exists (select 1 from productos p where p.nombre = x.nombre);

insert into receta_items (producto_id, insumo_id, cantidad)
select p.id, i.id, x.cant
from (values
  ('Provoleta', 'Queso provolone', 0.15),
  ('Empanada de carne', 'Tapas de empanada', 1), ('Empanada de carne', 'Carne cortada para empanadas', 0.06), ('Empanada de carne', 'Cebolla', 0.02),
  ('Choripán', 'Chorizo', 1), ('Choripán', 'Pan de chorizo', 1),
  ('Morcilla', 'Morcilla', 1),
  ('Mollejas', 'Mollejas', 0.3), ('Mollejas', 'Limones', 0.5),
  ('Vacío', 'Vacío', 0.4), ('Entraña', 'Entraña', 0.35), ('Bife de chorizo', 'Bife de chorizo', 0.45), ('Asado de tira', 'Asado de tira', 0.5),
  ('Parrillada para 2', 'Asado de tira', 0.4), ('Parrillada para 2', 'Vacío', 0.3), ('Parrillada para 2', 'Chorizo', 2),
  ('Parrillada para 2', 'Morcilla', 2), ('Parrillada para 2', 'Mollejas', 0.2),
  ('Papas fritas', 'Papas', 0.35), ('Papas fritas', 'Aceite', 0.05),
  ('Ensalada mixta', 'Lechuga', 0.1), ('Ensalada mixta', 'Tomate', 0.15), ('Ensalada mixta', 'Cebolla', 0.05),
  ('Flan mixto', 'Leche', 0.1), ('Flan mixto', 'Huevos', 1), ('Flan mixto', 'Azúcar', 0.03), ('Flan mixto', 'Dulce de leche', 0.04), ('Flan mixto', 'Crema', 0.03),
  ('Panqueque con dulce de leche', 'Harina', 0.04), ('Panqueque con dulce de leche', 'Leche', 0.08),
  ('Panqueque con dulce de leche', 'Huevos', 0.5), ('Panqueque con dulce de leche', 'Dulce de leche', 0.08),
  ('Fernet con cola', 'Fernet', 70), ('Fernet con cola', 'Cola', 230), ('Fernet con cola', 'Hielo', 0.2),
  ('Gin tonic', 'Gin', 60), ('Gin tonic', 'Tónica', 200), ('Gin tonic', 'Limones', 0.25), ('Gin tonic', 'Hielo', 0.2),
  ('Aperol spritz', 'Aperol', 90), ('Aperol spritz', 'Espumante', 90), ('Aperol spritz', 'Hielo', 0.2),
  ('Mojito', 'Ron blanco', 60), ('Mojito', 'Menta', 0.15), ('Mojito', 'Limones', 0.5), ('Mojito', 'Azúcar', 0.02), ('Mojito', 'Hielo', 0.25),
  ('Pinta rubia tirada', 'Cerveza rubia', 0.5), ('Pinta IPA tirada', 'Cerveza IPA', 0.5), ('Copa de Malbec', 'Vino Malbec (por copa)', 150)
) as x(prod, ins, cant)
join productos p on p.nombre = x.prod join insumos i on i.nombre = x.ins
on conflict do nothing;
