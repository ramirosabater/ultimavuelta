import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { useEnVivo } from '../lib/datos'
import { fecha, hoy, jornada, sumarDias } from '../lib/formato'
import type { Rol } from '../lib/tipos'
import Ayuda from './Ayuda'
import { BAJADA, LOGO, NOMBRE } from '../lib/marca'

interface Opcion { to: string; b: string; s?: string; n?: number; roles?: Rol[] }
interface Grupo { t: string; to?: string; base?: string[]; n?: number; items?: Opcion[]; roles: Rol[] }

const GESTION: Rol[] = ['admin', 'encargado']

function Desplegable({ g, abierto, setAbierto, activo }: { g: Grupo; abierto: boolean; setAbierto: (v: boolean) => void; activo: boolean }) {
  return (
    <div className="dd">
      <button type="button" className={`dt ${activo ? 'active' : ''}`} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        {g.t}<span className="flecha" aria-hidden="true">▾</span>{g.n ? <span className="dot">{g.n}</span> : null}
      </button>
      {abierto && <div className="dm">{g.items!.map((o) => (
        <NavLink key={o.to} to={o.to} end onClick={() => setAbierto(false)}>
          <b>{o.b}{o.n ? <span className="badge">{o.n}</span> : null}</b>{o.s && <small>{o.s}</small>}
        </NavLink>))}
      </div>}
    </div>
  )
}

