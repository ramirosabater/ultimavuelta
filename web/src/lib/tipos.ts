// Tipos de las tablas que usa la app (escritos a mano; ver README para generarlos desde Supabase)

export type Rol = 'admin' | 'encargado' | 'mozo' | 'cocina' | 'barra'
export type Estacion = 'cocina' | 'barra'
export type EstadoComanda = 'pendiente' | 'preparando' | 'listo' | 'entregado'
export type EstadoMesa = 'libre' | 'ocupada' | 'cuenta'

export interface Perfil { id: string; nombre: string; email: string | null; rol: Rol; activo: boolean }

export interface Categoria { id: number; nombre: string; estacion: Estacion; orden: number; activa: boolean }
export interface Producto {
  id: number; nombre: string; descripcion: string | null; categoria_id: number; precio: number; estacion: Estacion
  activo: boolean; controla_stock: boolean; stock: number; stock_min: number; orden: number
}
export interface Proveedor {
  id: number; nombre: string; rubro: string | null; cuit: string | null; contacto: string | null; telefono: string | null
  email: string | null; plazo_dias: number; notas: string | null; activo: boolean
}
export interface Insumo {
  id: number; nombre: string; unidad: string; cantidad: number; minimo: number; costo: number; merma_pct: number
  pack: number | null; pack_nombre: string | null; proveedor_id: number | null; vence: string | null; activo: boolean
  rinde_coccion: number; referencia_id: number | null
}
/** Tabla de referencia: merma de limpieza, rinde al cocinar (cocido / limpio) y porción típica */
export interface Referencia {
  id: number; nombre: string; grupo: string; unidad: string; limpieza_pct: number; rinde_coccion: number
  coccion: string | null; porcion: number | null; porcion_es: 'cocido' | 'limpio'; nota: string | null
}
export interface RecetaItem { producto_id: number; insumo_id: number; cantidad: number; cocido: boolean }

export interface Mesa {
  id: number; numero: number; zona: string | null; activa: boolean; token: string; estado: EstadoMesa
  abierta: string | null; comensales: number | null; mozo_id: string | null
  tipo: TipoCuenta; nombre: string | null; telefono: string | null; direccion: string | null; temporal: boolean
}
/** mesa: una mesa del salón · el resto: cuentas sin mesa (se apagan al cobrarlas) */
export type TipoCuenta = 'mesa' | 'llevar' | 'delivery' | 'barra' | 'aparte'
export interface PedidoItem { id: number; pedido_id: number; producto_id: number | null; nombre: string; cantidad: number; precio: number; estacion: Estacion; nota: string | null; cortesia?: boolean }
export interface Pedido {
  id: number; mesa_id: number; origen: 'mozo' | 'qr'; confirmado: boolean; creado: string; mozo_id: string | null
  est_cocina: EstadoComanda | null; est_barra: EstadoComanda | null; t_cocina_listo: string | null; t_barra_listo: string | null
  ticket_id: number | null; pedido_items?: PedidoItem[]
}
export interface Llamado { mesa_id: number; creado: string }

export interface Cuenta { id: number; nombre: string; tipo: 'Efectivo' | 'Banco' | 'Billetera virtual'; saldo_inicial: number; desde: string; orden: number; activa: boolean }
export interface MedioPago { nombre: string; cuenta_id: number | null; orden: number; activo: boolean }
export interface Jornada {
  fecha: string; apertura: number | null; abierta_en: string | null; cierre_contado: number | null
  cierre_esperado: number | null; cerrada_en: string | null
}
export interface Ticket {
  id: number; jornada: string; hora: string; mesa_numero: number | null; comensales: number | null; mozo_nombre: string | null
  subtotal: number; descuento_pct: number; total: number; medio: string; costo: number; sin_factura: boolean
  propina?: number; mesa_nombre?: string | null
  ticket_items?: { nombre: string; cantidad: number; precio: number }[]
}
export interface Gasto {
  id: number; fecha: string; concepto: string; categoria: string; monto: number; proveedor_id: number | null
  estado: 'pagado' | 'pendiente'; cuenta_id: number | null; pagado_el: string | null; vence: string | null
  origen: 'manual' | 'compra' | 'caja'; jornada: string | null; nota: string | null; creado: string
}
export interface MovimientoStock {
  id: number; insumo_id: number | null; producto_id: number | null; tipo: 'venta' | 'compra' | 'ingreso' | 'merma' | 'conteo'
  cantidad: number; costo_unit: number; motivo: string | null; nota: string | null; jornada: string; hora: string
}
export interface Inventario { id: number; fecha: string; completo: boolean; nota: string | null }
export interface Rendimiento { id: number; insumo_id: number; proveedor: string | null; crudo: number; limpio: number; cocido: number | null; nota: string | null; fecha: string }

export const ROLES: Record<Rol, { nombre: string; texto: string }> = {
  admin: { nombre: 'Dueño', texto: 'Todo, incluidos usuarios y configuración' },
  encargado: { nombre: 'Encargado', texto: 'Todo menos usuarios y configuración' },
  mozo: { nombre: 'Mozo', texto: 'Mesas, pedidos y cobrar' },
  cocina: { nombre: 'Parrilla', texto: 'La pantalla de comandas de parrilla y cocina' },
  barra: { nombre: 'Barra', texto: 'La pantalla de comandas de barra' },
}

export const CAT_GASTO = ['Mercadería', 'Alquiler', 'Sueldos y cargas', 'Luz, gas y agua', 'Internet y teléfono', 'Impuestos y tasas',
  'Mantenimiento', 'Limpieza', 'Publicidad', 'Comisiones y bancos', 'Caja chica', 'Otros']
export const MOTIVOS_MERMA = ['Vencido o en mal estado', 'Se quemó o salió mal', 'Devolución del cliente', 'Rotura o derrame', 'Sobrante del día', 'Otro']
export const UNIDADES = ['kg', 'g', 'L', 'ml', 'u.', 'atados', 'bolsas']

export type EstadoReserva = 'pendiente' | 'confirmada' | 'sentada' | 'cancelada' | 'no_vino'
export interface Reserva {
  id: number; codigo: string; nombre: string; telefono: string; personas: number; fecha: string; hora: string
  nota: string | null; estado: EstadoReserva; origen: 'web' | 'telefono' | 'local'; mesa_id: number | null
  creado: string; creado_por: string | null; atendido: string | null; cancelada_por: 'cliente' | 'local' | null
}

export interface Factura {
  id: number; codigo: string; ticket_id: number | null; tipo: 11 | 13; punto_venta: number; numero: number | null; fecha: string; total: number
  doc_tipo: number; doc_nro: number; receptor: string | null; cond_iva_receptor: number; estado: 'pendiente' | 'autorizada' | 'rechazada'
  cae: string | null; cae_vence: string | null; error: string | null; observaciones: string | null; ambiente: 'homologacion' | 'produccion'
  asociada_id: number | null; anulada: boolean; creado: string
}
export interface ConfigFacturacion {
  cuit: string | null; razon_social: string | null; nombre_fantasia: string | null; domicilio: string | null; iibb: string | null
  inicio_actividades: string | null; punto_venta: number | null; ambiente: 'homologacion' | 'produccion'; activa: boolean; facturar_siempre: boolean
  tope_identificar: number; csr: string | null; cert_homologacion: string | null; cert_produccion: string | null
  vence_homologacion: string | null; vence_produccion: string | null; ultima_prueba: string | null; ultima_prueba_ok: boolean | null; ultima_prueba_msg: string | null
}
