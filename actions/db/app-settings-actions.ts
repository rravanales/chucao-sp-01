/**
 * @file actions/db/app-settings-actions.ts
 * @brief Server Actions para la gestión de configuración de la aplicación en DeltaOne.
 * @description Funciones del lado del servidor para obtener y actualizar configuraciones globales:
 * - Personalización de terminología (UC-403)
 * - Activación/desactivación de Strategy Maps (UC-404)
 * - Configuración global de alertas por respuesta a notas (UC-302)
 *
 * Mejores prácticas aplicadas:
 * - Validación con Zod y mensajes de error claros
 * - Compatibilidad hacia atrás en contratos de entrada
 * - Escritura dual para claves renombradas a fin de no romper lecturas existentes
 * - Respuestas tipadas coherentes con `.returning()`
 */

"use server";

import { db } from "@/db/db";
import {
  appSettingsTable,
  InsertAppSetting,
  SelectAppSetting,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { formatZodError } from "@/types/validation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { firstOrUndefined } from "@/lib/db-helpers";

const logger = getLogger("app-settings-actions");

/* -------------------------------------------------------------------------- */
/*                             Esquemas de Validación Zod                     */
/* -------------------------------------------------------------------------- */

/**
 * @schema getAppSettingSchema
 * @description Esquema de validación para la clave de una configuración de la aplicación.
 * @property {string} settingKey - La clave de la configuración a recuperar, requerida.
 */
const getAppSettingSchema = z.object({
  settingKey: z.string().min(1, "La clave de la configuración es requerida."),
});

/**
 * @schema updateTerminologySettingSchemaV1
 * @description Esquema v1 para actualizar terminología.
 * @property {string} settingKey
 * @property {string} settingValue
 */
const updateTerminologySettingSchemaV1 = z.object({
  settingKey: z.string().min(1, "La clave de la configuración es requerida.").max(255),
  settingValue: z.string().min(1, "El valor de la configuración es requerido.").max(255),
});

/**
 * @schema updateTerminologySettingSchemaV2
 * @description Esquema v2 para actualizar terminología.
 * @property {string} key
 * @property {string} value
 */
const updateTerminologySettingSchemaV2 = z.object({
  key: z.string().min(1, "La clave es requerida.").max(255),
  value: z.string().min(1, "El valor es requerido.").max(255),
});

/**
 * @schema toggleStrategyMapsSchema
 * @description Esquema de validación para alternar la funcionalidad de Strategy Maps.
 * @property {boolean} enabled - Indica si Strategy Maps está activado o desactivado.
 */
const toggleStrategyMapsSchema = z.object({
  enabled: z.boolean(),
});

/**
 * @schema toggleEnableNoteReplyAlertsSchema
 * @description Esquema de validación para alternar la funcionalidad global de alertas por respuesta a notas (UC-302).
 * @property {boolean} enabled - Indica si la configuración está activada o desactivada.
 */
const toggleEnableNoteReplyAlertsSchema = z.object({
  enabled: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*                           Utilidades de Compatibilidad                     */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza la entrada de terminología para aceptar los contratos v1 y v2.
 * Retorna `{ settingKey, settingValue }` ya normalizado.
 */
function normalizeTerminologyInput(
  data: unknown,
): z.infer<typeof updateTerminologySettingSchemaV1> | null {
  const v2 = updateTerminologySettingSchemaV2.safeParse(data);
  if (v2.success) {
    return {
      settingKey: v2.data.key,
      settingValue: v2.data.value,
    };
  }
  const v1 = updateTerminologySettingSchemaV1.safeParse(data);
  if (v1.success) {
    return v1.data;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 Server Actions                             */
/* -------------------------------------------------------------------------- */

/**
 * @function getAppSettingAction
 * @description Obtiene una configuración específica de la aplicación por su clave (settingKey).
 * Verifica la autenticación del usuario y valida la clave de entrada.
 * @param {string} settingKey - La clave de la configuración a recuperar.
 * @returns {Promise<ActionState<SelectAppSetting | null>>}
 */
export async function getAppSettingAction(
  settingKey: string,
): Promise<ActionState<SelectAppSetting | null>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve app setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedKey = getAppSettingSchema.safeParse({ settingKey });
  if (!validatedKey.success) {
    const errorMessage = formatZodError(validatedKey.error);
    logger.error(`Validation error for getAppSettingAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const setting = await firstOrUndefined(
      db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.settingKey, validatedKey.data.settingKey)),
    );

    if (!setting) {
      logger.info(`App setting "${settingKey}" not found. Returning null.`);
      return ok("Configuración de la aplicación no encontrada.", null);
    }

    return ok("Configuración de la aplicación obtenida exitosamente.", setting);
  } catch (error) {
    logger.error(
      `Error retrieving app setting: ${error instanceof Error ? error.message : String(error)}`,
      { settingKey },
    );
    return fail(
      `Fallo al obtener la configuración de la aplicación: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function updateTerminologyAction
 * @description Actualiza una configuración de terminología (UC-403).
 * Acepta ambos contratos de entrada:
 *  - v1: { settingKey, settingValue }
 *  - v2: { key, value }
 * @returns {Promise<ActionState<SelectAppSetting>>}
 */
export async function updateTerminologyAction(
  data: unknown,
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update terminology setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const normalized = normalizeTerminologyInput(data);
  if (!normalized) {
    // Construimos el detalle de error usando ambos esquemas para claridad
    const v1 = updateTerminologySettingSchemaV1.safeParse(data);
    const v2 = updateTerminologySettingSchemaV2.safeParse(data);
    const errorMessage = [
      !v2.success ? `v2: ${formatZodError(v2.error)}` : "",
      !v1.success ? `v1: ${formatZodError(v1.error)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    logger.error(`Validation error for updateTerminologyAction: ${errorMessage}`);
    return fail(errorMessage || "Datos inválidos.");
  }

  const { settingKey, settingValue } = normalized;

  try {
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey,
        settingValue,
        settingType: "terminology",
        updatedAt: new Date(),
      } satisfies InsertAppSetting)
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedSetting) {
      return fail("Fallo al actualizar la terminología de la aplicación.");
    }

    logger.info(
      `Terminology setting ${settingKey} updated to ${settingValue} by user ${userId}`,
      { updatedSetting },
    );
    return ok("Terminología de la aplicación actualizada exitosamente.", updatedSetting);
  } catch (error) {
    logger.error(
      `Error updating terminology setting: ${error instanceof Error ? error.message : String(error)}`,
      { settingKey, settingValue },
    );
    return fail(
      `Fallo al actualizar la terminología de la aplicación: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function toggleStrategyMapsAction
 * @description Activa o desactiva "Strategy Maps" (UC-404).
 * Compatibilidad:
 *  - Clave canónica (v1): "strategy_maps_enabled"
 *  - Clave alternativa (v2): "enable_strategy_maps"
 * Se hace escritura dual para no romper lecturas previas.
 * @param {z.infer<typeof toggleStrategyMapsSchema>} data
 * @returns {Promise<ActionState<SelectAppSetting>>}
 */
export async function toggleStrategyMapsAction(
  data: z.infer<typeof toggleStrategyMapsSchema>,
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to toggle Strategy Maps setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = toggleStrategyMapsSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for toggleStrategyMapsAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { enabled } = validatedData.data;
  const canonicalKey = "strategy_maps_enabled"; // v1
  const altKey = "enable_strategy_maps"; // v2 (compatibilidad)
  const settingValue = String(enabled);

  try {
    // Escribimos primero la clave canónica y usamos ese resultado como retorno
    const [canonicalSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey: canonicalKey,
        settingValue,
        settingType: "methodology",
        updatedAt: new Date(),
      } satisfies InsertAppSetting)
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Escritura secundaria (best-effort) para compatibilidad con la clave alternativa
    try {
      await db
        .insert(appSettingsTable)
        .values({
          settingKey: altKey,
          settingValue,
          settingType: "methodology",
          updatedAt: new Date(),
        } satisfies InsertAppSetting)
        .onConflictDoUpdate({
          target: appSettingsTable.settingKey,
          set: {
            settingValue,
            updatedAt: new Date(),
          },
        })
        .returning();
    } catch (compatError) {
      // No rompemos el flujo si la compat falla; log de advertencia suficiente.
      logger.warn(
        `Secondary write for alt Strategy Maps key failed: ${
          compatError instanceof Error ? compatError.message : String(compatError)
        }`,
        { altKey, settingValue },
      );
    }

    if (!canonicalSetting) {
      return fail("Fallo al actualizar la configuración de Strategy Maps.");
    }

    logger.info(
      `Strategy Maps setting toggled to ${enabled} by user ${userId}`,
      { canonicalSetting },
    );
    return ok("Configuración de Strategy Maps actualizada exitosamente.", canonicalSetting);
  } catch (error) {
    logger.error(
      `Error toggling Strategy Maps setting: ${error instanceof Error ? error.message : String(error)}`,
      { canonicalKey, settingValue },
    );
    return fail(
      `Fallo al actualizar la configuración de Strategy Maps: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function toggleEnableNoteReplyAlertsAction
 * @description Activa o desactiva la configuración global para habilitar alertas
 * cuando se responde a una nota (UC-302).
 * @param {z.infer<typeof toggleEnableNoteReplyAlertsSchema>} data
 * @returns {Promise<ActionState<SelectAppSetting>>}
 */
export async function toggleEnableNoteReplyAlertsAction(
  data: z.infer<typeof toggleEnableNoteReplyAlertsSchema>,
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to toggle 'enable note reply alerts' setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = toggleEnableNoteReplyAlertsSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = formatZodError(validatedData.error);
    logger.error(
      `Validation error for toggleEnableNoteReplyAlertsAction: ${errorMessage}`,
    );
    return fail(errorMessage);
  }

  const { enabled } = validatedData.data;
  const settingKey = "enable_note_reply_alerts";
  const settingValue = String(enabled);

  try {
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey,
        settingValue,
        settingType: "alert_settings",
        updatedAt: new Date(),
      } satisfies InsertAppSetting)
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedSetting) {
      return fail(
        "Fallo al actualizar la configuración de habilitar alertas por respuesta a notas.",
      );
    }

    logger.info(
      `'Enable note reply alerts' setting toggled to ${enabled} by user ${userId}`,
      { updatedSetting },
    );
    return ok("Configuración actualizada exitosamente.", updatedSetting);
  } catch (error) {
    logger.error(
      `Error toggling 'enable note reply alerts' setting: ${error instanceof Error ? error.message : String(error)}`,
      { settingKey, settingValue },
    );
    return fail(
      `Fallo al actualizar la configuración de alertas por respuesta a notas: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
