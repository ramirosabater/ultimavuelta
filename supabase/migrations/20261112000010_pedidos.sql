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
