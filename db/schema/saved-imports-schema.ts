/**
 * @file db/schema/saved-imports-schema.ts
 * @brief Define el esquema de base de datos para las importaciones de datos guardadas en DeltaOne.
 * @description Esta tabla permite almacenar configuraciones de importación de KPI reutilizables,
 * incluyendo mapeos de datos, transformaciones y programación de ejecuciones recurrentes.
 */

import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core"
import { importConnectionsTable } from "./import-connections-schema" // Importar la tabla de conexiones de importación
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles

/**
 * @constant savedImportsTable
 * @description Definición de la tabla `saved_imports`, que almacena configuraciones de importación
 * de datos de KPI que pueden ser ejecutadas manualmente o programadas.
 */
export const savedImportsTable = pgTable("saved_imports", {
  id: uuid("id").primaryKey().defaultRandom(), // Identificador único de la importación guardada
  name: text("name").notNull().unique(), // Nombre único de la importación guardada
  connectionId: uuid("connection_id")
    .references(() => importConnectionsTable.id, { onDelete: "cascade" })
    .notNull(), // FK a la conexión de importación asociada, con borrado en cascada
  kpiMappings: jsonb("kpi_mappings").notNull(), // Configuración de mapeo de columnas de origen a KPIs de destino (JSON)
  transformations: jsonb("transformations"), // Array de objetos con reglas de transformación de datos (JSON, opcional)
  scheduleConfig: jsonb("schedule_config"), // Configuración de programación: frecuencia, hora, etc. (JSON, opcional)
  lastRunAt: timestamp("last_run_at"), // Marca de tiempo de la última ejecución exitosa de esta importación
  createdById: text("created_by_user_id")
    .references(() => profilesTable.userId, { onDelete: "set null" })
    .notNull(), // FK al usuario que creó esta importación, se setea a NULL si el usuario es eliminado
  createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof savedImportsTable.$inferInsert} InsertSavedImport
 * @description Define el tipo para la inserción de una nueva importación guardada.
 */
export type InsertSavedImport = typeof savedImportsTable.$inferInsert

/**
 * @typedef {typeof savedImportsTable.$inferSelect} SelectSavedImport
 * @description Define el tipo para la selección de una importación guardada existente.
 */
export type SelectSavedImport = typeof savedImportsTable.$inferSelect
