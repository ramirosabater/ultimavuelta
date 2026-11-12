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
