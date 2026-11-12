import { useMemo, useState } from 'react'
import { rpc, tabla, useConsulta } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { fecha, jornada, plata } from '../lib/formato'
import type { Categoria, Factura, MedioPago, Mesa, PedidoItem, Producto, TipoCuenta } from '../lib/tipos'
import { Modal, Pill, useAccion } from './ui'
import { TIPOS_CUENTA, etiquetaMesa } from '../lib/mesas'
import { facturarTicket, type EstadoFacturacion, type Receptor } from '../lib/factura'
import { CamposReceptor, ResultadoFactura } from './facturas'

/** La carta para cargar pedidos (solo lo activo) */
export function useCarta() {
  return useConsulta(async () => {
    const [cats, prods] = await Promise.all([
      tabla<Categoria[]>(supabase.from('categorias').select('*').eq('activa', true).order('orden').order('nombre')),
      tabla<Producto[]>(supabase.from('productos').select('*').eq('activo', true).order('orden').order('nombre')),
    ])
    return { cats, prods }
  })
}

/** Lista de ítems con cantidad, nombre, nota y precio */
type ItemVista = Pick<PedidoItem, 'cantidad' | 'nombre' | 'nota' | 'precio'> & { cortesia?: boolean; id?: number }
export function Items({ items, precios = true, onItem }: { items: ItemVista[]; precios?: boolean; onItem?: (i: ItemVista) => void }) {
  return <ul className="items">{items.map((i, k) => <li key={i.id ?? k} style={{ flexDirection: 'column', gap: 0 }}>
    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="q">{i.cantidad}×</span><span>{i.nombre}{i.cortesia && <> <Pill tono="ok">invita la casa</Pill></>}</span>
      {precios && <span className="p">{plata(i.cantidad * i.precio)}</span>}
      {onItem && <button className="btn sm ghost item-mas" aria-label={`Corregir ${i.nombre}`} title="Sacar, invitar o pasar" onClick={() => onItem(i)}>⋯</button>}</span>
    {i.nota && <span className="nota">{i.nota}</span>}
  </li>)}</ul>
}

export function AbrirMesa({ mesa, onCerrar, onListo }: { mesa: Mesa; onCerrar: () => void; onListo: () => void }) {
  const [com, setCom] = useState('2')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={`Abrir ${etiquetaMesa(mesa).toLowerCase()}`} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
      if (await correr(() => rpc('abrir_mesa', { p_mesa: mesa.id, p_comensales: Number(com) || null }), `${etiquetaMesa(mesa)} abierta`)) onListo()
    }}>Abrir y cargar pedido</button></>}>
    <label className="campo">Comensales<input id="am-comensales" type="number" min={1} inputMode="numeric" value={com} onChange={(e) => setCom(e.target.value)} autoFocus /></label>
  </Modal>
}

interface Linea { producto: Producto; cantidad: number; nota: string }

