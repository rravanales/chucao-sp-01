/**
 * @file app/(main)/settings/alerts/_components/alert-settings-form.tsx
 * @brief Componente de cliente para la configuración y gestión de alertas en DeltaOne.
 * @description Este componente proporciona la interfaz de usuario para configurar
 * alertas automáticas para KPIs en estado "Rojo", recordatorios de actualización de KPI,
 * alertas personalizadas basadas en cambios de KPI, y configuraciones globales como
 * requerir notas para KPIs de bajo rendimiento y habilitar alertas por respuestas a notas.
 * Utiliza Server Actions para todas las operaciones CRUD y shadcn/ui para la interfaz.
 * (UC-300, UC-301, UC-302, UC-303, UC-304)
 */

"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"

import {
  createCustomKpiAlertAction,
  createKpiRedAlertAction,
  deleteAlertAction,
  updateAlertAction,
  configureKpiUpdateReminderAction,
  toggleRequireNoteForRedKpiAction
} from "@/actions/db/alert-actions"
import { toggleEnableNoteReplyAlertsAction } from "@/actions/db/app-settings-actions"

import type { KpiSelectOption } from "@/actions/db/kpi-actions"
import {
  SelectAlert,
  SelectGroup,
  SelectProfile,
  alertTypeEnum
} from "@/db/schema"

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

import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"

import { Separator } from "@/components/ui/separator"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"

import {
  Loader2,
  Save,
  PlusCircle,
  Edit,
  Trash2,
  MoreVertical,
  CalendarDays,
  Target,
  FlaskConical,
  MessageSquare,
  MinusCircle,
  Users,
  Settings,
  BellRing
} from "lucide-react"

/* ============================================================================
   PROPS
   ========================================================================== */

interface AlertSettingsFormProps {
  initialAlerts: SelectAlert[]
  allKpis: KpiSelectOption[] // <-- importante: usamos el shape id+name
  allProfiles: SelectProfile[]
  allGroups: SelectGroup[]
  initialRequireNoteForRedKpi: boolean
  initialEnableNoteReplyAlerts: boolean
}

/* ============================================================================
   ZOD: Schemas CLIENTE (alineados al servidor)
   ========================================================================== */

/** Debe reflejar el schema del servidor (actions/db/alert-actions.ts) */
const ClientAlertFrequencySchema = z
  .object({
    type: z.enum(["immediate", "daily", "weekly", "monthly", "once"])
  })
  .nullable()
  .optional()

/** Alias local NO-NULO para trabajar cómodos con frequencyConfig */
type FrequencyConfig = NonNullable<z.infer<typeof ClientAlertFrequencySchema>>

/** Para alertas personalizadas (alineado al servidor) */
const ClientCustomKpiChangeConditionDetailsSchema = z.object({
  triggerEvent: z.enum(["score_changing", "value_changing"], {
    errorMap: () => ({ message: "Evento disparador inválido." })
  }),
  operator: z.enum(["gt", "lt", "eq", "ne"], {
    errorMap: () => ({ message: "Operador de comparación inválido." })
  }),
  thresholdValue: z
    .string()
    .min(1, "El valor de umbral es requerido.")
    .max(255, "El valor de umbral no puede exceder 255 caracteres.")
})

/** Para recordatorio de actualización (alineado al servidor) */
const ClientUpdateReminderConditionDetailsSchema = z
  .object({
    daysBeforeDeadline: z
      .number()
      .int("Debe ser un número entero.")
      .min(0, "No puede ser negativo.")
      .optional(),
    daysAfterDeadline: z
      .number()
      .int("Debe ser un número entero.")
      .min(0, "No puede ser negativo.")
      .optional()
  })
  .refine(
    data =>
      data.daysBeforeDeadline !== undefined ||
      data.daysAfterDeadline !== undefined,
    {
      message:
        "Debes especificar 'daysBeforeDeadline' y/o 'daysAfterDeadline'.",
      path: ["daysBeforeDeadline", "daysAfterDeadline"]
    }
  )

/** Base schema para formularios de alerta de KPI */
const kpiAlertFormSchema = z.object({
  id: z.string().uuid().optional(),
  kpiId: z.string().uuid("Seleccione un KPI válido."),
  alertType: z.enum(["Red KPI", "Custom KPI Change"], {
    errorMap: () => ({ message: "Tipo de alerta inválido." })
  }),
  // Para "Custom KPI Change"
  conditionDetails:
    ClientCustomKpiChangeConditionDetailsSchema.nullable().optional(),
  recipientsUserIds: z.array(z.string().uuid()).optional(),
  recipientsGroupIds: z.array(z.string().uuid()).optional(),
  frequencyConfig: ClientAlertFrequencySchema
})

