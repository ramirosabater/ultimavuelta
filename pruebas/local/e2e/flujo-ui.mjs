// Una noche por la interfaz: el cliente pide por QR, el mozo confirma y abre otra mesa,
// la parrilla prepara, la caja cobra, y gestión carga proveedor, gasto, producto y le pregunta a Chichito.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const sql = (q) => execSync(`psql -h /tmp -p 54329 -U postgres -d bar -Atc "${q.replace(/"/g, '\\"')}"`).toString().trim()
const OUT = '/tmp/capturas/flujo'; execSync(`mkdir -p ${OUT}`)
const b = await chromium.launch()
const errores = []
async function pagina(puerto, movil = false) {
  const ctx = await b.newContext(movil ? { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1360, height: 900 } })
  await ctx.addInitScript(() => { try { for (const n of [1, 2, 3, 4, 5]) localStorage.setItem(`uv-hola-00000000-0000-0000-0000-00000000000${n}`, '1') } catch {} })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errores.push(`${puerto} js: ${e.message}`))
  p.on('response', async (r) => { if (r.status() >= 400 && !/realtime|fonts/.test(r.url())) errores.push(`${puerto} red ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${(await r.text().catch(() => '')).slice(0, 160)}`) })
  p.on('dialog', (d) => d.accept())
  return p
}
const paso = (t) => console.log('→ ' + t)
const toast = async (p) => (await p.locator('.toast').first().textContent({ timeout: 5000 }).catch(() => '(sin aviso)'))

// 1. Cliente en la mesa 5, desde el celular
const token = sql("select token from mesas where numero = 5")
const cli = await pagina(5176, true)
await cli.goto(`http://localhost:5176/m/${token}`, { waitUntil: 'networkidle' })
paso('QR: carta cargada, mesa ' + await cli.locator('.pub-mesa').textContent())
await cli.getByRole('button', { name: 'Agregar Vacío', exact: true }).click()
await cli.getByRole('button', { name: 'Agregar otro Vacío' }).click()
await cli.getByRole('button', { name: 'Agregar Fernet con cola', exact: true }).click()
await cli.getByRole('button', { name: /Ver pedido/ }).click()
await cli.getByPlaceholder(/Aclaración/).first().fill('uno jugoso')
await cli.screenshot({ path: `${OUT}/1-qr-pedido.png` })
await cli.getByRole('button', { name: 'Pedir', exact: true }).click()
paso('QR pedido: ' + await toast(cli))
await cli.getByRole('button', { name: 'Llamar al mozo' }).click()
await cli.waitForTimeout(400); paso('QR llamar: ' + await cli.getByRole('button', { name: /mozo/ }).textContent())
await cli.waitForTimeout(500); await cli.screenshot({ path: `${OUT}/2-qr-estado.png` })

// 2. Mozo confirma el pedido del QR y abre la mesa 6
const mozo = await pagina(5174, true)
await mozo.goto('http://localhost:5174/mesas', { waitUntil: 'networkidle' })
await mozo.screenshot({ path: `${OUT}/3-mozo-avisos.png` })
await mozo.getByRole('button', { name: 'Mesa 5', exact: true }).click()
await mozo.getByRole('button', { name: 'Confirmar', exact: true }).first().click()
paso('Mozo confirma QR: ' + await toast(mozo))
await mozo.getByRole('button', { name: 'Atendido' }).first().click().catch(() => paso('(sin botón Atendido)'))
await mozo.getByRole('button', { name: 'Mesa 6', exact: true }).click()
await mozo.getByRole('button', { name: 'Abrir mesa' }).click()
await mozo.locator('#am-comensales').fill('4')
await mozo.getByRole('button', { name: 'Abrir y cargar pedido' }).click()
await mozo.locator('#ped-buscar').fill('parrillada'); await mozo.getByRole('button', { name: 'Agregar Parrillada para 2' }).click()
await mozo.locator('#ped-buscar').fill('ipa'); await mozo.getByRole('button', { name: 'Agregar Pinta IPA tirada' }).click()
await mozo.getByRole('button', { name: 'Enviar comanda' }).click()
paso('Mozo mesa 6: ' + await toast(mozo))

// 3. Parrilla
const parr = await pagina(5175)
await parr.goto('http://localhost:5175/cocina', { waitUntil: 'networkidle' })
await parr.screenshot({ path: `${OUT}/4-parrilla.png` })
let n = await parr.getByRole('button', { name: 'Empezar' }).count()
for (let i = 0; i < n; i++) { await parr.getByRole('button', { name: 'Empezar' }).first().click(); await parr.waitForTimeout(400) }
n = await parr.getByRole('button', { name: 'Listo para servir' }).count()
for (let i = 0; i < n; i++) { await parr.getByRole('button', { name: 'Listo para servir' }).first().click(); await parr.waitForTimeout(400) }
paso(`Parrilla: ${n} comandas listas → estados ${sql("select string_agg(coalesce(est_cocina::text,'-'),',') from pedidos where ticket_id is null")}`)

