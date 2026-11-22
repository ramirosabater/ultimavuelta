-- =====================================================================
-- Última Vuelta · La semana de platos del día
--   Se planifica qué plato del día va cada día y cuántas porciones (la app sugiere según lo vendido).
--   Con eso: el plato se pone solo en la carta el día que toca, la lista de compras suma lo que lleva,
--   y se ve lo que hay que comprar para toda la semana.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez), después del 06.
-- =====================================================================

create table if not exists platos_semana (
  fecha       date primary key,                                   -- la jornada
  producto_id bigint not null references productos(id) on delete cascade,
  porciones   int not null check (porciones between 1 and 500),
  aplicado    boolean not null default false,                     -- ya se puso en la carta ese día
  usuario_id  uuid references perfiles(id) on delete set null,
  creado      timestamptz not null default now()
);
alter table platos_semana enable row level security;
drop policy if exists platos_semana_leer on platos_semana;
drop policy if exists platos_semana_gestion on platos_semana;
create policy platos_semana_leer    on platos_semana for select using ((select es_salon()));
create policy platos_semana_gestion on platos_semana for all using ((select es_gestion())) with check ((select es_gestion()));
revoke all on platos_semana from anon;
grant select, insert, update, delete on platos_semana to authenticated;

-- ¿Ese día está cerrado? (Configuración → días que no abren)
create or replace function dia_cerrado(p_fecha date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(dow from p_fecha)::int::text = any (string_to_array(replace(param('dias_cerrado', ''), ' ', ''), ','))
$$;

-- Porciones de plato del día que se suelen vender ese día de la semana (últimas 4 iguales; si no, últimas 14 noches; si no, 15)
create or replace function porciones_plato_sugeridas(p_fecha date) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_cat bigint := (select id from categorias where nombre = 'Plato del día'); v numeric;
begin
  with noches as (
    select t.jornada, coalesce(sum(ti.cantidad) filter (where p.categoria_id = v_cat), 0) n
    from tickets t join ticket_items ti on ti.ticket_id = t.id left join productos p on p.id = ti.producto_id
    where t.jornada < jornada_actual() and t.jornada >= jornada_actual() - 70 group by t.jornada)
  select coalesce(
    (select avg(n) from (select n from noches where extract(dow from jornada) = extract(dow from p_fecha) and n > 0 order by jornada desc limit 4) z),
    (select avg(n) from (select n from noches where n > 0 order by jornada desc limit 14) z)) into v;
  return greatest(1, ceil(coalesce(v, 15)))::int;
end $$;

-- Pone en la carta el plato planificado para hoy (una sola vez por día: si después lo pausan porque se acabó, queda pausado)
create or replace function aplicar_plato_del_dia() returns text
language plpgsql security definer set search_path = public as $$
declare v_plan platos_semana; v_cat bigint := (select id from categorias where nombre = 'Plato del día'); v_nombre text;
begin
  if auth.uid() is null then return null; end if;
  select * into v_plan from platos_semana where fecha = jornada_actual() and not aplicado for update skip locked;
  if not found then return null; end if;
  update productos set activo = (id = v_plan.producto_id) where categoria_id = v_cat and (activo or id = v_plan.producto_id);
  update categorias set activa = true where id = v_cat and not activa;
  update platos_semana set aplicado = true where fecha = v_plan.fecha;
  select nombre into v_nombre from productos where id = v_plan.producto_id;
  return v_nombre;
end $$;

-- Planificar un día: elegir el plato y las porciones. p_producto null: saca el plan de ese día.
create or replace function planificar_plato(p_fecha date, p_producto bigint, p_porciones int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados planifican los platos del día.');
  perform exigir(p_fecha >= jornada_actual(), 'Ese día ya pasó.');
  if p_producto is null then delete from platos_semana where fecha = p_fecha; return; end if;
  perform exigir(exists (select 1 from productos p join categorias c on c.id = p.categoria_id where p.id = p_producto and c.nombre = 'Plato del día'),
                 'Elegí un plato del día.');
  perform exigir(coalesce(p_porciones, 1) between 1 and 500, 'Las porciones van de 1 a 500.');
  insert into platos_semana (fecha, producto_id, porciones, usuario_id)
  values (p_fecha, p_producto, coalesce(p_porciones, porciones_plato_sugeridas(p_fecha)), auth.uid())
  on conflict (fecha) do update set
    porciones = coalesce(p_porciones, case when platos_semana.producto_id = excluded.producto_id then platos_semana.porciones else excluded.porciones end),
    aplicado = platos_semana.aplicado and platos_semana.producto_id = excluded.producto_id,
    producto_id = excluded.producto_id, usuario_id = excluded.usuario_id;
  if p_fecha = jornada_actual() then perform aplicar_plato_del_dia(); end if;
end $$;

-- Plato del día: ahora también se puede guardar sin ponerlo en la carta (p_activar false, para planificar)
-- y el que se pone hoy a mano queda como el plan de hoy.
drop function if exists guardar_plato_del_dia(text, text, numeric, jsonb, boolean, bigint);
create or replace function guardar_plato_del_dia(p_nombre text, p_descripcion text, p_precio numeric, p_items jsonb default null,
                                                 p_sacar_anterior boolean default true, p_producto bigint default null,
                                                 p_activar boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_cat bigint; v_id bigint; v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cargan el plato del día.');
  perform exigir(length(v_nombre) between 2 and 80, 'Poné el nombre del plato.');
  perform exigir(coalesce(p_precio, -1) >= 0, 'Poné el precio.');
  v_cat := categoria_plato_del_dia();
  update categorias set activa = true where id = v_cat and not activa;
  v_id := p_producto;
  if v_id is null then   -- si ya se hizo uno con el mismo nombre, se reusa
    select id into v_id from productos where categoria_id = v_cat and lower(nombre) = lower(v_nombre) order by id desc limit 1;
  end if;
  if v_id is null then
    insert into productos (nombre, descripcion, categoria_id, precio, estacion, activo)
    values (v_nombre, nullif(btrim(p_descripcion), ''), v_cat, p_precio, 'cocina', p_activar) returning id into v_id;
  else
    update productos set nombre = v_nombre, descripcion = nullif(btrim(p_descripcion), ''), precio = p_precio, categoria_id = v_cat,
                         activo = activo or p_activar
    where id = v_id;
    perform exigir(found, 'Ese plato ya no existe.');
  end if;
  if p_items is not null then perform guardar_receta(v_id, p_items); end if;
  if p_activar then
    if p_sacar_anterior then
      update productos set activo = false where categoria_id = v_cat and activo and id <> v_id;
    end if;
    insert into platos_semana (fecha, producto_id, porciones, aplicado, usuario_id)
    values (jornada_actual(), v_id, porciones_plato_sugeridas(jornada_actual()), true, auth.uid())
    on conflict (fecha) do update set aplicado = true,
      porciones = case when platos_semana.producto_id = excluded.producto_id then platos_semana.porciones else excluded.porciones end,
      producto_id = excluded.producto_id;
  end if;
  return v_id;
end $$;

-- La semana: 7 días desde p_desde, con el plan, lo vendido y lo que hay que comprar para lo que falta
create or replace function semana_platos(p_desde date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_desde date := coalesce(p_desde, jornada_actual()); v_hoy date := jornada_actual();
        v_cat bigint := (select id from categorias where nombre = 'Plato del día'); r jsonb;
begin
  perform exigir(es_gestion(), 'La semana de platos es para dueños y encargados.');
  with dias as (select (v_desde + k)::date fecha from generate_series(0, 6) k),
       necesita as (
         select x.insumo_id, sum(ps.porciones * crudo(x.cantidad, x.cocido, i.merma_pct, i.rinde_coccion)) q
         from platos_semana ps join receta_items x on x.producto_id = ps.producto_id join insumos i on i.id = x.insumo_id
         where ps.fecha between greatest(v_desde, v_hoy) and v_desde + 6 group by 1)
  select jsonb_build_object(
    'desde', v_desde, 'hoy', v_hoy,
    'dias', (select jsonb_agg(jsonb_build_object(
        'fecha', d.fecha, 'cerrado', dia_cerrado(d.fecha), 'pasado', d.fecha < v_hoy,
        'producto_id', ps.producto_id, 'porciones', ps.porciones, 'aplicado', ps.aplicado,
        'sugerido', case when d.fecha >= v_hoy and not dia_cerrado(d.fecha) then porciones_plato_sugeridas(d.fecha) end,
        'vendidos', case when d.fecha <= v_hoy and ps.producto_id is not null then
                      (select coalesce(sum(ti.cantidad), 0) from ticket_items ti join tickets t on t.id = ti.ticket_id
                       where t.jornada = d.fecha and ti.producto_id = ps.producto_id) end
      ) order by d.fecha) from dias d left join platos_semana ps on ps.fecha = d.fecha),
    'platos', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio', p.precio, 'activo', p.activo,
                       'costo', round(costo_receta(p.id), 2), 'con_receta', exists (select 1 from receta_items where producto_id = p.id),
                       'veces', (select count(*) from platos_semana where producto_id = p.id)) order by p.nombre), '[]')
               from productos p where p.categoria_id = v_cat),
    'compras', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'unidad', i.unidad, 'necesita', round(n.q, 3),
                       'hay', i.cantidad, 'pack', i.pack, 'pack_nombre', i.pack_nombre, 'costo', i.costo, 'proveedor', pr.nombre) order by pr.nombre nulls last, i.nombre), '[]')
                from necesita n join insumos i on i.id = n.insumo_id left join proveedores pr on pr.id = i.proveedor_id)
  ) into r;
  return r;
