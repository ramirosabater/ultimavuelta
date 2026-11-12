-- =====================================================================
-- Última Vuelta · El bar de los Seba's · Esquema inicial
-- FloWerITT · Ramiro Sabater · 29/10/2026
--
-- Tablas, permisos por rol (RLS) y datos de base.
-- Las funciones de la app (cobrar, compras, tableros, QR) están en 0002.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type rol_usuario    as enum ('admin', 'encargado', 'mozo', 'cocina', 'barra');
create type estacion       as enum ('cocina', 'barra');
create type estado_comanda as enum ('pendiente', 'preparando', 'listo', 'entregado');
create type estado_mesa    as enum ('libre', 'ocupada', 'cuenta');

-- ---------------------------------------------------------------------
-- Usuarios
--   admin: los dueños, todo. encargado: todo menos usuarios y configuración.
--   mozo: mesas, pedidos y cobrar. cocina / barra: su pantalla de comandas.
-- ---------------------------------------------------------------------
create table perfiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  nombre  text not null,
  email   text,
  rol     rol_usuario not null default 'mozo',
  activo  boolean not null default true,
  creado  timestamptz not null default now()
);

create table parametros (
  clave       text primary key,
  valor       text not null,
  descripcion text
);

-- ---------------------------------------------------------------------
-- Carta
-- ---------------------------------------------------------------------
create table categorias (
  id        bigint generated always as identity primary key,
  nombre    text not null unique,
  estacion  estacion not null default 'cocina',   -- dónde se prepara por defecto
  orden     int not null default 0,
  activa    boolean not null default true
);

create table productos (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  descripcion    text,
  categoria_id   bigint not null references categorias(id),
  precio         numeric(14,2) not null check (precio >= 0),
  estacion       estacion not null default 'cocina',
  activo         boolean not null default true,     -- pausado: no se puede pedir
  controla_stock boolean not null default false,    -- botellas, latas, porrones: se cuentan por unidad
  stock          numeric(14,3) not null default 0,
  stock_min      numeric(14,3) not null default 0,
  orden          int not null default 0,
  creado         timestamptz not null default now()
);
create index productos_categoria_idx on productos (categoria_id);

-- ---------------------------------------------------------------------
-- Proveedores, artículos (insumos) y recetas
-- ---------------------------------------------------------------------
create table proveedores (
  id         bigint generated always as identity primary key,
  nombre     text not null unique,
  rubro      text,
  cuit       text,
  contacto   text,
  telefono   text,
  email      text,
  plazo_dias int not null default 0 check (plazo_dias >= 0),   -- 0 = contado
  notas      text,
  activo     boolean not null default true
);

create table insumos (
  id           bigint generated always as identity primary key,
  nombre       text not null unique,
  unidad       text not null default 'kg',
  cantidad     numeric(14,3) not null default 0,    -- lo que hay
  minimo       numeric(14,3) not null default 0,
  costo        numeric(14,4) not null default 0,    -- por unidad, el de la última compra
  merma_pct    numeric(5,2)  not null default 0 check (merma_pct between 0 and 90),  -- limpieza / porcionado
  pack         numeric(14,3),                       -- se compra de a (10 kg, 750 ml, 12 u.)
  pack_nombre  text,                                -- bolsa, botella, docena
  proveedor_id bigint references proveedores(id) on delete set null,
  vence        date,
  activo       boolean not null default true
);
create index insumos_proveedor_idx on insumos (proveedor_id);

create table receta_items (
  producto_id bigint not null references productos(id) on delete cascade,
  insumo_id   bigint not null references insumos(id) on delete restrict,
  cantidad    numeric(14,4) not null check (cantidad > 0),   -- limpia, por porción, en la unidad del insumo
  primary key (producto_id, insumo_id)
);
create index receta_insumo_idx on receta_items (insumo_id);

-- ---------------------------------------------------------------------
-- Salón: mesas, pedidos (comandas) y llamados
-- ---------------------------------------------------------------------
create table mesas (
  id          bigint generated always as identity primary key,
  numero      int not null unique check (numero > 0),
  zona        text,                                 -- Salón, Patio, Barra
  activa      boolean not null default true,
  -- El QR de la mesa lleva este código: es lo único que necesita el cliente para pedir
  token       text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
  estado      estado_mesa not null default 'libre',
  abierta     timestamptz,
  comensales  int check (comensales > 0),
  mozo_id     uuid references perfiles(id) on delete set null
);

