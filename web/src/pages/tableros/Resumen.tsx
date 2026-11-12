import { Link } from 'react-router-dom'
import { rpc, useConsulta } from '../../lib/datos'
import { DIAS_LARGO, dow, jornada, mesTxt, pct, plata, sumarDias } from '../../lib/formato'
import { SubNavTableros } from './filtros'
import { Barras, Cabeza, Delta, Pill, Stat, type Tono } from '../../components/ui'

interface Resumen {
  jornada: string
  hoy: { vendido: number; mesas: number; pasado: number; hay_pasado: boolean; abiertas: number; en_mesas: number; cubiertos: number; ticket_prom: number | null }
  mes: { ventas: number; ventas_ant: number; gastos: number; costo: number }
  plata: { cuentas: { nombre: string; saldo: number }[]; deudas: number; vencido: number }
  alertas: { nivel: Tono; etiqueta: string; texto: string; ir: string }[]
  ultimas: { l: string; v: number }[]
}

export default function TableroResumen() {
  const { datos: r, error } = useConsulta(() => rpc<Resumen>('tablero_resumen'))
  if (error) return <div className="aviso bad">{error}</div>
  if (!r) return <><SubNavTableros /><p className="cargando">Armando el resumen…</p></>
  const j = jornada(), mes = j.slice(0, 7), disp = r.plata.cuentas.reduce((s, c) => s + Number(c.saldo), 0)
  const resultado = Number(r.mes.ventas) - Number(r.mes.gastos)
  return <>
    <Cabeza etiqueta="En vivo" titulo="Tableros" />
    <SubNavTableros />
    <div className="label" style={{ marginBottom: 6 }}>Esta noche · {DIAS_LARGO[dow(j)]}</div>
    <div className="stats" style={{ marginBottom: 18 }} data-ayuda="esta-noche">
      <Stat label="Vendido hasta ahora" valor={plata(r.hoy.vendido)} extra={r.hoy.hay_pasado ? <><Delta a={Number(r.hoy.vendido)} b={Number(r.hoy.pasado)} /> <span className="muted">vs. {DIAS_LARGO[dow(sumarDias(j, -7))]} pasado a esta hora</span></> : <span className="muted">sin dato de la semana pasada</span>} />
      <Stat label="En mesas abiertas" valor={plata(r.hoy.en_mesas)} extra={`${r.hoy.abiertas} mesa${r.hoy.abiertas === 1 ? '' : 's'}`} />
      <Stat label="Cubiertos" valor={r.hoy.cubiertos || '—'} />
      <Stat label="Ticket promedio" valor={r.hoy.ticket_prom ? plata(r.hoy.ticket_prom) : '—'} />
    </div>
    <div className="label" style={{ marginBottom: 6 }}>{mesTxt(mes)}</div>
    <div className="stats" style={{ marginBottom: 18 }} data-ayuda="el-mes">
      <Stat label="Ventas del mes" valor={plata(r.mes.ventas)} extra={<><Delta a={Number(r.mes.ventas)} b={Number(r.mes.ventas_ant)} /> <span className="muted">vs. mismo día del mes pasado</span></>} />
      <Stat label="Gastos del mes" valor={plata(r.mes.gastos)} />
      <Stat label="Resultado" valor={<span style={{ color: resultado < 0 ? 'var(--crit)' : 'var(--ok)' }}>{plata(resultado)}</span>} />
      <Stat label="Costo de mercadería" valor={Number(r.mes.ventas) ? pct(Number(r.mes.costo) / Number(r.mes.ventas)) : '—'} extra={Number(r.mes.ventas) ? <span className="muted">objetivo 25–35 %</span> : undefined} />
    </div>
    <div className="label" style={{ marginBottom: 6 }}>Plata</div>
    <div className="stats" style={{ marginBottom: 18 }} data-ayuda="plata">
      <Stat label="Disponible" valor={plata(disp)} extra={r.plata.cuentas.map((c) => `${c.nombre} ${plata(c.saldo)}`).join(' · ')} />
      <Stat label="Deudas a pagar" valor={plata(r.plata.deudas)} />
      <Stat label="Vencido" valor={<span style={{ color: Number(r.plata.vencido) ? 'var(--crit)' : 'inherit' }}>{plata(r.plata.vencido)}</span>} />
      <Stat label="Queda libre" valor={plata(disp - Number(r.plata.deudas))} extra={<span className="muted">disponible menos deudas</span>} />
    </div>
    <section className="panel" style={{ marginBottom: 16 }} data-ayuda="atender">
      <h3 style={{ marginBottom: 8 }}>Para atender {r.alertas.length > 0 && <Pill>{r.alertas.length}</Pill>}</h3>
      {r.alertas.length ? <div className="rows">{r.alertas.slice(0, 14).map((a, k) => <div key={k} className="row">
        <Pill tono={a.nivel}>{a.etiqueta}</Pill><span className="grow">{a.texto}</span><Link className="btn sm ghost" to={a.ir}>Ir</Link></div>)}
        {r.alertas.length > 14 && <div className="muted" style={{ fontSize: 13, paddingTop: 6 }}>Y {r.alertas.length - 14} más.</div>}</div>
        : <div className="kempty">Todo en orden.</div>}
    </section>
    <section className="panel"><h3>Ventas de las últimas 2 semanas</h3><Barras puntos={r.ultimas} /></section>
  </>
}