export function CargarPedido({ mesa, onCerrar, onListo }: { mesa: Mesa; onCerrar: () => void; onListo: () => void }) {
  const { datos } = useCarta()
  const [cat, setCat] = useState<number | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [buscar, setBuscar] = useState('')
  const { correr, ocupado } = useAccion()
  const cats = datos?.cats.filter((c) => datos.prods.some((p) => p.categoria_id === c.id)) ?? []
  const catSel = cat ?? cats[0]?.id
  const visibles = (datos?.prods ?? []).filter((p) => buscar.trim() ? p.nombre.toLowerCase().includes(buscar.trim().toLowerCase()) : p.categoria_id === catSel)
  const total = lineas.reduce((s, l) => s + l.cantidad * l.producto.precio, 0)
  const sumar = (p: Producto, d: number) => setLineas((ls) => {
    const i = ls.findIndex((l) => l.producto.id === p.id)
    if (i < 0) return d > 0 ? [...ls, { producto: p, cantidad: d, nota: '' }] : ls
    const n = [...ls]; n[i] = { ...n[i], cantidad: n[i].cantidad + d }
    return n.filter((l) => l.cantidad > 0)
  })
  const enCarrito = (id: number) => lineas.find((l) => l.producto.id === id)?.cantidad ?? 0

  return <Modal titulo={`Pedido · ${etiquetaMesa(mesa)}`} onCerrar={onCerrar} ancho={720}
    pie={<><div className="grow"><div className="label">Total</div><div className="mono" style={{ fontWeight: 600, fontSize: 18 }}>{plata(total)}</div></div>
      <button className="btn pri" disabled={!lineas.length || ocupado} onClick={async () => {
        const items = lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad, nota: l.nota }))
        if (await correr(() => rpc('cargar_pedido', { p_mesa: mesa.id, p_items: items }), 'Comanda enviada')) onListo()
      }}>Enviar comanda</button></>}>
    <input id="ped-buscar" type="search" placeholder="Buscar en la carta…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
    {!buscar && <div className="chips">{cats.map((c) => {
      const n = lineas.filter((l) => l.producto.categoria_id === c.id).reduce((s, l) => s + l.cantidad, 0)
      return <button key={c.id} className="chip" aria-pressed={c.id === catSel} onClick={() => setCat(c.id)}>{c.nombre}{n ? ` · ${n}` : ''}</button>
    })}</div>}
    {!datos ? <p className="cargando">Cargando la carta…</p> : !datos.prods.length ? <div className="kempty">La carta está vacía. Cargá productos en Carta y QR.</div> :
      <div className="prod-grid">{visibles.map((p) => {
        const ago = p.controla_stock && p.stock <= 0, q = enCarrito(p.id)
        return <button key={p.id} className="prod-btn" disabled={ago} onClick={() => sumar(p, 1)} aria-label={`Agregar ${p.nombre}`}>
          <b>{p.nombre}</b><span className="mono">{ago ? 'Agotado' : plata(p.precio)}{p.controla_stock && !ago ? ` · quedan ${p.stock}` : ''}</span>
          {q > 0 && <span className="q">{q}</span>}
        </button>
      })}</div>}
    {lineas.length > 0 && <div className="carrito">
      <div className="label">En la comanda</div>
      {lineas.map((l) => <div key={l.producto.id} className="fila">
        <span className="stepper">
          <button onClick={() => sumar(l.producto, -1)} aria-label={`Quitar un ${l.producto.nombre}`}>−</button>
          <span className="num">{l.cantidad}</span>
          <button onClick={() => sumar(l.producto, 1)} aria-label={`Sumar un ${l.producto.nombre}`}>+</button>
        </span>
        <span className="grow"><b>{l.producto.nombre}</b></span>
        <input id={`nota-${l.producto.id}`} placeholder="Nota: punto, sin hielo…" value={l.nota} maxLength={140} style={{ flex: '1 1 180px', padding: '6px 10px', fontSize: 13 }}
          onChange={(e) => setLineas((ls) => ls.map((x) => x.producto.id === l.producto.id ? { ...x, nota: e.target.value } : x))} />
      </div>)}
    </div>}
  </Modal>
}

interface Pago { medio: string; monto: string }