create table pedidos (
  id             bigint generated always as identity primary key,
  mesa_id        bigint not null references mesas(id),
  origen         text not null default 'mozo' check (origen in ('mozo', 'qr')),
  confirmado     boolean not null default true,     -- los del QR esperan que el mozo los confirme
  creado         timestamptz not null default now(),
  confirmado_en  timestamptz,
  mozo_id        uuid references perfiles(id) on delete set null,
  est_cocina     estado_comanda,                    -- null: no tiene nada de cocina
  est_barra      estado_comanda,
  t_cocina_listo timestamptz,
  t_barra_listo  timestamptz,
  ticket_id      bigint                              -- se completa al cobrar la mesa (queda como historia)
);
create index pedidos_abiertos_idx on pedidos (mesa_id) where ticket_id is null;

create table pedido_items (
  id          bigint generated always as identity primary key,
  pedido_id   bigint not null references pedidos(id) on delete cascade,
  producto_id bigint references productos(id) on delete set null,
  nombre      text not null,
  cantidad    int not null check (cantidad between 1 and 99),
  precio      numeric(14,2) not null,
  estacion    estacion not null,
  nota        text check (length(nota) <= 140)
);
create index pedido_items_pedido_idx on pedido_items (pedido_id);

create table llamados (
  mesa_id bigint primary key references mesas(id) on delete cascade,
  creado  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Plata: cuentas, medios de pago, jornadas (caja), tickets, gastos
-- ---------------------------------------------------------------------
create table cuentas (
  id            bigint generated always as identity primary key,
  nombre        text not null unique,
  tipo          text not null default 'Banco' check (tipo in ('Efectivo', 'Banco', 'Billetera virtual')),
  saldo_inicial numeric(14,2) not null default 0,
  desde         date not null default current_date,   -- el saldo inicial es a esta fecha
  orden         int not null default 0,
  activa        boolean not null default true
);

create table medios_pago (
  nombre    text primary key,
  cuenta_id bigint references cuentas(id) on delete set null,   -- adónde entra lo cobrado así
  orden     int not null default 0,
  activo    boolean not null default true
);

-- La jornada corta a la hora de "corte_jornada" (6 AM): lo vendido a las 2 AM es de la noche anterior
create table jornadas (
  fecha           date primary key,
  apertura        numeric(14,2),                      -- efectivo inicial en caja
  abierta_en      timestamptz,
  abierta_por     uuid references perfiles(id) on delete set null,
  cierre_contado  numeric(14,2),
  cierre_esperado numeric(14,2),
  cerrada_en      timestamptz,
  cerrada_por     uuid references perfiles(id) on delete set null
);

create table tickets (
  id            bigint generated always as identity primary key,
  jornada       date not null,
  hora          timestamptz not null default now(),
  mesa_numero   int,
  mesa_abierta  timestamptz,
  comensales    int,
  mozo_id       uuid references perfiles(id) on delete set null,
  mozo_nombre   text,
  subtotal      numeric(14,2) not null,
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  total         numeric(14,2) not null,
  medio         text not null references medios_pago(nombre) on update cascade,
  costo         numeric(14,2) not null default 0,     -- mercadería según recetas al momento de cobrar
  min_cocina    int[] not null default '{}',          -- minutos de cada comanda hasta "listo"
  min_barra     int[] not null default '{}',
  cobrado_por   uuid references perfiles(id) on delete set null
);
create index tickets_jornada_idx on tickets (jornada);
alter table pedidos add constraint pedidos_ticket_fk foreign key (ticket_id) references tickets(id);

create table ticket_items (
  id          bigint generated always as identity primary key,
  ticket_id   bigint not null references tickets(id) on delete cascade,
  producto_id bigint references productos(id) on delete set null,
  nombre      text not null,
  categoria   text,
  cantidad    int not null,
  precio      numeric(14,2) not null,
  costo_unit  numeric(14,4) not null default 0
);
create index ticket_items_ticket_idx on ticket_items (ticket_id);
create index ticket_items_producto_idx on ticket_items (producto_id);

create table compras (
  id           bigint generated always as identity primary key,
  proveedor_id bigint references proveedores(id) on delete set null,
  numero       text,
  fecha        date not null default current_date,
  total        numeric(14,2) not null default 0,
  creado       timestamptz not null default now(),
  usuario_id   uuid references perfiles(id) on delete set null
);

create table gastos (
  id           bigint generated always as identity primary key,
  fecha        date not null default current_date,
  concepto     text not null,
  categoria    text not null default 'Otros',
  monto        numeric(14,2) not null check (monto >= 0),
  proveedor_id bigint references proveedores(id) on delete set null,
  estado       text not null default 'pagado' check (estado in ('pagado', 'pendiente')),
  cuenta_id    bigint references cuentas(id) on delete restrict,   -- de dónde salió la plata (si está pagado)
  pagado_el    date,
  vence        date,
  origen       text not null default 'manual' check (origen in ('manual', 'compra', 'caja')),
  compra_id    bigint references compras(id) on delete set null,
  jornada      date,                                  -- los gastos pagados con la caja del día
  nota         text,
  creado       timestamptz not null default now(),
  usuario_id   uuid references perfiles(id) on delete set null,
  check (estado = 'pendiente' or cuenta_id is not null)
);
create index gastos_fecha_idx on gastos (fecha);
create index gastos_pendientes_idx on gastos (vence) where estado = 'pendiente';

create table movimientos_cuenta (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('transferencia', 'ajuste')),
  de_cuenta  bigint references cuentas(id) on delete restrict,   -- transferencia: sale de acá
  a_cuenta   bigint references cuentas(id) on delete restrict,   -- transferencia: entra acá · ajuste: la cuenta
  monto      numeric(14,2) not null,                             -- ajuste: con signo
  fecha      date not null default current_date,
  nota       text,
  usuario_id uuid references perfiles(id) on delete set null,
  check ((tipo = 'transferencia' and de_cuenta is not null and a_cuenta is not null and de_cuenta <> a_cuenta and monto > 0)
      or (tipo = 'ajuste' and a_cuenta is not null))
);

