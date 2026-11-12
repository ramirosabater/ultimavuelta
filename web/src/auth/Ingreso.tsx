import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { LOGO, NOMBRE } from '../lib/marca'
import { Grilla } from '../components/Autos'

export default function Ingreso() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError(''); setAviso(''); setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
    setEnviando(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'El mail o la contraseña no coinciden.' : error.message)
  }

  async function olvide() {
    if (!email) { setError('Escribí tu mail y volvé a tocar "Olvidé mi contraseña".'); return }
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/elegir-clave' })
    if (error) setError(error.message)
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
        {error && <div className="aviso bad" role="alert">{error}</div>}
        {aviso && <div className="aviso ok" role="status">{aviso}</div>}
        <button className="btn pri" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        <button type="button" className="link" onClick={olvide}>Olvidé mi contraseña</button>
      </form>
      <Grilla />
    </div>
  )
}
