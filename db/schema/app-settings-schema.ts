/**
 * @file db/schema/app-settings-schema.ts
 * @brief Define el esquema de base de datos para la configuración de la aplicación en DeltaOne.
 * @description Esta tabla almacena configuraciones globales de la aplicación, como la
 * personalización de la terminología (ej., "Measures" a "KPIs") o la activación
 * de ciertas funcionalidades (ej., Strategy Maps, o requerir notas para KPIs en rojo).
 * Es un mecanismo flexible para almacenar pares clave-valor de configuraciones.
 */

import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core"

/**
 * @enum appSettingTypeEnum
 * @description Define los posibles tipos de configuración de la aplicación,
 * utilizados para categorizar y organizar los ajustes.
 */
export const appSettingTypeEnum = pgEnum("app_setting_type", [
  "terminology",
  "methodology",
  "alert_settings" // Nuevo tipo para configuraciones globales de alertas
])

/**
 * @constant appSettingsTable
 * @description Definición de la tabla app_settings, que almacena configuraciones globales de la aplicación.
 * Utiliza `settingKey` como clave primaria para asegurar la unicidad de cada configuración.
 * Los valores se almacenan como texto para flexibilidad, y `settingType` ayuda en la organización.
 */
export const appSettingsTable = pgTable("app_settings", {
  settingKey: text("setting_key").primaryKey().notNull(), // Clave única de la configuración (ej. 'measure_term', 'strategy_maps_enabled')
  settingValue: text("setting_value").notNull(), // Valor de la configuración (ej. 'KPIs', 'true', 'false')
  settingType: appSettingTypeEnum("setting_type").notNull(), // Tipo de configuración (ej. 'terminology', 'methodology', 'alert_settings')
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de la última actualización
})

/**
 * @typedef {typeof appSettingsTable.$inferInsert} InsertAppSetting
 * @description Define el tipo para la inserción de una nueva configuración de la aplicación.
 */
export type InsertAppSetting = typeof appSettingsTable.$inferInsert

/**
 * @typedef {typeof appSettingsTable.$inferSelect} SelectAppSetting
 * @description Define el tipo para la selección de una configuración de la aplicación existente.
 */
export type SelectAppSetting = typeof appSettingsTable.$inferSelect
