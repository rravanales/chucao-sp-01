/**
 * @file app/(main)/data-imports/_components/standard-kpi-import-wizard.tsx
 * @brief Componente de cliente para la gestión y configuración de importaciones estándar de KPI.
 * @description Basado en la versión 1, incorporando control de permisos (usePermissions) para
 * condicionar la visibilidad de las acciones de cada importación guardada, tal como en la versión 2,
 * sin perder funcionalidades ni romper compatibilidad.
 */
"use client"

import React, { useState, useEffect } from "react"
import { useForm, useFieldArray, Control } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  createSavedKpiImportAction,
  updateSavedKpiImportAction,
  deleteSavedKpiImportAction,
  executeSavedKpiImportAction,
  scheduleKpiImportAction, // (importado aunque no usado aún; compatibilidad con futuras mejoras)
  unscheduleKpiImportAction
} from "@/actions/db/import-actions"
// ⬇️ usamos la nueva acción en kpi-actions3
import { getAllKpisForSelectAction } from "@/actions/db/kpi-actions"

import { SelectImportConnection, SelectSavedImport } from "@/db/schema"

import {
  KpiMapping,
  KpiMappingSchema,
  TransformationRule,
  TransformationRuleSchema
} from "@/types/import-types"
import { ScheduleConfig, ScheduleConfigSchema } from "@/types/schedule-types"
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
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Loader2,
  Save,
  StepForward,
  StepBack,
  Play,
  CalendarDays,
  Trash2,
  Edit,
  MoreVertical
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
// ⬇️ imports faltantes para tabla y diálogo
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"

// ⬇️ NUEVO: control de permisos (aportado por la versión 2)
import { usePermissions } from "@/context/permission-context"

/**
 * Tipos auxiliares locales
 */
type KpiOption = { id: string; name: string }

/**
 * @interface StandardKpiImportWizardProps
 */
interface StandardKpiImportWizardProps {
  connections: SelectImportConnection[]
  savedImport?: SelectSavedImport | null
  savedImports?: SelectSavedImport[] | null
  /**
   * Callback opcional que se dispara cuando la importación se creó/actualizó exitosamente.
   * Útil para que el componente padre cierre diálogos y refresque datos.
   */
  onSuccess?: () => void
}

/**
 * Esquema del formulario
 */
const formSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre de la importación es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  connectionId: z.string().uuid("ID de conexión inválido."),
  kpiMappings: z
    .array(KpiMappingSchema)
    .min(1, "Debe haber al menos un mapeo de KPI."),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  // aseguramos estructura por defecto para evitar {} vacíos
  scheduleConfig: ScheduleConfigSchema.nullable().optional()
})

type FormData = z.infer<typeof formSchema>

/**
 * @component KpiMappingRow
 */
interface KpiMappingRowProps {
  index: number
  control: Control<FormData>
  kpiOptions: KpiOption[]
  onRemove: () => void
}

