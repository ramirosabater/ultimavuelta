# Puesta en marcha · Última Vuelta

Lleva una hora la primera vez. Se necesita: una cuenta de **Supabase** (gratis alcanza para arrancar),
una de **Netlify** (gratis), el repo en GitHub y, para leer facturas y que Chichito responda, una clave de la **API de Claude**.

## 1. Supabase: la base

1. En <https://supabase.com> → **New project**. Nombre `ultimavuelta`, región **São Paulo** (la más cerca de Rada Tilly). Guardá la contraseña de la base.
2. **SQL Editor** → New query → pegá todo `1-base.sql` → **Run**. Tiene que terminar sin errores.
3. (Opcional) Pegá `3-carta-de-ejemplo.sql` → Run. Carga una carta, artículos, recetas y proveedores de ejemplo para probar.
   Después se cambian desde la app.
4. **Authentication → Users → Add user → Create new user**: tu mail, una contraseña, tildá *Auto Confirm User*.
5. Abrí `2-primer-administrador.sql`, cambiá el mail y el nombre, pegalo en el SQL Editor → Run.
6. **Authentication → URL Configuration**:
   - *Site URL*: la dirección de Netlify (paso 3), por ejemplo `https://ultimavuelta.netlify.app`
   - *Redirect URLs*: agregá `https://ultimavuelta.netlify.app/elegir-clave`
7. **Project Settings → API**: copiá la *Project URL* y la clave *anon / publishable*. Van en Netlify.

## 2. Funciones (invitar usuarios, leer facturas, Chichito)

Desde una PC con el repo y la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <el-ref-del-proyecto>      # está en la URL: https://<ref>.supabase.co
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... APP_URL=https://ultimavuelta.netlify.app
supabase functions deploy usuarios ia
```

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
6. **Carta y QR → Mesas y QR**: ajustá las mesas e **imprimí los QR**.
7. **Administración → Usuarios**: invitá a los mozos, la parrilla y la barra. A cada uno le llega un mail para elegir su contraseña.

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

## Si algo falla

- **"Falta conectar con Supabase"** al abrir la app: faltan las dos variables en Netlify (o se cargaron después del deploy: hacé *Trigger deploy*).
- **El mail de invitación no llega**: revisar spam. El mail de Supabase gratis tiene un límite de pocos mails por hora;
  para más, en *Authentication → SMTP* se configura un servicio propio (Resend, por ejemplo).
- **"No hay conexión con el servidor"** al invitar o leer facturas: las funciones no están publicadas (paso 2).
- **Un QR dejó de andar**: alguien generó uno nuevo para esa mesa. Imprimilo de nuevo desde Mesas y QR.
