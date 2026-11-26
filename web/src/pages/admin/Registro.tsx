// Registro: todo lo que pasó en la app, quién lo hizo y cuándo (solo dueños)
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { tabla, useConsulta } from '../../lib/datos'
import { fecha, hhmm, jornada, sumarDias } from '../../lib/formato'
import { SubNavAdmin } from './nav'
import { Cabeza } from '../../components/ui'
import { Kpi, color } from '../../components/tablero'

interface Fila { id: number; hora: string; jornada: string; usuario_id: string | null; usuario: string; rol: string | null; area: string; accion: string; tabla: string | null; texto: string; cambios: Record<string, [unknown, unknown]> | null; importante: boolean }

const AREAS: [string, string, string][] = [
  ['Salón', '🍽️', 'var(--t1)'], ['Cocina', '🔥', 'var(--t6)'], ['Bebidas', '🍹', 'var(--t7)'], ['Caja', '💵', 'var(--t4)'], ['Stock', '📦', 'var(--t8)'],
  ['Carta', '📋', 'var(--t3)'], ['Administración', '🧾', 'var(--t2)'], ['Reservas', '📅', 'var(--t5)'], ['Usuarios', '👤', 'var(--t6)'],
  ['Configuración', '⚙️', 'var(--t8)'], ['Ingresos', '🔑', 'var(--muted)'], ['Otros', '•', 'var(--muted)'],
]
const area = (a: string) => AREAS.find((x) => x[0] === a) ?? AREAS[AREAS.length - 1]
const PERIODOS: [string, string][] = [['hoy', 'Esta noche'], ['ayer', 'Anoche'], ['7', '7 días'], ['30', '30 días']]
const ROL: Record<string, string> = { admin: 'dueño', encargado: 'encargado', mozo: 'mozo', cocina: 'cocina', barra: 'bebidas' }
const valor = (v: unknown) => v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v)
const POR_PAGINA = 300