const KpiMappingRow: React.FC<KpiMappingRowProps> = ({
  index,
  control,
  kpiOptions,
  onRemove
}) => {
  return (
    <div className="mb-2 grid grid-cols-1 gap-4 rounded-md border p-4 md:grid-cols-4">
      <FormField
        control={control}
        name={`kpiMappings.${index}.kpiId`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>KPI de Destino</FormLabel>
            <UiSelect onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un KPI" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {kpiOptions.map(kpi => (
                  <SelectItem key={kpi.id} value={kpi.id}>
                    {kpi.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </UiSelect>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`kpiMappings.${index}.periodDate.sourceField`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Campo Fecha (Origen)</FormLabel>
            <FormControl>
              <Input placeholder="Ej: DateColumn" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`kpiMappings.${index}.actualValue.sourceField`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Campo Valor Real (Origen)</FormLabel>
            <FormControl>
              <Input placeholder="Ej: ActualValueColumn" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="flex items-end justify-end">
        <Button
          type="button"
          variant="destructive"
          size="icon"
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * @component StandardKpiImportWizard
 */
const StandardKpiImportWizard: React.FC<StandardKpiImportWizardProps> = ({
  connections,
  savedImport = null,
  savedImports = null,
  onSuccess
}) => {
  const isEditMode = !!savedImport
  const { toast } = useToast()
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [kpiOptions, setKpiOptions] = useState<KpiOption[]>([])

  // ⬇️ NUEVO: permisos
  const { hasPermission } = usePermissions()
  const canManageSavedImports = hasPermission("import:manage_saved_imports")

  const defaultConnectionId =
    savedImport?.connectionId ?? connections[0]?.id ?? ""

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: savedImport?.name || "",
      connectionId: defaultConnectionId,
      kpiMappings:
        ((savedImport?.kpiMappings as KpiMapping[]) ?? []).length > 0
          ? (savedImport?.kpiMappings as KpiMapping[])
          : [
              {
                kpiId: "",
                periodDate: { sourceField: "" },
                actualValue: { sourceField: "" }
              }
            ],
      transformations:
        (savedImport?.transformations as TransformationRule[]) ?? [],
      // si no viene, no forzamos objeto vacío; el UI maneja opcionalidad
      scheduleConfig:
        (savedImport?.scheduleConfig as ScheduleConfig | undefined) ?? undefined
    }
  })

  const {
    fields: kpiMappingFields,
    append: appendKpiMapping,
    remove: removeKpiMapping
  } = useFieldArray({
    control: form.control,
    name: "kpiMappings"
  })

  useEffect(() => {
    // Cargar KPIs (id + name)
    const fetchKpis = async () => {
      const res = await getAllKpisForSelectAction()
      if (res.isSuccess && res.data) {
        setKpiOptions(res.data)
      } else {
        toast({
          title: "Error",
          description:
            res.message ?? "No se pudieron cargar los KPIs para el mapeo.",
          variant: "destructive"
        })
      }
    }
    fetchKpis()
  }, [toast])

  useEffect(() => {
    // Reset al cambiar entre edición/creación
    if (savedImport) {
      form.reset({
        name: savedImport.name,
        connectionId: savedImport.connectionId,
        kpiMappings: (savedImport.kpiMappings as KpiMapping[]) || [],
        transformations:
          (savedImport.transformations as TransformationRule[]) || [],
        scheduleConfig:
          (savedImport.scheduleConfig as ScheduleConfig | undefined) ??
          undefined
      })
    } else {
      form.reset({
        name: "",
        connectionId: connections[0]?.id ?? "",
        kpiMappings: [
          {
            kpiId: "",
            periodDate: { sourceField: "" },
            actualValue: { sourceField: "" }
          }
        ],
        transformations: [],
        scheduleConfig: undefined
      })
    }
  }, [savedImport])

  const nextStep = () => setCurrentStep(prev => prev + 1)
  const prevStep = () => setCurrentStep(prev => prev - 1)

  const onSubmit = async (values: FormData) => {
    setIsSubmitting(true)
    let result: ActionState<SelectSavedImport>

    try {
      const payload: Omit<
        SelectSavedImport,
        "id" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt"
      > = {
        name: values.name,
        connectionId: values.connectionId,
        kpiMappings: values.kpiMappings,
        transformations: values.transformations ?? [],
        scheduleConfig: values.scheduleConfig ?? null
      }

      if (isEditMode && savedImport?.id) {
        // ⬇️ Mantener firma de la v1 para compatibilidad
        result = await updateSavedKpiImportAction(savedImport.id, payload)
      } else {
        result = await createSavedKpiImportAction(payload)
      }

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description: `Importación estándar ${isEditMode ? "actualizada" : "creada"} correctamente.`
        })
        form.reset()
        router.refresh()
        // Notifica al padre (cerrar diálogo, refrescar listas, etc.)
        onSuccess?.()
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
        description: `Error al procesar la importación: ${error.message}`,
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteImport = async (id: string) => {
    // ⬇️ Defensa extra opcional: bloquear si no hay permiso
    if (!canManageSavedImports) {
      toast({
        title: "Permisos insuficientes",
        description: "No tienes permisos para eliminar importaciones estándar.",
        variant: "destructive"
      })
      return
    }

    const result = await deleteSavedKpiImportAction({ id })
    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: "Importación guardada eliminada correctamente."
      })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  const handleExecuteImport = async (id: string) => {
    if (!canManageSavedImports) {
      toast({
        title: "Permisos insuficientes",
        description: "No tienes permisos para ejecutar importaciones estándar.",
        variant: "destructive"
      })
      return
    }

    toast({
      title: "Ejecutando",
      description: "La importación de KPI está en curso..."
    })
    const result = await executeSavedKpiImportAction({ id })
    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: "Importación ejecutada correctamente."
      })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  const handleScheduleToggle = async (
    id: string,
    currentSchedule: ScheduleConfig | null | undefined
  ) => {
    if (!canManageSavedImports) {
      toast({
        title: "Permisos insuficientes",
        description:
          "No tienes permisos para gestionar la programación de importaciones.",
        variant: "destructive"
      })
      return
    }

    if (currentSchedule) {
      const result = await unscheduleKpiImportAction({ id })
      if (result.isSuccess) {
        toast({ title: "Éxito", description: "Importación desprogramada." })
        router.refresh()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        })
      }
    } else {
      toast({
        title: "Info",
        description:
          "La programación requiere más configuración (no implementado en este paso)."
      })
      // Aquí abrirías un diálogo para configurar scheduleConfig
    }
  }

  // Listado de importaciones existentes (cuando no estamos editando una en particular)
  if (savedImports !== null && !isEditMode) {
    if (savedImports.length === 0) {
      return (
        <p className="text-muted-foreground py-8 text-center">
          No hay importaciones estándar configuradas. Haz clic en "Nueva
          Importación Estándar" para empezar.
        </p>
      )
    }
    return (
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Conexión</TableHead>
              <TableHead>Última Ejecución</TableHead>
              <TableHead>Programada</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {savedImports.map(imp => {
              const sc =
                (imp.scheduleConfig as ScheduleConfig | null | undefined) ??
                null
              return (
                <TableRow key={imp.id}>
                  <TableCell className="font-medium">{imp.name}</TableCell>
                  <TableCell>
                    {connections.find(conn => conn.id === imp.connectionId)
                      ?.name || "Desconocida"}
                  </TableCell>
                  <TableCell>
                    {imp.lastRunAt
                      ? new Date(imp.lastRunAt).toLocaleDateString()
                      : "Nunca"}
                  </TableCell>
                  <TableCell>
                    {sc ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2"
                            >
                              <CalendarDays className="mr-1 size-3" />
                              Programada
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Frecuencia: {sc.frequency}</p>
                            <p>Hora: {sc.time}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      "No"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* ⬇️ NUEVO: mostrar acciones solo si el usuario tiene permiso */}
                    {canManageSavedImports && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="size-8 p-0">
                            <span className="sr-only">Abrir menú</span>
                            <MoreVertical className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <Dialog>
                            <DialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                              >
                                <Edit className="mr-2 size-4" /> Editar
                              </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[800px]">
                              <DialogHeader>
                                <DialogTitle>
                                  Editar Importación Estándar de KPI
                                </DialogTitle>
                                <DialogDescription>
                                  Modifica la configuración de esta importación
                                  avanzada.
                                </DialogDescription>
                              </DialogHeader>
                              <StandardKpiImportWizard
                                connections={connections}
                                savedImport={imp}
                                // Si se provee onSuccess desde el padre, se respeta; de lo contrario refrescamos
                                onSuccess={() => {
                                  router.refresh()
                                }}
                              />
                            </DialogContent>
                          </Dialog>
                          <DropdownMenuItem
                            onClick={() => handleExecuteImport(imp.id)}
                          >
                            <Play className="mr-2 size-4" /> Ejecutar Ahora
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleScheduleToggle(imp.id, sc)}
                          >
                            <CalendarDays className="mr-2 size-4" />{" "}
                            {sc ? "Desprogramar" : "Programar"}
                          </DropdownMenuItem>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem
                                onSelect={e => e.preventDefault()}
                                className="text-red-600"
                              >
                                <Trash2 className="mr-2 size-4" /> Eliminar
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  ¿Estás absolutamente seguro?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Esta acción no se puede deshacer. Esto
                                  eliminará permanentemente la configuración de
                                  la importación estándar.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteImport(imp.id)}
                                  className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                                >
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    )
  }

  // Formulario del wizard (crear/editar)
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Paso 1 */}
        {currentStep === 1 && (
          <Card className="p-6">
            <CardTitle className="mb-4">1. Información Básica</CardTitle>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la Importación</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ej: Importación Ventas Mensuales"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Un nombre único para identificar esta configuración de
                    importación.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="connectionId"
              render={({ field }) => (
                <FormItem className="mt-4">
                  <FormLabel>Conexión de Datos</FormLabel>
                  <UiSelect
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={connections.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una conexión" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {connections.length === 0 ? (
                        <SelectItem value="no-connection" disabled>
                          No hay conexiones disponibles
                        </SelectItem>
                      ) : (
                        connections.map(conn => (
                          <SelectItem key={conn.id} value={conn.id}>
                            {conn.name} ({conn.connectionType})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </UiSelect>
                  <FormDescription>
                    La fuente de datos de donde se extraerán los valores de KPI.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Card>
        )}

        {/* Paso 2 */}
        {currentStep === 2 && (
          <Card className="p-6">
            <CardTitle className="mb-4">2. Mapeo de KPI</CardTitle>
            <FormDescription className="mb-4">
              Define cómo los campos de tu fuente de datos se corresponden con
              los KPIs de DeltaOne.
            </FormDescription>
            {kpiMappingFields.map((field, index) => (
              <KpiMappingRow
                key={field.id}
                index={index}
                control={form.control}
                kpiOptions={kpiOptions}
                onRemove={() => removeKpiMapping(index)}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                appendKpiMapping({
                  kpiId: "",
                  periodDate: { sourceField: "" },
                  actualValue: { sourceField: "" }
                })
              }
              className="w-full"
            >
              Añadir Mapeo de KPI
            </Button>
            {kpiMappingFields.length === 0 && (
              <p className="text-muted-foreground py-4 text-center">
                Añade al menos un mapeo de KPI.
              </p>
            )}
          </Card>
        )}

        {/* Paso 3 */}
        {currentStep === 3 && (
          <Card className="p-6">
            <CardTitle className="mb-4">3. Transformaciones de Datos</CardTitle>
            <FormDescription className="mb-4">
              Aplica reglas para limpiar, filtrar o modificar los datos antes de
              la importación.
            </FormDescription>
            {form.watch("transformations")?.length ? (
              <ul>
                {form.watch("transformations")?.map((t, i) => (
                  <li key={i} className="mb-2">
                    <span className="font-semibold">{t.type}</span> en campo "
                    {t.field}"
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground py-4 text-center">
                No hay transformaciones configuradas. Puedes añadir
                transformaciones personalizadas en una fase posterior.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled
              className="mt-4 w-full"
            >
              Añadir Transformación (funcionalidad avanzada)
            </Button>
          </Card>
        )}

        {/* Paso 4 */}
        {currentStep === 4 && (
          <Card className="p-6">
            <CardTitle className="mb-4">4. Programación</CardTitle>
            <FormDescription className="mb-4">
              Configura la frecuencia con la que esta importación debe
              ejecutarse automáticamente.
            </FormDescription>
            <FormField
              control={form.control}
              name="scheduleConfig.frequency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Frecuencia</FormLabel>
                  <UiSelect
                    onValueChange={field.onChange}
                    value={field.value || ""}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona la frecuencia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {["daily", "weekly", "monthly", "annually", "custom"].map(
                        freq => (
                          <SelectItem key={freq} value={freq}>
                            {freq}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </UiSelect>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.watch("scheduleConfig")?.frequency && (
              <FormField
                control={form.control}
                name="scheduleConfig.time"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Hora (HH:MM UTC)</FormLabel>
                    <FormControl>
                      <Input
                        type="time"
                        placeholder="HH:MM"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {form.watch("scheduleConfig")?.frequency === "custom" && (
              <FormField
                control={form.control}
                name="scheduleConfig.customCron"
                render={({ field }) => (
                  <FormItem className="mt-4">
                    <FormLabel>Expresión Cron Personalizada</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Ej: 0 0 * * *"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription>
                      Define una expresión Cron para una programación altamente
                      personalizada.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </Card>
        )}

        {/* Navegación */}
        <div className="flex justify-between">
          {currentStep > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={prevStep}
              disabled={isSubmitting}
            >
              <StepBack className="mr-2 size-4" /> Anterior
            </Button>
          )}
          {currentStep < 4 && (
            <Button type="button" onClick={nextStep} disabled={isSubmitting}>
              Siguiente <StepForward className="ml-2 size-4" />
            </Button>
          )}
          {currentStep === 4 && (
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              {isEditMode ? "Guardar Cambios" : "Crear Importación"}
            </Button>
          )}
        </div>
      </form>
    </Form>
  )
}

export default StandardKpiImportWizard
