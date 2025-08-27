/**
 * @file actions/db/kpi-actions.ts
 * @brief Implementa Server Actions para la gestión de Indicadores Clave de Rendimiento (KPIs) en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar la configuración de KPIs, asignar propietarios a los elementos de Scorecard
 * a los que están vinculados, y gestionar las actualizaciones manuales de los valores de los KPIs.
 * Asegura la validación de datos, la consistencia lógica y la protección de accesos no autorizados.
 */
"use server";

import { db } from "@/db/db";
import {
  InsertKpi,
  InsertKpiUpdater,
  kpisTable,
  kpiScoringTypeEnum,
  kpiCalendarFrequencyEnum,
  kpiDataTypeEnum,
  kpiAggregationTypeEnum,
  kpiUpdatersTable,
  kpiValuesTable,
  scorecardElementsTable,
  SelectKpi,
  SelectKpiValue,
  SelectScorecardElement,
  kpiColorEnum,
  SelectAppSetting, // Para futuras referencias si se necesita leer configuraciones de la app aquí
  appSettingsTable // Para futuras referencias
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { calculateKpiScoreAndColor } from "@/actions/db/import-actions"; // Reutilizar la función de cálculo de score/color
import { extractKpiReferences } from "@/lib/kpi-calculation-engine"; // Nueva importación para el motor de cálculo

const logger = getLogger("kpi-actions");

// Helper para obtener el primer elemento de un array o undefined
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

// Conjunto de tipos de dato numéricos permitidos para KPIs con scoring numérico
type KpiDataType = (typeof kpiDataTypeEnum.enumValues)[number];
const numericDataTypes = new Set<KpiDataType>(["Number", "Percentage", "Currency"]);

/**
 * @schema createKpiSchema
 * @description Esquema de validación para la creación de un nuevo KPI.
 * @property {string} scorecardElementId - ID del elemento de Scorecard al que se vincula el KPI, UUID requerido.
 * @property {z.infer<typeof kpiScoringTypeEnum>} scoringType - Tipo de puntuación del KPI, requerido.
 * @property {z.infer<typeof kpiCalendarFrequencyEnum>} calendarFrequency - Frecuencia de actualización del KPI, requerida.
 * @property {z.infer<typeof kpiDataTypeEnum>} dataType - Tipo de dato del KPI, requerido.
 * @property {z.infer<typeof kpiAggregationTypeEnum>} aggregationType - Tipo de agregación del KPI, requerido.
 * @property {number} decimalPrecision - Número de decimales, entero no negativo (0-20), por defecto 0.
 * @property {boolean} isManualUpdate - Indica si se actualiza manualmente, por defecto false.
 * @property {string | null} calculationEquation - Ecuación de cálculo para KPIs automáticos, opcional.
 * @property {boolean} rollupEnabled - Habilita el rollup desde organizaciones hijas, por defecto false.
 */
const createKpiSchema = z
  .object({
    scorecardElementId: z.string().uuid("ID de elemento de Scorecard inválido."),
    scoringType: z.enum(kpiScoringTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de puntuación de KPI inválido." }),
    }),
    calendarFrequency: z.enum(kpiCalendarFrequencyEnum.enumValues, {
      errorMap: () => ({ message: "Frecuencia de calendario de KPI inválida." }),
    }),
    dataType: z.enum(kpiDataTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de dato de KPI inválido." }),
    }),
    aggregationType: z.enum(kpiAggregationTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de agregación de KPI inválido." }),
    }),
    decimalPrecision: z
      .number()
      .int("La precisión decimal debe ser un número entero.")
      .min(0, "La precisión decimal no puede ser negativa.")
      .max(20, "La precisión decimal no puede exceder 20.")
      .default(0),
    isManualUpdate: z.boolean().default(false),
    calculationEquation: z
      .string()
      .max(1000, "La ecuación no puede exceder los 1000 caracteres.")
      .optional()
      .nullable(),
    rollupEnabled: z.boolean().default(false),
  })
  .refine(
    (data) => {
      // Regla de negocio: si el tipo de puntuación es numérico (Goal/Red Flag), el tipo de dato debe ser numérico.
      // Si es Yes/No, el tipo de dato debe ser Number (para 0/1).
      // Si es Text, el tipo de dato debe ser Text.
      if (data.scoringType === "Goal/Red Flag" && !numericDataTypes.has(data.dataType)) {
        return false; // combinación inválida
      }
      if (data.scoringType === "Yes/No" && data.dataType !== "Number") {
        return false;
      }
      if (data.scoringType === "Text" && data.dataType !== "Text") {
        return false;
      }
      return true; // combinación válida
    },
    {
      message: "Inconsistencia entre el tipo de puntuación y el tipo de dato del KPI.",
      path: ["scoringType", "dataType"],
    },
  );

