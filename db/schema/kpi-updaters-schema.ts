/**
 * @file db/schema/kpi-updaters-schema.ts
 * @brief Define el esquema de base de datos para los encargados de actualización de KPI en DeltaOne.
 * @description Esta tabla de unión gestiona la asignación de usuarios o grupos
 * responsables de actualizar manualmente los valores de KPIs específicos.
 */

import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core"
import { kpisTable } from "./kpis-schema" // Importar la tabla de KPIs
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles

/**
 * @constant kpiUpdatersTable
 * @description Definición de la tabla kpi_updaters, una tabla de unión que asocia
 * KPIs con los usuarios responsables de actualizarlos manualmente.
 */
export const kpiUpdatersTable = pgTable(
  "kpi_updaters",
  {
    kpiId: uuid("kpi_id")
      .references(() => kpisTable.id, { onDelete: "cascade" })
      .notNull(), // FK al KPI
    userId: text("user_id")
      .references(() => profilesTable.userId, { onDelete: "cascade" })
      .notNull(), // FK al usuario responsable de la actualización
    canModifyThresholds: boolean("can_modify_thresholds")
      .default(false)
      .notNull(), // Indica si el actualizador puede modificar los umbrales del KPI
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  table => {
    return {
      // Clave primaria compuesta para asegurar que un usuario solo pueda ser asignado una vez como actualizador para un KPI específico
      pk: [table.kpiId, table.userId]
    }
  }
)

/**
 * @typedef {typeof kpiUpdatersTable.$inferInsert} InsertKpiUpdater
 * @description Define el tipo para la inserción de un nuevo encargado de actualización de KPI.
 */
export type InsertKpiUpdater = typeof kpiUpdatersTable.$inferInsert

/**
 * @typedef {typeof kpiUpdatersTable.$inferSelect} SelectKpiUpdater
 * @description Define el tipo para la selección de un encargado de actualización de KPI existente.
 */
export type SelectKpiUpdater = typeof kpiUpdatersTable.$inferSelect
