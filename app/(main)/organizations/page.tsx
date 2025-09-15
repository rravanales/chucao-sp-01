/**
 * @file app/(main)/organizations/page2.tsx
 * @brief Página de administración de organizaciones para listar, crear, editar y eliminar organizaciones.
 * @description Este Server Component se encarga de:
 *  - Autenticar al usuario.
 *  - Obtener la lista de organizaciones de nivel superior desde la base de datos.
 *  - Mostrar un listado de OrganizationCard para cada organización.
 *  - Proveer un botón para abrir un modal de creación de nueva organización (OrganizationForm).
 *  - Manejar la visualización inicial de la jerarquía organizacional.
 *  - Controlar la visibilidad de las acciones según los permisos del usuario (UC-500).
 * Esta página es un punto central para la gestión de la estructura de la empresa dentro de DeltaOne (UC-500).
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusCircle, Building } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import OrganizationForm from "./_components/organization-form"
import OrganizationCard from "./_components/organization-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { getUserPermissionsAction } from "@/actions/db/user-group-actions"

// -----------------------------
// Utilidades locales (lado servidor) para permisos
// -----------------------------

type RawPermission = {
  createdAt: Date
  updatedAt: Date
  groupId: string
  permissionKey: string
  permissionValue: boolean
  organizationId: string | null
}

const GLOBAL_SCOPE = "global" as const

type UserPermissionsMap = Record<string, Record<string, boolean>>

function normalizePermissions(rows: RawPermission[]): UserPermissionsMap {
  const map: UserPermissionsMap = {}
  for (const p of rows) {
    const scope = p.organizationId ?? GLOBAL_SCOPE
    if (!map[p.permissionKey]) map[p.permissionKey] = {}
    map[p.permissionKey][scope] = p.permissionValue
  }
  return map
}

function buildHasPermission(userMap: UserPermissionsMap) {
  return (
    permissionKey: string,
    organizationId: string | null = null
  ): boolean => {
    const byScope = userMap[permissionKey]
    if (!byScope) return false
    const scopeKey = organizationId ?? GLOBAL_SCOPE
    if (Object.prototype.hasOwnProperty.call(byScope, scopeKey)) {
      return byScope[scopeKey]
    }
    if (Object.prototype.hasOwnProperty.call(byScope, GLOBAL_SCOPE)) {
      return byScope[GLOBAL_SCOPE]
    }
    return false
  }
}

export default async function OrganizationsPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  // Mantener el comportamiento de v1: solo organizaciones de nivel superior (parentId: null)
  // y obtener permisos del usuario en paralelo.
  const [organizationsRes, permissionsRes] = await Promise.all([
    getAllOrganizationsAction({ parentId: null }),
    // La acción actual no recibe argumentos (evita el error TS2554)
    getUserPermissionsAction()
  ])

  if (!organizationsRes.isSuccess) {
    console.error("Failed to fetch organizations:", organizationsRes.message)
    return (
      <div className="container mx-auto py-12">
        <h1 className="text-3xl font-bold">Gestión de Organizaciones</h1>
        <p className="text-destructive mt-4">
          Error al cargar las organizaciones: {organizationsRes.message}
        </p>
      </div>
    )
  }

  if (!permissionsRes.isSuccess) {
    console.error("Failed to fetch user permissions:", permissionsRes.message)
    // Política conservadora: sin permisos, no mostramos acciones restringidas.
  }

  const organizations = organizationsRes.data || []

  // Normalizar permisos devueltos por la acción actual
  const normalized = permissionsRes.isSuccess
    ? normalizePermissions(permissionsRes.data as RawPermission[])
    : ({} as UserPermissionsMap)

  const hasPermission = buildHasPermission(normalized)
  const canCreateOrganization = hasPermission("organization_management")

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Organizaciones</h1>
        {canCreateOrganization && (
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 size-4" /> Nueva Organización
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Crear Nueva Organización</DialogTitle>
                <DialogDescription>
                  Define una nueva entidad dentro de tu estructura
                  organizacional.
                </DialogDescription>
              </DialogHeader>
              <OrganizationForm />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Separator className="mb-8" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="size-5" /> Estructura Organizacional
          </CardTitle>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No hay organizaciones configuradas.{" "}
              {canCreateOrganization
                ? 'Haz clic en "Nueva Organización" para empezar.'
                : "Contacta a un administrador para configurar la estructura."}
            </p>
          ) : (
            <ScrollArea className="h-[calc(100vh-250px)] pr-4">
              <div className="space-y-4">
                {organizations.map(org => (
                  <OrganizationCard key={org.id} organization={org} />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
