// Función "arca": facturación electrónica directa con ARCA (monotributo: Factura C y Nota de crédito C).
//   generar_csr        (dueño)   crea la clave privada (queda acá, nunca sale) y el pedido de certificado para subir a ARCA
//   cargar_certificado (dueño)   guarda el certificado que devuelve ARCA, revisando que sea de esa clave
//   probar             (dueño)   entra a ARCA y pregunta el último número autorizado del punto de venta
//   facturar           (salón)   hace la factura de un ticket cobrado
//   anular             (gestión) hace la nota de crédito de una factura
// Secretos que usa: los de siempre de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). No necesita otros.
import { admin, cors, esGestion, json, quienLlama } from '../_compartido/comun.ts'
import {
  type Ambiente, type Credencial, consultar, entrar, ErrorArca, estadoServidores, leerCertificado, nuevaClave, pedidoCertificado, pedirCae, ultimoAutorizado,
} from './afip.ts'

interface Config {
  cuit: string | null; razon_social: string | null; punto_venta: number | null; ambiente: Ambiente; activa: boolean; tope_identificar: number
  cert_homologacion: string | null; cert_produccion: string | null
}
interface Factura {
  id: number; codigo: string; ticket_id: number | null; tipo: number; punto_venta: number; numero: number | null; fecha: string; total: number
  doc_tipo: number; doc_nro: number; cond_iva_receptor: number; estado: string; cae: string | null; ambiente: Ambiente; asociada_id: number | null; anulada: boolean
}
interface Pedido {
  accion?: string; ambiente?: Ambiente; certificado?: string; nueva?: boolean
  ticket_id?: number; doc_tipo?: number; doc_nro?: string | number; receptor?: string; cond_iva?: number; factura_id?: number
}

const db = admin()
const hoyArg = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const aArca = (f: string) => f.replace(/-/g, '')
const deArca = (f: string | null) => (f && /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : null)
const plata = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

async function leer<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data as T
}
const config = () => leer<Config>(db.from('facturacion').select('*').eq('id', 1).single())
const secreto = () => leer<{ clave_privada: string | null; ta: Record<string, { token: string; sign: string; vence: string }> }>(
  db.from('facturacion_secreto').select('*').eq('id', 1).single())

function listo(c: Config) {
  if (!c.cuit || !c.razon_social || !c.punto_venta) throw new ErrorArca('Faltan los datos del bar en Administración → Facturación (CUIT, razón social y punto de venta).')
  const cert = c.ambiente === 'produccion' ? c.cert_produccion : c.cert_homologacion
  if (!cert) throw new ErrorArca(`Falta cargar el certificado de ARCA para ${c.ambiente === 'produccion' ? 'producción' : 'prueba'} en Administración → Facturación.`)
  return cert
}

/** Ticket de acceso de WSAA: se reusa mientras dure (12 h), porque ARCA no da otro hasta que vence */
async function credencial(c: Config): Promise<Credencial> {
  const cert = listo(c)
  const s = await secreto()
  if (!s.clave_privada) throw new ErrorArca('Falta generar el pedido de certificado en Administración → Facturación.')
  const ta = s.ta?.[c.ambiente]
  if (ta && new Date(ta.vence).getTime() > Date.now() + 5 * 60_000) return { token: ta.token, sign: ta.sign, cuit: c.cuit! }
  const nuevo = await entrar(c.ambiente, s.clave_privada, cert)
  await leer(db.from('facturacion_secreto').update({ ta: { ...(s.ta ?? {}), [c.ambiente]: nuevo } }).eq('id', 1))
  return { token: nuevo.token, sign: nuevo.sign, cuit: c.cuit! }
}

// ------------------------------------------------------------------ receptor
function cuitValido(c: string) {
  if (!/^\d{11}$/.test(c)) return false
  const p = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = p.reduce((t, x, i) => t + x * Number(c[i]), 0)
  const v = 11 - (s % 11), dv = v === 11 ? 0 : v === 10 ? 9 : v
  return dv === Number(c[10])
}
function receptor(p: Pedido, total: number, tope: number) {
  const nro = String(p.doc_nro ?? '').replace(/\D/g, '')
  let docTipo = Number(p.doc_tipo) || (nro ? (nro.length === 11 ? 80 : 96) : 99)
  if (!nro) docTipo = 99
  if (docTipo === 99) {
    if (total >= tope) throw new ErrorArca(`Desde ${plata(tope)} hay que identificar al cliente: pedile el DNI o el CUIT.`)
    return { docTipo: 99, docNro: 0, condIva: 5 }
  }
  if (docTipo === 96 && !/^\d{7,8}$/.test(nro)) throw new ErrorArca('Revisá el DNI: tiene que tener 7 u 8 números.')
  if (docTipo === 80 && !cuitValido(nro)) throw new ErrorArca('Revisá el CUIT: los números no cierran.')
  const condIva = docTipo === 80 ? ([1, 4, 5, 6, 13, 16].includes(Number(p.cond_iva)) ? Number(p.cond_iva) : 5) : 5
  return { docTipo, docNro: Number(nro), condIva }
}

