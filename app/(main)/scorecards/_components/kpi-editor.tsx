/**
 * @file app/(main)/scorecards/_components/kpi-editor2.tsx
 * @brief Componente de cliente para la creación o edición de Indicadores Clave de Rendimiento (KPIs).
 * @description Form de configuración de KPI con pestañas para:
 * - Configuración general
 * - Valores manuales (si el KPI es manual)
 * - Propietarios del elemento y Updaters del KPI
 */
"use client"

import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  createKpiAction,
  updateKpiConfigurationAction,
  setKpiCalculationEquationAction,
  enableKpiRollupAction,
  assignKpiUpdatersAction,
  getKpiAction // ✅ usaremos esto para reconsultar y listar updaters
} from "@/actions/db/kpi-actions"
import {
  updateScorecardElementAction // ✅ para asignar propietario
} from "@/actions/db/scorecard-element-actions"
import { getAllProfilesAction } from "@/actions/db/profiles-actions"
import {
  SelectKpi,
  kpiScoringTypeEnum,
  kpiCalendarFrequencyEnum,
  kpiDataTypeEnum,
  kpiAggregationTypeEnum,
  InsertKpi,
  SelectProfile,
  SelectKpiUpdater
} from "@/db/schema"
import { ActionState } from "@/types"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Save, Users, CalendarDays, Settings } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import KpiManualUpdateForm from "./kpi-manual-update-form"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator" // ✅ faltaba importar

/**
 * Validación del formulario
 */
const formSchema = z
  .object({
    scorecardElementId: z
      .string()
      .uuid("ID de elemento de Scorecard inválido."),
    scoringType: z.enum(kpiScoringTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de puntuación de KPI inválido." })
    }),
    calendarFrequency: z.enum(kpiCalendarFrequencyEnum.enumValues, {
      errorMap: () => ({ message: "Frecuencia de calendario de KPI inválida." })
    }),
    dataType: z.enum(kpiDataTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de dato de KPI inválido." })
    }),
    aggregationType: z.enum(kpiAggregationTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de agregación de KPI inválido." })
    }),
    decimalPrecision: z.coerce
      .number()
      .int("La precisión decimal debe ser un número entero.")
      .min(0, "La precisión decimal no puede ser negativa.")
      .max(20, "La precisión decimal no puede exceder 20.")
      .default(0),
    isManualUpdate: z.boolean().default(false),
    calculationEquation: z
      .string()
      .max(1000, "La ecuación no puede exceder los 1000 caracteres.")
      .nullable()
      .optional(),
    rollupEnabled: z.boolean().default(false)
  })
  .refine(
    data => {
      if (data.rollupEnabled) {
        return (
          data.calculationEquation === null && data.isManualUpdate === false
        )
      }
      return true
    },
    {
      message:
        "Si el rollup está habilitado, la ecuación de cálculo debe estar vacía y no debe ser de actualización manual.",
      path: ["rollupEnabled", "calculationEquation", "isManualUpdate"]
    }
  )
  .refine(
    data => {
      // Exclusión mutua entre manual, ecuación y rollup
      const isManual = data.isManualUpdate
      const hasEq = !!data.calculationEquation
      const isRollup = data.rollupEnabled
      const selectedCount = [isManual, hasEq, isRollup].filter(Boolean).length
      return selectedCount === 1
    },
    {
      message:
        "Un KPI debe ser manual, tener una ecuación de cálculo, o tener el rollup habilitado (excluyentes).",
      path: ["isManualUpdate", "calculationEquation", "rollupEnabled"]
    }
  )
  .refine(
    data => {
      const numericDataTypes = new Set(["Number", "Percentage", "Currency"])
      if (
        data.scoringType === "Goal/Red Flag" &&
        !numericDataTypes.has(data.dataType)
      ) {
        return false
      }
      if (data.scoringType === "Yes/No" && data.dataType !== "Number") {
        return false
      }
      if (data.scoringType === "Text" && data.dataType !== "Text") {
        return false
      }
      return true
    },
    {
      message:
        "Inconsistencia entre el tipo de puntuación y el tipo de dato del KPI.",
      path: ["scoringType", "dataType"]
    }
  )

