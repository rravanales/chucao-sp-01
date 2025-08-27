/**
 *  @file actions/db/import-actions.ts
 *  @brief Implementa Server Actions para la gestión de importaciones estándar de valores de KPI en DeltaOne.
 *  @description Este archivo contiene funciones del lado del servidor para crear, leer,
 *  actualizar, eliminar y ejecutar configuraciones de importación de KPI guardadas.
 *  Maneja la lógica de obtención de datos (con un placeholder para la extracción real),
 *  aplicación de transformaciones y actualización de los valores de KPI en la base de datos.
 *  Asegura la validación de datos, el cifrado de credenciales sensibles y la protección de accesos.
 */

"use server";

import { db } from "@/db/db";
import {
  InsertSavedImport,
  SelectSavedImport,
  savedImportsTable,
  importConnectionsTable,
  kpiValuesTable,
  kpisTable,
  kpiScoringTypeEnum,
  kpiColorEnum,
  kpiDataTypeEnum,
  SelectKpi,
  InsertKpiValue,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import {
  KpiMapping,
  KpiMappingSchema,
  TransformationRule,
  TransformationRuleSchema,
} from "@/types/import-types"; // Importar los esquemas Zod de KpiMapping y TransformationRule
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { encrypt, decrypt } from "@/lib/encryption";
import { applyTransformations } from "@/lib/data-transformer";

const logger = getLogger("import-actions");

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

/**
 * @typedef {'Number' | 'Percentage' | 'Currency' | 'Text'} KpiDataType
 * @description Define los tipos de datos posibles para un KPI.
 */
type KpiDataType = (typeof kpiDataTypeEnum.enumValues)[number];
const numericDataTypes = new Set<KpiDataType>(["Number", "Percentage", "Currency"]);

/**
 * @function calculateKpiScoreAndColor
 * @description Calcula la puntuación y el color de un KPI de tipo 'Goal/Red Flag'
 * basado en el valor actual, objetivo y umbrales.
 * @param {number | null} actualValue - El valor actual del KPI.
 * @param {number | null} targetValue - El valor objetivo del KPI.
 * @param {number | null} thresholdRed - El umbral que define el estado "Rojo".
 * @param {number | null} thresholdYellow - El umbral que define el estado "Amarillo".
 * @returns {{ score: number | null; color: (typeof kpiColorEnum.enumValues)[number] | null }}
 * Un objeto con la puntuación calculada y el color correspondiente, o null si el valor actual no es numérico.
 * @notes
 * Esta es una implementación simplificada de la lógica de puntuación. Una implementación
 * más robusta podría considerar la dirección del objetivo (mayor es mejor, menor es mejor, en rango).
 * Para este contexto, se asume "mayor o igual es mejor" para el objetivo.
 */
export function calculateKpiScoreAndColor(
  actualValue: number | null,
  targetValue: number | null,
  thresholdRed: number | null,
  thresholdYellow: number | null
): { score: number | null; color: (typeof kpiColorEnum.enumValues)[number] | null } {
  if (actualValue === null || isNaN(actualValue)) {
    return { score: null, color: null };
  }

  let score: number | null = null;
  let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

  // Si hay un valor objetivo, calcular score y color en relación a él
  if (targetValue !== null && !isNaN(targetValue) && targetValue > 0) {
    if (actualValue >= targetValue) {
      score = 100;
      color = "Green";
    } else if (thresholdYellow !== null && !isNaN(thresholdYellow) && actualValue >= thresholdYellow) {
      // Si hay un umbral amarillo y el actual está por encima o igual
      score = 50 + ((actualValue - thresholdYellow) / (targetValue - thresholdYellow)) * 50;
      color = "Yellow";
    } else if (thresholdRed !== null && !isNaN(thresholdRed) && actualValue >= thresholdRed) {
      // Si hay un umbral rojo y el actual está por encima o igual, pero por debajo del amarillo
      score = (actualValue / thresholdRed) * 50; // Simple linear scale to 0-50 for red range
      color = "Red";
    } else {
      // Por debajo de todos los umbrales
      score = 0;
      color = "Red";
    }
  } else if (thresholdRed !== null && !isNaN(thresholdRed)) {
    // Si no hay objetivo pero sí umbral rojo, y el valor actual es menor
    if (actualValue < thresholdRed) {
      color = "Red";
      score = 0; // O un valor proporcional
    } else {
      color = "Green"; // Si está por encima del umbral rojo, asume verde si no hay más info
      score = 100;
    }
  } else {
    // Si no hay objetivo ni umbrales, el score y color son indeterminados o se asumen neutrales
    score = null;
    color = null;
  }

  // Asegurar que el score no exceda 100 ni sea menor que 0
  if (score !== null) {
    score = Math.max(0, Math.min(100, score));
  }

  return { score, color };
}

/* -------------------------------------------------------------------------- */
/*                           Esquemas de Validación Zod                       */
/* -------------------------------------------------------------------------- */

/**
 * @schema createSavedKpiImportSchema
 * @description Esquema de validación para la creación de una nueva importación de KPI guardada.
 * @property {string} name - Nombre único de la importación, requerido y máximo 255 caracteres.
 * @property {string} connectionId - ID de la conexión de importación, UUID requerido.
 * @property {KpiMapping[]} kpiMappings - Array de objetos de mapeo de KPI, requerido.
 * @property {TransformationRule[] | null} transformations - Array de reglas de transformación, opcional y nullable.
 * @property {any | null} scheduleConfig - Configuración de programación, opcional y nullable.
 */
const createSavedKpiImportSchema = z.object({
  name: z.string().min(1, "El nombre de la importación es requerido.").max(255, "El nombre no puede exceder los 255 caracteres."),
  connectionId: z.string().uuid("ID de conexión inválido."),
  kpiMappings: z.array(KpiMappingSchema).min(1, "Debe haber al menos un mapeo de KPI."),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: z.any().nullable().optional(), // Flexible para la configuración del cron job
});

/**
 * @schema updateSavedKpiImportSchema
 * @description Esquema de validación para la actualización de una importación de KPI guardada existente.
 * @property {string} id - ID de la importación guardada a actualizar, UUID requerido.
 * @property {string} [name] - Nombre único de la importación, opcional y máximo 255 caracteres.
 * @property {string} [connectionId] - ID de la conexión de importación, UUID opcional.
 * @property {KpiMapping[]} [kpiMappings] - Array de objetos de mapeo de KPI, opcional.
 * @property {TransformationRule[] | null} [transformations] - Array de reglas de transformación, opcional y nullable.
 * @property {any | null} [scheduleConfig] - Configuración de programación, opcional y nullable.
 */
const updateSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
  name: z.string().min(1, "El nombre de la importación es requerido.").max(255, "El nombre no puede exceder los 255 caracteres.").optional(),
  connectionId: z.string().uuid("ID de conexión inválido.").optional(),
  kpiMappings: z.array(KpiMappingSchema).min(1, "Debe haber al menos un mapeo de KPI.").optional(),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: z.any().nullable().optional(),
});

