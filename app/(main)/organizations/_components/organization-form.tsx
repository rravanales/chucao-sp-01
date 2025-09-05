/**
 * @file app/(main)/organizations/_components/organization-form.tsx
 * @brief Componente de cliente para el formulario de creación o edición de organizaciones.
 * @description Este formulario utiliza `react-hook-form` con `zod` para validar y enviar datos
 * a las Server Actions `createOrganizationAction` y `updateOrganizationAction`. Permite
 * crear nuevas organizaciones o editar existentes, incluyendo la asignación de una
 * organización padre. Proporciona feedback al usuario a través de `useToast` (UC-500).
 */
"use client"

import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  createOrganizationAction,
  updateOrganizationAction,
  getAllOrganizationsAction // Necesario para listar padres potenciales
} from "@/actions/db/organization-actions"
import { SelectOrganization } from "@/db/schema"
import { ActionState, fail } from "@/types"
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
import { Loader2, Save } from "lucide-react"

/**
 * Esquema base para la validación de la forma de organización, alineado con createOrganizationSchema.
 * Se reutiliza y extiende para la edición.
 */
const formSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  description: z
    .string()
    .max(1000, "La descripción no puede exceder los 1000 caracteres.")
    .nullable()
    .optional(),
  parentId: z
    .string()
    .uuid("ID de organización padre inválido.")
    .nullable()
    .optional(),
  templateFromDatasetField: z // Campo que solo se usa en casos muy específicos, se mantiene para compatibilidad
    .string()
    .max(
      255,
      "El nombre del campo del dataset no puede exceder 255 caracteres."
    )
    .nullable()
    .optional()
})

interface OrganizationFormProps {
  organization?: SelectOrganization // Si se proporciona, es modo edición
  onSuccess?: () => void // Callback opcional al éxito
}

export default function OrganizationForm({
  organization,
  onSuccess
}: OrganizationFormProps) {
  const isEditMode = !!organization
  const { toast } = useToast()
  const router = useRouter()
  const [parentOrganizations, setParentOrganizations] = useState<
    SelectOrganization[]
  >([])
  const [isFetchingParents, setIsFetchingParents] = useState(true)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: organization?.name || "",
      description: organization?.description || null,
      parentId: organization?.parentId || null,
      templateFromDatasetField: organization?.templateFromDatasetField || null
    }
  })

  const { isSubmitting } = form.formState

  useEffect(() => {
    /**
     * @function fetchParentOrganizations
     * @description Obtiene la lista de organizaciones para poblar el selector de padre.
     * Esta función es llamada una vez al montar el componente.
     */
    const fetchParentOrganizations = async () => {
      setIsFetchingParents(true)
      const res = await getAllOrganizationsAction() // Obtener todas las organizaciones
      if (res.isSuccess) {
        // Filtrar la propia organización y sus descendientes si está en modo edición para evitar ciclos
        let filteredOrgs = res.data
        if (isEditMode && organization) {
          filteredOrgs = res.data.filter(
            org =>
              org.id !== organization.id && org.parentId !== organization.id
          ) // Simple filtro para evitar auto-referencia directa. Más complejo requeriría un árbol de descendientes.
        }
        setParentOrganizations(filteredOrgs)
      } else {
        toast({
          title: "Error al cargar organizaciones padre",
          description: res.message,
          variant: "destructive"
        })
      }
      setIsFetchingParents(false)
    }

    fetchParentOrganizations()
  }, [isEditMode, organization, toast])

  /**
   * @function onSubmit
   * @description Maneja el envío del formulario, llamando a la Server Action correspondiente.
   * @param {z.infer<typeof formSchema>} values - Los valores del formulario.
   * @returns {Promise<void>}
   */
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    let result: ActionState<SelectOrganization>

    // Normalizar cadenas vacías a null para campos opcionales
    const payload = {
      ...values,
      description: values.description === "" ? null : values.description,
      parentId: values.parentId === "" ? null : values.parentId,
      templateFromDatasetField:
        values.templateFromDatasetField === ""
          ? null
          : values.templateFromDatasetField
    }

    if (isEditMode && organization) {
      // Modo edición
      result = await updateOrganizationAction(organization.id, payload)
    } else {
      // Modo creación
      result = await createOrganizationAction(payload)
    }

    if (result.isSuccess) {
      toast({
        title: isEditMode ? "Organización Actualizada" : "Organización Creada",
        description: `La organización "${result.data.name}" ha sido ${isEditMode ? "actualizada" : "creada"} exitosamente.`
      })
      router.refresh() // Revalidar los datos en el servidor
      onSuccess?.() // Ejecutar callback opcional
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input placeholder="Nombre de la organización" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Descripción de la organización (opcional)"
                  {...field}
                  value={field.value ?? ""} // Asegurar que la Textarea no reciba null
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="parentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organización Padre (Opcional)</FormLabel>
              <Select
                onValueChange={value =>
                  field.onChange(value === "null" ? null : value)
                }
                value={field.value ?? "null"}
                disabled={isFetchingParents || isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una organización padre" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="null">-- Ninguno --</SelectItem>
                  {isFetchingParents ? (
                    <SelectItem value="loading" disabled>
                      Cargando...
                    </SelectItem>
                  ) : (
                    parentOrganizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormDescription>
                Puedes anidar esta organización bajo otra existente.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Este campo se deja oculto o de solo lectura para la mayoría de los casos de uso,
            ya que se relaciona con la creación de organizaciones por plantilla desde datasets,
            un caso de uso más avanzado. */}
        <FormField
          control={form.control}
          name="templateFromDatasetField"
          render={({ field }) => (
            <FormItem className="hidden">
              {" "}
              {/* Ocultar por defecto */}
              <FormLabel>Campo de Dataset para Plantilla</FormLabel>
              <FormControl>
                <Input
                  placeholder="Campo de dataset (opcional)"
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
          {isEditMode ? "Guardar Cambios" : "Crear Organización"}
        </Button>
      </form>
    </Form>
  )
}
