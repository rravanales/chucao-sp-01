// actions/db/import-actions2.ts
// ÚNICO ARCHIVO CORREGIDO + DOCUMENTADO (estilo versión 1). Copiar/pegar tal cual.

"use server";

/**
 * @file actions/db/import-actions2.ts
 * @brief Implementa Server Actions para la gestión de importaciones estándar y programadas de valores de KPI en DeltaOne.
 * @description
 * Este módulo expone funciones del lado servidor para:
 *   - Crear, leer, actualizar y eliminar configuraciones de importación guardadas (UC-201).
 *   - Ejecutar importaciones (UC-201, UC-203), aplicando transformaciones y mapeando valores hacia KPIs.
 *   - Programar y desprogramar importaciones recurrentes (UC-204), almacenando la configuración de schedule en la DB.
 *
 * Características clave:
 *   - Validación con Zod de todas las entradas (payloads, IDs, JSONB).
 *   - Parseo seguro de campos JSONB (`kpiMappings`, `transformations`) con schemas dedicados.
 *   - Cálculo de `score` y `color` para KPIs de tipo "Goal/Red Flag" y "Yes/No".
 *   - Upsert idempotente en `kpi_values` (conflicto por [kpiId, periodDate]).
 *   - Registro de `lastRunAt` y `updatedAt` para control de re-ejecuciones.
 *   - Aliases de compatibilidad con nombres de acciones de la versión 1.
 *
 * Notas:
 *   - La extracción de datos reales desde fuentes externas está simulada (placeholder).
 *   - `score` se almacena como string para compatibilidad con tipos (ej. decimal/char).
 *   - Si necesitas estricta compatibilidad binaria con v1 en nombres/firmas, revisa los
 *     "Aliases de compatibilidad v1" al final del archivo.
 */

import { db } from "@/db/db";
import {
  InsertSavedImport,
  SelectSavedImport,
  savedImportsTable,
  importConnectionsTable,
  kpiValuesTable,
  kpisTable,
  kpiColorEnum,
  SelectKpi,
  InsertKpiValue,
  scorecardElementsTable,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import {
  KpiMapping,
  KpiMappingSchema,
  TransformationRule,
  TransformationRuleSchema,
} from "@/types/import-types";
import { ScheduleConfigSchema } from "@/types/schedule-types";
import { auth } from "@clerk/nextjs/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { decrypt } from "@/lib/encryption";
import { applyTransformations } from "@/lib/data-transformer";
import { calculateKpiScoreAndColor } from "@/lib/kpi-scoring";

const logger = getLogger("import-actions");

/* -------------------------------------------------------------------------- */
/*                               Helpers / Utils                              */
/* -------------------------------------------------------------------------- */

/**
 * @function firstOrUndefined
 * @template T
 * @description Retorna el primer registro de un array resultante de una query o `undefined`.
 * @param {Promise<T[]>} q Promesa con el array de resultados.
 * @returns {Promise<T | undefined>} Primer elemento o `undefined`.
 */
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/**
 * @function formatZodError
 * @description Convierte un ZodError en un string legible para logs y respuestas.
 * @param {z.ZodError} e Error de Zod.
 * @returns {string} Mensaje formateado.
 */
function formatZodError(e: z.ZodError): string {
  return e.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" | ");
}

/* -------------------------------------------------------------------------- */
/*                           Esquemas de Validación Zod                       */
/* -------------------------------------------------------------------------- */

/**
 * @schema createSavedKpiImportSchema
 * @description Esquema de validación para crear una importación guardada (UC-201).
 * @property {string} name Nombre único de la importación (1..255).
 * @property {string} connectionId UUID de la conexión de importación.
 * @property {KpiMapping[]} kpiMappings Lista de mapeos KPI-Columnas origen.
 * @property {TransformationRule[] | null} transformations Reglas de transformación (opcional/nullable).
 * @property {ScheduleConfig | null} scheduleConfig Configuración de programación (opcional/nullable).
 */
