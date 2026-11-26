import { rpc, useConsulta } from '../../lib/datos'
import { DIAS, duracion, pad, plata } from '../../lib/formato'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { useState } from 'react'
import { Cabeza } from '../../components/ui'
import { Area, BarrasValor, Bloque, Dona, Kpi, Mosaicos, Podio, Variacion, color, corto, emoji } from '../../components/tablero'
import type { MesasRinde } from './Resumen'

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
  const { datos, error, cargando } = useConsulta(async () => {
    const args = { p_desde: F.desde, p_hasta: F.hasta, p_f: filtrosBase(F, CLAVES) }
    const [r, m] = await Promise.all([rpc<Ventas>('tablero_ventas', { ...args, p_comparar: F.comparar }), rpc<MesasRinde>('tablero_mesas', args).catch(() => null)])
    return { r, m }
  }, [JSON.stringify(F)])
  const [orden, setOrden] = useState<'vendido' | 'por_hora' | 'ticket' | 'veces'>('vendido')
  const r = datos?.r, m = datos?.m
  const v = (a: number, b: number | null | undefined, inv?: boolean) => F.comparar && r?.prev ? <Variacion a={Number(a)} b={b == null ? null : Number(b)} inverso={inv} texto="vs. antes" /> : undefined
  const mesas = (m?.mesas ?? []).slice().sort((a, b) => Number(b[orden] ?? 0) - Number(a[orden] ?? 0))
  return <>
    <Cabeza etiqueta="Tableros" titulo="Ventas y servicio" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="kpis">
        <Kpi titulo="Ventas" icono="💰" color={color(0)} valor={plata(r.kpi.ventas)} chispa={r.serie.puntos.map((x) => Number(x.v))} pie={v(r.kpi.ventas, r.prev?.ventas)} />
        <Kpi titulo="Mesas cobradas" icono="🍽️" color={color(1)} valor={r.kpi.mesas} pie={<>{v(r.kpi.mesas, r.prev?.mesas)} {r.kpi.unidades} productos</>} />
        <Kpi titulo="Ticket promedio" icono="🧾" color={color(2)} valor={r.kpi.ticket_prom ? plata(r.kpi.ticket_prom) : '—'} pie={r.kpi.ticket_prom ? v(r.kpi.ticket_prom, r.prev?.ticket_prom) : undefined} />
        <Kpi titulo="Por cubierto" icono="👤" color={color(3)} valor={r.kpi.por_cubierto ? plata(r.kpi.por_cubierto) : '—'} pie={r.kpi.por_cubierto ? <>{v(r.kpi.por_cubierto, r.prev?.por_cubierto)} {r.kpi.cubiertos} personas</> : undefined} />
        <Kpi titulo="Permanencia" icono="⏱️" color={color(4)} valor={r.kpi.permanencia != null ? duracion(Number(r.kpi.permanencia)) : '—'} pie="de abrir a cobrar" />
        <Kpi titulo="Cocina" icono="🔥" color={color(5)} valor={r.kpi.cocina_prom != null ? `${r.kpi.cocina_prom} min` : '—'} pie={r.kpi.cocina_tarde != null ? `${r.kpi.cocina_tarde} % llegó tarde` : 'por comanda'} />
        <Kpi titulo="Bebidas" icono="🍹" color={color(6)} valor={r.kpi.barra_prom != null ? `${r.kpi.barra_prom} min` : '—'} pie={r.kpi.barra_tarde != null ? `${r.kpi.barra_tarde} % llegó tarde` : 'por comanda'} />
      </div>
      {!r.kpi.mesas ? <div className="notice"><b>Sin ventas con estos filtros.</b><br />Probá con otro período o quitá algún filtro.</div> : <>
        <div className="tb">
          <Bloque className="s8" titulo={r.serie.titulo} der={plata(r.kpi.ventas)}><Area puntos={r.serie.puntos.map((x) => ({ l: x.l, v: Number(x.v) }))} /></Bloque>
          <Bloque className="s4" titulo="Qué se vende"><Mosaicos filas={r.categorias.map((c) => ({ nombre: c.nombre, v: Number(c.v) }))} max={5} /></Bloque>
        </div>
        <div className="tb">
          <Bloque className="s5" titulo="Promedio por día de la semana" der="por noche abierta">
            <BarrasValor puntos={[1, 2, 3, 4, 5, 6, 0].map((x) => ({ l: DIAS[x], v: Number(r.por_dia.find((p) => p.dow === x)?.v ?? 0) }))} />
          </Bloque>
          <Calor calor={r.calor} />
        </div>

        <div className="tb">
          <Bloque className="s8" titulo="Mesas que más rinden" ayuda="top-mesas"
            der={<select aria-label="Ordenar mesas" value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}>
              <option value="vendido">por lo vendido</option><option value="por_hora">por plata por hora</option><option value="ticket">por ticket promedio</option><option value="veces">por veces que se ocupó</option></select>}>
            {mesas.length ? <>
              <div className="tbl-wrap"><table className="tabla-mesas"><thead><tr><th>#</th><th>Mesa</th><th className="r">Vendido</th><th className="r">Veces</th><th className="r">Ticket</th><th className="r">Por cubierto</th><th className="r">Tiempo</th><th className="r">Por hora</th></tr></thead><tbody>
                {mesas.map((x, i) => <tr key={x.numero}><td>{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><span className="chapa-mini">{x.numero}</span>{x.juntadas > 0 && <span className="muted" style={{ fontSize: 12 }}> · {x.juntadas} junta{x.juntadas > 1 ? 's' : ''}</span>}</td>
                  <td className="r mono"><b>{plata(x.vendido)}</b></td><td className="r mono">{x.veces}</td><td className="r mono">{plata(x.ticket)}</td>
                  <td className="r mono">{x.por_cubierto ? plata(x.por_cubierto) : '—'}</td><td className="r mono muted">{x.minutos != null ? duracion(x.minutos) : '—'}</td>
                  <td className="r mono"><b>{x.por_hora ? plata(x.por_hora) : '—'}</b></td></tr>)}
              </tbody></table></div>
              <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}><b>Por hora</b>: lo que deja la mesa por cada hora ocupada. Una mesa que vende mucho pero se queda toda la noche puede rendir menos que una que rota.</p>
            </> : <div className="kempty">Sin mesas del salón cobradas en el período.</div>}
          </Bloque>
          <Bloque className="s4" titulo="Cómo se cobra">
            {(m?.sin_mesa ?? []).length > 0 && <><h4 style={{ margin: '0 0 8px' }}>Salón, para llevar, delivery y barra</h4><Dona chico filas={[...mesas.length ? [{ nombre: 'Mesas del salón', v: mesas.reduce((s, x) => s + Number(x.vendido), 0) }] : [], ...(m?.sin_mesa ?? []).map((x) => ({ nombre: x.tipo, v: Number(x.vendido) }))]}
              centro={<><b>{corto(Number(m?.total ?? r.kpi.ventas))}</b>total</>} /><div style={{ height: 14 }} /></>}
            <h4 style={{ margin: '0 0 8px' }}>Medios de pago</h4>
            <Dona chico filas={r.medios.map((x) => ({ nombre: x.nombre, v: Number(x.v) }))} />
          </Bloque>
        </div>

        <div className="tb">
          <Bloque className="s6" titulo="Los más vendidos" der="por plata">
            <Podio filas={r.productos.slice(0, 8).map((p) => ({ nombre: <>{emoji(p.categoria ?? p.nombre)} {p.nombre}</>, v: Number(p.vendido), sub: `${p.unidades} unidades${p.categoria ? ` · ${p.categoria}` : ''}`,
              der: F.comparar && p.antes != null ? <span>antes {p.antes}</span> : null }))} />
          </Bloque>
          <Bloque className="s6" titulo="Por mozo">
            <Podio filas={r.mozos.map((x) => ({ nombre: x.nombre, v: Number(x.vendido), sub: `${x.mesas} mesas · ticket ${plata(Number(x.vendido) / x.mesas)}`, der: x.cubiertos ? <span>{plata(Number(x.vendido) / x.cubiertos)} por cubierto</span> : null }))} />
          </Bloque>
        </div>

        <details className="bloque"><summary style={{ cursor: 'pointer' }}><b>Todos los productos</b> <span className="muted">({r.productos.length})</span></summary>
          <div className="tbl-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Producto</th><th>Categoría</th><th className="r">Unidades</th>{F.comparar && <th className="r">Antes</th>}<th className="r">Vendido</th><th className="r">% del total</th></tr></thead><tbody>
            {(() => { const tot = r.productos.reduce((s, p) => s + Number(p.vendido), 0) || 1; return r.productos.map((p) => <tr key={p.nombre}><td><b>{p.nombre}</b></td><td className="muted">{p.categoria}</td><td className="r mono">{p.unidades}</td>
              {F.comparar && <td className="r mono muted">{p.antes ?? 0}</td>}<td className="r mono">{plata(p.vendido)}</td><td className="r mono">{Math.round((Number(p.vendido) / tot) * 1000) / 10}%</td></tr>) })()}
          </tbody></table></div>
        </details>
      </>}
    </div>}
  </>
}

