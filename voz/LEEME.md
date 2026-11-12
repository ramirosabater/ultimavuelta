# Voz de Chichito

- `referencia-14s.wav` y `referencia-completa.wav`: los audios de referencia, limpios y emparejados de volumen.
- `frases.json`: las frases fijas de Chichito (se regenera con `node scripts/frases-voz.mjs` si cambian los recorridos o los avisos).
- `chichito-voz.ipynb`: cuaderno para Google Colab que graba las frases con Chatterbox Multilingual (MIT) y baja `voz-chichito.zip`.

El contenido de `voz-chichito.zip` va en `web/public/voz/` (indice.json + los mp3). La app lo usa sola.
Los audios de referencia son la voz de una persona: no subirlos a ningún lado público.
