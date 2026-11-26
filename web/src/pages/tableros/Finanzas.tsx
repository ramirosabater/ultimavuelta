import { useState } from 'react'
import { rpc, useConsulta } from '../../lib/datos'
import { fechaCorta, pct, plata } from '../../lib/formato'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { PagarModal, venceTexto } from '../admin/Gastos'
import { BarrasPar, Barras, Cabeza, Pill } from '../../components/ui'
import { Bloque, Dona, Kpi, Variacion, color, corto, emoji } from '../../components/tablero'

interface Finanzas {
  solo_gastos: boolean
  kpi: { ventas: number; gastos: number }
  prev: { ventas: number; gastos: number } | null
  serie: { por: 'dia' | 'mes'; puntos: { l: string; ventas: number; gastos: number }[] }
  categorias: { nombre: string; periodo: number | null; anterior: number }[]
  detalle: { id: number; fecha: string; concepto: string; categoria: string; proveedor: string | null; estado: string; vence: string | null; cuenta: string | null; monto: number }[]
  medios: { nombre: string; cuenta: string | null; v: number }[]
  proximos: { id: number; concepto: string; proveedor: string | null; categoria: string; vence: string | null; monto: number }[]
  disponible: number; a_pagar: number; vencidos: number; a_pagar_30: number
}
const CLAVES: Clave[] = ['gcat', 'proveedor', 'cuenta']

