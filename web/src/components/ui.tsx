import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { corto, plata } from '../lib/formato'

// ------------------------------------------------------------------ avisos cortos (toast)
const ToastCtx = createContext<(t: string) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('')
  const t = useRef(0)
  const avisar = useCallback((m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(''), 2800) }, [])
  return <ToastCtx.Provider value={avisar}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>
}
export const useToast = () => useContext(ToastCtx)

/** Corre una acción, muestra el error si falla y el aviso si sale bien. Devuelve si salió bien. */
export function useAccion() {
  const avisar = useToast()
  const [ocupado, setOcupado] = useState(false)
  const correr = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(true)
    try { await fn(); if (ok) avisar(ok); return true }
    catch (e) { avisar(e instanceof Error ? e.message : String(e)); return false }
    finally { setOcupado(false) }
  }, [avisar])
  return { correr, ocupado }
}

// ------------------------------------------------------------------ ventana
export function Modal({ titulo, onCerrar, children, pie, ancho }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onCerrar])
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={ancho ? { maxWidth: ancho } : undefined}>
        <div className="m-h"><h2>{titulo}</h2><button className="btn sm ghost" onClick={onCerrar}>Cerrar</button></div>
        <div className="m-b">{children}</div>
        {pie && <div className="m-f">{pie}</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ piezas chicas
export type Tono = '' | 'ok' | 'warn' | 'crit' | 'acc'
export const Pill = ({ tono = '', children }: { tono?: Tono; children: ReactNode }) => <span className={`pill ${tono}`}>{children}</span>

export function Stat({ label, valor, extra }: { label: string; valor: ReactNode; extra?: ReactNode }) {
  return <div className="stat"><div className="label">{label}</div><div className="v">{valor}</div>{extra && <div style={{ marginTop: 4, fontSize: 12 }}>{extra}</div>}</div>
}

export function Delta({ a, b, inverso }: { a: number; b: number | null | undefined; inverso?: boolean }) {
  if (!b) return <span className="muted" style={{ fontSize: 12 }}>sin dato previo</span>
  const d = a / b - 1, bueno = inverso ? d < 0 : d > 0
  return <span className={`pill ${Math.abs(d) < 0.02 ? '' : bueno ? 'ok' : 'crit'}`} style={{ fontSize: 11 }}>{d > 0 ? '▲' : '▼'} {Math.round(Math.abs(d) * 1000) / 10} %</span>
}

export const Vacio = ({ children }: { children: ReactNode }) => <div className="kempty">{children}</div>
export const Aviso = ({ children }: { children: ReactNode }) => <div className="notice">{children}</div>
export function MensajeError({ texto }: { texto: string }) { return texto ? <div className="aviso bad" role="alert">{texto}</div> : null }
export function Cabeza({ etiqueta, titulo, children }: { etiqueta: string; titulo: string; children?: ReactNode }) {
  return <div className="vhead"><div><div className="label">{etiqueta}</div><h2>{titulo}</h2></div><span className="sp" />{children}</div>
}

// ------------------------------------------------------------------ gráficos
function paso(x: number) { const p = 10 ** Math.floor(Math.log10(x || 1)); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p }

/** Barras verticales con escala, la última resaltada */
export function Barras({ puntos, etiqueta = 'Ventas' }: { puntos: { l: string; v: number }[]; etiqueta?: string }) {
  if (!puntos.length) return <Vacio>Sin datos para el gráfico.</Vacio>
  const W = 720, H = 220, L = 56, B = 26, T = 12, R = 8, mx = Math.max(1, ...puntos.map((x) => x.v))
  const st = paso(mx / 4), top = Math.ceil(mx / st) * st, bw = (W - L - R) / puntos.length, cada = Math.ceil(puntos.length / 12)
  const lineas = []; for (let v = 0; v <= top; v += st) lineas.push(v)
  return (
    <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gráfico: ${etiqueta}`}>
      {lineas.map((v) => { const y = T + (H - T - B) * (1 - v / top); return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" /><text x={L - 6} y={y + 3} textAnchor="end">{corto(v)}</text></g> })}
      {puntos.map((x, i) => {
        const h = (H - T - B) * (x.v / top), X = L + i * bw + bw * 0.15, w = bw * 0.7
        return <g key={i}>
          <rect x={X} y={H - B - h} width={w} height={Math.max(h, x.v ? 1 : 0)} rx={2} fill={i === puntos.length - 1 ? 'var(--ember)' : 'var(--accent)'}><title>{`${x.l}: ${plata(x.v)}`}</title></rect>
          {(i % cada === 0 || i === puntos.length - 1) && <text x={X + w / 2} y={H - 8} textAnchor="middle">{x.l}</text>}
        </g>
      })}
    </svg></div>
  )
}

/** Dos series lado a lado (ventas y gastos) */
export function BarrasPar({ puntos, na, nb }: { puntos: { l: string; a: number; b: number }[]; na: string; nb: string }) {
  if (!puntos.length) return <Vacio>Sin datos para el gráfico.</Vacio>
  const W = 720, H = 240, L = 58, B = 28, T = 14, R = 8, mx = Math.max(1, ...puntos.flatMap((x) => [x.a, x.b]))
  const st = paso(mx / 4), top = Math.ceil(mx / st) * st, gw = (W - L - R) / puntos.length, bw = Math.min(28, gw * 0.32), cada = Math.ceil(puntos.length / 14)
  const lineas = []; for (let v = 0; v <= top; v += st) lineas.push(v)
  return <>
    <div className="fila" style={{ fontSize: 13, margin: '6px 0' }}>
      <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--c1)', marginRight: 5 }} />{na}</span>
      <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--c2)', marginRight: 5 }} />{nb}</span>
    </div>
    <div className="chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${na} y ${nb}`}>
      {lineas.map((v) => { const y = T + (H - T - B) * (1 - v / top); return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--line)" /><text x={L - 6} y={y + 3} textAnchor="end">{corto(v)}</text></g> })}
      {puntos.map((x, i) => {
        const cx = L + gw * i + gw / 2
        return <g key={i}>
          {([[x.a, 'var(--c1)', -1, na], [x.b, 'var(--c2)', 1, nb]] as const).map(([v, c, s, n]) => {
            const h = (H - T - B) * (v / top)
            return <rect key={n} x={s < 0 ? cx - bw - 1 : cx + 1} y={H - B - h} width={bw} height={Math.max(v ? 2 : 0, h)} rx={3} fill={c}><title>{`${x.l} · ${n}: ${plata(v)}`}</title></rect>
          })}
          {(i % cada === 0 || i === puntos.length - 1) && <text x={cx} y={H - 9} textAnchor="middle">{x.l}</text>}
        </g>
      })}
    </svg></div>
  </>
}

/** Barras horizontales con nombre, monto y porcentaje */
export function Ranking({ filas, color, conPct = true }: { filas: { nombre: string; v: number; extra?: ReactNode }[]; color?: string; conPct?: boolean }) {
  if (!filas.length) return <Vacio>Sin datos en el período.</Vacio>
  const mx = Math.max(1, ...filas.map((f) => f.v)), tot = filas.reduce((s, f) => s + f.v, 0) || 1
  return <>{filas.map((f) => (
    <div className="hbar" key={f.nombre}>
      <span>{f.nombre} {conPct && <span className="muted mono">{Math.round((f.v / tot) * 100)}%</span>} {f.extra}</span>
      <span className="mono">{plata(f.v)}</span>
      <span className="bar"><i style={{ width: `${((f.v / mx) * 100).toFixed(1)}%`, background: color }} /></span>
    </div>))}</>
}
