/**
 * @file app/(main)/organizations/_components/organization-card.tsx
 * @brief Componente de cliente para mostrar una tarjeta de organización y sus sub-organizaciones.
 * @description Este componente muestra los detalles de una organización, incluyendo sus hijos
 * de forma recursiva. Permite la edición y eliminación de organizaciones, utilizando
 * Server Actions para las operaciones CRUD y shadcn/ui para la interfaz.
 * (UC-500: Gestionar Jerarquía de Organizaciones)
 * Incluye verificaciones de permisos para controlar la visibilidad de las acciones.
 */
"use client"

import React, { useState } from "react"
import { SelectOrganization } from "@/db/schema"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreVertical, Edit, Trash2, Building2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
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
import OrganizationForm from "./organization-form" // Assuming this is for editing
import { deleteOrganizationAction } from "@/actions/db/organization-actions"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/context/permission-context" // Import usePermissions

interface OrganizationCardProps {
  organization: SelectOrganization & { children?: SelectOrganization[] }
  level?: number // Para la indentación recursiva
}

const OrganizationCard: React.FC<OrganizationCardProps> = ({
  organization,
  level = 0
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const { hasPermission } = usePermissions() // Access hasPermission from context
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

  // Check if the current user can manage this specific organization (edit/delete)
  const canManageOrganization = hasPermission(
    "organization_management",
    organization.id
  )

  const handleDeleteOrganization = async () => {
    const result = await deleteOrganizationAction({ id: organization.id })
    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: "Organización eliminada correctamente."
      })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message || "Fallo al eliminar la organización.",
        variant: "destructive"
      })
    }
  }

  return (
    <Card
      className="mb-4"
      style={{ marginLeft: `${level * 20}px` }} // Indent based on level
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Building2 className="text-primary size-5" />
          <CardTitle className="text-xl font-bold">
            {organization.name}
          </CardTitle>
        </div>
        {canManageOrganization && ( // Only show dropdown if user has permission
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <span className="sr-only">Abrir menú</span>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <Dialog
                open={isEditDialogOpen}
                onOpenChange={setIsEditDialogOpen}
              >
                <DialogTrigger asChild>
                  <DropdownMenuItem onSelect={e => e.preventDefault()}>
                    <Edit className="mr-2 size-4" /> Editar
                  </DropdownMenuItem>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>Editar Organización</DialogTitle>
                    <DialogDescription>
                      Modifica los detalles de esta organización.
                    </DialogDescription>
                  </DialogHeader>
                  <OrganizationForm
                    organization={organization}
                    onSuccess={() => {
                      setIsEditDialogOpen(false) // Close dialog on success
                      router.refresh() // Revalidate data
                    }}
                  />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    onSelect={e => e.preventDefault()}
                    className="text-red-600"
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
                      Esta acción no se puede deshacer. Esto eliminará
                      permanentemente la organización y todos sus elementos
                      (Scorecards, KPIs, etc.).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteOrganization}
                      className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>
      <CardContent>
        {organization.description && (
          <CardDescription className="mb-4">
            {organization.description}
          </CardDescription>
        )}
        {organization.children && organization.children.length > 0 && (
          <div className="mt-4 border-l-2 pl-4">
            {organization.children.map(childOrg => (
              <OrganizationCard
                key={childOrg.id}
                organization={childOrg}
                level={level + 1}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default OrganizationCard
