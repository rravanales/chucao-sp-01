"use server"

import { db } from "@/db/db"
import {
  InsertOrganization,
  SelectOrganization,
  organizationsTable,
} from "@/db/schema"
import { ActionState } from "@/types"
import { auth } from "@clerk/nextjs/server"
import { eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { getLogger } from "@/lib/logger"

const logger = getLogger("organization-actions")

/**
 * @schema createOrganizationSchema
 * @description Esquema de validación para la creación de una nueva organización.
 */
const createOrganizationSchema = z.object({
  name: z.string().min(1, "El nombre de la organización es requerido.").max(255, "El nombre no puede exceder los 255 caracteres."),
  description: z.string().max(1000, "La descripción no puede exceder los 1000 caracteres.").optional().nullable(),
  parentId: z.string().uuid("ID de organización padre inválido.").optional().nullable(),
  templateFromDatasetField: z.string().max(255, "El campo de plantilla no puede exceder los 255 caracteres.").optional().nullable(),
})

/**
 * @schema updateOrganizationSchema
 * @description Esquema de validación para la actualización de una organización existente.
 * Permite campos opcionales ya que se puede actualizar solo una parte de la organización.
 */
const updateOrganizationSchema = z.object({
  id: z.string().uuid("ID de organización inválido."),
  name: z.string().min(1, "El nombre de la organización es requerido.").max(255, "El nombre no puede exceder los 255 caracteres.").optional(),
  description: z.string().max(1000, "La descripción no puede exceder los 1000 caracteres.").optional().nullable(),
  parentId: z.string().uuid("ID de organización padre inválido.").nullable().optional(),
  templateFromDatasetField: z.string().max(255, "El campo de plantilla no puede exceder los 255 caracteres.").optional().nullable(),
})

/**
 * @schema deleteOrganizationSchema
 * @description Esquema de validación para la eliminación de una organización.
 */
const deleteOrganizationSchema = z.object({
  id: z.string().uuid("ID de organización inválido."),
})

/**
 * @function createOrganizationAction
 * @description Crea una nueva organización en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Si se proporciona un `parentId`, verifica su existencia.
 * @param {Omit<InsertOrganization, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos de la nueva organización, excluyendo campos auto-generados (`id`, `createdAt`, `updatedAt`).
 * @returns {Promise<ActionState<SelectOrganization>>} Un objeto ActionState indicando el éxito o fracaso y los datos de la organización creada.
 * @example
 * // Ejemplo de uso:
 * const result = await createOrganizationAction({ name: "Departamento de Ventas", parentId: "some-parent-id", description: "Equipo de ventas global" });
 * if (result.isSuccess) {
 *   console.log("Organización creada:", result.data);
 * } else {
 *   console.error("Error al crear organización:", result.message);
 * }
 */
export async function createOrganizationAction(
  data: Omit<InsertOrganization, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ActionState<SelectOrganization>> {
  const { userId } = await auth()
  if (!userId) {
    logger.warn("Unauthorized attempt to create organization.")
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." }
  }

  try {
    // Validar los datos de entrada usando el esquema de Zod
    const validatedData = createOrganizationSchema.safeParse(data)
    if (!validatedData.success) {
      const errorMessage = validatedData.error.errors.map(e => e.message).join(", ")
      logger.error(`Validation error for createOrganizationAction: ${errorMessage}`)
      return { isSuccess: false, message: errorMessage }
    }

    // Si se proporciona un parentId, verificar que la organización padre exista
    if (validatedData.data.parentId) {
      const parentExists = await db
        .select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, validatedData.data.parentId))
        .limit(1)
      if (parentExists.length === 0) {
        logger.error(`Parent organization with ID ${validatedData.data.parentId} not found.`)
        return { isSuccess: false, message: "La organización padre especificada no existe." }
      }
    }

    // Insertar la nueva organización en la base de datos
    const [newOrganization] = await db
      .insert(organizationsTable)
      .values({
        name: validatedData.data.name,
        description: validatedData.data.description,
        parentId: validatedData.data.parentId,
        templateFromDatasetField: validatedData.data.templateFromDatasetField,
        // createdAt y updatedAt son manejados automáticamente por Drizzle con defaultNow() y $onUpdate()
      })
      .returning() // Devolver los datos de la organización insertada

    // Verificar si la inserción fue exitosa y se devolvieron datos
    if (!newOrganization) {
      logger.error("Failed to create organization in database, no data returned.")
      return { isSuccess: false, message: "Fallo al crear la organización." }
    }

    logger.info(`Organization created: ${newOrganization.id} by user ${userId}`)
    return {
      isSuccess: true,
      message: "Organización creada exitosamente.",
      data: newOrganization,
    }
  } catch (error) {
    logger.error(`Error creating organization: ${error instanceof Error ? error.message : String(error)}`)
    return { isSuccess: false, message: "Fallo al crear la organización." }
  }
}

