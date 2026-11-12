import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { num, pct, plata } from '../../lib/formato'
import type { Insumo, Proveedor, Rendimiento } from '../../lib/tipos'
import { SubNavStock } from './nav'
import { Cabeza, Modal, Pill, useAccion } from '../../components/ui'

export default function Rendimientos() {
  const { datos, error, recargar } = useConsulta(async () => {
    const [insumos, provs, pruebas] = await Promise.all([
      tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre')),
      tabla<Proveedor[]>(supabase.from('proveedores').select('*')),
      tabla<Rendimiento[]>(supabase.from('rendimientos').select('*').order('fecha', { ascending: false })),
    ])
    return { insumos, provs, pruebas }
  })
  const [nueva, setNueva] = useState(false)
  const { correr, ocupado } = useAccion()
  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <><SubNavStock /><p className="cargando">Cargando…</p></>
  const { insumos, provs, pruebas } = datos
  const ids = [...new Set(pruebas.map((p) => p.insumo_id))].filter((id) => insumos.some((i) => i.id === id))

  return <>
    <Cabeza etiqueta="Cocina" titulo="Rendimientos"><button className="btn pri" onClick={() => setNueva(true)} data-ayuda="nueva-prueba">Nueva prueba</button></Cabeza>
    <SubNavStock />
    <p className="muted" style={{ fontSize: 13, margin: '0 0 14px', maxWidth: '72ch' }}>Cuando llega una pieza, pesala cruda, después de limpiarla y, si querés, una porción ya cocida. Con 3 o 4 pruebas por corte sabés tu merma real, la de tu carnicero y tu parrillero. Se promedian las últimas 5.</p>
    {!ids.length ? <div className="notice"><b>Todavía no hay pruebas.</b><br />Hacé la primera con la próxima pieza de vacío o entraña que llegue: tocá “Nueva prueba”.</div> :
      <div className="rep-grid" style={{ marginTop: 0 }}>{ids.map((id) => {
        const i = insumos.find((x) => x.id === id)!
        const todas = pruebas.filter((p) => p.insumo_id === id), ult = todas.slice(0, 5)
        const merma = ult.reduce((s, p) => s + (1 - p.limpio / p.crudo), 0) / ult.length
        const coc = ult.filter((p) => p.cocido), coccion = coc.length ? coc.reduce((s, p) => s + (1 - p.cocido! / p.limpio), 0) / coc.length : null
        const cargada = Number(i.merma_pct) / 100, dif = merma - cargada
        const sirve = (1 - merma) * (coccion != null ? 1 - coccion : 1)
        const porProv = new Map<string, number[]>(); todas.forEach((p) => { const k = p.proveedor || 'Sin proveedor'; porProv.set(k, [...(porProv.get(k) ?? []), 1 - p.limpio / p.crudo]) })
        return <section className="panel" key={id}>
          <div className="fila"><h3 className="grow">{i.nombre}</h3><Pill>{todas.length} prueba{todas.length > 1 ? 's' : ''}</Pill></div>
          <dl className="kv">
            <dt>Merma de limpieza real</dt><dd className="mono"><b>{pct(merma, 1)}</b></dd>
            <dt>Cargada en el artículo</dt><dd className="mono">{pct(cargada, 1)}</dd>
            {coccion != null && <><dt>Pérdida en la parrilla</dt><dd className="mono">{pct(coccion, 1)}</dd></>}
            <dt>De 1 {i.unidad} comprado</dt><dd className="mono">se sirven {num(sirve)} {i.unidad}{coccion != null ? ' cocidos' : ' limpios'}</dd>
            <dt>Costo real por {i.unidad} limpio</dt><dd className="mono">{plata(i.costo / (1 - merma))}</dd>
          </dl>
          {porProv.size > 1 && <div className="muted" style={{ fontSize: 13, margin: '-6px 0 10px' }}>Por proveedor: {[...porProv].map(([k, v]) => `${k} ${pct(v.reduce((s, x) => s + x, 0) / v.length, 1)}`).join(' · ')}</div>}
          {Math.abs(dif) >= 0.01 ? <div className="alert" style={{ background: dif > 0 ? 'var(--warn-soft)' : 'var(--ok-soft)' }}>
            <span className="grow">{dif > 0 ? 'Perdés más de lo que tenías cargado: los costos de los platos están por debajo de la realidad.' : 'Rinde mejor de lo cargado.'}</span>
            <button className="btn sm pri" disabled={ocupado} onClick={async () => { if (await correr(async () => { const { error } = await supabase.from('insumos').update({ merma_pct: Math.round(merma * 1000) / 10 }).eq('id', id); if (error) throw new Error(error.message) }, 'Merma actualizada: los costos de los platos se recalcularon')) recargar() }}>Usar {pct(merma, 1)}</button>
          </div> : <Pill tono="ok">El artículo ya usa la merma real</Pill>}
        </section>
      })}</div>}
    {pruebas.length > 0 && <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Pruebas registradas</h3>
      <div className="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Proveedor</th><th className="r">Crudo</th><th className="r">Limpio</th><th className="r">Cocido</th><th className="r">Merma</th><th /></tr></thead><tbody>
        {pruebas.slice(0, 40).map((p) => <tr key={p.id}><td className="mono">{new Date(p.fecha).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</td>
          <td>{insumos.find((i) => i.id === p.insumo_id)?.nombre}</td><td className="muted">{p.proveedor || '—'}</td>
          <td className="r mono">{num(p.crudo)}</td><td className="r mono">{num(p.limpio)}</td><td className="r mono">{p.cocido ? num(p.cocido) : '—'}</td>
          <td className="r mono"><b>{pct(1 - p.limpio / p.crudo, 1)}</b></td>
          <td className="r"><button className="btn sm ghost danger" disabled={ocupado} onClick={async () => { if (await correr(async () => { await supabase.from('rendimientos').delete().eq('id', p.id) }, 'Prueba borrada')) recargar() }}>Borrar</button></td></tr>)}
      </tbody></table></div></section>}
    {nueva && <NuevaPrueba insumos={insumos} provs={provs} onCerrar={() => setNueva(false)} onListo={() => { setNueva(false); recargar() }} />}
  </>
}

function NuevaPrueba({ insumos, provs, onCerrar, onListo }: { insumos: Insumo[]; provs: Proveedor[]; onCerrar: () => void; onListo: () => void }) {
  const opciones = [...insumos].filter((i) => i.activo).sort((a, b) => (a.unidad === 'kg' ? 0 : 1) - (b.unidad === 'kg' ? 0 : 1) || a.nombre.localeCompare(b.nombre))
  const provDe = (iid: string) => provs.find((p) => p.id === insumos.find((i) => String(i.id) === iid)?.proveedor_id)?.nombre ?? ''
  const [iid, setIid] = useState(String(opciones[0]?.id ?? ''))
  const [f, setF] = useState({ proveedor: provDe(String(opciones[0]?.id ?? '')), crudo: '', limpio: '', cocido: '', nota: '' })
  const [err, setErr] = useState('')
  const { correr, ocupado } = useAccion()
  const c = Number(f.crudo), l = Number(f.limpio), k = Number(f.cocido)
  async function guardar() {
    if (!(c > 0) || !(l > 0) || l > c) { setErr('Cargá peso crudo y limpio (el limpio no puede ser mayor).'); return }
    if (k && k > l) { setErr('El cocido no puede pesar más que el limpio.'); return }
    if (await correr(async () => { const { error } = await supabase.from('rendimientos').insert({ insumo_id: Number(iid), proveedor: f.proveedor || null, crudo: c, limpio: l, cocido: k || null, nota: f.nota || null }); if (error) throw new Error(error.message) }, 'Prueba guardada')) onListo()
  }
  return <Modal titulo="Prueba de rendimiento" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={guardar}>Guardar prueba</button></>}>
    <label className="campo">Corte o artículo<select id="y-ins" value={iid} onChange={(e) => { setIid(e.target.value); setF({ ...f, proveedor: provDe(e.target.value) }) }}>{opciones.map((i) => <option key={i.id} value={i.id}>{i.nombre} ({i.unidad})</option>)}</select></label>
    <label className="campo">Proveedor<input id="y-prov" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /></label>
    <div className="two">
      <label className="campo">Peso crudo, como llegó<input id="y-crudo" type="number" step="any" min={0} inputMode="decimal" placeholder="Ej.: 2,35" value={f.crudo} onChange={(e) => setF({ ...f, crudo: e.target.value })} /></label>
      <label className="campo">Peso limpio, listo para la parrilla<input id="y-limpio" type="number" step="any" min={0} inputMode="decimal" value={f.limpio} onChange={(e) => setF({ ...f, limpio: e.target.value })} /></label>
    </div>
    <label className="campo">Peso cocido de esa parte limpia (opcional)<input id="y-cocido" type="number" step="any" min={0} inputMode="decimal" value={f.cocido} onChange={(e) => setF({ ...f, cocido: e.target.value })} /></label>
    <label className="campo">Nota (opcional)<input id="y-nota" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Ej.: venía con mucha grasa" /></label>
    {c > 0 && l > 0 && l <= c && <div style={{ fontSize: 14 }}>Merma de limpieza <b className="mono">{pct(1 - l / c, 1)}</b>{k > 0 && k <= l && <> · pérdida en la parrilla <b className="mono">{pct(1 - k / l, 1)}</b> · de lo comprado se sirve el <b className="mono">{pct(k / c, 1)}</b></>}</div>}
    {err && <div className="err">{err}</div>}
  </Modal>
}
