import { useState } from 'react'
import { rpc, tabla, traerTodo, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { diasEntre, fechaCorta, hoy, plata, sumarDias } from '../../lib/formato'
import { CAT_GASTO, type Cuenta, type Gasto, type GastoFijo, type Proveedor } from '../../lib/tipos'
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

export function PagarModal({ gasto, cuentaSugerida, onCerrar, onListo }: { gasto: { id: number; concepto: string; monto: number }; cuentaSugerida?: number | null; onCerrar: () => void; onListo: () => void }) {
  const cuentas = useConsulta(() => tabla<Cuenta[]>(supabase.from('cuentas').select('*').eq('activa', true).order('orden')))
  const [cuenta, setCuenta] = useState(cuentaSugerida ? String(cuentaSugerida) : '')
  const [fecha, setFecha] = useState(hoy())
  const [monto, setMonto] = useState(Number(gasto.monto) > 0 ? String(gasto.monto) : '')
  const { correr, ocupado } = useAccion()
  const elegida = cuenta || String(cuentas.datos?.[0]?.id ?? '')
  const m = Number(monto)
  return <Modal titulo="Registrar pago" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" id="pg-ok" disabled={ocupado || !elegida || !(m > 0)}
    onClick={async () => { if (await correr(() => rpc('pagar_gasto', { p_gasto: gasto.id, p_cuenta: Number(elegida), p_fecha: fecha, p_monto: m }), 'Pago registrado')) onListo() }}>{m > 0 ? `Pagar ${plata(m)}` : 'Pagar'}</button></>}>
    <p style={{ marginTop: 0 }}><b>{gasto.concepto}</b></p>
    <label className="campo">Monto ($){Number(gasto.monto) > 0 ? null : <small>Poné lo que vino en la factura de este mes.</small>}<input id="pg-monto" type="number" step="any" min={0} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus={!(Number(gasto.monto) > 0)} /></label>
    <div className="two">
      <label className="campo">Se paga con<select id="pg-cuenta" value={elegida} onChange={(e) => setCuenta(e.target.value)}>{(cuentas.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
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
    await rpc('generar_gastos_fijos').catch(() => 0)
    const [periodo, pendientes, fijos] = await Promise.all([
      traerTodo<Fila>((a, b) => supabase.from('gastos').select('*, proveedores(nombre), cuentas(nombre)').gte('fecha', desde).order('fecha', { ascending: false }).order('id', { ascending: false }).range(a, b)),
      tabla<Fila[]>(supabase.from('gastos').select('*, proveedores(nombre), cuentas(nombre)').eq('estado', 'pendiente').order('vence', { nullsFirst: true })),
      tabla<GastoFijo[]>(supabase.from('gastos_fijos').select('*').order('dia').order('concepto')),
    ])
    return { periodo, pendientes, fijos }
  }, [desde])
  const [ventana, setVentana] = useState<null | { t: 'nuevo' } | { t: 'editar'; g: Fila } | { t: 'pagar'; g: Fila } | { t: 'fijo'; f: GastoFijo | null }>(null)
  const listo = () => { setVentana(null); g.recargar() }

  if (g.error) return <div className="aviso bad">{g.error}</div>
  if (!g.datos || !base.datos) return <><SubNavAdmin /><p className="cargando">Cargando gastos…</p></>
  const lista = g.datos.periodo.filter((x) => (!cat || x.categoria === cat) && (!estado || x.estado === estado))
  const total = lista.reduce((s, x) => s + Number(x.monto), 0)
  const deuda = g.datos.pendientes.reduce((s, x) => s + Number(x.monto), 0)
  const { fijos } = g.datos
  const mesActual = hoy().slice(0, 8) + '01'
  const vencido = g.datos.pendientes.filter((x) => x.vence && x.vence < hoy()).reduce((s, x) => s + Number(x.monto), 0)

  return <>
    <Cabeza etiqueta="Administración" titulo="Gastos">
      <button className="btn" data-ayuda="nuevo-fijo" onClick={() => setVentana({ t: 'fijo', f: null })}>＋ Gasto fijo mensual</button>
      <button className="btn pri" data-ayuda="nuevo-gasto" onClick={() => setVentana({ t: 'nuevo' })}>Nuevo gasto</button></Cabeza>
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
        {x.fijo_id && <Pill tono="acc">fijo</Pill>}{venceTexto(x.vence)}<span className="num mono">{Number(x.monto) > 0 ? plata(x.monto) : <span className="muted" style={{ fontSize: 12 }}>monto a cargar</span>}</span>
        <button className="btn sm" onClick={() => setVentana({ t: 'pagar', g: x })}>Pagar</button></div>)}</div>
        : <div className="kempty">No debés nada. 🎉</div>}
    </section>

    <section className="panel" style={{ marginBottom: 16 }} data-ayuda="gastos-fijos">
      <div className="fila" style={{ marginBottom: 4 }}><h3 className="grow">Gastos fijos mensuales</h3>
        <button className="btn sm" onClick={() => setVentana({ t: 'fijo', f: null })}>＋ Agregar</button></div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', maxWidth: '75ch' }}>Luz, gas, agua, alquiler, internet, contador… Se cargan una vez: <b>cada mes aparecen solos en “Por pagar”</b> con su vencimiento. Al pagarlos ponés el monto de la factura de ese mes y de qué caja sale.</p>
      {fijos.length ? <div className="tbl-wrap"><table><thead><tr><th>Concepto</th><th>Vence</th><th className="r">Monto</th><th>Se paga con</th><th>Este mes</th><th /></tr></thead><tbody>
        {fijos.map((f) => { const este = g.datos!.periodo.concat(g.datos!.pendientes).find((x) => x.fijo_id === f.id && x.periodo === mesActual)
          return <tr key={f.id} style={f.activo ? undefined : { opacity: 0.5 }}><td><b>{f.concepto}</b><div className="muted" style={{ fontSize: 12 }}>{f.categoria}{f.proveedor_id ? ` · ${base.datos!.provs.find((p) => p.id === f.proveedor_id)?.nombre ?? ''}` : ''}</div></td>
            <td className="mono">día {f.dia}</td><td className="r mono">{f.monto != null ? plata(f.monto) : <span className="muted">varía</span>}</td>
            <td className="muted">{base.datos!.cuentas.find((c) => c.id === f.cuenta_id)?.nombre ?? '—'}</td>
            <td>{!f.activo ? <Pill>Pausado</Pill> : !este ? <span className="muted">—</span> : este.estado === 'pagado' ? <Pill tono="ok">Pagado {plata(este.monto)}</Pill>
              : <button className="btn sm" onClick={() => setVentana({ t: 'pagar', g: este })}>Pagar</button>}</td>
            <td className="r"><button className="btn sm ghost" onClick={() => setVentana({ t: 'fijo', f })}>Editar</button></td></tr> })}
      </tbody></table></div> : <div className="kempty">Todavía no hay gastos fijos. Tocá <b>＋ Agregar</b> y cargá la luz, el gas, el alquiler…</div>}
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

    {ventana?.t === 'pagar' && <PagarModal gasto={ventana.g} cuentaSugerida={fijos.find((f) => f.id === ventana.g.fijo_id)?.cuenta_id} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana?.t === 'fijo' && <GastoFijoForm fijo={ventana.f} provs={base.datos.provs} cuentas={base.datos.cuentas} onCerrar={() => setVentana(null)} onListo={listo} />}
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

