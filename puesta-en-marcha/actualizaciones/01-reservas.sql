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
