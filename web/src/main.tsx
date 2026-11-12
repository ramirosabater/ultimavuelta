import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './base-prototipo.css'
import './index.css'
import './tema-carreras.css'

const root = createRoot(document.getElementById('root')!)
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Sin la configuración de Supabase la app no puede arrancar: se explica qué falta en vez de mostrar una pantalla vacía
if (!url || !clave || !/^https?:\/\//.test(url)) {
  root.render(
    <div className="ingreso"><div className="card stack" style={{ width: 'min(560px, 100%)' }}>
      <h1>Falta conectar con Supabase</h1>
      <p style={{ margin: 0 }}>No se encontró el archivo <code>.env.local</code> en la carpeta <code>web</code>, o le falta algún dato. Tiene que tener estas dos líneas:</p>
      <pre style={{ background: 'var(--chip)', padding: 12, borderRadius: 10, overflowX: 'auto', margin: 0 }}>VITE_SUPABASE_URL=https://xxxx.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=la-clave-anon</pre>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>El archivo se tiene que llamar exactamente <code>.env.local</code> (no <code>.env.local.txt</code>).</li>
        <li>Después de crearlo o cambiarlo, cortá <code>npm run dev</code> con Ctrl+C y volvé a correrlo.</li>
        <li>{url ? `La URL que llegó es "${url}": tiene que empezar con https://` : 'No llegó la URL.'} {clave ? 'La clave sí llegó.' : 'No llegó la clave.'}</li>
      </ul>
    </div></div>,
  )
} else {
  import('./App').then(({ default: App }) => root.render(<StrictMode><App /></StrictMode>))
}
