// La voz de Chichito.
// Si en web/public/voz/ hay frases grabadas (indice.json + los audios), Chichito habla con esa voz.
// Lo que no está grabado (avisos con números, respuestas de la IA) dice una frase corta grabada
// para que mires la pantalla. Si no hay frases grabadas, usa la voz del navegador como antes.

/** Las frases se buscan por esta clave: el texto en minúsculas, sin espacios de más */
export function claveVoz(texto: string) {
  const t = texto.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** Frase grabada que se usa cuando el texto no está grabado */
export const FRASE_GENERICA = '¡Ey! Mirá lo que te dejé escrito.'

let indice: Promise<Record<string, string> | null> | null = null
let sonando: HTMLAudioElement | null = null

function cargarIndice() {
  indice ??= fetch('/voz/indice.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && typeof j === 'object' && Object.keys(j).length ? (j as Record<string, string>) : null))
    .catch(() => null)
  return indice
}

export function callarVoz() {
  if (sonando) { sonando.pause(); sonando = null }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

function navegador(texto: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(texto)
  const voces = window.speechSynthesis.getVoices()
  const v = voces.find((x) => /es[-_]AR/i.test(x.lang)) ?? voces.find((x) => x.lang.startsWith('es'))
  if (v) u.voice = v
  u.lang = v?.lang ?? 'es-AR'; u.rate = 1.03
  window.speechSynthesis.speak(u)
}

/** Dice el texto. `grabada`: otra forma del texto para buscar entre las grabadas (por ejemplo, el saludo sin el nombre). */
export async function decir(texto: string, grabada?: string) {
  callarVoz()
  const idx = await cargarIndice()
  if (!idx) { navegador(texto); return }
  const archivo = idx[claveVoz(grabada ?? texto)] ?? idx[claveVoz(texto)] ?? idx[claveVoz(FRASE_GENERICA)]
  if (!archivo) { navegador(texto); return }
  const a = new Audio(`/voz/${archivo}`)
  sonando = a
  a.play().catch(() => { if (sonando === a) { sonando = null; navegador(texto) } })
}
