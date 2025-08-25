/**
 * @file actions/db/scorecard-element-actions.ts
 * @brief Implementa Server Actions para la gestión de elementos del Scorecard en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, leer,
 * actualizar, eliminar y reordenar elementos del Scorecard (perspectivas, objetivos,
 * iniciativas, KPIs). Asegura la validación de datos, la unicidad en la jerarquía
 * y la protección de accesos no autorizados.
 */

"use server"

import { db } from "@/db/db"
import {
  InsertScorecardElement,
  SelectScorecardElement,
  scorecardElementsTable,
  scorecardElementTypeEnum,
} from "@/db/schema"
import { ActionState } from "@/types"
import { auth } from "@clerk/nextjs/server"
import { and, eq, isNull, ne, asc } from "drizzle-orm";
import { z } from "zod"
import { getLogger } from "@/lib/logger"

const logger = getLogger("scorecard-element-actions")

type InsertRow = typeof scorecardElementsTable.$inferInsert;
type SelectRow = typeof scorecardElementsTable.$inferSelect;
type UpdateRow = Partial<InsertRow>;

// helper chico
async function firstOrUndefined<T>(q: Promise<T[]>): Promise<T | undefined> {
  const rows = await q;
  return rows[0];
}


/**
 * @schema createScorecardElementSchema
 * @description Esquema de validación para la creación de un nuevo elemento de Scorecard.
 * @property {string} name - Nombre del elemento, requerido y máximo 255 caracteres.
 * @property {string} description - Descripción opcional, máximo 1000 caracteres.
 * @property {string} parentId - ID del elemento padre, UUID opcional y nullable.
 * @property {string} organizationId - ID de la organización, UUID requerido.
 * @property {scorecardElementTypeEnum} elementType - Tipo de elemento de Scorecard, requerido.
 * @property {string} ownerUserId - ID del usuario propietario, opcional y nullable.
 * @property {number} weight - Peso del elemento, número entre 0 y 1000, por defecto 1.0.
 * @property {number} orderIndex - Índice de orden, entero no negativo, por defecto 0.
 */
const createScorecardElementSchema = z.object({
  name: z.string().min(1, "El nombre del elemento es requerido.").max(255, "El nombre no puede exceder los 255 caracteres."),
  description: z.string().max(1000, "La descripción no puede exceder los 1000 caracteres.").optional().nullable(),
  parentId: z.string().uuid("ID de elemento padre inválido.").optional().nullable(),
  organizationId: z.string().uuid("ID de organización inválido."),
  elementType: z.enum(scorecardElementTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de elemento de Scorecard inválido." }),
  }),
  ownerUserId: z.string().optional().nullable(),
  weight: z.coerce.number().min(0, "El peso no puede ser negativo.").max(1000, "El peso no puede exceder 1000.").default(1.0),
  orderIndex: z.number().int().min(0, "El índice de orden no puede ser negativo.").default(0),
})

/**
 * @schema updateScorecardElementSchema
 * @description Esquema de validación para la actualización de un elemento de Scorecard existente.
 * Permite campos opcionales ya que se puede actualizar solo una parte del elemento.
 * @property {string} id - ID del elemento de Scorecard, UUID requerido.
 * @property {string} name - Nombre del elemento, opcional y máximo 255 caracteres.
 * @property {string} description - Descripción opcional, máximo 1000 caracteres.
 * @property {string} parentId - ID del elemento padre, UUID opcional y nullable.
 * @property {string} organizationId - ID de la organización, UUID opcional.
 * @property {scorecardElementTypeEnum} elementType - Tipo de elemento de Scorecard, opcional.
 * @property {string} ownerUserId - ID del usuario propietario, opcional y nullable.
 * @property {number} weight - Peso del elemento, número entre 0 y 1000, opcional.
 * @property {number} orderIndex - Índice de orden, entero no negativo, opcional.
 */