/**
 * @function getOrganizationsAction
 * @description Obtiene una lista de organizaciones.
 * Puede filtrar por `parentId` para obtener hijos directos, o si `parentId` es `null`,
 * devolverá las organizaciones de nivel superior (sin padre). Si `parentId` es `undefined` (no se pasa),
 * devolverá *todas* las organizaciones.
 * @param {string | null | undefined} parentId - (Opcional) El ID de la organización padre para filtrar los hijos.
 *                                              Si es `null`, devuelve organizaciones de nivel superior. Si es `undefined`, devuelve todas.
 * @returns {Promise<ActionState<SelectOrganization[]>>} Un objeto ActionState indicando el éxito o fracaso y la lista de organizaciones.
 * @example
 * // Obtener todas las organizaciones de nivel superior
 * const topLevelOrgs = await getOrganizationsAction(null);
 * // Obtener organizaciones hijas de un padre específico
 * const childOrgs = await getOrganizationsAction("some-parent-id");
 * // Obtener todas las organizaciones (sin filtrar por jerarquía)
 * const allOrgs = await getOrganizationsAction();
 */
export async function getOrganizationsAction(
  parentId?: string | null,
): Promise<ActionState<SelectOrganization[]>> {
  const { userId } = await auth()
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve organizations.")
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." }
  }

  try {
    let organizations: SelectOrganization[]

    if (parentId !== undefined) { // Si parentId se ha pasado explícitamente (sea string o null)
      if (parentId !== null) { // Si parentId es un string, validarlo y filtrar por él
        const validatedParentId = z.string().uuid("ID de organización padre inválido.").safeParse(parentId);
        if (!validatedParentId.success) {
          const errorMessage = validatedParentId.error.errors.map(e => e.message).join(", ")
          logger.error(`Validation error for getOrganizationsAction (parentId): ${errorMessage}`)
          return { isSuccess: false, message: errorMessage }
        }
        organizations = await db
          .select()
          .from(organizationsTable)
          .where(eq(organizationsTable.parentId, validatedParentId.data))
      } else { // Si parentId es explícitamente null, obtener organizaciones de nivel superior
        organizations = await db
          .select()
          .from(organizationsTable)
          .where(isNull(organizationsTable.parentId))
      }
    } else { // Si parentId no se pasó (es undefined), obtener todas las organizaciones
      organizations = await db
        .select()
        .from(organizationsTable)
    }

    logger.info(`Organizations retrieved by user ${userId}. Count: ${organizations.length}`)
    return {
      isSuccess: true,
      message: "Organizaciones obtenidas exitosamente.",
      data: organizations,
    }
  } catch (error) {
    logger.error(`Error retrieving organizations: ${error instanceof Error ? error.message : String(error)}`)
    return { isSuccess: false, message: "Fallo al obtener las organizaciones." }
  }
}

