/**
 * @file actions/db/profiles-actions.ts
 * @brief Server Actions para la gestión de perfiles de usuario en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear,
 * leer y eliminar perfiles de usuario en la base de datos local. Estos perfiles
 * complementan la información de usuario de Clerk con datos específicos de la aplicación,
 * como la membresía y los IDs de suscripción/cliente de Stripe.
 * Las funciones aseguran la autenticación del usuario y la validación de los datos de entrada.
 */
"use server";

import { db } from "@/db/db";
import { profilesTable, SelectProfile, InsertProfile } from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { groupMembersTable } from "@/db/schema/group-members-schema"; // Importar tabla de miembros de grupo
import { groupsTable } from "@/db/schema/groups-schema"; // Importar tabla de grupos
import { relations } from "drizzle-orm"; // Importar relations

export type { InsertProfile, SelectProfile } from "@/db/schema"; 

const logger = getLogger("profiles-actions");

// Helper para obtener el primer elemento de un array o undefined
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                               Zod Schemas                                  */
/* -------------------------------------------------------------------------- */

/**
 * @schema createDeltaOneUserSchema
 * @description Esquema de validación para la integración de un nuevo usuario de Clerk en DeltaOne.
 * Este esquema asume que el userId ya existe en Clerk.
 * @property {string} userId - ID del usuario de Clerk, requerido.
 * @property {string} [email] - Email del usuario, opcional.
 * @property {string} [name] - Nombre del usuario, opcional (para futuras extensiones).
 * @property {string[]} [groupIds] - IDs de los grupos a los que se asignará el usuario, opcional.
 */
const createDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  email: z.string().email("Formato de email inválido.").nullable().optional(),
  name: z
    .string()
    .max(255, "El nombre no puede exceder 255 caracteres.")
    .nullable()
    .optional(),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

/* -------------------------------------------------------------------------- */
/*                                  Server Actions                            */
/* -------------------------------------------------------------------------- */

/**
 * @function createDeltaOneUserAction
 * @description Registra un usuario de Clerk existente en el sistema DeltaOne,
 * creando un perfil local si no existe y asignándolo a grupos. Esta acción es robusta
 * y puede ser usada para sincronizar usuarios desde Clerk o para una importación masiva.
 * @param {z.infer<typeof createDeltaOneUserSchema>} data - Datos del usuario para registrar/actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil del usuario o un mensaje de error.
 * @notes
 * Esta acción asume que el usuario ya existe en Clerk o será creado por otro flujo de Clerk.
 * Si profilesTable tuviera campos como name, se deberían actualizar aquí.
 */
