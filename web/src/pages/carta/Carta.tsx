import { useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { num, plata } from '../../lib/formato'
import type { Categoria, Estacion, Insumo, Producto, RecetaItem } from '../../lib/tipos'
import { SubNav } from '../../components/Layout'
import { costoPorcion, pillCosto } from '../../components/stock'
import { Cabeza, Modal, Pill, useAccion } from '../../components/ui'
import { costoFilas, EstimarReceta, FilasReceta, filasDe, filaVacia, itemsFilas, type FilaReceta } from '../../components/receta'

export const SubNavCarta = () => <SubNav items={[['/carta', 'Carta'], ['/carta/platos', 'Platos del día'], ['/carta/mesas', 'Mesas y QR']]} />
const EST: Record<Estacion, string> = { cocina: 'Parrilla / cocina', barra: 'Barra' }

export default function Carta() {
  const d = useConsulta(async () => {
    const [cats, prods, rec, ins, p] = await Promise.all([
      tabla<Categoria[]>(supabase.from('categorias').select('*').order('orden')),
      tabla<Producto[]>(supabase.from('productos').select('*').order('orden').order('nombre')),
      tabla<RecetaItem[]>(supabase.from('receta_items').select('*')),
      tabla<Insumo[]>(supabase.from('insumos').select('*')),
      leerParametros(),
    ])
    return { cats, prods, rec, ins, objetivo: (Number(p.costo_objetivo) || 35) / 100 }
  })
  const [buscar, setBuscar] = useState('')
  const [ventana, setVentana] = useState<null | { p: Producto | null; cat?: number } | { c: Categoria | null } | { stock: Producto } | { dia: true }>(null)
  const { correr } = useAccion()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavCarta /><p className="cargando">Cargando la carta…</p></>
  const { cats, prods, rec, ins, objetivo } = d.datos
  const listo = () => { setVentana(null); d.recargar() }
  const costo = (id: number) => { const r = rec.filter((x) => x.producto_id === id); return r.length ? costoPorcion(r, ins) : null }
  const pausar = (p: Producto) => correr(async () => { const { error } = await supabase.from('productos').update({ activo: !p.activo }).eq('id', p.id); if (error) throw new Error(error.message); d.recargar() }, p.activo ? `${p.nombre}: pausado` : `${p.nombre}: vuelve a la carta`)
  const coincide = (p: Producto) => !buscar || p.nombre.toLowerCase().includes(buscar.toLowerCase())

  return <>
    <Cabeza etiqueta="Carta y QR" titulo="Carta">
      <button className="btn" onClick={() => setVentana({ c: null })}>Nueva categoría</button>
      <button className="btn" data-ayuda="nuevo-producto" onClick={() => setVentana({ p: null })}>Nuevo producto</button>
      <button className="btn pri" data-ayuda="plato-del-dia" onClick={() => setVentana({ dia: true })}>Plato del día</button></Cabeza>
    <SubNavCarta />
    <p className="muted" style={{ fontSize: 13, margin: '0 0 10px', maxWidth: '72ch' }}>Lo que se ve en la carta del QR y en la pantalla del mozo. <b>Pausar</b> saca un producto al toque (se acabó el vacío) sin borrarlo.</p>
    <input id="carta-buscar" type="search" placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ marginBottom: 14 }} />
    {cats.map((c) => { const suyos = prods.filter((p) => p.categoria_id === c.id && coincide(p)); if (buscar && !suyos.length) return null
      return <section className="panel" key={c.id} style={{ marginBottom: 14, opacity: c.activa ? 1 : 0.6 }}>
        <div className="fila" style={{ marginBottom: 6 }}><h3 className="grow">{c.nombre} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· {EST[c.estacion]}{!c.activa && ' · oculta'}</span></h3>
          <button className="btn sm ghost" onClick={() => setVentana({ c })}>Editar</button><button className="btn sm" onClick={() => setVentana({ p: null, cat: c.id })}>Agregar</button></div>
        {suyos.length ? <div className="tbl-wrap"><table><thead><tr><th>Producto</th><th className="r">Precio</th><th className="r">Costo</th><th>Estado</th><th /></tr></thead><tbody>
          {suyos.map((p) => { const co = costo(p.id); return <tr key={p.id} style={p.activo ? undefined : { opacity: 0.55 }}>
            <td><b>{p.nombre}</b>{p.descripcion && <div className="muted" style={{ fontSize: 12 }}>{p.descripcion}</div>}</td>
            <td className="r mono">{plata(p.precio)}</td>
            <td className="r">{co != null ? <><span className="mono">{plata(co)}</span> {pillCosto(Number(p.precio) ? co / Number(p.precio) : null, objetivo)}</> : <span className="muted" style={{ fontSize: 12 }}>sin receta</span>}</td>
            <td>{!p.activo ? <Pill tono="warn">Pausado</Pill> : p.controla_stock ? (p.stock <= 0 ? <Pill tono="crit">Agotado</Pill> : <Pill tono={p.stock <= p.stock_min ? 'warn' : 'ok'}>{num(p.stock)} u.</Pill>) : <Pill tono="ok">En carta</Pill>}</td>
            <td className="r" style={{ whiteSpace: 'nowrap' }}>{p.controla_stock && <button className="btn sm ghost" onClick={() => setVentana({ stock: p })}>Stock</button>} <button className="btn sm ghost" onClick={() => pausar(p)}>{p.activo ? 'Pausar' : 'Activar'}</button> <button className="btn sm ghost" onClick={() => setVentana({ p })}>Editar</button></td></tr> })}
        </tbody></table></div> : <div className="kempty">Sin productos.</div>}
      </section> })}
    {ventana && 'p' in ventana && <ProductoForm prod={ventana.p} cats={cats} catInicial={ventana.cat} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && 'c' in ventana && <CategoriaForm cat={ventana.c} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && 'dia' in ventana && <PlatoDelDia cats={cats} prods={prods} rec={rec} ins={ins} objetivo={objetivo} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && 'stock' in ventana && <StockProducto prod={ventana.stock} onCerrar={() => setVentana(null)} onListo={listo} />}
  </>
}