/**
 * @function getOrganizationByIdAction
 * @description Obtiene una única organización por su ID.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * @param {string} id - El ID único de la organización a obtener.
 * @returns {Promise<ActionState<SelectOrganization>>} Un objeto ActionState indicando el éxito o fracaso y los datos de la organización.
 * @example
 * // Ejemplo de uso:
 * const org = await getOrganizationByIdAction("a1b2c3d4-e5f6-7890-1234-567890abcdef");
 * if (org.isSuccess) {
 *   console.log("Organización encontrada:", org.data);
 * } else {
 *   console.error("Error al obtener organización:", org.message);
 * }
 */
export async function getOrganizationByIdAction(
  id: string,
): Promise<ActionState<SelectOrganization>> {
  const { userId } = await auth()
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve organization by ID.")
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." }
  }

  try {
    const validatedId = z.string().uuid("ID de organización inválido.").safeParse(id)
    if (!validatedId.success) {
      const errorMessage = validatedId.error.errors.map(e => e.message).join(", ")
      logger.error(`Validation error for getOrganizationByIdAction: ${errorMessage}`)
      return { isSuccess: false, message: errorMessage }
    }

    const organization = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, validatedId.data))
      .limit(1) // Limitar a 1 ya que el ID es una clave primaria y debe ser único

    if (organization.length === 0) {
      logger.warn(`Organization with ID ${validatedId.data} not found for user ${userId}.`)
      return { isSuccess: false, message: "Organización no encontrada." }
    }

    logger.info(`Organization ${validatedId.data} retrieved by user ${userId}`)
    return {
      isSuccess: true,
      message: "Organización obtenida exitosamente.",
      data: organization[0],
    }
  } catch (error) {
    logger.error(`Error retrieving organization by ID: ${error instanceof Error ? error.message : String(error)}`)
    return { isSuccess: false, message: "Fallo al obtener la organización." }
  }
}

/**
 * @function updateOrganizationAction
 * @description Actualiza una organización existente en la base de datos.
 * Verifica la autenticación del usuario, valida los datos de entrada y
 * previene la creación de referencias circulares directas (`parentId` no puede ser el propio `id`).
 * @param {string} id - El ID de la organización a actualizar.
 * @param {Partial<Omit<InsertOrganization, 'id' | 'createdAt' | 'updatedAt'>>} data - Objeto con los datos parciales para actualizar la organización.
 * @returns {Promise<ActionState<SelectOrganization>>} Un objeto ActionState indicando el éxito o fracaso y los datos de la organización actualizada.
 * @example
 * // Ejemplo de uso:
 * const result = await updateOrganizationAction("a1b2c3d4-e5f6-7890-1234-567890abcdef", { name: "Nuevo Departamento", description: "Descripción actualizada" });
 * if (result.isSuccess) {
 *   console.log("Organización actualizada:", result.data);
 * } else {
 *   console.error("Error al actualizar organización:", result.message);
 * }
 */
