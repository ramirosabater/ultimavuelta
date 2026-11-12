// Versión en un solo archivo para pegar en Supabase → Edge Functions → Deploy a new function → Via Editor (nombre: arca).
// Se genera con scripts/empaquetar-funciones.py desde supabase/functions/arca/: si cambia aquello, regenerar este.
// Función "arca": facturación electrónica directa con ARCA (monotributo: Factura C y Nota de crédito C).
//   generar_csr        (dueño)   crea la clave privada (queda acá, nunca sale) y el pedido de certificado para subir a ARCA
//   cargar_certificado (dueño)   guarda el certificado que devuelve ARCA, revisando que sea de esa clave
//   probar             (dueño)   entra a ARCA y pregunta el último número autorizado del punto de venta
//   facturar           (salón)   hace la factura de un ticket cobrado
//   anular             (gestión) hace la nota de crédito de una factura
// Secretos que usa: los de siempre de Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). No necesita otros.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
// @deno-types="npm:@types/node-forge@1.3.11"
import forge from "npm:node-forge@1.3.1"

// ---- supabase/functions/_compartido/comun.ts ----
// Utilidades compartidas por las funciones de Supabase de Última Vuelta

const env = (k: string, def = '') => Deno.env.get(k) ?? def

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente con permisos completos (service role): solo dentro de las funciones, nunca en el navegador */
const admin = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/** Cliente que actúa como el usuario que llama: la base aplica sus permisos */
const comoUsuario = (req: Request): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

type Rol = 'admin' | 'encargado' | 'mozo' | 'cocina' | 'barra'

/** Quién llama: su perfil activo, o null si no está autorizado */
async function quienLlama(req: Request): Promise<{ id: string; rol: Rol; nombre: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const db = admin()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: p } = await db.from('perfiles').select('rol, activo, nombre').eq('id', data.user.id).maybeSingle()
  if (!p || !p.activo) return null
  return { id: data.user.id, rol: p.rol as Rol, nombre: p.nombre }
}

const esGestion = (rol: Rol) => rol === 'admin' || rol === 'encargado'
// ---- supabase/functions/arca/afip.ts ----
// Cliente de los web services de ARCA (ex AFIP): WSAA para entrar y WSFEv1 para facturar.
// Sin dependencias de Supabase: recibe la clave, el certificado y los datos, y devuelve lo que contesta ARCA.

type Ambiente = 'homologacion' | 'produccion'

