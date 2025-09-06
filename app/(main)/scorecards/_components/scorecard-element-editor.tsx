/**
 * @file app/(main)/scorecards/_components/scorecard-element-editor.tsx
 * @brief Componente de cliente para la creación o edición de elementos de Scorecard.
 * @description Este formulario permite a los usuarios crear nuevos elementos de Scorecard
 * (Perspectivas, Objetivos, Iniciativas, KPIs) o modificar los existentes.
 * Utiliza `react-hook-form` con `zod` para la validación de entrada y se integra
 * con las Server Actions `createScorecardElementAction` y `updateScorecardElementAction`.
 * Soporta la selección de una organización, un elemento padre, y el tipo de elemento.
 * Proporciona retroalimentación al usuario mediante `useToast` (UC-100).
 */
"use client"

import React, { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  createScorecardElementAction,
  updateScorecardElementAction,
  getScorecardElementsAction
} from "@/actions/db/scorecard-element-actions"
import { getAllOrganizationsAction } from "@/actions/db/organization-actions"
import {
  SelectOrganization,
  SelectScorecardElement,
  scorecardElementTypeEnum,
  InsertScorecardElement
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Loader2, Save } from "lucide-react"

/**
 * Define el esquema de validación para el formulario de elementos de Scorecard.
 * Se basa en el esquema de las Server Actions, pero adaptado para el frontend.
 */
const formSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del elemento es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  description: z
    .string()
    .max(1000, "La descripción no puede exceder los 1000 caracteres.")
    .nullable()
    .optional(),
  parentId: z
    .string()
    .uuid("ID de elemento padre inválido.")
    .nullable()
    .optional(),
  organizationId: z.string().uuid("ID de organización inválido."),
  elementType: z.enum(scorecardElementTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de elemento de Scorecard inválido." })
  }),
  ownerUserId: z
    .string()
    .min(1, "El ID del propietario es requerido.")
    .nullable()
    .optional(),
  weight: z.coerce
    .number()
    .min(0, "El peso no puede ser negativo.")
    .max(1000, "El peso no puede exceder 1000.")
    .default(1.0),
  orderIndex: z.coerce
    .number()
    .int()
    .min(0, "El índice de orden no puede ser negativo.")
    .default(0)
})

interface ScorecardElementEditorProps {
  organizations: SelectOrganization[]
  scorecardElement?: SelectScorecardElement
  onSuccess?: () => void
}

// Valor por defecto único y válido para elementType
const DEFAULT_ELEMENT_TYPE = scorecardElementTypeEnum
  .enumValues[0] as (typeof scorecardElementTypeEnum.enumValues)[number]

export default function ScorecardElementEditor({
  organizations,
  scorecardElement,
  onSuccess
}: ScorecardElementEditorProps) {
  const isEditMode = !!scorecardElement
  const { toast } = useToast()
  const router = useRouter()

  const [parentElements, setParentElements] = useState<
    SelectScorecardElement[]
  >([])
  const [isFetchingParents, setIsFetchingParents] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: scorecardElement?.name || "",
      description: scorecardElement?.description || null,
      parentId: scorecardElement?.parentId || null,
      organizationId:
        scorecardElement?.organizationId || (organizations[0]?.id ?? ""),
      elementType: scorecardElement?.elementType ?? DEFAULT_ELEMENT_TYPE,
      ownerUserId: scorecardElement?.ownerUserId || null,
      weight: scorecardElement?.weight
        ? parseFloat(scorecardElement.weight as unknown as string)
        : 1.0,
      orderIndex: scorecardElement?.orderIndex ?? 0
    }
  })

  const { isSubmitting } = form.formState

  // Cargar elementos de Scorecard para el selector de padre
  useEffect(() => {
    const fetchParentElements = async (orgId: string) => {
      setIsFetchingParents(true)
      const response = await getScorecardElementsAction(orgId, null) // Obtener elementos de nivel superior por ahora
      if (response.isSuccess) {
        // Filtrar el elemento actual si estamos en modo edición para evitar auto-referencias
        const filteredElements =
          response.data?.filter(
            el => !isEditMode || el.id !== scorecardElement?.id
          ) || []
        setParentElements(filteredElements)
      } else {
        toast({
          title: "Error",
          description: `Fallo al cargar elementos padre: ${response.message}`,
          variant: "destructive"
        })
      }
      setIsFetchingParents(false)
    }

    const orgId = form.watch("organizationId")
    if (orgId) {
      fetchParentElements(orgId)
    } else {
      setParentElements([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.watch("organizationId"), isEditMode, scorecardElement?.id, toast])

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    let result: ActionState<SelectScorecardElement>

    // Convertir el weight a string antes de pasarlo a la Server Action si el schema DB es 'numeric'
    const payload: Omit<
      InsertScorecardElement,
      "id" | "createdAt" | "updatedAt"
    > = {
      ...values,
      weight: values.weight.toString()
    }

    if (isEditMode && scorecardElement) {
      result = await updateScorecardElementAction(scorecardElement.id, payload)
    } else {
      result = await createScorecardElementAction(payload)
    }

    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: `Elemento de Scorecard ${isEditMode ? "actualizado" : "creado"} correctamente.`
      })
      router.refresh() // Revalidar los datos en el servidor
      onSuccess?.()
    } else {
      toast({
        title: "Error",
        description: `Fallo al ${isEditMode ? "actualizar" : "crear"} el elemento: ${result.message}`,
        variant: "destructive"
      })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input placeholder="Nombre del elemento" {...field} />
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
                  placeholder="Descripción del elemento (opcional)"
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
          name="organizationId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organización</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isSubmitting || isEditMode}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona una organización" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                La organización a la que pertenece este elemento.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="parentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Elemento Padre (Opcional)</FormLabel>
              <Select
                onValueChange={value =>
                  field.onChange(value === "null" ? null : value)
                }
                value={field.value ?? "null"}
                disabled={isFetchingParents || isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un elemento padre" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="null">-- Ninguno --</SelectItem>
                  {isFetchingParents ? (
                    <SelectItem value="loading" disabled>
                      Cargando...
                    </SelectItem>
                  ) : (
                    parentElements.map(el => (
                      <SelectItem key={el.id} value={el.id}>
                        {el.name} ({el.elementType})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormDescription>
                Elemento superior en la jerarquía del Scorecard.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="elementType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de Elemento</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo de elemento" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {scorecardElementTypeEnum.enumValues.map(type => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="weight"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Peso (0-1000)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Ej. 1.0"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Importancia relativa para cálculos agregados.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="orderIndex"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Índice de Orden</FormLabel>
              <FormControl>
                <Input type="number" placeholder="Ej. 0" {...field} />
              </FormControl>
              <FormDescription>
                Posición dentro de los elementos hermanos.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* ownerUserId oculto por ahora */}
        <FormField
          control={form.control}
          name="ownerUserId"
          render={({ field }) => (
            <FormItem className="hidden">
              <FormLabel>ID de Propietario (Opcional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="ID de usuario de Clerk"
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
          {isEditMode ? "Guardar Cambios" : "Crear Elemento"}
        </Button>
      </form>
    </Form>
  )
}