/** Cobrar una mesa: medio (o medios) de pago, descuento, propina y cuánto paga cada uno */
export function Cobrar({ mesa, items, onCerrar, onListo }: { mesa: Mesa; items: ItemVista[]; onCerrar: () => void; onListo: () => void }) {
  const medios = useConsulta(() => tabla<MedioPago[]>(supabase.from('medios_pago').select('*').eq('activo', true).order('orden')))
  const destino = useConsulta(() => rpc<string>('jornada_caja'))
  const fac = useConsulta(() => rpc<EstadoFacturacion | null>('facturacion_estado').catch(() => null))
  const [conFactura, setConFactura] = useState<boolean | null>(null)
  const [receptor, setReceptor] = useState<Receptor>({})
  // Después de cobrar: el ticket y cómo salió la factura
  const [cobrado, setCobrado] = useState<{ id: number; total: number } | null>(null)
  const [factura, setFactura] = useState<Factura | null>(null)
  const [errFactura, setErrFactura] = useState('')
  const [facturando, setFacturando] = useState(false)
  const [medio, setMedio] = useState('')
  const [desc, setDesc] = useState('0')
  const [div, setDiv] = useState('1')
  const [propina, setPropina] = useState('')
  const [pagos, setPagos] = useState<Pago[] | null>(null)   // null: un solo medio
  const { correr, ocupado } = useAccion()
  const agrupados = useMemo(() => {
    const m = new Map<string, ItemVista>()
    for (const i of items) { const k = `${i.nombre}|${i.precio}|${i.cortesia ? 1 : 0}`; const x = m.get(k); if (x) x.cantidad += i.cantidad; else m.set(k, { cantidad: i.cantidad, nombre: i.nombre, precio: i.precio, nota: null, cortesia: i.cortesia }) }
    return [...m.values()]
  }, [items])
  const sub = agrupados.reduce((s, i) => s + i.cantidad * i.precio, 0)
  const d = Math.min(100, Math.max(0, Number(desc) || 0)), partes = Math.max(1, Math.floor(Number(div) || 1))
  const total = Math.round(sub * (1 - d / 100) * 100) / 100
  const prop = Math.max(0, Math.round(Number(propina) || 0))
  const aCobrar = total + prop
  const lista = medios.datos ?? []
  const elegido = medio || lista[0]?.nombre || ''
  const sumaPagos = (pagos ?? []).reduce((s, p) => s + (Number(p.monto) || 0), 0)
  const falta = pagos ? Math.round((aCobrar - sumaPagos) * 100) / 100 : 0
  const pagosOk = !pagos || (Math.abs(falta) < 1 && pagos.every((p) => p.medio && Number(p.monto) >= 0))
  const facturable = !!fac.datos?.activa
  const facturar = facturable && (conFactura ?? fac.datos!.facturar_siempre)
  const faltaDoc = facturar && total >= (fac.datos?.tope ?? Infinity) && !(receptor.doc_nro ?? '').replace(/\D/g, '')
  const cambiarPago = (k: number, c: Partial<Pago>) => setPagos((ps) => (ps ?? []).map((p, i) => (i === k ? { ...p, ...c } : p)))
  function dosMedios() {
    const otro = lista.find((m) => m.nombre !== elegido)?.nombre ?? elegido
    setPagos([{ medio: elegido, monto: '' }, { medio: otro, monto: '' }])
  }
  async function pedirFactura(t: { id: number; total: number }) {
    setFacturando(true); setErrFactura('')
    try { setFactura(await facturarTicket(t.id, receptor)) } catch (e) { setErrFactura(e instanceof Error ? e.message : String(e)) } finally { setFacturando(false) }
  }
  if (cobrado) return <Modal titulo={`${etiquetaMesa(mesa)} cobrada · ${plata(cobrado.total)}`} onCerrar={onListo}
    pie={<><span className="grow" /><button className="btn" onClick={onListo}>Listo</button></>}>
    {facturando && !factura && !errFactura ? <p className="muted">Pidiendo la factura a ARCA…</p>
      : <ResultadoFactura f={factura} error={errFactura} ocupado={facturando} onReintentar={() => pedirFactura(cobrado)} />}
  </Modal>
  return <Modal titulo={`Cobrar · ${etiquetaMesa(mesa)}`} onCerrar={onCerrar}
    pie={<><div className="grow"><div className="label">Total a cobrar</div><div className="mono" style={{ fontWeight: 600, fontSize: 22 }}>{plata(aCobrar)}</div>
      {prop > 0 && <small className="muted">{plata(total)} + {plata(prop)} de propina</small>}</div>
      <button className="btn pri" disabled={ocupado || !elegido || faltaDoc || !pagosOk} onClick={async () => {
        let t: { id: number; total: number } | null = null
        const args = { p_mesa: mesa.id, p_medio: pagos?.[0]?.medio ?? elegido, p_descuento: d, p_propina: prop,
          p_pagos: pagos ? pagos.filter((p) => Number(p.monto) > 0).map((p) => ({ medio: p.medio, monto: Number(p.monto) })) : null }
        const como = pagos ? pagos.filter((p) => Number(p.monto) > 0).map((p) => p.medio).join(' + ') : elegido
        if (!(await correr(async () => { t = await rpc<{ id: number; total: number }>('cobrar_mesa', args) }, `Cobrado ${plata(aCobrar)} · ${como}`))) return
        if (facturable && !facturar && t) await rpc('ticket_sin_factura', { p_ticket: (t as { id: number }).id, p_valor: true }).catch(() => {})
        if (!facturar || !t || Number((t as { total: number }).total) <= 0) { onListo(); return }
        setCobrado(t); pedirFactura(t)
      }}>{facturar ? 'Cobrar y facturar' : facturable ? 'Cobrar sin factura' : 'Confirmar cobro'}</button></>}>
    {destino.datos && destino.datos !== jornada() && <div className="notice">La caja de hoy ya está cerrada: este cobro va a la jornada del <b>{fecha(destino.datos)}</b>.</div>}
    <Items items={agrupados} />
    <div className="total-row" style={{ borderTopWidth: 1 }}><span className="label">Subtotal</span><span className="num" style={{ fontSize: 16 }}>{plata(sub)}</span></div>
    <div className="two">
      <label className="campo">Descuento %<input id="c-desc" type="number" min={0} max={100} inputMode="numeric" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <label className="campo">Dividir entre<input id="c-div" type="number" min={1} inputMode="numeric" value={div} onChange={(e) => setDiv(e.target.value)} /></label>
    </div>
    <div className="campo">Propina (opcional)
      <div className="fila" style={{ flexWrap: 'nowrap' }}>
        <input id="c-propina" type="number" min={0} inputMode="numeric" placeholder="$ 0" value={propina} onChange={(e) => setPropina(e.target.value)} />
        {[10, 15].map((p) => <button key={p} type="button" className="btn sm" onClick={() => setPropina(String(Math.round(total * p / 100 / 100) * 100))}>{p} %</button>)}
      </div>
      <small>Se suma al cobro y queda separada de la venta, para repartir entre el personal.</small>
    </div>
    {!pagos ? <div className="campo">Medio de pago<div className="opts" id="c-medios">{lista.map((m) =>
        <button key={m.nombre} className="opt" aria-pressed={m.nombre === elegido} onClick={() => setMedio(m.nombre)}>{m.nombre}</button>)}</div>
        {lista.length > 1 && <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={dosMedios}>Paga con más de un medio</button>}</div>
      : <div className="campo">Pagos
        {pagos.map((p, k) => <div key={k} className="fila" style={{ flexWrap: 'nowrap' }}>
          <select id={`c-pm-${k}`} aria-label="Medio" value={p.medio} onChange={(e) => cambiarPago(k, { medio: e.target.value })} style={{ flex: '1 1 50%' }}>
            {lista.map((m) => <option key={m.nombre} value={m.nombre}>{m.nombre}</option>)}</select>
          <input id={`c-pmonto-${k}`} type="number" min={0} inputMode="numeric" placeholder="$" value={p.monto} onChange={(e) => cambiarPago(k, { monto: e.target.value })} style={{ flex: '1 1 40%' }} />
          <button type="button" className="btn sm ghost" title="Completar con lo que falta" aria-label="Completar con lo que falta" disabled={falta <= 0}
            onClick={() => cambiarPago(k, { monto: String(Math.round(((Number(p.monto) || 0) + falta) * 100) / 100) })}>＝</button>
          {pagos.length > 2 && <button type="button" className="btn sm ghost danger" aria-label="Sacar este pago" onClick={() => setPagos(pagos.filter((_, i) => i !== k))}>✕</button>}
        </div>)}
        <div className="fila">
          <button type="button" className="btn sm ghost" onClick={() => setPagos([...pagos, { medio: elegido, monto: '' }])}>＋ Otro pago</button>
          <button type="button" className="btn sm ghost" onClick={() => setPagos(null)}>Un solo medio</button>
          <span className="grow" />
          {Math.abs(falta) < 1 ? <Pill tono="ok">Completo</Pill> : falta > 0 ? <Pill tono="warn">Falta {plata(falta)}</Pill> : <Pill tono="crit">Sobra {plata(-falta)}</Pill>}
        </div>
      </div>}
    {d > 0 && <div className="muted">Descuento: −{plata(sub - total)}</div>}
    {partes > 1 && <span className="pill acc" style={{ fontSize: 14, padding: '6px 12px', alignSelf: 'flex-start' }}>{plata(aCobrar / partes)} por persona</span>}
    {facturable && <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <label className="fila" style={{ gap: 8, fontWeight: 600 }}><input id="c-factura" type="checkbox" checked={facturar} onChange={(e) => setConFactura(e.target.checked)} style={{ width: 20, height: 20 }} />
        Hacer Factura C{fac.datos!.ambiente === 'homologacion' && <span className="pill">modo prueba</span>}</label>
      {facturar ? <CamposReceptor r={receptor} set={setReceptor} total={total} tope={fac.datos!.tope} />
        : <small className="muted">Esta venta se cobra sin factura. Si después hace falta, se factura desde la Caja.</small>}
    </div>}
  </Modal>
}

