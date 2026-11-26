import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rpc, useConsulta } from '../../lib/datos'
import { DIAS, DIAS_LARGO, dow, jornada, mesTxt, pct, plata, sumarDias } from '../../lib/formato'
import { SubNavTableros } from './filtros'
import { Cabeza, Pill, type Tono } from '../../components/ui'
import { Area, Bloque, Kpi, Podio, Variacion, color, corto } from '../../components/tablero'

interface Resumen {
  jornada: string
  hoy: { vendido: number; mesas: number; pasado: number; hay_pasado: boolean; abiertas: number; en_mesas: number; cubiertos: number; ticket_prom: number | null }
  mes: { ventas: number; ventas_ant: number; gastos: number; costo: number }
  plata: { cuentas: { nombre: string; saldo: number }[]; deudas: number; vencido: number }
  alertas: { nivel: Tono; etiqueta: string; texto: string; ir: string }[]
  ultimas: { l: string; v: number }[]
}
export interface MesasRinde {
  mesas: { numero: number; veces: number; vendido: number; cubiertos: number | null; ticket: number; por_cubierto: number | null; minutos: number | null; por_hora: number | null; juntadas: number }[]
  sin_mesa: { tipo: string; veces: number; vendido: number }[]
  total: number
}

const EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** La base puede devolver el día en inglés: "Fri 13" → "Vie 13" */
const diaEs = (l: string) => l.replace(/^([A-Za-z]{3})/, (d) => (EN.includes(d) ? DIAS[EN.indexOf(d)] : d))

