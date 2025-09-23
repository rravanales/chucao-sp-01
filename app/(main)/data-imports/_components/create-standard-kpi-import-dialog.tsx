/**
 * @file app/(main)/data-imports/_components/create-standard-kpi-import-dialog.tsx
 * @brief Componente de cliente para el diálogo de creación de nuevas importaciones estándar de KPI.
 * @description Este componente encapsula el botón para abrir el asistente de creación de una nueva
 * importación estándar (UC-201, UC-203). Utiliza el contexto de permisos para controlar si el usuario
 * actual tiene la capacidad de gestionar importaciones guardadas, mostrando el botón solo si es así.
 * Recibe las conexiones de importación disponibles para ser usadas en el wizard.
 */

"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { ListTodo } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import StandardKpiImportWizard from "./standard-kpi-import-wizard"
import { useRouter } from "next/navigation"
import { SelectImportConnection } from "@/db/schema"
import { usePermissions } from "@/context/permission-context"

interface CreateStandardKpiImportDialogProps {
  connections: SelectImportConnection[]
}

export default function CreateStandardKpiImportDialog({
  connections
}: CreateStandardKpiImportDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const { hasPermission } = usePermissions()

  // Verificar si el usuario tiene permiso para gestionar importaciones guardadas.
  const canManageSavedImports = hasPermission("import:manage_saved_imports")

  /**
   * @function handleSuccess
   * @description Callback que se ejecuta cuando una importación estándar se ha creado o actualizado exitosamente.
   * Cierra el diálogo y refresca la ruta para revalidar los datos.
   * @returns {void}
   */
  const handleSuccess = () => {
    setIsOpen(false)
    router.refresh()
  }

  if (!canManageSavedImports) {
    return null // No renderizar el botón si el usuario no tiene permisos.
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1">
          <ListTodo className="size-3.5" />
          <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
            Nueva Importación Estándar
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Crear Nueva Importación Estándar de KPI</DialogTitle>
          <DialogDescription>
            Configura una importación avanzada para tus KPIs, incluyendo mapeos
            y transformaciones.
          </DialogDescription>
        </DialogHeader>
        {/* Pasar las conexiones a StandardKpiImportWizard */}
        <StandardKpiImportWizard
          connections={connections}
          onSuccess={handleSuccess}
        />
      </DialogContent>
    </Dialog>
  )
}