const createSavedKpiImportSchema = z.object({
  name: z.string().min(1, "El nombre es requerido.").max(255, "Máx 255 caracteres."),
  connectionId: z.string().uuid("ID de conexión inválido."),
  kpiMappings: z.array(KpiMappingSchema).min(1, "Debe haber al menos un mapeo."),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: ScheduleConfigSchema.nullable().optional(),
});

/**
 * @schema updateSavedKpiImportSchema
 * @description Esquema de validación para actualizar una importación guardada existente (UC-201).
 * Campos opcionales permiten parches parciales.
 */
const updateSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
  name: z.string().min(1).max(255).optional(),
  connectionId: z.string().uuid().optional(),
  kpiMappings: z.array(KpiMappingSchema).min(1).optional(),
  transformations: z.array(TransformationRuleSchema).nullable().optional(),
  scheduleConfig: ScheduleConfigSchema.nullable().optional(),
});

/**
 * @schema deleteSavedKpiImportSchema
 * @description Esquema de validación para eliminar una importación guardada.
 */
const deleteSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema executeSavedKpiImportSchema
 * @description Esquema de validación para ejecutar una importación guardada (UC-201, UC-203).
 */
const executeSavedKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema scheduleKpiImportSchema
 * @description Esquema de validación para programar una importación guardada (UC-204).
 */
const scheduleKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
  scheduleConfig: ScheduleConfigSchema,
});

/**
 * @schema unscheduleKpiImportSchema
 * @description Esquema de validación para desprogramar una importación guardada (UC-204).
 */
const unscheduleKpiImportSchema = z.object({
  id: z.string().uuid("ID de importación inválido."),
});

/**
 * @schema uploadSimpleKpiImportSchema
 * @description Esquema de validación para importación simple desde archivo (UC-200 / placeholder).
 */
const uploadSimpleKpiImportSchema = z.object({
  fileName: z.string().min(1, "El nombre del archivo es requerido."),
  fileContentBase64: z.string().min(1, "El contenido Base64 es requerido."),
  organizationId: z.string().uuid("ID de organización inválido."),
});

/* -------------------------------------------------------------------------- */
/*                                Server Actions                              */
/* -------------------------------------------------------------------------- */

/**
 * @function createSavedKpiImportAction
 * @description Crea una nueva configuración de importación de KPI guardada (UC-201).
 * - Valida payload con Zod.
 * - Verifica unicidad del nombre y existencia de la conexión.
 * - Persiste JSONB (`kpiMappings`, `transformations`, `scheduleConfig`).
 * @param {Omit<InsertSavedImport, 'id' | 'createdById' | 'createdAt' | 'updatedAt' | 'lastRunAt'>} data
 * @returns {Promise<ActionState<SelectSavedImport>>}
 */
