# Puesta en marcha · Última Vuelta

Lleva una hora la primera vez. Se necesita: una cuenta de **Supabase** (gratis alcanza para arrancar),
una de **Netlify** (gratis), el repo en GitHub y, para leer facturas y que Chichito responda, una clave de la **API de Claude**.

## 1. Supabase: la base

1. En <https://supabase.com> → **New project**. Nombre `ultimavuelta`, región **São Paulo** (la más cerca de Rada Tilly). Guardá la contraseña de la base.
2. **SQL Editor** → New query → pegá todo `1-base.sql` (trae también la tabla de referencia de rendimientos) → **Run**. Tiene que terminar sin errores.
3. Pegá `3-carta.sql` → Run. Carga la carta de Última Vuelta (pizzas, hamburguesas, sándwiches, papas, ensaladas, entradas, postres y bebidas) con sus recetas, artículos y proveedores. **Precios, costos y porciones son estimados**: corríjanlos en la app. Si ya tenían cargada la carta de ejemplo, sus platos de parrilla quedan pausados. Si están cargados los datos de prueba, primero borralos (`6-borrar-datos-de-prueba.sql`).
   Después se cambian desde la app.
4. **Authentication → Users → Add user → Create new user**: tu mail, una contraseña, tildá *Auto Confirm User*.
5. Abrí `2-primer-administrador.sql`, cambiá el mail y el nombre, pegalo en el SQL Editor → Run.
6. **Authentication → URL Configuration**:
   - *Site URL*: la dirección de Netlify (paso 3), por ejemplo `https://ultimavuelta.netlify.app`
   - *Redirect URLs*: agregá `https://ultimavuelta.netlify.app/elegir-clave`
7. **Project Settings → API**: copiá la *Project URL* y la clave *anon / publishable*. Van en Netlify.

## 2. Funciones (invitar usuarios, leer facturas, Chichito)

Todo desde la página de Supabase, sin instalar nada:

1. **Edge Functions → Deploy a new function → Via Editor**. Nombre: `usuarios`. Borrá el ejemplo, pegá todo
   `puesta-en-marcha/funciones/usuarios.ts` y tocá **Deploy function**.
2. Lo mismo con el nombre `ia` y el archivo `puesta-en-marcha/funciones/ia.ts`.
3. **Edge Functions → Secrets → Add new secret**:
   - `ANTHROPIC_API_KEY` = la clave de la API de Claude
   - `APP_URL` = la dirección de Netlify, por ejemplo `https://ultimavuelta.netlify.app`

