-- =====================================================================
-- Última Vuelta · Ticket, gastos fijos y artículos del local
--   · El ticket de cada cobro se puede imprimir (también el mozo, los de hoy).
--   · Gastos fijos: luz, gas, alquiler, internet… se cargan una vez y cada mes aparece solo el gasto
--     pendiente; al pagarlo se pone el monto de ese mes y de qué caja sale.
--   · Tabla de referencia: artículos de limpieza y descartables, y se pueden agregar propios.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

-- ---------------------------------------------------------------- ticket
create or replace function ticket_para_imprimir(p_ticket bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t tickets; r jsonb;
begin
  perform exigir(es_salon() or es_gestion(), 'Tu usuario no puede ver tickets.');
  select * into t from tickets where id = p_ticket;
  perform exigir(found, 'No se encontró el ticket.');
  perform exigir(es_gestion() or t.hora > now() - interval '18 hours', 'Los tickets viejos los reimprime un encargado.');
  select jsonb_build_object(
    't', to_jsonb(t) || jsonb_build_object('ticket_items', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'precio', precio) order by nombre)
                                                                    from ticket_items where ticket_id = t.id), '[]'::jsonb)),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('medio', medio, 'monto', monto)) from pagos_ticket where ticket_id = t.id), '[]'::jsonb),
    'local', coalesce((select valor from parametros where clave = 'nombre_local'), 'Última Vuelta'),
    'bajada', coalesce((select valor from parametros where clave = 'bajada_local'), ''))
  into r;
  return r;
end $$;

-- ---------------------------------------------------------------- gastos fijos
create table if not exists gastos_fijos (
  id           bigint generated always as identity primary key,
  concepto     text not null check (length(btrim(concepto)) between 2 and 80),
  categoria    text not null default 'Otros',
  proveedor_id bigint references proveedores(id) on delete set null,
  dia          int not null default 10 check (dia between 1 and 28),   -- día del mes en que vence
  monto        numeric(14,2) check (monto is null or monto >= 0),      -- null: cambia cada mes (luz, gas)
  cuenta_id    bigint references cuentas(id) on delete set null,      -- de dónde se paga normalmente
  activo       boolean not null default true,
  desde        date not null default date_trunc('month', current_date)::date,
  nota         text,
  creado       timestamptz not null default now()
);
alter table gastos_fijos enable row level security;
drop policy if exists gastos_fijos_gestion on gastos_fijos;
create policy gastos_fijos_gestion on gastos_fijos for all using ((select es_gestion())) with check ((select es_gestion()));
grant select, insert, update, delete on gastos_fijos to authenticated;

alter table gastos add column if not exists fijo_id bigint references gastos_fijos(id) on delete set null;
alter table gastos add column if not exists periodo date;   -- el mes (primer día) del gasto fijo
create unique index if not exists gastos_fijo_periodo on gastos (fijo_id, periodo) where fijo_id is not null;

-- Genera los gastos fijos del mes que todavía no están (quedan pendientes, con el vencimiento del mes).
-- Se llama sola al entrar; se puede llamar las veces que sea. Devuelve cuántos creó.
create or replace function generar_gastos_fijos() returns int
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', hoy_local())::date; n int;
begin
  if not es_gestion() then return 0; end if;
  insert into gastos (fecha, concepto, categoria, monto, proveedor_id, estado, vence, origen, fijo_id, periodo, usuario_id)
  select v_mes + (f.dia - 1), f.concepto || ' · ' || to_char(v_mes, 'MM/YYYY'), f.categoria, coalesce(f.monto, 0), f.proveedor_id,
         'pendiente', v_mes + (f.dia - 1), 'manual', f.id, v_mes, auth.uid()
  from gastos_fijos f
  where f.activo and f.desde <= v_mes
    and not exists (select 1 from gastos g where g.fijo_id = f.id and g.periodo = v_mes)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Pagar un gasto: ahora se puede poner el monto (para los que cambian cada mes, como la luz)
drop function if exists pagar_gasto(bigint, bigint, date);
create or replace function pagar_gasto(p_gasto bigint, p_cuenta bigint, p_fecha date default null, p_monto numeric default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados registran pagos.');
  perform exigir(exists (select 1 from cuentas where id = p_cuenta), 'Elegí de qué cuenta sale la plata.');
  perform exigir(p_monto is null or p_monto > 0, 'Poné el monto que se pagó.');
  update gastos set estado = 'pagado', cuenta_id = p_cuenta, pagado_el = coalesce(p_fecha, hoy_local()), monto = coalesce(p_monto, monto)
  where id = p_gasto and estado = 'pendiente';
  perform exigir(found, 'Ese gasto ya estaba pagado.');
  perform exigir((select monto from gastos where id = p_gasto) > 0, 'Poné el monto que se pagó.');
end $$;

-- ---------------------------------------------------------------- tabla de referencia: limpieza y descartables
-- propia: la agregó el local (se puede editar y borrar)
alter table referencias add column if not exists propia boolean not null default false;

insert into referencias (nombre, grupo, unidad, limpieza_pct, rinde_coccion, porcion, porcion_es, nota) values
  ('Lavandina', 'Limpieza del local', 'L', 0, 1, null, 'limpio', 'Bidón de 5 L'),
  ('Detergente', 'Limpieza del local', 'L', 0, 1, null, 'limpio', 'Bidón de 5 L'),
  ('Desengrasante', 'Limpieza del local', 'L', 0, 1, null, 'limpio', 'Para plancha, campana y parrilla'),
  ('Limpiador de pisos', 'Limpieza del local', 'L', 0, 1, null, 'limpio', null),
  ('Alcohol al 70 %', 'Limpieza del local', 'L', 0, 1, null, 'limpio', null),
  ('Limpiavidrios', 'Limpieza del local', 'L', 0, 1, null, 'limpio', null),
  ('Esponjas', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', null),
  ('Virulana', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', null),
  ('Trapos de piso', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', null),
  ('Rejillas', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', null),
  ('Guantes descartables', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', 'Caja de 100'),
  ('Bolsas de residuo', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', 'Rollo de 10 o 30'),
  ('Papel higiénico', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', 'Rollos'),
  ('Jabón líquido de manos', 'Limpieza del local', 'L', 0, 1, null, 'limpio', null),
  ('Toallas de papel', 'Limpieza del local', 'u.', 0, 1, null, 'limpio', 'Rollos o paquetes'),
  ('Servilletas', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', 'Paquetes'),
  ('Rollo de cocina', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Film', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', 'Rollo'),
  ('Papel aluminio', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', 'Rollo'),
  ('Envases para llevar', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Cajas de pizza', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Bolsas para llevar', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Sorbetes', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Vasos descartables', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Escarbadientes', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Velas', 'Descartables y mesa', 'u.', 0, 1, null, 'limpio', null),
  ('Gas envasado', 'Local', 'u.', 0, 1, null, 'limpio', 'Garrafa o tubo'),
  ('Carbón', 'Local', 'kg', 0, 1, null, 'limpio', 'Bolsa de 4 o 10 kg'),
  ('Leña', 'Local', 'kg', 0, 1, null, 'limpio', null)
on conflict (nombre) do nothing;

revoke execute on function ticket_para_imprimir(bigint), generar_gastos_fijos(), pagar_gasto(bigint, bigint, date, numeric) from public, anon;
grant execute on function ticket_para_imprimir(bigint), generar_gastos_fijos(), pagar_gasto(bigint, bigint, date, numeric) to authenticated, service_role;