export async function updateOrganizationAction(
  id: string,
  data: Partial<Omit<InsertOrganization, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<ActionState<SelectOrganization>> {
  const { userId } = await auth()
  if (!userId) {
    logger.warn("Unauthorized attempt to update organization.")
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." }
  }

  try {
    // Validar el ID de la organización y los datos de actualización
    const validatedUpdatePayload = updateOrganizationSchema.safeParse({ id, ...data })
    if (!validatedUpdatePayload.success) {
      const errorMessage = validatedUpdatePayload.error.errors.map(e => e.message).join(", ")
      logger.error(`Validation error for updateOrganizationAction: ${errorMessage}`)
      return { isSuccess: false, message: errorMessage }
    }

    const validatedId = validatedUpdatePayload.data.id;
    const validatedData = {
      name: validatedUpdatePayload.data.name,
      description: validatedUpdatePayload.data.description,
      parentId: validatedUpdatePayload.data.parentId,
      templateFromDatasetField: validatedUpdatePayload.data.templateFromDatasetField,
    };

    // Prevenir que una organización se establezca como su propia padre
    if (validatedData.parentId === validatedId) {
      logger.error(`Attempted to set organization ${validatedId} as its own parent.`)
      return { isSuccess: false, message: "Una organización no puede ser su propia padre." }
    }

    // Si se proporciona un parentId (y no es null), verificar que exista
    if (validatedData.parentId !== undefined && validatedData.parentId !== null) {
      const parentExists = await db
        .select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, validatedData.parentId))
        .limit(1)
      if (parentExists.length === 0) {
        logger.error(`Parent organization with ID ${validatedData.parentId} not found during update.`)
        return { isSuccess: false, message: "La organización padre especificada no existe." }
      }
    }

    // Realizar la actualización en la base de datos
    const [updatedOrganization] = await db
      .update(organizationsTable)
      .set(validatedData)
      .where(eq(organizationsTable.id, validatedId))
      .returning()

    // Verificar si la organización fue encontrada y actualizada
    if (!updatedOrganization) {
      logger.warn(`Organization with ID ${validatedId} not found for update by user ${userId}.`)
      return { isSuccess: false, message: "Organización no encontrada o no se pudo actualizar." }
    }

    logger.info(`Organization updated: ${updatedOrganization.id} by user ${userId}`)
    return {
      isSuccess: true,
      message: "Organización actualizada exitosamente.",
      data: updatedOrganization,
    }
  } catch (error) {
    logger.error(`Error updating organization: ${error instanceof Error ? error.message : String(error)}`)
    return { isSuccess: false, message: "Fallo al actualizar la organización." }
  }
}

/**
 * @function deleteOrganizationAction
 * @description Elimina una organización de la base de datos.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * La eliminación en cascada de organizaciones hijas y elementos de scorecard relacionados
 * es manejada por las restricciones de clave foránea en la base de datos.
 * @param {string} id - El ID de la organización a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 * @example
 * // Ejemplo de uso:
 * const result = await deleteOrganizationAction("a1b2c3d4-e5f6-7890-1234-567890abcdef");
 * if (result.isSuccess) {
 *   console.log("Organización eliminada.");
 * } else {
 *   console.error("Error al eliminar organización:", result.message);
 * }
 */
export async function deleteOrganizationAction(
  id: string,
): Promise<ActionState<undefined>> {
  const { userId } = await auth()
  if (!userId) {
    logger.warn("Unauthorized attempt to delete organization.")
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." }
  }

  try {
    const validatedId = deleteOrganizationSchema.safeParse({ id })
    if (!validatedId.success) {
      const errorMessage = validatedId.error.errors.map(e => e.message).join(", ")
      logger.error(`Validation error for deleteOrganizationAction: ${errorMessage}`)
      return { isSuccess: false, message: errorMessage }
    }

    // Verificar si la organización existe antes de intentar eliminarla
    const existingOrg = await db
      .select({ id: organizationsTable.id })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, validatedId.data.id))
      .limit(1);

    if (existingOrg.length === 0) {
      logger.warn(`Organization with ID ${validatedId.data.id} not found for deletion by user ${userId}.`);
      return { isSuccess: false, message: "Organización no encontrada." };
    }

    // Realizar la eliminación. Las organizaciones hijas y los elementos de scorecard
    // relacionados se eliminarán en cascada debido a las restricciones de la DB.
    await db
      .delete(organizationsTable)
      .where(eq(organizationsTable.id, validatedId.data.id))

    logger.info(`Organization deleted: ${validatedId.data.id} by user ${userId}`)
    return { isSuccess: true, message: "Organización eliminada exitosamente." }
  } catch (error) {
    logger.error(`Error deleting organization: ${error instanceof Error ? error.message : String(error)}`)
    return { isSuccess: false, message: "Fallo al eliminar la organización." }
  }
}