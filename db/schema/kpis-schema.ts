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
  boolean,
  unique
} from "drizzle-orm/pg-core"
import { scorecardElementsTable } from "./scorecard-elements-schema" // Importar la tabla de elementos de Scorecard

/**
 * @enum kpiScoringTypeEnum
 * @description Define cómo se puntúa un KPI (ej. Gol/Bandera Roja, Sí/No, Texto).
 */
export const kpiScoringTypeEnum = pgEnum("kpi_scoring_type", [
  "Goal/Red Flag", // Compara un valor con metas y umbrales (rojo/amarillo/verde)
  "Yes/No", // Puntuación binaria
  "Text" // Simplemente muestra texto (no se puntúa numéricamente)
])

/**
 * @enum kpiCalendarFrequencyEnum
 * @description Define la frecuencia de actualización esperada de un KPI.
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
 * @description Define el tipo de dato que almacenará un KPI.
 */
export const kpiDataTypeEnum = pgEnum("kpi_data_type", [
  "Number",
  "Percentage",
  "Currency",
  "Text"
])

/**
 * @enum kpiAggregationTypeEnum
 * @description Define cómo se agregan los valores de KPI para diferentes períodos o en rollups.
 */
export const kpiAggregationTypeEnum = pgEnum("kpi_aggregation_type", [
  "Sum", // Suma los valores
  "Average", // Promedia los valores
  "Last Value" // Toma el último valor del período
])

export const kpisTable = pgTable(
  "kpis",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Identificador único del KPI
    scorecardElementId: uuid("scorecard_element_id")
      .references(() => scorecardElementsTable.id, { onDelete: "cascade" })
      .notNull(), // FK al elemento del Scorecard al que está vinculado este KPI, con borrado en cascada
    scoringType: kpiScoringTypeEnum("scoring_type").notNull(), // Tipo de puntuación del KPI
    calendarFrequency: kpiCalendarFrequencyEnum("calendar_frequency").notNull(), // Frecuencia de actualización del KPI
    dataType: kpiDataTypeEnum("data_type").notNull(), // Tipo de dato que almacena el KPI
    aggregationType: kpiAggregationTypeEnum("aggregation_type").notNull(), // Tipo de agregación para rollup o consolidación temporal
    decimalPrecision: integer("decimal_precision").default(0).notNull(), // Número de decimales para mostrar
    isManualUpdate: boolean("is_manual_update").default(false).notNull(), // Indica si el valor del KPI se actualiza manualmente
    calculationEquation: text("calculation_equation"), // Ecuación para KPIs calculados automáticamente (opcional)
    rollupEnabled: boolean("rollup_enabled").default(false).notNull(), // Indica si este KPI acumula valores de organizaciones hijas
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  table => {
    return [
      // Asegura que un elemento de Scorecard solo puede tener un KPI asociado directamente
      unique("scorecard_element_id_unique").on(table.scorecardElementId)
    ]
  }
)

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