const updateScorecardElementSchema = z.object({
  id: z.string().uuid("ID de elemento de Scorecard inválido."),
  name: z.string().min(1, "El nombre del elemento es requerido.").max(255, "El nombre no puede exceder los 255 caracteres.").optional(),
  description: z.string().max(1000, "La descripción no puede exceder los 1000 caracteres.").optional().nullable(),
  parentId: z.string().uuid("ID de elemento padre inválido.").nullable().optional(),
  organizationId: z.string().uuid("ID de organización inválido.").optional(),
  elementType: z.enum(scorecardElementTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de elemento de Scorecard inválido." }),
  }).optional(),
  ownerUserId: z.string().optional().nullable(),
  weight: z.coerce.number().min(0, "El peso no puede ser negativo.").max(1000, "El peso no puede exceder 1000.").optional(),
  orderIndex: z.number().int().min(0, "El índice de orden no puede ser negativo.").optional(),
})

/**
 * @schema deleteScorecardElementSchema
 * @description Esquema de validación para la eliminación de un elemento de Scorecard.
 * @property {string} id - ID del elemento de Scorecard, UUID requerido.
 */
const deleteScorecardElementSchema = z.object({
  id: z.string().uuid("ID de elemento de Scorecard inválido."),
})

/**
 * @schema reorderScorecardElementItemSchema
 * @description Esquema de validación para un único elemento en la acción de reordenar.
 * @property {string} id - ID del elemento, UUID requerido.
 * @property {string | null | "null"} parentId - Nuevo ID del elemento padre, UUID opcional, nullable, o la cadena "null".
 * @property {number} orderIndex - Nuevo índice de orden, entero no negativo y requerido.
 */
const reorderScorecardElementItemSchema = z.object({
  id: z.string().uuid("ID de elemento de Scorecard inválido."),
  parentId: z.string().uuid("ID de elemento padre inválido.").nullable().or(z.literal("null")).optional(), // Permite "null" string para flexibilidad de la API
  orderIndex: z.number().int().min(0, "El índice de orden no puede ser negativo."),
});


/**
 * @schema reorderScorecardElementsSchema
 * @description Esquema de validación para la acción de reordenar múltiples elementos de Scorecard.
 * Es un array de `reorderScorecardElementItemSchema`.
 */
//const reorderScorecardElementsSchema = z.array(reorderScorecardElementItemSchema);
const reorderScorecardElementsSchema = z
  .array(reorderScorecardElementItemSchema)
  .min(1, "Debe enviar al menos un elemento a reordenar.");


/**
 * @function createScorecardElementAction
 * @description Crea un nuevo elemento de Scorecard en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Asegura la unicidad del nombre dentro del mismo nivel jerárquico y organización.
 * @param {Omit<InsertScorecardElement, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos del nuevo elemento de Scorecard, excluyendo campos auto-generados.
 * @returns {Promise<ActionState<SelectScorecardElement>>} Un objeto ActionState indicando el éxito o fracaso y los datos del elemento creado.
 * @notes
 *   - El `ownerUserId` y `parentId` se sanitizan para convertir cadenas vacías a `null` antes de la validación y la inserción.
 *   - Se realiza una comprobación de duplicados para `name` bajo el mismo `parentId` y `organizationId`.
 * @throws {Error} Si ocurre un error inesperado durante la operación de base de datos.
 */
