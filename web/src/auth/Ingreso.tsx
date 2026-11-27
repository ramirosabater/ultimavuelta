import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CLAVE_CAPTCHA, Captcha, type CaptchaRef } from './Captcha'
import { supabase } from '../lib/supabase'
import { LOGO, NOMBRE } from '../lib/marca'
import { Grilla } from '../components/Autos'

export default function Ingreso() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [token, setToken] = useState('')
  const captcha = useRef<CaptchaRef>(null)
  // Después de 5 intentos fallidos seguidos, hay que esperar un minuto
  const [fallos, setFallos] = useState(0)
  const [esperaHasta, setEsperaHasta] = useState(0)
  const [, setTic] = useState(0)
  useEffect(() => { if (!esperaHasta) return; const t = window.setInterval(() => { if (Date.now() >= esperaHasta) { setEsperaHasta(0); setFallos(0) } setTic((x) => x + 1) }, 1000); return () => window.clearInterval(t) }, [esperaHasta])
  const faltan = esperaHasta ? Math.max(0, Math.ceil((esperaHasta - Date.now()) / 1000)) : 0
  const sinVerificar = !!CLAVE_CAPTCHA && !token

  const traducir = (m: string) => m === 'Invalid login credentials' ? 'El mail o la contraseña no coinciden.'
    : /captcha/i.test(m) ? 'Falta la verificación "no soy un robot" o venció. Marcala de nuevo.'
    : /rate limit|too many/i.test(m) ? 'Demasiados intentos. Esperá unos minutos y probá de nuevo.' : m

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (faltan) return
    if (sinVerificar) { setError('Marcá "no soy un robot" antes de entrar.'); return }
    setError(''); setAviso(''); setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave, options: CLAVE_CAPTCHA ? { captchaToken: token } : undefined })
    setEnviando(false)
    captcha.current?.reiniciar()   // cada verificación sirve una sola vez
    if (error) {
      setError(traducir(error.message))
      if (error.message === 'Invalid login credentials') { const f = fallos + 1; setFallos(f); if (f >= 5) setEsperaHasta(Date.now() + 60000) }
    }
  }

  async function olvide() {
    if (!email) { setError('Escribí tu mail y volvé a tocar "Olvidé mi contraseña".'); return }
    if (sinVerificar) { setError('Marcá "no soy un robot" y volvé a tocar "Olvidé mi contraseña".'); return }
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/elegir-clave', ...(CLAVE_CAPTCHA ? { captchaToken: token } : {}) })
    captcha.current?.reiniciar()
    if (error) setError(traducir(error.message))
    else setAviso('Te mandamos un mail para elegir una contraseña nueva.')
  }

  return (
    <div className="ingreso">
      <form className="card stack" onSubmit={entrar}>
        <div>
          <img src={LOGO} alt="" />
          <h1>{NOMBRE}</h1>
          <p className="muted" style={{ margin: 0 }}>El bar de los Seba's · Entrá con tu mail.</p>
        </div>
        <label className="campo">Mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="campo">Contraseña
          <input type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <Captcha ref={captcha} onToken={setToken} onError={setError} />
        {error && <div className="aviso bad" role="alert">{error}</div>}
        {aviso && <div className="aviso ok" role="status">{aviso}</div>}
        {faltan > 0 && <div className="aviso warn" role="status">Muchos intentos fallidos. Esperá {faltan} segundos para probar de nuevo, o tocá "Olvidé mi contraseña".</div>}
        <button className="btn pri" disabled={enviando || faltan > 0 || sinVerificar}>{enviando ? 'Entrando…' : sinVerificar ? 'Marcá "no soy un robot"' : 'Entrar'}</button>
        <button type="button" className="link" onClick={olvide}>Olvidé mi contraseña</button>
      </form>
      <Grilla />
    </div>
  )
}
