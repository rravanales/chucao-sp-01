/**
 * @file db/schema/import-connections-schema.ts
 * @brief Define el esquema de base de datos para las conexiones de importación en DeltaOne.
 * @description Esta tabla almacena los detalles de conexión a diversas fuentes de datos (bases de datos,
 * hojas de cálculo) que se utilizarán para importar los valores de KPI. Las credenciales sensibles
 * en `connection_details` deben ser cifradas a nivel de aplicación antes de su almacenamiento.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb
} from "drizzle-orm/pg-core"
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles

/**
 * @enum importConnectionTypeEnum
 * @description Define los tipos posibles de fuentes de datos para las conexiones de importación.
 */
export const importConnectionTypeEnum = pgEnum("import_connection_type", [
  "Excel",
  "Microsoft SQL Server",
  "Oracle",
  "MySQL",
  "PostgreSQL",
  "Hive"
])

/**
 * @constant importConnectionsTable
 * @description Definición de la tabla `import_connections`, que almacena la información de las conexiones
 * a las fuentes de datos externas.
 */
export const importConnectionsTable = pgTable("import_connections", {
  id: uuid("id").primaryKey().defaultRandom(), // Identificador único de la conexión de importación
  name: text("name").notNull().unique(), // Nombre único de la conexión para fácil identificación
  connectionType: importConnectionTypeEnum("connection_type").notNull(), // Tipo de la conexión (ej. 'Excel', 'Microsoft SQL Server')
  connectionDetails: jsonb("connection_details").notNull(), // Detalles de la conexión (host, puerto, credenciales, etc. - DEBE SER CIFRADO)
  createdById: text("created_by_user_id")
    .references(() => profilesTable.userId, { onDelete: "set null" })
    .notNull(), // FK al usuario que creó esta conexión, se setea a NULL si el usuario es eliminado
  createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof importConnectionsTable.$inferInsert} InsertImportConnection
 * @description Define el tipo para la inserción de una nueva conexión de importación.
 */
export type InsertImportConnection = typeof importConnectionsTable.$inferInsert

/**
 * @typedef {typeof importConnectionsTable.$inferSelect} SelectImportConnection
 * @description Define el tipo para la selección de una conexión de importación existente.
 */
export type SelectImportConnection = typeof importConnectionsTable.$inferSelect