// ------------------------------------------------------------------ pedir el CAE (con recuperación)
/**
 * Pide el número siguiente y el CAE. Si otro pidió el mismo número a la vez (error 10016), reintenta.
 * Si se corta la conexión, la factura queda pendiente con el número intentado y se recupera en el próximo intento.
 */
async function autorizar(c: Config, cred: Credencial, f: Factura, asociado?: Factura): Promise<Factura> {
  // Quedó a medias antes: ver si ARCA llegó a autorizarla
  if (f.numero) {
    const ya = await consultar(c.ambiente, cred, f.punto_venta, f.tipo, f.numero)
    if (ya && Math.abs(ya.total - Number(f.total)) < 0.01 && ya.docNro === Number(f.doc_nro) && ya.cae) {
      return await leer<Factura>(db.from('facturas').update({ estado: 'autorizada', cae: ya.cae, cae_vence: deArca(ya.caeVence), fecha: deArca(ya.fecha) ?? f.fecha, error: null })
        .eq('id', f.id).select().single())
    }
  }
  for (let intento = 0; intento < 3; intento++) {
    const numero = (await ultimoAutorizado(c.ambiente, cred, f.punto_venta, f.tipo)) + 1
    await leer(db.from('facturas').update({ numero, fecha: hoyArg() }).eq('id', f.id))
    const r = await pedirCae(c.ambiente, cred, {
      ptoVta: f.punto_venta, tipo: f.tipo as 11 | 13, numero, fecha: aArca(hoyArg()), total: Number(f.total),
      docTipo: f.doc_tipo, docNro: Number(f.doc_nro), condIva: f.cond_iva_receptor,
      asociado: asociado ? { tipo: asociado.tipo, ptoVta: asociado.punto_venta, numero: asociado.numero!, fecha: aArca(asociado.fecha), cuit: c.cuit! } : undefined,
    })
    if (r.resultado === 'A' && r.cae) {
      return await leer<Factura>(db.from('facturas').update({
        estado: 'autorizada', cae: r.cae, cae_vence: deArca(r.caeVence), error: null, observaciones: r.observaciones.join(' · ') || null,
      }).eq('id', f.id).select().single())
    }
    if (r.errores.some((e) => e.code === 10016)) continue
    const motivo = [...r.errores.map((e) => `${e.code}: ${e.msg}`), ...r.observaciones].join(' · ') || 'ARCA la rechazó sin decir por qué.'
    await leer(db.from('facturas').update({ estado: 'rechazada', error: motivo, numero: null }).eq('id', f.id))
    throw new ErrorArca(`ARCA rechazó la factura: ${motivo}`)
  }
  throw new ErrorArca('No se pudo conseguir el número de factura (se están haciendo otras a la vez). Probá de nuevo.')
}

// ------------------------------------------------------------------ acciones
async function facturar(p: Pedido, usuario: string) {
  const c = await config()
  if (!c.activa) throw new ErrorArca('La facturación no está activada. Un dueño la activa en Administración → Facturación.')
  listo(c)
  const t = await leer<{ id: number; total: number } | null>(db.from('tickets').select('id, total').eq('id', Number(p.ticket_id)).maybeSingle())
  if (!t) throw new ErrorArca('No encontramos ese cobro.')
  if (Number(t.total) <= 0) throw new ErrorArca('Ese cobro es de $0: no lleva factura.')
  const cred = await credencial(c)
  const vivas = await leer<Factura[]>(db.from('facturas').select('*').eq('ticket_id', t.id).eq('ambiente', c.ambiente).eq('tipo', 11).neq('estado', 'rechazada').eq('anulada', false))
  let f = vivas[0]
  if (f?.estado === 'autorizada') return f
  if (!f) {
    const r = receptor(p, Number(t.total), Number(c.tope_identificar))
    const { data, error } = await db.from('facturas').insert({
      ticket_id: t.id, tipo: 11, punto_venta: c.punto_venta, fecha: hoyArg(), total: t.total, doc_tipo: r.docTipo, doc_nro: r.docNro,
      receptor: (p.receptor ?? '').trim().slice(0, 80) || null, cond_iva_receptor: r.condIva, ambiente: c.ambiente, creado_por: usuario,
    }).select().single()
    if (error) throw new ErrorArca(/duplicate|unique/i.test(error.message) ? 'La factura de esta mesa ya se está haciendo. Esperá un momento.' : error.message)
    f = data as Factura
  }
  return await autorizar(c, cred, f)
}