export async function createDeltaOneUserAction(
  data: z.infer<typeof createDeltaOneUserSchema>,
): Promise<ActionState<SelectProfile>> {
  // Authentication check is optional here, as this action might be called by system processes (e.g., Clerk webhook, bulk import action)
  // If called directly by a user, auth should be handled by the caller action or middleware.
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId && !data.userId) {
    // If no current user and no userId in data, then unauthorized
    logger.warn("Unauthorized attempt to create/sync DeltaOne user profile.");
    return fail(
      "No autorizado. Debe iniciar sesión o la acción debe ser invocada con un ID de usuario válido.",
    );
  }

  const validatedData = createDeltaOneUserSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for createDeltaOneUserAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { userId, groupIds, email } = validatedData.data;

  try {
    const existingProfile = await firstOrUndefined(
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    );

    let profile: SelectProfile;

    if (existingProfile) {
      // Si el perfil existe, actualiza los campos si son diferentes
      const updatePayload: Partial<InsertProfile> = { updatedAt: new Date() };
      if (email && existingProfile.email !== email) {
        updatePayload.email = email;
      }

      // Solo actualizar si hay cambios
      if (Object.keys(updatePayload).length > 1) {
        const [updatedProfile] = await db
          .update(profilesTable)
          .set(updatePayload)
          .where(eq(profilesTable.userId, userId))
          .returning();
        profile = updatedProfile;
      } else {
        profile = existingProfile;
      }

      logger.info(`DeltaOne user profile updated: ${userId}`);
    } else {
      // Si el perfil no existe, créalo
      const [newProfile] = await db
        .insert(profilesTable)
        .values({
          userId: userId,
          email: email,
          // membership y stripe_customer_id/subscription_id tienen defaults o se manejan por otros flujos
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      profile = newProfile;
      logger.info(`DeltaOne user profile created: ${userId}`);
    }

    // Gestionar la asignación de grupos si se proporcionan groupIds
    if (groupIds && groupIds.length > 0) {
      // Eliminar asignaciones existentes para este usuario y luego insertar las nuevas
      await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));

      const newGroupMemberships = groupIds.map((groupId) => ({
        groupId: groupId,
        userId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      await db.insert(groupMembersTable).values(newGroupMemberships);
      logger.info(`User ${userId} assigned to groups: ${groupIds.join(", ")}`);
    }

    return ok("Usuario de DeltaOne registrado/actualizado exitosamente.", profile);
  } catch (error) {
    logger.error(
      `Error creating/updating DeltaOne user profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { userId, groupIds, email },
    );
    return fail(
      `Fallo al registrar/actualizar el usuario de DeltaOne: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * @function getProfileByUserIdAction
 * @description Obtiene el perfil de un usuario específico por su ID de usuario.
 * @param {string} userId - El ID del usuario cuyo perfil se desea obtener.
 * @returns {Promise<ActionState<SelectProfile>>} Un objeto ActionState con el perfil encontrado o un mensaje de error.
 */
export async function getProfileByUserIdAction(
  userId: string,
): Promise<ActionState<SelectProfile>> {
  // Authentication check is optional here, as this action might be called by system processes (e.g., Clerk webhook, bulk import action)
  // Or by a user getting their OWN profile, in which case the caller ensures userId == currentAuthUserId
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId && userId === undefined) {
    // If no current user and no userId in data, then unauthorized
    logger.warn("Unauthorized attempt to retrieve user profile without specific ID.");
    return fail("No autorizado. Debe iniciar sesión o proporcionar un ID de usuario válido.");
  }

  // If a userId is passed, assume authorization logic is handled by the caller or it's a system call.
  // If no userId is passed, default to the authenticated user's ID.
  const targetUserId = userId || currentAuthUserId;
  if (!targetUserId) {
    return fail("No se pudo determinar el ID de usuario para obtener el perfil.");
  }

  try {
    const profileData = await firstOrUndefined(
      db.select().from(profilesTable).where(eq(profilesTable.userId, targetUserId)),
    );

    if (!profileData) {
      logger.warn(`Profile not found for user ID: ${targetUserId}`);
      return fail("Perfil de usuario no encontrado.");
    }

    // Obtener los grupos a los que pertenece el usuario
    const userGroups = await db
      .select({
        id: groupsTable.id,
        name: groupsTable.name,
        groupType: groupsTable.groupType,
      })
      .from(groupsTable)
      .innerJoin(groupMembersTable, eq(groupsTable.id, groupMembersTable.groupId))
      .where(eq(groupMembersTable.userId, targetUserId));

    return ok("Usuario de DeltaOne obtenido exitosamente.", { ...profileData, groups: userGroups });
  } catch (error) {
    logger.error(
      `Error retrieving user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId: targetUserId },
    );
    return fail(
      `Fallo al obtener el perfil de usuario: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * @function deleteProfileAction
 * @description Elimina el perfil de un usuario de la base de datos.
 * @param {string} userId - El ID del usuario cuyo perfil se desea eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function deleteProfileAction(userId: string): Promise<ActionState<undefined>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to delete user profile.");
    return fail("No autorizado. Debe iniciar sesión.");
  }
  // In a real application, implement robust authorization checks here
  // e.g., only an admin or the user themselves can delete their profile

  try {
    const [deletedProfile] = await db
      .delete(profilesTable)
      .where(eq(profilesTable.userId, userId))
      .returning();

    if (!deletedProfile) {
      return fail("Perfil de usuario no encontrado o ya eliminado.");
    }

    logger.info(`User profile deleted: ${userId}`);
    return ok("Perfil de usuario eliminado exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId },
    );
    return fail(
      `Fallo al eliminar el perfil de usuario: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * @function getAllProfilesAction
 * @description Obtiene una lista de todos los perfiles de usuario en la base de datos.
 * Verifica la autenticación del usuario.
 * @returns {Promise<ActionState<SelectProfile[]>>} Un objeto ActionState con la lista de perfiles o un mensaje de error.
 */
export async function getAllProfilesAction(): Promise<ActionState<SelectProfile[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve all user profiles.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const profiles = await db.select().from(profilesTable);
    return ok("Perfiles obtenidos exitosamente.", profiles);
  } catch (error) {
    logger.error(
      `Error retrieving all user profiles: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail(`Fallo al obtener los perfiles de usuario: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                Backwards-compat actions esperadas por otros módulos        */
/* -------------------------------------------------------------------------- */

/** @deprecated Usa createDeltaOneUserAction o getOrCreateProfileAction */
export async function createProfileAction(
  data: InsertProfile
): Promise<ActionState<SelectProfile>> {
  try {
    const [newProfile] = await db
      .insert(profilesTable)
      .values({
        ...data,
        createdAt: (data as any)?.createdAt ?? new Date(),
        updatedAt: (data as any)?.updatedAt ?? new Date(),
      })
      .returning();

    if (!newProfile) return fail("No se pudo crear el perfil.");

    logger.info(`Profile created successfully for user: ${newProfile.userId}`);
    return ok("Profile created successfully", newProfile);
  } catch (error) {
    logger.error(
      `Error creating profile: ${error instanceof Error ? error.message : String(error)}`
    );
    return fail("Failed to create profile");
  }
}

/** @deprecated Usada por módulos antiguos, reemplazar por flows de sincronización */
export async function updateProfileAction(
  userId: string,
  data: Partial<InsertProfile>
): Promise<ActionState<SelectProfile>> {
  try {
    const [updatedProfile] = await db
      .update(profilesTable)
      .set({ ...data, updatedAt: new Date() } as Partial<InsertProfile>)
      .where(eq(profilesTable.userId, userId))
      .returning();

    if (!updatedProfile) return fail("Profile not found to update");

    logger.info(`Profile updated successfully for user: ${userId}`);
    return ok("Profile updated successfully", updatedProfile);
  } catch (error) {
    logger.error(
      `Error updating profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId }
    );
    return fail("Failed to update profile");
  }
}

/** @deprecated Usada en stripe-actions.ts para mantener compatibilidad */
export async function updateProfileByStripeCustomerIdAction(
  stripeCustomerId: string,
  data: Partial<InsertProfile>
): Promise<ActionState<SelectProfile>> {
  try {
    const [updatedProfile] = await db
      .update(profilesTable)
      .set({ ...data, updatedAt: new Date() } as Partial<InsertProfile>)
      .where(eq(profilesTable.stripeCustomerId, stripeCustomerId))
      .returning();

    if (!updatedProfile) return fail("Profile not found by Stripe customer ID");

    logger.info(`Profile updated by Stripe customer ID successfully: ${stripeCustomerId}`);
    return ok("Profile updated by Stripe customer ID successfully", updatedProfile);
  } catch (error) {
    logger.error(
      `Error updating profile by stripe customer ID: ${error instanceof Error ? error.message : String(error)}`,
      { stripeCustomerId }
    );
    return fail("Failed to update profile by Stripe customer ID");
  }
}

/* ----------------------- Helpers adicionales opcionales ------------------- */

/** Compat getter por stripeCustomerId */
export async function getProfileByStripeCustomerIdAction(
  stripeCustomerId: string
): Promise<ActionState<SelectProfile>> {
  try {
    const rows = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.stripeCustomerId, stripeCustomerId));
    const profile = rows?.[0];
    if (!profile) {
      return fail("Profile not found by Stripe customer ID");
    }
    return ok("Profile retrieved successfully", profile);
  } catch (error) {
    return fail(
      `Failed to get profile by Stripe customer ID: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** Compat get-or-create usado por algunos módulos antiguos */
export async function getOrCreateProfileAction(
  userId: string,
  patch?: Partial<InsertProfile>
): Promise<ActionState<SelectProfile>> {
  try {
    const existing = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, userId));
    if (existing?.[0]) {
      if (patch && Object.keys(patch).length > 0) {
        const [updated] = await db
          .update(profilesTable)
          .set({ ...patch, updatedAt: new Date() } as Partial<InsertProfile>)
          .where(eq(profilesTable.userId, userId))
          .returning();
        return ok("Profile updated successfully", updated);
      }
      return ok("Profile retrieved successfully", existing[0]);
    }
    const [created] = await db
      .insert(profilesTable)
      .values({
        userId,
        ...patch,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as InsertProfile)
      .returning();
    return ok("Profile created successfully", created);
  } catch (error) {
    return fail(
      `Failed to get or create profile: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}