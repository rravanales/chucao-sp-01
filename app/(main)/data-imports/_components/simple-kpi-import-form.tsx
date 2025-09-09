/**
 * @file app/(main)/data-imports/_components/simple-kpi-import-form.tsx
 * @brief Componente de cliente para la importación simple de valores de KPI desde hojas de cálculo.
 * @description Este formulario permite a los usuarios cargar un archivo Excel para realizar una
 * importación rápida de valores de KPI. El archivo se codifica en Base64 y se envía a una
 * Server Action para su procesamiento.
 * (UC-200: Configurar Importación Simple de Valores de KPI (desde Hojas de Cálculo))
 */
"use client"

import React, { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { uploadSimpleKpiImportAction } from "@/actions/db/import-actions"
import { SelectOrganization } from "@/db/schema"
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
import { Button } from "@/components/ui/button"
import { Loader2, Upload } from "lucide-react"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"

/**
 * @interface SimpleKpiImportFormProps
 * @description Propiedades para el componente SimpleKpiImportForm.
 * @property {SelectOrganization[]} organizations - Lista de organizaciones disponibles para seleccionar.
 */
interface SimpleKpiImportFormProps {
  organizations: SelectOrganization[]
}

/**
 * Define el esquema de validación para el formulario de importación simple.
 */
const formSchema = z.object({
  organizationId: z.string().uuid("ID de organización inválido."),
  file: z
    .instanceof(File, {
      message: "Se requiere un archivo para la importación."
    })
    .refine(
      file => file.size < 5 * 1024 * 1024, // 5MB limit
      "El tamaño del archivo no debe exceder 5MB."
    )
    .refine(
      file =>
        file.type ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.type === "application/vnd.ms-excel",
      "Solo se permiten archivos Excel (.xlsx, .xls)."
    )
})

/**
 * @function SimpleKpiImportForm
 * @description Componente de formulario para realizar importaciones simples de KPI.
 */
const SimpleKpiImportForm: React.FC<SimpleKpiImportFormProps> = ({
  organizations
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      organizationId: "",
      file: undefined
    }
  })

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    try {
      // Read the file content as Base64
      const fileContentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsDataURL(values.file)
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1] // Extract base64 part
          resolve(base64)
        } // Extract base64 part
        reader.onerror = error => reject(error)
      })

      const result: ActionState<undefined> = await uploadSimpleKpiImportAction({
        fileName: values.file.name,
        fileContentBase64: fileContentBase64,
        organizationId: values.organizationId
      })

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description: "Importación simple de KPI completada correctamente."
        })
        form.reset() // Clear the form
        router.refresh()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        })
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Error al procesar el archivo: ${error.message}`,
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 p-4">
        <FormField
          control={form.control}
          name="organizationId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organización</FormLabel>
              <UiSelect
                onValueChange={field.onChange}
                value={field.value}
                disabled={isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una organización" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {organizations.length === 0 ? (
                    <SelectItem value="no-org" disabled>
                      No hay organizaciones disponibles
                    </SelectItem>
                  ) : (
                    organizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </UiSelect>
              <FormDescription>
                Los KPIs importados se asociarán a los elementos de Scorecard de
                esta organización.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="file"
          render={({ field: { value, onChange, ...fieldProps } }) => (
            <FormItem>
              <FormLabel>Archivo Excel de KPI</FormLabel>
              <FormControl>
                <Input
                  {...fieldProps}
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={event => {
                    onChange(event.target.files && event.target.files)
                  }}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormDescription>
                Sube un archivo Excel (.xlsx o .xls) con tus datos de KPI.
                Asegúrate de que los nombres de las columnas coincidan con los
                nombres de tus KPIs y las fechas.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Upload className="mr-2 size-4" />
          )}{" "}
          Cargar e Importar
        </Button>
      </form>
    </Form>
  )
}

export default SimpleKpiImportForm
