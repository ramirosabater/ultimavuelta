-- =====================================================================
-- Última Vuelta · base completa (= las migraciones de supabase/migrations, en orden)
-- Se corre UNA vez, en un proyecto Supabase nuevo, desde el SQL Editor.
-- Generado con: cat supabase/migrations/*.sql
-- =====================================================================


-- >>> 20261029000001_esquema.sql
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

-- Tabla de referencia: cuánto se pierde al limpiar y cuánto queda al cocinar cada tipo de artículo.
-- Valores aproximados de tablas generales para arrancar; las pruebas de rendimiento propias mandan.
create table referencias (
  id             bigint generated always as identity primary key,
  nombre         text not null unique,
  grupo          text not null,
  unidad         text not null default 'kg',
  limpieza_pct   numeric(5,2) not null default 0 check (limpieza_pct between 0 and 90),
  rinde_coccion  numeric(6,3) not null default 1 check (rinde_coccion > 0 and rinde_coccion <= 6),  -- cocido / limpio
  coccion        text,                              -- cómo se cocina en ese rinde (parrilla, frito, hervido…)
  porcion        numeric(10,3),                     -- porción típica por plato
  porcion_es     text not null default 'cocido' check (porcion_es in ('cocido', 'limpio')),
  nota           text
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
  rinde_coccion numeric(6,3) not null default 1 check (rinde_coccion > 0 and rinde_coccion <= 6),  -- cocido / limpio: 0,70 la carne, 2,6 el arroz
  referencia_id bigint references referencias(id) on delete set null,
  activo       boolean not null default true
);
create index insumos_proveedor_idx on insumos (proveedor_id);

create table receta_items (
  producto_id bigint not null references productos(id) on delete cascade,
  insumo_id   bigint not null references insumos(id) on delete restrict,
  cantidad    numeric(14,4) not null check (cantidad > 0),   -- por porción, en la unidad del insumo
  cocido      boolean not null default false,                 -- true: la cantidad es como sale al plato (ya cocido)
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

alter table referencias enable row level security;
create policy referencias_leer    on referencias for select using ((select es_personal()));
create policy referencias_gestion on referencias for all using ((select es_gestion())) with check ((select es_gestion()));

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

-- >>> 20261029000002_operacion.sql
-- =====================================================================
-- Última Vuelta · Funciones de la operación
--   Salón: abrir mesa, cargar y confirmar pedidos, comandas, llamados, cobrar.
--   Caja: abrir, gastos con la plata de la caja, cerrar.
--   Stock: compras, mermas, conteos e inventarios, recetas.
--   Plata: pagar deudas, saldos de las cuentas.
-- Cada función revisa el rol de quien la llama. Los precios y costos salen
-- siempre de la base, nunca de lo que manda el navegador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function param(p_clave text, p_defecto text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select valor from parametros where clave = p_clave), p_defecto)
$$;

create or replace function zona() returns text
language sql stable set search_path = public as $$ select param('zona_horaria', 'America/Argentina/Buenos_Aires') $$;

-- La jornada de un momento: lo vendido antes de la hora de corte cuenta para la noche anterior
create or replace function jornada_de(p_ts timestamptz) returns date
language sql stable set search_path = public as $$
  select ((p_ts at time zone zona()) - make_interval(hours => coalesce(nullif(param('corte_jornada'), '')::int, 6)))::date
$$;
create or replace function jornada_actual() returns date
language sql stable set search_path = public as $$ select jornada_de(now()) $$;
create or replace function hoy_local() returns date
language sql stable set search_path = public as $$ select (now() at time zone zona())::date $$;

-- La jornada a la que va lo que se cobra ahora: la actual, salvo que su caja ya esté cerrada.
-- Entonces pasa a la siguiente (y así, si esa también se abrió y cerró antes de tiempo).
create or replace function jornada_caja() returns date
language plpgsql stable security definer set search_path = public as $$
declare v_j date := jornada_actual();
begin
  for i in 1..7 loop
    exit when not exists (select 1 from jornadas where fecha = v_j and cerrada_en is not null);
    v_j := v_j + 1;
  end loop;
  return v_j;
end $$;

-- Cantidad a comprar para tener p_limpio después de limpiar (merma de limpieza)
create or replace function bruto(p_limpio numeric, p_merma numeric) returns numeric
language sql immutable as $$ select p_limpio / (1 - least(coalesce(p_merma, 0), 90) / 100.0) $$;

-- Cantidad a comprar para una porción: si la receta está en cocido, primero se pasa a limpio (÷ rinde de cocción)
-- y después se suma la merma de limpieza
create or replace function crudo(p_cant numeric, p_cocido boolean, p_merma numeric, p_rinde numeric) returns numeric
language sql immutable as $$
  select bruto(case when p_cocido then p_cant / greatest(coalesce(p_rinde, 1), 0.01) else p_cant end, p_merma)
$$;

-- Costo de una porción según la receta y el último precio de cada artículo
create or replace function costo_receta(p_producto bigint) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(crudo(r.cantidad, r.cocido, i.merma_pct, i.rinde_coccion) * i.costo), 0)
  from receta_items r join insumos i on i.id = r.insumo_id where r.producto_id = p_producto
$$;

create or replace function exigir(p_ok boolean, p_mensaje text) returns void
language plpgsql as $$ begin if not coalesce(p_ok, false) then raise exception '%', p_mensaje using errcode = 'P0001'; end if; end $$;

-- ---------------------------------------------------------------------
-- Salón
-- ---------------------------------------------------------------------
create or replace function abrir_mesa(p_mesa bigint, p_comensales int default null) returns void
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede abrir mesas.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found, 'La mesa no existe.');
  perform exigir(m.estado = 'libre', format('La mesa %s ya está abierta.', m.numero));
  update mesas set estado = 'ocupada', abierta = now(), comensales = nullif(p_comensales, 0), mozo_id = auth.uid() where id = p_mesa;
end $$;

-- Valida los ítems que manda el navegador y devuelve los que se pueden cargar, con precio y estación de la carta
create or replace function items_validos(p_items jsonb)
returns table (producto_id bigint, nombre text, cantidad int, precio numeric, estacion estacion, nota text)
language plpgsql stable security definer set search_path = public as $$
declare x jsonb; p productos; n int := 0;
begin
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 40, 'El pedido está vacío o es demasiado largo.');
  for x in select * from jsonb_array_elements(p_items) loop
    select * into p from productos where id = (x->>'producto_id')::bigint;
    perform exigir(found and p.activo, 'Uno de los productos ya no está en la carta. Actualizá la página.');
    perform exigir(not p.controla_stock or p.stock > 0, format('%s está agotado.', p.nombre));
    perform exigir((x->>'cantidad')::int between 1 and 30, 'Cantidad no válida.');
    n := n + (x->>'cantidad')::int;
    producto_id := p.id; nombre := p.nombre; cantidad := (x->>'cantidad')::int; precio := p.precio; estacion := p.estacion;
    nota := nullif(left(trim(coalesce(x->>'nota', '')), 140), '');
    return next;
  end loop;
  perform exigir(n <= 60, 'El pedido tiene demasiadas unidades.');
end $$;

create or replace function crear_pedido(p_mesa bigint, p_items jsonb, p_origen text, p_confirmado boolean) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into pedidos (mesa_id, origen, confirmado, confirmado_en, mozo_id)
  values (p_mesa, p_origen, p_confirmado, case when p_confirmado then now() end, case when p_confirmado then auth.uid() end)
  returning id into v_id;
  insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion, nota)
  select v_id, v.producto_id, v.nombre, v.cantidad, v.precio, v.estacion, v.nota from items_validos(p_items) v;
  update pedidos set
    est_cocina = case when exists (select 1 from pedido_items where pedido_id = v_id and estacion = 'cocina') then 'pendiente'::estado_comanda end,
    est_barra  = case when exists (select 1 from pedido_items where pedido_id = v_id and estacion = 'barra')  then 'pendiente'::estado_comanda end
  where id = v_id;
  return v_id;
end $$;

-- El mozo carga una comanda. Si la mesa estaba libre, la abre.
create or replace function cargar_pedido(p_mesa bigint, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cargar pedidos.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found and m.activa, 'La mesa no existe.');
  if m.estado = 'libre' then
    update mesas set estado = 'ocupada', abierta = now(), mozo_id = auth.uid() where id = p_mesa;
  end if;
  return crear_pedido(p_mesa, p_items, 'mozo', true);
end $$;

-- Un pedido que hizo el cliente por QR: el mozo lo confirma y recién ahí va a parrilla y barra
create or replace function confirmar_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  perform exigir(es_salon(), 'Tu usuario no puede confirmar pedidos.');
  select * into p from pedidos where id = p_pedido for update;
  perform exigir(found and p.ticket_id is null, 'El pedido ya no existe.');
  perform exigir(not p.confirmado, 'El pedido ya estaba confirmado.');
  update pedidos set confirmado = true, confirmado_en = now(), creado = now(), mozo_id = auth.uid() where id = p_pedido;
  update mesas set estado = 'ocupada', abierta = coalesce(abierta, now()), mozo_id = coalesce(mozo_id, auth.uid())
  where id = p.mesa_id and estado = 'libre';
end $$;

-- Rechazar un pedido del QR o anular uno que todavía no empezaron a preparar
create or replace function anular_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p pedidos;
begin
  perform exigir(es_salon(), 'Tu usuario no puede anular pedidos.');
  select * into p from pedidos where id = p_pedido for update;
  perform exigir(found and p.ticket_id is null, 'El pedido ya no existe.');
  perform exigir(not p.confirmado or es_gestion()
                 or (coalesce(p.est_cocina, 'pendiente') = 'pendiente' and coalesce(p.est_barra, 'pendiente') = 'pendiente'),
                 'Ya lo están preparando: pedile a un encargado que lo anule.');
  delete from pedidos where id = p_pedido;
end $$;

-- Parrilla y barra avanzan sus comandas; el mozo marca lo entregado
create or replace function avanzar_comanda(p_pedido bigint, p_estacion estacion, p_estado estado_comanda) returns void
language plpgsql security definer set search_path = public as $$
declare v_rol rol_usuario := mi_rol();
begin
  perform exigir(v_rol in ('admin', 'encargado', 'mozo') or v_rol::text = p_estacion::text, 'Esta comanda es de otra estación.');
  if p_estacion = 'cocina' then
    update pedidos set est_cocina = p_estado, t_cocina_listo = case when p_estado = 'listo' then now() else t_cocina_listo end
    where id = p_pedido and confirmado and ticket_id is null and est_cocina is not null;
  else
    update pedidos set est_barra = p_estado, t_barra_listo = case when p_estado = 'listo' then now() else t_barra_listo end
    where id = p_pedido and confirmado and ticket_id is null and est_barra is not null;
  end if;
  perform exigir(found, 'La comanda ya no existe.');
end $$;

-- El mozo retiró lo que estaba listo (de parrilla, de barra o de las dos)
create or replace function entregar_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede marcar entregas.');
  update pedidos set
    est_cocina = case when est_cocina = 'listo' then 'entregado' else est_cocina end,
    est_barra  = case when est_barra  = 'listo' then 'entregado' else est_barra  end
  where id = p_pedido and ticket_id is null;
end $$;

create or replace function pedir_cuenta(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  update mesas set estado = 'cuenta' where id = p_mesa and estado <> 'libre';
  delete from llamados where mesa_id = p_mesa;
end $$;

create or replace function atender_llamado(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede atender mesas.');
  delete from llamados where mesa_id = p_mesa;
end $$;

-- Cerrar una mesa sin cobrar (se abrió por error o se fueron sin consumir)
create or replace function liberar_mesa(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  perform exigir(not exists (select 1 from pedidos where mesa_id = p_mesa and ticket_id is null and confirmado),
                 'La mesa tiene pedidos: cobrala o anulá los pedidos primero.');
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_mesa;
end $$;

-- Pasar todo de una mesa a otra que esté libre
create or replace function mover_mesa(p_desde bigint, p_hacia bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a mesas; b mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  select * into a from mesas where id = p_desde for update;
  select * into b from mesas where id = p_hacia for update;
  perform exigir(a.id is not null and b.id is not null and b.activa, 'La mesa no existe.');
  perform exigir(b.estado = 'libre' and not exists (select 1 from pedidos where mesa_id = p_hacia and ticket_id is null),
                 format('La mesa %s no está libre.', b.numero));
  update pedidos set mesa_id = p_hacia where mesa_id = p_desde and ticket_id is null;
  update mesas set estado = a.estado, abierta = a.abierta, comensales = a.comensales, mozo_id = a.mozo_id where id = p_hacia;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_desde;
  delete from llamados where mesa_id = p_desde;
end $$;

-- ---------------------------------------------------------------------
-- Cobrar: ticket, costo de mercadería, descuento de stock y mesa libre, todo junto
-- ---------------------------------------------------------------------
create or replace function cobrar_mesa(p_mesa bigint, p_medio text, p_descuento numeric default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m mesas; v_t bigint; v_sub numeric; v_tot numeric; v_j date := jornada_caja(); r record;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cobrar.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found, 'La mesa no existe.');
  perform exigir(exists (select 1 from medios_pago where nombre = p_medio and activo), 'Elegí un medio de pago.');
  p_descuento := coalesce(p_descuento, 0);
  perform exigir(p_descuento between 0 and 100, 'El descuento tiene que estar entre 0 y 100 %.');

  select sum(i.cantidad * i.precio) into v_sub
  from pedido_items i join pedidos p on p.id = i.pedido_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado;
  perform exigir(v_sub is not null, format('La mesa %s no tiene nada para cobrar.', m.numero));
  v_tot := round(v_sub * (1 - p_descuento / 100), 2);

  insert into tickets (jornada, mesa_numero, mesa_abierta, comensales, mozo_id, mozo_nombre, subtotal, descuento_pct, total, medio, cobrado_por,
                       min_cocina, min_barra)
  select v_j, m.numero, m.abierta, m.comensales, m.mozo_id, (select nombre from perfiles where id = m.mozo_id), v_sub, p_descuento, v_tot, p_medio, auth.uid(),
         coalesce(array_agg(round(extract(epoch from p.t_cocina_listo - p.creado) / 60)::int) filter (where p.t_cocina_listo is not null), '{}'),
         coalesce(array_agg(round(extract(epoch from p.t_barra_listo  - p.creado) / 60)::int) filter (where p.t_barra_listo  is not null), '{}')
  from pedidos p where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  returning id into v_t;

  insert into ticket_items (ticket_id, producto_id, nombre, categoria, cantidad, precio, costo_unit)
  select v_t, i.producto_id, i.nombre, c.nombre, sum(i.cantidad), i.precio, coalesce(costo_receta(i.producto_id), 0)
  from pedido_items i join pedidos p on p.id = i.pedido_id
  left join productos pr on pr.id = i.producto_id left join categorias c on c.id = pr.categoria_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  group by i.producto_id, i.nombre, c.nombre, i.precio;

  update tickets set costo = (select coalesce(sum(cantidad * costo_unit), 0) from ticket_items where ticket_id = v_t) where id = v_t;

  -- Bebidas que se cuentan por unidad
  for r in select ti.producto_id, sum(ti.cantidad) q from ticket_items ti join productos p on p.id = ti.producto_id
           where ti.ticket_id = v_t and p.controla_stock group by ti.producto_id loop
    update productos set stock = greatest(0, stock - r.q) where id = r.producto_id;
    insert into movimientos_stock (producto_id, tipo, cantidad, jornada, ticket_id, usuario_id) values (r.producto_id, 'venta', -r.q, v_j, v_t, auth.uid());
  end loop;

  -- Artículos de las recetas (con la merma de limpieza)
  for r in select ri.insumo_id, sum(ti.cantidad * crudo(ri.cantidad, ri.cocido, i.merma_pct, i.rinde_coccion)) q, max(i.costo) c
           from ticket_items ti join receta_items ri on ri.producto_id = ti.producto_id join insumos i on i.id = ri.insumo_id
           where ti.ticket_id = v_t group by ri.insumo_id loop
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, ticket_id, usuario_id)
    values (r.insumo_id, 'venta', -round(r.q, 3), r.c, v_j, v_t, auth.uid());
    update insumos set cantidad = greatest(0, cantidad - round(r.q, 3)) where id = r.insumo_id;
  end loop;

  -- Los pedidos quedan como historia del ticket; los del QR sin confirmar se descartan
  update pedidos set ticket_id = v_t,
    est_cocina = case when est_cocina is null then null else 'entregado'::estado_comanda end,
    est_barra  = case when est_barra  is null then null else 'entregado'::estado_comanda end
  where mesa_id = p_mesa and ticket_id is null and confirmado;
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null where id = p_mesa;

  return jsonb_build_object('id', v_t, 'total', v_tot, 'subtotal', v_sub, 'medio', p_medio, 'mesa', m.numero);
end $$;

-- ---------------------------------------------------------------------
-- Caja del día
-- ---------------------------------------------------------------------
create or replace function cuenta_efectivo() returns bigint
language sql stable set search_path = public as $$
  select coalesce((select cuenta_id from medios_pago where nombre = 'Efectivo'),
                  (select id from cuentas where tipo = 'Efectivo' and activa order by orden limit 1))
$$;

create or replace function abrir_caja(p_monto numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_caja();
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados abren la caja.');
  perform exigir(coalesce(p_monto, -1) >= 0, 'Cargá el efectivo inicial (puede ser 0).');
  perform exigir(not exists (select 1 from jornadas where fecha = v_j and apertura is not null), 'La caja de hoy ya está abierta.');
  insert into jornadas (fecha, apertura, abierta_en, abierta_por) values (v_j, p_monto, now(), auth.uid())
  on conflict (fecha) do update set apertura = excluded.apertura, abierta_en = excluded.abierta_en, abierta_por = excluded.abierta_por;
end $$;

create or replace function registrar_gasto_caja(p_concepto text, p_monto numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_caja(); v_c bigint := cuenta_efectivo();
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados sacan plata de la caja.');
  perform exigir(length(trim(coalesce(p_concepto, ''))) > 0 and coalesce(p_monto, 0) > 0, 'Completá concepto y monto.');
  perform exigir(v_c is not null, 'Falta una cuenta de efectivo (Administración → Cuentas).');
  insert into gastos (fecha, concepto, categoria, monto, estado, cuenta_id, pagado_el, origen, jornada, usuario_id)
  values (hoy_local(), trim(p_concepto), 'Caja chica', p_monto, 'pagado', v_c, hoy_local(), 'caja', v_j, auth.uid());
end $$;

-- Lo que debería haber en la caja: inicial + ventas en efectivo − gastos pagados con la caja
create or replace function efectivo_esperado(p_jornada date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select apertura from jornadas where fecha = p_jornada), 0)
       + coalesce((select sum(t.total) from tickets t join medios_pago mp on mp.nombre = t.medio
                   join cuentas c on c.id = mp.cuenta_id where t.jornada = p_jornada and c.tipo = 'Efectivo'), 0)
       - coalesce((select sum(monto) from gastos where jornada = p_jornada and origen = 'caja'), 0)
$$;

create or replace function cerrar_caja(p_contado numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_caja(); v_e numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cierran la caja.');
  perform exigir(coalesce(p_contado, -1) >= 0, 'Cargá el efectivo contado.');
  perform exigir(exists (select 1 from jornadas where fecha = v_j and apertura is not null), 'La caja de hoy no está abierta.');
  v_e := efectivo_esperado(v_j);
  update jornadas set cierre_contado = p_contado, cierre_esperado = v_e, cerrada_en = now(), cerrada_por = auth.uid() where fecha = v_j;
  return jsonb_build_object('contado', p_contado, 'esperado', v_e, 'diferencia', p_contado - v_e);
end $$;

-- ---------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------
-- Una compra (una factura o lo que llegó de un artículo): suma stock, actualiza el costo y deja el gasto
-- p_items: [{insumo_id, cantidad, total, vence}] · p_pago: 'pendiente' o el id de la cuenta con que se pagó
create or replace function registrar_compra(p_items jsonb, p_proveedor bigint default null, p_numero text default null,
                                            p_fecha date default null, p_pago text default 'pendiente',
                                            p_proveedor_nuevo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prov bigint := p_proveedor; v_fecha date := coalesce(p_fecha, hoy_local()); v_c bigint; v_tot numeric := 0;
  x jsonb; i insumos; v_cant numeric; v_monto numeric; v_cu numeric; v_plazo int; v_nombre text; v_n int := 0; v_cuenta bigint;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cargan compras.');
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 80, 'La compra no tiene artículos.');
  if v_prov is null and length(trim(coalesce(p_proveedor_nuevo, ''))) > 0 then
    insert into proveedores (nombre) values (trim(p_proveedor_nuevo))
    on conflict (nombre) do update set nombre = excluded.nombre returning id into v_prov;
  end if;
  if p_pago is not null and p_pago <> 'pendiente' then
    v_cuenta := p_pago::bigint;
    perform exigir(exists (select 1 from cuentas where id = v_cuenta), 'La cuenta no existe.');
  end if;

  insert into compras (proveedor_id, numero, fecha, usuario_id) values (v_prov, nullif(trim(p_numero), ''), v_fecha, auth.uid()) returning id into v_c;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into i from insumos where id = (x->>'insumo_id')::bigint for update;
    perform exigir(found, 'Uno de los artículos no existe.');
    v_cant := (x->>'cantidad')::numeric; v_monto := coalesce(nullif(x->>'total', '')::numeric, 0);
    perform exigir(v_cant > 0 and v_monto >= 0, format('Revisá cantidad y precio de %s.', i.nombre));
    v_cu := case when v_monto > 0 then v_monto / v_cant else i.costo end;
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, compra_id, usuario_id)
    values (i.id, 'compra', v_cant, round(v_cu, 4), jornada_actual(), v_c, auth.uid());
    update insumos set cantidad = cantidad + v_cant, costo = round(v_cu, 4),
      vence = coalesce(nullif(x->>'vence', '')::date, case when cantidad <= 0 then null else vence end),
      proveedor_id = coalesce(proveedor_id, v_prov)
    where id = i.id;
    v_tot := v_tot + case when v_monto > 0 then v_monto else v_cant * i.costo end;
    v_n := v_n + 1; v_nombre := i.nombre;
  end loop;
  update compras set total = round(v_tot, 2) where id = v_c;

  if v_tot > 0 then
    select plazo_dias into v_plazo from proveedores where id = v_prov;
    insert into gastos (fecha, concepto, categoria, monto, proveedor_id, estado, cuenta_id, pagado_el, vence, origen, compra_id, usuario_id)
    values (v_fecha,
            case when nullif(trim(p_numero), '') is not null then 'Factura ' || trim(p_numero)
                 when v_n = 1 then 'Compra: ' || v_nombre else format('Compra de %s artículos', v_n) end,
            'Mercadería', round(v_tot, 2), v_prov,
            case when v_cuenta is null then 'pendiente' else 'pagado' end, v_cuenta,
            case when v_cuenta is null then null else v_fecha end,
            case when v_cuenta is null then v_fecha + coalesce(v_plazo, 0) end, 'compra', v_c, auth.uid());
  end if;
  return jsonb_build_object('compra', v_c, 'total', round(v_tot, 2), 'articulos', v_n, 'proveedor', v_prov);
end $$;

create or replace function registrar_merma(p_insumo bigint, p_cantidad numeric, p_motivo text, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i insumos;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados registran mermas.');
  perform exigir(coalesce(p_cantidad, 0) > 0, 'Cargá la cantidad que se tiró.');
  select * into i from insumos where id = p_insumo for update;
  perform exigir(found, 'El artículo no existe.');
  insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, nota, jornada, usuario_id)
  values (p_insumo, 'merma', -p_cantidad, i.costo, coalesce(nullif(trim(p_motivo), ''), 'Otro'), nullif(trim(p_nota), ''), jornada_actual(), auth.uid());
  update insumos set cantidad = greatest(0, cantidad - p_cantidad) where id = p_insumo;
end $$;

-- Inventario: lo contado pasa a ser lo que hay; las diferencias quedan como movimiento de conteo
-- p_items: [{insumo_id, cantidad}] · p_completo = false para un conteo suelto de un artículo
create or replace function guardar_inventario(p_items jsonb, p_completo boolean default true, p_nota text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; x jsonb; i insumos; v_c numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cargan inventarios.');
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Cargá al menos un artículo contado.');
  insert into inventarios (completo, usuario_id, nota) values (coalesce(p_completo, true), auth.uid(), nullif(trim(p_nota), '')) returning id into v_id;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into i from insumos where id = (x->>'insumo_id')::bigint for update;
    perform exigir(found, 'Uno de los artículos no existe.');
    v_c := (x->>'cantidad')::numeric;
    perform exigir(v_c >= 0, format('La cantidad de %s no puede ser negativa.', i.nombre));
    insert into inventario_items (inventario_id, insumo_id, cantidad, sistema) values (v_id, i.id, v_c, i.cantidad);
    if v_c <> i.cantidad then
      insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, motivo, jornada, usuario_id)
      values (i.id, 'conteo', v_c - i.cantidad, i.costo, 'Diferencia de conteo', jornada_actual(), auth.uid());
      update insumos set cantidad = v_c where id = i.id;
    end if;
  end loop;
  return v_id;
end $$;

-- Bebidas por unidad: lo que entra y los ajustes a mano
create or replace function mover_stock_producto(p_producto bigint, p_cantidad numeric, p_tipo text default 'ingreso') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados ajustan el stock.');
  perform exigir(p_tipo in ('ingreso', 'conteo') and coalesce(p_cantidad, 0) <> 0, 'Movimiento no válido.');
  update productos set stock = greatest(0, stock + p_cantidad) where id = p_producto and controla_stock;
  perform exigir(found, 'Ese producto no controla stock por unidad.');
  insert into movimientos_stock (producto_id, tipo, cantidad, jornada, usuario_id) values (p_producto, p_tipo, p_cantidad, jornada_actual(), auth.uid());
end $$;

-- Reemplaza la receta completa de un plato. p_items: [{insumo_id, cantidad}]
create or replace function guardar_receta(p_producto bigint, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cambian recetas.');
  perform exigir(exists (select 1 from productos where id = p_producto), 'El plato no existe.');
  delete from receta_items where producto_id = p_producto;
  insert into receta_items (producto_id, insumo_id, cantidad, cocido)
  select p_producto, (x->>'insumo_id')::bigint, sum((x->>'cantidad')::numeric), bool_or(coalesce((x->>'cocido')::boolean, false))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
  where (x->>'cantidad')::numeric > 0 group by 2;
end $$;

-- ---------------------------------------------------------------------
-- Plata
-- ---------------------------------------------------------------------
create or replace function pagar_gasto(p_gasto bigint, p_cuenta bigint, p_fecha date default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados registran pagos.');
  perform exigir(exists (select 1 from cuentas where id = p_cuenta), 'Elegí de qué cuenta sale la plata.');
  update gastos set estado = 'pagado', cuenta_id = p_cuenta, pagado_el = coalesce(p_fecha, hoy_local())
  where id = p_gasto and estado = 'pendiente';
  perform exigir(found, 'Ese gasto ya estaba pagado.');
end $$;

-- Saldo de una cuenta: inicial + ventas cobradas con sus medios − gastos pagados desde ella ± transferencias y ajustes
create or replace function saldo_cuenta(p_cuenta bigint, p_hasta date default null) returns numeric
language sql stable security definer set search_path = public as $$
  with c as (select * from cuentas where id = p_cuenta), h as (select coalesce(p_hasta, '9999-12-31'::date) d)
  select (select saldo_inicial from c)
    + coalesce((select sum(t.total) from tickets t join medios_pago mp on mp.nombre = t.medio
                where mp.cuenta_id = p_cuenta and t.jornada >= (select desde from c) and t.jornada <= (select d from h)), 0)
    - coalesce((select sum(monto) from gastos where cuenta_id = p_cuenta and estado = 'pagado'
                and pagado_el >= (select desde from c) and pagado_el <= (select d from h)), 0)
    + coalesce((select sum(case when a_cuenta = p_cuenta then monto else -monto end) from movimientos_cuenta
                where (a_cuenta = p_cuenta or (tipo = 'transferencia' and de_cuenta = p_cuenta))
                and fecha >= (select desde from c) and fecha <= (select d from h)), 0)
$$;

create or replace function saldos_cuentas() returns table (id bigint, nombre text, tipo text, saldo numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre, c.tipo, saldo_cuenta(c.id) from cuentas c where es_gestion() and c.activa order by c.orden, c.nombre
$$;

-- >>> 20261029000003_tableros.sql
-- =====================================================================
-- Última Vuelta · Tableros, previsión de compras y control de stock
-- Todas devuelven jsonb listo para la pantalla y son solo para gestión.
-- Filtros (p_f): categoria, producto, mozo, medio, dow (0 = domingo), insumo, proveedor, gcat, cuenta.
-- =====================================================================

-- Tickets del período con los filtros de la pantalla. Si se filtra por plato, categoría, artículo
-- o proveedor, el total de cada ticket pasa a ser solo lo de esos ítems (con su descuento).
create or replace function tickets_filtrados(p_desde date, p_hasta date, p_f jsonb default '{}')
returns table (id bigint, jornada date, hora timestamptz, total numeric, comensales int, mozo_id uuid, mozo_nombre text,
               medio text, mesa_abierta timestamptz, min_cocina int[], min_barra int[], unidades bigint, costo numeric)
language sql stable security definer set search_path = public as $$
  with t as (
    select * from tickets t
    where t.jornada between p_desde and p_hasta
      and (p_f->>'mozo' is null or coalesce(t.mozo_id::text, 'sin') = p_f->>'mozo')
      and (p_f->>'medio' is null or t.medio = p_f->>'medio')
      and (p_f->>'dow' is null or extract(dow from t.jornada)::int = (p_f->>'dow')::int)
  ), it as (
    select ti.* from ticket_items ti join t on t.id = ti.ticket_id
    where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
      and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint)
      and (p_f->>'insumo' is null or exists (select 1 from receta_items r where r.producto_id = ti.producto_id and r.insumo_id = (p_f->>'insumo')::bigint))
      and (p_f->>'proveedor' is null or exists (select 1 from receta_items r join insumos i on i.id = r.insumo_id
                                                where r.producto_id = ti.producto_id and i.proveedor_id = (p_f->>'proveedor')::bigint))
  ), filtra_items as (
    select (p_f ?| array['categoria', 'producto', 'insumo', 'proveedor']) si
  )
  select t.id, t.jornada, t.hora,
         case when (select si from filtra_items) then round(sum(it.cantidad * it.precio) * (1 - t.descuento_pct / 100), 2) else t.total end,
         t.comensales, t.mozo_id, t.mozo_nombre, t.medio, t.mesa_abierta, t.min_cocina, t.min_barra,
         sum(it.cantidad), sum(it.cantidad * it.costo_unit)
  from t join it on it.ticket_id = t.id
  group by t.id, t.jornada, t.hora, t.total, t.descuento_pct, t.comensales, t.mozo_id, t.mozo_nombre, t.medio, t.mesa_abierta, t.min_cocina, t.min_barra
$$;

create or replace function hora_local(p_ts timestamptz) returns int
language sql stable set search_path = public as $$ select extract(hour from p_ts at time zone zona())::int $$;

-- Serie de ventas: por hora (un día), por día (hasta 62), por semana (hasta 200) o por mes
create or replace function serie_ventas(p_desde date, p_hasta date, p_f jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := p_hasta - p_desde + 1; v_corte int := coalesce(nullif(param('corte_jornada'), '')::int, 6);
begin
  if n = 1 then
    return jsonb_build_object('titulo', 'Ventas por hora', 'puntos', coalesce((
      with h as (select hora_local(hora) hh, sum(total) v from tickets_filtrados(p_desde, p_hasta, p_f) group by 1),
           r as (select min((hh - v_corte + 24) % 24) a, max((hh - v_corte + 24) % 24) b from h)
      select jsonb_agg(jsonb_build_object('l', lpad(((x + v_corte) % 24)::text, 2, '0') || 'h', 'v', coalesce(h.v, 0)) order by x)
      from r, generate_series(r.a, r.b) x left join h on (h.hh - v_corte + 24) % 24 = x), '[]'));
  elsif n <= 62 then
    return jsonb_build_object('titulo', 'Ventas por día', 'puntos', coalesce((
      with d as (select jornada, sum(total) v from tickets_filtrados(p_desde, p_hasta, p_f) group by 1)
      select jsonb_agg(jsonb_build_object('l', to_char(g, 'DD/MM'), 'v', coalesce(d.v, 0)) order by g)
      from generate_series(p_desde, p_hasta, interval '1 day') g left join d on d.jornada = g::date), '[]'));
  elsif n <= 200 then
    return jsonb_build_object('titulo', 'Ventas por semana', 'puntos', coalesce((
      with d as (select (jornada - p_desde) / 7 k, sum(total) v from tickets_filtrados(p_desde, p_hasta, p_f) group by 1)
      select jsonb_agg(jsonb_build_object('l', to_char(p_desde + k * 7, 'DD/MM'), 'v', coalesce(d.v, 0)) order by k)
      from generate_series(0, (n - 1) / 7) k left join d using (k)), '[]'));
  else
    return jsonb_build_object('titulo', 'Ventas por mes', 'puntos', coalesce((
      with d as (select date_trunc('month', jornada) m, sum(total) v from tickets_filtrados(p_desde, p_hasta, p_f) group by 1)
      select jsonb_agg(jsonb_build_object('l', to_char(g, 'MM/YY'), 'v', coalesce(d.v, 0)) order by g)
      from generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), interval '1 month') g left join d on d.m = g), '[]'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Ventas y servicio
-- ---------------------------------------------------------------------
create or replace function tablero_ventas(p_desde date, p_hasta date, p_f jsonb default '{}', p_comparar boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := p_hasta - p_desde + 1; pd date := p_desde - n; ph date := p_desde - 1; r jsonb;
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  p_f := jsonb_strip_nulls(coalesce(p_f, '{}'));
  with t as (select * from tickets_filtrados(p_desde, p_hasta, p_f)),
       tp as (select * from tickets_filtrados(pd, ph, p_f) where p_comparar),
       it as (select ti.*, t.jornada, t.hora from ticket_items ti join t on t.id = ti.ticket_id
              where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
                and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint)
                and (p_f->>'insumo' is null or exists (select 1 from receta_items x where x.producto_id = ti.producto_id and x.insumo_id = (p_f->>'insumo')::bigint))
                and (p_f->>'proveedor' is null or exists (select 1 from receta_items x join insumos i on i.id = x.insumo_id where x.producto_id = ti.producto_id and i.proveedor_id = (p_f->>'proveedor')::bigint))),
       itp as (select ti.nombre, sum(ti.cantidad) q from ticket_items ti join tp on tp.id = ti.ticket_id
              where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
                and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint) group by 1),
       mc as (select unnest(min_cocina) x from t), mb as (select unnest(min_barra) x from t)
  select jsonb_build_object(
    'kpi', (select jsonb_build_object(
        'ventas', coalesce(sum(total), 0), 'unidades', coalesce(sum(unidades), 0), 'mesas', count(*),
        'ticket_prom', case when count(*) > 0 then round(sum(total) / count(*)) end,
        'cubiertos', coalesce(sum(comensales), 0),
        'por_cubierto', case when sum(comensales) > 0 then round(sum(total) filter (where comensales > 0) / sum(comensales)) end,
        'permanencia', round(avg(extract(epoch from hora - mesa_abierta) / 60) filter (where mesa_abierta is not null and hora - mesa_abierta < interval '10 hours')),
        'cocina_prom', (select round(avg(x)) from mc), 'cocina_tarde', (select round(100.0 * count(*) filter (where x > split_part(param('alerta_cocina', '15,25'), ',', 2)::int) / nullif(count(*), 0)) from mc),
        'barra_prom',  (select round(avg(x)) from mb), 'barra_tarde',  (select round(100.0 * count(*) filter (where x > split_part(param('alerta_barra', '5,10'), ',', 2)::int) / nullif(count(*), 0)) from mb))
      from t),
    'prev', case when p_comparar then (select jsonb_build_object(
        'ventas', coalesce(sum(total), 0), 'unidades', coalesce(sum(unidades), 0), 'mesas', count(*),
        'ticket_prom', case when count(*) > 0 then round(sum(total) / count(*)) end,
        'por_cubierto', case when sum(comensales) > 0 then round(sum(total) filter (where comensales > 0) / sum(comensales)) end) from tp) end,
    'serie', serie_ventas(p_desde, p_hasta, p_f),
    'calor', (select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'h', h, 'v', v)), '[]') from
               (select extract(dow from jornada)::int d, hora_local(hora) h, sum(total) v from t group by 1, 2) z),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'v', round(v / dias))), '[]') from
               (select extract(dow from jornada)::int d, sum(total) v, count(distinct jornada) dias from t group by 1) z),
    'mozos', (select coalesce(jsonb_agg(jsonb_build_object('id', mozo_id, 'nombre', coalesce(nombre, 'Sin mozo'), 'mesas', nm, 'vendido', v, 'cubiertos', c) order by v desc), '[]') from
               (select mozo_id, max(mozo_nombre) nombre, count(*) nm, sum(total) v, sum(comensales) c from t group by mozo_id) z),
    'productos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'categoria', categoria, 'unidades', q, 'vendido', v,
                   'antes', (select q from itp where itp.nombre = z.nombre)) order by v desc), '[]') from
               (select nombre, max(categoria) categoria, sum(cantidad) q, sum(cantidad * precio) v from it group by nombre limit 60) z),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c, 'v', v) order by v desc), '[]') from
               (select coalesce(categoria, 'Otros') c, sum(cantidad * precio) v from it group by 1) z),
    'medios', (select coalesce(jsonb_agg(jsonb_build_object('nombre', medio, 'v', v) order by v desc), '[]') from
               (select medio, sum(total) v from t group by 1) z)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Costos y desperdicio
-- ---------------------------------------------------------------------
create or replace function insumo_pasa(p_insumo bigint, p_f jsonb) returns boolean
language sql stable set search_path = public as $$
  select (p_f->>'insumo' is null or p_insumo = (p_f->>'insumo')::bigint)
     and (p_f->>'proveedor' is null or exists (select 1 from insumos where id = p_insumo and proveedor_id = (p_f->>'proveedor')::bigint))
$$;

create or replace function tablero_costos(p_desde date, p_hasta date, p_f jsonb default '{}', p_comparar boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := p_hasta - p_desde + 1; pd date := p_desde - n; ph date := p_desde - 1; r jsonb; v_ins boolean;
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  p_f := jsonb_strip_nulls(coalesce(p_f, '{}'));
  v_ins := p_f ?| array['insumo', 'proveedor'];
  with t as (select * from tickets_filtrados(p_desde, p_hasta, p_f)),
       tp as (select * from tickets_filtrados(pd, ph, p_f) where p_comparar),
       -- con filtro de artículo o proveedor, el costo es solo el de esos artículos (lo que salió por las ventas)
       ci as (select m.ticket_id, sum(-m.cantidad * m.costo_unit) c from movimientos_stock m
              where v_ins and m.tipo = 'venta' and m.insumo_id is not null and insumo_pasa(m.insumo_id, p_f)
                and m.jornada between pd and p_hasta group by 1),
       ms as (select m.*, i.nombre, i.unidad from movimientos_stock m join insumos i on i.id = m.insumo_id
              where m.tipo = 'merma' and m.jornada between p_desde and p_hasta and insumo_pasa(m.insumo_id, p_f)),
       msp as (select m.* from movimientos_stock m where p_comparar and m.tipo = 'merma' and m.insumo_id is not null
               and m.jornada between pd and ph and insumo_pasa(m.insumo_id, p_f)),
       co as (select m.*, i.nombre from movimientos_stock m join insumos i on i.id = m.insumo_id
              where m.tipo = 'compra' and m.jornada between p_desde and p_hasta and insumo_pasa(m.insumo_id, p_f)),
       it as (select ti.* from ticket_items ti join t on t.id = ti.ticket_id
              where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
                and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint)
                and (not v_ins or exists (select 1 from receta_items x where x.producto_id = ti.producto_id and insumo_pasa(x.insumo_id, p_f)))),
       cambios as (select distinct on (insumo_id) nombre, costo_unit, ant from
                     (select m.insumo_id, i.nombre, m.costo_unit, m.jornada, m.hora,
                             lag(m.costo_unit) over (partition by m.insumo_id order by m.hora) ant
                      from movimientos_stock m join insumos i on i.id = m.insumo_id
                      where m.tipo = 'compra' and m.costo_unit > 0 and insumo_pasa(m.insumo_id, p_f)) z
                   where jornada between p_desde and p_hasta and ant > 0 order by insumo_id, hora desc)
  select jsonb_build_object(
    'kpi', jsonb_build_object(
      'ventas', (select coalesce(sum(total), 0) from t),
      'costo', round(case when v_ins then (select coalesce(sum(c), 0) from ci where ticket_id in (select id from t)) else (select coalesce(sum(costo), 0) from t) end, 2),
      'tirado', round((select coalesce(sum(-cantidad * costo_unit), 0) from ms), 2),
      'compras', round((select coalesce(sum(cantidad * costo_unit), 0) from co), 2),
      'n_compras', (select count(distinct compra_id) from co),
      'solo_articulos', v_ins),
    'prev', case when p_comparar then jsonb_build_object(
      'ventas', (select coalesce(sum(total), 0) from tp),
      'costo', round(case when v_ins then (select coalesce(sum(c), 0) from ci where ticket_id in (select id from tp)) else (select coalesce(sum(costo), 0) from tp) end, 2),
      'tirado', round((select coalesce(sum(-cantidad * costo_unit), 0) from msp), 2)) end,
    'platos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', z.nombre, 'cantidad', z.q, 'vendido', z.v, 'costo_hist', round(z.c, 2),
                 'precio', p.precio, 'costo_unit', round(costo_receta(p.id), 2), 'con_receta', exists (select 1 from receta_items where producto_id = p.id))
                 order by z.v - z.c desc), '[]') from
               (select producto_id, max(nombre) nombre, sum(cantidad) q, sum(cantidad * precio) v, sum(cantidad * costo_unit) c from it group by producto_id) z
               join productos p on p.id = z.producto_id),
    'mermas_motivo', (select coalesce(jsonb_agg(jsonb_build_object('nombre', motivo, 'v', v) order by v desc), '[]') from
               (select coalesce(motivo, 'Otro') motivo, round(sum(-cantidad * costo_unit), 2) v from ms group by 1) z),
    'mermas_articulo', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'v', v, 'cantidad', q, 'unidad', unidad) order by v desc), '[]') from
               (select nombre, unidad, round(sum(-cantidad * costo_unit), 2) v, sum(-cantidad) q from ms group by 1, 2) z),
    'cambios_precio', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'cambio', round(costo_unit / ant - 1, 4)) order by costo_unit / ant desc), '[]')
               from cambios where abs(costo_unit / ant - 1) > 0.02),
    'plato', case when p_f->>'producto' is not null then (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'precio', p.precio, 'costo', costo_receta(p.id),
               'receta', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'unidad', i.unidad, 'cantidad', x.cantidad, 'cocido', x.cocido,
                            'bruto', crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion), 'costo', crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion) * i.costo)
                            order by crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion) * i.costo desc), '[]')
                          from receta_items x join insumos i on i.id = x.insumo_id where x.producto_id = p.id))
               from productos p where p.id = (p_f->>'producto')::bigint) end,
    'articulo', case when p_f->>'insumo' is not null then (select jsonb_build_object('id', i.id, 'nombre', i.nombre, 'unidad', i.unidad, 'costo', i.costo, 'hay', i.cantidad,
               'usado', (select coalesce(sum(-cantidad), 0) from movimientos_stock where insumo_id = i.id and tipo = 'venta' and jornada between p_desde and p_hasta),
               'comprado', (select coalesce(sum(cantidad), 0) from co where insumo_id = i.id),
               'tirado', (select coalesce(sum(-cantidad), 0) from ms where insumo_id = i.id),
               'precios', (select coalesce(jsonb_agg(jsonb_build_object('l', to_char(jornada, 'DD/MM'), 'v', round(costo_unit)) order by hora), '[]') from
                            (select jornada, hora, costo_unit from movimientos_stock where insumo_id = i.id and tipo = 'compra' and costo_unit > 0 order by hora desc limit 24) z),
               'platos', (select coalesce(jsonb_agg(p.nombre order by p.nombre), '[]') from receta_items x join productos p on p.id = x.producto_id where x.insumo_id = i.id))
               from insumos i where i.id = (p_f->>'insumo')::bigint) end
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Finanzas
-- ---------------------------------------------------------------------
create or replace function tablero_finanzas(p_desde date, p_hasta date, p_f jsonb default '{}', p_comparar boolean default true) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n int := p_hasta - p_desde + 1; pd date := p_desde - n; ph date := p_desde - 1; r jsonb; v_hoy date := hoy_local();
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  p_f := jsonb_strip_nulls(coalesce(p_f, '{}'));
  with v as (select t.jornada f, t.medio, t.total from tickets t join medios_pago mp on mp.nombre = t.medio
             where t.jornada between pd and p_hasta and (p_f->>'cuenta' is null or mp.cuenta_id = (p_f->>'cuenta')::bigint)),
       g as (select g.*, p.nombre prov from gastos g left join proveedores p on p.id = g.proveedor_id
             where g.fecha between pd and p_hasta
               and (p_f->>'gcat' is null or g.categoria = p_f->>'gcat')
               and (p_f->>'proveedor' is null or g.proveedor_id = (p_f->>'proveedor')::bigint)
               and (p_f->>'cuenta' is null or g.cuenta_id = (p_f->>'cuenta')::bigint)),
       pend as (select g.*, p.nombre prov from gastos g left join proveedores p on p.id = g.proveedor_id where g.estado = 'pendiente'
               and (p_f->>'gcat' is null or g.categoria = p_f->>'gcat') and (p_f->>'proveedor' is null or g.proveedor_id = (p_f->>'proveedor')::bigint)),
       serie as (
         select case when n <= 45 then to_char(x, 'DD') else to_char(x, 'MM/YY') end l, x d, case when n <= 45 then x else (x + interval '1 month' - interval '1 day')::date end h
         from generate_series(case when n <= 45 then p_desde else date_trunc('month', p_desde)::date end, p_hasta,
                              case when n <= 45 then interval '1 day' else interval '1 month' end) x)
  select jsonb_build_object(
    'solo_gastos', p_f ?| array['gcat', 'proveedor'],
    'kpi', jsonb_build_object('ventas', (select coalesce(sum(total), 0) from v where f between p_desde and p_hasta),
                              'gastos', (select coalesce(sum(monto), 0) from g where fecha between p_desde and p_hasta)),
    'prev', case when p_comparar then jsonb_build_object('ventas', (select coalesce(sum(total), 0) from v where f between pd and ph),
                              'gastos', (select coalesce(sum(monto), 0) from g where fecha between pd and ph)) end,
    'serie', (select jsonb_build_object('por', case when n <= 45 then 'dia' else 'mes' end,
               'puntos', coalesce(jsonb_agg(jsonb_build_object('l', s.l,
                 'ventas', (select coalesce(sum(total), 0) from v where f between greatest(s.d, p_desde) and least(s.h, p_hasta)),
                 'gastos', (select coalesce(sum(monto), 0) from g where fecha between greatest(s.d, p_desde) and least(s.h, p_hasta))) order by s.d), '[]'))
              from serie s),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c, 'periodo', a, 'anterior', b) order by a desc, b desc), '[]') from
               (select categoria c, sum(monto) filter (where fecha >= p_desde) a, coalesce(sum(monto) filter (where fecha <= ph), 0) b
                from g group by 1) z where coalesce(a, 0) > 0 or (p_comparar and b > 0)),
    'detalle', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha, 'concepto', concepto, 'categoria', categoria, 'proveedor', prov,
                 'estado', estado, 'vence', vence, 'cuenta', (select nombre from cuentas where id = z.cuenta_id), 'monto', monto) order by fecha desc, id desc), '[]')
               from (select * from g where fecha between p_desde and p_hasta order by fecha desc, id desc limit 150) z),
    'medios', (select coalesce(jsonb_agg(jsonb_build_object('nombre', medio, 'cuenta', (select c.nombre from medios_pago mp join cuentas c on c.id = mp.cuenta_id where mp.nombre = z.medio), 'v', s) order by s desc), '[]')
               from (select medio, sum(total) s from v where f between p_desde and p_hasta group by 1) z),
    'proximos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'concepto', concepto, 'proveedor', prov, 'categoria', categoria, 'vence', vence, 'monto', monto) order by vence nulls first), '[]')
               from (select * from pend order by vence nulls first limit 15) z),
    'disponible', case when p_f->>'cuenta' is not null then saldo_cuenta((p_f->>'cuenta')::bigint) else (select coalesce(sum(saldo_cuenta(id)), 0) from cuentas where activa) end,
    'a_pagar', (select coalesce(sum(monto), 0) from pend),
    'vencidos', (select count(*) from pend where vence < v_hoy),
    'a_pagar_30', (select coalesce(sum(monto), 0) from pend where vence is null or vence <= v_hoy + 30)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Control semanal: lo que se tendría que haber usado contra lo que salió entre dos inventarios
-- ---------------------------------------------------------------------
create or replace function control_inventario(p_desde bigint, p_hasta bigint)
returns table (insumo_id bigint, nombre text, unidad text, inicial numeric, final numeric, entro numeric,
               teorico numeric, mermas numeric, usado numeric, sin_explicar numeric, plata numeric, costo numeric)
language sql stable security definer set search_path = public as $$
  with a as (select * from inventarios where id = p_desde), b as (select * from inventarios where id = p_hasta),
  ia as (select * from inventario_items where inventario_id = p_desde), ib as (select * from inventario_items where inventario_id = p_hasta),
  mv as (select m.insumo_id,
           sum(m.cantidad) filter (where m.tipo in ('compra', 'ingreso')) entro,
           sum(-m.cantidad) filter (where m.tipo = 'venta') teorico,
           sum(-m.cantidad) filter (where m.tipo = 'merma') mermas
         from movimientos_stock m where m.insumo_id is not null
           and m.hora > (select fecha from a) and m.hora <= (select fecha from b) group by 1)
  select i.id, i.nombre, i.unidad, ia.cantidad, ib.cantidad, coalesce(mv.entro, 0), coalesce(mv.teorico, 0), coalesce(mv.mermas, 0),
         ia.cantidad + coalesce(mv.entro, 0) - ib.cantidad,
         ia.cantidad + coalesce(mv.entro, 0) - ib.cantidad - coalesce(mv.teorico, 0) - coalesce(mv.mermas, 0),
         round((ia.cantidad + coalesce(mv.entro, 0) - ib.cantidad - coalesce(mv.teorico, 0) - coalesce(mv.mermas, 0)) * i.costo, 2), i.costo
  from ia join ib using (insumo_id) join insumos i on i.id = ia.insumo_id left join mv on mv.insumo_id = i.id
  where es_gestion() and (select fecha from a) < (select fecha from b)
  order by abs((ia.cantidad + coalesce(mv.entro, 0) - ib.cantidad - coalesce(mv.teorico, 0) - coalesce(mv.mermas, 0)) * i.costo) desc
$$;

-- ---------------------------------------------------------------------
-- Previsión: lo que se suele vender cada día de la semana (últimas 4 iguales) y lo que eso usa de cada artículo
-- ---------------------------------------------------------------------
create or replace function porciones_esperadas(p_fecha date) returns table (producto_id bigint, cantidad numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_dias date[]; v_dow int := extract(dow from p_fecha)::int;
begin
  if v_dow::text = any (string_to_array(replace(param('dias_cerrado', ''), ' ', ''), ',')) then return; end if;
  select array_agg(jornada order by jornada desc) into v_dias from
    (select distinct jornada from tickets where jornada < jornada_actual() and jornada >= jornada_actual() - 70
     and extract(dow from jornada)::int = v_dow order by jornada desc limit 4) z;
  if v_dias is null then
    select array_agg(jornada) into v_dias from
      (select distinct jornada from tickets where jornada < jornada_actual() order by jornada desc limit 14) z;
  end if;
  if v_dias is null then return; end if;
  return query
    select ti.producto_id, sum(ti.cantidad)::numeric / array_length(v_dias, 1)
    from ticket_items ti join tickets t on t.id = ti.ticket_id
    where t.jornada = any (v_dias) and ti.producto_id is not null group by ti.producto_id;
end $$;

create or replace function prevision() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_hoy date := jornada_actual(); v_n int := greatest(1, coalesce(nullif(param('cobertura_dias'), '')::int, 3)); r jsonb;
begin
  perform exigir(es_gestion(), 'La previsión es para dueños y encargados.');
  with hoy as (select * from porciones_esperadas(v_hoy)),
       prox as (select pe.* from generate_series(0, v_n - 1) k, lateral porciones_esperadas(v_hoy + k) pe),
       uso_hoy as (select x.insumo_id, sum(h.cantidad * crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion)) u from hoy h
                   join receta_items x on x.producto_id = h.producto_id join insumos i on i.id = x.insumo_id group by 1),
       uso as (select x.insumo_id, sum(p.cantidad * crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion)) u from prox p
               join receta_items x on x.producto_id = p.producto_id join insumos i on i.id = x.insumo_id group by 1)
  select jsonb_build_object(
    'historial', exists (select 1 from tickets where jornada < v_hoy),
    'dias', v_n,
    'cerrado_hoy', extract(dow from v_hoy)::int::text = any (string_to_array(replace(param('dias_cerrado', ''), ' ', ''), ',')),
    'dow', extract(dow from v_hoy)::int,
    'platos_hoy', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'estacion', p.estacion, 'cantidad', round(h.cantidad, 1)) order by h.cantidad desc), '[]')
                   from hoy h join productos p on p.id = h.producto_id),
    'insumos_hoy', (select coalesce(jsonb_agg(jsonb_build_object('id', insumo_id, 'uso', round(u, 3)) order by u desc), '[]') from uso_hoy),
    'insumos', (select coalesce(jsonb_object_agg(insumo_id::text, round(u, 3)), '{}') from uso)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Resumen del dueño
-- ---------------------------------------------------------------------
create or replace function tablero_resumen() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_j date := jornada_actual(); v_hoy date := hoy_local(); v_mes date := date_trunc('month', v_j)::date; r jsonb;
        v_inv bigint[]; v_obj numeric := coalesce(nullif(param('costo_objetivo'), '')::numeric, 35);
begin
  perform exigir(es_gestion(), 'El resumen es para dueños y encargados.');
  select array_agg(id order by fecha desc) into v_inv from (select id, fecha from inventarios where completo order by fecha desc limit 2) z;
  with hoy as (select * from tickets where jornada = v_j),
       pasado as (select * from tickets where jornada = v_j - 7 and hora <= now() - interval '7 days'),
       abiertas as (select m.*, (select coalesce(sum(i.cantidad * i.precio), 0) from pedido_items i join pedidos p on p.id = i.pedido_id
                                 where p.mesa_id = m.id and p.ticket_id is null and p.confirmado) consumo from mesas m where m.estado <> 'libre'),
       mes as (select * from tickets where jornada >= v_mes and jornada <= v_j),
       mes_ant as (select * from tickets where jornada >= (v_mes - interval '1 month')::date and jornada <= (v_j - interval '1 month')::date),
       alertas as (
         select 0 o, 'crit' nivel, 'Vencido' etiqueta, format('Pagar %s · %s', concepto, to_char(monto, 'FM999G999G999')) texto, '/admin/gastos' ir from gastos where estado = 'pendiente' and vence < v_hoy
         union all select 1, case when vence <= v_hoy then 'crit' else 'warn' end, case when vence < v_hoy then 'Vencido' when vence = v_hoy then 'Vence hoy' else 'Por vencer' end,
                          format('%s: usalo primero o registralo como merma', nombre), '/stock/articulos' from insumos where activo and vence is not null and vence <= v_hoy + 2 and cantidad > 0
         union all select 2, 'warn', 'Reponer', format('%s: quedan %s %s', nombre, trim(to_char(cantidad, 'FM999G990D99')), unidad), '/stock/compras' from insumos where activo and minimo > 0 and cantidad <= minimo
         union all select 2, 'warn', 'Reponer', format('%s: quedan %s', nombre, trim(to_char(stock, 'FM999G990'))), '/stock/articulos' from productos where activo and controla_stock and stock <= stock_min
         union all select 3, 'warn', 'Costo alto', format('%s: %s %% del precio', nombre, round(100 * costo_receta(id) / precio)), '/stock/recetas'
                   from productos where activo and precio > 0 and costo_receta(id) / precio * 100 > v_obj
         union all select 4, 'warn', 'Suba', format('%s subió %s %%', nombre, round(100 * (costo_unit / ant - 1))), '/tableros/costos' from
                   (select distinct on (m.insumo_id) i.nombre, m.costo_unit, lag(m.costo_unit) over (partition by m.insumo_id order by m.hora) ant, m.jornada, m.hora
                    from movimientos_stock m join insumos i on i.id = m.insumo_id where m.tipo = 'compra' and m.costo_unit > 0
                    order by m.insumo_id, m.hora desc) z where jornada >= v_j - 30 and ant > 0 and costo_unit / ant > 1.05
         union all select 5, case when s > 50000 then 'crit' else 'warn' end, 'Control', format('%s sin explicar en el último control', to_char(s, 'FM$999G999G999')), '/stock/control'
                   from (select sum(plata) filter (where plata > 0) s from control_inventario(v_inv[2], v_inv[1]) where v_inv[2] is not null) z where s > 0
         union all select 6, 'warn', 'Caja', 'La caja de anoche quedó sin cerrar', '/caja'
                   from jornadas where fecha = v_j - 1 and apertura is not null and cerrada_en is null)
  select jsonb_build_object(
    'jornada', v_j,
    'hoy', jsonb_build_object(
      'vendido', (select coalesce(sum(total), 0) from hoy), 'mesas', (select count(*) from hoy),
      'pasado', (select coalesce(sum(total), 0) from pasado), 'hay_pasado', exists (select 1 from tickets where jornada = v_j - 7),
      'abiertas', (select count(*) from abiertas), 'en_mesas', (select coalesce(sum(consumo), 0) from abiertas),
      'cubiertos', (select coalesce(sum(comensales), 0) from hoy) + (select coalesce(sum(comensales), 0) from abiertas),
      'ticket_prom', (select round(avg(total)) from hoy)),
    'mes', jsonb_build_object(
      'ventas', (select coalesce(sum(total), 0) from mes), 'ventas_ant', (select coalesce(sum(total), 0) from mes_ant),
      'gastos', (select coalesce(sum(monto), 0) from gastos where fecha >= v_mes and fecha <= v_hoy),
      'costo', (select coalesce(sum(costo), 0) from mes)),
    'plata', jsonb_build_object(
      'cuentas', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'saldo', saldo)), '[]') from saldos_cuentas()),
      'deudas', (select coalesce(sum(monto), 0) from gastos where estado = 'pendiente'),
      'vencido', (select coalesce(sum(monto), 0) from gastos where estado = 'pendiente' and vence < v_hoy)),
    'alertas', (select coalesce(jsonb_agg(jsonb_build_object('nivel', nivel, 'etiqueta', etiqueta, 'texto', texto, 'ir', ir) order by o), '[]') from alertas),
    'ultimas', (select coalesce(jsonb_agg(jsonb_build_object('l', to_char(g, 'TMDy DD'), 'v', coalesce(v, 0)) order by g), '[]')
                from generate_series(v_j - 13, v_j, interval '1 day') g
                left join (select jornada, sum(total) v from tickets where jornada >= v_j - 13 group by 1) z on z.jornada = g::date)
  ) into r;
  return r;
end $$;

-- >>> 20261029000004_qr_y_ayudante.sql
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

  -- Con 3 o más pruebas, si lo medido se aleja de lo cargado en el artículo
  select string_agg(nombre, ', '), count(*) into t, n from (
    select i.nombre from insumos i, lateral (select avg(1 - limpio / crudo) * 100 m, count(*) c
      from (select * from rendimientos r where r.insumo_id = i.id order by fecha desc limit 5) u) z
    where i.activo and z.c >= 3 and abs(z.m - i.merma_pct) >= 2 order by i.nombre limit 3) y;
  if n > 0 then return next jsonb_build_object('tema', 'rendimiento-medido', 'clave', 'medido-' || t, 'prioridad', 3, 'titulo', 'Rendimiento medido',
    'texto', format('Las pruebas de %s dan una merma distinta a la cargada. Usá lo medido así los costos y las compras son reales.', t),
    'boton', 'Ver rendimientos', 'ir', '/stock/rendimientos'); end if;
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

-- >>> 20261112000005_referencias.sql
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

-- >>> 20261112000006_reservas.sql
-- =====================================================================
-- Última Vuelta · Reservas
--   El cliente reserva desde una página pública (/reservar): elige día, horario y cuántos son.
--   La reserva entra "pendiente" y el encargado la confirma (con un WhatsApp armado desde la app).
--   Las reservas por teléfono o en el local las carga el encargado directo.
--   Al llegar, el mozo la sienta en una mesa: se abre la mesa con esos comensales.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

create type estado_reserva as enum ('pendiente', 'confirmada', 'sentada', 'cancelada', 'no_vino');

create table reservas (
  id          bigint generated always as identity primary key,
  -- Con este código el cliente ve y cancela su reserva (/reserva/<código>)
  codigo      text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  nombre      text not null check (length(trim(nombre)) between 2 and 60),
  telefono    text not null check (telefono ~ '^[0-9]{8,15}$'),
  personas    int not null check (personas between 1 and 60),
  fecha       date not null,                 -- la noche (jornada) de la reserva
  hora        time not null,                 -- después de medianoche = madrugada de esa misma noche
  nota        text check (length(nota) <= 200),
  estado      estado_reserva not null default 'pendiente',
  origen      text not null default 'web' check (origen in ('web', 'telefono', 'local')),
  mesa_id     bigint references mesas(id) on delete set null,
  creado      timestamptz not null default now(),
  creado_por  uuid references perfiles(id) on delete set null,
  atendido    timestamptz,                   -- cuándo se confirmó, sentó o canceló
  cancelada_por text check (cancelada_por in ('cliente', 'local'))
);
create index reservas_fecha on reservas (fecha, hora);
create index reservas_telefono on reservas (telefono, fecha);

alter table reservas enable row level security;
-- Los mozos ven las reservas (para sentarlas); gestión las carga y las cambia
create policy reservas_leer    on reservas for select using ((select es_salon()));
create policy reservas_gestion on reservas for all using ((select es_gestion())) with check ((select es_gestion()));
revoke all on reservas from anon;
grant select, insert, update, delete on reservas to authenticated;

alter publication supabase_realtime add table reservas;

insert into parametros (clave, valor, descripcion) values
  ('reservas_activas',   'si', 'Reservas por la página pública: si o no'),
  ('reservas_horarios',  '20:30,21:00,21:30,22:00,22:30,23:00', 'Horarios que se pueden reservar, separados por coma'),
  ('reservas_cupo',      '30', 'Personas que se pueden reservar por horario (el resto queda para los que llegan sin reserva)'),
  ('reservas_max',       '10', 'Más personas que esto, la página pide que llamen'),
  ('reservas_dias',      '30', 'Con cuántos días de anticipación se puede reservar'),
  ('reservas_min_horas', '2', 'Hasta cuántas horas antes se puede reservar por la página'),
  ('reservas_telefono',  '', 'Teléfono o WhatsApp del local para grupos grandes y consultas (con código de área, sin 0 ni 15)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
-- El momento real de una reserva: las de madrugada (antes de la hora de corte) son del día siguiente
create or replace function reserva_momento(p_fecha date, p_hora time) returns timestamptz
language sql stable set search_path = public as $$
  select ((p_fecha + p_hora + case when extract(hour from p_hora) < coalesce(nullif(param('corte_jornada'), '')::int, 6)
                                   then interval '1 day' else interval '0' end) at time zone zona())
$$;

create or replace function horarios_reserva() returns time[]
language sql stable set search_path = public as $$
  -- ordenados como pasa la noche: 20:30 … 23:30, 00:00, 00:30
  select coalesce(array_agg(t order by extract(hour from t) < coalesce(nullif(param('corte_jornada'), '')::int, 6), t), '{}')
  from (select distinct trim(h)::time t from unnest(string_to_array(param('reservas_horarios', ''), ',')) h
        where trim(h) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$') z
$$;

-- Personas ya reservadas en un horario (lo cancelado y los que no vinieron no cuentan)
create or replace function reservados(p_fecha date, p_hora time) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(personas), 0)::int from reservas where fecha = p_fecha and hora = p_hora and estado in ('pendiente', 'confirmada', 'sentada')
$$;

create or replace function dia_cerrado(p_fecha date) returns boolean
language sql stable set search_path = public as $$
  select extract(dow from p_fecha)::text = any (string_to_array(replace(param('dias_cerrado', ''), ' ', ''), ','))
$$;

-- ---------------------------------------------------------------------
-- Página pública: lo que puede usar alguien sin usuario
-- ---------------------------------------------------------------------
create or replace function reservas_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'activas', param('reservas_activas', 'si') = 'si',
    'local', param('nombre_local', ''), 'bajada', param('bajada_local', ''),
    'telefono', param('reservas_telefono', ''),
    'max', coalesce(nullif(param('reservas_max'), '')::int, 10),
    'dias', coalesce(nullif(param('reservas_dias'), '')::int, 30),
    'hoy', jornada_actual(),
    'cerrado', (select coalesce(jsonb_agg(d::int), '[]') from unnest(string_to_array(replace(param('dias_cerrado', ''), ' ', ''), ',')) d where d ~ '^[0-6]$'))
$$;

-- Los horarios de una noche y cuántos lugares quedan en cada uno
create or replace function reservas_disponibles(p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cupo int := coalesce(nullif(param('reservas_cupo'), '')::int, 30);
        v_min interval := make_interval(hours => coalesce(nullif(param('reservas_min_horas'), '')::int, 2));
begin
  if p_fecha is null or p_fecha < jornada_actual() or p_fecha > jornada_actual() + coalesce(nullif(param('reservas_dias'), '')::int, 30)
     or dia_cerrado(p_fecha) then return '[]'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('hora', to_char(h, 'HH24:MI'),
            'libres', case when reserva_momento(p_fecha, h) < now() + v_min then 0 else greatest(v_cupo - reservados(p_fecha, h), 0) end) order by o), '[]')
          from unnest(horarios_reserva()) with ordinality as x(h, o));
end $$;

create or replace function pedir_reserva(p_nombre text, p_telefono text, p_personas int, p_fecha date, p_hora text, p_nota text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
        v_hora time; v_max int := coalesce(nullif(param('reservas_max'), '')::int, 10);
        v_cupo int := coalesce(nullif(param('reservas_cupo'), '')::int, 30); v_cod text;
        v_llamar text := case when param('reservas_telefono', '') <> '' then ' Escribinos al ' || param('reservas_telefono') || '.' else '' end;
begin
  perform exigir(param('reservas_activas', 'si') = 'si', 'Por ahora no tomamos reservas por acá.' || v_llamar);
  perform exigir(length(trim(coalesce(p_nombre, ''))) between 2 and 60, 'Poné tu nombre.');
  perform exigir(length(v_tel) between 8 and 15, 'Revisá el teléfono: con código de área, sin el 0 ni el 15 (por ejemplo 2974123456).');
  perform exigir(p_personas between 1 and v_max, format('Para más de %s personas, escribinos y lo armamos.%s', v_max, v_llamar));
  perform exigir(length(coalesce(p_nota, '')) <= 200, 'La aclaración es muy larga.');
  perform exigir(p_fecha between jornada_actual() and jornada_actual() + coalesce(nullif(param('reservas_dias'), '')::int, 30), 'Elegí otra fecha.');
  perform exigir(not dia_cerrado(p_fecha), 'Ese día no abrimos.');
  begin v_hora := p_hora::time; exception when others then v_hora := null; end;
  perform exigir(v_hora = any (horarios_reserva()), 'Elegí uno de los horarios.');
  perform exigir(reserva_momento(p_fecha, v_hora) >= now() + make_interval(hours => coalesce(nullif(param('reservas_min_horas'), '')::int, 2)),
                 'Ese horario ya no se puede reservar por acá.' || v_llamar);
  -- Una reserva por teléfono y por noche, y freno a pedidos en masa
  perform exigir(not exists (select 1 from reservas where telefono = v_tel and fecha = p_fecha and estado in ('pendiente', 'confirmada')),
                 'Ya tenés una reserva para esa noche. Si querés cambiarla, cancelala desde su link y hacé otra.');
  perform exigir((select count(*) from reservas where telefono = v_tel and estado in ('pendiente', 'confirmada') and fecha >= jornada_actual()) < 3,
                 'Ya tenés varias reservas hechas.' || v_llamar);
  perform exigir((select count(*) from reservas where origen = 'web' and creado > now() - interval '10 minutes') < 20,
                 'Estamos recibiendo muchas reservas. Probá de nuevo en unos minutos.');
  -- Que dos personas no se queden con el último lugar a la vez
  perform pg_advisory_xact_lock(hashtext('reserva ' || p_fecha || ' ' || v_hora));
  perform exigir(reservados(p_fecha, v_hora) + p_personas <= v_cupo,
                 'No quedan lugares para ese horario. Probá con otro.' || v_llamar);
  insert into reservas (nombre, telefono, personas, fecha, hora, nota, origen)
  values (trim(p_nombre), v_tel, p_personas, p_fecha, v_hora, nullif(trim(coalesce(p_nota, '')), ''), 'web')
  returning codigo into v_cod;
  return v_cod;
end $$;

create or replace function ver_reserva(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', nombre, 'personas', personas, 'fecha', fecha, 'hora', to_char(hora, 'HH24:MI'), 'nota', nota,
           'estado', estado, 'pasada', reserva_momento(fecha, hora) < now(),
           'local', param('nombre_local', ''), 'bajada', param('bajada_local', ''), 'telefono', param('reservas_telefono', ''))
  from reservas where codigo = p_codigo and length(p_codigo) >= 10
$$;

create or replace function cancelar_reserva(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservas;
begin
  select * into r from reservas where codigo = p_codigo and length(p_codigo) >= 10 for update;
  perform exigir(found, 'No encontramos la reserva.');
  perform exigir(r.estado in ('pendiente', 'confirmada'), 'Esta reserva ya no se puede cancelar.');
  perform exigir(reserva_momento(r.fecha, r.hora) > now(), 'La reserva ya pasó.');
  update reservas set estado = 'cancelada', cancelada_por = 'cliente', atendido = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- En el local
-- ---------------------------------------------------------------------
-- Llegó el cliente: se abre la mesa con esos comensales y la reserva queda sentada
create or replace function sentar_reserva(p_reserva bigint, p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r reservas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede sentar reservas.');
  select * into r from reservas where id = p_reserva for update;
  perform exigir(found, 'La reserva no existe.');
  perform exigir(r.estado in ('pendiente', 'confirmada'), 'Esta reserva ya fue sentada o cancelada.');
  perform abrir_mesa(p_mesa, r.personas);
  update reservas set estado = 'sentada', mesa_id = p_mesa, atendido = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------------
-- Chichito: reservas por confirmar (gestión) y las que llegan pronto (salón)
-- Se agregan a las sugerencias de 0004 sin tocarlas.
-- ---------------------------------------------------------------------
create or replace function sugerencias_reservas() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rol rol_usuario := mi_rol(); n int; t text; k text;
begin
  if v_rol is null or v_rol not in ('admin', 'encargado', 'mozo') then return; end if;
  select string_agg(format('%s (%s) %s', nombre, personas, to_char(hora, 'HH24:MI')), ', ' order by hora), string_agg(id::text, '-'), count(*)
    into t, k, n from reservas
    where estado in ('pendiente', 'confirmada') and reserva_momento(fecha, hora) between now() - interval '30 minutes' and now() + interval '45 minutes';
  if n > 0 then return next jsonb_build_object('tema', 'reserva-llega', 'clave', 'llega-' || k, 'prioridad', 1, 'posponer', 'nada',
    'titulo', case when n = 1 then 'Llega una reserva' else 'Llegan reservas' end,
    'texto', format('Está por llegar: %s. Cuando lleguen, sentalos desde Reservas así la mesa se abre sola.', t),
    'boton', 'Ver reservas', 'ir', '/reservas'); end if;
  if v_rol = 'mozo' then return; end if;
  select count(*) into n from reservas where estado = 'pendiente' and reserva_momento(fecha, hora) > now();
  if n > 0 then return next jsonb_build_object('tema', 'reservas-pendientes', 'clave', 'reservas-' || n, 'prioridad', 1,
    'titulo', 'Reservas por confirmar',
    'texto', format(case when n = 1 then 'Entró una reserva por la página. Confirmala así el cliente sabe que lo esperamos.'
                         else 'Entraron %s reservas por la página. Confirmalas así los clientes saben que los esperamos.' end, n),
    'boton', 'Ver reservas', 'ir', '/reservas'); end if;
end $$;

-- Las sugerencias que ya existían más las de reservas
alter function sugerencias_ayudante(text) rename to sugerencias_base;
create or replace function sugerencias_ayudante(p_area text default null) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select * from sugerencias_reservas() union all select * from sugerencias_base(p_area)
$$;

-- Lo que Chichito sabe para responder: se suman las reservas de hoy y de los próximos días
alter function contexto_ayudante() rename to contexto_base;
create or replace function contexto_ayudante() returns text
language plpgsql stable security definer set search_path = public as $$
declare s text := contexto_base(); v_j date := jornada_actual();
begin
  if s is null then return null; end if;
  return s || E'\nReservas de hoy: ' || coalesce((select string_agg(format('%s %s (%s personas, %s)', to_char(hora, 'HH24:MI'), nombre, personas, estado), '; ' order by hora)
              from reservas where fecha = v_j and estado <> 'cancelada'), 'ninguna')
           || E'\nReservas próximos 7 días: ' || coalesce((select string_agg(format('%s: %s reservas, %s personas', to_char(fecha, 'TMDy DD/MM'), n, p), '; ' order by fecha)
              from (select fecha, count(*) n, sum(personas) p from reservas where fecha > v_j and fecha <= v_j + 7 and estado in ('pendiente', 'confirmada') group by 1) z), 'ninguna') || '.';
end $$;

-- ---------------------------------------------------------------------
-- Permisos de las funciones nuevas
-- ---------------------------------------------------------------------
revoke execute on function reserva_momento(date, time), horarios_reserva(), reservados(date, time), dia_cerrado(date),
  reservas_info(), reservas_disponibles(date), pedir_reserva(text, text, int, date, text, text), ver_reserva(text), cancelar_reserva(text),
  sentar_reserva(bigint, bigint), sugerencias_reservas(), sugerencias_base(text), sugerencias_ayudante(text), contexto_base(), contexto_ayudante()
  from public, anon;
grant execute on function reserva_momento(date, time), horarios_reserva(), reservados(date, time), dia_cerrado(date),
  reservas_info(), reservas_disponibles(date), ver_reserva(text), sentar_reserva(bigint, bigint),
  sugerencias_ayudante(text), contexto_ayudante() to authenticated, service_role;
grant execute on function sugerencias_reservas(), sugerencias_base(text), contexto_base() to service_role;
-- La página pública de reservas (sin usuario)
grant execute on function reservas_info(), reservas_disponibles(date), pedir_reserva(text, text, int, date, text, text),
  ver_reserva(text), cancelar_reserva(text) to anon, authenticated;

-- >>> 20261112000007_facturacion.sql
-- =====================================================================
-- Última Vuelta · Facturación electrónica con ARCA (monotributo: Factura C)
--   La app se conecta directo a los web services de ARCA (WSAA para entrar, WSFE para facturar)
--   desde la función "arca" de Supabase. Acá están los datos del emisor, las facturas y
--   lo que necesita la función (clave privada y ticket de acceso), que nadie más puede leer.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

-- Datos del emisor y estado de la conexión (una sola fila)
create table facturacion (
  id                 int primary key default 1 check (id = 1),
  cuit               text check (cuit ~ '^[0-9]{11}$'),
  razon_social       text,                    -- el titular del monotributo, como figura en ARCA
  nombre_fantasia    text,
  domicilio          text,                    -- domicilio comercial
  iibb               text,                    -- ingresos brutos (número o "Exento" / "Convenio Multilateral")
  inicio_actividades date,
  punto_venta        int check (punto_venta between 1 and 99998),  -- el creado en ARCA para "Web Services"
  ambiente           text not null default 'homologacion' check (ambiente in ('homologacion', 'produccion')),
  activa             boolean not null default false,   -- se factura desde la app
  facturar_siempre   boolean not null default true,    -- al cobrar, la factura viene tildada
  tope_identificar   numeric(14,2) not null default 10000000,  -- desde este monto hay que identificar al consumidor final
  csr                text,                    -- pedido de certificado (se sube a ARCA)
  cert_homologacion  text,                    -- certificados que devuelve ARCA (PEM)
  cert_produccion    text,
  vence_homologacion timestamptz,
  vence_produccion   timestamptz,
  ultima_prueba      timestamptz,
  ultima_prueba_ok   boolean,
  ultima_prueba_msg  text
);
insert into facturacion (id) values (1);

-- Lo que solo usa la función "arca" (con la clave de servicio): nadie lo lee desde la app
create table facturacion_secreto (
  id           int primary key default 1 check (id = 1),
  clave_privada text,
  ta           jsonb not null default '{}'   -- ticket de acceso de WSAA por ambiente: {token, sign, vence}
);
insert into facturacion_secreto (id) values (1);

create table facturas (
  id             bigint generated always as identity primary key,
  -- Con este código se ve la factura sin usuario (/factura/<código>): para imprimirla o mandarla por WhatsApp
  codigo         text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  ticket_id      bigint references tickets(id) on delete restrict,
  tipo           int not null check (tipo in (11, 13)),   -- 11 Factura C · 13 Nota de crédito C
  punto_venta    int not null,
  numero         bigint,                     -- se conoce al pedirlo; queda firme con el CAE
  fecha          date not null,
  total          numeric(14,2) not null check (total > 0),
  doc_tipo       int not null default 99,    -- 99 sin identificar · 96 DNI · 80 CUIT
  doc_nro        bigint not null default 0,
  receptor       text,                       -- nombre (solo para la factura impresa)
  cond_iva_receptor int not null default 5,  -- 5 consumidor final · 6 monotributo · 1 responsable inscripto · 4 exento
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'autorizada', 'rechazada')),
  cae            text,
  cae_vence      date,
  error          text,                       -- por qué ARCA la rechazó o qué falló
  observaciones  text,                       -- avisos de ARCA aunque la autorice
  ambiente       text not null check (ambiente in ('homologacion', 'produccion')),
  asociada_id    bigint references facturas(id),  -- la factura que anula una nota de crédito
  anulada        boolean not null default false,  -- tiene una nota de crédito autorizada
  creado         timestamptz not null default now(),
  creado_por     uuid references perfiles(id) on delete set null
);
-- Una factura viva por ticket y ambiente (una rechazada o anulada deja volver a facturar)
create unique index facturas_ticket_vivo on facturas (ticket_id, ambiente) where tipo = 11 and estado <> 'rechazada' and not anulada;
create unique index facturas_numero on facturas (ambiente, punto_venta, tipo, numero) where estado = 'autorizada';
create index facturas_fecha on facturas (fecha);

alter table facturacion enable row level security;
create policy facturacion_leer  on facturacion for select using ((select es_gestion()));
create policy facturacion_admin on facturacion for update using ((select es_admin())) with check ((select es_admin()));
alter table facturacion_secreto enable row level security;   -- sin políticas: solo la clave de servicio
alter table facturas enable row level security;
create policy facturas_leer on facturas for select using ((select es_salon()));
-- Las facturas las escribe solo la función "arca"

revoke all on facturacion, facturacion_secreto, facturas from anon;
revoke all on facturacion_secreto from authenticated;
revoke insert, update, delete on facturas from authenticated;
grant select, update on facturacion to authenticated;
grant select on facturas to authenticated;
grant all on facturacion, facturacion_secreto, facturas to service_role;

alter publication supabase_realtime add table facturas;

-- ---------------------------------------------------------------------
-- La factura para ver e imprimir (sin usuario, con su código)
-- ---------------------------------------------------------------------
create or replace function factura_publica(p_codigo text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tipo', f.tipo, 'punto_venta', f.punto_venta, 'numero', f.numero, 'fecha', f.fecha, 'total', f.total,
    'doc_tipo', f.doc_tipo, 'doc_nro', f.doc_nro, 'receptor', f.receptor, 'cond_iva_receptor', f.cond_iva_receptor,
    'estado', f.estado, 'cae', f.cae, 'cae_vence', f.cae_vence, 'ambiente', f.ambiente, 'anulada', f.anulada,
    'emisor', jsonb_build_object('cuit', e.cuit, 'razon_social', e.razon_social, 'nombre_fantasia', e.nombre_fantasia,
                                 'domicilio', e.domicilio, 'iibb', e.iibb, 'inicio_actividades', e.inicio_actividades),
    'asociada', (select jsonb_build_object('tipo', a.tipo, 'punto_venta', a.punto_venta, 'numero', a.numero, 'fecha', a.fecha) from facturas a where a.id = f.asociada_id),
    'mesa', t.mesa_numero, 'subtotal', t.subtotal, 'descuento_pct', t.descuento_pct,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id), '[]')
              from ticket_items i where i.ticket_id = coalesce(f.ticket_id, (select a.ticket_id from facturas a where a.id = f.asociada_id))))
  from facturas f cross join facturacion e
  left join tickets t on t.id = coalesce(f.ticket_id, (select a.ticket_id from facturas a where a.id = f.asociada_id))
  where f.codigo = p_codigo and length(p_codigo) >= 12 and f.estado = 'autorizada'
$$;

-- Lo que necesita saber quien cobra (también el mozo, que no ve la configuración)
create or replace function facturacion_estado() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('activa', activa and cuit is not null and punto_venta is not null, 'facturar_siempre', facturar_siempre,
                            'tope', tope_identificar, 'ambiente', ambiente)
  from facturacion where id = 1 and es_salon()
$$;

-- ---------------------------------------------------------------------
-- Chichito: ventas sin factura, certificado por vencer y modo prueba
-- ---------------------------------------------------------------------
create or replace function sugerencias_facturacion() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare e facturacion; n int; v_vence timestamptz;
begin
  if not es_gestion() then return; end if;
  select * into e from facturacion where id = 1;
  if not e.activa then return; end if;
  select count(*) into n from tickets t where t.jornada >= jornada_actual() - 3 and t.total > 0
    and not exists (select 1 from facturas f where f.ticket_id = t.id and f.tipo = 11 and f.estado = 'autorizada' and not f.anulada and f.ambiente = e.ambiente);
  if n > 0 then return next jsonb_build_object('tema', 'sin-factura', 'clave', 'sin-factura-' || n, 'prioridad', 1,
    'titulo', 'Ventas sin factura',
    'texto', format(case when n = 1 then 'Hay una mesa cobrada sin factura en los últimos días. Hacela desde la Caja.'
                         else 'Hay %s mesas cobradas sin factura en los últimos días. Hacelas desde la Caja.' end, n),
    'boton', 'Ir a la caja', 'ir', '/caja'); end if;
  v_vence := case when e.ambiente = 'produccion' then e.vence_produccion else e.vence_homologacion end;
  if v_vence is not null and v_vence < now() + interval '30 days' then return next jsonb_build_object('tema', 'certificado', 'clave', 'cert-' || v_vence::date, 'prioridad', 1,
    'titulo', 'Certificado de ARCA',
    'texto', format('El certificado para facturar vence el %s. Pedile al contador uno nuevo con el mismo pedido (CSR) y cargalo en Facturación.', to_char(v_vence at time zone zona(), 'DD/MM/YYYY')),
    'boton', 'Ir a Facturación', 'ir', '/admin/facturacion'); end if;
  if e.ambiente = 'homologacion' then return next jsonb_build_object('tema', 'factura-prueba', 'clave', 'factura-prueba', 'prioridad', 3,
    'titulo', 'Facturando en modo prueba',
    'texto', 'Las facturas salen contra el ambiente de prueba de ARCA: no valen. Cuando esté todo bien, pasá a producción en Facturación.',
    'boton', 'Ir a Facturación', 'ir', '/admin/facturacion'); end if;
end $$;

create or replace function sugerencias_ayudante(p_area text default null) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select * from sugerencias_reservas() union all select * from sugerencias_facturacion() union all select * from sugerencias_base(p_area)
$$;

revoke execute on function factura_publica(text), facturacion_estado(), sugerencias_facturacion(), sugerencias_ayudante(text) from public, anon;
grant execute on function facturacion_estado() to authenticated, service_role;
grant execute on function factura_publica(text) to anon, authenticated, service_role;
grant execute on function sugerencias_ayudante(text) to authenticated, service_role;
grant execute on function sugerencias_facturacion() to service_role;

-- >>> 20261112000008_sin_factura.sql
-- =====================================================================
-- Última Vuelta · Ventas que no se facturan
--   Al cobrar se puede elegir no hacer factura: el ticket queda marcado "sin factura" a propósito
--   y no aparece como pendiente ni en los avisos de Chichito. Se puede facturar después igual.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

alter table tickets add column sin_factura boolean not null default false;

-- Marcar o desmarcar un ticket (quien puede cobrar)
create or replace function ticket_sin_factura(p_ticket bigint, p_valor boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar esto.');
  perform exigir(not coalesce(p_valor, true) or not exists (select 1 from facturas f where f.ticket_id = p_ticket and f.tipo = 11 and f.estado = 'autorizada' and not f.anulada),
                 'Esa mesa ya tiene factura. Para sacársela, anulala con nota de crédito.');
  update tickets set sin_factura = coalesce(p_valor, true) where id = p_ticket;
  perform exigir(found, 'No encontramos ese cobro.');
end $$;

-- Chichito: solo cuenta las que quedaron sin factura sin querer
create or replace function sugerencias_facturacion() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare e facturacion; n int; v_vence timestamptz;
begin
  if not es_gestion() then return; end if;
  select * into e from facturacion where id = 1;
  if not e.activa then return; end if;
  select count(*) into n from tickets t where t.jornada >= jornada_actual() - 3 and t.total > 0 and not t.sin_factura
    and not exists (select 1 from facturas f where f.ticket_id = t.id and f.tipo = 11 and f.estado = 'autorizada' and not f.anulada and f.ambiente = e.ambiente);
  if n > 0 then return next jsonb_build_object('tema', 'sin-factura', 'clave', 'sin-factura-' || n, 'prioridad', 1,
    'titulo', 'Facturas pendientes',
    'texto', format(case when n = 1 then 'Hay una mesa cobrada a la que no le salió la factura. Hacela desde la Caja (o marcala sin factura).'
                         else 'Hay %s mesas cobradas a las que no les salió la factura. Hacelas desde la Caja (o marcalas sin factura).' end, n),
    'boton', 'Ir a la caja', 'ir', '/caja'); end if;
  v_vence := case when e.ambiente = 'produccion' then e.vence_produccion else e.vence_homologacion end;
  if v_vence is not null and v_vence < now() + interval '30 days' then return next jsonb_build_object('tema', 'certificado', 'clave', 'cert-' || v_vence::date, 'prioridad', 1,
    'titulo', 'Certificado de ARCA',
    'texto', format('El certificado para facturar vence el %s. Pedile al contador uno nuevo con el mismo pedido (CSR) y cargalo en Facturación.', to_char(v_vence at time zone zona(), 'DD/MM/YYYY')),
    'boton', 'Ir a Facturación', 'ir', '/admin/facturacion'); end if;
  if e.ambiente = 'homologacion' then return next jsonb_build_object('tema', 'factura-prueba', 'clave', 'factura-prueba', 'prioridad', 3,
    'titulo', 'Facturando en modo prueba',
    'texto', 'Las facturas salen contra el ambiente de prueba de ARCA: no valen. Cuando esté todo bien, pasá a producción en Facturación.',
    'boton', 'Ir a Facturación', 'ir', '/admin/facturacion'); end if;
end $$;

revoke execute on function ticket_sin_factura(bigint, boolean), sugerencias_facturacion() from public, anon;
grant execute on function ticket_sin_factura(bigint, boolean) to authenticated, service_role;
grant execute on function sugerencias_facturacion() to service_role;

-- >>> 20261112000009_anular_compra.sql
-- =====================================================================
-- Última Vuelta · Anular una compra mal cargada
--   Saca del stock lo que había sumado, vuelve el costo del artículo al de la compra anterior
--   (si nadie lo cambió después) y borra el gasto que había dejado.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

create or replace function anular_compra(p_compra bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_prev numeric; v_n int := 0; v_total numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados anulan compras.');
  select total into v_total from compras where id = p_compra for update;
  perform exigir(found, 'No encontramos esa compra.');
  for m in select ms.id, ms.insumo_id, ms.cantidad, ms.costo_unit, ms.hora, i.costo
           from movimientos_stock ms join insumos i on i.id = ms.insumo_id
           where ms.compra_id = p_compra and ms.tipo = 'compra' for update of i loop
    -- El costo que tenía antes de esta compra (la compra anterior de ese artículo)
    select costo_unit into v_prev from movimientos_stock
     where insumo_id = m.insumo_id and tipo = 'compra' and costo_unit > 0 and id <> m.id
       and (compra_id is distinct from p_compra) and (hora, id) < (m.hora, m.id)
     order by hora desc, id desc limit 1;
    update insumos set cantidad = cantidad - m.cantidad,
                       costo = case when v_prev is not null and costo = m.costo_unit then v_prev else costo end
     where id = m.insumo_id;
    v_n := v_n + 1;
  end loop;
  delete from movimientos_stock where compra_id = p_compra;
  delete from gastos where compra_id = p_compra and origen = 'compra';
  delete from compras where id = p_compra;
  return jsonb_build_object('articulos', v_n, 'total', v_total);
end $$;

revoke execute on function anular_compra(bigint) from public, anon;
grant execute on function anular_compra(bigint) to authenticated, service_role;

-- >>> 20261112000010_pedidos.sql
-- =====================================================================
-- Última Vuelta · Circuito de pedidos y cobro, afinado
--   Cobro: pagar con varios medios, propina, "invita la casa".
--   Corregir: sacar un producto ya enviado (con motivo), pasar productos a otra mesa, separar la cuenta.
--   Sin mesa: para llevar, delivery y barra, con el nombre del cliente.
--   Todo lo que se saca, se invita o se pasa queda registrado para los dueños.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
alter table tickets add column if not exists propina numeric(14,2) not null default 0 check (propina >= 0);
alter table tickets add column if not exists mesa_nombre text;          -- "Para llevar · Juan", "Delivery · Ana"…

-- Cómo se pagó cada ticket (puede ser con más de un medio). La propina va incluida en los pagos.
create table if not exists ticket_pagos (
  id        bigint generated always as identity primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  medio     text not null references medios_pago(nombre) on update cascade,
  monto     numeric(14,2) not null check (monto > 0)
);
create index if not exists ticket_pagos_ticket_idx on ticket_pagos (ticket_id);
alter table ticket_pagos enable row level security;
drop policy if exists ticket_pagos_gestion on ticket_pagos;
create policy ticket_pagos_gestion on ticket_pagos for all using ((select es_gestion())) with check ((select es_gestion()));

-- Los pagos de cada ticket. Los tickets viejos (de antes de esto) tienen un solo medio: el del ticket.
-- monto: la plata que entró (con la propina) · venta: la parte que es venta (sin la propina)
create or replace view pagos_ticket with (security_invoker = true) as
select t.id ticket_id, t.jornada, coalesce(p.medio, t.medio) medio, coalesce(p.monto, t.total + t.propina) monto,
       round(coalesce(p.monto, t.total + t.propina) * case when t.total + t.propina > 0 then t.total / (t.total + t.propina) else 1 end, 2) venta
from tickets t left join ticket_pagos p on p.ticket_id = t.id;
revoke all on pagos_ticket from anon;
grant select on pagos_ticket to authenticated, service_role;

alter table pedido_items add column if not exists cortesia boolean not null default false;
alter table ticket_items add column if not exists cortesia boolean not null default false;

-- Lo que se sacó, se invitó o se pasó de mesa (para control)
create table if not exists pedido_cambios (
  id         bigint generated always as identity primary key,
  hora       timestamptz not null default now(),
  jornada    date not null,
  mesa       text not null,
  tipo       text not null check (tipo in ('sacado', 'invitado', 'pasado')),
  nombre     text not null,
  cantidad   int not null,
  importe    numeric(14,2) not null default 0,
  motivo     text,
  usuario_id uuid references perfiles(id) on delete set null,
  usuario    text
);
create index if not exists pedido_cambios_jornada_idx on pedido_cambios (jornada);
alter table pedido_cambios enable row level security;
drop policy if exists pedido_cambios_gestion on pedido_cambios;
create policy pedido_cambios_gestion on pedido_cambios for select using ((select es_gestion()));

-- Cuentas sin mesa: se crean al abrirlas y se apagan al cobrarlas
alter table mesas add column if not exists tipo text not null default 'mesa';
alter table mesas add column if not exists nombre text;
alter table mesas add column if not exists telefono text;
alter table mesas add column if not exists direccion text;
alter table mesas add column if not exists temporal boolean not null default false;
do $$ begin
  alter table mesas add constraint mesas_tipo_check check (tipo in ('mesa', 'llevar', 'delivery', 'barra', 'aparte'));
exception when duplicate_object then null; end $$;

do $$ begin alter publication supabase_realtime add table pedido_cambios; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------
-- Cómo se llama la mesa o la cuenta en pantalla y en el ticket
create or replace function nombre_mesa(m mesas) returns text
language sql stable set search_path = public as $$
  select case m.tipo when 'mesa' then 'Mesa ' || m.numero when 'llevar' then 'Para llevar · ' || coalesce(m.nombre, '')
                     when 'delivery' then 'Delivery · ' || coalesce(m.nombre, '') when 'barra' then 'Barra · ' || coalesce(m.nombre, '')
                     else coalesce(m.nombre, 'Cuenta aparte') end
$$;

-- Después de sacar o pasar ítems: si el pedido quedó vacío se borra; si no, cada estación queda solo si tiene ítems
create or replace function ajustar_pedido(p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pedido_items where pedido_id = p_pedido) then
    delete from pedidos where id = p_pedido and ticket_id is null; return;
  end if;
  update pedidos set
    est_cocina = case when exists (select 1 from pedido_items where pedido_id = p_pedido and estacion = 'cocina') then coalesce(est_cocina, 'pendiente'::estado_comanda) end,
    est_barra  = case when exists (select 1 from pedido_items where pedido_id = p_pedido and estacion = 'barra')  then coalesce(est_barra,  'pendiente'::estado_comanda) end
  where id = p_pedido;
end $$;

-- Una cuenta sin mesa que se quedó sin nada (se sacó o se pasó todo) se cierra sola
create or replace function cerrar_si_vacia(p_mesa bigint) returns void
language sql security definer set search_path = public as $$
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null, activa = false
  where id = p_mesa and temporal and activa and not exists (select 1 from pedidos where mesa_id = p_mesa and ticket_id is null)
$$;

create or replace function anotar_cambio(m mesas, p_tipo text, p_nombre text, p_cantidad int, p_importe numeric, p_motivo text) returns void
language sql security definer set search_path = public as $$
  insert into pedido_cambios (jornada, mesa, tipo, nombre, cantidad, importe, motivo, usuario_id, usuario)
  values (jornada_actual(), nombre_mesa(m), p_tipo, p_nombre, p_cantidad, coalesce(p_importe, 0), nullif(trim(coalesce(p_motivo, '')), ''),
          auth.uid(), (select nombre from perfiles where id = auth.uid()))
$$;

-- ---------------------------------------------------------------------
-- Sin mesa: para llevar, delivery, barra (y "cuenta aparte" al separar)
-- ---------------------------------------------------------------------
create or replace function abrir_cuenta(p_tipo text, p_nombre text, p_telefono text default null, p_direccion text default null, p_comensales int default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_num int;
begin
  perform exigir(es_salon(), 'Tu usuario no puede abrir cuentas.');
  perform exigir(p_tipo in ('llevar', 'delivery', 'barra', 'aparte'), 'Elegí para llevar, delivery o barra.');
  perform exigir(length(trim(coalesce(p_nombre, ''))) between 1 and 40, 'Poné un nombre para reconocer el pedido.');
  perform exigir(p_tipo <> 'delivery' or length(trim(coalesce(p_direccion, ''))) >= 3, 'Para delivery poné la dirección.');
  perform pg_advisory_xact_lock(hashtext('abrir_cuenta'));
  select greatest(1000, coalesce(max(numero), 0) + 1) into v_num from mesas;
  insert into mesas (numero, zona, tipo, nombre, telefono, direccion, temporal, activa, estado, abierta, comensales, mozo_id)
  values (v_num, null, p_tipo, trim(p_nombre), nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), ''), nullif(trim(coalesce(p_direccion, '')), ''),
          true, true, 'ocupada', now(), case when p_comensales > 0 then p_comensales end, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Una cuenta sin mesa que se cobra o se cierra desaparece de la pantalla
create or replace function liberar_mesa(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  perform exigir(not exists (select 1 from pedidos where mesa_id = p_mesa and ticket_id is null and confirmado),
                 'La mesa tiene pedidos: cobrala o anulá los pedidos primero.');
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null, activa = activa and not temporal where id = p_mesa;
end $$;

create or replace function mover_mesa(p_desde bigint, p_hacia bigint) returns void
language plpgsql security definer set search_path = public as $$
declare a mesas; b mesas;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar mesas.');
  select * into a from mesas where id = p_desde for update;
  select * into b from mesas where id = p_hacia for update;
  perform exigir(a.id is not null and b.id is not null and b.activa and not b.temporal, 'La mesa no existe.');
  perform exigir(b.estado = 'libre' and not exists (select 1 from pedidos where mesa_id = p_hacia and ticket_id is null),
                 format('La mesa %s no está libre.', b.numero));
  update pedidos set mesa_id = p_hacia where mesa_id = p_desde and ticket_id is null;
  update mesas set estado = case when a.estado = 'libre' then 'ocupada' else a.estado end, abierta = coalesce(a.abierta, now()),
                   comensales = a.comensales, mozo_id = coalesce(a.mozo_id, auth.uid()) where id = p_hacia;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null, activa = activa and not temporal where id = p_desde;
  delete from llamados where mesa_id = p_desde;
end $$;

-- ---------------------------------------------------------------------
-- Corregir pedidos ya enviados
-- ---------------------------------------------------------------------
-- Sacar un producto (o parte). Si ya lo están preparando, solo dueños o encargado. Con motivo.
create or replace function sacar_item(p_item bigint, p_cantidad int default null, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i pedido_items; p pedidos; m mesas; v_q int; v_est estado_comanda;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar pedidos.');
  select * into i from pedido_items where id = p_item for update;
  perform exigir(found, 'Ese producto ya no está en el pedido.');
  select * into p from pedidos where id = i.pedido_id for update;
  perform exigir(p.ticket_id is null, 'Esa mesa ya se cobró.');
  select * into m from mesas where id = p.mesa_id;
  v_est := case when i.estacion = 'cocina' then p.est_cocina else p.est_barra end;
  perform exigir(not p.confirmado or es_gestion() or coalesce(v_est, 'pendiente') = 'pendiente',
                 'Ya lo están preparando: pedile a un encargado que lo saque.');
  perform exigir(not p.confirmado or length(trim(coalesce(p_motivo, ''))) >= 3, 'Contá por qué se saca (por ejemplo: se equivocó al pedir).');
  v_q := least(coalesce(p_cantidad, i.cantidad), i.cantidad);
  perform exigir(v_q >= 1, 'Elegí cuántos sacar.');
  if v_q = i.cantidad then delete from pedido_items where id = p_item; else update pedido_items set cantidad = cantidad - v_q where id = p_item; end if;
  if p.confirmado then perform anotar_cambio(m, 'sacado', i.nombre, v_q, v_q * i.precio,
                                            p_motivo || case when coalesce(v_est, 'pendiente') <> 'pendiente' then ' (ya en preparación)' else '' end); end if;
  perform ajustar_pedido(p.id);
  perform cerrar_si_vacia(p.mesa_id);
end $$;

-- Invita la casa: el producto queda en el ticket a $ 0 (se cuenta el costo). Solo dueños o encargado.
create or replace function invitar_item(p_item bigint, p_cantidad int default null, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i pedido_items; p pedidos; m mesas; v_q int;
begin
  perform exigir(es_gestion(), 'Las invitaciones las hacen los dueños o el encargado.');
  select * into i from pedido_items where id = p_item for update;
  perform exigir(found, 'Ese producto ya no está en el pedido.');
  perform exigir(not i.cortesia, 'Ese producto ya está invitado.');
  select * into p from pedidos where id = i.pedido_id for update;
  perform exigir(p.ticket_id is null and p.confirmado, 'Ese pedido ya no se puede cambiar.');
  select * into m from mesas where id = p.mesa_id;
  v_q := least(coalesce(p_cantidad, i.cantidad), i.cantidad);
  perform exigir(v_q >= 1, 'Elegí cuántos invitar.');
  if v_q < i.cantidad then
    update pedido_items set cantidad = cantidad - v_q where id = p_item;
    insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion, nota, cortesia)
    values (i.pedido_id, i.producto_id, i.nombre, v_q, 0, i.estacion, i.nota, true);
  else
    update pedido_items set precio = 0, cortesia = true where id = p_item;
  end if;
  perform anotar_cambio(m, 'invitado', i.nombre, v_q, v_q * i.precio, p_motivo);
end $$;

-- Pasar productos a otra mesa o cuenta (para separar la cuenta o corregir una mesa equivocada).
-- p_items: [{id, cantidad}]. Si la mesa de destino está libre, se abre.
create or replace function pasar_items(p_items jsonb, p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d mesas; x jsonb; i pedido_items; p pedidos; m mesas; v_q int; v_nuevo bigint; v_mapa jsonb := '{}'; v_tocados bigint[] := '{}'; v_id bigint;
begin
  perform exigir(es_salon(), 'Tu usuario no puede cambiar pedidos.');
  perform exigir(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0, 'Elegí qué productos pasar.');
  select * into d from mesas where id = p_mesa for update;
  perform exigir(found and d.activa, 'La mesa de destino no existe.');
  if d.estado = 'libre' then update mesas set estado = 'ocupada', abierta = now(), mozo_id = coalesce(mozo_id, auth.uid()) where id = p_mesa; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    select * into i from pedido_items where id = (x->>'id')::bigint for update;
    perform exigir(found, 'Uno de los productos ya no está.');
    select * into p from pedidos where id = i.pedido_id for update;
    perform exigir(p.ticket_id is null and p.confirmado, 'Solo se pueden pasar productos ya confirmados y sin cobrar.');
    perform exigir(p.mesa_id <> p_mesa, 'Ese producto ya está en esa mesa.');
    select * into m from mesas where id = p.mesa_id;
    v_q := least(coalesce((x->>'cantidad')::int, i.cantidad), i.cantidad);
    continue when v_q < 1;
    -- un pedido nuevo en el destino por cada pedido de origen (mantiene la hora y el estado de la comanda)
    v_nuevo := (v_mapa->>p.id::text)::bigint;
    if v_nuevo is null then
      insert into pedidos (mesa_id, origen, confirmado, creado, confirmado_en, mozo_id, est_cocina, est_barra, t_cocina_listo, t_barra_listo)
      values (p_mesa, p.origen, true, p.creado, p.confirmado_en, p.mozo_id, p.est_cocina, p.est_barra, p.t_cocina_listo, p.t_barra_listo)
      returning id into v_nuevo;
      v_mapa := v_mapa || jsonb_build_object(p.id::text, v_nuevo);
      v_tocados := v_tocados || p.id || v_nuevo;
    end if;
    if v_q = i.cantidad then update pedido_items set pedido_id = v_nuevo where id = i.id;
    else
      update pedido_items set cantidad = cantidad - v_q where id = i.id;
      insert into pedido_items (pedido_id, producto_id, nombre, cantidad, precio, estacion, nota, cortesia)
      values (v_nuevo, i.producto_id, i.nombre, v_q, i.precio, i.estacion, i.nota, i.cortesia);
    end if;
    perform anotar_cambio(m, 'pasado', i.nombre, v_q, v_q * i.precio, 'A ' || nombre_mesa(d));
  end loop;
  foreach v_id in array v_tocados loop perform ajustar_pedido(v_id); end loop;
  for v_id in select id from mesas where temporal and activa and id <> p_mesa loop perform cerrar_si_vacia(v_id); end loop;
end $$;

-- ---------------------------------------------------------------------
-- Cobrar con varios medios y propina
-- p_pagos: [{medio, monto}] (si no viene, todo con p_medio). Los pagos suman el total más la propina.
-- ---------------------------------------------------------------------
drop function if exists cobrar_mesa(bigint, text, numeric);
create or replace function cobrar_mesa(p_mesa bigint, p_medio text, p_descuento numeric default 0, p_pagos jsonb default null, p_propina numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m mesas; v_t bigint; v_sub numeric; v_tot numeric; v_j date := jornada_caja(); r record; x jsonb; v_suma numeric := 0; v_medio text; v_prop numeric := round(coalesce(p_propina, 0), 2);
begin
  perform exigir(es_salon(), 'Tu usuario no puede cobrar.');
  select * into m from mesas where id = p_mesa for update;
  perform exigir(found, 'La mesa no existe.');
  p_descuento := coalesce(p_descuento, 0);
  perform exigir(p_descuento between 0 and 100, 'El descuento tiene que estar entre 0 y 100 %.');
  perform exigir(v_prop >= 0, 'La propina no puede ser negativa.');

  select sum(i.cantidad * i.precio) into v_sub
  from pedido_items i join pedidos p on p.id = i.pedido_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado;
  perform exigir(v_sub is not null, format('%s no tiene nada para cobrar.', nombre_mesa(m)));
  v_tot := round(v_sub * (1 - p_descuento / 100), 2);

  -- Los pagos
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    p_pagos := jsonb_build_array(jsonb_build_object('medio', p_medio, 'monto', v_tot + v_prop));
  end if;
  for x in select * from jsonb_array_elements(p_pagos) loop
    perform exigir(exists (select 1 from medios_pago where nombre = x->>'medio' and activo), 'Elegí un medio de pago.');
    perform exigir(coalesce((x->>'monto')::numeric, 0) >= 0, 'Revisá los montos de los pagos.');
    v_suma := v_suma + coalesce((x->>'monto')::numeric, 0);
  end loop;
  perform exigir(abs(v_suma - (v_tot + v_prop)) < 1, format('Los pagos suman $ %s y hay que cobrar $ %s.', replace(to_char(v_suma, 'FM999,999,990'), ',', '.'), replace(to_char(v_tot + v_prop, 'FM999,999,990'), ',', '.')));
  select e->>'medio' into v_medio from jsonb_array_elements(p_pagos) e order by (e->>'monto')::numeric desc limit 1;

  insert into tickets (jornada, mesa_numero, mesa_nombre, mesa_abierta, comensales, mozo_id, mozo_nombre, subtotal, descuento_pct, total, propina, medio, cobrado_por,
                       min_cocina, min_barra)
  select v_j, case when m.tipo = 'mesa' then m.numero end, case when m.tipo <> 'mesa' then nombre_mesa(m) end, m.abierta, m.comensales, m.mozo_id,
         (select nombre from perfiles where id = m.mozo_id), v_sub, p_descuento, v_tot, v_prop, v_medio, auth.uid(),
         coalesce(array_agg(round(extract(epoch from p.t_cocina_listo - p.creado) / 60)::int) filter (where p.t_cocina_listo is not null), '{}'),
         coalesce(array_agg(round(extract(epoch from p.t_barra_listo  - p.creado) / 60)::int) filter (where p.t_barra_listo  is not null), '{}')
  from pedidos p where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  returning id into v_t;

  insert into ticket_pagos (ticket_id, medio, monto)
  select v_t, e->>'medio', sum((e->>'monto')::numeric) from jsonb_array_elements(p_pagos) e where (e->>'monto')::numeric > 0 group by 2;

  insert into ticket_items (ticket_id, producto_id, nombre, categoria, cantidad, precio, costo_unit, cortesia)
  select v_t, i.producto_id, i.nombre, c.nombre, sum(i.cantidad), i.precio, coalesce(costo_receta(i.producto_id), 0), i.cortesia
  from pedido_items i join pedidos p on p.id = i.pedido_id
  left join productos pr on pr.id = i.producto_id left join categorias c on c.id = pr.categoria_id
  where p.mesa_id = p_mesa and p.ticket_id is null and p.confirmado
  group by i.producto_id, i.nombre, c.nombre, i.precio, i.cortesia;

  update tickets set costo = (select coalesce(sum(cantidad * costo_unit), 0) from ticket_items where ticket_id = v_t) where id = v_t;

  -- Bebidas que se cuentan por unidad
  for r in select ti.producto_id, sum(ti.cantidad) q from ticket_items ti join productos p on p.id = ti.producto_id
           where ti.ticket_id = v_t and p.controla_stock group by ti.producto_id loop
    update productos set stock = greatest(0, stock - r.q) where id = r.producto_id;
    insert into movimientos_stock (producto_id, tipo, cantidad, jornada, ticket_id, usuario_id) values (r.producto_id, 'venta', -r.q, v_j, v_t, auth.uid());
  end loop;

  -- Artículos de las recetas (con la merma de limpieza)
  for r in select ri.insumo_id, sum(ti.cantidad * crudo(ri.cantidad, ri.cocido, i.merma_pct, i.rinde_coccion)) q, max(i.costo) c
           from ticket_items ti join receta_items ri on ri.producto_id = ti.producto_id join insumos i on i.id = ri.insumo_id
           where ti.ticket_id = v_t group by ri.insumo_id loop
    insert into movimientos_stock (insumo_id, tipo, cantidad, costo_unit, jornada, ticket_id, usuario_id)
    values (r.insumo_id, 'venta', -round(r.q, 3), r.c, v_j, v_t, auth.uid());
    update insumos set cantidad = greatest(0, cantidad - round(r.q, 3)) where id = r.insumo_id;
  end loop;

  -- Los pedidos quedan como historia del ticket; los del QR sin confirmar se descartan
  update pedidos set ticket_id = v_t,
    est_cocina = case when est_cocina is null then null else 'entregado'::estado_comanda end,
    est_barra  = case when est_barra  is null then null else 'entregado'::estado_comanda end
  where mesa_id = p_mesa and ticket_id is null and confirmado;
  delete from pedidos where mesa_id = p_mesa and ticket_id is null;
  delete from llamados where mesa_id = p_mesa;
  update mesas set estado = 'libre', abierta = null, comensales = null, mozo_id = null, activa = activa and not temporal where id = p_mesa;

  return jsonb_build_object('id', v_t, 'total', v_tot, 'subtotal', v_sub, 'propina', v_prop, 'medio', v_medio, 'mesa', nombre_mesa(m));
end $$;

-- La plata: ahora sale de los pagos (con propina incluida)
create or replace function saldo_cuenta(p_cuenta bigint, p_hasta date default null) returns numeric
language sql stable security definer set search_path = public as $$
  with c as (select * from cuentas where id = p_cuenta), h as (select coalesce(p_hasta, '9999-12-31'::date) d)
  select (select saldo_inicial from c)
    + coalesce((select sum(t.monto) from pagos_ticket t join medios_pago mp on mp.nombre = t.medio
                where mp.cuenta_id = p_cuenta and t.jornada >= (select desde from c) and t.jornada <= (select d from h)), 0)
    - coalesce((select sum(monto) from gastos where cuenta_id = p_cuenta and estado = 'pagado'
                and pagado_el >= (select desde from c) and pagado_el <= (select d from h)), 0)
    + coalesce((select sum(case when a_cuenta = p_cuenta then monto else -monto end) from movimientos_cuenta
                where (a_cuenta = p_cuenta or (tipo = 'transferencia' and de_cuenta = p_cuenta))
                and fecha >= (select desde from c) and fecha <= (select d from h)), 0)
$$;

create or replace function efectivo_esperado(p_jornada date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select apertura from jornadas where fecha = p_jornada), 0)
       + coalesce((select sum(t.monto) from pagos_ticket t join medios_pago mp on mp.nombre = t.medio
                   join cuentas c on c.id = mp.cuenta_id where t.jornada = p_jornada and c.tipo = 'Efectivo'), 0)
       - coalesce((select sum(monto) from gastos where jornada = p_jornada and origen = 'caja'), 0)
$$;

-- ---------------------------------------------------------------------
-- Tableros: los medios de pago salen de los pagos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tickets_filtrados(p_desde date, p_hasta date, p_f jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id bigint, jornada date, hora timestamp with time zone, total numeric, comensales integer, mozo_id uuid, mozo_nombre text, medio text, mesa_abierta timestamp with time zone, min_cocina integer[], min_barra integer[], unidades bigint, costo numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (
    select * from tickets t
    where t.jornada between p_desde and p_hasta
      and (p_f->>'mozo' is null or coalesce(t.mozo_id::text, 'sin') = p_f->>'mozo')
      and (p_f->>'medio' is null or exists (select 1 from pagos_ticket pt where pt.ticket_id = t.id and pt.medio = p_f->>'medio'))
      and (p_f->>'dow' is null or extract(dow from t.jornada)::int = (p_f->>'dow')::int)
  ), it as (
    select ti.* from ticket_items ti join t on t.id = ti.ticket_id
    where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
      and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint)
      and (p_f->>'insumo' is null or exists (select 1 from receta_items r where r.producto_id = ti.producto_id and r.insumo_id = (p_f->>'insumo')::bigint))
      and (p_f->>'proveedor' is null or exists (select 1 from receta_items r join insumos i on i.id = r.insumo_id
                                                where r.producto_id = ti.producto_id and i.proveedor_id = (p_f->>'proveedor')::bigint))
  ), filtra_items as (
    select (p_f ?| array['categoria', 'producto', 'insumo', 'proveedor']) si
  )
  select t.id, t.jornada, t.hora,
         case when (select si from filtra_items) then round(sum(it.cantidad * it.precio) * (1 - t.descuento_pct / 100), 2) else t.total end,
         t.comensales, t.mozo_id, t.mozo_nombre, t.medio, t.mesa_abierta, t.min_cocina, t.min_barra,
         sum(it.cantidad), sum(it.cantidad * it.costo_unit)
  from t join it on it.ticket_id = t.id
  group by t.id, t.jornada, t.hora, t.total, t.descuento_pct, t.comensales, t.mozo_id, t.mozo_nombre, t.medio, t.mesa_abierta, t.min_cocina, t.min_barra
$function$;

CREATE OR REPLACE FUNCTION public.tablero_ventas(p_desde date, p_hasta date, p_f jsonb DEFAULT '{}'::jsonb, p_comparar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int := p_hasta - p_desde + 1; pd date := p_desde - n; ph date := p_desde - 1; r jsonb;
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  p_f := jsonb_strip_nulls(coalesce(p_f, '{}'));
  with t as (select * from tickets_filtrados(p_desde, p_hasta, p_f)),
       tp as (select * from tickets_filtrados(pd, ph, p_f) where p_comparar),
       it as (select ti.*, t.jornada, t.hora from ticket_items ti join t on t.id = ti.ticket_id
              where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
                and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint)
                and (p_f->>'insumo' is null or exists (select 1 from receta_items x where x.producto_id = ti.producto_id and x.insumo_id = (p_f->>'insumo')::bigint))
                and (p_f->>'proveedor' is null or exists (select 1 from receta_items x join insumos i on i.id = x.insumo_id where x.producto_id = ti.producto_id and i.proveedor_id = (p_f->>'proveedor')::bigint))),
       itp as (select ti.nombre, sum(ti.cantidad) q from ticket_items ti join tp on tp.id = ti.ticket_id
              where (p_f->>'categoria' is null or ti.categoria = p_f->>'categoria')
                and (p_f->>'producto' is null or ti.producto_id = (p_f->>'producto')::bigint) group by 1),
       mc as (select unnest(min_cocina) x from t), mb as (select unnest(min_barra) x from t)
  select jsonb_build_object(
    'kpi', (select jsonb_build_object(
        'ventas', coalesce(sum(total), 0), 'unidades', coalesce(sum(unidades), 0), 'mesas', count(*),
        'ticket_prom', case when count(*) > 0 then round(sum(total) / count(*)) end,
        'cubiertos', coalesce(sum(comensales), 0),
        'por_cubierto', case when sum(comensales) > 0 then round(sum(total) filter (where comensales > 0) / sum(comensales)) end,
        'permanencia', round(avg(extract(epoch from hora - mesa_abierta) / 60) filter (where mesa_abierta is not null and hora - mesa_abierta < interval '10 hours')),
        'cocina_prom', (select round(avg(x)) from mc), 'cocina_tarde', (select round(100.0 * count(*) filter (where x > split_part(param('alerta_cocina', '15,25'), ',', 2)::int) / nullif(count(*), 0)) from mc),
        'barra_prom',  (select round(avg(x)) from mb), 'barra_tarde',  (select round(100.0 * count(*) filter (where x > split_part(param('alerta_barra', '5,10'), ',', 2)::int) / nullif(count(*), 0)) from mb))
      from t),
    'prev', case when p_comparar then (select jsonb_build_object(
        'ventas', coalesce(sum(total), 0), 'unidades', coalesce(sum(unidades), 0), 'mesas', count(*),
        'ticket_prom', case when count(*) > 0 then round(sum(total) / count(*)) end,
        'por_cubierto', case when sum(comensales) > 0 then round(sum(total) filter (where comensales > 0) / sum(comensales)) end) from tp) end,
    'serie', serie_ventas(p_desde, p_hasta, p_f),
    'calor', (select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'h', h, 'v', v)), '[]') from
               (select extract(dow from jornada)::int d, hora_local(hora) h, sum(total) v from t group by 1, 2) z),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'v', round(v / dias))), '[]') from
               (select extract(dow from jornada)::int d, sum(total) v, count(distinct jornada) dias from t group by 1) z),
    'mozos', (select coalesce(jsonb_agg(jsonb_build_object('id', mozo_id, 'nombre', coalesce(nombre, 'Sin mozo'), 'mesas', nm, 'vendido', v, 'cubiertos', c) order by v desc), '[]') from
               (select mozo_id, max(mozo_nombre) nombre, count(*) nm, sum(total) v, sum(comensales) c from t group by mozo_id) z),
    'productos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'categoria', categoria, 'unidades', q, 'vendido', v,
                   'antes', (select q from itp where itp.nombre = z.nombre)) order by v desc), '[]') from
               (select nombre, max(categoria) categoria, sum(cantidad) q, sum(cantidad * precio) v from it group by nombre limit 60) z),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c, 'v', v) order by v desc), '[]') from
               (select coalesce(categoria, 'Otros') c, sum(cantidad * precio) v from it group by 1) z),
    'medios', (select coalesce(jsonb_agg(jsonb_build_object('nombre', medio, 'v', v) order by v desc), '[]') from
               (select pt.medio, round(sum(pt.venta * case when tt.total > 0 then t.total / tt.total else 1 end)) v
                from t join tickets tt on tt.id = t.id join pagos_ticket pt on pt.ticket_id = t.id group by 1) z)
  ) into r;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.tablero_finanzas(p_desde date, p_hasta date, p_f jsonb DEFAULT '{}'::jsonb, p_comparar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int := p_hasta - p_desde + 1; pd date := p_desde - n; ph date := p_desde - 1; r jsonb; v_hoy date := hoy_local();
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  p_f := jsonb_strip_nulls(coalesce(p_f, '{}'));
  with v as (select t.jornada f, t.medio, t.venta total from pagos_ticket t join medios_pago mp on mp.nombre = t.medio
             where t.jornada between pd and p_hasta and (p_f->>'cuenta' is null or mp.cuenta_id = (p_f->>'cuenta')::bigint)),
       g as (select g.*, p.nombre prov from gastos g left join proveedores p on p.id = g.proveedor_id
             where g.fecha between pd and p_hasta
               and (p_f->>'gcat' is null or g.categoria = p_f->>'gcat')
               and (p_f->>'proveedor' is null or g.proveedor_id = (p_f->>'proveedor')::bigint)
               and (p_f->>'cuenta' is null or g.cuenta_id = (p_f->>'cuenta')::bigint)),
       pend as (select g.*, p.nombre prov from gastos g left join proveedores p on p.id = g.proveedor_id where g.estado = 'pendiente'
               and (p_f->>'gcat' is null or g.categoria = p_f->>'gcat') and (p_f->>'proveedor' is null or g.proveedor_id = (p_f->>'proveedor')::bigint)),
       serie as (
         select case when n <= 45 then to_char(x, 'DD') else to_char(x, 'MM/YY') end l, x d, case when n <= 45 then x else (x + interval '1 month' - interval '1 day')::date end h
         from generate_series(case when n <= 45 then p_desde else date_trunc('month', p_desde)::date end, p_hasta,
                              case when n <= 45 then interval '1 day' else interval '1 month' end) x)
  select jsonb_build_object(
    'solo_gastos', p_f ?| array['gcat', 'proveedor'],
    'kpi', jsonb_build_object('ventas', (select coalesce(sum(total), 0) from v where f between p_desde and p_hasta),
                              'gastos', (select coalesce(sum(monto), 0) from g where fecha between p_desde and p_hasta)),
    'prev', case when p_comparar then jsonb_build_object('ventas', (select coalesce(sum(total), 0) from v where f between pd and ph),
                              'gastos', (select coalesce(sum(monto), 0) from g where fecha between pd and ph)) end,
    'serie', (select jsonb_build_object('por', case when n <= 45 then 'dia' else 'mes' end,
               'puntos', coalesce(jsonb_agg(jsonb_build_object('l', s.l,
                 'ventas', (select coalesce(sum(total), 0) from v where f between greatest(s.d, p_desde) and least(s.h, p_hasta)),
                 'gastos', (select coalesce(sum(monto), 0) from g where fecha between greatest(s.d, p_desde) and least(s.h, p_hasta))) order by s.d), '[]'))
              from serie s),
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c, 'periodo', a, 'anterior', b) order by a desc, b desc), '[]') from
               (select categoria c, sum(monto) filter (where fecha >= p_desde) a, coalesce(sum(monto) filter (where fecha <= ph), 0) b
                from g group by 1) z where coalesce(a, 0) > 0 or (p_comparar and b > 0)),
    'detalle', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha, 'concepto', concepto, 'categoria', categoria, 'proveedor', prov,
                 'estado', estado, 'vence', vence, 'cuenta', (select nombre from cuentas where id = z.cuenta_id), 'monto', monto) order by fecha desc, id desc), '[]')
               from (select * from g where fecha between p_desde and p_hasta order by fecha desc, id desc limit 150) z),
    'medios', (select coalesce(jsonb_agg(jsonb_build_object('nombre', medio, 'cuenta', (select c.nombre from medios_pago mp join cuentas c on c.id = mp.cuenta_id where mp.nombre = z.medio), 'v', s) order by s desc), '[]')
               from (select medio, sum(total) s from v where f between p_desde and p_hasta group by 1) z),
    'proximos', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'concepto', concepto, 'proveedor', prov, 'categoria', categoria, 'vence', vence, 'monto', monto) order by vence nulls first), '[]')
               from (select * from pend order by vence nulls first limit 15) z),
    'disponible', case when p_f->>'cuenta' is not null then saldo_cuenta((p_f->>'cuenta')::bigint) else (select coalesce(sum(saldo_cuenta(id)), 0) from cuentas where activa) end,
    'a_pagar', (select coalesce(sum(monto), 0) from pend),
    'vencidos', (select count(*) from pend where vence < v_hoy),
    'a_pagar_30', (select coalesce(sum(monto), 0) from pend where vence is null or vence <= v_hoy + 30)
  ) into r;
  return r;
end $function$;


-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function ajustar_pedido(bigint), cerrar_si_vacia(bigint), anotar_cambio(mesas, text, text, int, numeric, text) from public, anon, authenticated;
grant execute on function nombre_mesa(mesas), abrir_cuenta(text, text, text, text, int), sacar_item(bigint, int, text), invitar_item(bigint, int, text),
  pasar_items(jsonb, bigint), cobrar_mesa(bigint, text, numeric, jsonb, numeric), liberar_mesa(bigint), mover_mesa(bigint, bigint) to authenticated, service_role;
revoke execute on function abrir_cuenta(text, text, text, text, int), sacar_item(bigint, int, text), invitar_item(bigint, int, text),
  pasar_items(jsonb, bigint), cobrar_mesa(bigint, text, numeric, jsonb, numeric) from public, anon;
