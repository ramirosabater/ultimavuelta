import { useState } from 'react'
import { rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { jornada, num, plata, sumarDias } from '../../lib/formato'
import type { Insumo, Producto } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { ArticuloForm, CompraModal, ContarModal, estadoStock, MermaModal, useBaseStock, venceInfo } from '../../components/stock'
import { Cabeza, Modal, Pill, Stat, useAccion } from '../../components/ui'

type Ventana = null | { t: 'editar'; i: Insumo | null } | { t: 'compra' | 'merma' | 'contar'; i: Insumo } | { t: 'ingreso'; p: Producto }

export default function Articulos() {
  const base = useBaseStock()
  const extra = useConsulta(async () => {
    const [prods, mermas] = await Promise.all([
      tabla<Producto[]>(supabase.from('productos').select('*').eq('controla_stock', true).order('nombre')),
      tabla<{ cantidad: number; costo_unit: number }[]>(supabase.from('movimientos_stock').select('cantidad, costo_unit').eq('tipo', 'merma').gte('jornada', sumarDias(jornada(), -6))),
    ])
    return { prods, tirado7: mermas.reduce((s, m) => s - m.cantidad * m.costo_unit, 0) }
  })
  const [ventana, setVentana] = useState<Ventana>(null)
  const [buscar, setBuscar] = useState('')
  const [prov, setProv] = useState('')
  const { correr, ocupado } = useAccion()
  const recargar = () => { base.recargar(); extra.recargar() }
  const listo = () => { setVentana(null); recargar() }

  if (base.error) return <div className="aviso bad">{base.error}</div>
  if (!base.datos || !extra.datos) return <><SubNavStock /><p className="cargando">Cargando artículos…</p></>
  const { insumos, proveedores, cuentas } = base.datos
  const activos = insumos.filter((i) => i.activo)
  const reponer = activos.filter((i) => i.minimo > 0 && i.cantidad <= i.minimo)
  const porVencer = activos.filter((i) => venceInfo(i)?.tono && i.cantidad > 0)
  const valor = activos.reduce((s, i) => s + Number(i.cantidad) * Number(i.costo), 0)
  const lista = insumos.filter((i) => (!buscar || i.nombre.toLowerCase().includes(buscar.toLowerCase())) && (!prov || String(i.proveedor_id ?? '') === prov))
  const provDe = (id: number | null) => proveedores.find((p) => p.id === id)?.nombre

  return <>
    <Cabeza etiqueta="Depósito y cocina" titulo="Artículos"><button className="btn pri" onClick={() => setVentana({ t: 'editar', i: null })} data-ayuda="nuevo-articulo">Nuevo artículo</button></Cabeza>
    <SubNavStock />
    <div className="stats" style={{ marginBottom: 16 }}>
      <Stat label="Valor del stock" valor={plata(valor)} /><Stat label="Para reponer" valor={reponer.length} />
      <Stat label="Por vencer" valor={porVencer.length} /><Stat label="Tirado en 7 días" valor={plata(extra.datos.tirado7)} />
    </div>
    {(reponer.length > 0 || porVencer.length > 0) && <div className="alerts"><div className="alert"><Pill tono="warn">{reponer.length + porVencer.length}</Pill>
      <span className="grow">Revisar: {[...porVencer, ...reponer.filter((i) => !porVencer.includes(i))].map((i) => i.nombre).join(', ')}</span></div></div>}

    <section className="panel" style={{ marginBottom: 16 }}>
      <h3>Lo que comprás</h3>
      <p className="muted" style={{ margin: '4px 0 10px', fontSize: 13, maxWidth: '72ch' }}>Se descuentan solos al cobrar, según la receta de cada plato. Lo que entra se carga como compra y lo que se tira como merma, así los números cierran.</p>
      <div className="fila" style={{ marginBottom: 10 }}>
        <input id="art-buscar" type="search" placeholder="Buscar artículo…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ flex: '1 1 200px', width: 'auto' }} />
        <select id="art-prov" value={prov} onChange={(e) => setProv(e.target.value)} style={{ flex: '0 1 220px', width: 'auto' }}><option value="">Todos los proveedores</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
      </div>
      {lista.length ? <div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Estado</th><th className="r">Hay</th><th className="r">Mínimo</th><th className="r">Costo</th><th>Vence</th><th className="r" /></tr></thead><tbody>
        {lista.map((i) => { const v = venceInfo(i); return <tr key={i.id} style={i.activo ? undefined : { opacity: 0.55 }}>
          <td><b>{i.nombre}</b>{provDe(i.proveedor_id) && <div className="muted" style={{ fontSize: 12 }}>{provDe(i.proveedor_id)}</div>}</td>
          <td>{i.activo ? estadoStock(Number(i.cantidad), Number(i.minimo)) : <Pill>Inactivo</Pill>}</td>
          <td className="r mono"><b>{num(i.cantidad)}</b> {i.unidad}</td><td className="r mono muted">{num(i.minimo)}</td>
          <td className="r mono">{plata(i.costo)}<span className="muted">/{i.unidad}</span></td>
          <td>{v ? (v.tono ? <Pill tono={v.tono}>{v.texto}</Pill> : <span className="muted" style={{ fontSize: 13 }}>{v.texto}</span>) : <span className="muted">—</span>}</td>
          <td className="r" style={{ whiteSpace: 'nowrap' }}>
            <button className="btn sm" onClick={() => setVentana({ t: 'compra', i })}>Compra</button>{' '}
            <button className="btn sm" onClick={() => setVentana({ t: 'merma', i })}>Merma</button>{' '}
            <button className="btn sm" onClick={() => setVentana({ t: 'contar', i })}>Contar</button>{' '}
            <button className="btn sm ghost" onClick={() => setVentana({ t: 'editar', i })}>Editar</button>
          </td></tr> })}
      </tbody></table></div> : <div className="kempty">{insumos.length ? 'Nada con ese filtro.' : 'Sin artículos cargados. Tocá “Nuevo artículo”.'}</div>}
    </section>

    <section className="panel">
      <h3>Bebidas por unidad</h3>
      <p className="muted" style={{ margin: '4px 0 8px', fontSize: 13 }}>Botellas, latas y porrones que se venden enteros. Se activa por producto en Carta y QR.</p>
      {extra.datos.prods.length ? <div className="tbl-wrap"><table><thead><tr><th>Producto</th><th>Estado</th><th className="r">Stock</th><th className="r">Mínimo</th><th className="r">Ajustar</th></tr></thead><tbody>
        {extra.datos.prods.map((p) => <tr key={p.id}><td><b>{p.nombre}</b></td><td>{estadoStock(Number(p.stock), Number(p.stock_min))}</td>
          <td className="r mono"><b>{num(p.stock)}</b></td><td className="r mono muted">{num(p.stock_min)}</td>
          <td className="r" style={{ whiteSpace: 'nowrap' }}>
            <span className="stepper">
              <button disabled={ocupado} aria-label={`Restar uno de ${p.nombre}`} onClick={async () => { if (await correr(() => rpc('mover_stock_producto', { p_producto: p.id, p_cantidad: -1, p_tipo: 'conteo' }))) extra.recargar() }}>−</button>
              <button disabled={ocupado} aria-label={`Sumar uno de ${p.nombre}`} onClick={async () => { if (await correr(() => rpc('mover_stock_producto', { p_producto: p.id, p_cantidad: 1, p_tipo: 'conteo' }))) extra.recargar() }}>+</button>
            </span>{' '}<button className="btn sm" onClick={() => setVentana({ t: 'ingreso', p })}>Ingreso</button></td></tr>)}
      </tbody></table></div> : <div className="kempty">Ningún producto controla stock por unidad.</div>}
    </section>

    {ventana?.t === 'editar' && <ArticuloForm insumo={ventana.i} proveedores={proveedores} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana?.t === 'compra' && <CompraModal insumo={ventana.i} proveedores={proveedores} cuentas={cuentas} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana?.t === 'merma' && <MermaModal insumos={insumos} inicial={ventana.i.id} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana?.t === 'contar' && <ContarModal insumo={ventana.i} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana?.t === 'ingreso' && <IngresoProducto p={ventana.p} onCerrar={() => setVentana(null)} onListo={listo} />}
  </>
}

function IngresoProducto({ p, onCerrar, onListo }: { p: Producto; onCerrar: () => void; onListo: () => void }) {
  const [q, setQ] = useState('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={`Ingreso · ${p.nombre}`} onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || !(Number(q) > 0)}
    onClick={async () => { if (await correr(() => rpc('mover_stock_producto', { p_producto: p.id, p_cantidad: Number(q), p_tipo: 'ingreso' }), 'Stock actualizado')) onListo() }}>Sumar al stock</button></>}>
    <label className="campo">Unidades que entran<input id="g-cant" type="number" min={1} step={1} inputMode="numeric" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
  </Modal>
}
