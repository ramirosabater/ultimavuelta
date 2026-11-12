import { fecha } from './formato'
import type { EstadoReserva, Reserva } from './tipos'

export const ESTADO_RESERVA: Record<EstadoReserva, string> = {
  pendiente: 'Por confirmar', confirmada: 'Confirmada', sentada: 'Sentada', cancelada: 'Cancelada', no_vino: 'No vino',
}
export const TONO_RESERVA = { pendiente: 'warn', confirmada: 'ok', sentada: 'acc', cancelada: '', no_vino: 'crit' } as const

export const linkReservar = () => `${window.location.origin}/reservar`
export const linkReserva = (codigo: string) => `${window.location.origin}/reserva/${codigo}`

/** "21:00:00" → "21:00" */
export const hora = (h: string) => h.slice(0, 5)

/** Para wa.me: celulares de Argentina van con 549 + código de área + número (sin 0 ni 15) */
export function numeroWhatsApp(tel: string) {
  const d = tel.replace(/\D/g, '')
  if (d.startsWith('549')) return d
  if (d.startsWith('54')) return `549${d.slice(2)}`
  return `549${d}`
}
export const linkWhatsApp = (tel: string, texto: string) => `https://wa.me/${numeroWhatsApp(tel)}?text=${encodeURIComponent(texto)}`

/** "297 412 3456" para mostrar */
export function telefonoLindo(tel: string) {
  const d = tel.replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d
}

const primerNombre = (n: string) => n.trim().split(/\s+/)[0]

export function mensajeConfirmacion(r: Pick<Reserva, 'nombre' | 'fecha' | 'hora' | 'personas' | 'codigo'>, local: string) {
  return `¡Hola ${primerNombre(r.nombre)}! Te confirmamos la reserva en ${local} para el ${fecha(r.fecha)} a las ${hora(r.hora)}, ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}. `
    + `Si no pueden venir, avisanos o cancelala acá: ${linkReserva(r.codigo)}. ¡Los esperamos!`
}
export function mensajeCancelacion(r: Pick<Reserva, 'nombre' | 'fecha' | 'hora'>, local: string) {
  return `¡Hola ${primerNombre(r.nombre)}! Te escribimos de ${local} por tu reserva del ${fecha(r.fecha)} a las ${hora(r.hora)}: `
    + 'lamentablemente para ese horario no tenemos lugar. ¿Te sirve otro horario u otro día?'
}
