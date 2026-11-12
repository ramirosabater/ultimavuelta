import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { DIAS, dow, fecha, sumarDias } from '../lib/formato'
import { linkWhatsApp, telefonoLindo } from '../lib/reservas'
import { LOGO, NOMBRE } from '../lib/marca'
import { Grilla } from '../components/Autos'

interface Info { activas: boolean; local: string; bajada: string; telefono: string; max: number; dias: number; hoy: string; cerrado: number[] }
interface Turno { hora: string; libres: number }
interface MiReserva { nombre: string; personas: number; fecha: string; hora: string; nota: string | null; estado: string; pasada: boolean; local: string; bajada: string; telefono: string }

const GUARDADAS = 'uv-reservas'
function leerGuardadas(): { codigo: string; fecha: string; hora: string }[] {
  try { return JSON.parse(localStorage.getItem(GUARDADAS) ?? '[]') } catch { return [] }
}
function guardar(codigo: string, f: string, h: string) {
  try { localStorage.setItem(GUARDADAS, JSON.stringify([{ codigo, fecha: f, hora: h }, ...leerGuardadas().filter((x) => x.codigo !== codigo)].slice(0, 5))) } catch { /* sin almacenamiento */ }
}

function Cabecera({ local, bajada }: { local?: string; bajada?: string }) {
  return <div className="pub-cab"><img src={LOGO} alt="" width={72} height={72} /><div><h1>{local || NOMBRE}</h1>{bajada && <small>{bajada}</small>}</div></div>
}

/** Página pública: /reservar para pedir una reserva y /reserva/<código> para verla o cancelarla. No necesita usuario. */
export default function Reservar() {
  const { codigo } = useParams()
  return codigo ? <VerReserva codigo={codigo} /> : <NuevaReserva />
}

