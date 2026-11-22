// Funciones de Supabase en la PC: "ia" imitada (para probar a Chichito sin gastar API) y
// "arca" reenviada a la función real corriendo con Deno (ARCA_FN, por defecto :54334) contra el ARCA simulado.
import { createServer, request } from 'node:http'
const ARCA_FN = new URL(process.env.ARCA_FN || 'http://localhost:54334')
createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') { res.writeHead(200, cors); res.end('ok'); return }
  if (req.url.startsWith('/arca')) {
    const p = request({ host: ARCA_FN.hostname, port: ARCA_FN.port, path: '/', method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res) })
    p.on('error', () => { res.writeHead(502, cors); res.end(JSON.stringify({ error: 'La función arca no está corriendo' })) })
    req.pipe(p); return
  }
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const p = JSON.parse(b || '{}')
    res.writeHead(200, cors)
    if (p.tipo === 'receta') {   // una receta fija: un artículo nuevo y dos que ya existen (por nombre)
      res.end(JSON.stringify({ porcion: `1 plato de ${p.nombre}`, items: [
        { insumo_id: null, nombre: 'Bondiola de cerdo', unidad: 'kg', cantidad: 0.25, costo: 9000, merma_pct: 5 },
        { insumo_id: null, nombre: 'Papas', unidad: 'kg', cantidad: 0.3, costo: 900, merma_pct: 20 },
        { insumo_id: null, nombre: 'Aceite', unidad: 'L', cantidad: 0.02, costo: 3200, merma_pct: 0 }] }))
      return
    }
    res.end(JSON.stringify(p.tipo === 'pregunta' ? { texto: `(prueba) Me preguntaste: "${p.pregunta}" desde ${p.pantalla}.` } : { error: 'solo preguntas en la prueba' }))
  })
}).listen(Number(process.env.PORT || 54331), () => console.log('mock funciones listo'))
