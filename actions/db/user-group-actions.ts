/**
 * @file actions/db/user-group-actions.ts
 * @brief Implementa Server Actions para la gestión de usuarios y grupos en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para gestionar
 * la creación, recuperación, actualización y eliminación de grupos de usuarios,
 * la asignación de miembros a estos grupos, y la gestión de permisos asociados a ellos.
 * También incluye acciones para la gestión del perfil local de los usuarios (profilesTable)
 * y la integración con el sistema de autenticación de Clerk a un nivel conceptual.
 */

"use server";

import { db } from "@/db/db";
import {
  InsertGroup,
  InsertGroupMember,
  InsertGroupPermission,
  SelectGroup,
  SelectGroupMember,
  SelectGroupPermission,
  groupMembersTable,
  groupPermissionsTable,
  groupsTable,
  userGroupTypeEnum,
} from "@/db/schema";
import { SelectProfile, profilesTable } from "@/db/schema/profiles-schema";
import { ActionState, fail, ok } from "@/types";
// Clerk: en este proyecto (v6.11.2) usa clerkClient de @clerk/nextjs/server
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
// import { createDeltaOneUserAction } from "./profiles-actions"; // Assuming this is where createDeltaOneUserAction is for initial profile creation
import crypto from "crypto"; // For generating random passwords

const logger = getLogger("user-group-actions");

// Helper para obtener el primer elemento de un array o undefined
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows?.[0];
}

/* -------------------------------------------------------------------------- */
/*                              Esquemas de Validación Zod                          */
/* -------------------------------------------------------------------------- */

/**
 * @schema createGroupSchema
 * @description Esquema de validación para la creación de un nuevo grupo de usuarios.
 * @property {string} name - Nombre único del grupo, requerido.
 * @property {z.infer<typeof userGroupTypeEnum>} groupType - Tipo de grupo de usuario, requerido.
 */
const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del grupo es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  groupType: z.enum(userGroupTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de grupo de usuario inválido." }),
  }),
});

/**
 * @schema updateGroupSchema
 * @description Esquema de validación para la actualización de un grupo de usuarios existente.
 * Permite la actualización parcial de los campos.
 * @property {string} id - ID del grupo a actualizar, UUID requerido.
 * @property {string} [name] - Nombre único del grupo, opcional.
 * @property {z.infer<typeof userGroupTypeEnum>} [groupType] - Tipo de grupo de usuario, opcional.
 */
const updateGroupSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
  name: z
    .string()
    .min(1, "El nombre del grupo es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres.")
    .optional(),
  groupType: z
    .enum(userGroupTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de grupo de usuario inválido." }),
    })
    .optional(),
});

/**
 * @schema deleteGroupSchema
 * @description Esquema de validación para la eliminación de un grupo de usuarios.
 * @property {string} id - ID del grupo a eliminar, UUID requerido.
 */
const deleteGroupSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
});

/**
 * @schema getGroupByIdSchema
 * @description Esquema de validación para obtener un grupo por su ID.
 * @property {string} id - ID del grupo, UUID requerido.
 */
const getGroupByIdSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
});

/**
 * @schema assignGroupMembersSchema
 * @description Esquema de validación para asignar miembros a un grupo.
 * @property {string} groupId - ID del grupo al que se asignarán los miembros, UUID requerido.
 * @property {string[]} userIds - Array de IDs de usuario a asignar al grupo, requerido.
 */
const assignGroupMembersSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  userIds: z.array(z.string().min(1, "El ID de usuario no puede estar vacío.")),
});

/**
 * @schema GroupPermissionSchema
 * @description Esquema de validación para un objeto de permiso individual.
 * @property {string} permissionKey - Clave del permiso (ej. 'can_manage_scorecards').
 * @property {boolean} permissionValue - Valor del permiso (true/false).
 * @property {string | null} [organizationId] - ID de la organización a la que aplica el permiso (nullable para permisos globales).
 */
const GroupPermissionSchema = z.object({
  permissionKey: z.string().min(1, "La clave de permiso es requerida."),
  permissionValue: z.boolean(),
  organizationId: z.string().uuid("ID de organización inválido.").nullable().optional(),
});

