import { rpc } from '../lib/datos'
import { hora } from '../lib/reservas'
import type { Mesa, Reserva } from '../lib/tipos'
import { Modal, useAccion } from './ui'

/** El momento de la reserva: las de madrugada (antes de las 6) son del día siguiente */
export function momentoReserva(r: Pick<Reserva, 'fecha' | 'hora'>) {
  const d = new Date(`${r.fecha}T${hora(r.hora)}:00`)
  if (d.getHours() < 6) d.setDate(d.getDate() + 1)
  return d
}
export function Sentar({ r, mesas, onCerrar, onListo }: { r: Reserva; mesas: Mesa[]; onCerrar: () => void; onListo: () => void }) {
  const { correr, ocupado } = useAccion()
  const libres = mesas.filter((m) => m.estado === 'libre').sort((a, b) => Number(b.id === r.mesa_id) - Number(a.id === r.mesa_id))
  return <Modal titulo={`Sentar a ${r.nombre} (${r.personas})`} onCerrar={onCerrar}>
    {!libres.length ? <p>No hay mesas libres ahora.</p> : <>
      <p className="muted" style={{ marginTop: 0 }}>Elegí la mesa: se abre con {r.personas} comensales y la reserva queda sentada.</p>
      <div className="res-mesas">{libres.map((m) => <button key={m.id} disabled={ocupado} onClick={async () => {
        if (await correr(() => rpc('sentar_reserva', { p_reserva: r.id, p_mesa: m.id }), `Mesa ${m.numero} abierta para ${r.nombre}`)) onListo()
      }}>{m.numero}{m.id === r.mesa_id ? <small>la asignada</small> : m.zona ? <small>{m.zona}</small> : null}</button>)}</div>
    </>}
  </Modal>
}