-- ---------------------------------------------------------------------
-- Stock: todo lo que entra y sale queda como movimiento
--   venta: lo que usaron los platos cobrados (receta + merma de limpieza)
--   compra / ingreso: lo que entra · merma: lo que se tira · conteo: diferencia al contar
-- ---------------------------------------------------------------------
create table movimientos_stock (
  id          bigint generated always as identity primary key,
  insumo_id   bigint references insumos(id) on delete cascade,
  producto_id bigint references productos(id) on delete cascade,   -- bebidas que se cuentan por unidad
  tipo        text not null check (tipo in ('venta', 'compra', 'ingreso', 'merma', 'conteo')),
  cantidad    numeric(14,3) not null,      -- con signo: + entra, − sale
  costo_unit  numeric(14,4) not null default 0,
  motivo      text,
  nota        text,
  jornada     date not null,
  hora        timestamptz not null default now(),
  ticket_id   bigint references tickets(id) on delete set null,
  compra_id   bigint references compras(id) on delete set null,
  usuario_id  uuid references perfiles(id) on delete set null,
  check ((insumo_id is null) <> (producto_id is null))
);
create index mov_stock_insumo_idx on movimientos_stock (insumo_id, hora);
create index mov_stock_jornada_idx on movimientos_stock (jornada, tipo);

create table inventarios (
  id         bigint generated always as identity primary key,
  fecha      timestamptz not null default now(),
  completo   boolean not null default true,   -- false: un conteo suelto de un artículo
  usuario_id uuid references perfiles(id) on delete set null,
  nota       text
);
create table inventario_items (
  inventario_id bigint not null references inventarios(id) on delete cascade,
  insumo_id     bigint not null references insumos(id) on delete cascade,
  cantidad      numeric(14,3) not null check (cantidad >= 0),
  sistema       numeric(14,3) not null,          -- lo que decía la app al contar
  primary key (inventario_id, insumo_id)
);

create table rendimientos (
  id         bigint generated always as identity primary key,
  insumo_id  bigint not null references insumos(id) on delete cascade,
  proveedor  text,
  crudo      numeric(14,3) not null check (crudo > 0),
  limpio     numeric(14,3) not null check (limpio > 0 and limpio <= crudo),
  cocido     numeric(14,3) check (cocido is null or (cocido > 0 and cocido <= limpio)),
  nota       text,
  fecha      timestamptz not null default now(),
  usuario_id uuid references perfiles(id) on delete set null
);

-- Memoria de Chichito: qué sugerencias pospuso o no quiere ver cada usuario
create table ayudante_memoria (
  usuario    uuid not null default auth.uid() references perfiles(id) on delete cascade,
  tema       text not null,
  estado     text not null check (estado in ('nunca', 'pospuesta', 'aceptada')),
  hasta      timestamptz,
  actualizado timestamptz not null default now(),
  primary key (usuario, tema)
);

-- ---------------------------------------------------------------------
-- Permisos por filas (RLS)
--   Las funciones van entre paréntesis con select para que se evalúen una vez por consulta.
-- ---------------------------------------------------------------------
create or replace function mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;
create or replace function es_personal() returns boolean
language sql stable set search_path = public as $$ select mi_rol() is not null $$;
create or replace function es_gestion() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() in ('admin', 'encargado'), false) $$;
create or replace function es_salon() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() in ('admin', 'encargado', 'mozo'), false) $$;
create or replace function es_admin() returns boolean
language sql stable set search_path = public as $$ select coalesce(mi_rol() = 'admin', false) $$;

