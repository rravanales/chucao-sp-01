/**
 * @file app/(main)/scorecards/_components/kpi-editor.tsx
 * @brief Componente de cliente para la creación o edición de Indicadores Clave de Rendimiento (KPIs).
 * @description Este formulario permite a los usuarios definir y configurar las características
 * de un KPI, incluyendo su tipo de puntuación, frecuencia de actualización, tipo de dato,
 * método de agregación, precisión decimal, si es de actualización manual o calculada
 * por una ecuación, y si participa en el rollup. Se integra con las Server Actions
 * `createKpiAction` y `updateKpiConfigurationAction` y proporciona retroalimentación
 * mediante `useToast` (UC-101).
 */
"use client"

import React, { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  createKpiAction,
  updateKpiConfigurationAction,
  setKpiCalculationEquationAction,
  enableKpiRollupAction
} from "@/actions/db/kpi-actions"
import {
  SelectKpi,
  kpiScoringTypeEnum,
  kpiCalendarFrequencyEnum,
  kpiDataTypeEnum,
  kpiAggregationTypeEnum,
  InsertKpi
} from "@/db/schema" // Importar tipos y enums
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Save } from "lucide-react"

/**
 * Define el esquema de validación para el formulario de KPI.
 * Se adapta de los esquemas de las Server Actions para el frontend.
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
      if (
        !data.isManualUpdate &&
        !data.rollupEnabled &&
        !data.calculationEquation
      ) {
        return false
      }
      if (
        data.isManualUpdate &&
        (data.calculationEquation || data.rollupEnabled)
      ) {
        return false
      }
      return true
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
  kpi?: SelectKpi
  onSuccess?: () => void
}

export default function KpiEditor({
  scorecardElementId,
  kpi,
  onSuccess
}: KpiEditorProps) {
  const isEditMode = !!kpi
  const { toast } = useToast()
  const router = useRouter()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      scorecardElementId: scorecardElementId,
      scoringType: kpi?.scoringType ?? kpiScoringTypeEnum.enumValues[0],
      calendarFrequency:
        kpi?.calendarFrequency ?? kpiCalendarFrequencyEnum.enumValues[0],
      dataType: kpi?.dataType ?? kpiDataTypeEnum.enumValues[0],
      aggregationType:
        kpi?.aggregationType ?? kpiAggregationTypeEnum.enumValues[0],
      decimalPrecision: kpi?.decimalPrecision || 0,
      isManualUpdate: kpi?.isManualUpdate || false,
      calculationEquation: kpi?.calculationEquation || null,
      rollupEnabled: kpi?.rollupEnabled || false
    }
  })

  const { isSubmitting } = form.formState
  const { watch, setValue } = form

  useEffect(() => {
    const subscription = watch((values, { name }) => {
      if (name === "calculationEquation") {
        const newEquation = values.calculationEquation?.trim()
        if (newEquation) {
          setValue("isManualUpdate", false, { shouldValidate: true })
          setValue("rollupEnabled", false, { shouldValidate: true })
        } else if (!values.isManualUpdate && !values.rollupEnabled) {
          setValue("isManualUpdate", true, { shouldValidate: true })
        }
      }
      if (name === "isManualUpdate") {
        if (values.isManualUpdate) {
          setValue("calculationEquation", null, { shouldValidate: true })
          setValue("rollupEnabled", false, { shouldValidate: true })
        }
      }
      if (name === "rollupEnabled") {
        if (values.rollupEnabled) {
          setValue("isManualUpdate", false, { shouldValidate: true })
          setValue("calculationEquation", null, { shouldValidate: true })
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, setValue])

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    let result: ActionState<SelectKpi>

    const kpiPayload: Partial<
      Omit<InsertKpi, "id" | "createdAt" | "updatedAt" | "scorecardElementId">
    > = {
      scoringType: values.scoringType,
      calendarFrequency: values.calendarFrequency,
      dataType: values.dataType,
      aggregationType: values.aggregationType,
      decimalPrecision: values.decimalPrecision,
      isManualUpdate: values.isManualUpdate,
      calculationEquation: values.calculationEquation,
      rollupEnabled: values.rollupEnabled
    }

    if (isEditMode && kpi) {
      result = await updateKpiConfigurationAction(kpi.id, kpiPayload)
    } else {
      const createPayload: Omit<InsertKpi, "id" | "createdAt" | "updatedAt"> = {
        scorecardElementId: values.scorecardElementId,
        ...kpiPayload
      } as Omit<InsertKpi, "id" | "createdAt" | "updatedAt">

      result = await createKpiAction(createPayload)
    }

    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: `KPI ${isEditMode ? "actualizado" : "creado"} correctamente.`
      })
      router.refresh()
      if (onSuccess) {
        onSuccess()
      }
    } else {
      toast({
        title: "Error",
        description: `Fallo al ${isEditMode ? "actualizar" : "crear"} el KPI: ${result.message}`,
        variant: "destructive"
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4">
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
        {/* ... resto del formulario sin cambios ... */}
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
  )
}
