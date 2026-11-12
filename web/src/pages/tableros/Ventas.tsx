import { rpc, useConsulta } from '../../lib/datos'
import { DIAS, duracion, pad, plata } from '../../lib/formato'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { Barras, Cabeza, Delta, Ranking, Stat } from '../../components/ui'

interface Ventas {
  kpi: { ventas: number; unidades: number; mesas: number; ticket_prom: number | null; cubiertos: number; por_cubierto: number | null; permanencia: number | null; cocina_prom: number | null; cocina_tarde: number | null; barra_prom: number | null; barra_tarde: number | null }
  prev: { ventas: number; unidades: number; mesas: number; ticket_prom: number | null; por_cubierto: number | null } | null
  serie: { titulo: string; puntos: { l: string; v: number }[] }
  calor: { dow: number; h: number; v: number }[]
  por_dia: { dow: number; v: number }[]
  mozos: { nombre: string; mesas: number; vendido: number; cubiertos: number | null }[]
  productos: { nombre: string; categoria: string | null; unidades: number; vendido: number; antes: number | null }[]
  categorias: { nombre: string; v: number }[]
  medios: { nombre: string; v: number }[]
}
const CLAVES: Clave[] = ['categoria', 'producto', 'mozo', 'medio', 'dow']
const ORDEN_HORAS = [...Array(24).keys()].map((i) => (i + 6) % 24)

export default function TableroVentas() {
  const { F, setF } = useFiltros()
  const { datos: r, error, cargando } = useConsulta(() => rpc<Ventas>('tablero_ventas', { p_desde: F.desde, p_hasta: F.hasta, p_f: filtrosBase(F, CLAVES), p_comparar: F.comparar }), [JSON.stringify(F)])
  const d = (a: number, b: number | null | undefined, inv?: boolean) => F.comparar && r?.prev ? <Delta a={Number(a)} b={b == null ? null : Number(b)} inverso={inv} /> : undefined
  return <>
    <Cabeza etiqueta="Tableros" titulo="Ventas y servicio" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat label="Ventas" valor={plata(r.kpi.ventas)} extra={d(r.kpi.ventas, r.prev?.ventas)} />
        <Stat label="Unidades" valor={r.kpi.unidades} extra={d(r.kpi.unidades, r.prev?.unidades)} />
        <Stat label="Mesas" valor={r.kpi.mesas} extra={d(r.kpi.mesas, r.prev?.mesas)} />
        <Stat label="Ticket promedio" valor={r.kpi.ticket_prom ? plata(r.kpi.ticket_prom) : '—'} extra={r.kpi.ticket_prom ? d(r.kpi.ticket_prom, r.prev?.ticket_prom) : undefined} />
        <Stat label="Por cubierto" valor={r.kpi.por_cubierto ? plata(r.kpi.por_cubierto) : '—'} extra={r.kpi.por_cubierto ? d(r.kpi.por_cubierto, r.prev?.por_cubierto) : undefined} />
        <Stat label="Permanencia" valor={r.kpi.permanencia != null ? duracion(Number(r.kpi.permanencia)) : '—'} extra={<span className="muted">de abrir a cobrar</span>} />
        <Stat label="Parrilla" valor={r.kpi.cocina_prom != null ? `${r.kpi.cocina_prom} min` : '—'} extra={r.kpi.cocina_tarde != null ? <span className="muted">{r.kpi.cocina_tarde}% llegó tarde</span> : undefined} />
        <Stat label="Barra" valor={r.kpi.barra_prom != null ? `${r.kpi.barra_prom} min` : '—'} extra={r.kpi.barra_tarde != null ? <span className="muted">{r.kpi.barra_tarde}% llegó tarde</span> : undefined} />
      </div>
      {!r.kpi.mesas ? <div className="notice"><b>Sin ventas con estos filtros.</b><br />Probá con otro período o quitá algún filtro.</div> : <>
        <section className="panel" style={{ marginBottom: 16 }}><h3>{r.serie.titulo}</h3><Barras puntos={r.serie.puntos} /></section>
        <div className="rep-grid" style={{ marginTop: 0 }}>
          <Calor calor={r.calor} />
          <section className="panel"><h3>Promedio por día</h3><Barras puntos={[1, 2, 3, 4, 5, 6, 0].map((x) => ({ l: DIAS[x], v: Number(r.por_dia.find((p) => p.dow === x)?.v ?? 0) }))} /></section>
        </div>
        <div className="rep-grid">
          <section className="panel" style={{ minWidth: 0 }}><h3 style={{ marginBottom: 6 }}>Por mozo</h3><div className="tbl-wrap"><table><thead><tr><th>Mozo</th><th className="r">Mesas</th><th className="r">Vendido</th><th className="r">Ticket prom.</th><th className="r">Por cubierto</th></tr></thead><tbody>
            {r.mozos.map((m) => <tr key={m.nombre}><td><b>{m.nombre}</b></td><td className="r mono">{m.mesas}</td><td className="r mono">{plata(m.vendido)}</td><td className="r mono">{plata(m.vendido / m.mesas)}</td><td className="r mono">{m.cubiertos ? plata(m.vendido / m.cubiertos) : '—'}</td></tr>)}
          </tbody></table></div></section>
          <section className="panel"><h3 style={{ marginBottom: 10 }}>Por categoría</h3><Ranking filas={r.categorias} /><h3 style={{ margin: '18px 0 10px' }}>Por medio de pago</h3><Ranking filas={r.medios} /></section>
        </div>
        <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Productos</h3><div className="tbl-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th className="r">Unidades</th>{F.comparar && <th className="r">Antes</th>}<th className="r">Vendido</th><th className="r">% del total</th></tr></thead><tbody>
          {(() => { const tot = r.productos.reduce((s, p) => s + Number(p.vendido), 0) || 1; return r.productos.map((p) => <tr key={p.nombre}><td><b>{p.nombre}</b></td><td className="muted">{p.categoria}</td><td className="r mono">{p.unidades}</td>
            {F.comparar && <td className="r mono muted">{p.antes ?? 0}</td>}<td className="r mono">{plata(p.vendido)}</td><td className="r mono">{Math.round((Number(p.vendido) / tot) * 1000) / 10}%</td></tr>) })()}
        </tbody></table></div></section>
      </>}
    </div>}
  </>
}

