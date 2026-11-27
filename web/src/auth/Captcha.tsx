// "No soy un robot" con Cloudflare Turnstile. Supabase lo verifica al entrar y al pedir una contraseña nueva.
// Se activa poniendo VITE_TURNSTILE_SITE_KEY (la clave del sitio) en Netlify; sin esa clave no aparece.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, o: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id: string) => void
    }
  }
}

export const CLAVE_CAPTCHA = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() || ''
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let cargando: Promise<void> | null = null
function cargar() {
  cargando ??= new Promise((ok, mal) => {
    if (window.turnstile) { ok(); return }
    const s = document.createElement('script')
    s.src = SCRIPT; s.async = true; s.defer = true
    s.onload = () => ok(); s.onerror = () => { cargando = null; mal(new Error('No se pudo cargar la verificación. Revisá la conexión.')) }
    document.head.appendChild(s)
  })
  return cargando
}

export interface CaptchaRef { reiniciar: () => void }

/** El cuadrito de verificación. onToken recibe el código (o '' si venció o falló). */
export const Captcha = forwardRef<CaptchaRef, { onToken: (t: string) => void; onError?: (m: string) => void }>(function Captcha({ onToken, onError }, ref) {
  const caja = useRef<HTMLDivElement>(null)
  const id = useRef<string | null>(null)
  const cb = useRef({ onToken, onError })
  cb.current = { onToken, onError }
  useImperativeHandle(ref, () => ({ reiniciar: () => { cb.current.onToken(''); if (id.current && window.turnstile) window.turnstile.reset(id.current) } }), [])
  useEffect(() => {
    if (!CLAVE_CAPTCHA) return
    let vivo = true
    cargar().then(() => {
      if (!vivo || !caja.current || !window.turnstile) return
      id.current = window.turnstile.render(caja.current, {
        sitekey: CLAVE_CAPTCHA, language: 'es', theme: 'auto', size: 'flexible',
        callback: (t: string) => cb.current.onToken(t),
        'expired-callback': () => cb.current.onToken(''),
        'timeout-callback': () => cb.current.onToken(''),
        'error-callback': () => { cb.current.onToken(''); cb.current.onError?.('La verificación falló. Probá de nuevo.') },
      })
    }).catch((e: Error) => cb.current.onError?.(e.message))
    return () => { vivo = false; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = null }
  }, [])
  if (!CLAVE_CAPTCHA) return null
  return <div className="captcha" ref={caja} aria-label="Verificación: no soy un robot" />
})
