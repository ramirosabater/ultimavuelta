import { useState } from 'react'
import { rpc, tabla, useConsulta } from '../lib/datos'
import { invocar, supabase } from '../lib/supabase'
import { bruto, hoy, num, pct, plata } from '../lib/formato'
import { MOTIVOS_MERMA, UNIDADES, type Cuenta, type Insumo, type Proveedor } from '../lib/tipos'
import { Modal, Pill, useAccion } from './ui'

/** Artículos, proveedores y cuentas: lo que usan casi todas las pantallas de stock */
export function useBaseStock() {
  return useConsulta(async () => {
    const [insumos, proveedores, cuentas] = await Promise.all([
      tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre')),
      tabla<Proveedor[]>(supabase.from('proveedores').select('*').order('nombre')),
      tabla<Cuenta[]>(supabase.from('cuentas').select('*').eq('activa', true).order('orden')),
    ])
    return { insumos, proveedores, cuentas }
  })
}

export function venceInfo(i: Insumo): { tono: '' | 'warn' | 'crit'; texto: string } | null {
  if (!i.vence) return null
  const d = Math.round((new Date(i.vence + 'T12:00').getTime() - new Date(hoy() + 'T12:00').getTime()) / 864e5)
  return d < 0 ? { tono: 'crit', texto: 'Vencido' } : d === 0 ? { tono: 'crit', texto: 'Vence hoy' } : d <= 2 ? { tono: 'warn', texto: `Vence en ${d} d` } : { tono: '', texto: new Date(i.vence + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) }
}
export const estadoStock = (v: number, min: number) => v <= 0 ? <Pill tono="crit">Agotado</Pill> : v <= min ? <Pill tono="warn">Reponer</Pill> : <Pill tono="ok">OK</Pill>
export function pillCosto(fc: number | null, objetivo = 0.35) {
  if (fc == null) return <Pill>Sin receta</Pill>
  return <Pill tono={fc <= objetivo - 0.05 ? 'ok' : fc <= objetivo ? 'warn' : 'crit'}>{Math.round(fc * 100)}% costo</Pill>
}

/** Selector de pago: queda a pagar o se pagó desde una cuenta */
export function SelectPago({ id, valor, onCambio, cuentas }: { id: string; valor: string; onCambio: (v: string) => void; cuentas: Cuenta[] }) {
  return <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)}>
    <option value="pendiente">Queda a pagar (cuenta corriente)</option>
    {cuentas.map((c) => <option key={c.id} value={String(c.id)}>Pagado con {c.nombre}</option>)}
  </select>
}
export function pagoPorDefecto(p: Proveedor | undefined, cuentas: Cuenta[]) {
  return p && p.plazo_dias > 0 ? 'pendiente' : String(cuentas.find((c) => c.tipo === 'Efectivo')?.id ?? cuentas[0]?.id ?? 'pendiente')
}

