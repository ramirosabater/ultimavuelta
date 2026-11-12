import { useState } from 'react'
import { rpc, useConsulta } from '../../lib/datos'
import { fechaCorta, pct, plata } from '../../lib/formato'
import { BarraFiltros, filtrosBase, SubNavTableros, useFiltros, type Clave } from './filtros'
import { PagarModal, venceTexto } from '../admin/Gastos'
import { BarrasPar, Barras, Cabeza, Delta, Pill, Ranking, Stat } from '../../components/ui'

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
  const d = (a: number, b: number | undefined, inv?: boolean) => F.comparar && r?.prev ? <Delta a={a} b={b == null ? null : Number(b)} inverso={inv} /> : undefined
  return <>
    <Cabeza etiqueta="Tableros" titulo="Finanzas" />
    <SubNavTableros />
    <BarraFiltros F={F} setF={setF} claves={CLAVES} />
    {error ? <div className="aviso bad">{error}</div> : !r ? <p className="cargando">Calculando…</p> : <div style={{ opacity: cargando ? 0.6 : 1 }}>
      <div className="stats" style={{ marginBottom: 16 }}>
        {!r.solo_gastos && <Stat label="Ventas" valor={plata(ventas)} extra={d(ventas, r.prev?.ventas)} />}
        <Stat label="Gastos" valor={plata(gastos)} extra={d(gastos, r.prev?.gastos, true)} />
        {!r.solo_gastos && <Stat label="Resultado" valor={<span style={{ color: res < 0 ? 'var(--crit)' : 'var(--ok)' }}>{plata(res)}</span>} extra={ventas ? <span className="muted">{pct(res / ventas)} de margen</span> : undefined} />}
        <Stat label={F.f.cuenta ? 'Saldo de la cuenta' : 'Disponible hoy'} valor={plata(r.disponible)} />
        <Stat label="A pagar" valor={plata(r.a_pagar)} extra={r.vencidos ? <Pill tono="crit">{r.vencidos} vencido{r.vencidos > 1 ? 's' : ''}</Pill> : undefined} />
        {!F.f.cuenta && <Stat label="Queda en 30 días" valor={<span style={{ color: Number(r.disponible) - Number(r.a_pagar_30) < 0 ? 'var(--crit)' : 'inherit' }}>{plata(Number(r.disponible) - Number(r.a_pagar_30))}</span>} extra={<span className="muted">sin contar ventas futuras</span>} />}
      </div>
      <section className="panel" style={{ marginBottom: 16 }}><h3>{r.solo_gastos ? 'Gastos' : 'Ventas y gastos'} {r.serie.por === 'dia' ? 'por día' : 'por mes'}</h3>
        {r.solo_gastos ? <Barras puntos={r.serie.puntos.map((p) => ({ l: p.l, v: Number(p.gastos) }))} etiqueta="Gastos" />
          : <BarrasPar puntos={r.serie.puntos.map((p) => ({ l: p.l, a: Number(p.ventas), b: Number(p.gastos) }))} na="Ventas" nb="Gastos" />}
      </section>
      <div className="rep-grid" style={{ marginTop: 0 }}>
        <section className="panel" style={{ minWidth: 0 }}><h3 style={{ marginBottom: 6 }}>Gastos por categoría</h3>
          {r.categorias.length ? <div className="tbl-wrap"><table><thead><tr><th>Categoría</th><th className="r">Período</th>{F.comparar && <th className="r">Anterior</th>}{!r.solo_gastos && <th className="r">Sobre ventas</th>}</tr></thead><tbody>
            {r.categorias.map((c) => <tr key={c.nombre}><td>{c.nombre}</td><td className="r mono">{plata(c.periodo)}</td>{F.comparar && <td className="r mono muted">{plata(c.anterior)}</td>}{!r.solo_gastos && <td className="r mono">{ventas ? pct(Number(c.periodo ?? 0) / ventas) : '—'}</td>}</tr>)}
          </tbody></table></div> : <div className="kempty">Sin gastos con estos filtros.</div>}
        </section>
        <section className="panel" style={{ minWidth: 0 }} data-ayuda="proximos-pagos"><h3 style={{ marginBottom: 6 }}>Próximos pagos</h3>
          {r.proximos.length ? <div className="rows">{r.proximos.map((g) => <div className="row" key={g.id}><div className="grow"><b>{g.concepto}</b><div className="muted" style={{ fontSize: 12 }}>{g.proveedor || g.categoria}</div></div>
            {venceTexto(g.vence)}<span className="num mono">{plata(g.monto)}</span><button className="btn sm" onClick={() => setPagar(g)}>Pagar</button></div>)}</div>
            : <div className="kempty">No hay pagos pendientes.</div>}
        </section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Detalle de gastos <Pill>{r.detalle.length}</Pill></h3>
        {r.detalle.length ? <><div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Proveedor</th><th>Estado</th><th className="r">Monto</th></tr></thead><tbody>
          {r.detalle.map((g) => <tr key={g.id}><td className="mono">{fechaCorta(g.fecha)}</td><td><b>{g.concepto}</b></td><td className="muted">{g.categoria}</td><td className="muted">{g.proveedor || '—'}</td>
            <td>{g.estado === 'pagado' ? <Pill tono="ok">{g.cuenta || 'Pagado'}</Pill> : venceTexto(g.vence)}</td><td className="r mono">{plata(g.monto)}</td></tr>)}
        </tbody></table></div><div className="total-row"><span className="label">Total</span><span className="num">{plata(gastos)}</span></div></>
          : <div className="kempty">Sin gastos en el período.</div>}
      </section>
      {!r.solo_gastos && <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 10 }}>Cómo te pagaron</h3>
        <Ranking filas={r.medios.map((m) => ({ nombre: m.nombre, v: Number(m.v), extra: <span className="muted" style={{ fontSize: 12 }}>→ {m.cuenta ?? 'sin cuenta'}</span> }))} /></section>}
    </div>}
    {pagar && <PagarModal gasto={pagar} onCerrar={() => setPagar(null)} onListo={() => { setPagar(null); recargar() }} />}
  </>
}
