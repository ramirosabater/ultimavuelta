import { useId } from 'react'

// Autos de carrera dibujados para la app, en estilo dibujo animado (gorditos, ruedas grandes, contorno grueso).
// No son copias de autos reales ni de personajes: uno por cada categoría que corre en Comodoro y la zona.
export type Cat = 'tc' | 'austral' | 'r12' | 'gol' | 'p1100'

type Molde = {
  x0: number; x1: number; alto: number     // largo de la carrocería y altura del capó
  cA: number; cB: number; techo: number    // cabina: desde dónde hasta dónde y qué tan alta
  ruedas: [number, number]; r: number
  color: string; franja: string; llanta: string; aleron?: boolean; cola?: boolean   // cola: hatchback (cola cortada)
}

const MOLDES: Record<Cat, Molde> = {
  // Turismo Carretera: sedán largo y bajo, con alerón
  tc: { x0: 12, x1: 228, alto: 50, cA: 72, cB: 176, techo: 24, ruedas: [58, 184], r: 20, color: '#1d5fc4', franja: '#ffcf33', llanta: '#ffcf33', aleron: true },
  // TC Austral: trompa larga, rojo
  austral: { x0: 12, x1: 228, alto: 51, cA: 80, cB: 178, techo: 26, ruedas: [60, 186], r: 20, color: '#e02a1f', franja: '#fff6e0', llanta: '#e9edf2', aleron: true },
  // Monomarca: sedancito de tres volúmenes, alto y cuadrado
  r12: { x0: 22, x1: 220, alto: 50, cA: 76, cB: 162, techo: 20, ruedas: [64, 178], r: 19, color: '#f5b52a', franja: '#1d3557', llanta: '#e9edf2' },
  // Turismo Pista 1.6: hatchback de cola corta
  gol: { x0: 36, x1: 212, alto: 48, cA: 40, cB: 158, techo: 23, ruedas: [76, 172], r: 19, color: '#1fa6a0', franja: '#fff6e0', llanta: '#ffcf33', cola: true },
  // Turismo Pista 1100: el chiquito
  p1100: { x0: 40, x1: 190, alto: 50, cA: 70, cB: 148, techo: 22, ruedas: [72, 160], r: 18, color: '#fbf0dc', franja: '#e02a1f', llanta: '#e02a1f' },
}

export const LARGADA: { cat: Cat; nombre: string; numero: number }[] = [
  { cat: 'tc', nombre: 'TC Patagónico', numero: 7 },
  { cat: 'austral', nombre: 'TC Austral', numero: 3 },
  { cat: 'r12', nombre: 'Monomarca R12 Chubutense', numero: 12 },
  { cat: 'gol', nombre: 'TP Gol 1.6', numero: 18 },
  { cat: 'p1100', nombre: 'TP 1100', numero: 11 },
]

const TINTA = '#2a1810'
const PISO = 86   // centro de las ruedas

function formas(m: Molde) {
  const { x0, x1, alto: a, cA, cB, techo: t } = m
  // Carrocería: panza redonda, capó (adelante, a la derecha) un poco más bajo que el baúl
  const baul = m.cola ? a - 6 : a
  const cuerpo = `M${x0 + 12} ${PISO + 2} L${x1 - 12} ${PISO + 2} Q${x1 + 1} ${PISO + 2} ${x1} ${PISO - 10} L${x1} ${a + 14}
    Q${x1 - 1} ${a + 4} ${x1 - 16} ${a + 2} L${cB} ${a} L${cA} ${baul} L${x0 + 16} ${baul + 1}
    Q${x0} ${baul + 3} ${x0} ${baul + 18} L${x0} ${PISO - 10} Q${x0} ${PISO + 2} ${x0 + 12} ${PISO + 2} Z`
  // Cabina: burbuja con parabrisas inclinado
  const atras = m.cola ? `M${cA} ${baul + 2} C${cA - 2} ${t + 14} ${cA + 4} ${t} ${cA + 18} ${t}` : `M${cA} ${baul + 2} C${cA + 8} ${t + 2} ${cA + 16} ${t} ${cA + 28} ${t}`
  const cabina = `${atras} L${cB - 30} ${t} C${cB - 16} ${t} ${cB - 4} ${a - 10} ${cB + 8} ${a + 2} Z`
  const mid = Math.round((cA + cB) / 2) - 2
  const vAtras = m.cola ? `M${cA + 6} ${baul} C${cA + 5} ${t + 14} ${cA + 9} ${t + 6} ${cA + 19} ${t + 6} L${mid - 3} ${t + 6} L${mid - 3} ${baul} Z`
    : `M${cA + 10} ${baul} C${cA + 15} ${t + 8} ${cA + 20} ${t + 6} ${cA + 29} ${t + 6} L${mid - 3} ${t + 6} L${mid - 3} ${a} Z`
  const vAdelante = `M${mid + 3} ${a} L${mid + 3} ${t + 6} L${cB - 31} ${t + 6} C${cB - 20} ${t + 6} ${cB - 11} ${a - 9} ${cB - 3} ${a} Z`
  return { cuerpo, cabina, vidrios: [vAtras, vAdelante], mid }
}

