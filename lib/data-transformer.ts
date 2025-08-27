/**
 * @file lib/data-transformer.ts
 * @brief Implementa la lógica para aplicar transformaciones a los datos durante el proceso de importación.
 * @description Este módulo contiene funciones que toman un conjunto de datos y un array de reglas
 * de transformación, aplicando cada regla secuencialmente para limpiar, filtrar o reformatear
 * los datos antes de su carga en los KPIs de DeltaOne.
 */

import { TransformationRule, TransformationType } from "@/types/import-types" // Se importan los tipos de reglas de transformación
import { getLogger } from "@/lib/logger" // Se importa el logger para registrar eventos

const logger = getLogger("data-transformer")

/**
 * @interface DataRow
 * @description Define la estructura de una fila de datos genérica, donde las claves son cadenas
 * y los valores pueden ser de cualquier tipo.
 */
interface DataRow {
  [key: string]: any
}

/**
 * @function applyTransformations
 * @description Aplica una serie de reglas de transformación a un conjunto de datos.
 * Las reglas se aplican en el orden en que se proporcionan.
 * @param {DataRow[]} data - El array de objetos (filas) a transformar.
 * @param {TransformationRule[]} rules - Las reglas de transformación a aplicar.
 * @returns {DataRow[]} El array de objetos transformados después de aplicar todas las reglas.
 */
export function applyTransformations(
  data: DataRow[],
  rules: TransformationRule[]
): DataRow[] {
  let transformedData = [...data] // Crear una copia para no modificar el array original

  for (const rule of rules) {
    transformedData = applySingleTransformation(transformedData, rule)
  }

  return transformedData
}

/**
 * @function applySingleTransformation
 * @description Aplica una única regla de transformación a un conjunto de datos.
 * @param {DataRow[]} data - El array de objetos (filas) a transformar.
 * @param {TransformationRule} rule - La regla de transformación a aplicar.
 * @returns {DataRow[]} El array de objetos transformados después de aplicar la regla.
 */
function applySingleTransformation(
  data: DataRow[],
  rule: TransformationRule
): DataRow[] {
  const { type, field, parameters } = rule

  switch (type) {
    case "filter":
      return applyFilterTransformation(data, field, parameters)
    case "regex_replace":
      return applyRegexReplaceTransformation(data, field, parameters)
    case "set_default":
      return applySetDefaultTransformation(data, field, parameters)
    case "data_type_conversion":
      return applyDataTypeConversionTransformation(data, field, parameters)
    default:
      // Si el tipo de transformación es desconocido, se registra una advertencia y se devuelven los datos sin modificar.
      logger.warn(
        `Tipo de transformación desconocido: '${type}' para el campo '${field}'. La regla será omitida.`
      )
      return data
  }
}

/**
 * @function applyFilterTransformation
 * @description Aplica una transformación de filtro a los datos.
 * @WARNING La evaluación dinámica de cadenas de condición puede ser un riesgo de seguridad (ej. inyección de código).
 * En una implementación de producción, se recomienda usar un parser de expresiones seguro
 * (ej. una librería de evaluación de expresiones o una estructura de condición más controlada)
 * en lugar de `eval()`.
 * @param {DataRow[]} data - Los datos a filtrar.
 * @param {string} field - El campo al que se aplica el filtro.
 * @param {any} parameters - Los parámetros de la regla, esperando `{ condition: string }` (ej. "value > 100").
 * @returns {DataRow[]} Los datos filtrados.
 */
function applyFilterTransformation(
  data: DataRow[],
  field: string,
  parameters: any
): DataRow[] {
  if (!parameters || typeof parameters.condition !== "string") {
    logger.warn(
      `La regla de transformación 'filter' para el campo '${field}' no tiene un parámetro 'condition' válido de tipo string. Regla omitida.`
    )
    return data
  }

  return data.filter(row => {
    // Reemplazar la palabra clave 'value' en la condición con el valor real del campo de la fila.
    // Esto es necesario para que la cadena de condición sea evaluable.
    const conditionString = parameters.condition.replace(
      /value/g,
      `row['${field}']`
    )
    try {
      // ADVERTENCIA: Uso de eval().
      // Este es un placeholder. Para producción, usar un parser de expresiones seguro.
      return eval(conditionString)
    } catch (e) {
      logger.error(
        `Error al evaluar la condición de filtro '${conditionString}' para el campo '${field}': ${e instanceof Error ? e.message : String(e)}. La fila será filtrada.`
      )
      return false // Si la evaluación falla, la fila se filtra para evitar datos inconsistentes.
    }
  })
}

