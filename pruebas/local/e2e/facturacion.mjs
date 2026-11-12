// Prueba de punta a punta de la facturación contra el ARCA simulado (levantar-arca.sh + PostgREST + base con flujo.sql).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { de, ANON } from './jwt.mjs'

const FN = 'http://localhost:54334', REST = 'http://localhost:54330', ARCA = 'http://localhost:54333'
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas++ }
async function arca(rol, cuerpo) {
  const r = await fetch(FN, { method: 'POST', headers: { Authorization: `Bearer ${rol === 'anon' ? ANON : de(rol)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  return { status: r.status, ...(await r.json()) }
}
async function rest(rol, ruta, init = {}) {
  const r = await fetch(REST + ruta, { ...init, headers: { Authorization: `Bearer ${rol === 'anon' ? ANON : de(rol)}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) } })
  const t = await r.text(); return { status: r.status, data: t ? JSON.parse(t) : null }
}

// 1. Datos del bar (CUIT de prueba válido)
let r = await rest('admin', '/facturacion?id=eq.1', { method: 'PATCH', body: JSON.stringify({ cuit: '20123456786', razon_social: 'Sebastián Pérez', nombre_fantasia: 'Última Vuelta', domicilio: 'Av. Moyano 123, Rada Tilly, Chubut', iibb: '20123456786', inicio_actividades: '2026-10-01', punto_venta: 3 }) })
ok(r.status === 200, 'el dueño guarda los datos del bar')
r = await rest('encargado', '/facturacion?id=eq.1', { method: 'PATCH', body: JSON.stringify({ activa: true }) })
ok(r.status === 200 && r.data.length === 0, 'el encargado no puede cambiar la facturación')
r = await rest('encargado', '/facturacion_secreto')
ok(r.status >= 400, 'nadie lee la clave privada desde la app')

// 2. Pedido de certificado, "ARCA" lo firma, se carga
r = await arca('encargado', { accion: 'generar_csr' }); ok(r.status === 403, 'solo un dueño genera el pedido')
r = await arca('admin', { accion: 'generar_csr' })
ok(r.csr?.includes('BEGIN CERTIFICATE REQUEST'), 'se genera el CSR')
const sujeto = execFileSync('openssl', ['req', '-noout', '-subject'], { input: r.csr }).toString().trim()
ok(/serialNumber\s*=\s*CUIT 20123456786/.test(sujeto) && /O\s*=\s*Sebastian Perez/.test(sujeto), `el CSR tiene el CUIT y la razón social (${sujeto})`)
const csr2 = (await arca('admin', { accion: 'generar_csr' })).csr
ok(execFileSync('openssl', ['req', '-noout', '-modulus'], { input: csr2 }).toString() === execFileSync('openssl', ['req', '-noout', '-modulus'], { input: r.csr }).toString(), 'regenerar el CSR conserva la misma clave')
const cert = await (await fetch(`${ARCA}/firmar`, { method: 'POST', body: r.csr })).text()
// Un certificado de otra clave tiene que rechazarse
const d = mkdtempSync(join(tmpdir(), 'otro-'))
execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k'), '-out', join(d, 'r'), '-subj', '/C=AR/O=Otro/CN=x/serialNumber=CUIT 20123456786'], { stdio: 'ignore' })
const otro = await (await fetch(`${ARCA}/firmar`, { method: 'POST', body: readFileSync(join(d, 'r'), 'utf8') })).text()
r = await arca('admin', { accion: 'cargar_certificado', ambiente: 'homologacion', certificado: otro })
ok(/no corresponde/.test(r.error ?? ''), 'rechaza un certificado de otra clave: ' + r.error)
r = await arca('admin', { accion: 'cargar_certificado', ambiente: 'homologacion', certificado: 'cualquier cosa' })
ok(/no es un certificado/.test(r.error ?? ''), 'rechaza un archivo que no es certificado')
r = await arca('admin', { accion: 'cargar_certificado', ambiente: 'homologacion', certificado: cert })
ok(!!r.vence, 'carga el certificado bueno, vence ' + r.vence)

// 3. Probar la conexión (entra a WSAA con la firma CMS verificada por openssl)
r = await arca('admin', { accion: 'probar' })
ok(r.ok && r.ultimo === 0, 'probar conexión: ' + (r.msg ?? r.error))
r = await arca('mozo', { accion: 'facturar', ticket_id: 1 })
ok(/no está activada/.test(r.error ?? ''), 'sin activar no factura')
await rest('admin', '/facturacion?id=eq.1', { method: 'PATCH', body: JSON.stringify({ activa: true }) })

