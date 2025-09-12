/**
 * @file app/(main)/settings/users/page.tsx
 * @brief Página de administración de usuarios para listar, crear, editar y eliminar usuarios.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario.
 *   - Obtener la lista de perfiles de usuario existentes (UC-400).
 *   - Obtener la lista de grupos existentes (UC-402) para mostrar las membresías.
 *   - Renderizar el componente de cliente UserManagementTable con los datos necesarios.
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllProfilesAction } from "@/actions/db/profiles-actions"
import { getAllGroupsAction } from "@/actions/db/user-group-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import UserManagementTable from "./_components/user-management-table"
import { SelectGroup, SelectProfile } from "@/db/schema"
import { getLogger } from "@/lib/logger"

const logger = getLogger("users-page")

export default async function UserSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  const profilesRes = await getAllProfilesAction()
  const groupsRes = await getAllGroupsAction()

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

  const profiles: SelectProfile[] = profilesRes.data || []
  const groups: SelectGroup[] = groupsRes.data || []

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Administración de Usuarios</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios del Sistema</CardTitle>
          {/* Aquí se podría añadir una descripción si fuera necesario */}
        </CardHeader>
        <CardContent>
          <UserManagementTable
            initialProfiles={profiles}
            initialGroups={groups}
          />
        </CardContent>
      </Card>
    </div>
  )
}
