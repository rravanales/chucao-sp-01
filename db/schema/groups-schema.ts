/**
 * @file db/schema/groups-schema.ts
 * @brief Define el esquema de base de datos para los grupos de usuarios en DeltaOne.
 * @description Esta tabla organiza a los usuarios en diferentes grupos (ej. Power Users,
 * Update Users) para facilitar la gestión de permisos basada en roles.
 */

import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core"

/**
 * @enum userGroupTypeEnum
 * @description Define los tipos predefinidos de grupos de usuarios con diferentes niveles de acceso base.
 */
export const userGroupTypeEnum = pgEnum("user_group_type", [
  "Power User", // Acceso completo de administración
  "Update User", // Permisos para actualizar valores de KPI
  "Interactive User", // Permisos para visualizar datos e interactuar (ej., notas)
  "View Only" // Solo permisos de visualización
])

/**
 * @constant groupsTable
 * @description Definición de la tabla groups, que almacena la información de los grupos de usuarios.
 */
export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(), // Identificador único del grupo
  name: text("name").notNull().unique(), // Nombre único del grupo para fácil identificación
  groupType: userGroupTypeEnum("group_type").notNull(), // Tipo de grupo (ej. 'Power User', 'View Only')
  createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
})

/**
 * @typedef {typeof groupsTable.$inferInsert} InsertGroup
 * @description Define el tipo para la inserción de un nuevo grupo.
 */
export type InsertGroup = typeof groupsTable.$inferInsert

/**
 * @typedef {typeof groupsTable.$inferSelect} SelectGroup
 * @description Define el tipo para la selección de un grupo existente.
 */
export type SelectGroup = typeof groupsTable.$inferSelect