export default function TableroResumen() {
  const [todas, setTodas] = useState(false)
  const j = jornada(), mes = j.slice(0, 7)
  const { datos, error } = useConsulta(async () => {
    const [r, m] = await Promise.all([rpc<Resumen>('tablero_resumen'), rpc<MesasRinde>('tablero_mesas', { p_desde: `${mes}-01`, p_hasta: j }).catch(() => null)])
    return { r, m }
  })
  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <><SubNavTableros /><p className="cargando">Armando el resumen…</p></>
  const { r, m } = datos
  const disp = r.plata.cuentas.reduce((s, c) => s + Number(c.saldo), 0)
  const ventas = Number(r.mes.ventas), gastos = Number(r.mes.gastos), resultado = ventas - gastos, costoPct = ventas ? Number(r.mes.costo) / ventas : null
  const chispa = r.ultimas.map((x) => Number(x.v))
  const libre = disp - Number(r.plata.deudas)
  const topMesas = (m?.mesas ?? []).slice().sort((a, b) => Number(b.vendido) - Number(a.vendido)).slice(0, 5)

  return <>
    <Cabeza etiqueta="En vivo" titulo="Tableros" />
    <SubNavTableros />

    <div className="tb">
      <Bloque className="oscuro s7" titulo={<>Esta noche · {DIAS_LARGO[dow(j)]}</>} ayuda="esta-noche"
        der={r.hoy.hay_pasado ? <Variacion a={Number(r.hoy.vendido)} b={Number(r.hoy.pasado)} texto={`vs. ${DIAS_LARGO[dow(sumarDias(j, -7))]} pasado a esta hora`} /> : 'sin dato de la semana pasada'}>
        <div className="vivo">
          <div className="vivo-c" style={{ ['--k' as string]: 'var(--t2)' }}><div className="vivo-o"><b>{corto(Number(r.hoy.en_mesas))}</b></div><small>En mesas</small><em>{r.hoy.abiertas} abierta{r.hoy.abiertas === 1 ? '' : 's'}</em></div>
          <div className="vivo-c" style={{ ['--k' as string]: 'var(--t3)' }}><div className="vivo-o grande"><b>{corto(Number(r.hoy.vendido))}</b></div><small>Cobrado hoy</small><em>{r.hoy.mesas} mesa{r.hoy.mesas === 1 ? '' : 's'} cobrada{r.hoy.mesas === 1 ? '' : 's'}</em></div>
          <div className="vivo-c" style={{ ['--k' as string]: 'var(--t4)' }}><div className="vivo-o"><b>{r.hoy.cubiertos || '—'}</b></div><small>Cubiertos</small><em>personas</em></div>
        </div>
        <div className="vivo-pie">
          <div><small>Ticket promedio</small><b>{r.hoy.ticket_prom ? plata(r.hoy.ticket_prom) : '—'}</b></div>
          <div><small>Total de la noche</small><b>{plata(Number(r.hoy.vendido) + Number(r.hoy.en_mesas))}</b></div>
          <div><small>Por cubierto</small><b>{r.hoy.cubiertos ? plata(Number(r.hoy.vendido) / r.hoy.cubiertos) : '—'}</b></div>
        </div>
      </Bloque>

      <Bloque className="s5" titulo="La plata" ayuda="plata" der={<Link to="/tableros/finanzas">Ver finanzas →</Link>}>
        <div className="fila" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
          <div className="grow"><div className="label">Disponible</div><div style={{ font: '400 clamp(22px, 6vw, 32px) var(--f-display)', whiteSpace: 'nowrap' }}>{plata(disp)}</div></div>
          <Pill tono={libre < 0 ? 'crit' : 'ok'}>Queda libre {plata(libre)}</Pill>
        </div>
        <Podio filas={r.plata.cuentas.map((c) => ({ nombre: c.nombre, v: Math.max(0, Number(c.saldo)) }))} />
        <div className="vivo-pie" style={{ color: 'var(--fg)' }}>
          <div style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}><small>A pagar</small><b>{corto(Number(r.plata.deudas))}</b></div>
          <div style={{ background: Number(r.plata.vencido) ? 'var(--crit-soft)' : 'var(--sunk)', borderColor: 'var(--line)' }}><small>Vencido</small><b style={{ color: Number(r.plata.vencido) ? 'var(--crit)' : undefined }}>{corto(Number(r.plata.vencido))}</b></div>
          <div style={{ background: 'var(--sunk)', borderColor: 'var(--line)' }}><small>Libre</small><b>{corto(libre)}</b></div>
        </div>
      </Bloque>
    </div>

    <div className="label" style={{ marginBottom: 6 }}>{mesTxt(mes)}</div>
    <div className="kpis" data-ayuda="el-mes">
      <Kpi titulo="Ventas del mes" icono="💰" color={color(0)} valor={plata(ventas)} chispa={chispa} pie={<><Variacion a={ventas} b={Number(r.mes.ventas_ant)} /> vs. el mes pasado a esta altura</>} />
      <Kpi titulo="Gastos del mes" icono="🧾" color={color(5)} valor={plata(gastos)} pie={ventas ? `${pct(gastos / ventas)} de lo vendido` : undefined} />
      <Kpi titulo="Resultado" icono={resultado < 0 ? '📉' : '📈'} color={color(3)} valor={<span style={{ color: resultado < 0 ? 'var(--crit)' : undefined }}>{plata(resultado)}</span>} pie="ventas menos gastos" />
      <Kpi titulo="Margen" icono="🎯" color={color(1)} valor={ventas ? pct(resultado / ventas, 1) : '—'} pie="de cada $100 que entran" />
      <Kpi titulo="Costo de mercadería" icono="🥩" color={color(2)} valor={costoPct != null ? pct(costoPct, 1) : '—'}
        pie={costoPct != null ? <><Pill tono={costoPct > 0.35 ? 'crit' : costoPct < 0.25 ? 'warn' : 'ok'}>{costoPct > 0.35 ? 'alto' : costoPct < 0.25 ? 'bajo' : 'bien'}</Pill> objetivo 25–35 %</> : undefined} />
    </div>

    <div className="tb">
      <Bloque className="s8" titulo="Ventas de las últimas 2 semanas" der={`${plata(chispa.reduce((s, v) => s + v, 0))} en total`}>
        <Area puntos={r.ultimas.map((x) => ({ l: diaEs(x.l), v: Number(x.v) }))} />
      </Bloque>
      <Bloque className="s4" titulo="Mesas que más rinden" der={mesTxt(mes)} ayuda="top-mesas">
        {topMesas.length ? <Podio filas={topMesas.map((x) => ({ nombre: <><span className="chapa-mini">{x.numero}</span> Mesa {x.numero}</>, v: Number(x.vendido),
          sub: `${x.veces} ${x.veces === 1 ? 'vez' : 'veces'} · ticket ${corto(x.ticket)}`, der: x.por_hora ? <b>{corto(x.por_hora)}/h</b> : null }))} />
          : <div className="kempty">Todavía no hay mesas cobradas este mes.</div>}
        <Link className="btn sm ghost" style={{ marginTop: 10 }} to="/tableros/ventas">Ver todas las mesas →</Link>
      </Bloque>
    </div>

    <Bloque titulo={<>Para atender {r.alertas.length > 0 && <Pill>{r.alertas.length}</Pill>}</>} ayuda="atender">
      {r.alertas.length ? <div className="rows">{r.alertas.slice(0, todas ? 99 : 8).map((a, k) => <div key={k} className="row">
        <Pill tono={a.nivel}>{a.etiqueta}</Pill><span className="grow">{a.texto}</span><Link className="btn sm ghost" to={a.ir}>Ir</Link></div>)}
        {r.alertas.length > 8 && <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver ${r.alertas.length - 8} más`}</button>}</div>
        : <div className="kempty">Todo en orden.</div>}
    </Bloque>
  </>
}
