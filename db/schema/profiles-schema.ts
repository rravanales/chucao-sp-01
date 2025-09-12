/**
 * @file db/schema/profiles-schema.ts
 * @brief Define el esquema de base de datos para los perfiles de usuario.
 * @description Esta tabla extiende los datos del usuario provenientes de Clerk,
 * incorporando información sobre el nivel de membresía, detalles de suscripción a través de Stripe,
 * y fechas relevantes de creación y actualización del perfil.
 */

import { pgTable, text, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core"

/**
 * @enum membershipEnum
 * @description Define los tipos de membresía de usuario.
 */
export const membershipEnum = pgEnum("membership", ["free", "pro"])

/**
 * @constant profilesTable
 * @description Definición de la tabla `profiles`, que extiende los datos del usuario de Clerk
 * con información de membresía y detalles de suscripción.
 */
export const profilesTable = pgTable("profiles", {
  userId: text("user_id").primaryKey().notNull(), // ID de usuario de Clerk
  email: text("email"), // Correo electrónico del usuario, para notificaciones. Puede ser nulo si se obtiene de Clerk directamente.
  membership: membershipEnum("membership").notNull().default("free"), // Nivel de membresía del usuario
  stripeCustomerId: text("stripe_customer_id"), // ID de cliente de Stripe para la gestión de pagos
  stripeSubscriptionId: text("stripe_subscription_id"), // ID de suscripción de Stripe
  isActive: boolean("is_active").notNull().default(true), // Indica si el usuario está activo o desactivado
  createdAt: timestamp("created_at").defaultNow().notNull(), // Fecha de creación del perfil
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()) // Fecha de última actualización
})

/**
 * @typedef {typeof profilesTable.$inferInsert} InsertProfile
 * @description Define el tipo para la inserción de un nuevo perfil.
 */
export type InsertProfile = typeof profilesTable.$inferInsert

/**
 * @typedef {typeof profilesTable.$inferSelect} SelectProfile
 * @description Define el tipo para la selección de un perfil existente.
 */
export type SelectProfile = typeof profilesTable.$inferSelect
