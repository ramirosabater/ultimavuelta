#!/usr/bin/env bash
# Levanta la facturación en la PC: ARCA simulado (:54333), Supabase mínimo (:54332) y la función "arca" con Deno (:54334)
set -e
cd "$(dirname "$0")"
node mock-arca.mjs > /tmp/mock-arca.log 2>&1 &
node mock-supabase.mjs > /tmp/mock-supabase.log 2>&1 &
SR=$(node jwt.mjs service_role); ANON=$(node jwt.mjs anon)
cd ../../../supabase/functions
SUPABASE_URL=http://localhost:54332 SUPABASE_SERVICE_ROLE_KEY=$SR SUPABASE_ANON_KEY=$ANON \
ARCA_WSAA_URL=http://localhost:54333/wsaa ARCA_WSFE_URL=http://localhost:54333/wsfe DENO_SERVE_ADDRESS=tcp:127.0.0.1:54334 \
  deno run -A arca/index.ts > /tmp/fn-arca.log 2>&1 &
wait
