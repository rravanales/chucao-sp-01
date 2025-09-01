/**
 * @file actions/db/import-actions.ts
 * @brief Implementa Server Actions para la gestión de importaciones estándar y programadas de valores de KPI en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar, eliminar, ejecutar y programar/desprogramar configuraciones de importación de KPI guardadas.
 * Maneja la lógica de obtención de datos (con un placeholder para la extracción real),
 * aplicación de transformaciones, y actualización de los valores de KPI en la base de datos.
 * Asegura la validación de datos, el cifrado de credenciales sensibles y la protección de accesos.
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
import { ScheduleConfig, ScheduleConfigSchema } from "@/types/schedule-types"; // NEW: Import ScheduleConfig and Schema
import { auth } from "@clerk/nextjs/server";
import { and, eq, sql, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { encrypt, decrypt } from "@/lib/encryption";
import { applyTransformations } from "@/lib/data-transformer";
import { calculateKpiScoreAndColor } from "@/lib/kpi-scoring";

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
//type KpiDataType = (typeof kpiDataTypeEnum.enumValues)[number];
type KpiDataType = (typeof kpiDataTypeEnum.enumValues)[number];
const numericDataTypes = new Set<KpiDataType>(["Number", "Percentage", "Currency"]);

/**
 * Tipo auxiliar para mappings de campos de KPI.
 */
type KpiMappingField = { sourceField: string; defaultValue?: string | null; };

// (La función calculateKpiScoreAndColor se movió a "@/lib/kpi-scoring")

/* --------------------------------------------------------------------------  */
/*                             Esquemas de Validación Zod                         */
/* -------------------------------------------------------------------------- */

/**
 * @schema createSavedKpiImportSchema
 * @description Esquema de validación para la creación de una nueva importación de KPI guardada.
 * @property {string} name - Nombre único de la importación, requerido y máximo 255 caracteres.
 * @property {string} connectionId - ID de la conexión de importación, UUID requerido.
 * @property {KpiMapping[]} kpiMappings - Array de objetos de mapeo de KPI, requerido.
 * @property {TransformationRule[] | null} transformations - Array de reglas de transformación, opcional y nullable.
 * @property {ScheduleConfig | null} scheduleConfig - Configuración de programación, opcional y nullable.
 */
const createSavedKpiImportSchema = z.object({
  name: z.string().min(1, "El nombre de la importación es requerido.").max(255, "El nombre no puede exceder los 255 caracteres."),
  connectionId: z.string().uuid("ID de conexión inválido."),
  kpiMappings: z.array(KpiMappingSchema).min(1, "Debe haber al menos un mapeo de KPI."),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: ScheduleConfigSchema.nullable().optional(), // Updated to use ScheduleConfigSchema
});

/**
 * @schema updateSavedKpiImportSchema
 * @description Esquema de validación para la actualización de una importación de KPI guardada existente.
 * Permite campos opcionales para actualizaciones parciales.
 * @property {string} id - ID de la importación guardada a actualizar, UUID requerido.
 * @property {string} [name] - Nombre único de la importación, opcional y máximo 255 caracteres.
 * @property {string} [connectionId] - ID de la conexión de importación, UUID opcional.
 * @property {KpiMapping[]} [kpiMappings] - Array de objetos de mapeo de KPI, opcional.
 * @property {TransformationRule[] | null} [transformations] - Array de reglas de transformación, opcional y nullable.
 * @property {ScheduleConfig | null} [scheduleConfig] - Configuración de programación, opcional y nullable.
 */
const updateSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
  name: z.string().min(1, "El nombre de la importación es requerido.").max(255, "El nombre no puede exceder los 255 caracteres.").optional(),
  connectionId: z.string().uuid("ID de conexión inválido.").optional(),
  kpiMappings: z.array(KpiMappingSchema).min(1, "Debe haber al menos un mapeo de KPI.").optional(),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: ScheduleConfigSchema.nullable().optional(), // Updated to use ScheduleConfigSchema
});

/**
 * @schema getSavedImportByIdSchema
 * @description Esquema de validación para obtener una importación de KPI guardada por su ID.
 * @property {string} id - ID de la importación guardada, UUID requerido.
 */
const getSavedImportByIdSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema deleteSavedKpiImportSchema
 * @description Esquema de validación para eliminar una importación de KPI guardada por su ID.
 * @property {string} id - ID de la importación guardada, UUID requerido.
 */
