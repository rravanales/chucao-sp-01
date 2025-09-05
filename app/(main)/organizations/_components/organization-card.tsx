/**
 * @file app/(main)/organizations/_components/organization-card.tsx
 * @brief Componente de cliente para mostrar los detalles de una organización y permitir acciones de edición/eliminación.
 * @description Este componente interactivo recibe los datos de una organización y los presenta
 * en una tarjeta. Incluye funcionalidades para editar la organización a través de un modal
 * (`OrganizationForm`) y eliminarla con una confirmación (`AlertDialog`), utilizando
 * Server Actions para las operaciones de backend y `useToast` para feedback al usuario (UC-500).
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
import OrganizationForm from "./organization-form"
import { deleteOrganizationAction } from "@/actions/db/organization-actions"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"

interface OrganizationCardProps {
  organization: SelectOrganization
}

export default function OrganizationCard({
  organization
}: OrganizationCardProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  /**
   * @function handleDelete
   * @description Maneja la lógica de eliminación de una organización.
   * Invoca la Server Action `deleteOrganizationAction` y muestra notificaciones.
   * @param {string} organizationId - El ID de la organización a eliminar.
   * @returns {Promise<void>}
   */
  const handleDelete = async (organizationId: string) => {
    const result = await deleteOrganizationAction({ id: organizationId })
    if (result.isSuccess) {
      toast({
        title: "Organización eliminada",
        description: `La organización "${organization.name}" ha sido eliminada exitosamente.`
      })
      router.refresh() // Revalidar los datos en el servidor para actualizar la lista
    } else {
      toast({
        title: "Error al eliminar",
        description: result.message || "No se pudo eliminar la organización.",
        variant: "destructive"
      })
    }
  }

  return (
    <Card className="relative transition-shadow duration-200 hover:shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-xl">
          <Building2 className="text-muted-foreground size-5" />
          {organization.name}
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="size-8 p-0">
              <span className="sr-only">Abrir menú</span>
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
              <DialogTrigger asChild>
                <DropdownMenuItem
                  onSelect={e => e.preventDefault()} // Prevenir que el DropdownMenu se cierre
                >
                  <Edit className="mr-2 size-4" />
                  Editar
                </DropdownMenuItem>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Editar Organización</DialogTitle>
                  <DialogDescription>
                    Modifica los detalles de la organización.
                  </DialogDescription>
                </DialogHeader>
                <OrganizationForm
                  organization={organization}
                  onSuccess={() => setIsEditDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-red-600"
                  onSelect={e => e.preventDefault()} // Prevenir que el DropdownMenu se cierre
                >
                  <Trash2 className="mr-2 size-4" />
                  Eliminar
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    ¿Estás absolutamente seguro?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción no se puede deshacer. Esto eliminará
                    permanentemente la organización{" "}
                    <span className="font-semibold">{organization.name}</span> y
                    todos sus elementos del Scorecard, KPIs y datos asociados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => handleDelete(organization.id)}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">
          {organization.description || "Sin descripción."}
        </CardDescription>
        {/* Futura visualización de la jerarquía o KPIs resumen */}
      </CardContent>
    </Card>
  )
}
