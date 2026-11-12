#!/usr/bin/env bash
# Levanta la app contra el PostgREST local, una copia por rol: admin 5173, mozo 5174, cocina 5175, sin usuario (QR) 5176
set -e
cd "$(dirname "$0")"
ANON=$(node jwt.mjs anon)
cd ../../../web
for par in admin:5173 mozo:5174 cocina:5175 anon:5176; do
  rol=${par%%:*}; puerto=${par##*:}
  if [ "$rol" = anon ]; then jwt=""; else jwt=$(node ../pruebas/local/e2e/jwt.mjs "$rol"); fi
  POSTGREST_URL=http://localhost:54330 FUNCIONES_URL=http://localhost:54331 \
  VITE_SUPABASE_URL=http://localhost:$puerto VITE_SUPABASE_ANON_KEY=$ANON VITE_DEV_JWT=$jwt \
    npx vite --port "$puerto" --strictPort > "/tmp/vite-$rol.log" 2>&1 &
done
wait
