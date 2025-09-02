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
  appSettingTypeEnum,
  InsertAlert,
  SelectAlert,
  SelectAppSetting,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";

const logger = getLogger("alert-actions");

/**
 * Formatea mensajes de error de Zod de forma tipada.
 */
function formatZodError(err: z.ZodError): string {
  return err.errors.map((e: z.ZodIssue) => e.message).join(", ");
}


/**
 * Helper para obtener el primer elemento de un array o undefined.
 * @template T El tipo de los elementos en el array.
 * @param {Promise<T[]>} q La promesa que resuelve en un array de elementos.
 * @returns {Promise<T | undefined>} El primer elemento del array o undefined si el array está vacío.
 */
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                              Esquemas de Validación Zod                      */
/* -------------------------------------------------------------------------- */

/**
 * @schema AlertRunFrequencyConfigSchema
 * @description Esquema Zod para la configuración de la frecuencia de ejecución de una alerta.
 * Define la periodicidad con la que el sistema debe verificar y potencialmente disparar la alerta.
 */
const AlertRunFrequencyConfigSchema = z.object({
  type: z.enum(["immediate", "daily", "weekly", "monthly", "once"]),
  // Campos adicionales para configuraciones más granulares podrían añadirse aquí si se requiere.
  // Por ejemplo, `timeOfDay: z.string().regex(/^(\d|2):(\d)$/)` para alertas diarias a una hora específica.
}).nullable().optional();

/**
 * @schema UpdateReminderConditionDetailsSchema
 * @description Esquema Zod para los `conditionDetails` de las alertas de tipo 'Update Reminder'.
 * Define el umbral de días antes o después de la fecha límite de actualización de un KPI para enviar el recordatorio.
 */
const UpdateReminderConditionDetailsSchema = z.object({
  daysBeforeDeadline: z.number().int("Debe ser un número entero.").min(0, "No puede ser negativo.").optional(),
  daysAfterDeadline: z.number().int("Debe ser un número entero.").min(0, "No puede ser negativo.").optional(),
}).refine(data => data.daysBeforeDeadline !== undefined || data.daysAfterDeadline !== undefined, {
  message: "Debe especificar días antes o después de la fecha límite para el recordatorio.",
  path: ["daysBeforeDeadline", "daysAfterDeadline"],
});

/**
 * @schema CustomKpiChangeConditionDetailsSchema
 * @description Esquema Zod para los `conditionDetails` de las alertas de tipo 'Custom KPI Change'.
 * Permite definir condiciones más complejas para el disparo de la alerta.
 */
const CustomKpiChangeConditionDetailsSchema = z.object({
  triggerEvent: z.enum(["score_changing", "value_changing"], { errorMap: () => ({ message: "Evento disparador inválido." }) }),
  operator: z.enum(["gt", "lt", "eq", "ne"], { errorMap: () => ({ message: "Operador de comparación inválido." }) }),
  thresholdValue: z.string().min(1, "El valor de umbral es requerido.").max(255, "El valor de umbral no puede exceder 255 caracteres."),
  // Podrían añadirse más campos para definir un porcentaje de cambio, un rango, etc.
});

/**
 * @schema CreateAlertBaseSchema
 * @description Esquema de validación para la creación de una nueva alerta.
 * Incluye validaciones condicionales para `kpiId` y `conditionDetails`
 * basándose en el `alertType`.
 * @property {z.infer<typeof alertTypeEnum>} alertType - Tipo de alerta, requerido.
 * @property {string | null | undefined} kpiId - ID del KPI asociado, opcional para algunos tipos de alerta.
 * @property {any | null | undefined} conditionDetails - Detalles de la condición, varía según `alertType`.
 * @property {string[] | null | undefined} recipientsUserIds - Array de IDs de usuario receptores, opcional.
 * @property {string[] | null | undefined} recipientsGroupIds - Array de IDs de grupo receptores, opcional.
 * @property {z.infer<typeof AlertRunFrequencyConfigSchema>} frequencyConfig - Configuración de frecuencia, opcional.
 */
