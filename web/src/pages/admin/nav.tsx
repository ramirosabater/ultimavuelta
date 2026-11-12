import { SubNav } from '../../components/Layout'
import { useAuth } from '../../auth/AuthProvider'

export function SubNavAdmin() {
  const { perfil } = useAuth()
  const items: [string, string][] = [['/admin/proveedores', 'Proveedores'], ['/admin/gastos', 'Gastos'], ['/admin/cuentas', 'Cuentas']]
  if (perfil?.rol === 'admin') items.push(['/admin/usuarios', 'Usuarios'], ['/admin/configuracion', 'Configuración'])
  return <SubNav items={items} />
}
