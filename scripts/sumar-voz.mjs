// Suma las frases nuevas que vienen en un zip de Colab ya descomprimido: node scripts/sumar-voz.mjs <carpeta>
// Copia los mp3 a web/public/voz y junta los índices (lo nuevo pisa lo viejo si la frase se regrabó).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const dir = process.argv[2]
if (!dir) { console.error('Uso: node scripts/sumar-voz.mjs <carpeta con indice.json y los mp3>'); process.exit(1) }
const nuevo = JSON.parse(readFileSync(`${dir}/indice.json`, 'utf8'))
let actual = {}
try { actual = JSON.parse(readFileSync('web/public/voz/indice.json', 'utf8')) } catch { /* primera vez */ }
for (const [id, archivo] of Object.entries(nuevo)) {
  if (!/^[0-9a-f]{8}\.mp3$/.test(archivo)) throw new Error(`Nombre raro: ${archivo}`)
  copyFileSync(`${dir}/${archivo}`, `web/public/voz/${archivo}`)
  actual[id] = archivo
}
writeFileSync('web/public/voz/indice.json', JSON.stringify(actual))
console.log(`${Object.keys(nuevo).length} frases sumadas · ${Object.keys(actual).length} en total`)
