/**
 * @file components/shared/main-sidebar.tsx
 * @brief Componente de barra lateral principal para la aplicación autenticada.
 * @description Este componente de servidor proporciona la navegación lateral para el
 * layout principal de la aplicación. Incluye enlaces a las secciones principales
 * de la aplicación y un componente de Sheet para la funcionalidad de menú lateral
 * en dispositivos móviles.
 *
 * @notes
 * - Es un Server Component para renderizar los enlaces de navegación estáticos
 *   de manera eficiente.
 * - Utiliza un componente de cliente (MobileSidebar) encapsulado para la interactividad
 *   del menú lateral en móvil con Shadcn's Sheet.
 * - Los Tooltips se utilizan para mejorar la usabilidad de los iconos de navegación.
 */
"use client" // Marcado como cliente para permitir el uso de estado y efectos para el Sheet/toggle

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  Building,
  ClipboardList,
  UploadCloud,
  BellRing,
  Users,
  Settings,
  LayoutDashboard,
  Menu
} from "lucide-react"
import React, { useState } from "react"

interface NavLinkProps {
  href: string
  icon: React.ReactNode
  label: string
}

const navLinks: NavLinkProps[] = [
  {
    href: "/dashboard",
    icon: <LayoutDashboard className="size-5" />,
    label: "Dashboard"
  },
  {
    href: "/organizations",
    icon: <Building className="size-5" />,
    label: "Organizaciones"
  },
  {
    href: "/scorecards",
    icon: <ClipboardList className="size-5" />,
    label: "Scorecards"
  },
  {
    href: "/data-imports",
    icon: <UploadCloud className="size-5" />,
    label: "Importaciones"
  },
  { href: "/alerts", icon: <BellRing className="size-5" />, label: "Alertas" },
  {
    href: "/settings/users",
    icon: <Users className="size-5" />,
    label: "Usuarios"
  },
  {
    href: "/settings/app",
    icon: <Settings className="size-5" />,
    label: "Configuración"
  }
]

export function MainSidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false) // Estado para controlar si el Sheet está abierto

  // Función para cerrar el Sheet después de la navegación
  const handleNavigation = () => {
    setIsOpen(false)
  }

  const SidebarContent = () => (
    <nav className="flex flex-col gap-2 p-4">
      <h2 className="mb-4 px-2 text-xl font-semibold">Navegación</h2>
      <Separator className="mb-4" />
      <TooltipProvider>
        {navLinks.map(link => (
          <Tooltip key={link.href}>
            <TooltipTrigger asChild>
              <Link
                href={link.href}
                className={cn(
                  "hover:bg-muted flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
                  pathname === link.href
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
                onClick={handleNavigation} // Cerrar el Sheet al navegar
              >
                {link.icon}
                <span className="text-sm font-medium">{link.label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{link.label}</TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </nav>
  )

  return (
    <>
      {/* Sidebar para escritorio */}
      <aside className="bg-sidebar hidden w-64 flex-col border-r md:flex">
        <div className="flex-1 overflow-y-auto">
          <SidebarContent />
        </div>
      </aside>

      {/* Sidebar para móvil (Sheet) */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          {/* El botón en el header para móvil lo activa */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4 md:hidden"
            aria-label="Toggle Sidebar"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>
    </>
  )
}
