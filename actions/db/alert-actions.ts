/**
 * @file actions/db/alert-actions.ts
 * @brief Implementa Server Actions para la gestión de alertas en el sistema.
 * @description Este archivo contiene funciones del lado del servidor para crear, actualizar,
 * eliminar y recuperar alertas configuradas en la base de datos. Incluye validaciones
 * específicas para los diferentes tipos de alertas, como recordatorios de actualización
 * de KPI, cambios personalizados en KPI y alertas de KPI en estado "Rojo".
 * Asegura la validación de datos, la autenticación de usuarios y el manejo de errores
 * para garantizar la consistencia y seguridad en las operaciones.
 */

"use server";

import { db } from "@/db/db";
import {
  alertsTable,
  appSettingsTable,
  kpisTable,
  alertTypeEnum,
  SelectAlert,
  SelectAppSetting,
  InsertAlert,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";

const logger = getLogger("alert-actions");

/* -------------------------------------------------------------------------- */
/*                               Utilidades locales                           */
/* -------------------------------------------------------------------------- */

/** Formatea mensajes de error de Zod de forma tipada. */
function formatZodError(err: z.ZodError): string {
  return err.errors.map((e) => e.message).join(", ");
}

/** Helper para obtener el primer elemento de un array o undefined. */
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                              Esquemas de Validación                         */
/* -------------------------------------------------------------------------- */

/** Config de frecuencia de ejecución de una alerta. */
const AlertRunFrequencyConfigSchema = z
  .object({
    type: z.enum(["immediate", "daily", "weekly", "monthly", "once"]),
  })
  .nullable()
  .optional();

/** conditionDetails para 'Update Reminder'. */
const UpdateReminderConditionDetailsSchema = z
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
      .optional(),
  })
  .refine(
    (data) =>
      data.daysBeforeDeadline !== undefined ||
      data.daysAfterDeadline !== undefined,
    {
      message:
        "Debe especificar días antes o después de la fecha límite para el recordatorio.",
      path: ["daysBeforeDeadline", "daysAfterDeadline"],
    },
  );

/** conditionDetails para 'Custom KPI Change'. */
const CustomKpiChangeConditionDetailsSchema = z.object({
  triggerEvent: z.enum(["score_changing", "value_changing"], {
    errorMap: () => ({ message: "Evento disparador inválido." }),
  }),
  operator: z.enum(["gt", "lt", "eq", "ne"], {
    errorMap: () => ({ message: "Operador de comparación inválido." }),
  }),
  thresholdValue: z
    .string()
    .min(1, "El valor de umbral es requerido.")
    .max(255, "El valor de umbral no puede exceder 255 caracteres."),
});

/** Base para crear alertas. */
const CreateAlertBaseSchema = z.object({
  alertType: z.enum(alertTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de alerta inválido." }),
  }),
  kpiId: z.string().uuid("ID de KPI inválido.").nullable().optional(),
  conditionDetails: z.any().nullable().optional(),
  recipientsUserIds: z
    .array(z.string().min(1, "El ID de usuario no puede estar vacío."))
    .nullable()
    .optional(),
  recipientsGroupIds: z
    .array(z.string().uuid("ID de grupo inválido."))
    .nullable()
    .optional(),
  frequencyConfig: AlertRunFrequencyConfigSchema,
});

