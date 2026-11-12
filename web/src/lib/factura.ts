import { invocar } from './supabase'
import type { Factura } from './tipos'

export const TIPO_FACTURA: Record<number, string> = { 11: 'Factura C', 13: 'Nota de crédito C' }
export const COND_IVA: Record<number, string> = {
  5: 'Consumidor final', 6: 'Responsable monotributo', 1: 'IVA responsable inscripto', 4: 'IVA sujeto exento', 13: 'Monotributista social', 16: 'Monotributo trabajador independiente promovido',
}
export const DOC: Record<number, string> = { 80: 'CUIT', 96: 'DNI', 99: '' }

/** 00003-00000012 */
export const numeroFactura = (pv: number, n: number | null) => `${String(pv).padStart(5, '0')}-${String(n ?? 0).padStart(8, '0')}`
export const linkFactura = (codigo: string) => `${window.location.origin}/factura/${codigo}`

export interface Receptor { doc_nro?: string; receptor?: string; cond_iva?: number }
export interface EstadoFacturacion { activa: boolean; facturar_siempre: boolean; tope: number; ambiente: 'homologacion' | 'produccion' }

/** Pide la factura de un ticket a la función "arca" */
export async function facturarTicket(ticket: number, r: Receptor = {}) {
  const { data, error } = await invocar<{ factura: Factura }>('arca', { accion: 'facturar', ticket_id: ticket, ...r })
  if (error) throw new Error(error)
  return data!.factura
}

/** El QR que va impreso en la factura (especificación de ARCA) */
export function linkQr(f: { fecha: string; punto_venta: number; tipo: number; numero: number | null; total: number; doc_tipo: number; doc_nro: number; cae: string | null }, cuit: string) {
  const datos = { ver: 1, fecha: f.fecha, cuit: Number(cuit), ptoVta: f.punto_venta, tipoCmp: f.tipo, nroCmp: f.numero, importe: Math.round(Number(f.total) * 100) / 100,
    moneda: 'PES', ctz: 1, tipoDocRec: f.doc_tipo, nroDocRec: Number(f.doc_nro), tipoCodAut: 'E', codAut: Number(f.cae) }
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(datos))}`
}
