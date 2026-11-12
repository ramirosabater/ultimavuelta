import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { leerParametros, rpc, tabla, useConsulta } from '../../lib/datos'
import { supabase } from '../../lib/supabase'
import type { Mesa } from '../../lib/tipos'
import { SubNavCarta } from './Carta'
import { Cabeza, Modal, Pill, useAccion } from '../../components/ui'
import { LOGO, NOMBRE } from '../../lib/marca'

export const linkMesa = (token: string) => `${window.location.origin}/m/${token}`

function QR({ texto, tam = 180 }: { texto: string; tam?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(texto, { width: tam * 2, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')) }, [texto, tam])
  return src ? <img src={src} width={tam} height={tam} alt={`QR ${texto}`} /> : <div style={{ width: tam, height: tam }} />
}

export default function MesasQR() {
  const d = useConsulta(async () => {
    const [mesas, p] = await Promise.all([tabla<Mesa[]>(supabase.from('mesas').select('*').order('numero')), leerParametros()])
    return { mesas, local: p.nombre_local || NOMBRE }
  })
  const [ventana, setVentana] = useState<Mesa | null | 'nueva'>(null)
  const [elegidas, setElegidas] = useState<number[]>([])
  const { correr } = useAccion()
  if (d.error) return <div className="aviso bad">{d.error}</div>
  if (!d.datos) return <><SubNavCarta /><p className="cargando">Cargando mesas…</p></>
  const { mesas, local } = d.datos
  const activas = mesas.filter((m) => m.activa)
  const imprimir = elegidas.length ? activas.filter((m) => elegidas.includes(m.id)) : activas

  return <>
    <div className="no-imprimir">
      <Cabeza etiqueta="Carta y QR" titulo="Mesas y QR">
        <button className="btn" onClick={() => window.print()} data-ayuda="imprimir-qr">Imprimir {elegidas.length ? `${elegidas.length} QR` : 'todos los QR'}</button>
        <button className="btn pri" onClick={() => setVentana('nueva')}>Nueva mesa</button></Cabeza>
      <SubNavCarta />
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px', maxWidth: '72ch' }}>Cada mesa tiene su QR: el cliente lo escanea, ve la carta, pide y llama al mozo. Los pedidos del QR esperan que el mozo los confirme. Si un QR se filtra (alguien le sacó foto), generá uno nuevo y el viejo deja de andar.</p>
      <div className="qr-grid">
        {mesas.map((m) => <div className="panel qr-card" key={m.id} style={m.activa ? undefined : { opacity: 0.55 }}>
          <label className="check" style={{ justifyContent: 'space-between', width: '100%' }}><b style={{ fontFamily: 'var(--f-display)', fontSize: 22 }}>Mesa {m.numero}</b>
            {m.activa && <input type="checkbox" aria-label={`Elegir mesa ${m.numero}`} checked={elegidas.includes(m.id)} onChange={(e) => setElegidas(e.target.checked ? [...elegidas, m.id] : elegidas.filter((x) => x !== m.id))} />}</label>
          <div className="muted" style={{ fontSize: 12 }}>{m.zona || 'Salón'} {!m.activa && <Pill>Inactiva</Pill>} {m.estado !== 'libre' && <Pill tono="acc">{m.estado === 'cuenta' ? 'Pidió la cuenta' : 'Ocupada'}</Pill>}</div>
          {m.activa && <QR texto={linkMesa(m.token)} tam={140} />}
          <div className="fila" style={{ justifyContent: 'center' }}>
            {m.activa && <a className="btn sm ghost" href={linkMesa(m.token)} target="_blank" rel="noreferrer">Probar</a>}
            <button className="btn sm ghost" onClick={() => setVentana(m)}>Editar</button>
            {m.activa && <button className="btn sm ghost" onClick={() => { if (window.confirm(`¿Generar un QR nuevo para la mesa ${m.numero}? El impreso deja de andar.`)) correr(async () => { await rpc('nuevo_qr', { p_mesa: m.id }); d.recargar() }, 'QR nuevo generado: imprimilo') }}>QR nuevo</button>}
          </div>
        </div>)}
      </div>
    </div>
    <div className="solo-imprimir qr-hojas">
      {imprimir.map((m) => <div className="qr-hoja" key={m.id}>
        <img className="qr-logo" src={LOGO} alt="" width={120} height={120} />
        <div className="qr-local">{local}</div>
        <QR texto={linkMesa(m.token)} tam={210} />
        <div className="qr-mesa">Mesa {m.numero}</div>
        <div className="qr-txt">Escaneá para ver la carta, pedir y llamar al mozo</div>
      </div>)}
    </div>
    {ventana && <MesaForm mesa={ventana === 'nueva' ? null : ventana} siguiente={Math.max(0, ...mesas.map((m) => m.numero)) + 1} onCerrar={() => setVentana(null)} onListo={() => { setVentana(null); d.recargar() }} />}
  </>
}

function MesaForm({ mesa, siguiente, onCerrar, onListo }: { mesa: Mesa | null; siguiente: number; onCerrar: () => void; onListo: () => void }) {
  const [numero, setNumero] = useState(String(mesa?.numero ?? siguiente)), [zona, setZona] = useState(mesa?.zona ?? '')
  const { correr, ocupado } = useAccion()
  return <Modal titulo={mesa ? `Mesa ${mesa.numero}` : 'Nueva mesa'} onCerrar={onCerrar}
    pie={<>{mesa && <button className="btn ghost" disabled={ocupado || (mesa.activa && mesa.estado !== 'libre')} onClick={async () => { if (await correr(async () => { const { error } = await supabase.from('mesas').update({ activa: !mesa.activa }).eq('id', mesa.id); if (error) throw new Error(error.message) }, 'Listo')) onListo() }}>{mesa.activa ? 'Desactivar' : 'Activar'}</button>}
      <span className="grow" /><button className="btn pri" disabled={ocupado} onClick={async () => {
        const fila = { numero: Math.round(Number(numero)), zona: zona.trim() || null }
        if (await correr(async () => { if (!(fila.numero > 0)) throw new Error('Número inválido.'); const { error } = mesa ? await supabase.from('mesas').update(fila).eq('id', mesa.id) : await supabase.from('mesas').insert(fila); if (error) throw new Error(error.code === '23505' ? 'Ya hay una mesa con ese número.' : error.message) }, 'Mesa guardada')) onListo()
      }}>Guardar</button></>}>
    <div className="two"><label className="campo">Número<input id="ms-num" type="number" min={1} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus /></label>
      <label className="campo">Zona<input id="ms-zona" list="ms-zonas" value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Salón, Patio, Barra" /><datalist id="ms-zonas"><option value="Salón" /><option value="Patio" /><option value="Barra" /></datalist></label></div>
  </Modal>
}