function NuevaReserva() {
  const navigate = useNavigate()
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState('')
  const [personas, setPersonas] = useState(2)
  const [dia, setDia] = useState('')
  const [turnos, setTurnos] = useState<Turno[] | null>(null)
  const [h, setH] = useState('')
  const [nombre, setNombre] = useState('')
  const [tel, setTel] = useState('')
  const [nota, setNota] = useState('')
  const [msj, setMsj] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const guardadas = leerGuardadas()

  useEffect(() => {
    supabase.rpc('reservas_info').then(({ data, error: e }) => {
      if (e || !data) { setError('No pudimos cargar las reservas. Probá de nuevo en un rato.'); return }
      setInfo(data as Info)
    })
  }, [])

  const dias = info ? Array.from({ length: Math.min(info.dias, 21) + 1 }, (_, i) => sumarDias(info.hoy, i)).filter((d) => !info.cerrado.includes(dow(d))) : []
  useEffect(() => { if (!dia && dias.length) setDia(dias[0]) }, [dia, dias])

  const cargarTurnos = useCallback(async (d: string) => {
    setTurnos(null)
    const { data, error: e } = await supabase.rpc('reservas_disponibles', { p_fecha: d })
    setTurnos(e ? [] : (data as Turno[]))
  }, [])
  useEffect(() => { if (dia) cargarTurnos(dia) }, [dia, cargarTurnos])
  useEffect(() => { if (turnos && h && !turnos.some((t) => t.hora === h && t.libres >= personas)) setH('') }, [turnos, h, personas])

  async function reservar() {
    setMsj('')
    if (!h) { setMsj('Elegí un horario.'); return }
    if (nombre.trim().length < 2) { setMsj('Poné tu nombre.'); return }
    setOcupado(true)
    const { data, error: e } = await supabase.rpc('pedir_reserva', { p_nombre: nombre, p_telefono: tel, p_personas: personas, p_fecha: dia, p_hora: h, p_nota: nota.trim() || null })
    setOcupado(false)
    if (e) { setMsj(mensajeError(e)); cargarTurnos(dia); return }
    guardar(data as string, dia, h)
    navigate(`/reserva/${data}`, { replace: false })
  }

  if (error) return <div className="pub"><Cabecera /><p className="pub-error">{error}</p></div>
  if (!info) return <div className="pub"><p className="cargando" style={{ textAlign: 'center', marginTop: 80 }}>Cargando…</p></div>
  const wa = info.telefono ? linkWhatsApp(info.telefono, `¡Hola! Quería consultar por una reserva en ${info.local}.`) : ''

  if (!info.activas) return <div className="pub"><Cabecera local={info.local} bajada={info.bajada} />
    <div className="panel stack" style={{ marginTop: 12 }}><h2 style={{ margin: 0 }}>Reservas</h2>
      <p style={{ margin: 0 }}>Por ahora no tomamos reservas por acá.{info.telefono && <> Escribinos y lo vemos.</>}</p>
      {wa && <a className="btn pri" href={wa} target="_blank" rel="noreferrer">Escribir por WhatsApp</a>}</div></div>

  return <div className="pub">
    <Cabecera local={info.local} bajada={info.bajada} />
    <h2 className="res-titulo">Reservá tu mesa</h2>
    {guardadas.length > 0 && <p className="muted" style={{ margin: '0 0 8px', fontSize: 14 }}>Tus reservas: {guardadas.map((g, i) => <span key={g.codigo}>{i > 0 && ' · '}<Link to={`/reserva/${g.codigo}`}>{fecha(g.fecha)} {g.hora}</Link></span>)}</p>}

    <section className="res-paso">
      <div className="label">¿Cuántos son?</div>
      <div className="res-personas">
        <button aria-label="Uno menos" onClick={() => setPersonas((p) => Math.max(1, p - 1))} disabled={personas <= 1}>−</button>
        <b>{personas}</b><span>{personas === 1 ? 'persona' : 'personas'}</span>
        <button aria-label="Uno más" onClick={() => setPersonas((p) => Math.min(info.max, p + 1))} disabled={personas >= info.max}>+</button>
      </div>
      {personas >= info.max && <small className="muted">¿Son más de {info.max}? {wa ? <a href={wa} target="_blank" rel="noreferrer">Escribinos</a> : 'Escribinos'} y lo armamos.</small>}
    </section>

    <section className="res-paso">
      <div className="label">¿Qué día?</div>
      <div className="res-dias">{dias.map((d, i) => <button key={d} aria-pressed={dia === d} onClick={() => setDia(d)}>
        <small>{i === 0 && d === info.hoy ? 'Hoy' : d === sumarDias(info.hoy, 1) ? 'Mañana' : DIAS[dow(d)]}</small><b>{Number(d.slice(8))}</b></button>)}</div>
    </section>

    <section className="res-paso">
      <div className="label">¿A qué hora? <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>· {fecha(dia)}</span></div>
      {turnos === null ? <p className="muted">Buscando lugares…</p>
        : !turnos.length ? <p className="muted">Ese día no tomamos reservas. Probá con otro.</p>
        : <div className="res-horas">{turnos.map((t) => { const no = t.libres < personas; return <button key={t.hora} aria-pressed={h === t.hora} disabled={no} onClick={() => setH(t.hora)}>
            <b>{t.hora}</b>{no && <small>{t.libres ? `Quedan ${t.libres}` : 'Completo'}</small>}</button> })}</div>}
    </section>

    {h && <section className="res-paso stack">
      <div className="label">Tus datos</div>
      <label className="campo">Nombre<input id="res-nombre" autoComplete="name" maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      <label className="campo">Celular (WhatsApp)<input id="res-tel" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="297 412 3456" value={tel} onChange={(e) => setTel(e.target.value)} />
        <small>Con código de área, sin el 0 ni el 15. Te confirmamos por acá.</small></label>
      <label className="campo">Aclaración (opcional)<input id="res-nota" maxLength={200} placeholder="Cumpleaños, silla para bebé, afuera…" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
    </section>}

    <footer className="pub-fin"><div className="label">En pista</div><Grilla /></footer>
    <div style={{ height: 110 }} />
    <div className="pub-pie">
      <button className="btn pri grow" disabled={!h || ocupado} onClick={reservar}>
        {ocupado ? 'Reservando…' : h ? `Reservar · ${fecha(dia)} ${h} · ${personas} ${personas === 1 ? 'persona' : 'personas'}` : 'Elegí día y horario'}
      </button>
    </div>
    {msj && <div className="toast" role="status">{msj}</div>}
  </div>
}

