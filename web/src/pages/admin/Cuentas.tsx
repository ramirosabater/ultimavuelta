import { useState } from 'react'
import { rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { fechaCorta, hoy, plata } from '../../lib/formato'
import type { Cuenta, MedioPago } from '../../lib/tipos'
import { SubNavAdmin } from './nav'
import { Cabeza, Modal, Stat, useAccion } from '../../components/ui'

interface Mov { id: number; tipo: 'transferencia' | 'ajuste'; de_cuenta: number | null; a_cuenta: number; monto: number; fecha: string; nota: string | null }

export default function Cuentas() {
  const d = useConsulta(async () => {
    const [cuentas, saldos, medios, movs] = await Promise.all([
      tabla<Cuenta[]>(supabase.from('cuentas').select('*').order('orden')),
      rpc<{ id: number; saldo: number }[]>('saldos_cuentas'),
      tabla<MedioPago[]>(supabase.from('medios_pago').select('*').order('orden')),
      tabla<Mov[]>(supabase.from('movimientos_cuenta').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }).limit(20)),
    ])
    return { cuentas, saldos, medios, movs }
  })
  const [ventana, setVentana] = useState<null | 'transferir' | 'medio' | { cuenta: Cuenta | null } | { ajustar: Cuenta }>(null)
  const { correr } = useAccion()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavAdmin /><p className="cargando">Cargando cuentas…</p></>
  const { cuentas, saldos, medios, movs } = d.datos
  const saldo = (id: number) => Number(saldos.find((s) => s.id === id)?.saldo ?? 0)
  const nombre = (id: number | null) => cuentas.find((c) => c.id === id)?.nombre ?? '—'
  const listo = () => { setVentana(null); d.recargar() }
  const activas = cuentas.filter((c) => c.activa)

  return <>
    <Cabeza etiqueta="Administración" titulo="Cuentas">
      <button className="btn" onClick={() => setVentana('transferir')}>Pasar plata</button>
      <button className="btn pri" onClick={() => setVentana({ cuenta: null })}>Nueva cuenta</button></Cabeza>
    <SubNavAdmin />
    <div className="stats" style={{ marginBottom: 16 }} data-ayuda="saldos">
      {activas.map((c) => <Stat key={c.id} label={c.nombre} valor={plata(saldo(c.id))} extra={<span className="muted">{c.tipo}</span>} />)}
      <Stat label="Total" valor={plata(activas.reduce((s, c) => s + saldo(c.id), 0))} />
    </div>
    <section className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 6 }}>Cuentas</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', maxWidth: '72ch' }}>El saldo se calcula solo: saldo inicial + lo cobrado con los medios que entran a la cuenta − gastos pagados desde ella ± transferencias y ajustes. Si no coincide con el banco, hacé un ajuste.</p>
      <div className="tbl-wrap"><table><thead><tr><th>Cuenta</th><th>Tipo</th><th className="r">Saldo inicial</th><th>Desde</th><th className="r">Saldo hoy</th><th /></tr></thead><tbody>
        {cuentas.map((c) => <tr key={c.id} style={c.activa ? undefined : { opacity: 0.55 }}><td><b>{c.nombre}</b></td><td className="muted">{c.tipo}</td><td className="r mono">{plata(c.saldo_inicial)}</td><td className="mono">{fechaCorta(c.desde)}</td>
          <td className="r mono"><b>{plata(saldo(c.id))}</b></td><td className="r" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setVentana({ ajustar: c })}>Ajustar</button> <button className="btn sm ghost" onClick={() => setVentana({ cuenta: c })}>Editar</button></td></tr>)}
      </tbody></table></div>
    </section>
    <div className="rep-grid" style={{ marginTop: 0 }}>
      <section className="panel" data-ayuda="medios-pago">
        <div className="fila" style={{ marginBottom: 6 }}><h3 className="grow">Medios de pago</h3><button className="btn sm" onClick={() => setVentana('medio')}>Agregar</button></div>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Adónde entra lo que se cobra con cada uno.</p>
        <div className="rows">{medios.map((m) => <div className="row" key={m.nombre} style={m.activo ? undefined : { opacity: 0.55 }}>
          <b className="grow">{m.nombre}</b>
          <select aria-label={`Cuenta de ${m.nombre}`} value={m.cuenta_id ?? ''} style={{ width: 'auto' }} onChange={(e) => correr(async () => { const { error } = await supabase.from('medios_pago').update({ cuenta_id: e.target.value ? Number(e.target.value) : null }).eq('nombre', m.nombre); if (error) throw new Error(error.message); d.recargar() }, 'Guardado')}>
            <option value="">Sin cuenta</option>{activas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          <button className="btn sm ghost" onClick={() => correr(async () => { await supabase.from('medios_pago').update({ activo: !m.activo }).eq('nombre', m.nombre); d.recargar() }, m.activo ? 'Medio desactivado' : 'Medio activado')}>{m.activo ? 'Desactivar' : 'Activar'}</button>
        </div>)}</div>
      </section>
      <section className="panel">
        <h3 style={{ marginBottom: 6 }}>Últimos movimientos entre cuentas</h3>
        {movs.length ? <div className="rows">{movs.map((m) => <div className="row" key={m.id}><span className="mono muted">{fechaCorta(m.fecha)}</span>
          <span className="grow">{m.tipo === 'transferencia' ? `${nombre(m.de_cuenta)} → ${nombre(m.a_cuenta)}` : `Ajuste en ${nombre(m.a_cuenta)}`}{m.nota && <div className="muted" style={{ fontSize: 12 }}>{m.nota}</div>}</span>
          <span className="num mono">{plata(m.monto)}</span></div>)}</div> : <div className="kempty">Sin transferencias ni ajustes.</div>}
      </section>
    </div>

    {ventana === 'transferir' && <Transferir cuentas={activas} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana === 'medio' && <NuevoMedio cuentas={activas} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && 'cuenta' in ventana && <CuentaForm cuenta={ventana.cuenta} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && 'ajustar' in ventana && <Ajustar cuenta={ventana.ajustar} saldo={saldo(ventana.ajustar.id)} onCerrar={() => setVentana(null)} onListo={listo} />}
  </>
}

