#!/usr/bin/env bash
# Arma puesta-en-marcha/5-datos-de-prueba.sql: preparar + carta de ejemplo + generar
cd "$(dirname "$0")/../.."
{ cat pruebas/demo/parte-1-preparar.sql; sed -n '/^insert into proveedores/,$p' puesta-en-marcha/3-carta-de-ejemplo.sql; cat pruebas/demo/parte-2-generar.sql; } > puesta-en-marcha/5-datos-de-prueba.sql
