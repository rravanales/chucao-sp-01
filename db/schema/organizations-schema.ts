/**
 * @file db/schema/organizations-schema.ts
 * @brief Define el esquema de base de datos para las organizaciones en DeltaOne.
 * @description Esta tabla almacena la estructura jerárquica de las organizaciones,
 * permitiendo el seguimiento del rendimiento a diferentes niveles.
 * Se incluyen referencias para jerarquía padre-hijo, plantillas y borrado en cascada.
 */

import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"

/**
 * @constant organizationsTable
 * @description Definición de la tabla `organizations`, que representa las unidades organizacionales
 * dentro de la plataforma DeltaOne. Incluye jerarquía N-niveles mediante un campo `parentId`.
 * La clave foránea autorelacionada se define en la sección de "extra config"
 * para habilitar `ON DELETE CASCADE` sin provocar errores de tipos en TypeScript.
 */
export const organizationsTable = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Identificador único de la organización
    name: text("name").notNull(), // Nombre de la organización
    description: text("description"), // Descripción opcional de la organización
    parentId: uuid("parent_id"), // Campo FK autorelacionada (la restricción se define abajo)
    templateFromDatasetField: text("template_from_dataset_field"), // Si fue creada por plantilla y de qué campo (opcional)
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  /**
   * @description Extra config: definición de la restricción de clave foránea autorelacionada
   * con eliminación en cascada para mantener la integridad referencial.
   * Se define aquí (y no en la columna) para evitar autoreferencia en el inicializador
   * que dispara los errores TS7022/TS7024.
   */
  org => [
    foreignKey({
      columns: [org.parentId],
      foreignColumns: [org.id],
      name: "organizations_parent_id_fkey"
    })
      .onDelete("cascade")
      .onUpdate("cascade")
  ]
)

/**
 * @constant organizationsRelations
 * @description Relaciones 1:N (parent → children) para navegar la jerarquía.
 * `relations` es solo para navegación en consultas; las reglas de integridad están en la tabla.
 */
export const organizationsRelations = relations(
  organizationsTable,
  ({ one, many }) => ({
    parent: one(organizationsTable, {
      fields: [organizationsTable.parentId],
      references: [organizationsTable.id],
      relationName: "parent"
    }),
    children: many(organizationsTable, {
      relationName: "parent"
    })
  })
)

/**
 * @typedef {typeof organizationsTable.$inferInsert} InsertOrganization
 * @description Tipo para la inserción de una nueva organización.
 */
export type InsertOrganization = typeof organizationsTable.$inferInsert

/**
 * @typedef {typeof organizationsTable.$inferSelect} SelectOrganization
 * @description Tipo para la selección de una organización existente.
 */
export type SelectOrganization = typeof organizationsTable.$inferSelect
