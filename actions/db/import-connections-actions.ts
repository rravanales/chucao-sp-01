/**
 * @file actions/db/import-connections-actions.ts
 * @brief Implementa Server Actions para la gestión de conexiones de importación en DeltaOne.
 * @description Este archivo contiene funciones del lado del servidor para crear, obtener,
 * actualizar, eliminar y probar conexiones a fuentes de datos externas. Las credenciales
 * sensibles se cifran antes de ser almacenadas y se descifran al ser recuperadas.
 * Se requiere autenticación para todas las operaciones.
 */

"use server";

import { db } from "@/db/db";
import {
  importConnectionsTable,
  InsertImportConnection,
  SelectImportConnection,
  importConnectionTypeEnum,
  profilesTable,
} from "@/db/schema";
import { ActionState, fail, ok } from "@/types";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getLogger } from "@/lib/logger";
import { encrypt, decrypt } from "@/lib/encryption";

const logger = getLogger("import-connections-actions");

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

/**
 * @schema createImportConnectionSchema
 * @description Esquema de validación para la creación de una nueva conexión de importación.
 * @property {string} name - Nombre único de la conexión, requerido y máximo 255 caracteres.
 * @property {z.infer<typeof importConnectionTypeEnum>} connectionType - Tipo de la conexión, requerido.
 * @property {string} connectionDetails - Detalles de la conexión (JSON string), requerido y máximo 2000 caracteres.
 */
const createImportConnectionSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre de la conexión es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  connectionType: z.enum(importConnectionTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de conexión inválido." }),
  }),
  connectionDetails: z
    .string()
    .min(1, "Los detalles de conexión son requeridos.")
    .max(2000, "Los detalles de conexión no pueden exceder los 2000 caracteres."),
});

/**
 * @schema updateImportConnectionSchema
 * @description Esquema de validación para la actualización de una conexión de importación existente.
 * Permite campos opcionales para actualizaciones parciales.
 * @property {string} id - ID de la conexión a actualizar, UUID requerido.
 * @property {string} name - Nombre único de la conexión, opcional y máximo 255 caracteres.
 * @property {z.infer<typeof importConnectionTypeEnum>} connectionType - Tipo de la conexión, opcional.
 * @property {string} connectionDetails - Detalles de la conexión (JSON string), opcional y máximo 2000 caracteres.
 */
const updateImportConnectionSchema = z.object({
  id: z.string().uuid("ID de conexión inválido."),
  name: z
    .string()
    .min(1, "El nombre de la conexión es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres.")
    .optional(),
  connectionType: z
    .enum(importConnectionTypeEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de conexión inválido." }),
    })
    .optional(),
  connectionDetails: z
    .string()
    .min(1, "Los detalles de conexión son requeridos.")
    .max(2000, "Los detalles de conexión no pueden exceder los 2000 caracteres.")
    .optional(),
});

/**
 * @schema deleteImportConnectionSchema
 * @description Esquema de validación para la eliminación de una conexión de importación.
 * @property {string} id - ID de la conexión a eliminar, UUID requerido.
 */
const deleteImportConnectionSchema = z.object({
  id: z.string().uuid("ID de conexión inválido."),
});

/**
 * @schema getImportConnectionByIdSchema
 * @description Esquema de validación para obtener una conexión por su ID.
 * @property {string} id - ID de la conexión, UUID requerido.
 */
const getImportConnectionByIdSchema = z.object({
  id: z.string().uuid("ID de conexión inválido."),
});

/**
 * @schema testImportConnectionSchema
 * @description Esquema de validación para probar una conexión de importación.
 * Los detalles de conexión se pasan sin cifrar para la prueba inicial.
 * @property {z.infer<typeof importConnectionTypeEnum>} connectionType - Tipo de la conexión a probar, requerido.
 * @property {string} connectionDetails - Detalles de la conexión (JSON string) a probar, requerido.
 */
const testImportConnectionSchema = z.object({
  connectionType: z.enum(importConnectionTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de conexión inválido." }),
  }),
  connectionDetails: z
    .string()
    .min(1, "Los detalles de conexión son requeridos.")
    .max(2000, "Los detalles de conexión no pueden exceder los 2000 caracteres."),
});

/**
 * @function createImportConnectionAction
 * @description Crea una nueva conexión de importación en la base de datos.
 * Cifra los detalles de conexión sensibles antes de almacenarlos.
 * @param {Omit<InsertImportConnection, 'id' | 'createdById' | 'createdAt' | 'updatedAt'>} data - Datos de la nueva conexión, excluyendo campos autogenerados.
 * @returns {Promise<ActionState<SelectImportConnection>>} Objeto ActionState con la conexión creada o un mensaje de error.
 */
