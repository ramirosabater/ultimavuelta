import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { invocar, supabase } from '../lib/supabase'
import { areaDe, CIRCUITOS, type Circuito } from '../lib/guias'
import Chichito, { trajeDe } from './Chichito'

interface Sug { tema: string; clave: string; prioridad: number; posponer?: string; titulo: string; texto: string; boton: string; ir?: string; circuito?: string }
interface Memoria { tema: string; estado: 'nunca' | 'pospuesta' | 'aceptada'; hasta: string | null }

const VOZ = 'uv-voz'
const leerLS = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const escribirLS = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin memoria */ } }
/** Mañana a las 6 (cuando arranca la próxima jornada) */
function manana() { const d = new Date(); if (d.getHours() >= 6) d.setDate(d.getDate() + 1); d.setHours(6, 0, 0, 0); return d.toISOString() }
const calmo = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** El ayudante: sugerencias según lo que pasa en el local, recorridos guiados por pantalla y preguntas libres. */
export default function Ayuda() {
  const { perfil } = useAuth()
  const rol = perfil!.rol
  const { pathname } = useLocation()
  const navegar = useNavigate()
  const area = areaDe(pathname)
  const [abierto, setAbierto] = useState(false)
  const [tour, setTour] = useState<{ c: Circuito; paso: number } | null>(null)
  const [sug, setSug] = useState<Sug | null>(null)
  const [sugs, setSugs] = useState<Sug[]>([])
  const [memoria, setMemoria] = useState<Memoria[]>([])
  const [pregunta, setPregunta] = useState('')
  const [respuesta, setRespuesta] = useState('')
  const [pensando, setPensando] = useState(false)
  const [habla, setHabla] = useState(false)
  const [festeja, setFesteja] = useState(false)
  const [angulo, setAngulo] = useState<number | null>(null)
  const [voz, setVoz] = useState(leerLS(VOZ) === '1')
  const [anillo, setAnillo] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const mostradas = useRef(new Set<string>())

  // ------------------------------------------------ sugerencias y memoria
  const cargar = useCallback(async () => {
    const [s, m] = await Promise.all([supabase.rpc('sugerencias_ayudante', { p_area: area }), supabase.from('ayudante_memoria').select('tema, estado, hasta')])
    if (!s.error) setSugs((s.data ?? []) as Sug[])
    if (!m.error) setMemoria((m.data ?? []) as Memoria[])
  }, [area])
  useEffect(() => { cargar(); const iv = window.setInterval(cargar, 60000); return () => window.clearInterval(iv) }, [cargar])
  const permitida = (x: Sug) => { const m = memoria.find((y) => y.tema === x.tema); return !m || (m.estado !== 'nunca' && !(m.estado === 'pospuesta' && m.hasta && Date.parse(m.hasta) > Date.now())) }
  const visibles = sugs.filter(permitida).sort((a, b) => a.prioridad - b.prioridad)
  const urgentes = visibles.filter((x) => x.prioridad <= 1).length

  async function recordar(x: Sug, estado: Memoria['estado']) {
    const fila = { tema: x.tema, estado, hasta: estado === 'pospuesta' ? manana() : null, actualizado: new Date().toISOString() }
    setMemoria((m) => [...m.filter((y) => y.tema !== x.tema), fila])
    await supabase.from('ayudante_memoria').upsert(fila)
  }

  // ------------------------------------------------ voz y boca
  const hablar = useCallback((texto: string) => {
    setHabla(true); window.setTimeout(() => setHabla(false), Math.min(4000, 600 + texto.length * 25))
    if (!voz || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(texto)
    const v = window.speechSynthesis.getVoices().find((x) => /es[-_]AR/i.test(x.lang)) ?? window.speechSynthesis.getVoices().find((x) => x.lang.startsWith('es'))
    if (v) u.voice = v
    u.lang = v?.lang ?? 'es-AR'; u.rate = 1.03
    window.speechSynthesis.speak(u)
  }, [voz])
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }, [])

  // ------------------------------------------------ bienvenida y avisos urgentes
  useEffect(() => {
    const k = `uv-hola-${perfil!.id}`
    if (!leerLS(k)) { escribirLS(k, '1'); setAbierto(true); hablar(`¡Hola ${perfil!.nombre.split(' ')[0]}! Soy Chichito. Tocame cuando necesites una mano.`) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (abierto || tour || sug) return
    const nueva = visibles.find((x) => x.prioridad === 0 && !mostradas.current.has(x.clave))
    if (nueva) { mostradas.current.add(nueva.clave); setSug(nueva); hablar(nueva.texto) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugs, memoria])

  // ------------------------------------------------ resaltar un elemento y señalarlo
  const resaltar = useCallback((foco?: string) => {
    if (!foco) { setAnillo(null); setAngulo(null); return }
    let intentos = 0
    const buscar = () => {
      const el = [...document.querySelectorAll<HTMLElement>(`[data-ayuda="${foco}"]`)].find((e) => e.offsetParent !== null)
      if (!el) { if (++intentos < 12) window.setTimeout(buscar, 150); else { setAnillo(null); setAngulo(null) } return }
      el.scrollIntoView({ block: 'center', behavior: calmo() ? 'auto' : 'smooth' })
      window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        setAnillo({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 })
        const b = boton.current?.getBoundingClientRect()
        if (b) setAngulo(Math.round(Math.atan2(r.top + r.height / 2 - (b.top + b.height / 2), r.left + r.width / 2 - (b.left + b.width * 0.85)) * 180 / Math.PI))
      }, 350)
    }
    buscar()
  }, [])
  useEffect(() => {
    if (!tour) { resaltar(); return }
    const p = tour.c.pasos[tour.paso]
    if (p.ir && p.ir !== pathname) { navegar(p.ir); return }
    resaltar(p.foco); hablar(`${p.titulo}. ${p.texto}`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, pathname])
  useEffect(() => {
    if (!tour) return
    const r = () => resaltar(tour.c.pasos[tour.paso].foco)
    window.addEventListener('resize', r); return () => window.removeEventListener('resize', r)
  }, [tour, resaltar])

  function empezar(c: Circuito) { setAbierto(false); setSug(null); setTour({ c, paso: 0 }) }
  function paso(d: number) {
    if (!tour) return
    const n = tour.paso + d
    if (n >= tour.c.pasos.length) { setTour(null); setFesteja(true); window.setTimeout(() => setFesteja(false), 1500); hablar('¡Listo!'); return }
    setTour({ ...tour, paso: Math.max(0, n) })
  }
  function irSug(x: Sug) {
    setSug(null); setAbierto(false)
    if (x.circuito) { const c = CIRCUITOS.find((y) => y.id === x.circuito); if (c) { empezar(c); return } }
    if (x.ir) navegar(x.ir)
  }

  async function preguntar(e: FormEvent) {
    e.preventDefault()
    const q = pregunta.trim()
    if (!q || pensando) return
    setPensando(true); setRespuesta(''); setHabla(true)
    const { data, error } = await invocar<{ texto: string }>('ia', { tipo: 'pregunta', pregunta: q, pantalla: pathname })
    setPensando(false); setHabla(false)
    const t = error ? `No pude responder ahora: ${error}` : data?.texto ?? 'No tengo respuesta para eso.'
    setRespuesta(t); if (!error) hablar(t)
  }

  const deRol = CIRCUITOS.filter((c) => c.roles.includes(rol))
  const aqui = deRol.filter((c) => c.area === area), otros = deRol.filter((c) => c.area !== area)
  const p = tour?.c.pasos[tour.paso]
  const alternarVoz = () => { const v = !voz; setVoz(v); escribirLS(VOZ, v ? '1' : '0'); if (!v && 'speechSynthesis' in window) window.speechSynthesis.cancel() }

  let globo = null
  if (tour && p) {
    const n = tour.c.pasos.length
    globo = <div className="ch-globo" role="dialog" aria-label={`Ayuda: ${tour.c.titulo}`}>
      <div className="ch-meta"><span>{tour.c.titulo}</span>{n > 1 && <span>{tour.paso + 1} de {n}</span>}</div>
      {n > 1 && <div className="ch-prog"><i style={{ width: `${((tour.paso + 1) / n) * 100}%` }} /></div>}
      <b>{p.titulo}</b><p>{p.texto}</p>
      <div className="ch-acc"><button className="btn sm ghost" onClick={() => setTour(null)}>Salir</button><span style={{ flex: 1 }} />
        {tour.paso > 0 && <button className="btn sm" onClick={() => paso(-1)}>Atrás</button>}
        <button className="btn sm pri" onClick={() => paso(1)}>{tour.paso < n - 1 ? 'Siguiente' : '¡Listo!'}</button></div>
    </div>
  } else if (sug) {
    const posponible = sug.posponer !== 'nada'
    globo = <div className="ch-globo" role="dialog" aria-label="Sugerencia de Chichito">
      <div className="ch-meta"><span>{sug.titulo}</span><button className="ch-x" onClick={() => setSug(null)} aria-label="Cerrar">✕</button></div>
      <p>{sug.texto}</p>
      <div className="ch-acc">{posponible && <button className="btn sm ghost" onClick={() => { recordar(sug, 'pospuesta'); setSug(null) }}>Más tarde</button>}<span style={{ flex: 1 }} />
        <button className="btn sm pri" onClick={() => irSug(sug)}>{sug.boton}</button></div>
      {posponible && <button className="ch-nunca" onClick={() => { recordar(sug, 'nunca'); setSug(null) }}>No me lo digas más</button>}
    </div>
  } else if (abierto) {
    globo = <div className="ch-globo ch-panel" role="dialog" aria-label="Ayuda">
      <div className="ch-meta"><b style={{ fontSize: 15, color: 'var(--fg)' }}>¡Hola! Soy Chichito.</b>
        <span><button className="ch-x" onClick={alternarVoz} aria-pressed={voz} title={voz ? 'Apagar la voz' : 'Que te hable en voz alta'}>{voz ? '🔊' : '🔈'}</button>
          <button className="ch-x" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button></span></div>
      <form className="ch-preg" onSubmit={preguntar}><input id="ch-q" placeholder="Preguntame lo que quieras" autoComplete="off" value={pregunta} onChange={(e) => setPregunta(e.target.value)} maxLength={600} />
        <button className="btn sm pri" type="submit" disabled={pensando}>Preguntar</button></form>
      {(respuesta || pensando) && <div className="ch-resp">{pensando ? <span className="muted">Pensando…</span> : respuesta.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</div>}
      {visibles.length > 0 && <><div className="ch-sec">{visibles.length === 1 ? 'Tengo una sugerencia' : `Tengo ${visibles.length} sugerencias`}</div>
        {visibles.slice(0, 5).map((x) => <button key={x.clave} className={`ch-item${x.prioridad <= 1 ? ' urg' : ''}`} onClick={() => { setAbierto(false); setSug(x); hablar(x.texto) }}>{x.texto}</button>)}</>}
      {aqui.length > 0 && <><div className="ch-sec">En esta pantalla</div>{aqui.map((c) => <button key={c.id} className="ch-item tour" onClick={() => empezar(c)}>{c.titulo}</button>)}</>}
      {otros.length > 0 && <details className="ch-mas"><summary>Otras ayudas</summary>{otros.map((c) => <button key={c.id} className="ch-item tour" onClick={() => empezar(c)}>{c.titulo}</button>)}</details>}
    </div>
  }

  return <>
    {anillo && tour && <div id="ch-ring" style={anillo} aria-hidden="true" />}
    <div className="ch no-imprimir">
      {globo}
      <button ref={boton} className="ch-boton" onClick={() => { if (tour) return; setSug(null); setAbierto(!abierto); if (!abierto) cargar() }}
        aria-label={urgentes ? `Chichito tiene ${urgentes} aviso${urgentes > 1 ? 's' : ''}` : 'Abrir la ayuda de Chichito'}>
        <Chichito traje={trajeDe(area)} habla={habla} festeja={festeja} angulo={tour ? angulo : null} />
        {visibles.length > 0 && !globo && <span className={`ch-badge${urgentes ? ' urg' : ''}`}>{visibles.length}</span>}
      </button>
    </div>
  </>
}
