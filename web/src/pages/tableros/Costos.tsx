import { useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { num, pct, plata } from '../../lib/formato'
import type { Insumo, Producto, RecetaItem } from '../../lib/tipos'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { EditarReceta } from '../stock/Recetas'
import { pillCosto } from '../../components/stock'
import { Barras, Cabeza, Pill, Stat } from '../../components/ui'
import { Anillo, Bloque, Dona, Kpi, Podio, Variacion, color, corto, emoji } from '../../components/tablero'

interface Plato { id: number; nombre: string; cantidad: number; vendido: number; costo_hist: number; precio: number; costo_unit: number; con_receta: boolean }
interface Costos {
  kpi: { ventas: number; costo: number; tirado: number; compras: number; n_compras: number; solo_articulos: boolean }
  prev: { ventas: number; costo: number; tirado: number } | null
  platos: Plato[]
  mermas_motivo: { nombre: string; v: number }[]
  mermas_articulo: { nombre: string; v: number; cantidad: number; unidad: string }[]
  cambios_precio: { nombre: string; cambio: number }[]
  plato: { id: number; nombre: string; precio: number; costo: number; receta: { nombre: string; unidad: string; cantidad: number; cocido: boolean; bruto: number; costo: number }[] } | null
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
  const v = (a: number, b: number | undefined, inv?: boolean) => F.comparar && r?.prev ? <Variacion a={Number(a)} b={b == null ? null : Number(b)} inverso={inv} texto="vs. antes" /> : undefined

  return <>
    <Cabeza etiqueta="Tableros" titulo="Costos y desperdicio" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      {(() => { const vt = Number(r.kpi.ventas), co = Number(r.kpi.costo), ti = Number(r.kpi.tirado), cp = vt ? co / vt : null, mg = vt - co
        return <>
        <div className="kpis">
          <Kpi titulo="Ventas" icono="💰" color={color(0)} valor={plata(vt)} pie={v(vt, r.prev?.ventas)} />
          <Kpi titulo={r.kpi.solo_articulos ? 'Costo de esos artículos' : 'Costo de mercadería'} icono="🥩" color={color(2)} valor={plata(co)} pie={cp != null ? `${pct(cp, 1)} de las ventas` : undefined} />
          {!r.kpi.solo_articulos && <Kpi titulo="Margen bruto" icono="📈" color={color(3)} valor={plata(mg)} pie={r.prev ? v(mg, Number(r.prev.ventas) - Number(r.prev.costo)) : 'ventas menos mercadería'} />}
          <Kpi titulo="Tirado (mermas)" icono="🗑️" color={color(5)} valor={plata(ti)} pie={v(ti, r.prev?.tirado, true)} />
          <Kpi titulo="Compras" icono="🛒" color={color(1)} valor={plata(r.kpi.compras)} pie={`${r.kpi.n_compras} compra${r.kpi.n_compras === 1 ? '' : 's'}`} />
        </div>
        {!r.kpi.solo_articulos && vt > 0 && <div className="tb">
          <Bloque className="s5" titulo="¿Cómo venimos?" ayuda="rentabilidad">
            <div className="anillos">
              <div><Anillo p={cp ?? 0} marca={objetivo} c={cp != null && cp > objetivo ? 'var(--crit)' : 'var(--t4)'} centro={pct(cp ?? 0)} sub="costo" />
                <span><b>Costo de mercadería</b><br /><span className="muted">la rayita es tu objetivo ({pct(objetivo)})</span></span></div>
              <div><Anillo p={mg / vt} c="var(--t2)" centro={pct(mg / vt)} sub="margen" /><span><b>Margen bruto</b><br /><span className="muted">lo que queda de cada venta</span></span></div>
              <div><Anillo p={co + ti ? ti / (co + ti) : 0} marca={0.03} c={co + ti && ti / (co + ti) > 0.06 ? 'var(--crit)' : 'var(--t3)'} centro={pct(co + ti ? ti / (co + ti) : 0, 1)} sub="tirado" />
                <span><b>Desperdicio</b><br /><span className="muted">sano: menos del 3 %</span></span></div>
            </div>
          </Bloque>
          <Bloque className="s7" titulo="Los platos que más plata dejan" der="margen generado en el período">
            <Podio filas={r.platos.filter((p) => p.con_receta).map((p) => ({ p, m: Number(p.vendido) - Number(p.costo_hist) })).sort((x, y) => y.m - x.m).slice(0, 6).map(({ p, m }) => ({
              nombre: <>{emoji(p.nombre)} {p.nombre}</>, v: m, sub: `${p.cantidad} vendidos · deja ${plata(Number(p.precio) - Number(p.costo_unit))} c/u`,
              der: pillCosto(Number(p.precio) ? Number(p.costo_unit) / Number(p.precio) : null, objetivo) }))} />
          </Bloque>
        </div>}
        </> })()}

      {r.plato && <section className="bloque tb-sep">
        <div className="fila"><h3 className="grow">{r.plato.nombre}</h3>{pillCosto(r.plato.receta.length ? Number(r.plato.costo) / Number(r.plato.precio) : null, objetivo)}
          <button className="btn sm" onClick={() => abrirReceta(r.plato!.id)}>Editar receta</button></div>
        <div className="stats" style={{ margin: '10px 0' }}>
          <Stat label="Precio" valor={plata(r.plato.precio)} /><Stat label="Costo por porción" valor={plata(r.plato.costo)} /><Stat label="Deja por unidad" valor={plata(Number(r.plato.precio) - Number(r.plato.costo))} />
          {(() => { const x = r.platos.find((p) => p.id === r.plato!.id); return x ? <><Stat label="Vendidos" valor={x.cantidad} /><Stat label="Margen generado" valor={plata(Number(x.vendido) - Number(x.costo_hist))} /></> : null })()}
        </div>
        {r.plato.receta.length ? <div className="tbl-wrap"><table><thead><tr><th>Ingrediente</th><th className="r">Por porción</th><th className="r">Hay que comprar</th><th className="r">Costo</th><th className="r">% del plato</th></tr></thead><tbody>
          {r.plato.receta.map((x) => <tr key={x.nombre}><td>{x.nombre}</td><td className="r mono">{num(x.cantidad)} {x.unidad}{x.cocido ? ' al plato' : ''}</td><td className="r mono muted">{num(x.bruto)} {x.unidad}</td><td className="r mono">{plata(x.costo)}</td><td className="r mono">{Number(r.plato!.costo) ? pct(Number(x.costo) / Number(r.plato!.costo)) : '—'}</td></tr>)}
        </tbody></table></div> : <div className="kempty">Este plato no tiene receta cargada.</div>}
      </section>}

      {r.articulo && <section className="bloque tb-sep">
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

      <details className="bloque" style={{ marginBottom: 16 }}><summary style={{ cursor: 'pointer' }}><b>Rentabilidad de todos los platos</b> <span className="muted">({r.platos.length})</span></summary><div style={{ height: 10 }} />
        {r.platos.length ? <div className="tbl-wrap"><table><thead><tr><th>Plato</th><th className="r">Vendidos</th><th className="r">Precio</th><th className="r">Costo</th><th className="r">Deja c/u</th><th className="r">Margen generado</th><th /></tr></thead><tbody>
          {r.platos.map((p) => <tr key={p.id}><td><b>{p.nombre}</b></td><td className="r mono">{p.cantidad}</td><td className="r mono">{plata(p.precio)}</td>
            <td className="r mono">{p.con_receta ? plata(p.costo_unit) : '—'}</td><td className="r mono">{p.con_receta ? plata(Number(p.precio) - Number(p.costo_unit)) : '—'}</td>
            <td className="r mono"><b>{plata(Number(p.vendido) - Number(p.costo_hist))}</b></td><td>{pillCosto(p.con_receta && Number(p.precio) ? Number(p.costo_unit) / Number(p.precio) : null, objetivo)}</td></tr>)}
        </tbody></table></div> : <div className="kempty">Sin ventas con estos filtros.</div>}
      </details>

      <Matriz platos={r.platos.filter((p) => p.con_receta)} />

      <div className="tb">
        <Bloque className="s5" titulo="Por qué se tira"><Dona filas={r.mermas_motivo.map((m) => ({ nombre: m.nombre, v: Number(m.v) }))} centro={<><b>{corto(Number(r.kpi.tirado))}</b>tirado</>} /></Bloque>
        <Bloque className="s7" titulo="Qué se tira"><Podio filas={r.mermas_articulo.slice(0, 8).map((m) => ({ nombre: m.nombre, v: Number(m.v), sub: `${num(m.cantidad)} ${m.unidad}` }))} /></Bloque>
      </div>
      <section className="bloque"><h3 style={{ marginBottom: 8 }}>Cambios de precio en el período</h3>
        {r.cambios_precio.length ? <div className="chips-precio">{r.cambios_precio.map((x) => <span key={x.nombre}>{x.nombre}<Pill tono={x.cambio > 0 ? 'crit' : 'ok'}>{x.cambio > 0 ? '▲' : '▼'} {pct(Math.abs(x.cambio), 1)}</Pill></span>)}</div>
          : <div className="kempty">Sin cambios de precio registrados.</div>}
      </section>
    </div>}
    {receta && <EditarReceta producto={receta.p} receta={receta.rec} insumos={receta.ins} objetivo={objetivo} onCerrar={() => setReceta(null)} onListo={() => { setReceta(null); recargar() }} />}
  </>
}

/** Cruza cuánto se vende cada plato con cuánto deja por unidad */
function Matriz({ platos }: { platos: Plato[] }) {
  if (platos.length < 4) return <div className="notice tb-sep"><b>Qué platos convienen</b><br />Aparece cuando haya ventas de al menos 4 platos con receta en el período.</div>
  const deja = (p: Plato) => Number(p.precio) - Number(p.costo_unit)
  const qm = (platos.reduce((s, p) => s + Number(p.cantidad), 0) / platos.length) * 0.7
  const mm = platos.reduce((s, p) => s + deja(p) * Number(p.cantidad), 0) / platos.reduce((s, p) => s + Number(p.cantidad), 0)
  const g: Record<string, Plato[]> = { estrella: [], caballo: [], enigma: [], perro: [] }
  for (const p of platos) { const pop = Number(p.cantidad) >= qm, rent = deja(p) >= mm; g[pop && rent ? 'estrella' : pop ? 'caballo' : rent ? 'enigma' : 'perro'].push(p) }
  const caja = (k: string, t: string, e: string, c: string, tip: string) => <div className="cuadrante" style={{ ['--k' as string]: c }} key={k}>
    <h4><span aria-hidden="true">{e}</span>{t}<Pill>{g[k].length}</Pill></h4><p>{tip}</p>
    <ul>{g[k].length ? g[k].sort((a, b) => b.cantidad - a.cantidad).slice(0, 8).map((p) => <li key={p.id}>{p.nombre} <span className="muted mono" style={{ fontSize: 12 }}>×{p.cantidad} · deja {plata(deja(p))}</span></li>) : <li className="muted">—</li>}{g[k].length > 8 && <li className="muted">y {g[k].length - 8} más</li>}</ul>
  </div>
  return <Bloque titulo="Qué platos convienen" der="cuánto se vende × cuánto deja" ayuda="matriz" className="tb-sep">
    <div className="cuadrantes">
      {caja('estrella', 'Estrellas', '⭐', 'var(--t4)', 'Se venden mucho y dejan buena plata. Que nunca falten.')}
      {caja('caballo', 'Caballitos', '🐴', 'var(--t3)', 'Se venden mucho pero dejan poco. Subí el precio o ajustá la porción.')}
      {caja('enigma', 'Enigmas', '❓', 'var(--t5)', 'Dejan buena plata pero salen poco. Recomendalos en la mesa.')}
      {caja('perro', 'Para revisar', '⚠️', 'var(--t6)', 'Salen poco y dejan poco. Candidatos a salir de la carta.')}
    </div></Bloque>
}