/** Schema para el formulario de recordatorio global */
const updateReminderFormSchema = z.object({
  id: z.string().uuid().optional(),
  conditionDetails: ClientUpdateReminderConditionDetailsSchema,
  recipientsUserIds: z.array(z.string().uuid()).optional(),
  recipientsGroupIds: z.array(z.string().uuid()).optional(),
  frequencyConfig: ClientAlertFrequencySchema
})

/** Toggles globales */
const generalSettingsFormSchema = z.object({
  requireNoteForRedKpi: z.boolean(),
  enableNoteReplyAlerts: z.boolean()
})

/* ============================================================================
   Sub-componentes
   ========================================================================== */

interface RecipientSelectorProps {
  label: string
  profiles: SelectProfile[]
  groups: SelectGroup[]
  selectedUserIds: string[]
  selectedGroupIds: string[]
  onUsersChange: (ids: string[]) => void
  onGroupsChange: (ids: string[]) => void
  disabled?: boolean
}

/**
 * Selector simple (single select por ahora) que mantiene compatibilidad
 * con arrays en el payload del servidor.
 */
const RecipientSelector: React.FC<RecipientSelectorProps> = ({
  label,
  profiles,
  groups,
  selectedUserIds,
  selectedGroupIds,
  onUsersChange,
  onGroupsChange,
  disabled = false
}) => {
  const singleUser = selectedUserIds?.[0] ?? ""
  const singleGroup = selectedGroupIds?.[0] ?? ""

  return (
    <Card className="bg-muted/50 mt-4 border-dashed">
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormItem>
          <FormLabel>Usuarios Individuales</FormLabel>
          <UiSelect
            onValueChange={value => onUsersChange(value ? [value] : [])}
            value={singleUser}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un usuario" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map(profile => (
                <SelectItem key={profile.userId} value={profile.userId}>
                  {profile.email || profile.userId}
                </SelectItem>
              ))}
            </SelectContent>
          </UiSelect>
          <FormDescription>
            Selecciona (por ahora) un usuario para recibir la alerta.
          </FormDescription>
        </FormItem>

        <FormItem>
          <FormLabel>Grupos de Usuarios</FormLabel>
          <UiSelect
            onValueChange={value => onGroupsChange(value ? [value] : [])}
            value={singleGroup}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un grupo" />
            </SelectTrigger>
            <SelectContent>
              {groups.map(group => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name} ({group.groupType})
                </SelectItem>
              ))}
            </SelectContent>
          </UiSelect>
          <FormDescription>
            Selecciona (por ahora) un grupo para recibir la alerta.
          </FormDescription>
        </FormItem>

        <p className="text-muted-foreground text-xs italic">
          Nota: En esta fase, la selección múltiple se simplifica a uno por
          tipo.
        </p>
      </CardContent>
    </Card>
  )
}

/* ============================================================================
   Diálogo: Crear/Editar alerta de KPI
   ========================================================================== */

interface KpiAlertFormDialogProps {
  initialAlert?: SelectAlert | null
  allKpis: KpiSelectOption[]
  allProfiles: SelectProfile[]
  allGroups: SelectGroup[]
  onSuccess: () => void
  onClose: () => void
}

