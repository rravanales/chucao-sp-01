/**
 * @file app/(main)/scorecards/_components/kpi-manual-update-form.tsx
 * @brief Componente de cliente para la actualización manual de valores de KPIs.
 * @description Este formulario permite a los usuarios designados como "Updaters" ingresar
 * manualmente los valores (actual, objetivo, umbrales) de un KPI para un período específico.
 * Utiliza `react-hook-form` y `zod` para la validación y se integra con la
 * `updateKpiManualValueAction` del backend. Proporciona retroalimentación
 * mediante `useToast` (UC-102).
 */
"use client"

import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  updateKpiManualValueAction,
  getKpiAction,
  getKpiValueForPeriodAction
} from "@/actions/db/kpi-actions"
import { SelectKpi, SelectKpiValue, kpiDataTypeEnum } from "@/db/schema"
import { ActionState } from "@/types"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { format } from "date-fns"
import { CalendarIcon, Loader2, Save } from "lucide-react"
import { cn } from "@/lib/utils" // Import cn utility

/**
 * @interface KpiManualUpdateFormProps
 * @description Propiedades para el componente KpiManualUpdateForm.
 * @property {string} kpiId - El ID del KPI a actualizar.
 * @property {SelectKpi} kpiConfig - La configuración actual del KPI, incluyendo su tipo de dato y frecuencia.
 * @property {() => void} [onSuccess] - Callback opcional para ejecutar después de una actualización exitosa.
 */
interface KpiManualUpdateFormProps {
  kpiId: string
  kpiConfig: SelectKpi
  onSuccess?: () => void
}

/**
 * Define el esquema de validación para el formulario de actualización manual de KPI.
 * Adaptado de `updateKpiManualValueSchema` en `kpi-actions.ts`.
 */
const formSchema = z
  .object({
    kpiId: z.string().uuid("ID de KPI inválido.").optional(), // Optional for form, but passed via props
    periodDate: z.date({
      required_error: "La fecha del período es requerida."
    }),
    actualValue: z
      .string()
      .max(255, "El valor actual no puede exceder 255 caracteres.")
      .nullable()
      .optional(),
    targetValue: z
      .string()
      .max(255, "El valor objetivo no puede exceder 255 caracteres.")
      .nullable()
      .optional(),
    thresholdRed: z
      .string()
      .max(255, "El umbral rojo no puede exceder 255 caracteres.")
      .nullable()
      .optional(),
    thresholdYellow: z
      .string()
      .max(255, "El umbral amarillo no puede exceder 255 caracteres.")
      .nullable()
      .optional(),
    note: z
      .string()
      .max(1000, "La nota no puede exceder los 1000 caracteres.")
      .nullable()
      .optional()
  })
  .refine(
    data => {
      // Validación condicional para tipos de datos numéricos
      const numericDataTypes = new Set(["Number", "Percentage", "Currency"])
      if (numericDataTypes.has(window.__KPI_DATA_TYPE__ || "Text")) {
        const checkNumeric = (val: string | null | undefined) =>
          val === null || val === undefined || val === "" || !isNaN(Number(val))

        if (!checkNumeric(data.actualValue)) return false
        if (!checkNumeric(data.targetValue)) return false
        if (!checkNumeric(data.thresholdRed)) return false
        if (!checkNumeric(data.thresholdYellow)) return false
      }
      return true
    },
    {
      message: "Los valores deben ser numéricos para este tipo de KPI.",
      path: ["actualValue"] // This path can be adjusted to point to all numeric fields if needed
    }
  )

// Declaring a global variable to store KPI data type for client-side validation
// This is a workaround as Zod refine cannot directly access component props.
declare global {
  interface Window {
    __KPI_DATA_TYPE__: (typeof kpiDataTypeEnum.enumValues)[number]
  }
}