function VerReserva({ codigo }: { codigo: string }) {
  const [r, setR] = useState<MiReserva | null | undefined>(undefined)
  const [msj, setMsj] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('ver_reserva', { p_codigo: codigo })
    setR(error ? null : (data as MiReserva | null))
  }, [codigo])
  useEffect(() => { cargar(); const iv = window.setInterval(cargar, 30000); return () => window.clearInterval(iv) }, [cargar])

  async function cancelar() {
    if (!window.confirm('¿Cancelar la reserva?')) return
    setOcupado(true)
    const { error } = await supabase.rpc('cancelar_reserva', { p_codigo: codigo })
    setOcupado(false)
    setMsj(error ? mensajeError(error) : 'Listo, la reserva quedó cancelada.')
    cargar()
  }

  if (r === undefined) return <div className="pub"><p className="cargando" style={{ textAlign: 'center', marginTop: 80 }}>Cargando…</p></div>
  if (r === null) return <div className="pub"><Cabecera /><p className="pub-error">No encontramos esa reserva. Revisá el link.</p><p><Link to="/reservar">Hacer una reserva</Link></p></div>
  const wa = r.telefono ? linkWhatsApp(r.telefono, `¡Hola! Tengo una reserva para el ${fecha(r.fecha)} a las ${r.hora} a nombre de ${r.nombre}.`) : ''
  const estado = r.estado === 'pendiente' ? { t: 'Recibimos tu reserva', s: 'Te la confirmamos por WhatsApp en un rato.', c: 'pendiente' }
    : r.estado === 'confirmada' ? { t: '¡Reserva confirmada!', s: 'Te esperamos.', c: 'confirmada' }
    : r.estado === 'sentada' ? { t: '¡Gracias por venir!', s: 'Esperamos que la hayan pasado bien.', c: 'confirmada' }
    : r.estado === 'cancelada' ? { t: 'Reserva cancelada', s: 'Si querés, hacé otra.', c: 'cancelada' }
    : { t: 'La reserva venció', s: 'Si querés, hacé otra.', c: 'cancelada' }

  return <div className="pub">
    <Cabecera local={r.local} bajada={r.bajada} />
    <div className={`res-estado ${estado.c}`}><b>{estado.t}</b><span>{estado.s}</span></div>
    <dl className="kv res-kv">
      <dt>A nombre de</dt><dd>{r.nombre}</dd>
      <dt>Día</dt><dd>{fecha(r.fecha)}</dd>
      <dt>Hora</dt><dd className="mono">{r.hora}</dd>
      <dt>Personas</dt><dd className="mono">{r.personas}</dd>
      {r.nota && <><dt>Aclaración</dt><dd>{r.nota}</dd></>}
    </dl>
    <div className="stack">
      {(r.estado === 'pendiente' || r.estado === 'confirmada') && !r.pasada && <>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Guardá este link para ver o cancelar la reserva. Si llegan más tarde o cambian de planes, avisanos.</p>
        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">Escribir al local · {telefonoLindo(r.telefono)}</a>}
        <button className="btn ghost danger" disabled={ocupado} onClick={cancelar}>Cancelar la reserva</button>
      </>}
      <Link className="btn ghost" to="/reservar">Hacer otra reserva</Link>
    </div>
    <footer className="pub-fin"><div className="label">En pista</div><Grilla /></footer>
    {msj && <div className="toast" role="status">{msj}</div>}
  </div>
}