end $$;

-- Previsión de compras: el plato del día ya no se estima por lo vendido (cambia cada día) sino por lo planificado
create or replace function porciones_esperadas(p_fecha date) returns table (producto_id bigint, cantidad numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_dias date[]; v_dow int := extract(dow from p_fecha)::int; v_cat bigint := (select id from categorias where nombre = 'Plato del día');
begin
  if dia_cerrado(p_fecha) then return; end if;
  select array_agg(jornada order by jornada desc) into v_dias from
    (select distinct jornada from tickets where jornada < jornada_actual() and jornada >= jornada_actual() - 70
     and extract(dow from jornada)::int = v_dow order by jornada desc limit 4) z;
  if v_dias is null then
    select array_agg(jornada) into v_dias from
      (select distinct jornada from tickets where jornada < jornada_actual() order by jornada desc limit 14) z;
  end if;
  if v_dias is not null then
    return query
      select ti.producto_id, sum(ti.cantidad)::numeric / array_length(v_dias, 1)
      from ticket_items ti join tickets t on t.id = ti.ticket_id join productos p on p.id = ti.producto_id
      where t.jornada = any (v_dias) and p.categoria_id is distinct from v_cat group by ti.producto_id;
  end if;
  return query select ps.producto_id, ps.porciones::numeric from platos_semana ps where ps.fecha = p_fecha;
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
    'historial', exists (select 1 from tickets where jornada < v_hoy) or exists (select 1 from platos_semana where fecha between v_hoy and v_hoy + v_n - 1),
    'dias', v_n,
    'cerrado_hoy', dia_cerrado(v_hoy),
    'dow', extract(dow from v_hoy)::int,
    'platos_hoy', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'estacion', p.estacion, 'cantidad', round(h.cantidad, 1)) order by h.cantidad desc), '[]')
                   from hoy h join productos p on p.id = h.producto_id),
    'insumos_hoy', (select coalesce(jsonb_agg(jsonb_build_object('id', insumo_id, 'uso', round(u, 3)) order by u desc), '[]') from uso_hoy),
    'insumos', (select coalesce(jsonb_object_agg(insumo_id::text, round(u, 3)), '{}') from uso)
  ) into r;
  return r;
end $$;

revoke execute on function dia_cerrado(date), porciones_plato_sugeridas(date), aplicar_plato_del_dia(), planificar_plato(date, bigint, int),
  guardar_plato_del_dia(text, text, numeric, jsonb, boolean, bigint, boolean), semana_platos(date) from public, anon;
grant execute on function dia_cerrado(date), porciones_plato_sugeridas(date), aplicar_plato_del_dia(), planificar_plato(date, bigint, int),
  guardar_plato_del_dia(text, text, numeric, jsonb, boolean, bigint, boolean), semana_platos(date) to authenticated, service_role;