export default function KpiManualUpdateForm({
  kpiId,
  kpiConfig,
  onSuccess
}: KpiManualUpdateFormProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentKpiValue, setCurrentKpiValue] = useState<SelectKpiValue | null>(
    null
  )

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      kpiId: kpiId,
      periodDate: new Date(), // Default to current date
      actualValue: "",
      targetValue: "",
      thresholdRed: "",
      thresholdYellow: "",
      note: ""
    }
  })

  const selectedPeriodDate = form.watch("periodDate")

  // Effect to update global KPI data type for validation
  useEffect(() => {
    if (kpiConfig?.dataType) {
      window.__KPI_DATA_TYPE__ = kpiConfig.dataType
    }
  }, [kpiConfig?.dataType])

  // Effect to fetch existing KPI value for the selected period
  useEffect(() => {
    const fetchKpiValue = async () => {
      if (selectedPeriodDate) {
        const periodDateString = format(selectedPeriodDate, "yyyy-MM-dd")
        const res = await getKpiValueForPeriodAction(kpiId, periodDateString)
        if (res.isSuccess && res.data) {
          setCurrentKpiValue(res.data)
          form.reset({
            kpiId: kpiId,
            periodDate: selectedPeriodDate,
            actualValue: res.data.actualValue ?? "",
            targetValue: res.data.targetValue ?? "",
            thresholdRed: res.data.thresholdRed ?? "",
            thresholdYellow: res.data.thresholdYellow ?? "",
            note: res.data.note ?? ""
          })
        } else {
          setCurrentKpiValue(null)
          form.reset({
            kpiId: kpiId,
            periodDate: selectedPeriodDate,
            actualValue: "",
            targetValue: "",
            thresholdRed: "",
            thresholdYellow: "",
            note: ""
          })
        }
      }
    }
    fetchKpiValue()
  }, [kpiId, selectedPeriodDate, form])

  /**
   * @function onSubmit
   * @description Maneja el envío del formulario, llamando a la Server Action correspondiente.
   * @param {z.infer<typeof formSchema>} values - Los valores del formulario.
   * @returns {Promise<void>}
   */
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    // Convert Date object to ISO string for the backend action
    const periodDateString = format(values.periodDate, "yyyy-MM-dd")

    const payload = {
      kpiId: kpiId, // Ensure kpiId is always from props, not form values directly
      periodDate: periodDateString,
      actualValue: values.actualValue || null,
      targetValue: values.targetValue || null,
      thresholdRed: values.thresholdRed || null,
      thresholdYellow: values.thresholdYellow || null,
      note: values.note || null
    }

    let result: ActionState<SelectKpiValue>
    result = await updateKpiManualValueAction(payload)

    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: "Valor de KPI actualizado manualmente."
      })
      form.reset(values) // Reset form with current values
      router.refresh() // Revalidate data for Server Components
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

  const isNumericKpi = new Set(["Number", "Percentage", "Currency"]).has(
    kpiConfig.dataType
  )

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="periodDate"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Fecha del Período</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-[240px] pl-3 text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      {field.value ? (
                        format(field.value, "PPP")
                      ) : (
                        <span>Selecciona una fecha</span>
                      )}
                      <CalendarIcon className="ml-auto size-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={date =>
                      date > new Date() || date < new Date("1900-01-01")
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="actualValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Valor Actual</FormLabel>
              <FormControl>
                <Input
                  placeholder="Ej. 123.45"
                  type={isNumericKpi ? "number" : "text"}
                  step={isNumericKpi ? "any" : undefined}
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {kpiConfig.scoringType === "Goal/Red Flag" && ( // Only show target/thresholds for Goal/Red Flag KPIs
          <>
            <FormField
              control={form.control}
              name="targetValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor Objetivo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej. 100.00"
                      type={isNumericKpi ? "number" : "text"}
                      step={isNumericKpi ? "any" : undefined}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="thresholdRed"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Umbral Rojo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej. 70.00"
                      type={isNumericKpi ? "number" : "text"}
                      step={isNumericKpi ? "any" : undefined}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="thresholdYellow"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Umbral Amarillo</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej. 90.00"
                      type={isNumericKpi ? "number" : "text"}
                      step={isNumericKpi ? "any" : undefined}
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nota (Opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Añadir una nota sobre esta actualización..."
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
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
          Guardar Actualización Manual
        </Button>
      </form>
    </Form>
  )
}
