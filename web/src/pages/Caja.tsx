import { useState } from 'react'
import { rpc, tabla, useConsulta, useEnVivo } from '../lib/datos'
import { invocar, supabase } from '../lib/supabase'
import { duracion, fecha, hhmm, jornada, minutosDesde, plata } from '../lib/formato'
import type { Cuenta, Factura, Gasto, Jornada, MedioPago, Mesa, Pedido, Ticket } from '../lib/tipos'
import type { EstadoFacturacion } from '../lib/factura'
import { numeroFactura } from '../lib/factura'
import { EstadoFacturaTicket, FacturarTicket } from '../components/facturas'
import { Cobrar } from '../components/salon'
import { AutoVacio } from '../components/Autos'
import { Cabeza, Modal, Pill, Stat, useAccion } from '../components/ui'
import { chapaMesa, etiquetaMesa } from '../lib/mesas'

interface PagoT { ticket_id: number; medio: string; monto: number; venta: number }
interface Cambio { id: number; hora: string; mesa: string; tipo: 'sacado' | 'invitado' | 'pasado'; nombre: string; cantidad: number; importe: number; motivo: string | null; usuario: string | null }

type Ventana = null | 'abrir' | 'gasto' | 'cerrar' | { cobrar: Mesa } | { facturar: Ticket }