export default function TableroFinanzas() {
  const { F, setF } = useFiltros()
  const { datos: r, error, cargando, recargar } = useConsulta(() => rpc<Finanzas>('tablero_finanzas', { p_desde: F.desde, p_hasta: F.hasta, p_f: filtrosBase(F, CLAVES), p_comparar: F.comparar }), [JSON.stringify(F)])
  const [pagar, setPagar] = useState<{ id: number; concepto: string; monto: number } | null>(null)
  const ventas = Number(r?.kpi.ventas ?? 0), gastos = Number(r?.kpi.gastos ?? 0), res = ventas - gastos
  const v = (a: number, b: number | undefined, inv?: boolean) => F.comparar && r?.prev ? <Variacion a={a} b={b == null ? null : Number(b)} inverso={inv} texto="vs. antes" /> : undefined
  return <>
    <Cabeza etiqueta="Tableros" titulo="Finanzas" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="kpis">
        {!r.solo_gastos && <Kpi titulo="Ingresos" icono="💰" color="var(--t7)" valor={plata(ventas)} chispa={r.serie.puntos.map((p) => Number(p.ventas))} pie={v(ventas, r.prev?.ventas)} />}
        <Kpi titulo="Gastos" icono="🧾" color="var(--t1)" valor={plata(gastos)} chispa={r.serie.puntos.map((p) => Number(p.gastos))} pie={v(gastos, r.prev?.gastos, true)} />
        {!r.solo_gastos && <Kpi titulo="Beneficio neto" icono={res < 0 ? '📉' : '📈'} color="var(--t4)" valor={<span style={{ color: res < 0 ? 'var(--crit)' : undefined }}>{plata(res)}</span>} pie={r.prev ? v(res, Number(r.prev.ventas) - Number(r.prev.gastos)) : 'ingresos menos gastos'} />}
        {!r.solo_gastos && <Kpi titulo="Margen" icono="🎯" color="var(--t3)" valor={ventas ? pct(res / ventas, 1) : '—'} pie="de cada $100 que entran" />}
        {!r.solo_gastos && <Kpi titulo="Gastos vs. ingresos" icono="⚖️" color="var(--t8)" valor={ventas ? pct(gastos / ventas, 1) : '—'} pie={ventas ? (gastos > ventas ? 'se gastó más de lo que entró' : 'de lo que entró se fue en gastos') : undefined} />}
      </div>

      <div className="tb">
        <Bloque className="s7" titulo="Gastos y compras" der={`${r.categorias.length} categorías`}>
          {r.categorias.length ? <div className="iconos">{r.categorias.map((c, i) => <div key={c.nombre} className="icono-f" style={{ ['--k' as string]: color(i) }}>
            <span className="icono-e" aria-hidden="true">{emoji(c.nombre)}</span>
            <div style={{ minWidth: 0 }}><b>{plata(c.periodo)}</b><span className="icono-t">{c.nombre}{gastos ? ` · ${pct(Number(c.periodo ?? 0) / gastos)}` : ''}</span>
              {F.comparar && Number(c.anterior) > 0 && <Variacion a={Number(c.periodo ?? 0)} b={Number(c.anterior)} inverso />}</div>
          </div>)}</div> : <div className="kempty">Sin gastos con estos filtros.</div>}
        </Bloque>
        <Bloque className="s5" titulo={r.solo_gastos ? 'En qué se va la plata' : 'Gastos vs. ingresos'}>
          <Dona filas={r.categorias.map((c) => ({ nombre: c.nombre, v: Number(c.periodo ?? 0) }))}
            centro={r.solo_gastos || !ventas ? <><b>{corto(gastos)}</b>gastos</> : <><b>{pct(gastos / ventas)}</b>de lo vendido</>} />
        </Bloque>
      </div>

      <div className="tb">
        <Bloque className="s8" titulo={`${r.solo_gastos ? 'Gastos' : 'Ingresos y gastos'} ${r.serie.por === 'dia' ? 'por día' : 'por mes'}`}>
          {r.solo_gastos ? <Barras puntos={r.serie.puntos.map((p) => ({ l: p.l, v: Number(p.gastos) }))} etiqueta="Gastos" />
            : <BarrasPar puntos={r.serie.puntos.map((p) => ({ l: p.l, a: Number(p.ventas), b: Number(p.gastos) }))} na="Ingresos" nb="Gastos" />}
        </Bloque>
        <Bloque className="s4" titulo="La caja que viene" ayuda="proximos-pagos">
          <div className="vivo-pie" style={{ marginTop: 0, marginBottom: 12 }}>
            <div style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}><small>{F.f.cuenta ? 'Saldo' : 'Disponible'}</small><b>{corto(Number(r.disponible))}</b></div>
            <div style={{ background: r.vencidos ? 'var(--crit-soft)' : 'var(--sunk)', borderColor: 'var(--line)' }}><small>A pagar</small><b>{corto(Number(r.a_pagar))}</b></div>
            {!F.f.cuenta && <div style={{ background: Number(r.disponible) - Number(r.a_pagar_30) < 0 ? 'var(--crit-soft)' : 'var(--ok-soft)', borderColor: 'var(--line)' }}><small>En 30 días</small><b>{corto(Number(r.disponible) - Number(r.a_pagar_30))}</b></div>}
          </div>
          {r.proximos.length ? <div className="rows">{r.proximos.slice(0, 6).map((g) => <div className="row" key={g.id}><div className="grow" style={{ minWidth: 0 }}><b>{g.concepto}</b><div>{venceTexto(g.vence)}</div></div>
            <span className="num mono">{Number(g.monto) > 0 ? corto(Number(g.monto)) : '—'}</span><button className="btn sm" onClick={() => setPagar(g)}>Pagar</button></div>)}</div>
            : <div className="kempty">No hay pagos pendientes.</div>}
        </Bloque>
      </div>

      {!r.solo_gastos && <Bloque titulo="Cómo te pagaron" className="tb-sep"><Dona filas={r.medios.map((m) => ({ nombre: `${m.nombre} → ${m.cuenta ?? 'sin cuenta'}`, v: Number(m.v) }))} centro={<><b>{corto(ventas)}</b>cobrado</>} /></Bloque>}

      <details className="bloque"><summary style={{ cursor: 'pointer' }}><b>Detalle de gastos</b> <span className="muted">({r.detalle.length} · {plata(gastos)})</span></summary>
        {r.detalle.length ? <div className="tbl-wrap" style={{ marginTop: 10 }}><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Proveedor</th><th>Estado</th><th className="r">Monto</th></tr></thead><tbody>
          {r.detalle.map((g) => <tr key={g.id}><td className="mono">{fechaCorta(g.fecha)}</td><td><b>{g.concepto}</b></td><td className="muted">{g.categoria}</td><td className="muted">{g.proveedor || '—'}</td>
            <td>{g.estado === 'pagado' ? <Pill tono="ok">{g.cuenta || 'Pagado'}</Pill> : venceTexto(g.vence)}</td><td className="r mono">{plata(g.monto)}</td></tr>)}
        </tbody></table></div> : <div className="kempty">Sin gastos en el período.</div>}
      </details>
    </div>}
    {pagar && <PagarModal gasto={pagar} onCerrar={() => setPagar(null)} onListo={() => { setPagar(null); recargar() }} />}
  </>
}