function ProductoForm({ prod, cats, catInicial, onCerrar, onListo }: { prod: Producto | null; cats: Categoria[]; catInicial?: number; onCerrar: () => void; onListo: () => void }) {
  const c0 = cats.find((c) => c.id === (prod?.categoria_id ?? catInicial)) ?? cats[0]
  const [f, setF] = useState({ nombre: prod?.nombre ?? '', descripcion: prod?.descripcion ?? '', categoria_id: String(c0?.id ?? ''), precio: String(prod?.precio ?? ''), estacion: (prod?.estacion ?? c0?.estacion ?? 'cocina') as Estacion, controla_stock: prod?.controla_stock ?? false, stock_min: String(prod?.stock_min ?? 0), orden: String(prod?.orden ?? 0) })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (!f.nombre.trim()) { setErr('Poné el nombre.'); return }
    if (!(Number(f.precio) >= 0) || f.precio === '') { setErr('Poné el precio.'); return }
    const fila = { nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, categoria_id: Number(f.categoria_id), precio: Number(f.precio), estacion: f.estacion, controla_stock: f.controla_stock, stock_min: Number(f.stock_min) || 0, orden: Number(f.orden) || 0 }
    if (await correr(async () => { const { error } = prod ? await supabase.from('productos').update(fila).eq('id', prod.id) : await supabase.from('productos').insert(fila); if (error) throw new Error(error.message) }, 'Producto guardado')) onListo()
  }
  async function borrar() {
    if (!window.confirm(`¿Borrar ${prod!.nombre}? Si ya se vendió, mejor pausalo.`)) return
    if (await correr(async () => { const { error } = await supabase.from('productos').delete().eq('id', prod!.id); if (error) throw new Error(error.code === '23503' ? 'Ya tiene ventas: pausalo en vez de borrarlo.' : error.message) }, 'Producto borrado')) onListo()
  }
  return <Modal titulo={prod ? 'Editar producto' : 'Nuevo producto'} onCerrar={onCerrar}
    pie={<>{prod && <button className="btn ghost danger" disabled={ocupado} onClick={borrar}>Borrar</button>}<span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar</button></>}>
    <label className="campo">Nombre<input id="pr-nom" value={f.nombre} onChange={set('nombre')} autoFocus /></label>
    <label className="campo">Descripción (se ve en el QR)<input id="pr-desc" value={f.descripcion} onChange={set('descripcion')} placeholder="Con chimichurri de la casa" /></label>
    <div className="two">
      <label className="campo">Categoría<select id="pr-cat" value={f.categoria_id} onChange={(e) => { const c = cats.find((x) => String(x.id) === e.target.value); setF({ ...f, categoria_id: e.target.value, estacion: c?.estacion ?? f.estacion }) }}>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
      <label className="campo">Precio ($)<input id="pr-precio" type="number" step="any" min={0} inputMode="decimal" value={f.precio} onChange={set('precio')} /></label>
    </div>
    <div className="two">
      <label className="campo">Se prepara en<select id="pr-est" value={f.estacion} onChange={set('estacion')}><option value="cocina">Parrilla / cocina</option><option value="barra">Barra</option></select></label>
      <label className="campo">Orden en la carta<input id="pr-orden" type="number" inputMode="numeric" value={f.orden} onChange={set('orden')} /></label>
    </div>
    <label className="check"><input type="checkbox" id="pr-stock" checked={f.controla_stock} onChange={(e) => setF({ ...f, controla_stock: e.target.checked })} /> Se cuenta por unidad (botellas, latas, porrones)</label>
    {f.controla_stock && <label className="campo" style={{ marginTop: 8 }}>Avisar cuando queden menos de<input id="pr-min" type="number" min={0} inputMode="numeric" value={f.stock_min} onChange={set('stock_min')} /></label>}
    <p className="muted" style={{ fontSize: 13 }}>Lo que lleva (para el costo y el stock) se carga en Stock → Recetas y costos.</p>
    {err && <div className="err">{err}</div>}
  </Modal>
}

