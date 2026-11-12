// Cliente de los web services de ARCA (ex AFIP): WSAA para entrar y WSFEv1 para facturar.
// Sin dependencias de Supabase: recibe la clave, el certificado y los datos, y devuelve lo que contesta ARCA.
// @deno-types="npm:@types/node-forge@1.3.11"
import forge from "npm:node-forge@1.3.1"

export type Ambiente = 'homologacion' | 'produccion'

const URLS: Record<Ambiente, { wsaa: string; wsfe: string }> = {
  homologacion: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  produccion: { wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
}
/** Las pruebas locales apuntan a un ARCA simulado con ARCA_WSAA_URL y ARCA_WSFE_URL */
const url = (amb: Ambiente, s: 'wsaa' | 'wsfe') =>
  Deno.env.get(s === 'wsaa' ? 'ARCA_WSAA_URL' : 'ARCA_WSFE_URL') || URLS[amb][s]

export class ErrorArca extends Error {
  constructor(msg: string, public codigo?: number) { super(msg) }
}

// ------------------------------------------------------------------ clave y certificado
/** Clave RSA 2048 nueva (con la criptografía nativa, rápida) en PEM */
export async function nuevaClave(): Promise<string> {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', par.privateKey))
  let bin = ''; for (const b of der) bin += String.fromCharCode(b)
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n').trim()}\n-----END PRIVATE KEY-----\n`
}

/** Pedido de certificado (CSR) como lo pide ARCA: C=AR, O=razón social, CN=alias, serialNumber=CUIT nnnnnnnnnnn */
export function pedidoCertificado(clavePem: string, cuit: string, razonSocial: string, alias = 'ultimavuelta'): string {
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
export function leerCertificado(certPem: string, clavePem: string): { vence: Date; sujeto: string; cuit: string | null } {
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
export interface TicketAcceso { token: string; sign: string; vence: string }

function fechaArca(d: Date) {
  // ISO con la hora de Argentina: 2026-11-12T12:00:00-03:00
  const a = new Date(d.getTime() - 3 * 3600_000)
  return a.toISOString().replace(/\.\d{3}Z$/, '-03:00')
}

export async function entrar(amb: Ambiente, clavePem: string, certPem: string, servicio = 'wsfe'): Promise<TicketAcceso> {
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
export interface Credencial { token: string; sign: string; cuit: string }
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

export async function estadoServidores(amb: Ambiente) {
  const xml = await fe(amb, 'FEDummy', '')
  return { app: tag(xml, 'AppServer'), db: tag(xml, 'DbServer'), auth: tag(xml, 'AuthServer') }
}

export async function ultimoAutorizado(amb: Ambiente, c: Credencial, ptoVta: number, tipo: number): Promise<number> {
  const xml = await fe(amb, 'FECompUltimoAutorizado', `${auth(c)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`)
  tirarSiError(xml)
  return Number(tag(xml, 'CbteNro') ?? 0)
}

/** Un comprobante ya emitido (para recuperar uno que quedó a medias), o null si no existe */
export async function consultar(amb: Ambiente, c: Credencial, ptoVta: number, tipo: number, numero: number) {
  const xml = await fe(amb, 'FECompConsultar', `${auth(c)}<ar:FeCompConsReq><ar:CbteTipo>${tipo}</ar:CbteTipo><ar:CbteNro>${numero}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`)
  const e = errores(xml)
  if (e.some((x) => x.code === 602)) return null   // no existe
  tirarSiError(xml)
  return {
    total: Number(tag(xml, 'ImpTotal')), fecha: tag(xml, 'CbteFch') ?? '', docTipo: Number(tag(xml, 'DocTipo')), docNro: Number(tag(xml, 'DocNro')),
    cae: tag(xml, 'CodAutorizacion') ?? '', caeVence: tag(xml, 'FchVto') ?? '', resultado: tag(xml, 'Resultado') ?? '',
  }
}

export interface Comprobante {
  ptoVta: number; tipo: 11 | 13; numero: number; fecha: string /* yyyymmdd */; total: number
  docTipo: number; docNro: number; condIva: number
  asociado?: { tipo: number; ptoVta: number; numero: number; fecha: string; cuit: string }
}
export interface Respuesta { resultado: 'A' | 'R' | 'P'; cae: string | null; caeVence: string | null; observaciones: string[]; errores: { code: number; msg: string }[] }

const importe = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** Pide el CAE de una Factura C o Nota de crédito C (monotributo: sin IVA discriminado, todo es neto) */
export async function pedirCae(amb: Ambiente, c: Credencial, x: Comprobante): Promise<Respuesta> {
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