const CreateAlertBaseSchema = z.object({
  alertType: z.enum(alertTypeEnum.enumValues, { errorMap: () => ({ message: "Tipo de alerta inválido." }) }),
  kpiId: z.string().uuid("ID de KPI inválido.").nullable().optional(),
  conditionDetails: z.any().nullable().optional(), // Flexible JSONB for now, refined by superRefine
  recipientsUserIds: z.array(z.string().min(1, "El ID de usuario no puede estar vacío.")).nullable().optional(),
  recipientsGroupIds: z.array(z.string().uuid("ID de grupo inválido.")).nullable().optional(),
  frequencyConfig: AlertRunFrequencyConfigSchema,
});

/**
 * Valida campos condicionalmente según el tipo de alerta.
 * Se reutiliza en create y update para evitar ZodEffects al extender.
 */
//const validateAlertByType = (data: z.infer<typeof CreateAlertBaseSchema>, ctx: z.RefinementCtx) => {
const validateAlertByType = (data: z.infer<typeof CreateAlertBaseSchema>, ctx: z.RefinementCtx) => {
  // Validate conditionDetails based on alertType
  if (data.alertType === "Update Reminder") {
    const parsed = UpdateReminderConditionDetailsSchema.safeParse(data.conditionDetails);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los detalles de la condición para el recordatorio de actualización son inválidos.",
        path: ["conditionDetails"],
      });
    }
    if (data.kpiId !== null && data.kpiId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las alertas de recordatorio de actualización son de tipo general y no deben estar vinculadas a un KPI específico.",
        path: ["kpiId"],
      });
    }
  } else if (data.alertType === "Custom KPI Change") {
    const parsed = CustomKpiChangeConditionDetailsSchema.safeParse(data.conditionDetails);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los detalles de la condición para la alerta de cambio de KPI personalizada son inválidos.",
        path: ["conditionDetails"],
      });
    }
    if (data.kpiId === null || data.kpiId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las alertas de cambio de KPI personalizadas deben estar vinculadas a un KPI específico.",
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
    // No specific conditionDetails validation for 'Red KPI' itself, as the 'red' state is implicit from KPI config
  }
  // For 'Note Reply', kpiId can be null (general notes) or specific.
  // conditionDetails can be null for 'Red KPI' and 'Note Reply'.
};

/**
 * @schema createAlertSchema
 * Igual que el base, pero con validación condicional aplicada.
 */
const createAlertSchema = CreateAlertBaseSchema.superRefine(validateAlertByType);

/**
 * Para update: id requerido, resto parcial.
 * alertType es opcional aquí; validamos solo si viene.
 */
const UpdateAlertPayloadSchema = CreateAlertBaseSchema.partial();
const UpdateAlertBaseSchema = z
  .object({
    id: z.string().uuid("ID de alerta inválido."),
  })
  .merge(UpdateAlertPayloadSchema);

const validateUpdateByType = (data: z.infer<typeof UpdateAlertBaseSchema>, ctx: z.RefinementCtx) => {
  // Solo ejecuta validación condicional si viene alertType en el payload
  if (data.alertType !== undefined) {
    // Adaptamos el tipo parcial a uno “completo” para reusar la misma lógica
    // Asumimos que los campos faltantes no rompen validateAlertByType (usa checks defensivos)
    validateAlertByType(
      {
        alertType: data.alertType,
        kpiId: data.kpiId ?? null,
        conditionDetails: data.conditionDetails ?? null,
        recipientsUserIds: data.recipientsUserIds ?? null,
        recipientsGroupIds: data.recipientsGroupIds ?? null,
        frequencyConfig: data.frequencyConfig ?? null,
      } as z.infer<typeof CreateAlertBaseSchema>,
      ctx
    );
  }
};

 
/**
 * @schema updateAlertSchema
 * @description Esquema de validación para la actualización de una alerta existente.
 * Permite actualizaciones parciales y hereda las validaciones condicionales de `createAlertSchema`.
 * @property {string} id - ID de la alerta a actualizar, UUID requerido.
 */

const updateAlertSchema = UpdateAlertBaseSchema.superRefine(validateUpdateByType);


/**
 * @schema deleteAlertSchema
 * @description Esquema de validación para la eliminación de una alerta por su ID.
 * @property {string} id - ID de la alerta a eliminar, UUID requerido.
 */
const deleteAlertSchema = z.object({
  id: z.string().uuid("ID de alerta inválido."),
});

/**
 * @schema getAlertByIdSchema
 * @description Esquema de validación para obtener una alerta por su ID.
 * @property {string} id - ID de la alerta a recuperar, UUID requerido.
 */