export function Auto({ cat, numero, className, titulo }: { cat: Cat; numero?: number; className?: string; titulo?: string }) {
  const m = MOLDES[cat], id = useId().replace(/:/g, '')
  const { cuerpo, cabina, vidrios, mid } = formas(m)
  const puerta = (m.cA + m.cB) / 2 + 2, ny = (m.alto + PISO) / 2 + 1, nr = 11
  return <svg className={`auto ${className ?? ''}`} viewBox="0 -2 240 112" role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
    <defs>
      <clipPath id={`c${id}`}><path d={cuerpo} /><path d={cabina} /></clipPath>
      <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".38" /><stop offset=".45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" />
      </linearGradient>
    </defs>
    <ellipse cx="120" cy={PISO + m.r + 1} rx="108" ry="6" fill="#000" opacity=".2" />
    {/* alerón */}
    {m.aleron && <g stroke={TINTA} strokeWidth="3" strokeLinejoin="round">
      <path d={`M${m.x0 + 16} ${m.alto - 2} L${m.x0 + 16} ${m.alto - 16} M${m.x0 + 34} ${m.alto - 2} L${m.x0 + 34} ${m.alto - 14}`} strokeLinecap="round" />
      <path d={`M${m.x0 + 2} ${m.alto - 22} Q${m.x0 + 26} ${m.alto - 27} ${m.x0 + 46} ${m.alto - 20} L${m.x0 + 46} ${m.alto - 14} Q${m.x0 + 24} ${m.alto - 19} ${m.x0 + 2} ${m.alto - 15} Z`} fill={m.franja} />
    </g>}
    {/* contorno: las dos piezas con trazo grueso, después el relleno encima (así queda una sola silueta) */}
    <path d={cabina} fill={TINTA} stroke={TINTA} strokeWidth="7" strokeLinejoin="round" />
    <path d={cuerpo} fill={TINTA} stroke={TINTA} strokeWidth="7" strokeLinejoin="round" />
    <g clipPath={`url(#c${id})`}>
      <path d={cabina} fill={m.color} /><path d={cuerpo} fill={m.color} />
      {/* franjas de carrera */}
      <rect x="0" y={m.alto + 9} width="240" height="7" fill={m.franja} />
      <rect x="0" y={m.alto + 18} width="240" height="2.5" fill={m.franja} />
      <rect x="0" y="0" width="240" height="112" fill={`url(#g${id})`} />
      {/* pasaruedas */}
      {m.ruedas.map((x) => <circle key={x} cx={x} cy={PISO} r={m.r + 5} fill={TINTA} />)}
    </g>
    {/* vidrios con reflejo */}
    {vidrios.map((d) => <path key={d} d={d} fill="#bfe6ee" stroke={TINTA} strokeWidth="2.5" strokeLinejoin="round" />)}
    <path d={`M${mid - 14} ${m.techo + 9} l-8 ${m.alto - m.techo - 13}`} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity=".8" />
    <path d={`M${mid + 14} ${m.techo + 9} l-6 ${m.alto - m.techo - 13}`} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".7" />
    {/* brillo del techo y del costado */}
    <path d={`M${m.cA + 24} ${m.techo + 3} L${m.cB - 34} ${m.techo + 3}`} stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
    <path d={`M${m.x0 + 14} ${m.alto + 5} L${m.x0 + 40} ${m.alto + 4}`} stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
    {/* paragolpes cromados */}
    <rect x={m.x1 - 12} y={PISO - 6} width="16" height="7" rx="3.5" fill="#dfe4ea" stroke={TINTA} strokeWidth="2.5" />
    <rect x={m.x0 - 4} y={PISO - 6} width="16" height="7" rx="3.5" fill="#dfe4ea" stroke={TINTA} strokeWidth="2.5" />
    {/* faro grande y luz de atrás */}
    <circle cx={m.x1 - 7} cy={m.alto + 14} r="6" fill="#fff2a8" stroke={TINTA} strokeWidth="2.5" />
    <circle cx={m.x1 - 8.5} cy={m.alto + 12.5} r="1.8" fill="#fff" />
    <rect x={m.x0 - 1} y={(m.cola ? m.alto - 6 : m.alto) + 9} width="6" height="9" rx="3" fill="#ff4a3a" stroke={TINTA} strokeWidth="2" />
    {/* número en la puerta */}
    {numero != null && <g>
      <circle cx={puerta} cy={ny} r={nr} fill="#fff" stroke={TINTA} strokeWidth="2.5" />
      <text x={puerta} y={ny + nr * 0.42} textAnchor="middle" fontSize={nr * 1.25} fontFamily="'Lilita One', Impact, sans-serif" fill={TINTA}>{numero}</text>
    </g>}
    {/* ruedas gordas */}
    {m.ruedas.map((x) => <g key={`w${x}`}>
      <circle cx={x} cy={PISO} r={m.r} fill="#1d1d1f" stroke={TINTA} strokeWidth="3" />
      <circle cx={x} cy={PISO} r={m.r * 0.56} fill={m.llanta} stroke={TINTA} strokeWidth="2.5" />
      <circle cx={x} cy={PISO} r={m.r * 0.18} fill={TINTA} />
      <path d={`M${x - m.r * 0.62} ${PISO - m.r * 0.35} A${m.r * 0.75} ${m.r * 0.75} 0 0 1 ${x - m.r * 0.2} ${PISO - m.r * 0.72}`} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".45" />
    </g>)}
  </svg>
}

/** Los cinco autos en fila, con el nombre de la categoría abajo */
export function Grilla({ nombres = true }: { nombres?: boolean }) {
  return <div className={`grilla${nombres ? '' : ' sin-nombres'}`}>
    {LARGADA.map((a) => <figure key={a.cat}><Auto cat={a.cat} numero={a.numero} titulo={nombres ? undefined : a.nombre} />{nombres && <figcaption>{a.nombre}</figcaption>}</figure>)}
  </div>
}

/** Un auto para los lugares vacíos ("boxes libres") */
export function AutoVacio({ texto, cat = 'tc' }: { texto: string; cat?: Cat }) {
  return <div className="kempty vacio-auto"><Auto cat={cat} />{texto}</div>
}
