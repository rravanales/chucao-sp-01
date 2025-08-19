/**
 * @file db/schema/kpi-values-schema.ts
 * @brief Define el esquema de base de datos para los valores de los Indicadores Clave de Rendimiento (KPIs) en DeltaOne.
 * @description Esta tabla almacena los datos de rendimiento reales y de umbral para cada KPI
 * en un período de tiempo dado, incluyendo su puntuación y color calculados.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  decimal,
  boolean,
  uniqueIndex,
  date
} from "drizzle-orm/pg-core"
import { kpisTable } from "./kpis-schema" // Importar la tabla de KPIs
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles (para updated_by_user_id)

/**
 * @enum kpiColorEnum
 * @description Define los posibles colores o estados de rendimiento de un KPI.
 */
export const kpiColorEnum = pgEnum("kpi_color", ["Red", "Yellow", "Green"])

/**
 * @constant kpiValuesTable
 * @description Definición de la tabla kpi_values, que almacena los valores de un KPI
 * para cada período de tiempo, incluyendo su valor real, metas, umbrales, puntuación y color.
 */
export const kpiValuesTable = pgTable(
  "kpi_values",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Identificador único del valor de KPI
    kpiId: uuid("kpi_id")
      .references(() => kpisTable.id, { onDelete: "cascade" })
      .notNull(), // FK al KPI al que pertenece este valor, con borrado en cascada
    periodDate: date("period_date").notNull(), // Fecha del período al que corresponde este valor (ej. el primer día del mes)
    actualValue: text("actual_value"), // Valor real del KPI (almacenado como texto para flexibilidad con data_type)
    targetValue: text("target_value"), // Valor objetivo del KPI (opcional, almacenado como texto)
    thresholdRed: text("threshold_red"), // Umbral que define "Rojo" (opcional, almacenado como texto)
    thresholdYellow: text("threshold_yellow"), // Umbral que define "Amarillo" (opcional, almacenado como texto)
    score: decimal("score"), // Puntuación calculada del KPI para este período (opcional)
    color: kpiColorEnum("color"), // Color/estado calculado del KPI (opcional)
    updatedByUserId: text("updated_by_user_id").references(
      () => profilesTable.userId,
      { onDelete: "set null" }
    ), // FK al usuario que realizó la última actualización manual/importación, se setea a NULL si el usuario es eliminado
    isManualEntry: boolean("is_manual_entry").default(false).notNull(), // Indica si la entrada fue manual (true) o por importación/cálculo (false)
    note: text("note"), // Campo para notas o explicaciones (ej. si el KPI está en "Rojo")
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  table => {
    return [
      // Asegura que solo haya un valor para un KPI específico en un período de fecha dado
      uniqueIndex("kpi_values_kpi_id_period_date_idx").on(
        table.kpiId,
        table.periodDate
      )
    ]
  }
)

/**
 * @typedef {typeof kpiValuesTable.$inferInsert} InsertKpiValue
 * @description Define el tipo para la inserción de un nuevo valor de KPI.
 */
export type InsertKpiValue = typeof kpiValuesTable.$inferInsert

/**
 * @typedef {typeof kpiValuesTable.$inferSelect} SelectKpiValue
 * @description Define el tipo para la selección de un valor de KPI existente.
 */
export type SelectKpiValue = typeof kpiValuesTable.$inferSelect