function GastoFijoForm({ fijo, provs, cuentas, onCerrar, onListo }: { fijo: GastoFijo | null; provs: Proveedor[]; cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    concepto: fijo?.concepto ?? '', categoria: fijo?.categoria ?? 'Luz, gas y agua', dia: String(fijo?.dia ?? 10), varia: fijo ? fijo.monto == null : true,
    monto: fijo?.monto != null ? String(fijo.monto) : '', cuenta_id: fijo?.cuenta_id ? String(fijo.cuenta_id) : String(cuentas[0]?.id ?? ''),
    proveedor_id: fijo?.proveedor_id ? String(fijo.proveedor_id) : '', nota: fijo?.nota ?? '',
  })
  const [yaPago, setYaPago] = useState<boolean | null>(null)
  const diaHoy = Number(hoy().slice(8, 10))
  const empiezaDespues = !fijo && (yaPago ?? Number(f.dia) < diaHoy)
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (f.concepto.trim().length < 2) { setErr('Poné qué es: luz, gas, alquiler…'); return }
    const dia = Math.round(Number(f.dia))
    if (!(dia >= 1 && dia <= 28)) { setErr('El día de vencimiento va del 1 al 28.'); return }
    if (!f.varia && !(Number(f.monto) > 0)) { setErr('Poné el monto, o marcá que cambia cada mes.'); return }
    const fila = { concepto: f.concepto.trim(), categoria: f.categoria, dia, monto: f.varia ? null : Number(f.monto), cuenta_id: f.cuenta_id ? Number(f.cuenta_id) : null,
      proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null, nota: f.nota.trim() || null,
      ...(fijo ? {} : { desde: empiezaDespues ? sumarDias(hoy().slice(0, 8) + '28', 7).slice(0, 8) + '01' : hoy().slice(0, 8) + '01' }) }
    if (await correr(async () => {
      const { error } = fijo ? await supabase.from('gastos_fijos').update(fila).eq('id', fijo.id) : await supabase.from('gastos_fijos').insert(fila)
      if (error) throw new Error(error.message)
    }, fijo ? 'Gasto fijo guardado' : empiezaDespues ? 'Gasto fijo creado: aparece el mes que viene' : 'Gasto fijo creado: ya aparece en Por pagar')) onListo()
  }
  async function pausar() {
    if (await correr(async () => { const { error } = await supabase.from('gastos_fijos').update({ activo: !fijo!.activo }).eq('id', fijo!.id); if (error) throw new Error(error.message) },
      fijo!.activo ? 'Pausado: no se genera más' : 'Activado otra vez')) onListo()
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar el gasto fijo "${fijo!.concepto}"? Los gastos de meses anteriores quedan.`)) return
    if (await correr(async () => { const { error } = await supabase.from('gastos_fijos').delete().eq('id', fijo!.id); if (error) throw new Error(error.message) }, 'Gasto fijo borrado')) onListo()
  }
  return <Modal titulo={fijo ? 'Editar gasto fijo' : 'Nuevo gasto fijo mensual'} onCerrar={onCerrar}
    pie={<>{fijo && <><button className="btn ghost danger" disabled={ocupado} onClick={borrar}>Borrar</button><button className="btn ghost" disabled={ocupado} onClick={pausar}>{fijo.activo ? 'Pausar' : 'Activar'}</button></>}
      <span className="grow" /><button className="btn pri" id="gf-ok" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    <label className="campo">Qué es<input id="gf-concepto" value={f.concepto} onChange={set('concepto')} placeholder="Luz (Camuzzi), alquiler, internet…" autoFocus list="gf-ideas" />
      <datalist id="gf-ideas">{['Luz', 'Gas', 'Agua', 'Alquiler', 'Internet', 'Teléfono', 'Contador', 'Seguro', 'Monotributo', 'Ingresos brutos', 'Tasa municipal', 'Alarma', 'Música (SADAIC/AADI)', 'Sistema de cobro'].map((x) => <option key={x} value={x} />)}</datalist></label>
    <div className="two">
      <label className="campo">Categoría<select id="gf-cat" value={f.categoria} onChange={set('categoria')}>{CAT_GASTO.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="campo">Vence el día<input id="gf-dia" type="number" min={1} max={28} inputMode="numeric" value={f.dia} onChange={set('dia')} /><small>de cada mes (1 a 28)</small></label>
    </div>
    <div className="campo">Monto
      <div className="opts">
        <button type="button" className="opt" aria-pressed={f.varia} onClick={() => setF({ ...f, varia: true })}>Cambia cada mes</button>
        <button type="button" className="opt" aria-pressed={!f.varia} onClick={() => setF({ ...f, varia: false })}>Siempre el mismo</button>
      </div>
      {f.varia ? <small>Cada mes aparece en “Por pagar” y al pagarlo ponés lo que vino en la factura.</small>
        : <input id="gf-monto" type="number" step="any" min={0} inputMode="decimal" placeholder="$" value={f.monto} onChange={set('monto')} />}
    </div>
    <div className="two">
      <label className="campo">Se paga con<select id="gf-cuenta" value={f.cuenta_id} onChange={set('cuenta_id')}><option value="">Elegir al pagar</option>{cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label className="campo">Proveedor (opcional)<select id="gf-prov" value={f.proveedor_id} onChange={set('proveedor_id')}><option value="">—</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
    </div>
    {!fijo && <label className="check"><input type="checkbox" id="gf-ya" checked={empiezaDespues} onChange={(e) => setYaPago(e.target.checked)} /> El de este mes ya está pagado o cargado (empieza el mes que viene)</label>}
    <label className="campo">Nota (opcional)<input id="gf-nota" value={f.nota} onChange={set('nota')} placeholder="N° de cliente, débito automático…" /></label>
    {err && <div className="err">{err}</div>}
  </Modal>
}