/**
 * @schema updateKpiConfigurationSchema
 * @description Esquema de validación para la actualización de un KPI existente.
 * Permite campos opcionales ya que se puede actualizar solo una parte del KPI.
 * @property {string} id - ID del KPI a actualizar, UUID requerido.
 * @property {z.infer<typeof kpiScoringTypeEnum>} scoringType - Tipo de puntuación del KPI, opcional.
 * @property {z.infer<typeof kpiCalendarFrequencyEnum>} calendarFrequency - Frecuencia de actualización del KPI, opcional.
 * @property {z.infer<typeof kpiDataTypeEnum>} dataType - Tipo de dato del KPI, opcional.
 * @property {z.infer<typeof kpiAggregationTypeEnum>} aggregationType - Tipo de agregación del KPI, opcional.
 * @property {number} decimalPrecision - Número de decimales, entero no negativo (0-20), opcional.
 * @property {boolean} isManualUpdate - Indica si se actualiza manualmente, opcional.
 * @property {string | null} calculationEquation - Ecuación de cálculo para KPIs automáticos, opcional.
 * @property {boolean} rollupEnabled - Habilita el rollup desde organizaciones hijas, opcional.
 */
const updateKpiConfigurationSchema = z
  .object({
    id: z.string().uuid("ID de KPI inválido."),
    scoringType: z
      .enum(kpiScoringTypeEnum.enumValues, {
        errorMap: () => ({ message: "Tipo de puntuación de KPI inválido." }),
      })
      .optional(),
    calendarFrequency: z
      .enum(kpiCalendarFrequencyEnum.enumValues, {
        errorMap: () => ({ message: "Frecuencia de calendario de KPI inválida." }),
      })
      .optional(),
    dataType: z
      .enum(kpiDataTypeEnum.enumValues, {
        errorMap: () => ({ message: "Tipo de dato de KPI inválido." }),
      })
      .optional(),
    aggregationType: z
      .enum(kpiAggregationTypeEnum.enumValues, {
        errorMap: () => ({ message: "Tipo de agregación de KPI inválido." }),
      })
      .optional(),
    decimalPrecision: z
      .number()
      .int("La precisión decimal debe ser un número entero.")
      .min(0, "La precisión decimal no puede ser negativa.")
      .max(20, "La precisión decimal no puede exceder 20.")
      .optional(),
    isManualUpdate: z.boolean().optional(),
    calculationEquation: z
      .string()
      .max(1000, "La ecuación no puede exceder los 1000 caracteres.")
      .optional()
      .nullable(),
    rollupEnabled: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Validación de consistencia solo si ambos campos vienen en el payload.
      if (data.scoringType && data.dataType) {
        if (data.scoringType === "Goal/Red Flag" && !numericDataTypes.has(data.dataType)) {
          return false;
        }
        if (data.scoringType === "Yes/No" && data.dataType !== "Number") {
          return false;
        }
        if (data.scoringType === "Text" && data.dataType !== "Text") {
          return false;
        }
      }
      return true;
    },
    {
      message: "Inconsistencia entre el tipo de puntuación y el tipo de dato del KPI.",
      path: ["scoringType", "dataType"],
    },
  );

/**
 * @schema getKpiByIdSchema
 * @description Esquema de validación para obtener un KPI por su ID.
 * @property {string} id - ID del KPI, UUID requerido.
 */
