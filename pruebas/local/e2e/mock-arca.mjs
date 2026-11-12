// ARCA simulado para probar la facturación sin salir de la PC: WSAA (verifica de verdad la firma CMS
// contra una CA de prueba con openssl) y WSFEv1 (FEDummy, FECompUltimoAutorizado, FECAESolicitar, FECompConsultar).
// También firma pedidos de certificado (CSR) como lo haría ARCA: POST /firmar con el CSR en el cuerpo.
// Control para las pruebas: POST /control {"cortar": true} corta la conexión en la próxima factura después de autorizarla.
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIR = process.env.DIR || mkdtempSync(join(tmpdir(), 'arca-'))
const CA_KEY = join(DIR, 'ca.key'), CA = join(DIR, 'ca.pem')
if (!existsSync(CA)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', CA_KEY, '-out', CA, '-days', '30', '-subj', '/C=AR/O=ARCA simulado/CN=Computadores Test'], { stdio: 'ignore' })
}
const tas = new Map()          // cert sujeto → {token, vence}
const tokens = new Map()       // token → cuit
const comps = new Map()        // "pv-tipo" → [{nro, total, fecha, docTipo, docNro, cae, vto}]
let cortar = false
const log = (...a) => console.log('[arca]', ...a)

const tag = (x, n) => { const m = new RegExp(`<(?:[\\w-]+:)?${n}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${n}>`).exec(x); return m ? m[1].trim() : null }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sobre = (cuerpo) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`
const falla = (msg) => sobre(`<soapenv:Fault xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><faultcode>ns1:cms.bad</faultcode><faultstring>${esc(msg)}</faultstring></soapenv:Fault>`)
const fe = (metodo, inner) => sobre(`<${metodo}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${metodo}Result>${inner}</${metodo}Result></${metodo}Response>`)
const err = (code, msg) => `<Errors><Err><Code>${code}</Code><Msg>${esc(msg)}</Msg></Err></Errors>`
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

function wsaa(xml) {
  const cms = tag(xml, 'in0')
  if (!cms) return [500, falla('Falta in0')]
  const f = join(DIR, `cms-${Date.now()}.der`)
  writeFileSync(f, Buffer.from(cms, 'base64'))
  let tra, sujeto
  try {
    tra = execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', f, '-CAfile', CA, '-purpose', 'any'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    sujeto = execFileSync('sh', ['-c', `openssl cms -cmsout -print -inform DER -in ${f} | grep -m1 'subject:' || true`]).toString().trim()
  } catch (e) { log('firma inválida', e.stderr?.toString()); return [500, falla('cms.sign.invalid: Firma inválida o algoritmo no soportado')] }
  if (tag(tra, 'service') !== 'wsfe') return [500, falla('El servicio no existe')]
  const gen = new Date(tag(tra, 'generationTime')), exp = new Date(tag(tra, 'expirationTime')), ahora = Date.now()
  if (!(gen.getTime() < ahora && exp.getTime() > ahora)) return [500, falla('generationTime/expirationTime inválidos')]
  const cuit = /CUIT (\d{11})/.exec(sujeto)?.[1] || /serialNumber\s*=\s*CUIT (\d{11})/.exec(sujeto)?.[1]
  const ya = tas.get(sujeto)
  if (ya && ya.vence > ahora) return [500, falla('El CEE ya posee un TA valido para el acceso al WSN solicitado')]
  const token = Buffer.from(`tok-${Math.random()}`).toString('base64'), sign = Buffer.from(`sig-${Math.random()}`).toString('base64')
  const vence = new Date(ahora + 12 * 3600_000)
  tas.set(sujeto, { token, vence: vence.getTime() }); tokens.set(token, cuit)
  log('TA nuevo para', cuit)
  const resp = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><loginTicketResponse version="1.0"><header><source>CN=wsaahomo</source><destination>${esc(sujeto)}</destination><uniqueId>1</uniqueId>`
    + `<generationTime>${new Date(ahora).toISOString()}</generationTime><expirationTime>${vence.toISOString().replace('Z', '-00:00')}</expirationTime></header>`
    + `<credentials><token>${token}</token><sign>${sign}</sign></credentials></loginTicketResponse>`
  return [200, sobre(`<ns1:loginCmsResponse xmlns:ns1="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${esc(resp)}</loginCmsReturn></ns1:loginCmsResponse>`)]
}

