/**
 * @file app/(main)/settings/users/page.tsx
 * @brief Página de administración de usuarios para listar, crear, editar y eliminar usuarios.
 * @description Basado en la versión 1, agrega:
 *  - Carga de permisos del usuario e integración con hasPermission.
 *  - Botón/modal de Importación Masiva (UC-401) condicionado por permisos.
 *  Mantiene compatibilidad con v1 (mismas props para UserManagementTable).
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllProfilesAction } from "@/actions/db/profiles-actions"
import { getAllGroupsAction } from "@/actions/db/user-group-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import UserManagementTable from "./_components/user-management-table"
import { SelectGroup, SelectProfile } from "@/db/schema"
import { getLogger } from "@/lib/logger"

// Integración de permisos (mejora v2)
import { getUserPermissionsMapAction } from "@/actions/db/user-group-actions"
import { createHasPermission } from "@/types/permissions-types"

// UI para importación masiva (opcional)
import { Button } from "@/components/ui/button"
import { UploadCloud } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
//import { BulkImportUsersForm } from "./_components/bulk-import-users-form"

const logger = getLogger("users-page")

export default async function UserSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // Carga concurrente: perfiles, grupos y permisos (map)
  const [profilesRes, groupsRes, permsRes] = await Promise.all([
    getAllProfilesAction(),
    getAllGroupsAction(),
    getUserPermissionsMapAction() // devuelve UserPermissionsMap
  ])

  if (!profilesRes.isSuccess) {
    logger.error(`Error loading user profiles: ${profilesRes.message}`)
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar perfiles de usuario
        </h1>
        <p className="text-red-500">{profilesRes.message}</p>
      </div>
    )
  }

  if (!groupsRes.isSuccess) {
    logger.error(`Error loading groups: ${groupsRes.message}`)
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">Error al cargar grupos</h1>
        <p className="text-red-500">{groupsRes.message}</p>
      </div>
    )
  }

  // Si fallan permisos, degradamos con mapa vacío (no bloquea la página v1)
  const userPermissions = permsRes.isSuccess ? permsRes.data || {} : {}

  const profiles: SelectProfile[] = profilesRes.data || []
  const groups: SelectGroup[] = groupsRes.data || []

  // Helper de permisos (v2). Usamos 'user:manage' para habilitar importación/desactivación.
  const hasPermission = createHasPermission(userPermissions)
  const canManageUsers = hasPermission("user:manage", "global")

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Administración de Usuarios</h1>

        {/* Nuevo en v2: Importación masiva condicionada por permisos. No rompe v1. */}
        <div className="flex gap-4">
          {/* <Dialog>
            <DialogTrigger asChild>
              <Button disabled={!canManageUsers}>
                <UploadCloud className="mr-2 size-4" /> Importar Usuarios
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Importar Usuarios Masivamente</DialogTitle>
                <DialogDescription>
                  Sube un archivo CSV para crear o actualizar múltiples cuentas de usuario.
                  Asegúrate de incluir al menos la columna <code>email</code>. Puedes asociar grupos por clave.
                </DialogDescription>
              </DialogHeader>
              <BulkImportUsersForm allGroups={groups} />
            </DialogContent>
          </Dialog> */}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios del Sistema</CardTitle>
        </CardHeader>
        <CardContent>
          <UserManagementTable
            initialProfiles={profiles} // <- mismos nombres que v1
            initialGroups={groups} // <- mismos nombres que v1
          />
        </CardContent>
      </Card>
    </div>
  )
}
