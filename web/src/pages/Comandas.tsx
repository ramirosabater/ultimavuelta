import { useEffect, useState } from 'react'
import { leerParametros, rpc, tabla, useConsulta, useEnVivo } from '../lib/datos'
import { supabase } from '../lib/supabase'
import { hhmm, minutosDesde } from '../lib/formato'
import type { EstadoComanda, Estacion, Mesa, Pedido } from '../lib/tipos'
import { Items } from '../components/salon'
import { AutoVacio } from '../components/Autos'
import { Cabeza, Pill, useAccion } from '../components/ui'

const COLUMNAS: { estado: EstadoComanda; titulo: string; boton: string; sigue: EstadoComanda }[] = [
  { estado: 'pendiente', titulo: 'Pendientes', boton: 'Empezar', sigue: 'preparando' },
  { estado: 'preparando', titulo: 'En preparación', boton: 'Listo para servir', sigue: 'listo' },
  { estado: 'listo', titulo: 'Listos', boton: 'Entregado a la mesa', sigue: 'entregado' },
]

/** Pantalla de parrilla o de barra: las comandas de esa estación, en vivo */
export default function Comandas({ estacion }: { estacion: Estacion }) {
  const campo = estacion === 'cocina' ? 'est_cocina' : 'est_barra'
  const { datos, recargar, error } = useConsulta(async () => {
    const [pedidos, mesas, par] = await Promise.all([
      tabla<Pedido[]>(supabase.from('pedidos').select('*, pedido_items(*)').is('ticket_id', null).eq('confirmado', true)
        .in(campo, ['pendiente', 'preparando', 'listo']).order('creado')),
      tabla<Mesa[]>(supabase.from('mesas').select('id, numero')),
      leerParametros(),
    ])
    const lim = (par[estacion === 'cocina' ? 'alerta_cocina' : 'alerta_barra'] ?? (estacion === 'cocina' ? '15,25' : '5,10')).split(',').map(Number)
    return { pedidos, mesas: new Map(mesas.map((m) => [m.id, m.numero])), lim }
  }, [estacion])
  useEnVivo(['pedidos', 'pedido_items'], recargar, 15)
  // El reloj de cada comanda se actualiza solo
  const [, setTic] = useState(0)
  useEffect(() => { const t = window.setInterval(() => setTic((x) => x + 1), 30000); return () => window.clearInterval(t) }, [])
  const { correr, ocupado } = useAccion()

  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <p className="cargando">Cargando comandas…</p>
  const [amarillo, rojo] = datos.lim

  return <>
    <Cabeza etiqueta="Comandas" titulo={estacion === 'cocina' ? 'Parrilla y cocina' : 'Barra'}>
      <span className="muted" style={{ fontSize: 13 }}>Alerta a los {amarillo} min, urgente a los {rojo}</span>
    </Cabeza>
    <div className="kds" data-ayuda="comandas">{COLUMNAS.map((c) => {
      const lista = datos.pedidos.filter((p) => p[campo] === c.estado)
      return <section key={c.estado} className="kcol">
        <h3>{c.titulo} <Pill>{lista.length}</Pill></h3>
        {!lista.length ? <AutoVacio texto="Boxes libres: nada por acá" cat={estacion === 'barra' ? 'gol' : 'tc'} /> : lista.map((p) => {
          const mm = minutosDesde(p.creado)
          const nivel = c.estado === 'listo' ? '' : mm >= rojo ? 'crit' : mm >= amarillo ? 'warn' : ''
          return <article key={p.id} className={`ticket${nivel ? ` t-${nivel}` : ''}`}>
            <div className="th"><b>Mesa {datos.mesas.get(p.mesa_id)}</b><Pill tono={nivel as '' | 'warn' | 'crit'}>{hhmm(p.creado)} · {mm} min</Pill></div>
            <Items items={(p.pedido_items ?? []).filter((i) => i.estacion === estacion)} precios={false} />
            <button className={`btn${c.estado === 'listo' ? '' : ' pri'}`} disabled={ocupado}
              onClick={async () => { if (await correr(() => rpc('avanzar_comanda', { p_pedido: p.id, p_estacion: estacion, p_estado: c.sigue }))) recargar() }}>{c.boton}</button>
          </article>
        })}
      </section>
    })}</div>
  </>
}
