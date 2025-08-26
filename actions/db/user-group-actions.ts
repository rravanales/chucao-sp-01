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
  profilesTable,
  groupsTable,
  groupMembersTable,
  groupPermissionsTable,
  userGroupTypeEnum,
  SelectProfile,
  SelectGroup,
  SelectGroupMember,
  SelectGroupPermission,
  organizationsTable,
} from "@/db/schema";
import { ActionState, ok, fail } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { createProfileAction, getProfileByUserIdAction, updateProfileAction } from "./profiles-actions"; // Importar acciones de perfil local

const logger = getLogger("user-group-actions");

/**
 * @function firstOrUndefined
 * @description Helper para obtener el primer elemento de un array o undefined.
 * @template T El tipo de los elementos en el array.
 * @param {Promise<T[]>} q La promesa que resuelve a un array de elementos.
 * @returns {Promise<T | undefined>} Una promesa que resuelve al primer elemento o undefined.
 */
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
 * Este esquema asume que el `userId` ya existe en Clerk.
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
 * @schema updateDeltaOneUserSchema
 * @description Esquema de validación para actualizar la información de un usuario en DeltaOne.
 * Principalmente enfocado en la gestión de grupos.
 * @property {string} userId - ID del usuario de Clerk a actualizar, requerido.
 * @property {string[]} [groupIds] - Nuevos IDs de los grupos a los que se asignará el usuario, opcional.
 */
const updateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

/**
 * @schema deactivateDeltaOneUserSchema
 * @description Esquema de validación para desactivar un usuario en DeltaOne.
 * @property {string} userId - ID del usuario de Clerk a desactivar, requerido.
 */
const deactivateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

/**
 * @schema createGroupSchema
 * @description Esquema de validación para la creación de un nuevo grupo de usuarios.
 * @property {string} name - Nombre del grupo, requerido y único.
 * @property {z.infer<typeof userGroupTypeEnum>} groupType - Tipo de grupo, requerido.
 */
const createGroupSchema = z.object({
  name: z.string().min(1, "El nombre del grupo es requerido.").max(255, "El nombre no puede exceder los 255 caracteres."),
  groupType: z.enum(userGroupTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de grupo de usuario inválido." }),
  }),
});

/**
 * @schema updateGroupSchema
 * @description Esquema de validación para la actualización de un grupo existente.
 * @property {string} id - ID del grupo a actualizar, UUID requerido.
 * @property {string} [name] - Nuevo nombre del grupo, opcional.
 * @property {z.infer<typeof userGroupTypeEnum>} [groupType] - Nuevo tipo de grupo, opcional.
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
 * @description Esquema de validación para la eliminación de un grupo.
 * @property {string} id - ID del grupo a eliminar, UUID requerido.
 */
const deleteGroupSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
});

/**
 * @schema assignGroupMembersSchema
 * @description Esquema de validación para la asignación de miembros a un grupo.
 * @property {string} groupId - ID del grupo, UUID requerido.
 * @property {string[]} userIds - Array de IDs de usuario a asignar al grupo.
 */
const assignGroupMembersSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  userIds: z.array(z.string().min(1, "El ID de usuario es requerido.")).optional().default([]),
});

/**
 * @schema assignGroupPermissionsSchema
 * @description Esquema de validación para la asignación de permisos a un grupo.
 * @property {string} groupId - ID del grupo, UUID requerido.
 * @property {Array<{ permissionKey: string; permissionValue: boolean; organizationId?: string | null }>} permissions - Array de objetos de permiso.
 */
const assignGroupPermissionsSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissions: z.array(
    z.object({
      permissionKey: z.string().min(1, "La clave de permiso es requerida."),
      permissionValue: z.boolean(),
      organizationId: z.string().uuid("ID de organización inválido.").optional().nullable(),
    })
  ),
});

/* -------------------------------------------------------------------------- */
/*                               User Actions                                 */
/* -------------------------------------------------------------------------- */

/**
 * @function createDeltaOneUserAction
 * @description Registra un usuario de Clerk existente en el sistema DeltaOne,
 * creando un perfil local si no existe y asignándolo a grupos.
 * @param {z.infer<typeof createDeltaOneUserSchema>} data - Datos del usuario para registrar/actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil del usuario o un mensaje de error.
 * @notes
 *  - Esta acción asume que el usuario ya existe en Clerk o será creado por otro flujo de Clerk.
 *  - Si `profilesTable` tuviera campos como `name` o `email`, se deberían actualizar aquí.
 */
