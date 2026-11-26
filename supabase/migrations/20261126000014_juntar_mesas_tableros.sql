-- =====================================================================
-- Última Vuelta · Juntar mesas y tableros nuevos
--   · Juntar mesas: cuando viene un grupo grande se juntan varias mesas en una (la principal).
--     Todo se carga y se cobra en la principal; al cobrarla o liberarla, las otras quedan libres solas.
--     El QR de cualquiera de las mesas juntas pide y llama en la principal.
--   · Mesas que más rinden: lo vendido por mesa, por cubierto y por hora ocupada.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

alter table mesas add column if not exists junta_con bigint references mesas(id) on delete set null;
alter table tickets add column if not exists mesas_juntas int[];   -- las otras mesas que estaban juntas con la cobrada

-- La mesa donde va todo: la principal si está junta, si no la misma
create or replace function mesa_principal(p_mesa bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select junta_con from mesas where id = p_mesa), p_mesa)
$$;

create or replace function juntar_mesas(p_principal bigint, p_otras bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare pr mesas; o mesas; v_id bigint; v_com int := 0;
begin
  perform exigir(es_salon(), 'Tu usuario no puede juntar mesas.');
  select * into pr from mesas where id = p_principal for update;
  perform exigir(found and pr.activa and not pr.temporal, 'Elegí una mesa del salón.');
  perform exigir(pr.junta_con is null, format('La mesa %s ya está junta con otra: elegí la principal.', pr.numero));
  perform exigir(coalesce(array_length(p_otras, 1), 0) between 1 and 12, 'Elegí con qué mesas se junta.');
  if pr.estado = 'libre' then
    update mesas set estado = 'ocupada', abierta = now(), mozo_id = auth.uid() where id = pr.id returning * into pr;
  end if;
  foreach v_id in array p_otras loop
    continue when v_id = pr.id;
    select * into o from mesas where id = v_id for update;
    perform exigir(found and o.activa and not o.temporal, 'Una de las mesas no es del salón.');
    perform exigir(o.junta_con is null or o.junta_con = pr.id, format('La mesa %s ya está junta con otra.', o.numero));
    perform exigir(not exists (select 1 from mesas where junta_con = o.id), format('La mesa %s tiene otras juntas: juntá todo en esa.', o.numero));
    -- Lo que tenía cargado pasa a la principal
    update pedidos set mesa_id = pr.id where mesa_id = o.id and ticket_id is null;
    if exists (select 1 from llamados where mesa_id = o.id) then
      insert into llamados (mesa_id) values (pr.id) on conflict (mesa_id) do nothing;
      delete from llamados where mesa_id = o.id;
    end if;
    v_com := v_com + coalesce(o.comensales, 0);
    update mesas set junta_con = pr.id, estado = 'ocupada', abierta = coalesce(o.abierta, pr.abierta), comensales = null,
                     mozo_id = coalesce(o.mozo_id, pr.mozo_id) where id = o.id;
  end loop;
  if v_com > 0 then update mesas set comensales = coalesce(comensales, 0) + v_com where id = pr.id; end if;
end $$;

-- Sacar una mesa del grupo (queda libre; lo cargado queda en la principal)
create or replace function separar_mesa(p_mesa bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_salon(), 'Tu usuario no puede separar mesas.');
  update mesas set junta_con = null, estado = 'libre', abierta = null, comensales = null, mozo_id = null
  where id = p_mesa and junta_con is not null;
  perform exigir(found, 'Esa mesa no está junta con otra.');
end $$;

-- Cuando la principal queda libre (se cobró, se liberó o se pasó a otra), las juntas se liberan solas
create or replace function soltar_juntas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'libre' and old.estado <> 'libre' then
    update mesas set junta_con = null, estado = 'libre', abierta = null, comensales = null, mozo_id = null where junta_con = new.id;
  end if;
  return new;
end $$;
drop trigger if exists mesas_soltar_juntas on mesas;
create trigger mesas_soltar_juntas after update of estado on mesas for each row execute function soltar_juntas();

-- Un pedido cargado en una mesa junta va a la principal
create or replace function pedido_a_principal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mesa_id := mesa_principal(new.mesa_id);
  return new;
end $$;
drop trigger if exists pedidos_a_principal on pedidos;
create trigger pedidos_a_principal before insert or update of mesa_id on pedidos for each row execute function pedido_a_principal();

-- El ticket guarda qué mesas estaban juntas
create or replace function ticket_juntas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mesa_numero is not null then
    new.mesas_juntas := (select array_agg(o.numero order by o.numero) from mesas o join mesas p on p.id = o.junta_con
                         where p.numero = new.mesa_numero and p.tipo = 'mesa' and not p.temporal);
  end if;
  return new;
end $$;
drop trigger if exists tickets_juntas on tickets;
create trigger tickets_juntas before insert on tickets for each row execute function ticket_juntas();

-- El QR de una mesa junta pide y llama en la principal
create or replace function pedir_desde_mesa(p_token text, p_items jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare m mesas;
begin
  select * into m from mesas where token = p_token and activa;
  perform exigir(found, 'Este QR ya no es válido. Pedile al mozo.');
  select * into m from mesas where id = coalesce(m.junta_con, m.id) for update;
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
  insert into llamados (mesa_id) values (coalesce(m.junta_con, m.id)) on conflict (mesa_id) do nothing;
end $$;

-- ---------------------------------------------------------------- tableros: mesas que más rinden
-- Por mesa del salón: lo vendido, las veces que se ocupó, cubiertos, ticket y por cubierto, el tiempo promedio
-- y la plata por hora ocupada (lo que mejor dice qué mesa rinde). Aparte, lo vendido sin mesa.
create or replace function tablero_mesas(p_desde date, p_hasta date, p_f jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform exigir(es_gestion(), 'Los tableros son para dueños y encargados.');
  with tf as (select f.*, t.mesa_numero, t.mesa_nombre, t.mesas_juntas from tickets_filtrados(p_desde, p_hasta, coalesce(p_f, '{}')) f join tickets t on t.id = f.id),
  m as (
    select mesa_numero n, count(*) veces, sum(total) vendido, sum(comensales) cubiertos,
           sum(greatest(extract(epoch from hora - mesa_abierta) / 3600, 0.25)) filter (where mesa_abierta is not null) horas,
           avg(extract(epoch from hora - mesa_abierta) / 60) filter (where mesa_abierta is not null) minutos,
           count(*) filter (where mesas_juntas is not null) juntadas
    from tf where mesa_numero is not null group by 1
  ),
  s as (
    select split_part(coalesce(mesa_nombre, 'Cuenta aparte'), ' · ', 1) tipo, count(*) veces, sum(total) vendido from tf where mesa_numero is null group by 1
  )
  select jsonb_build_object(
    'mesas', coalesce((select jsonb_agg(jsonb_build_object('numero', n, 'veces', veces, 'vendido', vendido, 'cubiertos', cubiertos,
                          'ticket', round(vendido / veces), 'por_cubierto', case when cubiertos > 0 then round(vendido / cubiertos) end,
                          'minutos', round(minutos), 'por_hora', case when horas > 0 then round(vendido / horas) end, 'juntadas', juntadas)
                        order by vendido desc) from m), '[]'),
    'sin_mesa', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'veces', veces, 'vendido', vendido) order by vendido desc) from s), '[]'),
    'total', coalesce((select sum(total) from tf), 0))
  into r;
  return r;
end $$;

revoke execute on function juntar_mesas(bigint, bigint[]), separar_mesa(bigint), tablero_mesas(date, date, jsonb), mesa_principal(bigint) from public, anon;
grant execute on function juntar_mesas(bigint, bigint[]), separar_mesa(bigint), tablero_mesas(date, date, jsonb), mesa_principal(bigint) to authenticated, service_role;
grant execute on function pedir_desde_mesa(text, jsonb), llamar_mozo(text) to anon, authenticated;
