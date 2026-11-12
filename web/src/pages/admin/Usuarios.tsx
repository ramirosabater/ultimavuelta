import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { invocar, supabase } from '../../lib/supabase'
import { ROLES, type Perfil, type Rol } from '../../lib/tipos'
import { useAuth } from '../../auth/AuthProvider'
import { SubNavAdmin } from './nav'
import { Cabeza, Modal, Pill, useAccion } from '../../components/ui'

export default function Usuarios() {
  const { perfil: yo } = useAuth()
  const d = useConsulta(() => tabla<Perfil[]>(supabase.from('perfiles').select('*').order('activo', { ascending: false }).order('nombre')))
  const [invitar, setInvitar] = useState(false)
  const { correr } = useAccion()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  async function cambiar(p: Perfil, cambio: Partial<Perfil>, ok: string) {
    await correr(async () => { const { error } = await supabase.from('perfiles').update(cambio).eq('id', p.id); if (error) throw new Error(error.message); d.recargar() }, ok)
  }
  return <>
    <Cabeza etiqueta="Administración" titulo="Usuarios"><button className="btn pri" data-ayuda="invitar" onClick={() => setInvitar(true)}>Invitar a alguien</button></Cabeza>
    <SubNavAdmin />
    <section className="panel" style={{ marginBottom: 16 }}>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', maxWidth: '72ch' }}>Cada uno entra con su mail y su contraseña y ve solo lo suyo. Si alguien deja de trabajar, desactivalo: no puede entrar más pero queda su historia (mesas, ventas).</p>
      {!d.datos ? <p className="cargando">Cargando…</p> : <div className="tbl-wrap"><table><thead><tr><th>Nombre</th><th>Mail</th><th>Rol</th><th>Estado</th><th /></tr></thead><tbody>
        {d.datos.map((p) => <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
          <td><b>{p.nombre}</b>{p.id === yo?.id && <span className="muted"> (vos)</span>}</td><td className="muted">{p.email}</td>
          <td><select aria-label={`Rol de ${p.nombre}`} value={p.rol} disabled={p.id === yo?.id} style={{ width: 'auto' }} onChange={(e) => cambiar(p, { rol: e.target.value as Rol }, 'Rol cambiado')}>
            {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.nombre}</option>)}</select></td>
          <td>{p.activo ? <Pill tono="ok">Activo</Pill> : <Pill>Inactivo</Pill>}</td>
          <td className="r">{p.id !== yo?.id && <button className="btn sm ghost" onClick={() => cambiar(p, { activo: !p.activo }, p.activo ? 'Usuario desactivado' : 'Usuario activado')}>{p.activo ? 'Desactivar' : 'Activar'}</button>}</td></tr>)}
      </tbody></table></div>}
    </section>
    <section className="panel"><h3 style={{ marginBottom: 8 }}>Qué ve cada rol</h3><div className="rows">
      {Object.entries(ROLES).map(([k, r]) => <div className="row" key={k}><b style={{ minWidth: 110 }}>{r.nombre}</b><span className="grow muted">{r.texto}</span></div>)}</div></section>
    {invitar && <Invitar onCerrar={() => setInvitar(false)} onListo={() => { setInvitar(false); d.recargar() }} />}
  </>
}

function Invitar({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: '', email: '', rol: 'mozo' as Rol })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Invitar a alguien" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
    setErr('')
    let msj = ''
    const ok = await correr(async () => {
      const { data, error } = await invocar<{ mensaje: string }>('usuarios', f)
      if (error) { setErr(error); throw new Error(error) }
      msj = data?.mensaje ?? ''
    })
    if (ok) { if (msj) window.alert(msj); onListo() }
  }}>Mandar invitación</button></>}>
    <div className="two"><label className="campo">Nombre<input id="u-nom" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} autoFocus /></label>
      <label className="campo">Mail<input id="u-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label></div>
    <label className="campo">Rol<select id="u-rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as Rol })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.nombre} — {r.texto}</option>)}</select></label>
    <p className="muted" style={{ fontSize: 13 }}>Le llega un mail para elegir su contraseña. Si no lo ve, que revise el spam.</p>
    {err && <div className="err">{err}</div>}
  </Modal>
}
