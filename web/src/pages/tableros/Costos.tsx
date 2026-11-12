import { useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { num, pct, plata } from '../../lib/formato'
import type { Insumo, Producto, RecetaItem } from '../../lib/tipos'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { EditarReceta } from '../stock/Recetas'
import { pillCosto } from '../../components/stock'
import { Barras, Cabeza, Delta, Pill, Ranking, Stat } from '../../components/ui'

interface Plato { id: number; nombre: string; cantidad: number; vendido: number; costo_hist: number; precio: number; costo_unit: number; con_receta: boolean }
interface Costos {
  kpi: { ventas: number; costo: number; tirado: number; compras: number; n_compras: number; solo_articulos: boolean }
  prev: { ventas: number; costo: number; tirado: number } | null
  platos: Plato[]
  mermas_motivo: { nombre: string; v: number }[]
  mermas_articulo: { nombre: string; v: number; cantidad: number; unidad: string }[]
  cambios_precio: { nombre: string; cambio: number }[]
  plato: { id: number; nombre: string; precio: number; costo: number; receta: { nombre: string; unidad: string; cantidad: number; bruto: number; costo: number }[] } | null
  articulo: { id: number; nombre: string; unidad: string; costo: number; hay: number; usado: number; comprado: number; tirado: number; precios: { l: string; v: number }[]; platos: string[] } | null
}
const CLAVES: Clave[] = ['categoria', 'producto', 'insumo', 'proveedor']

export default function TableroCostos() {
  const { F, setF } = useFiltros()
  const { datos: r, error, cargando, recargar } = useConsulta(() => rpc<Costos>('tablero_costos', { p_desde: F.desde, p_hasta: F.hasta, p_f: filtrosBase(F, CLAVES), p_comparar: F.comparar }), [JSON.stringify(F)])
  const obj = useConsulta(async () => (Number((await leerParametros()).costo_objetivo) || 35) / 100)
  const [receta, setReceta] = useState<{ p: Producto; rec: RecetaItem[]; ins: Insumo[] } | null>(null)
  const objetivo = obj.datos ?? 0.35
  async function abrirReceta(id: number) {
    const [p, rec, ins] = await Promise.all([tabla<Producto[]>(supabase.from('productos').select('*').eq('id', id)), tabla<RecetaItem[]>(supabase.from('receta_items').select('*').eq('producto_id', id)), tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre'))])
    if (p[0]) setReceta({ p: p[0], rec, ins })
  }
  const d = (a: number, b: number | undefined, inv?: boolean) => F.comparar && r?.prev ? <Delta a={Number(a)} b={b == null ? null : Number(b)} inverso={inv} /> : undefined

  return <>
    <Cabeza etiqueta="Tableros" titulo="Costos y desperdicio" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Ventas" valor={plata(r.kpi.ventas)} extra={d(r.kpi.ventas, r.prev?.ventas)} />
        <Stat label={r.kpi.solo_articulos ? 'Costo de esos artículos' : 'Costo de mercadería'} valor={plata(r.kpi.costo)} extra={Number(r.kpi.ventas) ? <span className="muted">{pct(Number(r.kpi.costo) / Number(r.kpi.ventas))} de las ventas</span> : undefined} />
        {!r.kpi.solo_articulos && <Stat label="Margen bruto" valor={plata(Number(r.kpi.ventas) - Number(r.kpi.costo))} extra={r.prev ? d(Number(r.kpi.ventas) - Number(r.kpi.costo), Number(r.prev.ventas) - Number(r.prev.costo)) : undefined} />}
        <Stat label="Tirado (mermas)" valor={plata(r.kpi.tirado)} extra={d(r.kpi.tirado, r.prev?.tirado, true)} />
        <Stat label="Compras" valor={plata(r.kpi.compras)} extra={<span className="muted">{r.kpi.n_compras} compra{r.kpi.n_compras === 1 ? '' : 's'}</span>} />
      </div>

      {r.plato && <section className="panel" style={{ marginBottom: 16 }}>
        <div className="fila"><h3 className="grow">{r.plato.nombre}</h3>{pillCosto(r.plato.receta.length ? Number(r.plato.costo) / Number(r.plato.precio) : null, objetivo)}
          <button className="btn sm" onClick={() => abrirReceta(r.plato!.id)}>Editar receta</button></div>
        <div className="stats" style={{ margin: '10px 0' }}>
          <Stat label="Precio" valor={plata(r.plato.precio)} /><Stat label="Costo por porción" valor={plata(r.plato.costo)} /><Stat label="Deja por unidad" valor={plata(Number(r.plato.precio) - Number(r.plato.costo))} />
          {(() => { const x = r.platos.find((p) => p.id === r.plato!.id); return x ? <><Stat label="Vendidos" valor={x.cantidad} /><Stat label="Margen generado" valor={plata(Number(x.vendido) - Number(x.costo_hist))} /></> : null })()}
        </div>
        {r.plato.receta.length ? <div className="tbl-wrap"><table><thead><tr><th>Ingrediente</th><th className="r">Cantidad limpia</th><th className="r">Con merma</th><th className="r">Costo</th><th className="r">% del plato</th></tr></thead><tbody>
          {r.plato.receta.map((x) => <tr key={x.nombre}><td>{x.nombre}</td><td className="r mono">{num(x.cantidad)} {x.unidad}</td><td className="r mono muted">{num(x.bruto)} {x.unidad}</td><td className="r mono">{plata(x.costo)}</td><td className="r mono">{Number(r.plato!.costo) ? pct(Number(x.costo) / Number(r.plato!.costo)) : '—'}</td></tr>)}
        </tbody></table></div> : <div className="kempty">Este plato no tiene receta cargada.</div>}
      </section>}

      {r.articulo && <section className="panel" style={{ marginBottom: 16 }}>
        <h3>{r.articulo.nombre}</h3>
        <div className="stats" style={{ margin: '10px 0' }}>
          <Stat label="Costo actual" valor={<>{plata(r.articulo.costo)}<span className="muted" style={{ fontSize: 13 }}>/{r.articulo.unidad}</span></>} />
          <Stat label="Se usó según ventas" valor={`${num(r.articulo.usado)} ${r.articulo.unidad}`} />
          <Stat label="Se compró" valor={`${num(r.articulo.comprado)} ${r.articulo.unidad}`} />
          <Stat label="Se tiró" valor={`${num(r.articulo.tirado)} ${r.articulo.unidad}`} extra={Number(r.articulo.usado) + Number(r.articulo.tirado) ? <span className="muted">{pct(Number(r.articulo.tirado) / (Number(r.articulo.usado) + Number(r.articulo.tirado)), 1)} de lo usado</span> : undefined} />
          <Stat label="Hay ahora" valor={`${num(r.articulo.hay)} ${r.articulo.unidad}`} />
        </div>
        {r.articulo.precios.length ? <><div className="label">Precio pagado por {r.articulo.unidad}, últimas compras</div><Barras puntos={r.articulo.precios} etiqueta="Precio" /></> : <div className="kempty">Sin compras registradas con precio.</div>}
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>Lo usan: {r.articulo.platos.length ? r.articulo.platos.join(', ') : 'ningún plato'}.</p>
      </section>}

      <section className="panel" style={{ marginBottom: 16 }} data-ayuda="rentabilidad"><h3 style={{ marginBottom: 6 }}>Rentabilidad por plato</h3>
        {r.platos.length ? <div className="tbl-wrap"><table><thead><tr><th>Plato</th><th className="r">Vendidos</th><th className="r">Precio</th><th className="r">Costo</th><th className="r">Deja c/u</th><th className="r">Margen generado</th><th /></tr></thead><tbody>
          {r.platos.map((p) => <tr key={p.id}><td><b>{p.nombre}</b></td><td className="r mono">{p.cantidad}</td><td className="r mono">{plata(p.precio)}</td>
            <td className="r mono">{p.con_receta ? plata(p.costo_unit) : '—'}</td><td className="r mono">{p.con_receta ? plata(Number(p.precio) - Number(p.costo_unit)) : '—'}</td>
            <td className="r mono"><b>{plata(Number(p.vendido) - Number(p.costo_hist))}</b></td><td>{pillCosto(p.con_receta && Number(p.precio) ? Number(p.costo_unit) / Number(p.precio) : null, objetivo)}</td></tr>)}
        </tbody></table></div> : <div className="kempty">Sin ventas con estos filtros.</div>}
      </section>

      <Matriz platos={r.platos.filter((p) => p.con_receta)} />

      <div className="rep-grid" style={{ marginTop: 0 }}>
        <section className="panel"><h3 style={{ marginBottom: 10 }}>Mermas por motivo</h3><Ranking filas={r.mermas_motivo} color="var(--crit)" conPct={false} /></section>
        <section className="panel"><h3 style={{ marginBottom: 10 }}>Mermas por artículo</h3><Ranking filas={r.mermas_articulo.map((m) => ({ nombre: m.nombre, v: Number(m.v), extra: <span className="muted mono" style={{ fontSize: 12 }}>{num(m.cantidad)} {m.unidad}</span> }))} color="var(--crit)" conPct={false} /></section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 8 }}>Cambios de precio en el período</h3>
        {r.cambios_precio.length ? <div className="rows">{r.cambios_precio.map((x) => <div key={x.nombre} className="row"><span className="grow">{x.nombre}</span><Pill tono={x.cambio > 0 ? 'crit' : 'ok'}>{x.cambio > 0 ? '+' : '−'}{pct(Math.abs(x.cambio), 1)}</Pill></div>)}</div>
          : <div className="kempty">Sin cambios de precio registrados.</div>}
      </section>
    </div>}
    {receta && <EditarReceta producto={receta.p} receta={receta.rec} insumos={receta.ins} objetivo={objetivo} onCerrar={() => setReceta(null)} onListo={() => { setReceta(null); recargar() }} />}
  </>
}

