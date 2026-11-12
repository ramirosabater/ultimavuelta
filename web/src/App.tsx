import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import Ingreso from './auth/Ingreso'
import ElegirClave from './auth/ElegirClave'
import Layout from './components/Layout'
import { Auto } from './components/Autos'
import { ToastProvider } from './components/ui'
import type { Rol } from './lib/tipos'

// Las pantallas se cargan cuando se usan: el celular del mozo no baja los tableros
const Mesas = lazy(() => import('./pages/Mesas'))
const Comandas = lazy(() => import('./pages/Comandas'))
const Caja = lazy(() => import('./pages/Caja'))
const Publico = lazy(() => import('./pages/Publico'))
const Articulos = lazy(() => import('./pages/stock/Articulos'))
const Recetas = lazy(() => import('./pages/stock/Recetas'))
const Rendimientos = lazy(() => import('./pages/stock/Rendimientos'))
const Compras = lazy(() => import('./pages/stock/Compras'))
const Control = lazy(() => import('./pages/stock/Control'))
const Mermas = lazy(() => import('./pages/stock/Mermas'))
const TResumen = lazy(() => import('./pages/tableros/Resumen'))
const TVentas = lazy(() => import('./pages/tableros/Ventas'))
const TCostos = lazy(() => import('./pages/tableros/Costos'))
const TFinanzas = lazy(() => import('./pages/tableros/Finanzas'))
const Proveedores = lazy(() => import('./pages/admin/Proveedores'))
const Gastos = lazy(() => import('./pages/admin/Gastos'))
const Cuentas = lazy(() => import('./pages/admin/Cuentas'))
const Usuarios = lazy(() => import('./pages/admin/Usuarios'))
const Configuracion = lazy(() => import('./pages/admin/Configuracion'))
const Carta = lazy(() => import('./pages/carta/Carta'))
const MesasQR = lazy(() => import('./pages/carta/MesasQR'))

const G: Rol[] = ['admin', 'encargado']
/** Adónde va cada uno al entrar */
const INICIO: Record<Rol, string> = { admin: '/tableros/resumen', encargado: '/mesas', mozo: '/mesas', cocina: '/cocina', barra: '/barra' }

function Solo({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { perfil } = useAuth()
  return perfil && roles.includes(perfil.rol) ? <>{children}</> : <Navigate to="/" replace />
}

function Privado() {
  const { cargando, perfil, sinPerfil, salir } = useAuth()
  if (cargando) return <div className="ingreso"><div className="calentando"><Auto cat="tc" numero={7} /><p>Calentando motores…</p></div></div>
  if (sinPerfil) return <div className="ingreso"><div className="card stack"><h1>Sin acceso</h1>
    <p style={{ margin: 0 }}>Tu usuario no está activo. Pedile a uno de los dueños que te habilite.</p><button className="btn" onClick={salir}>Salir</button></div></div>
  if (!perfil) return <Ingreso />
  return <Suspense fallback={<p className="cargando wrap">Cargando…</p>}><Routes>
    <Route element={<Layout />}>
      <Route index element={<Navigate to={INICIO[perfil.rol]} replace />} />
      <Route path="mesas" element={<Solo roles={['admin', 'encargado', 'mozo']}><Mesas /></Solo>} />
      <Route path="cocina" element={<Solo roles={['admin', 'encargado', 'cocina']}><Comandas key="cocina" estacion="cocina" /></Solo>} />
      <Route path="barra" element={<Solo roles={['admin', 'encargado', 'barra']}><Comandas key="barra" estacion="barra" /></Solo>} />
      <Route path="caja" element={<Solo roles={G}><Caja /></Solo>} />
      <Route path="stock">
        <Route index element={<Navigate to="articulos" replace />} />
        <Route path="articulos" element={<Solo roles={G}><Articulos /></Solo>} />
        <Route path="recetas" element={<Solo roles={G}><Recetas /></Solo>} />
        <Route path="rendimientos" element={<Solo roles={G}><Rendimientos /></Solo>} />
        <Route path="compras" element={<Solo roles={G}><Compras /></Solo>} />
        <Route path="control" element={<Solo roles={G}><Control /></Solo>} />
        <Route path="mermas" element={<Solo roles={G}><Mermas /></Solo>} />
      </Route>
      <Route path="tableros">
        <Route index element={<Navigate to="resumen" replace />} />
        <Route path="resumen" element={<Solo roles={G}><TResumen /></Solo>} />
        <Route path="ventas" element={<Solo roles={G}><TVentas /></Solo>} />
        <Route path="costos" element={<Solo roles={G}><TCostos /></Solo>} />
        <Route path="finanzas" element={<Solo roles={G}><TFinanzas /></Solo>} />
      </Route>
      <Route path="admin">
        <Route index element={<Navigate to="gastos" replace />} />
        <Route path="proveedores" element={<Solo roles={G}><Proveedores /></Solo>} />
        <Route path="gastos" element={<Solo roles={G}><Gastos /></Solo>} />
        <Route path="cuentas" element={<Solo roles={G}><Cuentas /></Solo>} />
        <Route path="usuarios" element={<Solo roles={['admin']}><Usuarios /></Solo>} />
        <Route path="configuracion" element={<Solo roles={['admin']}><Configuracion /></Solo>} />
      </Route>
      <Route path="carta" element={<Solo roles={G}><Carta /></Solo>} />
      <Route path="carta/mesas" element={<Solo roles={G}><MesasQR /></Solo>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes></Suspense>
}

export default function App() {
  return <BrowserRouter><ToastProvider><Routes>
    {/* La carta del QR es pública: no pasa por el ingreso */}
    <Route path="/m/:token" element={<Suspense fallback={null}><Publico /></Suspense>} />
    <Route path="/elegir-clave" element={<AuthProvider><ElegirClave /></AuthProvider>} />
    <Route path="/*" element={<AuthProvider><Privado /></AuthProvider>} />
  </Routes></ToastProvider></BrowserRouter>
}
