/**
 * @file actions/db/user-group-actions.ts
 * @brief Implementa Server Actions para la gestión de usuarios y grupos en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para gestionar
 * la creación, recuperación, actualización y eliminación de grupos de usuarios,
 * la asignación de miembros a estos grupos, y la gestión de permisos asociados a ellos.
 * También incluye acciones para la gestión del perfil local de los usuarios (profilesTable)
 * y la integración con el sistema de autenticación de Clerk a un nivel conceptual.
 *
 * Corrección (UC-401):
 * - Se modifica el "Bulk Import Users" para que el server action reciba un archivo
 *   codificado en Base64 (CSV) y lo procese internamente, en lugar de exigir
 *   un arreglo de usuarios ya parseado desde el cliente.
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
  membershipEnum,
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

/**
 * CORRECCIÓN UC-401:
 * El payload ahora es un objeto con metadatos del archivo y su contenido en Base64.
 * El servidor se encarga de decodificar y parsear (CSV simple).
 */
const BulkImportUsersPayloadSchema = z.object({
  fileName: z.string().min(1, "El nombre del archivo es requerido."),
  fileContentBase64: z.string().min(1, "El contenido Base64 del archivo es requerido."),
});

const assignRollupTreeGroupPermissionsSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissionKey: z.string().min(1, "La clave de permiso es requerida.").max(255),
  permissionValue: z.boolean(),
  organizationId: z.string().uuid("ID de organización inválido."),
  applyToDescendants: z.boolean().default(false),
});

/** ------------------------------------------------------------------------ */
/**                      MEJORA v2: Esquemas de usuario                      */
/** ------------------------------------------------------------------------ */
const updateUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  email: z.string().email("Correo electrónico inválido.").optional().nullable(),
  membership: z
    .enum(membershipEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de membresía inválido." }),
    })
    .optional(),
});

const deactivateUserSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
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

  // Verificar grupo (mantener v1)
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

