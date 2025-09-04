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
  groupMembersTable,
  groupPermissionsTable,
  groupsTable,
  userGroupTypeEnum,
  organizationsTable,
} from "@/db/schema";
import { SelectProfile, profilesTable } from "@/db/schema/profiles-schema";
import { ActionState, fail, ok } from "@/types";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import crypto from "crypto";
import { getDescendantOrganizations } from "@/lib/organization-utils";

const logger = getLogger("user-group-actions");

/** Formatea errores de Zod a un mensaje legible */
const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((i) =>
      i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message
    )
    .join(" | ");

/* -------------------------------------------------------------------------- */
/*                            Esquemas de Validación Zod                      */
/* -------------------------------------------------------------------------- */

const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del grupo es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  groupType: z.enum(userGroupTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de grupo de usuario inválido." }),
  }),
});

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

const getGroupByIdSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
});

const deleteGroupSchema = z.object({
  id: z.string().uuid("ID de grupo inválido."),
});

const assignGroupMembersSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  userIds: z.array(z.string().min(1, "El ID de usuario no puede estar vacío.")),
});

const GroupPermissionSchema = z.object({
  permissionKey: z
    .string()
    .min(1, "La clave de permiso es requerida.")
    .max(255, "La clave de permiso no puede exceder los 255 caracteres."),
  permissionValue: z.boolean(),
  organizationId: z.string().uuid("ID de organización inválido.").nullable().optional(),
});

const assignGroupPermissionsSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissions: z.array(GroupPermissionSchema),
});

const createDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  name: z.string().max(255, "El nombre no puede exceder 255 caracteres.").optional(),
  email: z.string().email("Formato de email inválido.").optional(),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

const getDeltaOneUserByIdSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

const updateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  name: z.string().max(255, "El nombre no puede exceder 255 caracteres.").optional(),
  email: z.string().email("Formato de email inválido.").optional(),
  groupIds: z.array(z.string().uuid("ID de grupo inválido.")).optional(),
});

const deactivateDeltaOneUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
});

const BulkImportUserSchema = z.object({
  email: z.string().email("Formato de email inválido."),
  firstName: z.string().max(255, "El nombre no puede exceder 255 caracteres.").optional(),
  lastName: z.string().max(255, "El apellido no puede exceder 255 caracteres.").optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").optional(),
  title: z.string().max(255, "El título no puede exceder 255 caracteres.").optional(),
  groupKeys: z.array(z.string().min(1, "La clave de grupo no puede estar vacía.")).optional(),
});

const BulkImportUsersPayloadSchema = z
  .array(BulkImportUserSchema)
  .min(1, "El archivo de importación no puede estar vacío.");

const assignRollupTreeGroupPermissionsSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissionKey: z.string().min(1, "La clave de permiso es requerida.").max(255),
  permissionValue: z.boolean(),
  organizationId: z.string().uuid("ID de organización inválido."),
  applyToDescendants: z.boolean().default(false),
});

/* -------------------------------------------------------------------------- */
/*                               Group Actions                                */
/* -------------------------------------------------------------------------- */

export async function createGroupAction(
  data: Omit<InsertGroup, "id" | "createdAt" | "updatedAt">,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = createGroupSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { name, groupType } = parsed.data;

  const existing = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.name, name))
    .limit(1);

  if (existing.length > 0) return fail(`Ya existe un grupo con el nombre '${name}'.`);

  const [newGroup] = await db
    .insert(groupsTable)
    .values({ name, groupType, createdAt: new Date(), updatedAt: new Date() })
    .returning();

  return ok("Grupo creado exitosamente.", newGroup);
}

export async function getGroupByIdAction(
  data: z.infer<typeof getGroupByIdSchema>,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = getGroupByIdSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { id } = parsed.data;

  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, id))
    .limit(1);

  if (!group) return fail("Grupo no encontrado.");
  return ok("Grupo obtenido exitosamente.", group);
}

