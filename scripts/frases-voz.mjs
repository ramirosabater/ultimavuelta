// Arma la lista de frases fijas de Chichito para grabarlas con la voz clonada (voz/frases.json).
// Uso: node scripts/frases-voz.mjs
// Sale de: los recorridos (web/src/lib/guias.ts), los avisos de la base que no llevan números, y unas frases sueltas.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'

const claveVoz = (texto) => {
  const t = texto.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

const frases = new Set([
  '¡Hola! Soy Chichito. Tocame cuando necesites una mano.',
  '¡Listo!',
  '¡Ey! Mirá lo que te dejé escrito.',   // FRASE_GENERICA de web/src/lib/voz.ts
])

// Recorridos: se dicen como "título. texto"
const guias = readFileSync('web/src/lib/guias.ts', 'utf8')
for (const m of guias.matchAll(/titulo: '((?:[^'\\]|\\.)*)', texto: '((?:[^'\\]|\\.)*)'/g)) {
  if (!/\bir:/.test(guias.slice(Math.max(0, m.index - 120), m.index))) continue   // solo los pasos, no los títulos de los circuitos
  frases.add(`${m[1].replace(/\\'/g, "'")}. ${m[2].replace(/\\'/g, "'")}`)
}

// Avisos de la base que son siempre iguales (los que llevan números o nombres no se pueden grabar)
for (const f of readdirSync('supabase/migrations').sort()) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
  for (const m of sql.matchAll(/'texto',\s*'((?:[^']|'')*)'/g)) {
    const t = m[1].replace(/''/g, "'")
    if (!t.includes('%') && t.length > 10) frases.add(t)
  }
}

const lista = [...frases].map((texto) => ({ id: claveVoz(texto), texto }))
mkdirSync('voz', { recursive: true })
writeFileSync('voz/frases.json', JSON.stringify(lista, null, 1) + '\n')
console.log(`${lista.length} frases en voz/frases.json`)

// Las que todavía no están grabadas (para grabar solo esas) y las grabadas que ya no se usan
let grabadas = {}
try { grabadas = JSON.parse(readFileSync('web/public/voz/indice.json', 'utf8')) } catch { /* todavía no hay */ }
const nuevas = lista.filter((f) => !grabadas[f.id])
const sobran = Object.keys(grabadas).filter((id) => !lista.some((f) => f.id === id))
writeFileSync('voz/frases-nuevas.json', JSON.stringify(nuevas, null, 1) + '\n')
console.log(`${nuevas.length} sin grabar en voz/frases-nuevas.json${sobran.length ? ` · ${sobran.length} grabadas que ya no se usan: ${sobran.join(', ')}` : ''}`)