/** Validación condicional por tipo. */
const validateAlertByType = (
  data: z.infer<typeof CreateAlertBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  if (data.alertType === "Update Reminder") {
    const parsed = UpdateReminderConditionDetailsSchema.safeParse(
      data.conditionDetails,
    );
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Los detalles de la condición para el recordatorio de actualización son inválidos.",
        path: ["conditionDetails"],
      });
    }
    if (data.kpiId !== null && data.kpiId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Las alertas de recordatorio de actualización son de tipo general y no deben estar vinculadas a un KPI específico.",
        path: ["kpiId"],
      });
    }
  } else if (data.alertType === "Custom KPI Change") {
    const parsed = CustomKpiChangeConditionDetailsSchema.safeParse(
      data.conditionDetails,
    );
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Los detalles de la condición para la alerta de cambio de KPI personalizada son inválidos.",
        path: ["conditionDetails"],
      });
    }
    if (data.kpiId === null || data.kpiId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Las alertas de cambio de KPI personalizadas deben estar vinculadas a un KPI específico.",
        path: ["kpiId"],
      });
    }
  } else if (data.alertType === "Red KPI") {
    if (data.kpiId === null || data.kpiId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las alertas de KPI Rojo deben estar vinculadas a un KPI específico.",
        path: ["kpiId"],
      });
    }
  }
};

const createAlertSchema = CreateAlertBaseSchema.superRefine(validateAlertByType);

/** Para update: id requerido, resto parcial. */
const UpdateAlertPayloadSchema = CreateAlertBaseSchema.partial();
const UpdateAlertBaseSchema = z
  .object({
    id: z.string().uuid("ID de alerta inválido."),
  })
  .merge(UpdateAlertPayloadSchema);

const validateUpdateByType = (
  data: z.infer<typeof UpdateAlertBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  if (data.alertType !== undefined) {
    validateAlertByType(
      {
        alertType: data.alertType,
        kpiId: data.kpiId ?? null,
        conditionDetails: data.conditionDetails ?? null,
        recipientsUserIds: data.recipientsUserIds ?? null,
        recipientsGroupIds: data.recipientsGroupIds ?? null,
        frequencyConfig: data.frequencyConfig ?? null,
      } as z.infer<typeof CreateAlertBaseSchema>,
      ctx,
    );
  }
};

const updateAlertSchema = UpdateAlertBaseSchema.superRefine(validateUpdateByType);