export function MoverMesa({ mesa, mesas, onCerrar, onListo }: { mesa: Mesa; mesas: Mesa[]; onCerrar: () => void; onListo: () => void }) {
  const libres = mesas.filter((m) => m.estado === 'libre' && m.activa && !m.temporal && m.id !== mesa.id)
  const [hacia, setHacia] = useState<number | ''>('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={`Pasar ${etiquetaMesa(mesa).toLowerCase()} a otra mesa`} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={!hacia || ocupado} onClick={async () => {
      const destino = mesas.find((m) => m.id === hacia)
      if (await correr(() => rpc('mover_mesa', { p_desde: mesa.id, p_hacia: hacia }), `Pasada a la mesa ${destino?.numero}`)) onListo()
    }}>Pasar</button></>}>
    <p style={{ margin: 0 }}>Todo lo que está cargado pasa a la mesa que elijas. Tiene que estar libre. Para pasar solo algunos productos, usá Separar o pasar productos.</p>
    {libres.length ? <div className="opts">{libres.map((m) => <button key={m.id} className="opt" aria-pressed={hacia === m.id} onClick={() => setHacia(m.id)}>Mesa {m.numero}</button>)}</div>
      : <div className="kempty">No hay mesas libres.</div>}
  </Modal>
}

// ------------------------------------------------------------------ pedidos sin mesa
/** Para llevar, delivery o barra: una cuenta con el nombre del cliente. Devuelve la cuenta para cargarle el pedido. */
export function AbrirCuenta({ onCerrar, onListo }: { onCerrar: () => void; onListo: (m: Mesa) => void }) {
  const [tipo, setTipo] = useState<Exclude<TipoCuenta, 'mesa' | 'aparte'>>('llevar')
  const [nombre, setNombre] = useState(''), [tel, setTel] = useState(''), [dir, setDir] = useState('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Pedido sin mesa" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !nombre.trim() || (tipo === 'delivery' && dir.trim().length < 3)} onClick={async () => {
    let id = 0
    if (await correr(async () => { id = await rpc<number>('abrir_cuenta', { p_tipo: tipo, p_nombre: nombre, p_telefono: tel || null, p_direccion: dir || null }) }, 'Cuenta abierta'))
      onListo({ id, numero: 0, zona: null, activa: true, token: '', estado: 'ocupada', abierta: new Date().toISOString(), comensales: null, mozo_id: null,
        tipo, nombre: nombre.trim(), telefono: tel || null, direccion: dir || null, temporal: true })
  }}>Abrir y cargar pedido</button></>}>
    <div className="opts" id="ac-tipo">{TIPOS_CUENTA.map((t) => <button key={t.tipo} className="opt" aria-pressed={tipo === t.tipo} onClick={() => setTipo(t.tipo)}>{t.nombre}</button>)}</div>
    <label className="campo">Nombre<input id="ac-nombre" maxLength={40} placeholder={tipo === 'barra' ? 'Ej.: Juan, el de la gorra' : 'Ej.: Juan Pérez'} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></label>
    {tipo !== 'barra' && <label className="campo">Teléfono {tipo === 'llevar' && <small>(opcional, para avisarle)</small>}<input id="ac-tel" inputMode="tel" placeholder="297 4…" value={tel} onChange={(e) => setTel(e.target.value)} /></label>}
    {tipo === 'delivery' && <label className="campo">Dirección<input id="ac-dir" maxLength={120} placeholder="Calle, número, barrio" value={dir} onChange={(e) => setDir(e.target.value)} /></label>}
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Va a parrilla y barra como cualquier mesa. Al cobrarla, desaparece de la pantalla.</p>
  </Modal>
}