const deleteSavedKpiImportSchema = z.object({
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

/**
 * @schema scheduleKpiImportSchema
 * @description Esquema de validación para programar una importación de KPI guardada (UC-204).
 * @property {string} id - ID de la importación guardada a programar, UUID requerido.
 * @property {ScheduleConfig} scheduleConfig - Configuración de la programación.
 */
const scheduleKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
  scheduleConfig: ScheduleConfigSchema,
});

/**
 * @schema unscheduleKpiImportSchema
 * @description Esquema de validación para desprogramar una importación de KPI guardada (UC-204).
 * @property {string} id - ID de la importación guardada a desprogramar, UUID requerido.
 */
const unscheduleKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/* --------------------------------------------------------------------------  */
/*                                Server Actions                                */
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
        scheduleConfig: validatedData.data.scheduleConfig ? validatedData.data.scheduleConfig as any : null, // Ensure JSONB is handled
      })
      .returning();

    logger.info("Saved KPI import created successfully.", { importId: newImport.id, name: newImport.name });
    return ok("Importación de KPI guardada creada exitosamente.", newImport);
  } catch (error) {
    logger.error(
      `Error creating saved KPI import: ${error instanceof Error ? error.message : String(error)}`,
      { data }
    );
    return fail("Fallo al crear la importación de KPI guardada.");
  }
}

/**
 * @function getSavedKpiImportsAction
 * @description Obtiene una lista de todas las configuraciones de importación de KPI guardadas.
 * @returns {Promise<ActionState<SelectSavedImport[]>>} Un objeto ActionState con la lista de importaciones guardadas o un mensaje de error.
 */
export async function getSavedKpiImportsAction(): Promise<ActionState<SelectSavedImport[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve saved KPI imports.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const imports = await db.select().from(savedImportsTable);
    logger.info(`Retrieved ${imports.length} saved KPI imports.`);
    return ok("Importaciones de KPI guardadas obtenidas exitosamente.", imports);
  } catch (error) {
    logger.error(
      `Error retrieving saved KPI imports: ${error instanceof Error ? error.message : String(error)}`
    );
    return fail("Fallo al obtener las importaciones de KPI guardadas.");
  }
}

/**
 * @function getSavedImportByIdAction
 * @description Obtiene una configuración de importación de KPI guardada por su ID.
 * @param {string} id - El ID de la importación guardada a recuperar.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación guardada o un mensaje de error.
 */
export async function getSavedImportByIdAction(id: string): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve saved KPI import by ID.");
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
    logger.error(
      `Error retrieving saved KPI import by ID: ${error instanceof Error ? error.message : String(error)}`
    );
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
        db
          .select()
          .from(savedImportsTable)
          .where(and(eq(savedImportsTable.name, name), ne(savedImportsTable.id, importId)))
      );
      if (existingImport) {
        return fail(`Ya existe una importación con el nombre "${name}".`);
      }
    }

    const [updatedImport] = await db
      .update(savedImportsTable)
      .set({
        ...updateData,
        updatedAt: new Date(),
        scheduleConfig: updateData.scheduleConfig ? updateData.scheduleConfig as any : null, // Ensure JSONB is handled
      })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    if (!updatedImport) {
      return fail("Importación de KPI guardada no encontrada.");
    }

    logger.info("Saved KPI import updated successfully.", { importId: updatedImport.id, name: updatedImport.name });
    return ok("Importación de KPI guardada actualizada exitosamente.", updatedImport);
  } catch (error) {
    logger.error(
      `Error updating saved KPI import: ${error instanceof Error ? error.message : String(error)}`,
      { id, data }
    );
    return fail("Fallo al actualizar la importación de KPI guardada.");
  }
}

/**
 * @function deleteSavedKpiImportAction
 * @description Elimina una configuración de importación de KPI guardada de la base de datos.
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
      return fail("Importación de KPI guardada no encontrada.");
    }

    logger.info("Saved KPI import deleted successfully.", { importId: deletedImport.id });
    return ok("Importación de KPI guardada eliminada exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting saved KPI import: ${error instanceof Error ? error.message : String(error)}`,
      { id }
    );
    return fail("Fallo al eliminar la importación de KPI guardada.");
  }
}

/**
 * @function executeSavedKpiImportAction
 * @description Ejecuta una importación de KPI guardada (UC-201, UC-203).
 * Recupera la configuración de importación, la conexión, extrae (simula) datos,
 * aplica transformaciones, mapea a KPIs y actualiza la tabla kpi_values.
 * @param {z.infer<typeof executeSavedKpiImportSchema>} data - Objeto con el ID de la importación a ejecutar.
 * @param {string | null} [executorUserId = null] - El ID del usuario que ejecuta la acción.
 *   Esto permite que la acción sea invocada por un usuario autenticado o por un sistema (ej. cron job)
 *   que pasa el ID del creador de la importación.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o un mensaje de error.
 * @notes
 *   - La extracción real de datos de diversas fuentes de bases de datos o archivos Excel
 *     es una tarea compleja y para este paso se ha implementado un placeholder simulado.
 *   - Los valores se almacenan como texto en kpi_values para flexibilidad.
 *   - El cálculo de score y color es una implementación simplificada para KPIs 'Goal/Red Flag'.
 *   - Si `executorUserId` es `null`, intentará usar el `userId` de `auth()`. Si ambos son `null`, fallará.
 */
