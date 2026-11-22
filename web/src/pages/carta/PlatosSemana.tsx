// La semana de platos del día: qué plato va cada día y cuántas porciones, y lo que hay que comprar para eso.
import { useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { DIAS, fecha, jornada, num, plata, sumarDias, dow } from '../../lib/formato'
import type { Categoria, Insumo, Producto, RecetaItem } from '../../lib/tipos'
import { pillCosto } from '../../components/stock'
import { Cabeza, Pill, Stat, useAccion, useToast } from '../../components/ui'
import { PlatoDelDia, SubNavCarta } from './Carta'

interface Dia { fecha: string; cerrado: boolean; pasado: boolean; producto_id: number | null; porciones: number | null; aplicado: boolean | null; sugerido: number | null; vendidos: number | null }
interface PlatoGuardado { id: number; nombre: string; descripcion: string | null; precio: number; activo: boolean; costo: number; con_receta: boolean; veces: number }
interface Compra { id: number; nombre: string; unidad: string; necesita: number; hay: number; pack: number | null; pack_nombre: string | null; costo: number; proveedor: string | null }
interface Semana { desde: string; hoy: string; dias: Dia[]; platos: PlatoGuardado[]; compras: Compra[] }

/** Lo que falta comprar de un artículo, redondeado a la presentación */
function falta(c: Compra) {
  const f = Number(c.necesita) - Math.max(0, Number(c.hay))
  if (f <= 0.0001) return { q: 0, packs: 0 }
  const pk = Number(c.pack) || 0
  const q = pk ? Math.ceil(f / pk - 1e-9) * pk : Math.ceil(f * 100) / 100
  return { q, packs: pk ? Math.round(q / pk) : 0 }
}

export default function PlatosSemana() {
  const [desde, setDesde] = useState(jornada())
  const d = useConsulta(async () => {
    const [sem, cats, prods, rec, ins, p] = await Promise.all([
      rpc<Semana>('semana_platos', { p_desde: desde }),
      tabla<Categoria[]>(supabase.from('categorias').select('*').order('orden')),
      tabla<Producto[]>(supabase.from('productos').select('*').order('nombre')),
      tabla<RecetaItem[]>(supabase.from('receta_items').select('*')),
      tabla<Insumo[]>(supabase.from('insumos').select('*').order('nombre')),
      leerParametros(),
    ])
    return { sem, cats, prods, rec, ins, objetivo: (Number(p.costo_objetivo) || 35) / 100 }
  }, [desde])
  const [ventana, setVentana] = useState<null | { nuevo: string | null } | { editar: Producto }>(null)
  const [porc, setPorc] = useState<Record<string, string>>({})
  const { correr } = useAccion()
  const avisar = useToast()

  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavCarta /><p className="cargando">Cargando la semana…</p></>
  const { sem, cats, prods, rec, ins, objetivo } = d.datos
  const plato = (id: number | null) => sem.platos.find((p) => p.id === id)
  const abiertos = sem.dias.filter((x) => !x.cerrado)
  const planificados = abiertos.filter((x) => x.producto_id)
  const porciones = planificados.reduce((s, x) => s + (x.porciones ?? 0), 0)
  const costoSemana = planificados.reduce((s, x) => s + (x.porciones ?? 0) * (plato(x.producto_id)?.costo ?? 0), 0)
  const ventaSemana = planificados.reduce((s, x) => s + (x.porciones ?? 0) * Number(plato(x.producto_id)?.precio ?? 0), 0)
  const compras = sem.compras.map((c) => ({ c, ...falta(c) }))
  const aComprar = compras.filter((x) => x.q > 0)

  const planificar = (dia: Dia, producto: number | null, porciones: number | null, nombre?: string) =>
    correr(async () => { await rpc('planificar_plato', { p_fecha: dia.fecha, p_producto: producto, p_porciones: porciones }); d.recargar() },
      producto ? `${fecha(dia.fecha)}: ${nombre ?? plato(producto)?.nombre ?? 'plato'}${dia.fecha === sem.hoy ? ' (ya está en la carta)' : ''}` : `${fecha(dia.fecha)}: sin plato`)
  function guardarPorciones(dia: Dia) {
    const v = porc[dia.fecha]
    if (v === undefined || !dia.producto_id) return
    const n = Math.round(Number(v))
    setPorc((p) => { const q = { ...p }; delete q[dia.fecha]; return q })
    if (n >= 1 && n !== dia.porciones) planificar(dia, dia.producto_id, n)
  }
  function copiar() {
    const g = new Map<string, string[]>()
    for (const x of aComprar) { const k = x.c.proveedor ?? 'Otros'; g.set(k, [...(g.get(k) ?? []), `- ${x.c.nombre}: ${x.packs ? `${x.packs} ${x.c.pack_nombre ?? 'pack'}${x.packs > 1 ? 's' : ''} (${num(x.q)} ${x.c.unidad})` : `${num(x.q)} ${x.c.unidad}`}`]) }
    const t = `Platos del día · semana del ${fecha(sem.desde)}\n` + [...g].map(([k, l]) => `\n*${k}*\n${l.join('\n')}`).join('\n')
    navigator.clipboard?.writeText(t).then(() => avisar('Lista copiada. Pegala en WhatsApp.'), () => avisar('No se pudo copiar'))
  }

  return <>
    <Cabeza etiqueta="Carta y QR" titulo="Platos del día">
      <button className="btn pri" data-ayuda="nuevo-plato-dia" onClick={() => setVentana({ nuevo: null })}>Nuevo plato</button></Cabeza>
    <SubNavCarta />
    <p className="muted" style={{ fontSize: 13, margin: '0 0 12px', maxWidth: '72ch' }}>Elegí qué plato va cada día y cuántas porciones preparar. El día que toca se pone solo en la carta (y se saca el anterior). Las porciones sugeridas salen de lo que se vendió de plato del día ese mismo día de la semana. Lo que lleva se suma a la lista de compras.</p>

    <div className="fila" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <button className="btn sm" disabled={desde <= jornada()} onClick={() => setDesde(sumarDias(desde, -7))}>‹ Anterior</button>
      <b className="grow" style={{ textAlign: 'center' }}>Del {fecha(desde)} al {fecha(sumarDias(desde, 6))}</b>
      <button className="btn sm" onClick={() => setDesde(sumarDias(desde, 7))}>Siguiente ›</button>
    </div>

    <div className="stats" style={{ marginBottom: 14 }}>
      <Stat label="Días con plato" valor={`${planificados.length} de ${abiertos.length}`} />
      <Stat label="Porciones" valor={num(porciones)} />
      <Stat label="Mercadería" valor={plata(costoSemana)} extra={ventaSemana ? `${Math.round(costoSemana / ventaSemana * 100)} % de lo que se vende` : undefined} />
    </div>

    <section className="panel" style={{ marginBottom: 14 }}>
      {!sem.platos.length && <div className="notice" style={{ marginBottom: 10 }}><b>Todavía no hay platos del día guardados.</b><br />Tocá <b>Nuevo plato</b>: le ponés nombre, qué lleva y precio, y Chichito calcula la receta.</div>}
      <div className="rows semana-platos">{sem.dias.map((x) => {
        const p = plato(x.producto_id), esHoy = x.fecha === sem.hoy
        const n = porc[x.fecha] ?? (x.porciones != null ? String(x.porciones) : '')
        return <div className="row" key={x.fecha} style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, opacity: x.pasado ? 0.65 : 1 }}>
          <div style={{ minWidth: 92 }}><b>{DIAS[dow(x.fecha)]} {Number(x.fecha.slice(8, 10))}</b>{esHoy && <> <Pill tono="ok">hoy</Pill></>}</div>
          {x.cerrado ? <span className="muted grow">Cerrado</span> : <>
            <select id={`ps-p-${x.fecha}`} aria-label={`Plato del ${fecha(x.fecha)}`} value={x.producto_id ?? ''} disabled={x.pasado}
              onChange={(e) => { const v = e.target.value; if (v === 'nuevo') setVentana({ nuevo: x.fecha }); else planificar(x, v ? Number(v) : null, null) }}
              style={{ flex: 2, minWidth: 170, width: 'auto' }}>
              <option value="">Sin plato del día</option>
              {sem.platos.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
              {!x.pasado && <option value="nuevo">＋ Plato nuevo…</option>}
            </select>
            {x.producto_id ? <>
              <label className="fila muted" style={{ gap: 6, fontSize: 13 }}>
                <input id={`ps-n-${x.fecha}`} type="number" min={1} max={500} inputMode="numeric" value={n} disabled={x.pasado} aria-label="Porciones"
                  onChange={(e) => setPorc({ ...porc, [x.fecha]: e.target.value })} onBlur={() => guardarPorciones(x)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 72 }} /> porciones</label>
              <span className="mono muted" style={{ fontSize: 12, minWidth: 110, textAlign: 'right' }}>
                {p && p.con_receta ? <>mercadería {plata(p.costo * (x.porciones ?? 0))}</> : <span style={{ color: 'var(--crit, #b42318)' }}>sin receta</span>}
                {x.vendidos != null && <><br />vendidas {num(x.vendidos)} de {x.porciones}</>}
                {!x.pasado && x.sugerido != null && x.porciones !== x.sugerido && <><br />sugeridas {x.sugerido}</>}
              </span>
            </> : <span className="grow" />}
          </>}
        </div>
      })}</div>
    </section>

    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="fila" style={{ marginBottom: 6 }}><h3 className="grow">Para comprar</h3>{aComprar.length > 0 && <button className="btn sm" onClick={copiar}>Copiar lista</button>}</div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Lo que llevan los platos que faltan esta semana, contra lo que hay en stock (el stock también lo usa el resto de la carta: la lista general de <b>Stock → Compras</b> ya suma los platos del día de los próximos días).</p>
      {!compras.length ? <div className="kempty">Planificá algún plato para ver qué hay que comprar.</div>
        : <div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Proveedor</th><th className="r">Lleva</th><th className="r">Hay</th><th className="r">Comprar</th><th className="r">Costo</th></tr></thead><tbody>
          {compras.map(({ c, q, packs }) => <tr key={c.id} style={q ? undefined : { opacity: 0.55 }}>
            <td><b>{c.nombre}</b></td><td className="muted">{c.proveedor ?? '—'}</td>
            <td className="r mono">{num(c.necesita)} {c.unidad}</td><td className="r mono">{num(Math.max(0, c.hay))}</td>
            <td className="r mono">{q ? (packs ? `${packs} ${c.pack_nombre ?? 'pack'}${packs > 1 ? 's' : ''}` : `${num(q)} ${c.unidad}`) : 'alcanza'}</td>
            <td className="r mono">{q ? plata(q * c.costo) : ''}</td></tr>)}
        </tbody></table></div>}
      {aComprar.length > 0 && <div className="muted" style={{ fontSize: 13, marginTop: 8, textAlign: 'right' }}>Total estimado <b className="mono">{plata(aComprar.reduce((s, x) => s + x.q * x.c.costo, 0))}</b></div>}
    </section>

    {sem.platos.length > 0 && <section className="panel">
      <h3 style={{ marginBottom: 6 }}>Platos guardados</h3>
      <div className="tbl-wrap"><table><thead><tr><th>Plato</th><th className="r">Precio</th><th className="r">Costo</th><th className="r">Veces</th><th /></tr></thead><tbody>
        {sem.platos.map((q) => <tr key={q.id}>
          <td><b>{q.nombre}</b>{q.descripcion && <div className="muted" style={{ fontSize: 12 }}>{q.descripcion}</div>}</td>
          <td className="r mono">{plata(q.precio)}</td>
          <td className="r">{q.con_receta ? <><span className="mono">{plata(q.costo)}</span> {pillCosto(q.precio ? q.costo / q.precio : null, objetivo)}</> : <span className="muted" style={{ fontSize: 12 }}>sin receta</span>}</td>
          <td className="r mono">{q.veces}</td>
          <td className="r"><button className="btn sm ghost" onClick={() => { const pr = prods.find((x) => x.id === q.id); if (pr) setVentana({ editar: pr }) }}>Editar</button></td></tr>)}
      </tbody></table></div>
    </section>}

    {ventana && <PlatoDelDia cats={cats} prods={prods} rec={rec} ins={ins} objetivo={objetivo} planificar inicial={'editar' in ventana ? ventana.editar : undefined}
      onCerrar={() => setVentana(null)}
      onListo={async (id, nombre) => {
        const dia = 'nuevo' in ventana && ventana.nuevo ? sem.dias.find((x) => x.fecha === ventana.nuevo) : undefined
        setVentana(null)
        if (dia && id) await planificar(dia, id, null, nombre); else d.recargar()
      }} />}
  </>
}
