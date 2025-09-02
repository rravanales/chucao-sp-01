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
import {
  InsertProfile,
  SelectProfile,
  groupMembersTable,
  profilesTable,
} from "@/db/schema";
import { ActionState, fail, ok } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { eq, inArray, and } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { SelectGroup, groupsTable, InsertGroupMember } from "@/db/schema"; // Import groupsTable, SelectGroup, and InsertGroupMember

const logger = getLogger("profiles-actions");

/**
 * Helper para obtener el primer elemento de un array o undefined.
 * @template T El tipo de los elementos en el array.
 * @param {Promise<T[]>} q La promesa que resuelve en un array de elementos.
 * @returns {Promise<T | undefined>} El primer elemento del array o undefined si el array está vacío.
 */
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                              Esquemas de Validación Zod                          */
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
  name: z.string().max(255, "El nombre no puede exceder 255 caracteres.").nullable().optional(),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

/**
 * @schema getProfileByUserIdSchema
 * @description Esquema de validación para obtener un perfil por su `userId`.
 * @property {string} userId - ID del usuario, UUID requerido.
 */
const getProfileByUserIdSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

/**
 * @schema deleteProfileSchema
 * @description Esquema de validación para la eliminación de un perfil.
 * @property {string} userId - ID del usuario, UUID requerido.
 */
const deleteProfileSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
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
  if (!currentAuthUserId && !data.userId) { // If no current user and no userId in data, then unauthorized
    logger.warn("Unauthorized attempt to create/sync DeltaOne user profile.");
    return fail("No autorizado. Debe iniciar sesión o la acción debe ser invocada con un ID de usuario válido.");
  }
  
  // Use data.userId if provided, otherwise currentAuthUserId
  const actualUserId = data.userId || currentAuthUserId;
  if (!actualUserId) {
    return fail("No se pudo determinar el ID de usuario para crear/sincronizar el perfil.");
  }

  const validatedData = createDeltaOneUserSchema.safeParse({ ...data, userId: actualUserId });
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
      profile = existingProfile;
      // Update email if provided and different
      if (email !== undefined && email !== null && profile.email !== email) {
        const [updatedProfile] = await db.update(profilesTable)
          .set({ email, updatedAt: new Date() })
          .where(eq(profilesTable.userId, userId))
          .returning();
        profile = updatedProfile;
        logger.info(`Profile email updated for user ${userId}.`);
      } else if (email === null && profile.email !== null) { // If email is explicitly set to null
        const [updatedProfile] = await db.update(profilesTable)
          .set({ email: null, updatedAt: new Date() })
          .where(eq(profilesTable.userId, userId))
          .returning();
        profile = updatedProfile;
        logger.info(`Profile email cleared for user ${userId}.`);
      }
      logger.info(`Profile already exists for user ${userId}.`);
    } else {
      // Create new profile
      const [newProfile] = await db
        .insert(profilesTable)
        .values({
          userId: userId,
          email: email ?? null,
          membership: "free", // Default membership
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      profile = newProfile;
      logger.info(`Profile created for user ${userId}.`);
    }

    // Assign to groups if provided. This logic is simple; a more complex system might diff changes.
    // For bulk import, it's safer to clear and re-add if groupIds are provided.
    if (groupIds && groupIds.length > 0) {
      // Fetch current group memberships
      const currentGroupMemberships = await db
        .select()
        .from(groupMembersTable)
        .where(eq(groupMembersTable.userId, userId));
      const currentGroupIds = new Set(currentGroupMemberships.map(gm => gm.groupId));

      const groupIdsToAdd = groupIds.filter(id => !currentGroupIds.has(id));
      const groupIdsToRemove = [...currentGroupIds].filter(id => !groupIds.includes(id));

      // Remove groups
      if (groupIdsToRemove.length > 0) {
        await db
          .delete(groupMembersTable)
          .where(
            and(
              eq(groupMembersTable.userId, userId),
              inArray(groupMembersTable.groupId, groupIdsToRemove)
            )
          );
        logger.info(`User ${userId} removed from groups: ${groupIdsToRemove.join(", ")}`);
      }

      // Add new groups
      if (groupIdsToAdd.length > 0) {
        const newGroupMembers: InsertGroupMember[] = groupIdsToAdd.map((groupId) => ({
          groupId: groupId,
          userId: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        await db.insert(groupMembersTable).values(newGroupMembers);
        logger.info(`User ${userId} added to groups: ${groupIdsToAdd.join(", ")}`);
      }
    }

    return ok("Usuario de DeltaOne registrado/actualizado exitosamente.", profile);
  } catch (error) {
    logger.error(
      `Error creating/updating DeltaOne user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId, groupIds, email },
    );
    return fail(`Fallo al registrar/actualizar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
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
  if (!currentAuthUserId && userId === undefined) { // If no current user and no userId in data, then unauthorized
    logger.warn("Unauthorized attempt to retrieve user profile without specific ID.");
    return fail("No autorizado. Debe iniciar sesión o proporcionar un ID de usuario válido.");
  }
  // If a userId is passed, assume authorization logic is handled by the caller or it's a system call.
  // If no userId is passed, default to the authenticated user's ID.
  const targetUserId = userId || currentAuthUserId;
  if (!targetUserId) {
    return fail("No se pudo determinar el ID de usuario para obtener el perfil.");
  }

  const validatedData = getProfileByUserIdSchema.safeParse({ userId: targetUserId });
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getProfileByUserIdAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const profile = await firstOrUndefined(
      db.select().from(profilesTable).where(eq(profilesTable.userId, validatedData.data.userId)),
    );

    if (!profile) {
      return fail("Perfil de usuario no encontrado.");
    }

    logger.info(`Profile retrieved successfully for user: ${profile.userId}`);
    return ok("Perfil de usuario obtenido exitosamente.", profile);
  } catch (error) {
    logger.error(
      `Error retrieving user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId: targetUserId },
    );
    return fail(`Fallo al obtener el perfil de usuario: ${error instanceof Error ? error.message : String(error)}`);
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

  const validatedData = deleteProfileSchema.safeParse({ userId });
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteProfileAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [deletedProfile] = await db
      .delete(profilesTable)
      .where(eq(profilesTable.userId, validatedData.data.userId))
      .returning();

    if (!deletedProfile) {
      return fail("Perfil de usuario no encontrado.");
    }

    logger.info(`Profile deleted successfully for user: ${deletedProfile.userId}`);
    return ok("Perfil eliminado exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error deleting user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId },
    );
    return fail(`Fallo al eliminar el perfil de usuario: ${error instanceof Error ? error.message : String(error)}`);
  }
}