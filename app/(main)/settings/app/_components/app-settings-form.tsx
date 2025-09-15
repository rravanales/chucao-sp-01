/**
 * @file app/(main)/settings/app/_components/app-settings-form.tsx
 * @brief Componente de cliente para el formulario de configuración general de la aplicación.
 * @description Este componente permite a los administradores personalizar la terminología
 * de la aplicación (ej. cambiar "Measures" a "KPIs") y activar/desactivar la funcionalidad
 * de "Strategy Maps" (UC-403, UC-404).
 * Utiliza `react-hook-form` para la gestión del formulario, `zod` para la validación,
 * y `Server Actions` para la persistencia de datos. Proporciona retroalimentación al usuario
 * a través de notificaciones `useToast`.
 */

"use client"

import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  updateTerminologyAction,
  toggleStrategyMapsAction
} from "@/actions/db/app-settings-actions"
import { ActionState } from "@/types"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, Save, Settings } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { SelectAppSetting } from "@/db/schema"
import { Separator } from "@/components/ui/separator"

/**
 * @interface AppSettingsFormProps
 * @description Propiedades para el componente AppSettingsForm.
 * @property {SelectAppSetting | null} initialCustomKpiTerm - Objeto de configuración inicial para la terminología de KPI.
 * @property {boolean} initialEnableStrategyMaps - Estado inicial de la activación de Strategy Maps.
 */
interface AppSettingsFormProps {
  initialCustomKpiTerm: SelectAppSetting | null
  initialEnableStrategyMaps: boolean
}

/**
 * @schema formSchema
 * @description Esquema de validación Zod para el formulario de configuración de la aplicación.
 * Define la estructura y las reglas para los campos del formulario.
 * @property {string} customKpiTerm - El término personalizado para KPI (ej. "Medidas", "Métricas").
 * @property {boolean} enableStrategyMaps - Indica si la funcionalidad de Strategy Maps está habilitada.
 */
const formSchema = z.object({
  customKpiTerm: z
    .string()
    .min(1, "El término de KPI es requerido.")
    .max(255, "El término no puede exceder los 255 caracteres."),
  enableStrategyMaps: z.boolean().default(false)
})

export default function AppSettingsForm({
  initialCustomKpiTerm,
  initialEnableStrategyMaps
}: AppSettingsFormProps) {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customKpiTerm: initialCustomKpiTerm?.settingValue || "KPI", // Valor por defecto si no hay configuración
      enableStrategyMaps: initialEnableStrategyMaps
    }
  })

  // Efecto para actualizar los valores por defecto del formulario si las props cambian
  useEffect(() => {
    form.reset({
      customKpiTerm: initialCustomKpiTerm?.settingValue || "KPI",
      enableStrategyMaps: initialEnableStrategyMaps
    })
  }, [initialCustomKpiTerm, initialEnableStrategyMaps, form])

  /**
   * @function onSubmit
   * @description Maneja el envío del formulario.
   * Llama a las Server Actions para actualizar la terminología y el estado de los Strategy Maps.
   * @param {z.infer<typeof formSchema>} values - Los valores del formulario validados.
   * @returns {Promise<void>}
   */
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    let successCount = 0
    let errorMessages: string[] = []

    // 1. Actualizar terminología de KPI
    const kpiTermResult: ActionState<SelectAppSetting> =
      await updateTerminologyAction({
        key: "custom_kpi_term",
        value: values.customKpiTerm
      })

    if (kpiTermResult.isSuccess) {
      successCount++
    } else {
      errorMessages.push(`Terminología de KPI: ${kpiTermResult.message}`)
    }

    // 2. Actualizar estado de Strategy Maps
    const strategyMapsResult: ActionState<SelectAppSetting> =
      await toggleStrategyMapsAction({
        enabled: values.enableStrategyMaps
      })

    if (strategyMapsResult.isSuccess) {
      successCount++
    } else {
      errorMessages.push(`Strategy Maps: ${strategyMapsResult.message}`)
    }

    // Mostrar feedback al usuario
    if (successCount > 0 && errorMessages.length === 0) {
      toast({
        title: "Éxito",
        description: "Configuraciones guardadas correctamente."
      })
    } else if (successCount > 0 && errorMessages.length > 0) {
      toast({
        title: "Advertencia",
        description: `Algunas configuraciones se guardaron, pero hubo errores: ${errorMessages.join(" | ")}`,
        variant: "destructive"
      })
    } else {
      toast({
        title: "Error",
        description: `Fallo al guardar todas las configuraciones: ${errorMessages.join(" | ")}`,
        variant: "destructive"
      })
    }

    setIsSubmitting(false)
    router.refresh() // Revalidar datos en el servidor para reflejar cambios
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card className="bg-muted/50 border-dashed">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
              <Settings className="size-4" /> Configuración de Terminología
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="customKpiTerm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Término para "KPI"</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Medidas, Métricas, Indicadores"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    Personaliza el término utilizado en la aplicación para
                    "KPIs". Por ejemplo, cámbialo a "Medidas" o "Métricas" para
                    alinearlo con la nomenclatura de tu organización.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Separator />

        <Card className="bg-muted/50 border-dashed">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
              <Settings className="size-4" /> Configuración de Metodología
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="enableStrategyMaps"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      Habilitar Strategy Maps
                    </FormLabel>
                    <FormDescription>
                      Muestra o esconde la sección de Strategy Maps en la
                      aplicación. Desactívalo si tu organización no usa esta
                      metodología.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isSubmitting}
                      aria-readonly
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}{" "}
          Guardar Configuraciones
        </Button>
      </form>
    </Form>
  )
}
