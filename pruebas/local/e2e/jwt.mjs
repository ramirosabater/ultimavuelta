// Firma JWT de prueba (HS256) con el mismo secreto que usa el PostgREST local.
import { createHmac } from 'node:crypto'
export const SECRETO = 'secreto-de-prueba-local-de-al-menos-32-caracteres'
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export function jwt(claims) {
  const cab = b64({ alg: 'HS256', typ: 'JWT' }), cuerpo = b64({ exp: Math.floor(Date.now() / 1000) + 86400 * 30, ...claims })
  return `${cab}.${cuerpo}.${createHmac('sha256', SECRETO).update(`${cab}.${cuerpo}`).digest('base64url')}`
}
export const USUARIOS = {
  admin: '00000000-0000-0000-0000-000000000001', encargado: '00000000-0000-0000-0000-000000000002',
  mozo: '00000000-0000-0000-0000-000000000003', cocina: '00000000-0000-0000-0000-000000000004', barra: '00000000-0000-0000-0000-000000000005',
}
export const ANON = jwt({ role: 'anon' })
export const de = (rol) => jwt({ role: 'authenticated', sub: USUARIOS[rol] })
if (process.argv[2]) console.log(process.argv[2] === 'anon' ? ANON : de(process.argv[2]))