/**
 * @schema assignGroupPermissionsSchema
 * @description Esquema de validación para asignar permisos a un grupo.
 * @property {string} groupId - ID del grupo al que se asignarán los permisos, UUID requerido.
 * @property {z.infer<typeof GroupPermissionSchema>[]} permissions - Array de objetos de permiso, requerido.
 */
const assignGroupPermissionsSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissions: z.array(GroupPermissionSchema),
});

/**
 * @schema createDeltaOneUserSchema
 * @description Esquema de validación para la integración de un nuevo usuario de Clerk en DeltaOne.
 * Este esquema asume que el userId ya existe en Clerk.
 * @property {string} userId - ID del usuario de Clerk, requerido.
 * @property {string} [name] - Nombre del usuario, opcional.
 * @property {string} [email] - Email del usuario, opcional.
 * @property {string[]} [groupIds] - IDs de los grupos a los que se asignará el usuario, opcional.
 */
const createDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  // Campos como name, email, lastName serían manejados principalmente por Clerk,
  // pero pueden ser referenciados o sincronizados si la tabla profiles los tuviera.
  // Para este proyecto, profiles solo tiene userId, membership, stripeCustomerId, stripeSubscriptionId.
  // Se añaden aquí como ejemplo si el perfil local se extendiera.
  name: z.string().max(255, "El nombre no puede exceder 255 caracteres.").optional(),
  email: z.string().email("Formato de email inválido.").optional(),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

/**
 * @schema getDeltaOneUserByIdSchema
 * @description Esquema de validación para obtener un usuario de DeltaOne por su ID.
 * @property {string} userId - ID del usuario, requerido.
 */
const getDeltaOneUserByIdSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

/**
 * @schema updateDeltaOneUserSchema
 * @description Esquema de validación para actualizar la información de un usuario en DeltaOne.
 * @property {string} userId - ID del usuario a actualizar, requerido.
 * @property {string[]} [groupIds] - IDs de los grupos a los que se asignará el usuario, opcional.
 */
const updateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

/**
 * @schema deactivateDeltaOneUserSchema
 * @description Esquema de validación para desactivar un usuario en DeltaOne.
 * @property {string} userId - ID del usuario a desactivar, requerido.
 */
const deactivateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

/**
 * @schema BulkImportUserSchema
 * @description Esquema de validación para la estructura de un usuario en la importación masiva.
 * Incluye campos para la creación y actualización de usuarios en Clerk y DeltaOne.
 * @property {string} email - Correo electrónico del usuario, requerido.
 * @property {string} [firstName] - Nombre del usuario, opcional.
 * @property {string} [lastName] - Apellido del usuario, opcional.
 * @property {string} [password] - Contraseña (para nuevos usuarios o reseteo), opcional.
 * @property {string} [title] - Título del usuario, opcional.
 * @property {string[]} [groupKeys] - Nombres de las claves de los grupos a los que se asignará el usuario, opcional.
 */
const BulkImportUserSchema = z.object({
  email: z.string().email("Formato de email inválido."),
  firstName: z.string().max(255, "El nombre no puede exceder 255 caracteres.").optional(),
  lastName: z.string().max(255, "El apellido no puede exceder 255 caracteres.").optional(),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .optional(), // Opcional para updates
  title: z.string().max(255, "El título no puede exceder 255 caracteres.").optional(),
  groupKeys: z.array(z.string().min(1, "La clave de grupo no puede estar vacía.")).optional(),
});

/**
 * @schema BulkImportUsersPayloadSchema
 * @description Esquema de validación para el payload de importación masiva de usuarios.
 * Es un array de objetos BulkImportUserSchema.
 */
const BulkImportUsersPayloadSchema = z
  .array(BulkImportUserSchema)
  .min(1, "El archivo de importación no puede estar vacío.");

/* -------------------------------------------------------------------------- */
/*                                  Group Actions                             */
/* -------------------------------------------------------------------------- */

