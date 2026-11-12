import { useEffect, useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { DIAS_LARGO, diasEntre, fecha, jornada, sumarDias } from '../../lib/formato'
import { CAT_GASTO, type Categoria, type Cuenta, type Insumo, type MedioPago, type Producto, type Proveedor } from '../../lib/tipos'
import { SubNav } from '../../components/Layout'

export const SubNavTableros = () => <SubNav items={[['/tableros/resumen', 'Resumen'], ['/tableros/ventas', 'Ventas y servicio'], ['/tableros/costos', 'Costos y desperdicio'], ['/tableros/finanzas', 'Finanzas']]} />

const PRESETS: [string, string][] = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['mesant', 'Mes pasado'], ['90', '90 días'], ['anio', 'Este año']]
export type Clave = 'categoria' | 'producto' | 'mozo' | 'medio' | 'dow' | 'insumo' | 'proveedor' | 'gcat' | 'cuenta'
export interface F { preset: string; desde: string; hasta: string; comparar: boolean; f: Partial<Record<Clave, string>> }

function rango(p: string): [string, string] {
  const h = jornada()
  switch (p) {
    case 'hoy': return [h, h]
    case 'ayer': { const a = sumarDias(h, -1); return [a, a] }
    case '7': return [sumarDias(h, -6), h]
    case 'mes': return [h.slice(0, 8) + '01', h]
    case 'mesant': { const ini = h.slice(0, 8) + '01'; const fin = sumarDias(ini, -1); return [fin.slice(0, 8) + '01', fin] }
    case '90': return [sumarDias(h, -89), h]
    case 'anio': return [h.slice(0, 5) + '01-01', h]
    default: return [sumarDias(h, -29), h]
  }
}
const CLAVE = 'uv-filtros'
function leer(): F {
  let o: Partial<F> = {}
  try { o = JSON.parse(localStorage.getItem(CLAVE) || '{}') } catch { /* sin memoria */ }
  const preset = o.preset ?? '30'
  const [d, h] = preset === 'custom' && o.desde && o.hasta ? [o.desde, o.hasta] : rango(preset)
  return { preset, desde: d, hasta: h, comparar: o.comparar ?? true, f: o.f ?? {} }
}

/** Filtros compartidos por los tableros (quedan guardados en este navegador) */
export function useFiltros() {
  const [F, setF] = useState<F>(leer)
  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(F)) } catch { /* sin memoria */ } }, [F])
  return { F, setF }
}
/** Los filtros que tocan a esta pantalla, en el formato que espera la base */
export const filtrosBase = (F: F, claves: Clave[]) => Object.fromEntries(claves.filter((k) => F.f[k]).map((k) => [k, F.f[k]]))

export function BarraFiltros({ F, setF, claves }: { F: F; setF: (f: F) => void; claves: Clave[] }) {
  const op = useConsulta(async () => {
    const [cats, prods, insumos, provs, medios, cuentas, mozos] = await Promise.all([
      tabla<Categoria[]>(supabase.from('categorias').select('*').order('orden')),
      tabla<Producto[]>(supabase.from('productos').select('id, nombre').order('nombre')),
      tabla<Insumo[]>(supabase.from('insumos').select('id, nombre').order('nombre')),
      tabla<Proveedor[]>(supabase.from('proveedores').select('id, nombre').order('nombre')),
      tabla<MedioPago[]>(supabase.from('medios_pago').select('nombre').order('orden')),
      tabla<Cuenta[]>(supabase.from('cuentas').select('id, nombre').order('orden')),
      tabla<{ id: string; nombre: string }[]>(supabase.from('perfiles').select('id, nombre').in('rol', ['admin', 'encargado', 'mozo']).order('nombre')),
    ])
    return { cats, prods, insumos, provs, medios, cuentas, mozos }
  })
  const o = op.datos
  const lista: Record<Clave, [string, [string, string][]]> = {
    categoria: ['Categoría', (o?.cats ?? []).map((c) => [c.nombre, c.nombre])],
    producto: ['Plato o trago', (o?.prods ?? []).map((p) => [String(p.id), p.nombre])],
    mozo: ['Mozo', [...(o?.mozos ?? []).map((m) => [m.id, m.nombre] as [string, string]), ['sin', 'Sin mozo']]],
    medio: ['Medio de pago', (o?.medios ?? []).map((m) => [m.nombre, m.nombre])],
    dow: ['Día', [1, 2, 3, 4, 5, 6, 0].map((d) => [String(d), DIAS_LARGO[d][0].toUpperCase() + DIAS_LARGO[d].slice(1)])],
    insumo: ['Artículo', (o?.insumos ?? []).map((i) => [String(i.id), i.nombre])],
    proveedor: ['Proveedor', (o?.provs ?? []).map((p) => [String(p.id), p.nombre])],
    gcat: ['Categoría de gasto', CAT_GASTO.map((c) => [c, c])],
    cuenta: ['Cuenta', (o?.cuentas ?? []).map((c) => [String(c.id), c.nombre])],
  }
  const activos = claves.filter((k) => F.f[k])
  const n = diasEntre(F.desde, F.hasta) + 1
  return <section className="panel fbar no-imprimir" data-ayuda="filtros">
    <div className="chips" style={{ marginBottom: 10 }}>{PRESETS.map(([k, l]) => <button key={k} className="chip" aria-pressed={F.preset === k}
      onClick={() => { const [d, h] = rango(k); setF({ ...F, preset: k, desde: d, hasta: h }) }}>{l}</button>)}</div>
    <div className="fgrid">
      <label className="campo flt"><span>Desde</span><input type="date" id="flt-desde" value={F.desde} max={F.hasta} onChange={(e) => e.target.value && setF({ ...F, preset: 'custom', desde: e.target.value, hasta: e.target.value > F.hasta ? e.target.value : F.hasta })} /></label>
      <label className="campo flt"><span>Hasta</span><input type="date" id="flt-hasta" value={F.hasta} min={F.desde} max={jornada()} onChange={(e) => e.target.value && setF({ ...F, preset: 'custom', hasta: e.target.value, desde: e.target.value < F.desde ? e.target.value : F.desde })} /></label>
      {claves.map((k) => <label key={k} className="campo flt"><span>{lista[k][0]}</span>
        <select id={`flt-${k}`} value={F.f[k] ?? ''} onChange={(e) => setF({ ...F, f: { ...F.f, [k]: e.target.value || undefined } })}>
          <option value="">Todos</option>{lista[k][1].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
    </div>
    <div className="fila" style={{ marginTop: 10 }}>
      <label className="check"><input type="checkbox" id="flt-comparar" checked={F.comparar} onChange={(e) => setF({ ...F, comparar: e.target.checked })} /> Comparar con el período anterior</label>
      <span className="muted" style={{ fontSize: 13 }}>{n} día{n > 1 ? 's' : ''} · {fecha(F.desde)}{F.desde !== F.hasta ? ` a ${fecha(F.hasta)}` : ''}</span>
      <span className="grow" />
      {activos.length > 0 && <button className="btn sm ghost" onClick={() => setF({ ...F, f: {} })}>Quitar filtros ({activos.length})</button>}
    </div>
  </section>
}
