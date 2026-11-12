-- =====================================================================
-- Última Vuelta · Tabla de referencia de rendimientos
-- Cuánto se pierde al limpiar (limpieza_pct), cuánto queda al cocinar (rinde_coccion = cocido / limpio)
-- y la porción típica por plato. Cubre parrilla y también lo que puede entrar en la carta:
-- pescados y mariscos, pollo, cerdo, cordero, verduras, guarniciones, pastas, arroz, legumbres, postres y barra.
--
-- Son valores APROXIMADOS para arrancar, armados con tablas generales (USDA: rendimientos de cocción
-- y de preparación) y práctica de cocina profesional. Varían con el proveedor, la pieza, el corte y el punto.
-- Las pruebas de Stock → Rendimientos dan el número real del local y reemplazan a estos.
-- Los artículos toman estos valores al crearlos; cambiar esta tabla no toca los artículos ya cargados.
-- =====================================================================

insert into referencias (grupo, nombre, unidad, limpieza_pct, rinde_coccion, coccion, porcion, porcion_es, nota) values
  -- Vacuna a la parrilla (porción: lo que llega al plato, cocido)
  ('Carne vacuna', 'Vacío',               'kg', 12, 0.70, 'parrilla, a punto', 0.300, 'cocido', 'Sacar la telita y el exceso de grasa'),
  ('Carne vacuna', 'Asado de tira',       'kg',  5, 0.65, 'parrilla, lento',   0.350, 'cocido', 'Con hueso: la porción incluye el hueso'),
  ('Carne vacuna', 'Entraña',             'kg', 15, 0.70, 'parrilla, fuego fuerte', 0.250, 'cocido', 'Pelar la membrana'),
  ('Carne vacuna', 'Matambre',            'kg', 10, 0.65, 'parrilla o al horno', 0.250, 'cocido', null),
  ('Carne vacuna', 'Bife de chorizo',     'kg', 10, 0.75, 'parrilla, a punto', 0.300, 'cocido', 'Rinde baja con más cocción'),
  ('Carne vacuna', 'Ojo de bife',         'kg', 10, 0.75, 'parrilla, a punto', 0.300, 'cocido', null),
  ('Carne vacuna', 'Bife ancho',          'kg', 12, 0.73, 'parrilla, a punto', 0.300, 'cocido', null),
  ('Carne vacuna', 'Lomo',                'kg', 15, 0.78, 'parrilla o plancha', 0.250, 'cocido', 'Sacar cordón y grasa'),
  ('Carne vacuna', 'Colita de cuadril',   'kg',  8, 0.72, 'parrilla',          0.250, 'cocido', null),
  ('Carne vacuna', 'Tapa de asado',       'kg', 10, 0.68, 'parrilla, lento',   0.300, 'cocido', null),
  ('Carne vacuna', 'Picaña',              'kg',  8, 0.72, 'parrilla',          0.250, 'cocido', 'Dejar la grasa de cobertura'),
  ('Carne vacuna', 'Falda',               'kg', 10, 0.60, 'parrilla lenta o guiso', 0.300, 'cocido', null),
  ('Carne vacuna', 'Carne picada',        'kg',  0, 0.75, 'plancha (hamburguesa)', 0.150, 'cocido', 'Una hamburguesa de 200 g cruda queda en unos 150 g'),
  ('Carne vacuna', 'Nalga o peceto para milanesa', 'kg', 10, 0.80, 'frita o al horno, rebozada', 0.200, 'cocido', 'El pan rallado y el huevo van aparte en la receta'),
  ('Carne vacuna', 'Carne para guiso o estofado', 'kg', 10, 0.65, 'guisada', 0.250, 'cocido', null),
  ('Carne vacuna', 'Carne para empanadas', 'kg', 5, 0.75, 'salteada', 0.040, 'cocido', 'Por empanada'),
  -- Achuras
  ('Achuras', 'Chorizo',                  'u.', 0, 1, 'parrilla', 1, 'cocido', 'Por unidad'),
  ('Achuras', 'Morcilla',                 'u.', 0, 1, 'parrilla', 1, 'cocido', 'Por unidad'),
  ('Achuras', 'Mollejas',                 'kg', 25, 0.65, 'parrilla', 0.200, 'cocido', 'Blanquear y pelar'),
  ('Achuras', 'Chinchulines',             'kg', 30, 0.55, 'parrilla, bien hechos', 0.200, 'cocido', 'Limpiar bien; pierden mucho'),
  ('Achuras', 'Riñón',                    'kg', 20, 0.70, 'parrilla', 0.200, 'cocido', null),
  ('Achuras', 'Provoleta',                'kg',  0, 0.90, 'parrilla o plancha', 0.150, 'limpio', 'Queso provolone en rodaja'),
  -- Cerdo
  ('Cerdo', 'Bondiola',                   'kg',  5, 0.70, 'parrilla o al horno', 0.300, 'cocido', null),
  ('Cerdo', 'Matambre de cerdo',          'kg',  8, 0.68, 'parrilla',          0.300, 'cocido', null),
  ('Cerdo', 'Pechito o costillas de cerdo', 'kg', 5, 0.65, 'parrilla o al horno', 0.400, 'cocido', 'Con hueso'),
  ('Cerdo', 'Solomillo de cerdo',         'kg',  8, 0.75, 'parrilla o plancha', 0.250, 'cocido', null),
  ('Cerdo', 'Carré de cerdo',             'kg',  8, 0.75, 'parrilla o al horno', 0.280, 'cocido', null),
  -- Pollo
  ('Pollo', 'Pollo entero',               'kg',  5, 0.70, 'parrilla o al horno', 0.400, 'cocido', 'Con hueso: medio pollo ronda 0,5 kg cocido'),
  ('Pollo', 'Pechuga de pollo',           'kg', 10, 0.75, 'plancha o parrilla', 0.200, 'cocido', 'Sin piel ni hueso'),
  ('Pollo', 'Pata y muslo',               'kg',  5, 0.70, 'parrilla o al horno', 0.300, 'cocido', 'Con hueso'),
  ('Pollo', 'Suprema para milanesa',      'kg', 10, 0.82, 'frita o al horno, rebozada', 0.200, 'cocido', 'El rebozado va aparte'),
  -- Cordero y chivito
  ('Cordero', 'Cordero patagónico',       'kg',  5, 0.65, 'asador o parrilla, lento', 0.400, 'cocido', 'Con hueso'),
  ('Cordero', 'Chivito',                  'kg',  5, 0.65, 'asador o parrilla, lento', 0.400, 'cocido', 'Con hueso'),
  ('Cordero', 'Carré de cordero',         'kg', 10, 0.75, 'parrilla o plancha', 0.250, 'cocido', null),
  -- Pescados y mariscos
  ('Pescados y mariscos', 'Filet de merluza',   'kg',  5, 0.80, 'plancha o frito', 0.200, 'cocido', null),
  ('Pescados y mariscos', 'Filet de abadejo',   'kg',  5, 0.80, 'plancha o parrilla', 0.200, 'cocido', null),
  ('Pescados y mariscos', 'Filet de salmón',    'kg',  5, 0.80, 'plancha o parrilla', 0.200, 'cocido', null),
  ('Pescados y mariscos', 'Pescado entero para filetear', 'kg', 55, 0.80, 'plancha o parrilla', 0.200, 'cocido', 'De la pieza entera sale menos de la mitad en filet'),
  ('Pescados y mariscos', 'Langostinos con cáscara', 'kg', 45, 0.85, 'plancha o hervidos', 0.150, 'cocido', 'Pelados y sin cabeza'),
  ('Pescados y mariscos', 'Calamar',            'kg', 30, 0.75, 'rabas fritas o plancha', 0.180, 'cocido', 'Limpio, en aros'),
  ('Pescados y mariscos', 'Mejillones con valva', 'kg', 70, 0.85, 'al vapor o a la provenzal', 0.150, 'cocido', 'Se aprovecha alrededor de un tercio'),
  ('Pescados y mariscos', 'Pulpo',              'kg', 15, 0.55, 'hervido y a la parrilla', 0.150, 'cocido', 'Pierde casi la mitad al hervir'),
  ('Pescados y mariscos', 'Cornalitos',         'kg',  5, 0.80, 'fritos', 0.200, 'cocido', null),
  -- Verduras y guarniciones
  ('Verduras', 'Papas para fritas',       'kg', 20, 0.55, 'fritas',     0.200, 'cocido', 'Peladas; al freír pierden casi la mitad del agua'),
  ('Verduras', 'Papas al horno o puré',   'kg', 15, 0.90, 'horno o hervidas', 0.200, 'cocido', null),
  ('Verduras', 'Batata',                  'kg', 20, 0.85, 'horno o frita', 0.200, 'cocido', null),
  ('Verduras', 'Cebolla',                 'kg', 10, 1,    'cruda', 0.050, 'limpio', 'Caramelizada rinde menos de la mitad'),
  ('Verduras', 'Tomate',                  'kg',  8, 1,    'crudo', 0.100, 'limpio', null),
  ('Verduras', 'Lechuga',                 'kg', 25, 1,    'cruda', 0.060, 'limpio', 'Hojas feas y tronco'),
  ('Verduras', 'Rúcula',                  'kg', 15, 1,    'cruda', 0.040, 'limpio', null),
  ('Verduras', 'Zanahoria',               'kg', 15, 1,    'cruda o hervida', 0.060, 'limpio', null),
  ('Verduras', 'Morrón',                  'kg', 18, 0.65, 'asado a la parrilla', 0.080, 'cocido', 'Sin semillas ni cabo'),
  ('Verduras', 'Berenjena',               'kg', 10, 0.70, 'parrilla o escabeche', 0.100, 'cocido', null),
  ('Verduras', 'Zapallito',               'kg',  8, 0.80, 'parrilla o salteado', 0.100, 'cocido', null),
  ('Verduras', 'Calabaza o zapallo',      'kg', 30, 0.85, 'horno o puré', 0.150, 'cocido', 'Cáscara y semillas'),
  ('Verduras', 'Choclo',                  'kg', 60, 1,    'desgranado', 0.080, 'limpio', 'De la mazorca se aprovechan los granos'),
  ('Verduras', 'Champiñones',             'kg',  5, 0.65, 'salteados', 0.080, 'cocido', null),
  ('Verduras', 'Ajo',                     'kg', 12, 1,    'crudo', 0.005, 'limpio', null),
  ('Verduras', 'Perejil y verdes',        'kg', 30, 1,    'crudo', 0.005, 'limpio', 'Tallos'),
  ('Verduras', 'Limón para jugo',         'kg', 60, 1,    'exprimido', 0.030, 'limpio', 'De un kilo salen unos 400 ml de jugo'),
  -- Huevos y lácteos
  ('Huevos y lácteos', 'Huevos',          'u.', 0, 1,    null, 1, 'limpio', 'Por unidad'),
  ('Huevos y lácteos', 'Muzzarella',      'kg', 0, 0.90, 'gratinada', 0.100, 'limpio', null),
  ('Huevos y lácteos', 'Queso rallado',   'kg', 0, 1,    null, 0.020, 'limpio', null),
  ('Huevos y lácteos', 'Crema',           'L',  0, 1,    null, 0.050, 'limpio', null),
  ('Huevos y lácteos', 'Manteca',         'kg', 0, 1,    null, 0.020, 'limpio', null),
  -- Secos: crecen al cocinar (rinde mayor a 1)
  ('Secos', 'Arroz',                      'kg', 0, 2.60, 'hervido', 0.200, 'cocido', '80 g crudos dan unos 200 g cocidos'),
  ('Secos', 'Fideos secos',               'kg', 0, 2.30, 'hervidos', 0.250, 'cocido', '110 g secos dan unos 250 g cocidos'),
  ('Secos', 'Pasta fresca',               'kg', 0, 1.40, 'hervida', 0.250, 'cocido', null),
  ('Secos', 'Polenta',                    'kg', 0, 4.00, 'hervida', 0.250, 'cocido', null),
  ('Secos', 'Lentejas o porotos secos',   'kg', 3, 2.40, 'hervidos', 0.200, 'cocido', 'Remojar; sacar piedritas'),
  ('Secos', 'Garbanzos secos',            'kg', 2, 2.20, 'hervidos', 0.200, 'cocido', null),
  ('Secos', 'Pan rallado',                'kg', 0, 1,    null, 0.030, 'limpio', 'Por milanesa'),
  -- Panificados y postres
  ('Panificados y postres', 'Pan',        'u.', 0, 1, null, 1, 'limpio', 'Por unidad'),
  ('Panificados y postres', 'Tapas de empanada', 'u.', 0, 1, null, 1, 'limpio', 'Por unidad'),
  ('Panificados y postres', 'Dulce de leche', 'kg', 0, 1, null, 0.050, 'limpio', null),
  ('Panificados y postres', 'Helado',     'kg', 5, 1, 'servido', 0.120, 'limpio', 'Lo que queda en el balde'),
  ('Panificados y postres', 'Frutas para postre o tragos', 'kg', 20, 1, 'pelada', 0.100, 'limpio', null),
  -- Barra (porción: lo que se sirve)
  ('Barra', 'Cerveza en barril',          'L', 7, 1, 'tirada', 0.500, 'limpio', 'Espuma, purga y cambio de barril. Pinta 0,5 L'),
  ('Barra', 'Cerveza en botella o lata',  'u.', 0, 1, null, 1, 'limpio', 'Por unidad'),
  ('Barra', 'Vino por copa',              'L', 2, 1, 'servido', 0.150, 'limpio', 'Una botella de 750 ml da 5 copas'),
  ('Barra', 'Bebidas blancas y aperitivos', 'L', 3, 1, 'servido', 0.060, 'limpio', 'Gin, fernet, aperitivos: medida de 60 ml'),
  ('Barra', 'Gaseosa o agua tónica',      'L', 3, 1, 'servida', 0.200, 'limpio', null),
  ('Barra', 'Hielo',                      'kg', 10, 1, null, 0.150, 'limpio', 'Lo que se derrite antes de usarse')
on conflict (nombre) do nothing;