export async function createSavedKpiImportAction(
  data: Omit<InsertSavedImport, "id" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">,
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = createSavedKpiImportSchema.safeParse(data);
  if (!parsed.success) {
    const msg = formatZodError(parsed.error);
    logger.error(`Validation error (create): ${msg}`);
    return fail(msg);
  }

  const { name, connectionId, kpiMappings, transformations, scheduleConfig } = parsed.data;

  try {
    const nameExists = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.name, name)),
    );
    if (nameExists) return fail("Ya existe una importación con este nombre.");

    const connectionExists = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, connectionId)),
    );
    if (!connectionExists) return fail("La conexión especificada no existe.");

    const [row] = await db
      .insert(savedImportsTable)
      .values({
        name,
        connectionId,
        kpiMappings: kpiMappings as any,
        transformations: transformations as any,
        scheduleConfig: scheduleConfig as any,
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return ok("Importación de KPI guardada creada exitosamente.", row);
  } catch (e) {
    logger.error(`Error creating saved KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al crear la importación de KPI guardada.");
  }
}

/**
 * @function getSavedKpiImportAction
 * @description Obtiene una configuración de importación guardada por su ID.
 * @param {string} id UUID de la importación.
 * @returns {Promise<ActionState<SelectSavedImport>>}
 */
export async function getSavedKpiImportAction(
  id: string,
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = z.string().uuid("ID inválido.").safeParse(id);
  if (!v.success) return fail(formatZodError(v.error));

  try {
    const saved = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, v.data)),
    );
    if (!saved) return fail("Importación de KPI guardada no encontrada.");
    return ok("Importación de KPI guardada obtenida exitosamente.", saved);
  } catch (e) {
    logger.error(`Error retrieving saved KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al obtener la importación de KPI guardada.");
  }
}

/**
 * @function updateSavedKpiImportAction
 * @description Actualiza una importación guardada (UC-201).
 * - Valida el payload.
 * - Verifica unicidad del nombre si cambia.
 * - Verifica existencia de la conexión si se provee `connectionId`.
 * @param {string} id UUID de la importación.
 * @param {Partial<Omit<InsertSavedImport, 'id' | 'createdById' | 'createdAt' | 'updatedAt' | 'lastRunAt'>>} data
 * @returns {Promise<ActionState<SelectSavedImport>>}
 */
export async function updateSavedKpiImportAction(
  id: string,
  data: Partial<Omit<InsertSavedImport, "id" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">>,
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = updateSavedKpiImportSchema.safeParse({ id, ...data });
  if (!v.success) return fail(formatZodError(v.error));
  const { id: importId, name, connectionId, kpiMappings, transformations, scheduleConfig } = v.data;

  try {
    const existing = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, importId)),
    );
    if (!existing) return fail("Importación de KPI guardada no encontrada.");

    if (name && name !== existing.name) {
      const conflict = await firstOrUndefined(
        db.select().from(savedImportsTable).where(eq(savedImportsTable.name, name)),
      );
      if (conflict) return fail("Ya existe otra importación con ese nombre.");
    }

    if (connectionId) {
      const conn = await firstOrUndefined(
        db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, connectionId)),
      );
      if (!conn) return fail("La conexión de importación especificada no existe.");
    }

    const [updated] = await db
      .update(savedImportsTable)
      .set({
        name,
        connectionId,
        kpiMappings: kpiMappings as any,
        transformations: transformations as any,
        scheduleConfig: scheduleConfig as any,
        updatedAt: new Date(),
      })
      .where(eq(savedImportsTable.id, importId))
      .returning();

    return ok("Importación de KPI guardada actualizada exitosamente.", updated);
  } catch (e) {
    logger.error(`Error updating saved KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al actualizar la importación de KPI guardada.");
  }
}

/**
 * @function deleteSavedKpiImportAction
 * @description Elimina una importación guardada.
 * @param {{ id: string }} data Objeto con UUID de la importación.
 * @returns {Promise<ActionState<undefined>>}
 * @note Firma v2 (objeto). Al final del archivo hay un wrapper `deleteSavedKpiImportActionV1(id)` compatible con v1.
 */
export async function deleteSavedKpiImportAction(
  data: z.infer<typeof deleteSavedKpiImportSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = deleteSavedKpiImportSchema.safeParse(data);
  if (!v.success) return fail(formatZodError(v.error));

  try {
    const existing = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, v.data.id)),
    );
    if (!existing) return fail("Importación de KPI guardada no encontrada.");

    await db.delete(savedImportsTable).where(eq(savedImportsTable.id, v.data.id));
    return ok("Importación de KPI guardada eliminada exitosamente.");
  } catch (e) {
    logger.error(`Error deleting saved KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al eliminar la importación de KPI guardada.");
  }
}

/**
 * @function executeSavedKpiImportAction
 * @description Ejecuta una importación guardada (UC-201, UC-203).
 * Flujo:
 *   1) Carga import + conexión asociada.
 *   2) Decripta y parsea detalles de conexión (placeholder).
 *   3) Valida y aplica transformaciones sobre los datos extraídos (placeholder).
 *   4) Mapea columnas → campos KPI y calcula `score/color`.
 *   5) Upsert en `kpi_values` por [kpiId, periodDate].
 *   6) Actualiza `lastRunAt`.
 * @param {z.infer<typeof executeSavedKpiImportSchema>} data
 * @param {string | null} [executorUserId=null] Permite ejecución por sistema (cron) o usuario autenticado.
 * @returns {Promise<ActionState<undefined>>}
 */