// 4. Facturar tickets
const tickets = (await rest('admin', '/tickets?select=id,total&order=id')).data
ok(tickets.length >= 3, `hay ${tickets.length} tickets para facturar`)
const [t1, t2, t3] = tickets
r = await arca('mozo', { accion: 'facturar', ticket_id: t1.id })
ok(r.factura?.estado === 'autorizada' && r.factura.numero === 1 && r.factura.cae?.length === 14, `factura C 0003-${r.factura?.numero} CAE ${r.factura?.cae} (${r.error ?? 'ok'})`)
const f1 = r.factura
r = await arca('mozo', { accion: 'facturar', ticket_id: t1.id })
ok(r.factura?.id === f1.id, 'facturar dos veces el mismo ticket devuelve la misma factura')
r = await arca('cocina', { accion: 'facturar', ticket_id: t2.id }); ok(r.status === 403, 'la parrilla no factura')
r = await arca('anon', { accion: 'facturar', ticket_id: t2.id }); ok(r.status === 401, 'sin usuario no factura')

// 5. Identificar al cliente desde el tope
await rest('admin', '/facturacion?id=eq.1', { method: 'PATCH', body: JSON.stringify({ tope_identificar: 100 }) })
r = await arca('encargado', { accion: 'facturar', ticket_id: t2.id }); ok(/identificar al cliente/.test(r.error ?? ''), 'pide DNI desde el tope: ' + r.error)
r = await arca('encargado', { accion: 'facturar', ticket_id: t2.id, doc_nro: '123' }); ok(/DNI/.test(r.error ?? ''), 'revisa el DNI')
r = await arca('encargado', { accion: 'facturar', ticket_id: t2.id, doc_nro: '20123456780' }); ok(/CUIT/.test(r.error ?? ''), 'revisa el dígito del CUIT')
r = await arca('encargado', { accion: 'facturar', ticket_id: t2.id, doc_nro: '30.111.222', receptor: 'María Gómez' })
ok(r.factura?.numero === 2 && r.factura.doc_tipo === 96 && r.factura.observaciones, `factura a DNI 30111222 (${r.factura?.observaciones ?? r.error})`)
await rest('admin', '/facturacion?id=eq.1', { method: 'PATCH', body: JSON.stringify({ tope_identificar: 10000000 }) })

// 6. Se corta la conexión justo después de que ARCA autoriza: al reintentar la recupera sin duplicar
await fetch(`${ARCA}/control`, { method: 'POST', body: '{"cortar":true}' })
r = await arca('mozo', { accion: 'facturar', ticket_id: t3.id })
ok(r.sin_conexion === true, 'se corta: ' + r.error)
const pend = (await rest('admin', `/facturas?ticket_id=eq.${t3.id}`)).data
ok(pend.length === 1 && pend[0].estado === 'pendiente' && pend[0].numero === 3, 'queda pendiente con el número 3')
r = await arca('mozo', { accion: 'facturar', ticket_id: t3.id })
ok(r.factura?.estado === 'autorizada' && r.factura.numero === 3 && r.factura.id === pend[0].id, 'al reintentar recupera la 3 con su CAE, sin hacer otra')

// 7. Nota de crédito y volver a facturar
r = await arca('mozo', { accion: 'anular', factura_id: f1.id }); ok(r.status === 403, 'el mozo no anula')
r = await arca('encargado', { accion: 'anular', factura_id: f1.id })
ok(r.factura?.tipo === 13 && r.factura.numero === 1 && r.factura.estado === 'autorizada', `nota de crédito C 0003-${r.factura?.numero} (${r.error ?? 'ok'})`)
r = await arca('encargado', { accion: 'anular', factura_id: f1.id }); ok(/ya tiene su nota/.test(r.error ?? ''), 'no se anula dos veces')
r = await arca('mozo', { accion: 'facturar', ticket_id: t1.id })
ok(r.factura?.numero === 4 && r.factura.id !== f1.id, 'el ticket anulado se puede volver a facturar: 0003-4')

// 8. La factura pública (sin usuario) y lo que ve cada rol
const pub = await rest('anon', '/rpc/factura_publica', { method: 'POST', body: JSON.stringify({ p_codigo: r.factura.codigo }) })
ok(pub.data?.cae === r.factura.cae && pub.data.emisor.cuit === '20123456786' && pub.data.items.length > 0, `la factura se ve sin usuario con ${pub.data?.items?.length} ítems`)
const nada = await rest('anon', '/rpc/factura_publica', { method: 'POST', body: JSON.stringify({ p_codigo: 'inventado12345' }) })
ok(nada.data === null, 'con un código inventado no se ve nada')
ok((await rest('anon', '/facturas')).status >= 400, 'sin usuario no se listan facturas')
ok((await rest('mozo', '/facturas')).data.length === 5, 'el mozo ve las facturas (para imprimirlas)')
r = await rest('mozo', `/facturas?id=eq.${f1.id}`, { method: 'PATCH', body: JSON.stringify({ cae: '1' }) })
ok(r.status >= 400, 'nadie cambia una factura desde la app')
const sug = await rest('admin', '/rpc/sugerencias_ayudante', { method: 'POST', body: JSON.stringify({ p_area: 'caja' }) })
ok(sug.data.some((s) => s.tema === 'factura-prueba'), 'Chichito avisa que se factura en modo prueba')

console.log(fallas ? `${fallas} FALLAS` : 'FACTURACIÓN SIN ERRORES')
process.exit(fallas ? 1 : 0)
