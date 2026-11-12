import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
/** Token fijo para pruebas locales contra PostgREST (sin Supabase Auth).
 *  Solo vale en la PC (localhost): si por error se cargara en Netlify, se ignora. */
const enLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
export const devJwt = enLocal ? (import.meta.env.VITE_DEV_JWT as string | undefined) || undefined : undefined

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env')
}

export const supabase = devJwt
  ? createClient(url, anonKey, { accessToken: async () => devJwt })
  : createClient(url, anonKey)

/** Mensaje legible de un error de Supabase/Postgres (las funciones de la base ya devuelven texto en castellano). */
export function mensajeError(e: unknown): string {
  if (!e) return ''
  const err = e as { message?: string; hint?: string }
  return [err.message, err.hint].filter(Boolean).join(' ')
}

/** Llama a una función de Supabase y devuelve el mensaje de error legible que manda la función */
export async function invocar<T = unknown>(nombre: string, body: Record<string, unknown> | FormData): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(nombre, { body })
  if (!error) return { data: data as T, error: null }
  let detalle = ''
  try { detalle = (await (error as { context?: Response }).context?.json())?.error ?? '' } catch { /* sin detalle */ }
  if (!detalle && /Failed to send|fetch/i.test(error.message)) detalle = 'No hay conexión con el servidor (o la función todavía no está publicada en Supabase).'
  return { data: null, error: detalle || mensajeError(error) }
}
