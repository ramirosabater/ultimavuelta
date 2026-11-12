import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { hhmm, jornada, num, pct, plata, sumarDias } from '../../lib/formato'
import type { Insumo, MovimientoStock } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { MermaModal } from '../../components/stock'
import { Cabeza, Pill, Ranking, Stat } from '../../components/ui'

export default function Mermas() {
  const [rango, setRango] = useState(7)
  const { datos, error, recargar } = useConsulta(async () => {
    const desde = sumarDias(jornada(), -(rango - 1))
    const [insumos, movs, ventas] = await Promise.all([
      tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre')),
      tabla<MovimientoStock[]>(supabase.from('movimientos_stock').select('*').eq('tipo', 'merma').gte('jornada', desde).order('hora', { ascending: false })),
      tabla<{ costo: number }[]>(supabase.from('tickets').select('costo').gte('jornada', desde)),
    ])
    return { insumos, movs, usado: ventas.reduce((s, t) => s + Number(t.costo), 0) }
  }, [rango])
  const [nueva, setNueva] = useState(false)
  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <><SubNavStock /><p className="cargando">Cargando…</p></>
  const { insumos, movs, usado } = datos
  const valor = (m: MovimientoStock) => -Number(m.cantidad) * Number(m.costo_unit)
  const tirado = movs.reduce((s, m) => s + valor(m), 0), p = usado + tirado > 0 ? tirado / (usado + tirado) : 0
  const agrupar = (k: (m: MovimientoStock) => string) => { const o = new Map<string, number>(); movs.forEach((m) => o.set(k(m), (o.get(k(m)) ?? 0) + valor(m))); return [...o].map(([nombre, v]) => ({ nombre, v })).sort((a, b) => b.v - a.v).slice(0, 8) }
  const nombre = (id: number | null) => insumos.find((i) => i.id === id)?.nombre ?? '—'
  const porMotivo = agrupar((m) => m.motivo ?? 'Otro'), porArt = agrupar((m) => nombre(m.insumo_id))

  return <>
    <Cabeza etiqueta="Desperdicio" titulo="Mermas"><button className="btn pri" onClick={() => setNueva(true)} data-ayuda="registrar-merma">Registrar merma</button></Cabeza>
    <SubNavStock />
    <div className="chips" style={{ marginBottom: 12 }}>{[[7, '7 días'], [30, '30 días'], [90, '90 días']].map(([k, l]) => <button key={k} className="chip" aria-pressed={rango === k} onClick={() => setRango(Number(k))}>{l}</button>)}</div>
    <div className="stats" style={{ marginBottom: 16 }}>
      <Stat label="Plata tirada" valor={plata(tirado)} /><Stat label="Sobre lo usado" valor={usado + tirado ? pct(p, 1) : '—'} />
      <Stat label="Registros" valor={movs.length} /><Stat label="Motivo principal" valor={<span style={{ fontSize: 15, fontFamily: 'var(--f-body)' }}>{porMotivo[0]?.nombre ?? '—'}</span>} />
    </div>
    {usado + tirado > 0 && <p className="muted" style={{ fontSize: 13, margin: '-6px 0 14px' }}>{p <= 0.03 ? <><Pill tono="ok">Muy bien</Pill> Por debajo del 3 % es un desperdicio bajo para una parrilla.</> : p <= 0.06 ? <><Pill tono="warn">A mirar</Pill> Entre 3 % y 6 %: revisá los motivos que más se repiten.</> : <><Pill tono="crit">Alto</Pill> Más del 6 %: conviene ajustar compras y preparación.</>}</p>}
    {!movs.length ? <div className="notice"><b>Sin mermas registradas en este período.</b><br />Cada vez que se tire algo (vencido, quemado, devuelto), cargalo con “Registrar merma”. Las diferencias al contar quedan aparte, en Control semanal.</div> : <>
      <div className="rep-grid" style={{ marginTop: 0 }}>
        <section className="panel"><h3 style={{ marginBottom: 10 }}>Por motivo</h3><Ranking filas={porMotivo} color="var(--crit)" conPct={false} /></section>
        <section className="panel"><h3 style={{ marginBottom: 10 }}>Por artículo</h3><Ranking filas={porArt} color="var(--crit)" conPct={false} /></section>
      </div>
      <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Registro</h3><div className="tbl-wrap"><table><thead><tr><th>Cuándo</th><th>Artículo</th><th>Motivo</th><th className="r">Cantidad</th><th className="r">Costo</th></tr></thead><tbody>
        {movs.slice(0, 80).map((m) => { const i = insumos.find((x) => x.id === m.insumo_id); return <tr key={m.id}>
          <td className="mono" style={{ whiteSpace: 'nowrap' }}>{new Date(m.hora).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} {hhmm(m.hora)}</td>
          <td><b>{i?.nombre}</b>{m.nota && <div className="muted" style={{ fontSize: 12 }}>{m.nota}</div>}</td><td>{m.motivo}</td>
          <td className="r mono">{num(-m.cantidad)} {i?.unidad}</td><td className="r mono">{plata(valor(m))}</td></tr> })}
      </tbody></table></div></section>
    </>}
    {nueva && <MermaModal insumos={insumos} onCerrar={() => setNueva(false)} onListo={() => { setNueva(false); recargar() }} />}
  </>
}
