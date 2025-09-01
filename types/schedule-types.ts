/**
 * @file types/schedule-types.ts
 * @brief Define los tipos y esquemas Zod para la configuración de programación de importaciones.
 * @description Este archivo contiene interfaces TypeScript y esquemas Zod para
 * estructurar la información de cómo se programan las importaciones recurrentes de KPI
 * en DeltaOne. Esto incluye la frecuencia, la hora y otros parámetros específicos
 * según el tipo de programación.
 */

import { z } from "zod"

/**
 * @interface ScheduleConfig
 * @description Define la estructura de la configuración de programación para una importación.
 * @property {'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom'} frequency - La frecuencia con la que se debe ejecutar la importación.
 * @property {string} time - La hora del día en formato "HH:MM" en que se debe ejecutar la importación (UTC).
 * @property {number} [dayOfWeek] - Para frecuencia 'weekly', el día de la semana (0 = Domingo, 6 = Sábado).
 * @property {number} [dayOfMonth] - Para frecuencia 'monthly', el día del mes (1-31).
 * @property {number} [monthOfYear] - Para frecuencia 'annually' o 'quarterly', el mes del año (1-12).
 * @property {string} [customCron] - Cadena cron personalizada para frecuencia 'custom' (ej. "0 0 * * *").
 */
export interface ScheduleConfig {
  frequency:
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "annually"
    | "custom"
  time: string // "HH:MM" in UTC
  dayOfWeek?: number // 0 (Sunday) - 6 (Saturday) for weekly
  dayOfMonth?: number // 1-31 for monthly
  monthOfYear?: number // 1-12 for annually/quarterly
  customCron?: string // For 'custom' frequency
}

/**
 * @schema ScheduleConfigSchema
 * @description Esquema Zod para validar la configuración de programación de importaciones.
 * Asegura que los campos condicionales (ej., dayOfWeek para 'weekly') estén presentes
 * según la frecuencia seleccionada y que los formatos sean correctos.
 */
export const ScheduleConfigSchema = z
  .object({
    frequency: z.enum(
      ["daily", "weekly", "monthly", "quarterly", "annually", "custom"],
      {
        errorMap: () => ({ message: "Frecuencia de programación inválida." })
      }
    ),
    time: z
      .string()
      .regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        "Formato de hora inválido. Usar HH:MM."
      ),
    dayOfWeek: z
      .number()
      .int("El día de la semana debe ser un número entero.")
      .min(0, "El día de la semana debe ser entre 0 (Domingo) y 6 (Sábado).")
      .max(6, "El día de la semana debe ser entre 0 (Domingo) y 6 (Sábado).")
      .optional(),
    dayOfMonth: z
      .number()
      .int("El día del mes debe ser un número entero.")
      .min(1, "El día del mes debe ser entre 1 y 31.")
      .max(31, "El día del mes debe ser entre 1 y 31.")
      .optional(),
    monthOfYear: z
      .number()
      .int("El mes del año debe ser un número entero.")
      .min(1, "El mes del año debe ser entre 1 y 12.")
      .max(12, "El mes del año debe ser entre 1 y 12.")
      .optional(),
    customCron: z.string().optional()
  })
  .superRefine((data, ctx) => {
    // Validaciones condicionales para campos específicos de frecuencia
    if (data.frequency === "weekly" && data.dayOfWeek === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Para la frecuencia semanal, 'dayOfWeek' es requerido.",
        path: ["dayOfWeek"]
      })
    }
    if (data.frequency === "monthly" && data.dayOfMonth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Para la frecuencia mensual, 'dayOfMonth' es requerido.",
        path: ["dayOfMonth"]
      })
    }
    // Para trimestral y anual, monthOfYear es necesario para definir el punto de inicio del período
    if (
      (data.frequency === "quarterly" || data.frequency === "annually") &&
      data.monthOfYear === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Para la frecuencia trimestral o anual, 'monthOfYear' es requerido.",
        path: ["monthOfYear"]
      })
    }
    if (
      data.frequency === "custom" &&
      (data.customCron === undefined || data.customCron.trim() === "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Para la frecuencia personalizada, 'customCron' es requerido y no puede estar vacío.",
        path: ["customCron"]
      })
    }
  })
