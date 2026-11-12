-- =====================================================================
-- Última Vuelta · base completa (= las 4 migraciones de supabase/migrations, en orden)
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

-- Cantidad a comprar para tener p_limpio después de limpiar (merma de limpieza)
create or replace function bruto(p_limpio numeric, p_merma numeric) returns numeric
language sql immutable as $$ select p_limpio / (1 - least(coalesce(p_merma, 0), 90) / 100.0) $$;

-- Costo de una porción según la receta y el último precio de cada artículo
create or replace function costo_receta(p_producto bigint) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(bruto(r.cantidad, i.merma_pct) * i.costo), 0)
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
  m mesas; v_t bigint; v_sub numeric; v_tot numeric; v_j date := jornada_actual(); r record;
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
  for r in select ri.insumo_id, sum(ti.cantidad * bruto(ri.cantidad, i.merma_pct)) q, max(i.costo) c
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
declare v_j date := jornada_actual();
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados abren la caja.');
  perform exigir(coalesce(p_monto, -1) >= 0, 'Cargá el efectivo inicial (puede ser 0).');
  perform exigir(not exists (select 1 from jornadas where fecha = v_j and apertura is not null), 'La caja de hoy ya está abierta.');
  insert into jornadas (fecha, apertura, abierta_en, abierta_por) values (v_j, p_monto, now(), auth.uid())
  on conflict (fecha) do update set apertura = excluded.apertura, abierta_en = excluded.abierta_en, abierta_por = excluded.abierta_por;
end $$;

create or replace function registrar_gasto_caja(p_concepto text, p_monto numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_j date := jornada_actual(); v_c bigint := cuenta_efectivo();
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
declare v_j date := jornada_actual(); v_e numeric;
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
  insert into receta_items (producto_id, insumo_id, cantidad)
  select p_producto, (x->>'insumo_id')::bigint, sum((x->>'cantidad')::numeric)
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
               'receta', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'unidad', i.unidad, 'cantidad', x.cantidad,
                            'bruto', bruto(x.cantidad, i.merma_pct), 'costo', bruto(x.cantidad, i.merma_pct) * i.costo) order by bruto(x.cantidad, i.merma_pct) * i.costo desc), '[]')
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
       uso_hoy as (select x.insumo_id, sum(h.cantidad * bruto(x.cantidad, i.merma_pct)) u from hoy h
                   join receta_items x on x.producto_id = h.producto_id join insumos i on i.id = x.insumo_id group by 1),
       uso as (select x.insumo_id, sum(p.cantidad * bruto(x.cantidad, i.merma_pct)) u from prox p
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
