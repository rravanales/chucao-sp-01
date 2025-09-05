/**
 * @file actions/db/organization-actions2.ts
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
import {
  replicateScorecardStructure,
  getDescendantOrganizations,
} from "@/lib/organization-utils";

const logger = getLogger("organization-actions");

/**
 * Formatea errores de Zod a un mensaje legible.
 */
const formatZodError = (error: z.ZodError) =>
  error.issues
    .map((i) =>
      i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join(" | ");

/**
 * @schema createOrganizationSchema
 * @description Esquema de validación para la creación de una nueva organización.
 * @property {string} name - Nombre de la organización, requerido y máximo 255 caracteres.
 * @property {string | null} [description] - Descripción opcional, máximo 1000 caracteres.
 * @property {string | null} [parentId] - ID de la organización padre, UUID opcional y nullable.
 * @property {string | null} [templateFromDatasetField] - Nombre del campo del dataset para plantillas, opcional y nullable.
 */
const createOrganizationSchema = z
  .object({
    name: z
      .string()
      .min(1, "El nombre de la organización es requerido.")
      .max(255, "El nombre no puede exceder los 255 caracteres."),
    description: z
      .string()
      .max(1000, "La descripción no puede exceder los 1000 caracteres.")
      .optional()
      .nullable(),
    parentId: z
      .string()
      .uuid("ID de organización padre inválido.")
      .optional()
      .nullable(),
    templateFromDatasetField: z
      .string()
      .max(255, "El nombre del campo del dataset no puede exceder 255 caracteres.")
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      // Regla de negocio: Si se proporciona un parentId, no puede ser una cadena vacía.
      if ((data.parentId as unknown) === "") return false;
      return true;
    },
    {
      message: "El ID de organización padre no puede ser una cadena vacía.",
      path: ["parentId"],
    },
  );

/**
 * @schema updateOrganizationSchema
 * @description Esquema de validación para la actualización de una organización existente.
 * Permite campos opcionales para actualizaciones parciales.
 * @property {string} id - ID de la organización a actualizar, UUID requerido.
 * @property {string} [name] - Nombre de la organización, opcional y máximo 255 caracteres.
 * @property {string | null} [description] - Descripción opcional, máximo 1000 caracteres.
 * @property {string | null} [parentId] - ID de la organización padre, UUID opcional y nullable.
 * @property {string | null} [templateFromDatasetField] - Nombre del campo del dataset para plantillas, opcional y nullable.
 */
const updateOrganizationSchema = z
  .object({
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
    parentId: z
      .string()
      .uuid("ID de organización padre inválido.")
      .optional()
      .nullable(),
    templateFromDatasetField: z
      .string()
      .max(255, "El nombre del campo del dataset no puede exceder 255 caracteres.")
      .optional()
      .nullable(),
  })
  .refine(
    (data) => {
      if (data.parentId === data.id) return false; // Prevenir referencias circulares directas
      if ((data.parentId as unknown) === "") return false; // No permitir cadena vacía
      return true;
    },
    {
      message:
        "El ID de padre no puede ser igual al ID de la organización, ni una cadena vacía.",
      path: ["parentId"],
    },
  );

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

/**
 * @schema getAllOrganizationsSchema
 * @description Esquema de validación para obtener todas las organizaciones, opcionalmente filtrado por parentId.
 * @property {string | null | undefined} parentId - ID del elemento padre para filtrar los hijos, opcional y nullable.
 */
const getAllOrganizationsSchema = z
  .object({
    parentId: z.string().uuid("ID de organización padre inválido.").nullable().optional(),
  })
  .optional(); // permitir llamar sin parámetros

/* -------------------------------------------------------------------------- */
/*                                 Server Actions                             */
/* -------------------------------------------------------------------------- */

/**
 * @function createOrganizationAction
 * @description Crea una nueva organización en la base de datos.
 * Verifica la autenticación del usuario y valida los datos de entrada.
 * Si se proporciona un parentId, verifica su existencia.
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

  const { name, description, parentId, templateFromDatasetField } =
    validatedData.data;

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
      return fail("Ya existe una organización con este nombre en este nivel.");
    }

    // Verificar que el parentId, si se proporciona, exista
    if (parentId) {
      const parentOrg = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.id, parentId))
        .limit(1);
      if (parentOrg.length === 0) {
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

    if (!newOrganization) {
      return fail("Fallo al crear la organización.");
    }

    logger.info("Organización creada exitosamente.", {
      organizationId: newOrganization.id,
      name: newOrganization.name,
    });
    return ok("Organización creada exitosamente.", newOrganization);
  } catch (error) {
    logger.error(
      `Error creating organization: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail(
      `Fallo al crear la organización: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function getOrganizationByIdAction
 * @description Obtiene una organización específica por su ID.
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

    const [organization] = organizationArr;
    if (!organization) {
      return fail("Organización no encontrada.");
    }

    logger.info("Organización obtenida exitosamente por ID.", {
      organizationId: id,
    });
    return ok("Organización obtenida exitosamente.", organization);
  } catch (error) {
    logger.error(
      `Error retrieving organization by ID: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(
      `Fallo al obtener la organización: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function updateOrganizationAction
 * @description Actualiza una organización existente en la base de datos.
 * Verifica la autenticación del usuario, valida los datos de entrada y
 * previene la creación de referencias circulares directas (parentId no puede ser el propio id).
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

  const { name, description, parentId, templateFromDatasetField } =
    validatedData.data;

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

    // Si se cambia el nombre o el parentId, verificar unicidad bajo el padre efectivo
    if (name !== undefined || parentId !== undefined) {
      const effectiveName = name ?? existingOrganization.name;
      const effectiveParentId =
        parentId === undefined ? existingOrganization.parentId : parentId;

      const nameConflict = await db
        .select()
        .from(organizationsTable)
        .where(
          and(
            eq(organizationsTable.name, effectiveName),
            effectiveParentId === null
              ? isNull(organizationsTable.parentId)
              : eq(organizationsTable.parentId, effectiveParentId),
            ne(organizationsTable.id, id), // Excluir la propia organización al verificar duplicados
          ),
        )
        .limit(1);
      if (nameConflict.length > 0) {
        return fail("Ya existe otra organización con este nombre en este nivel.");
      }
    }

    // Verificar que el nuevo parentId, si se proporciona, exista y no sea la propia organización ni un descendiente
    if (parentId && parentId !== existingOrganization.parentId) {
      if (parentId === id) {
        return fail("Una organización no puede ser su propio padre.");
      }
      const parentOrg = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.id, parentId))
        .limit(1);
      if (parentOrg.length === 0) {
        return fail("La organización padre especificada no existe.");
      }

      // Prevenir ciclos de ancestros (ej. si se intenta mover a un descendiente como padre).
      // Nota: asumimos que getDescendantOrganizations requiere (organizationId, db)
      // y retorna string[] o { id: string }[]. Normalizamos a booleano.
      const descendants = (await getDescendantOrganizations(parentId, db as any)) as
        | string[]
        | Array<{ id: string }>;

      const isDescendant = Array.isArray(descendants)
        ? (descendants as any[]).some((d) =>
            typeof d === "string" ? d === id : d?.id === id,
          )
        : false;

      if (isDescendant) {
        return fail("No se puede asignar un descendiente como organización padre.");
      }
    }

    // Construir patch solo con campos definidos
    const patch: Partial<typeof organizationsTable.$inferInsert> = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (parentId !== undefined) patch.parentId = parentId;
    if (templateFromDatasetField !== undefined)
      patch.templateFromDatasetField = templateFromDatasetField;
    patch.updatedAt = new Date();

    const [updatedOrganization] = await db
      .update(organizationsTable)
      .set(patch)
      .where(eq(organizationsTable.id, id))
      .returning();

    if (!updatedOrganization) {
      return fail("Fallo al actualizar la organización.");
    }

    logger.info("Organización actualizada exitosamente.", {
      organizationId: updatedOrganization.id,
      name: updatedOrganization.name,
    });
    return ok("Organización actualizada exitosamente.", updatedOrganization);
  } catch (error) {
    logger.error(
      `Error updating organization: ${error instanceof Error ? error.message : String(error)}`,
      { id, data },
    );
    return fail(
      `Fallo al actualizar la organización: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function deleteOrganizationAction
 * @description Elimina una organización de la base de datos.
 * La eliminación en cascada de organizaciones hijas, elementos de Scorecard y KPIs relacionados
 * es manejada por las restricciones de clave foránea en la base de datos.
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

    logger.info("Organización eliminada exitosamente.", {
      organizationId: deletedOrganization.id,
    });
    return ok("Organización eliminada exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting organization: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail(
      `Fallo al eliminar la organización: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * @function createTemplatedOrganizationsFromDatasetAction
 * @description Crea múltiples organizaciones hijas a partir de una organización plantilla (UC-502).
 * Replicará la estructura completa de Scorecards y KPIs de la plantilla para cada nueva organización hija.
 */
export async function createTemplatedOrganizationsFromDatasetAction(
  data: z.infer<typeof createTemplatedOrganizationsFromDatasetSchema>,
): Promise<ActionState<SelectOrganization[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create templated organizations.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData =
    createTemplatedOrganizationsFromDatasetSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = formatZodError(validatedData.error);
    logger.error(
      `Validation error for createTemplatedOrganizationsFromDatasetAction: ${errorMessage}`,
    );
    return fail(errorMessage);
  }

  const { templateOrganizationId, newOrganizationNames, datasetFieldName } =
    validatedData.data;

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

    await db.transaction(async (tx) => {
      for (const newOrgName of newOrganizationNames) {
        // Verificar unicidad del nombre bajo el padre de la plantilla (o el mismo nivel si la plantilla no tiene padre)
        const existingOrg = await tx
          .select()
          .from(organizationsTable)
          .where(
            and(
              eq(organizationsTable.name, newOrgName),
              templateOrg.parentId !== null
                ? eq(organizationsTable.parentId, templateOrg.parentId)
                : isNull(organizationsTable.parentId),
            ),
          )
          .limit(1);

        if (existingOrg.length > 0) {
          logger.warn(
            `Skipping creation of organization "${newOrgName}" as it already exists in this level.`,
          );
          continue; // Saltar esta organización y continuar con la siguiente
        }

        // Crear la nueva organización hija con referencia al campo del dataset (simulado)
        const [newOrganization] = await tx
          .insert(organizationsTable)
          .values({
            name: newOrgName,
            description: `Organización generada a partir de plantilla "${templateOrg.name}" para el campo "${datasetFieldName}".`,
            parentId: templateOrg.id, // Las nuevas organizaciones son hijas de la plantilla
            templateFromDatasetField: datasetFieldName,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        if (newOrganization) {
          createdOrganizations.push(newOrganization);
          // Replicar la estructura del Scorecard de la plantilla a la nueva organización
          await replicateScorecardStructure(
            tx,
            templateOrg.id,
            newOrganization.id,
            userId,
          );
        }
      }
    });

    if (createdOrganizations.length === 0) {
      return fail("No se creó ninguna organización. Verifique los nombres y permisos.");
    }

    logger.info(
      `Se crearon ${createdOrganizations.length} organizaciones basadas en plantilla exitosamente.`,
      {
        templateOrganizationId,
        newOrganizationNames: createdOrganizations.map((o) => o.name),
      },
    );
    return ok(
      "Organizaciones basadas en plantilla creadas exitosamente.",
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

/**
 * @function getAllOrganizationsAction
 * @description Obtiene una lista de todas las organizaciones en la base de datos (UC-500).
 * Opcionalmente, puede filtrar organizaciones por su parentId para obtener sus hijos directos.
 * Si parentId es null/undefined, devuelve todas las organizaciones de nivel superior (sin padre).
 */
export async function getAllOrganizationsAction(
  data?: z.infer<typeof getAllOrganizationsSchema>,
): Promise<ActionState<SelectOrganization[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve all organizations.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = getAllOrganizationsSchema.safeParse(data || {});
  if (!validatedData.success) {
    const errorMessage = formatZodError(validatedData.error);
    logger.error(`Validation error for getAllOrganizationsAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { parentId } = validatedData.data || {};

  try {
    const organizations = await db
      .select()
      .from(organizationsTable)
      .where(
        parentId === undefined || parentId === null
          ? isNull(organizationsTable.parentId)
          : eq(organizationsTable.parentId, parentId),
      )
      .orderBy(organizationsTable.name); // Ordenar por nombre para consistencia

    return ok("Organizaciones obtenidas exitosamente.", organizations);
  } catch (error) {
    logger.error(
      `Error retrieving all organizations: ${error instanceof Error ? error.message : String(error)}`,
      { parentId },
    );
    return fail(
      `Fallo al obtener las organizaciones: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
