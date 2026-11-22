// Las filas de una receta (artículo, cantidad, al plato o limpio crudo), con artículos nuevos
// y el botón para que Chichito estime la receta. Lo usan Stock → Recetas y el plato del día.
import { useState } from 'react'
import { invocar, supabase } from '../lib/supabase'
import { tabla, useConsulta } from '../lib/datos'
import { crudo, num, plata } from '../lib/formato'
import { UNIDADES, type Insumo, type RecetaItem, type Referencia } from '../lib/tipos'

export interface FilaReceta {
  iid: string            // id del artículo, o 'nuevo'
  cant: string
  cocido: boolean
  nuevo?: { nombre: string; unidad: string; costo: string; merma: string }
}

export const filaVacia = (): FilaReceta => ({ iid: '', cant: '', cocido: false })
export const filasDe = (receta: RecetaItem[]): FilaReceta[] =>
  receta.length ? receta.map((r) => ({ iid: String(r.insumo_id), cant: String(r.cantidad), cocido: !!r.cocido })) : [filaVacia()]

const completa = (f: FilaReceta) => Number(f.cant) > 0 && (f.iid === 'nuevo' ? (f.nuevo?.nombre.trim().length ?? 0) >= 2 : !!f.iid)
const empezada = (f: FilaReceta) => !!(f.iid || f.cant)

/** Lo que hay que comprar para una fila y lo que cuesta */
function compraFila(f: FilaReceta, insumos: Insumo[]) {
  const c = Number(f.cant)
  if (!(c > 0)) return null
  if (f.iid === 'nuevo') {
    const n = f.nuevo!, q = crudo(c, false, Number(n.merma) || 0, 1)
    return { q, unidad: n.unidad, costo: q * (Number(n.costo) || 0) }
  }
  const i = insumos.find((x) => String(x.id) === f.iid)
  if (!i) return null
  const q = crudo(c, f.cocido, i.merma_pct, i.rinde_coccion)
  return { q, unidad: i.unidad, costo: q * i.costo }
}

export const costoFilas = (filas: FilaReceta[], insumos: Insumo[]) =>
  filas.filter(completa).reduce((s, f) => s + (compraFila(f, insumos)?.costo ?? 0), 0)

/** Revisa las filas y arma lo que espera guardar_receta. Devuelve un texto si hay algo a medio cargar. */
export function itemsFilas(filas: FilaReceta[]): { items: unknown[]; error?: string } {
  if (filas.some((f) => empezada(f) && !completa(f))) return { items: [], error: 'Completá artículo y cantidad en cada fila, o quitá la que sobra.' }
  return {
    items: filas.filter(completa).map((f) => f.iid === 'nuevo'
      ? { nuevo: { nombre: f.nuevo!.nombre.trim(), unidad: f.nuevo!.unidad, costo: Number(f.nuevo!.costo) || 0, merma_pct: Number(f.nuevo!.merma) || 0 }, cantidad: Number(f.cant), cocido: false }
      : { insumo_id: Number(f.iid), cantidad: Number(f.cant), cocido: f.cocido }),
  }
}

