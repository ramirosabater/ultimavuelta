import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { COND_IVA, DOC, TIPO_FACTURA, linkQr, numeroFactura } from '../lib/factura'
import { fechaCorta, plata } from '../lib/formato'

interface Pub {
  tipo: 11 | 13; punto_venta: number; numero: number; fecha: string; total: number; doc_tipo: number; doc_nro: number; receptor: string | null
  cond_iva_receptor: number; cae: string; cae_vence: string; ambiente: string; anulada: boolean
  emisor: { cuit: string; razon_social: string; nombre_fantasia: string | null; domicilio: string | null; iibb: string | null; inicio_actividades: string | null }
  asociada: { tipo: number; punto_venta: number; numero: number; fecha: string } | null
  mesa: number | null; subtotal: number | null; descuento_pct: number | null; items: { nombre: string; cantidad: number; precio: number }[]
}
const fechaAr = (f: string | null) => (f ? `${fechaCorta(f)}/${f.slice(0, 4)}` : '—')
const cuitLindo = (c: string | number) => { const s = String(c); return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : s }

/** La factura impresa: pública con su código (/factura/<código>), para imprimir o mandar por WhatsApp */
export default function Factura() {
  const { codigo = '' } = useParams()
  const [q] = useSearchParams()
  const [f, setF] = useState<Pub | null | undefined>(undefined)
  const [qr, setQr] = useState('')
  useEffect(() => { supabase.rpc('factura_publica', { p_codigo: codigo }).then(({ data, error }) => setF(error ? null : (data as Pub | null))) }, [codigo])
  useEffect(() => {
    if (!f) return
    QRCode.toDataURL(linkQr(f, f.emisor.cuit), { width: 300, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''))
  }, [f])
  useEffect(() => { if (f && qr && q.get('imprimir')) window.setTimeout(() => window.print(), 300) }, [f, qr, q])

  if (f === undefined) return <div className="fac-pagina"><p className="muted">Cargando la factura…</p></div>
  if (f === null) return <div className="fac-pagina"><p className="pub-error">No encontramos esa factura. Revisá el link.</p></div>
  const e = f.emisor
  const desc = Number(f.descuento_pct) || 0
  const conDetalle = f.tipo === 11 && f.items.length > 0
  return <div className="fac-pagina">
    <div className="fac-acciones no-imprimir">
      <button className="btn pri" onClick={() => window.print()}>Imprimir o guardar PDF</button>
      <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`${TIPO_FACTURA[f.tipo]} ${numeroFactura(f.punto_venta, f.numero)}: ${window.location.href.split('?')[0]}`)}`} target="_blank" rel="noreferrer">Mandar por WhatsApp</a>
    </div>
    <article className="fac">
      {f.ambiente === 'homologacion' && <div className="fac-prueba">COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL</div>}
      {f.anulada && <div className="fac-prueba">ANULADA CON NOTA DE CRÉDITO</div>}
      <div className="fac-cab">
        <div className="fac-emisor">
          <b className="fac-nombre">{e.nombre_fantasia || e.razon_social}</b>
          {e.nombre_fantasia && <div>{e.razon_social}</div>}
          {e.domicilio && <div>{e.domicilio}</div>}
          <div>Responsable Monotributo</div>
        </div>
        <div className="fac-letra"><b>C</b><small>Cód. {String(f.tipo).padStart(3, '0')}</small></div>
        <div className="fac-datos">
          <b>{TIPO_FACTURA[f.tipo].toUpperCase()}</b>
          <div>N° <span className="mono">{numeroFactura(f.punto_venta, f.numero)}</span></div>
          <div>Fecha: {fechaAr(f.fecha)}</div>
          <div>CUIT: {cuitLindo(e.cuit)}</div>
          {e.iibb && <div>Ingresos Brutos: {e.iibb}</div>}
          {e.inicio_actividades && <div>Inicio de actividades: {fechaAr(e.inicio_actividades)}</div>}
        </div>
      </div>
      <section className="fac-receptor">
        <div><span className="muted">Cliente:</span> {f.receptor || (f.doc_tipo === 99 ? 'Consumidor final' : '—')}</div>
        {f.doc_tipo !== 99 && <div><span className="muted">{DOC[f.doc_tipo]}:</span> {f.doc_tipo === 80 ? cuitLindo(f.doc_nro) : f.doc_nro}</div>}
        <div><span className="muted">Condición frente al IVA:</span> {COND_IVA[f.cond_iva_receptor] ?? f.cond_iva_receptor}</div>
        <div><span className="muted">Condición de venta:</span> Contado</div>
        {f.asociada && <div><span className="muted">Anula:</span> {TIPO_FACTURA[f.asociada.tipo]} {numeroFactura(f.asociada.punto_venta, f.asociada.numero)} del {fechaAr(f.asociada.fecha)}</div>}
      </section>
      {conDetalle ? <table className="fac-items"><thead><tr><th>Cant.</th><th>Detalle</th><th className="r">Precio</th><th className="r">Importe</th></tr></thead><tbody>
        {f.items.map((i, k) => <tr key={k}><td className="mono">{i.cantidad}</td><td>{i.nombre}</td><td className="r mono">{plata(i.precio)}</td><td className="r mono">{plata(i.cantidad * i.precio)}</td></tr>)}
        {desc > 0 && <><tr><td /><td>Subtotal</td><td /><td className="r mono">{plata(f.subtotal)}</td></tr>
          <tr><td /><td>Descuento {desc} %</td><td /><td className="r mono">−{plata(Number(f.subtotal) - Number(f.total))}</td></tr></>}
      </tbody></table>
        : <table className="fac-items"><tbody><tr><td>{f.tipo === 13 ? 'Anulación de la operación' : 'Consumo'}{f.mesa ? ` · mesa ${f.mesa}` : ''}</td><td className="r mono">{plata(f.total)}</td></tr></tbody></table>}
      <div className="fac-total"><span>TOTAL</span><b className="mono">{plata(f.total)}</b></div>
      <div className="fac-pie">
        {qr && <img src={qr} width={110} height={110} alt="QR de ARCA para verificar el comprobante" />}
        <div>
          <div><b>CAE:</b> <span className="mono">{f.cae}</span></div>
          <div><b>Vto. CAE:</b> {fechaAr(f.cae_vence)}</div>
          <small className="muted">Comprobante autorizado por ARCA. Podés verificarlo escaneando el QR.</small>
        </div>
      </div>
    </article>
  </div>
}