export default function Caja() {
  const [ver, setVer] = useState<string | null>(null)
  const hoyJ = jornada(), j = ver ?? hoyJ
  // Adónde van los cobros de ahora: la jornada actual, o la siguiente si su caja ya se cerró
  const destino = useConsulta(() => rpc<string>('jornada_caja'))
  const { datos, recargar, error } = useConsulta(async () => {
    const [jor, tickets, gastos, mesas, pedidos, medios, cuentas, esperado] = await Promise.all([
      tabla<Jornada[]>(supabase.from('jornadas').select('*').eq('fecha', j)),
      tabla<Ticket[]>(supabase.from('tickets').select('*, ticket_items(nombre, cantidad, precio)').eq('jornada', j).order('hora', { ascending: false })),
      tabla<Gasto[]>(supabase.from('gastos').select('*').eq('jornada', j).eq('origen', 'caja').order('creado', { ascending: false })),
      tabla<Mesa[]>(supabase.from('mesas').select('*').neq('estado', 'libre').order('numero')),
      tabla<Pedido[]>(supabase.from('pedidos').select('*, pedido_items(*)').is('ticket_id', null).eq('confirmado', true)),
      tabla<MedioPago[]>(supabase.from('medios_pago').select('*').order('orden')),
      tabla<Cuenta[]>(supabase.from('cuentas').select('*')),
      rpc<number>('efectivo_esperado', { p_jornada: j }),
    ])
    const [pagos, cambios] = await Promise.all([
      tabla<PagoT[]>(supabase.from('pagos_ticket').select('*').eq('jornada', j)),
      tabla<Cambio[]>(supabase.from('pedido_cambios').select('*').eq('jornada', j).order('hora', { ascending: false })),
    ])
    const [facturas, fac] = await Promise.all([
      tickets.length ? tabla<Factura[]>(supabase.from('facturas').select('*').in('ticket_id', tickets.map((t) => t.id))) : Promise.resolve([] as Factura[]),
      rpc<EstadoFacturacion | null>('facturacion_estado').catch(() => null),
    ])
    return { jor: jor[0] ?? null, tickets, gastos, mesas, pedidos, medios, cuentas, esperado: Number(esperado), facturas, fac, pagos, cambios }
  }, [j])
  useEnVivo(['mesas', 'pedidos', 'facturas', 'pedido_cambios'], recargar, 30)
  const { correr } = useAccion()
  const [ventana, setVentana] = useState<Ventana>(null)

  if (error) return <div className="aviso bad">{error}</div>
  if (!datos) return <p className="cargando">Cargando la caja…</p>
  const { jor, tickets, gastos, mesas, pedidos, medios, cuentas, esperado, facturas, fac, pagos, cambios } = datos
  const factOn = !!fac?.activa
  const facturasDe = (t: number) => facturas.filter((f) => f.ticket_id === t && f.ambiente === fac?.ambiente)
  const abierta = jor?.apertura != null, cerrada = !!jor?.cerrada_en
  const total = tickets.reduce((s, t) => s + Number(t.total), 0)
  // La plata por medio sale de los pagos (una mesa puede pagar con dos medios; la propina va incluida)
  const porMedio = medios.map((m) => ({ ...m, v: pagos.filter((p) => p.medio === m.nombre).reduce((s, p) => s + Number(p.monto), 0) })).filter((m) => m.activo || m.v > 0)
  const propinas = tickets.reduce((s, t) => s + Number(t.propina ?? 0), 0)
  const mediosDe = (t: Ticket) => { const ps = pagos.filter((p) => p.ticket_id === t.id); return ps.length ? ps.map((p) => ps.length > 1 ? `${p.medio} ${plata(p.monto)}` : p.medio).join(' + ') : t.medio }
  const efectivoMedios = new Set(medios.filter((m) => cuentas.find((c) => c.id === m.cuenta_id)?.tipo === 'Efectivo').map((m) => m.nombre))
  const efectivo = pagos.filter((p) => efectivoMedios.has(p.medio)).reduce((s, p) => s + Number(p.monto), 0)
  const egresos = gastos.reduce((s, g) => s + Number(g.monto), 0)
  const itemsDe = (m: Mesa) => pedidos.filter((p) => p.mesa_id === m.id).flatMap((p) => p.pedido_items ?? [])
  const totalMesa = (m: Mesa) => itemsDe(m).reduce((s, i) => s + i.cantidad * i.precio, 0)
  const porCobrar = [...mesas].filter((m) => m.activa).sort((a, b) => (a.estado === 'cuenta' ? 0 : 1) - (b.estado === 'cuenta' ? 0 : 1) || a.numero - b.numero)
  const movs = [
    ...tickets.map((t) => ({ t, h: t.hora, txt: `${t.mesa_nombre ?? `Mesa ${t.mesa_numero ?? '—'}`} · ${(t.ticket_items ?? []).reduce((s, i) => s + i.cantidad, 0)} ítems`, med: mediosDe(t) + (Number(t.descuento_pct) ? ` · ${t.descuento_pct}% desc.` : '') + (Number(t.propina) ? ` · propina ${plata(t.propina!)}` : ''), m: Number(t.total) })),
    ...gastos.map((g) => ({ t: null as Ticket | null, h: g.creado, txt: `Gasto: ${g.concepto}`, med: 'Efectivo', m: -Number(g.monto) })),
  ].sort((a, b) => (a.h < b.h ? 1 : -1))
  const listo = () => { setVentana(null); recargar(); destino.recargar() }
  const jc = destino.datos

  return <>
    <Cabeza etiqueta={`Jornada ${fecha(j)}`} titulo="Caja">
      {!abierta ? <button className="btn pri" onClick={() => setVentana('abrir')} data-ayuda="abrir-caja">Abrir caja</button>
        : !cerrada ? <><button className="btn" onClick={() => setVentana('gasto')} data-ayuda="gasto-caja">Registrar gasto</button><button className="btn pri" onClick={() => setVentana('cerrar')} data-ayuda="cerrar-caja">Cerrar caja</button></>
        : <Pill tono="ok">Caja cerrada {hhmm(jor!.cerrada_en!)}</Pill>}
    </Cabeza>
    <div className="stats" style={{ marginBottom: 16 }}>
      <Stat label="Vendido" valor={plata(total)} /><Stat label="Mesas cobradas" valor={tickets.length} />
      <Stat label="Efectivo" valor={plata(efectivo)} /><Stat label="Gastos de caja" valor={plata(egresos)} />
      {propinas > 0 && <Stat label="Propinas" valor={plata(propinas)} extra={<span className="muted" style={{ fontSize: 12 }}>para repartir</span>} />}
      <Stat label="Debería haber en caja" valor={abierta ? plata(esperado) : '—'} />
      {factOn && (() => { const facturado = tickets.filter((t) => facturasDe(t.id).some((f) => f.tipo === 11 && f.estado === 'autorizada' && !f.anulada)).reduce((s, t) => s + Number(t.total), 0)
        return <><Stat label="Facturado" valor={plata(facturado)} /><Stat label="Sin factura" valor={plata(total - facturado)} /></> })()}
    </div>
    {cerrada && jc && jc !== j && <div className="alert" style={{ marginBottom: 16 }}><Pill tono="warn">Caja cerrada</Pill>
      <span className="grow">Lo que se cobre ahora va a la jornada del <b>{fecha(jc)}</b>.</span>
      <button className="btn sm" onClick={() => setVer(jc)}>Ver esa jornada</button></div>}
    {j !== hoyJ && <div className="alert" style={{ marginBottom: 16 }}><span className="grow">Estás viendo la jornada del <b>{fecha(j)}</b>.</span>
      <button className="btn sm ghost" onClick={() => setVer(null)}>Volver a la de hoy</button></div>}
    {cerrada && (() => { const dif = Number(jor!.cierre_contado) - Number(jor!.cierre_esperado); return <div className="alert" style={{ background: dif === 0 ? 'var(--ok-soft)' : 'var(--warn-soft)', marginBottom: 16 }}>
      <span className="grow">Cierre: contado <b className="mono">{plata(jor!.cierre_contado)}</b>, esperado <span className="mono">{plata(jor!.cierre_esperado)}</span>. Diferencia <b className="mono">{dif > 0 ? '+' : ''}{plata(dif)}</b></span></div> })()}
    {!abierta && <div className="alert" style={{ marginBottom: 16 }}><span className="grow">La caja de hoy no está abierta. Abrila con el efectivo inicial para que el cierre dé justo.</span></div>}

    <div className="caja-grid">
      <section className="panel" data-ayuda="por-cobrar"><h3 style={{ marginBottom: 6 }}>Mesas por cobrar</h3><div className="rows">
        {porCobrar.length ? porCobrar.map((m) => <div key={m.id} className="row">
          <b style={{ fontFamily: 'var(--f-display)', fontSize: 24, minWidth: '2ch' }}>{chapaMesa(m)}</b>
          <span className="grow">{m.temporal && <b style={{ marginRight: 6 }}>{etiquetaMesa(m)}</b>}{m.estado === 'cuenta' ? <Pill tono="acc">Pidió la cuenta</Pill> : <span className="muted">Abierta {duracion(minutosDesde(m.abierta!))}</span>}</span>
          <span className="num">{plata(totalMesa(m))}</span>
          <button className="btn sm pri" disabled={!itemsDe(m).length} onClick={() => setVentana({ cobrar: m })}>Cobrar</button>
        </div>) : <AutoVacio texto="No hay mesas abiertas" cat="r12" />}
      </div></section>
      <section className="panel"><h3 style={{ marginBottom: 6 }}>Por medio de pago</h3><div className="rows">
        {porMedio.map((m) => <div key={m.nombre} className="row"><span className="grow">{m.nombre}</span><span className="num mono">{plata(m.v)}</span></div>)}
      </div></section>
    </div>

    <section className="panel" style={{ marginTop: 16 }}><h3 style={{ marginBottom: 6 }}>Movimientos de hoy</h3>
      {movs.length ? <div className="tbl-wrap"><table><thead><tr><th>Hora</th><th>Detalle</th><th>Medio</th><th className="r">Importe</th>{factOn && <th>Factura</th>}</tr></thead><tbody>
        {movs.map((x, i) => <tr key={i}><td className="mono">{hhmm(x.h)}</td><td>{x.txt}</td><td className="muted">{x.med}</td><td className="r mono" style={x.m < 0 ? { color: 'var(--crit)' } : undefined}>{plata(x.m)}</td>
          {factOn && <td>{x.t && Number(x.t.total) > 0 && <EstadoFacturaTicket fs={facturasDe(x.t.id)} sinFactura={x.t.sin_factura} onFacturar={() => setVentana({ facturar: x.t! })}
            onSinFactura={() => correr(async () => { await rpc('ticket_sin_factura', { p_ticket: x.t!.id, p_valor: true }); recargar() }, 'Marcada sin factura')}
            onAnular={(f) => { if (window.confirm(`¿Anular la factura ${numeroFactura(f.punto_venta, f.numero)} de ${plata(f.total)}? Se hace una nota de crédito en ARCA y después la podés volver a facturar.`))
              correr(async () => { const r = await invocar('arca', { accion: 'anular', factura_id: f.id }); if (r.error) throw new Error(r.error); recargar() }, 'Factura anulada con nota de crédito') }} />}</td>}</tr>)}
      </tbody></table></div> : <div className="kempty">Sin cobros todavía. Los tickets aparecen acá al cobrar una mesa.</div>}
    </section>

    {cambios.length > 0 && <section className="panel" style={{ marginTop: 16 }} data-ayuda="cambios"><h3 style={{ marginBottom: 6 }}>Sacado, invitado y pasado</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Lo que se corrigió en las mesas esta jornada, para tenerlo controlado.</p>
      <div className="tbl-wrap"><table><thead><tr><th>Hora</th><th>Mesa</th><th>Qué</th><th>Motivo</th><th>Quién</th><th className="r">Importe</th></tr></thead><tbody>
        {cambios.map((c) => <tr key={c.id}><td className="mono">{hhmm(c.hora)}</td><td>{c.mesa}</td>
          <td><Pill tono={c.tipo === 'sacado' ? 'crit' : c.tipo === 'invitado' ? 'ok' : ''}>{c.tipo === 'sacado' ? 'Sacado' : c.tipo === 'invitado' ? 'Invita la casa' : 'Pasado'}</Pill> {c.cantidad}× {c.nombre}</td>
          <td className="muted">{c.motivo ?? '—'}</td><td className="muted">{c.usuario ?? '—'}</td><td className="r mono">{c.tipo === 'pasado' ? '—' : plata(c.importe)}</td></tr>)}
      </tbody></table></div>
    </section>}

    {ventana === 'abrir' && <AbrirCaja onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana === 'gasto' && <GastoCaja onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana === 'cerrar' && <CerrarCaja esperado={esperado} jor={jor!} efectivo={efectivo} egresos={egresos} hayMesas={mesas.length > 0} onCerrar={() => setVentana(null)} onListo={listo} />}
    {ventana && typeof ventana === 'object' && 'facturar' in ventana && <FacturarTicket ticket={ventana.facturar.id} total={Number(ventana.facturar.total)} tope={fac?.tope ?? 10000000}
      onCerrar={() => setVentana(null)} onListo={recargar} />}
    {ventana && typeof ventana === 'object' && 'cobrar' in ventana && <Cobrar mesa={ventana.cobrar} items={itemsDe(ventana.cobrar)} onCerrar={() => setVentana(null)} onListo={listo} />}
  </>
}