const URLS: Record<Ambiente, { wsaa: string; wsfe: string }> = {
  homologacion: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  produccion: { wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
}
/** Las pruebas locales apuntan a un ARCA simulado con ARCA_WSAA_URL y ARCA_WSFE_URL */
const url = (amb: Ambiente, s: 'wsaa' | 'wsfe') =>
  Deno.env.get(s === 'wsaa' ? 'ARCA_WSAA_URL' : 'ARCA_WSFE_URL') || URLS[amb][s]

class ErrorArca extends Error {
  constructor(msg: string, public codigo?: number) { super(msg) }
}

// ------------------------------------------------------------------ clave y certificado
/** Clave RSA 2048 nueva (con la criptografía nativa, rápida) en PEM */
async function nuevaClave(): Promise<string> {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  let bin = ''; for (const b of der) bin += String.fromCharCode(b)
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`
}

/** Pedido de certificado (CSR) como lo pide ARCA: C=AR, O=razón social, CN=alias, serialNumber=CUIT nnnnnnnnnnn */
function pedidoCertificado(clavePem: string, cuit: string, razonSocial: string, alias = 'ultimavuelta'): string {
  const clave = forge.pki.privateKeyFromPem(clavePem) as forge.pki.rsa.PrivateKey
  const csr = forge.pki.createCertificationRequest()
  csr.publicKey = forge.pki.setRsaPublicKey(clave.n, clave.e)
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: sinAcentos(razonSocial).slice(0, 60) },
    { name: 'commonName', value: alias },
    { type: '2.5.4.5', value: `CUIT ${cuit}` },
  ])
  csr.sign(clave, forge.md.sha256.create())
  return forge.pki.certificationRequestToPem(csr)
}

/** Revisa que el certificado sea de esta clave y devuelve vencimiento y a quién corresponde */
function leerCertificado(certPem: string, clavePem: string): { vence: Date; sujeto: string; cuit: string | null } {
  let cert: forge.pki.Certificate
  try { cert = forge.pki.certificateFromPem(limpiarPem(certPem)) } catch { throw new ErrorArca('Ese archivo no es un certificado. Subí el .crt que bajaste de ARCA.') }
  const clave = forge.pki.privateKeyFromPem(clavePem) as forge.pki.rsa.PrivateKey
  const pub = cert.publicKey as forge.pki.rsa.PublicKey
  if (pub.n.compareTo(clave.n) !== 0) throw new ErrorArca('Ese certificado no corresponde al pedido (CSR) que generó la app. Subí el que hiciste con ese pedido.')
  const sujeto = cert.subject.attributes.map((a) => `${a.shortName ?? a.name ?? a.type}=${a.value}`).join(', ')
  const cuit = /CUIT (\d{11})/.exec(sujeto)?.[1] ?? null
  return { vence: cert.validity.notAfter, sujeto, cuit }
}

function limpiarPem(pem: string) {
  const t = pem.trim()
  if (t.includes('BEGIN CERTIFICATE')) return t
  return `-----BEGIN CERTIFICATE-----\n${t.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`
}
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '')

// ------------------------------------------------------------------ WSAA: el ticket de acceso (dura 12 horas)
interface TicketAcceso { token: string; sign: string; vence: string }

function fechaArca(d: Date) {
  // ISO con la hora de Argentina: 2026-11-12T12:00:00-03:00
  const a = new Date(d.getTime() - 3 * 3600_000)
  return a.toISOString().replace(/\.\d{3}Z$/, '-03:00')
}

async function entrar(amb: Ambiente, clavePem: string, certPem: string, servicio = 'wsfe'): Promise<TicketAcceso> {
  const ahora = new Date()
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>`
    + `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>`
    + `<generationTime>${fechaArca(new Date(ahora.getTime() - 10 * 60_000))}</generationTime>`
    + `<expirationTime>${fechaArca(new Date(ahora.getTime() + 10 * 60_000))}</expirationTime>`
    + `</header><service>${servicio}</service></loginTicketRequest>`
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  const cert = forge.pki.certificateFromPem(limpiarPem(certPem))
  p7.addCertificate(cert)
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePem), certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: ahora as unknown as string },
    ],
  })
  p7.sign()
  const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes())
  const sobre = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">`
    + `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  const xml = await soap(url(amb, 'wsaa'), '', sobre)
  const falla = tag(xml, 'faultstring')
  if (falla) {
    if (/ya posee un TA valido/i.test(falla)) throw new ErrorArca('ARCA dice que ya hay una sesión abierta y no la tenemos guardada. Esperá unos 10 minutos y probá de nuevo.')
    if (/[Cc]omputador no autorizado|no autorizado a acceder/.test(falla)) throw new ErrorArca('El certificado no tiene permiso para facturar. En ARCA falta asociarlo al servicio "Facturación Electrónica" (Administrador de Relaciones de Clave Fiscal).')
    if (/[Cc]ertificado.*(expirado|vencido)|expired/i.test(falla)) throw new ErrorArca('El certificado de ARCA está vencido. Cargá uno nuevo en Facturación.')
    throw new ErrorArca(`ARCA no dejó entrar: ${falla}`)
  }
  const ret = desescapar(tag(xml, 'loginCmsReturn') ?? '')
  const token = tag(ret, 'token'), sign = tag(ret, 'sign'), vence = tag(ret, 'expirationTime')
  if (!token || !sign || !vence) throw new ErrorArca('ARCA contestó algo que no se entiende al entrar.')
  return { token, sign, vence }
}

// ------------------------------------------------------------------ WSFEv1
interface Credencial { token: string; sign: string; cuit: string }
const auth = (c: Credencial) => `<ar:Auth><ar:Token>${c.token}</ar:Token><ar:Sign>${c.sign}</ar:Sign><ar:Cuit>${c.cuit}</ar:Cuit></ar:Auth>`
const sobreFe = (metodo: string, cuerpo: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soap:Header/>`
  + `<soap:Body><ar:${metodo}>${cuerpo}</ar:${metodo}></soap:Body></soap:Envelope>`
const fe = (amb: Ambiente, metodo: string, cuerpo: string) => soap(url(amb, 'wsfe'), `http://ar.gov.afip.dif.FEV1/${metodo}`, sobreFe(metodo, cuerpo))

/** Los errores que devuelve WSFE: [{code, msg}] */
function errores(xml: string, envoltorio = 'Errors', item = 'Err') {
  const bloque = tag(xml, envoltorio) ?? ''
  return tags(bloque, item).map((e) => ({ code: Number(tag(e, 'Code')), msg: desescapar(tag(e, 'Msg') ?? '') }))
}
function tirarSiError(xml: string) {
  const falla = tag(xml, 'faultstring'); if (falla) throw new ErrorArca(`ARCA: ${falla}`)
  const e = errores(xml); if (e.length) throw new ErrorArca(e.map((x) => `${x.code}: ${x.msg}`).join(' · '), e[0].code)
}

async function estadoServidores(amb: Ambiente) {
  const xml = await fe(amb, 'FEDummy', '')
  return { app: tag(xml, 'AppServer'), db: tag(xml, 'DbServer'), auth: tag(xml, 'AuthServer') }
}

async function ultimoAutorizado(amb: Ambiente, c: Credencial, ptoVta: number, tipo: number): Promise<number> {
  const xml = await fe(amb, 'FECompUltimoAutorizado', `${auth(c)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`)
  tirarSiError(xml)
  return Number(tag(xml, 'CbteNro') ?? 0)
}

