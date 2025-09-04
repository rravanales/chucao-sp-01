/**
 * @file app/(main)/layout.tsx
 * @brief Layout principal de la aplicación para rutas autenticadas.
 * @description Este layout de servidor envuelve todas las páginas bajo la ruta `/(main)`
 * y proporciona la estructura base de la interfaz de usuario, incluyendo la barra de navegación
 * superior (MainHeader) y la barra lateral de navegación (MainSidebar).
 * Gestiona el diseño general de la aplicación para usuarios autenticados.
 *
 * @notes
 * - Este es un Server Component para permitir una renderización inicial eficiente
 *   y la posibilidad de pasar datos directamente a los componentes hijos.
 * - Utiliza un diseño flexible para colocar el encabezado, la barra lateral y el contenido principal.
 */
import { MainHeader } from "@/components/shared/main-header"
import { MainSidebar } from "../../components/shared/main-sidebar"

interface MainLayoutProps {
  children: React.ReactNode
}

export default async function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Encabezado principal de la aplicación */}
      <MainHeader />
      <div className="flex flex-1">
        {/* Barra lateral principal para navegación */}
        <MainSidebar />
        {/* Contenido principal de la página */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