function wsfe(accion, xml, res) {
  const metodo = accion.replace(/"/g, '').split('/').pop()
  if (metodo === 'FEDummy') return [200, fe('FEDummy', '<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>')]
  const token = tag(xml, 'Token'), cuit = tag(xml, 'Cuit')
  if (!tokens.has(token) || tokens.get(token) !== cuit) return [200, fe(metodo, err(600, 'ValidacionDeToken: No validaron las credenciales'))]
  if (metodo === 'FECompUltimoAutorizado') {
    const k = `${tag(xml, 'PtoVta')}-${tag(xml, 'CbteTipo')}`, l = comps.get(k) ?? []
    return [200, fe(metodo, `<PtoVta>${tag(xml, 'PtoVta')}</PtoVta><CbteTipo>${tag(xml, 'CbteTipo')}</CbteTipo><CbteNro>${l.length ? l[l.length - 1].nro : 0}</CbteNro>`)]
  }
  if (metodo === 'FECompConsultar') {
    const k = `${tag(xml, 'PtoVta')}-${tag(xml, 'CbteTipo')}`, c = (comps.get(k) ?? []).find((x) => String(x.nro) === tag(xml, 'CbteNro'))
    if (!c) return [200, fe(metodo, err(602, 'No existen datos en nuestros registros para los parametros ingresados.'))]
    return [200, fe(metodo, `<ResultGet><Concepto>1</Concepto><DocTipo>${c.docTipo}</DocTipo><DocNro>${c.docNro}</DocNro><CbteDesde>${c.nro}</CbteDesde><CbteHasta>${c.nro}</CbteHasta>`
      + `<CbteFch>${c.fecha}</CbteFch><ImpTotal>${c.total}</ImpTotal><Resultado>A</Resultado><CodAutorizacion>${c.cae}</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>${c.vto}</FchVto></ResultGet>`)]
  }
  if (metodo === 'FECAESolicitar') {
    const pv = tag(xml, 'PtoVta'), tipo = tag(xml, 'CbteTipo'), k = `${pv}-${tipo}`, l = comps.get(k) ?? []
    const nro = Number(tag(xml, 'CbteDesde')), total = Number(tag(xml, 'ImpTotal')), neto = Number(tag(xml, 'ImpNeto'))
    const cab = `<FeCabResp><Cuit>${cuit}</Cuit><PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><FchProceso>${yyyymmdd(new Date())}</FchProceso><CantReg>1</CantReg>`
    const rechazo = (code, msg) => [200, fe(metodo, `${cab}<Resultado>R</Resultado><Reproceso>N</Reproceso></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado>`
      + `<Observaciones><Obs><Code>${code}</Code><Msg>${esc(msg)}</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp>`)]
    const ultimo = l.length ? l[l.length - 1].nro : 0
    if (nro !== ultimo + 1) return [200, fe(metodo, `${cab}<Resultado>R</Resultado></FeCabResp>${err(10016, `El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.`)}`)]
    if (!['11', '13'].includes(tipo)) return rechazo(10007, 'Tipo de comprobante no habilitado para monotributo')
    if (Math.abs(total - neto) > 0.001 || Number(tag(xml, 'ImpIVA')) !== 0) return rechazo(10048, 'Para comprobantes C el ImpTotal debe ser igual al ImpNeto')
    if (!tag(xml, 'CondicionIVAReceptorId')) return rechazo(10246, 'Falta CondicionIVAReceptorId')
    const docTipo = Number(tag(xml, 'DocTipo')), docNro = Number(tag(xml, 'DocNro'))
    if (docTipo === 99 && (docNro !== 0 || total >= 10000000)) return rechazo(10015, 'Consumidor final sin identificar: DocNro 0 y menos de $10.000.000')
    if (tipo === '13') {
      const asoc = tag(xml, 'CbteAsoc')
      if (!asoc) return rechazo(10040, 'Nota de crédito sin comprobante asociado')
      const orig = (comps.get(`${tag(asoc, 'PtoVta')}-${tag(asoc, 'Tipo')}`) ?? []).find((x) => String(x.nro) === tag(asoc, 'Nro'))
      if (!orig) return rechazo(10151, 'El comprobante asociado no existe')
    }
    const cae = String(70000000000000 + Math.floor(Math.random() * 9999999999)), vto = yyyymmdd(new Date(Date.now() + 10 * 86400_000))
    l.push({ nro, total, fecha: tag(xml, 'CbteFch'), docTipo, docNro, cae, vto }); comps.set(k, l)
    log(`autorizado ${tipo} ${pv}-${nro} $${total} CAE ${cae}`)
    if (cortar) { cortar = false; log('cortando la conexión a propósito'); res.socket.destroy(); return null }
    return [200, fe(metodo, `${cab}<Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>${docTipo}</DocTipo>`
      + `<DocNro>${docNro}</DocNro><CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><CbteFch>${tag(xml, 'CbteFch')}</CbteFch><Resultado>A</Resultado>`
      + (docTipo === 99 ? '' : '<Observaciones><Obs><Code>10217</Code><Msg>Aviso de prueba del simulado</Msg></Obs></Observaciones>')
      + `<CAE>${cae}</CAE><CAEFchVto>${vto}</CAEFchVto></FECAEDetResponse></FeDetResp>`)]
  }
  return [500, falla('Método desconocido ' + metodo)]
}

createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    let r
    if (req.url.startsWith('/control')) { cortar = !!JSON.parse(b || '{}').cortar; r = [200, '{"ok":true}'] }
    else if (req.url.startsWith('/firmar')) {
      const f = join(DIR, `csr-${Date.now()}`)
      writeFileSync(f + '.csr', b)
      try {
        execFileSync('openssl', ['x509', '-req', '-in', f + '.csr', '-CA', CA, '-CAkey', CA_KEY, '-CAcreateserial', '-out', f + '.crt', '-days', '730', '-sha256'], { stdio: 'ignore' })
        r = [200, readFileSync(f + '.crt', 'utf8')]
      } catch { r = [400, 'CSR inválido'] }
    } else if (req.url.startsWith('/wsaa')) r = wsaa(b)
    else if (req.url.startsWith('/wsfe')) r = wsfe(req.headers.soapaction ?? '', b, res)
    else r = [404, 'no']
    if (!r) return
    res.writeHead(r[0], { 'Content-Type': 'text/xml; charset=utf-8' }); res.end(r[1])
  })
}).listen(Number(process.env.PORT || 54333), () => log('ARCA simulado listo, CA en', CA))
