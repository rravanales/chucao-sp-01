/**
 *  @file types/import-types.ts
 *  @brief Define los tipos para mapeos de KPI y reglas de transformación de datos, incluyendo esquemas Zod.
 *  @description Este archivo contiene interfaces TypeScript que estructuran los datos
 *  utilizados en las configuraciones de importación de KPIs, incluyendo cómo los
 *  campos de origen se mapean a los KPIs de destino y las reglas de transformación
 *  que se aplican a los datos importados. También incluye los esquemas Zod correspondientes
 *  para la validación de estos tipos.
 */

import { z } from "zod"

/**
 *  @interface KpiMappingField
 *  @description Define cómo se mapea un campo específico de un KPI (ej. valor actual, fecha)
 *  desde una fuente de datos de origen.
 *  @property {string} sourceField - El nombre del campo o columna en la fuente de datos de origen.
 *  @property {string | null} [defaultValue] - Un valor por defecto opcional si el campo de origen está vacío.
 */
export interface KpiMappingField {
  sourceField: string
  defaultValue?: string | null
}

/**
 * @schema KpiMappingFieldSchema
 * @description Esquema Zod para validar KpiMappingField.
 */
export const KpiMappingFieldSchema = z.object({
  sourceField: z.string().min(1, "El campo de origen es requerido."),
  defaultValue: z.string().nullable().optional()
})

/**
 *  @interface KpiMapping
 *  @description Define la configuración de mapeo para un KPI específico dentro de una importación.
 *  @property {string} kpiId - El ID del KPI de destino en DeltaOne.
 *  @property {KpiMappingField} periodDate - Cómo se mapea la fecha del período del KPI.
 *  @property {KpiMappingField} actualValue - Cómo se mapea el valor real del KPI.
 *  @property {KpiMappingField | null} [targetValue] - Cómo se mapea el valor objetivo del KPI (opcional).
 *  @property {KpiMappingField | null} [thresholdRed] - Cómo se mapea el umbral rojo del KPI (opcional).
 *  @property {KpiMappingField | null} [thresholdYellow] - Cómo se mapea el umbral amarillo del KPI (opcional).
 *  @property {KpiMappingField | null} [note] - Cómo se mapea la nota del KPI (opcional).
 */
export interface KpiMapping {
  kpiId: string
  periodDate: KpiMappingField
  actualValue: KpiMappingField
  targetValue?: KpiMappingField | null
  thresholdRed?: KpiMappingField | null
  thresholdYellow?: KpiMappingField | null
  note?: KpiMappingField | null
}

/**
 * @schema KpiMappingSchema
 * @description Esquema Zod para validar KpiMapping.
 */
export const KpiMappingSchema = z.object({
  kpiId: z.string().uuid("ID de KPI inválido."),
  periodDate: KpiMappingFieldSchema,
  actualValue: KpiMappingFieldSchema,
  targetValue: KpiMappingFieldSchema.nullable().optional(),
  thresholdRed: KpiMappingFieldSchema.nullable().optional(),
  thresholdYellow: KpiMappingFieldSchema.nullable().optional(),
  note: KpiMappingFieldSchema.nullable().optional()
})

/**
 *  @enum TransformationType
 *  @description Enumera los tipos de transformaciones de datos soportadas.
 */
export type TransformationType =
  | "filter"
  | "regex_replace"
  | "set_default"
  | "data_type_conversion"

/**
 * @schema TransformationRuleSchema
 * @description Esquema Zod para validar TransformationRule.
 * @property {TransformationType} type - El tipo de transformación a realizar (ej. 'filter', 'regex_replace').
 * @property {string} field - El campo o columna de los datos de origen a la que se aplica la transformación.
 * @property {any} parameters - Parámetros específicos para la transformación.
 *    *  Para 'filter': { condition: string } (ej. "value > 100")
 *    *  Para 'regex_replace': { pattern: string; replacement: string }
 *    *  Para 'set_default': { defaultValue: any }
 *    *  Para 'data_type_conversion': { targetType: 'number' | 'string' | 'date' }
 */
export interface TransformationRule {
  type: TransformationType
  field: string
  parameters: any
}

export const TransformationRuleSchema = z.object({
  type: z.enum(
    ["filter", "regex_replace", "set_default", "data_type_conversion"],
    {
      errorMap: () => ({ message: "Tipo de transformación inválido." })
    }
  ),
  field: z.string().min(1, "El campo de la transformación es requerido."),
  parameters: z.any() // Los parámetros son dinámicos según el tipo de transformación
})
