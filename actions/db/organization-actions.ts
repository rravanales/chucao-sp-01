/**
 * @file actions/db/organization-actions.ts
 * @brief Implementa Server Actions para la gestión de organizaciones en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear,
 * leer, actualizar y eliminar organizaciones. También incluye la acción para
 * crear organizaciones basadas en plantillas a partir de un listado de nombres,
 * replicando la estructura de Scorecards y KPIs de una organización existente.
 * Asegura la validación de datos, la unicidad y la protección de accesos no autorizados.
 */
"use server";

import { db } from "@/db/db";
import {
    InsertOrganization,
    SelectOrganization,
    organizationsTable,
} from "@/db/schema";
import { ActionState, fail, ok } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { replicateScorecardStructure, getDescendantOrganizations } from "@/lib/organization-utils";

const logger = getLogger("organization-actions");

/**
 * Formatea errores de Zod a un mensaje legible.
 */
const formatZodError = (error: z.ZodError) =>
  error.issues
    .map((i) => (i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join(" | ");


/**
 * @schema createOrganizationSchema
 * @description Esquema de validación para la creación de una nueva organización.
 */
const createOrganizationSchema = z.object({
    name: z
        .string()
        .min(1, "El nombre de la organización es requerido.")
        .max(255, "El nombre no puede exceder los 255 caracteres."),
    description: z
        .string()
        .max(1000, "La descripción no puede exceder los 1000 caracteres.")
        .optional()
        .nullable(),
    parentId: z.string().uuid("ID de organización padre inválido.").optional().nullable(),
    templateFromDatasetField: z
        .string()
        .max(255, "El campo de plantilla no puede exceder los 255 caracteres.")
        .optional()
        .nullable(),
});

/**
 * @schema updateOrganizationSchema
 * @description Esquema de validación para la actualización de una organización existente.
 * Permite campos opcionales para actualizaciones parciales.
 */
const updateOrganizationSchema = z.object({
    id: z.string().uuid("ID de organización inválido."),
    name: z
        .string()
        .min(1, "El nombre de la organización es requerido.")
        .max(255, "El nombre no puede exceder los 255 caracteres.")
        .optional(),
    description: z
        .string()
        .max(1000, "La descripción no puede exceder los 1000 caracteres.")
        .optional()
        .nullable(),
    parentId: z.string().uuid("ID de organización padre inválido.").optional().nullable(),
    templateFromDatasetField: z
        .string()
        .max(255, "El campo de plantilla no puede exceder los 255 caracteres.")
        .optional()
        .nullable(),
});

/**
 * @schema getOrganizationByIdSchema
 * @description Esquema de validación para obtener una organización por su ID.
 */
const getOrganizationByIdSchema = z.object({
    id: z.string().uuid("ID de organización inválido."),
});

/**
 * @schema deleteOrganizationSchema
 * @description Esquema de validación para la eliminación de una organización.
 */
const deleteOrganizationSchema = z.object({
    id: z.string().uuid("ID de organización inválido."),
});

/**
 * @schema createTemplatedOrganizationsFromDatasetSchema
 * @description Esquema de validación para la creación de organizaciones basadas en plantillas (UC-502).
 * @property {string} templateOrganizationId - ID de la organización plantilla, UUID requerido.
 * @property {string[]} newOrganizationNames - Array de nombres para las nuevas organizaciones, requerido.
 * @property {string} datasetFieldName - Nombre del campo del dataset que simula la fuente, requerido.
 */
const createTemplatedOrganizationsFromDatasetSchema = z.object({
    templateOrganizationId: z.string().uuid("ID de organización plantilla inválido."),
    newOrganizationNames: z
        .array(
            z
                .string()
                .min(1, "El nombre de la organización es requerido.")
                .max(255, "El nombre no puede exceder los 255 caracteres."),
        )
        .min(1, "Debe proporcionar al menos un nombre de organización para crear."),
    datasetFieldName: z
        .string()
        .min(1, "El nombre del campo del dataset es requerido.")
        .max(255, "El nombre del campo del dataset no puede exceder los 255 caracteres."),
});

/* -------------------------------------------------------------------------- */
/*                                Server Actions                              */
/* -------------------------------------------------------------------------- */

/**
 * @function createOrganizationAction
 * @description Crea una nueva organización en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Si se proporciona un parentId, verifica su existencia.
 * @param {Omit<InsertOrganization, 'id' | 'createdAt' | 'updatedAt'>} data - Objeto con los datos de la nueva organización, excluyendo campos auto-generados (id, createdAt, updatedAt).
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
    data: Omit<InsertOrganization, "id" | "createdAt" | "updatedAt">,
): Promise<ActionState<SelectOrganization>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to create organization.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    const validatedData = createOrganizationSchema.safeParse(data);
    if (!validatedData.success) {
        const errorMessage = formatZodError(validatedData.error);
        logger.error(`Validation error for createOrganizationAction: ${errorMessage}`);
        return fail(errorMessage);
    }

    const { name, description, parentId, templateFromDatasetField } = validatedData.data;

    try {
        // Verificar si ya existe una organización con el mismo nombre y padre (o sin padre)
        const existingOrganization = await db
            .select()
            .from(organizationsTable)
            .where(
                and(
                    eq(organizationsTable.name, name),
                    parentId ? eq(organizationsTable.parentId, parentId) : isNull(organizationsTable.parentId),
                ),
            )
            .limit(1);

        if (existingOrganization.length > 0) {
            return fail("Ya existe una organización con este nombre bajo el mismo padre.");
        }

        // Si se proporciona parentId, verificar que exista
        if (parentId) {
            const parent = await db
                .select()
                .from(organizationsTable)
                .where(eq(organizationsTable.id, parentId))
                .limit(1);
            if (parent.length === 0) {
                return fail("La organización padre especificada no existe.");
            }
        }

        const [newOrganization] = await db
            .insert(organizationsTable)
            .values({
                name,
                description,
                parentId,
                templateFromDatasetField,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        logger.info("Organization created successfully.", { newOrganizationId: newOrganization.id, userId });
        return ok("Organización creada exitosamente.", newOrganization);        
    } catch (error) {
        logger.error(
            `Error creating organization: ${error instanceof Error ? error.message : String(error)}`,
            { data },
        );
        return fail(`Fallo al crear la organización: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * @function getOrganizationByIdAction
 * @description Obtiene una organización específica por su ID.
 * @param {z.infer<typeof getOrganizationByIdSchema>} data - Objeto con el ID de la organización.
 * @returns {Promise<ActionState<SelectOrganization>>} Un objeto ActionState indicando el éxito o fracaso y los datos de la organización.
 */
export async function getOrganizationByIdAction(
    data: z.infer<typeof getOrganizationByIdSchema>,
): Promise<ActionState<SelectOrganization>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to retrieve organization by ID.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    const validatedData = getOrganizationByIdSchema.safeParse(data);
    if (!validatedData.success) {
        const errorMessage = formatZodError(validatedData.error);
        logger.error(`Validation error for getOrganizationByIdAction: ${errorMessage}`);
        return fail(errorMessage);
    }

    const { id } = validatedData.data;

    try {
        const organizationArr = await db
            .select()
            .from(organizationsTable)
            .where(eq(organizationsTable.id, id))
            .limit(1);

        // if (organization.length === 0) {
        const [organization] = organizationArr;
        if (!organization) {        
            return fail("Organización no encontrada.");
        }

        logger.info("Organization retrieved by ID successfully.", { organizationId: id, userId });
        return ok("Organización obtenida exitosamente.", organization );
    } catch (error) {
        logger.error(
            `Error retrieving organization by ID: ${error instanceof Error ? error.message : String(error)}`,
            { id },
        );
        return fail(`Fallo al obtener la organización: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * @function getOrganizationsAction
 * @description Obtiene una lista de organizaciones.
 * Puede filtrar por parentId para obtener hijos directos, o si parentId es null,
 * devolverá las organizaciones de nivel superior (sin padre).
 * @param {string | null | undefined} parentId - (Opcional) El ID del padre para filtrar hijos. undefined para todas las organizaciones sin filtro por padre.
 * @returns {Promise<ActionState<SelectOrganization[]>>} Un objeto ActionState indicando el éxito o fracaso y la lista de organizaciones.
 */
export async function getOrganizationsAction(
    parentId?: string | null,
): Promise<ActionState<SelectOrganization[]>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to retrieve organizations.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    // Validar parentId si se proporciona y no es null
    if (parentId !== undefined && parentId !== null) {
        const parentIdValidation = z.string().uuid("ID de organización padre inválido.").safeParse(parentId);
        if (!parentIdValidation.success) {
            const errorMessage = formatZodError(parentIdValidation.error);
            logger.error(`Validation error for getOrganizationsAction (parentId): ${errorMessage}`);
            return fail(errorMessage);
        }
    }

    try {
        const organizations = await db
            .select()
            .from(organizationsTable)
            .where(
              parentId === undefined
                ? undefined
                : parentId === null
                  ? isNull(organizationsTable.parentId)
                  : eq(organizationsTable.parentId, parentId)
            )            
            .orderBy(organizationsTable.name); // Ordenar por nombre para consistencia

        logger.info("Organizations retrieved successfully.", { count: organizations.length, userId, parentId });
        return ok("Organizaciones obtenidas exitosamente.", organizations);
    } catch (error) {
        logger.error(
            `Error retrieving organizations: ${error instanceof Error ? error.message : String(error)}`,
            { parentId },
        );
        return fail(`Fallo al obtener las organizaciones: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * @function updateOrganizationAction
 * @description Actualiza una organización existente en la base de datos.
 * Verifica la autenticación del usuario, valida los datos de entrada y
 * previene la creación de referencias circulares directas (parentId no puede ser el propio id).
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
    data: Partial<Omit<InsertOrganization, "id" | "createdAt" | "updatedAt">>,
): Promise<ActionState<SelectOrganization>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to update organization.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    const validatedData = updateOrganizationSchema.safeParse({ id, ...data }); // Incluir id en la validación
    if (!validatedData.success) {
        const errorMessage = formatZodError(validatedData.error);
        logger.error(`Validation error for updateOrganizationAction: ${errorMessage}`);
        return fail(errorMessage);
    }

    const { name, description, parentId, templateFromDatasetField } = validatedData.data;

    try {
        // Verificar que la organización exista
        const existingArr = await db
            .select()
            .from(organizationsTable)
            .where(eq(organizationsTable.id, id))
            .limit(1);

        const [existingOrganization] = existingArr;
        if (!existingOrganization) {            
            return fail("Organización no encontrada.");
        }

        // Prevenir auto-referencia (una organización no puede ser su propia padre)
        if (parentId && parentId === id) {
            return fail("Una organización no puede ser su propia padre.");
        }

        // Si se cambia el nombre o el parentId, verificar unicidad
        if (name !== undefined || parentId !== undefined) {
            const effectiveParentId =
              parentId !== undefined ? parentId : existingOrganization.parentId;
            const parentPredicate =
              effectiveParentId === null
                ? isNull(organizationsTable.parentId)
                : eq(organizationsTable.parentId, effectiveParentId);

            const siblingCheck = await db
                .select()
                .from(organizationsTable)
                .where(
                    and(
                        eq(organizationsTable.name, name ?? existingOrganization.name),
                        parentPredicate,                        
                        ne(organizationsTable.id, id), // Excluir la propia organización
                    ),
                )
                .limit(1);

            if (siblingCheck.length > 0) {
                return fail("Ya existe una organización con este nombre bajo el mismo padre.");
            }
        }


        // Construir patch solo con campos definidos
        const patch: Partial<typeof organizationsTable.$inferInsert> = {};
        if (name !== undefined) patch.name = name;
        if (description !== undefined) patch.description = description;
        if (parentId !== undefined) patch.parentId = parentId;
        if (templateFromDatasetField !== undefined) patch.templateFromDatasetField = templateFromDatasetField;
        patch.updatedAt = new Date();

        const [updatedOrganization] = await db        
            .update(organizationsTable)
            .set(patch)            
            .where(eq(organizationsTable.id, id))
            .returning();

        if (!updatedOrganization) {
            return fail("No se pudo actualizar la organización.");
        }

        logger.info("Organization updated successfully.", { organizationId: id, userId, updatedFields: data });
        return ok("Organización actualizada exitosamente.", updatedOrganization);
    } catch (error) {
        logger.error(
            `Error updating organization: ${error instanceof Error ? error.message : String(error)}`,
            { id, data },
        );
        return fail(`Fallo al actualizar la organización: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * @function deleteOrganizationAction
 * @description Elimina una organización de la base de datos.
 * La eliminación en cascada de organizaciones hijas, elementos de Scorecard y KPIs relacionados
 * es manejada por las restricciones de clave foránea en la base de datos.
 * @param {z.infer<typeof deleteOrganizationSchema>} data - Objeto con el ID de la organización a eliminar.
 * @returns {Promise<ActionState<undefined>>} Un objeto ActionState indicando el éxito o fracaso.
 */
export async function deleteOrganizationAction(
    data: z.infer<typeof deleteOrganizationSchema>,
): Promise<ActionState<undefined>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to delete organization.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    const validatedData = deleteOrganizationSchema.safeParse(data);
    if (!validatedData.success) {
        const errorMessage = formatZodError(validatedData.error);
        logger.error(`Validation error for deleteOrganizationAction: ${errorMessage}`);
        return fail(errorMessage);
    }

    const { id } = validatedData.data;

    try {
        const [deletedOrganization] = await db
            .delete(organizationsTable)
            .where(eq(organizationsTable.id, id))
            .returning();

        if (!deletedOrganization) {
            return fail("Organización no encontrada o ya eliminada.");
        }

        logger.info("Organization deleted successfully.", { organizationId: id, userId });
        return ok("Organización eliminada exitosamente.");
    } catch (error) {
        logger.error(
            `Error deleting organization: ${error instanceof Error ? error.message : String(error)}`,
            { id },
        );
        return fail(`Fallo al eliminar la organización: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * @function createTemplatedOrganizationsFromDatasetAction
 * @description Crea múltiples organizaciones hijas a partir de una organización plantilla (UC-502).
 * Replicará la estructura completa de Scorecards y KPIs de la plantilla para cada nueva organización hija.
 * @param {z.infer<typeof createTemplatedOrganizationsFromDatasetSchema>} data - Datos de la acción: templateOrganizationId, newOrganizationNames, datasetFieldName.
 * @returns {Promise<ActionState<SelectOrganization[]>>} Un objeto ActionState indicando el éxito o fracaso y los datos de las organizaciones creadas.
 */
export async function createTemplatedOrganizationsFromDatasetAction(
    data: z.infer<typeof createTemplatedOrganizationsFromDatasetSchema>,
): Promise<ActionState<SelectOrganization[]>> {
    const { userId } = await auth();
    if (!userId) {
        logger.warn("Unauthorized attempt to create templated organizations.");
        return fail("No autorizado. Debe iniciar sesión.");
    }

    const validatedData = createTemplatedOrganizationsFromDatasetSchema.safeParse(data);
    if (!validatedData.success) {
        const errorMessage = formatZodError(validatedData.error);
        logger.error(`Validation error for createTemplatedOrganizationsFromDatasetAction: ${errorMessage}`);
        return fail(errorMessage);
    }

    const { templateOrganizationId, newOrganizationNames, datasetFieldName } = validatedData.data;

    try {
        // 1. Verificar que la organización plantilla exista
        const templateOrgArr = await db        
            .select()
            .from(organizationsTable)
            .where(eq(organizationsTable.id, templateOrganizationId))
            .limit(1);

        const [templateOrg] = templateOrgArr;
        if (!templateOrg) {            
            return fail("La organización plantilla especificada no existe.");
        }
        const createdOrganizations: SelectOrganization[] = [];

        // 2. Iterar sobre cada nombre de nueva organización y crearla, replicando la estructura
        for (const orgName of newOrganizationNames) {
            await db.transaction(async (tx) => {
                // Verificar unicidad antes de crear la nueva organización
                const existingOrg = await tx
                    .select()
                    .from(organizationsTable)
                    .where(
                        and(
                            eq(organizationsTable.name, orgName),
                            eq(organizationsTable.parentId, templateOrganizationId),
                        ),
                    )
                    .limit(1);

                if (existingOrg.length > 0) {
                    logger.warn(`Skipping creation for organization '${orgName}': A child organization with this name already exists under the template parent.`);
                    return; // Skip this one, continue with others
                }

                // Crear la nueva organización hija
                const [newOrg] = await tx
                    .insert(organizationsTable)
                    .values({
                        name: orgName,
                        description: `Organización generada a partir de plantilla '${templateOrg.name}' usando el campo '${datasetFieldName}'.`,
                        parentId: templateOrganizationId, // La plantilla es el padre directo
                        templateFromDatasetField: datasetFieldName, // Registrar de qué campo se generó
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();

                if (!newOrg) {
                    throw new Error(`Failed to create new organization: ${orgName}`);
                }

                createdOrganizations.push(newOrg);

                // Replicar la estructura de Scorecard y KPIs de la plantilla a la nueva organización
                await replicateScorecardStructure(tx, templateOrganizationId, newOrg.id, userId);

                logger.info(`Organization '${orgName}' created and scorecard replicated successfully.`);
            });
        }

        if (createdOrganizations.length === 0 && newOrganizationNames.length > 0) {
            return fail("No se pudo crear ninguna organización. Verifique si ya existen organizaciones con los nombres proporcionados bajo la plantilla.");
        }

        logger.info(`Successfully created ${createdOrganizations.length} templated organizations.`, { userId, templateOrganizationId });
        return ok("Organizaciones basadas en plantillas creadas y replicadas exitosamente.",
            createdOrganizations,
        );
    } catch (error) {
        logger.error(
            `Error creating templated organizations: ${error instanceof Error ? error.message : String(error)}`,
            { data },
        );
        return fail(
            `Fallo al crear organizaciones basadas en plantillas: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}