/**
 * @file db/schema/scorecard-elements-schema.ts
 * @brief Define el esquema de base de datos para los elementos del Scorecard en DeltaOne.
 * @description Esta tabla almacena la estructura jerárquica de las métricas de rendimiento y la estrategia,
 * incluyendo perspectivas, objetivos, iniciativas y KPIs.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  decimal,
  integer,
  foreignKey
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { profilesTable } from "./profiles-schema" // Tabla de perfiles (propietarios)
import { organizationsTable } from "./organizations-schema" // Tabla de organizaciones (pertenencia)

/**
 * @enum scorecardElementTypeEnum
 * @description Enumera los tipos posibles de elementos dentro de un Scorecard.
 */
export const scorecardElementTypeEnum = pgEnum("scorecard_element_type", [
  "Perspective", // Perspectivas de Balanced Scorecard
  "Objective", // Objetivos estratégicos
  "Initiative", // Iniciativas o proyectos
  "KPI" // Indicadores Clave de Rendimiento
])

/**
 * @constant scorecardElementsTable
 * @description Definición de la tabla `scorecard_elements`, que representa los nodos del árbol de estrategia:
 * perspectivas, objetivos, iniciativas y KPIs. Incluye jerarquía N-niveles mediante `parentId`.
 * La clave foránea autorelacionada (parent → children) se define en la sección de "extra config" con
 * `ON DELETE CASCADE` para evitar errores de tipos y mantener integridad referencial.
 */
export const scorecardElementsTable = pgTable(
  "scorecard_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(), // Identificador único del elemento del Scorecard
    name: text("name").notNull(), // Nombre del elemento
    description: text("description"), // Descripción opcional
    parentId: uuid("parent_id"), // Campo FK autorelacionada (restricción abajo)
    organizationId: uuid("organization_id").notNull(), // FK a la organización (restricción abajo)
    elementType: scorecardElementTypeEnum("element_type").notNull(), // Tipo de elemento
    ownerUserId: text("owner_user_id"), // FK al usuario propietario (puede ser nulo) (restricción abajo)
    weight: decimal("weight").default("1.0").notNull(), // Ponderación para cálculo agregado del padre
    orderIndex: integer("order_index").notNull().default(0), // Orden en la UI
    createdAt: timestamp("created_at").defaultNow().notNull(), // Creación
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()) // Última actualización
  },
  /**
   * @description Extra config: definición de claves foráneas con sus políticas de integridad.
   * - `parentFk`: autorelación (árbol) con borrado en cascada.
   * - `organizationFk`: pertenencia a organización con borrado en cascada.
   * - `ownerUserFk`: propietario; si el usuario se elimina, se setea a NULL.
   * Definir aquí evita autoreferencias en el inicializador y los errores TS7022/TS7024.
   */
  t => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "scorecard_elements_parent_id_fkey"
    })
      .onDelete("cascade")
      .onUpdate("cascade"),

    foreignKey({
      columns: [t.organizationId],
      foreignColumns: [organizationsTable.id],
      name: "scorecard_elements_organization_id_fkey"
    })
      .onDelete("cascade")
      .onUpdate("cascade"),

    foreignKey({
      columns: [t.ownerUserId],
      foreignColumns: [profilesTable.userId],
      name: "scorecard_elements_owner_user_id_fkey"
    })
      .onDelete("set null")
      .onUpdate("cascade")
  ]
)

/**
 * @constant scorecardElementsRelations
 * @description Relaciones para navegar:
 * - Autorelación 1:N (parent → children)
 * - N:1 con organizations
 * - N:1 con profiles (propietario)
 */
export const scorecardElementsRelations = relations(
  scorecardElementsTable,
  ({ one, many }) => ({
    parent: one(scorecardElementsTable, {
      fields: [scorecardElementsTable.parentId],
      references: [scorecardElementsTable.id],
      relationName: "parent"
    }),
    children: many(scorecardElementsTable, {
      relationName: "parent"
    }),
    organization: one(organizationsTable, {
      fields: [scorecardElementsTable.organizationId],
      references: [organizationsTable.id]
    }),
    owner: one(profilesTable, {
      fields: [scorecardElementsTable.ownerUserId],
      references: [profilesTable.userId]
    })
  })
)

/**
 * @typedef {typeof scorecardElementsTable.$inferInsert} InsertScorecardElement
 * @description Define el tipo para la inserción de un nuevo elemento de Scorecard.
 */
export type InsertScorecardElement = typeof scorecardElementsTable.$inferInsert

/**
 * @typedef {typeof scorecardElementsTable.$inferSelect} SelectScorecardElement
 * @description Define el tipo para la selección de un elemento de Scorecard existente.
 */
export type SelectScorecardElement = typeof scorecardElementsTable.$inferSelect