/**
 * @function applyRegexReplaceTransformation
 * @description Aplica una transformación de reemplazo mediante expresión regular a los datos.
 * @param {DataRow[]} data - Los datos a transformar.
 * @param {string} field - El campo al que se aplica el reemplazo.
 * @param {any} parameters - Los parámetros de la regla, esperando `{ pattern: string; replacement: string }`.
 * @returns {DataRow[]} Los datos con el reemplazo aplicado.
 */
function applyRegexReplaceTransformation(
  data: DataRow[],
  field: string,
  parameters: any
): DataRow[] {
  if (
    !parameters ||
    typeof parameters.pattern !== "string" ||
    !("replacement" in parameters)
  ) {
    logger.warn(
      `La regla de transformación 'regex_replace' para el campo '${field}' no tiene parámetros 'pattern' o 'replacement' válidos. Regla omitida.`
    )
    return data
  }

  return data.map(row => {
    // Solo aplicar si el campo existe y no es nulo/indefinido
    if (row[field] !== undefined && row[field] !== null) {
      try {
        const regex = new RegExp(parameters.pattern, "g") // 'g' para reemplazo global de todas las ocurrencias
        row[field] = String(row[field]).replace(regex, parameters.replacement)
      } catch (e) {
        logger.error(
          `Error al aplicar 'regex_replace' para el campo '${field}' con patrón '${parameters.pattern}': ${e instanceof Error ? e.message : String(e)}. El valor del campo no se modificará.`
        )
      }
    }
    return row
  })
}

/**
 * @function applySetDefaultTransformation
 * @description Aplica una transformación para establecer un valor por defecto si el campo está vacío o nulo.
 * @param {DataRow[]} data - Los datos a transformar.
 * @param {string} field - El campo al que se aplica el valor por defecto.
 * @param {any} parameters - Los parámetros de la regla, esperando `{ defaultValue: any }`.
 * @returns {DataRow[]} Los datos con el valor por defecto aplicado.
 */
function applySetDefaultTransformation(
  data: DataRow[],
  field: string,
  parameters: any
): DataRow[] {
  if (!parameters || !("defaultValue" in parameters)) {
    logger.warn(
      `La regla de transformación 'set_default' para el campo '${field}' no tiene un parámetro 'defaultValue'. Regla omitida.`
    )
    return data
  }

  return data.map(row => {
    // Si el campo es undefined, null o una cadena vacía/solo espacios, aplicar el valor por defecto.
    if (
      row[field] === undefined ||
      row[field] === null ||
      (typeof row[field] === "string" && row[field].trim() === "")
    ) {
      row[field] = parameters.defaultValue
    }
    return row
  })
}

/**
 * @function applyDataTypeConversionTransformation
 * @description Aplica una transformación para convertir el tipo de dato de un campo.
 * @param {DataRow[]} data - Los datos a transformar.
 * @param {string} field - El campo a convertir.
 * @param {any} parameters - Los parámetros de la regla, esperando `{ targetType: 'number' | 'string' | 'date' }`.
 * @returns {DataRow[]} Los datos con el tipo de dato convertido.
 */
function applyDataTypeConversionTransformation(
  data: DataRow[],
  field: string,
  parameters: any
): DataRow[] {
  if (!parameters || typeof parameters.targetType !== "string") {
    logger.warn(
      `La regla de transformación 'data_type_conversion' para el campo '${field}' no tiene un parámetro 'targetType' válido. Regla omitida.`
    )
    return data
  }

  return data.map(row => {
    if (row[field] !== undefined && row[field] !== null) {
      try {
        switch (parameters.targetType) {
          case "number":
            const numValue = Number(row[field])
            if (isNaN(numValue)) {
              logger.warn(
                `Fallo al convertir el valor '${row[field]}' a 'number' para el campo '${field}'. Se establecerá a null.`
              )
              row[field] = null // Establecer a null si la conversión numérica falla
            } else {
              row[field] = numValue
            }
            break
          case "string":
            row[field] = String(row[field])
            break
          case "date":
            // Intenta convertir a fecha y luego a formato ISO YYYY-MM-DD
            const dateValue = new Date(row[field])
            if (isNaN(dateValue.getTime())) {
              logger.warn(
                `Fallo al convertir el valor '${row[field]}' a 'date' para el campo '${field}'. Se establecerá a null.`
              )
              row[field] = null
            } else {
              row[field] = dateValue.toISOString().split("T") // Formato YYYY-MM-DD
            }
            break
          default:
            logger.warn(
              `Tipo de destino no soportado '${parameters.targetType}' para el campo '${field}'. El valor del campo no se modificará.`
            )
        }
      } catch (e) {
        logger.error(
          `Error al convertir el tipo de dato para el campo '${field}' a '${parameters.targetType}': ${e instanceof Error ? e.message : String(e)}. El campo se establecerá a null.`
        )
        row[field] = null // Establecer a null en caso de error de conversión inesperado
      }
    }
    return row
  })
}