function CuentaForm({ cuenta, onCerrar, onListo }: { cuenta: Cuenta | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: cuenta?.nombre ?? '', tipo: cuenta?.tipo ?? 'Banco', saldo_inicial: String(cuenta?.saldo_inicial ?? 0), desde: cuenta?.desde ?? hoy() })
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    const fila = { nombre: f.nombre.trim(), tipo: f.tipo, saldo_inicial: Number(f.saldo_inicial) || 0, desde: f.desde }
    const ok = await correr(async () => {
      if (!fila.nombre) throw new Error('Poné un nombre.')
      const { error } = cuenta ? await supabase.from('cuentas').update(fila).eq('id', cuenta.id) : await supabase.from('cuentas').insert({ ...fila, orden: 99 })
      if (error) throw new Error(error.code === '23505' ? 'Ya hay una cuenta con ese nombre.' : error.message)
    }, 'Cuenta guardada')
    if (ok) onListo()
  }
  return <Modal titulo={cuenta ? 'Editar cuenta' : 'Nueva cuenta'} onCerrar={onCerrar}
    pie={<>{cuenta && <button className="btn ghost" disabled={ocupado} onClick={async () => { if (await correr(async () => { await supabase.from('cuentas').update({ activa: !cuenta.activa }).eq('id', cuenta.id) }, 'Listo')) onListo() }}>{cuenta.activa ? 'Desactivar' : 'Activar'}</button>}
      <span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    <div className="two"><label className="campo">Nombre<input id="c-nom" value={f.nombre} onChange={set('nombre')} autoFocus /></label>
      <label className="campo">Tipo<select id="c-tipo" value={f.tipo} onChange={set('tipo')}><option>Efectivo</option><option>Banco</option><option>Billetera virtual</option></select></label></div>
    <div className="two"><label className="campo">Saldo inicial ($)<input id="c-saldo" type="number" step="any" inputMode="decimal" value={f.saldo_inicial} onChange={set('saldo_inicial')} /></label>
      <label className="campo">A la fecha<input id="c-desde" type="date" value={f.desde} onChange={set('desde')} /></label></div>
  </Modal>
}

