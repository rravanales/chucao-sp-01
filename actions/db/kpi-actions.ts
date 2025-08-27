/**
 * @file actions/db/kpi-actions3.ts
 * @brief Implementa Server Actions para la gestión de Indicadores Clave de Rendimiento (KPIs) en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar la configuración de KPIs, asignar propietarios a los elementos de Scorecard
 * a los que están vinculados, y gestionar las actualizaciones manuales de los valores de los KPIs.
 * También incluye la lógica para habilitar/deshabilitar la funcionalidad de rollup para KPIs,
 * ajustando los campos de actualización relacionados.
 * Asegura la validación de datos, la consistencia lógica y la protección de accesos no autorizados.
 */
"use server";

import { db } from "@/db/db";
import {
  InsertKpi,
  InsertKpiUpdater,
  InsertKpiValue,    
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
  appSettingsTable, // Para futuras referencias
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
const getKpiByIdSchema = z.object({ id: z.string().uuid("ID de KPI inválido."), });

/**
 * @schema deleteKpiSchema
 * @description Esquema de validación para la eliminación de un KPI.
 * @property {string} id - ID del KPI, UUID requerido.
 */
const deleteKpiSchema = z.object({ id: z.string().uuid("ID de KPI inválido."), });

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
 */
const setKpiCalculationEquationSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  calculationEquation: z
    .string()
    .max(1000, "La ecuación no puede exceder los 1000 caracteres.")
    .optional()
    .nullable(),
});

/**
 * @schema enableKpiRollupSchema
 * @description Esquema de validación para habilitar/deshabilitar la funcionalidad de rollup en un KPI (UC-501).
 * @property {string} kpiId - ID del KPI a actualizar, UUID requerido.
 * @property {boolean} rollupEnabled - Estado deseado para la funcionalidad de rollup (true para habilitar, false para deshabilitar).
 */
const enableKpiRollupSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  rollupEnabled: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/*                                Server Actions                              */
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
      logger.warn(`Scorecard Element with ID ${validatedData.data.scorecardElementId} not found.`);
      return fail("Elemento de Scorecard no encontrado.");
    }

    if (existingScorecardElement.elementType !== "KPI") {
      logger.warn(
        `Scorecard Element with ID ${validatedData.data.scorecardElementId} is not of type 'KPI'. Actual type: ${existingScorecardElement.elementType}`,
      );
      return fail("Un KPI solo puede vincularse a un elemento de Scorecard de tipo 'KPI'.");
    }

    // Verificar si ya existe un KPI vinculado a este scorecardElementId
    const existingKpi = await firstOrUndefined(
      db
        .select()
        .from(kpisTable)
        .where(eq(kpisTable.scorecardElementId, validatedData.data.scorecardElementId)),
    );

    if (existingKpi) {
      logger.warn(
        `A KPI already exists for Scorecard Element ID ${validatedData.data.scorecardElementId}.`,
      );
      return fail("Ya existe un KPI asociado a este elemento de Scorecard.");
    }

    const newKpi: InsertKpi = {
      ...validatedData.data,
      // Default values for createdAt and updatedAt are handled by the DB schema
    };    

    const [createdKpi] = await db.insert(kpisTable).values(newKpi).returning();

    if (!createdKpi) {
      logger.error("Failed to insert KPI into the database.");
      return fail("Fallo al crear el KPI.");
    }

    logger.info("KPI created successfully.", { kpiId: createdKpi.id, scorecardElementId: createdKpi.scorecardElementId });
    return ok("KPI creado exitosamente.", createdKpi);
  } catch (error) {
    logger.error(`Error creating KPI: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail("Fallo al crear el KPI.");
  }
}

/**
 * @function getKpiAction
 * @description Obtiene un KPI específico por su ID.
 * @param {string} id - El ID del KPI a recuperar.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState con el KPI encontrado o un mensaje de error.
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
    logger.error(`Error retrieving KPI: ${error instanceof Error ? error.message : String(error)}`, { id });
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
      logger.error(`Failed to update KPI configuration for ID: ${kpiId}`);
      return fail("Fallo al actualizar la configuración del KPI.");
    }

    logger.info("KPI configuration updated successfully.", { kpiId: updatedKpi.id });
    return ok("Configuración de KPI actualizada exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(`Error updating KPI configuration: ${error instanceof Error ? error.message : String(error)}`, {
      kpiId,
      data,
    });
    return fail("Fallo al actualizar la configuración del KPI.");
  }
}

/**
 * @function deleteKpiAction
 * @description Elimina un KPI de la base de datos.
 * La eliminación en cascada de los valores de KPI asociados (kpi_values) y los updaters (kpi_updaters)
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
    const [deletedKpi] = await db.delete(kpisTable).where(eq(kpisTable.id, validatedId.data.id)).returning();

    if (!deletedKpi) {
      logger.warn(`KPI with ID ${validatedId.data.id} not found for deletion.`);
      return fail("KPI no encontrado para eliminar.");
    }

    logger.info("KPI deleted successfully.", { kpiId: deletedKpi.id });
    return ok("KPI eliminado exitosamente.");
  } catch (error) {
    logger.error(`Error deleting KPI: ${error instanceof Error ? error.message : String(error)}`, { id });
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

  // Sanitizar ownerUserId a null si es una cadena vacía
  const sanitizedOwnerUserId = ownerUserId === "" ? null : ownerUserId;

  const validatedData = assignScorecardElementOwnersSchema.safeParse({
    scorecardElementId,
    ownerUserId: sanitizedOwnerUserId,
  });
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
      logger.warn(`Scorecard Element with ID ${validatedData.data.scorecardElementId} not found.`);
      return fail("Elemento de Scorecard no encontrado.");
    }

    logger.info("Owner assigned to scorecard element successfully.", {
      scorecardElementId: updatedElement.id,
      ownerUserId: updatedElement.ownerUserId,
    });
    return ok("Propietario del elemento de Scorecard asignado exitosamente.", updatedElement);
  } catch (error) {
    logger.error(`Error assigning owner to scorecard element: ${error instanceof Error ? error.message : String(error)}`, {
      scorecardElementId,
      ownerUserId,
    });
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

    const newUpdater: InsertKpiUpdater = {
      kpiId: validatedData.data.kpiId,
      userId: validatedData.data.userId,
      canModifyThresholds: validatedData.data.canModifyThresholds || false,
      // Default values for createdAt and updatedAt are handled by the DB schema
    };

    // Use upsert pattern to insert or update
    const [result] = await db
      .insert(kpiUpdatersTable)
      .values(newUpdater)
      .onConflictDoUpdate({
        target: [kpiUpdatersTable.kpiId, kpiUpdatersTable.userId],
        set: {
          canModifyThresholds: newUpdater.canModifyThresholds,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!result) {
      logger.error("Failed to assign KPI updater.");
      return fail("Fallo al asignar el encargado de actualización de KPI.");
    }

    logger.info("KPI updater assigned/updated successfully.", {
      kpiId: result.kpiId,
      userId: result.userId,
    });
    return ok("Encargado de actualización de KPI asignado/actualizado exitosamente.", result);
  } catch (error) {
    logger.error(`Error assigning KPI updater: ${error instanceof Error ? error.message : String(error)}`, {
      data,
    });
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
 *  El valor actual del KPI y los umbrales se almacenan como texto para compatibilidad con el esquema,
 *  Se verifica la configuración require_note_for_red_kpi en appSettingsTable antes de permitir la actualización.
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
    // Helper: valida string no vacío (evita undefined/null y espacios)
    const isNonEmptyString = (v: unknown): v is string =>
      typeof v === "string" && v.trim() !== "";
  
    // 1. Verify if the current user is an authorized updater for this KPI
    const isUpdater = await firstOrUndefined(
      db
        .select()
        .from(kpiUpdatersTable)
        .where(and(eq(kpiUpdatersTable.kpiId, kpiId), eq(kpiUpdatersTable.userId, currentAuthUserId))),
    );

    // TODO: Implement proper permission check for updaters based on organization or roles.
    // For now, a user is an updater if they are explicitly assigned to this KPI.
    // In a real scenario, an admin might update any KPI. This check assumes non-admin update.
    if (!isUpdater) {
      logger.warn(`User ${currentAuthUserId} is not an authorized updater for KPI ${kpiId}.`);
      return fail("No tiene permisos para actualizar este KPI.");
    }

    // 2. Get KPI configuration to determine data type and scoring type
    const kpiConfig = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, kpiId)));

    if (!kpiConfig) {
      logger.warn(`KPI configuration not found for ID: ${kpiId}.`);
      return fail("Configuración de KPI no encontrada.");
    }

    // 3. Validate actualValue based on KPI data type
    let parsedActualValue: number | null = null;
    if (actualValue !== null && actualValue !== undefined && actualValue !== "") {
      if (numericDataTypes.has(kpiConfig.dataType)) {
        parsedActualValue = parseFloat(actualValue);
        if (isNaN(parsedActualValue)) {
          return fail(`El valor actual no es un número válido para el tipo de dato ${kpiConfig.dataType}.`);
        }
      }
    }

    // 4. Calculate score and color for 'Goal/Red Flag' KPIs
    let score: number | null = null;
    let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

    if (kpiConfig.scoringType === "Goal/Red Flag") {
      const parsedTarget = isNonEmptyString(targetValue) ? parseFloat(targetValue) : null;
      const parsedThresholdRed = isNonEmptyString(thresholdRed) ? parseFloat(thresholdRed) : null;
      const parsedThresholdYellow = isNonEmptyString(thresholdYellow) ? parseFloat(thresholdYellow) : null;

      if (parsedTarget === null && isNonEmptyString(targetValue)) {
        return fail("El valor objetivo no es un número válido.");
      }
      if (parsedThresholdRed === null && isNonEmptyString(thresholdRed)) {
        return fail("El umbral rojo no es un número válido.");
      }
      if (parsedThresholdYellow === null && isNonEmptyString(thresholdYellow)) {
        return fail("El umbral amarillo no es un número válido.");
      }

      const calculated = calculateKpiScoreAndColor(
        parsedActualValue,
        parsedTarget,
        parsedThresholdRed,
        parsedThresholdYellow,
      );
      score = calculated.score;
      color = calculated.color;
    } else if (kpiConfig.scoringType === "Yes/No") {
      // For Yes/No, map 'Yes' to 100 (Green), 'No' to 0 (Red), others to null/Red
      if (actualValue?.toLowerCase() === "yes") {
        score = 100;
        color = "Green";
      } else if (actualValue?.toLowerCase() === "no") {
        score = 0;
        color = "Red";
      } else {
        score = null;
        color = null; // Or default to Red if strict
      }
    } else if (kpiConfig.scoringType === "Text") {
      // For Text KPIs, score and color are not typically calculated automatically
      score = null;
      color = null;
    }

    // 5. Check if note is required for 'Red' KPIs (UC-303)
    // This requires checking an app setting.
    const requireNoteSetting: SelectAppSetting | undefined = await firstOrUndefined(
      db.select().from(appSettingsTable).where(eq(appSettingsTable.settingKey, "require_note_for_red_kpi")),
    );
    const isNoteRequired = requireNoteSetting?.settingValue === "true";

    if (isNoteRequired && color === "Red" && (!note || note.trim() === "")) {
      return fail("Una nota es requerida al actualizar un KPI a estado 'Rojo'.");
    }

    const insertOrUpdateData: InsertKpiValue = {
      kpiId: kpiId,
      periodDate: periodDate,
      actualValue: actualValue,
      targetValue: targetValue,
      thresholdRed: thresholdRed,
      thresholdYellow: thresholdYellow,
      score: score !== null ? String(score) : null, // Store numeric score as string for decimal type
      color: color,
      updatedByUserId: currentAuthUserId,
      isManualEntry: true,
      note: note,
      // createdAt and updatedAt handled by schema
    };

    const [upsertedKpiValue] = await db
      .insert(kpiValuesTable)
      .values(insertOrUpdateData)
      .onConflictDoUpdate({
        target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
        set: {
          actualValue: insertOrUpdateData.actualValue,
          targetValue: insertOrUpdateData.targetValue,
          thresholdRed: insertOrUpdateData.thresholdRed,
          thresholdYellow: insertOrUpdateData.thresholdYellow,
          score: insertOrUpdateData.score,
          color: insertOrUpdateData.color,
          updatedByUserId: insertOrUpdateData.updatedByUserId,
          isManualEntry: insertOrUpdateData.isManualEntry,
          note: insertOrUpdateData.note,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!upsertedKpiValue) {
      logger.error(`Failed to upsert KPI value for KPI ID: ${kpiId}, Period: ${periodDate}`);
      return fail("Fallo al actualizar el valor manual del KPI.");
    }

    logger.info("KPI manual value updated successfully.", { kpiId: upsertedKpiValue.kpiId, periodDate: upsertedKpiValue.periodDate });
    return ok("Valor de KPI actualizado exitosamente.", upsertedKpiValue);
  } catch (error) {
    logger.error(`Error updating KPI manual value: ${error instanceof Error ? error.message : String(error)}`, {
      kpiId,
      periodDate,
      actualValue,
    });
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
 *  Esta acción actualiza tanto calculation_equation como is_manual_update.
 *  La lógica para la evaluación real de la ecuación se manejará en pasos posteriores
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

  try {
    const { kpiId, calculationEquation } = validatedData.data;

    // Determine isManualUpdate based on the presence of a calculationEquation
    const isManualUpdate = !calculationEquation;

    const [updatedKpi] = await db
      .update(kpisTable)
      .set({
        calculationEquation: calculationEquation,
        isManualUpdate: isManualUpdate,
        updatedAt: new Date(),
      })
      .where(eq(kpisTable.id, kpiId))
      .returning();

    if (!updatedKpi) {
      logger.error(`Failed to update KPI calculation equation for ID: ${kpiId}.`);
      return fail("Fallo al configurar la ecuación de cálculo del KPI.");
    }

    // TODO: Trigger recalculation for this KPI and any dependent KPIs
    logger.info("KPI calculation equation updated successfully.", { kpiId: updatedKpi.id, isManualUpdate });
    return ok("Ecuación de cálculo de KPI configurada exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(`Error setting KPI calculation equation: ${error instanceof Error ? error.message : String(error)}`, {
      data,
    });
    return fail("Fallo al configurar la ecuación de cálculo del KPI.");
  }
}

/**
 * @function enableKpiRollupAction
 * @description Habilita o deshabilita la funcionalidad de rollup para un KPI (UC-501).
 * Cuando el rollup se habilita, el KPI se marca como no manual y su ecuación de cálculo se limpia,
 * ya que su valor será agregado desde organizaciones hijas. Si se deshabilita, se marca como manual.
 * @param {z.infer<typeof enableKpiRollupSchema>} data - Objeto con el ID del KPI y el estado deseado para rollup.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI actualizado.
 */
export async function enableKpiRollupAction(
  data: z.infer<typeof enableKpiRollupSchema>,
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to enable/disable KPI rollup.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = enableKpiRollupSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for enableKpiRollupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const { kpiId, rollupEnabled } = validatedData.data;

    // Si el rollup está habilitado, el KPI no es de actualización manual y su ecuación se limpia.
    // Si el rollup está deshabilitado, el KPI vuelve a ser de actualización manual y su ecuación se limpia.
    const [updatedKpi] = await db
      .update(kpisTable)
      .set({
        rollupEnabled: rollupEnabled,
        isManualUpdate: !rollupEnabled, // No es manual si está en rollup, sí es manual si no está en rollup.
        calculationEquation: null, // El rollup o la entrada manual/nueva ecuación gestionarán el valor.
        updatedAt: new Date(),
      })
      .where(eq(kpisTable.id, kpiId))
      .returning();

    if (!updatedKpi) {
      logger.error(`Failed to update KPI rollup status for ID: ${kpiId}.`);
      return fail("Fallo al actualizar el estado de rollup del KPI.");
    }

    // TODO: Si rollupEnabled es true, se podría disparar una primera ejecución del cálculo de rollup.
    // Si rollupEnabled es false, se podría limpiar cualquier valor de rollup previo o restablecerlo.

    logger.info("KPI rollup status updated successfully.", { kpiId: updatedKpi.id, rollupEnabled: updatedKpi.rollupEnabled });
    return ok("Estado de rollup de KPI actualizado exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(`Error enabling/disabling KPI rollup: ${error instanceof Error ? error.message : String(error)}`, {
      data,
    });
    return fail("Fallo al habilitar/deshabilitar el rollup del KPI.");
  }
}