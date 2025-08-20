/**
 * @file db/schema/group-permissions-schema.ts
 * @brief Define el esquema de base de datos para los permisos asignados a grupos en DeltaOne.
 * @description Esta tabla permite la asignación granular de permisos a grupos,
 * incluyendo permisos a nivel de organización para un control de acceso escalable.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  primaryKey
} from "drizzle-orm/pg-core"
import { groupsTable } from "./groups-schema" // Importar la tabla de grupos
import { organizationsTable } from "./organizations-schema" // Importar la tabla de organizaciones

/**
 * @constant groupPermissionsTable
 * @description Definición de la tabla group_permissions, que asocia grupos con permisos específicos.
 * Permite definir permisos globales o permisos específicos para una organización.
 */
export const groupPermissionsTable = pgTable(
  "group_permissions",
  {
    groupId: uuid("group_id")
      .references(() => groupsTable.id, { onDelete: "cascade" })
      .notNull(), // FK al grupo al que se le asigna el permiso
    permissionKey: text("permission_key").notNull(), // Clave del permiso (ej. 'can_manage_scorecards', 'can_import_data')
    permissionValue: boolean("permission_value").default(false).notNull(), // Valor del permiso (true para permitido, false para denegado/no establecido)
    organizationId: uuid("organization_id").references(
      () => organizationsTable.id,
      { onDelete: "cascade" }
    ), // FK a la organización si el permiso es específico de una (nullable para permisos globales)
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  table => {
    return [
      // Clave primaria compuesta para asegurar la unicidad de un permiso para un grupo en un contexto organizacional dado.
      // Si organizationId es nulo, se considera un permiso global.
      primaryKey({
        columns: [table.groupId, table.permissionKey, table.organizationId]
      })
    ]
  }
)

/**
 * @typedef {typeof groupPermissionsTable.$inferInsert} InsertGroupPermission
 * @description Define el tipo para la inserción de un nuevo permiso de grupo.
 */
export type InsertGroupPermission = typeof groupPermissionsTable.$inferInsert

/**
 * @typedef {typeof groupPermissionsTable.$inferSelect} SelectGroupPermission
 * @description Define el tipo para la selección de un permiso de grupo existente.
 */
export type SelectGroupPermission = typeof groupPermissionsTable.$inferSelect