const getKpiByIdSchema = z.object({
  id: z.string().uuid("ID de KPI inválido."),
});

/**
 * @schema deleteKpiSchema
 * @description Esquema de validación para la eliminación de un KPI.
 * @property {string} id - ID del KPI, UUID requerido.
 */
const deleteKpiSchema = z.object({
  id: z.string().uuid("ID de KPI inválido."),
});

/**
 * @schema assignScorecardElementOwnersSchema
 * @description Esquema de validación para asignar o actualizar un propietario para un elemento de Scorecard.
 * @property {string} scorecardElementId - ID del elemento de Scorecard, UUID requerido.
 * @property {string | null} ownerUserId - ID del usuario propietario, opcional y nullable.
 */
const assignScorecardElementOwnersSchema = z.object({
  scorecardElementId: z.string().uuid("ID de elemento de Scorecard inválido."),
  ownerUserId: z.string().min(1, "El ID de usuario es requerido.").optional().nullable(),
});

/**
 * @schema assignKpiUpdatersSchema
 * @description Esquema de validación para asignar o actualizar un "Updater" para un KPI.
 * @property {string} kpiId - ID del KPI, UUID requerido.
 * @property {string} userId - ID del usuario a asignar como Updater.
 * @property {boolean} canModifyThresholds - Indica si el Updater puede modificar los umbrales del KPI, por defecto false.
 */
const assignKpiUpdatersSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  userId: z.string().min(1, "El ID de usuario es requerido."),
  canModifyThresholds: z.boolean().default(false).optional(),
});

/**
 * @schema updateKpiManualValueSchema
 * @description Esquema de validación para la actualización manual de un valor de KPI.
 * @property {string} kpiId - ID del KPI a actualizar, UUID requerido.
 * @property {string} periodDate - Fecha del período de actualización en formato 'YYYY-MM-DD'.
 * @property {string | null} actualValue - Valor real del KPI, opcional y nullable.
 * @property {string | null} targetValue - Valor objetivo del KPI, opcional y nullable.
 * @property {string | null} thresholdRed - Umbral rojo del KPI, opcional y nullable.
 * @property {string | null} thresholdYellow - Umbral amarillo del KPI, opcional y nullable.
 * @property {string | null} note - Nota asociada a la actualización, opcional y nullable, máx. 1000 caracteres.
 */
const updateKpiManualValueSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  periodDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido. Usar YYYY-MM-DD."),
  actualValue: z.string().max(255, "El valor actual no puede exceder 255 caracteres.").optional().nullable(),
  targetValue: z.string().max(255, "El valor objetivo no puede exceder 255 caracteres.").optional().nullable(),
  thresholdRed: z.string().max(255, "El umbral rojo no puede exceder 255 caracteres.").optional().nullable(),
  thresholdYellow: z.string().max(255, "El umbral amarillo no puede exceder 255 caracteres.").optional().nullable(),
  note: z.string().max(1000, "La nota no puede exceder los 1000 caracteres.").optional().nullable(),
});

/**
 * @schema setKpiCalculationEquationSchema
 * @description Esquema de validación para configurar la ecuación de cálculo de un KPI (UC-103).
 * @property {string} kpiId - ID del KPI al que se le asignará la ecuación, UUID requerido.
 * @property {string | null} calculationEquation - La ecuación de cálculo, opcional y nullable.
 *                                                Si es una cadena vacía, se interpreta como null.
 */
const setKpiCalculationEquationSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  calculationEquation: z
    .string()
    .max(1000, "La ecuación no puede exceder los 1000 caracteres.")
    .optional()
    .nullable(),
});

/* -------------------------------------------------------------------------- */
/*                               Server Actions                               */
/* -------------------------------------------------------------------------- */

/**
 * @function createKpiAction
 * @description Crea un nuevo KPI en la base de datos, vinculado a un elemento de Scorecard existente.
 * Verifica la autenticación del usuario, valida los datos de entrada y asegura que el elemento
 * de Scorecard al que se vincula sea de tipo 'KPI'.
 * @param {Omit<InsertKpi, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos del nuevo KPI.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI creado.
 */