function AbrirCaja({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [m, setM] = useState('0')
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Abrir caja" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado}
    onClick={async () => { if (await correr(() => rpc('abrir_caja', { p_monto: Number(m) || 0 }), 'Caja abierta')) onListo() }}>Abrir caja</button></>}>
    <label className="campo">Efectivo inicial en caja ($)<input id="a-monto" type="number" min={0} inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} autoFocus /></label>
  </Modal>
}

function GastoCaja({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [c, setC] = useState(''), [m, setM] = useState('')
  const { correr, ocupado } = useAccion()
  return <Modal titulo="Gasto con la plata de la caja" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado}
    onClick={async () => { if (await correr(() => rpc('registrar_gasto_caja', { p_concepto: c, p_monto: Number(m) }), 'Gasto registrado')) onListo() }}>Guardar gasto</button></>}>
    <label className="campo">Concepto<input id="e-desc" placeholder="Hielo, propinas, un proveedor…" value={c} onChange={(e) => setC(e.target.value)} autoFocus /></label>
    <label className="campo">Monto ($)<input id="e-monto" type="number" min={0} inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} /></label>
    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Queda también en Administración → Gastos, como caja chica.</p>
  </Modal>
}

function CerrarCaja({ esperado, jor, efectivo, egresos, hayMesas, onCerrar, onListo }: { esperado: number; jor: Jornada; efectivo: number; egresos: number; hayMesas: boolean; onCerrar: () => void; onListo: () => void }) {
  const [c, setC] = useState('')
  const { correr, ocupado } = useAccion()
  const dif = c === '' ? null : Number(c) - esperado
  return <Modal titulo="Cerrar caja" onCerrar={onCerrar} pie={<><span className="grow" /><button className="btn pri" disabled={ocupado || c === ''}
    onClick={async () => { if (await correr(() => rpc('cerrar_caja', { p_contado: Number(c) }), 'Caja cerrada')) onListo() }}>Cerrar caja</button></>}>
    <dl className="kv"><dt>Inicial</dt><dd className="mono">{plata(jor.apertura)}</dd><dt>Cobrado en efectivo</dt><dd className="mono">{plata(efectivo)}</dd>
      <dt>Gastos de caja</dt><dd className="mono">−{plata(egresos)}</dd><dt><b>Debería haber</b></dt><dd className="mono"><b>{plata(esperado)}</b></dd></dl>
    <label className="campo">Efectivo contado ($)<input id="z-cont" type="number" min={0} inputMode="numeric" value={c} onChange={(e) => setC(e.target.value)} autoFocus /></label>
    {dif != null && <div className="mono">Diferencia: {dif > 0 ? '+' : ''}{plata(dif)}</div>}
    {hayMesas && <div className="alert"><span className="grow">Todavía hay mesas abiertas sin cobrar.</span></div>}
  </Modal>
}