// ------------------------------------------------------------------ corregir un producto ya enviado
type Accion = 'sacar' | 'invitar' | 'pasar'
export function CorregirItem({ item, enPreparacion, mesa, destinos, gestion, onCerrar, onListo }: {
  item: ItemVista & { id: number }; enPreparacion: boolean; mesa: Mesa; destinos: Mesa[]; gestion: boolean; onCerrar: () => void; onListo: () => void
}) {
  const [accion, setAccion] = useState<Accion>('sacar')
  const [q, setQ] = useState(1), [motivo, setMotivo] = useState(''), [hacia, setHacia] = useState<number | ''>('')
  const { correr, ocupado } = useAccion()
  const bloqueado = accion === 'sacar' && enPreparacion && !gestion
  const puede = !bloqueado && (accion === 'pasar' ? !!hacia : accion === 'invitar' ? gestion : motivo.trim().length >= 3)
  async function hacer() {
    const ok = await correr(async () => {
      if (accion === 'sacar') await rpc('sacar_item', { p_item: item.id, p_cantidad: q, p_motivo: motivo })
      else if (accion === 'invitar') await rpc('invitar_item', { p_item: item.id, p_cantidad: q, p_motivo: motivo || null })
      else await rpc('pasar_items', { p_items: [{ id: item.id, cantidad: q }], p_mesa: hacia })
    }, accion === 'sacar' ? 'Sacado del pedido' : accion === 'invitar' ? 'Invita la casa' : 'Pasado')
    if (ok) onListo()
  }
  return <Modal titulo={`${item.cantidad}× ${item.nombre} · ${etiquetaMesa(mesa)}`} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !puede} onClick={hacer}>
      {accion === 'sacar' ? 'Sacar' : accion === 'invitar' ? 'Invitar' : 'Pasar'}</button></>}>
    <div className="opts" id="ci-accion">
      <button className="opt" aria-pressed={accion === 'sacar'} onClick={() => setAccion('sacar')}>Sacar</button>
      {!item.cortesia && gestion && <button className="opt" aria-pressed={accion === 'invitar'} onClick={() => setAccion('invitar')}>Invita la casa</button>}
      <button className="opt" aria-pressed={accion === 'pasar'} onClick={() => setAccion('pasar')}>Pasar a otra mesa</button>
    </div>
    {item.cantidad > 1 && <div className="campo">Cuántos<span className="stepper">
      <button onClick={() => setQ(Math.max(1, q - 1))} aria-label="Uno menos">−</button><span className="num">{q}</span>
      <button onClick={() => setQ(Math.min(item.cantidad, q + 1))} aria-label="Uno más">+</button></span></div>}
    {accion === 'pasar' ? (destinos.length ? <div className="opts" id="ci-destino">{destinos.map((m) => <button key={m.id} className="opt" aria-pressed={hacia === m.id} onClick={() => setHacia(m.id)}>
        {etiquetaMesa(m)}{m.estado === 'libre' ? ' (libre)' : ''}</button>)}</div> : <div className="kempty">No hay otras mesas.</div>)
      : <label className="campo">{accion === 'sacar' ? 'Por qué se saca' : 'Por qué invita la casa (opcional)'}
        <input id="ci-motivo" maxLength={100} placeholder={accion === 'sacar' ? 'Ej.: se equivocó al pedir, no había' : 'Ej.: cliente de siempre, demora'} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>}
    {bloqueado && <div className="aviso warn">Ya lo están preparando: lo puede sacar un encargado o un dueño.</div>}
    {accion === 'sacar' && enPreparacion && gestion && <small className="muted">Ya estaba en preparación: si se tira, cargalo también como merma en Stock.</small>}
    {accion === 'invitar' && <small className="muted">Queda en el ticket a $ 0 y se cuenta su costo. Los dueños lo ven en la Caja.</small>}
  </Modal>
}