// ------------------------------------------------------------------ alta y edición de artículos
export function ArticuloForm({ insumo, proveedores, onCerrar, onListo }: { insumo: Insumo | null; proveedores: Proveedor[]; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({
    nombre: insumo?.nombre ?? '', unidad: insumo?.unidad ?? 'kg', costo: String(insumo?.costo ?? ''), cantidad: String(insumo?.cantidad ?? 0),
    minimo: String(insumo?.minimo ?? 0), merma_pct: String(insumo?.merma_pct ?? 0), pack: String(insumo?.pack ?? ''), pack_nombre: insumo?.pack_nombre ?? '',
    proveedor_id: insumo?.proveedor_id ? String(insumo.proveedor_id) : '', vence: insumo?.vence ?? '',
  })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (!f.nombre.trim()) { setErr('Poné un nombre.'); return }
    const fila = {
      nombre: f.nombre.trim(), unidad: f.unidad.trim() || 'u.', costo: Number(f.costo) || 0, minimo: Number(f.minimo) || 0,
      merma_pct: Math.min(90, Math.max(0, Number(f.merma_pct) || 0)), pack: Number(f.pack) || null, pack_nombre: f.pack_nombre.trim() || null,
      proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null, vence: f.vence || null,
      ...(insumo ? {} : { cantidad: Number(f.cantidad) || 0 }),
    }
    const ok = await correr(async () => {
      const { error } = insumo ? await supabase.from('insumos').update(fila).eq('id', insumo.id) : await supabase.from('insumos').insert(fila)
      if (error) throw new Error(error.code === '23505' ? 'Ya hay un artículo con ese nombre.' : error.message)
    }, 'Artículo guardado')
    if (ok) onListo()
  }
  async function borrar() {
    const ok = await correr(async () => {
      const { error } = await supabase.from('insumos').delete().eq('id', insumo!.id)
      if (error) throw new Error(error.code === '23503' ? 'Lo usa alguna receta: sacalo de las recetas o desactivalo.' : error.message)
    }, 'Artículo eliminado')
    if (ok) onListo()
  }
  return <Modal titulo={insumo ? 'Editar artículo' : 'Nuevo artículo'} onCerrar={onCerrar}
    pie={<>{insumo && <button className="btn ghost danger" disabled={ocupado} onClick={borrar}>Eliminar</button>}
      {insumo && <button className="btn ghost" disabled={ocupado} onClick={async () => { if (await correr(async () => { await supabase.from('insumos').update({ activo: !insumo.activo }).eq('id', insumo.id) }, insumo.activo ? 'Artículo desactivado' : 'Artículo activado')) onListo() }}>{insumo.activo ? 'Desactivar' : 'Activar'}</button>}
      <span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    <label className="campo">Nombre<input id="i-nom" value={f.nombre} onChange={set('nombre')} placeholder="Vacío, papas, gin…" autoFocus /></label>
    <div className="two">
      <label className="campo">Unidad<input id="i-un" list="i-unidades" value={f.unidad} onChange={set('unidad')} /><datalist id="i-unidades">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist></label>
      <label className="campo">Costo por unidad ($)<input id="i-costo" type="number" step="any" min={0} inputMode="decimal" value={f.costo} onChange={set('costo')} /></label>
    </div>
    <div className="two">
      {!insumo && <label className="campo">Hay ahora<input id="i-cant" type="number" step="any" inputMode="decimal" value={f.cantidad} onChange={set('cantidad')} /></label>}
      <label className="campo">Mínimo (avisar debajo de)<input id="i-min" type="number" step="any" inputMode="decimal" value={f.minimo} onChange={set('minimo')} /></label>
    </div>
    <label className="campo">Merma de limpieza (%)<input id="i-merma" type="number" step="any" min={0} max={90} inputMode="decimal" value={f.merma_pct} onChange={set('merma_pct')} />
      <small>Lo que se pierde al limpiar o porcionar. Ej.: vacío 12 %, mollejas 25 %, papas 20 %. Mejor medirlo en Rendimientos.</small></label>
    <div className="two">
      <label className="campo">Se compra de a (cantidad)<input id="i-pack" type="number" step="any" min={0} inputMode="decimal" value={f.pack} onChange={set('pack')} placeholder="Ej.: 10" /></label>
      <label className="campo">Presentación<input id="i-packn" value={f.pack_nombre} onChange={set('pack_nombre')} placeholder="bolsa, caja, barril" /></label>
    </div>
    <div className="two">
      <label className="campo">Proveedor<select id="i-prov" value={f.proveedor_id} onChange={set('proveedor_id')}><option value="">Sin proveedor</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="campo">Vence<input id="i-vence" type="date" value={f.vence} onChange={set('vence')} /></label>
    </div>
    {err && <div className="err">{err}</div>}
  </Modal>
}

// ------------------------------------------------------------------ compra de un artículo ("Llegó")
export function CompraModal({ insumo, cantidad, proveedores, cuentas, onCerrar, onListo }: { insumo: Insumo; cantidad?: number; proveedores: Proveedor[]; cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const prov = proveedores.find((p) => p.id === insumo.proveedor_id)
  const [c, setC] = useState(cantidad ? String(cantidad) : '')
  const [t, setT] = useState(cantidad && insumo.costo ? String(Math.round(cantidad * insumo.costo)) : '')
  const [vence, setVence] = useState('')
  const [pago, setPago] = useState(pagoPorDefecto(prov, cuentas))
  const { correr, ocupado } = useAccion()
  const cu = Number(c) > 0 && Number(t) > 0 ? Number(t) / Number(c) : null
  return <Modal titulo={`Compra · ${insumo.nombre}`} onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !(Number(c) > 0)} onClick={async () => {
    if (await correr(() => rpc('registrar_compra', { p_items: [{ insumo_id: insumo.id, cantidad: Number(c), total: Number(t) || 0, vence: vence || null }], p_proveedor: insumo.proveedor_id, p_pago: pago }), 'Compra cargada')) onListo()
  }}>Sumar al stock</button></>}>
    <div className="two">
      <label className="campo">Cantidad que llegó ({insumo.unidad})<input id="k-cant" type="number" step="any" min={0} inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} autoFocus /></label>
      <label className="campo">Total pagado ($)<input id="k-tot" type="number" step="any" min={0} inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} /></label>
    </div>
    <div className="two">
      <label className="campo">Vence (opcional)<input id="k-vence" type="date" value={vence} onChange={(e) => setVence(e.target.value)} /></label>
      <label className="campo">Pago<SelectPago id="k-pago" valor={pago} onCambio={setPago} cuentas={cuentas} /></label>
    </div>
    {cu != null && <div className="muted" style={{ fontSize: 13 }}>Queda a {plata(cu)} por {insumo.unidad}{insumo.costo ? ` (antes ${plata(insumo.costo)}${Math.abs(cu / insumo.costo - 1) > 0.02 ? `, ${cu > insumo.costo ? 'subió' : 'bajó'} ${pct(Math.abs(cu / insumo.costo - 1))}` : ''})` : ''}</div>}
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Queda registrada en Gastos{prov ? ` de ${prov.nombre}` : ''}{pago === 'pendiente' && prov?.plazo_dias ? `, a pagar en ${prov.plazo_dias} días` : ''}.</p>
  </Modal>
}

