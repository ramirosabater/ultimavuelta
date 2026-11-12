import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, mensajeError } from '../lib/supabase'
import { hhmm, plata } from '../lib/formato'
import { LOGO, NOMBRE } from '../lib/marca'
import { Grilla } from '../components/Autos'

interface Prod { id: number; nombre: string; descripcion: string | null; precio: number; agotado: boolean }
interface CartaQR {
  local: string; bajada: string; mesa: number
  categorias: { nombre: string; productos: Prod[] }[]
  pedidos: { id: number; hora: string; confirmado: boolean; estado: 'esperando' | 'recibido' | 'preparando' | 'listo' | 'entregado'; items: { nombre: string; cantidad: number }[] }[]
  llamado: boolean
}
const ESTADO = { esperando: 'Esperando al mozo', recibido: 'Recibido', preparando: 'Preparándose', listo: '¡Listo! Ya te lo llevan', entregado: 'Entregado' }

/** La carta que ve el cliente al escanear el QR de la mesa. No necesita usuario. */
export default function Publico() {
  const { token = '' } = useParams()
  const [c, setC] = useState<CartaQR | null>(null)
  const [error, setError] = useState('')
  const [carrito, setCarrito] = useState<Record<number, { n: number; nota: string }>>({})
  const [verCarrito, setVerCarrito] = useState(false)
  const [msj, setMsj] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [cat, setCat] = useState(0)

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('carta_publica', { p_token: token })
    if (e) { setError('No pudimos cargar la carta. Probá de nuevo en un rato.'); return }
    if (!data) { setError('Este QR ya no es válido. Pedile la carta al mozo.'); return }
    setC(data as CartaQR); setError('')
  }, [token])
  useEffect(() => { cargar(); const iv = window.setInterval(cargar, 15000); return () => window.clearInterval(iv) }, [cargar])
  useEffect(() => { if (!msj) return; const t = window.setTimeout(() => setMsj(''), 3500); return () => window.clearTimeout(t) }, [msj])

  const productos = useMemo(() => Object.fromEntries((c?.categorias ?? []).flatMap((k) => k.productos).map((p) => [p.id, p])), [c])
  const items = Object.entries(carrito).filter(([, v]) => v.n > 0).map(([id, v]) => ({ p: productos[Number(id)], ...v })).filter((x) => x.p)
  const total = items.reduce((s, x) => s + x.n * Number(x.p.precio), 0)
  const cuantos = items.reduce((s, x) => s + x.n, 0)
  const sumar = (id: number, d: number) => setCarrito((k) => ({ ...k, [id]: { n: Math.max(0, Math.min(20, (k[id]?.n ?? 0) + d)), nota: k[id]?.nota ?? '' } }))

  async function pedir() {
    setOcupado(true)
    const { error: e } = await supabase.rpc('pedir_desde_mesa', { p_token: token, p_items: items.map((x) => ({ producto_id: x.p.id, cantidad: x.n, nota: x.nota.trim() || null })) })
    setOcupado(false)
    if (e) { setMsj(mensajeError(e)); return }
    setCarrito({}); setVerCarrito(false); setMsj('¡Listo! El mozo confirma tu pedido en un momento.'); cargar()
  }
  async function llamar() {
    const { error: e } = await supabase.rpc('llamar_mozo', { p_token: token })
    setMsj(e ? mensajeError(e) : 'Avisamos al mozo. Ya viene.'); cargar()
  }

  if (error) return <div className="pub"><div className="pub-cab"><img src={LOGO} alt="" width={72} height={72} /><h1>{NOMBRE}</h1></div><p className="pub-error">{error}</p></div>
  if (!c) return <div className="pub"><p className="cargando" style={{ textAlign: 'center', marginTop: 80 }}>Cargando la carta…</p></div>
  const activos = c.pedidos.filter((p) => p.estado !== 'entregado')

  return <div className="pub">
    <div className="pub-cab"><img src={LOGO} alt="" width={72} height={72} /><div><h1>{c.local}</h1><small>{c.bajada}</small></div><span className="pub-mesa">Mesa {c.mesa}</span></div>
    {activos.length > 0 && <section className="pub-pedidos">{activos.map((p) => <div key={p.id} className={`pub-ped ${p.estado}`}>
      <b>{ESTADO[p.estado]}</b><span className="muted"> · {hhmm(p.hora)}</span>
      <div style={{ fontSize: 13 }}>{p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}</div></div>)}</section>}
    <nav className="pub-cats">{c.categorias.map((k, i) => <button key={k.nombre} aria-pressed={cat === i} onClick={() => { setCat(i); document.getElementById(`cat-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{k.nombre}</button>)}</nav>
    {c.categorias.map((k, i) => <section key={k.nombre} id={`cat-${i}`} className="pub-sec"><h2>{k.nombre}</h2>
      {k.productos.map((p) => { const n = carrito[p.id]?.n ?? 0; return <div key={p.id} className={`pub-prod ${p.agotado ? 'agotado' : ''}`}>
        <div className="grow"><b>{p.nombre}</b>{p.descripcion && <div className="muted">{p.descripcion}</div>}<div className="pub-precio">{p.agotado ? 'Agotado' : plata(p.precio)}</div></div>
        {!p.agotado && (n ? <div className="pub-cant"><button aria-label={`Sacar ${p.nombre}`} onClick={() => sumar(p.id, -1)}>−</button><b>{n}</b><button aria-label={`Agregar otro ${p.nombre}`} onClick={() => sumar(p.id, 1)}>+</button></div>
          : <button className="pub-add" aria-label={`Agregar ${p.nombre}`} onClick={() => sumar(p.id, 1)}>+</button>)}
      </div> })}
    </section>)}
    <footer className="pub-fin"><div className="label">En pista</div><Grilla /></footer>
    <div style={{ height: 110 }} />
    <div className="pub-pie">
      <button className="btn" onClick={llamar} disabled={c.llamado}>{c.llamado ? 'El mozo ya viene' : 'Llamar al mozo'}</button>
      {cuantos > 0 && <button className="btn pri grow" onClick={() => setVerCarrito(true)}>Ver pedido · {cuantos} · {plata(total)}</button>}
    </div>
    {msj && <div className="toast" role="status">{msj}</div>}
    {verCarrito && <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setVerCarrito(false) }}><div className="modal" role="dialog" aria-label="Tu pedido">
      <div className="m-h"><h2>Tu pedido</h2><button className="btn sm ghost" onClick={() => setVerCarrito(false)}>Seguir mirando</button></div>
      <div className="m-b">{items.map((x) => <div key={x.p.id} style={{ marginBottom: 12 }}>
        <div className="fila"><b className="grow">{x.n}× {x.p.nombre}</b><span className="mono">{plata(x.n * Number(x.p.precio))}</span></div>
        <input placeholder="Aclaración (sin sal, punto jugoso…)" maxLength={140} value={x.nota} onChange={(e) => setCarrito((k) => ({ ...k, [x.p.id]: { ...k[x.p.id], nota: e.target.value } }))} style={{ marginTop: 4 }} />
      </div>)}<div className="total-row"><span className="label">Total</span><span className="num">{plata(total)}</span></div>
        <p className="muted" style={{ fontSize: 13 }}>El mozo confirma el pedido antes de que salga. Se paga al final, en la mesa.</p></div>
      <div className="m-f"><span className="grow" /><button className="btn pri" disabled={ocupado} onClick={pedir}>{ocupado ? 'Enviando…' : 'Pedir'}</button></div>
    </div></div>}
  </div>
}
