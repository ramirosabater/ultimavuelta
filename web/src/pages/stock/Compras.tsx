import { useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { DIAS, DIAS_LARGO, fecha, jornada, num, pct, plata, sumarDias } from '../../lib/formato'
import type { Insumo, Proveedor } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { CompraManualModal, CompraModal, FacturaModal, useBaseStock } from '../../components/stock'
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
  const [ventana, setVentana] = useState<null | 'config' | 'manual' | { compra: Insumo; q: number } | { factura: File }>(null)
  const [vHist, setVHist] = useState(0)
  const archivo = useRef<HTMLInputElement>(null)
  const [buscar, setBuscar] = useState('')
  const [tab, setTab] = useState<'lista' | 'hoy' | 'cargadas'>(() => { try { return (localStorage.getItem('uv-compras-tab') as 'lista') || 'lista' } catch { return 'lista' } })
  const cambiarTab = (t: 'lista' | 'hoy' | 'cargadas') => { setTab(t); try { localStorage.setItem('uv-compras-tab', t) } catch { /* sin guardar */ } }
  const avisar = useToast()
  const recargar = () => { base.recargar(); extra.recargar(); setVHist((v) => v + 1) }

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

  // La lista, agrupada por proveedor (cada grupo se pide por separado)
  const grupos = new Map<string, Fila[]>()
  for (const f of filas) { const k = provDe(f.i, proveedores) || 'Sin proveedor'; grupos.set(k, [...(grupos.get(k) ?? []), f]) }
  const q = buscar.trim().toLowerCase()
  const usoHoy = new Map(prev.insumos_hoy.map((x) => [x.id, x.uso]))
  const faltaHoy = (i: Insumo) => (usoHoy.get(i.id) ?? 0) > Number(i.cantidad)
  const totalLista = filas.reduce((s, f) => s + f.costo, 0)
  const urgentes = filas.filter((f) => faltaHoy(f.i))
  const cuanto = (f: Fila) => f.packs ? `${f.packs} ${f.i.pack_nombre || 'pack'}${f.packs > 1 ? 's' : ''}` : `${num(f.qty)} ${f.i.unidad}`
  function texto(prov?: string) {
    let t = `Pedido ${par.nombre_local ?? ''} · ${fecha(jornada())}\n`
    for (const [k, fs] of grupos) { if (prov && k !== prov) continue; t += `\n*${k}*\n`; for (const f of fs) t += `- ${cuanto(f)}${f.packs ? ` (${num(f.qty)} ${f.i.unidad})` : ''} ${f.i.nombre}\n` }
    return t
  }
  async function copiar(prov?: string) {
    try { await navigator.clipboard.writeText(texto(prov)); avisar(prov ? `Pedido para ${prov} copiado. Pegalo en WhatsApp.` : 'Lista copiada. Pegala en WhatsApp.') } catch { window.prompt?.('Copiá la lista', texto(prov)) }
  }
  const platos = prev.platos_hoy.filter((p) => p.estacion === 'cocina').slice(0, 12)
  const usar = prev.insumos_hoy.map((x) => ({ x, i: insumos.find((y) => y.id === x.id)! })).filter((y) => y.i)
  const faltan = usar.filter((y) => Number(y.i.cantidad) < y.x.uso), alcanzan = usar.filter((y) => Number(y.i.cantidad) >= y.x.uso)
  const TABS = [
    { k: 'lista', t: 'Qué comprar', n: filas.length ? `${filas.length}` : '', ayuda: 'lista-compras' },
    { k: 'hoy', t: 'Para preparar hoy', n: faltan.length ? `${faltan.length} faltan` : '', ayuda: 'preparar-hoy' },
    { k: 'cargadas', t: 'Compras cargadas', n: '', ayuda: 'compras-cargadas' },
  ] as const

  return <>
    <Cabeza etiqueta="Depósito" titulo="Compras">
      <button className="btn pri" onClick={() => setVentana('manual')} data-ayuda="compra-manual">Cargar compra</button>
      <button className="btn" onClick={() => archivo.current?.click()} data-ayuda="factura">Factura con foto o PDF</button>
      {perfil?.rol === 'admin' && <button className="btn" onClick={() => setVentana('config')}>Ajustar cálculo</button>}
    </Cabeza>
    <input ref={archivo} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden id="fac-file"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setVentana({ factura: f }) }} />
    <SubNavStock />
    {subas.length > 0 && <div className="alert" style={{ marginBottom: 12 }}><Pill tono="crit">Subas</Pill>
      <span className="grow">{subas.map((x) => `${x.i!.nombre} +${pct(x.d, 1)}`).join(' · ')}. Revisá el costo de los platos en Recetas y costos.</span></div>}

    <div className="tabs-compras" role="tablist">{TABS.map((x) => <button key={x.k} role="tab" aria-selected={tab === x.k} className="tab-c" data-ayuda={tab === x.k ? undefined : x.ayuda} onClick={() => cambiarTab(x.k)}>
      {x.t}{x.n && <span className="pill">{x.n}</span>}</button>)}</div>

    {tab === 'lista' && <section className="panel" data-ayuda="lista-compras">
      <div className="fila" style={{ marginBottom: 8, gap: 10 }}>
        <div className="grow" style={{ minWidth: 200 }}>{filas.length ? <><b style={{ fontSize: 17 }}>{filas.length} artículo{filas.length > 1 ? 's' : ''} para comprar</b> · {grupos.size} proveedor{grupos.size > 1 ? 'es' : ''} · <b className="mono">{plata(totalLista)}</b></> : <b>No hace falta comprar nada</b>}
          <div className="muted" style={{ fontSize: 12 }}>Para {n} día{n > 1 ? 's' : ''} · colchón {colchon}% · cerrado: {cerrado.length ? cerrado.map((d) => DIAS[d]).join(', ') : 'ningún día'}</div></div>
        {filas.length > 0 && <button className="btn sm" onClick={() => copiar()}>Copiar todo para WhatsApp</button>}
      </div>
      {urgentes.length > 0 && <div className="alert" style={{ marginBottom: 10 }}><Pill tono="crit">Para hoy</Pill><span className="grow">No alcanza para esta noche: <b>{urgentes.map((f) => f.i.nombre).join(', ')}</b>.</span></div>}
      {filas.length > 6 && <input id="lc-buscar" type="search" placeholder="Buscar artículo o proveedor…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: 10 }} />}
      {filas.length ? <div className="prov-grupos">{[...grupos].map(([k, fs]) => {
        const vis = fs.filter((f) => !q || `${f.i.nombre} ${k}`.toLowerCase().includes(q))
        if (!vis.length) return null
        return <details key={k} className="prov-grupo" open={filas.length <= 12 || grupos.size <= 2 || !!q || fs.some((f) => faltaHoy(f.i))}>
          <summary><b className="grow">{k}</b><span className="muted">{fs.length} art.</span><span className="mono">{plata(fs.reduce((s, f) => s + f.costo, 0))}</span>
            {k !== 'Sin proveedor' && <button className="btn sm ghost" onClick={(e) => { e.preventDefault(); copiar(k) }}>Copiar pedido</button>}</summary>
          <div className="rows">{vis.map((f) => <div key={f.i.id} className="row lc-fila">
            <div className="grow" style={{ minWidth: 0 }}><b>{f.i.nombre}</b>{faltaHoy(f.i) && <> <Pill tono="crit">para hoy</Pill></>}
              <div className="muted" style={{ fontSize: 12 }}>hay {num(f.i.cantidad)} {f.i.unidad}{f.uso != null ? ` · se usan ≈ ${num(f.uso)}` : ''}</div></div>
            <div className="lc-cant"><b className="mono">{cuanto(f)}</b><span className="muted mono">{plata(f.costo)}</span></div>
            <button className="btn sm" onClick={() => setVentana({ compra: f.i, q: f.qty })}>Llegó</button>
          </div>)}</div>
        </details>
      })}</div> : <div className="kempty">Con lo que hay alcanza para los próximos {n} días.</div>}
      <details className="muted" style={{ fontSize: 13, marginTop: 10 }}><summary style={{ cursor: 'pointer' }}>¿Cómo se calcula?</summary>{!prev.historial
        ? 'Todavía no hay historial de ventas, así que por ahora sugiero llegar al mínimo de cada artículo más el colchón. Con unas noches cobradas, la lista se calcula sola por lo que se vende cada día de la semana.'
        : `Lo que se va a usar los próximos ${n} días según las recetas, lo vendido esos mismos días las semanas anteriores y los platos del día planificados (Carta y QR → Platos del día), más el colchón (el ${colchon}% o el mínimo del artículo, lo que sea mayor), menos lo que ya hay. Redondeado a la presentación de compra.`}</details>
    </section>}

    {tab === 'hoy' && <section className="panel" data-ayuda="preparar-hoy">
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Lo que se suele vender un {DIAS_LARGO[prev.dow]} según las últimas 4 semanas. Descongelá y prepará esto, no más.</p>
      {!prev.historial ? <div className="kempty">Hacen falta algunas noches de ventas cobradas para estimar.</div>
        : prev.cerrado_hoy ? <div className="kempty">Hoy el local está cerrado.</div>
        : !prev.platos_hoy.length ? <div className="kempty">Sin ventas para estimar este día.</div>
        : <>
          {faltan.length > 0 ? <div className="alert" style={{ marginBottom: 12 }}><Pill tono="crit">Falta</Pill><span className="grow">{faltan.map((y) => <span key={y.i.id} className="falta-hoy"><b>{y.i.nombre}</b> {num(y.x.uso - Number(y.i.cantidad))} {y.i.unidad}</span>)}</span>
            <button className="btn sm" onClick={() => cambiarTab('lista')}>Ver qué comprar</button></div>
            : <div className="aviso ok" style={{ marginBottom: 12 }}>Hay todo lo que se va a usar esta noche.</div>}
          <div className="label" style={{ marginBottom: 6 }}>Platos que se esperan esta noche</div>
          <div className="platos-hoy">{platos.map((p) => <span key={p.id}><b className="mono">{Math.max(1, Math.round(p.cantidad))}</b>{p.nombre}</span>)}</div>
          <div className="label" style={{ margin: '14px 0 6px' }}>Qué preparar</div>
          <div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th className="r">Preparar</th><th className="r">Hay</th><th /></tr></thead><tbody>
            {[...faltan, ...alcanzan].map(({ x, i }) => <tr key={i.id}><td><b>{i.nombre}</b></td><td className="r mono">{num(x.uso)} {i.unidad}</td><td className="r mono muted">{num(i.cantidad)}</td>
              <td className="r">{Number(i.cantidad) < x.uso ? <Pill tono="crit">Falta {num(x.uso - Number(i.cantidad))}</Pill> : <Pill tono="ok">Hay</Pill>}</td></tr>)}
          </tbody></table></div>
        </>}
    </section>}

    {tab === 'cargadas' && <Historial version={vHist} onCambio={recargar} />}


    {ventana === 'manual' && <CompraManualModal insumos={insumos} proveedores={proveedores} cuentas={cuentas} onCerrar={() => setVentana(null)} onListo={() => { setVentana(null); recargar() }} />}
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

// ------------------------------------------------------------------ compras cargadas (últimos 30 días), con anular
interface CompraH { id: number; fecha: string; numero: string | null; total: number; proveedores: { nombre: string } | null; perfiles: { nombre: string } | null
  movimientos_stock: { cantidad: number; costo_unit: number; insumos: { nombre: string; unidad: string } | null }[] }

function Historial({ version, onCambio }: { version: number; onCambio: () => void }) {
  const h = useConsulta(() => tabla<CompraH[]>(supabase.from('compras')
    .select('id, fecha, numero, total, proveedores(nombre), perfiles(nombre), movimientos_stock(cantidad, costo_unit, insumos(nombre, unidad))')
    .gte('fecha', sumarDias(jornada(), -30)).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(100)), [version])
  const [abierta, setAbierta] = useState<number | null>(null)
  const [anular, setAnular] = useState<CompraH | null>(null)
  const { correr, ocupado } = useAccion()
  const [buscar, setBuscar] = useState('')
  const [prov, setProv] = useState('')
  const todas = h.datos ?? []
  const q = buscar.trim().toLowerCase()
  const lista = todas.filter((c) => (!prov || (c.proveedores?.nombre ?? 'Sin proveedor') === prov)
    && (!q || `${c.proveedores?.nombre ?? ''} ${c.numero ?? ''} ${c.movimientos_stock.map((m) => m.insumos?.nombre ?? '').join(' ')}`.toLowerCase().includes(q)))
  const porProv = new Map<string, number>()
  for (const c of todas) { const k = c.proveedores?.nombre ?? 'Sin proveedor'; porProv.set(k, (porProv.get(k) ?? 0) + Number(c.total)) }
  const resumen = (c: CompraH) => { const ns = c.movimientos_stock.map((m) => m.insumos?.nombre ?? '—'); return ns.slice(0, 3).join(', ') + (ns.length > 3 ? ` y ${ns.length - 3} más` : '') }
  return <section className="panel" data-ayuda="compras-cargadas">
    <div className="fila" style={{ marginBottom: 8 }}><h3 className="grow">Compras de los últimos 30 días</h3>{todas.length > 0 && <b className="mono">{plata(todas.reduce((s, c) => s + Number(c.total), 0))}</b>}</div>
    {porProv.size > 1 && <div className="chips" style={{ marginBottom: 10 }}>
      <button className="chip" aria-pressed={!prov} onClick={() => setProv('')}>Todos</button>
      {[...porProv].sort((x, y) => y[1] - x[1]).map(([k, v]) => <button key={k} className="chip" aria-pressed={prov === k} onClick={() => setProv(prov === k ? '' : k)}>{k} · {plata(v)}</button>)}</div>}
    {todas.length > 5 && <input id="cc-buscar" type="search" placeholder="Buscar por artículo, proveedor o número de factura…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: 10 }} />}
    {h.error ? <div className="aviso bad">{h.error}</div> : !h.datos ? <p className="cargando">Cargando…</p>
      : !todas.length ? <div className="kempty">Todavía no cargaste compras en los últimos 30 días.</div>
      : !lista.length ? <div className="kempty">Nada coincide con la búsqueda.</div>
      : <div className="rows">{lista.map((c) => <div key={c.id} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div className="fila" style={{ flexWrap: 'nowrap' }}>
          <button className="link grow" style={{ textAlign: 'left', textDecoration: 'none', color: 'inherit', fontSize: 14, minWidth: 0 }} aria-expanded={abierta === c.id} onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
            <span className="mono muted" style={{ marginRight: 8 }}>{fecha(c.fecha)}</span><b>{c.proveedores?.nombre ?? 'Sin proveedor'}</b>{c.numero ? <span className="muted"> · {c.numero}</span> : null}
            <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{abierta === c.id ? '▾ ' : '▸ '}{resumen(c)}{c.perfiles?.nombre ? ` · cargó ${c.perfiles.nombre}` : ''}</div>
          </button>
          <b className="mono" style={{ whiteSpace: 'nowrap' }}>{plata(c.total)}</b>
        </div>
        {abierta === c.id && <div style={{ paddingLeft: 4 }}>
          {c.movimientos_stock.map((m, k) => <div key={k} className="fila" style={{ fontSize: 13, flexWrap: 'nowrap' }}><span className="grow">{m.insumos?.nombre ?? '—'}</span>
            <span className="mono">{num(m.cantidad)} {m.insumos?.unidad}</span><span className="mono muted" style={{ minWidth: 90, textAlign: 'right' }}>{plata(m.cantidad * m.costo_unit)}</span></div>)}
          <button className="btn sm ghost danger" style={{ marginTop: 8 }} onClick={() => setAnular(c)}>Anular esta compra</button>
        </div>}
      </div>)}</div>}
    {anular && <Modal titulo="Anular compra" onCerrar={() => setAnular(null)} pie={<><span className="grow" /><button className="btn" onClick={() => setAnular(null)}>No</button>
      <button className="btn pri danger" disabled={ocupado} onClick={async () => { if (await correr(() => rpc('anular_compra', { p_compra: anular.id }), 'Compra anulada')) { setAnular(null); setAbierta(null); onCambio() } }}>Sí, anular</button></>}>
      <p style={{ margin: 0 }}>Se saca del stock lo que sumó esta compra ({anular.movimientos_stock.map((m) => `${num(m.cantidad)} ${m.insumos?.unidad ?? ''} ${m.insumos?.nombre ?? ''}`).join(', ')}) y se borra el gasto de {plata(anular.total)}.</p>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Usalo si se cargó mal o dos veces. Después la podés cargar de nuevo bien.</p>
    </Modal>}
  </section>
}