// ------------------------------------------------------------------ merma
export function MermaModal({ insumos, inicial, onCerrar, onListo }: { insumos: Insumo[]; inicial?: number; onCerrar: () => void; onListo: () => void }) {
  const [iid, setIid] = useState(String(inicial ?? insumos[0]?.id ?? ''))
  const [c, setC] = useState(''), [motivo, setMotivo] = useState(MOTIVOS_MERMA[0]), [nota, setNota] = useState('')
  const { correr, ocupado } = useAccion()
  const i = insumos.find((x) => String(x.id) === iid)
  return <Modal titulo="Registrar merma" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !(Number(c) > 0)} onClick={async () => {
    if (await correr(() => rpc('registrar_merma', { p_insumo: Number(iid), p_cantidad: Number(c), p_motivo: motivo, p_nota: nota || null }), 'Merma registrada')) onListo()
  }}>Registrar</button></>}>
    <label className="campo">Artículo<select id="w-ins" value={iid} onChange={(e) => setIid(e.target.value)}>{insumos.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.unidad})</option>)}</select></label>
    <label className="campo">Cantidad tirada{i ? ` (${i.unidad})` : ''}<input id="w-cant" type="number" step="any" min={0} inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></label>
    <div className="campo">Motivo<div className="opts">{MOTIVOS_MERMA.map((m) => <button key={m} className="opt" aria-pressed={m === motivo} onClick={() => setMotivo(m)} style={{ fontSize: 13 }}>{m}</button>)}</div></div>
    <label className="campo">Nota (opcional)<input id="w-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: se cortó la cadena de frío" /></label>
    {i && Number(c) > 0 && <div className="muted" style={{ fontSize: 13 }}>Son {plata(Number(c) * i.costo)} tirados.</div>}
  </Modal>
}

// ------------------------------------------------------------------ conteo suelto de un artículo
export function ContarModal({ insumo, onCerrar, onListo }: { insumo: Insumo; onCerrar: () => void; onListo: () => void }) {
  const [v, setV] = useState('')
  const { correr, ocupado } = useAccion()
  const d = v === '' ? null : Number(v) - Number(insumo.cantidad)
  return <Modal titulo={`Contar · ${insumo.nombre}`} onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || v === ''} onClick={async () => {
    if (await correr(() => rpc('guardar_inventario', { p_items: [{ insumo_id: insumo.id, cantidad: Number(v) }], p_completo: false }), 'Conteo guardado')) onListo()
  }}>Guardar conteo</button></>}>
    <p style={{ margin: 0 }}>La app dice que hay <b className="mono">{num(insumo.cantidad)} {insumo.unidad}</b>. Contá lo que hay de verdad.</p>
    <label className="campo">Hay realmente ({insumo.unidad})<input id="z-real" type="number" step="any" min={0} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></label>
    {d != null && (d < 0 ? <div><Pill tono="crit">Faltan {num(-d)} {insumo.unidad}</Pill> Queda registrado como diferencia por {plata(-d * insumo.costo)}.</div>
      : d > 0 ? <div><Pill tono="ok">Sobran {num(d)} {insumo.unidad}</Pill> Revisá si falta cargar una compra.</div> : <Pill tono="ok">Coincide</Pill>)}
  </Modal>
}

