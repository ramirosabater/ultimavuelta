import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { LOGO } from '../lib/marca'

/** Adonde llegan el mail de invitación y el de "olvidé mi contraseña" */
export default function ElegirClave() {
  const [clave, setClave] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    if (clave.length < 8) { setError('La contraseña tiene que tener al menos 8 caracteres.'); return }
    if (clave !== repetir) { setError('Las dos contraseñas no coinciden.'); return }
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setEnviando(false)
    if (error) setError(error.message.includes('session') ? 'El enlace venció. Pedí uno nuevo con "Olvidé mi contraseña".' : error.message)
    else window.location.replace('/')
  }

  return (
    <div className="ingreso">
      <form className="card stack" onSubmit={guardar}>
        <div><img src={LOGO} alt="" /><h1>Elegí tu contraseña</h1>
          <p className="muted" style={{ margin: 0 }}>Con tu mail y esta contraseña vas a entrar al sistema.</p></div>
        <label className="campo">Contraseña nueva<input type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} required /></label>
        <label className="campo">Repetila<input type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required /></label>
        {error && <div className="aviso bad" role="alert">{error}</div>}
        <button className="btn pri" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar y entrar'}</button>
      </form>
    </div>
  )
}