async function anular(p: Pedido, usuario: string) {
  const c = await config()
  listo(c)
  const f = await leer<Factura | null>(db.from('facturas').select('*').eq('id', Number(p.factura_id)).maybeSingle())
  if (!f || f.tipo !== 11 || f.estado !== 'autorizada') throw new ErrorArca('Solo se anula una factura autorizada.')
  if (f.anulada) throw new ErrorArca('Esa factura ya tiene su nota de crédito.')
  if (f.ambiente !== c.ambiente) throw new ErrorArca('Esa factura es de otro ambiente de ARCA.')
  const cred = await credencial(c)
  let nc = (await leer<Factura[]>(db.from('facturas').select('*').eq('asociada_id', f.id).eq('tipo', 13).neq('estado', 'rechazada')))[0]
  if (!nc) {
    nc = await leer<Factura>(db.from('facturas').insert({
      tipo: 13, punto_venta: f.punto_venta, fecha: hoyArg(), total: f.total, doc_tipo: f.doc_tipo, doc_nro: f.doc_nro,
      cond_iva_receptor: f.cond_iva_receptor, ambiente: f.ambiente, asociada_id: f.id, creado_por: usuario,
    }).select().single())
  }
  if (nc.estado !== 'autorizada') nc = await autorizar(c, cred, nc, f)
  await leer(db.from('facturas').update({ anulada: true }).eq('id', f.id))
  return nc
}

async function generarCsr(p: Pedido) {
  const c = await config()
  if (!c.cuit || !c.razon_social) throw new ErrorArca('Primero guardá el CUIT y la razón social.')
  const s = await secreto()
  let clave = s.clave_privada
  if (!clave || p.nueva) {
    clave = await nuevaClave()
    await leer(db.from('facturacion_secreto').update({ clave_privada: clave, ta: {} }).eq('id', 1))
  }
  const csr = pedidoCertificado(clave, c.cuit, c.razon_social)
  await leer(db.from('facturacion').update({ csr }).eq('id', 1))
  return { csr }
}

async function cargarCertificado(p: Pedido) {
  const amb: Ambiente = p.ambiente === 'produccion' ? 'produccion' : 'homologacion'
  const c = await config(), s = await secreto()
  if (!s.clave_privada) throw new ErrorArca('Primero generá el pedido de certificado (CSR).')
  const info = leerCertificado(p.certificado ?? '', s.clave_privada)
  if (info.vence.getTime() < Date.now()) throw new ErrorArca('Ese certificado ya está vencido.')
  if (info.cuit && c.cuit && info.cuit !== c.cuit) throw new ErrorArca(`El certificado es del CUIT ${info.cuit} y el bar tiene cargado ${c.cuit}.`)
  const cert = (p.certificado ?? '').trim()
  await leer(db.from('facturacion').update(amb === 'produccion'
    ? { cert_produccion: cert, vence_produccion: info.vence.toISOString() }
    : { cert_homologacion: cert, vence_homologacion: info.vence.toISOString() }).eq('id', 1))
  const ta = { ...(s.ta ?? {}) }; delete ta[amb]
  await leer(db.from('facturacion_secreto').update({ ta }).eq('id', 1))
  return { vence: info.vence.toISOString(), sujeto: info.sujeto }
}

async function probar() {
  const c = await config()
  const guardar = (ok: boolean, msg: string) => leer(db.from('facturacion').update({ ultima_prueba: new Date().toISOString(), ultima_prueba_ok: ok, ultima_prueba_msg: msg }).eq('id', 1))
  try {
    const servidores = await estadoServidores(c.ambiente)
    const cred = await credencial(c)
    const ultimo = await ultimoAutorizado(c.ambiente, cred, c.punto_venta!, 11)
    const msg = `Conectado con ARCA (${c.ambiente === 'produccion' ? 'producción' : 'prueba'}). Punto de venta ${c.punto_venta}: última Factura C autorizada ${ultimo || 'ninguna todavía'}.`
    await guardar(true, msg)
    return { ok: true, msg, servidores, ultimo }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await guardar(false, msg)
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const quien = await quienLlama(req)
  if (!quien) return json({ error: 'Entrá con tu usuario.' }, 401)
  const p = await req.json().catch(() => ({})) as Pedido
  const soloDueno = ['generar_csr', 'cargar_certificado', 'probar'].includes(p.accion ?? '')
  if (soloDueno && quien.rol !== 'admin') return json({ error: 'Solo un dueño configura la facturación.' }, 403)
  if (p.accion === 'anular' && !esGestion(quien.rol)) return json({ error: 'Solo dueños y encargados anulan facturas.' }, 403)
  if (p.accion === 'facturar' && !['admin', 'encargado', 'mozo'].includes(quien.rol)) return json({ error: 'Tu usuario no puede facturar.' }, 403)
  try {
    switch (p.accion) {
      case 'generar_csr': return json(await generarCsr(p))
      case 'cargar_certificado': return json(await cargarCertificado(p))
      case 'probar': return json(await probar())
      case 'facturar': return json({ factura: await facturar(p, quien.id) })
      case 'anular': return json({ factura: await anular(p, quien.id) })
      case 'tiene_clave': return json({ tiene: !!(await secreto()).clave_privada })
      default: return json({ error: 'Pedido desconocido.' }, 400)
    }
  } catch (e) {
    const sinConexion = e instanceof ErrorArca && e.codigo === -1
    return json({ error: e instanceof Error ? e.message : String(e), sin_conexion: sinConexion }, 400)
  }
})