/** Parser CSV simple con soporte básico de comillas */
function parseCsvSimple(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (ch === '"' ) {
      if (inQuotes && next === '"') {
        // Escapar comillas dobles -> una comilla literal
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      // Manejar CRLF y LF
      if (ch === "\r" && next === "\n") {
        i++;
      }
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Último campo / fila si quedó sin cerrar
  if (field.length > 0 || inQuotes || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  // Filtrar filas vacías
  return rows.filter(r => r.some(c => c && c.length > 0));
}

export async function bulkImportUsersAction(
  data: z.infer<typeof BulkImportUsersPayloadSchema>,
): Promise<ActionState<BulkImportResult>> {
  const { userId: current } = await auth();
  if (!current) return fail("No autorizado. Debe iniciar sesión.");

  const validated = BulkImportUsersPayloadSchema.safeParse(data);
  if (!validated.success) {
    const errorMessage = formatZodError(validated.error);
    logger.error(`Validation error for bulkImportUsersAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { fileName, fileContentBase64 } = validated.data;

  // Por ahora soportamos sólo CSV para parsing server-side sin librerías externas.
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".csv")) {
    return fail(
      "Formato no soportado. Por ahora, la importación masiva acepta sólo archivos CSV (se planea añadir parsing de Excel en cliente)."
    );
  }

  let createdCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  const results: BulkImportUserResult[] = [];

  try {
    const decoded = Buffer.from(fileContentBase64, "base64").toString("utf-8");

    const table = parseCsvSimple(decoded);
    if (table.length < 2) {
      return ok("Importación masiva de usuarios procesada, pero no se encontraron datos en el archivo.", {
        totalProcessed: 0,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
        results: [],
      });
    }

    // Encabezados
    const headersRaw = table[0].map(h => h.trim());
    // Normalizamos headers a un set esperado
    const headerIndex = (name: string) => {
      const i = headersRaw.findIndex(h => h.toLowerCase() === name.toLowerCase());
      return i >= 0 ? i : -1;
    };

    const idxEmail = headerIndex("email");
    if (idxEmail === -1) return fail("El CSV debe contener la columna 'email'.");

    const idxFirst = headerIndex("firstName");
    const idxLast = headerIndex("lastName");
    const idxPassword = headerIndex("password");
    const idxTitle = headerIndex("title");
    const idxGroupKeys = headerIndex("groupKeys"); // Separadas por ';'

    // Mapa clave-de-grupo (name) -> id
    const allGroups = await db.select().from(groupsTable);
    const groupKeyToId = new Map(allGroups.map((g) => [g.name, g.id]));

    // Recorremos filas de datos
    const dataRows = table.slice(1);
    const usersToProcess: Array<z.infer<typeof BulkImportUserSchema>> = [];

    for (const r of dataRows) {
      const email = r[idxEmail]?.trim();
      const firstName = idxFirst >= 0 ? r[idxFirst]?.trim() : undefined;
      const lastName = idxLast >= 0 ? r[idxLast]?.trim() : undefined;
      const password = idxPassword >= 0 ? r[idxPassword]?.trim() : undefined;
      const title = idxTitle >= 0 ? r[idxTitle]?.trim() : undefined;
      const groupKeysStr = idxGroupKeys >= 0 ? r[idxGroupKeys]?.trim() : undefined;

      const groupKeys =
        groupKeysStr && groupKeysStr.length > 0
          ? groupKeysStr.split(";").map((g) => g.trim()).filter(Boolean)
          : undefined;

      const candidate = {
        email,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        password: password || undefined,
        title: title || undefined,
        groupKeys,
      };

      const checked = BulkImportUserSchema.safeParse(candidate);
      if (!checked.success) {
        failedCount++;
        results.push({
          email: email || "N/A",
          status: "failed",
          message: formatZodError(checked.error),
        });
        continue;
      }

      usersToProcess.push(checked.data);
    }

    // Proceso: para cada usuario, mantener la lógica original con Clerk + perfil local
    for (const u of usersToProcess) {
      const { email, firstName, lastName, password, title, groupKeys } = u;
      let status: BulkImportUserResult["status"] = "failed";
      let message = "";
      let clerkUserId: string | null = null;

      try {
        // 1) Buscar/crear/actualizar en Clerk
        // Nota: mantener el patrón original (clerkClient() como posible factory del SDK).
        const clerk = await clerkClient();
        const { data: found } = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });

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
      totalProcessed: usersToProcess.length,
      createdCount,
      updatedCount,
      failedCount,
      results,
    });
  } catch (e: any) {
    logger.error(
      `Error processing bulk import file: ${e?.message ?? String(e)}`,
      { fileName }
    );
    return fail(
      `Fallo al procesar el archivo de importación masiva: ${e?.message ?? String(e)}`
    );
  }
}

/* -------------------------------------------------------------------------- */
/*                       MEJORAS v2: Acciones de usuario extra                */
/* -------------------------------------------------------------------------- */

/**
 * @function updateUserAction
 * @description Actualiza el perfil de un usuario existente en la base de datos local (UC-400).
 * Permite a un administrador modificar ciertos detalles del perfil de usuario en DeltaOne.
 * @param {z.infer<typeof updateUserSchema>} data - Datos del perfil de usuario a actualizar.
 * @returns {Promise<ActionState<SelectProfile>>} Objeto ActionState con el perfil actualizado o un mensaje de error.
 * @notes No reemplaza a updateDeltaOneUserAction (v1). Es una acción adicional más focalizada
 *        en email/membership y mantiene compatibilidad con el resto del contrato público.
 */
export async function updateUserAction(
  data: z.infer<typeof updateUserSchema>,
): Promise<ActionState<SelectProfile>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to update user profile.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validated = updateUserSchema.safeParse(data);
  if (!validated.success) {
    return fail(formatZodError(validated.error));
  }

  const { userId, email, membership } = validated.data;

  // Verificar existencia del perfil
  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (!existing) {
    return fail("Perfil de usuario no encontrado.");
  }

  try {
    const [updatedProfile] = await db
      .update(profilesTable)
      .set({
        ...(email !== undefined && { email: email ?? null }),
        ...(membership !== undefined && { membership }),
        updatedAt: new Date(),
      })
      .where(eq(profilesTable.userId, userId))
      .returning();

    if (!updatedProfile) {
      return fail("Perfil de usuario no encontrado.");
    }

    logger.info(`User profile updated: ${userId}`);
    return ok("Perfil de usuario actualizado exitosamente.", updatedProfile);
  } catch (e: any) {
    logger.error(`Error updating user profile: ${e?.message ?? String(e)}`, { userId });
    return fail("Fallo al actualizar el perfil de usuario.");
  }
}

/**
 * @function deactivateUserAction
 * @description Desactiva un usuario en el sistema (UC-400), implementación provisional:
 * - Elimina al usuario de todos los grupos.
 * - Establece su membresía a 'free' como marcador de desactivación.
 * @param {z.infer<typeof deactivateUserSchema>} data
 * @returns {Promise<ActionState<undefined>>}
 * @notes Mantiene compatibilidad: no reemplaza a deactivateDeltaOneUserAction (v1).
 */
export async function deactivateUserAction(
  data: z.infer<typeof deactivateUserSchema>,
): Promise<ActionState<undefined>> {
  const { userId: currentAuthUserId } = await auth();
  if (!currentAuthUserId) {
    logger.warn("Unauthorized attempt to deactivate user.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validated = deactivateUserSchema.safeParse(data);
  if (!validated.success) {
    return fail(formatZodError(validated.error));
  }

  const { userId } = validated.data;

  // Verificar existencia del perfil
  const [existing] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);

  if (!existing) {
    return fail("Perfil de usuario no encontrado.");
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(groupMembersTable).where(eq(groupMembersTable.userId, userId));
      await tx
        .update(profilesTable)
        .set({ membership: "free", updatedAt: new Date() })
        .where(eq(profilesTable.userId, userId));
    });

    logger.info(`User ${userId} deactivated (placeholder).`);
    return ok("Usuario desactivado exitosamente (implementación provisional).", undefined);
  } catch (e: any) {
    logger.error(`Error deactivating user: ${e?.message ?? String(e)}`, { userId });
    return fail("Fallo al desactivar el usuario.");
  }
}
