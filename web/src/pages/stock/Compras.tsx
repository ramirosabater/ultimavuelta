import { useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { DIAS, DIAS_LARGO, fecha, jornada, num, pct, plata, sumarDias } from '../../lib/formato'
import type { Insumo, Proveedor } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { CompraModal, FacturaModal, useBaseStock } from '../../components/stock'
import { Cabeza, Modal, Pill, useAccion, useToast } from '../../components/ui'

interface Prevision { historial: boolean; dias: number; cerrado_hoy: boolean; dow: number; platos_hoy: { id: number; nombre: string; estacion: string; cantidad: number }[]; insumos_hoy: { id: number; uso: number }[]; insumos: Record<string, number> }
interface Fila { i: Insumo; uso: number | null; qty: number; packs: number; costo: number }

export function listaCompras(insumos: Insumo[], prev: Prevision | null, colchon: number): Fila[] {
  const filas: Fila[] = []
  for (const i of insumos.filter((x) => x.activo)) {
    const min = Number(i.minimo) || 0
    const uso = prev?.historial ? Number(prev.insumos[String(i.id)] ?? 0) : null
    const objetivo = uso != null ? uso + Math.max(uso * colchon / 100, min) : min * (1 + colchon / 100)
    const falta = objetivo - Number(i.cantidad)
    if (falta <= 0.0001) continue
    const pk = Number(i.pack) || 0
    const qty = pk ? Math.ceil(falta / pk - 1e-9) * pk : Math.ceil(falta * 100) / 100
    filas.push({ i, uso, qty, packs: pk ? Math.round(qty / pk) : 0, costo: qty * Number(i.costo) })
  }
  return filas
}

export default function Compras() {
  const { perfil } = useAuth()
  const base = useBaseStock()
  const extra = useConsulta(async () => {
    const [prev, par, subas] = await Promise.all([
      rpc<Prevision>('prevision'),
      leerParametros(),
      tabla<{ insumo_id: number; costo_unit: number; hora: string }[]>(supabase.from('movimientos_stock').select('insumo_id, costo_unit, hora').eq('tipo', 'compra').gt('costo_unit', 0).order('hora', { ascending: false }).limit(400)),
    ])
    return { prev, par, subas }
  })
  const [ventana, setVentana] = useState<null | 'config' | { compra: Insumo; q: number } | { factura: File }>(null)
  const archivo = useRef<HTMLInputElement>(null)
  const avisar = useToast()
  const recargar = () => { base.recargar(); extra.recargar() }

  if (base.error || extra.error) return <div className="aviso bad">{base.error || extra.error}</div>
  if (!base.datos || !extra.datos) return <><SubNavStock /><p className="cargando">Calculando compras…</p></>
  const { insumos, proveedores, cuentas } = base.datos
  const { prev, par } = extra.datos
  const n = Number(par.cobertura_dias) || 3, colchon = Number(par.colchon_pct ?? 15), cerrado = (par.dias_cerrado ?? '').split(',').filter((x) => x.trim() !== '').map(Number)
  const filas = listaCompras(insumos, prev, colchon).sort((a, b) => (provDe(a.i, proveedores) || '~').localeCompare(provDe(b.i, proveedores) || '~') || a.i.nombre.localeCompare(b.i.nombre))
  // Subas: la última compra de cada artículo contra la anterior (últimos 30 días)
  const desde = sumarDias(jornada(), -30), vistos = new Map<number, number[]>()
  for (const m of extra.datos.subas) vistos.set(m.insumo_id, [...(vistos.get(m.insumo_id) ?? []), m.costo_unit])
  const subas = [...vistos].filter(([id]) => extra.datos!.subas.find((m) => m.insumo_id === id)!.hora.slice(0, 10) >= desde)
    .map(([id, cs]) => ({ i: insumos.find((x) => x.id === id), d: cs.length > 1 ? cs[0] / cs[1] - 1 : 0 })).filter((x) => x.i && x.d > 0.05)

  function texto() {
    const g = new Map<string, Fila[]>()
    for (const f of filas) { const k = provDe(f.i, proveedores) || 'Otros'; g.set(k, [...(g.get(k) ?? []), f]) }
    let t = `Pedido ${par.nombre_local ?? ''} · ${fecha(jornada())}\n`
    for (const [k, fs] of g) { t += `\n*${k}*\n`; for (const f of fs) t += `- ${f.packs ? `${f.packs} ${f.i.pack_nombre || 'pack'} (${num(f.qty)} ${f.i.unidad})` : `${num(f.qty)} ${f.i.unidad}`} ${f.i.nombre}\n` }
    return t
  }

  return <>
    <Cabeza etiqueta="Depósito" titulo="Compras">
      <button className="btn pri" onClick={() => archivo.current?.click()} data-ayuda="factura">Cargar factura (foto o PDF)</button>
      {perfil?.rol === 'admin' && <button className="btn" onClick={() => setVentana('config')}>Ajustar cálculo</button>}
    </Cabeza>
    <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden id="fac-file"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setVentana({ factura: f }) }} />
    <SubNavStock />
    {subas.length > 0 && <div className="alert" style={{ marginBottom: 12 }}><Pill tono="crit">Subas</Pill>
      <span className="grow">{subas.map((x) => `${x.i!.nombre} +${pct(x.d, 1)}`).join(' · ')}. Revisá el costo de los platos en Recetas y costos.</span></div>}
    <div className="alert" style={{ background: 'var(--sunk)', marginBottom: 16 }}><span className="grow">Compro para <b>{n} día{n > 1 ? 's' : ''}</b> · colchón <b>{colchon}%</b> · cerrado: <b>{cerrado.length ? cerrado.map((d) => DIAS[d]).join(', ') : 'ningún día'}</b></span></div>

    <section className="panel" style={{ marginBottom: 16 }} data-ayuda="preparar-hoy">
      <h3>Para preparar hoy</h3>
      <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Lo que se suele vender un {DIAS_LARGO[prev.dow]} según las últimas 4 semanas. Descongelá y prepará esto, no más.</p>
      {!prev.historial ? <div className="kempty">Hacen falta algunas noches de ventas cobradas para estimar.</div>
        : prev.cerrado_hoy ? <div className="kempty">Hoy el local está cerrado.</div>
        : !prev.platos_hoy.length ? <div className="kempty">Sin ventas para estimar este día.</div>
        : <div className="rep-grid" style={{ marginTop: 0 }}>
          <div style={{ minWidth: 0 }}><div className="label" style={{ marginBottom: 4 }}>Platos esperados</div><div className="rows">
            {prev.platos_hoy.filter((p) => p.estacion === 'cocina').slice(0, 10).map((p) => <div className="row" key={p.id}><span className="grow">{p.nombre}</span><span className="num mono">≈ {Math.max(1, Math.round(p.cantidad))}</span></div>)}</div></div>
          <div style={{ minWidth: 0 }}><div className="label" style={{ marginBottom: 4 }}>Artículos que se van a usar</div><div className="rows">
            {prev.insumos_hoy.slice(0, 12).map((x) => { const i = insumos.find((y) => y.id === x.id); if (!i) return null
              return <div className="row" key={x.id}><span className="grow">{i.nombre}</span><span className="mono">{num(x.uso)} {i.unidad}</span>{Number(i.cantidad) < x.uso ? <Pill tono="crit">Falta {num(x.uso - Number(i.cantidad))}</Pill> : <Pill tono="ok">Hay</Pill>}</div> })}</div></div>
        </div>}
    </section>

    <section className="panel" data-ayuda="lista-compras">
      <div className="fila" style={{ marginBottom: 4 }}><h3 className="grow">Lista de compras</h3>
        {filas.length > 0 && <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(texto()); avisar('Lista copiada. Pegala en WhatsApp.') } catch { setVentana(null); window.prompt?.('Copiá la lista', texto()) } }}>Copiar para WhatsApp</button>}</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 8px', maxWidth: '75ch' }}>{!prev.historial
        ? 'Todavía no hay historial de ventas, así que por ahora sugiero llegar al mínimo de cada artículo más el colchón. Con unas noches cobradas, la lista se calcula sola por lo que se vende cada día de la semana.'
        : `Lo que se va a usar los próximos ${n} días según las recetas y lo vendido esos mismos días las semanas anteriores, más el colchón (el ${colchon}% o el mínimo del artículo, lo que sea mayor), menos lo que ya hay. Redondeado a la presentación de compra.`}</p>
      {filas.length ? <>
        <div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th className="r">Hay</th><th className="r">Se usará</th><th className="r">Comprar</th><th className="r">Estimado</th><th /></tr></thead><tbody>
          {filas.map((f) => <tr key={f.i.id}><td><b>{f.i.nombre}</b>{provDe(f.i, proveedores) && <div className="muted" style={{ fontSize: 12 }}>{provDe(f.i, proveedores)}</div>}</td>
            <td className="r mono">{num(f.i.cantidad)} {f.i.unidad}</td><td className="r mono muted">{f.uso == null ? '—' : num(f.uso)}</td>
            <td className="r mono"><b>{f.packs ? `${f.packs} × ${f.i.pack_nombre || 'pack'}` : `${num(f.qty)} ${f.i.unidad}`}</b>{f.packs ? <span className="muted"> ({num(f.qty)} {f.i.unidad})</span> : null}</td>
            <td className="r mono">{plata(f.costo)}</td>
            <td className="r"><button className="btn sm" onClick={() => setVentana({ compra: f.i, q: f.qty })}>Llegó</button></td></tr>)}
        </tbody></table></div>
        <div className="total-row"><span className="label">Total estimado</span><span className="num">{plata(filas.reduce((s, f) => s + f.costo, 0))}</span></div>
      </> : <div className="kempty">No hace falta comprar nada para los próximos {n} días.</div>}
    </section>

    {ventana === 'config' && <ConfigCompras par={par} onCerrar={() => setVentana(null)} onListo={() => { setVentana(null); extra.recargar() }} />}
    {ventana && typeof ventana === 'object' && 'compra' in ventana && <CompraModal insumo={ventana.compra} cantidad={ventana.q} proveedores={proveedores} cuentas={cuentas} onCerrar={() => setVentana(null)} onListo={() => { setVentana(null); recargar() }} />}
    {ventana && typeof ventana === 'object' && 'factura' in ventana && <FacturaModal archivo={ventana.factura} insumos={insumos} proveedores={proveedores} cuentas={cuentas} onCerrar={() => setVentana(null)} onListo={() => { setVentana(null); recargar() }} />}
  </>
}

