/**
 * @file app/(main)/organizations/page.tsx
 * @brief Página de administración de organizaciones para listar, crear, editar y eliminar organizaciones.
 * @description Este Server Component se encarga de:
 * - Autenticar al usuario.
 * - Obtener la lista de organizaciones de nivel superior desde la base de datos.
 * - Mostrar un listado de `OrganizationCard` para cada organización.
 * - Proveer un botón para abrir un modal de creación de nueva organización (`OrganizationForm`).
 * - Manejar la visualización inicial de la jerarquía organizacional.
 * Esta página es un punto central para la gestión de la estructura de la empresa dentro de DeltaOne (UC-500).
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import {
  getAllOrganizationsAction,
  deleteOrganizationAction
} from "@/actions/db/organization-actions"
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

export default async function OrganizationsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login") // Redirigir a login si no hay usuario autenticado
  }

  // Obtener solo las organizaciones de nivel superior para la vista inicial
  // La jerarquía completa se manejará visualmente en los componentes hijos o con una UI de árbol más compleja
  const organizationsRes = await getAllOrganizationsAction({ parentId: null })

  if (!organizationsRes.isSuccess) {
    return (
      <div className="container mx-auto py-8">
        <h1 className="mb-6 text-3xl font-bold">Organizaciones</h1>
        <p className="text-destructive">
          Error al cargar las organizaciones: {organizationsRes.message}
        </p>
      </div>
    )
  }

  const organizations = organizationsRes.data

  return (
    <ScrollArea className="h-full">
      <div className="container mx-auto space-y-8 py-8">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Building className="size-7" /> Organizaciones
          </h1>
          <Dialog>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <PlusCircle className="size-4" /> Crear Nueva Organización
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Crear Nueva Organización</DialogTitle>
                <DialogDescription>
                  Define una nueva entidad dentro de la estructura de tu
                  empresa.
                </DialogDescription>
              </DialogHeader>
              <OrganizationForm />
            </DialogContent>
          </Dialog>
        </div>

        <Separator />

        {organizations.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center">
            No hay organizaciones configuradas aún. ¡Crea la primera para
            empezar!
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {organizations.map(org => (
              <OrganizationCard key={org.id} organization={org} />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
