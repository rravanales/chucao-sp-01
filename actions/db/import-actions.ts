/**
 * @file actions/db/import-actions2.ts
 * @brief Implementa Server Actions para la gestión de importaciones estándar de valores de KPI en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar, eliminar y ejecutar configuraciones de importación de KPI guardadas.
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
 * Tipo auxiliar para mappings de campos de KPI.
 */
type KpiMappingField = {
  sourceField: string;
  defaultValue?: string | null;
};

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
/*                            Esquemas de Validación Zod                        */
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
 * Permite campos opcionales para actualizaciones parciales.
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

/* -------------------------------------------------------------------------- */
/*                               Server Actions                               */
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
    const savedImports = await db.select().from(savedImportsTable);
    return ok("Importaciones de KPI guardadas obtenidas exitosamente.", savedImports);
  } catch (error) {
    logger.error(
      `Error retrieving saved KPI imports: ${error instanceof Error ? error.message : String(error)}`
    );
    return fail("Fallo al obtener las importaciones de KPI guardadas.");
  }
}

/**
 * @function getSavedKpiImportByIdAction
 * @description Obtiene una configuración de importación de KPI guardada específica por su ID.
 * @param {string} id - El ID de la importación guardada a recuperar.
 * @returns {Promise<ActionState<SelectSavedImport>>} Un objeto ActionState con la importación guardada o un mensaje de error.
 */