export async function createImportConnectionAction(
  data: Omit<InsertImportConnection, "id" | "createdById" | "createdAt" | "updatedAt">,
): Promise<ActionState<SelectImportConnection>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to create import connection.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = createImportConnectionSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for createImportConnectionAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    // Verificar si ya existe una conexión con el mismo nombre para asegurar unicidad
    const existingConnection = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.name, validatedData.data.name)),
    );
    if (existingConnection) {
      return fail(`Ya existe una conexión con el nombre "${validatedData.data.name}".`);
    }

    // Cifrar los detalles de conexión antes de guardarlos
    const encryptedDetails = encrypt(validatedData.data.connectionDetails);

    const [newConnection] = await db
      .insert(importConnectionsTable)
      .values({
        ...validatedData.data,
        connectionDetails: encryptedDetails, // Almacenar cifrado
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Descifrar para el objeto de retorno (no almacenar cifrado en el frontend)
    const decryptedReturnConnection = {
      ...newConnection,
      connectionDetails: decrypt(newConnection.connectionDetails as string),
    };

    logger.info(`Import connection "${newConnection.name}" created successfully by user ${userId}.`);
    return ok("Conexión de importación creada exitosamente.", decryptedReturnConnection);
  } catch (error) {
    logger.error(
      `Error creating import connection: ${error instanceof Error ? error.message : String(error)}`,
      { data },
    );
    return fail("Fallo al crear la conexión de importación.");
  }
}

/**
 * @function getImportConnectionsAction
 * @description Obtiene una lista de todas las conexiones de importación configuradas.
 * Descifra los detalles de conexión antes de devolverlos.
 * @returns {Promise<ActionState<SelectImportConnection[]>>} Objeto ActionState con la lista de conexiones o un mensaje de error.
 */
