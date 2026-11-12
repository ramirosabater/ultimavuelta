// Lo mínimo de Supabase que necesitan las funciones con Deno en la PC:
//   /auth/v1/user → el usuario del JWT de prueba · /rest/v1/* → el PostgREST local
import { createServer, request } from 'node:http'
import { createHmac } from 'node:crypto'
import { SECRETO } from './jwt.mjs'
const PGRST = { host: 'localhost', port: 54330 }
function leerJwt(t) {
  const [a, b, f] = (t || '').split('.')
  if (!f || createHmac('sha256', SECRETO).update(`${a}.${b}`).digest('base64url') !== f) return null
  return JSON.parse(Buffer.from(b, 'base64url').toString())
}
createServer((req, res) => {
  if (req.url.startsWith('/auth/v1/user')) {
    const c = leerJwt((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    res.writeHead(c?.sub ? 200 : 401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(c?.sub ? { id: c.sub, aud: 'authenticated', role: c.role, email: `${c.sub}@prueba.local` } : { msg: 'invalid JWT' })); return
  }
  if (req.url.startsWith('/rest/v1')) {
    const p = request({ ...PGRST, path: req.url.replace(/^\/rest\/v1/, '') || '/', method: req.method, headers: { ...req.headers, host: 'localhost' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    req.pipe(p); return
  }
  res.writeHead(404); res.end()
}).listen(Number(process.env.PORT || 54332), () => console.log('mock supabase listo'))