export async function getAllGroupsAction(): Promise<ActionState<SelectGroup[]>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const groups = await db.select().from(groupsTable);
  return ok("Grupos obtenidos exitosamente.", groups);
}

export async function updateGroupAction(
  data: z.infer<typeof updateGroupSchema>,
): Promise<ActionState<SelectGroup>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = updateGroupSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { id, name, groupType } = parsed.data;

  const [existing] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, id))
    .limit(1);

  if (!existing) return fail("Grupo no encontrado.");

  if (name) {
    const conflict = await db
      .select()
      .from(groupsTable)
      .where(and(eq(groupsTable.name, name), ne(groupsTable.id, id)))
      .limit(1);
    if (conflict.length > 0) return fail(`Ya existe otro grupo con el nombre '${name}'.`);
  }

  const [updated] = await db
    .update(groupsTable)
    .set({ name, groupType, updatedAt: new Date() })
    .where(eq(groupsTable.id, id))
    .returning();

  return ok("Grupo actualizado exitosamente.", updated);
}

export async function deleteGroupAction(
  data: z.infer<typeof deleteGroupSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = deleteGroupSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { id } = parsed.data;

  const [deleted] = await db.delete(groupsTable).where(eq(groupsTable.id, id)).returning();
  if (!deleted) return fail("Grupo no encontrado.");

  return ok("Grupo eliminado exitosamente.", undefined);
}