const getAlertByIdSchema = z.object({
  id: z.string().uuid("ID de alerta inválido."),
});

/**
 * @schema toggleRequireNoteForRedKpiSchema
 * @description Esquema de validación para activar o desactivar la configuración global
 * que requiere una nota al actualizar un KPI a un estado "Rojo" (UC-303).
 * @property {boolean} enabled - El estado deseado para la configuración (true para activar, false para desactivar).
 */
const toggleRequireNoteForRedKpiSchema = z.object({
  enabled: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*                                 Server Actions                             */
/* -------------------------------------------------------------------------- */

/**
 * @function createAlertAction
 * @description Crea una nueva configuración de alerta en la base de datos (UC-300, UC-302, UC-304).
 * Esta acción es general y permite crear cualquier tipo de alerta definido, con
 * validaciones específicas para `kpiId` y `conditionDetails` basadas en el `alertType`.
 * @param {z.infer<typeof createAlertSchema>} data - Objeto con los datos de la nueva alerta.
 * @returns {Promise<ActionState<SelectAlert>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function createAlertAction(
  data: z.infer<typeof createAlertSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = createAlertSchema.safeParse(data);
  if (!validatedData.success) {
    //const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for createAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { kpiId, conditionDetails, recipientsUserIds, recipientsGroupIds, frequencyConfig, alertType } = validatedData.data;

  try {
    // Check if KPI exists if kpiId is provided
    if (kpiId) {
      const existingKpi = await firstOrUndefined(
        db.select().from(kpisTable).where(eq(kpisTable.id, kpiId))
      );
      if (!existingKpi) {
        return fail("KPI asociado no encontrado.");
      }
    }

    const newAlert: InsertAlert = {
      alertType: alertType,
      kpiId: kpiId ?? null,
      conditionDetails: conditionDetails ?? null,
      recipientsUserIds: recipientsUserIds || [], // Convert null/undefined to empty array for JSONB default
      recipientsGroupIds: recipientsGroupIds || [], // Convert null/undefined to empty array for JSONB default
      frequencyConfig: frequencyConfig ?? null,
      createdById: userId,
    };

    const [createdAlert] = await db.insert(alertsTable).values(newAlert).returning();

    if (!createdAlert) {
      return fail("Fallo al crear la alerta.");
    }

    logger.info(`Alert created successfully: ${createdAlert.id}`, { createdAlert });
    return ok("Alerta creada exitosamente.", createdAlert);
  } catch (error) {
    logger.error(
      `Error creating alert: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al crear la alerta: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function configureKpiUpdateReminderAction
 * @description Configura un recordatorio global de actualización de KPI (UC-301).
 * Esta acción crea o actualiza una alerta de tipo 'Update Reminder' con `kpiId` nulo,
 * y los detalles de la configuración del recordatorio se almacenan en `conditionDetails`.
 * Solo puede existir una alerta de 'Update Reminder' de tipo general (kpiId es nulo).
 * @param {z.infer<typeof createAlertSchema>} data - Objeto con los datos de la configuración del recordatorio.
 * Se espera `alertType: 'Update Reminder'`.
 * @returns {Promise<ActionState<SelectAlert>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function configureKpiUpdateReminderAction(
  data: z.infer<typeof createAlertSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to configure KPI update reminder.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  // Ensure alertType is 'Update Reminder' and kpiId is null
  const validatedData = createAlertSchema.safeParse({
    ...data,
    alertType: "Update Reminder",
    kpiId: null, // Force kpiId to null for global reminder
  });

  if (!validatedData.success) {
    //const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    const errorMessage = formatZodError(validatedData.error);    
    logger.error(`Validation error for configureKpiUpdateReminderAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { conditionDetails, recipientsUserIds, recipientsGroupIds, frequencyConfig } = validatedData.data;

  try {
    // Check for existing global 'Update Reminder' alert
    const existingReminder = await firstOrUndefined(
      db.select().from(alertsTable).where(
        and(
          eq(alertsTable.alertType, "Update Reminder"),
          isNull(alertsTable.kpiId),
        )
      )
    );

    let configuredAlert: SelectAlert;

    const alertPayload: Omit<InsertAlert, 'id' | 'createdAt' | 'updatedAt' | 'createdById'> = {
      alertType: "Update Reminder",
      kpiId: null,
      conditionDetails: conditionDetails ?? null,
      recipientsUserIds: recipientsUserIds || [],
      recipientsGroupIds: recipientsGroupIds || [],
      frequencyConfig: frequencyConfig ?? null,
    };

    if (existingReminder) {
      // Update existing
      const [updatedAlert] = await db
        .update(alertsTable)
        .set({ ...alertPayload, updatedAt: new Date() })
        .where(eq(alertsTable.id, existingReminder.id))
        .returning();
      configuredAlert = updatedAlert;
      logger.info(`KPI update reminder updated successfully: ${configuredAlert.id}`, { configuredAlert });
      return ok("Recordatorio de actualización de KPI configurado exitosamente.", configuredAlert);
    } else {
      // Create new
      const [newAlert] = await db.insert(alertsTable).values({
        ...alertPayload,
        createdById: userId,
      }).returning();
      configuredAlert = newAlert;
      logger.info(`KPI update reminder created successfully: ${configuredAlert.id}`, { configuredAlert });
      return ok("Recordatorio de actualización de KPI creado exitosamente.", configuredAlert);
    }
  } catch (error) {
    logger.error(
      `Error configuring KPI update reminder: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al configurar el recordatorio de actualización de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function toggleRequireNoteForRedKpiAction
 * @description Activa o desactiva la configuración global para requerir una nota
 * al actualizar un KPI a un estado de bajo rendimiento (UC-303).
 * Actualiza la tabla `app_settings` con la clave `require_note_for_red_kpi`.
 * @param {z.infer<typeof toggleRequireNoteForRedKpiSchema>} data - Objeto con el estado `enabled` deseado.
 * @returns {Promise<ActionState<SelectAppSetting>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function toggleRequireNoteForRedKpiAction(
  data: z.infer<typeof toggleRequireNoteForRedKpiSchema>,
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to toggle 'require note for red KPI' setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = toggleRequireNoteForRedKpiSchema.safeParse(data);
  if (!validatedData.success) {
//    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for toggleRequireNoteForRedKpiAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { enabled } = validatedData.data;
  const settingKey = "require_note_for_red_kpi";

  try {
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey: settingKey,
        settingValue: String(enabled), // Store boolean as string 'true' or 'false'
        settingType: "methodology", // As per technical spec, this is a methodology setting
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
      return fail("Fallo al actualizar la configuración de requerir nota para KPI en Rojo.");
    }

    logger.info(`'Require note for red KPI' setting toggled to ${enabled}.`, { updatedSetting });
    return ok(`Configuración de requerir nota para KPI en Rojo actualizada a ${enabled}.`, updatedSetting);
  } catch (error) {
    logger.error(
      `Error toggling 'require note for red KPI' setting: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al actualizar la configuración: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getAlertAction
 * @description Obtiene una alerta específica por su ID.
 * Verifica la autenticación del usuario.
 * @param {z.infer<typeof getAlertByIdSchema>} data - Objeto con el ID de la alerta a recuperar.
 * @returns {Promise<ActionState<SelectAlert>>} Un objeto ActionState con la alerta encontrada o un mensaje de error.
 */
export async function getAlertAction(
  data: z.infer<typeof getAlertByIdSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = getAlertByIdSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for getAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id } = validatedData.data;

  try {
    const alert = await firstOrUndefined(
      db.select().from(alertsTable).where(eq(alertsTable.id, id))
    );

    if (!alert) {
      return fail("Alerta no encontrada.");
    }

    logger.info(`Alert retrieved successfully: ${alert.id}`, { alert });
    return ok("Alerta obtenida exitosamente.", alert);
  } catch (error) {
    logger.error(
      `Error retrieving alert: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(`Fallo al obtener la alerta: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getAlertsAction
 * @description Obtiene una lista de todas las alertas configuradas.
 * Verifica la autenticación del usuario.
 * @returns {Promise<ActionState<SelectAlert[]>>} Un objeto ActionState con la lista de alertas o un mensaje de error.
 */
export async function getAlertsAction(): Promise<ActionState<SelectAlert[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve all alerts.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const alerts = await db.select().from(alertsTable);

    logger.info(`Retrieved ${alerts.length} alerts.`);
    return ok("Alertas obtenidas exitosamente.", alerts);
  } catch (error) {
    logger.error(
      `Error retrieving all alerts: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail(`Fallo al obtener todas las alertas: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function updateAlertAction
 * @description Actualiza una configuración de alerta existente (UC-300, UC-302, UC-304).
 * Permite la actualización parcial de los campos de una alerta.
 * @param {string} id - El ID de la alerta a actualizar.
 * @param {z.infer<typeof updateAlertSchema>} data - Objeto con los datos parciales para actualizar la alerta.
 * @returns {Promise<ActionState<SelectAlert>>} Un objeto ActionState con la alerta actualizada o un mensaje de error.
 */
export async function updateAlertAction(
  id: string,
  // Evitamos que el caller pase 'id' dentro de data y sobrescriba el parámetro
  // (pero mantenemos compatibilidad de tipos con el schema de validación).
  data: z.infer<typeof UpdateAlertPayloadSchema>,
): Promise<ActionState<SelectAlert>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  // Evitar TS2783: si 'data' trae 'id', lo ignoramos para que no sobrescriba.
  const { id: _ignoredId, ...rest } = (data ?? {}) as Partial<
    z.infer<typeof UpdateAlertBaseSchema>
  >;
  const parsed = updateAlertSchema.safeParse({
    id,
    ...rest,
  });  
  if (!parsed.success) {
    const errorMessage = formatZodError(parsed.error);
    logger.error(`Validation error for updateAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: alertId, kpiId, conditionDetails, recipientsUserIds, recipientsGroupIds, frequencyConfig, alertType } = parsed.data;

  try {
    const existingAlert = await firstOrUndefined(
      db.select().from(alertsTable).where(eq(alertsTable.id, alertId))
    );
    if (!existingAlert) {
      return fail("Alerta no encontrada.");
    }

    // Check if KPI exists if kpiId is provided in update
    if (kpiId) {
      const existingKpi = await firstOrUndefined(
        db.select().from(kpisTable).where(eq(kpisTable.id, kpiId))
      );
      if (!existingKpi) {
        return fail("KPI asociado no encontrado.");
      }
    }

    const updateData: Partial<InsertAlert> = {
      kpiId: kpiId !== undefined ? (kpiId ?? null) : existingAlert.kpiId,
      conditionDetails: conditionDetails !== undefined ? (conditionDetails ?? null) : existingAlert.conditionDetails,
      recipientsUserIds: recipientsUserIds !== undefined ? (recipientsUserIds || []) : existingAlert.recipientsUserIds,
      recipientsGroupIds: recipientsGroupIds !== undefined ? (recipientsGroupIds || []) : existingAlert.recipientsGroupIds,
      frequencyConfig: frequencyConfig !== undefined ? (frequencyConfig ?? null) : existingAlert.frequencyConfig,
      alertType: alertType ?? existingAlert.alertType,
      updatedAt: new Date(),
    };

    const [updatedAlert] = await db
      .update(alertsTable)
      .set(updateData)
      .where(eq(alertsTable.id, alertId))
      .returning();

    if (!updatedAlert) {
      return fail("Fallo al actualizar la alerta.");
    }

    logger.info(`Alert updated successfully: ${updatedAlert.id}`, { updatedAlert });
    return ok("Alerta actualizada exitosamente.", updatedAlert);
  } catch (error) {
    logger.error(
      `Error updating alert: ${error instanceof Error ? error.message : String(error)}`,
      { id, data },
    );
    return fail(`Fallo al actualizar la alerta: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function deleteAlertAction
 * @description Elimina una alerta de la base de datos.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * @param {z.infer<typeof deleteAlertSchema>} data - Objeto con el ID de la alerta a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function deleteAlertAction(
  data: z.infer<typeof deleteAlertSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete alert.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = deleteAlertSchema.safeParse(data);
  if (!validatedData.success) {
    //const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for deleteAlertAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id } = validatedData.data;

  try {
    const [deletedAlert] = await db
      .delete(alertsTable)
      .where(eq(alertsTable.id, id)) // id garantizado por schema
      .returning();    

    if (!deletedAlert) {
      return fail("Alerta no encontrada para eliminar.");
    }

    logger.info(`Alert deleted successfully: ${id}`);
    return ok("Alerta eliminada exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting alert: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(`Fallo al eliminar la alerta: ${error instanceof Error ? error.message : String(error)}`);
  }
}