/** Un comprobante ya emitido (para recuperar uno que quedó a medias), o null si no existe */
async function consultar(amb: Ambiente, c: Credencial, ptoVta: number, tipo: number, numero: number) {
  const xml = await fe(amb, 'FECompConsultar', `${auth(c)}<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${numero}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`)
  const e = errores(xml)
  if (e.some((x) => x.code === 602)) return null   // no existe
  tirarSiError(xml)
  return {
    total: Number(tag(xml, 'ImpTotal')), fecha: tag(xml, 'CbteFch') ?? '', docTipo: Number(tag(xml, 'DocTipo')), docNro: Number(tag(xml, 'DocNro')),
    cae: tag(xml, 'CodAutorizacion') ?? '', caeVence: tag(xml, 'FchVto') ?? '', resultado: tag(xml, 'Resultado') ?? '',
  }
}

interface Comprobante {
  ptoVta: number; tipo: 11 | 13; numero: number; fecha: string /* yyyymmdd */; total: number
  docTipo: number; docNro: number; condIva: number
  asociado?: { tipo: number; ptoVta: number; numero: number; fecha: string; cuit: string }
}
interface Respuesta { resultado: 'A' | 'R' | 'P'; cae: string | null; caeVence: string | null; observaciones: string[]; errores: { code: number; msg: string }[] }

const importe = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** Pide el CAE de una Factura C o Nota de crédito C (monotributo: sin IVA discriminado, todo es neto) */
async function pedirCae(amb: Ambiente, c: Credencial, x: Comprobante): Promise<Respuesta> {
  const det = `<ar:FECAEDetRequest>`
    + `<ar:Concepto>1</ar:Concepto><ar:DocTipo>${x.docTipo}</ar:DocTipo><ar:DocNro>${x.docNro}</ar:DocNro>`
    + `<ar:CbteDesde>${x.numero}</ar:CbteDesde><ar:CbteHasta>${x.numero}</ar:CbteHasta><ar:CbteFch>${x.fecha}</ar:CbteFch>`
    + `<ar:ImpTotal>${importe(x.total)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${importe(x.total)}</ar:ImpNeto>`
    + `<ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>0.00</ar:ImpIVA>`
    + `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${x.condIva}</ar:CondicionIVAReceptorId>`
    + (x.asociado ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${x.asociado.tipo}</ar:Tipo><ar:PtoVta>${x.asociado.ptoVta}</ar:PtoVta>`
      + `<ar:Nro>${x.asociado.numero}</ar:Nro><ar:Cuit>${x.asociado.cuit}</ar:Cuit><ar:CbteFch>${x.asociado.fecha}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>` : '')
    + `</ar:FECAEDetRequest>`
  const xml = await fe(amb, 'FECAESolicitar', `${auth(c)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${x.ptoVta}</ar:PtoVta>`
    + `<ar:CbteTipo>${x.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${det}</ar:FeDetReq></ar:FeCAEReq>`)
  const falla = tag(xml, 'faultstring'); if (falla) throw new ErrorArca(`ARCA: ${falla}`)
  const detResp = tag(xml, 'FECAEDetResponse') ?? ''
  const resultado = (tag(detResp, 'Resultado') ?? tag(xml, 'Resultado') ?? 'R') as Respuesta['resultado']
  return {
    resultado, cae: tag(detResp, 'CAE') || null, caeVence: tag(detResp, 'CAEFchVto') || null,
    observaciones: errores(detResp, 'Observaciones', 'Obs').map((o) => `${o.code}: ${o.msg}`),
    errores: errores(xml),
  }
}

// ------------------------------------------------------------------ SOAP y XML mínimos
async function soap(destino: string, accion: string, cuerpo: string): Promise<string> {
  let r: Response
  try {
    r = await fetch(destino, {
      method: 'POST', body: cuerpo, signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${accion}"` },
    })
  } catch (e) {
    console.error('ARCA sin conexión', destino, e)
    throw new ErrorArca('No hay conexión con ARCA. Puede estar caído o lento: probá de nuevo en un rato.', -1)
  }
  const t = await r.text()
  if (!r.ok && !t.includes('Envelope')) throw new ErrorArca(`ARCA respondió con error ${r.status}. Probá de nuevo en un rato.`, -1)
  return t
}
/** Contenido de la primera etiqueta con ese nombre (con o sin prefijo de espacio de nombres) */
function tag(xml: string, nombre: string): string | null {
  const m = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`).exec(xml)
  return m ? m[1].trim() : null
}
function tags(xml: string, nombre: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, 'g'))].map((m) => m[1])
}
const desescapar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// ---- la función ----
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
  const hecha = await autorizar(c, cred, f)
  await db.from('tickets').update({ sin_factura: false }).eq('id', t.id)   // si estaba marcada "sin factura", ya no
  return hecha
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
