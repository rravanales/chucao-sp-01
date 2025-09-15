/**
 * @file app/(main)/layout.tsx
 * @brief Layout principal para las rutas de la aplicación autenticada.
 * @description Server Component que:
 *   1) Autentica al usuario
 *   2) Garantiza que tenga perfil
 *   3) Carga permisos del usuario (lista) y los transforma a mapa
 *   4) Envuelve con PermissionProvider para exponer permisos en todo /(main)
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import {
  getProfileByUserIdAction,
  createProfileAction
} from "@/actions/db/profiles-actions"
import { getUserPermissionsAction } from "@/actions/db/user-group-actions"
import { MainHeader } from "@/components/shared/main-header"
import { MainSidebar } from "@/components/shared/main-sidebar"
import { PermissionProvider } from "@/context/permission-context"
import type { UserPermissionsMap } from "@/types/permissions-types"
import { buildUserPermissionsMap } from "@/types/permissions-types" // 👈 importar el helper

interface MainLayoutProps {
  children: React.ReactNode
}

export default async function MainLayout({ children }: MainLayoutProps) {
  const { userId } = await auth()

  // Si no hay userId, redirigir al login
  if (!userId) {
    redirect("/login")
  }

  // Asegurar que el usuario tenga un perfil en la DB
  const profileRes = await getProfileByUserIdAction(userId)
  if (!profileRes.isSuccess || !profileRes.data) {
    const createProfileRes = await createProfileAction({ userId })
    if (!createProfileRes.isSuccess) {
      console.error(
        "Error creating profile for user:",
        createProfileRes.message
      )
      redirect("/login") // o '/error?message=profile_creation_failed'
    }
  }

  // Obtener los permisos del usuario (probablemente viene como LISTA)
  const permissionsRes = await getUserPermissionsAction()

  // Transformar la lista -> mapa para cumplir con UserPermissionsMap
  const initialPermissions: UserPermissionsMap | null =
    permissionsRes.isSuccess && permissionsRes.data
      ? buildUserPermissionsMap(permissionsRes.data) // 👈 aquí la conversión
      : null

  return (
    <PermissionProvider initialPermissions={initialPermissions}>
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
    </PermissionProvider>
  )
}
