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
  kpiAggregationTypeEnum,
  kpiCalendarFrequencyEnum,
  kpiDataTypeEnum,
  kpiScoringTypeEnum,
  kpisTable,
  scorecardElementsTable,
  SelectKpi,
  SelectScorecardElement,
  kpiUpdatersTable,
  InsertKpiUpdater,
  kpiValuesTable,
  InsertKpiValue,
  kpiColorEnum,
  profilesTable,
  SelectKpiValue,  
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types"
import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";

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
 * @schema assignScorecardElementOwnerSchema
 * @description Esquema de validación para asignar un propietario a un elemento de Scorecard.
 * @property {string} scorecardElementId - ID del elemento de Scorecard, UUID requerido.
 * @property {string | null} ownerUserId - ID del usuario propietario, opcional y nullable.
 */
const assignScorecardElementOwnerSchema = z.object({
  scorecardElementId: z.string().uuid("ID de elemento de Scorecard inválido."),
  ownerUserId: z.string().optional().nullable(),
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
      return fail("El elemento de Scorecard especificado no existe.");
    }

    // Un KPI solo puede vincularse a un elemento de Scorecard de tipo 'KPI'
    if (existingScorecardElement.elementType !== "KPI") {
      logger.warn(
        `Attempt to link KPI to a Scorecard Element of type '${existingScorecardElement.elementType}' instead of 'KPI'.`,
      );
      return fail("Un KPI solo puede vincularse a un elemento de Scorecard de tipo 'KPI'.");
    }

    const newKpi: InsertKpi = {
      ...validatedData.data,
      // Drizzle handles `decimal` as string, so ensure numbers are converted if coming from a number input in Zod
      // For `decimalPrecision`, Zod already ensures it's a number.
      scorecardElementId: validatedData.data.scorecardElementId, // Explicitly ensure type
    };

    const [createdKpi] = await db.insert(kpisTable).values(newKpi).returning();

    if (!createdKpi) {
      logger.error("Failed to insert KPI into database.");
      return fail("Fallo al crear el KPI.");
    }

    logger.info(`KPI created successfully with ID: ${createdKpi.id}`);
    return ok("KPI creado exitosamente.", createdKpi);
  } catch (error) {
    logger.error(`Error creating KPI: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al crear el KPI.");
  }
}

/**
 * @function getKpiAction
 * @description Obtiene un KPI específico por su ID.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * @param {string} id - El ID único del KPI a obtener.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI.
 */
export async function getKpiAction(id: string): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve KPI.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = z.string().uuid("ID de KPI inválido.").safeParse(id);
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getKpiAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const kpi: SelectKpi | undefined = await firstOrUndefined(
      db.select().from(kpisTable).where(eq(kpisTable.id, validatedId.data)),
    );

    if (!kpi) {
      logger.warn(`KPI with ID ${validatedId.data} not found.`);
      return fail("KPI no encontrado.");
    }

    logger.info(`KPI retrieved successfully with ID: ${kpi.id}`);
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
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(kpisTable.id, kpiId))
      .returning();

    if (!updatedKpi) {
      logger.warn(`KPI with ID ${kpiId} not found for update.`);
      return fail("KPI no encontrado para actualizar.");
    }

    logger.info(`KPI configuration updated successfully for ID: ${updatedKpi.id}`);
    return ok("Configuración de KPI actualizada exitosamente.", updatedKpi);
  } catch (error) {
    logger.error(
      `Error updating KPI configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail("Fallo al actualizar la configuración del KPI.");
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

  // Sanitizar ownerUserId para que sea null si es una cadena vacía
  const sanitizedOwnerUserId = ownerUserId === "" ? null : ownerUserId;

  const validatedPayload = assignScorecardElementOwnerSchema.safeParse({
    scorecardElementId,
    ownerUserId: sanitizedOwnerUserId,
  });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for assignScorecardElementOwnersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [updatedScorecardElement] = await db
      .update(scorecardElementsTable)
      .set({
        ownerUserId: validatedPayload.data.ownerUserId,
        updatedAt: new Date(),
      })
      .where(eq(scorecardElementsTable.id, validatedPayload.data.scorecardElementId))
      .returning();

    if (!updatedScorecardElement) {
      logger.warn(`Scorecard element with ID ${validatedPayload.data.scorecardElementId} not found for owner assignment.`);
      return fail("Elemento de Scorecard no encontrado para asignar propietario.");
    }

    logger.info(`Owner assigned successfully to scorecard element ID: ${updatedScorecardElement.id}`);
    return ok("Propietario del elemento de Scorecard asignado exitosamente.", updatedScorecardElement);
  } catch (error) {
    logger.error(
      `Error assigning owner to scorecard element: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fail("Fallo al asignar el propietario del elemento de Scorecard.");
  }
}

/**
 * @function assignKpiUpdatersAction
 * @description Asigna un usuario como "Updater" (encargado de actualización manual) para un KPI específico.
 * Si el usuario ya es un updater, actualiza sus permisos (ej. `canModifyThresholds`).
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

    // Verify User exists (assuming profilesTable is synced with Clerk or at least the userId exists)
    // A more robust check might involve Clerk's API, but for DB FK, existence in profilesTable is sufficient
    // const existingUser = await firstOrUndefined(
    //   db.select().from(db.schema.profiles).where(eq(db.schema.profiles.userId, validatedData.data.userId)),
    // );
    const existingUser = await firstOrUndefined(
      db.select().from(profilesTable).where(eq(profilesTable.userId, validatedData.data.userId)),
    );    
    if (!existingUser) {
      logger.warn(`User with ID ${validatedData.data.userId} not found for assigning updater.`);
      return fail("Usuario no encontrado.");
    }

    // Insert or update kpi_updaters
    const [updater] = await db
      .insert(kpiUpdatersTable)
      .values({ ...validatedData.data, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [kpiUpdatersTable.kpiId, kpiUpdatersTable.userId],
        set: {
          canModifyThresholds: validatedData.data.canModifyThresholds,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updater) {
      logger.error("Failed to assign KPI updater.");
      return fail("Fallo al asignar el encargado de actualización de KPI.");
    }

    logger.info(`KPI updater assigned/updated successfully for KPI ID: ${updater.kpiId}, User ID: ${updater.userId}`);
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

  const { kpiId, periodDate, actualValue, targetValue, thresholdRed, thresholdYellow, note } =
    validatedData.data;

  try {
    // 1. Verify if the current user is an authorized updater for this KPI
    const isUpdater = await firstOrUndefined(
      db
        .select()
        .from(kpiUpdatersTable)
        .where(and(eq(kpiUpdatersTable.kpiId, kpiId), eq(kpiUpdatersTable.userId, currentAuthUserId))),
    );

    if (!isUpdater) {
      logger.warn(`User ${currentAuthUserId} attempted to update KPI ${kpiId} without being an assigned updater.`);
      return fail("No tienes permiso para actualizar este KPI.");
    }

    // 2. Retrieve KPI configuration for data type and scoring type validation
    const kpiConfig = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, kpiId)));

    if (!kpiConfig) {
      logger.warn(`KPI with ID ${kpiId} not found during manual update attempt.`);
      return fail("KPI no encontrado.");
    }

    // Prepare values for database insertion (all stored as text)
    let kpiValueToInsert: Omit<InsertKpiValue, "id" | "createdAt" | "updatedAt"> = {
      kpiId,
      periodDate: periodDate, // Drizzle handles 'YYYY-MM-DD' strings for 'date' type
      actualValue: actualValue ?? null,
      targetValue: targetValue ?? null,
      thresholdRed: thresholdRed ?? null,
      thresholdYellow: thresholdYellow ?? null,
      updatedByUserId: currentAuthUserId,
      isManualEntry: true,
      note: note ?? null,
      score: null, // Will be calculated if Goal/Red Flag
      color: null, // Will be calculated if Goal/Red Flag
    };

    // 3. Perform data type specific validation and conversions
    switch (kpiConfig.dataType) {
      case "Number":
      case "Percentage":
      case "Currency":
        // Validate if values are numeric
        const parseNumeric = (val: string | null | undefined, fieldName: string) => {
          if (val === null || val === undefined) return null;
          const num = Number(val);
          if (isNaN(num)) {
            throw new Error(`El ${fieldName} debe ser un valor numérico.`);
          }
          // Convert back to string for text column storage, ensuring decimal precision
          return num.toFixed(kpiConfig.decimalPrecision);
        };
        try {
          kpiValueToInsert.actualValue = parseNumeric(actualValue, "valor actual");
          // Only updaters with canModifyThresholds can set/update thresholds
          if (isUpdater.canModifyThresholds) {
            kpiValueToInsert.targetValue = parseNumeric(targetValue, "valor objetivo");
            kpiValueToInsert.thresholdRed = parseNumeric(thresholdRed, "umbral rojo");
            kpiValueToInsert.thresholdYellow = parseNumeric(thresholdYellow, "umbral amarillo");
          } else {
             // If updater cannot modify thresholds, ensure these fields are not updated
             delete kpiValueToInsert.targetValue;
             delete kpiValueToInsert.thresholdRed;
             delete kpiValueToInsert.thresholdYellow;
          }
        } catch (e) {
          logger.error(`Numeric validation failed for KPI ${kpiId}: ${e instanceof Error ? e.message : String(e)}`);
          return fail(e instanceof Error ? e.message : "Fallo en la validación numérica de KPI.");
        }
        break;
      case "Text":
        // Only actualValue is relevant for Text type, others should be null
        if (targetValue || thresholdRed || thresholdYellow) {
          logger.warn(`Attempt to set target/threshold values for Text KPI ${kpiId}. Ignoring.`);
        }
        kpiValueToInsert.targetValue = null;
        kpiValueToInsert.thresholdRed = null;
        kpiValueToInsert.thresholdYellow = null;
        break;
      default:
        // No specific validation needed for other types for now
        break;
    }

    // 4. Calculate Score and Color if Scoring Type is "Goal/Red Flag"
    if (kpiConfig.scoringType === "Goal/Red Flag" && kpiValueToInsert.actualValue) {
      const actual = Number(kpiValueToInsert.actualValue);
      const redThreshold = kpiValueToInsert.thresholdRed ? Number(kpiValueToInsert.thresholdRed) : undefined;
      const yellowThreshold = kpiValueToInsert.thresholdYellow ? Number(kpiValueToInsert.thresholdYellow) : undefined;
      const target = kpiValueToInsert.targetValue ? Number(kpiValueToInsert.targetValue) : undefined;

      // Simple scoring logic: Red if below red threshold, Yellow if below yellow, Green otherwise (or if above target)
      let calculatedColor: (typeof kpiColorEnum.enumValues)[number] = "Green";
      if (redThreshold !== undefined && actual < redThreshold) {
        calculatedColor = "Red";
      } else if (yellowThreshold !== undefined && actual < yellowThreshold) {
        calculatedColor = "Yellow";
      }
      
      // Basic score calculation (e.g., percentage towards target if target exists)
      let calculatedScore: string | null = null;
      if (target !== undefined && target !== 0) {
        calculatedScore = ((actual / target) * 100).toFixed(kpiConfig.decimalPrecision); // Store as string
      } else if (target === 0 && actual === 0) {
        calculatedScore = "100.00"; // Or some other sensible default if target is 0 and actual is 0
      }

      kpiValueToInsert.color = calculatedColor;
      kpiValueToInsert.score = calculatedScore;
    }
    // TODO: UC-303 Require Note for Red KPI
    // Check app_settings for setting 'require_note_for_red_kpi'
    // If enabled and calculatedColor is "Red" and note is null, return error.

    // 5. Upsert (Insert or Update) the KPI value
    const [updatedKpiValue] = await db
      .insert(kpiValuesTable)
      .values({ ...kpiValueToInsert, createdAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
        set: {
          actualValue: kpiValueToInsert.actualValue,
          targetValue: kpiValueToInsert.targetValue,
          thresholdRed: kpiValueToInsert.thresholdRed,
          thresholdYellow: kpiValueToInsert.thresholdYellow,
          score: kpiValueToInsert.score,
          color: kpiValueToInsert.color,
          updatedByUserId: kpiValueToInsert.updatedByUserId,
          isManualEntry: kpiValueToInsert.isManualEntry,
          note: kpiValueToInsert.note,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!updatedKpiValue) {
      logger.error(`Failed to upsert KPI value for KPI ID: ${kpiId}, Period: ${periodDate}.`);
      return fail("Fallo al actualizar el valor manual del KPI.");
    }

    logger.info(`KPI value updated/inserted successfully for KPI ID: ${kpiId}, Period: ${periodDate}`);
    return ok("Valor de KPI actualizado exitosamente.", updatedKpiValue);
  } catch (error) {
    logger.error(`Error updating KPI manual value: ${error instanceof Error ? error.message : String(error)}`);
    return fail(`Fallo al actualizar el valor manual del KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}