export default function Layout() {
  const { perfil, salir } = useAuth()
  const rol = perfil!.rol
  const gestion = GESTION.includes(rol)
  const { pathname } = useLocation()
  const [abierto, setAbierto] = useState<string | null>(null)
  const [n, setN] = useState({ salon: 0, cocina: 0, barra: 0, stock: 0, vencidos: 0 })
  const nav = useRef<HTMLElement>(null)

  // Los números del menú: lo que espera que alguien haga algo
  const contar = useCallback(async () => {
    const cuenta = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
    const [llamados, qr, listos, cocina, barra] = await Promise.all([
      cuenta(supabase.from('llamados').select('mesa_id', { count: 'exact', head: true })),
      cuenta(supabase.from('pedidos').select('id', { count: 'exact', head: true }).is('ticket_id', null).eq('confirmado', false)),
      cuenta(supabase.from('pedidos').select('id', { count: 'exact', head: true }).is('ticket_id', null).eq('confirmado', true).or('est_cocina.eq.listo,est_barra.eq.listo')),
      cuenta(supabase.from('pedidos').select('id', { count: 'exact', head: true }).is('ticket_id', null).eq('confirmado', true).in('est_cocina', ['pendiente', 'preparando'])),
      cuenta(supabase.from('pedidos').select('id', { count: 'exact', head: true }).is('ticket_id', null).eq('confirmado', true).in('est_barra', ['pendiente', 'preparando'])),
    ])
    let stock = 0, vencidos = 0
    if (gestion) {
      const [a, b, c] = await Promise.all([
        supabase.from('insumos').select('cantidad, minimo').eq('activo', true).gt('minimo', 0),
        cuenta(supabase.from('insumos').select('id', { count: 'exact', head: true }).eq('activo', true).gt('cantidad', 0).lte('vence', sumarDias(hoy(), 2))),
        cuenta(supabase.from('gastos').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').lt('vence', hoy())),
      ])
      stock = (a.data ?? []).filter((i) => Number(i.cantidad) <= Number(i.minimo)).length + b
      vencidos = c
    }
    setN({ salon: llamados + qr + listos, cocina, barra, stock, vencidos })
  }, [gestion])
  useEffect(() => { contar() }, [contar, pathname])
  useEnVivo(['pedidos', 'llamados'], contar, 30)

  useEffect(() => { setAbierto(null) }, [pathname])
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (!nav.current?.contains(e.target as Node)) setAbierto(null) }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(null) }
    document.addEventListener('click', fuera); document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('click', fuera); document.removeEventListener('keydown', tecla) }
  }, [abierto])

  const grupos: Grupo[] = [
    { t: 'Mesas', to: '/mesas', n: n.salon, roles: ['admin', 'encargado', 'mozo'] },
    { t: 'Parrilla', to: '/cocina', n: n.cocina, roles: ['admin', 'encargado', 'cocina'] },
    { t: 'Barra', to: '/barra', n: n.barra, roles: ['admin', 'encargado', 'barra'] },
    { t: 'Caja', to: '/caja', roles: GESTION },
    { t: 'Stock', base: ['/stock'], n: n.stock, roles: GESTION, items: [
      { to: '/stock/articulos', b: 'Artículos', s: 'Lo que comprás: stock, costo, vencimientos', n: n.stock },
      { to: '/stock/recetas', b: 'Recetas y costos', s: 'Cuánto cuesta cada plato y cuánto deja' },
      { to: '/stock/rendimientos', b: 'Rendimientos', s: 'Pesar crudo y limpio: la merma real' },
      { to: '/stock/compras', b: 'Compras', s: 'Qué comprar y cargar facturas con foto o PDF' },
      { to: '/stock/control', b: 'Control semanal', s: 'Inventario y lo que falta sin explicar' },
      { to: '/stock/mermas', b: 'Mermas', s: 'Lo que se tiró y por qué' },
    ] },
    { t: 'Tableros', base: ['/tableros'], roles: GESTION, items: [
      { to: '/tableros/resumen', b: 'Resumen', s: 'Esta noche, el mes y la plata' },
      { to: '/tableros/ventas', b: 'Ventas y servicio', s: 'Horarios, platos, mozos y tiempos' },
      { to: '/tableros/costos', b: 'Costos y desperdicio', s: 'Rentabilidad, mermas y precios' },
      { to: '/tableros/finanzas', b: 'Finanzas', s: 'Resultado, gastos y pagos' },
    ] },
    { t: 'Administración', base: ['/admin'], n: n.vencidos, roles: GESTION, items: [
      { to: '/admin/proveedores', b: 'Proveedores', s: 'Contactos, plazos y cuenta corriente' },
      { to: '/admin/gastos', b: 'Gastos', s: 'Lo pagado y lo que hay que pagar', n: n.vencidos },
      { to: '/admin/cuentas', b: 'Cuentas', s: 'Caja, banco, Mercado Pago' },
      { to: '/admin/usuarios', b: 'Usuarios', s: 'Quién entra y qué puede hacer', roles: ['admin'] },
      { to: '/admin/configuracion', b: 'Configuración', s: 'Nombre, jornada, compras y alertas', roles: ['admin'] },
    ] },
    { t: 'Carta y QR', base: ['/carta'], roles: GESTION, items: [
      { to: '/carta', b: 'Carta', s: 'Productos, precios y categorías' },
      { to: '/carta/mesas', b: 'Mesas y QR', s: 'Las mesas del salón y sus QR para imprimir' },
    ] },
  ]
  const visibles = grupos.filter((g) => g.roles.includes(rol)).map((g) => g.items ? { ...g, items: g.items.filter((o) => !o.roles || o.roles.includes(rol)) } : g)
  const activo = (g: Grupo) => (g.base ?? []).some((b) => pathname.startsWith(b))

  return (
    <>
      <header>
        <div className="wrap">
          <div className="hrow">
            <Link to="/" className="brand" aria-label="Inicio">
              <img className="brand-logo" src={LOGO} alt="" width={44} height={44} />
              <span className="brand-txt"><span>{NOMBRE}</span><small>{BAJADA}</small></span>
            </Link>
            <span className="jornada">Jornada {fecha(jornada())}</span>
            <div className="usuario"><span>{perfil!.nombre}</span><button onClick={salir}>Salir</button></div>
          </div>
          <nav aria-label="Secciones" ref={nav}>
            {visibles.map((g) => g.to
              ? <NavLink key={g.t} to={g.to} end={g.to === '/carta'}>{g.t}{g.n ? <span className="dot">{g.n}</span> : null}</NavLink>
              : <Desplegable key={g.t} g={g} activo={activo(g)} abierto={abierto === g.t} setAbierto={(v) => setAbierto(v ? g.t : null)} />)}
          </nav>
        </div>
        <div className="vitral" aria-hidden="true" />
      </header>
      <main className="wrap"><Outlet /></main>
      <Ayuda />
    </>
  )
}

/** Submenú de una sección, con los mismos destinos que el desplegable */
export function SubNav({ items }: { items: [string, string][] }) {
  return <div className="subnav no-imprimir">{items.map(([to, t]) => <NavLink key={to} to={to} end>{t}</NavLink>)}</div>
}
