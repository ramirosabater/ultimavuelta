import { useState } from 'react'
import { rpc, tabla, traerTodo, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { diasEntre, fechaCorta, hoy, plata, sumarDias } from '../../lib/formato'
import { CAT_GASTO, type Cuenta, type Gasto, type Proveedor } from '../../lib/tipos'
import { SubNavAdmin } from './nav'
import { Cabeza, Modal, Pill, Stat, useAccion } from '../../components/ui'

/** "Vence en 3 días", "Vencido hace 2 días"… */
export function venceTexto(vence: string | null) {
  if (!vence) return <Pill tono="warn">Pendiente</Pill>
  const d = diasEntre(hoy(), vence)
  if (d < 0) return <Pill tono="crit">Vencido hace {-d} día{d === -1 ? '' : 's'}</Pill>
  if (d === 0) return <Pill tono="warn">Vence hoy</Pill>
  return <Pill tono={d <= 3 ? 'warn' : ''}>Vence {d === 1 ? 'mañana' : `en ${d} días`}</Pill>
}

export function PagarModal({ gasto, onCerrar, onListo }: { gasto: { id: number; concepto: string; monto: number }; onCerrar: () => void; onListo: () => void }) {
  const cuentas = useConsulta(() => tabla<Cuenta[]>(supabase.from('cuentas').select('*').eq('activa', true).order('orden')))
  const [cuenta, setCuenta] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const { correr, ocupado } = useAccion()
  const elegida = cuenta || String(cuentas.datos?.[0]?.id ?? '')
  return <Modal titulo="Registrar pago" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !elegida}
    onClick={async () => { if (await correr(() => rpc('pagar_gasto', { p_gasto: gasto.id, p_cuenta: Number(elegida), p_fecha: fecha }), 'Pago registrado')) onListo() }}>Pagar {plata(gasto.monto)}</button></>}>
    <p style={{ marginTop: 0 }}><b>{gasto.concepto}</b></p>
    <div className="two">
      <label className="campo">Sale de<select id="pg-cuenta" value={elegida} onChange={(e) => setCuenta(e.target.value)}>{(cuentas.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label className="campo">Fecha<input id="pg-fecha" type="date" value={fecha} max={hoy()} onChange={(e) => setFecha(e.target.value)} /></label>
    </div>
  </Modal>
}

type Fila = Gasto & { proveedores: { nombre: string } | null; cuentas: { nombre: string } | null }

export default function Gastos() {
  const [desde, setDesde] = useState(sumarDias(hoy(), -30))
  const [cat, setCat] = useState('')
  const [estado, setEstado] = useState('')
  const base = useConsulta(async () => {
    const [provs, cuentas] = await Promise.all([
      tabla<Proveedor[]>(supabase.from('proveedores').select('*').eq('activo', true).order('nombre')),
      tabla<Cuenta[]>(supabase.from('cuentas').select('*').eq('activa', true).order('orden')),
    ])
    return { provs, cuentas }
  })
  const g = useConsulta(async () => {
    const [periodo, pendientes] = await Promise.all([
      traerTodo<Fila>((a, b) => supabase.from('gastos').select('*, proveedores(nombre), cuentas(nombre)').gte('fecha', desde).order('fecha', { ascending: false }).order('id', { ascending: false }).range(a, b)),
      tabla<Fila[]>(supabase.from('gastos').select('*, proveedores(nombre), cuentas(nombre)').eq('estado', 'pendiente').order('vence', { nullsFirst: true })),
    ])
    return { periodo, pendientes }
  }, [desde])
  const [ventana, setVentana] = useState<null | { t: 'nuevo' } | { t: 'editar'; g: Fila } | { t: 'pagar'; g: Fila }>(null)
  const listo = () => { setVentana(null); g.recargar() }

  if (g.error) return <div className="aviso bad">{g.error}</div>
  if (!g.datos || !base.datos) return <><SubNavAdmin /><p className="cargando">Cargando gastos…</p></>
  const lista = g.datos.periodo.filter((x) => (!cat || x.categoria === cat) && (!estado || x.estado === estado))
  const total = lista.reduce((s, x) => s + Number(x.monto), 0)
  const deuda = g.datos.pendientes.reduce((s, x) => s + Number(x.monto), 0)
  const vencido = g.datos.pendientes.filter((x) => x.vence && x.vence < hoy()).reduce((s, x) => s + Number(x.monto), 0)

  return <>
    <Cabeza etiqueta="Administración" titulo="Gastos"><button className="btn pri" data-ayuda="nuevo-gasto" onClick={() => setVentana({ t: 'nuevo' })}>Nuevo gasto</button></Cabeza>
    <SubNavAdmin />
    <div className="stats" style={{ marginBottom: 16 }}>
      <Stat label="Gastos en la lista" valor={plata(total)} extra={<span className="muted">{lista.length} gasto{lista.length === 1 ? '' : 's'}</span>} />
      <Stat label="A pagar" valor={plata(deuda)} extra={<span className="muted">{g.datos.pendientes.length} pendiente{g.datos.pendientes.length === 1 ? '' : 's'}</span>} />
      <Stat label="Vencido" valor={<span style={{ color: vencido ? 'var(--crit)' : 'inherit' }}>{plata(vencido)}</span>} />
    </div>

    <section className="panel" style={{ marginBottom: 16 }} data-ayuda="por-pagar">
      <h3 style={{ marginBottom: 8 }}>Por pagar</h3>
      {g.datos.pendientes.length ? <div className="rows">{g.datos.pendientes.map((x) => <div className="row" key={x.id}>
        <div className="grow"><b>{x.concepto}</b><div className="muted" style={{ fontSize: 12 }}>{x.proveedores?.nombre || x.categoria} · {fechaCorta(x.fecha)}</div></div>
        {venceTexto(x.vence)}<span className="num mono">{plata(x.monto)}</span>
        <button className="btn sm" onClick={() => setVentana({ t: 'pagar', g: x })}>Pagar</button></div>)}</div>
        : <div className="kempty">No debés nada. 🎉</div>}
    </section>

    <section className="panel">
      <div className="fila" style={{ marginBottom: 10 }}>
        <h3 className="grow">Todos los gastos</h3>
        <label className="campo flt"><span>Desde</span><input id="g-desde" type="date" value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
        <label className="campo flt"><span>Categoría</span><select id="g-cat" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas</option>{CAT_GASTO.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="campo flt"><span>Estado</span><select id="g-estado" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option value="pagado">Pagados</option><option value="pendiente">Pendientes</option></select></label>
      </div>
      {lista.length ? <div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Proveedor</th><th>Estado</th><th className="r">Monto</th><th /></tr></thead><tbody>
        {lista.map((x) => <tr key={x.id}><td className="mono">{fechaCorta(x.fecha)}</td><td><b>{x.concepto}</b>{x.origen !== 'manual' && <div className="muted" style={{ fontSize: 12 }}>{x.origen === 'compra' ? 'De una compra' : 'Pagado con la caja'}</div>}</td>
          <td className="muted">{x.categoria}</td><td className="muted">{x.proveedores?.nombre || '—'}</td>
          <td>{x.estado === 'pagado' ? <Pill tono="ok">{x.cuentas?.nombre ?? 'Pagado'}</Pill> : venceTexto(x.vence)}</td>
          <td className="r mono">{plata(x.monto)}</td><td className="r"><button className="btn sm ghost" onClick={() => setVentana({ t: 'editar', g: x })}>Editar</button></td></tr>)}
      </tbody></table></div> : <div className="kempty">No hay gastos con estos filtros.</div>}
    </section>

    {ventana?.t === 'pagar' && <PagarModal gasto={ventana.g} onCerrar={() => setVentana(null)} onListo={listo} />}
    {(ventana?.t === 'nuevo' || ventana?.t === 'editar') && <GastoForm gasto={ventana.t === 'editar' ? ventana.g : null} provs={base.datos.provs} cuentas={base.datos.cuentas} onCerrar={() => setVentana(null)} onListo={listo} />}
  </>
}

function GastoForm({ gasto, provs, cuentas, onCerrar, onListo }: { gasto: Gasto | null; provs: Proveedor[]; cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    concepto: gasto?.concepto ?? '', categoria: gasto?.categoria ?? 'Otros', monto: String(gasto?.monto ?? ''), fecha: gasto?.fecha ?? hoy(),
    proveedor_id: gasto?.proveedor_id ? String(gasto.proveedor_id) : '', pago: gasto ? (gasto.estado === 'pendiente' ? 'pendiente' : String(gasto.cuenta_id)) : String(cuentas[0]?.id ?? 'pendiente'),
    vence: gasto?.vence ?? '', nota: gasto?.nota ?? '',
  })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const deCompra = gasto?.origen === 'compra' || gasto?.origen === 'caja'
  function elegirProv(id: string) {
    const p = provs.find((x) => String(x.id) === id)
    setF({ ...f, proveedor_id: id, ...(p && p.plazo_dias > 0 && !gasto ? { pago: 'pendiente', vence: sumarDias(f.fecha, p.plazo_dias) } : {}) })
  }
  async function guardar() {
    if (!f.concepto.trim()) { setErr('Poné qué es.'); return }
    if (!(Number(f.monto) > 0)) { setErr('Poné el monto.'); return }
    const pend = f.pago === 'pendiente'
    const fila = {
      concepto: f.concepto.trim(), categoria: f.categoria, monto: Number(f.monto), fecha: f.fecha, proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null,
      estado: pend ? 'pendiente' : 'pagado', cuenta_id: pend ? null : Number(f.pago), pagado_el: pend ? null : (gasto?.pagado_el ?? f.fecha), vence: pend ? (f.vence || null) : null, nota: f.nota.trim() || null,
    }
    const ok = await correr(async () => {
      const { error } = gasto ? await supabase.from('gastos').update(fila).eq('id', gasto.id) : await supabase.from('gastos').insert(fila)
      if (error) throw new Error(error.message)
    }, 'Gasto guardado')
    if (ok) onListo()
  }
  async function borrar() {
    if (!window.confirm('¿Borrar este gasto?')) return
    if (await correr(async () => { const { error } = await supabase.from('gastos').delete().eq('id', gasto!.id); if (error) throw new Error(error.message) }, 'Gasto borrado')) onListo()
  }
  return <Modal titulo={gasto ? 'Editar gasto' : 'Nuevo gasto'} onCerrar={onCerrar}
    pie={<>{gasto && <button className="btn ghost danger" disabled={ocupado} onClick={borrar}>Borrar</button>}<span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    {deCompra && <div className="notice" style={{ marginBottom: 10 }}>Este gasto se generó {gasto?.origen === 'compra' ? 'al cargar una compra' : 'desde la caja'}. Si cambiás el monto, el stock no se toca.</div>}
    <label className="campo">Concepto<input id="g-concepto" value={f.concepto} onChange={set('concepto')} placeholder="Alquiler de noviembre, luz, sueldo Juan…" autoFocus /></label>
    <div className="two">
      <label className="campo">Categoría<select id="g-categoria" value={f.categoria} onChange={set('categoria')}>{CAT_GASTO.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="campo">Monto ($)<input id="g-monto" type="number" step="any" min={0} inputMode="decimal" value={f.monto} onChange={set('monto')} /></label>
    </div>
    <div className="two">
      <label className="campo">Fecha<input id="g-fecha" type="date" value={f.fecha} onChange={set('fecha')} /></label>
      <label className="campo">Proveedor<select id="g-prov" value={f.proveedor_id} onChange={(e) => elegirProv(e.target.value)}><option value="">Sin proveedor</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
    </div>
    <div className="two">
      <label className="campo">Pago<select id="g-pago" value={f.pago} onChange={set('pago')}><option value="pendiente">Queda pendiente</option>{cuentas.map((c) => <option key={c.id} value={c.id}>Pagado con {c.nombre}</option>)}</select></label>
      {f.pago === 'pendiente' && <label className="campo">Vence<input id="g-vence" type="date" value={f.vence} onChange={set('vence')} /></label>}
    </div>
    <label className="campo">Nota<input id="g-nota" value={f.nota} onChange={set('nota')} /></label>
    {err && <div className="err">{err}</div>}
  </Modal>
}
