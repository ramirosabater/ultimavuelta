// Versión en un solo archivo para pegar en Supabase → Edge Functions → Deploy a new function → Via Editor (nombre: usuarios).
// Se genera desde supabase/functions/usuarios/index.ts: si cambia aquel, regenerar este.
// Función "usuarios": un dueño invita a alguien al sistema (le llega un mail para elegir su contraseña).
// Crear usuarios necesita la clave de servicio, por eso se hace acá y no desde el navegador.
// Rol, nombre y alta/baja de un usuario existente se cambian directo desde la app (lo permiten los permisos de admin).
// ---- utilidades compartidas (copia de supabase/functions/_compartido/comun.ts) ----
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string, def = '') => Deno.env.get(k) ?? def

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente con permisos completos (service role): solo dentro de las funciones, nunca en el navegador */
const admin = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/** Cliente que actúa como el usuario que llama: la base aplica sus permisos */
const comoUsuario = (req: Request): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

type Rol = 'admin' | 'encargado' | 'mozo' | 'cocina' | 'barra'

/** Quién llama: su perfil activo, o null si no está autorizado */
async function quienLlama(req: Request): Promise<{ id: string; rol: Rol; nombre: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const db = admin()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: p } = await db.from('perfiles').select('rol, activo, nombre').eq('id', data.user.id).maybeSingle()
  if (!p || !p.activo) return null
  return { id: data.user.id, rol: p.rol as Rol, nombre: p.nombre }
}

const esGestion = (rol: Rol) => rol === 'admin' || rol === 'encargado'

// ---- fin de las utilidades ----

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
