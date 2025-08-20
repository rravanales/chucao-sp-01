/**
 * @file db/schema/app-settings-schema.ts
 * @brief Define el esquema de base de datos para la configuración de la aplicación en DeltaOne.
 * @description Esta tabla almacena configuraciones globales de la aplicación que pueden ser
 * modificadas por los administradores (ej., terminología personalizada, activación de funcionalidades).
 */

import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core"

/**
 * @enum appSettingTypeEnum
 * @description Define los tipos de configuración de la aplicación.
 */
export const appSettingTypeEnum = pgEnum("app_setting_type", [
  "terminology", // Configuración relacionada con la terminología de la aplicación
  "methodology" // Configuración relacionada con la metodología (ej. Strategy Maps)
])

/**
 * @constant appSettingsTable
 * @description Definición de la tabla app_settings, que almacena pares clave-valor
 * para la configuración global de la aplicación.
 */
export const appSettingsTable = pgTable("app_settings", {
  settingKey: text("setting_key").primaryKey().notNull(), // Clave única para la configuración (ej. 'terminology_measures')
  settingValue: text("setting_value").notNull(), // Valor de la configuración (ej. el término personalizado o 'true'/'false')
  settingType: appSettingTypeEnum("setting_type").notNull(), // Tipo de configuración (ej. 'terminology', 'methodology')
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof appSettingsTable.$inferInsert} InsertAppSetting
 * @description Define el tipo para la inserción de una nueva configuración de aplicación.
 */
export type InsertAppSetting = typeof appSettingsTable.$inferInsert

/**
 * @typedef {typeof appSettingsTable.$inferSelect} SelectAppSetting
 * @description Define el tipo para la selección de una configuración de aplicación existente.
 */
export type SelectAppSetting = typeof appSettingsTable.$inferSelect
