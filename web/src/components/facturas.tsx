import { useState } from 'react'
import { COND_IVA, TIPO_FACTURA, facturarTicket, linkFactura, numeroFactura, type Receptor } from '../lib/factura'
import { plata } from '../lib/formato'
import type { Factura } from '../lib/tipos'
import { Modal, Pill } from './ui'

/** DNI o CUIT del cliente (opcional, obligatorio desde el tope) */
export function CamposReceptor({ r, set, total, tope }: { r: Receptor; set: (r: Receptor) => void; total: number; tope: number }) {
  const nro = (r.doc_nro ?? '').replace(/\D/g, '')
  const obligatorio = total >= tope
  const [abierto, setAbierto] = useState(obligatorio || !!nro)
  if (!abierto && !obligatorio) return <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAbierto(true)}>Factura a nombre de alguien (DNI o CUIT)</button>
  return <div className="stack" style={{ gap: 8 }}>
    {obligatorio && <div className="aviso warn">Desde {plata(tope)} ARCA pide identificar al cliente: cargá su DNI o CUIT.</div>}
    <div className="two">
      <label className="campo">DNI o CUIT<input id="fc-doc" inputMode="numeric" placeholder={obligatorio ? 'Obligatorio' : 'Opcional'} value={r.doc_nro ?? ''} onChange={(e) => set({ ...r, doc_nro: e.target.value })} /></label>
      <label className="campo">Nombre<input id="fc-nombre" maxLength={80} placeholder="Opcional" value={r.receptor ?? ''} onChange={(e) => set({ ...r, receptor: e.target.value })} /></label>
    </div>
    {nro.length === 11 && <label className="campo">Condición frente al IVA del cliente<select id="fc-cond" value={r.cond_iva ?? 5} onChange={(e) => set({ ...r, cond_iva: Number(e.target.value) })}>
      {[5, 6, 1, 4].map((c) => <option key={c} value={c}>{COND_IVA[c]}</option>)}</select>
      <small>Igual sale Factura C (son monotributistas), pero ARCA pide la condición del cliente.</small></label>}
  </div>
}

/** Lo que se ve cuando la factura salió (o no) */
export function ResultadoFactura({ f, error, onReintentar, ocupado }: { f: Factura | null; error: string; onReintentar?: () => void; ocupado?: boolean }) {
  if (f) {
    const link = linkFactura(f.codigo)
    return <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <div className="res-estado confirmada" style={{ width: '100%', boxSizing: 'border-box' }}>
        <b>{TIPO_FACTURA[f.tipo]} {numeroFactura(f.punto_venta, f.numero)}</b><span>CAE {f.cae} · {plata(f.total)}{f.ambiente === 'homologacion' ? ' · de prueba, no vale' : ''}</span>
      </div>
      {f.observaciones && <small className="muted">ARCA avisa: {f.observaciones}</small>}
      <div className="fila" style={{ justifyContent: 'center' }}>
        <a className="btn pri" href={`${link}?imprimir=1`} target="_blank" rel="noreferrer">Imprimir</a>
        <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`Tu factura: ${link}`)}`} target="_blank" rel="noreferrer">Mandar por WhatsApp</a>
        <a className="btn ghost" href={link} target="_blank" rel="noreferrer">Ver</a>
      </div>
    </div>
  }
  return <div className="stack">
    <div className="aviso bad" role="alert">{error}</div>
    <p className="muted" style={{ margin: 0, fontSize: 14 }}>La mesa quedó cobrada igual. La factura queda pendiente en la Caja para hacerla más tarde.</p>
    {onReintentar && <button className="btn pri" disabled={ocupado} onClick={onReintentar}>{ocupado ? 'Probando…' : 'Reintentar la factura'}</button>}
  </div>
}

/** Facturar un ticket ya cobrado (desde la Caja) */
export function FacturarTicket({ ticket, total, tope, onCerrar, onListo }: { ticket: number; total: number; tope: number; onCerrar: () => void; onListo: () => void }) {
  const [r, setR] = useState<Receptor>({})
  const [f, setF] = useState<Factura | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function hacer() {
    setOcupado(true); setError('')
    try { setF(await facturarTicket(ticket, r)); onListo() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  return <Modal titulo={f ? 'Factura lista' : `Facturar ${plata(total)}`} onCerrar={onCerrar}
    pie={f ? <><span className="grow" /><button className="btn" onClick={onCerrar}>Listo</button></>
      : <><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={hacer}>{ocupado ? 'Pidiendo a ARCA…' : 'Hacer la factura'}</button></>}>
    {f ? <ResultadoFactura f={f} error="" /> : <>
      <CamposReceptor r={r} set={setR} total={total} tope={tope} />
      {error && <div className="aviso bad" role="alert">{error}</div>}
    </>}
  </Modal>
}

/** Etiqueta de la factura de un ticket para las listas */
export function EstadoFacturaTicket({ fs, sinFactura, onFacturar, onAnular, onSinFactura }: {
  fs: Factura[]; sinFactura?: boolean; onFacturar?: () => void; onAnular?: (f: Factura) => void; onSinFactura?: () => void
}) {
  const viva = fs.find((f) => f.tipo === 11 && f.estado === 'autorizada' && !f.anulada)
  const pendiente = fs.find((f) => f.tipo === 11 && f.estado === 'pendiente')
  if (viva) return <span className="fila" style={{ gap: 4, flexWrap: 'nowrap' }}>
    <a className="mono" href={linkFactura(viva.codigo)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>C {numeroFactura(viva.punto_venta, viva.numero)}</a>
    {viva.ambiente === 'homologacion' && <Pill>prueba</Pill>}
    {onAnular && <button className="btn sm ghost danger" title="Hacer nota de crédito" onClick={() => onAnular(viva)}>Anular</button>}
  </span>
  if (sinFactura && !pendiente) return <span className="fila" style={{ gap: 4, flexWrap: 'nowrap' }}>
    <Pill>Sin factura</Pill>{onFacturar && <button className="btn sm ghost" onClick={onFacturar}>Facturar</button>}
  </span>
  return <span className="fila" style={{ gap: 4, flexWrap: 'nowrap' }}>
    {pendiente ? <Pill tono="warn">Pendiente</Pill> : fs.some((f) => f.anulada) ? <Pill>Anulada</Pill> : <Pill tono="crit">Falta factura</Pill>}
    {onFacturar && <button className="btn sm" onClick={onFacturar}>{pendiente ? 'Reintentar' : 'Facturar'}</button>}
    {onSinFactura && !pendiente && <button className="btn sm ghost" title="Marcarla como venta sin factura" onClick={onSinFactura}>No facturar</button>}
  </span>
}