const KpiAlertFormDialog: React.FC<KpiAlertFormDialogProps> = ({
  initialAlert,
  allKpis,
  allProfiles,
  allGroups,
  onSuccess,
  onClose
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEditMode = !!initialAlert

  const form = useForm<z.infer<typeof kpiAlertFormSchema>>({
    resolver: zodResolver(kpiAlertFormSchema),
    defaultValues: {
      id: initialAlert?.id || undefined,
      kpiId: initialAlert?.kpiId || "",
      alertType:
        initialAlert?.alertType === "Red KPI" ||
        initialAlert?.alertType === "Custom KPI Change"
          ? initialAlert.alertType
          : "Red KPI",
      conditionDetails:
        (initialAlert?.alertType === "Custom KPI Change"
          ? ((initialAlert?.conditionDetails as any) ?? undefined)
          : null) ?? undefined,
      recipientsUserIds: (initialAlert?.recipientsUserIds as string[]) ?? [],
      recipientsGroupIds: (initialAlert?.recipientsGroupIds as string[]) ?? [],
      frequencyConfig:
        (initialAlert?.frequencyConfig as { type: any } | null | undefined) ??
        undefined
    }
  })

  const alertType = form.watch("alertType")

  useEffect(() => {
    if (alertType === "Red KPI") {
      form.setValue("conditionDetails", null)
    }
  }, [alertType, form])

  const onSubmit = async (values: z.infer<typeof kpiAlertFormSchema>) => {
    setIsSubmitting(true)

    const payload = {
      kpiId: values.kpiId,
      recipientsUserIds: values.recipientsUserIds ?? [],
      recipientsGroupIds: values.recipientsGroupIds ?? [],
      frequencyConfig: values.frequencyConfig ?? null,
      conditionDetails:
        values.alertType === "Custom KPI Change"
          ? (values.conditionDetails ?? null)
          : null
    }

    try {
      if (isEditMode && initialAlert) {
        const result = await updateAlertAction({
          id: initialAlert.id,
          alertType: values.alertType,
          ...payload
        })
        if (result.isSuccess) {
          toast({
            title: "Éxito",
            description: "Alerta de KPI actualizada correctamente."
          })
          onSuccess()
          onClose()
        } else {
          toast({
            title: "Error",
            description: result.message,
            variant: "destructive"
          })
        }
      } else {
        if (values.alertType === "Red KPI") {
          const res = await createKpiRedAlertAction(payload)
          if (res.isSuccess) {
            toast({
              title: "Éxito",
              description: "Alerta de KPI creada correctamente."
            })
            onSuccess()
            onClose()
          } else {
            toast({
              title: "Error",
              description: res.message,
              variant: "destructive"
            })
          }
        } else if (values.alertType === "Custom KPI Change") {
          const res = await createCustomKpiAlertAction(payload)
          if (res.isSuccess) {
            toast({
              title: "Éxito",
              description: "Alerta personalizada creada correctamente."
            })
            onSuccess()
            onClose()
          } else {
            toast({
              title: "Error",
              description: res.message,
              variant: "destructive"
            })
          }
        } else {
          toast({
            title: "Error",
            description: "Tipo de alerta no soportado.",
            variant: "destructive"
          })
        }
      }
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
        <FormField
          control={form.control}
          name="alertType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de Alerta</FormLabel>
              <UiSelect
                onValueChange={field.onChange}
                value={field.value}
                disabled={isSubmitting || isEditMode}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo de alerta" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Red KPI">KPI Rojo</SelectItem>
                  <SelectItem value="Custom KPI Change">
                    Cambio de KPI Personalizado
                  </SelectItem>
                </SelectContent>
              </UiSelect>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="kpiId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>KPI a Monitorear</FormLabel>
              <UiSelect
                onValueChange={field.onChange}
                value={field.value}
                disabled={isSubmitting || allKpis.length === 0}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un KPI" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {allKpis.length === 0 ? (
                    <SelectItem value="no-kpi" disabled>
                      No hay KPIs disponibles
                    </SelectItem>
                  ) : (
                    allKpis.map(kpi => (
                      <SelectItem key={kpi.id} value={kpi.id}>
                        {kpi.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </UiSelect>
              <FormDescription>
                La alerta se activará para este Indicador Clave de Rendimiento.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {alertType === "Custom KPI Change" && (
          <FormField
            control={form.control}
            name="conditionDetails"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Condiciones Personalizadas (JSON)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={`Ej: {"triggerEvent":"score_changing","operator":"lt","thresholdValue":"50"}`}
                    value={
                      field.value ? JSON.stringify(field.value, null, 2) : ""
                    }
                    onChange={e => {
                      try {
                        const parsed = JSON.parse(e.target.value)
                        ClientCustomKpiChangeConditionDetailsSchema.parse(
                          parsed
                        )
                        field.onChange(parsed)
                      } catch {
                        // Mantener como string inválido para que el usuario lo corrija
                        field.onChange(undefined)
                      }
                    }}
                    className="font-mono"
                  />
                </FormControl>
                <FormDescription>
                  Define las condiciones del disparo. Estructura válida:{" "}
                  <code>{"{ triggerEvent, operator, thresholdValue }"}</code>.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="frequencyConfig"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Frecuencia de Notificación</FormLabel>
              <UiSelect
                onValueChange={value => {
                  // value es el string del enum; lo convertimos a objeto { type }
                  if (!value) {
                    field.onChange(undefined)
                  } else {
                    field.onChange({ type: value as FrequencyConfig["type"] })
                  }
                }}
                value={
                  (field.value as FrequencyConfig | null | undefined)?.type ??
                  ""
                }
                disabled={isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona la frecuencia" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="immediate">Inmediata</SelectItem>
                  <SelectItem value="daily">Diaria</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="once">Una vez</SelectItem>
                </SelectContent>
              </UiSelect>
              <FormDescription>
                Con qué frecuencia se verifica/ejecuta la alerta.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <RecipientSelector
          label="Destinatarios de la Alerta"
          profiles={allProfiles}
          groups={allGroups}
          selectedUserIds={form.watch("recipientsUserIds") ?? []}
          selectedGroupIds={form.watch("recipientsGroupIds") ?? []}
          onUsersChange={ids => form.setValue("recipientsUserIds", ids)}
          onGroupsChange={ids => form.setValue("recipientsGroupIds", ids)}
          disabled={isSubmitting}
        />

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}{" "}
          {isEditMode ? "Guardar Cambios" : "Crear Alerta"}
        </Button>
      </form>
    </Form>
  )
}

/* ============================================================================
   Formulario: Recordatorio global de actualización de KPI
   ========================================================================== */

interface KpiUpdateReminderFormProps {
  initialAlert?: SelectAlert | null
  allProfiles: SelectProfile[]
  allGroups: SelectGroup[]
  onSuccess: () => void
}

const KpiUpdateReminderForm: React.FC<KpiUpdateReminderFormProps> = ({
  initialAlert,
  allProfiles,
  allGroups,
  onSuccess
}) => {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<z.infer<typeof updateReminderFormSchema>>({
    resolver: zodResolver(updateReminderFormSchema),
    defaultValues: {
      id: initialAlert?.id || undefined,
      conditionDetails: ((initialAlert?.conditionDetails as any) ?? {
        daysBeforeDeadline: 1,
        daysAfterDeadline: 0
      }) as z.infer<typeof ClientUpdateReminderConditionDetailsSchema>,
      recipientsUserIds: (initialAlert?.recipientsUserIds as string[]) ?? [],
      recipientsGroupIds: (initialAlert?.recipientsGroupIds as string[]) ?? [],
      frequencyConfig: (initialAlert?.frequencyConfig as
        | { type: any }
        | null
        | undefined) ?? { type: "daily" }
    }
  })

  const onSubmit = async (values: z.infer<typeof updateReminderFormSchema>) => {
    setIsSubmitting(true)
    try {
      const result = await configureKpiUpdateReminderAction({
        alertType: "Update Reminder",
        kpiId: null,
        conditionDetails: values.conditionDetails,
        recipientsUserIds: values.recipientsUserIds ?? [],
        recipientsGroupIds: values.recipientsGroupIds ?? [],
        frequencyConfig: values.frequencyConfig ?? null
      })

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description: "Recordatorio de actualización de KPI configurado."
        })
        onSuccess()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        })
      }
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const freq = form.watch("frequencyConfig")

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
        <Card className="bg-muted/50 border-dashed">
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="size-4" /> Configuración del Recordatorio
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="conditionDetails.daysBeforeDeadline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Días Antes del Vencimiento</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Ej: 1"
                      value={field.value ?? ""}
                      onChange={e =>
                        field.onChange(
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                        )
                      }
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    Número de días antes del final del período para enviar el
                    recordatorio.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="conditionDetails.daysAfterDeadline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Días Después del Vencimiento</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="Ej: 0"
                      value={field.value ?? ""}
                      onChange={e =>
                        field.onChange(
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                        )
                      }
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    Días después del fin del período, si el KPI sigue sin
                    actualizarse.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <FormField
          control={form.control}
          name="frequencyConfig"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Frecuencia de Envío</FormLabel>
              <UiSelect
                onValueChange={value => {
                  if (!value) field.onChange(undefined)
                  else
                    field.onChange({ type: value as FrequencyConfig["type"] })
                }}
                value={
                  (field.value as FrequencyConfig | null | undefined)?.type ??
                  ""
                }
                disabled={isSubmitting}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona la frecuencia" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="daily">Diaria</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="once">Una vez</SelectItem>
                </SelectContent>
              </UiSelect>
              <FormDescription>
                Con qué frecuencia el sistema verificará y enviará
                recordatorios.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <RecipientSelector
          label="Destinatarios del Recordatorio (además de Updaters)"
          profiles={allProfiles}
          groups={allGroups}
          selectedUserIds={form.watch("recipientsUserIds") ?? []}
          selectedGroupIds={form.watch("recipientsGroupIds") ?? []}
          onUsersChange={ids => form.setValue("recipientsUserIds", ids)}
          onGroupsChange={ids => form.setValue("recipientsGroupIds", ids)}
          disabled={isSubmitting}
        />

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-1">
            <FormLabel>Vista previa</FormLabel>
            <p className="text-muted-foreground text-xs">
              Frecuencia:{" "}
              <span className="font-medium">
                {(freq as FrequencyConfig | null | undefined)?.type ?? "—"}
              </span>
            </p>
          </div>
          <div className="text-muted-foreground text-right text-xs">
            (Los horarios exactos se definirán a futuro)
          </div>
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}{" "}
          Guardar Configuración
        </Button>
      </form>
    </Form>
  )
}

/* ============================================================================
   Componente principal
   ========================================================================== */

const AlertSettingsForm: React.FC<AlertSettingsFormProps> = ({
  initialAlerts,
  allKpis,
  allProfiles,
  allGroups,
  initialRequireNoteForRedKpi,
  initialEnableNoteReplyAlerts
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmittingGeneral, setIsSubmittingGeneral] = useState(false)

  const kpiAlerts = initialAlerts.filter(
    alert =>
      alert.alertType === "Red KPI" || alert.alertType === "Custom KPI Change"
  )
  const updateReminderAlert = initialAlerts.find(
    alert => alert.alertType === "Update Reminder"
  )

  const generalForm = useForm<z.infer<typeof generalSettingsFormSchema>>({
    resolver: zodResolver(generalSettingsFormSchema),
    defaultValues: {
      requireNoteForRedKpi: !!initialRequireNoteForRedKpi,
      enableNoteReplyAlerts: !!initialEnableNoteReplyAlerts
    }
  })

  const onGeneralSettingsSubmit = async (
    values: z.infer<typeof generalSettingsFormSchema>
  ) => {
    setIsSubmittingGeneral(true)
    try {
      const [res1, res2] = await Promise.all([
        toggleRequireNoteForRedKpiAction({
          enabled: values.requireNoteForRedKpi
        }),
        toggleEnableNoteReplyAlertsAction({
          enabled: values.enableNoteReplyAlerts
        })
      ])

      const allSuccess = res1.isSuccess && res2.isSuccess

      if (allSuccess) {
        toast({
          title: "Éxito",
          description: "Configuración general de alertas actualizada."
        })
        router.refresh()
      } else {
        toast({
          title: "Error",
          description: res1.isSuccess ? res2.message : res1.message,
          variant: "destructive"
        })
      }
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive"
      })
    } finally {
      setIsSubmittingGeneral(false)
    }
  }

  const handleAlertDelete = async (id: string) => {
    const result = await deleteAlertAction(id)
    if (result.isSuccess) {
      toast({ title: "Éxito", description: "Alerta eliminada correctamente." })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  // Control de diálogos por alerta (para no usar hacks)
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null)

  return (
    <Tabs defaultValue="general" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="general" className="flex items-center gap-2">
          <Settings className="size-4" /> General
        </TabsTrigger>
        <TabsTrigger value="kpi-alerts" className="flex items-center gap-2">
          <Target className="size-4" /> Alertas de KPI
        </TabsTrigger>
        <TabsTrigger
          value="update-reminders"
          className="flex items-center gap-2"
        >
          <CalendarDays className="size-4" /> Recordatorios
        </TabsTrigger>
      </TabsList>

      {/* GENERAL */}
      <TabsContent value="general" className="py-4">
        <Card>
          <CardHeader>
            <CardTitle>Configuración General de Alertas</CardTitle>
            <CardDescription>
              Gestiona ajustes de alertas que aplican a toda la aplicación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...generalForm}>
              <form
                onSubmit={generalForm.handleSubmit(onGeneralSettingsSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={generalForm.control}
                  name="requireNoteForRedKpi"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Requerir Nota en KPI Rojo
                        </FormLabel>
                        <FormDescription>
                          Al actualizar un KPI a estado rojo se exigirá una
                          nota.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmittingGeneral}
                          aria-label="Requerir nota en KPI rojo"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={generalForm.control}
                  name="enableNoteReplyAlerts"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          Habilitar Alertas por Respuestas a Notas
                        </FormLabel>
                        <FormDescription>
                          Envía una notificación al autor de una nota cuando
                          alguien responde a la misma.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSubmittingGeneral}
                          aria-label="Habilitar alertas por respuestas a notas"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isSubmittingGeneral}>
                  {isSubmittingGeneral ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 size-4" />
                  )}{" "}
                  Guardar Configuración General
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </TabsContent>

      {/* KPI ALERTS */}
      <TabsContent value="kpi-alerts" className="py-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Alertas Específicas de KPI</h2>
          <Dialog
            open={editingAlertId === "__new__"}
            onOpenChange={open => {
              setEditingAlertId(open ? "__new__" : null)
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setEditingAlertId("__new__")}>
                <PlusCircle className="mr-2 size-4" /> Nueva Alerta de KPI
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Crear Nueva Alerta de KPI</DialogTitle>
                <DialogDescription>
                  Define una alerta para monitorear un KPI específico.
                </DialogDescription>
              </DialogHeader>
              <KpiAlertFormDialog
                allKpis={allKpis}
                allProfiles={allProfiles}
                allGroups={allGroups}
                onSuccess={() => router.refresh()}
                onClose={() => setEditingAlertId(null)}
              />
            </DialogContent>
          </Dialog>
        </div>
        <Separator className="mb-4" />
        {kpiAlerts.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">
            No hay alertas de KPI configuradas.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {kpiAlerts.map(alert => {
              const kpiName = alert.kpiId
                ? (allKpis.find(k => k.id === alert.kpiId)?.name ??
                  "Desconocido")
                : "—"
              return (
                <Card key={alert.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                      {alert.alertType === "Red KPI" && (
                        <MinusCircle className="size-4 text-red-500" />
                      )}
                      {alert.alertType === "Custom KPI Change" && (
                        <FlaskConical className="size-4 text-orange-500" />
                      )}
                      {alert.alertType}
                    </CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="size-8 p-0">
                          <span className="sr-only">Abrir menú</span>
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <Dialog
                          open={editingAlertId === alert.id}
                          onOpenChange={open => {
                            setEditingAlertId(open ? alert.id : null)
                          }}
                        >
                          <DialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={e => e.preventDefault()}
                            >
                              <Edit className="mr-2 size-4" /> Editar
                            </DropdownMenuItem>
                          </DialogTrigger>
                          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
                            <DialogHeader>
                              <DialogTitle>Editar Alerta de KPI</DialogTitle>
                              <DialogDescription>
                                Modifica la configuración de esta alerta de KPI.
                              </DialogDescription>
                            </DialogHeader>
                            <KpiAlertFormDialog
                              initialAlert={alert}
                              allKpis={allKpis}
                              allProfiles={allProfiles}
                              allGroups={allGroups}
                              onSuccess={() => router.refresh()}
                              onClose={() => setEditingAlertId(null)}
                            />
                          </DialogContent>
                        </Dialog>

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
                                Esta acción no se puede deshacer. Eliminará
                                permanentemente la configuración de la alerta.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleAlertDelete(alert.id)}
                                className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                              >
                                Eliminar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm">
                      KPI: <span className="font-semibold">{kpiName}</span>
                    </p>
                    {alert.alertType === "Custom KPI Change" &&
                      !!alert.conditionDetails && (
                        <p className="text-muted-foreground text-xs">
                          Condición:{" "}
                          {(() => {
                            const s = JSON.stringify(alert.conditionDetails)
                            return s.length > 80 ? s.slice(0, 80) + "…" : s
                          })()}
                        </p>
                      )}
                    <p className="text-muted-foreground text-xs">
                      Destinatarios:{" "}
                      {(alert.recipientsUserIds as string[])?.length ?? 0}{" "}
                      usuarios,{" "}
                      {(alert.recipientsGroupIds as string[])?.length ?? 0}{" "}
                      grupos.
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </TabsContent>

      {/* UPDATE REMINDERS */}
      <TabsContent value="update-reminders" className="py-4">
        <Card>
          <CardHeader>
            <CardTitle>
              Configuración de Recordatorios de Actualización
            </CardTitle>
            <CardDescription>
              Define cuándo y a quién se enviarán los recordatorios para
              actualizar los valores de KPI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <KpiUpdateReminderForm
              initialAlert={updateReminderAlert || null}
              allProfiles={allProfiles}
              allGroups={allGroups}
              onSuccess={() => router.refresh()}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

export default AlertSettingsForm
