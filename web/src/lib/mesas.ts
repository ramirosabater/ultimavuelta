import type { Mesa, TipoCuenta } from './tipos'

export const TIPOS_CUENTA: { tipo: Exclude<TipoCuenta, 'mesa' | 'aparte'>; nombre: string; corto: string }[] = [
  { tipo: 'llevar', nombre: 'Para llevar', corto: 'Llevar' },
  { tipo: 'delivery', nombre: 'Delivery', corto: 'Delivery' },
  { tipo: 'barra', nombre: 'Barra', corto: 'Barra' },
]

/** "Mesa 4", "Para llevar · Juan", "Delivery · Ana"… (igual que nombre_mesa en la base) */
export function etiquetaMesa(m: Pick<Mesa, 'numero' | 'tipo' | 'nombre'> | undefined | null) {
  if (!m) return 'Mesa'
  switch (m.tipo ?? 'mesa') {
    case 'mesa': return `Mesa ${m.numero}`
    case 'llevar': return `Para llevar · ${m.nombre ?? ''}`
    case 'delivery': return `Delivery · ${m.nombre ?? ''}`
    case 'barra': return `Barra · ${m.nombre ?? ''}`
    default: return m.nombre ?? 'Cuenta aparte'
  }
}

/** Lo que va en el círculo de la tarjeta: el número de la mesa o una abreviatura */
export function chapaMesa(m: Pick<Mesa, 'numero' | 'tipo'>) {
  return m.tipo === 'mesa' ? String(m.numero) : m.tipo === 'llevar' ? 'LL' : m.tipo === 'delivery' ? 'DL' : m.tipo === 'barra' ? 'BA' : '½'
}
