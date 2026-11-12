// Función "usuarios": un dueño invita a alguien al sistema (le llega un mail para elegir su contraseña).
// Crear usuarios necesita la clave de servicio, por eso se hace acá y no desde el navegador.
// Rol, nombre y alta/baja de un usuario existente se cambian directo desde la app (lo permiten los permisos de admin).
import { admin, cors, env, json, quienLlama } from '../_compartido/comun.ts'

interface Pedido { email?: string; nombre?: string; rol?: string }
const ROLES = ['admin', 'encargado', 'mozo', 'cocina', 'barra']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const quien = await quienLlama(req)
  if (!quien || quien.rol !== 'admin') return json({ error: 'Solo un dueño puede invitar usuarios.' }, 403)

  const p = await req.json().catch(() => ({})) as Pedido
  const email = (p.email ?? '').trim().toLowerCase()
  const nombre = (p.nombre ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'El mail no es válido.' }, 400)
  if (!nombre) return json({ error: 'Falta el nombre.' }, 400)
  if (!ROLES.includes(p.rol ?? '')) return json({ error: 'Rol desconocido.' }, 400)

  const db = admin()
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: env('APP_URL', 'https://ultimavuelta.netlify.app') + '/elegir-clave',
    data: { nombre },
  })
  if (error || !data.user) {
    const yaExiste = /already|registered|exists/i.test(error?.message ?? '')
    return json({ error: yaExiste ? 'Ya existe un usuario con ese mail.' : `No se pudo invitar: ${error?.message}` }, 400)
  }
  const { error: e1 } = await db.from('perfiles').upsert({ id: data.user.id, nombre, email, rol: p.rol, activo: true })
  if (e1) return json({ error: `Se invitó pero no se pudo crear el perfil: ${e1.message}` }, 500)
  return json({ id: data.user.id, email, mensaje: `Le mandamos a ${email} un mail para que elija su contraseña.` })
})
