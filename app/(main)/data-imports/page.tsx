/**
 * @file app/(main)/data-imports/page.tsx
 * @brief Página de administración de importaciones de datos para KPI.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario.
 *   - Obtener la lista de conexiones de importación existentes (UC-202).
 *   - Obtener la lista de importaciones de KPI guardadas (UC-201).
 *   - Mostrar una interfaz de pestañas para gestionar conexiones, realizar importaciones simples
 *     y configurar/ejecutar importaciones estándar.
 *   - Proveer botones y diálogos para la creación de nuevas conexiones e importaciones estándar.
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getImportConnectionsAction } from "@/actions/db/import-connections-actions"
import { getAllSavedKpiImportsAction } from "@/actions/db/import-actions"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions" // To get organizations for simple import form
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusCircle, Database, FileSpreadsheet, ListTodo } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import ImportConnectionManager from "./_components/import-connection-manager"
import SimpleKpiImportForm from "./_components/simple-kpi-import-form"
import StandardKpiImportWizard from "./_components/standard-kpi-import-wizard"
import {
  SelectImportConnection,
  SelectSavedImport,
  SelectOrganization
} from "@/db/schema"

export default async function DataImportsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // Fetch all necessary data using Server Actions
  const connectionsRes = await getImportConnectionsAction()
  const savedImportsRes = await getAllSavedKpiImportsAction()
  const organizationsRes = await getAllOrganizationsAction() // Required for the simple import form

  if (!connectionsRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar conexiones de importación
        </h1>
        <p className="text-red-500">{connectionsRes.message}</p>
      </div>
    )
  }

  if (!savedImportsRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar importaciones guardadas
        </h1>
        <p className="text-red-500">{savedImportsRes.message}</p>
      </div>
    )
  }

  if (!organizationsRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar organizaciones
        </h1>
        <p className="text-red-500">{organizationsRes.message}</p>
      </div>
    )
  }

  const importConnections: SelectImportConnection[] = connectionsRes.data || []
  const savedKpiImports: SelectSavedImport[] = savedImportsRes.data || []
  const organizations: SelectOrganization[] = organizationsRes.data || []

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">
          Gestión de Importaciones de Datos
        </h1>
      </div>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="connections">
            <Database className="mr-2 size-4" /> Conexiones
          </TabsTrigger>
          <TabsTrigger value="simple-import">
            <FileSpreadsheet className="mr-2 size-4" /> Importación Simple
          </TabsTrigger>
          <TabsTrigger value="standard-imports">
            <ListTodo className="mr-2 size-4" /> Importaciones Estándar
          </TabsTrigger>
        </TabsList>

        {/* Tab Content: Connections */}
        <TabsContent value="connections" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-2xl font-bold">
                Conexiones de Importación
              </CardTitle>
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <PlusCircle className="mr-2 size-4" /> Nueva Conexión
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>
                      Crear Nueva Conexión de Importación
                    </DialogTitle>
                    <DialogDescription>
                      Configura una nueva conexión a tu fuente de datos (ej.
                      base de datos, archivo).
                    </DialogDescription>
                  </DialogHeader>
                  {/* TODO: Implement ImportConnectionForm component */}
                  <p>Formulario para crear conexión (próximo componente)</p>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <ImportConnectionManager connections={importConnections} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Content: Simple Import */}
        <TabsContent value="simple-import" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">
                Importación Simple de KPI
              </CardTitle>
              <CardDescription>
                Carga rápidamente valores de KPI desde hojas de cálculo (Excel)
                en un formato compatible.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleKpiImportForm organizations={organizations} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Content: Standard Imports */}
        <TabsContent value="standard-imports" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-2xl font-bold">
                Importaciones Estándar de KPI
              </CardTitle>
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <PlusCircle className="mr-2 size-4" /> Nueva Importación
                    Estándar
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[800px]">
                  <DialogHeader>
                    <DialogTitle>
                      Crear Nueva Importación Estándar de KPI
                    </DialogTitle>
                    <DialogDescription>
                      Configura un proceso avanzado de importación con mapeos y
                      transformaciones.
                    </DialogDescription>
                  </DialogHeader>
                  <StandardKpiImportWizard
                    connections={importConnections}
                    savedImport={null} // For creating a new one
                  />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <StandardKpiImportWizard
                connections={importConnections}
                savedImports={savedKpiImports}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
