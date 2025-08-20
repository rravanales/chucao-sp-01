/**
 * @file db/schema/alerts-schema.ts
 * @brief Define el esquema de base de datos para las alertas en DeltaOne.
 * @description Esta tabla almacena la configuración de varias alertas automáticas
 * (ej., KPI en estado "Rojo", recordatorios de actualización, respuestas a notas,
 * y alertas personalizadas), incluyendo a quiénes se dirigen y sus condiciones.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb
} from "drizzle-orm/pg-core"
import { kpisTable } from "./kpis-schema" // Importar la tabla de KPIs
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles (para created_by_user_id)

/**
 * @enum alertTypeEnum
 * @description Define los tipos posibles de alertas que pueden configurarse en la aplicación.
 */
export const alertTypeEnum = pgEnum("alert_type", [
  "Red KPI", // Alerta cuando un KPI se vuelve rojo
  "Update Reminder", // Recordatorio para actualizar valores de KPI
  "Note Reply", // Alerta cuando se responde a una nota
  "Custom KPI Change" // Alerta personalizada basada en cambios específicos de KPI
])

/**
 * @constant alertsTable
 * @description Definición de la tabla alerts, que gestiona la configuración y el estado de las alertas.
 */
export const alertsTable = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(), // Identificador único de la alerta
  alertType: alertTypeEnum("alert_type").notNull(), // Tipo de alerta (ej. 'Red KPI', 'Update Reminder')
  kpiId: uuid("kpi_id").references(() => kpisTable.id, { onDelete: "cascade" }), // FK al KPI asociado (nullable para alertas generales como recordatorios)
  conditionDetails: jsonb("condition_details"), // Detalles de la condición para disparar la alerta (ej. umbral, tipo de cambio, si requiere nota). JSONB para flexibilidad.
  recipientsUserIds: jsonb("recipients_user_ids").notNull().default("[]"), // Array de IDs de usuario que recibirán la alerta. JSONB para flexibilidad.
  recipientsGroupIds: jsonb("recipients_group_ids").notNull().default("[]"), // Array de IDs de grupo que recibirán la alerta. JSONB para flexibilidad.
  frequencyConfig: jsonb("frequency_config"), // Configuración de la frecuencia de la alerta (ej. 'inmediata', 'diaria', 'semanal', días antes/después). JSONB para flexibilidad.
  createdById: text("created_by_user_id")
    .references(() => profilesTable.userId, { onDelete: "set null" })
    .notNull(), // FK al usuario que creó esta alerta, se setea a NULL si el usuario es eliminado
  createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof alertsTable.$inferInsert} InsertAlert
 * @description Define el tipo para la inserción de una nueva alerta.
 */
export type InsertAlert = typeof alertsTable.$inferInsert

/**
 * @typedef {typeof alertsTable.$inferSelect} SelectAlert
 * @description Define el tipo para la selección de una alerta existente.
 */
export type SelectAlert = typeof alertsTable.$inferSelect
