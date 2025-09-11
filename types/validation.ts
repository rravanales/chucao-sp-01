/**
 * @file types/validation.ts
 * @brief Utilidades de validación (Zod).
 */

import { z } from "zod"

/**
 * @function formatZodError
 * @description Formatea un ZodError a un string legible.
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map(e => {
      const path = e.path?.length ? `${e.path.join(".")}: ` : ""
      return `${path}${e.message}`
    })
    .join("; ")
}
