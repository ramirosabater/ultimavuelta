import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { rpc, tabla, useConsulta, useEnVivo } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { duracion, hhmm, jornada, minutosDesde, plata } from '../lib/formato'
import type { Llamado, Mesa, Pedido, PedidoItem, Reserva } from '../lib/tipos'
import { chapaMesa, etiquetaMesa } from '../lib/mesas'
import { hora } from '../lib/reservas'
import { Sentar, momentoReserva } from '../components/reservas'
import { AbrirCuenta, AbrirMesa, CargarPedido, Cobrar, CorregirItem, Items, MoverMesa, PasarItems } from '../components/salon'
import { Cabeza, Modal, Pill, useAccion } from '../components/ui'

const ESTADO = { pendiente: 'Pendiente', preparando: 'En preparación', listo: 'Listo', entregado: 'Entregado' } as const
const TONO = { pendiente: 'warn', preparando: 'acc', listo: 'ok', entregado: '' } as const

// El circuito de una mesa, en el orden en que pasa
const CIRCUITO = ['Sentados', 'Pedido en cola', 'Preparando', 'Listo para llevar', 'Comiendo', 'Pidió la cuenta'] as const
/** En qué paso del circuito está la mesa (1 a 6) y qué decir. Si hay varios pedidos, manda lo que pide acción del mozo. */
function etapa(m: Mesa, ps: Pedido[]): { n: number; txt: string; donde?: string } | null {
  if (m.estado === 'libre' && !ps.length) return null
  if (m.estado === 'cuenta') return { n: 6, txt: 'Pidió la cuenta' }
  const conf = ps.filter((p) => p.confirmado)
  const donde = (est: string) => [conf.some((p) => p.est_cocina === est) && 'cocina', conf.some((p) => p.est_barra === est) && 'bebidas'].filter(Boolean).join(' y ')
  if (donde('listo')) return { n: 4, txt: 'Listo para llevar', donde: `retirar de ${donde('listo')}` }
  if (ps.some((p) => !p.confirmado)) return { n: 2, txt: 'Pedido QR por confirmar' }
  if (donde('preparando')) return { n: 3, txt: 'Preparando', donde: `en ${donde('preparando')}` }
  if (donde('pendiente')) return { n: 2, txt: 'Pedido en cola', donde: `esperando en ${donde('pendiente')}` }
  if (conf.length) return { n: 5, txt: 'Comiendo', donde: 'todo entregado' }
  return { n: 1, txt: 'Sentados', donde: 'sin pedido todavía' }
}

type Ventana = null | 'cuenta' | { tipo: 'abrir' | 'pedido' | 'cobrar' | 'mover' | 'separar' | 'juntar'; mesa: Mesa } | { tipo: 'item'; mesa: Mesa; item: PedidoItem; prep: boolean }

