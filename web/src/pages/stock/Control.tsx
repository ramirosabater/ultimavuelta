import { useMemo, useState } from 'react'
import { rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { hhmm, num, pct, plata } from '../../lib/formato'
import type { Insumo, Inventario, Proveedor } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { Cabeza, Modal, Pill, Stat, useAccion } from '../../components/ui'

interface FilaControl { insumo_id: number; nombre: string; unidad: string; inicial: number; final: number; entro: number; teorico: number; mermas: number; usado: number; sin_explicar: number; plata: number; costo: number }
const etiqueta = (x: Inventario) => `${new Date(x.fecha).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(x.fecha)}`

export default function Control() {
  const invs = useConsulta(() => tabla<Inventario[]>(supabase.from('inventarios').select('*').eq('completo', true).order('fecha', { ascending: false }).limit(30)))
  const [b, setB] = useState(0), [a, setA] = useState<number | null>(null)
  const [contar, setContar] = useState(false)
  const lista = invs.datos ?? []
  const bi = Math.min(b, Math.max(0, lista.length - 2)), ai = Math.max(bi + 1, Math.min(a ?? bi + 1, lista.length - 1))
  const control = useConsulta(async () => lista.length >= 2 ? rpc<FilaControl[]>('control_inventario', { p_desde: lista[ai].id, p_hasta: lista[bi].id }) : [], [lista.length, ai, bi, invs.datos])

  if (invs.error) return <div className="aviso bad">{invs.error}</div>
  if (!invs.datos) return <><SubNavStock /><p className="cargando">Cargando…</p></>
  const filas = control.datos ?? []
  const perdido = filas.filter((r) => r.sin_explicar > 0).reduce((s, r) => s + Number(r.plata), 0)
  const teoPlata = filas.reduce((s, r) => s + Number(r.teorico) * Number(r.costo), 0)
  const p = teoPlata > 0 ? perdido / teoPlata : 0
  const pill = (r: FilaControl) => {
    const rel = r.teorico > 0 ? r.sin_explicar / r.teorico : Math.abs(r.sin_explicar) > 0.0001 ? 1 : 0
    if (r.teorico <= 0 && Math.abs(r.sin_explicar) < 0.0001) return <Pill>Sin uso</Pill>
    if (r.sin_explicar < 0 && Math.abs(rel) > 0.03) return <Pill tono="acc">Se usó menos</Pill>
    const x = Math.abs(rel); return x <= 0.03 ? <Pill tono="ok">Bien</Pill> : x <= 0.08 ? <Pill tono="warn">Revisar</Pill> : <Pill tono="crit">Pérdida</Pill>
  }

  return <>
    <Cabeza etiqueta="Depósito" titulo="Control semanal"><button className="btn pri" onClick={() => setContar(true)} data-ayuda="inventario">Inventario completo</button></Cabeza>
    <SubNavStock />
    <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', maxWidth: '72ch' }}>Compara lo que se tendría que haber usado según lo vendido y las recetas, con lo que realmente salió del depósito entre dos inventarios. Lo que no explican las ventas ni las mermas cargadas es plata que se pierde sin que nadie lo vea.</p>
    {lista.length < 2 ? <div className="notice"><b>{lista.length ? 'Falta un inventario más.' : 'Hacé el primer inventario completo.'}</b><br />
      {lista.length ? `El último fue el ${etiqueta(lista[0])}. Hacé otro en unos días, al cierre, y acá aparece la comparación.` : 'Contá todo al cierre de una noche. Repetí cada semana, siempre a la misma hora.'}</div> : <>
      <div className="fila" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
        <label className="campo flt" style={{ flex: '1 1 170px' }}><span>Desde</span><select id="ctl-a" value={ai} onChange={(e) => setA(Number(e.target.value))}>
          {lista.map((x, k) => k > bi && <option key={x.id} value={k}>{etiqueta(x)}</option>)}</select></label>
        <label className="campo flt" style={{ flex: '1 1 170px' }}><span>Hasta</span><select id="ctl-b" value={bi} onChange={(e) => { const v = Number(e.target.value); setB(v); if ((a ?? v + 1) <= v) setA(v + 1) }}>
          {lista.map((x, k) => k < lista.length - 1 && <option key={x.id} value={k}>{etiqueta(x)}</option>)}</select></label>
      </div>
      <div className="stats" style={{ marginBottom: 12 }}>
        <Stat label="Plata sin explicar" valor={<span style={{ color: perdido > 0 ? 'var(--crit)' : 'inherit' }}>{plata(perdido)}</span>} />
        <Stat label="Sobre lo que se debía usar" valor={teoPlata > 0 ? pct(p, 1) : '—'} />
        <Stat label="Artículos comparados" valor={filas.length} />
      </div>
      {teoPlata > 0 && <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>{p <= 0.02 ? <><Pill tono="ok">Muy fino</Pill> Menos del 2 % sin explicar.</> : p <= 0.05 ? <><Pill tono="warn">A ajustar</Pill> Entre 2 % y 5 %: mirá los primeros de la lista.</> : <><Pill tono="crit">Se está perdiendo plata</Pill> Más del 5 %: revisá porciones, mermas sin cargar y compras sin registrar.</>}</p>}
      <section className="panel"><div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th className="r">Debía usarse</th><th className="r">Merma cargada</th><th className="r">Se usó</th><th className="r">Sin explicar</th><th className="r">Plata</th><th /></tr></thead><tbody>
        {filas.map((r) => <tr key={r.insumo_id}><td><b>{r.nombre}</b><div className="muted mono" style={{ fontSize: 11 }}>{num(r.inicial)} + {num(r.entro)} entró − {num(r.final)} al final</div></td>
          <td className="r mono">{num(r.teorico)} {r.unidad}</td><td className="r mono muted">{num(r.mermas)}</td><td className="r mono">{num(r.usado)}</td>
          <td className="r mono"><b>{r.sin_explicar > 0 ? '+' : ''}{num(r.sin_explicar)}</b></td>
          <td className="r mono" style={r.plata > 0 ? { color: 'var(--crit)' } : undefined}>{plata(r.plata)}</td><td>{pill(r)}</td></tr>)}
      </tbody></table></div></section>
      <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 8 }}>Cómo leerlo</h3><div className="rows" style={{ fontSize: 14 }}>
        <div className="row"><Pill tono="crit">Pérdida</Pill><span className="grow">Salió más de lo que explican las ventas. Suele ser porciones más grandes que la receta, comida tirada sin cargar o algo que desaparece.</span></div>
        <div className="row"><Pill tono="acc">Se usó menos</Pill><span className="grow">Puede ser una compra cargada de más, porciones más chicas que la receta o ventas que no pasaron por la caja.</span></div>
        <div className="row"><Pill tono="warn">Revisar</Pill><span className="grow">Diferencias chicas. Si se repite varias semanas, ajustá la receta o la merma con pruebas de rendimiento.</span></div>
      </div></section>
    </>}
    {contar && <InventarioModal onCerrar={() => setContar(false)} onListo={() => { setContar(false); setA(null); setB(0); invs.recargar() }} />}
  </>
}

