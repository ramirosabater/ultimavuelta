// Función "ia": lo que la app le pide a Claude (API de Anthropic). La clave queda en el servidor.
//   tipo "factura":  lee una foto o PDF de una factura y devuelve las líneas asociadas a los artículos. Solo gestión.
//   tipo "pregunta": Chichito responde una pregunta con los datos del local que puede ver quien pregunta.
// Secretos: ANTHROPIC_API_KEY. Opcionales: IA_MODELO_FACTURA, IA_MODELO_PREGUNTAS.
import { admin, comoUsuario, cors, env, esGestion, json, quienLlama } from '../_compartido/comun.ts'

const API = () => env('ANTHROPIC_URL', 'https://api.anthropic.com') + '/v1/messages'
const MODELO_FACTURA = () => env('IA_MODELO_FACTURA', 'claude-sonnet-5-5')
const MODELO_PREGUNTAS = () => env('IA_MODELO_PREGUNTAS', 'claude-haiku-5-5')
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_BYTES = 12 * 1024 * 1024

async function claude(modelo: string, system: string, content: unknown[], maxTokens: number): Promise<string> {
  const clave = env('ANTHROPIC_API_KEY')
  if (!clave) throw new Error('Falta configurar la clave de Claude (ANTHROPIC_API_KEY) en Supabase.')
  const r = await fetch(API(), {
    method: 'POST',
    headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  })
  if (!r.ok) {
    const t = await r.text()
    if (r.status === 429) throw new Error('Claude está con mucho trabajo. Probá de nuevo en un minuto.')
    if (r.status === 413) throw new Error('El archivo es demasiado grande.')
    throw new Error(`Claude no pudo responder (${r.status}). ${t.slice(0, 200)}`)
  }
  const d = await r.json() as { content?: { type: string; text?: string }[] }
  return (d.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
}

/** Toma el JSON de la respuesta aunque venga con texto alrededor o en un bloque de código */
function sacarJson(t: string): unknown {
  const bloque = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const s = bloque ? bloque[1] : t
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('No se pudo leer la respuesta.')
  return JSON.parse(s.slice(a, b + 1))
}

// ------------------------------------------------------------------ factura
interface LineaFactura { iid?: number | null; texto?: string; cantidad?: number; total?: number; dudoso?: boolean }

async function leerFactura(b: { archivo?: string; media_type?: string }) {
  const tipo = (b.media_type ?? '').toLowerCase()
  const datos = (b.archivo ?? '').replace(/^data:[^,]+,/, '')
  if (!datos) throw new Error('No llegó el archivo.')
  if (datos.length * 0.75 > MAX_BYTES) throw new Error('El archivo es muy grande (máximo 12 MB). Probá con una foto más chica.')
  const esPdf = tipo === 'application/pdf'
  if (!esPdf && !TIPOS_IMAGEN.includes(tipo)) throw new Error('Mandá una foto (JPG o PNG) o un PDF.')

  const db = admin()
  const { data: insumos } = await db.from('insumos').select('id, nombre, unidad, pack, pack_nombre').eq('activo', true).order('nombre')
  const { data: provs } = await db.from('proveedores').select('id, nombre, cuit').eq('activo', true)
  const lista = (insumos ?? []).map((i) => `${i.id} | ${i.nombre} | unidad: ${i.unidad}${i.pack ? ` | se compra de a ${i.pack} ${i.unidad} (${i.pack_nombre ?? 'pack'})` : ''}`).join('\n')

  const system = 'Leés facturas, remitos y tickets de proveedores de un bar y parrilla en Argentina y devolvés solo JSON válido, sin comentarios.'
  const pedido = `Extraé cada línea de productos del comprobante.

Artículos que maneja el local (id | nombre | unidad de stock):
${lista || '(todavía no hay artículos cargados)'}

Para cada línea:
- iid: el id del artículo que corresponde, o null si no coincide con ninguno.
- texto: la descripción tal como figura.
- cantidad: convertida a la UNIDAD DE STOCK del artículo (3 cajas de 10 kg = 30 si la unidad es kg; 2 botellas de 750 ml = 1500 si es ml; 1 barril de 50 L = 50 si es L). Sin artículo, la cantidad como figura.
- total: importe total de la línea en pesos con IVA incluido si está discriminado, número sin símbolos. Si solo está el precio unitario, multiplicalo.
- dudoso: true si no se lee bien o la conversión no es segura.

Respondé solo con este JSON:
{"proveedor": string|null, "cuit": string|null, "numero": string|null, "fecha": "AAAA-MM-DD"|null, "total_factura": number|null, "items": [{"iid": number|null, "texto": string, "cantidad": number, "total": number, "dudoso": boolean}]}`

  const archivo = esPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: datos } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: datos } }
  const texto = await claude(MODELO_FACTURA(), system, [archivo, { type: 'text', text: pedido }], 4000)
  const r = sacarJson(texto) as { proveedor?: string; cuit?: string; numero?: string; fecha?: string; total_factura?: number; items?: LineaFactura[] }

  const ids = new Set((insumos ?? []).map((i) => i.id))
  const cuit = (r.cuit ?? '').replace(/\D/g, '')
  const nombre = (r.proveedor ?? '').toLowerCase()
  const prov = (provs ?? []).find((p) => cuit && (p.cuit ?? '').replace(/\D/g, '') === cuit)
    ?? (provs ?? []).find((p) => nombre && (nombre.includes(p.nombre.toLowerCase()) || p.nombre.toLowerCase().includes(nombre)))
  return {
    proveedor: r.proveedor ?? null, proveedor_id: prov?.id ?? null, cuit: r.cuit ?? null, numero: r.numero ?? null,
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(r.fecha ?? '') ? r.fecha : null, total_factura: Number(r.total_factura) || null,
    items: (r.items ?? []).slice(0, 80).map((x) => ({
      insumo_id: x.iid != null && ids.has(Number(x.iid)) ? Number(x.iid) : null,
      texto: String(x.texto ?? '').slice(0, 200), cantidad: Number(x.cantidad) || null, total: Number(x.total) || null, dudoso: !!x.dudoso,
    })),
  }
}

