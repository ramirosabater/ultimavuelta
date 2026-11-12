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