function CategoriaForm({ cat, onCerrar, onListo }: { cat: Categoria | null; onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: cat?.nombre ?? '', estacion: cat?.estacion ?? 'cocina' as Estacion, orden: String(cat?.orden ?? 0) })
  const { correr, ocupado } = useAccion()
  return <Modal titulo={cat ? 'Editar categoría' : 'Nueva categoría'} onCerrar={onCerrar}
    pie={<>{cat && <button className="btn ghost" disabled={ocupado} onClick={async () => { if (await correr(async () => { await supabase.from('categorias').update({ activa: !cat.activa }).eq('id', cat.id) }, 'Listo')) onListo() }}>{cat.activa ? 'Ocultar' : 'Mostrar'}</button>}
      <span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
        const fila = { nombre: f.nombre.trim(), estacion: f.estacion, orden: Number(f.orden) || 0 }
        if (await correr(async () => { if (!fila.nombre) throw new Error('Poné un nombre.'); const { error } = cat ? await supabase.from('categorias').update(fila).eq('id', cat.id) : await supabase.from('categorias').insert(fila); if (error) throw new Error(error.code === '23505' ? 'Ya existe esa categoría.' : error.message) }, 'Categoría guardada')) onListo()
      }}>Guardar</button></>}>
    <label className="campo">Nombre<input id="cat-nom" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} autoFocus /></label>
    <div className="two"><label className="campo">Se prepara en<select id="cat-est" value={f.estacion} onChange={(e) => setF({ ...f, estacion: e.target.value as Estacion })}><option value="cocina">Parrilla / cocina</option><option value="barra">Barra</option></select></label>
      <label className="campo">Orden<input id="cat-orden" type="number" inputMode="numeric" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label></div>
  </Modal>
}