// ------------------------------------------------------------------ pregunta
const MAPA = `Secciones de la app (menú de arriba):
- Mesas (/mesas): el salón. Tocar una mesa libre para abrirla, "Agregar pedido" para cargar la comanda, confirmar los pedidos que llegan por QR, "Pidió la cuenta", "Cobrar", pasar a otra mesa.
- Parrilla (/cocina) y Barra (/barra): las comandas de cada estación en tres columnas (pendientes, en preparación, listos). Se marcan con "Empezar" y "Listo".
- Caja (/caja): abrir la caja con el efectivo inicial, gastos pagados con la caja, cobrar mesas y cerrar contando el efectivo.
- Stock: Artículos (/stock/articulos: lo que se compra, compra, merma, contar), Recetas y costos (/stock/recetas), Rendimientos (/stock/rendimientos: pesar crudo y limpio), Compras (/stock/compras: lista de compras calculada y cargar factura con foto o PDF), Control semanal (/stock/control: inventario completo y lo que falta sin explicar), Mermas (/stock/mermas).
- Tableros: Resumen, Ventas y servicio, Costos y desperdicio, Finanzas, con filtros desde/hasta, plato, mozo, día, medio de pago, artículo y proveedor.
- Administración: Proveedores, Gastos (por pagar y pagar), Cuentas (caja, banco, Mercado Pago, transferencias), Usuarios (solo dueños), Configuración.
- Carta y QR: productos, precios, categorías, pausar lo agotado, mesas y QR para imprimir.`

async function responder(req: Request, b: { pregunta?: string; pantalla?: string }) {
  const pregunta = (b.pregunta ?? '').trim().slice(0, 600)
  if (!pregunta) throw new Error('Escribí tu pregunta.')
  const { data: contexto, error } = await comoUsuario(req).rpc('contexto_ayudante')
  if (error) throw new Error('No pude leer los datos del local.')
  const system = `Sos Chichito, el ayudante de la app de gestión de un bar y parrilla. Hablás en español rioplatense, con voseo, cálido y concreto.
Respondé en 2 a 5 oraciones cortas, sin títulos ni listas largas.
Si preguntan cómo hacer algo en la app, decí en qué sección y qué botón tocar, según este mapa:
${MAPA}
Si preguntan por números del local, usá solo los datos de abajo. Si no alcanzan, decilo y sugerí dónde mirarlo en Tableros. No inventes cifras ni funciones que no estén en el mapa.
Si piden algo que el rol de quien pregunta no puede ver, explicá que eso lo ven los dueños o el encargado.

Datos del local ahora:
${contexto ?? ''}`
  const texto = await claude(MODELO_PREGUNTAS(), system, [{ type: 'text', text: `Estoy en la pantalla ${b.pantalla ?? '?'}. ${pregunta}` }], 600)
  return { texto }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const quien = await quienLlama(req)
  if (!quien) return json({ error: 'Entrá con tu usuario.' }, 401)
  const b = await req.json().catch(() => ({})) as { tipo?: string; archivo?: string; media_type?: string; pregunta?: string; pantalla?: string }
  try {
    if (b.tipo === 'factura') {
      if (!esGestion(quien.rol)) return json({ error: 'Solo dueños y encargados cargan facturas.' }, 403)
      return json(await leerFactura(b))
    }
    if (b.tipo === 'pregunta') return json(await responder(req, b))
    return json({ error: 'Pedido desconocido.' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})
