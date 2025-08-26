/**
 * @file actions/db/app-settings-actions.ts
 * @brief Implementa Server Actions para la gestión de la configuración de la aplicación en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para obtener y actualizar
 * configuraciones globales de la aplicación, como la personalización de la terminología
 * y la activación/desactivación de funcionalidades como los Strategy Maps.
 * Asegura la validación de datos, el almacenamiento consistente en la base de datos
 * y la protección de accesos no autorizados.
 */

"use server";

import { db } from "@/db/db";
import {
  appSettingsTable,
  appSettingTypeEnum,
  InsertAppSetting,
  SelectAppSetting,
} from "@/db/schema";
import { ActionState, fail, ok } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";

const logger = getLogger("app-settings-actions");

/**
 * Helper para obtener el primer elemento de un array o undefined.
 * Utilizado para consultas que se esperan retornar uno o ningún resultado.
 *
 * @template T El tipo de elementos en el array.
 * @param {Promise<T[]>} q Una promesa que resuelve a un array de tipo T.
 * @returns {Promise<T | undefined>} El primer elemento del array o `undefined` si el array está vacío.
 */
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                            Esquemas de Validación Zod                      */
/* -------------------------------------------------------------------------- */

/**
 * @schema getAppSettingSchema
 * @description Esquema de validación para obtener una configuración de la aplicación por su clave.
 * @property {string} settingKey - La clave única de la configuración, requerida y con un máximo de 255 caracteres.
 */
const getAppSettingSchema = z.object({
  settingKey: z
    .string()
    .min(1, "La clave de configuración es requerida.")
    .max(255, "La clave no puede exceder los 255 caracteres."),
});

/**
 * @schema updateTerminologySettingSchema
 * @description Esquema de validación para actualizar una configuración de terminología.
 * @property {string} settingKey - La clave de configuración de terminología (ej., 'terminology_measures'),
 *                                 requerida y con un máximo de 255 caracteres.
 * @property {string} settingValue - El valor personalizado para el término (ej., 'KPIs'),
 *                                  requerido y con un máximo de 1000 caracteres.
 */
const updateTerminologySettingSchema = z.object({
  settingKey: z
    .string()
    .min(1, "La clave de configuración es requerida.")
    .max(255, "La clave no puede exceder los 255 caracteres."),
  settingValue: z
    .string()
    .min(1, "El valor de la configuración es requerido.")
    .max(1000, "El valor no puede exceder los 1000 caracteres."),
});

/**
 * @schema toggleStrategyMapsSchema
 * @description Esquema de validación para activar o desactivar la funcionalidad de Strategy Maps.
 * @property {string} settingKey - La clave específica para la configuración de Strategy Maps
 *                                 (debe ser 'enable_strategy_maps'), requerida.
 * @property {boolean} settingValue - El estado deseado para la funcionalidad (true/false).
 */
