/**
 * @file lib/db-helpers.ts
 * @brief Helpers genéricos para consultas a la base de datos.
 */

/**
 * @function firstOrUndefined
 * @description Devuelve el primer elemento de un array o undefined si está vacío.
 * Útil para consultas que se espera retornen 0 o 1 fila.
 */
export async function firstOrUndefined<T>(
  q: Promise<T[]>
): Promise<T | undefined> {
  const rows = await q
  return rows?.[0]
}
