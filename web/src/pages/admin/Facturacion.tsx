import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { invocar, supabase } from '../../lib/supabase'
import { fecha, hhmm, plata } from '../../lib/formato'
import { TIPO_FACTURA, linkFactura, numeroFactura } from '../../lib/factura'
import type { ConfigFacturacion, Factura } from '../../lib/tipos'
import { SubNavAdmin } from './nav'
import { Cabeza, Pill, useAccion, useToast } from '../../components/ui'

const CAMPOS: [keyof ConfigFacturacion, string, string, string?][] = [
  ['cuit', 'CUIT del titular', 'Solo números, 11 dígitos', 'numeric'],
  ['razon_social', 'Razón social', 'Nombre y apellido del monotributista, como figura en ARCA'],
  ['nombre_fantasia', 'Nombre de fantasía', 'Lo que se ve arriba en la factura (Última Vuelta)'],
  ['domicilio', 'Domicilio comercial', 'Calle, número, Rada Tilly, Chubut'],
  ['iibb', 'Ingresos Brutos', 'Número de inscripción (o "Exento")'],
  ['inicio_actividades', 'Inicio de actividades', ''],
  ['punto_venta', 'Punto de venta', 'El número que crearon en ARCA para "Web Services" (no el de Comprobantes en línea)', 'numeric'],
]

function bajar(nombre: string, texto: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/pkcs10' })); a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
}
const venceTxt = (v: string | null) => (v ? `vence el ${fecha(v.slice(0, 10))}` : '')