export async function getImportConnectionsAction(): Promise<ActionState<SelectImportConnection[]>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve import connections.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  try {
    const connections = await db.select().from(importConnectionsTable);

    // Descifrar los detalles de conexión para cada entrada
    const decryptedConnections = connections.map((conn) => ({
      ...conn,
      connectionDetails: decrypt(conn.connectionDetails as string),
    }));

    logger.info(`Retrieved ${decryptedConnections.length} import connections for user ${userId}.`);
    return ok("Conexiones de importación obtenidas exitosamente.", decryptedConnections);
  } catch (error) {
    logger.error(
      `Error retrieving import connections: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail("Fallo al obtener las conexiones de importación.");
  }
}

/**
 * @function getImportConnectionAction
 * @description Obtiene una conexión de importación específica por su ID.
 * Descifra los detalles de conexión antes de devolverlos.
 * @param {string} id - El ID de la conexión a obtener.
 * @returns {Promise<ActionState<SelectImportConnection>>} Objeto ActionState con la conexión o un mensaje de error.
 */
export async function getImportConnectionAction(
  id: string,
): Promise<ActionState<SelectImportConnection>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to retrieve import connection by ID.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = getImportConnectionByIdSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for getImportConnectionAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const connection = await firstOrUndefined(
      db.select().from(importConnectionsTable).where(eq(importConnectionsTable.id, validatedId.data.id)),
    );

    if (!connection) {
      logger.warn(`Import connection with ID ${validatedId.data.id} not found.`);
      return fail("Conexión de importación no encontrada.");
    }

    // Descifrar los detalles de conexión
    const decryptedConnection = {
      ...connection,
      connectionDetails: decrypt(connection.connectionDetails as string),
    };

    logger.info(`Import connection "${decryptedConnection.name}" retrieved successfully.`);
    return ok("Conexión de importación obtenida exitosamente.", decryptedConnection);
  } catch (error) {
    logger.error(
      `Error retrieving import connection by ID: ${error instanceof Error ? error.message : String(error)}`,
    );
    return fail("Fallo al obtener la conexión de importación.");
  }
}

/**
 * @function updateImportConnectionAction
 * @description Actualiza una conexión de importación existente en la base de datos.
 * Cifra los detalles de conexión si se proporcionan para la actualización.
 * @param {string} id - El ID de la conexión a actualizar.
 * @param {Partial<Omit<InsertImportConnection, 'id' | 'createdById' | 'createdAt' | 'updatedAt'>>} data - Datos parciales para actualizar la conexión.
 * @returns {Promise<ActionState<SelectImportConnection>>} Objeto ActionState con la conexión actualizada o un mensaje de error.
 */
export async function updateImportConnectionAction(
  id: string,
  data: Partial<Omit<InsertImportConnection, "id" | "createdById" | "createdAt" | "updatedAt">>,
): Promise<ActionState<SelectImportConnection>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to update import connection.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedPayload = updateImportConnectionSchema.safeParse({ id, ...data });
  if (!validatedPayload.success) {
    const errorMessage = validatedPayload.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for updateImportConnectionAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const { id: connectionId, ...updateData } = validatedPayload.data;

    // Si se están actualizando los detalles de conexión, cifrarlos
    if (updateData.connectionDetails) {
      updateData.connectionDetails = encrypt(updateData.connectionDetails);
    }

    const [updatedConnection] = await db
      .update(importConnectionsTable)
      .set({
        ...updateData,
        updatedAt: new Date(), // Actualizar el timestamp de última actualización
      })
      .where(eq(importConnectionsTable.id, connectionId))
      .returning();

    if (!updatedConnection) {
      logger.warn(`Import connection with ID ${connectionId} not found for update.`);
      return fail("Conexión de importación no encontrada.");
    }

    // Descifrar para el objeto de retorno
    const decryptedReturnConnection = {
      ...updatedConnection,
      connectionDetails: decrypt(updatedConnection.connectionDetails as string),
    };

    logger.info(`Import connection "${updatedConnection.name}" updated successfully by user ${userId}.`);
    return ok("Conexión de importación actualizada exitosamente.", decryptedReturnConnection);
  } catch (error) {
    logger.error(
      `Error updating import connection: ${error instanceof Error ? error.message : String(error)}`,
      { id, data },
    );
    return fail("Fallo al actualizar la conexión de importación.");
  }
}

/**
 * @function deleteImportConnectionAction
 * @description Elimina una conexión de importación de la base de datos.
 * Las importaciones guardadas que referencian esta conexión serán eliminadas en cascada por la BD.
 * @param {string} id - El ID de la conexión a eliminar.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function deleteImportConnectionAction(id: string): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to delete import connection.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedId = deleteImportConnectionSchema.safeParse({ id });
  if (!validatedId.success) {
    const errorMessage = validatedId.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for deleteImportConnectionAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  try {
    const [deletedConnection] = await db
      .delete(importConnectionsTable)
      .where(eq(importConnectionsTable.id, validatedId.data.id))
      .returning({ id: importConnectionsTable.id, name: importConnectionsTable.name });

    if (!deletedConnection) {
      logger.warn(`Import connection with ID ${validatedId.data.id} not found for deletion.`);
      return fail("Conexión de importación no encontrada.");
    }

    logger.info(`Import connection "${deletedConnection.name}" (ID: ${deletedConnection.id}) deleted successfully by user ${userId}.`);
    return ok("Conexión de importación eliminada exitosamente.");
  } catch (error) {
    logger.error(
      `Error deleting import connection: ${error instanceof Error ? error.message : String(error)}`,
      { id },
    );
    return fail("Fallo al eliminar la conexión de importación.");
  }
}

/**
 * @function testImportConnectionAction
 * @description Prueba una conexión de importación, verificando la validez de los detalles de conexión.
 *
 * @important Para esta fase inicial, esta función realiza una validación de formato (ej., si connectionDetails es un JSON válido)
 * y una simulación. NO establece una conexión real a bases de datos externas. La integración con
 * controladores de bases de datos y manejo de errores específico para cada tipo de fuente (SQL Server, Oracle, etc.)
 * es una tarea compleja que excede el alcance de un paso atómico.
 *
 * @param {z.infer<typeof testImportConnectionSchema>} data - Objeto con el tipo y los detalles de conexión a probar.
 * @returns {Promise<ActionState<undefined>>} Objeto ActionState indicando el éxito o un mensaje de error.
 */
export async function testImportConnectionAction(
  data: z.infer<typeof testImportConnectionSchema>,
): Promise<ActionState<undefined>> {
  const { userId } = await auth();
  if (!userId) {
    logger.warn("Unauthorized attempt to test import connection.");
    return fail("No autorizado. Debe iniciar sesión.");
  }

  const validatedData = testImportConnectionSchema.safeParse(data);
  if (!validatedData.success) {
    const errorMessage = validatedData.error.errors.map((e) => e.message).join(", ");
    logger.error(`Validation error for testImportConnectionAction: ${errorMessage}`);
    return fail(errorMessage);
  }

  const { connectionType, connectionDetails } = validatedData.data;

  try {
    // Intenta parsear connectionDetails como JSON para verificar su formato
    let parsedDetails: any;
    try {
      parsedDetails = JSON.parse(connectionDetails);
    } catch (parseError) {
      logger.error(`Invalid JSON format for connectionDetails of type ${connectionType}.`, parseError);
      return fail("Los detalles de conexión tienen un formato JSON inválido.");
    }

    // Aquí se podría añadir lógica específica para cada tipo de conexión
    // Por ejemplo, verificar que ciertos campos existan para un tipo de DB
    switch (connectionType) {
      case "Microsoft SQL Server":
      case "Oracle":
      case "MySQL":
      case "PostgreSQL":
      case "Hive":
        if (!parsedDetails.host || !parsedDetails.port || !parsedDetails.user || !parsedDetails.database) {
          return fail("Faltan detalles esenciales para la conexión a la base de datos (host, port, user, database).");
        }
        // Nota: Las contraseñas no se validan aquí ya que no se establece una conexión real
        break;
      case "Excel":
        if (!parsedDetails.filePath) {
          return fail("Falta la ruta del archivo para la conexión Excel.");
        }
        // No se intenta abrir el archivo en esta simulación
        break;
      default:
        // No hay validación específica para tipos desconocidos, pero el JSON ya se validó
        break;
    }

    logger.info(`Simulated test for connection type "${connectionType}" successful for user ${userId}.`);
    return ok("Conexión probada exitosamente (validación de formato).");
  } catch (error) {
    logger.error(
      `Error testing import connection: ${error instanceof Error ? error.message : String(error)}`,
      { connectionType, connectionDetails },
    );
    return fail(`Fallo al probar la conexión: ${error instanceof Error ? error.message : String(error)}`);
  }
}