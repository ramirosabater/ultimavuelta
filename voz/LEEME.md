# Voz de Chichito

- `referencia-14s.wav` y `referencia-completa.wav`: los audios de referencia, limpios y emparejados de volumen.
- `frases.json`: las frases fijas de Chichito (se regenera con `node scripts/frases-voz.mjs` si cambian los recorridos o los avisos).
- `chichito-voz.ipynb`: cuaderno para Google Colab que graba las frases con Chatterbox Multilingual (MIT) y baja `voz-chichito.zip`.

El contenido de `voz-chichito.zip` va en `web/public/voz/` (indice.json + los mp3). La app lo usa sola.
Los audios de referencia son la voz de una persona: no subirlos a ningún lado público.

## Cuando cambian o se agregan frases
1. `node scripts/frases-voz.mjs` → deja en `voz/frases-nuevas.json` solo las que faltan grabar.
2. En Colab, con el mismo cuaderno y el mismo audio de referencia, subir `frases-nuevas.json` tal cual (el cuaderno usa el archivo de frases que se acaba de subir y arranca la carpeta de audios vacía). Conviene usar los mismos valores de EXPRESION y CFG.
3. Con el zip que baja: descomprimir y `node scripts/sumar-voz.mjs <carpeta>`. Publicar.
Mientras una frase no está grabada, Chichito dice la frase genérica con la voz grabada.