export default function Registro() {
  const [periodo, setPeriodo] = useState('hoy')
  const [quien, setQuien] = useState('')
  const [areas, setAreas] = useState<string[]>([])
  const [soloImp, setSoloImp] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [q, setQ] = useState('')
  const [limite, setLimite] = useState(POR_PAGINA)
  const [abierta, setAbierta] = useState<number | null>(null)
  useEffect(() => { const t = window.setTimeout(() => setQ(buscar.trim()), 350); return () => window.clearTimeout(t) }, [buscar])
  useEffect(() => { supabase.rpc('limpiar_registro').then(() => {}, () => {}) }, [])
  const j = jornada()
  const desde = periodo === 'hoy' ? j : periodo === 'ayer' ? sumarDias(j, -1) : sumarDias(j, -(Number(periodo) - 1))
  const hasta = periodo === 'ayer' ? sumarDias(j, -1) : j

  const d = useConsulta(async () => {
    let c = supabase.from('registro').select('*').gte('jornada', desde).lte('jornada', hasta).order('id', { ascending: false }).limit(limite)
    if (quien) c = quien === 'sistema' ? c.is('usuario_id', null) : c.eq('usuario_id', quien)
    if (areas.length) c = c.in('area', areas)
    if (soloImp) c = c.eq('importante', true)
    if (q) c = c.ilike('texto', `%${q.replace(/[%_]/g, '')}%`)
    const [filas, gente] = await Promise.all([
      tabla<Fila[]>(c),
      tabla<{ id: string; nombre: string; rol: string }[]>(supabase.from('perfiles').select('id, nombre, rol').order('nombre')),
    ])
    return { filas, gente }
  }, [desde, hasta, quien, areas.join(','), soloImp, q, limite])

  const filas = d.datos?.filas ?? []
  const porDia = new Map<string, Fila[]>()
  for (const f of filas) porDia.set(f.jornada, [...(porDia.get(f.jornada) ?? []), f])
  const porUsuario = new Map<string, number>()
  for (const f of filas) porUsuario.set(f.usuario, (porUsuario.get(f.usuario) ?? 0) + 1)
  const importantes = filas.filter((f) => f.importante).length
  const usuarios = new Set(filas.filter((f) => f.usuario_id).map((f) => f.usuario_id)).size

  function csv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const t = ['Fecha;Hora;Usuario;Rol;Área;Importante;Qué pasó', ...filas.map((f) => [f.jornada, hhmm(f.hora), f.usuario, f.rol ?? '', f.area, f.importante ? 'sí' : '', f.texto].map((x) => esc(String(x))).join(';'))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + t], { type: 'text/csv;charset=utf-8' }))
    a.download = `registro-${desde}${desde !== hasta ? `-a-${hasta}` : ''}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  return <>
    <Cabeza etiqueta="Administración" titulo="Registro">
      {filas.length > 0 && <button className="btn" onClick={csv}>Bajar en Excel (CSV)</button>}
    </Cabeza>
    <SubNavAdmin />
    <p className="muted" style={{ fontSize: 13, margin: '0 0 12px', maxWidth: '78ch' }}>Todo lo que pasa en la app queda anotado: quién lo hizo, cuándo y qué cambió. Mesas, pedidos, comandas, cobros, caja, compras, stock, carta, gastos, usuarios y configuración. Lo marcado con ⚠ es lo que conviene mirar: anulaciones, invitaciones, descuentos, cambios de precio, ventas sin factura, ajustes de stock, diferencias de caja y borrados.</p>

    <div className="kpis">
      <Kpi titulo="Movimientos" icono="📝" color={color(0)} valor={filas.length >= limite ? `${limite}+` : filas.length} pie={PERIODOS.find((p) => p[0] === periodo)?.[1]} />
      <Kpi titulo="Para mirar" icono="⚠️" color={color(5)} valor={importantes} pie={importantes ? <button className="link" onClick={() => setSoloImp(true)}>ver solo esos</button> : 'nada raro'} />
      <Kpi titulo="Personas" icono="👥" color={color(1)} valor={usuarios} pie={[...porUsuario].filter(([u]) => u !== 'Sistema').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u, n]) => `${u} ${n}`).join(' · ') || '—'} />
    </div>

    <section className="bloque" style={{ marginBottom: 'var(--tb-gap)' }}>
      <div className="fila" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="chips">{PERIODOS.map(([k, t]) => <button key={k} className="chip" aria-pressed={periodo === k} onClick={() => { setPeriodo(k); setLimite(POR_PAGINA) }}>{t}</button>)}</div>
        <select id="rg-quien" aria-label="Quién" value={quien} onChange={(e) => setQuien(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todas las personas</option>
          {(d.datos?.gente ?? []).map((g) => <option key={g.id} value={g.id}>{g.nombre} ({ROL[g.rol] ?? g.rol})</option>)}
          <option value="sistema">Sistema y clientes (QR, web)</option>
        </select>
        <label className="check" style={{ margin: 0 }}><input type="checkbox" id="rg-imp" checked={soloImp} onChange={(e) => setSoloImp(e.target.checked)} /> Solo lo importante</label>
        <input id="rg-buscar" type="search" placeholder="Buscar: mesa 5, vacío, anuló, precio…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ flex: '1 1 200px', width: 'auto' }} />
      </div>
      <div className="chips">{AREAS.slice(0, -1).map(([a, e]) => <button key={a} className="chip" aria-pressed={areas.includes(a)} onClick={() => setAreas(areas.includes(a) ? areas.filter((x) => x !== a) : [...areas, a])}>{e} {a}</button>)}
        {areas.length > 0 && <button className="chip" onClick={() => setAreas([])}>✕ Todas las áreas</button>}</div>
    </section>

    {d.error ? <div className="aviso bad">{d.error}</div> : !d.datos ? <p className="cargando">Cargando el registro…</p>
      : !filas.length ? <div className="notice"><b>No hay movimientos con estos filtros.</b><br />Probá con otro período o sacá algún filtro.</div>
      : <div className="registro">{[...porDia].map(([dia, fs]) => <section key={dia} className="bloque" style={{ marginBottom: 'var(--tb-gap)' }}>
        <div className="bloque-h"><h3>{dia === j ? 'Esta noche' : dia === sumarDias(j, -1) ? 'Anoche' : fecha(dia)}</h3><span className="bloque-der">{fs.length} movimiento{fs.length === 1 ? '' : 's'}</span></div>
        <ol className="rg-lista">{fs.map((f) => { const [, e, c] = area(f.area); const abre = abierta === f.id && f.cambios
          return <li key={f.id} className={f.importante ? 'imp' : ''} style={{ ['--k' as string]: c }}>
            <span className="rg-h mono">{hhmm(f.hora)}</span>
            <span className="rg-e" title={f.area} aria-hidden="true">{e}</span>
            <div className="rg-d">
              <div>{f.importante && <span className="rg-imp" title="Para mirar">⚠</span>}{f.texto}</div>
              <div className="rg-m"><b>{f.usuario}</b>{f.rol && ` · ${ROL[f.rol] ?? f.rol}`} · {f.area}
                {f.cambios && <button className="link" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setAbierta(abre ? null : f.id)}>{abre ? 'ocultar' : 'qué cambió'}</button>}</div>
              {abre && <table className="rg-cambios"><tbody>{Object.entries(f.cambios!).map(([k, [a, b]]) => <tr key={k}><th>{k.replace(/_/g, ' ')}</th><td className="muted">{valor(a)}</td><td>→</td><td><b>{valor(b)}</b></td></tr>)}</tbody></table>}
            </div>
          </li> })}</ol>
      </section>)}
        {filas.length >= limite && <button className="btn" onClick={() => setLimite(limite + POR_PAGINA)}>Ver más</button>}
      </div>}
    {d.datos && !filas.length && periodo === 'hoy' && !quien && !areas.length && !soloImp && !q && <p className="muted" style={{ fontSize: 13 }}>Si recién activaste el registro, empieza a anotar desde ahora.</p>}
  </>
}