// ------------------------------------------------------------------ separar la cuenta o pasar varios productos
export function PasarItems({ mesa, items, destinos, onCerrar, onListo }: {
  mesa: Mesa; items: (ItemVista & { id: number })[]; destinos: Mesa[]; onCerrar: () => void; onListo: () => void
}) {
  const [qs, setQs] = useState<Record<number, number>>({})
  const [hacia, setHacia] = useState<number | 'aparte' | ''>('aparte')
  const [nombre, setNombre] = useState('')
  const { correr, ocupado } = useAccion()
  const elegidos = items.filter((i) => (qs[i.id] ?? 0) > 0)
  const monto = elegidos.reduce((s, i) => s + (qs[i.id] ?? 0) * i.precio, 0)
  const poner = (i: ItemVista & { id: number }, d: number) => setQs({ ...qs, [i.id]: Math.max(0, Math.min(i.cantidad, (qs[i.id] ?? 0) + d)) })
  async function hacer() {
    const ok = await correr(async () => {
      let dest = hacia
      if (dest === 'aparte') dest = await rpc<number>('abrir_cuenta', { p_tipo: 'aparte', p_nombre: `${etiquetaMesa(mesa)} · ${nombre.trim() || 'aparte'}`.slice(0, 40) })
      await rpc('pasar_items', { p_items: elegidos.map((i) => ({ id: i.id, cantidad: qs[i.id] })), p_mesa: dest })
    }, hacia === 'aparte' ? 'Cuenta separada' : 'Productos pasados')
    if (ok) onListo()
  }
  return <Modal titulo={`Separar o pasar · ${etiquetaMesa(mesa)}`} onCerrar={onCerrar} ancho={620}
    pie={<><div className="grow"><div className="label">Se pasa</div><div className="mono" style={{ fontWeight: 600, fontSize: 18 }}>{plata(monto)}</div></div>
      <button className="btn pri" disabled={ocupado || !elegidos.length || !hacia} onClick={hacer}>{hacia === 'aparte' ? 'Separar cuenta' : 'Pasar'}</button></>}>
    <p className="muted" style={{ margin: 0, fontSize: 14 }}>Elegí qué productos y cuántos. Para que alguien pague lo suyo, separalo en una cuenta aparte y cobrala sola.</p>
    <div className="rows">{items.map((i) => <div key={i.id} className="row">
      <span className="grow">{i.nombre}{i.cortesia && <> <Pill tono="ok">invita la casa</Pill></>}<div className="muted" style={{ fontSize: 12 }}>{i.cantidad} en la mesa · {plata(i.precio)} c/u</div></span>
      <span className="stepper"><button onClick={() => poner(i, -1)} aria-label={`Uno menos de ${i.nombre}`}>−</button><span className="num">{qs[i.id] ?? 0}</span>
        <button onClick={() => poner(i, 1)} aria-label={`Uno más de ${i.nombre}`}>+</button></span>
    </div>)}</div>
    <div className="campo">Adónde
      <div className="opts" id="pi-destino">
        <button className="opt" aria-pressed={hacia === 'aparte'} onClick={() => setHacia('aparte')}>Cuenta aparte</button>
        {destinos.map((m) => <button key={m.id} className="opt" aria-pressed={hacia === m.id} onClick={() => setHacia(m.id)}>{etiquetaMesa(m)}{m.estado === 'libre' ? ' (libre)' : ''}</button>)}
      </div></div>
    {hacia === 'aparte' && <label className="campo">¿De quién? (opcional)<input id="pi-nombre" maxLength={20} placeholder="Ej.: Pedro" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>}
  </Modal>
}
