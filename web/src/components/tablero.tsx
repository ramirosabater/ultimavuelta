// Piezas de los tableros: tarjetas de indicadores, dona, barras con valor, área, anillo y rankings.
// Todo en SVG propio, con los colores del tema (claro y oscuro).
import type { ReactNode } from 'react'
import { plata } from '../lib/formato'

export const COLORES = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)', 'var(--t5)', 'var(--t6)', 'var(--t7)', 'var(--t8)']
export const color = (i: number) => COLORES[i % COLORES.length]

const EMOJI: [RegExp, string][] = [
  [/plato del d/i, '🍲'], [/pizza/i, '🍕'], [/hambur/i, '🍔'], [/s[aá]ndw/i, '🥪'], [/papa/i, '🍟'], [/ensalad/i, '🥗'], [/postre|helad|flan/i, '🍮'],
  [/entrada|empanad/i, '🥟'], [/parrill|carne|vac[ií]o/i, '🥩'], [/guarnic/i, '🥔'], [/trago|c[oó]ctel/i, '🍹'], [/cerveza|pinta/i, '🍺'], [/vino/i, '🍷'],
  [/sin alcohol|gaseosa|agua mineral/i, '🥤'], [/caf[eé]/i, '☕'],
  [/mercader/i, '🛒'], [/alquiler/i, '🏠'], [/sueldo|carga/i, '👥'], [/luz|gas|agua/i, '💡'], [/internet|tel[eé]fono/i, '📶'], [/impuesto|tasa/i, '🏛️'],
  [/mantenim/i, '🔧'], [/limpieza/i, '🧽'], [/publicidad/i, '📣'], [/comisi|banco/i, '🏦'], [/caja chica/i, '💵'],
  [/efectivo/i, '💵'], [/d[eé]bito|cr[eé]dito|tarjeta/i, '💳'], [/transfer|qr|mercado/i, '📲'],
  [/llevar/i, '🛍️'], [/delivery/i, '🛵'], [/barra/i, '🍸'],
]
export const emoji = (nombre: string) => EMOJI.find(([r]) => r.test(nombre))?.[1] ?? '📦'

export const corto = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e6) return `$${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e7 ? 0 : 1 })} M`
  if (a >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('es-AR')} mil`
  return `$${Math.round(v)}`
}

/** Variación contra el período anterior */
export function Variacion({ a, b, inverso, texto }: { a: number; b: number | null | undefined; inverso?: boolean; texto?: string }) {
  if (!b) return null
  const d = a / b - 1, bueno = inverso ? d < 0 : d > 0, igual = Math.abs(d) < 0.02
  return <span className={`var ${igual ? '' : bueno ? 'sube' : 'baja'}`}>{igual ? '＝' : d > 0 ? '▲' : '▼'} {Math.round(Math.abs(d) * 1000) / 10} %{texto && <span className="var-t"> {texto}</span>}</span>
}

/** Línea chiquita para dentro de una tarjeta */
export function Chispa({ v, c = 'currentColor' }: { v: number[]; c?: string }) {
  if (v.length < 2) return null
  const W = 120, H = 36, mx = Math.max(...v), mn = Math.min(...v), r = mx - mn || 1
  const pts = v.map((x, i) => [(i / (v.length - 1)) * W, H - 3 - ((x - mn) / r) * (H - 6)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return <svg className="chispa" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <path d={`${d} L${W},${H} L0,${H} Z`} fill={c} opacity=".15" /><path d={d} fill="none" stroke={c} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
}

/** Tarjeta de indicador: franja de color con el título, el número grande, la variación y una línea opcional */
export function Kpi({ titulo, valor, color: c = 'var(--t1)', icono, pie, chispa, ayuda }: { titulo: string; valor: ReactNode; color?: string; icono?: string; pie?: ReactNode; chispa?: number[]; ayuda?: string }) {
  return <div className="kpi" style={{ ['--k' as string]: c }} data-ayuda={ayuda}>
    <div className="kpi-t">{icono && <span aria-hidden="true">{icono}</span>}{titulo}</div>
    <div className="kpi-c"><div className="kpi-v">{valor}</div>{chispa && <Chispa v={chispa} c={c} />}</div>
    {pie && <div className="kpi-p">{pie}</div>}
  </div>
}

/** Dona con leyenda */
export function Dona({ filas, centro, chico }: { filas: { nombre: string; v: number; color?: string }[]; centro?: ReactNode; chico?: boolean }) {
  const f = filas.filter((x) => x.v > 0)
  if (!f.length) return <div className="kempty">Sin datos en el período.</div>
  const tot = f.reduce((s, x) => s + x.v, 0), R = 52, C = 2 * Math.PI * R
  let acc = 0
  return <div className={`dona${chico ? ' chico' : ''}`}>
    <div className="dona-g"><svg viewBox="0 0 140 140" role="img" aria-label={f.map((x) => `${x.nombre} ${Math.round((x.v / tot) * 100)}%`).join(', ')}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--sunk)" strokeWidth="22" />
      {f.map((x, i) => { const l = (x.v / tot) * C, el = <circle key={x.nombre} cx="70" cy="70" r={R} fill="none" stroke={x.color ?? color(i)} strokeWidth="22"
        strokeDasharray={`${Math.max(0, l - 1.5)} ${C - Math.max(0, l - 1.5)}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)"><title>{`${x.nombre}: ${plata(x.v)}`}</title></circle>; acc += l; return el })}
    </svg>{centro && <div className="dona-c">{centro}</div>}</div>
    <ul className="dona-l">{f.map((x, i) => <li key={x.nombre}><i style={{ background: x.color ?? color(i) }} /><span className="grow">{x.nombre}</span><b className="mono">{Math.round((x.v / tot) * 1000) / 10}%</b><span className="mono muted">{corto(x.v)}</span></li>)}</ul>
  </div>
}