export async function createScorecardElementAction(
  data: Omit<InsertScorecardElement, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ActionState<SelectScorecardElement>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create scorecard element.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  // Asegurar que ownerUserId y parentId sean null si son cadenas vacías, para que coincidan con el esquema DB.
  const sanitizedData = {
    ...data,
    ownerUserId: data.ownerUserId === '' ? null : data.ownerUserId,
    parentId: data.parentId === '' ? null : data.parentId,
  };

  const validatedData = createScorecardElementSchema.safeParse(sanitizedData);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map(e => e.message).join(", ");
    logger.error(`Validation error for createScorecardElementAction: ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  try {
    // Verificar si ya existe un elemento con el mismo nombre, organizationId y parentId
    const payload = validatedData.data; // tipado fuerte para Drizzle

    const parentCond =
    payload.parentId == null
        ? isNull(scorecardElementsTable.parentId)
        : eq(scorecardElementsTable.parentId, payload.parentId);

    const existingElement = await firstOrUndefined(
    db
        .select()
        .from(scorecardElementsTable)
        .where(and(
        eq(scorecardElementsTable.name, payload.name),
        eq(scorecardElementsTable.organizationId, payload.organizationId),
        parentCond
        ))
        .limit(1)
    );

    if (existingElement) {
      logger.warn(`Attempted to create duplicate scorecard element: ${validatedData.data.name} under parent ${validatedData.data.parentId} in organization ${validatedData.data.organizationId}`);
      return { isSuccess: false, message: "Ya existe un elemento de Scorecard con el mismo nombre en este nivel jerárquico." };
    }

    // const [newElement] = await db.insert(scorecardElementsTable).values(validatedData.data).returning();

    const toInsert: InsertRow = {
        name: payload.name,
        description: payload.description ?? null,
        parentId: payload.parentId ?? null,
        organizationId: payload.organizationId,
        elementType: payload.elementType,
        ownerUserId: payload.ownerUserId ?? null,
        weight: String(payload.weight ?? 1),
        orderIndex: payload.orderIndex ?? 0,
        // si tu esquema requiere createdAt/updatedAt por defecto, déjalo a la DB
    };

    const [newElement] = await db.insert(scorecardElementsTable).values(toInsert).returning();

    if (!newElement) {
      logger.error("Failed to retrieve the newly created scorecard element.");
      return { isSuccess: false, message: "Fallo al crear el elemento de Scorecard." };
    }

    logger.info(`Scorecard element created successfully: ${newElement.id} - ${newElement.name}`);
    return { isSuccess: true, message: "Elemento de Scorecard creado exitosamente.", data: newElement };
  } catch (error) {
    logger.error(`Error creating scorecard element: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al crear el elemento de Scorecard." };
  }
}

/**
 * @function getScorecardElementsAction
 * @description Obtiene una lista de elementos de Scorecard.
 * Puede filtrar por `organizationId` y opcionalmente por `parentId` para obtener hijos directos,
 * o si `parentId` es `null`, devolverá los elementos de nivel superior (sin padre) para esa organización.
 * Si `organizationId` es nulo, la acción fallará ya que todos los elementos de scorecard pertenecen a una organización.
 * @param {string} organizationId - El ID de la organización a la que pertenecen los elementos.
 * @param {string | null | undefined} parentId - (Opcional) El ID del elemento padre para filtrar los hijos. `undefined` para todos los elementos de la organización sin filtro por padre.
 * @returns {Promise<ActionState<SelectScorecardElement[]>>} Un objeto ActionState indicando el éxito o fracaso y la lista de elementos.
 * @notes
 *   - Utiliza `isNull` de Drizzle para la comparación con `null` en la base de datos.
 *   - Los resultados se ordenan por `orderIndex`.
 * @throws {Error} Si ocurre un error inesperado durante la operación de base de datos.
 */
