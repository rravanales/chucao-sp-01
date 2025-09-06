/**
 * @file app/(main)/scorecards/page.tsx
 * @brief Página de administración de Scorecards y KPIs para listar y gestionar la estrategia organizacional.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario para asegurar el acceso.
 *   - Obtener una lista de todas las organizaciones para permitir la selección.
 *   - Obtener y mostrar la lista de elementos de Scorecard (Perspectivas, Objetivos, KPIs)
 *     para la organización seleccionada (o la primera por defecto), representando la jerarquía.
 *   - Proporcionar la funcionalidad para crear nuevos elementos de Scorecard a través de un diálogo.
 *   - Esta página es un punto central para la gestión del rendimiento estratégico (UC-100, UC-101).
 * @notes
 *   - La implementación actual muestra una lista plana de elementos y está preparada para una vista
 *     jerárquica más compleja en iteraciones futuras, que puede requerir componentes recursivos.
 *   - Se utiliza el primer ID de organización disponible como valor por defecto si existe.
 */
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import { getScorecardElementsAction } from "@/actions/db/scorecard-element-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusCircle, Pyramid, LayoutGrid } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import ScorecardElementEditor from "./_components/scorecard-element-editor"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  SelectOrganization,
  SelectScorecardElement,
  SelectKpi
} from "@/db/schema"
import { getKpiAction } from "@/actions/db/kpi-actions"
import KpiEditor from "./_components/kpi-editor"

interface ScorecardElementWithKpi extends SelectScorecardElement {
  kpi?: SelectKpi | null
}

export default async function ScorecardsPage() {
  const { userId } = await auth()

  // Redirigir si el usuario no está autenticado
  if (!userId) {
    redirect("/login")
  }

  // Obtener todas las organizaciones
  const organizationsResponse = await getAllOrganizationsAction()
  if (!organizationsResponse.isSuccess) {
    console.error(
      "Failed to fetch organizations:",
      organizationsResponse.message
    )
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-6 text-3xl font-bold">Gestión de Scorecards</h1>
        <p className="text-red-500">
          Error al cargar las organizaciones: {organizationsResponse.message}
        </p>
      </div>
    )
  }

  const organizations: SelectOrganization[] = organizationsResponse.data || []
  const defaultOrganization =
    organizations.length > 0 ? organizations[0] : undefined
  const defaultOrganizationId = defaultOrganization?.id

  let scorecardElements: ScorecardElementWithKpi[] = []

  if (defaultOrganizationId) {
    const elementsResponse = await getScorecardElementsAction(
      defaultOrganizationId
    )
    if (!elementsResponse.isSuccess) {
      console.error(
        "Failed to fetch scorecard elements:",
        elementsResponse.message
      )
    } else {
      scorecardElements = elementsResponse.data || []

      const elementsWithKpis: ScorecardElementWithKpi[] = await Promise.all(
        scorecardElements.map(async element => {
          if (element.elementType === "KPI") {
            const kpiResponse = await getKpiAction(element.id)
            if (kpiResponse.isSuccess) {
              return { ...element, kpi: kpiResponse.data }
            }
          }
          return element
        })
      )
      scorecardElements = elementsWithKpis
    }
  }

  return (
    <div className="container mx-auto py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Scorecards y KPIs</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 size-4" /> Nuevo Elemento de Scorecard
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Crear Nuevo Elemento de Scorecard</DialogTitle>
              <DialogDescription>
                Define un nuevo elemento como Perspectiva, Objetivo o KPI.
              </DialogDescription>
            </DialogHeader>
            <ScorecardElementEditor organizations={organizations} />
          </DialogContent>
        </Dialog>
      </div>

      <Separator className="my-6" />

      {organizations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No hay organizaciones configuradas.</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Por favor, crea una organización primero para poder gestionar
              Scorecards y KPIs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pyramid className="size-5" />
              Estructura de Scorecard para: {defaultOrganization?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scorecardElements.length === 0 ? (
              <p className="text-muted-foreground">
                No hay elementos de Scorecard definidos para esta organización.
              </p>
            ) : (
              <ScrollArea className="h-[500px] w-full rounded-md border p-4">
                <ul className="space-y-2">
                  {scorecardElements.map(element => (
                    <li
                      key={element.id}
                      className="flex items-center justify-between rounded-md border p-2 shadow-sm"
                    >
                      <div className="flex items-center space-x-2">
                        {element.elementType === "Perspective" && (
                          <LayoutGrid className="size-4 text-blue-500" />
                        )}
                        {element.elementType === "Objective" && (
                          <Pyramid className="size-4 text-green-500" />
                        )}
                        {element.elementType === "Initiative" && (
                          <PlusCircle className="size-4 text-purple-500" />
                        )}
                        {element.elementType === "KPI" && (
                          <LayoutGrid className="size-4 text-red-500" />
                        )}
                        <span>
                          {element.name} ({element.elementType})
                        </span>
                      </div>
                      <div className="flex space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              Editar
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                            <DialogHeader>
                              <DialogTitle>
                                Editar Elemento de Scorecard
                              </DialogTitle>
                              <DialogDescription>
                                Modifica los detalles de este elemento.
                              </DialogDescription>
                            </DialogHeader>
                            <ScorecardElementEditor
                              organizations={organizations}
                              scorecardElement={element}
                            />
                          </DialogContent>
                        </Dialog>
                        {element.elementType === "KPI" && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                Configurar KPI
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                              <DialogHeader>
                                <DialogTitle>
                                  Configurar KPI: {element.name}
                                </DialogTitle>
                                <DialogDescription>
                                  Establece las características específicas del
                                  KPI.
                                </DialogDescription>
                              </DialogHeader>
                              <KpiEditor
                                scorecardElementId={element.id}
                                kpi={element.kpi || undefined}
                              />
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
