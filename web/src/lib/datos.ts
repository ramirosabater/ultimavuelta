import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, mensajeError } from './supabase'

/** Llama a una función de la base. Devuelve el resultado o tira un Error con el mensaje en castellano. */
export async function rpc<T = unknown>(nombre: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) throw new Error(mensajeError(error))
  return data as T
}

/** Consulta que se carga al entrar y se puede recargar. `deps` cambia la consulta. */
export function useConsulta<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const fnRef = useRef(fn); fnRef.current = fn
  const vez = useRef(0)
  const recargar = useCallback(async () => {
    const yo = ++vez.current
    try {
      const d = await fnRef.current()
      if (yo === vez.current) { setDatos(d); setError('') }
    } catch (e) {
      if (yo === vez.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (yo === vez.current) setCargando(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setCargando(true); recargar() }, deps)
  return { datos, error, cargando, recargar }
}

/** Lee una tabla y avisa si falla (con el mensaje de la base) */
export async function tabla<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await q
  if (error) throw new Error(mensajeError(error))
  return (data ?? []) as T
}

/**
 * Pantallas en vivo: se recarga cuando cambian las tablas indicadas (Supabase Realtime)
 * y, por las dudas, cada `cadaSeg` segundos aunque no llegue ningún aviso.
 */
export function useEnVivo(tablas: string[], alCambiar: () => void, cadaSeg = 20) {
  const fn = useRef(alCambiar); fn.current = alCambiar
  useEffect(() => {
    let t = 0
    const avisar = () => { window.clearTimeout(t); t = window.setTimeout(() => fn.current(), 250) }
    const canal = supabase.channel(`vivo-${tablas.join('-')}-${Math.random().toString(36).slice(2, 7)}`)
    for (const tb of tablas) canal.on('postgres_changes', { event: '*', schema: 'public', table: tb }, avisar)
    canal.subscribe()
    const iv = window.setInterval(() => fn.current(), cadaSeg * 1000)
    const vis = () => { if (document.visibilityState === 'visible') fn.current() }
    document.addEventListener('visibilitychange', vis)
    return () => { window.clearTimeout(t); window.clearInterval(iv); document.removeEventListener('visibilitychange', vis); supabase.removeChannel(canal) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablas.join(','), cadaSeg])
}

/** Supabase devuelve como máximo 1000 filas por pedido: esto pide de a 1000 hasta traer todo */
export async function traerTodo<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await armar(i, i + 999)
    if (error) throw new Error(mensajeError(error))
    const filas = (data ?? []) as T[]
    out.push(...filas)
    if (filas.length < 1000) return out
  }
}

/** Parámetros de configuración (tabla parametros) */
export async function leerParametros(): Promise<Record<string, string>> {
  const { data } = await supabase.from('parametros').select('clave, valor')
  return Object.fromEntries((data ?? []).map((p) => [p.clave, p.valor]))
}