(Con la [CLI de Supabase](https://supabase.com/docs/guides/cli) también se puede: `supabase functions deploy usuarios ia`
y `supabase secrets set ...` desde la carpeta del repo.)

- `ANTHROPIC_API_KEY`: se saca en <https://console.anthropic.com> → API Keys. Cargá un poco de crédito; una factura cuesta
  unos pocos centavos de dólar y una pregunta a Chichito menos.
- Opcional: `IA_MODELO_FACTURA` (por defecto `claude-sonnet-5-5`) e `IA_MODELO_PREGUNTAS` (por defecto `claude-haiku-5-5`).
- Sin la clave la app funciona igual: solo no lee facturas por foto y Chichito no responde preguntas libres
  (las sugerencias y los recorridos sí andan).

## 3. Netlify: la app

1. <https://app.netlify.com> → **Add new site → Import an existing project** → GitHub → `ultimavuelta`.
2. Configuración del build (ya está en `web/netlify.toml`, solo confirmá):
   - Base directory: `web` · Build command: `npm run build` · Publish directory: `web/dist`
3. **Environment variables**:
   - `VITE_SUPABASE_URL` = la Project URL
   - `VITE_SUPABASE_ANON_KEY` = la clave anon / publishable
4. **Logo**: está en `web/public/logo.webp` (y los íconos `favicon.png` e `icono-192.png`). Para cambiarlo, reemplazá esos archivos.
5. **Deploy**. En *Site configuration → Change site name* poné `ultimavuelta` (o el nombre que quieran; si cambia,
   actualizá la *Site URL*, las *Redirect URLs* y `APP_URL`).

## 4. Primer uso

1. Entrá con tu mail y contraseña. Chichito te saluda.
2. **Administración → Configuración**: nombre, hora de corte de la jornada (6 AM), días que no abren, colchón de compras.
3. **Administración → Cuentas**: saldo inicial de la caja, el banco y Mercado Pago. Revisá a qué cuenta entra cada medio de pago.
4. **Administración → Proveedores** y **Stock → Artículos**: lo que compran, con costo, mínimo y merma de limpieza.
5. **Carta y QR → Carta**: productos y precios. **Stock → Recetas**: cuánto lleva cada plato (así sale el costo).
   **Plato del día** (en Carta): nombre, qué lleva y precio; "Que Chichito calcule la receta" pone las cantidades (revisalas) y sugiere un precio. El del día anterior se pausa y queda para volver a ponerlo con un toque. El mismo botón está al editar cualquier receta.
   **Carta y QR → Platos del día**: la semana. Para cada día se elige el plato y las porciones (la app sugiere según lo vendido ese día de la semana). El día que toca se pone solo en la carta. Abajo está lo que hay que comprar para esos platos, con "Copiar lista" para WhatsApp; la lista general de Stock → Compras también los suma.
6. **Carta y QR → Mesas y QR**: ajustá las mesas e **imprimí los QR**.
7. **Administración → Usuarios**: invitá a los mozos, la parrilla y la barra. A cada uno le llega un mail para elegir su contraseña.
8. **Administración → Configuración → Reservas**: horarios, lugares por horario, máximo de personas y el WhatsApp del local.
   Después, en **Reservas → Link y QR para clientes**, copiá el link (`/reservar`) para Instagram y WhatsApp o bajá el QR para la puerta.

## Actualizaciones

Cuando la app suma algo que necesita cambios en la base, viene un archivo en `puesta-en-marcha/actualizaciones/`.
Se pega **una sola vez**, en orden, en **SQL Editor → New query → Run**. La app en Netlify se actualiza sola.
(Una base nueva no los necesita: `1-base.sql` ya los trae.)

| Archivo | Qué agrega |
|---|---|
| `01-reservas.sql` | Reservas: página pública para clientes, cupo por horario, confirmar por WhatsApp y sentar en una mesa |
| `02-facturacion.sql` | Factura electrónica con ARCA (después, publicar la función `arca`: ver abajo) |
| `03-sin-factura.sql` | Cobrar sin factura: la venta queda marcada y no aparece como pendiente |
| `04-anular-compra.sql` | Compras: cargar a mano con varios artículos y anular una compra mal cargada |
| `05-pedidos.sql` | Pedidos: para llevar, delivery y barra; sacar, invitar o pasar productos; separar la cuenta; cobrar con varios medios y propina |
| `06-plato-del-dia.sql` | Plato del día con receta calculada por Chichito; recetas con artículos nuevos (después, volver a publicar la función `ia` con `funciones/ia.ts`) |
| `07-semana-platos.sql` | La semana de platos del día: plato y porciones por día, se pone solo en la carta el día que toca, y suma a la lista de compras |
| `08-ticket-gastos-fijos.sql` | Ticket impreso al cobrar (y reimprimir desde la Caja); gastos fijos mensuales que se generan solos; artículos de limpieza, descartables y del local en la tabla de referencia, y agregar propios |
| `09-juntar-mesas-tableros.sql` | Juntar mesas para grupos grandes; ranking de mesas que más rinden para los tableros nuevos (después, volver a publicar la función `ia`) |
| `10-registro.sql` | Registro de todo lo que pasa (Administración → Registro, solo dueños): quién, qué, cuándo y qué cambió; lo sensible marcado aparte |

## Datos de prueba (para mostrar la app)
- `5-datos-de-prueba.sql`: carga nueve semanas de movimiento inventado (ventas, caja, compras, gastos, mermas, control semanal, reservas y mesas abiertas ahora). Si la carta está vacía, carga la de `3-carta.sql`. Antes tienen que estar pegadas las actualizaciones 01 a 07.
- `6-borrar-datos-de-prueba.sql`: saca todo eso y deja la base como estaba. Correlo antes de empezar a usar la app de verdad.

## Factura electrónica (ARCA)

Monotributo: la app hace **Factura C** al cobrar cada mesa, directo con ARCA, con CAE y QR.

1. **Supabase → Edge Functions → Deploy a new function → Via Editor**. Nombre: `arca`. Pegá todo `puesta-en-marcha/funciones/arca.ts`
   → **Deploy function**. No necesita secretos nuevos.
2. En la app, **Administración → Facturación** (solo dueños), los cuatro pasos:
   1. Datos del bar: CUIT y razón social del titular del monotributo, domicilio comercial, ingresos brutos, inicio de actividades
      y el punto de venta para Web Services.
   2. Certificado: bajar el pedido (`ultimavuelta.csr`), sacar el certificado en ARCA (los pasos están en la misma pantalla,
      "Cómo se saca el certificado en ARCA") y subir el `.crt`. Primero el de **prueba (homologación)**.
   3. Probar la conexión.
   4. Activar. Hacer unas facturas de prueba cobrando mesas. Cuando todo esté bien: sacar el certificado de producción,
      crear el punto de venta real, cargarlo, pasar a **Real (producción)** y probar de nuevo.
3. Si ARCA está caído al cobrar, la mesa se cobra igual y la factura queda **pendiente**: en **Caja**, columna Factura → Reintentar.
   Chichito avisa si quedan ventas sin factura. **Anular** hace la nota de crédito.
4. Las ventas que no se facturan: al cobrar, destildar **Hacer Factura C** (botón **Cobrar sin factura**). Quedan marcadas
   "Sin factura" en la Caja (se pueden facturar después) y no cuentan como pendientes. Si la mayoría no se factura, en
   Facturación se destilda "Al cobrar, la factura viene tildada".

## "No soy un robot" en el ingreso (Cloudflare Turnstile)

Es gratis. Se hace en este orden, porque si se activa en Supabase antes de que la app muestre el cuadrito, nadie puede entrar.

1. **Cloudflare** (dash.cloudflare.com, crear cuenta si no hay) → **Turnstile** → **Add widget**: nombre "Última Vuelta", dominio `ultimavuelta.netlify.app`, modo **Managed**. Da dos claves: la **Site key** (pública) y la **Secret key** (privada).
2. **Netlify** → el sitio → **Site configuration → Environment variables** → agregar `VITE_TURNSTILE_SITE_KEY` con la **Site key**. Después **Deploys → Trigger deploy → Clear cache and deploy site**. Abrir la app en una ventana de incógnito: en el ingreso tiene que aparecer el cuadrito.
3. **Supabase** → **Authentication → Attack Protection** (o *Bot and Abuse Protection*) → **Enable CAPTCHA protection** → proveedor **Turnstile** → pegar la **Secret key** → **Save**.

Para sacarlo: primero se apaga en Supabase y después se borra la variable en Netlify. Además, tras 5 contraseñas mal seguidas la app hace esperar un minuto.

## Rutina recomendada

| Cuándo | Qué | Dónde |
|---|---|---|
| Cada noche al abrir | Abrir la caja con el efectivo inicial | Caja |
| Cada noche al cerrar | Contar la plata y cerrar la caja | Caja |
| Cuando llega mercadería | Cargar la factura (foto o PDF) | Stock → Compras |
| Cuando se tira algo | Registrar la merma con el motivo | Stock → Mermas |
| Cuando llega carne | Prueba de rendimiento: pesar crudo y limpio | Stock → Rendimientos |
| Una vez por semana, al cierre | Inventario completo | Stock → Control semanal |
| Una vez por semana | Mirar Costos y desperdicio | Tableros |
| Cada tarde | Confirmar las reservas que entraron por la página | Reservas |
| Al cierre | Revisar que no queden mesas sin factura | Caja |

## Si algo falla

- **"Falta conectar con Supabase"** al abrir la app: faltan las dos variables en Netlify (o se cargaron después del deploy: hacé *Trigger deploy*).
- **El mail de invitación no llega**: revisar spam. El mail de Supabase gratis tiene un límite de pocos mails por hora;
  para más, en *Authentication → SMTP* se configura un servicio propio (Resend, por ejemplo).
- **"No hay conexión con el servidor"** al invitar o leer facturas: las funciones no están publicadas (paso 2).
- **Un QR dejó de andar**: alguien generó uno nuevo para esa mesa. Imprimilo de nuevo desde Mesas y QR.
