import { useState } from 'react'
import { tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import { DIAS_LARGO } from '../../lib/formato'
import { SubNavAdmin } from './nav'
import { Cabeza, useAccion } from '../../components/ui'

interface Param { clave: string; valor: string; descripcion: string | null }
const GRUPOS: [string, string[]][] = [
  ['El local', ['nombre_local', 'bajada_local']],
  ['Jornada', ['corte_jornada', 'zona_horaria', 'dias_cerrado']],
  ['Compras y costos', ['cobertura_dias', 'colchon_pct', 'costo_objetivo']],
  ['Alertas de comandas', ['alerta_cocina', 'alerta_barra']],
]
const ETIQUETA: Record<string, string> = {
  nombre_local: 'Nombre', bajada_local: 'Segunda línea', corte_jornada: 'Hora de corte', zona_horaria: 'Zona horaria', dias_cerrado: 'Días cerrado',
  cobertura_dias: 'Comprar para (días)', colchon_pct: 'Colchón (%)', costo_objetivo: 'Costo objetivo (%)', alerta_cocina: 'Parrilla (min amarillo, rojo)', alerta_barra: 'Barra (min amarillo, rojo)',
}

export default function Configuracion() {
  const d = useConsulta(() => tabla<Param[]>(supabase.from('parametros').select('*')))
  const [cambios, setCambios] = useState<Record<string, string>>({})
  const { correr, ocupado } = useAccion()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavAdmin /><p className="cargando">Cargando…</p></>
  const val = (k: string) => cambios[k] ?? d.datos!.find((p) => p.clave === k)?.valor ?? ''
  const desc = (k: string) => d.datos!.find((p) => p.clave === k)?.descripcion
  const set = (k: string, v: string) => setCambios({ ...cambios, [k]: v })
  const cerrados = val('dias_cerrado').split(',').map((s) => s.trim()).filter(Boolean)
  async function guardar() {
    if (await correr(async () => {
      for (const [clave, valor] of Object.entries(cambios)) {
        const { error } = await supabase.from('parametros').update({ valor: valor.trim() }).eq('clave', clave)
        if (error) throw new Error(error.message)
      }
    }, 'Configuración guardada')) { setCambios({}); d.recargar() }
  }
  return <>
    <Cabeza etiqueta="Administración" titulo="Configuración"><button className="btn pri" disabled={ocupado || !Object.keys(cambios).length} onClick={guardar}>Guardar cambios</button></Cabeza>
    <SubNavAdmin />
    {GRUPOS.map(([t, claves]) => <section className="panel" key={t} style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 10 }}>{t}</h3>
      {claves.map((k) => k === 'dias_cerrado'
        ? <div className="campo" key={k}>{ETIQUETA[k]}<div className="chips" style={{ marginTop: 6 }}>{[1, 2, 3, 4, 5, 6, 0].map((x) => { const on = cerrados.includes(String(x)); return <button key={x} type="button" className="chip" aria-pressed={on}
            onClick={() => set(k, (on ? cerrados.filter((c) => c !== String(x)) : [...cerrados, String(x)]).join(','))}>{DIAS_LARGO[x]}</button> })}</div><small>{desc(k)}</small></div>
        : <label className="campo" key={k}>{ETIQUETA[k] ?? k}<input id={`cfg-${k}`} value={val(k)} onChange={(e) => set(k, e.target.value)} />{desc(k) && <small>{desc(k)}</small>}</label>)}
    </section>)}
  </>
}
