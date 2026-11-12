// Recorre todas las pantallas de cada rol, junta errores de consola y de red, y saca capturas.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { mkdirSync } from 'node:fs'
const OUT = process.env.OUT || '/tmp/capturas'; mkdirSync(OUT, { recursive: true })
const RUTAS = {
  5173: ['/tableros/resumen', '/tableros/ventas', '/tableros/costos', '/tableros/finanzas', '/mesas', '/cocina', '/barra', '/caja',
    '/stock/articulos', '/stock/recetas', '/stock/rendimientos', '/stock/compras', '/stock/control', '/stock/mermas',
    '/admin/proveedores', '/admin/gastos', '/admin/cuentas', '/admin/usuarios', '/admin/configuracion', '/carta', '/carta/mesas'],
  5174: ['/mesas', '/caja>/mesas', '/tableros/resumen>/mesas'], 5175: ['/cocina', '/barra>/cocina', '/mesas>/cocina'],
}
const b = await chromium.launch()
let problemas = 0
for (const movil of [false, true]) {
  for (const [puerto, rutas] of Object.entries(RUTAS)) {
    const ctx = await b.newContext(movil ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true } : { viewport: { width: 1360, height: 900 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('uv-hola-00000000-0000-0000-0000-000000000001', '1'); localStorage.setItem('uv-hola-00000000-0000-0000-0000-000000000003', '1'); localStorage.setItem('uv-hola-00000000-0000-0000-0000-000000000004', '1') } catch {} })
    const p = await ctx.newPage()
    const errs = []
    p.on('console', (m) => { if (m.type() === 'error' && !/realtime|websocket|WebSocket|ERR_TUNNEL|ERR_NAME|fonts/i.test(m.text())) errs.push('consola: ' + m.text()) })
    p.on('pageerror', (e) => errs.push('js: ' + e.message))
    p.on('response', async (r) => { if (r.status() >= 400 && !/realtime/.test(r.url())) errs.push(`red ${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${(await r.text().catch(() => '')).slice(0, 200)}`) })
    for (const r of rutas) {
      const [ruta, espera = r] = r.split('>')
      errs.length = 0
      await p.goto(`http://localhost:${puerto}${ruta}`, { waitUntil: 'networkidle' }).catch((e) => errs.push('nav: ' + e.message))
      await p.waitForTimeout(600)
      const final = new URL(p.url()).pathname
      const aviso = await p.locator('.aviso.bad').allTextContents()
      const ancho = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      const nombre = `${movil ? 'm' : 'd'}-${puerto}${ruta.replace(/\//g, '_')}.png`
      await p.screenshot({ path: `${OUT}/${nombre}`, fullPage: true })
      const malos = [...errs, ...aviso.map((a) => 'aviso: ' + a), ...(ancho ? ['se desborda a lo ancho'] : []), ...(final !== espera ? [`redirigió a ${final}`] : [])]
      if (malos.length) { problemas += malos.length; console.log(`✗ ${movil ? 'móvil' : 'pc'} ${puerto}${ruta}\n   ` + malos.join('\n   ')) } else console.log(`✓ ${movil ? 'móvil' : 'pc'} ${puerto}${ruta}`)
    }
    await ctx.close()
  }
}
await b.close()
console.log(problemas ? `${problemas} problemas` : 'SIN PROBLEMAS')