export async function executeSavedKpiImportAction(
  data: z.infer<typeof executeSavedKpiImportSchema>,
  executorUserId: string | null = null,
): Promise<ActionState<undefined>> {
  const { userId: authUserId } = await auth();
  const actualUpdaterUserId = executorUserId || authUserId;
  if (!actualUpdaterUserId) return fail("No autorizado. Debe iniciar sesión o proporcionar un ID de usuario ejecutor.");

  const v = executeSavedKpiImportSchema.safeParse(data);
  if (!v.success) return fail(formatZodError(v.error));
  const { id: importId } = v.data;

  try {
    // 1) Import + Conexión
    const joined = await firstOrUndefined(
      db
        .select()
        .from(savedImportsTable)
        .leftJoin(importConnectionsTable, eq(savedImportsTable.connectionId, importConnectionsTable.id))
        .where(eq(savedImportsTable.id, importId))
        .limit(1),
    );

    // Drizzle retorna con claves por nombre de tabla (snake_case)
    if (!joined || !joined.saved_imports) {
      return fail("Configuración de importación de KPI guardada no encontrada.");
    }

    const savedImport = joined.saved_imports;
    const connection = joined.import_connections;
    if (!connection) return fail("Conexión de importación asociada no encontrada.");

    // 2) Decrypt + parse de detalles (placeholder)
    let connectionDetails: unknown = {};
    try {
      const decrypted = decrypt(connection.connectionDetails as unknown as string);
      connectionDetails = JSON.parse(decrypted);
    } catch {
      logger.error(`No se pudieron parsear los detalles de conexión para importId=${importId}`);
      return fail("Detalles de conexión inválidos o corruptos.");
    }

    // 3) JSONB: mapeos/transformaciones
    const mappingsRes = z.array(KpiMappingSchema).safeParse(savedImport.kpiMappings ?? []);
    if (!mappingsRes.success) {
      logger.error(`Invalid KPI mappings: ${formatZodError(mappingsRes.error)}`);
      return fail("Mapeos de KPI inválidos o corruptos en la configuración de importación.");
    }
    const kpiMappings: KpiMapping[] = mappingsRes.data;

    const transfRes = z.array(TransformationRuleSchema).safeParse(savedImport.transformations ?? []);
    const transformations: TransformationRule[] = transfRes.success
      ? transfRes.data.map(r => ({ ...r, parameters: r.parameters ?? {} }))
      : [];

    // 4) Extracción (placeholder)
    logger.info(`Simulating data extraction for connection type: ${connection.connectionType}`);
    let rawData: Record<string, unknown>[] = [];
    if (connection.connectionType === "Excel") {
      rawData = [
        { "Date": "2023-01-01T00:00:00Z", "KPI_ID": "a1", "Actual": "100", "Target": "120" },
        { "Date": "2023-02-01T00:00:00Z", "KPI_ID": "b2", "Actual": "50", "ThresholdRed": "40" },
      ];
    } else if (["Microsoft SQL Server", "Oracle", "MySQL", "PostgreSQL", "Hive"].includes(connection.connectionType)) {
      rawData = [
        { "date_col": "2023-03-01T00:00:00Z", "kpi_id_col": "a1", "value_col": "110", "goal_col": "130" },
        { "date_col": "2023-03-01T00:00:00Z", "kpi_id_col": "b2", "value_col": "45", "red_threshold_col": "40" },
      ];
    } else {
      return fail("Tipo de conexión no soportado para la extracción de datos.");
    }

    if (rawData.length === 0) {
      await db.update(savedImportsTable).set({ lastRunAt: new Date(), updatedAt: new Date() }).where(eq(savedImportsTable.id, importId));
      return ok("Importación ejecutada, pero no se extrajeron datos.");
    }

    // 5) Transformaciones
    const transformed = applyTransformations(rawData, transformations);
    logger.info(`Applied ${transformations.length} transformations.`);

    // 6) Pre-carga de KPIs
    const kpiIdsToFetch = Array.from(new Set(kpiMappings.map(m => m.kpiId)));
    const kpis: SelectKpi[] =
      kpiIdsToFetch.length > 0
        ? await db.select().from(kpisTable).where(inArray(kpisTable.id, kpiIdsToFetch))
        : [];
    const kpiMap = new Map<string, SelectKpi>(kpis.map(k => [k.id, k]));

    // 7) Mapeo y cálculo
    const kpiValuesToUpsert: InsertKpiValue[] = [];

    // 🔧 FIX: aceptar null | undefined en el parámetro `field`
    const getMappedValue = (
      row: Record<string, unknown>,
      field: { sourceField: string; defaultValue?: string | null } | null | undefined,
    ) => {
      if (!field) return null;
      const v = row[field.sourceField];
      if (v === undefined || v === null || String(v).trim() === "") {
        return field.defaultValue ?? null;
      }
      return String(v);
    };

    for (const row of transformed) {
      for (const mapping of kpiMappings) {
        const kpi = kpiMap.get(mapping.kpiId);
        if (!kpi) {
          logger.info(`KPI ${mapping.kpiId} no encontrado; fila omitida.`);
          continue;
        }

        const rawPeriod = getMappedValue(row, mapping.periodDate);
        if (!rawPeriod) continue;
        const periodDate = rawPeriod.includes("T") ? rawPeriod.split("T")[0] : rawPeriod;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) {
          logger.info(`Formato de fecha inválido '${periodDate}' para KPI ${mapping.kpiId}`);
          continue;
        }

        const actualValue = getMappedValue(row, mapping.actualValue);
        const targetValue = getMappedValue(row, mapping.targetValue);
        const thresholdRed = getMappedValue(row, mapping.thresholdRed);
        const thresholdYellow = getMappedValue(row, mapping.thresholdYellow);
        const note = getMappedValue(row, mapping.note);

        // Cálculo score/color (score como string)
        let scoreStr: string | null = null;
        let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

        const toNum = (s: string | null) =>
          s != null && s.trim() !== "" && !isNaN(Number(s)) ? Number(s) : null;
        const a = toNum(actualValue);
        const t = toNum(targetValue);
        const r = toNum(thresholdRed);
        const y = toNum(thresholdYellow);

        if (kpi.scoringType === "Goal/Red Flag" && a !== null) {
          const res = calculateKpiScoreAndColor(a, t, r, y);
          scoreStr = res.score != null ? String(res.score) : null;
          color = res.color;
        } else if (kpi.scoringType === "Yes/No" && a !== null) {
          scoreStr = a === 1 ? "100" : "0";
          color = a === 1 ? "Green" : "Red";
        }

        kpiValuesToUpsert.push({
          kpiId: kpi.id,
          periodDate,
          actualValue,
          targetValue,
          thresholdRed,
          thresholdYellow,
          score: scoreStr,
          color,
          updatedByUserId: actualUpdaterUserId,
          isManualEntry: false,
          note,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // 8) Upsert por conflicto (kpiId, periodDate)
    if (kpiValuesToUpsert.length > 0) {
      await db.transaction(async (tx) => {
        for (const v of kpiValuesToUpsert) {
          await tx
            .insert(kpiValuesTable)
            .values(v)
            .onConflictDoUpdate({
              target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
              set: {
                actualValue: v.actualValue,
                targetValue: v.targetValue,
                thresholdRed: v.thresholdRed,
                thresholdYellow: v.thresholdYellow,
                score: v.score,
                color: v.color,
                updatedByUserId: v.updatedByUserId,
                isManualEntry: v.isManualEntry,
                note: v.note,
                updatedAt: new Date(),
              },
            });
        }
      });
      logger.info(`Successfully processed ${kpiValuesToUpsert.length} KPI values.`);
    } else {
      logger.info(`No valid KPI values to insert after mapping for import ID: ${importId}.`);
    }

    // 9) lastRunAt
    await db
      .update(savedImportsTable)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(savedImportsTable.id, importId));

    return ok("Importación de KPI ejecutada exitosamente.");
  } catch (e) {
    logger.error(`Error executing saved KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al ejecutar la importación de KPI.");
  }
}

/**
 * @function uploadSimpleKpiImportAction
 * @description Importación simple desde archivo (UC-200) — **placeholder**:
 *   - Simula parseo desde `fileContentBase64`.
 *   - Enlaza KPIs por nombre dentro de una organización.
 *   - Calcula `score/color` si corresponde.
 * @param {z.infer<typeof uploadSimpleKpiImportSchema>} data
 * @returns {Promise<ActionState<undefined>>}
 */
export async function uploadSimpleKpiImportAction(
  data: z.infer<typeof uploadSimpleKpiImportSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = uploadSimpleKpiImportSchema.safeParse(data);
  if (!v.success) return fail(formatZodError(v.error));

  const { fileName, fileContentBase64, organizationId } = v.data;

  try {
    const decoded = Buffer.from(fileContentBase64, "base64").toString("utf-8");
    logger.info(`Simulando importación simple: ${fileName} (len=${decoded.length})`);

    // Datos simulados
    const simulatedRows = [
      { KpiName: "Ventas Mensuales", Date: "2023-01-01", Value: "1500" },
      { KpiName: "Ventas Mensuales", Date: "2023-02-01", Value: "1600" },
      { KpiName: "Satisfacción Cliente", Date: "2023-01-01", Value: "85", Target: "90" },
    ];

    const kpisInOrg = await db
      .select({
        id: kpisTable.id,
        name: scorecardElementsTable.name,
        scoringType: kpisTable.scoringType,
      })
      .from(kpisTable)
      .leftJoin(
        scorecardElementsTable,
        eq(kpisTable.scorecardElementId, scorecardElementsTable.id),
      )
      .where(eq(scorecardElementsTable.organizationId, organizationId));

    const kpiNameMap = new Map(kpisInOrg.map(k => [k.name, k]));

    for (const row of simulatedRows) {
      const kpiName = row.KpiName;
      const kpiEntry = kpiNameMap.get(kpiName);
      if (!kpiEntry) {
        logger.info(`KPI '${kpiName}' no encontrado en org ${organizationId}; fila omitida.`);
        continue;
      }

      const periodRaw = row.Date;
      const periodDate = periodRaw.includes("T") ? periodRaw.split("T")[0] : periodRaw;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) {
        logger.info(`Formato de fecha inválido '${row.Date}' para KPI '${kpiName}'.`);
        continue;
      }

      const actualValue = row.Value ?? null;
      const targetValue = row.Target ?? null;

      let scoreStr: string | null = null;
      let color: (typeof kpiColorEnum.enumValues)[number] | null = null;

      if (kpiEntry.scoringType === "Goal/Red Flag" && actualValue && targetValue) {
        const a = Number(actualValue);
        const t = Number(targetValue);
        if (!Number.isNaN(a) && !Number.isNaN(t)) {
          const res = calculateKpiScoreAndColor(a, t, null, null);
          scoreStr = res.score != null ? String(res.score) : null;
          color = res.color;
        }
      }

      const vToUpsert: InsertKpiValue = {
        kpiId: kpiEntry.id,
        periodDate,
        actualValue,
        targetValue,
        score: scoreStr,
        color,
        updatedByUserId: userId,
        isManualEntry: false,
        note: `Importado vía importación simple (${fileName})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db
        .insert(kpiValuesTable)
        .values(vToUpsert)
        .onConflictDoUpdate({
          target: [kpiValuesTable.kpiId, kpiValuesTable.periodDate],
          set: {
            actualValue: vToUpsert.actualValue,
            targetValue: vToUpsert.targetValue,
            score: vToUpsert.score,
            color: vToUpsert.color,
            updatedByUserId: vToUpsert.updatedByUserId,
            note: vToUpsert.note,
            updatedAt: new Date(),
          },
        });
    }

    return ok("Importación simple de KPI procesada exitosamente.");
  } catch (e) {
    logger.error(`Error uploading simple KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al procesar la importación simple.");
  }
}

/**
 * @function scheduleKpiImportAction
 * @description Programa una importación guardada (UC-204).
 * @param {z.infer<typeof scheduleKpiImportSchema>} data
 * @returns {Promise<ActionState<SelectSavedImport>>}
 */
export async function scheduleKpiImportAction(
  data: z.infer<typeof scheduleKpiImportSchema>,
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = scheduleKpiImportSchema.safeParse(data);
  if (!v.success) return fail(formatZodError(v.error));

  try {
    const exists = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, v.data.id)),
    );
    if (!exists) return fail("Importación de KPI guardada no encontrada.");

    const [updated] = await db
      .update(savedImportsTable)
      .set({ scheduleConfig: v.data.scheduleConfig as any, updatedAt: new Date() })
      .where(eq(savedImportsTable.id, v.data.id))
      .returning();

    return ok("Importación de KPI programada exitosamente.", updated);
  } catch (e) {
    logger.error(`Error scheduling KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al programar la importación de KPI.");
  }
}

/**
 * @function unscheduleKpiImportAction
 * @description Desprograma una importación guardada (UC-204).
 * @param {z.infer<typeof unscheduleKpiImportSchema>} data
 * @returns {Promise<ActionState<SelectSavedImport>>}
 */
export async function unscheduleKpiImportAction(
  data: z.infer<typeof unscheduleKpiImportSchema>,
): Promise<ActionState<SelectSavedImport>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const v = unscheduleKpiImportSchema.safeParse(data);
  if (!v.success) return fail(formatZodError(v.error));

  try {
    const exists = await firstOrUndefined(
      db.select().from(savedImportsTable).where(eq(savedImportsTable.id, v.data.id)),
    );
    if (!exists) return fail("Importación de KPI guardada no encontrada.");

    const [updated] = await db
      .update(savedImportsTable)
      .set({ scheduleConfig: null, updatedAt: new Date() })
      .where(eq(savedImportsTable.id, v.data.id))
      .returning();

    return ok("Importación de KPI desprogramada exitosamente.", updated);
  } catch (e) {
    logger.error(`Error unscheduling KPI import: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al desprogramar la importación de KPI.");
  }
}

/**
 * @function getAllSavedKpiImportsAction
 * @description Lista todas las importaciones guardadas (UC-201).
 * @returns {Promise<ActionState<SelectSavedImport[]>>}
 */
export async function getAllSavedKpiImportsAction(): Promise<ActionState<SelectSavedImport[]>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  try {
    const rows = await db.select().from(savedImportsTable);
    return ok("Importaciones de KPI guardadas obtenidas exitosamente.", rows);
  } catch (e) {
    logger.error(`Error retrieving saved KPI imports: ${e instanceof Error ? e.message : String(e)}`);
    return fail("Fallo al obtener las importaciones de KPI guardadas.");
  }
}

/* -------------------------------------------------------------------------- */
/*                     Aliases de compatibilidad con la versión 1             */
/* -------------------------------------------------------------------------- */
/**
 * @alias getSavedImportByIdAction
 * @description Alias para mantener compatibilidad con v1.
 */
export { getSavedKpiImportAction as getSavedImportByIdAction };

/**
 * @alias getSavedKpiImportsAction
 * @description Alias para mantener compatibilidad con v1.
 */
export { getAllSavedKpiImportsAction as getSavedKpiImportsAction };

/**
 * @function deleteSavedKpiImportActionV1
 * @description Wrapper con firma v1 (`id: string`) para `deleteSavedKpiImportAction`.
 * @param {string} id UUID de la importación.
 * @returns {Promise<ActionState<undefined>>}
 */
export async function deleteSavedKpiImportActionV1(id: string) {
  return deleteSavedKpiImportAction({ id });
}