-- Gestión (dueños y encargado): leen y editan todo lo del negocio
do $$
declare t text;
begin
  foreach t in array array['proveedores','insumos','receta_items','cuentas','jornadas','tickets','ticket_items',
                           'compras','gastos','movimientos_cuenta','movimientos_stock','inventarios',
                           'inventario_items','rendimientos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using ((select es_gestion())) with check ((select es_gestion()))', t||'_gestion', t);
  end loop;
end $$;

-- Lo que ve todo el personal (los nombres de la carta y las mesas aparecen en todas las pantallas)
do $$
declare t text;
begin
  foreach t in array array['categorias','productos','mesas','pedidos','pedido_items','llamados','medios_pago']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using ((select es_personal()))', t||'_leer', t);
  end loop;
end $$;
-- La carta y los medios de pago los cambia gestión
create policy categorias_gestion  on categorias  for all using ((select es_gestion())) with check ((select es_gestion()));
create policy productos_gestion   on productos   for all using ((select es_gestion())) with check ((select es_gestion()));
create policy medios_gestion      on medios_pago for all using ((select es_gestion())) with check ((select es_gestion()));
create policy mesas_gestion       on mesas       for all using ((select es_gestion())) with check ((select es_gestion()));
-- Abrir mesas, cargar y confirmar pedidos, avanzar comandas, atender llamados y cobrar se hace con las
-- funciones de 0002: así los precios salen siempre de la carta y cada rol hace solo lo suyo.

alter table perfiles enable row level security;
create policy perfiles_leer  on perfiles for select using (id = (select auth.uid()) or (select es_gestion()));
create policy perfiles_admin on perfiles for all using ((select es_admin())) with check ((select es_admin()));

alter table parametros enable row level security;
create policy parametros_leer  on parametros for select using ((select es_personal()));
create policy parametros_admin on parametros for all using ((select es_admin())) with check ((select es_admin()));

alter table ayudante_memoria enable row level security;
create policy ayudante_propia on ayudante_memoria for all
  using (usuario = (select auth.uid())) with check (usuario = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Nada es público: lo único que puede usar alguien sin usuario son las tres
-- funciones de la carta por QR (0002). Supabase habilita todo para "anon" por defecto.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Pantallas en vivo (mesas, comandas y llamados se actualizan solos)
alter publication supabase_realtime add table mesas, pedidos, pedido_items, llamados;

-- ---------------------------------------------------------------------
-- Datos de base
-- ---------------------------------------------------------------------
insert into parametros (clave, valor, descripcion) values
  ('nombre_local',    'Última Vuelta', 'Nombre que se ve en la app, la carta y los QR'),
  ('bajada_local',    'El bar de los Seba''s', 'Segunda línea del nombre'),
  ('zona_horaria',    'America/Argentina/Buenos_Aires', 'Para saber a qué jornada corresponde cada venta'),
  ('corte_jornada',   '6', 'Hora en que termina la jornada: lo vendido antes de esta hora cuenta para la noche anterior'),
  ('cobertura_dias',  '3', 'Compras: para cuántos días se compra'),
  ('colchon_pct',     '15', 'Compras: margen extra sobre lo que se espera usar'),
  ('dias_cerrado',    '', 'Días que el local no abre (0 = domingo … 6 = sábado), separados por coma'),
  ('alerta_cocina',   '15,25', 'Minutos para marcar una comanda de cocina en amarillo y en rojo'),
  ('alerta_barra',    '5,10', 'Minutos para marcar una comanda de barra en amarillo y en rojo'),
  ('costo_objetivo',  '35', 'Porcentaje de costo de mercadería sobre el precio a partir del cual un plato se marca caro');

insert into categorias (nombre, estacion, orden) values
  ('Entradas', 'cocina', 1), ('Parrilla', 'cocina', 2), ('Guarniciones', 'cocina', 3), ('Postres', 'cocina', 4),
  ('Tragos', 'barra', 5), ('Cervezas', 'barra', 6), ('Vinos', 'barra', 7), ('Sin alcohol', 'barra', 8);

insert into cuentas (nombre, tipo, orden) values ('Caja', 'Efectivo', 1), ('Banco', 'Banco', 2), ('Mercado Pago', 'Billetera virtual', 3);
insert into medios_pago (nombre, cuenta_id, orden) values
  ('Efectivo',           (select id from cuentas where nombre = 'Caja'), 1),
  ('Débito',             (select id from cuentas where nombre = 'Banco'), 2),
  ('Crédito',            (select id from cuentas where nombre = 'Banco'), 3),
  ('Transferencia / QR', (select id from cuentas where nombre = 'Mercado Pago'), 4);

insert into mesas (numero, zona) select n, 'Salón' from generate_series(1, 12) n;
