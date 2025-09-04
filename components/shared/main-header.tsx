/**
 * @file components/shared/main-header.tsx
 * @brief Componente de encabezado principal para la aplicación autenticada.
 * @description Este componente de servidor proporciona la barra de navegación superior para el
 * layout principal de la aplicación. Incluye el título de la aplicación, la
 * interfaz de usuario del usuario de Clerk (para gestión de cuenta) y un botón
 * para alternar la visibilidad de la barra lateral en dispositivos móviles.
 *
 * @notes
 * - Es un Server Component para manejar la autenticación directamente y ofrecer
 *   una experiencia de carga más rápida y segura para elementos estáticos.
 * - Se integra con Clerk para mostrar la información del usuario autenticado.
 * - Incluye un botón que activará el Sheet del MainSidebar en vista móvil.
 */
import Link from "next/link"
import { UserButton } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server" // Importar auth para obtener el userId
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"

export async function MainHeader() {
  const { userId } = await auth() // Obtener el ID del usuario autenticado

  return (
    <header className="bg-background sticky top-0 z-40 w-full border-b">
      <div className="container flex h-16 items-center justify-between py-4">
        {/* Título de la aplicación / Logo */}
        <Link
          href="/dashboard"
          className="flex items-center space-x-2 text-lg font-bold"
        >
          <span>DeltaOne</span>
        </Link>

        <div className="flex items-center space-x-4">
          {/* Botón para abrir el sidebar en móvil (controlado por MainSidebar) */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            id="mobile-sidebar-toggle"
          >
            <Menu className="size-5" />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>

          {/* User Button de Clerk */}
          {userId && <UserButton afterSignOutUrl="/login" />}
        </div>
      </div>
    </header>
  )
}