export function FilasReceta({ filas, setFilas, insumos }: { filas: FilaReceta[]; setFilas: (f: FilaReceta[]) => void; insumos: Insumo[] }) {
  const refs = useConsulta(() => tabla<Referencia[]>(supabase.from('referencias').select('*')))
  const activos = insumos.filter((i) => i.activo)
  const cambiar = (k: number, c: Partial<FilaReceta>) => setFilas(filas.map((x, j) => (j === k ? { ...x, ...c } : x)))
  const cambiarNuevo = (k: number, c: Partial<NonNullable<FilaReceta['nuevo']>>) => cambiar(k, { nuevo: { ...filas[k].nuevo!, ...c } })
  return <>
    <div className="rows">{filas.map((f, k) => {
      const i = insumos.find((x) => String(x.id) === f.iid)
      const compra = compraFila(f, insumos)
      return <div className="row" key={k}>
        <select id={`rec-i-${k}`} aria-label="Artículo" value={f.iid} onChange={(e) => {
          const v = e.target.value, n = insumos.find((x) => String(x.id) === v)
          cambiar(k, v === 'nuevo' ? { iid: v, cocido: false, nuevo: f.nuevo ?? { nombre: '', unidad: 'kg', costo: '', merma: '0' } } : { iid: v, cocido: n ? Number(n.rinde_coccion) !== 1 : false })
        }} style={{ flex: 2, minWidth: 150, width: 'auto' }}>
          <option value="">Elegí artículo</option>
          <option value="nuevo">＋ Artículo nuevo…</option>
          {activos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
        <input id={`rec-c-${k}`} type="number" step="any" min={0} inputMode="decimal" placeholder="Cant." aria-label="Cantidad por porción" value={f.cant} onChange={(e) => cambiar(k, { cant: e.target.value })} style={{ flex: 1, minWidth: 80, width: 'auto' }} />
        {f.iid === 'nuevo'
          ? <select id={`rec-u-${k}`} aria-label="Unidad" value={f.nuevo!.unidad} onChange={(e) => cambiarNuevo(k, { unidad: e.target.value })} style={{ width: 'auto', flex: '0 0 auto' }}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
          : <span className="mono muted" style={{ minWidth: '3em' }}>{i?.unidad ?? ''}</span>}
        {f.iid === 'nuevo'
          ? <span className="muted" style={{ fontSize: 12, flex: '0 1 130px' }}>limpio crudo</span>
          : <select id={`rec-k-${k}`} aria-label="Cómo está la cantidad" value={f.cocido ? 'cocido' : 'limpio'} onChange={(e) => cambiar(k, { cocido: e.target.value === 'cocido' })} style={{ width: 'auto', flex: '0 1 130px' }}>
            <option value="cocido">al plato</option><option value="limpio">limpio crudo</option></select>}
        {compra && <span className="mono muted" style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }} title="Lo que hay que comprar y su costo">compra {num(compra.q)} {compra.unidad}<br />{plata(compra.costo)}</span>}
        <button className="btn sm ghost danger" onClick={() => setFilas(filas.filter((_, j) => j !== k))} aria-label="Quitar ingrediente">Quitar</button>
        {f.iid === 'nuevo' && <div className="nuevo-art" style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input id={`rec-n-${k}`} placeholder="Nombre del artículo nuevo" aria-label="Nombre del artículo nuevo" value={f.nuevo!.nombre} onChange={(e) => cambiarNuevo(k, { nombre: e.target.value })} style={{ flex: 2, minWidth: 160, width: 'auto' }} />
          <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>$ por {f.nuevo!.unidad}<input id={`rec-p-${k}`} type="number" step="any" min={0} inputMode="decimal" value={f.nuevo!.costo} onChange={(e) => cambiarNuevo(k, { costo: e.target.value })} style={{ width: 100 }} /></label>
          <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>se tira %<input id={`rec-m-${k}`} type="number" step="any" min={0} max={90} inputMode="decimal" value={f.nuevo!.merma} onChange={(e) => cambiarNuevo(k, { merma: e.target.value })} style={{ width: 64 }} /></label>
        </div>}
        {(() => { const r = i && refs.datos?.find((x) => x.id === i.referencia_id); return r?.porcion ? <div className="muted" style={{ flexBasis: '100%', fontSize: 12 }}>Porción típica de {r.nombre.toLowerCase()}: {num(r.porcion)} {r.unidad}{r.porcion_es === 'cocido' && Number(r.rinde_coccion) !== 1 ? ' al plato' : ''}{r.nota ? ` · ${r.nota}` : ''}</div> : null })()}
      </div>
    })}</div>
    <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFilas([...filas, filaVacia()])}>Agregar ingrediente</button>
  </>
}

interface Estimada { porcion: string | null; items: { insumo_id: number | null; nombre: string; unidad: string; cantidad: number; costo?: number; merma_pct?: number }[] }

/** "Que Chichito calcule la receta": la estima con IA a partir del nombre y lo que lleva */
export function EstimarReceta({ nombre, descripcion, insumos, onFilas }: { nombre: string; descripcion: string; insumos: Insumo[]; onFilas: (f: FilaReceta[], porcion: string | null) => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  async function estimar() {
    if (!nombre.trim()) { setErr('Primero poné el nombre del plato.'); return }
    setErr(''); setOcupado(true)
    const { data, error } = await invocar<Estimada>('ia', { tipo: 'receta', nombre, descripcion })
    setOcupado(false)
    if (error || !data) { setErr(error ?? 'No se pudo calcular.'); return }
    onFilas(data.items.map((x) => {
      const ins = (x.insumo_id != null ? insumos.find((i) => i.id === x.insumo_id) : undefined)
        ?? insumos.find((i) => i.nombre.toLowerCase() === x.nombre.trim().toLowerCase())
      return ins
        ? { iid: String(ins.id), cant: String(x.cantidad), cocido: false }
        : { iid: 'nuevo', cant: String(x.cantidad), cocido: false, nuevo: { nombre: x.nombre, unidad: x.unidad, costo: String(x.costo ?? ''), merma: String(x.merma_pct ?? 0) } }
    }), data.porcion)
  }
  return <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
    <button className="btn" data-ayuda="estimar-receta" disabled={ocupado} onClick={estimar}>{ocupado ? 'Calculando…' : '✨ Que Chichito calcule la receta'}</button>
    {err && <span className="err" style={{ margin: 0 }}>{err}</span>}
  </div>
}