function StockProducto({ prod, onCerrar, onListo }: { prod: Producto; onCerrar: () => void; onListo: () => void }) {
  const [modo, setModo] = useState<'ingreso' | 'conteo'>('ingreso')
  const [n, setN] = useState('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={prod.nombre} onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || n === ''} onClick={async () => {
    if (await correr(() => rpc('mover_stock_producto', { p_producto: prod.id, p_cantidad: Number(n), p_tipo: modo }), 'Stock actualizado')) onListo()
  }}>Guardar</button></>}>
    <p style={{ marginTop: 0 }}>Hay <b>{num(prod.stock)}</b> unidades según la app.</p>
    <div className="chips" style={{ marginBottom: 10 }}><button className="chip" aria-pressed={modo === 'ingreso'} onClick={() => setModo('ingreso')}>Entraron</button><button className="chip" aria-pressed={modo === 'conteo'} onClick={() => setModo('conteo')}>Conté y hay</button></div>
    <label className="campo">{modo === 'ingreso' ? 'Cuántas entraron' : 'Cuántas hay'}<input id="sp-n" type="number" min={0} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} autoFocus /></label>
  </Modal>
}

/** Plato del día: nombre, qué lleva y precio. La receta la calcula Chichito (o se carga a mano).
 *  planificar: solo se guarda (para la semana), no se pone en la carta. inicial: abre uno ya hecho para editarlo. */