export default function Mesas() {
  const { gestion } = useAuth()
  const { datos, recargar, error } = useConsulta(async () => {
    const [mesas, pedidos, llamados, reservas] = await Promise.all([
      tabla<Mesa[]>(supabase.from('mesas').select('*').eq('activa', true).order('numero')),
      tabla<Pedido[]>(supabase.from('pedidos').select('*, pedido_items(*)').is('ticket_id', null).order('creado')),
      tabla<Llamado[]>(supabase.from('llamados').select('*').order('creado')),
      tabla<Reserva[]>(supabase.from('reservas').select('*').eq('fecha', jornada()).in('estado', ['pendiente', 'confirmada']).order('hora')),
    ])
    const nombres = new Map<string, string>()
    if (gestion) for (const p of await tabla<{ id: string; nombre: string }[]>(supabase.from('perfiles').select('id, nombre'))) nombres.set(p.id, p.nombre)
    return { mesas, pedidos, llamados, nombres, reservas }
  })
  useEnVivo(['mesas', 'pedidos', 'pedido_items', 'llamados', 'reservas'], recargar, 15)
  const [sel, setSel] = useState<number | null>(null)
  const [ventana, setVentana] = useState<Ventana>(null)
  const [sentar, setSentar] = useState<Reserva | null>(null)
  const { correr, ocupado } = useAccion()
  const accion = useCallback(async (fn: () => Promise<unknown>, ok: string) => { if (await correr(fn, ok)) recargar() }, [correr, recargar])

  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <p className="cargando">Cargando el salón…</p>
  const { mesas, pedidos, llamados, nombres, reservas } = datos
  // Reservas de esta noche que todavía no llegaron (las muy atrasadas, más de 1 h, no se muestran acá)
  const porLlegar = reservas.filter((r) => momentoReserva(r).getTime() > Date.now() - 60 * 60000)
  const proxima = porLlegar[0]
  // Una mesa asignada a una reserva se ve "reservada" desde 2 horas antes
  const reservaDe = (m: Mesa) => porLlegar.find((r) => r.mesa_id === m.id && momentoReserva(r).getTime() < Date.now() + 120 * 60000)
  const mesaDe = (id: number) => mesas.find((m) => m.id === id)
  const deMesa = (id: number) => pedidos.filter((p) => p.mesa_id === id)
  const totalMesa = (id: number) => deMesa(id).filter((p) => p.confirmado).flatMap((p) => p.pedido_items ?? []).reduce((s, i) => s + i.cantidad * i.precio, 0)
  const qr = pedidos.filter((p) => !p.confirmado)
  const listos = pedidos.filter((p) => p.confirmado && (p.est_cocina === 'listo' || p.est_barra === 'listo'))
  const fijas = mesas.filter((m) => !m.temporal), sueltas = mesas.filter((m) => m.temporal)
  const ocupadas = fijas.filter((m) => m.estado !== 'libre').length
  // Adónde se pueden pasar productos de una mesa: las otras mesas del salón y las cuentas sin mesa abiertas
  const destinos = (m: Mesa) => mesas.filter((x) => x.id !== m.id)
  const mesa = sel ? mesas.find((m) => m.id === sel) ?? null : null
  const listo = () => { setVentana(null); recargar() }

  const juntasDe = (id: number) => mesas.filter((x) => x.junta_con === id)
  const tarjeta = (m: Mesa) => {
    if (m.junta_con) {
      const pr = mesaDe(m.junta_con)
      return <button key={m.id} className={`mesa ocupada junta${sel === m.junta_con ? ' sel' : ''}`} onClick={() => setSel(m.junta_con!)} aria-label={`Mesa ${m.numero}, junta con la ${pr?.numero}`}>
        <span className="n">{chapaMesa(m)}</span>
        <span className="etapa"><b>🔗 Junta con la {pr?.numero}</b><small>todo se carga en la {pr?.numero}</small></span>
      </button>
    }
    const ps = deMesa(m.id), tot = totalMesa(m.id), juntas = juntasDe(m.id)
    const llama = llamados.some((l) => l.mesa_id === m.id)
    const e = etapa(m, ps)
    return <button key={m.id} className={`mesa ${m.estado}${m.temporal ? ' suelta' : ''}${sel === m.id ? ' sel' : ''}${e ? ` etapa-${e.n}` : ''}`} onClick={() => setSel(sel === m.id ? null : m.id)} aria-label={etiquetaMesa(m)}>
      <span className="n">{chapaMesa(m)}</span>
      {juntas.length > 0 && <span className="juntas">+ {juntas.map((x) => x.numero).join(' + ')}</span>}
      {m.temporal && <span className="quien">{m.nombre}</span>}
      {e ? <span className="etapa" title={e.donde}>
          <span className="etapa-bar" aria-hidden="true">{CIRCUITO.map((_, i) => <i key={i} className={i + 1 < e.n ? 'h' : i + 1 === e.n ? 'a' : ''} />)}</span>
          <b>{e.txt}</b>{e.donde && <small>{e.donde}</small>}
        </span>
        : <span className="s">{reservaDe(m) ? 'Reservada' : 'Libre'}</span>}
      {m.estado !== 'libre' && <span className="s">{duracion(minutosDesde(m.abierta!))}</span>}
      {m.estado === 'libre' && reservaDe(m) && <span className="res">{hora(reservaDe(m)!.hora)} · {reservaDe(m)!.nombre} ({reservaDe(m)!.personas})</span>}
      {(m.estado !== 'libre' || ps.length > 0) && <span className="t">{plata(tot)}</span>}
      <span className="badges">{llama && <Pill tono="crit">Llama</Pill>}</span>
    </button>
  }

  return <>
    <Cabeza etiqueta="Salón" titulo="Mesas"><Pill tono="acc">{ocupadas} de {fijas.length} ocupadas</Pill>
      <button className="btn" onClick={() => setVentana('cuenta')} data-ayuda="sin-mesa">Para llevar · delivery · barra</button></Cabeza>

    {(llamados.length > 0 || qr.length > 0 || listos.length > 0) && <div className="alerts" data-ayuda="avisos">
      {llamados.map((l) => <div key={`l${l.mesa_id}`} className="alert call">
        <Pill tono="crit">Llamado</Pill><span className="grow"><b>{etiquetaMesa(mesaDe(l.mesa_id))}</b> llama al mozo · hace {duracion(minutosDesde(l.creado))}</span>
        <button className="btn sm" disabled={ocupado} onClick={() => accion(() => rpc('atender_llamado', { p_mesa: l.mesa_id }), 'Atendido')}>Atendido</button>
      </div>)}
      {qr.map((p) => <div key={`q${p.id}`} className="alert">
        <Pill tono="warn">Pedido QR</Pill>
        <span className="grow"><b>{etiquetaMesa(mesaDe(p.mesa_id))}</b> pidió {(p.pedido_items ?? []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}</span>
        <button className="btn sm ghost danger" disabled={ocupado} onClick={() => accion(() => rpc('anular_pedido', { p_pedido: p.id }), 'Pedido rechazado')}>Rechazar</button>
        <button className="btn sm pri" disabled={ocupado} onClick={() => accion(() => rpc('confirmar_pedido', { p_pedido: p.id }), 'Pedido enviado a preparar')}>Confirmar y enviar</button>
      </div>)}
      {listos.map((p) => <div key={`r${p.id}`} className="alert" style={{ background: 'var(--ok-soft)' }}>
        <Pill tono="ok">Listo</Pill>
        <span className="grow"><b>{etiquetaMesa(mesaDe(p.mesa_id))}</b> · retirar de {[p.est_cocina === 'listo' && 'cocina', p.est_barra === 'listo' && 'bebidas'].filter(Boolean).join(' y ')}</span>
        <button className="btn sm" disabled={ocupado} onClick={() => accion(() => rpc('entregar_pedido', { p_pedido: p.id }), 'Entregado')}>Entregado</button>
      </div>)}
    </div>}

    {porLlegar.length > 0 && <div className="res-hoy" data-ayuda="reservas-hoy">
      <span className="grow"><b>Reservas de hoy:</b> {porLlegar.length} · {porLlegar.reduce((s, r) => s + r.personas, 0)} personas.
        {proxima && <> Próxima: <b>{proxima.nombre}</b> ({proxima.personas}) a las <b className="mono">{hora(proxima.hora)}</b>{proxima.estado === 'pendiente' && ' · sin confirmar'}</>}</span>
      {proxima && <button className="btn sm pri" onClick={() => setSentar(proxima)}>Llegaron: sentar</button>}
      <Link className="btn sm ghost" to="/reservas">Ver todas</Link>
    </div>}

    {!fijas.length && <div className="notice"><b>No hay mesas cargadas.</b><br />Un dueño o el encargado las crea en Carta y QR → Mesas y QR.</div>}

    <div className={`mesas-layout${mesa ? ' has-sel' : ''}`}>
      <div>
        {sueltas.length > 0 && <><div className="label" style={{ margin: '0 0 6px' }}>Sin mesa</div>
          <div className="grid-mesas sueltas" style={{ marginBottom: 14 }}>{sueltas.map((m) => tarjeta(m))}</div></>}
        <div className="grid-mesas" data-ayuda="mesas">{fijas.map((m) => tarjeta(m))}</div>
        <div className="circuito" aria-label="El circuito de la mesa">{CIRCUITO.map((c, i) => <span key={c} className={`etapa-${i + 1}`}><b>{i + 1}</b>{c}</span>)}</div>
      </div>

      {mesa && <aside className="panel side" data-ayuda="panel-mesa">
        <div className="fila"><div className="grow"><div className="label">{mesa.temporal ? ({ llevar: 'Para llevar', delivery: 'Delivery', barra: 'Barra', aparte: 'Cuenta aparte', mesa: 'Mesa' } as const)[mesa.tipo] : 'Mesa'}</div><h2>{mesa.temporal ? mesa.nombre : mesa.numero}{juntasDe(mesa.id).length > 0 && <span className="juntas-h"> + {juntasDe(mesa.id).map((x) => x.numero).join(' + ')}</span>}</h2></div><button className="btn sm ghost" onClick={() => setSel(null)}>Cerrar</button></div>
        {mesa.estado !== 'libre' ? <dl className="kv">
          <dt>Estado</dt><dd>{(() => { const e = etapa(mesa, deMesa(mesa.id)); return e ? <><Pill tono={e.n === 4 ? 'ok' : e.n === 6 ? 'acc' : e.n === 2 || e.n === 3 ? 'warn' : ''}>{e.n} · {e.txt}</Pill>{e.donde && <small className="muted"> {e.donde}</small>}</> : <Pill>Ocupada</Pill> })()}</dd>
          <dt>Abierta</dt><dd className="mono">{hhmm(mesa.abierta!)} · {duracion(minutosDesde(mesa.abierta!))}</dd>
          {mesa.telefono ? <><dt>Teléfono</dt><dd><a href={`https://wa.me/549${mesa.telefono.replace(/^0/, '')}`} target="_blank" rel="noreferrer">{mesa.telefono}</a></dd></> : null}
          {mesa.direccion ? <><dt>Dirección</dt><dd>{mesa.direccion}</dd></> : null}
          {mesa.comensales ? <><dt>Comensales</dt><dd className="mono">{mesa.comensales}</dd></> : null}
          {mesa.mozo_id && nombres.get(mesa.mozo_id) ? <><dt>Mozo</dt><dd>{nombres.get(mesa.mozo_id)}</dd></> : null}
        </dl> : <p className="muted" style={{ margin: '8px 0 12px' }}>Mesa libre.</p>}
        {juntasDe(mesa.id).length > 0 && <div className="juntas-panel"><span className="grow">🔗 Juntas con esta: {juntasDe(mesa.id).map((x) => <button key={x.id} className="chip" title={`Separar la mesa ${x.numero}`} disabled={ocupado} onClick={() => accion(() => rpc('separar_mesa', { p_mesa: x.id }), `Mesa ${x.numero} separada`)}>Mesa {x.numero} ✕</button>)}</span>
          <small className="muted">Tocá una para separarla. Al cobrar, se liberan todas.</small></div>}

        {deMesa(mesa.id).map((p) => <div key={p.id} className="comanda">
          <div className="comanda-h">
            <span className="mono muted">{hhmm(p.creado)}</span>
            {p.origen === 'qr' && <Pill>QR</Pill>}
            {!p.confirmado ? <Pill tono="warn">Sin confirmar</Pill> : <>
              {p.est_cocina && <Pill tono={TONO[p.est_cocina]}>Cocina: {ESTADO[p.est_cocina]}</Pill>}
              {p.est_barra && <Pill tono={TONO[p.est_barra]}>Bebidas: {ESTADO[p.est_barra]}</Pill>}
            </>}
          </div>
          <Items items={p.pedido_items ?? []} onItem={p.confirmado ? (i) => setVentana({ tipo: 'item', mesa, item: i as PedidoItem, prep: ((i as PedidoItem).estacion === 'cocina' ? p.est_cocina : p.est_barra) !== 'pendiente' }) : undefined} />
          <div className="fila">
            {!p.confirmado && <button className="btn sm pri" disabled={ocupado} onClick={() => accion(() => rpc('confirmar_pedido', { p_pedido: p.id }), 'Pedido enviado a preparar')}>Confirmar</button>}
            {p.confirmado && (p.est_cocina === 'listo' || p.est_barra === 'listo') && <button className="btn sm" disabled={ocupado} onClick={() => accion(() => rpc('entregar_pedido', { p_pedido: p.id }), 'Entregado')}>Marcar entregado</button>}
            {(!p.confirmado || gestion || ((p.est_cocina ?? 'pendiente') === 'pendiente' && (p.est_barra ?? 'pendiente') === 'pendiente')) &&
              <button className="btn sm ghost danger" disabled={ocupado} onClick={() => accion(() => rpc('anular_pedido', { p_pedido: p.id }), p.confirmado ? 'Pedido anulado' : 'Pedido rechazado')}>{p.confirmado ? 'Anular' : 'Rechazar'}</button>}
          </div>
        </div>)}
        {deMesa(mesa.id).length > 0 && <div className="total-row"><span className="label">Total mesa</span><span className="num">{plata(totalMesa(mesa.id))}</span></div>}

        <div className="actions">
          {mesa.estado === 'libre' ? <><button className="btn pri" onClick={() => setVentana({ tipo: 'abrir', mesa })}>Abrir mesa</button>
            <button className="btn" data-ayuda="juntar" onClick={() => setVentana({ tipo: 'juntar', mesa })}>Juntar con otras mesas</button></> : <>
            <button className="btn pri" onClick={() => setVentana({ tipo: 'pedido', mesa })}>Agregar pedido</button>
            {mesa.estado !== 'cuenta' && <button className="btn" disabled={ocupado} onClick={() => accion(() => rpc('pedir_cuenta', { p_mesa: mesa.id }), `${etiquetaMesa(mesa)} pidió la cuenta`)}>Pidió la cuenta</button>}
            {deMesa(mesa.id).some((p) => p.confirmado) && <button className="btn" onClick={() => setVentana({ tipo: 'cobrar', mesa })}>Cobrar</button>}
            {deMesa(mesa.id).some((p) => p.confirmado) && <button className="btn ghost" onClick={() => setVentana({ tipo: 'separar', mesa })} data-ayuda="separar">Separar o pasar productos</button>}
            {!mesa.temporal && <button className="btn ghost" data-ayuda="juntar" onClick={() => setVentana({ tipo: 'juntar', mesa })}>Juntar con otras mesas</button>}
            {!mesa.temporal && <button className="btn ghost" onClick={() => setVentana({ tipo: 'mover', mesa })}>Pasar a otra mesa</button>}
            {!deMesa(mesa.id).some((p) => p.confirmado) && <button className="btn ghost danger" disabled={ocupado} onClick={async () => { await accion(() => rpc('liberar_mesa', { p_mesa: mesa.id }), 'Mesa liberada'); setSel(null) }}>Liberar mesa</button>}
          </>}
        </div>
      </aside>}
    </div>

    {ventana === 'cuenta' && <AbrirCuenta onCerrar={() => setVentana(null)} onListo={(m) => { recargar(); setSel(m.id); setVentana({ tipo: 'pedido', mesa: m }) }} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'item' && <CorregirItem item={ventana.item} enPreparacion={ventana.prep} mesa={ventana.mesa} destinos={destinos(ventana.mesa)} gestion={gestion}
      onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'separar' && <PasarItems mesa={ventana.mesa} destinos={destinos(ventana.mesa)}
      items={deMesa(ventana.mesa.id).filter((p) => p.confirmado).flatMap((p) => p.pedido_items ?? [])} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'abrir' && <AbrirMesa mesa={ventana.mesa} onCerrar={() => setVentana(null)} onListo={() => { recargar(); setVentana({ tipo: 'pedido', mesa: ventana.mesa }) }} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'pedido' && <CargarPedido mesa={ventana.mesa} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'cobrar' && <Cobrar mesa={ventana.mesa} items={deMesa(ventana.mesa.id).filter((p) => p.confirmado).flatMap((p) => p.pedido_items ?? [])}
      onCerrar={() => setVentana(null)} onListo={() => { setSel(null); listo() }} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'juntar' && <JuntarMesas mesa={ventana.mesa} mesas={fijas} onCerrar={() => setVentana(null)} onListo={() => { setSel(ventana.mesa.id); listo() }} />}
    {sentar && <Sentar r={sentar} mesas={fijas} onCerrar={() => setSentar(null)} onListo={() => { setSentar(null); recargar() }} />}
    {ventana && typeof ventana === 'object' && ventana.tipo === 'mover' && <MoverMesa mesa={ventana.mesa} mesas={mesas} onCerrar={() => setVentana(null)} onListo={() => { setSel(null); listo() }} />}
  </>
}

/** Juntar mesas para un grupo grande: todo se carga y se cobra en la principal */
function JuntarMesas({ mesa, mesas, onCerrar, onListo }: { mesa: Mesa; mesas: Mesa[]; onCerrar: () => void; onListo: () => void }) {
  const ya = mesas.filter((m) => m.junta_con === mesa.id).map((m) => m.id)
  const candidatas = mesas.filter((m) => m.id !== mesa.id && m.activa && !mesas.some((x) => x.junta_con === m.id) && (m.junta_con == null || m.junta_con === mesa.id))
  const [elegidas, setElegidas] = useState<number[]>([])
  const { correr, ocupado } = useAccion()
  const nums = elegidas.map((id) => mesas.find((m) => m.id === id)?.numero).sort((a, b) => (a ?? 0) - (b ?? 0))
  const conCosas = elegidas.filter((id) => mesas.find((m) => m.id === id)?.estado !== 'libre').length
  return <Modal titulo={`Juntar con la mesa ${mesa.numero}`} onCerrar={onCerrar}
    pie={<><span className="grow muted" style={{ fontSize: 13 }}>{elegidas.length ? `Mesa ${mesa.numero} + ${nums.join(' + ')}` : 'Elegí las mesas'}</span>
      <button className="btn pri" id="jm-ok" disabled={ocupado || !elegidas.length} onClick={async () => {
        if (await correr(() => rpc('juntar_mesas', { p_principal: mesa.id, p_otras: elegidas }), `Mesas juntas: ${mesa.numero} + ${nums.join(' + ')}`)) onListo()
      }}>Juntar</button></>}>
    <p style={{ margin: 0 }}>Para un grupo grande. Todo se carga y se cobra en la <b>mesa {mesa.numero}</b>{mesa.estado === 'libre' ? ', que queda abierta' : ''}. El QR de cualquiera de las mesas pide en la {mesa.numero}. Al cobrar, se liberan todas.</p>
    {candidatas.length ? <div className="opts" id="jm-mesas">{candidatas.map((m) => {
      const ok = elegidas.includes(m.id) || ya.includes(m.id)
      return <button key={m.id} className="opt" aria-pressed={ok} disabled={ya.includes(m.id)} onClick={() => setElegidas(ok ? elegidas.filter((x) => x !== m.id) : [...elegidas, m.id])}>
        Mesa {m.numero}{ya.includes(m.id) ? ' · ya junta' : m.estado !== 'libre' ? ' · ocupada' : ''}</button>
    })}</div> : <div className="kempty">No hay otras mesas para juntar.</div>}
    {conCosas > 0 && <div className="notice" style={{ fontSize: 13 }}>Lo que ya está cargado en {conCosas === 1 ? 'la mesa ocupada' : 'las mesas ocupadas'} pasa a la mesa {mesa.numero}.</div>}
  </Modal>
}