/**
 * @schema deleteSavedKpiImportSchema
 * @description Esquema de validación para la eliminación de una importación de KPI guardada.
 * @property {string} id - ID de la importación guardada a eliminar, UUID requerido.
 */
const deleteSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema getSavedImportByIdSchema
 * @description Esquema de validación para obtener una importación de KPI guardada por ID.
 * @property {string} id - ID de la importación guardada, UUID requerido.
 */
const getSavedImportByIdSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema executeSavedKpiImportSchema
 * @description Esquema de validación para la ejecución de una importación de KPI guardada.
 * @property {string} id - ID de la importación guardada a ejecutar, UUID requerido.
 */
const executeSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/* -------------------------------------------------------------------------- */
/*                              Server Actions                                */
/* -------------------------------------------------------------------------- */

/**
 * @function createSavedKpiImportAction
 * @description Crea una nueva configuración de importación de KPI guardada en la base de datos (UC-201).
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Asegura la unicidad del nombre de la importación.
 * @param {Omit<InsertSavedImport, 'id' | 'createdById' | 'createdAt' | 'updatedAt' | 'lastRunAt'>} data - Objeto con los datos de la nueva importación.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function createSavedKpiImportAction(
  data: Omit<InsertSavedImport, "id" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create saved KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = createSavedKpiImportSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for createSavedKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    // Verificar si ya existe una importación con el mismo nombre
    const existingImport = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.name, validatedData.data.name))
    );
    if (existingImport) {
      return fail(`Ya existe una importación con el nombre "${validatedData.data.name}".`);
    }

    const [newImport] = await db
      .insert(savedImportsTable)
      .values({
        ...validatedData.data,
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return ok("Importación de KPI guardada exitosamente.", newImport);
  } catch (error) {
    logger.error(`Error creating saved KPI import: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail("Fallo al crear la importación de KPI guardada.");
  }
}

/**
 * @function getSavedImportsAction
 * @description Obtiene una lista de todas las importaciones de KPI guardadas.
 * Verifica la autenticación del usuario.
 * @returns {Promise<ActionState<SelectSavedImport[]>>} Un objeto ActionState con la lista de importaciones o un mensaje de error.
 */