const provDe = (i: Insumo, ps: Proveedor[]) => ps.find((p) => p.id === i.proveedor_id)?.nombre ?? ''

function ConfigCompras({ par, onCerrar, onListo }: { par: Record<string, string>; onCerrar: () => void; onListo: () => void }) {
  const [dias, setDias] = useState(par.cobertura_dias ?? '3'), [col, setCol] = useState(par.colchon_pct ?? '15')
  const [cerr, setCerr] = useState<number[]>((par.dias_cerrado ?? '').split(',').filter((x) => x.trim() !== '').map(Number))
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Cálculo de compras" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
    const filas = [{ clave: 'cobertura_dias', valor: String(Math.min(14, Math.max(1, Number(dias) || 3))) }, { clave: 'colchon_pct', valor: String(Math.min(100, Math.max(0, Number(col) || 0))) }, { clave: 'dias_cerrado', valor: cerr.join(',') }]
    if (await correr(async () => { const { error } = await supabase.from('parametros').upsert(filas); if (error) throw new Error(error.message) }, 'Cálculo actualizado')) onListo()
  }}>Guardar</button></>}>
    <div className="two">
      <label className="campo">Comprar para (días)<input id="q-dias" type="number" min={1} max={14} inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} /></label>
      <label className="campo">Colchón (%)<input id="q-seg" type="number" min={0} max={100} inputMode="numeric" value={col} onChange={(e) => setCol(e.target.value)} /></label>
    </div>
    <p className="muted" style={{ fontSize: 13, margin: 0 }}>Días: cada cuánto compran o reciben pedidos. Colchón: margen extra por si la noche viene más movida.</p>
    <div className="campo">Días que el local está cerrado<div className="chips">{DIAS.map((d, k) => <button key={d} className="chip" aria-pressed={cerr.includes(k)} onClick={() => setCerr(cerr.includes(k) ? cerr.filter((x) => x !== k) : [...cerr, k])}>{d}</button>)}</div></div>
  </Modal>
}
