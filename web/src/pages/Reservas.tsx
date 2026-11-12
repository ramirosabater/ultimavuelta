import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../auth/AuthProvider'
import { leerParametros, tabla, useConsulta, useEnVivo } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { DIAS, dow, fecha, jornada, sumarDias } from '../lib/formato'
import type { Mesa, Reserva } from '../lib/tipos'
import {
  ESTADO_RESERVA, TONO_RESERVA, hora, linkReserva, linkReservar, linkWhatsApp, mensajeCancelacion, mensajeConfirmacion, telefonoLindo,
} from '../lib/reservas'
import { Cabeza, Modal, Pill, Vacio, useAccion, useToast } from '../components/ui'
import { Sentar, momentoReserva } from '../components/reservas'

const activa = (r: Reserva) => r.estado === 'pendiente' || r.estado === 'confirmada'
const ORIGEN = { web: 'Página', telefono: 'Teléfono', local: 'En el local' } as const

export default function Reservas() {
  const { gestion, perfil } = useAuth()
  const hoy = jornada()
  const [dia, setDia] = useState(hoy)
  const { datos, recargar, error } = useConsulta(async () => {
    const [delDia, pendientes, proximas, mesas, p] = await Promise.all([
      tabla<Reserva[]>(supabase.from('reservas').select('*').eq('fecha', dia).order('hora').order('creado')),
      tabla<Reserva[]>(supabase.from('reservas').select('*').eq('estado', 'pendiente').gte('fecha', hoy).order('fecha').order('hora')),
      tabla<Pick<Reserva, 'fecha' | 'personas'>[]>(supabase.from('reservas').select('fecha, personas').in('estado', ['pendiente', 'confirmada']).gte('fecha', hoy).lte('fecha', sumarDias(hoy, 20))),
      tabla<Mesa[]>(supabase.from('mesas').select('*').eq('activa', true).eq('temporal', false).order('numero')),
      leerParametros(),
    ])
    return { delDia, pendientes, proximas, mesas, p }
  }, [dia])
  useEnVivo(['reservas', 'mesas'], recargar, 30)
  const [form, setForm] = useState<Partial<Reserva> | null>(null)
  const [sentar, setSentar] = useState<Reserva | null>(null)
  const [verQR, setVerQR] = useState(false)
  const { correr, ocupado } = useAccion()
  const avisar = useToast()

  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <p className="cargando">Cargando reservas…</p>
  const { delDia, pendientes, proximas, mesas, p } = datos
  const local = p.nombre_local || 'el bar'
  const cupo = Number(p.reservas_cupo) || 30
  const horarios = (p.reservas_horarios ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const cerrados = (p.dias_cerrado ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number)
  const dias = Array.from({ length: 14 }, (_, i) => sumarDias(hoy, i))
  const porDia = (d: string) => proximas.filter((r) => r.fecha === d)
  const mesaNum = (id: number | null) => mesas.find((m) => m.id === id)?.numero

  const cambiar = (r: Reserva, cambios: Partial<Reserva>, ok: string) => correr(async () => {
    const { error: e } = await supabase.from('reservas').update({ ...cambios, atendido: new Date().toISOString() }).eq('id', r.id)
    if (e) throw new Error(e.message)
    recargar()
  }, ok)
  const copiar = async (t: string, ok: string) => { try { await navigator.clipboard.writeText(t); avisar(ok) } catch { window.prompt('Copiá el link:', t) } }

  const vivas = delDia.filter((r) => r.estado !== 'cancelada' && r.estado !== 'no_vino')
  const caidas = delDia.filter((r) => r.estado === 'cancelada' || r.estado === 'no_vino')
  const orden = (h: string) => (Number(h.slice(0, 2)) < 6 ? 24 * 60 : 0) + Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  const turnos = [...new Set(vivas.map((r) => hora(r.hora)))].sort((a, b) => orden(a) - orden(b))

  const Fila = ({ r, conFecha = false }: { r: Reserva; conFecha?: boolean }) => {
    const paso = momentoReserva(r).getTime() < Date.now() - 15 * 60000
    return <div className={`res-fila ${r.estado}`}>
      <span className="pers" title="Personas">{r.personas}</span>
      <div className="grow">
        <b>{r.nombre}</b> {conFecha && <span className="mono">· {fecha(r.fecha)} {hora(r.hora)}</span>}
        <div className="fila" style={{ gap: 6, marginTop: 2 }}>
          <Pill tono={TONO_RESERVA[r.estado]}>{ESTADO_RESERVA[r.estado]}{r.estado === 'cancelada' && r.cancelada_por === 'cliente' ? ' por el cliente' : ''}</Pill>
          <Pill>{ORIGEN[r.origen]}</Pill>
          {r.mesa_id && <Pill tono="acc">Mesa {mesaNum(r.mesa_id) ?? '?'}</Pill>}
          {gestion && <a className="mono" style={{ fontSize: 13 }} href={`tel:+54${r.telefono}`}>{telefonoLindo(r.telefono)}</a>}
        </div>
        {r.nota && <div className="nota">“{r.nota}”</div>}
      </div>
      <div className="fila" style={{ gap: 6 }}>
        {r.estado === 'pendiente' && gestion && <>
          <a className="btn sm pri" href={linkWhatsApp(r.telefono, mensajeConfirmacion(r, local))} target="_blank" rel="noreferrer"
            onClick={() => cambiar(r, { estado: 'confirmada' }, 'Reserva confirmada')}>Confirmar por WhatsApp</a>
          <button className="btn sm" disabled={ocupado} onClick={() => cambiar(r, { estado: 'confirmada' }, 'Reserva confirmada')}>Solo confirmar</button>
          <a className="btn sm ghost danger" href={linkWhatsApp(r.telefono, mensajeCancelacion(r, local))} target="_blank" rel="noreferrer"
            onClick={() => cambiar(r, { estado: 'cancelada', cancelada_por: 'local' }, 'Reserva rechazada')}>No hay lugar</a>
        </>}
        {activa(r) && r.fecha <= hoy && <button className="btn sm pri" onClick={() => setSentar(r)}>Llegaron: sentar</button>}
        {gestion && <details className="mas">
          <summary className="btn sm ghost" aria-label={`Más opciones de ${r.nombre}`}>⋯</summary>
          <div className="mas-menu" onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false }}>
            <a href={linkWhatsApp(r.telefono, `¡Hola ${r.nombre.split(' ')[0]}! Te escribimos de ${local} por tu reserva del ${fecha(r.fecha)} a las ${hora(r.hora)}.`)} target="_blank" rel="noreferrer">Escribir por WhatsApp</a>
            <button onClick={() => copiar(linkReserva(r.codigo), 'Link de la reserva copiado')}>Copiar link para el cliente</button>
            {activa(r) && <button onClick={() => setForm(r)}>Editar</button>}
            {activa(r) && paso && <button onClick={() => cambiar(r, { estado: 'no_vino' }, 'Marcada: no vino')}>No vino</button>}
            {activa(r) && <button className="danger" onClick={() => { if (window.confirm(`¿Cancelar la reserva de ${r.nombre}?`)) cambiar(r, { estado: 'cancelada', cancelada_por: 'local' }, 'Reserva cancelada') }}>Cancelar reserva</button>}
            {!activa(r) && r.estado !== 'sentada' && <button onClick={() => cambiar(r, { estado: 'confirmada', cancelada_por: null }, 'Reserva reactivada')}>Volver a activar</button>}
          </div>
        </details>}
      </div>
    </div>
  }

  const personasDia = vivas.reduce((s, r) => s + r.personas, 0)
  return <>
    <Cabeza etiqueta="Salón" titulo="Reservas">
      {gestion && <button className="btn" onClick={() => setVerQR(true)} data-ayuda="link-reservas">Link y QR para clientes</button>}
      {gestion && <button className="btn pri" onClick={() => setForm({ fecha: dia, personas: 2, origen: 'telefono' })} data-ayuda="nueva-reserva">Nueva reserva</button>}
    </Cabeza>

    {gestion && p.reservas_activas === 'no' && <div className="aviso warn" style={{ marginBottom: 12 }}>La página de reservas está apagada: los clientes no pueden reservar solos. Se prende en Administración → Configuración.</div>}

    {gestion && pendientes.length > 0 && <section className="panel" style={{ marginBottom: 16 }} data-ayuda="por-confirmar">
      <h3 style={{ marginBottom: 8 }}>Por confirmar <Pill tono="warn">{pendientes.length}</Pill></h3>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>Entraron por la página. Al confirmar se abre WhatsApp con el mensaje listo para mandar.</p>
      {pendientes.map((r) => <Fila key={r.id} r={r} conFecha />)}
    </section>}

    <div className="res-dia-sel" data-ayuda="dias-reserva">{dias.map((d, i) => { const n = porDia(d).length; return <button key={d} className="chip" aria-pressed={dia === d} onClick={() => setDia(d)}
      style={cerrados.includes(dow(d)) && !n ? { opacity: 0.5 } : undefined}>
      {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${DIAS[dow(d)]} ${Number(d.slice(8))}`}{n > 0 && <span className="n">{n}</span>}</button> })}
      <input type="date" aria-label="Otra fecha" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} style={{ width: 'auto' }} />
    </div>

    <div className="fila" style={{ marginBottom: 12 }}>
      <h3 className="grow" style={{ margin: 0 }}>{fecha(dia)}</h3>
      <span className="muted">{vivas.length ? `${vivas.length} reserva${vivas.length > 1 ? 's' : ''} · ${personasDia} personas` : ''}</span>
    </div>

    {!vivas.length ? <Vacio>No hay reservas para este día.{gestion && ' Las que entren por la página o cargues a mano aparecen acá.'}</Vacio>
      : turnos.map((h) => { const rs = vivas.filter((r) => hora(r.hora) === h); const ocup = rs.reduce((s, r) => s + r.personas, 0)
        return <section key={h} className="res-turno">
          <div className="res-turno-h"><b>{h}</b>{horarios.includes(h) && <span className={`res-cupo ${ocup >= cupo ? 'lleno' : ''}`} title={`${ocup} de ${cupo} lugares`}><i style={{ width: `${Math.min(100, (ocup / cupo) * 100)}%` }} /></span>}
            <span className="muted" style={{ fontSize: 13 }}>{ocup} {horarios.includes(h) ? `de ${cupo}` : ''} personas</span></div>
          {rs.map((r) => <Fila key={r.id} r={r} />)}
        </section> })}

    {caidas.length > 0 && <details style={{ marginTop: 10 }}><summary className="muted">Canceladas y no vinieron ({caidas.length})</summary>
      <div style={{ marginTop: 8 }}>{caidas.map((r) => <Fila key={r.id} r={r} />)}</div></details>}

    {form && <ReservaForm inicial={form} horarios={horarios} mesas={mesas} usuario={perfil!.id} onCerrar={() => setForm(null)} onListo={(d) => { setForm(null); if (d) setDia(d); recargar() }} />}
    {sentar && <Sentar r={sentar} mesas={mesas} onCerrar={() => setSentar(null)} onListo={() => { setSentar(null); recargar() }} />}
    {verQR && <LinkReservas onCerrar={() => setVerQR(false)} copiar={copiar} />}
  </>
}

function ReservaForm({ inicial, horarios, mesas, usuario, onCerrar, onListo }: {
  inicial: Partial<Reserva>; horarios: string[]; mesas: Mesa[]; usuario: string; onCerrar: () => void; onListo: (dia?: string) => void
}) {
  const [r, setR] = useState({
    nombre: inicial.nombre ?? '', telefono: inicial.telefono ?? '', personas: String(inicial.personas ?? 2), fecha: inicial.fecha ?? jornada(),
    hora: inicial.hora ? hora(inicial.hora) : '', nota: inicial.nota ?? '', mesa_id: inicial.mesa_id ? String(inicial.mesa_id) : '', origen: inicial.origen ?? 'telefono',
  })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof r, v: string) => setR({ ...r, [k]: v })
  async function guardar() {
    const tel = r.telefono.replace(/\D/g, '').replace(/^0/, '')
    if (r.nombre.trim().length < 2) return setErr('Poné el nombre.')
    if (tel.length < 8 || tel.length > 15) return setErr('Revisá el teléfono: con código de área, sin el 0 ni el 15.')
    if (!(Number(r.personas) >= 1)) return setErr('¿Cuántas personas?')
    if (!/^\d{1,2}:\d{2}$/.test(r.hora)) return setErr('Elegí la hora.')
    setErr('')
    const fila = { nombre: r.nombre.trim(), telefono: tel, personas: Number(r.personas), fecha: r.fecha, hora: r.hora, nota: r.nota.trim() || null, mesa_id: r.mesa_id ? Number(r.mesa_id) : null }
    if (await correr(async () => {
      const { error } = inicial.id
        ? await supabase.from('reservas').update(fila).eq('id', inicial.id)
        : await supabase.from('reservas').insert({ ...fila, origen: r.origen, estado: 'confirmada', creado_por: usuario, atendido: new Date().toISOString() })
      if (error) throw new Error(error.message)
    }, inicial.id ? 'Reserva actualizada' : 'Reserva cargada')) onListo(r.fecha)
  }
  return <Modal titulo={inicial.id ? `Reserva de ${inicial.nombre}` : 'Nueva reserva'} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>{inicial.id ? 'Guardar' : 'Cargar reserva'}</button></>}>
    <div className="stack">
      {!inicial.id && <div className="chips">{(['telefono', 'local'] as const).map((o) => <button key={o} type="button" className="chip" aria-pressed={r.origen === o} onClick={() => set('origen', o)}>{o === 'telefono' ? 'Por teléfono o WhatsApp' : 'En el local'}</button>)}</div>}
      <label className="campo">Nombre<input id="rf-nombre" value={r.nombre} maxLength={60} onChange={(e) => set('nombre', e.target.value)} autoFocus /></label>
      <label className="campo">Celular<input id="rf-tel" type="tel" inputMode="tel" placeholder="297 412 3456" value={r.telefono} onChange={(e) => set('telefono', e.target.value)} /><small>Con código de área, sin el 0 ni el 15: así se le puede escribir por WhatsApp.</small></label>
      <div className="fila" style={{ alignItems: 'flex-end' }}>
        <label className="campo" style={{ width: 90 }}>Personas<input id="rf-personas" type="number" min={1} max={60} inputMode="numeric" value={r.personas} onChange={(e) => set('personas', e.target.value)} /></label>
        <label className="campo grow">Día<input id="rf-fecha" type="date" value={r.fecha} onChange={(e) => set('fecha', e.target.value)} /></label>
        <label className="campo" style={{ width: 110 }}>Hora<input id="rf-hora" type="time" value={r.hora} onChange={(e) => set('hora', e.target.value)} /></label>
      </div>
      {horarios.length > 0 && <div className="chips">{horarios.map((h) => <button key={h} type="button" className="chip" aria-pressed={r.hora === h} onClick={() => set('hora', h)}>{h}</button>)}</div>}
      <label className="campo">Mesa (opcional)<select id="rf-mesa" value={r.mesa_id} onChange={(e) => set('mesa_id', e.target.value)}>
        <option value="">Sin asignar</option>{mesas.map((m) => <option key={m.id} value={m.id}>Mesa {m.numero}{m.zona ? ` · ${m.zona}` : ''}</option>)}</select>
        <small>Si la asignás, en Mesas se ve como reservada un rato antes.</small></label>
      <label className="campo">Aclaración<input id="rf-nota" maxLength={200} value={r.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Cumpleaños, afuera, silla para bebé…" /></label>
      {err && <div className="aviso bad" role="alert">{err}</div>}
    </div>
  </Modal>
}

function LinkReservas({ onCerrar, copiar }: { onCerrar: () => void; copiar: (t: string, ok: string) => void }) {
  const link = linkReservar()
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')) }, [link])
  const texto = useMemo(() => `Reservá tu mesa acá 👉 ${link}`, [link])
  return <Modal titulo="Link y QR para reservar" onCerrar={onCerrar}>
    <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <p className="muted" style={{ margin: 0 }}>Ponelo en la bio de Instagram, en el estado de WhatsApp o imprimí el QR para la puerta.</p>
      {src && <img src={src} width={220} height={220} alt="QR para reservar" style={{ background: '#fff', padding: 8, borderRadius: 8 }} />}
      <code style={{ wordBreak: 'break-all' }}>{link}</code>
      <div className="fila" style={{ justifyContent: 'center' }}>
        <button className="btn pri" onClick={() => copiar(texto, 'Link copiado')}>Copiar link</button>
        <a className="btn" href={link} target="_blank" rel="noreferrer">Ver la página</a>
        {src && <a className="btn ghost" href={src} download="qr-reservas.png">Bajar el QR</a>}
      </div>
    </div>
  </Modal>
}