/** Barras verticales con el valor arriba (resalta la más alta) */
export function BarrasValor({ puntos, alto = 200 }: { puntos: { l: string; v: number }[]; alto?: number }) {
  if (!puntos.some((p) => p.v)) return <div className="kempty">Sin datos para el gráfico.</div>
  const mx = Math.max(...puntos.map((p) => p.v)) || 1
  return <div className="bv" style={{ height: alto }}>{puntos.map((p, i) => <div key={i} className={`bv-c${p.v === mx ? ' top' : ''}`} title={`${p.l}: ${plata(p.v)}`}>
    <span className="bv-n">{corto(p.v)}</span><i style={{ height: `${Math.max(2, (p.v / mx) * 100)}%` }} /><span className="bv-l">{p.l}</span></div>)}</div>
}

/** Área con línea suave (para series de días) */
export function Area({ puntos, alto = 220, c = 'var(--t1)' }: { puntos: { l: string; v: number }[]; alto?: number; c?: string }) {
  if (!puntos.length) return <div className="kempty">Sin datos para el gráfico.</div>
  const W = 720, H = alto, L = 50, B = 24, T = 14, R = 10, mx = Math.max(1, ...puntos.map((p) => p.v))
  const top = Math.ceil(mx / (10 ** Math.floor(Math.log10(mx)) / 2)) * (10 ** Math.floor(Math.log10(mx)) / 2)
  const x = (i: number) => L + (puntos.length === 1 ? (W - L - R) / 2 : (i / (puntos.length - 1)) * (W - L - R)), y = (v: number) => T + (H - T - B) * (1 - v / top)
  const pts = puntos.map((p, i) => [x(i), y(p.v)])
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], m = (x1 - x0) / 2; d += ` C${x0 + m},${y0} ${x1 - m},${y1} ${x1},${y1}` }
  const cada = Math.ceil(puntos.length / 10), id = `ar${Math.round(Math.random() * 1e6)}`
  return <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de ventas">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity=".35" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
    {[0, 0.25, 0.5, 0.75, 1].map((k) => <g key={k}><line x1={L} x2={W - R} y1={y(top * k)} y2={y(top * k)} stroke="var(--line)" strokeDasharray={k ? '3 4' : undefined} /><text x={L - 6} y={y(top * k) + 3} textAnchor="end">{corto(top * k)}</text></g>)}
    <path d={`${d} L${pts[pts.length - 1][0]},${H - B} L${pts[0][0]},${H - B} Z`} fill={`url(#${id})`} />
    <path d={d} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" />
    {pts.map(([px, py], i) => <g key={i}><circle cx={px} cy={py} r={i === pts.length - 1 ? 5 : 3} fill="var(--surface)" stroke={c} strokeWidth="2"><title>{`${puntos[i].l}: ${plata(puntos[i].v)}`}</title></circle>
      {(i % cada === 0 || i === pts.length - 1) && <text x={px} y={H - 6} textAnchor="middle">{puntos[i].l}</text>}</g>)}
  </svg></div>
}