/**
 * @function createGroupAction
 * @description Crea un nuevo grupo de usuarios en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Asegura la unicidad del nombre del grupo.
 * @param {Omit<InsertGroup, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos del nuevo grupo.
 * @returns {Promise<ActionState<SelectGroup>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function createGroupAction(
  data: Omit<InsertGroup, "id" | "createdAt" | "updatedAt">,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = createGroupSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for createGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { name, groupType } = validatedData.data;

  try {
    const existingGroup = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.name, name)),
    );

    if (existingGroup) {
      return fail(`Ya existe un grupo con el nombre '${name}'.`);
    }

    const [newGroup] = await db
      .insert(groupsTable)
      .values({
        name,
        groupType,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    logger.info(`Group created successfully: ${newGroup.id}`);
    return ok("Grupo creado exitosamente.", newGroup);
  } catch (error) {
    logger.error(
      `Error creating group: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al crear el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getGroupAction
 * @description Obtiene un grupo específico por su ID.
 * @param {z.infer<typeof getGroupByIdSchema>} data - Objeto con el ID del grupo a recuperar.
 * @returns {Promise<ActionState<SelectGroup>>} Un objeto ActionState con el grupo encontrado o un mensaje de error.
 */
export async function getGroupAction(
  data: z.infer<typeof getGroupByIdSchema>,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = getGroupByIdSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const group = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.id, validatedData.data.id)),
    );

    if (!group) {
      return fail("Grupo no encontrado.");
    }

    logger.info(`Group retrieved successfully: ${group.id}`);
    return ok("Grupo obtenido exitosamente.", group);
  } catch (error) {
    logger.error(
      `Error retrieving group: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al obtener el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getAllGroupsAction
 * @description Obtiene todos los grupos de usuarios del sistema.
 * @returns {Promise<ActionState<SelectGroup[]>>} Un objeto ActionState con la lista de grupos o un mensaje de error.
 */
export async function getAllGroupsAction(): Promise<ActionState<SelectGroup[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve all groups.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const groups = await db.select().from(groupsTable);
    logger.info(`Retrieved ${groups.length} groups.`);
    return ok("Grupos obtenidos exitosamente.", groups);
  } catch (error) {
    logger.error(
      `Error retrieving all groups: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail(`Fallo al obtener todos los grupos: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function updateGroupAction
 * @description Actualiza un grupo de usuarios existente en la base de datos.
 * @param {z.infer<typeof updateGroupSchema>} data - Objeto con los datos para actualizar el grupo.
 * @returns {Promise<ActionState<SelectGroup>>} Un objeto ActionState con el grupo actualizado o un mensaje de error.
 */
export async function updateGroupAction(
  data: z.infer<typeof updateGroupSchema>,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = updateGroupSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { id, name, groupType } = validatedData.data;

  try {
    const existingGroup = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.id, id)),
    );

    if (!existingGroup) {
      return fail("Grupo no encontrado.");
    }

    if (name && name !== existingGroup.name) {
      const nameConflict = await firstOrUndefined(
        db.select().from(groupsTable).where(and(eq(groupsTable.name, name), ne(groupsTable.id, id))),
      );
      if (nameConflict) {
        return fail(`Ya existe otro grupo con el nombre '${name}'.`);
      }
    }

    const [updatedGroup] = await db
      .update(groupsTable)
      .set({
        name,
        groupType,
        updatedAt: new Date(),
      })
      .where(eq(groupsTable.id, id))
      .returning();

    logger.info(`Group updated successfully: ${updatedGroup.id}`);
    return ok("Grupo actualizado exitosamente.", updatedGroup);
  } catch (error) {
    logger.error(
      `Error updating group: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al actualizar el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function deleteGroupAction
 * @description Elimina un grupo de usuarios de la base de datos.
 * @param {z.infer<typeof deleteGroupSchema>} data - Objeto con el ID del grupo a eliminar.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function deleteGroupAction(
  data: z.infer<typeof deleteGroupSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = deleteGroupSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [deletedGroup] = await db
      .delete(groupsTable)
      .where(eq(groupsTable.id, validatedData.data.id))
      .returning({ id: groupsTable.id });

    if (!deletedGroup) {
      return fail("Grupo no encontrado.");
    }

    logger.info(`Group deleted successfully: ${deletedGroup.id}`);
    return ok("Grupo eliminado exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error deleting group: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al eliminar el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function assignGroupMembersAction
 * @description Asigna un conjunto de usuarios a un grupo específico.
 * Sobrescribe las membresías existentes para ese grupo, estableciendo el nuevo conjunto de miembros.
 * @param {z.infer<typeof assignGroupMembersSchema>} data - ID del grupo y array de IDs de usuario.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function assignGroupMembersAction(
  data: z.infer<typeof assignGroupMembersSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to assign group members.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = assignGroupMembersSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for assignGroupMembersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { groupId, userIds } = validatedData.data;

  try {
    // Verify group exists
    const existingGroup = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.id, groupId)),
    );
    if (!existingGroup) {
      return fail("Grupo no encontrado.");
    }

    // Delete existing members for this group
    await db.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));

    // Insert new members
    if (userIds.length > 0) {
      const newGroupMembers: InsertGroupMember[] = userIds.map((memberId) => ({
        groupId: groupId,
        userId: memberId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await db.insert(groupMembersTable).values(newGroupMembers);
    }

    logger.info(`Group members assigned successfully for group: ${groupId}`);
    return ok("Miembros del grupo asignados exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error assigning group members: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al asignar miembros al grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function assignGroupPermissionsAction
 * @description Asigna un conjunto de permisos a un grupo específico.
 * Sobrescribe los permisos existentes para ese grupo y contexto organizacional (si aplica).
 * @param {z.infer<typeof assignGroupPermissionsSchema>} data - ID del grupo y array de objetos de permiso.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function assignGroupPermissionsAction(
  data: z.infer<typeof assignGroupPermissionsSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to assign group permissions.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = assignGroupPermissionsSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for assignGroupPermissionsAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { groupId, permissions } = validatedData.data;

  try {
    // Verify group exists
    const existingGroup = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.id, groupId)),
    );
    if (!existingGroup) {
      return fail("Grupo no encontrado.");
    }

    // Delete existing permissions for this group
    await db.delete(groupPermissionsTable).where(eq(groupPermissionsTable.groupId, groupId));

    // Insert new permissions
    if (permissions.length > 0) {
      const newGroupPermissions: InsertGroupPermission[] = permissions.map((perm) => ({
        groupId: groupId,
        permissionKey: perm.permissionKey,
        permissionValue: perm.permissionValue,
        organizationId: perm.organizationId ?? null, // Ensure null if undefined
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await db.insert(groupPermissionsTable).values(newGroupPermissions);
    }

    logger.info(`Group permissions assigned successfully for group: ${groupId}`);
    return ok("Permisos del grupo asignados exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error assigning group permissions: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo al asignar permisos al grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                                  User Actions                              */
/* -------------------------------------------------------------------------- */

/**
 * @function createDeltaOneUserAction
 * @description Registra un usuario de Clerk existente en el sistema DeltaOne,
 * creando un perfil local si no existe y asignándolo a grupos.
 * @param {z.infer<typeof createDeltaOneUserSchema>} data - Datos del usuario para registrar/actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil del usuario o un mensaje de error.
 * @notes
 * Esta acción asume que el usuario ya existe en Clerk o será creado por otro flujo de Clerk.
 * Si profilesTable tuviera campos como name o email, se deberían actualizar aquí.
 */
export async function createDeltaOneUserAction(
  data: z.infer<typeof createDeltaOneUserSchema>,
): Promise<ActionState<SelectProfile>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to create DeltaOne user.");
    return fail("No autorizado. Debe iniciar sesión.");
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
      profile = existingProfile;
      // Update email if provided and different
      if (email && (profile as any).email !== email) {
        const [updatedProfile] = await db
          .update(profilesTable)
          .set({ ...(profile as any), email, updatedAt: new Date() } as any)      
          .where(eq(profilesTable.userId, userId))
          .returning();
        profile = updatedProfile;
      }
      logger.info(`Profile already exists for user ${userId}.`);
    } else {
      // Create new profile
      const [newProfile] = await db
        .insert(profilesTable)
        .values({
          userId: userId,
          ...(email ? ({ email } as any) : {}),
          membership: "free", // Default membership
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      profile = newProfile;
      logger.info(`Profile created for user ${userId}.`);
    }

    // Assign to groups if provided
    if (groupIds && groupIds.length > 0) {
      // Borra TODAS las membresías del usuario y vuelve a insertar (semántica sobrescribir)
      await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));    

      const newGroupMembers: InsertGroupMember[] = groupIds.map((groupId) => ({
        groupId: groupId,
        userId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await db.insert(groupMembersTable).values(newGroupMembers);
      logger.info(`User ${userId} assigned to groups: ${groupIds.join(", ")}`);
    }

    return ok("Usuario de DeltaOne registrado/actualizado exitosamente.", profile);
  } catch (error) {
    logger.error(
      `Error creating/updating DeltaOne user profile: ${error instanceof Error ? error.message : String(error)}`,
      { userId, groupIds },
    );
    return fail(`Fallo al registrar/actualizar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getDeltaOneUserByIdAction
 * @description Obtiene la información de un usuario de DeltaOne por su ID, incluyendo sus grupos.
 * @param {z.infer<typeof getDeltaOneUserByIdSchema>} data - Objeto con el ID del usuario.
 * @returns {Promise<ActionState<SelectProfile & { groups: SelectGroup[] }>>} Objeto ActionState con el perfil del usuario y sus grupos o un mensaje de error.
 */
export async function getDeltaOneUserByIdAction(
  data: z.infer<typeof getDeltaOneUserByIdSchema>,
): Promise<ActionState<SelectProfile & { groups: SelectGroup[] }>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to retrieve DeltaOne user by ID.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = getDeltaOneUserByIdSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getDeltaOneUserByIdAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { userId } = validatedData.data;

  try {
    // const userWithGroups = await db.query.profilesTable.findFirst({
    // Ojo: nombre de la relación en db.query suele ser 'profiles', no 'profilesTable'
    const userWithGroups = await db.query.profiles.findFirst({    
      where: eq(profilesTable.userId, userId),
      with: {
        groupMembers: {
          with: {
            group: true,
          },
        },
      },
    });

    if (!userWithGroups) {
      return fail("Usuario de DeltaOne no encontrado.");
    }

    // Evita 'never' en TS: toma groupMembers de forma segura y tipa al map
    const { groupMembers, ...profileData } = userWithGroups as any;
    const userGroups: SelectGroup[] = (groupMembers ?? []).map(
      (gm: { group: SelectGroup }) => gm.group
    );    

    logger.info(`DeltaOne user ${userId} retrieved successfully.`);
    return {
      isSuccess: true,
      message: "Usuario de DeltaOne obtenido exitosamente.",
      data: { ...profileData, groups: userGroups }
    };
  } catch (error) {
    logger.error(
      `Error retrieving DeltaOne user by ID: ${error instanceof Error ? error.message : String(error)}`,
      { userId },
    );
    return fail(`Fallo al obtener el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function updateDeltaOneUserAction
 * @description Actualiza la información de un usuario en DeltaOne, incluyendo sus membresías de grupo.
 * @param {z.infer<typeof updateDeltaOneUserSchema>} data - Datos del usuario para actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil actualizado o un mensaje de error.
 * @notes
 * Esta acción se centra en actualizar los datos de la tabla profilesTable (si los campos name o email existieran allí)
 * y la pertenencia a grupos en groupMembersTable.
 * Las actualizaciones de información principal del usuario (ej., nombre, email) en Clerk deberían
 * realizarse a través de la API de Clerk.
 */
export async function updateDeltaOneUserAction(
  data: z.infer<typeof updateDeltaOneUserSchema>,
): Promise<ActionState<SelectProfile>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to update DeltaOne user.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = updateDeltaOneUserSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateDeltaOneUserAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { userId, groupIds } = validatedData.data;

  try {
    const existingProfile = await firstOrUndefined(
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)),
    );

    if (!existingProfile) {
      return fail("Usuario de DeltaOne no encontrado.");
    }

    // Update group memberships
    await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
    if (groupIds && groupIds.length > 0) {
      const newGroupMembers: InsertGroupMember[] = groupIds.map((groupId) => ({
        groupId: groupId,
        userId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await db.insert(groupMembersTable).values(newGroupMembers);
    }

    logger.info(`DeltaOne user ${userId} updated successfully.`);
    return ok("Usuario de DeltaOne actualizado exitosamente.", existingProfile); // Return original profile for simplicity as only group memberships were modified
  } catch (error) {
    logger.error(
      `Error updating DeltaOne user: ${error instanceof Error ? error.message : String(error)}`,
      { userId },
    );
    return fail(`Fallo al actualizar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function deactivateDeltaOneUserAction
 * @description Desactiva un usuario en el contexto de DeltaOne, eliminándolo de todos los grupos.
 * Esta acción no elimina la cuenta de Clerk, solo su relación con DeltaOne.
 * @param {z.infer<typeof deactivateDeltaOneUserSchema>} data - Datos para desactivar el usuario.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o fracaso.
 * @notes
 * Para desactivar completamente un usuario de Clerk, se debería usar la API de Clerk.
 * Esta acción se limita a eliminar al usuario de todos los grupos en DeltaOne.
 */
export async function deactivateDeltaOneUserAction(
  data: z.infer<typeof deactivateDeltaOneUserSchema>,
): Promise<ActionState<undefined>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to deactivate DeltaOne user.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = deactivateDeltaOneUserSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deactivateDeltaOneUserAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { userId } = validatedData.data;

  try {
    // Delete all group memberships for the user
    await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));

    logger.info(`DeltaOne user ${userId} deactivated (removed from all groups) successfully.`);
    return ok("Usuario de DeltaOne desactivado (eliminado de todos los grupos) exitosamente.", undefined);
  } catch (error) {
    logger.error(
      `Error deactivating DeltaOne user: ${error instanceof Error ? error.message : String(error)}`,
      { userId },
    );
    return fail(`Fallo al desactivar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @interface BulkImportUserResult
 * @description Define la estructura del resultado de la importación para un solo usuario.
 * @property {string} email - Correo electrónico del usuario procesado.
 * @property {'created' | 'updated' | 'failed'} status - Estado del procesamiento del usuario.
 * @property {string} [message] - Mensaje adicional sobre el resultado (ej. error).
 */
interface BulkImportUserResult {
  email: string;
  status: 'created' | 'updated' | 'failed';
  message?: string;
}

/**
 * @interface BulkImportResult
 * @description Define la estructura del resultado general de la acción de importación masiva de usuarios.
 * @property {number} totalProcessed - Número total de usuarios intentados procesar.
 * @property {number} createdCount - Número de usuarios creados exitosamente.
 * @property {number} updatedCount - Número de usuarios actualizados exitosamente.
 * @property {number} failedCount - Número de usuarios que fallaron en el procesamiento.
 * @property {BulkImportUserResult[]} results - Array de resultados detallados para cada usuario.
 */
interface BulkImportResult {
  totalProcessed: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: BulkImportUserResult[];
}

/**
 * @function bulkImportUsersAction
 * @description Procesa una importación masiva de usuarios desde un payload estructurado (UC-401).
 * Crea o actualiza usuarios en Clerk y sus perfiles en la base de datos de DeltaOne,
 * asignándolos a grupos según lo especificado.
 * @param {z.infer<typeof BulkImportUsersPayloadSchema>} data - Array de objetos de usuario a importar.
 * @returns {Promise<ActionState<BulkImportResult>>} Objeto ActionState con el resumen de la importación.
 */
export async function bulkImportUsersAction(
  data: z.infer<typeof BulkImportUsersPayloadSchema>,
): Promise<ActionState<BulkImportResult>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to bulk import users.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = BulkImportUsersPayloadSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for bulkImportUsersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const usersToImport = validatedData.data;
  const importResults: BulkImportUserResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  try {
    // Fetch all groups once to map group names to IDs
    const allGroups = await db.select().from(groupsTable);
    const groupKeyToIdMap = new Map(allGroups.map((group) => [group.name, group.id]));

    for (const userData of usersToImport) {        
      const { email, firstName, lastName, password, groupKeys, title } = userData;
      let userClerkId: string | undefined;
      let userStatus: 'created' | 'updated' = 'created';
      let message = '';

      try {
        // 1. Check if user exists in Clerk
        const clerk = await clerkClient();
        const { data: users } = await clerk.users.getUserList({
          emailAddress: [email],
          limit: 1,
        });

        if (users.length > 0) {
          userClerkId = users[0].id;        
          userStatus = 'updated';

          // Update existing Clerk user
          await clerk.users.updateUser(userClerkId, {
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            password: password || undefined, // Update password if provided
          });
          message = `Usuario Clerk actualizado.`;
        } else {
          // Create new Clerk user
          const generatedPassword = password || crypto.randomBytes(16).toString('hex'); // Generate random password if not provided
          const newClerkUser = await clerk.users.createUser({
            emailAddress: [email],
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            password: generatedPassword,
            // quita/ajusta flags según tu versión de Clerk            
            // Mark user to change password on first login if it was generated
            // This is a common pattern for bulk imports where users don't set their initial password.
            // Clerk's API doesn't have a direct 'requirePasswordChange' flag in createUser,
            // but setting a generated password and not sending an invitation often implies this.
            // For a more explicit flow, an invitation should be sent or custom logic on first login
            // based on the generated password.
          });
          userClerkId = newClerkUser.id;
          message = `Usuario Clerk creado.`;
        }

        // 2. Ensure DeltaOne profile exists and update email if necessary
        if (userClerkId) {
          const profileResult = await createDeltaOneUserAction({        
            userId: userClerkId,
            email: email,
            name: firstName, // Pass name for potential future profile fields
          });
          if (!profileResult.isSuccess) {
            throw new Error(`Failed to create/update DeltaOne profile: ${profileResult.message}`);
          }

          // 3. Assign user to groups in DeltaOne
          if (groupKeys && groupKeys.length > 0) {
            const groupIdsToAssign: string[] = [];
            for (const key of groupKeys) {
              const groupId = groupKeyToIdMap.get(key);
              if (groupId) {
                groupIdsToAssign.push(groupId);
              } else {
                logger.warn(`Group key '${key}' not found for user ${email}. Skipping.`);
                message += ` Grupo '${key}' no encontrado.`;
              }
            }

            // Remove existing memberships for this user if they are not in the new list, then add new ones
            await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userClerkId));
            if (groupIdsToAssign.length > 0) {
                const newGroupMembers: InsertGroupMember[] = groupIdsToAssign.map((groupId) => ({
                    groupId: groupId,
                    userId: userClerkId!, // userClerkId is defined here
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }));
                await db.insert(groupMembersTable).values(newGroupMembers);
                message += ` Asignado a grupos.`;
            }
          }

          importResults.push({ email, status: userStatus, message });
          if (userStatus === 'created') createdCount++;
          else updatedCount++;
        } else {
          throw new Error("Clerk user ID not available after creation/update.");
        }
      } catch (userError: any) {
        logger.error(`Failed to process user ${email}: ${userError.message}`);
        importResults.push({ email, status: 'failed', message: userError.message });
        failedCount++;
      }
    }

    const overallResult: BulkImportResult = {
      totalProcessed: usersToImport.length,
      createdCount,
      updatedCount,
      failedCount,
      results: importResults,
    };

    logger.info(`Bulk import completed: ${createdCount} created, ${updatedCount} updated, ${failedCount} failed.`);
    return ok("Importación masiva de usuarios completada.", overallResult);
  } catch (error: any) {
    logger.error(
      `Error during bulk user import: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(`Fallo durante la importación masiva de usuarios: ${error instanceof Error ? error.message : String(error)}`);
  }
}