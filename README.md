# Última Vuelta · El bar de los Seba's

App para manejar el bar y parrilla de Rada Tilly: mesas y comandas, carta por QR, caja, stock con recetas,
compras con factura por foto o PDF, control semanal de pérdidas, administración y tableros. Con Chichito, el ayudante.

Stack: **Supabase** (Postgres, usuarios, tiempo real, funciones) + **Netlify** (app React). Igual que Serco.

```
supabase/migrations/
  20261029000001_esquema.sql      tablas, roles y permisos por fila (RLS), datos de base
  20261029000002_operacion.sql    salón, comandas, caja, compras, mermas, inventarios, recetas y plata (todo por funciones)
  20261029000003_tableros.sql     tableros con filtros, previsión de compras y control de inventario
  20261029000004_qr_y_ayudante.sql carta pública por QR, sugerencias y contexto de Chichito, permisos de funciones
supabase/functions/
  usuarios/                       invitar usuarios por mail (necesita la clave de servicio)
  ia/                             leer facturas (foto o PDF) y responder preguntas a Chichito con la API de Claude
puesta-en-marcha/                 SQL listo para pegar y la guía paso a paso (GUIA.md)
pruebas/local/                    base Postgres local, prueba por roles y recorrido de punta a punta con Playwright
web/                              la app (React 19 + Vite + TypeScript)
```

## Quién ve qué

| Rol | Ve |
|---|---|
| Dueño (`admin`) | Todo, incluidos usuarios y configuración |
| Encargado | Todo menos usuarios y configuración |
| Mozo | Mesas: abrir, cargar pedidos, confirmar los del QR, cobrar |
| Parrilla (`cocina`) / Barra | Su pantalla de comandas |
| Cliente (sin usuario) | La carta de su mesa por QR: pedir y llamar al mozo |

Los permisos están en la base (RLS + funciones `security definer`), no solo en la pantalla: un mozo no puede leer costos
ni tickets aunque lo intente desde afuera de la app, y el QR solo puede usar tres funciones con el código de su mesa.

## Cómo calcula

- **Jornada**: lo vendido antes de las 6 AM cuenta para la noche anterior (parámetro `corte_jornada`).
- **Costo de un plato** = Σ receta × cantidad limpia ÷ (1 − merma de limpieza) × costo del artículo.
  La merma de limpieza se mide con las pruebas de rendimiento.
- **Al cobrar** se descuentan del stock los artículos de cada plato y queda guardado el costo del ticket.
- **Control semanal**: entre dos inventarios completos, `inicial + compras − final − uso según ventas − mermas registradas`
  = lo que falta sin explicación, en kilos y en plata.
- **Qué comprar**: lo que se espera vender en los próximos días (promedio por día de la semana) + colchón − lo que hay,
  redondeado a la presentación del proveedor.

## Puesta en marcha

Seguir [`puesta-en-marcha/GUIA.md`](puesta-en-marcha/GUIA.md). `1-base.sql` es la concatenación de las 4 migraciones;
si se cambia una migración, regenerarlo con `cat supabase/migrations/*.sql`.

## Probar en la PC

```bash
cd web && npm install
# contra un proyecto Supabase: crear web/.env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Sin Supabase, con Postgres 16 y PostgREST locales (lo que se usó para probar):

```bash
pruebas/local/armar-base.sh                       # base "bar": migraciones + carta de ejemplo + 5 usuarios de prueba
psql -d bar -f pruebas/local/flujo.sql            # una noche completa rol por rol, por SQL → "TODO BIEN"
postgrest pruebas/local/e2e/postgrest.conf &      # API en :54330
node pruebas/local/e2e/mock-ia.mjs &              # imita la función ia en :54331
pruebas/local/e2e/levantar-vite.sh &              # la app por rol: dueño :5173, mozo :5174, parrilla :5175, QR :5176
node pruebas/local/e2e/recorrido.mjs              # todas las pantallas, PC y celular, sin errores
node pruebas/local/e2e/flujo-ui.mjs               # QR → mozo → parrilla → caja → gestión → Chichito, por la interfaz
```

`VITE_DEV_JWT` (solo en `localhost`) hace entrar directo con un usuario de prueba; en Netlify se ignora.
