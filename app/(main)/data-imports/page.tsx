/**
 * @file app/(main)/data-imports/page.tsx
 * @brief Página de administración de importaciones de datos para KPI.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario.
 *   - Obtener la lista de conexiones de importación existentes (UC-202).
 *   - Obtener la lista de importaciones de KPI guardadas (UC-201).
 *   - Obtener la lista de organizaciones para el formulario de importación simple.
 *   - Mostrar una interfaz de pestañas para gestionar conexiones, realizar importaciones simples
 *     y configurar/ejecutar importaciones estándar.
 *   - Proveer botones y diálogos (como componentes cliente) para la creación de nuevas conexiones
 *     e importaciones estándar, manteniendo esta página como Server Component puro.
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getImportConnectionsAction } from "@/actions/db/import-connections-actions"
import { getAllSavedKpiImportsAction } from "@/actions/db/import-actions"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions" // Para el formulario de importación simple
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription
} from "@/components/ui/card"
import { Database, FileSpreadsheet, ListTodo } from "lucide-react"
import ImportConnectionManager from "./_components/import-connection-manager"
import SimpleKpiImportForm from "./_components/simple-kpi-import-form"
import StandardKpiImportWizard from "./_components/standard-kpi-import-wizard"
import {
  SelectImportConnection,
  SelectSavedImport,
  SelectOrganization
} from "@/db/schema"
import CreateImportConnectionDialog from "./_components/create-import-connection-dialog" // Componente cliente nuevo
import CreateStandardKpiImportDialog from "./_components/create-standard-kpi-import-dialog" // Componente cliente nuevo

export default async function DataImportsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // Fetch en paralelo (manteniendo luego el manejo de errores visible como en v1)
  const [connectionsRes, savedImportsRes, organizationsRes] = await Promise.all(
    [
      getImportConnectionsAction(),
      getAllSavedKpiImportsAction(),
      getAllOrganizationsAction()
    ]
  )

  // Manejo de errores conservador (no perder UX de v1)
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
        {/* CTAs globales como componentes cliente (manejan permisos e interactividad) */}
        <div className="flex gap-2">
          <CreateImportConnectionDialog />
          <CreateStandardKpiImportDialog connections={importConnections} />
        </div>
      </div>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="connections" className="flex items-center gap-2">
            <Database className="size-4" /> Conexiones
          </TabsTrigger>
          {/* Mantener compatibilidad del valor del tab de v1: "simple-import" */}
          <TabsTrigger
            value="simple-import"
            className="flex items-center gap-2"
          >
            <FileSpreadsheet className="size-4" /> Importación Simple
          </TabsTrigger>
          <TabsTrigger
            value="standard-imports"
            className="flex items-center gap-2"
          >
            <ListTodo className="size-4" /> Importaciones Estándar
          </TabsTrigger>
        </TabsList>

        {/* Conexiones */}
        <TabsContent value="connections" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">
                Conexiones de Importación
              </CardTitle>
              <CardDescription>
                Administra tus conexiones a bases de datos y archivos para
                importaciones de KPI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Mantener contrato de props de v1 */}
              <ImportConnectionManager connections={importConnections} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Importación Simple */}
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

        {/* Importaciones Estándar */}
        <TabsContent value="standard-imports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">
                Importaciones Estándar de KPI
              </CardTitle>
              <CardDescription>
                Configura importaciones avanzadas con mapeo de campos,
                transformaciones y programación desde bases de datos o Excel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Mostrar/gestionar importaciones guardadas. La creación se maneja con el componente cliente en el header */}
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