function Transferir({ cuentas, onCerrar, onListo }: { cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const [de, setDe] = useState(String(cuentas[0]?.id ?? '')), [a, setA] = useState(String(cuentas[1]?.id ?? ''))
  const [monto, setMonto] = useState(''), [nota, setNota] = useState(''), [fecha, setFecha] = useState(hoy())
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Pasar plata entre cuentas" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
    if (await correr(async () => {
      if (de === a) throw new Error('Elegí dos cuentas distintas.')
      if (!(Number(monto) > 0)) throw new Error('Poné el monto.')
      const { error } = await supabase.from('movimientos_cuenta').insert({ tipo: 'transferencia', de_cuenta: Number(de), a_cuenta: Number(a), monto: Number(monto), fecha, nota: nota.trim() || null })
      if (error) throw new Error(error.message)
    }, 'Transferencia registrada')) onListo()
  }}>Registrar</button></>}>
    <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Ej.: depositaste el efectivo de la caja en el banco.</p>
    <div className="two"><label className="campo">Sale de<select id="t-de" value={de} onChange={(e) => setDe(e.target.value)}>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label className="campo">Entra a<select id="t-a" value={a} onChange={(e) => setA(e.target.value)}>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label></div>
    <div className="two"><label className="campo">Monto ($)<input id="t-monto" type="number" step="any" min={0} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></label>
      <label className="campo">Fecha<input id="t-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label></div>
    <label className="campo">Nota<input id="t-nota" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
  </Modal>
}

function Ajustar({ cuenta, saldo, onCerrar, onListo }: { cuenta: Cuenta; saldo: number; onCerrar: () => void; onListo: () => void }) {
  const [real, setReal] = useState(''), [nota, setNota] = useState('')
  const { correr, ocupado } = useAccion()
  const dif = real === '' ? 0 : Number(real) - saldo
  return <Modal titulo={`Ajustar ${cuenta.nombre}`} onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !dif} onClick={async () => {
    if (await correr(async () => { const { error } = await supabase.from('movimientos_cuenta').insert({ tipo: 'ajuste', a_cuenta: cuenta.id, monto: Math.round(dif * 100) / 100, fecha: hoy(), nota: nota.trim() || 'Ajuste de saldo' }); if (error) throw new Error(error.message) }, 'Saldo ajustado')) onListo()
  }}>Ajustar</button></>}>
    <p style={{ marginTop: 0 }}>La app dice <b>{plata(saldo)}</b>. ¿Cuánto hay en realidad?</p>
    <label className="campo">Saldo real ($)<input id="aj-real" type="number" step="any" inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} autoFocus /></label>
    {dif !== 0 && <p>Diferencia: <b style={{ color: dif < 0 ? 'var(--crit)' : 'var(--ok)' }}>{dif > 0 ? '+' : '−'}{plata(Math.abs(dif))}</b></p>}
    <label className="campo">Motivo<input id="aj-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Comisiones, intereses, error de carga…" /></label>
  </Modal>
}

function NuevoMedio({ cuentas, onCerrar, onListo }: { cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState(''), [cuenta, setCuenta] = useState(String(cuentas[0]?.id ?? ''))
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Nuevo medio de pago" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
    if (await correr(async () => { if (!nombre.trim()) throw new Error('Poné un nombre.'); const { error } = await supabase.from('medios_pago').insert({ nombre: nombre.trim(), cuenta_id: cuenta ? Number(cuenta) : null, orden: 99 }); if (error) throw new Error(error.code === '23505' ? 'Ya existe.' : error.message) }, 'Medio agregado')) onListo()
  }}>Agregar</button></>}>
    <div className="two"><label className="campo">Nombre<input id="mp-nom" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cuenta DNI, MODO…" autoFocus /></label>
      <label className="campo">Entra a<select id="mp-cuenta" value={cuenta} onChange={(e) => setCuenta(e.target.value)}><option value="">Sin cuenta</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label></div>
  </Modal>
}
