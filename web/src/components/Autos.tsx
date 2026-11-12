import { useId } from 'react'

// Autos de carrera dibujados para la app (no son fotos ni copias de autos reales):
// uno por cada categoría que corre en Comodoro y la zona, en los colores del logo.
export type Cat = 'tc' | 'austral' | 'r12' | 'gol' | 'p1100'

type Molde = {
  cuerpo: string; vidrios: string[]; ruedas: [number, number]; r: number
  num: [number, number, number]; color: string; franja: string; aleron?: string; luz: [number, number]; cola: [number, number]
}

const MOLDES: Record<Cat, Molde> = {
  // Turismo Carretera: sedán largo y bajo, con alerón
  tc: {
    cuerpo: 'M14 74 L14 58 Q15 51 26 50 L72 46 Q86 30 100 28 L150 28 Q162 28 172 38 L184 47 L220 52 Q230 54 231 62 L231 74 Z',
    vidrios: ['M82 46 Q92 34 102 32 L124 32 L124 46 Z', 'M128 32 L148 32 Q158 32 165 39 L171 46 L128 46 Z'],
    ruedas: [58, 184], r: 15, num: [128, 60, 10], color: '#1f3a5f', franja: '#c9a35a',
    aleron: 'M6 35 L44 35 L44 40 L6 40 Z M20 40 h4 v11 h-4 Z M34 40 h4 v10 h-4 Z', luz: [224, 56], cola: [15, 55],
  },
  // TC Austral: sedán con trompa más larga
  austral: {
    cuerpo: 'M16 74 L16 57 Q17 51 28 50 L80 47 Q92 31 104 30 L146 30 Q156 30 164 38 L176 47 L222 51 Q231 53 232 61 L232 74 Z',
    vidrios: ['M88 46 Q96 35 106 34 L124 34 L124 46 Z', 'M128 34 L146 34 Q154 34 160 40 L166 46 L128 46 Z'],
    ruedas: [60, 186], r: 15, num: [124, 60, 10], color: '#c8231e', franja: '#ffffff',
    aleron: 'M10 38 L42 38 L42 42 L10 42 Z M24 42 h4 v9 h-4 Z', luz: [225, 56], cola: [17, 55],
  },
  // Monomarca: sedancito de tres volúmenes, alto y cuadrado
  r12: {
    cuerpo: 'M20 74 L20 56 Q21 51 30 50 L68 49 L84 30 Q86 28 92 28 L140 28 Q146 28 150 32 L166 49 L210 51 Q218 52 218 58 L218 74 Z',
    vidrios: ['M88 47 L97 33 L114 33 L114 47 Z', 'M118 33 L138 33 Q143 33 146 37 L156 47 L118 47 Z'],
    ruedas: [62, 174], r: 14, num: [117, 61, 10], color: '#c9a35a', franja: '#1f3a5f', luz: [212, 55], cola: [21, 55],
  },
  // Turismo Pista 1.6: hatchback de cola corta
  gol: {
    cuerpo: 'M40 74 L40 48 Q40 36 50 34 L70 31 L118 29 Q128 29 136 35 L156 48 L198 52 Q208 54 208 60 L208 74 Z',
    vidrios: ['M50 46 L53 37 L68 34 L68 46 Z', 'M72 34 L96 32 L96 46 L72 46 Z', 'M100 32 L118 32 Q126 32 132 37 L144 46 L100 46 Z'],
    ruedas: [72, 170], r: 14, num: [98, 60, 10], color: '#3b8c93', franja: '#ffffff',
    aleron: 'M36 33 L60 31 L60 34 L36 37 Z', luz: [202, 56], cola: [41, 52],
  },
  // Turismo Pista 1100: el chiquito
  p1100: {
    cuerpo: 'M34 74 L34 52 Q34 44 44 43 L62 42 L76 28 Q78 26 84 26 L120 26 Q126 26 130 31 L142 44 L172 47 Q180 48 180 55 L180 74 Z',
    vidrios: ['M70 42 L80 30 L100 30 L100 42 Z', 'M104 30 L120 30 Q124 30 127 34 L135 42 L104 42 Z'],
    ruedas: [66, 152], r: 13, num: [104, 57, 9], color: '#e8e2d4', franja: '#c8231e', luz: [175, 53], cola: [35, 52],
  },
}

export const LARGADA: { cat: Cat; nombre: string; numero: number }[] = [
  { cat: 'tc', nombre: 'TC Patagónico', numero: 7 },
  { cat: 'austral', nombre: 'TC Austral', numero: 3 },
  { cat: 'r12', nombre: 'Monomarca R12 Chubutense', numero: 12 },
  { cat: 'gol', nombre: 'TP Gol 1.6', numero: 18 },
  { cat: 'p1100', nombre: 'TP 1100', numero: 11 },
]

export function Auto({ cat, numero, className, titulo }: { cat: Cat; numero?: number; className?: string; titulo?: string }) {
  const m = MOLDES[cat], id = useId().replace(/:/g, ''), [nx, ny, nr] = m.num
  const oscuro = m.color === '#e8e2d4' || m.color === '#c9a35a'
  return <svg className={`auto ${className ?? ''}`} viewBox="0 0 240 100" role={titulo ? 'img' : undefined} aria-label={titulo} aria-hidden={titulo ? undefined : true}>
    <defs><clipPath id={`c${id}`}><path d={m.cuerpo} /></clipPath></defs>
    <ellipse cx="120" cy="92" rx="112" ry="5" fill="#000" opacity=".22" />
    {m.aleron && <path d={m.aleron} fill="#111" />}
    <path d={m.cuerpo} fill={m.color} stroke="#0b0f16" strokeWidth="2" strokeLinejoin="round" />
    <g clipPath={`url(#c${id})`}>
      <rect x="0" y="57" width="240" height="5" fill={m.franja} />
      <rect x="0" y="64" width="240" height="2" fill={m.franja} />
      <rect x="0" y="70" width="240" height="6" fill="#0b0f16" opacity=".35" />
      {m.ruedas.map((x) => <circle key={x} cx={x} cy="76" r={m.r + 4} fill="#0b0f16" />)}
    </g>
    {m.vidrios.map((d) => <path key={d} d={d} fill="#1b2a3a" stroke="#0b0f16" strokeWidth="1.2" />)}
    {m.vidrios.map((d) => <path key={`b${d}`} d={d} fill="none" stroke="#9fc6d0" strokeWidth=".8" opacity=".5" />)}
    <rect x={m.luz[0]} y={m.luz[1]} width="6" height="4" rx="1.5" fill="#ffe08a" />
    <rect x={m.cola[0]} y={m.cola[1]} width="4" height="4" rx="1" fill="#e53b2f" />
    {numero != null && <g>
      <circle cx={nx} cy={ny} r={nr} fill="#fff" stroke="#111" strokeWidth="2" />
      <text x={nx} y={ny + nr * 0.38} textAnchor="middle" fontSize={nr * 1.15} fontWeight="800" fontStyle="italic" fontFamily="'Saira Condensed', Impact, sans-serif" fill="#111">{numero}</text>
    </g>}
    {m.ruedas.map((x) => <g key={`w${x}`}>
      <circle cx={x} cy="76" r={m.r} fill="#121212" />
      <circle cx={x} cy="76" r={m.r * 0.58} fill={oscuro ? '#2b2b2b' : '#c9ced6'} />
      <circle cx={x} cy="76" r={m.r * 0.2} fill="#555" />
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