export async function assignGroupMembersAction(
  data: z.infer<typeof assignGroupMembersSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = assignGroupMembersSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { groupId, userIds } = parsed.data;

  // Verificar grupo
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
  if (!group) return fail("Grupo no encontrado.");

  await db.transaction(async (tx) => {
    await tx.delete(groupMembersTable).where(eq(groupMembersTable.groupId, groupId));
    if (userIds.length > 0) {
      const rows: InsertGroupMember[] = userIds.map((u) => ({
        groupId,
        userId: u,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await tx.insert(groupMembersTable).values(rows);
    }
  });

  return ok("Miembros del grupo asignados exitosamente.", undefined);
}

export async function assignGroupPermissionsAction(
  data: z.infer<typeof assignGroupPermissionsSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = assignGroupPermissionsSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { groupId, permissions } = parsed.data;

  // Verificar grupo
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
  if (!group) return fail("Grupo no encontrado.");

  await db.transaction(async (tx) => {
    // Borrado simple por groupId. (Si necesitas granularidad por clave/organización, ajustar aquí.)
    await tx.delete(groupPermissionsTable).where(eq(groupPermissionsTable.groupId, groupId));

    if (permissions.length > 0) {
      const rows: InsertGroupPermission[] = permissions.map((p) => ({
        groupId,
        permissionKey: p.permissionKey,
        permissionValue: p.permissionValue,
        organizationId: p.organizationId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await tx.insert(groupPermissionsTable).values(rows);
    }
  });

  return ok("Permisos del grupo asignados exitosamente.", undefined);
}

/**
 * Asigna permisos a un grupo para una organización y opcionalmente a toda su descendencia.
 * Usa getDescendantOrganizations(db, organizationId) -> Promise<string[]>.
 */
export async function assignRollupTreeGroupPermissionsAction(
  data: z.infer<typeof assignRollupTreeGroupPermissionsSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = assignRollupTreeGroupPermissionsSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));

  const { groupId, permissionKey, permissionValue, organizationId, applyToDescendants } =
    parsed.data;

  // Verificar grupo
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId)).limit(1);
  if (!group) return fail("Grupo no encontrado.");

  // Verificar organización raíz
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  if (!org) return fail("Organización raíz no encontrada.");

  let orgIds: string[] = [organizationId];
  if (applyToDescendants) {
    // Firma esperada: getDescendantOrganizations(db, organizationId) => Promise<string[]>
    const descendants = await getDescendantOrganizations(db, organizationId);
    orgIds = Array.from(new Set([...orgIds, ...descendants]));
  }

  await db.transaction(async (tx) => {
    for (const orgId of orgIds) {
      const row: InsertGroupPermission = {
        groupId,
        permissionKey,
        permissionValue,
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await tx
        .insert(groupPermissionsTable)
        .values(row)
        .onConflictDoUpdate({
          target: [
            groupPermissionsTable.groupId,
            groupPermissionsTable.permissionKey,
            groupPermissionsTable.organizationId,
          ],
          set: { permissionValue, updatedAt: new Date() },
        });
    }
  });

  return ok("Permisos de árbol (rollup) asignados exitosamente.", undefined);
}

/* -------------------------------------------------------------------------- */
/*                                   User Actions                             */
/* -------------------------------------------------------------------------- */

export async function createDeltaOneUserAction(
  data: z.infer<typeof createDeltaOneUserSchema>,
): Promise<ActionState<SelectProfile>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = createDeltaOneUserSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));

  const { userId, groupIds, email } = parsed.data;

  let profile: SelectProfile;
  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(profilesTable)
      .set({
        ...(email !== undefined ? { email } : {}),
        updatedAt: new Date(),
      })
      .where(eq(profilesTable.userId, userId))
      .returning();
    profile = updated;
  } else {
    const [inserted] = await db
      .insert(profilesTable)
      .values({
        userId,
        membership: "free",
        email: email ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    profile = inserted;
  }

  if (groupIds && groupIds.length > 0) {
    await db.transaction(async (tx) => {
      // Semántica sobrescribir: borrar TODAS las membresías del usuario y volver a insertar
      await tx.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
      const rows: InsertGroupMember[] = groupIds.map((gid) => ({
        groupId: gid,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await tx.insert(groupMembersTable).values(rows);
    });
  }

  return ok("Usuario de DeltaOne registrado/actualizado exitosamente.", profile);
}

export async function getDeltaOneUserByIdAction(
  data: z.infer<typeof getDeltaOneUserByIdSchema>,
): Promise<ActionState<SelectProfile & { groups: SelectGroup[] }>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = getDeltaOneUserByIdSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { userId } = parsed.data;

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (!profile) return fail("Usuario de DeltaOne no encontrado.");

  const groups: SelectGroup[] = await db
    .select({ group: groupsTable })
    .from(groupMembersTable)
    .leftJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(eq(groupMembersTable.userId, userId))
    .then((rows) =>
      rows.map((r) => r.group).filter((g): g is SelectGroup => g !== null),
    );

  return ok("Usuario de DeltaOne obtenido exitosamente.", { ...profile, groups });
}

export async function updateDeltaOneUserAction(
  data: z.infer<typeof updateDeltaOneUserSchema>,
): Promise<ActionState<SelectProfile>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = updateDeltaOneUserSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));

  const { userId, email, groupIds } = parsed.data;

  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (!existing) return fail("Usuario de DeltaOne no encontrado.");

  let profile: SelectProfile = existing;

  if (email) {
    const [updated] = await db
      .update(profilesTable)
      .set({ email, updatedAt: new Date() })
      .where(eq(profilesTable.userId, userId))
      .returning();
    profile = updated;
  }

  if (groupIds !== undefined) {
    await db.transaction(async (tx) => {
      await tx.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
      if (groupIds.length > 0) {
        const rows: InsertGroupMember[] = groupIds.map((gid) => ({
          groupId: gid,
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        await tx.insert(groupMembersTable).values(rows);
      }
    });
  }

  return ok("Usuario de DeltaOne actualizado exitosamente.", profile);
}

export async function deactivateDeltaOneUserAction(
  data: z.infer<typeof deactivateDeltaOneUserSchema>,
): Promise<ActionState<undefined>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = deactivateDeltaOneUserSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));
  const { userId } = parsed.data;

  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (!existing) return fail("Usuario de DeltaOne no encontrado.");

  await db.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));

  return ok("Usuario de DeltaOne desactivado (eliminado de todos los grupos) exitosamente.", undefined);
}