/** Toggle 'require note for red KPI'. */
const toggleRequireNoteForRedKpiSchema = z.object({
  enabled: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*                                  Server Actions                            */
/* -------------------------------------------------------------------------- */

export async function createAlertAction(
  data: z.infer<typeof createAlertSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validated = createAlertSchema.safeParse(data);
  if (!validated.success) {
    const errorMessage = formatZodError(validated.error);
    logger.error(`Validation error for createAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const {
    kpiId,
    conditionDetails,
    recipientsUserIds,
    recipientsGroupIds,
    frequencyConfig,
    alertType,
  } = validated.data;

  try {
    if (kpiId) {
      const existingKpi = await firstOrUndefined(
        db.select().from(kpisTable).where(eq(kpisTable.id, kpiId)),
      );
      if (!existingKpi) {
        return fail("KPI asociado no encontrado.");
      }
    }

    const [newAlert] = await db
      .insert(alertsTable)
      .values({
        createdById: userId,
        alertType,
        kpiId: kpiId ?? null,
        conditionDetails: conditionDetails ?? null,
        recipientsUserIds: recipientsUserIds ?? [],
        recipientsGroupIds: recipientsGroupIds ?? [],
        frequencyConfig: frequencyConfig ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    if (!newAlert) {
      return fail("Fallo al crear la alerta. No se devolvió ningún registro.");
    }

    logger.info(`Alert created successfully: ${newAlert.id}`, { newAlert });
    return ok("Alerta creada exitosamente.", newAlert);
  } catch (error) {
    logger.error(
      `Error creating alert: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(
      `Fallo al crear la alerta: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateAlertAction(
  data: z.infer<typeof updateAlertSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validated = updateAlertSchema.safeParse(data);
  if (!validated.success) {
    const errorMessage = formatZodError(validated.error);
    logger.error(`Validation error for updateAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const {
    id,
    kpiId,
    conditionDetails,
    recipientsUserIds,
    recipientsGroupIds,
    frequencyConfig,
    alertType,
  } = validated.data;

  try {
    const existingAlert = await firstOrUndefined(
      db.select().from(alertsTable).where(eq(alertsTable.id, id)),
    );
    if (!existingAlert) {
      return fail("Alerta no encontrada.");
    }

    if (kpiId && kpiId !== existingAlert.kpiId) {
      const existingKpi = await firstOrUndefined(
        db.select().from(kpisTable).where(eq(kpisTable.id, kpiId)),
      );
      if (!existingKpi) {
        return fail("KPI asociado no encontrado.");
      }
    }

    const [updatedAlert] = await db
      .update(alertsTable)
      .set({
        alertType: alertType ?? existingAlert.alertType,
        kpiId: kpiId === undefined ? existingAlert.kpiId : kpiId, // permite setear a null
        conditionDetails:
          conditionDetails === undefined
            ? existingAlert.conditionDetails
            : conditionDetails ?? null,
        recipientsUserIds:
          recipientsUserIds === undefined
            ? existingAlert.recipientsUserIds
            : recipientsUserIds ?? [],
        recipientsGroupIds:
          recipientsGroupIds === undefined
            ? existingAlert.recipientsGroupIds
            : recipientsGroupIds ?? [],
        frequencyConfig:
          frequencyConfig === undefined
            ? existingAlert.frequencyConfig
            : frequencyConfig ?? null,
        updatedAt: new Date(),
      })
      .where(eq(alertsTable.id, id))
      .returning();

    if (!updatedAlert) {
      return fail("Fallo al actualizar la alerta.");
    }

    logger.info(`Alert updated successfully: ${updatedAlert.id}`, { updatedAlert });
    return ok("Alerta actualizada exitosamente.", updatedAlert);
  } catch (error) {
    logger.error(
      `Error updating alert: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(
      `Fallo al actualizar la alerta: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deleteAlertAction(
  id: string,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  if (!z.string().uuid("ID de alerta inválido.").safeParse(id).success) {
    return fail("ID de alerta inválido.");
  }

  try {
    const [deletedAlert] = await db
      .delete(alertsTable)
      .where(eq(alertsTable.id, id))
      .returning({ id: alertsTable.id });

    if (!deletedAlert) {
      return fail("Alerta no encontrada o no se pudo eliminar.");
    }

    logger.info(`Alert deleted successfully: ${id}`);
    return ok("Alerta eliminada exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting alert: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(
      `Fallo al eliminar la alerta: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getAlertByIdAction(
  id: string,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to get alert by ID.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  if (!z.string().uuid("ID de alerta inválido.").safeParse(id).success) {
    return fail("ID de alerta inválido.");
  }

  try {
    const alert = await firstOrUndefined(
      db.select().from(alertsTable).where(eq(alertsTable.id, id)),
    );

    if (!alert) {
      return fail("Alerta no encontrada.");
    }

    return ok("Alerta obtenida exitosamente.", alert);
  } catch (error) {
    logger.error(
      `Error getting alert by ID: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(
      `Fallo al obtener la alerta: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getAllAlertsAction(): Promise<
  ActionState<SelectAlert[]>
> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to get all alerts.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const alerts = await db.select().from(alertsTable);
    return ok("Alertas obtenidas exitosamente.", alerts);
  } catch (error) {
    logger.error(
      `Error getting all alerts: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail(
      `Fallo al obtener las alertas: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Configura un recordatorio global de actualización de KPI (alertType: 'Update Reminder', kpiId: null).
 */
export async function configureKpiUpdateReminderAction(
  data: z.infer<typeof createAlertSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to configure KPI update reminder.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  // Forzamos el tipo y kpiId null (recordatorio global)
  const validated = createAlertSchema.safeParse({
    ...data,
    alertType: "Update Reminder",
    kpiId: null,
  });
  if (!validated.success) {
    const errorMessage = formatZodError(validated.error);
    logger.error(
      `Validation error for configureKpiUpdateReminderAction: ${errorMessage}`,
    );
    return fail(errorMessage);
  }

  const {
    conditionDetails,
    recipientsUserIds,
    recipientsGroupIds,
    frequencyConfig,
  } = validated.data;

  try {
    // Verificar si ya existe el recordatorio global (kpiId IS NULL)
    const existingReminder = await firstOrUndefined(
      db
        .select()
        .from(alertsTable)
        .where(
          and(eq(alertsTable.alertType, "Update Reminder"), isNull(alertsTable.kpiId)),
        ),
    );

    if (existingReminder) {
      const [updated] = await db
        .update(alertsTable)
        .set({
          conditionDetails: conditionDetails ?? null,
          recipientsUserIds: recipientsUserIds ?? [],
          recipientsGroupIds: recipientsGroupIds ?? [],
          frequencyConfig: frequencyConfig ?? null,
          updatedAt: new Date(),
        })
        .where(eq(alertsTable.id, existingReminder.id))
        .returning();

      if (!updated) {
        return fail("No se pudo actualizar el recordatorio existente.");
      }
      logger.info(`KPI Update Reminder updated: ${updated.id}`, { updated });
      return ok("Recordatorio de actualización de KPI configurado.", updated);
    } else {
      const [created] = await db
        .insert(alertsTable)
        .values({
          createdById: userId,
          alertType: "Update Reminder",
          kpiId: null,
          conditionDetails: conditionDetails ?? null,
          recipientsUserIds: recipientsUserIds ?? [],
          recipientsGroupIds: recipientsGroupIds ?? [],
          frequencyConfig: frequencyConfig ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!created) {
        return fail("No se pudo crear el recordatorio de actualización de KPI.");
      }
      logger.info(`KPI Update Reminder created: ${created.id}`, { created });
      return ok("Recordatorio de actualización de KPI configurado.", created);
    }
  } catch (error) {
    logger.error(
      `Error configuring KPI update reminder: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(
      `Fallo al configurar el recordatorio: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Wrappers de conveniencia */
export async function createKpiRedAlertAction(
  data: Omit<z.infer<typeof createAlertSchema>, "alertType">,
): Promise<ActionState<SelectAlert>> {
  const fullData = {
    ...data,
    alertType: "Red KPI" as const,
    conditionDetails: null,
  };
  return createAlertAction(fullData);
}

export async function createCustomKpiAlertAction(
  data: Omit<z.infer<typeof createAlertSchema>, "alertType">,
): Promise<ActionState<SelectAlert>> {
  const fullData = {
    ...data,
    alertType: "Custom KPI Change" as const,
  };
  return createAlertAction(fullData);
}

/** Config global 'require note for red KPI'. */
export async function toggleRequireNoteForRedKpiAction(
  data: z.infer<typeof toggleRequireNoteForRedKpiSchema>,
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to toggle 'require note for red KPI' setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validated = toggleRequireNoteForRedKpiSchema.safeParse(data);
  if (!validated.success) {
    const errorMessage = formatZodError(validated.error);
    logger.error(
      `Validation error for toggleRequireNoteForRedKpiAction: ${errorMessage}`,
    );
    return fail(errorMessage);
  }

  const { enabled } = validated.data;
  const settingKey = "require_note_for_red_kpi";

  try {
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey,
        settingValue: String(enabled),
        settingType: "methodology",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue: String(enabled),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedSetting) {
      return fail(
        "Fallo al actualizar la configuración de requerir nota para KPI en rojo.",
      );
    }

    logger.info(
      `'Require note for red KPI' setting toggled to ${enabled} by user ${userId}`,
      { updatedSetting },
    );
    return ok("Configuración actualizada exitosamente.", updatedSetting);
  } catch (error) {
    logger.error(
      `Error toggling 'require note for red KPI' setting: ${error instanceof Error ? error.message : String(error)}`,
      { settingKey, enabled },
    );
    return fail(
      `Fallo al actualizar la configuración: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