function Calor({ calor }: { calor: Ventas['calor'] }) {
  const mx = Math.max(1, ...calor.map((c) => Number(c.v)))
  const horas = ORDEN_HORAS.filter((h) => calor.some((c) => c.h === h))
  const cols = horas.length ? ORDEN_HORAS.slice(ORDEN_HORAS.indexOf(horas[0]), ORDEN_HORAS.indexOf(horas[horas.length - 1]) + 1) : []
  return <Bloque className="s7" titulo="Cuándo se vende" der="más intenso, más plata" ayuda="calor">
    <div style={{ overflowX: 'auto' }}><table className="calor" style={{ width: 'auto' }}><thead><tr><th />{cols.map((c) => <th key={c} className="r" style={{ padding: '4px 3px', fontSize: 10 }}>{pad(c)}</th>)}</tr></thead><tbody>
      {[1, 2, 3, 4, 5, 6, 0].map((f) => <tr key={f}><th style={{ padding: '4px 8px 4px 0', fontSize: 11, border: 0 }}>{DIAS[f]}</th>{cols.map((c) => {
        const v = Number(calor.find((x) => x.dow === f && x.h === c)?.v ?? 0), p = Math.round((v / mx) * 100)
        return <td key={c} title={`${DIAS[f]} ${pad(c)} h: ${plata(v)}`} style={{ background: v ? `color-mix(in srgb, var(--t1) ${Math.max(12, p)}%, var(--surface))` : 'var(--sunk)' }} />
      })}</tr>)}
    </tbody></table></div></Bloque>
}
