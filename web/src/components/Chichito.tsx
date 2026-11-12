/** Chichito: un chulengo con brasas, cara y brazos. Se viste según la sección. */
export type Traje = 'mozo' | 'chef' | 'barra' | 'caja' | 'deposito' | 'lentes' | 'carta'

export const trajeDe = (area: string): Traje =>
  (({ mesas: 'mozo', cocina: 'chef', barra: 'barra', caja: 'caja', stock: 'deposito', tableros: 'lentes', admin: 'lentes', carta: 'carta' }) as Record<string, Traje>)[area] ?? 'mozo'

function Extra({ traje }: { traje: Traje }) {
  switch (traje) {
    case 'chef': return <><path d="M34 30 C26 30 26 16 36 16 C36 6 52 4 56 12 C62 4 78 8 74 18 C84 18 82 32 72 30 Z" fill="#fff" stroke="#E4DCD2" strokeWidth="1.5" /><rect x="36" y="27" width="36" height="7" rx="3" fill="#fff" stroke="#E4DCD2" strokeWidth="1.2" /></>
    case 'mozo': return <><path d="M45 99 l-9 -5 v10 z M63 99 l9 -5 v10 z" fill="#1E1A17" /><circle cx="54" cy="99" r="3.2" fill="#1E1A17" /></>
    case 'barra': return <g transform="translate(96 70) rotate(18)"><rect x="-6" y="-4" width="12" height="22" rx="3" fill="#C9CED6" stroke="#8A919B" strokeWidth="1.2" /><rect x="-4" y="-10" width="8" height="7" rx="2" fill="#AEB4BD" /></g>
    case 'caja': return <><path d="M28 36 C28 26 80 26 80 36 Z" fill="#1F6A52" /><path d="M76 34 C90 34 98 38 98 42 L74 40 Z" fill="#16855C" opacity=".9" /></>
    case 'deposito': return <><path d="M30 34 C30 14 78 14 78 34 Z" fill="#F2B600" /><rect x="25" y="31" width="58" height="6" rx="3" fill="#D99A00" /><rect x="50" y="16" width="8" height="16" rx="3" fill="#D99A00" /></>
    case 'lentes': return <g fill="none" stroke="#2A211B" strokeWidth="2.2"><circle cx="42" cy="66" r="11" /><circle cx="66" cy="66" r="11" /><path d="M53 64 q1 -3 2 0" /></g>
    case 'carta': return <g transform="translate(98 66) rotate(10)"><rect x="-8" y="-12" width="16" height="22" rx="2" fill="#FFF7EC" stroke="#B9A88F" strokeWidth="1.2" /><path d="M-4 -6 h8 M-4 -2 h8 M-4 2 h6" stroke="#B9A88F" strokeWidth="1.2" /></g>
  }
}

/** `angulo`: hacia dónde señala el brazo derecho (grados, 0 = derecha). */
export default function Chichito({ traje, habla, festeja, angulo }: { traje: Traje; habla?: boolean; festeja?: boolean; angulo?: number | null }) {
  const der = angulo != null ? angulo - 90 : festeja ? -150 : 20
  return <svg className={`ch-svg${habla ? ' habla' : ''}${festeja ? ' festeja' : ''}`} viewBox="-6 -4 124 132" role="img" aria-label="Chichito, el ayudante">
    <ellipse cx="56" cy="124" rx="40" ry="4" fill="#000" opacity=".15" />
    <g className="ch-cuerpo">
      <g className="ch-humo"><circle cx="86" cy="18" r="5" fill="#C9C2BA" opacity=".55" /><circle cx="94" cy="8" r="4" fill="#C9C2BA" opacity=".4" /><circle cx="99" cy="-1" r="3" fill="#C9C2BA" opacity=".3" /></g>
      <rect x="80" y="22" width="9" height="16" rx="2" fill="#4A403A" />
      <path d="M36 112 l-6 12 M76 112 l6 12" stroke="#4A403A" strokeWidth="5" strokeLinecap="round" />
      <rect x="14" y="34" width="84" height="80" rx="18" fill="#2B2420" />
      <rect x="14" y="34" width="84" height="14" rx="7" fill="#fff" opacity=".1" />
      <rect x="22" y="90" width="68" height="16" rx="6" fill="#3A2F29" />
      <g className="ch-brasas"><circle cx="34" cy="98" r="4" fill="#F0B04A" /><circle cx="46" cy="100" r="3.4" fill="#E06C2A" /><circle cx="58" cy="97" r="4.2" fill="#F5C45A" /><circle cx="70" cy="100" r="3.4" fill="#E06C2A" /><circle cx="80" cy="98" r="3.6" fill="#F0B04A" /></g>
      <path d="M24 92 h64" stroke="#8A7F77" strokeWidth="2" />
      <ellipse cx="42" cy="66" rx="9" ry="10" fill="#fff" /><ellipse cx="66" cy="66" rx="9" ry="10" fill="#fff" />
      <circle cx="44" cy="67" r="4.6" fill="#1A1412" /><circle cx="64" cy="67" r="4.6" fill="#1A1412" />
      <circle cx="45.6" cy="64.8" r="1.6" fill="#fff" /><circle cx="65.6" cy="64.8" r="1.6" fill="#fff" />
      <path d="M33 53 q8 -4 16 0 M59 53 q8 -4 16 0" stroke="#E9DCCD" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="28" cy="80" r="4" fill="#E06C5A" opacity=".55" /><circle cx="80" cy="80" r="4" fill="#E06C5A" opacity=".55" />
      <path className="ch-sonrisa" d="M43 79 Q54 89 65 79" stroke="#F3E6D6" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse className="ch-boca" cx="54" cy="83" rx="6.5" ry="4.4" fill="#7A2635" />
      <g className="ch-brazo" style={{ transform: 'rotate(-20deg)', transformOrigin: '14px 66px' }}><path d="M14 66 L14 92" stroke="#2B2420" strokeWidth="6" strokeLinecap="round" /><circle cx="14" cy="95" r="5.2" fill="#fff" stroke="#D8CFC5" strokeWidth="1.2" /></g>
      <g className="ch-brazo ch-der" style={{ transform: `rotate(${der}deg)`, transformOrigin: '98px 66px' }}><path d="M98 66 L98 92" stroke="#2B2420" strokeWidth="6" strokeLinecap="round" /><circle cx="98" cy="95" r="5.2" fill="#fff" stroke="#D8CFC5" strokeWidth="1.2" /><path d="M98 99 L98 104" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" /></g>
      <Extra traje={traje} />
    </g>
  </svg>
}
