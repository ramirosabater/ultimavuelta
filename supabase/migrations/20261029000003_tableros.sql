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
