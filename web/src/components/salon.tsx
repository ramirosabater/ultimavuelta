import { useMemo, useState } from 'react'
import { rpc, tabla, useConsulta } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { plata } from '../lib/formato'
import type { Categoria, MedioPago, Mesa, PedidoItem, Producto } from '../lib/tipos'
import { Modal, useAccion } from './ui'

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
export function Items({ items, precios = true }: { items: Pick<PedidoItem, 'cantidad' | 'nombre' | 'nota' | 'precio'>[]; precios?: boolean }) {
  return <ul className="items">{items.map((i, k) => <li key={k} style={{ flexDirection: 'column', gap: 0 }}>
    <span style={{ display: 'flex', gap: 8 }}><span className="q">{i.cantidad}×</span><span>{i.nombre}</span>{precios && <span className="p">{plata(i.cantidad * i.precio)}</span>}</span>
    {i.nota && <span className="nota">{i.nota}</span>}
  </li>)}</ul>
}

export function AbrirMesa({ mesa, onCerrar, onListo }: { mesa: Mesa; onCerrar: () => void; onListo: () => void }) {
  const [com, setCom] = useState('2')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={`Abrir mesa ${mesa.numero}`} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
      if (await correr(() => rpc('abrir_mesa', { p_mesa: mesa.id, p_comensales: Number(com) || null }), `Mesa ${mesa.numero} abierta`)) onListo()
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

  return <Modal titulo={`Pedido · Mesa ${mesa.numero}`} onCerrar={onCerrar} ancho={720}
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

/** Cobrar una mesa: medio de pago, descuento y cuánto paga cada uno */
export function Cobrar({ mesa, items, onCerrar, onListo }: { mesa: Mesa; items: Pick<PedidoItem, 'cantidad' | 'nombre' | 'nota' | 'precio'>[]; onCerrar: () => void; onListo: () => void }) {
  const medios = useConsulta(() => tabla<MedioPago[]>(supabase.from('medios_pago').select('*').eq('activo', true).order('orden')))
  const [medio, setMedio] = useState('')
  const [desc, setDesc] = useState('0')
  const [div, setDiv] = useState('1')
  const { correr, ocupado } = useAccion()
  const agrupados = useMemo(() => {
    const m = new Map<string, { cantidad: number; nombre: string; precio: number; nota: null }>()
    for (const i of items) { const k = `${i.nombre}|${i.precio}`; const x = m.get(k); if (x) x.cantidad += i.cantidad; else m.set(k, { cantidad: i.cantidad, nombre: i.nombre, precio: i.precio, nota: null }) }
    return [...m.values()]
  }, [items])
  const sub = agrupados.reduce((s, i) => s + i.cantidad * i.precio, 0)
  const d = Math.min(100, Math.max(0, Number(desc) || 0)), partes = Math.max(1, Math.floor(Number(div) || 1))
  const total = Math.round(sub * (1 - d / 100) * 100) / 100
  const elegido = medio || medios.datos?.[0]?.nombre || ''
  return <Modal titulo={`Cobrar mesa ${mesa.numero}`} onCerrar={onCerrar}
    pie={<><div className="grow"><div className="label">Total a cobrar</div><div className="mono" style={{ fontWeight: 600, fontSize: 22 }}>{plata(total)}</div></div>
      <button className="btn pri" disabled={ocupado || !elegido} onClick={async () => {
        if (await correr(() => rpc('cobrar_mesa', { p_mesa: mesa.id, p_medio: elegido, p_descuento: d }), `Cobrado ${plata(total)} · ${elegido}`)) onListo()
      }}>Confirmar cobro</button></>}>
    <Items items={agrupados} />
    <div className="total-row" style={{ borderTopWidth: 1 }}><span className="label">Subtotal</span><span className="num" style={{ fontSize: 16 }}>{plata(sub)}</span></div>
    <div className="two">
      <label className="campo">Descuento %<input id="c-desc" type="number" min={0} max={100} inputMode="numeric" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <label className="campo">Dividir entre<input id="c-div" type="number" min={1} inputMode="numeric" value={div} onChange={(e) => setDiv(e.target.value)} /></label>
    </div>
    <div className="campo">Medio de pago<div className="opts" id="c-medios">{(medios.datos ?? []).map((m) =>
      <button key={m.nombre} className="opt" aria-pressed={m.nombre === elegido} onClick={() => setMedio(m.nombre)}>{m.nombre}</button>)}</div></div>
    {d > 0 && <div className="muted">Descuento: −{plata(sub - total)}</div>}
    {partes > 1 && <span className="pill acc" style={{ fontSize: 14, padding: '6px 12px', alignSelf: 'flex-start' }}>{plata(total / partes)} por persona</span>}
  </Modal>
}

export function MoverMesa({ mesa, mesas, onCerrar, onListo }: { mesa: Mesa; mesas: Mesa[]; onCerrar: () => void; onListo: () => void }) {
  const libres = mesas.filter((m) => m.estado === 'libre' && m.activa && m.id !== mesa.id)
  const [hacia, setHacia] = useState<number | ''>('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={`Pasar la mesa ${mesa.numero}`} onCerrar={onCerrar}
    pie={<><span className="grow" /><button className="btn pri" disabled={!hacia || ocupado} onClick={async () => {
      const destino = mesas.find((m) => m.id === hacia)
      if (await correr(() => rpc('mover_mesa', { p_desde: mesa.id, p_hacia: hacia }), `Pasada a la mesa ${destino?.numero}`)) onListo()
    }}>Pasar</button></>}>
    <p style={{ margin: 0 }}>Todo lo que está cargado pasa a la mesa que elijas. Tiene que estar libre.</p>
    {libres.length ? <div className="opts">{libres.map((m) => <button key={m.id} className="opt" aria-pressed={hacia === m.id} onClick={() => setHacia(m.id)}>Mesa {m.numero}</button>)}</div>
      : <div className="kempty">No hay mesas libres.</div>}
  </Modal>
}