const toggleStrategyMapsSchema = z.object({
  settingKey: z.literal("enable_strategy_maps", {
    errorMap: () => ({ message: "Clave de configuración inválida para Strategy Maps." }),
  }),
  settingValue: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*                                Server Actions                              */
/* -------------------------------------------------------------------------- */

/**
 * @function getAppSettingAction
 * @description Obtiene una configuración específica de la aplicación por su clave (`settingKey`).
 * Verifica la autenticación del usuario y valida la clave de entrada.
 *
 * @param {string} settingKey - La clave de la configuración a recuperar.
 * @returns {Promise<ActionState<SelectAppSetting>>} Un objeto `ActionState` indicando el éxito
 *                                                    o fracaso y los datos de la configuración.
 */
export async function getAppSettingAction(
  settingKey: string
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve app setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedKey = getAppSettingSchema.safeParse({ settingKey });
  if (!validatedKey.success) {
    const errorMessage = validatedKey.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getAppSettingAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const setting = await firstOrUndefined(
      db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.settingKey, validatedKey.data.settingKey))
    );

    if (!setting) {
      logger.info(
        `App setting with key "${validatedKey.data.settingKey}" not found.`
      );
      return fail("Configuración de la aplicación no encontrada.");
    }

    return ok("Configuración de la aplicación obtenida exitosamente.", setting);
  } catch (error) {
    logger.error(
      `Error retrieving app setting: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { settingKey }
    );
    return fail(
      `Fallo al obtener la configuración de la aplicación: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * @function updateTerminologyAction
 * @description Actualiza una configuración de terminología en la base de datos.
 * Esta acción se utiliza para personalizar términos como "Measures" a "KPIs" (UC-403).
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Utiliza una operación de "upsert" (insertar o actualizar) basada en la `settingKey`.
 *
 * @param {z.infer<typeof updateTerminologySettingSchema>} data - Objeto con la clave y el nuevo valor del término.
 * @returns {Promise<ActionState<SelectAppSetting>>} Un objeto `ActionState` indicando el éxito
 *                                                    o fracaso y los datos de la configuración actualizada.
 */
export async function updateTerminologyAction(
  data: z.infer<typeof updateTerminologySettingSchema>
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update terminology setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = updateTerminologySettingSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateTerminologyAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { settingKey, settingValue } = validatedData.data;

  try {
    // Upsert logic: insert if not exists, update if exists based on settingKey (primary key)
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey,
        settingValue,
        settingType: "terminology", // Asegura que el tipo de configuración sea 'terminology'
        updatedAt: new Date(),
      } as InsertAppSetting) // Se realiza un cast para asegurar la compatibilidad con el tipo InsertAppSetting
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedSetting) {
      return fail("Fallo al actualizar la terminología de la aplicación. No se pudo guardar la configuración.");
    }

    return ok("Terminología de la aplicación actualizada exitosamente.", updatedSetting);
  } catch (error) {
    logger.error(
      `Error updating terminology setting: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { settingKey, settingValue }
    );
    return fail(
      `Fallo al actualizar la terminología de la aplicación: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * @function toggleStrategyMapsAction
 * @description Activa o desactiva la funcionalidad de "Strategy Maps" en la aplicación (UC-404).
 * El valor booleano (`settingValue`) se convierte a una cadena `'true'` o `'false'` para su almacenamiento
 * en la columna de texto de la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Utiliza una operación de "upsert" (insertar o actualizar) basada en la `settingKey`.
 *
 * @param {z.infer<typeof toggleStrategyMapsSchema>} data - Objeto con la clave y el nuevo estado booleano para Strategy Maps.
 * @returns {Promise<ActionState<SelectAppSetting>>} Un objeto `ActionState` indicando el éxito
 *                                                    o fracaso y los datos de la configuración actualizada.
 */
export async function toggleStrategyMapsAction(
  data: z.infer<typeof toggleStrategyMapsSchema>
): Promise<ActionState<SelectAppSetting>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to toggle Strategy Maps setting.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = toggleStrategyMapsSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for toggleStrategyMapsAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { settingKey, settingValue } = validatedData.data;
  const dbSettingValue = String(settingValue); // Convertir el booleano a string para almacenar en la DB

  try {
    // Upsert logic: insert if not exists, update if exists based on settingKey (primary key)
    const [updatedSetting] = await db
      .insert(appSettingsTable)
      .values({
        settingKey,
        settingValue: dbSettingValue,
        settingType: "methodology", // Asegura que el tipo de configuración sea 'methodology'
        updatedAt: new Date(),
      } as InsertAppSetting) // Se realiza un cast para asegurar la compatibilidad con el tipo InsertAppSetting
      .onConflictDoUpdate({
        target: appSettingsTable.settingKey,
        set: {
          settingValue: dbSettingValue,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedSetting) {
      return fail("Fallo al actualizar la configuración de Strategy Maps. No se pudo guardar la configuración.");
    }

    return ok("Configuración de Strategy Maps actualizada exitosamente.", updatedSetting);
  } catch (error) {
    logger.error(
      `Error toggling Strategy Maps setting: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { settingKey, settingValue }
    );
    return fail(
      `Fallo al actualizar la configuración de Strategy Maps: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}