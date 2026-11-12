// Imita la función "ia" de Supabase para probar a Chichito sin gastar API.
import { createServer } from 'node:http'
createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') { res.writeHead(200, cors); res.end('ok'); return }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const p = JSON.parse(b || '{}')
    res.writeHead(200, cors)
    res.end(JSON.stringify(p.tipo === 'pregunta' ? { texto: `(prueba) Me preguntaste: "${p.pregunta}" desde ${p.pantalla}.` } : { error: 'solo preguntas en la prueba' }))
  })
}).listen(Number(process.env.PORT || 54331), () => console.log('mock ia listo'))
