import type { Rol } from './tipos'

/** Recorridos guiados de Chichito. Cada paso lleva a una pantalla y resalta un elemento con data-ayuda. */
export interface Paso { ir: string; foco?: string; titulo: string; texto: string }
export interface Circuito { id: string; titulo: string; area: string; roles: Rol[]; pasos: Paso[] }

const G: Rol[] = ['admin', 'encargado']
const SALON: Rol[] = ['admin', 'encargado', 'mozo']

export const CIRCUITOS: Circuito[] = [
  { id: 'noche', titulo: 'Una noche completa', area: 'mesas', roles: G, pasos: [
    { ir: '/mesas', foco: 'mesas', titulo: '1. Mesas', texto: '¡Hola! Así se ve el salón. Tocás una mesa libre, la abrís con los comensales y cargás el pedido.' },
    { ir: '/cocina', foco: 'comandas', titulo: '2. Parrilla', texto: 'La comanda llega sola acá. El parrillero toca Empezar y después Listo, y el mozo ve que tiene que retirar.' },
    { ir: '/barra', foco: 'comandas', titulo: '3. Barra', texto: 'Los tragos, cervezas y vinos van a esta otra pantalla, separados de la comida.' },
    { ir: '/caja', foco: 'por-cobrar', titulo: '4. Caja', texto: 'Cuando la mesa pide la cuenta, se cobra con el medio de pago. Al cobrar se descuentan solos los artículos de cada plato.' },
    { ir: '/stock/compras', foco: 'lista-compras', titulo: '5. Compras', texto: 'Al otro día, esta lista te dice qué comprar y cuánto, según lo que se vende cada día de la semana.' },
    { ir: '/tableros/resumen', foco: 'esta-noche', titulo: '6. Tableros', texto: 'Y acá ves cómo vino la noche, el mes y la plata. ¡Listo, ya conocés todo!' },
  ] },
  { id: 'abrir-mesa', titulo: 'Abrir una mesa y tomar el pedido', area: 'mesas', roles: SALON, pasos: [
    { ir: '/mesas', foco: 'mesas', titulo: 'Elegí la mesa', texto: 'Tocá una mesa libre. Se abre el panel con el botón Abrir mesa: poné cuántos son.' },
    { ir: '/mesas', foco: 'panel-mesa', titulo: 'Cargá el pedido', texto: 'Tocá los productos, agregá aclaraciones si hace falta y mandá. La parrilla y la barra lo reciben al instante.' },
    { ir: '/mesas', foco: 'avisos', titulo: 'Los avisos', texto: 'Acá arriba aparecen las mesas que llaman, los pedidos por QR para confirmar y lo que está listo para llevar.' },
  ] },
  { id: 'comandas', titulo: 'Usar la pantalla de comandas', area: 'cocina', roles: ['admin', 'encargado', 'cocina', 'barra'], pasos: [
    { ir: '', foco: 'comandas', titulo: 'Tres columnas', texto: 'Pendientes, preparando y listos. Cada comanda muestra la mesa y hace cuánto entró.' },
    { ir: '', foco: 'comandas', titulo: 'El reloj', texto: 'Si una comanda tarda mucho se pone amarilla y después roja. Tocá Listo apenas sale, así medimos los tiempos.' },
  ] },
  { id: 'caja', titulo: 'Abrir, cobrar y cerrar la caja', area: 'caja', roles: G, pasos: [
    { ir: '/caja', foco: 'abrir-caja', titulo: 'Al empezar', texto: 'Cargá el efectivo con el que arrancás la noche.' },
    { ir: '/caja', foco: 'por-cobrar', titulo: 'Cobrar', texto: 'Primero aparecen las mesas que pidieron la cuenta. Tocá Cobrar, elegí el medio y, si hace falta, el descuento.' },
    { ir: '/caja', foco: 'gasto-caja', titulo: 'Gastos chicos', texto: 'Si pagás algo con la plata de la caja (hielo, un proveedor), cargalo acá así el cierre da justo.' },
    { ir: '/caja', foco: 'cerrar-caja', titulo: 'Al terminar', texto: 'Contá la plata y cargala. Te digo si sobra o falta.' },
  ] },
  { id: 'articulo', titulo: 'Cargar un artículo', area: 'stock', roles: G, pasos: [
    { ir: '/stock/articulos', foco: 'nuevo-articulo', titulo: 'Lo que comprás', texto: 'Cada cosa que comprás es un artículo: vacío, papas, gin. Poné la unidad, el costo, el mínimo y la merma de limpieza.' },
  ] },
  { id: 'receta', titulo: 'Cargar la receta de un plato', area: 'stock', roles: G, pasos: [
    { ir: '/stock/recetas', foco: 'editar-receta', titulo: 'Recetas y costos', texto: 'Poné cuánto lleva de cada artículo, limpio y por porción (por ejemplo 0,4 kg de vacío). Te muestro el costo y cuánto deja.' },
  ] },
  { id: 'factura', titulo: 'Cargar una factura con foto o PDF', area: 'stock', roles: G, pasos: [
    { ir: '/stock/compras', foco: 'factura', titulo: 'La factura', texto: 'Sacale foto o subí el PDF. Leo cada línea y te muestro todo para revisar antes de cargar: entra al stock y queda el gasto.' },
    { ir: '/stock/compras', foco: 'lista-compras', titulo: 'Qué comprar', texto: 'Esta lista se arma con lo que hay, lo que se vende cada día y el colchón que elegiste en Configuración.' },
  ] },
  { id: 'rendimiento', titulo: 'Hacer una prueba de rendimiento', area: 'stock', roles: G, pasos: [
    { ir: '/stock/rendimientos', foco: 'nueva-prueba', titulo: 'Pesá la pieza', texto: 'Cuando llega la carne, pesala cruda y después limpia. Con 3 o 4 pruebas sabés cuánto perdés de verdad en cada corte y el costo real por porción.' },
  ] },
  { id: 'inventario', titulo: 'Hacer el inventario semanal', area: 'stock', roles: G, pasos: [
    { ir: '/stock/control', foco: 'inventario', titulo: 'Contar todo', texto: 'Una vez por semana, al cierre, contá lo que hay. Con dos inventarios te muestro qué falta sin explicación y cuánta plata es.' },
  ] },
  { id: 'merma', titulo: 'Registrar algo que se tiró', area: 'stock', roles: G, pasos: [
    { ir: '/stock/mermas', foco: 'registrar-merma', titulo: 'Cada cosa que se tira', texto: 'Si algo se venció, se quemó o lo devolvieron, cargalo con el motivo. Así sabemos qué ajustar.' },
  ] },
  { id: 'filtros', titulo: 'Usar los filtros de los tableros', area: 'tableros', roles: G, pasos: [
    { ir: '/tableros/ventas', foco: 'filtros', titulo: 'Desde, hasta y más', texto: 'Elegí el período y filtrá por plato, mozo, día o medio de pago. Con Comparar ves si subió o bajó contra el período anterior.' },
    { ir: '/tableros/ventas', foco: 'calor', titulo: 'Cuándo se vende', texto: 'El mapa de calor te dice qué días y horas se mueve más plata: sirve para armar los turnos.' },
  ] },
  { id: 'platos', titulo: 'Ver qué platos convienen', area: 'tableros', roles: G, pasos: [
    { ir: '/tableros/costos', foco: 'rentabilidad', titulo: 'Rentabilidad', texto: 'Cuánto deja cada plato por unidad y en total en el período.' },
    { ir: '/tableros/costos', foco: 'matriz', titulo: 'Estrellas y para revisar', texto: 'Cruzo lo que se vende con lo que deja: qué cuidar, qué subir de precio y qué podrías sacar de la carta.' },
  ] },
  { id: 'proveedor', titulo: 'Dar de alta un proveedor', area: 'admin', roles: G, pasos: [
    { ir: '/admin/proveedores', foco: 'nuevo-proveedor', titulo: 'Nuevo proveedor', texto: 'Nombre, CUIT, teléfono y plazo de pago. Si te da 30 días, las facturas quedan a pagar con su vencimiento.' },
  ] },
  { id: 'pagar', titulo: 'Cargar un gasto y pagar deudas', area: 'admin', roles: G, pasos: [
    { ir: '/admin/gastos', foco: 'nuevo-gasto', titulo: 'Gastos', texto: 'Alquiler, luz, sueldos: cargalos acá, pagados o pendientes con vencimiento.' },
    { ir: '/admin/gastos', foco: 'por-pagar', titulo: 'Por pagar', texto: 'Acá está todo lo que se debe. Tocá Pagar y elegí de qué cuenta sale la plata.' },
    { ir: '/admin/cuentas', foco: 'saldos', titulo: 'Cuentas', texto: 'El saldo de la caja, el banco y Mercado Pago se calcula solo con lo cobrado y lo pagado.' },
  ] },
  { id: 'usuarios', titulo: 'Invitar a alguien del equipo', area: 'admin', roles: ['admin'], pasos: [
    { ir: '/admin/usuarios', foco: 'invitar', titulo: 'Invitar', texto: 'Poné el nombre, el mail y el rol. Le llega un mail para elegir su contraseña y entra viendo solo lo suyo.' },
  ] },
  { id: 'producto', titulo: 'Cargar un producto en la carta', area: 'carta', roles: G, pasos: [
    { ir: '/carta', foco: 'nuevo-producto', titulo: 'Nuevo producto', texto: 'Nombre, categoría y precio. Si es una botella o lata, marcá que se cuenta por unidad. Si se acaba, pausalo.' },
  ] },
  { id: 'qr', titulo: 'Imprimir los QR de las mesas', area: 'carta', roles: G, pasos: [
    { ir: '/carta/mesas', foco: 'imprimir-qr', titulo: 'Un QR por mesa', texto: 'Imprimí la hoja y pegá cada QR en su mesa. El cliente escanea, ve la carta, pide y llama al mozo.' },
  ] },
]

/** Sección de la app según la ruta (para el traje de Chichito y las ayudas de "esta pantalla") */
export function areaDe(ruta: string) {
  const s = ruta.split('/')[1] || 'mesas'
  return s === 'barra' ? 'cocina' : s
}
