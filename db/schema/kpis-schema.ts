/**
 * @file db/schema/kpis-schema.ts
 * @brief Define el esquema de base de datos para los Indicadores Clave de Rendimiento (KPIs) en DeltaOne.
 * @description Esta tabla almacena la configuración específica de cada KPI,
 * incluyendo su tipo de puntuación, frecuencia de actualización y detalles de cálculo.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  integer,
  boolean
} from "drizzle-orm/pg-core"
import { scorecardElementsTable } from "./scorecard-elements-schema" // Importar la tabla de elementos del Scorecard

/**
 * @enum kpiScoringTypeEnum
 * @description Define los tipos de puntuación para un KPI (ej. Goal/Red Flag, Sí/No, Texto).
 */
export const kpiScoringTypeEnum = pgEnum("kpi_scoring_type", [
  "Goal/Red Flag",
  "Yes/No",
  "Text"
])

/**
 * @enum kpiCalendarFrequencyEnum
 * @description Define las frecuencias de actualización de los KPIs (ej. diaria, semanal, mensual).
 */
export const kpiCalendarFrequencyEnum = pgEnum("kpi_calendar_frequency", [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Annually"
])

/**
 * @enum kpiDataTypeEnum
 * @description Define los tipos de datos que un KPI puede almacenar (ej. Número, Porcentaje, Moneda, Texto).
 */
export const kpiDataTypeEnum = pgEnum("kpi_data_type", [
  "Number",
  "Percentage",
  "Currency",
  "Text"
])

/**
 * @enum kpiAggregationTypeEnum
 * @description Define cómo se agregan los valores de un KPI para rollups o en períodos de tiempo (ej. Suma, Promedio, Último Valor).
 */
export const kpiAggregationTypeEnum = pgEnum("kpi_aggregation_type", [
  "Sum",
  "Average",
  "Last Value"
])

/**
 * @constant kpisTable
 * @description Definición de la tabla kpis, que almacena la configuración de cada KPI.
 */
export const kpisTable = pgTable("kpis", {
  id: uuid("id").primaryKey().defaultRandom(), // Identificador único del KPI
  scorecardElementId: uuid("scorecard_element_id")
    .references(() => scorecardElementsTable.id, { onDelete: "cascade" })
    .notNull()
    .unique(), // FK al elemento del Scorecard al que pertenece (debe ser de tipo 'KPI')
  scoringType: kpiScoringTypeEnum("scoring_type").notNull(), // Tipo de puntuación del KPI
  calendarFrequency: kpiCalendarFrequencyEnum("calendar_frequency").notNull(), // Frecuencia de actualización
  dataType: kpiDataTypeEnum("data_type").notNull(), // Tipo de dato que almacena el KPI
  aggregationType: kpiAggregationTypeEnum("aggregation_type").notNull(), // Tipo de agregación para rollups
  decimalPrecision: integer("decimal_precision").default(0).notNull(), // Número de decimales para valores numéricos
  isManualUpdate: boolean("is_manual_update").default(false).notNull(), // Indica si el KPI se actualiza manualmente
  calculationEquation: text("calculation_equation"), // Ecuación para KPIs calculados automáticamente
  rollupEnabled: boolean("rollup_enabled").default(false).notNull(), // Habilita el rollup desde organizaciones hijas
  createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof kpisTable.$inferInsert} InsertKpi
 * @description Define el tipo para la inserción de un nuevo KPI.
 */
export type InsertKpi = typeof kpisTable.$inferInsert

/**
 * @typedef {typeof kpisTable.$inferSelect} SelectKpi
 * @description Define el tipo para la selección de un KPI existente.
 */
export type SelectKpi = typeof kpisTable.$inferSelect