export async function getSavedKpiImportByIdAction(
  id: string
): Promise<ActionState<SelectSavedImport>> {
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
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    if (!updatedImport) {
      return fail("Importación de KPI guardada no encontrada.");
    }

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
      return fail("Importación de KPI guardada no encontrada para eliminar.");
    }

    return ok("Importación de KPI guardada eliminada exitosamente.", undefined);
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
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o un mensaje de error.
 * @notes
 *  La extracción real de datos de diversas fuentes de bases de datos o archivos Excel
 *  es una tarea compleja y para este paso se ha implementado un placeholder simulado.
 *  Los valores se almacenan como texto en kpi_values para flexibilidad.
 *  El cálculo de score y color es una implementación simplificada para KPIs 'Goal/Red Flag'.
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

    // 2. Obtener la conexión de importación
    const connection = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, savedImport.connectionId))
    );
    if (!connection) {
      logger.error(`Import connection with ID ${savedImport.connectionId} not found.`);
      return fail("Conexión de importación no encontrada.");
    }

    // 3. Descifrar detalles de conexión (asumiendo que connectionDetails es un JSON string cifrado)
    let decryptedConnectionDetails: any;
    try {
      const decryptedString = decrypt(String(connection.connectionDetails));

      decryptedConnectionDetails = JSON.parse(decryptedString);
    } catch (error) {
      logger.error(
        `Failed to decrypt or parse connection details for connection ${connection.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return fail("Fallo al descifrar o parsear los detalles de la conexión.");
    }

    // 4. Simular extracción de datos (placeholder avanzado)
    // En una implementación real, aquí se usarían librerías y drivers para conectar
    // y extraer datos de la fuente real (ej. exceljs, pg, tedious, etc.).
    let rawData: Record<string, unknown>[] = [];
    logger.info(`Simulating data extraction from connection type: ${connection.connectionType}`);

    if (connection.connectionType === "Excel") {
      // Simular datos de un archivo Excel simple
      rawData = [
        { Date: "2024-01-01", "Sales KPI": 150000, "Marketing Spend": 25000, "Target Sales": 145000, "Red Threshold": 120000, "Yellow Threshold": 135000, Note: "Increased ad spend" },
        { Date: "2024-02-01", "Sales KPI": 160000, "Marketing Spend": 27000, "Target Sales": 150000, "Red Threshold": 125000, "Yellow Threshold": 140000, Note: "New product launch" },
        { Date: "2024-03-01", "Sales KPI": 140000, "Marketing Spend": 24000, "Target Sales": 155000, "Red Threshold": 130000, "Yellow Threshold": 145000, Note: "Market downturn" },
      ];
    } else if (["Microsoft SQL Server", "Oracle", "MySQL", "PostgreSQL", "Hive"].includes(connection.connectionType)) {
      // Simular datos de una base de datos con una consulta SQL (el query_string estaría en decryptedConnectionDetails)
      // Para la simulación, generamos datos genéricos.
      const tableName = decryptedConnectionDetails.tableName || "default_table";
      logger.info(`Simulating query against table: ${tableName}`);
      rawData = [
        { Period: "2024-01-15", Value: 120.5, Goal: 125, Status: "Good", Details: "Q1 performance" },
        { Period: "2024-02-15", Value: 110.2, Goal: 120, Status: "Needs Attention", Details: "Sales dip" },
        { Period: "2024-03-15", Value: 130.8, Goal: 130, Status: "Excellent", Details: "Exceeded targets" },
      ];
    } else {
      logger.warn(`Unsupported connection type for data extraction: ${connection.connectionType}`);
      return ok("Importación ejecutada, pero no se extrajeron datos debido a un tipo de conexión no soportado en la simulación.", undefined);
    }

    if (rawData.length === 0) {
      return ok("Importación ejecutada, pero no se extrajeron datos de la fuente simulada.", undefined);
    }

    // 5. Aplicar transformaciones (UC-203)
    // Parseo con Zod y normalización: asegurar que 'parameters' siempre exista
    // para cumplir con el tipo TransformationRule (evita TS2345).
    const rawTransformations = z
      .array(TransformationRuleSchema)
      .parse(savedImport.transformations ?? []);

    const transformations: TransformationRule[] = rawTransformations.map((t) => ({
      ...t,
      // si viene indefinido, garantizamos un objeto vacío
      parameters: t.parameters ?? {},
    }));

    let transformedData = applyTransformations(rawData, transformations);

    logger.info(`Applied ${transformations.length} transformations, resulting in ${transformedData.length} rows.`, {
      transformedDataLength: transformedData.length,
    });

    // 6. Mapear y cargar datos en kpi_values
    const kpiMappings = z.array(KpiMappingSchema).parse(savedImport.kpiMappings ?? []);

    const kpiValuesToInsert: InsertKpiValue[] = [];
    for (const mapping of kpiMappings) {    
      // Obtener el KPI de destino para validar tipos y configuraciones de puntuación
      const targetKpi = await firstOrUndefined(db.select().from(kpisTable).where(eq(kpisTable.id, mapping.kpiId)));
      if (!targetKpi) {
        logger.warn(`Target KPI with ID ${mapping.kpiId} not found. Skipping mapping.`);
        continue;
      }

      for (const row of transformedData) {
        let actualValue: string | null = null;
        let targetValue: string | null = null;
        let thresholdRed: string | null = null;
        let thresholdYellow: string | null = null;
        let note: string | null = null;
        let periodDate: Date | null = null;

        // // Helper para extraer valor de la fila o defaultValue
        const getValue = (fieldMapping?: KpiMappingField | null, rowData: Record<string, unknown> = row): string | null => {
          if (!fieldMapping) return null;
          const value = rowData[fieldMapping.sourceField];
          if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
            return fieldMapping.defaultValue || null;
          }
          return String(value);
        };

        const periodDateString = getValue(mapping.periodDate);
        if (periodDateString) {
          // Tomar solo la parte de fecha si viene en ISO con hora.
          const isoDate =
            periodDateString.includes("T")
              ? periodDateString.split("T")[0]
              : periodDateString;

          periodDate = new Date(isoDate);        
          if (isNaN(periodDate.getTime())) {
            logger.warn(`Invalid date format for KPI ${targetKpi.id} periodDate: ${periodDateString}. Skipping row.`);
            continue;
          }
        } else {
          logger.warn(`Period date not found for KPI ${targetKpi.id}. Skipping row.`);
          continue;
        }

        actualValue = getValue(mapping.actualValue);
        targetValue = getValue(mapping.targetValue);
        thresholdRed = getValue(mapping.thresholdRed);
        thresholdYellow = getValue(mapping.thresholdYellow);
        note = getValue(mapping.note);

        // Validar y convertir tipos de datos si el KPI es numérico
        let parsedActual: number | null = null;
        let parsedTarget: number | null = null;
        let parsedThresholdRed: number | null = null;
        let parsedThresholdYellow: number | null = null;

        const parseNumericValue = (val: string | null, kpiId: string, fieldName: string): number | null => {
          if (val === null) return null;
          const num = parseFloat(val);
          if (isNaN(num)) {
            logger.warn(
              `Non-numeric value "${val}" found for numeric KPI ${kpiId} field "${fieldName}". Treating as null.`
            );
            return null;
          }
          return num;
        };

        const isNumericKpi = numericDataTypes.has(targetKpi.dataType); // Reutilizar el Set de numericDataTypes

        if (isNumericKpi) {
          parsedActual = parseNumericValue(actualValue, targetKpi.id, "actualValue");
          parsedTarget = parseNumericValue(targetValue, targetKpi.id, "targetValue");
          parsedThresholdRed = parseNumericValue(thresholdRed, targetKpi.id, "thresholdRed");
          parsedThresholdYellow = parseNumericValue(thresholdYellow, targetKpi.id, "thresholdYellow");
        }

        let score: number | null = null;
        let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

        // Calcular score y color para KPIs de tipo 'Goal/Red Flag'
        if (targetKpi.scoringType === "Goal/Red Flag" && isNumericKpi) {
          ({ score, color } = calculateKpiScoreAndColor(
            parsedActual,
            parsedTarget,
            parsedThresholdRed,
            parsedThresholdYellow
          ));
        } else if (targetKpi.scoringType === "Yes/No") {
          // Para Yes/No, el actualValue 1 = Green, 0 = Red
          const numericActual = parseNumericValue(actualValue, targetKpi.id, "actualValue");
          if (numericActual === 1) {
            color = "Green";
            score = 100;
          } else if (numericActual === 0) {
            color = "Red";
            score = 0;
          } else {
            color = null;
            score = null;
          }
        }
        // Para Text scoringType, score y color serán null

        kpiValuesToInsert.push({
          kpiId: targetKpi.id,
          periodDate: periodDate.toISOString().split("T")[0], // Convertir a ISO string y tomar solo la fecha
          actualValue: actualValue,
          targetValue: targetValue,
          thresholdRed: thresholdRed,
          thresholdYellow: thresholdYellow,
          score: score !== null ? String(score) : null, // Almacenar score como string si es numérico
          color: color,
          updatedByUserId: userId,
          isManualEntry: false, // Las importaciones no son entradas manuales
          note: note,
        });
      }
    }

    // 7. Realizar upsert de los valores de KPI
    if (kpiValuesToInsert.length > 0) {
      // Drizzle no tiene un upsert directo para múltiples filas en una sola llamada para postgres.
      // Se puede simular con un bucle o una sentencia ON CONFLICT (que se puede construir).
      // Para la simplicidad y el cumplimiento del formato, realizaremos inserciones individuales con ON CONFLICT.
      // Esto podría ser optimizado con COPY FROM en un entorno de producción o una función SQL.
      await db.transaction(async (tx) => {
        for (const kpiValue of kpiValuesToInsert) {
          await tx
            .insert(kpiValuesTable)
            .values(kpiValue)
            .onConflictDoUpdate({
              target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate], // Clave única para el conflicto
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
      logger.info(`Successfully processed ${kpiValuesToInsert.length} KPI value entries.`);
    } else {
      logger.info("No KPI values to insert after mapping and transformation.");
    }

    // 8. Actualizar last_run_at en saved_imports
    await db
      .update(savedImportsTable)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(savedImportsTable.id, importId));

    return ok("Importación de KPI ejecutada exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error executing saved KPI import: ${error instanceof Error ? error.message : String(error)}`,
      { importId }
    );
    return fail(`Fallo al ejecutar la importación de KPI: ${error instanceof Error ? error.message : String(error)}`);
  }
}