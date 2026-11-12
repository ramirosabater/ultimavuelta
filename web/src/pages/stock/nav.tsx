import { SubNav } from '../../components/Layout'

export function SubNavStock() {
  return <SubNav items={[['/stock/articulos', 'Artículos'], ['/stock/recetas', 'Recetas y costos'], ['/stock/rendimientos', 'Rendimientos'],
    ['/stock/compras', 'Compras'], ['/stock/control', 'Control semanal'], ['/stock/mermas', 'Mermas']]} />
}
