/**
 * @file app/(main)/settings/groups/page.tsx
 * @brief Página de administración de grupos (refactor corregido).
 * @description
 *  - Mantiene la funcionalidad de v1 (usa GroupPermissionConfig con los datos completos).
 *  - Integra la mejora de v2: gating por permisos para “Nuevo Grupo”, “Editar” y “Eliminar”.
 *  - Corrige los problemas detectados en la v2 previa:
 *      * No usa hooks de cliente en el Server Component.
 *      * Importa correctamente acciones y logger.
 *      * Evita cambiar contratos existentes (sigue pasando props de v1).
 *      * Usa Server Actions en formularios para eliminar (sin toasts/routers del cliente).
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { getLogger } from "@/lib/logger"

import {
  getAllGroupsAction,
  deleteGroupAction, // para eliminar grupos via Server Action
  getUserPermissionsAction // v2: devuelve UserPermissionsMap (según los comentarios del dev)
} from "@/actions/db/user-group-actions"

import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import { getAllProfilesAction } from "@/actions/db/profiles-actions"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"

import { PlusCircle, MoreVertical, Edit, Trash2, Key } from "lucide-react"

// Mantener compatibilidad con helpers de permisos (v2: createHasPermission; v1: makeHasPermission)
import * as Perm from "@/types/permissions-types"

import GroupPermissionConfig from "./_components/group-permission-config"
// Opcional: si tienes un formulario de grupos, se puede usar en los diálogos de Crear/Editar.
// Si no existe, puedes comentar estas dos líneas y los <Dialog> seguirán mostrando la UI de permisos de abajo.
//import GroupForm from "./_components/group-form"

import { SelectGroup, SelectOrganization, SelectProfile } from "@/db/schema"

const logger = getLogger("groups-page")

// Server Action para eliminar (sin hooks de cliente)
async function deleteGroupServerAction(formData: FormData) {
  "use server"
  const id = String(formData.get("id") || "")
  if (!id) return
  await deleteGroupAction({ id })
  revalidatePath("/app/(main)/settings/groups") // ajusta la ruta si corresponde
}

export default async function GroupSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // Cargar datos necesarios (como en v1) + permisos (v2)
  const [groupsRes, organizationsRes, profilesRes, permissionsRes] =
    await Promise.all([
      getAllGroupsAction(),
      getAllOrganizationsAction(),
      getAllProfilesAction(),
      getUserPermissionsAction().catch(
        () =>
          ({
            isSuccess: false,
            data: {},
            message: "No permissions"
          }) as const
      )
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

  // ---- Gating por permisos (mejora v2) ----
  const permissionsMap = permissionsRes?.isSuccess
    ? permissionsRes.data || {}
    : {}

  // Soporta v2 (createHasPermission) o v1 (makeHasPermission)

  const hasFactory: any =
    (Perm as any).createHasPermission ?? (Perm as any).makeHasPermission
  const hasPermission =
    typeof hasFactory === "function" ? hasFactory(permissionsMap) : () => false

  const canManageGroups = hasPermission("group:manage", "global")
  const canAssignPermissions = hasPermission(
    "group:assign_permissions",
    "global"
  )

  return (
    <div className="container mx-auto py-12">
      {/* Encabezado con botón "Nuevo Grupo" (gating por permisos) */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Administración de Grupos</h1>

        {/* Si tienes GroupForm, abrimos un diálogo; si no, puedes enlazar a una ruta /settings/groups/new */}
        <Dialog>
          <DialogTrigger asChild>
            <Button disabled={!canManageGroups}>
              <PlusCircle className="mr-2 size-4" /> Nuevo Grupo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Crear Nuevo Grupo</DialogTitle>
              <DialogDescription>
                Define un nuevo grupo de usuarios y su tipo.
              </DialogDescription>
            </DialogHeader>
            {/* Si no tienes este componente, comenta esta línea y reemplaza por tu UI */}
            {/* <GroupForm /> */}
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabla resumida de grupos con Editar / Gestionar Permisos / Eliminar (gating) */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Grupos de Usuarios</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No hay grupos configurados. Haz clic en “Nuevo Grupo” para
              empezar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(group => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{group.groupType}</Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(group.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="size-8 p-0">
                            <span className="sr-only">Abrir menú</span>
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Editar (opcional, si existe GroupForm) */}
                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                                disabled={!canManageGroups}
                              >
                                <Edit className="mr-2 size-4" /> Editar
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[480px]">
                              <DialogHeader>
                                <DialogTitle>Editar Grupo</DialogTitle>
                                <DialogDescription>
                                  Modifica el nombre o tipo de este grupo.
                                </DialogDescription>
                              </DialogHeader>
                              {/* Si no existe GroupForm, comenta la línea y usa tu UI */}
                              {/* <GroupForm initialData={group} /> */}
                            </DialogContent>
                          </Dialog>

                          {/* Gestionar Permisos (usa GroupPermissionConfig focalizado si tu componente lo soporta) */}
                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                                disabled={!canAssignPermissions}
                              >
                                <Key className="mr-2 size-4" /> Gestionar
                                Permisos
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[900px]">
                              <DialogHeader>
                                <DialogTitle>
                                  Permisos del Grupo: {group.name}
                                </DialogTitle>
                                <DialogDescription>
                                  Define qué acciones pueden realizar los
                                  miembros de este grupo.
                                </DialogDescription>
                              </DialogHeader>
                              {/* Si tu GroupPermissionConfig soporta prop groupId, úsala; si no, muestra el panel global (v1). */}
                              {/* @ts-expect-error: prop opcional según la versión de tu componente */}
                              <GroupPermissionConfig groupId={group.id} />
                            </DialogContent>
                          </Dialog>

                          {/* Eliminar (Server Action vía <form>) */}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                                className="text-red-600"
                                disabled={!canManageGroups}
                              >
                                <Trash2 className="mr-2 size-4" /> Eliminar
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  ¿Estás absolutamente seguro?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acción no se puede deshacer. Se eliminará
                                  permanentemente el grupo
                                  <strong> {group.name}</strong> y sus
                                  relaciones.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <form action={deleteGroupServerAction}>
                                  <input
                                    type="hidden"
                                    name="id"
                                    value={group.id}
                                  />
                                  <AlertDialogAction
                                    type="submit"
                                    className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                                  >
                                    Eliminar
                                  </AlertDialogAction>
                                </form>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Sección completa de configuración (v1) mantenida para no perder funcionalidades */}
      <Card>
        <CardHeader>
          <CardTitle>Configuración Completa de Permisos y Miembros</CardTitle>
        </CardHeader>
        <CardContent>
          <GroupPermissionConfig
            initialGroups={groups}
            allOrganizations={organizations}
            allProfiles={profiles}
            /**
             * Si tu componente soporta flags de permisos (versión actualizada),
             * puedes habilitar el gating dentro del propio configurador:
             */
            // @ts-expect-error prop opcional según versión del componente
            permissionFlags={{
              canManageGroups,
              canAssignPermissions,
              canAssignMembers: hasPermission("group:assign_members", "global")
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
