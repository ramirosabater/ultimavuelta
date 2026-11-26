// Ticket de la venta (comprobante no fiscal): se arma desde la base y se imprime en una ventana aparte,
// con el ancho de una impresora de tickets (80 mm) — también sirve en A4 o para guardar como PDF.
import { rpc } from './datos'
import { plata } from './formato'
import type { Ticket } from './tipos'

interface PagoT { medio: string; monto: number }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface DatosTicket { t: Ticket; pagos: PagoT[]; local: string; bajada: string }
export const datosTicket = (id: number) => rpc<DatosTicket>('ticket_para_imprimir', { p_ticket: id })

export function htmlTicket({ t, pagos, local, bajada }: DatosTicket) {
  const items = new Map<string, { nombre: string; cantidad: number; precio: number }>()
  for (const i of t.ticket_items ?? []) { const k = `${i.nombre}|${i.precio}`; const x = items.get(k); if (x) x.cantidad += i.cantidad; else items.set(k, { ...i }) }
  const h = new Date(t.hora)
  const cuando = `${h.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${h.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  const mesa = t.mesa_nombre ?? (t.mesa_numero ? `Mesa ${t.mesa_numero}` : '')
  const desc = Number(t.descuento_pct) || 0, prop = Number(t.propina) || 0
  const filas = [...items.values()].map((i) => `<tr><td>${i.cantidad}× ${esc(i.nombre)}</td><td class="r">${Number(i.precio) ? plata(i.cantidad * i.precio) : 'invita la casa'}</td></tr>`).join('')
  const medios = pagos.length > 1 ? pagos.map((p) => `<tr><td>${esc(p.medio)}</td><td class="r">${plata(p.monto)}</td></tr>`).join('') : `<tr><td>Pago</td><td class="r">${esc(pagos[0]?.medio ?? t.medio)}</td></tr>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket ${t.id}</title>
<style>
  @page { size: 80mm auto; margin: 4mm }
  body { font: 13px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; background: #fff; margin: 0 auto; padding: 8px; max-width: 72mm }
  h1 { font-size: 17px; text-align: center; margin: 0 }
  .c { text-align: center } .nw { white-space: nowrap } .r { text-align: right; white-space: nowrap } .m { color: #444; font-size: 12px }
  table { width: 100%; border-collapse: collapse } td { padding: 1px 0; vertical-align: top }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
  .tot td { font-size: 16px; font-weight: 700; padding-top: 3px }
  .acc { display: flex; gap: 8px; justify-content: center; margin: 0 0 12px } .acc button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer }
  @media print { .acc { display: none } }
</style></head><body>
<div class="acc"><button onclick="print()">Imprimir</button><button onclick="close()">Cerrar</button></div>
<h1>${esc(local)}</h1>${bajada ? `<div class="c m">${esc(bajada)}</div>` : ''}
<hr><table><tr><td class="nw">N° ${t.id}</td><td class="r">${cuando}</td></tr></table>${mesa ? `<div>${esc(mesa)}${t.comensales ? ` · ${t.comensales} pers.` : ''}</div>` : ''}${t.mozo_nombre ? `<div class="m">Atendió ${esc(t.mozo_nombre)}</div>` : ''}
<hr><table>${filas}</table><hr>
<table>${desc ? `<tr><td>Subtotal</td><td class="r">${plata(t.subtotal)}</td></tr><tr><td>Descuento ${desc} %</td><td class="r">−${plata(Number(t.subtotal) - Number(t.total))}</td></tr>` : ''}
<tr class="tot"><td>TOTAL</td><td class="r">${plata(t.total)}</td></tr>
${prop ? `<tr><td>Propina</td><td class="r">${plata(prop)}</td></tr><tr><td><b>Pagado</b></td><td class="r"><b>${plata(Number(t.total) + prop)}</b></td></tr>` : ''}
${medios}</table>
<hr><div class="c m">Comprobante no válido como factura</div><div class="c">¡Gracias por venir!</div>
</body></html>`
}

/** Abre el ticket en una ventana nueva lista para imprimir. Se llama desde un clic (si no, el navegador bloquea la ventana). */
export async function imprimirTicket(id: number, auto = true) {
  const w = window.open('', '_blank', 'width=420,height=640')
  if (!w) throw new Error('El navegador bloqueó la ventana del ticket. Permití las ventanas emergentes para este sitio.')
  w.document.write('<p style="font:14px system-ui;padding:16px">Armando el ticket…</p>')
  try {
    const html = htmlTicket(await datosTicket(id))
    w.document.open(); w.document.write(html); w.document.close()
    if (auto) w.setTimeout(() => w.print(), 350)
  } catch (e) { w.close(); throw e }
}