export async function createKpiAction(
  data: Omit<InsertKpi, "id" | "createdAt" | "updatedAt">,
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create KPI.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  // Sanitizar campos opcionales para que sean null si son cadenas vacías
  const sanitizedData = {
    ...data,
    calculationEquation: data.calculationEquation === "" ? null : data.calculationEquation,
  };

  const validatedData = createKpiSchema.safeParse(sanitizedData);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for createKpiAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    // Verificar que el scorecardElementId existe y es de tipo 'KPI'
    const existingScorecardElement: SelectScorecardElement | undefined = await firstOrUndefined(
      db
        .select()
        .from(scorecardElementsTable)
        .where(eq(scorecardElementsTable.id, validatedData.data.scorecardElementId)),
    );

    if (!existingScorecardElement) {
      logger.warn(`Scorecard element with ID ${validatedData.data.scorecardElementId} not found.`);
      return fail("El elemento de Scorecard especificado no existe.");
    }

    if (existingScorecardElement.elementType !== "KPI") {
      logger.warn(
        `Scorecard element with ID ${validatedData.data.scorecardElementId} is not of type 'KPI'. Actual type: ${existingScorecardElement.elementType}.`,
      );
      return fail("El elemento de Scorecard debe ser de tipo 'KPI' para asociarle un KPI.");
    }

    // Verificar si ya existe un KPI asociado a este elemento de Scorecard
    const existingKpiForElement = await firstOrUndefined(
      db.select().from(kpisTable).where(eq(kpisTable.scorecardElementId, validatedData.data.scorecardElementId)),
    );

    if (existingKpiForElement) {
      logger.warn(`A KPI already exists for scorecard element ID ${validatedData.data.scorecardElementId}.`);
      return fail("Ya existe un KPI asociado a este elemento de Scorecard.");
    }

    const [newKpi] = await db.insert(kpisTable).values(validatedData.data).returning();

    return ok("KPI creado exitosamente.", newKpi);
  } catch (error) {
    logger.error(`Error creating KPI: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al crear el KPI.");
  }
}

/**
 * @function getKpiAction
 * @description Obtiene un KPI específico por su ID.
 * @param {string} id - El ID del KPI a recuperar.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI.
 */
export async function getKpiAction(id: string): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve KPI.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = getKpiByIdSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getKpiAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const kpi = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, validatedId.data.id)));
    if (!kpi) {
      return fail("KPI no encontrado.");
    }
    return ok("KPI obtenido exitosamente.", kpi);
  } catch (error) {
    logger.error(`Error retrieving KPI: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al obtener el KPI.");
  }
}

/**
 * @function updateKpiConfigurationAction
 * @description Actualiza la configuración de un KPI existente en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada, incluyendo la consistencia
 * entre el tipo de puntuación y el tipo de dato.
 * @param {string} id - El ID del KPI a actualizar.
 * @param {Partial<Omit<InsertKpi, 'id' | 'createdAt' | 'updatedAt' | 'scorecardElementId'>>} data - Objeto con los datos parciales para actualizar el KPI.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI actualizado.
 */