function Calor({ calor }: { calor: Ventas['calor'] }) {
  const mx = Math.max(1, ...calor.map((c) => Number(c.v)))
  const horas = ORDEN_HORAS.filter((h) => calor.some((c) => c.h === h))
  const cols = horas.length ? ORDEN_HORAS.slice(ORDEN_HORAS.indexOf(horas[0]), ORDEN_HORAS.indexOf(horas[horas.length - 1]) + 1) : []
  return <section className="panel" style={{ minWidth: 0 }} data-ayuda="calor"><h3>Cuándo se vende</h3>
    <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>Por día de la jornada y hora. Más oscuro, más plata.</p>
    <div className="tbl-wrap"><table style={{ width: 'auto' }}><thead><tr><th />{cols.map((c) => <th key={c} className="r" style={{ padding: '4px 3px', fontSize: 10 }}>{pad(c)}</th>)}</tr></thead><tbody>
      {[1, 2, 3, 4, 5, 6, 0].map((f) => <tr key={f}><th style={{ padding: '4px 8px 4px 0', fontSize: 11, border: 0 }}>{DIAS[f]}</th>{cols.map((c) => {
        const v = Number(calor.find((x) => x.dow === f && x.h === c)?.v ?? 0), p = Math.round((v / mx) * 100)
        return <td key={c} title={`${DIAS[f]} ${pad(c)} h: ${plata(v)}`} style={{ padding: 0, border: '2px solid var(--surface)', width: 28, height: 26, borderRadius: 4, background: v ? `color-mix(in srgb, var(--c1) ${Math.max(12, p)}%, var(--surface))` : 'var(--sunk)' }} />
      })}</tr>)}
    </tbody></table></div></section>
}