export default function Facturacion() {
  const d = useConsulta(async () => {
    const [c, fs] = await Promise.all([
      tabla<ConfigFacturacion[]>(supabase.from('facturacion').select('*').eq('id', 1)),
      tabla<Factura[]>(supabase.from('facturas').select('*').order('creado', { ascending: false }).limit(15)),
    ])
    return { c: c[0], fs }
  })
  const [cambios, setCambios] = useState<Partial<ConfigFacturacion>>({})
  const [pegado, setPegado] = useState<{ amb: 'homologacion' | 'produccion'; texto: string } | null>(null)
  const { correr, ocupado } = useAccion()
  const avisar = useToast()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavAdmin /><p className="cargando">Cargando…</p></>
  const c = { ...d.datos.c, ...cambios }
  const fs = d.datos.fs
  const set = (k: keyof ConfigFacturacion, v: unknown) => setCambios({ ...cambios, [k]: v })
  const guardarCampos = (campos: Partial<ConfigFacturacion>, ok: string) => correr(async () => {
    const { error } = await supabase.from('facturacion').update(campos).eq('id', 1)
    if (error) throw new Error(/cuit/.test(error.message) ? 'El CUIT tiene que tener 11 números.' : error.message)
    setCambios({}); d.recargar()
  }, ok)
  const fn = (cuerpo: Record<string, unknown>, ok?: string) => correr(async () => {
    const r = await invocar<Record<string, unknown>>('arca', cuerpo)
    d.recargar()
    if (r.error) throw new Error(r.error)
    return r.data
  }, ok)

  const datosOk = !!(d.datos.c.cuit && d.datos.c.razon_social && d.datos.c.punto_venta && d.datos.c.domicilio)
  const cert = c.ambiente === 'produccion' ? d.datos.c.cert_produccion : d.datos.c.cert_homologacion
  const pruebaOk = !!d.datos.c.ultima_prueba_ok

  async function csr() {
    let texto = ''
    if (await correr(async () => { const r = await invocar<{ csr: string }>('arca', { accion: 'generar_csr' }); if (r.error) throw new Error(r.error); texto = r.data!.csr }, 'Pedido de certificado listo')) {
      bajar('ultimavuelta.csr', texto); d.recargar()
    }
  }
  async function leerArchivo(amb: 'homologacion' | 'produccion', file: File | undefined) {
    if (!file) return
    const texto = await file.text()
    fn({ accion: 'cargar_certificado', ambiente: amb, certificado: texto }, 'Certificado cargado')
  }

  return <>
    <Cabeza etiqueta="Administración" titulo="Facturación electrónica">
      {d.datos.c.activa ? <Pill tono="ok">Activa{d.datos.c.ambiente === 'homologacion' ? ' · modo prueba' : ''}</Pill> : <Pill>Sin activar</Pill>}
    </Cabeza>
    <SubNavAdmin />
    <p className="muted" style={{ margin: '0 0 16px', maxWidth: '75ch', fontSize: 14 }}>
      La app hace la <b>Factura C</b> de cada mesa directo con ARCA, como monotributistas, y la imprime o la manda por WhatsApp con su CAE y su QR.
      Se configura una vez, en cuatro pasos. Los trámites en la página de ARCA los puede hacer el contador con la clave fiscal del titular.
    </p>

    <section className="panel fac-paso" data-ayuda="fac-datos">
      <h3><span className="fac-n">1</span> Datos del bar {datosOk && <Pill tono="ok">Listo</Pill>}</h3>
      <div className="fac-grid">{CAMPOS.map(([k, t, ayuda, modo]) => <label className="campo" key={k}>{t}
        <input id={`fac-${k}`} type={k === 'inicio_actividades' ? 'date' : 'text'} inputMode={modo as 'numeric' | undefined} value={String(c[k] ?? '')}
          onChange={(e) => set(k, k === 'punto_venta' ? (e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null) : k === 'cuit' ? e.target.value.replace(/\D/g, '') : e.target.value)} />
        {ayuda && <small>{ayuda}</small>}</label>)}</div>
      <button className="btn pri" disabled={ocupado || !Object.keys(cambios).length} onClick={() => guardarCampos(cambios, 'Datos guardados')}>Guardar datos</button>
    </section>

    <section className="panel fac-paso" data-ayuda="fac-certificado">
      <h3><span className="fac-n">2</span> Certificado de ARCA {(d.datos.c.cert_homologacion || d.datos.c.cert_produccion) && <Pill tono="ok">Cargado</Pill>}</h3>
      <p style={{ marginTop: 0 }}>La app genera un <b>pedido de certificado</b> (archivo .csr). Con ese archivo, en ARCA se obtiene el <b>certificado</b> (.crt) y se carga acá.
        La clave privada queda guardada en el servidor de la app y no sale nunca.</p>
      <div className="fila" style={{ marginBottom: 12 }}>
        <button className="btn pri" disabled={ocupado || !datosOk} onClick={csr}>{d.datos.c.csr ? 'Volver a bajar el pedido (.csr)' : 'Generar pedido de certificado (.csr)'}</button>
        {d.datos.c.csr && <button className="btn ghost" onClick={async () => { try { await navigator.clipboard.writeText(d.datos!.c.csr!); avisar('Pedido copiado') } catch { /* */ } }}>Copiar el texto</button>}
        {!datosOk && <small className="muted">Primero completá y guardá los datos del paso 1.</small>}
      </div>
      <details className="fac-ayuda"><summary>Cómo se saca el certificado en ARCA</summary>
        <p><b>Para probar (homologación)</b>, con la clave fiscal del titular:</p>
        <ol>
          <li>En <i>Administrador de Relaciones de Clave Fiscal</i>, adherir el servicio <b>WSASS - Autogestión Certificados Homologación</b>.</li>
          <li>Entrar a <b>WSASS</b> → <i>Nuevo certificado</i>: nombre <code>ultimavuelta</code>, pegar el texto del pedido (.csr) y crear. Copiar el certificado que aparece y guardarlo como <code>prueba.crt</code>.</li>
          <li>En WSASS → <i>Crear autorización a servicio</i>: elegir ese certificado y el servicio <b>wsfe - Facturación Electrónica</b>.</li>
        </ol>
        <p><b>Para facturar de verdad (producción)</b>:</p>
        <ol>
          <li><i>Administración de puntos de venta y domicilios</i> → agregar un punto de venta del tipo <b>Factura Electrónica - Monotributo - Web Services</b>. Ese número va en el paso 1.</li>
          <li><i>Administración de Certificados Digitales</i> → agregar alias <code>ultimavuelta</code>, subir el archivo .csr y bajar el certificado (.crt).</li>
          <li><i>Administrador de Relaciones de Clave Fiscal</i> → <i>Nueva relación</i> → servicio <b>Facturación Electrónica</b> (ARCA → WebServices) → representante: el computador fiscal <code>ultimavuelta</code>.</li>
        </ol>
        <p className="muted">El mismo pedido (.csr) sirve para los dos certificados. Los certificados duran 2 años: Chichito avisa un mes antes.</p>
      </details>
      <div className="fac-grid" style={{ marginTop: 12 }}>
        {(['homologacion', 'produccion'] as const).map((amb) => { const tiene = amb === 'produccion' ? d.datos!.c.cert_produccion : d.datos!.c.cert_homologacion
          const vence = amb === 'produccion' ? d.datos!.c.vence_produccion : d.datos!.c.vence_homologacion
          return <div key={amb} className="fac-cert">
            <b>{amb === 'produccion' ? 'Certificado real (producción)' : 'Certificado de prueba (homologación)'}</b>
            <div>{tiene ? <Pill tono="ok">Cargado · {venceTxt(vence)}</Pill> : <Pill>Sin cargar</Pill>}</div>
            <div className="fila">
              <label className={`btn sm${d.datos!.c.csr ? '' : ' disabled'}`} style={{ cursor: 'pointer' }}>Subir .crt
                <input type="file" accept=".crt,.pem,.cer,.txt" hidden disabled={!d.datos!.c.csr || ocupado} onChange={(e) => { leerArchivo(amb, e.target.files?.[0]); e.target.value = '' }} /></label>
              <button className="btn sm ghost" disabled={!d.datos!.c.csr} onClick={() => setPegado({ amb, texto: '' })}>Pegar el texto</button>
            </div>
            {pegado?.amb === amb && <div className="stack" style={{ gap: 6 }}>
              <textarea rows={5} placeholder="-----BEGIN CERTIFICATE-----" value={pegado.texto} onChange={(e) => setPegado({ amb, texto: e.target.value })} style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }} />
              <button className="btn sm pri" disabled={ocupado || !pegado.texto.trim()} onClick={async () => { if (await fn({ accion: 'cargar_certificado', ambiente: amb, certificado: pegado.texto }, 'Certificado cargado')) setPegado(null) }}>Guardar certificado</button>
            </div>}
          </div> })}
      </div>
    </section>

    <section className="panel fac-paso" data-ayuda="fac-probar">
      <h3><span className="fac-n">3</span> Probar la conexión {pruebaOk && <Pill tono="ok">Conectado</Pill>}</h3>
      <div className="campo" style={{ marginBottom: 10 }}>Contra qué ARCA se factura
        <div className="chips" style={{ marginTop: 6 }}>
          <button className="chip" aria-pressed={c.ambiente === 'homologacion'} onClick={() => guardarCampos({ ambiente: 'homologacion' }, 'Modo prueba')}>Prueba (homologación)</button>
          <button className="chip" aria-pressed={c.ambiente === 'produccion'} onClick={() => { if (window.confirm('¿Pasar a producción? Desde ahora las facturas son reales y valen ante ARCA.')) guardarCampos({ ambiente: 'produccion' }, 'Facturando de verdad') }}>Real (producción)</button>
        </div>
        <small>Empezá en prueba: las facturas salen con CAE pero no valen. Cuando todo ande, pasá a real.</small></div>
      <div className="fila">
        <button className="btn pri" disabled={ocupado || !cert || !datosOk} onClick={() => fn({ accion: 'probar' })}>Probar conexión con ARCA</button>
        {!cert && <small className="muted">Falta el certificado de {c.ambiente === 'produccion' ? 'producción' : 'prueba'}.</small>}
      </div>
      {d.datos.c.ultima_prueba && <div className={`aviso ${d.datos.c.ultima_prueba_ok ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>
        {d.datos.c.ultima_prueba_msg} <span className="muted">({fecha(d.datos.c.ultima_prueba.slice(0, 10))} {hhmm(d.datos.c.ultima_prueba)})</span></div>}
    </section>

    <section className="panel fac-paso" data-ayuda="fac-activar">
      <h3><span className="fac-n">4</span> Activar</h3>
      <label className="fila" style={{ gap: 8, fontWeight: 600, marginBottom: 8 }}><input type="checkbox" checked={c.activa} disabled={ocupado || (!pruebaOk && !d.datos.c.activa)} style={{ width: 20, height: 20 }}
        onChange={(e) => { set('activa', e.target.checked); guardarCampos({ activa: e.target.checked }, e.target.checked ? 'Facturación activada' : 'Facturación desactivada') }} />Facturar desde la app</label>
      <label className="fila" style={{ gap: 8, marginBottom: 8 }}><input type="checkbox" checked={c.facturar_siempre} disabled={ocupado} style={{ width: 20, height: 20 }}
        onChange={(e) => { set('facturar_siempre', e.target.checked); guardarCampos({ facturar_siempre: e.target.checked }, 'Guardado') }} />Al cobrar, la factura viene tildada (se puede destildar en cada mesa)</label>
      <label className="campo" style={{ maxWidth: 320 }}>Desde qué monto hay que identificar al cliente ($)
        <input id="fac-tope" type="number" min={0} value={c.tope_identificar} onChange={(e) => set('tope_identificar', Number(e.target.value))}
          onBlur={() => cambios.tope_identificar != null && guardarCampos({ tope_identificar: cambios.tope_identificar }, 'Guardado')} />
        <small>Hoy ARCA lo pide desde $10.000.000 (RG 5700). Si cambia, se ajusta acá.</small></label>
      {!pruebaOk && !d.datos.c.activa && <small className="muted">Se activa después de probar la conexión.</small>}
    </section>

    {fs.length > 0 && <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Últimas facturas</h3>
      <div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Comprobante</th><th className="r">Total</th><th>Estado</th></tr></thead><tbody>
        {fs.map((f) => <tr key={f.id}><td className="mono">{fecha(f.fecha)}</td>
          <td>{f.estado === 'autorizada' ? <a href={linkFactura(f.codigo)} target="_blank" rel="noreferrer">{TIPO_FACTURA[f.tipo]} {numeroFactura(f.punto_venta, f.numero)}</a> : TIPO_FACTURA[f.tipo]}
            {f.ambiente === 'homologacion' && <> <Pill>prueba</Pill></>}</td>
          <td className="r mono">{plata(f.total)}</td>
          <td>{f.estado === 'autorizada' ? (f.anulada ? <Pill>Anulada</Pill> : <Pill tono="ok">CAE {f.cae}</Pill>) : f.estado === 'pendiente' ? <Pill tono="warn">Pendiente</Pill> : <span title={f.error ?? ''}><Pill tono="crit">Rechazada</Pill> <small className="muted">{f.error}</small></span>}</td></tr>)}
      </tbody></table></div></section>}
  </>
}
