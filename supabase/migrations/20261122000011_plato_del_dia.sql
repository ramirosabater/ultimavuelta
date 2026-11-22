-- =====================================================================
-- Última Vuelta · Plato del día
--   Cargar el plato del día en un paso: nombre, qué lleva y precio; la receta la estima Chichito
--   (o se carga a mano) y los artículos que falten se crean solos. El del día anterior se pausa
--   y queda guardado con su receta para volver a ponerlo otro día.
--   Las recetas de cualquier plato también aceptan artículos nuevos.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

-- Receta: cada ingrediente es un artículo que ya existe {insumo_id, cantidad, cocido}
-- o uno nuevo {nuevo: {nombre, unidad, costo, merma_pct}, cantidad, cocido}, que se crea con stock en cero.
create or replace function guardar_receta(p_producto bigint, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  x jsonb; v_id bigint; v_nombre text;
  v_items jsonb := '[]'::jsonb;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados cambian recetas.');
  perform exigir(exists (select 1 from productos where id = p_producto), 'El plato no existe.');
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    continue when coalesce((x->>'cantidad')::numeric, 0) <= 0;
    v_id := (x->>'insumo_id')::bigint;
    if v_id is null and jsonb_typeof(x->'nuevo') = 'object' then
      v_nombre := btrim(regexp_replace(x->'nuevo'->>'nombre', '\s+', ' ', 'g'));
      perform exigir(coalesce(length(v_nombre), 0) between 2 and 80, 'Poné el nombre de cada artículo nuevo.');
      select id into v_id from insumos where lower(nombre) = lower(v_nombre);
      if v_id is null then
        insert into insumos (nombre, unidad, costo, merma_pct)
        values (upper(left(v_nombre, 1)) || substr(v_nombre, 2), coalesce(nullif(btrim(x->'nuevo'->>'unidad'), ''), 'kg'),
                greatest(coalesce((x->'nuevo'->>'costo')::numeric, 0), 0), least(greatest(coalesce((x->'nuevo'->>'merma_pct')::numeric, 0), 0), 90))
        returning id into v_id;
      else
        update insumos set activo = true where id = v_id and not activo;
      end if;
    end if;
    perform exigir(v_id is not null and exists (select 1 from insumos where id = v_id), 'Hay un ingrediente sin artículo.');
    v_items := v_items || jsonb_build_object('insumo_id', v_id, 'cantidad', (x->>'cantidad')::numeric, 'cocido', coalesce((x->>'cocido')::boolean, false));
  end loop;
  delete from receta_items where producto_id = p_producto;
  insert into receta_items (producto_id, insumo_id, cantidad, cocido)
  select p_producto, (e->>'insumo_id')::bigint, sum((e->>'cantidad')::numeric), bool_or((e->>'cocido')::boolean)
  from jsonb_array_elements(v_items) e group by 2;
end $$;

-- La categoría del plato del día (va primera en la carta). La crea si no está.
create or replace function categoria_plato_del_dia() returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  select id into v from categorias where nombre = 'Plato del día';
  if v is null then
    insert into categorias (nombre, estacion, orden) values ('Plato del día', 'cocina', 0) returning id into v;
  end if;
  return v;
end $$;

-- Cargar (o volver a poner) el plato del día. p_producto: uno que ya se hizo antes, para reusarlo.
-- p_items null: deja la receta que tenía. Devuelve el id del plato.
create or replace function guardar_plato_del_dia(p_nombre text, p_descripcion text, p_precio numeric, p_items jsonb default null,
                                                 p_sacar_anterior boolean default true, p_producto bigint default null) returns bigint
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
    insert into productos (nombre, descripcion, categoria_id, precio, estacion)
    values (v_nombre, nullif(btrim(p_descripcion), ''), v_cat, p_precio, 'cocina') returning id into v_id;
  else
    update productos set nombre = v_nombre, descripcion = nullif(btrim(p_descripcion), ''), precio = p_precio, categoria_id = v_cat, activo = true
    where id = v_id;
    perform exigir(found, 'Ese plato ya no existe.');
  end if;
  if p_items is not null then perform guardar_receta(v_id, p_items); end if;
  if p_sacar_anterior then
    update productos set activo = false where categoria_id = v_cat and activo and id <> v_id;
  end if;
  return v_id;
end $$;

revoke execute on function categoria_plato_del_dia() from public, anon, authenticated;
grant execute on function guardar_receta(bigint, jsonb), guardar_plato_del_dia(text, text, numeric, jsonb, boolean, bigint) to authenticated, service_role;
revoke execute on function guardar_receta(bigint, jsonb), guardar_plato_del_dia(text, text, numeric, jsonb, boolean, bigint) from public, anon;