interface KpiEditorProps {
  scorecardElementId: string
  organizationId: string
  kpi?: SelectKpi
  onSuccess?: () => void
}

export default function KpiEditor({
  scorecardElementId,
  organizationId, // (guardado para futuras extensiones/filtrado)
  kpi,
  onSuccess
}: KpiEditorProps) {
  const isEditMode = !!kpi
  const { toast } = useToast()
  const router = useRouter()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allUsers, setAllUsers] = useState<SelectProfile[]>([])
  const [kpiUpdaters, setKpiUpdaters] = useState<SelectKpiUpdater[]>([])
  const [ownerUserId, setOwnerUserId] = useState<string | "null">("null")

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      scorecardElementId,
      // ❗️ANTES estabas poniendo el ARRAY entero de enumValues → ahora tomamos el primer valor
      scoringType: kpi?.scoringType ?? kpiScoringTypeEnum.enumValues[0],
      calendarFrequency:
        kpi?.calendarFrequency ?? kpiCalendarFrequencyEnum.enumValues[0],
      dataType: kpi?.dataType ?? kpiDataTypeEnum.enumValues[0],
      aggregationType:
        kpi?.aggregationType ?? kpiAggregationTypeEnum.enumValues[0],
      decimalPrecision: kpi?.decimalPrecision ?? 0,
      isManualUpdate: kpi?.isManualUpdate ?? false,
      calculationEquation: kpi?.calculationEquation ?? null,
      rollupEnabled: kpi?.rollupEnabled ?? false
    }
  })

  const currentIsManualUpdate = form.watch("isManualUpdate")
  const currentCalculationEquation = form.watch("calculationEquation")
  const currentRollupEnabled = form.watch("rollupEnabled")

  // Usuarios para propietarios/updaters
  useEffect(() => {
    ;(async () => {
      const res = await getAllProfilesAction()
      if (res.isSuccess && res.data) {
        setAllUsers(res.data)
      } else {
        toast({
          title: "Error",
          description: "Fallo al cargar la lista de usuarios.",
          variant: "destructive"
        })
      }
    })()
  }, [toast])

  // Si estoy editando, cargo updaters y owner a partir del KPI (con getKpiAction)
  useEffect(() => {
    ;(async () => {
      if (!kpi?.id) return
      const res = await getKpiAction(kpi.id)
      if (res.isSuccess && res.data) {
        // Intenta leer updaters si vienen en la relación
        const updaters = (res.data as any)?.updaters ?? []
        setKpiUpdaters(updaters)

        // Si tienes forma de inferir el owner del elemento desde el KPI (según tu modelo),
        // ajusta esta línea. Por ahora queda en "null" a menos que ya lo tengas en props.
        const ownerIdFromModel =
          (res.data as any)?.scorecardElementOwnerUserId ?? null
        setOwnerUserId(ownerIdFromModel ?? "null")
      }
    })()
  }, [kpi?.id])

  /**
   * Submit de configuración del KPI
   */
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    let result: ActionState<SelectKpi>

    if (isEditMode && kpi?.id) {
      const { scorecardElementId: _ignore, ...updatePayload } = values
      result = await updateKpiConfigurationAction(kpi.id, updatePayload)

      if (result.isSuccess) {
        // persistir ecuación si cambió
        if (
          updatePayload.calculationEquation !== undefined &&
          updatePayload.calculationEquation !== kpi.calculationEquation
        ) {
          await setKpiCalculationEquationAction({
            kpiId: kpi.id,
            calculationEquation: updatePayload.calculationEquation
          })
        }
        // persistir rollup si cambió
        if (
          updatePayload.rollupEnabled !== undefined &&
          updatePayload.rollupEnabled !== kpi.rollupEnabled
        ) {
          await enableKpiRollupAction({
            kpiId: kpi.id,
            rollupEnabled: updatePayload.rollupEnabled
          })
        }
      }
    } else {
      const createPayload: InsertKpi = {
        scorecardElementId: values.scorecardElementId,
        scoringType: values.scoringType,
        calendarFrequency: values.calendarFrequency,
        dataType: values.dataType,
        aggregationType: values.aggregationType,
        decimalPrecision: values.decimalPrecision,
        isManualUpdate: values.isManualUpdate,
        calculationEquation: values.calculationEquation,
        rollupEnabled: values.rollupEnabled,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      result = await createKpiAction(createPayload)
    }

    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: `KPI ${isEditMode ? "actualizado" : "creado"} correctamente.`
      })
      router.refresh()
      onSuccess?.()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
    setIsSubmitting(false)
  }

  /**
   * Asignación de propietario al elemento del Scorecard
   */
  const handleAssignOwner = async (selected: string) => {
    const value: string | null = selected === "null" ? null : selected
    setOwnerUserId(selected)

    setIsSubmitting(true)
    const res = await updateScorecardElementAction(scorecardElementId, {
      ownerUserId: value
    })
    if (res.isSuccess) {
      toast({
        title: "Éxito",
        description: "Propietario asignado correctamente."
      })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: res.message,
        variant: "destructive"
      })
    }
    setIsSubmitting(false)
  }

  /**
   * Asignación/remoción de Updater
   * (La action no acepta `isAssigned`, así que solo enviamos el payload esperado)
   */
  const handleAssignUpdater = async (
    userId: string,
    checked: boolean | "indeterminate"
  ) => {
    if (!kpi?.id) {
      toast({
        title: "Error",
        description: "ID de KPI no disponible.",
        variant: "destructive"
      })
      return
    }
    setIsSubmitting(true)

    // Llama a la action de asignar. Si tu backend necesita una acción separada para eliminar,
    // implementa/remove y úsala cuando checked === false.
    const result = await assignKpiUpdatersAction({
      kpiId: kpi.id,
      userId,
      canModifyThresholds: false
    })

    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: `Updater ${checked ? "asignado" : "actualizado"} correctamente.`
      })
      // re-consulta KPI para refrescar lista de updaters
      const updated = await getKpiAction(kpi.id)
      if (updated.isSuccess) {
        setKpiUpdaters(
          ((updated.data as any)?.updaters ?? []) as SelectKpiUpdater[]
        )
      }
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
    setIsSubmitting(false)
  }

  return (
    <Tabs defaultValue="settings" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="settings">
          <Settings className="mr-2 size-4" /> Configuración
        </TabsTrigger>
        {isEditMode && currentIsManualUpdate && (
          <TabsTrigger value="manual-values">
            <CalendarDays className="mr-2 size-4" /> Valores Manuales
          </TabsTrigger>
        )}
        {isEditMode && (
          <TabsTrigger value="ownership">
            <Users className="mr-2 size-4" /> Propietarios y Updaters
          </TabsTrigger>
        )}
      </TabsList>

      {/* SETTINGS */}
      <TabsContent value="settings" className="mt-4">
        <div className="space-y-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4 p-4"
            >
              {!isEditMode && (
                <FormField
                  control={form.control}
                  name="scorecardElementId"
                  render={({ field }) => (
                    <FormItem className="hidden">
                      <FormLabel>ID de Elemento de Scorecard</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="scoringType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Puntuación</FormLabel>
                    <UiSelect
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el tipo de puntuación" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kpiScoringTypeEnum.enumValues.map(type => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </UiSelect>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="calendarFrequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frecuencia del Calendario</FormLabel>
                    <UiSelect
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona la frecuencia" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kpiCalendarFrequencyEnum.enumValues.map(freq => (
                          <SelectItem key={freq} value={freq}>
                            {freq}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </UiSelect>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dataType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Dato</FormLabel>
                    <UiSelect
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el tipo de dato" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kpiDataTypeEnum.enumValues.map(type => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </UiSelect>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="aggregationType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Agregación</FormLabel>
                    <UiSelect
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el tipo de agregación" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {kpiAggregationTypeEnum.enumValues.map(type => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </UiSelect>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="decimalPrecision"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Precisión Decimal</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        max="20"
                        step="1"
                        placeholder="Ej. 2"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      Número de decimales a mostrar.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isManualUpdate"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={
                          isSubmitting ||
                          currentCalculationEquation !== null ||
                          currentRollupEnabled
                        }
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Actualización Manual</FormLabel>
                      <FormDescription>
                        Permite a los usuarios ingresar valores de KPI
                        directamente (excluye KPI calculado o rollup).
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="calculationEquation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ecuación de Cálculo (Opcional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ej. ([KPI:ventas_netas] / [KPI:unidades_vendidas]) * 100"
                        {...field}
                        value={field.value ?? ""}
                        disabled={
                          isSubmitting ||
                          currentIsManualUpdate ||
                          currentRollupEnabled
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Define una ecuación para calcular el valor del KPI
                      automáticamente (excluye KPI manual o rollup).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rollupEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={
                          isSubmitting ||
                          currentIsManualUpdate ||
                          currentCalculationEquation !== null
                        }
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Habilitar Rollup</FormLabel>
                      <FormDescription>
                        Agrega automáticamente valores de KPIs de organizaciones
                        hijas (excluye KPI manual o calculado).
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                {isEditMode ? "Guardar Cambios" : "Crear KPI"}
              </Button>
            </form>
          </Form>
        </div>
      </TabsContent>

      {/* VALORES MANUALES */}
      {isEditMode && currentIsManualUpdate && (
        <TabsContent value="manual-values" className="mt-4">
          <div className="space-y-4 rounded-md border p-4">
            <h3 className="text-lg font-semibold">
              Actualización Manual de Valores
            </h3>
            {kpi && (
              <KpiManualUpdateForm
                kpiId={kpi.id}
                kpiConfig={kpi}
                onSuccess={() => router.refresh()}
              />
            )}
          </div>
        </TabsContent>
      )}

      {/* PROPIETARIO Y UPDATERS */}
      {isEditMode && (
        <TabsContent value="ownership" className="mt-4">
          <div className="space-y-6 rounded-md border p-4">
            <h3 className="text-lg font-semibold">
              Propietario del Elemento de Scorecard
            </h3>
            <p className="text-muted-foreground text-sm">
              Asigna la responsabilidad de este elemento de Scorecard (que
              contiene este KPI).
            </p>
            <UiSelect
              onValueChange={handleAssignOwner}
              value={ownerUserId}
              disabled={isSubmitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un propietario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">-- Ninguno --</SelectItem>
                {allUsers.map(user => (
                  <SelectItem key={user.userId} value={user.userId}>
                    {user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </UiSelect>

            <Separator />

            <h3 className="text-lg font-semibold">Updaters del KPI</h3>
            <p className="text-muted-foreground text-sm">
              Asigna usuarios que pueden ingresar valores manualmente para este
              KPI.
            </p>
            <ScrollArea className="h-40 w-full rounded-md border p-4">
              {allUsers.map(user => {
                const isUpdater = kpiUpdaters.some(
                  u => u.userId === user.userId
                )
                return (
                  <div
                    key={user.userId}
                    className="flex items-center justify-between py-2"
                  >
                    <span>{user.email}</span>
                    <Checkbox
                      checked={isUpdater}
                      onCheckedChange={checked =>
                        handleAssignUpdater(user.userId, checked)
                      }
                      disabled={isSubmitting}
                    />
                  </div>
                )
              })}
            </ScrollArea>
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