export async function executeSavedKpiImportAction(
  data: z.infer<typeof executeSavedKpiImportSchema>,
  executorUserId: string | null = null,
): Promise<ActionState<undefined>> {
  const { userId: authUserId } = await auth();
  // Determina el ID del usuario que será registrado como quien realizó la actualización.
  // Prioriza el executorUserId explícitamente pasado (ej. por cron), luego el usuario autenticado.
  const actualUpdaterUserId = executorUserId || authUserId;

  if (!actualUpdaterUserId) {
    logger.warn("Unauthorized attempt to execute saved KPI import: No executor user ID provided.");
    return fail("No autorizado. Debe iniciar sesión o proporcionar un ID de usuario ejecutor.");
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

    // 2. Obtener la conexión de importación y extraer (simular) datos
    let rawData: Record<string, unknown>[] = [];
    const connection = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, savedImport.connectionId))
    );
    if (!connection) {
      logger.error(`Import connection not found for saved import ID: ${importId}.`);
      return fail("Conexión de importación no encontrada.");
    }
    const decryptedDetails = decrypt(connection.connectionDetails as string);
    const connectionDetails = JSON.parse(decryptedDetails);

    // Placeholder for data extraction based on connectionType
    // This section simulates data extraction from different sources.
    if (connection.connectionType === "Excel") {
      // Simulate data from Excel
      // In a real scenario, you'd use a library to parse the Excel file
      rawData = [
        { "KPI_ID": "a1b2c3d4-e5f6-7890-1234-567890abcdef", "PERIOD_DATE": "2024-01-01T00:00:00Z", "ACTUAL": "100", "TARGET": "120", "NOTE": "Q1 Performance" },
        { "KPI_ID": "f1e2d3c4-b5a6-9876-5432-10fedcba9876", "PERIOD_DATE": "2024-01-01T00:00:00Z", "ACTUAL": "50", "THRESHOLD_RED": "40" },
      ];
      logger.info(`Simulating Excel data extraction for connection ${connection.name}.`);
    } else if (["Microsoft SQL Server", "Oracle", "MySQL", "PostgreSQL", "Hive"].includes(connection.connectionType)) {
      // Simulate data from a database
      // In a real scenario, you'd use a DB client (e.g., 'pg' for PostgreSQL) with connectionDetails
      rawData = [
        { "kpi_id_col": "a1b2c3d4-e5f6-7890-1234-567890abcdef", "date_col": "2024-02-01T00:00:00Z", "value_col": "110", "goal_col": "130" },
        { "kpi_id_col": "f1e2d3c4-b5a6-9876-5432-10fedcba9876", "date_col": "2024-02-01T00:00:00Z", "value_col": "45", "red_threshold_col": "40" },
      ];
      logger.info(`Simulating DB data extraction for connection ${connection.name}.`);
    } else {
      logger.warn(`Connection type ${connection.connectionType} not supported for data extraction in this placeholder implementation.`);
      return fail(`Tipo de conexión ${connection.connectionType} no soportado para la extracción de datos.`);
    }

    if (rawData.length === 0) {
      logger.info(`Import executed, but no data extracted for import ID: ${importId}.`);
      // Update lastRunAt even if no data was extracted, to prevent immediate re-execution by cron
      await db.update(savedImportsTable).set({ lastRunAt: new Date(), updatedAt: new Date() }).where(eq(savedImportsTable.id, importId));
      return ok("Importación ejecutada, pero no se extrajeron datos.");
    }

    // // 3. Aplicar transformaciones (UC-203)
    // const transformations: TransformationRule[] = Array.isArray(savedImport.transformations) ? savedImport.transformations : [];
    // let transformedData = applyTransformations(rawData, transformations);

    // 3. Parseo seguro de kpiMappings y transformations desde JSONB (evita 'unknown')
    const parsedMappingsResult = z.array(KpiMappingSchema).safeParse(savedImport.kpiMappings ?? []);
    if (!parsedMappingsResult.success) {
      logger.error(`Invalid kpiMappings JSON shape for import ${importId}: ${parsedMappingsResult.error.message}`);
      return fail("La configuración de mapeo (kpiMappings) es inválida.");
    }
    const kpiMappings: KpiMapping[] = parsedMappingsResult.data;

    const parsedTransfResult = z
      .array(TransformationRuleSchema)
      .safeParse(savedImport.transformations ?? []);
    // Normaliza para que 'parameters' siempre exista (TransformationRule lo requiere)
    const transformations: TransformationRule[] = parsedTransfResult.success
      ? parsedTransfResult.data.map((r) => ({
          ...r,
          parameters: r.parameters ?? {},
        })) as TransformationRule[]
      : [];

    // 4. Aplicar transformaciones (UC-203)
    let transformedData = applyTransformations(rawData, transformations);
    logger.info(`Applied ${transformations.length} transformations.`);

    // 5. Mapear datos a KPIs y actualizar kpi_values
    const kpiValuesToInsert: InsertKpiValue[] = [];
    const kpiIdsToFetch = Array.from(new Set(kpiMappings.map((m: KpiMapping) => m.kpiId)));

    // Uso de inArray para evitar SQL manual
    const kpis = await db
      .select()
      .from(kpisTable)
      .where(inArray(kpisTable.id, kpiIdsToFetch));    
    const kpiMap = new Map<string, SelectKpi>(kpis.map(k => [k.id, k]));

    for (const row of transformedData) {
      for (const mapping of kpiMappings) {    
        const kpi = kpiMap.get(mapping.kpiId);
        if (!kpi) {
          logger.warn(`KPI with ID ${mapping.kpiId} not found during import mapping.`);
          continue;
        }

        // Extract values using sourceField or defaultValue
        const getMappedValue = (fieldMap: KpiMappingField) => {
          const value = row[fieldMap.sourceField];
          return (value !== undefined && value !== null && String(value).trim() !== '')
            ? String(value)
            : (fieldMap.defaultValue !== undefined && fieldMap.defaultValue !== null ? String(fieldMap.defaultValue) : null);
        };

        const periodDateString = getMappedValue(mapping.periodDate);
        if (!periodDateString) {
          logger.warn(`Missing periodDate for KPI ${kpi.id} in row: ${JSON.stringify(row)}`);
          continue;
        }

        // Manejar ISO strings: tomar solo YYYY-MM-DD
        const parsedPeriodDate = periodDateString.includes("T")
          ? periodDateString.split("T")[0]
          : periodDateString;        

        const actualValue = getMappedValue(mapping.actualValue);
        const targetValue = mapping.targetValue ? getMappedValue(mapping.targetValue) : null;
        const thresholdRed = mapping.thresholdRed ? getMappedValue(mapping.thresholdRed) : null;
        const thresholdYellow = mapping.thresholdYellow ? getMappedValue(mapping.thresholdYellow) : null;
        const note = mapping.note ? getMappedValue(mapping.note) : null;

        let score: number | null = null;
        let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

        // Convert actual and threshold values to numbers if KPI data type is numeric
        // Use a helper `isNonEmptyString` to safely parse floats (D-2025-0030)
        const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

        const parsedActualValue = isNonEmptyString(actualValue) ? parseFloat(actualValue) : null;
        const parsedTargetValue = isNonEmptyString(targetValue) ? parseFloat(targetValue) : null;
        const parsedThresholdRed = isNonEmptyString(thresholdRed) ? parseFloat(thresholdRed) : null;
        const parsedThresholdYellow = isNonEmptyString(thresholdYellow) ? parseFloat(thresholdYellow) : null;

        if (kpi.scoringType === "Goal/Red Flag" && parsedActualValue !== null) {
          const calculated = calculateKpiScoreAndColor(
            parsedActualValue,
            parsedTargetValue,
            parsedThresholdRed,
            parsedThresholdYellow
          );
          score = calculated.score;
          color = calculated.color;
        } else if (kpi.scoringType === "Yes/No" && parsedActualValue !== null) {
          // Assuming 1 for Yes, 0 for No
          score = parsedActualValue === 1 ? 100 : 0;
          color = parsedActualValue === 1 ? "Green" : "Red";
        }
        // No score/color for 'Text' KPIs

        kpiValuesToInsert.push({
          kpiId: kpi.id,
          periodDate: parsedPeriodDate, // YYYY-MM-DD como string
          actualValue: actualValue,
          targetValue: targetValue,
          thresholdRed: thresholdRed,
          thresholdYellow: thresholdYellow,
          score: score !== null ? String(score) : null, // Store numeric score as string for Drizzle decimal type
          color: color,
          updatedByUserId: actualUpdaterUserId, // Use the determined updater ID
          isManualEntry: false, // This is an import, not manual entry
          note: note,
        });
      }
    }

    if (kpiValuesToInsert.length > 0) {
      // Upsert: Try to insert, if conflict (kpiId, periodDate), update
      await db.transaction(async (tx) => {
        for (const kpiValue of kpiValuesToInsert) {
          await tx.insert(kpiValuesTable)
            .values(kpiValue)
            .onConflictDoUpdate({
              target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
              set: {
                actualValue: kpiValue.actualValue,
                targetValue: kpiValue.targetValue,
                thresholdRed: kpiValue.thresholdRed,
                thresholdYellow: kpiValue.thresholdYellow,
                score: kpiValue.score,
                color: kpiValue.color,
                updatedByUserId: kpiValue.updatedByUserId,
                isManualEntry: kpiValue.isManualEntry,
                note: kpiValue.note,
                updatedAt: new Date(),
              },
            });
        }
      });
      logger.info(`Successfully processed ${kpiValuesToInsert.length} KPI values.`);
    } else {
      logger.info(`No valid KPI values to insert after mapping for import ID: ${importId}.`);
    }

    // 6. Actualizar lastRunAt de la importación guardada
    await db.update(savedImportsTable)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(savedImportsTable.id, importId));

    logger.info(`KPI import ${savedImport.name} (ID: ${savedImport.id}) executed successfully.`);
    return ok("Importación de KPI ejecutada exitosamente.");
  } catch (error) {
    logger.error(`Error executing saved KPI import: ${error instanceof Error ? error.message : String(error)}`, { importId });
    return fail(`Fallo al ejecutar la importación de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function scheduleKpiImportAction
 * @description Programa una importación de KPI guardada para que se ejecute de forma recurrente (UC-204).
 * Almacena la configuración de programación en la base de datos.
 * @param {z.infer<typeof scheduleKpiImportSchema>} data - Objeto con el ID de la importación y la configuración de programación.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación actualizada o un mensaje de error.
 */
export async function scheduleKpiImportAction(
  data: z.infer<typeof scheduleKpiImportSchema>
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to schedule KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = scheduleKpiImportSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for scheduleKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: importId, scheduleConfig } = validatedData.data;

  try {
    const existingImport = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, importId))
    );
    if (!existingImport) {
      return fail("Importación de KPI guardada no encontrada.");
    }

    const [updatedImport] = await db
      .update(savedImportsTable)
      .set({
        scheduleConfig: scheduleConfig as any, // Drizzle's jsonb type is any, cast for type safety
        updatedAt: new Date(),
      })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    if (!updatedImport) {
        return fail("Fallo al encontrar la importación para actualizar.");
    }

    logger.info(`KPI import ${updatedImport.name} (ID: ${updatedImport.id}) scheduled successfully.`);
    return ok("Importación de KPI programada exitosamente.", updatedImport);
  } catch (error) {
    logger.error(`Error scheduling KPI import: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail(`Fallo al programar la importación de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function unscheduleKpiImportAction
 * @description Desprograma una importación de KPI guardada, eliminando su configuración de programación.
 * @param {z.infer<typeof unscheduleKpiImportSchema>} data - Objeto con el ID de la importación a desprogramar.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación actualizada o un mensaje de error.
 */
export async function unscheduleKpiImportAction(
  data: z.infer<typeof unscheduleKpiImportSchema>
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to unschedule KPI import.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = unscheduleKpiImportSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for unscheduleKpiImportAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id: importId } = validatedData.data;

  try {
    const existingImport = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, importId))
    );
    if (!existingImport) {
      return fail("Importación de KPI guardada no encontrada.");
    }

    const [updatedImport] = await db
      .update(savedImportsTable)
      .set({
        scheduleConfig: null, // Set scheduleConfig to null to unschedule
        updatedAt: new Date(),
      })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    if (!updatedImport) {
        return fail("Fallo al encontrar la importación para actualizar.");
    }

    logger.info(`KPI import ${updatedImport.name} (ID: ${updatedImport.id}) unscheduled successfully.`);
    return ok("Importación de KPI desprogramada exitosamente.", updatedImport);
  } catch (error) {
    logger.error(`Error unscheduling KPI import: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail(`Fallo al desprogramar la importación de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}