/* -------------------------------------------------------------------------- */
/*                           Bulk Import Users (UC-401)                       */
/* -------------------------------------------------------------------------- */

interface BulkImportUserResult {
  email: string;
  status: "created" | "updated" | "failed";
  message?: string;
}

interface BulkImportResult {
  totalProcessed: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: BulkImportUserResult[];
}

export async function bulkImportUsersAction(
  data: z.infer<typeof BulkImportUsersPayloadSchema>,
): Promise<ActionState<BulkImportResult>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const parsed = BulkImportUsersPayloadSchema.safeParse(data);
  if (!parsed.success) return fail(formatZodError(parsed.error));

  const users = parsed.data;
  const results: BulkImportUserResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  // Mapa clave-de-grupo (name) -> id
  const allGroups = await db.select().from(groupsTable);
  const groupKeyToId = new Map(allGroups.map((g) => [g.name, g.id]));

  for (const u of users) {
    const { email, firstName, lastName, password, title, groupKeys } = u;
    let status: BulkImportUserResult["status"] = "failed";
    let message = "";
    let clerkUserId: string | null = null;

    try {
      // 1) Buscar usuario en Clerk por email
      const clerk = await clerkClient();
      //const { data: users } 
      const {data: found}  = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });

      if (found.length > 0) {
        // Usuario existente -> actualizar
        const existing = found[0];
        clerkUserId = existing.id;
        await clerk.users.updateUser(existing.id, {
          firstName: firstName ?? undefined,
          lastName: lastName ?? undefined,
          password: password ?? undefined,
          publicMetadata: { ...(title ? { title } : {}) },
        });
        status = "updated";
        message = `Usuario Clerk actualizado: ${existing.id}`;
      } else {
        // Usuario nuevo -> crear
        const generatedPassword = password ?? crypto.randomBytes(16).toString("hex");
        const created = await clerk.users.createUser({
          emailAddress: [email],
          firstName: firstName ?? undefined,
          lastName: lastName ?? undefined,
          password: generatedPassword,
          publicMetadata: { ...(title ? { title } : {}) },
        });
        clerkUserId = created.id;
        status = "created";
        message = `Usuario Clerk creado: ${created.id}`;
      }

      // 2) Crear/Actualizar perfil en DeltaOne
      if (clerkUserId) {
        const profileResult = await createDeltaOneUserAction({
          userId: clerkUserId,
          email,
        });

        if (!profileResult.isSuccess) {
          message += ` | Error perfil DeltaOne: ${profileResult.message}`;
          status = "failed";
        } else {
          // 3) Asignación de grupos (sobrescribir membresías)
          const groupIdsToAssign: string[] = [];
          if (groupKeys && groupKeys.length > 0) {
            for (const key of groupKeys) {
              const gid = groupKeyToId.get(key);
              if (gid) groupIdsToAssign.push(gid);
              else logger.warn(`Group key '${key}' no encontrado para ${email}.`);
            }
          }

          await db
            .delete(groupMembersTable)
            .where(eq(groupMembersTable.userId, clerkUserId));

          if (groupIdsToAssign.length > 0) {
            const rows: InsertGroupMember[] = groupIdsToAssign.map((gid) => ({
              groupId: gid,
              userId: clerkUserId!,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));
            await db.insert(groupMembersTable).values(rows);
            message += " | Grupos asignados.";
          }
        }
      }
    } catch (err: any) {
      logger.error(`Error procesando usuario ${email}: ${err?.message ?? String(err)}`, { user: u });
      message = `Error: ${err?.message ?? String(err)}`;
      status = "failed";
    } finally {
      results.push({ email, status, message });
      if (status === "created") createdCount++;
      else if (status === "updated") updatedCount++;
      else failedCount++;
    }
  }

  return ok("Importación masiva de usuarios procesada.", {
    totalProcessed: users.length,
    createdCount,
    updatedCount,
    failedCount,
    results,
  });
}
