import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, devJwt } from '../lib/supabase'
import type { Perfil } from '../lib/tipos'

interface Auth {
  cargando: boolean
  perfil: Perfil | null
  /** true si el usuario entró pero no tiene perfil activo */
  sinPerfil: boolean
  /** dueños y encargados */
  gestion: boolean
  /** dueños, encargados y mozos */
  salon: boolean
  salir: () => Promise<void>
}

const Ctx = createContext<Auth | null>(null)

/** Lee el "sub" (id de usuario) de un JWT, solo para el modo de prueba local */
function subDeJwt(jwt: string): string | null {
  try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(devJwt ? subDeJwt(devJwt) : null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (devJwt) return
    supabase.auth.getSession().then(({ data }) => { setUserId(data.session?.user.id ?? null); if (!data.session) setCargando(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setUserId(s?.user.id ?? null); if (!s) { setPerfil(null); setCargando(false) } })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) { setCargando(false); return }
    setCargando(true)
    supabase.from('perfiles').select('id, nombre, email, rol, activo').eq('id', userId).maybeSingle()
      .then(({ data }) => { setPerfil(data && data.activo ? (data as Perfil) : null); setCargando(false) })
  }, [userId])

  const rol = perfil?.rol
  const valor: Auth = {
    cargando,
    perfil,
    sinPerfil: !!userId && !cargando && !perfil,
    gestion: rol === 'admin' || rol === 'encargado',
    salon: rol === 'admin' || rol === 'encargado' || rol === 'mozo',
    salir: async () => { if (!devJwt) await supabase.auth.signOut() },
  }
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth fuera de AuthProvider')
  return c
}