export function InventarioModal({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const datos = useConsulta(async () => {
    const [insumos, provs] = await Promise.all([
      tabla<Insumo[]>(supabase.from('insumos').select('*').eq('activo', true).order('nombre')),
      tabla<Proveedor[]>(supabase.from('proveedores').select('id, nombre')),
    ])
    return { insumos, provs }
  })
  const [vals, setVals] = useState<Record<number, string>>({})
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const grupos = useMemo(() => {
    const g = new Map<string, Insumo[]>()
    for (const i of datos.datos?.insumos ?? []) { const k = datos.datos!.provs.find((p) => p.id === i.proveedor_id)?.nombre ?? 'Otros'; g.set(k, [...(g.get(k) ?? []), i]) }
    return [...g].sort((a, b) => a[0].localeCompare(b[0]))
  }, [datos.datos])
  const cargados = Object.values(vals).filter((v) => v !== '').length
  return <Modal titulo="Inventario completo" onCerrar={onCerrar} pie={<><div className="grow muted" style={{ fontSize: 13 }}>{cargados} de {datos.datos?.insumos.length ?? 0} contados</div>
    <button className="btn pri" disabled={ocupado} onClick={async () => {
      const items = Object.entries(vals).filter(([, v]) => v !== '' && Number(v) >= 0).map(([id, v]) => ({ insumo_id: Number(id), cantidad: Number(v) }))
      if (!items.length) { setErr('Cargá al menos un artículo.'); return }
      if (await correr(() => rpc('guardar_inventario', { p_items: items, p_completo: true }), `Inventario guardado (${items.length} artículos)`)) onListo()
    }}>Guardar inventario</button></>}>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Cargá lo que hay de verdad. Lo que dejes vacío no se cuenta esta vez.</p>
    {!datos.datos ? <p className="cargando">Cargando…</p> : <div className="rows">{grupos.map(([g, is]) => <div key={g}>
      <div className="label" style={{ paddingTop: 12 }}>{g}</div>
      {is.map((i) => <div className="row" key={i.id}><span className="grow"><b>{i.nombre}</b><div className="muted mono" style={{ fontSize: 12 }}>la app dice: {num(i.cantidad)} {i.unidad}</div></span>
        <input id={`inv-${i.id}`} type="number" step="any" min={0} inputMode="decimal" value={vals[i.id] ?? ''} onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} style={{ width: 110 }} aria-label={`${i.nombre} contado`} />
        <span className="mono muted" style={{ minWidth: '3em' }}>{i.unidad}</span></div>)}
    </div>)}</div>}
    {err && <div className="err">{err}</div>}
  </Modal>
}