// 4. Caja cobra la mesa 5
const adm = await pagina(5173)
await adm.goto('http://localhost:5173/caja', { waitUntil: 'networkidle' })
await adm.screenshot({ path: `${OUT}/5-caja.png`, fullPage: true })
const antes = sql('select count(*) from tickets')
await adm.locator('[data-ayuda="por-cobrar"]').getByRole('button', { name: 'Cobrar' }).first().click()
await adm.locator('#c-medios button').first().click()
await adm.getByRole('button', { name: 'Confirmar cobro' }).click()
paso('Caja: ' + await toast(adm) + ` · tickets ${antes} → ${sql('select count(*) from tickets')}`)

// 5. Gestión: proveedor, gasto pendiente y pago, producto, configuración
await adm.goto('http://localhost:5173/admin/proveedores', { waitUntil: 'networkidle' })
await adm.getByRole('button', { name: 'Nuevo proveedor' }).click()
await adm.locator('#p-nom').fill('Frigorífico Sur'); await adm.locator('#p-plazo').fill('15'); await adm.locator('#p-tel').fill('+54 297 555-1234')
await adm.getByRole('button', { name: 'Guardar' }).click(); paso('Proveedor: ' + await toast(adm))
await adm.goto('http://localhost:5173/admin/gastos', { waitUntil: 'networkidle' })
await adm.getByRole('button', { name: 'Nuevo gasto' }).click()
await adm.locator('#g-concepto').fill('Media res'); await adm.locator('#g-monto').fill('250000')
await adm.locator('#g-prov').selectOption({ label: 'Frigorífico Sur' })
paso('Gasto: el plazo del proveedor lo dejó ' + await adm.locator('#g-pago').inputValue() + ' con vence ' + await adm.locator('#g-vence').inputValue())
await adm.getByRole('button', { name: 'Guardar' }).click(); paso('Gasto: ' + await toast(adm))
await adm.locator('[data-ayuda="por-pagar"]').getByRole('button', { name: 'Pagar' }).first().click()
await adm.locator('#pg-cuenta').selectOption({ label: 'Banco' })
await adm.getByRole('button', { name: /^Pagar \$/ }).click(); paso('Pago: ' + await toast(adm) + ' · pendientes ' + sql("select count(*) from gastos where estado='pendiente'"))
await adm.goto('http://localhost:5173/carta', { waitUntil: 'networkidle' })
await adm.getByRole('button', { name: 'Nuevo producto' }).click()
await adm.locator('#pr-nom').fill('Provoleta'); await adm.locator('#pr-precio').fill('8500'); await adm.locator('#pr-cat').selectOption({ label: 'Entradas' })
await adm.getByRole('button', { name: 'Guardar' }).click(); paso('Producto: ' + await toast(adm))
await adm.getByRole('row', { name: /Provoleta/ }).getByRole('button', { name: 'Pausar' }).click(); paso('Pausar: ' + await toast(adm))
await adm.goto('http://localhost:5173/admin/configuracion', { waitUntil: 'networkidle' })
await adm.locator('#cfg-colchon_pct').fill('20'); await adm.getByRole('button', { name: 'Guardar cambios' }).click(); paso('Config: ' + await toast(adm) + ' → ' + sql("select valor from parametros where clave='colchon_pct'"))

// 6. Chichito: pregunta y recorrido
await adm.goto('http://localhost:5173/tableros/costos', { waitUntil: 'networkidle' })
await adm.locator('.ch-boton').click()
await adm.locator('#ch-q').fill('¿Qué plato me conviene más?'); await adm.getByRole('button', { name: 'Preguntar' }).click()
await adm.waitForFunction(() => !document.querySelector('.ch-resp')?.textContent?.includes('Pensando'), null, { timeout: 8000 }).catch(() => {}); paso('Chichito responde: ' + await adm.locator('.ch-resp').textContent())
await adm.screenshot({ path: `${OUT}/6-chichito.png` })
await adm.getByRole('button', { name: 'Ver qué platos convienen' }).click()
await adm.waitForTimeout(900); await adm.screenshot({ path: `${OUT}/7-recorrido.png` })
await adm.getByRole('button', { name: 'Siguiente' }).click(); await adm.waitForTimeout(900)
paso('Recorrido paso 2 resaltado: ' + (await adm.locator('#ch-ring').count() ? 'sí' : 'no'))
await adm.getByRole('button', { name: '¡Listo!' }).click()

// 7. Cuentas: transferencia
await adm.goto('http://localhost:5173/admin/cuentas', { waitUntil: 'networkidle' })
await adm.getByRole('button', { name: 'Pasar plata' }).click(); await adm.locator('#t-monto').fill('50000')
await adm.getByRole('button', { name: 'Registrar' }).click(); paso('Transferencia: ' + await toast(adm))
await adm.screenshot({ path: `${OUT}/8-cuentas.png`, fullPage: true })

await b.close()
console.log(errores.length ? 'ERRORES:\n' + errores.join('\n') : 'FLUJO SIN ERRORES')