export async function createDeltaOneUserAction(
  data: z.infer<typeof createDeltaOneUserSchema>
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

  const { userId, groupIds } = validatedData.data;

  try {
    // 1. Asegurar que exista un perfil local para el userId
    let profileRes = await getProfileByUserIdAction(userId);
    let profile: SelectProfile;

    if (!profileRes.isSuccess) {
      // Si no existe, crear el perfil local con el userId
      profileRes = await createProfileAction({ userId, membership: 'free' }); // Asumimos 'free' por defecto
      if (!profileRes.isSuccess) {
        logger.error(`Failed to create profile for user ${userId}: ${profileRes.message}`);
        return fail(`Fallo al crear el perfil local para el usuario: ${profileRes.message}`);
      }
      profile = profileRes.data;
    } else {
      profile = profileRes.data;
    }

    // 2. Asignar el usuario a los grupos proporcionados
    if (groupIds && groupIds.length > 0) {
      // Eliminar membresías existentes para el usuario en estos grupos (si es un proceso de "set")
      // O solo añadir los nuevos si es un proceso de "add"
      await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
      
      const newGroupMembers: InsertGroupMember[] = groupIds.map((groupId) => ({
        groupId: groupId,
        userId: userId,
      }));
      await db.insert(groupMembersTable).values(newGroupMembers);
    }

    logger.info(`DeltaOne user created/updated for userId: ${userId}`);
    return ok("Usuario de DeltaOne creado/actualizado exitosamente.", profile);
  } catch (error) {
    logger.error(`Error creating/updating DeltaOne user: ${error instanceof Error ? error.message : String(error)}`, { userId });
    return fail(`Fallo al crear/actualizar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getDeltaOneUsersAction
 * @description Obtiene una lista de todos los perfiles de usuario en DeltaOne,
 * incluyendo los nombres de los grupos a los que pertenecen.
 * @returns {Promise<ActionState<Array<SelectProfile & { groups: SelectGroup[] }>>>} Objeto ActionState con la lista de usuarios y sus grupos.
 */
export async function getDeltaOneUsersAction(): Promise<ActionState<Array<SelectProfile & { groups: SelectGroup[] }>>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve DeltaOne users.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const usersWithGroups = await db.select()
      .from(profilesTable)
      .leftJoin(groupMembersTable, eq(profilesTable.userId, groupMembersTable.userId))
      .leftJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
      .then(rows => {
        // Agrupar los resultados por usuario
        const result = new Map<string, SelectProfile & { groups: SelectGroup[] }>();
        for (const row of rows) {
          if (!row.profiles) continue; // Asegurarse de que el perfil existe
          if (!result.has(row.profiles.userId)) {
            result.set(row.profiles.userId, { ...row.profiles, groups: [] });
          }
          if (row.groups && !result.get(row.profiles.userId)?.groups.some(g => g.id === row.groups?.id)) {
            result.get(row.profiles.userId)?.groups.push(row.groups);
          }
        }
        return Array.from(result.values());
      });

    return ok("Usuarios de DeltaOne obtenidos exitosamente.", usersWithGroups);
  } catch (error) {
    logger.error(`Error retrieving DeltaOne users: ${error instanceof Error ? error.message : String(error)}`);
    return fail(`Fallo al obtener los usuarios de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getDeltaOneUserByIdAction
 * @description Obtiene un perfil de usuario específico en DeltaOne por su ID de Clerk.
 * Incluye los nombres de los grupos a los que pertenece.
 * @param {string} userId - ID del usuario de Clerk.
 * @returns {Promise<ActionState<SelectProfile & { groups: SelectGroup[] }>>} Objeto ActionState con el usuario y sus grupos.
 */
export async function getDeltaOneUserByIdAction(
  userId: string
): Promise<ActionState<SelectProfile & { groups: SelectGroup[] }>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to retrieve DeltaOne user by ID.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = z.string().min(1, "El ID de usuario es requerido.").safeParse(userId);
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getDeltaOneUserByIdAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    // Nota: mantener el orden .from(...).leftJoin(...).leftJoin(...).where(...) mejora el tipado de Drizzle.
    const userRows = await db
      .select()
      .from(profilesTable)
      .leftJoin(groupMembersTable, eq(profilesTable.userId, groupMembersTable.userId))
      .leftJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
      .where(eq(profilesTable.userId, validatedId.data));

    // userRows es un array de filas { profiles, group_members, groups }
    if (userRows.length === 0 || !userRows[0]?.profiles) {
      return fail("Usuario de DeltaOne no encontrado.");
    }

    const profileData = userRows[0].profiles;
    const userGroups: SelectGroup[] = [];
    for (const row of userRows) {
      if (row.groups && !userGroups.some((g) => g.id === row.groups!.id)) {
        userGroups.push(row.groups);
      }
    }

    // Siempre devolver data en la rama de éxito para cumplir con ActionState<T>
    return ok("Usuario de DeltaOne obtenido exitosamente.", { ...profileData, groups: userGroups });
     
  } catch (error) {
    logger.error(`Error retrieving DeltaOne user by ID: ${error instanceof Error ? error.message : String(error)}`, { userId });
    return fail(`Fallo al obtener el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function updateDeltaOneUserAction
 * @description Actualiza la información de un usuario en DeltaOne, incluyendo sus membresías de grupo.
 * @param {z.infer<typeof updateDeltaOneUserSchema>} data - Datos del usuario para actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil actualizado o un mensaje de error.
 * @notes
 *  - Esta acción se centra en actualizar los datos de la tabla `profilesTable` (si los campos `name` o `email` existieran allí)
 *    y la pertenencia a grupos en `groupMembersTable`.
 *  - Las actualizaciones de información principal del usuario (ej., nombre, email) en Clerk deberían
 *    realizarse a través de la API de Clerk.
 */
export async function updateDeltaOneUserAction(
  data: z.infer<typeof updateDeltaOneUserSchema>
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
    // 1. Verificar si el perfil existe
    const existingProfileRes = await getProfileByUserIdAction(userId);
    if (!existingProfileRes.isSuccess) {
      return fail(`Usuario de DeltaOne no encontrado: ${existingProfileRes.message}`);
    }
    const existingProfile = existingProfileRes.data;

    // 2. Actualizar el perfil local (si aplica, actualmente solo membresía)
    // Placeholder para actualización de Clerk user details (ej. name, email)
    // await clerkClient.users.updateUser(userId, { firstName: name, emailAddresses: [{ id: 'email_id', emailAddress: email }] });

    // 3. Actualizar membresías de grupo
    if (groupIds !== undefined) {
      await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId)); // Eliminar todos los actuales
      if (groupIds.length > 0) {
        const newGroupMembers: InsertGroupMember[] = groupIds.map((groupId) => ({
          groupId: groupId,
          userId: userId,
        }));
        await db.insert(groupMembersTable).values(newGroupMembers);
      }
    }
    
    // Retornar el perfil existente ya que esta acción no modifica los campos directamente almacenados en profilesTable
    // fuera de lo que ya maneja createProfileAction (membership, stripe data)
    return ok("Usuario de DeltaOne actualizado exitosamente.", existingProfile);

  } catch (error) {
    logger.error(`Error updating DeltaOne user: ${error instanceof Error ? error.message : String(error)}`, { userId });
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
 *  - Para desactivar completamente un usuario de Clerk, se debería usar la API de Clerk.
 *  - Esta acción se limita a eliminar al usuario de todos los grupos en DeltaOne.
 */
export async function deactivateDeltaOneUserAction(
  data: z.infer<typeof deactivateDeltaOneUserSchema>
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
    // Placeholder para llamar a la API de Clerk para desactivar/eliminar el usuario en Clerk
    // await clerkClient.users.updateUser(userId, { publicMetadata: { active: false } });
    // o await clerkClient.users.deleteUser(userId);

    // Eliminar al usuario de todos los grupos en DeltaOne
    await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
    
    // Opcional: Eliminar el perfil local si la desactivación implica la eliminación de datos relacionados con DeltaOne
    // await db.delete(profilesTable).where(eq(profilesTable.userId, userId));

    logger.info(`DeltaOne user deactivated for userId: ${userId}`);
    return ok("Usuario de DeltaOne desactivado exitosamente.");
  } catch (error) {
    logger.error(`Error deactivating DeltaOne user: ${error instanceof Error ? error.message : String(error)}`, { userId });
    return fail(`Fallo al desactivar el usuario de DeltaOne: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                               Group Actions                                */
/* -------------------------------------------------------------------------- */

/**
 * @function createGroupAction
 * @description Crea un nuevo grupo de usuarios en la base de datos.
 * Verifica la autenticación del usuario y la unicidad del nombre del grupo.
 * @param {Omit<InsertGroup, 'id' | 'createdAt' | 'updatedAt'>} data - Datos del nuevo grupo.
 * @returns {Promise<ActionState<SelectGroup>>} Objeto ActionState con el grupo creado o un mensaje de error.
 */
export async function createGroupAction(
  data: Omit<InsertGroup, "id" | "createdAt" | "updatedAt">
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

  try {
    // Verificar unicidad del nombre
    const existingGroup = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.name, validatedData.data.name))
    );
    if (existingGroup) {
      return fail(`Ya existe un grupo con el nombre "${validatedData.data.name}".`);
    }

    const [newGroup] = await db.insert(groupsTable).values(validatedData.data).returning();
    if (!newGroup) {
        return fail("Fallo al crear el grupo, no se pudo obtener el grupo creado.");
    }

    logger.info(`Group created: ${newGroup.name} (${newGroup.id})`);
    return ok("Grupo creado exitosamente.", newGroup);
  } catch (error) {
    logger.error(`Error creating group: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail(`Fallo al crear el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getGroupsAction
 * @description Obtiene una lista de todos los grupos de usuarios.
 * @returns {Promise<ActionState<SelectGroup[]>>} Objeto ActionState con la lista de grupos o un mensaje de error.
 */
export async function getGroupsAction(): Promise<ActionState<SelectGroup[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve groups.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const groups = await db.select().from(groupsTable);
    return ok("Grupos obtenidos exitosamente.", groups);
  } catch (error) {
    logger.error(`Error retrieving groups: ${error instanceof Error ? error.message : String(error)}`);
    return fail(`Fallo al obtener los grupos: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function getGroupByIdAction
 * @description Obtiene un grupo de usuarios específico por su ID, incluyendo sus miembros y permisos.
 * @param {string} id - ID del grupo, UUID requerido.
 * @returns {Promise<ActionState<SelectGroup & { members: SelectProfile[]; permissions: SelectGroupPermission[] }>>} Objeto ActionState con el grupo, sus miembros y permisos.
 */
export async function getGroupByIdAction(
  id: string
): Promise<ActionState<SelectGroup & { members: SelectProfile[]; permissions: SelectGroupPermission[] }>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve group by ID.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = z.string().uuid("ID de grupo inválido.").safeParse(id);
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getGroupByIdAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const group = await firstOrUndefined(
      db.select().from(groupsTable).where(eq(groupsTable.id, validatedId.data))
    );
    if (!group) {
      return fail("Grupo no encontrado.");
    }

    const members = await db.select({ profile: profilesTable })
      .from(groupMembersTable)
      .where(eq(groupMembersTable.groupId, validatedId.data))
      .innerJoin(profilesTable, eq(groupMembersTable.userId, profilesTable.userId));

    const permissions = await db.select()
      .from(groupPermissionsTable)
      .where(eq(groupPermissionsTable.groupId, validatedId.data));

    return ok("Grupo obtenido exitosamente.", { ...group, members: members.map(m => m.profile), permissions });
  } catch (error) {
    logger.error(`Error retrieving group by ID: ${error instanceof Error ? error.message : String(error)}`, { id });
    return fail(`Fallo al obtener el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function updateGroupAction
 * @description Actualiza un grupo de usuarios existente en la base de datos.
 * Verifica la autenticación del usuario y la unicidad del nombre si se actualiza.
 * @param {string} id - ID del grupo a actualizar.
 * @param {Partial<Omit<InsertGroup, 'id' | 'createdAt' | 'updatedAt'>>} data - Datos parciales para actualizar el grupo.
 * @returns {Promise<ActionState<SelectGroup>>} Objeto ActionState con el grupo actualizado o un mensaje de error.
 */
export async function updateGroupAction(
  id: string,
  data: Partial<Omit<InsertGroup, "id" | "createdAt" | "updatedAt">>
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedPayload = updateGroupSchema.safeParse({ id, ...data });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const { id: groupId, name, ...updateData } = validatedPayload.data;

    // Verificar unicidad del nombre si se está actualizando
    if (name) {
      const existingGroup = await firstOrUndefined(
        db.select().from(groupsTable).where(and(eq(groupsTable.name, name), ne(groupsTable.id, groupId)))
      );
      if (existingGroup) {
        return fail(`Ya existe otro grupo con el nombre "${name}".`);
      }
    }

    const [updatedGroup] = await db
      .update(groupsTable)
      .set({ name, ...updateData, updatedAt: new Date() })
      .where(eq(groupsTable.id, groupId))
      .returning();

    if (!updatedGroup) {
      return fail("Grupo no encontrado o no se pudo actualizar.");
    }

    logger.info(`Group updated: ${updatedGroup.name} (${updatedGroup.id})`);
    return ok("Grupo actualizado exitosamente.", updatedGroup);
  } catch (error) {
    logger.error(`Error updating group: ${error instanceof Error ? error.message : String(error)}`, { id, data });
    return fail(`Fallo al actualizar el grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @function deleteGroupAction
 * @description Elimina un grupo de usuarios de la base de datos.
 * Las membresías y permisos asociados a este grupo serán eliminados en cascada por la BD.
 * @param {string} id - ID del grupo a eliminar.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function deleteGroupAction(id: string): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete group.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = deleteGroupSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteGroupAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [deletedGroup] = await db.delete(groupsTable).where(eq(groupsTable.id, validatedId.data.id)).returning();

    if (!deletedGroup) {
      return fail("Grupo no encontrado o ya ha sido eliminado.");
    }

    logger.info(`Group deleted: ${deletedGroup.name} (${deletedGroup.id})`);
    return ok("Grupo eliminado exitosamente.");
  } catch (error) {
    logger.error(`Error deleting group: ${error instanceof Error ? error.message : String(error)}`, { id });
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
  data: z.infer<typeof assignGroupMembersSchema>
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
    // Verificar que el grupo existe
    const existingGroup = await firstOrUndefined(db.select().from(groupsTable).where(eq(groupsTable.id, groupId)));
    if (!existingGroup) {
      return fail("Grupo no encontrado.");
    }

    // Usar una transacción para asegurar la atomicidad
    await db.transaction(async (tx) => {
      // 1. Eliminar todos los miembros existentes para este grupo
      await tx.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));

      // 2. Insertar los nuevos miembros
      if (userIds.length > 0) {
        const newMembers: InsertGroupMember[] = userIds.map((userId) => ({
          groupId: groupId,
          userId: userId,
        }));
        await tx.insert(groupMembersTable).values(newMembers);
      }
    });

    logger.info(`Group members assigned for group ID: ${groupId}`);
    return ok("Miembros del grupo asignados exitosamente.");
  } catch (error) {
    logger.error(`Error assigning group members: ${error instanceof Error ? error.message : String(error)}`, { data });
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
  data: z.infer<typeof assignGroupPermissionsSchema>
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
    // Verificar que el grupo existe
    const existingGroup = await firstOrUndefined(db.select().from(groupsTable).where(eq(groupsTable.id, groupId)));
    if (!existingGroup) {
      return fail("Grupo no encontrado.");
    }

    // Usar una transacción para asegurar la atomicidad
    await db.transaction(async (tx) => {
      // Eliminar permisos existentes para este grupo
      // Esto es crucial para la lógica de "sobrescribir" o "set" los permisos.
      await tx.delete(groupPermissionsTable).where(eq(groupPermissionsTable.groupId, groupId));

      // Insertar los nuevos permisos
      if (permissions.length > 0) {
        const newPermissions: InsertGroupPermission[] = permissions.map((perm) => ({
          groupId: groupId,
          permissionKey: perm.permissionKey,
          permissionValue: perm.permissionValue,
          organizationId: perm.organizationId === "null" ? null : perm.organizationId, // Normalizar "null" a null
        }));
        await tx.insert(groupPermissionsTable).values(newPermissions);
      }
    });

    logger.info(`Group permissions assigned for group ID: ${groupId}`);
    return ok("Permisos del grupo asignados exitosamente.");
  } catch (error) {
    logger.error(`Error assigning group permissions: ${error instanceof Error ? error.message : String(error)}`, { data });
    return fail(`Fallo al asignar permisos al grupo: ${error instanceof Error ? error.message : String(error)}`);
  }
}