#!/usr/bin/env bash
# Arma la base local de prueba desde cero: Supabase simulado + migraciones + carta de ejemplo + usuarios.
# Uso: pruebas/local/armar-base.sh   (con Postgres escuchando en PGHOST/PGPORT)
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-54329} PGUSER=${PGUSER:-postgres}
BASE=${BASE:-bar}
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $BASE with (force)" -c "create database $BASE"
$P -d postgres -c "do \$\$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    drop owned by anon, authenticated, service_role, authenticator cascade;
    drop role authenticator; drop role anon; drop role authenticated; drop role service_role;
  end if; end \$\$" >/dev/null 2>&1 || true
$P -d $BASE -f pruebas/local/supabase-simulado.sql
for f in supabase/migrations/*.sql; do $P -d $BASE -f "$f"; done
$P -d $BASE -f puesta-en-marcha/3-carta-de-ejemplo.sql
$P -d $BASE -f pruebas/local/usuarios-de-prueba.sql
echo "Base $BASE lista."