/** Anillo de avance: p de 0 a 1, con el número en el medio */
export function Anillo({ p, centro, sub, c = 'var(--t4)', marca }: { p: number; centro: ReactNode; sub?: ReactNode; c?: string; marca?: number }) {
  const R = 44, C = 2 * Math.PI * R, v = Math.max(0, Math.min(1, p))
  return <div className="anillo"><svg viewBox="0 0 110 110" aria-hidden="true">
    <circle cx="55" cy="55" r={R} fill="none" stroke="var(--sunk)" strokeWidth="11" />
    <circle cx="55" cy="55" r={R} fill="none" stroke={c} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${v * C} ${C}`} transform="rotate(-90 55 55)" />
    {marca != null && (() => { const a = (marca * 2 * Math.PI) - Math.PI / 2; return <line x1={55 + 36 * Math.cos(a)} y1={55 + 36 * Math.sin(a)} x2={55 + 53 * Math.cos(a)} y2={55 + 53 * Math.sin(a)} stroke="var(--fg)" strokeWidth="3" /> })()}
  </svg><div className="anillo-c"><b>{centro}</b>{sub && <small>{sub}</small>}</div></div>
}

/** Ranking con puesto, barra y datos a la derecha */
export function Podio({ filas, unidad }: { filas: { nombre: ReactNode; v: number; sub?: ReactNode; der?: ReactNode }[]; unidad?: (v: number) => ReactNode }) {
  if (!filas.length) return <div className="kempty">Sin datos en el período.</div>
  const mx = Math.max(1, ...filas.map((f) => f.v))
  return <ol className="podio">{filas.map((f, i) => <li key={i}>
    <span className={`podio-n p${i + 1}`}>{i + 1}</span>
    <div className="podio-d"><div className="fila" style={{ flexWrap: 'nowrap', gap: 8 }}><b className="grow" style={{ minWidth: 0 }}>{f.nombre}</b><span className="mono">{unidad ? unidad(f.v) : plata(f.v)}</span></div>
      <span className="podio-b"><i style={{ width: `${(f.v / mx) * 100}%`, background: color(i) }} /></span>
      {(f.sub || f.der) && <div className="podio-s"><span className="grow">{f.sub}</span>{f.der}</div>}</div>
  </li>)}</ol>
}

/** Mosaicos de color por categoría (con emoji, monto y porcentaje) */
export function Mosaicos({ filas, max = 4 }: { filas: { nombre: string; v: number }[]; max?: number }) {
  const tot = filas.reduce((s, f) => s + f.v, 0) || 1
  const top = filas.slice(0, max), resto = filas.slice(max).reduce((s, f) => s + f.v, 0)
  const lista = resto > 0 ? [...top, { nombre: 'Resto', v: resto }] : top
  if (!lista.length) return <div className="kempty">Sin ventas en el período.</div>
  return <div className="mosaicos">{lista.map((f, i) => <div key={f.nombre} className="mosaico" style={{ ['--k' as string]: color(i) }}>
    <span className="mosaico-e" aria-hidden="true">{f.nombre === 'Resto' ? '➕' : emoji(f.nombre)}</span>
    <span className="mosaico-n">{f.nombre}</span><b className="mono">{corto(f.v)}</b><span className="mosaico-p">{Math.round((f.v / tot) * 1000) / 10}%</span>
  </div>)}</div>
}

/** Panel de tablero con título y algo a la derecha */
export function Bloque({ titulo, der, children, className = '', ayuda }: { titulo: ReactNode; der?: ReactNode; children: ReactNode; className?: string; ayuda?: string }) {
  return <section className={`bloque ${className}`} data-ayuda={ayuda}><div className="bloque-h"><h3>{titulo}</h3>{der && <span className="bloque-der">{der}</span>}</div>{children}</section>
}