export async function updateKpiConfigurationAction(
  id: string,
  data: Partial<Omit<InsertKpi, "id" | "createdAt" | "updatedAt" | "scorecardElementId">>,
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update KPI configuration.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  // Sanitizar campos opcionales para que sean null si son cadenas vacías
  const sanitizedData = {
    ...data,
    calculationEquation: data.calculationEquation === "" ? null : data.calculationEquation,
  };

  const validatedPayload = updateKpiConfigurationSchema.safeParse({ id, ...sanitizedData });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateKpiConfigurationAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: kpiId, ...updateData } = validatedPayload.data;

  try {
    const [updatedKpi] = await db
      .update(kpisTable)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(kpisTable.id, kpiId))
      .returning();

    if (!updatedKpi) {
      return fail("KPI no encontrado o no se pudo actualizar la configuración.");
    }

    return ok("Configuración del KPI actualizada exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(
      `Error updating KPI configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail("Fallo al actualizar la configuración del KPI.");
  }
}

/**
 * @function deleteKpiAction
 * @description Elimina un KPI de la base de datos.
 * La eliminación en cascada de los valores de KPI asociados (`kpi_values`) y los updaters (`kpi_updaters`)
 * es manejada por las restricciones de clave foránea en la base de datos.
 * @param {string} id - El ID del KPI a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function deleteKpiAction(id: string): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete KPI.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = deleteKpiSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteKpiAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    await db.delete(kpisTable).where(eq(kpisTable.id, validatedId.data.id));
    return ok("KPI eliminado exitosamente.");
  } catch (error) {
    logger.error(`Error deleting KPI: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al eliminar el KPI.");
  }
}

/**
 * @function assignScorecardElementOwnersAction
 * @description Asigna uno o más usuarios como propietarios de un elemento de Scorecard.
 * Esta acción se incluye aquí según el plan de implementación, aunque modifica la tabla scorecardElementsTable.
 * @param {string} scorecardElementId - El ID del elemento de Scorecard al que se asignarán los propietarios.
 * @param {string | null} ownerUserId - El ID del usuario que será el propietario, o null para quitar el propietario.
 * @returns {Promise<ActionState<SelectScorecardElement>>} Un objeto ActionState indicando el éxito o fracaso y los datos actualizados del elemento de Scorecard.
 */
export async function assignScorecardElementOwnersAction(
  scorecardElementId: string,
  ownerUserId: string | null,
): Promise<ActionState<SelectScorecardElement>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to assign scorecard element owner.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = assignScorecardElementOwnersSchema.safeParse({ scorecardElementId, ownerUserId });
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for assignScorecardElementOwnersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [updatedElement] = await db
      .update(scorecardElementsTable)
      .set({ ownerUserId: validatedData.data.ownerUserId, updatedAt: new Date() })
      .where(eq(scorecardElementsTable.id, validatedData.data.scorecardElementId))
      .returning();

    if (!updatedElement) {
      return fail("Elemento de Scorecard no encontrado o no se pudo actualizar el propietario.");
    }

    return ok("Propietario del elemento de Scorecard asignado exitosamente.", updatedElement);
  } catch (error) {
    logger.error(
      `Error assigning owner to scorecard element: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail("Fallo al asignar el propietario del elemento de Scorecard.");
  }
}

/**
 * @function assignKpiUpdatersAction
 * @description Asigna un usuario como "Updater" (encargado de actualización manual) para un KPI específico.
 * Si el usuario ya es un updater, actualiza sus permisos (ej. canModifyThresholds).
 * @param {Omit<InsertKpiUpdater, 'createdAt' | 'updatedAt'>} data - Datos para asignar/actualizar el updater.
 * @returns {Promise<ActionState<InsertKpiUpdater>>} Objeto ActionState indicando el éxito o fracaso.
 */
export async function assignKpiUpdatersAction(
  data: Omit<InsertKpiUpdater, "createdAt" | "updatedAt">,
): Promise<ActionState<InsertKpiUpdater>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to assign KPI updater.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = assignKpiUpdatersSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for assignKpiUpdatersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    // Verify KPI exists
    const existingKpi = await firstOrUndefined(
      db.select().from(kpisTable).where(eq(kpisTable.id, validatedData.data.kpiId)),
    );
    if (!existingKpi) {
      logger.warn(`KPI with ID ${validatedData.data.kpiId} not found for assigning updater.`);
      return fail("KPI no encontrado.");
    }

    // Try to insert, if it's a duplicate (user already an updater), then update.
    // Drizzle's upsert functionality for composite primary keys is through `onConflictDoUpdate`.
    const [updater] = await db
      .insert(kpiUpdatersTable)
      .values({
        kpiId: validatedData.data.kpiId,
        userId: validatedData.data.userId,
        canModifyThresholds: validatedData.data.canModifyThresholds || false, // Default to false
      })
      .onConflictDoUpdate({
        target: [kpiUpdatersTable.kpiId, kpiUpdatersTable.userId],
        set: {
          canModifyThresholds: validatedData.data.canModifyThresholds || false,
          updatedAt: new Date(),
        },
      })
      .returning();

    return ok("Encargado de actualización de KPI asignado/actualizado exitosamente.", updater);
  } catch (error) {
    logger.error(`Error assigning KPI updater: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al asignar el encargado de actualización de KPI.");
  }
}

