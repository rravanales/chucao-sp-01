/**
 * @file app/(main)/settings/groups/page.tsx
 * @brief Página de administración de grupos para listar, crear, editar y eliminar grupos de usuarios.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario.
 *   - Obtener la lista de grupos existentes (UC-402).
 *   - Obtener la lista de organizaciones existentes (UC-402, UC-503) para permisos organizacionales.
 *   - Obtener la lista de perfiles de usuario (para asignar miembros a grupos).
 *   - Renderizar el componente de cliente GroupPermissionConfig con los datos necesarios.
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllGroupsAction } from "@/actions/db/user-group-actions"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import { getAllProfilesAction } from "@/actions/db/profiles-actions" // Para asignar miembros a grupos
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import GroupPermissionConfig from "./_components/group-permission-config"
import { SelectGroup, SelectOrganization, SelectProfile } from "@/db/schema"
import { getLogger } from "@/lib/logger"

const logger = getLogger("groups-page")

export default async function GroupSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  const [groupsRes, organizationsRes, profilesRes] = await Promise.all([
    getAllGroupsAction(),
    getAllOrganizationsAction(),
    getAllProfilesAction()
  ])

  if (!groupsRes.isSuccess) {
    logger.error(`Error loading groups: ${groupsRes.message}`)
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">Error al cargar grupos</h1>
        <p className="text-red-500">{groupsRes.message}</p>
      </div>
    )
  }

  if (!organizationsRes.isSuccess) {
    logger.error(`Error loading organizations: ${organizationsRes.message}`)
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar organizaciones
        </h1>
        <p className="text-red-500">{organizationsRes.message}</p>
      </div>
    )
  }

  if (!profilesRes.isSuccess) {
    logger.error(
      `Error loading profiles for group members: ${profilesRes.message}`
    )
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar perfiles para miembros de grupo
        </h1>
        <p className="text-red-500">{profilesRes.message}</p>
      </div>
    )
  }

  const groups: SelectGroup[] = groupsRes.data || []
  const organizations: SelectOrganization[] = organizationsRes.data || []
  const profiles: SelectProfile[] = profilesRes.data || []

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">
          Administración de Grupos y Permisos
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Grupos de Usuarios</CardTitle>
          {/* Aquí se podría añadir una descripción si fuera necesario */}
        </CardHeader>
        <CardContent>
          <GroupPermissionConfig
            initialGroups={groups}
            allOrganizations={organizations}
            allProfiles={profiles}
          />
        </CardContent>
      </Card>
    </div>
  )
}