/** Cruza cuánto se vende cada plato con cuánto deja por unidad */
function Matriz({ platos }: { platos: Plato[] }) {
  if (platos.length < 4) return <div className="notice" style={{ marginBottom: 16 }}><b>Qué platos convienen</b><br />Aparece cuando haya ventas de al menos 4 platos con receta en el período.</div>
  const deja = (p: Plato) => Number(p.precio) - Number(p.costo_unit)
  const qm = (platos.reduce((s, p) => s + Number(p.cantidad), 0) / platos.length) * 0.7
  const mm = platos.reduce((s, p) => s + deja(p) * Number(p.cantidad), 0) / platos.reduce((s, p) => s + Number(p.cantidad), 0)
  const g: Record<string, Plato[]> = { estrella: [], caballo: [], enigma: [], perro: [] }
  for (const p of platos) { const pop = Number(p.cantidad) >= qm, rent = deja(p) >= mm; g[pop && rent ? 'estrella' : pop ? 'caballo' : rent ? 'enigma' : 'perro'].push(p) }
  const caja = (k: string, t: string, c: string, tip: string) => <div className="panel" style={{ borderTop: `4px solid var(--${c})` }} key={k}>
    <div className="fila"><b style={{ fontFamily: 'var(--f-display)', fontSize: 20, textTransform: 'uppercase' }}>{t}</b><Pill>{g[k].length}</Pill></div>
    <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>{tip}</p>
    <div style={{ fontSize: 14 }}>{g[k].length ? g[k].sort((a, b) => b.cantidad - a.cantidad).map((p) => <div key={p.id}>{p.nombre} <span className="muted mono" style={{ fontSize: 12 }}>×{p.cantidad} · deja {plata(deja(p))}</span></div>) : <span className="muted">—</span>}</div>
  </div>
  return <section style={{ marginBottom: 16 }} data-ayuda="matriz"><h3 style={{ marginBottom: 4 }}>Qué platos convienen</h3>
    <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', maxWidth: '72ch' }}>Cruza cuánto se vende cada plato con cuánto deja por unidad, para el período y los filtros elegidos.</p>
    <div className="rep-grid" style={{ marginTop: 0 }}>
      {caja('estrella', 'Estrellas', 'ok', 'Se venden mucho y dejan buena plata. Que nunca falten.')}
      {caja('caballo', 'Caballitos', 'warn', 'Se venden mucho pero dejan poco. Subí el precio o ajustá la porción.')}
      {caja('enigma', 'Enigmas', 'accent', 'Dejan buena plata pero salen poco. Recomendalos en la mesa.')}
      {caja('perro', 'Para revisar', 'crit', 'Salen poco y dejan poco. Candidatos a salir de la carta.')}
    </div></section>
}