/**
 * @function updateKpiManualValueAction
 * @description Actualiza el valor de un KPI manualmente para un período específico.
 * Solo los usuarios designados como "Updaters" para ese KPI pueden realizar esta acción.
 * Realiza validaciones de tipos de datos y, si el KPI es de tipo "Goal/Red Flag", calcula el score y el color.
 * Si ya existe un valor para el KPI y el período, lo actualiza (upsert).
 * @param {z.infer<typeof updateKpiManualValueSchema>} data - Datos de la actualización manual del KPI.
 * @returns {Promise<ActionState<SelectKpiValue>>} Objeto ActionState indicando el éxito o fracaso.
 * @notes
 *   - El valor actual del KPI y los umbrales se almacenan como texto para compatibilidad con el esquema,
 *     pero se intenta convertir a número para el cálculo del score/color.
 *   - Se verifica la configuración `require_note_for_red_kpi` en `appSettingsTable` antes de permitir la actualización.
 */
export async function updateKpiManualValueAction(
  data: z.infer<typeof updateKpiManualValueSchema>,
): Promise<ActionState<SelectKpiValue>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to manually update KPI value.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = updateKpiManualValueSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateKpiManualValueAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { kpiId, periodDate, actualValue, targetValue, thresholdRed, thresholdYellow, note } = validatedData.data;

  try {
    // 1. Verify if the current user is an authorized updater for this KPI
    const isUpdater = await firstOrUndefined(
      db
        .select()
        .from(kpiUpdatersTable)
        .where(and(eq(kpiUpdatersTable.kpiId, kpiId), eq(kpiUpdatersTable.userId, currentAuthUserId))),
    );

    if (!isUpdater) {
      logger.warn(`User ${currentAuthUserId} is not an authorized updater for KPI ${kpiId}.`);
      return fail("No está autorizado para actualizar manualmente este KPI.");
    }

    // 2. Get KPI details to check scoring type and data type
    const kpiDetails = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, kpiId)));
    if (!kpiDetails) {
      return fail("KPI no encontrado.");
    }

    // Ensure KPI is configured for manual update
    if (!kpiDetails.isManualUpdate) {
      logger.warn(`KPI ${kpiId} is not configured for manual updates.`);
      return fail("Este KPI no está configurado para actualizaciones manuales.");
    }
    
    // Convert string values to numbers for calculation if data type is numeric
    const parsedActualValue = actualValue != null ? parseFloat(actualValue) : null;
    const parsedTargetValue = targetValue != null ? parseFloat(targetValue) : null;
    const parsedThresholdRed = thresholdRed != null ? parseFloat(thresholdRed) : null;
    const parsedThresholdYellow = thresholdYellow != null ? parseFloat(thresholdYellow) : null;


    let score: number | null = null;
    let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

    // Calculate score and color if scoring type is 'Goal/Red Flag'
    if (kpiDetails.scoringType === "Goal/Red Flag" && numericDataTypes.has(kpiDetails.dataType)) {
      const calculated = calculateKpiScoreAndColor(
        parsedActualValue,
        parsedTargetValue,
        parsedThresholdRed,
        parsedThresholdYellow,
      );
      score = calculated.score;
      color = calculated.color;
    } else if (kpiDetails.scoringType === "Yes/No" && kpiDetails.dataType === "Number") {
      // For Yes/No, assuming 1 for Yes, 0 for No. Score could be 100 or 0.
      if (parsedActualValue === 1) {
        score = 100;
        color = "Green";
      } else if (parsedActualValue === 0) {
        score = 0;
        color = "Red";
      } else {
        score = null;
        color = null;
      }
    }
    // For 'Text' scoring type, score and color are typically null or derived differently (out of scope for now)

    // 3. Check if a note is required if KPI turns red/low performance
    let isNoteRequired = false;
    const requireNoteSetting = await firstOrUndefined(
      db
        .select()
        .from(appSettingsTable)
        .where(eq(appSettingsTable.settingKey, "require_note_for_red_kpi")),
    );
    if (requireNoteSetting?.settingValue === 'true' && color === 'Red') {
      isNoteRequired = true;
    }

    if (isNoteRequired && ((note ?? '').trim() === '')) {        
      logger.warn(`Note required for KPI ${kpiId} due to red status, but none provided.`);
      return fail("Se requiere una nota explicativa para las actualizaciones de KPI en estado rojo.");
    }


    const insertData = {
      kpiId,
      periodDate: periodDate,
      actualValue,
      targetValue,
      thresholdRed,
      thresholdYellow,
      score: score !== null ? String(score) : null, // Convert score back to string for DB
      color,
      updatedByUserId: currentAuthUserId,
      isManualEntry: true,
      note: (note == null || note === "") ? null : note,
    };

    // Use onConflictDoUpdate for upsert (insert or update if exists)
    const [kpiValue] = await db
      .insert(kpiValuesTable)
      .values(insertData)
      .onConflictDoUpdate({
        target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
        set: {
          actualValue,
          targetValue,
          thresholdRed,
          thresholdYellow,
          score: score !== null ? String(score) : null, // Convert score back to string for DB
          color,
          updatedByUserId: currentAuthUserId,
          isManualEntry: true,
          note: (note == null || note === "") ? null : note,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!kpiValue) {
      return fail("Fallo al insertar o actualizar el valor del KPI.");
    }

    return ok("Valor del KPI actualizado manualmente exitosamente.", kpiValue);
  } catch (error) {
    logger.error(`Error updating KPI manual value: ${error instanceof Error ? error.message : String(error)}`);
    return fail(`Fallo al actualizar el valor manual del KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function setKpiCalculationEquationAction
 * @description Configura la ecuación de cálculo automático para un KPI (UC-103).
 * Si se proporciona una ecuación, el KPI se marca como no manual (isManualUpdate=false).
 * Si la ecuación es nula (se limpia), el KPI se marca como manual (isManualUpdate=true),
 * permitiendo actualizaciones manuales o por importación.
 * @param {z.infer<typeof setKpiCalculationEquationSchema>} data - Objeto con el ID del KPI y la ecuación de cálculo.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI actualizado.
 * @notes
 *   - Esta acción actualiza tanto `calculation_equation` como `is_manual_update`.
 *   - La lógica para la evaluación real de la ecuación se manejará en pasos posteriores
 *     (ej. en un cron job o al actualizar KPIs referenciados).
 */
export async function setKpiCalculationEquationAction(
  data: z.infer<typeof setKpiCalculationEquationSchema>,
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to set KPI calculation equation.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = setKpiCalculationEquationSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for setKpiCalculationEquationAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { kpiId, calculationEquation } = validatedData.data;
  // If an equation is provided (not null/empty), it's no longer manual. If cleared, it becomes manual.
  const isManualUpdate = calculationEquation === null || calculationEquation === ""; 

  try {
    const [updatedKpi] = await db
      .update(kpisTable)
      .set({
        calculationEquation: calculationEquation === "" ? null : calculationEquation,
        isManualUpdate: isManualUpdate,
        updatedAt: new Date(),
      })
      .where(eq(kpisTable.id, kpiId))
      .returning();

    if (!updatedKpi) {
      return fail("KPI no encontrado o no se pudo actualizar la ecuación.");
    }

    return ok("Ecuación de cálculo del KPI actualizada exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(
      `Error setting KPI calculation equation: ${error instanceof Error ? error.message : String(error)}`,
      { kpiId, calculationEquation },
    );
    return fail("Fallo al configurar la ecuación de cálculo del KPI.");
  }
}