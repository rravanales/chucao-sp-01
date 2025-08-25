/**
 * @file actions/db/kpi-actions.ts
 * @brief Implementa Server Actions para la gestión de Indicadores Clave de Rendimiento (KPIs) en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar la configuración de KPIs, y asignar propietarios a los elementos de Scorecard
 * a los que están vinculados. Asegura la validación de datos, la consistencia lógica
 * y la protección de accesos no autorizados.
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
} from "@/db/schema";
import { ActionState } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";

const logger = getLogger("kpi-actions");

// Helper para obtener el primer elemento de un array o undefined
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows[0];
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
    //   if (data.scoringType === "Goal/Red Flag" && !numericDataTypes.includes(data.dataType)) {
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
    }
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
            // if (data.scoringType === "Goal/Red Flag" && !numericDataTypes.includes(data.dataType)) {
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
    }
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
 * @function createKpiAction
 * @description Crea un nuevo KPI en la base de datos, vinculado a un elemento de Scorecard existente.
 * Verifica la autenticación del usuario, valida los datos de entrada y asegura que el elemento
 * de Scorecard al que se vincula sea de tipo 'KPI'.
 * @param {Omit<InsertKpi, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos del nuevo KPI.
 * @returns {Promise<ActionState<SelectKpi>>} Un objeto ActionState indicando el éxito o fracaso y los datos del KPI creado.
 */
export async function createKpiAction(
  data: Omit<InsertKpi, "id" | "createdAt" | "updatedAt">
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create KPI.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
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
    return { isSuccess: false, message: errorMessage };
  }

  try {
    // Verificar que el scorecardElementId existe y es de tipo 'KPI'
    const existingScorecardElement: SelectScorecardElement | undefined = await firstOrUndefined(
      db
        .select()
        .from(scorecardElementsTable)
        .where(eq(scorecardElementsTable.id, validatedData.data.scorecardElementId))
    );

    if (!existingScorecardElement) {
      logger.warn(
        `Scorecard element with ID ${validatedData.data.scorecardElementId} not found.`
      );
      return { isSuccess: false, message: "Elemento de Scorecard no encontrado." };
    }

    if (existingScorecardElement.elementType !== "KPI") {
      logger.warn(
        `Attempt to create KPI for scorecard element ID ${validatedData.data.scorecardElementId} which is not of type 'KPI'.`
      );
      return {
        isSuccess: false,
        message: "El elemento de Scorecard debe ser de tipo 'KPI' para asociarle un KPI.",
      };
    }

    // Insertar el nuevo KPI en la base de datos
    const [newKpi] = await db
      .insert(kpisTable)
      .values({
        ...validatedData.data,
        createdAt: new Date(), // Drizzle handles default, but explicit for clarity
        updatedAt: new Date(), // Drizzle handles default, but explicit for clarity
      })
      .returning();

    if (!newKpi) {
      logger.error("Failed to retrieve the created KPI after insertion.");
      return { isSuccess: false, message: "Fallo al crear el KPI." };
    }

    logger.info(`KPI created successfully with ID: ${newKpi.id}`);
    return { isSuccess: true, message: "KPI creado exitosamente.", data: newKpi };
  } catch (error) {
    logger.error(`Error creating KPI: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al crear el KPI." };
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
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  const validatedId = z.string().uuid("ID de KPI inválido.").safeParse(id);
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getKpiAction: ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  try {
    const kpi: SelectKpi | undefined = await firstOrUndefined(
      db.select().from(kpisTable).where(eq(kpisTable.id, validatedId.data))
    );

    if (!kpi) {
      logger.warn(`KPI with ID ${validatedId.data} not found.`);
      return { isSuccess: false, message: "KPI no encontrado." };
    }

    logger.info(`KPI retrieved successfully with ID: ${kpi.id}`);
    return { isSuccess: true, message: "KPI obtenido exitosamente.", data: kpi };
  } catch (error) {
    logger.error(`Error retrieving KPI: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al obtener el KPI." };
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
  data: Partial<Omit<InsertKpi, "id" | "createdAt" | "updatedAt" | "scorecardElementId">>
): Promise<ActionState<SelectKpi>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update KPI configuration.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
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
    return { isSuccess: false, message: errorMessage };
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
      logger.warn(`KPI with ID ${kpiId} not found or no changes applied.`);
      return { isSuccess: false, message: "KPI no encontrado o no se aplicaron cambios." };
    }

    logger.info(`KPI configuration updated successfully for ID: ${updatedKpi.id}`);
    return { isSuccess: true, message: "Configuración de KPI actualizada exitosamente.", data: updatedKpi };
  } catch (error) {
    logger.error(
      `Error updating KPI configuration: ${error instanceof Error ? error.message : String(error)}`
    );
    return { isSuccess: false, message: "Fallo al actualizar la configuración del KPI." };
  }
}

/**
 * @function assignScorecardElementOwnersAction
 * @description Asigna uno o más usuarios como propietarios de un elemento de Scorecard.
 * Esta acción se incluye aquí según el plan de implementación, aunque modifica la tabla `scorecardElementsTable`.
 * @param {string} scorecardElementId - El ID del elemento de Scorecard al que se asignarán los propietarios.
 * @param {string | null} ownerUserId - El ID del usuario que será el propietario, o `null` para quitar el propietario.
 * @returns {Promise<ActionState<SelectScorecardElement>>} Un objeto ActionState indicando el éxito o fracaso y los datos actualizados del elemento de Scorecard.
 */
export async function assignScorecardElementOwnersAction(
  scorecardElementId: string,
  ownerUserId: string | null
): Promise<ActionState<SelectScorecardElement>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to assign scorecard element owner.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
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
    return { isSuccess: false, message: errorMessage };
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
      logger.warn(
        `Scorecard element with ID ${validatedPayload.data.scorecardElementId} not found or owner already set.`
      );
      return {
        isSuccess: false,
        message: "Elemento de Scorecard no encontrado o el propietario ya está asignado.",
      };
    }

    logger.info(
      `Owner assigned successfully to scorecard element ID: ${updatedScorecardElement.id}`
    );
    return {
      isSuccess: true,
      message: "Propietario asignado exitosamente.",
      data: updatedScorecardElement,
    };
  } catch (error) {
    logger.error(
      `Error assigning owner to scorecard element: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { isSuccess: false, message: "Fallo al asignar el propietario del elemento de Scorecard." };
  }
}