export async function getSavedImportsAction(): Promise<ActionState<SelectSavedImport[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve saved KPI imports.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const imports = await db.select().from(savedImportsTable);
    return ok("Importaciones de KPI guardadas obtenidas exitosamente.", imports);
  } catch (error) {
    logger.error(`Error retrieving saved KPI imports: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al obtener las importaciones de KPI guardadas.");
  }
}

/**
 * @function getSavedImportByIdAction
 * @description Obtiene una importación de KPI guardada específica por su ID.
 * Verifica la autenticación del usuario y valida el ID.
 * @param {string} id - El ID de la importación guardada a obtener.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación o un mensaje de error.
 */
export async function getSavedImportByIdAction(id: string): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve specific saved KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = getSavedImportByIdSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getSavedImportByIdAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const savedImport = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, validatedId.data.id))
    );
    if (!savedImport) {
      return fail("Importación de KPI guardada no encontrada.");
    }
    return ok("Importación de KPI guardada obtenida exitosamente.", savedImport);
  } catch (error) {
    logger.error(`Error retrieving saved KPI import by ID: ${error instanceof Error ? error.message : String(error)}`);
    return fail("Fallo al obtener la importación de KPI guardada.");
  }
}

/**
 * @function updateSavedKpiImportAction
 * @description Actualiza una configuración de importación de KPI guardada existente (UC-201).
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * @param {string} id - El ID de la importación guardada a actualizar.
 * @param {Partial<Omit<InsertSavedImport, 'id' | 'createdById' | 'createdAt' | 'updatedAt' | 'lastRunAt'>>} data - Datos parciales para actualizar la importación.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación actualizada o un mensaje de error.
 */
export async function updateSavedKpiImportAction(
  id: string,
  data: Partial<Omit<InsertSavedImport, "id" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">>
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update saved KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedPayload = updateSavedKpiImportSchema.safeParse({ id, ...data });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateSavedKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: importId, name, ...updateData } = validatedPayload.data;

  try {
    // Si se intenta actualizar el nombre, verificar unicidad
    if (name) {
      const existingImport = await firstOrUndefined(
        db.select().from(savedImportsTable).where(and(eq(savedImportsTable.name, name), ne(savedImportsTable.id, importId)))
      );
      if (existingImport) {
        return fail(`Ya existe una importación con el nombre "${name}".`);
      }
    }

    const [updatedImport] = await db
      .update(savedImportsTable)
      .set({
        ...updateData,
        name, // Incluir el nombre validado si existe
        updatedAt: new Date(),
      })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    if (!updatedImport) {
      return fail("Importación de KPI guardada no encontrada para actualizar.");
    }

    return ok("Importación de KPI guardada actualizada exitosamente.", updatedImport);
  } catch (error) {
    logger.error(`Error updating saved KPI import: ${error instanceof Error ? error.message : String(error)}`, { id, data });
    return fail("Fallo al actualizar la importación de KPI guardada.");
  }
}

/**
 * @function deleteSavedKpiImportAction
 * @description Elimina una importación de KPI guardada de la base de datos.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * @param {string} id - El ID de la importación guardada a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function deleteSavedKpiImportAction(id: string): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete saved KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = deleteSavedKpiImportSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteSavedKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [deletedImport] = await db
      .delete(savedImportsTable)
      .where(eq(savedImportsTable.id, validatedId.data.id))
      .returning();

    if (!deletedImport) {
      return fail("Importación de KPI guardada no encontrada para eliminar.");
    }

    return ok("Importación de KPI guardada eliminada exitosamente.");
  } catch (error) {
    logger.error(`Error deleting saved KPI import: ${error instanceof Error ? error.message : String(error)}`, { id });
    return fail("Fallo al eliminar la importación de KPI guardada.");
  }
}

/**
 * @function executeSavedKpiImportAction
 * @description Ejecuta una importación de KPI guardada (UC-201, UC-203).
 * Recupera la configuración de importación, la conexión, extrae (simula) datos,
 * aplica transformaciones, mapea a KPIs y actualiza la tabla kpi_values.
 * @param {z.infer<typeof executeSavedKpiImportSchema>} data - Objeto con el ID de la importación a ejecutar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o un mensaje de error.
 * @notes
 *  - La extracción real de datos de diversas fuentes de bases de datos o archivos Excel
 *    es una tarea compleja y para este paso se ha implementado un placeholder simulado.
 *  - Los valores se almacenan como texto en `kpi_values` para flexibilidad.
 *  - El cálculo de `score` y `color` es una implementación simplificada para KPIs 'Goal/Red Flag'.
 */
export async function executeSavedKpiImportAction(
  data: z.infer<typeof executeSavedKpiImportSchema>
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to execute saved KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = executeSavedKpiImportSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for executeSavedKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: importId } = validatedData.data;

  try {
    // 1. Obtener la configuración de importación guardada
    const savedImport = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, importId))
    );
    if (!savedImport) {
      return fail("Configuración de importación de KPI no encontrada.");
    }

    // 2. Obtener los detalles de la conexión
    const connection = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, savedImport.connectionId))
    );
    if (!connection) {
      return fail("Conexión de importación no encontrada.");
    }

    // Descifrar detalles de conexión sensibles
    const decryptedConnectionDetails = JSON.parse(decrypt(connection.connectionDetails as string));

    // 3. **Placeholder para la extracción de datos real**
    // Declarar contenedor de datos crudos (evita TS2304).
    let rawData: Record<string, unknown>[] = [];

    // En una implementación completa, aquí iría la lógica real de extracción
    // (usando decryptedConnectionDetails). Por ahora, simulamos según el tipo.
    if (connection.connectionType?.includes("Excel")) {
      rawData = [
        { Date: "2025-01-01", Sales: "150000", Target: "140000", Red: "120000", Yellow: "130000" },
        { Date: "2025-02-01", Sales: "160000", Target: "150000", Red: "125000", Yellow: "135000" },
      ];
    } else if (connection.connectionType?.includes("SQL")) {
      logger.warn("Actual database connection and data fetching logic is a placeholder.");
      rawData = [
        { DateColumn: "2025-01-01", ValueColumn: "150.5", GoalColumn: "140", ThresholdR: "120", ThresholdY: "130" },
        { DateColumn: "2025-02-01", ValueColumn: "160.2", GoalColumn: "150", ThresholdR: "125", ThresholdY: "135" },
      ];
    } else {
      logger.warn(`Unsupported connection type for data extraction: ${connection.connectionType}. Returning empty data.`);
      rawData = [];
    }

    if (rawData.length === 0) {
      logger.info(`No raw data extracted for import ${savedImport.name}.`);
      return ok("Importación ejecutada, pero no se extrajeron datos.");   
    }

    // 4. Aplicar transformaciones (UC-203)
    let transformedData = rawData;
    const transformations: TransformationRule[] = Array.isArray(savedImport.transformations)
      ? (savedImport.transformations as TransformationRule[])
      : [];
    if (transformations.length > 0) {
      transformedData = applyTransformations(rawData, transformations);
      logger.info(`Applied ${transformations.length} transformations.`);
    }    


    // 5. Mapear datos a KPIs y actualizar kpi_values
    const kpiMappings: KpiMapping[] = savedImport.kpiMappings as KpiMapping[];
    const kpiValuesToInsert: InsertKpiValue[] = [];

    for (const row of transformedData) {
      for (const mapping of kpiMappings) {
        // Obtener la configuración del KPI de destino
        const targetKpi = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, mapping.kpiId)));
        if (!targetKpi) {
          logger.warn(`KPI with ID ${mapping.kpiId} not found during import for row:`, row);
          continue;
        }

        let periodDateString: string | null = (row[mapping.periodDate.sourceField] ?? mapping.periodDate.defaultValue) as string | null;
        if (!periodDateString) {
          logger.warn(`Missing period date for KPI ${targetKpi.id} in row:`, row);
          continue;
        }
        // Asegurarse de que la fecha sea un formato ISO válido
        // Normalizar a 'YYYY-MM-DD' para cumplir con el tipo string requerido por Drizzle
        // y evitar TS2322 (string[] → string).        
        try {
          periodDateString = new Date(periodDateString).toISOString().split('T')[0];
        } catch (dateError) {
          logger.error(`Invalid date format for KPI ${targetKpi.id} period date '${periodDateString}' in row:`, row, dateError);
          continue;
        }

        const actualValue = (row[mapping.actualValue.sourceField] ?? mapping.actualValue.defaultValue) as string | null;
        const targetValue = (row[mapping.targetValue?.sourceField ?? ""] ?? mapping.targetValue?.defaultValue) as string | null;
        const thresholdRed = (row[mapping.thresholdRed?.sourceField ?? ""] ?? mapping.thresholdRed?.defaultValue) as string | null;
        const thresholdYellow = (row[mapping.thresholdYellow?.sourceField ?? ""] ?? mapping.thresholdYellow?.defaultValue) as string | null;
        const note = (row[mapping.note?.sourceField ?? ""] ?? mapping.note?.defaultValue) as string | null;

        let score: number | null = null;
        let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

        // Si el KPI es de tipo 'Goal/Red Flag', calculamos el score y el color
        if (targetKpi.scoringType === "Goal/Red Flag") {
          const parsedActual = actualValue !== null && !isNaN(parseFloat(actualValue)) ? parseFloat(actualValue) : null;
          const parsedTarget = targetValue !== null && !isNaN(parseFloat(targetValue)) ? parseFloat(targetValue) : null;
          const parsedRed = thresholdRed !== null && !isNaN(parseFloat(thresholdRed)) ? parseFloat(thresholdRed) : null;
          const parsedYellow = thresholdYellow !== null && !isNaN(parseFloat(thresholdYellow)) ? parseFloat(thresholdYellow) : null;

          if (parsedActual !== null) {
            const calculated = calculateKpiScoreAndColor(parsedActual, parsedTarget, parsedRed, parsedYellow);
            score = calculated.score;
            color = calculated.color;
          }
        } else if (targetKpi.scoringType === "Yes/No") {
            // Asumimos 1 para Sí, 0 para No. Solo si el dataType es Number.
            const parsedActual = actualValue !== null && !isNaN(parseFloat(actualValue)) ? parseFloat(actualValue) : null;
            if (targetKpi.dataType === "Number" && parsedActual !== null) {
                if (parsedActual === 1) {
                    color = "Green";
                    score = 100;
                } else if (parsedActual === 0) {
                    color = "Red";
                    score = 0;
                } else {
                    color = null;
                    score = null;
                }
            }
        } // Para 'Text', no hay score/color automático por definición

        kpiValuesToInsert.push({
          kpiId: targetKpi.id,
          periodDate: periodDateString,
          actualValue: actualValue,
          targetValue: targetValue,
          thresholdRed: thresholdRed,
          thresholdYellow: thresholdYellow,
          score: score !== null ? score.toString() : null, // Drizzle `numeric` type expects string
          color: color,
          updatedByUserId: userId,
          isManualEntry: false, // Las importaciones no son entradas manuales
          note: note,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Realizar upsert de los valores de KPI en una transacción
    if (kpiValuesToInsert.length > 0) {
      await db.transaction(async (tx) => {
        for (const kpiValue of kpiValuesToInsert) {
          await tx
            .insert(kpiValuesTable)
            .values(kpiValue)
            .onConflictDoUpdate({
              target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate], // El índice único para el conflicto
              set: {
                actualValue: kpiValue.actualValue,
                targetValue: kpiValue.targetValue,
                thresholdRed: kpiValue.thresholdRed,
                thresholdYellow: kpiValue.thresholdYellow,
                score: kpiValue.score,
                color: kpiValue.color,
                updatedByUserId: kpiValue.updatedByUserId,
                isManualEntry: false, // Las importaciones sobrescriben como no manuales
                note: kpiValue.note,
                updatedAt: new Date(),
              },
            });
        }
      });
      logger.info(`Updated ${kpiValuesToInsert.length} KPI values.`);
    }

    // 6. Actualizar la marca de tiempo de la última ejecución
    await db
      .update(savedImportsTable)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(savedImportsTable.id, importId));

    return ok("Importación de KPI ejecutada exitosamente.");
  } catch (error) {
    logger.error(`Error executing saved KPI import: ${error instanceof Error ? error.message : String(error)}`, { importId });
    return fail(`Fallo al ejecutar la importación de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}