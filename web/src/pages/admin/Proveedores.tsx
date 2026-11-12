import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { fechaCorta, hoy, plata, sumarDias } from '../../lib/formato'
import type { Gasto, Insumo, Proveedor } from '../../lib/tipos'
import { SubNavAdmin } from './nav'
import { PagarModal, venceTexto } from './Gastos'
import { Cabeza, Modal, Pill, useAccion } from '../../components/ui'

export default function Proveedores() {
  const d = useConsulta(async () => {
    const [provs, pend, ins, compras] = await Promise.all([
      tabla<Proveedor[]>(supabase.from('proveedores').select('*').order('nombre')),
      tabla<Gasto[]>(supabase.from('gastos').select('*').eq('estado', 'pendiente').not('proveedor_id', 'is', null).order('vence')),
      tabla<Pick<Insumo, 'id' | 'nombre' | 'proveedor_id'>[]>(supabase.from('insumos').select('id, nombre, proveedor_id').eq('activo', true)),
      tabla<{ proveedor_id: number; total: number; fecha: string }[]>(supabase.from('compras').select('proveedor_id, total, fecha').gte('fecha', sumarDias(hoy(), -90))),
    ])
    return { provs, pend, ins, compras }
  })
  const [buscar, setBuscar] = useState('')
  const [ver, setVer] = useState<number | null>(null)
  const [editar, setEditar] = useState<Proveedor | null | 'nuevo'>(null)
  const [pagar, setPagar] = useState<Gasto | null>(null)
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavAdmin /><p className="cargando">Cargando proveedores…</p></>
  const { provs, pend, ins, compras } = d.datos
  const lista = provs.filter((p) => !buscar || `${p.nombre} ${p.rubro ?? ''}`.toLowerCase().includes(buscar.toLowerCase()))
  const deuda = (id: number) => pend.filter((g) => g.proveedor_id === id).reduce((s, g) => s + Number(g.monto), 0)

  return <>
    <Cabeza etiqueta="Administración" titulo="Proveedores"><button className="btn pri" data-ayuda="nuevo-proveedor" onClick={() => setEditar('nuevo')}>Nuevo proveedor</button></Cabeza>
    <SubNavAdmin />
    <section className="panel">
      <input id="prov-buscar" type="search" placeholder="Buscar por nombre o rubro…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: 10 }} />
      {lista.length ? <div className="tbl-wrap"><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Plazo</th><th className="r">Compras 90 días</th><th className="r">Le debés</th><th /></tr></thead><tbody>
        {lista.map((p) => { const deb = deuda(p.id), c90 = compras.filter((c) => c.proveedor_id === p.id).reduce((s, c) => s + Number(c.total), 0); return <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
          <td><b>{p.nombre}</b>{p.rubro && <div className="muted" style={{ fontSize: 12 }}>{p.rubro}</div>}</td>
          <td style={{ fontSize: 13 }}>{p.contacto}{p.telefono && <div><a href={`https://wa.me/${p.telefono.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{p.telefono}</a></div>}</td>
          <td>{p.plazo_dias ? `${p.plazo_dias} días` : 'Contado'}</td>
          <td className="r mono">{plata(c90)}</td>
          <td className="r mono">{deb ? <b style={{ color: 'var(--crit)' }}>{plata(deb)}</b> : <span className="muted">—</span>}</td>
          <td className="r" style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => setVer(p.id)}>Ver</button> <button className="btn sm ghost" onClick={() => setEditar(p)}>Editar</button></td></tr> })}
      </tbody></table></div> : <div className="kempty">{provs.length ? 'Nada coincide con la búsqueda.' : 'Todavía no cargaste proveedores.'}</div>}
    </section>

    {ver != null && (() => { const p = provs.find((x) => x.id === ver)!; const suyos = pend.filter((g) => g.proveedor_id === ver); const arts = ins.filter((i) => i.proveedor_id === ver)
      return <Modal titulo={p.nombre} onCerrar={() => setVer(null)} ancho={640}>
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{[p.rubro, p.cuit && `CUIT ${p.cuit}`, p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
        {p.notas && <div className="notice" style={{ marginBottom: 10 }}>{p.notas}</div>}
        <h3 style={{ marginBottom: 6 }}>Cuenta corriente</h3>
        {suyos.length ? <div className="rows">{suyos.map((g) => <div className="row" key={g.id}><div className="grow"><b>{g.concepto}</b><div className="muted" style={{ fontSize: 12 }}>{fechaCorta(g.fecha)}</div></div>
          {venceTexto(g.vence)}<span className="num mono">{plata(g.monto)}</span><button className="btn sm" onClick={() => setPagar(g)}>Pagar</button></div>)}</div>
          : <div className="kempty">No le debés nada.</div>}
        <h3 style={{ margin: '16px 0 6px' }}>Le comprás</h3>
        <div className="chips">{arts.length ? arts.map((a) => <Pill key={a.id}>{a.nombre}</Pill>) : <span className="muted">Ningún artículo tiene este proveedor asignado.</span>}</div>
      </Modal> })()}
    {editar && <ProveedorForm prov={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); d.recargar() }} />}
    {pagar && <PagarModal gasto={pagar} onCerrar={() => setPagar(null)} onListo={() => { setPagar(null); d.recargar() }} />}
  </>
}

function ProveedorForm({ prov, onCerrar, onListo }: { prov: Proveedor | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: prov?.nombre ?? '', rubro: prov?.rubro ?? '', cuit: prov?.cuit ?? '', contacto: prov?.contacto ?? '', telefono: prov?.telefono ?? '', email: prov?.email ?? '', plazo_dias: String(prov?.plazo_dias ?? 0), notas: prov?.notas ?? '' })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (!f.nombre.trim()) { setErr('Poné el nombre.'); return }
    const n = (s: string) => s.trim() || null
    const fila = { nombre: f.nombre.trim(), rubro: n(f.rubro), cuit: n(f.cuit), contacto: n(f.contacto), telefono: n(f.telefono), email: n(f.email), plazo_dias: Math.max(0, Math.round(Number(f.plazo_dias) || 0)), notas: n(f.notas) }
    const ok = await correr(async () => {
      const { error } = prov ? await supabase.from('proveedores').update(fila).eq('id', prov.id) : await supabase.from('proveedores').insert(fila)
      if (error) throw new Error(error.code === '23505' ? 'Ya hay un proveedor con ese nombre.' : error.message)
    }, 'Proveedor guardado')
    if (ok) onListo()
  }
  return <Modal titulo={prov ? 'Editar proveedor' : 'Nuevo proveedor'} onCerrar={onCerrar}
    pie={<>{prov && <button className="btn ghost" disabled={ocupado} onClick={async () => { if (await correr(async () => { await supabase.from('proveedores').update({ activo: !prov.activo }).eq('id', prov.id) }, prov.activo ? 'Proveedor desactivado' : 'Proveedor activado')) onListo() }}>{prov.activo ? 'Desactivar' : 'Activar'}</button>}
      <span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    <label className="campo">Nombre<input id="p-nom" value={f.nombre} onChange={set('nombre')} autoFocus /></label>
    <div className="two"><label className="campo">Rubro<input id="p-rubro" value={f.rubro} onChange={set('rubro')} placeholder="Carnicería, bebidas, verdulería…" /></label>
      <label className="campo">CUIT<input id="p-cuit" value={f.cuit} onChange={set('cuit')} /></label></div>
    <div className="two"><label className="campo">Contacto<input id="p-contacto" value={f.contacto} onChange={set('contacto')} /></label>
      <label className="campo">Teléfono / WhatsApp<input id="p-tel" type="tel" value={f.telefono} onChange={set('telefono')} /></label></div>
    <div className="two"><label className="campo">Mail<input id="p-mail" type="email" value={f.email} onChange={set('email')} /></label>
      <label className="campo">Plazo de pago (días)<input id="p-plazo" type="number" min={0} inputMode="numeric" value={f.plazo_dias} onChange={set('plazo_dias')} /><small>0 = se paga en el momento. Si tiene plazo, las compras quedan a pagar con vencimiento.</small></label></div>
    <label className="campo">Notas<textarea id="p-notas" rows={2} value={f.notas} onChange={set('notas')} placeholder="Días de entrega, pedido mínimo…" /></label>
    {err && <div className="err">{err}</div>}
  </Modal>
}
