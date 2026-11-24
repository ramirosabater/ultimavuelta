// La semana de platos del día: qué plato va cada día y cuántas porciones, y lo que hay que comprar para eso.
import { useState, type ReactNode } from 'react'
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
  const compras = sem.compras.map((c) => ({ c, ...falta(c) })).sort((a, b) => Number(b.q > 0) - Number(a.q > 0))   // primero lo que hay que comprar
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

  // Los tres pasos: cada uno sabe si ya está hecho, y el primero que falta queda marcado como "ahora".
  const hayPlatos = sem.platos.length > 0
  const futuros = abiertos.filter((x) => !x.pasado)
  const vacios = futuros.filter((x) => !x.producto_id)
  const semanaLista = futuros.length > 0 && vacios.length === 0
  const pasos = [
    { n: 1, id: 'paso-platos', t: 'Armá tus platos', hecho: hayPlatos,
      falta: 'Cargá al menos un plato del día. Se hace una sola vez y después se repite cuando quieras.' },
    { n: 2, id: 'paso-semana', t: 'Elegí el plato de cada día', hecho: semanaLista,
      falta: vacios.length ? `${vacios.length === 1 ? 'Falta 1 día' : `Faltan ${vacios.length} días`} sin plato: ${vacios.map((x) => DIAS[dow(x.fecha)]).join(', ')}.` : 'No hay días abiertos esta semana.' },
    { n: 3, id: 'paso-compras', t: 'Comprá lo que falta', hecho: planificados.length > 0 && aComprar.length === 0,
      falta: planificados.length ? `Hay ${aComprar.length} ${aComprar.length === 1 ? 'artículo' : 'artículos'} para comprar.` : 'Aparece cuando elijas los platos.' },
  ]
  const ahora = pasos.find((x) => !x.hecho)?.n ?? 0
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const Titulo = ({ n, children }: { n: number; children: ReactNode }) => {
    const ps = pasos[n - 1]
    return <h3><span className={`fac-n${ps.hecho ? ' hecho' : ''}`}>{ps.hecho ? '✓' : n}</span><span className="grow">{children}</span>
      {ps.hecho ? <Pill tono="ok">Listo</Pill> : ahora === n ? <Pill tono="acc">Ahora</Pill> : null}</h3>
  }

  return <>
    <Cabeza etiqueta="Carta y QR" titulo="Platos del día" />
    <SubNavCarta />

    <nav className="pasos" aria-label="Pasos">
      {pasos.map((x) => <button key={x.n} className={`paso${x.hecho ? ' hecho' : ''}${ahora === x.n ? ' ahora' : ''}`} onClick={() => ir(x.id)}>
        <span className="fac-n">{x.hecho ? '✓' : x.n}</span>
        <span><b>{x.t}</b><small>{x.hecho ? 'Listo' : x.falta}</small></span>
      </button>)}
    </nav>
    {ahora === 0 && <div className="aviso ok" style={{ marginBottom: 14 }}>La semana está lista: cada día el plato se pone solo en la carta.</div>}

    {/* Paso 1 */}
    <section className="panel fac-paso" id="paso-platos">
      <Titulo n={1}>Armá tus platos del día</Titulo>
      <p className="muted paso-ayuda">Nombre, qué lleva y precio. Tocá <b>“Que Chichito calcule la receta”</b> y él estima las cantidades. El plato queda guardado para repetirlo otros días.</p>
      {hayPlatos && <div className="tbl-wrap" style={{ marginBottom: 10 }}><table><thead><tr><th>Plato</th><th className="r">Precio</th><th className="r">Costo</th><th className="r">Veces</th><th /></tr></thead><tbody>
        {sem.platos.map((q) => <tr key={q.id}>
          <td><b>{q.nombre}</b>{q.descripcion && <div className="muted" style={{ fontSize: 12 }}>{q.descripcion}</div>}</td>
          <td className="r mono">{plata(q.precio)}</td>
          <td className="r">{q.con_receta ? <><span className="mono">{plata(q.costo)}</span> {pillCosto(q.precio ? q.costo / q.precio : null, objetivo)}</> : <Pill tono="crit">sin receta</Pill>}</td>
          <td className="r mono">{q.veces}</td>
          <td className="r"><button className="btn sm ghost" onClick={() => { const pr = prods.find((x) => x.id === q.id); if (pr) setVentana({ editar: pr }) }}>Editar</button></td></tr>)}
      </tbody></table></div>}
      <button className={`btn${hayPlatos ? '' : ' pri'}`} data-ayuda="nuevo-plato-dia" onClick={() => setVentana({ nuevo: null })}>＋ Nuevo plato del día</button>
    </section>

    {/* Paso 2 */}
    <section className="panel fac-paso" id="paso-semana">
      <Titulo n={2}>Elegí qué plato va cada día</Titulo>
      {!hayPlatos ? <div className="kempty">Primero armá un plato en el paso 1.</div> : <>
        <p className="muted paso-ayuda">Elegí el plato de cada día y revisá las porciones: te ponemos las <b>sugeridas</b> según lo que se vendió ese día de la semana, y las podés cambiar. El día que toca el plato <b>se pone solo en la carta</b> y se saca el anterior.</p>
        <div className="fila" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button className="btn sm" disabled={desde <= jornada()} onClick={() => setDesde(sumarDias(desde, -7))}>‹ Anterior</button>
          <b className="grow" style={{ textAlign: 'center' }}>Del {fecha(desde)} al {fecha(sumarDias(desde, 6))}</b>
          <button className="btn sm" onClick={() => setDesde(sumarDias(desde, 7))}>Siguiente ›</button>
        </div>
        <div className="rows semana-platos">{sem.dias.map((x) => {
          const p = plato(x.producto_id), esHoy = x.fecha === sem.hoy
          const n = porc[x.fecha] ?? (x.porciones != null ? String(x.porciones) : '')
          const falta = !x.cerrado && !x.pasado && !x.producto_id
          return <div className={`row${falta ? ' falta' : ''}`} key={x.fecha} style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, opacity: x.pasado ? 0.65 : 1 }}>
            <div style={{ minWidth: 92 }}><b>{DIAS[dow(x.fecha)]} {Number(x.fecha.slice(8, 10))}</b>{esHoy && <> <Pill tono="ok">hoy</Pill></>}</div>
            {x.cerrado ? <span className="muted grow">Cerrado</span> : <>
              <select id={`ps-p-${x.fecha}`} aria-label={`Plato del ${fecha(x.fecha)}`} value={x.producto_id ?? ''} disabled={x.pasado}
                onChange={(e) => { const v = e.target.value; if (v === 'nuevo') setVentana({ nuevo: x.fecha }); else planificar(x, v ? Number(v) : null, null) }}
                style={{ flex: 2, minWidth: 170, width: 'auto' }}>
                <option value="">{x.pasado ? 'Sin plato del día' : '— Elegí el plato —'}</option>
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
                  {!x.pasado && x.sugerido != null && x.porciones !== x.sugerido && <><br /><button className="link" onClick={() => planificar(x, x.producto_id, x.sugerido)}>usar sugeridas ({x.sugerido})</button></>}
                </span>
              </> : <span className="grow" />}
            </>}
          </div>
        })}</div>
        <div className="stats" style={{ marginTop: 12 }}>
          <Stat label="Días con plato" valor={`${planificados.length} de ${abiertos.length}`} />
          <Stat label="Porciones" valor={num(porciones)} />
          <Stat label="Mercadería" valor={plata(costoSemana)} extra={ventaSemana ? `${Math.round(costoSemana / ventaSemana * 100)} % de lo que se vende` : undefined} />
        </div>
      </>}
    </section>

    {/* Paso 3 */}
    <section className="panel fac-paso" id="paso-compras">
      <Titulo n={3}>Comprá lo que falta</Titulo>
      {!planificados.length ? <div className="kempty">Cuando elijas los platos de la semana (paso 2), acá aparece lo que hay que comprar.</div> : <>
        <p className="muted paso-ayuda">Lo que llevan los platos de esta semana contra lo que hay en stock. Tocá <b>Copiar lista</b> y pegala en WhatsApp al proveedor. (Esto también se suma solo a <b>Stock → Compras</b>.)</p>
        {!aComprar.length && <div className="aviso ok" style={{ marginBottom: 10 }}>Con lo que hay en stock alcanza para los platos de la semana.</div>}
        <div className="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Proveedor</th><th className="r">Lleva</th><th className="r">Hay</th><th className="r">Comprar</th><th className="r">Costo</th></tr></thead><tbody>
          {compras.map(({ c, q, packs }) => <tr key={c.id} style={q ? undefined : { opacity: 0.55 }}>
            <td><b>{c.nombre}</b></td><td className="muted">{c.proveedor ?? '—'}</td>
            <td className="r mono">{num(c.necesita)} {c.unidad}</td><td className="r mono">{num(Math.max(0, c.hay))}</td>
            <td className="r mono">{q ? (packs ? `${packs} ${c.pack_nombre ?? 'pack'}${packs > 1 ? 's' : ''}` : `${num(q)} ${c.unidad}`) : 'alcanza'}</td>
            <td className="r mono">{q ? plata(q * c.costo) : ''}</td></tr>)}
        </tbody></table></div>
        {aComprar.length > 0 && <div className="fila" style={{ marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
          <span className="muted grow" style={{ fontSize: 13 }}>Total estimado <b className="mono">{plata(aComprar.reduce((s, x) => s + x.q * x.c.costo, 0))}</b></span>
          <button className="btn pri" onClick={copiar}>Copiar lista</button></div>}
      </>}
    </section>

    {ventana && <PlatoDelDia cats={cats} prods={prods} rec={rec} ins={ins} objetivo={objetivo} planificar inicial={'editar' in ventana ? ventana.editar : undefined}
      onCerrar={() => setVentana(null)}
      onListo={async (id, nombre) => {
        const dia = 'nuevo' in ventana && ventana.nuevo ? sem.dias.find((x) => x.fecha === ventana.nuevo) : undefined
        setVentana(null)
        if (dia && id) await planificar(dia, id, null, nombre); else d.recargar()
      }} />}
  </>
}
