/**
 * @file app/(main)/scorecards/page2.tsx
 * @brief Página de administración de Scorecards y KPIs para listar y gestionar la estrategia organizacional.
 * @description Server Component que:
 *   - Autentica al usuario.
 *   - Obtiene organizaciones y selecciona la primera por defecto.
 *   - Lista elementos de Scorecard y, si son KPI, adjunta sus detalles.
 *   - Permite crear/editar elementos y configurar KPIs mediante diálogos.
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import { getScorecardElementsAction } from "@/actions/db/scorecard-element-actions"
import { getKpiAction } from "@/actions/db/kpi-actions"

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
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"

import ScorecardElementEditor from "./_components/scorecard-element-editor"
import KpiEditor from "./_components/kpi-editor"
import {
  SelectOrganization,
  SelectScorecardElement,
  SelectKpi
} from "@/db/schema"

interface ScorecardElementWithKpi extends SelectScorecardElement {
  kpi?: SelectKpi | null
}

export default async function ScorecardsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // 1) Organizaciones
  const organizationsRes = await getAllOrganizationsAction()
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

  const organizations: SelectOrganization[] = organizationsRes.data || []
  const selectedOrganizationId = organizations[0]?.id // ✅ tomar la primera por defecto

  // 2) Elementos de Scorecard
  let scorecardElements: ScorecardElementWithKpi[] = []
  if (selectedOrganizationId) {
    const elementsRes = await getScorecardElementsAction(selectedOrganizationId)
    if (elementsRes.isSuccess && elementsRes.data) {
      const baseElements = elementsRes.data as SelectScorecardElement[]

      // 3) Adjuntar KPI si aplica (evitar await dentro de map render)
      scorecardElements = await Promise.all(
        baseElements.map(async el => {
          if (el.elementType === "KPI") {
            const kpiRes = await getKpiAction(el.id)
            return { ...el, kpi: kpiRes.isSuccess ? kpiRes.data : null }
          }
          return el
        })
      )
    }
  }

  return (
    <div className="container mx-auto py-12">
      {/* Header + Crear elemento */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Scorecards y KPIs</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 size-4" />
              Crear Elemento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Crear Nuevo Elemento de Scorecard</DialogTitle>
              <DialogDescription>
                Define un nuevo elemento (Perspectiva, Objetivo, Iniciativa o
                KPI).
              </DialogDescription>
            </DialogHeader>
            {organizations.length > 0 ? (
              // ✅ ScorecardElementEditor espera `organizations` (no `organizationId`)
              <ScorecardElementEditor organizations={organizations} />
            ) : (
              <p className="text-red-500">
                Debe existir al menos una organización para crear elementos de
                Scorecard.
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Tarjeta principal */}
      <Card>
        <CardHeader>
          <CardTitle>
            Elementos de Scorecard{" "}
            {selectedOrganizationId
              ? `(${organizations.find(o => o.id === selectedOrganizationId)?.name ?? "—"})`
              : "(Ninguna organización seleccionada)"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 && (
            <p className="text-muted-foreground">
              No hay organizaciones configuradas. Crea una primero para empezar.
            </p>
          )}

          {selectedOrganizationId && scorecardElements.length === 0 && (
            <p className="text-muted-foreground">
              Esta organización no tiene elementos de Scorecard. ¡Crea uno!
            </p>
          )}

          {selectedOrganizationId && scorecardElements.length > 0 && (
            <ScrollArea className="h-[500px] w-full rounded-md border p-4">
              <ul className="space-y-3">
                {scorecardElements.map(element => (
                  <li
                    key={element.id}
                    className="rounded-md border p-4 shadow-sm"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* Icono por tipo */}
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
                        <h3 className="text-lg font-semibold">
                          {element.name} ({element.elementType})
                        </h3>
                      </div>

                      {/* Botón Configurar / Editar */}
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            Configurar
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                          <DialogHeader>
                            <DialogTitle>
                              {element.elementType === "KPI"
                                ? `Configurar KPI: ${element.name}`
                                : `Editar Elemento: ${element.name}`}
                            </DialogTitle>
                            <DialogDescription>
                              {element.elementType === "KPI"
                                ? "Establece las características específicas del KPI."
                                : "Modifica los detalles de este elemento de Scorecard."}
                            </DialogDescription>
                          </DialogHeader>

                          {element.elementType === "KPI" ? (
                            // ✅ KpiEditor NO recibe organizationId ni onSuccess
                            <KpiEditor
                              scorecardElementId={element.id}
                              organizationId={selectedOrganizationId}
                              kpi={element.kpi || undefined}
                            />
                          ) : (
                            // ✅ ScorecardElementEditor espera `organizations` y puede recibir `scorecardElement`
                            <ScorecardElementEditor
                              organizations={organizations}
                              scorecardElement={element}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>

                    <p className="text-muted-foreground text-sm">
                      {element.description || "Sin descripción."}
                    </p>

                    {/* Si es KPI, podríamos mostrar un mini resumen */}
                    {element.elementType === "KPI" && element.kpi && (
                      <>
                        <Separator className="my-3" />
                        <div className="text-muted-foreground text-sm">
                          <span className="font-medium">Tipo de dato:</span>{" "}
                          {element.kpi.dataType} ·{" "}
                          <span className="font-medium">Frecuencia:</span>{" "}
                          {element.kpi.calendarFrequency} ·{" "}
                          <span className="font-medium">Rollup:</span>{" "}
                          {element.kpi.rollupEnabled
                            ? "Habilitado"
                            : "Deshabilitado"}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
