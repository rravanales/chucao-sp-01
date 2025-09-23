/**
 * @file app/(main)/data-imports/_components/create-import-connection-dialog.tsx
 * @brief Componente de cliente para el diálogo de creación de nuevas conexiones de importación.
 * @description Este componente encapsula el botón para abrir el diálogo de creación de una nueva
 * conexión de importación (UC-202). Utiliza el contexto de permisos para controlar si el usuario
 * actual tiene la capacidad de gestionar conexiones, mostrando el botón solo si es así.
 */

"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { PlusCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import ImportConnectionForm from "./import-connection-form" // Assuming import-connection-form is the correct name
import { useRouter } from "next/navigation"
import { usePermissions } from "@/context/permission-context"

export default function CreateImportConnectionDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const { hasPermission } = usePermissions()

  // Verificar si el usuario tiene permiso para gestionar conexiones de importación.
  const canManageConnections = hasPermission("import:manage_connections")

  /**
   * @function handleSuccess
   * @description Callback que se ejecuta cuando una conexión se ha creado o actualizado exitosamente.
   * Cierra el diálogo y refresca la ruta para revalidar los datos.
   * @returns {void}
   */
  const handleSuccess = () => {
    setIsOpen(false)
    router.refresh()
  }

  if (!canManageConnections) {
    return null // No renderizar el botón si el usuario no tiene permisos.
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1">
          <PlusCircle className="size-3.5" />
          <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
            Nueva Conexión
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Crear Nueva Conexión de Importación</DialogTitle>
          <DialogDescription>
            Configura una nueva conexión a una fuente de datos (base de datos o
            archivo) para tus importaciones de KPI.
          </DialogDescription>
        </DialogHeader>
        <ImportConnectionForm onSuccess={handleSuccess} />
      </DialogContent>
    </Dialog>
  )
}