// ------------------------------------------------------------------ factura con foto o PDF
interface LineaFactura { usar: boolean; insumo_id: string; texto: string; cantidad: string; total: string; dudoso: boolean }
interface Lectura { proveedor: string | null; proveedor_id: number | null; cuit: string | null; numero: string | null; fecha: string | null; total_factura: number | null; items: { insumo_id: number | null; texto: string; cantidad: number | null; total: number | null; dudoso: boolean }[] }

const aBase64 = (f: File) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => mal(new Error('No se pudo leer el archivo.')); r.readAsDataURL(f) })

/** Achica las fotos grandes del celular antes de mandarlas (menos espera y menos costo) */
async function prepararImagen(f: File): Promise<{ data: string; tipo: string }> {
  if (f.type === 'application/pdf') return { data: await aBase64(f), tipo: 'application/pdf' }
  try {
    const bmp = await createImageBitmap(f)
    const esc = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc)
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/jpeg', 0.85))
    if (blob) return { data: await aBase64(new File([blob], 'factura.jpg')), tipo: 'image/jpeg' }
  } catch { /* si el navegador no puede, se manda como está */ }
  return { data: await aBase64(f), tipo: f.type || 'image/jpeg' }
}

export function FacturaModal({ archivo, insumos, proveedores, cuentas, onCerrar, onListo }: { archivo: File; insumos: Insumo[]; proveedores: Proveedor[]; cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const lectura = useConsulta(async () => {
    const { data: d, tipo } = await prepararImagen(archivo)
    const { data, error } = await invocar<Lectura>('ia', { tipo: 'factura', archivo: d, media_type: tipo })
    if (error || !data) throw new Error(error ?? 'No se pudo leer la factura.')
    if (!data.items.length) throw new Error('No encontré líneas de productos. Probá con una foto más nítida y derecha.')
    return data
  }, [archivo])
  if (lectura.error) return <Modal titulo="No se pudo leer" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn" onClick={onCerrar}>Cerrar</button></>}>
    <p style={{ margin: 0 }}>{lectura.error}</p><p className="muted" style={{ margin: 0, fontSize: 13 }}>Podés cargar la compra a mano con el botón Llegó de cada artículo.</p></Modal>
  if (!lectura.datos) return <Modal titulo="Leyendo la factura" onCerrar={onCerrar}><div className="notice"><b>Leyendo {archivo.type === 'application/pdf' ? 'el PDF' : 'la foto'}…</b><br />Puede tardar hasta un minuto.</div></Modal>
  return <RevisarFactura l={lectura.datos} insumos={insumos} proveedores={proveedores} cuentas={cuentas} onCerrar={onCerrar} onListo={onListo} />
}

function RevisarFactura({ l, insumos, proveedores, cuentas, onCerrar, onListo }: { l: Lectura; insumos: Insumo[]; proveedores: Proveedor[]; cuentas: Cuenta[]; onCerrar: () => void; onListo: () => void }) {
  const [prov, setProv] = useState(l.proveedor_id ? String(l.proveedor_id) : l.proveedor ? 'nuevo' : '')
  const [numero, setNumero] = useState(l.numero ?? '')
  const [fechaF, setFechaF] = useState(l.fecha ?? hoy())
  const [pago, setPago] = useState(pagoPorDefecto(proveedores.find((p) => String(p.id) === prov), cuentas))
  const [filas, setFilas] = useState<LineaFactura[]>(l.items.map((x) => ({ usar: !!x.insumo_id, insumo_id: x.insumo_id ? String(x.insumo_id) : '', texto: x.texto, cantidad: x.cantidad ? String(x.cantidad) : '', total: x.total ? String(x.total) : '', dudoso: x.dudoso })))
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const cambiar = (k: number, c: Partial<LineaFactura>) => setFilas((fs) => fs.map((f, i) => i === k ? { ...f, ...c } : f))
  const total = filas.filter((f) => f.usar).reduce((s, f) => s + (Number(f.total) || 0), 0)
  const activos = insumos.filter((i) => i.activo)
  async function cargar() {
    const usar = filas.filter((f) => f.usar)
    if (!usar.length) { setErr('Marcá al menos una línea para cargar.'); return }
    if (usar.some((f) => !f.insumo_id || !(Number(f.cantidad) > 0))) { setErr('Cada línea marcada necesita artículo y cantidad.'); return }
    const ok = await correr(() => rpc('registrar_compra', {
      p_items: usar.map((f) => ({ insumo_id: Number(f.insumo_id), cantidad: Number(f.cantidad), total: Number(f.total) || 0 })),
      p_proveedor: prov && prov !== 'nuevo' ? Number(prov) : null, p_proveedor_nuevo: prov === 'nuevo' ? l.proveedor : null,
      p_numero: numero || null, p_fecha: fechaF || null, p_pago: pago,
    }), `Factura cargada: ${usar.length} artículos`)
    if (ok) onListo()
  }
  return <Modal titulo="Revisar factura" onCerrar={onCerrar} ancho={680} pie={<>
    <div className="grow"><div className="label">Total a cargar</div><div className="mono" style={{ fontWeight: 600, fontSize: 18 }}>{plata(total)}{l.total_factura ? <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> · factura: {plata(l.total_factura)}</span> : null}</div></div>
    <button className="btn pri" disabled={ocupado} onClick={cargar}>Cargar compra</button></>}>
    <div className="two">
      <label className="campo">Proveedor<select id="f-prov" value={prov} onChange={(e) => { setProv(e.target.value); setPago(pagoPorDefecto(proveedores.find((p) => String(p.id) === e.target.value), cuentas)) }}>
        <option value="">Sin proveedor</option>
        {l.proveedor && !l.proveedor_id && <option value="nuevo">Crear «{l.proveedor}»</option>}
        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="campo">Fecha<input id="f-fecha" type="date" value={fechaF} onChange={(e) => setFechaF(e.target.value)} /></label>
    </div>
    <div className="two">
      <label className="campo">Número<input id="f-num" value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
      <label className="campo">Pago<SelectPago id="f-pago" valor={pago} onCambio={setPago} cuentas={cuentas} /></label>
    </div>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Revisá cada línea antes de cargar. Las cantidades van en la unidad de stock del artículo.</p>
    <div className="rows">{filas.map((f, k) => {
      const i = insumos.find((x) => String(x.id) === f.insumo_id), c = Number(f.cantidad), t = Number(f.total), nu = c > 0 && t > 0 ? t / c : null
      const d = nu && i?.costo ? nu / i.costo - 1 : null
      return <div key={k} className="row" style={{ alignItems: 'flex-start' }}>
        <label className="check" style={{ paddingTop: 8 }}><input type="checkbox" id={`fac-u-${k}`} checked={f.usar} onChange={(e) => cambiar(k, { usar: e.target.checked })} aria-label="Cargar esta línea" /></label>
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13 }}><span className="muted">En la factura:</span> {f.texto} {f.dudoso && <Pill tono="warn">Revisar</Pill>}</div>
          <select id={`fac-i-${k}`} value={f.insumo_id} onChange={(e) => cambiar(k, { insumo_id: e.target.value, usar: !!e.target.value || f.usar })}>
            <option value="">No es un artículo del local</option>{activos.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.unidad})</option>)}</select>
          <div className="two">
            <label className="campo">Cantidad{i ? ` (${i.unidad})` : ''}<input id={`fac-c-${k}`} type="number" step="any" min={0} inputMode="decimal" value={f.cantidad} onChange={(e) => cambiar(k, { cantidad: e.target.value })} /></label>
            <label className="campo">Total línea ($)<input id={`fac-t-${k}`} type="number" step="any" min={0} inputMode="decimal" value={f.total} onChange={(e) => cambiar(k, { total: e.target.value })} /></label>
          </div>
          {nu != null && i && <div style={{ fontSize: 13 }}><span className="mono">{plata(nu)} por {i.unidad}</span> {d != null && (d > 0.1 ? <Pill tono="crit">Subió {pct(d)}</Pill> : d > 0.02 ? <Pill tono="warn">Subió {pct(d)}</Pill> : d < -0.02 ? <Pill tono="ok">Bajó {pct(-d)}</Pill> : <Pill>Igual que antes</Pill>)}</div>}
        </div>
      </div>
    })}</div>
    {err && <div className="err">{err}</div>}
  </Modal>
}

/** Costo de una porción con la merma de limpieza */
export const costoPorcion = (receta: { insumo_id: number; cantidad: number }[], insumos: Insumo[]) =>
  receta.reduce((s, r) => { const i = insumos.find((x) => x.id === r.insumo_id); return s + (i ? bruto(r.cantidad, i.merma_pct) * i.costo : 0) }, 0)
