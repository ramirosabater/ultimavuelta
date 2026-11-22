import { useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { num, plata } from '../../lib/formato'
import type { Categoria, Insumo, Producto, RecetaItem } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { costoPorcion, pillCosto } from '../../components/stock'
import { Cabeza, Modal, Stat, useAccion } from '../../components/ui'
import { costoFilas, EstimarReceta, FilasReceta, filasDe, itemsFilas, type FilaReceta } from '../../components/receta'

export default function Recetas() {
  const { datos, error, recargar } = useConsulta(async () => {
    const [cats, prods, insumos, receta, par] = await Promise.all([
      tabla<Categoria[]>(supabase.from('categorias').select('*').order('orden')),
      tabla<Producto[]>(supabase.from('productos').select('*').order('orden').order('nombre')),
      tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre')),
      tabla<RecetaItem[]>(supabase.from('receta_items').select('*')),
      leerParametros(),
    ])
    return { cats, prods, insumos, receta, objetivo: (Number(par.costo_objetivo) || 35) / 100 }
  })
  const [editar, setEditar] = useState<Producto | null>(null)
  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <><SubNavStock /><p className="cargando">Cargando recetas…</p></>
  const { cats, prods, insumos, receta, objetivo } = datos
  const de = (id: number) => receta.filter((r) => r.producto_id === id)
  const conReceta = prods.filter((p) => de(p.id).length && p.precio > 0)
  const fcs = conReceta.map((p) => costoPorcion(de(p.id), insumos) / p.precio)
  const caros = fcs.filter((x) => x > objetivo).length

  return <>
    <Cabeza etiqueta="Cocina" titulo="Recetas y costos" />
    <SubNavStock />
    <div className="stats" style={{ marginBottom: 16 }}>
      <Stat label="Con receta" valor={`${conReceta.length} de ${prods.filter((p) => !p.controla_stock).length}`} />
      <Stat label="Costo promedio" valor={fcs.length ? `${Math.round((fcs.reduce((s, x) => s + x, 0) / fcs.length) * 100)}%` : '—'} />
      <Stat label="Platos caros de hacer" valor={caros} />
    </div>
    <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', maxWidth: '72ch' }}>El costo de cada plato sale de la receta y del último precio de cada artículo, contando la merma de limpieza. Como referencia, una parrilla sana trabaja entre 25 % y 35 % de costo sobre el precio de venta. Arriba de {Math.round(objetivo * 100)} % se marca en rojo.</p>
    {cats.map((c) => {
      const lista = prods.filter((p) => p.categoria_id === c.id)
      if (!lista.length) return null
      return <div className="cat-block" key={c.id}><h3>{c.nombre}</h3>{lista.map((p) => {
        const rec = de(p.id), costo = costoPorcion(rec, insumos), fc = rec.length && p.precio ? costo / p.precio : null
        const txt = rec.map((r) => { const i = insumos.find((x) => x.id === r.insumo_id); return i ? `${num(r.cantidad)} ${i.unidad} ${i.nombre}${r.cocido ? ' (cocido)' : ''}` : '' }).filter(Boolean).join(' · ')
        return <div className={`prod-row${p.activo ? '' : ' off'}`} key={p.id}>
          <div className="grow"><b>{p.nombre}</b><div className="muted" style={{ fontSize: 13 }}>{txt || (p.controla_stock ? 'Se cuenta por unidad (no lleva receta)' : 'Sin receta cargada')}</div></div>
          {pillCosto(fc, objetivo)}
          <span className="mono" style={{ minWidth: 150, textAlign: 'right', fontSize: 13 }}>{rec.length ? <>costo {plata(costo)}<br />deja <b>{plata(p.precio - costo)}</b></> : `precio ${plata(p.precio)}`}</span>
          <button className={`btn sm${rec.length ? '' : ' pri'}`} data-ayuda="editar-receta" onClick={() => setEditar(p)}>{rec.length ? 'Editar receta' : 'Cargar receta'}</button>
        </div>
      })}</div>
    })}
    {!prods.length && <div className="notice"><b>No hay productos.</b><br />Cargá la carta en Carta y QR y después sus recetas acá.</div>}
    {editar && <EditarReceta producto={editar} receta={de(editar.id)} insumos={insumos} objetivo={objetivo} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar() }} />}
  </>
}

export function EditarReceta({ producto, receta, insumos, objetivo, onCerrar, onListo }: { producto: Producto; receta: RecetaItem[]; insumos: Insumo[]; objetivo: number; onCerrar: () => void; onListo: () => void }) {
  const [filas, setFilas] = useState<FilaReceta[]>(filasDe(receta))
  const [porcion, setPorcion] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const costo = costoFilas(filas, insumos), fc = producto.precio && costo ? costo / producto.precio : null
  async function guardar() {
    const { items, error } = itemsFilas(filas)
    if (error) { setErr(error); return }
    if (await correr(() => rpc('guardar_receta', { p_producto: producto.id, p_items: items }), 'Receta guardada')) onListo()
  }
  return <Modal titulo={`Receta · ${producto.nombre}`} onCerrar={onCerrar} pie={<>
    <div className="grow"><div className="label">Costo por porción</div><div className="fila"><span className="mono" style={{ fontWeight: 600, fontSize: 18 }}>{plata(costo)}</span>{fc != null && pillCosto(fc, objetivo)}</div></div>
    <button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar receta</button></>}>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Cantidad por porción, en la unidad del artículo. Elegí si es <b>como sale al plato</b> (0,30 kg de vacío cocido, 0,20 kg de arroz cocido) o <b>limpio y crudo</b> (60 ml de gin). La app calcula cuánto hay que comprar sumando la limpieza y lo que se pierde o gana al cocinar.</p>
    <EstimarReceta nombre={producto.nombre} descripcion={producto.descripcion ?? ''} insumos={insumos} onFilas={(f, p) => { setFilas(f); setPorcion(p) }} />
    {porcion && <div className="notice" style={{ fontSize: 13 }}>Chichito la calculó para <b>{porcion}</b>. Revisá las cantidades antes de guardar.</div>}
    <FilasReceta filas={filas} setFilas={setFilas} insumos={insumos} />
    {err && <div className="err">{err}</div>}
  </Modal>
}