export function PlatoDelDia({ cats, prods, rec, ins, objetivo, planificar = false, inicial, onCerrar, onListo }: { cats: Categoria[]; prods: Producto[]; rec: RecetaItem[]; ins: Insumo[]; objetivo: number; planificar?: boolean; inicial?: Producto; onCerrar: () => void; onListo: (id?: number, nombre?: string) => void }) {
  const cat = cats.find((c) => c.nombre === 'Plato del día')
  const anteriores = cat ? prods.filter((p) => p.categoria_id === cat.id).sort((a, b) => Number(b.activo) - Number(a.activo) || b.id - a.id) : []
  const [desde, setDesde] = useState<Producto | null>(inicial ?? null)
  const [f, setF] = useState(inicial ? { nombre: inicial.nombre, descripcion: inicial.descripcion ?? '', precio: String(inicial.precio) } : { nombre: '', descripcion: '', precio: '' })
  const [filas, setFilas] = useState<FilaReceta[]>(inicial ? filasDe(rec.filter((r) => r.producto_id === inicial.id)) : [filaVacia()])
  const [porcion, setPorcion] = useState<string | null>(null)
  const [sacar, setSacar] = useState(true)
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const costo = costoFilas(filas, ins), precio = Number(f.precio)
  const fc = precio > 0 && costo > 0 ? costo / precio : null
  const sugerido = costo > 0 ? Math.ceil(costo / objetivo / 500) * 500 : null
  const hoy = anteriores.find((p) => p.activo)

  function elegir(p: Producto) {
    setDesde(p); setPorcion(null); setErr('')
    setF({ nombre: p.nombre, descripcion: p.descripcion ?? '', precio: String(p.precio) })
    setFilas(filasDe(rec.filter((r) => r.producto_id === p.id)))
  }
  function nuevo() { setDesde(null); setPorcion(null); setF({ nombre: '', descripcion: '', precio: '' }); setFilas([filaVacia()]) }
  async function guardar() {
    if (f.nombre.trim().length < 2) { setErr('Poné el nombre del plato.'); return }
    if (!(precio > 0)) { setErr('Poné el precio.'); return }
    const { items, error } = itemsFilas(filas)
    if (error) { setErr(error); return }
    if (!items.length) { setErr('Falta la receta: tocá "Que Chichito calcule la receta" o cargala a mano.'); return }
    let id: number | undefined
    if (await correr(async () => { id = await rpc<number>('guardar_plato_del_dia', { p_nombre: f.nombre, p_descripcion: f.descripcion, p_precio: precio, p_items: items, p_sacar_anterior: !planificar && sacar, p_producto: desde?.id ?? null, p_activar: !planificar }) },
      planificar ? `${f.nombre.trim()}: guardado` : `${f.nombre.trim()}: es el plato del día`)) onListo(id, f.nombre.trim())
  }
  return <Modal titulo={planificar ? (inicial ? 'Editar plato del día' : 'Nuevo plato del día') : 'Plato del día'} onCerrar={onCerrar} pie={<>
    <div className="grow"><div className="label">Costo por porción</div><div className="fila"><span className="mono" style={{ fontWeight: 600, fontSize: 18 }}>{plata(costo)}</span>{fc != null && pillCosto(fc, objetivo)}</div></div>
    <button className="btn pri" id="pd-guardar" disabled={ocupado} onClick={guardar}>{planificar ? 'Guardar plato' : 'Poner en la carta'}</button></>}>
    {!planificar && anteriores.length > 0 && <div>
      <div className="label">Volver a poner uno que ya hicieron (con su receta)</div>
      <div className="chips">
        <button className="chip" aria-pressed={!desde} onClick={nuevo}>＋ Uno nuevo</button>
        {anteriores.slice(0, 12).map((p) => <button key={p.id} className="chip" aria-pressed={desde?.id === p.id} onClick={() => elegir(p)}>{p.nombre}{p.activo ? ' · hoy' : ''}</button>)}
      </div>
    </div>}
    <div className="sub-paso"><span className="fac-n">1</span><b>El plato</b><small>cómo se llama y qué lleva</small></div>
    <label className="campo">Nombre<input id="pd-nom" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Bondiola braseada" autoFocus /></label>
    <label className="campo">Qué lleva (se ve en el QR y ayuda a calcular la receta)<input id="pd-desc" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Con puré de calabaza y salsa de hongos" /></label>
    <div className="sub-paso"><span className="fac-n">2</span><b>La receta</b><small>{f.nombre.trim().length < 2 ? 'primero poné el nombre' : 'tocá el botón y Chichito calcula las cantidades por porción'}</small></div>
    <EstimarReceta nombre={f.nombre} descripcion={f.descripcion} insumos={ins} onFilas={(x, p) => { setFilas(x); setPorcion(p) }} />
    {porcion && <div className="notice" style={{ fontSize: 13 }}>Chichito la calculó para <b>{porcion}</b>. Revisá las cantidades: los artículos nuevos se crean con stock en cero y el costo se corrige solo con la primera compra.</div>}
    <FilasReceta filas={filas} setFilas={setFilas} insumos={ins} />
    <div className="sub-paso"><span className="fac-n">3</span><b>El precio</b><small>{sugerido != null ? 'podés usar el sugerido según el costo' : 'cuando esté la receta te sugerimos uno'}</small></div>
    <div className="two">
      <label className="campo">Precio ($)<input id="pd-precio" type="number" step="any" min={0} inputMode="decimal" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} /></label>
      {sugerido != null && <div className="campo"><span>Precio sugerido</span><div className="fila"><span className="mono">{plata(sugerido)}</span><span className="muted" style={{ fontSize: 12 }}>({Math.round(objetivo * 100)} % de costo)</span>
        <button className="btn sm" onClick={() => setF({ ...f, precio: String(sugerido) })}>Usar</button></div></div>}
    </div>
    {!planificar && hoy && hoy.id !== desde?.id && <label className="check"><input type="checkbox" id="pd-sacar" checked={sacar} onChange={(e) => setSacar(e.target.checked)} /> Sacar de la carta {hoy.nombre} (queda guardado para otro día)</label>}
    {err && <div className="err">{err}</div>}
  </Modal>
}