export async function getScorecardElementsAction(
  organizationId: string,
  parentId?: string | null,
): Promise<ActionState<SelectScorecardElement[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve scorecard elements.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  // Validar organizationId
  const orgIdValidation = z.string().uuid("ID de organización inválido.").safeParse(organizationId);
  if (!orgIdValidation.success) {
    const errorMessage = orgIdValidation.error.errors.map(e => e.message).join(", ");
    logger.error(`Validation error for getScorecardElementsAction (organizationId): ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  // Validar parentId si se proporciona y no es null
  if (parentId !== undefined && parentId !== null) {
    const parentIdValidation = z.string().uuid("ID de elemento padre inválido.").safeParse(parentId);
    if (!parentIdValidation.success) {
      const errorMessage = parentIdValidation.error.errors.map(e => e.message).join(", ");
      logger.error(`Validation error for getScorecardElementsAction (parentId): ${errorMessage}`);
      return { isSuccess: false, message: errorMessage };
    }
  }

  try {
    //const whereConditions = [eq(scorecardElementsTable.organizationId, organizationId)];
    const whereConditions = [eq(scorecardElementsTable.organizationId, organizationId)];

    if (parentId === null) {
      whereConditions.push(isNull(scorecardElementsTable.parentId));
    } else if (parentId !== undefined) { // Si parentId se proporciona y no es null
      whereConditions.push(eq(scorecardElementsTable.parentId, parentId));
    }
    // Si parentId es undefined, no se aplica filtro por padre (obtiene todos para la organización)
    const elements = await db
      .select()
      .from(scorecardElementsTable)
      .where(and(...whereConditions))
      .orderBy(asc(scorecardElementsTable.orderIndex));

    logger.info(`Retrieved ${elements.length} scorecard elements for organization ${organizationId}.`);
    return { isSuccess: true, message: "Elementos de Scorecard obtenidos exitosamente.", data: elements };
  } catch (error) {
    logger.error(`Error retrieving scorecard elements: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al obtener los elementos de Scorecard." };
  }
}

/**
 * @function updateScorecardElementAction
 * @description Actualiza un elemento de Scorecard existente en la base de datos.
 * Verifica la autenticación del usuario, valida los datos de entrada y
 * previene la creación de referencias circulares (parentId no puede ser el propio id).
 * También verifica la unicidad del nombre si se cambia.
 * @param {string} id - El ID del elemento de Scorecard a actualizar.
 * @param {Partial<Omit<InsertScorecardElement, 'id' | 'createdAt' | 'updatedAt'>>} data - Objeto con los datos parciales para actualizar el elemento de Scorecard.
 * @returns {Promise<ActionState<SelectScorecardElement>>} Un objeto ActionState indicando el éxito o fracaso y los datos del elemento actualizado.
 * @notes
 *   - El `ownerUserId` y `parentId` se sanitizan para convertir cadenas vacías a `null`.
 *   - Se previene que un elemento sea su propio padre.
 *   - Se verifica la unicidad del nombre si los campos relevantes cambian, excluyendo el propio elemento de la comprobación.
 *   - `updatedAt` se establece manualmente para asegurar su actualización.
 * @throws {Error} Si ocurre un error inesperado durante la operación de base de datos.
 */
export async function updateScorecardElementAction(
  id: string,
  data: Partial<Omit<InsertScorecardElement, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<ActionState<SelectScorecardElement>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update scorecard element.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  // Asegurar que ownerUserId y parentId sean null si son cadenas vacías, para que coincidan con el esquema DB.
  const sanitizedData = {
    ...data,
    ownerUserId: data.ownerUserId === '' ? null : data.ownerUserId,
    parentId: data.parentId === '' ? null : data.parentId,
  };

  const validatedPayload = updateScorecardElementSchema.safeParse({ id, ...sanitizedData });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map(e => e.message).join(", ");
    logger.error(`Validation error for updateScorecardElementAction: ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  const { id: elementId, ...updateData } = validatedPayload.data;

  try {
    // Prevenir que un elemento sea su propio padre
    if (updateData.parentId === elementId) {
      logger.warn(`Attempted to set scorecard element ${elementId} as its own parent.`);
      return { isSuccess: false, message: "Un elemento no puede ser su propio padre." };
    }

    // Buscar el elemento existente para verificar la unicidad del nombre y el organizationId/parentId actual
    const existingElement = await firstOrUndefined(
    db.select().from(scorecardElementsTable)
        .where(eq(scorecardElementsTable.id, elementId))
        .limit(1)
    );      
        
    if (!existingElement) {
      logger.warn(`Scorecard element with ID ${elementId} not found for update.`);
      return { isSuccess: false, message: "Elemento de Scorecard no encontrado." };
    }

    // Verificar la unicidad del nombre si el nombre, parentId o organizationId están siendo actualizados
    const newName = updateData.name ?? existingElement.name;
    const newParentId = updateData.parentId !== undefined ? updateData.parentId : existingElement.parentId;
    const newOrganizationId = updateData.organizationId ?? existingElement.organizationId;

    // Solo verificar la unicidad si el nombre, parentId u organizationId han cambiado
    if (
      newName !== existingElement.name ||
      newParentId !== existingElement.parentId ||
      newOrganizationId !== existingElement.organizationId
    ) {
      const parentCond =
        newParentId == null
          ? isNull(scorecardElementsTable.parentId)
          : eq(scorecardElementsTable.parentId, newParentId);

      const duplicateCheck = await firstOrUndefined(
        db.select().from(scorecardElementsTable).where(and(
            eq(scorecardElementsTable.name, newName),
            eq(scorecardElementsTable.organizationId, newOrganizationId),
            parentCond,
            ne(scorecardElementsTable.id, elementId)
        )).limit(1)
      );

      if (duplicateCheck) { // Si se encuentra un duplicado (y no es el mismo elemento)
        logger.warn(`Attempted to update scorecard element to a duplicate name: ${newName} under parent ${newParentId} in organization ${newOrganizationId}`);
        return { isSuccess: false, message: "Ya existe un elemento de Scorecard con el mismo nombre en este nivel jerárquico." };
      }
    }

    // Construir objeto SET tipado    
    const setObj: UpdateRow = { updatedAt: new Date() };

    if (updateData.name !== undefined) setObj.name = updateData.name;
    if (updateData.description !== undefined) setObj.description = updateData.description ?? null;
    if (updateData.parentId !== undefined) setObj.parentId = updateData.parentId ?? null;
    if (updateData.organizationId !== undefined) setObj.organizationId = updateData.organizationId;
    if (updateData.elementType !== undefined) setObj.elementType = updateData.elementType;
    if (updateData.ownerUserId !== undefined) setObj.ownerUserId = updateData.ownerUserId ?? null;
    if (updateData.weight !== undefined) setObj.weight = String(updateData.weight)
    if (updateData.orderIndex !== undefined) setObj.orderIndex = updateData.orderIndex;

    const [updatedElement] = await db
      .update(scorecardElementsTable)
      .set(setObj)
      .where(eq(scorecardElementsTable.id, elementId))
      .returning();


    if (!updatedElement) {
      logger.error(`Failed to retrieve the updated scorecard element for ID: ${elementId}.`);
      return { isSuccess: false, message: "Fallo al actualizar el elemento de Scorecard." };
    }

    logger.info(`Scorecard element updated successfully: ${updatedElement.id} - ${updatedElement.name}`);
    return { isSuccess: true, message: "Elemento de Scorecard actualizado exitosamente.", data: updatedElement };
  } catch (error) {
    logger.error(`Error updating scorecard element: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al actualizar el elemento de Scorecard." };
  }
}

/**
 * @function deleteScorecardElementAction
 * @description Elimina un elemento de Scorecard de la base de datos.
 * Verifica la autenticación del usuario y valida el ID de entrada.
 * La eliminación en cascada de elementos hijos y KPIs relacionados
 * es manejada por las restricciones de clave foránea en la base de datos.
 * @param {string} id - El ID del elemento de Scorecard a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 * @notes
 *   - La eliminación en cascada es configurada a nivel de esquema de base de datos (`onDelete: "cascade"`).
 * @throws {Error} Si ocurre un error inesperado durante la operación de base de datos.
 */
export async function deleteScorecardElementAction(
  id: string,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete scorecard element.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  const validatedId = deleteScorecardElementSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map(e => e.message).join(", ");
    logger.error(`Validation error for deleteScorecardElementAction: ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  try {
    const [deletedElement] = await db
      .delete(scorecardElementsTable)
      .where(eq(scorecardElementsTable.id, validatedId.data.id))
      .returning();

    if (!deletedElement) {
        logger.warn(`Scorecard element with ID ${validatedId.data.id} not found for deletion.`);
        return { isSuccess: false, message: "Elemento de Scorecard no encontrado o ya eliminado." };
    }

    logger.info(`Scorecard element deleted successfully: ${validatedId.data.id}`);
    return { isSuccess: true, message: "Elemento de Scorecard eliminado exitosamente." };
  } catch (error) {
    logger.error(`Error deleting scorecard element: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al eliminar el elemento de Scorecard." };
  }
}

/**
 * @function reorderScorecardElementsAction
 * @description Reordena y/o cambia el padre de múltiples elementos de Scorecard en una operación por lotes.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Esta acción es crucial para la funcionalidad de arrastrar y soltar en la interfaz de usuario del Scorecard.
 * @param {Array<{ id: string; parentId: string | null | "null"; orderIndex: number }>} elements - Un array de objetos, cada uno conteniendo el ID del elemento, el nuevo ID de padre (o null), y el nuevo índice de orden.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 * @assumptions
 *   - Los IDs de los elementos en el array existen en la base de datos.
 *   - Los `parentId` referenciados son válidos o nulos.
 *   - La lógica de la UI asegura que los `orderIndex` proporcionados son consistentes dentro de cada nivel.
 * @limitations
 *   - No se realiza una validación exhaustiva de la consistencia de la jerarquía (ej., prevención de ciclos complejos) más allá de la auto-referencia.
 *   - No se verifica la pertenencia a la misma organización para todos los elementos en esta operación por lotes; se asume que la UI ya lo filtra.
 * @notes
 *   - Utiliza una transacción para asegurar que todas las actualizaciones se realicen o ninguna.
 *   - Normaliza la cadena `"null"` a un valor `null` para `parentId`.
 * @throws {Error} Si ocurre un error de validación o un error inesperado durante la operación de base de datos.
 */
export async function reorderScorecardElementsAction(
  elements: Array<{ id: string; parentId: string | null | "null"; orderIndex: number }>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to reorder scorecard elements.");
    return { isSuccess: false, message: "No autorizado. Debe iniciar sesión." };
  }

  const validatedElements = reorderScorecardElementsSchema.safeParse(elements);
  if (!validatedElements.success) {
    const errorMessage = validatedElements.error.errors.map(e => e.message).join(", ");
    logger.error(`Validation error for reorderScorecardElementsAction: ${errorMessage}`);
    return { isSuccess: false, message: errorMessage };
  }

  try {
    await db.transaction(async (tx) => {
      for (const element of validatedElements.data) {
        // Normalizar parentId de la cadena "null" al valor null real
        const newParentId = element.parentId === "null" ? null : element.parentId;

        // Prevenir que un elemento sea su propio padre
        if (newParentId === element.id) {
          // Si esto ocurre, se revierte toda la transacción y se lanza un error.
          throw new Error("Un elemento no puede ser su propio padre.");
        }

        // Actualizar parentId y orderIndex para el elemento
        await tx.update(scorecardElementsTable)
          .set({
              parentId: newParentId,
              orderIndex: element.orderIndex,
              updatedAt: new Date(),
          } satisfies UpdateRow)
          .where(eq(scorecardElementsTable.id, element.id));
      }
    });

    logger.info(`Scorecard elements reordered successfully.`);
    return { isSuccess: true, message: "Elementos de Scorecard reordenados exitosamente." };
  } catch (error) {
    // Capturar errores lanzados por la propia transacción (ej. auto-referencia de padre) o errores de la DB.
    logger.error(`Error reordering scorecard elements: ${error instanceof Error ? error.message : String(error)}`);
    return { isSuccess: false, message: "Fallo al reordenar los elementos de Scorecard." };
  }
}