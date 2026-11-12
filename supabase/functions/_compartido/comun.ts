// Utilidades compartidas por las funciones de Supabase de Última Vuelta
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const env = (k: string, def = '') => Deno.env.get(k) ?? def

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Cliente con permisos completos (service role): solo dentro de las funciones, nunca en el navegador */
export const admin = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/** Cliente que actúa como el usuario que llama: la base aplica sus permisos */
export const comoUsuario = (req: Request): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

export type Rol = 'admin' | 'encargado' | 'mozo' | 'cocina' | 'barra'

/** Quién llama: su perfil activo, o null si no está autorizado */
export async function quienLlama(req: Request): Promise<{ id: string; rol: Rol; nombre: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const db = admin()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  const { data: p } = await db.from('perfiles').select('rol, activo, nombre').eq('id', data.user.id).maybeSingle()
  if (!p || !p.activo) return null
  return { id: data.user.id, rol: p.rol as Rol, nombre: p.nombre }
}

export const esGestion = (rol: Rol) => rol === 'admin' || rol === 'encargado'
