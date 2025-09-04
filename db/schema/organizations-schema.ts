/**
 * @file db/schema/organizations-schema.ts
 * @brief Define el esquema de base de datos para las organizaciones en DeltaOne.
 * @description Esta tabla almacena la estructura jerárquica de las organizaciones,
 * permitiendo el seguimiento del rendimiento a diferentes niveles.
 * Se incluyen referencias para jerarquía padre-hijo, plantillas y borrado en cascada.
 */
import { pgTable, uuid, text, timestamp, foreignKey } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm" // Importar relations para definir las relaciones

/**
 * @constant organizationsTable
 * @description Definición de la tabla organizations, que gestiona la estructura jerárquica de la empresa.
 */
export const organizationsTable = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Identificador único de la organización
    name: text("name").notNull(), // Nombre de la organización
    description: text("description"), // Descripción opcional de la organización
    // Definir la columna sin references() para evitar el ciclo de tipos.
    parentId: uuid("parent_id"), // FK autoreferenciada; la restricción se define en el extra config
    templateFromDatasetField: text("template_from_dataset_field"), // Campo que indica si la organización fue creada a partir de una plantilla y de qué campo de dataset
    createdAt: timestamp("created_at").defaultNow().notNull(), // Marca de tiempo de creación del registro
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Marca de tiempo de última actualización
  },
  // Extra config: aquí definimos la FK autoreferenciada con ON DELETE/UPDATE CASCADE
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
 * @function organizationsRelations
 * @description Define las relaciones para la tabla organizations.
 * Permite acceder a los hijos de una organización (muchos a uno) y al padre (uno a uno).
 */
export const organizationsRelations = relations(
  organizationsTable,
  ({ one, many }) => ({
    parent: one(organizationsTable, {
      fields: [organizationsTable.parentId],
      references: [organizationsTable.id],
      relationName: "parentOrganization"
    }),
    children: many(organizationsTable, {
      relationName: "parentOrganization"
    })
  })
)

/**
 * @typedef {typeof organizationsTable.$inferInsert} InsertOrganization
 * @description Define el tipo para la inserción de una nueva organización.
 */
export type InsertOrganization = typeof organizationsTable.$inferInsert

/**
 * @typedef {typeof organizationsTable.$inferSelect} SelectOrganization
 * @description Define el tipo para la selección de una organización existente.
 */
export type SelectOrganization = typeof organizationsTable.$inferSelect
