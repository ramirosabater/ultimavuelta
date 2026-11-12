// Formatos y fechas. Todo en hora de Argentina, sin importar la configuración de la compu.
export const ZONA = 'America/Argentina/Buenos_Aires'
export const CORTE_JORNADA = 6

const fmtPlata = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
export const plata = (n: number | null | undefined) => fmtPlata.format(Math.round(Number(n) || 0))
export const num = (n: number | null | undefined) => fmtNum.format(Math.round((Number(n) || 0) * 100) / 100)
export const pct = (x: number | null | undefined, dec = 0) => `${(Math.round((Number(x) || 0) * 100 * 10 ** dec) / 10 ** dec).toLocaleString('es-AR')} %`
export const corto = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`)
export const pad = (n: number) => String(n).padStart(2, '0')

/** Partes de una fecha en hora argentina */
function partes(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return { y: g('year'), m: g('month'), d: g('day'), h: Number(g('hour')) % 24, min: g('minute') }
}
export const hhmm = (iso: string | Date) => { const p = partes(new Date(iso)); return `${pad(p.h)}:${p.min}` }
/** Fecha de hoy en Argentina (AAAA-MM-DD) */
export const hoy = () => { const p = partes(new Date()); return `${p.y}-${p.m}-${p.d}` }
/** La jornada corta a las 6 AM: lo vendido a las 2 AM cuenta para la noche anterior */
export function jornada(d = new Date()) {
  const p = partes(new Date(d.getTime() - CORTE_JORNADA * 3600e3))
  return `${p.y}-${p.m}-${p.d}`
}
export const fechaLocal = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12) }
export const sumarDias = (k: string, n: number) => { const d = fechaLocal(k); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const diasEntre = (a: string, b: string) => Math.round((fechaLocal(b).getTime() - fechaLocal(a).getTime()) / 864e5)
export const fecha = (k: string | null | undefined) => (k ? fechaLocal(k.slice(0, 10)).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }) : '—')
export const fechaCorta = (k: string | null | undefined) => (k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : '—')
export const minutosDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
export const duracion = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)}`)
export const mesTxt = (m: string) => { const [y, mm] = m.split('-').map(Number); const t = new Date(y, mm - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1) }
export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const dow = (k: string) => fechaLocal(k).getDay()

/** Cantidad que hay que comprar para tener `limpio` después de la merma de limpieza */
export const bruto = (limpio: number, merma: number) => limpio / (1 - Math.min(90, Math.max(0, merma || 0)) / 100)

export const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
