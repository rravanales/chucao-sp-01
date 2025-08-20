/**
 * @file db/schema/group-members-schema.ts
 * @brief Define el esquema de base de datos para la tabla de unión entre usuarios y grupos en DeltaOne.
 * @description Esta tabla gestiona la pertenencia de los usuarios a diferentes grupos,
 * lo cual es fundamental para el sistema de permisos basado en roles.
 */

import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core"
import { groupsTable } from "./groups-schema" // Importar la tabla de grupos
import { profilesTable } from "./profiles-schema" // Importar la tabla de perfiles

/**
 * @constant groupMembersTable
 * @description Definición de la tabla group_members, una tabla de unión que asocia
 * usuarios con los grupos a los que pertenecen.
 */
export const groupMembersTable = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .references(() => groupsTable.id, { onDelete: "cascade" })
      .notNull(), // FK al grupo
    userId: text("user_id")
      .references(() => profilesTable.userId, { onDelete: "cascade" })
      .notNull(), // FK al usuario
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  table => {
    return [
      // Clave primaria compuesta para asegurar que un usuario solo pueda pertenecer una vez a un grupo específico
      primaryKey({ columns: [table.groupId, table.userId] })
    ]
  }
)

/**
 * @typedef {typeof groupMembersTable.$inferInsert} InsertGroupMember
 * @description Define el tipo para la inserción de un nuevo miembro de grupo.
 */
export type InsertGroupMember = typeof groupMembersTable.$inferInsert

/**
 * @typedef {typeof groupMembersTable.$inferSelect} SelectGroupMember
 * @description Define el tipo para la selección de un miembro de grupo existente.
 */
export type SelectGroupMember = typeof groupMembersTable.$inferSelect
