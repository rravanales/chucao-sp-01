/**
 * @file lib/kpi-calculation-engine2.ts
 * @brief Proporciona utilidades para el procesamiento de ecuaciones de cálculo de KPI y futuras lógicas de rollup.
 * @description Este módulo contiene funciones para extraer referencias a otros KPIs dentro de una ecuación
 * y para sustituir esas referencias por valores reales. También incluye un placeholder para
 * la función de cálculo de valores de KPI de rollup, sentando las bases para futuras implementaciones
 * del motor de cálculo y auditoría.
 */
import { SelectKpi, kpiScoringTypeEnum, kpiDataTypeEnum } from "@/db/schema"
import { getLogger } from "@/lib/logger"

const logger = getLogger("kpi-calculation-engine")

/**
 * @typedef {'Goal/Red Flag' | 'Yes/No' | 'Text'} KpiScoringType
 * @description Alias para los tipos de puntuación de KPI definidos en el esquema de Drizzle.
 */
type KpiScoringType = (typeof kpiScoringTypeEnum.enumValues)[number]

/**
 * @typedef {'Number' | 'Percentage' | 'Currency' | 'Text'} KpiDataType
 * @description Alias para los tipos de datos de KPI definidos en el esquema de Drizzle.
 */
type KpiDataType = (typeof kpiDataTypeEnum.enumValues)[number]

/**
 * @interface KpiReference
 * @description Representa una referencia a un KPI dentro de una ecuación de cálculo.
 * @property {'kpi'} type - El tipo de referencia (actualmente solo 'kpi').
 * @property {string} identifier - El ID (UUID) o nombre (string) del KPI referenciado.
 * @property {boolean} isId - Verdadero si el identifier es un UUID, falso si es un nombre.
 * @property {string} originalMatch - La cadena exacta que se encontró en la ecuación (ej. '[KPI:UUID]' o '[KPI:NombreDeKPI]').
 */
export interface KpiReference {
  type: "kpi"
  identifier: string
  isId: boolean
  originalMatch: string
}

/**
 * @function extractKpiReferences
 * @description Extrae todas las referencias a KPIs de una cadena de ecuación.
 * Las referencias deben seguir el formato [KPI:UUID] o [KPI:NombreDeKPI].
 * @param {string} equation - La cadena de la ecuación de cálculo de donde se extraerán las referencias.
 * @returns {KpiReference[]} Un array de objetos KpiReference encontrados en la ecuación.
 * @notes
 *  Soporta referencias por UUID o por cualquier cadena de texto que no contenga ']' como identificador.
 *  Este paso no valida si los KPIs referenciados realmente existen en la base de datos.
 *  Podría ser extendido en el futuro para manejar referencias con períodos de tiempo (ej., [KPI:UUID:lastMonth]).
 */
export function extractKpiReferences(equation: string): KpiReference[] {
  const references: KpiReference[] = []
  // Expresión regular para encontrar [KPI:UUID] o [KPI:CUALQUIER_TEXTO_NO_VACIO]
  // Un UUID tiene 32 caracteres hexadecimales, separados por guiones.
  // La segunda parte ([^\]]+?) captura cualquier texto que no sea un corchete de cierre.
  const kpiReferenceRegex =
    /\[KPI:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[^\]]+?)]/g
  // Regex separado para validar UUID (mejora legibilidad y evita repetir literal).
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  let match: RegExpExecArray | null

  while ((match = kpiReferenceRegex.exec(equation)) !== null) {
    const fullMatch = match[0]
    const identifierRaw = match[1]
    const identifier = identifierRaw.trim() // Eliminar espacios en blanco alrededor del identificador

    // Verifica si el identificador coincide con el patrón de un UUID para determinar su tipo.
    const isId = uuidRegex.test(identifier)

    references.push({
      type: "kpi",
      identifier: identifier,
      isId: isId,
      originalMatch: fullMatch
    })
  }

  if (references.length > 0) {
    logger.info(
      `Extracted ${references.length} KPI references from equation.`,
      { equation, references }
    )
  }

  return references
}

/**
 * @function substituteKpiValues
 * @description Sustituye las referencias a KPI en una ecuación por sus valores correspondientes
 * de un mapa de valores proporcionado. Esta función es útil para preparar una ecuación
 * para su evaluación, reemplazando los placeholders por datos reales.
 * @param {string} equation - La cadena de la ecuación original con referencias a KPI (ej. "([KPI:ventas]) + [KPI:costos]").
 * @param {Map<string, string | null>} valuesMap - Un mapa donde la clave es el ID o nombre del KPI (según cómo se referencie en la ecuación)
 *  y el valor es el valor numérico (como cadena) o null.
 * @returns {string} La ecuación con todas las referencias a KPI sustituidas por los valores del mapa.
 * @notes
 *  Los valores null o undefined en valuesMap se sustituyen por la cadena '0' por defecto,
 *  para facilitar la evaluación de expresiones numéricas. Una lógica más sofisticada
 *  podría considerar el `dataType` del KPI destino para un manejo más preciso de los nulos.
 *  Esta función solo realiza la sustitución; no evalúa la expresión matemática resultante.
 *  Si un KPI referenciado no se encuentra en valuesMap, su placeholder en la ecuación no se reemplaza.
 */
export function substituteKpiValues(
  equation: string,
  valuesMap: Map<string, string | null>
): string {
  let substitutedEquation = equation
  const references = extractKpiReferences(equation)

  for (const ref of references) {
    const value = valuesMap.get(ref.identifier)
    // Sustituir valores nulos/indefinidos por '0' para facilitar futuras evaluaciones numéricas.
    // Una lógica más sofisticada podría considerar el dataType del KPI destino.
    const replacement = value === null || value === undefined ? "0" : value

    // Reemplazar todas las ocurrencias de la referencia original en la ecuación.
    // Es importante escapar el fullMatch para que la sustitución de RegExp funcione correctamente.
    const escapedMatch = ref.originalMatch.replace(
      /[-\/\\^$*+?.()|[\]{}]/g,
      "\\$&"
    )
    substitutedEquation = substitutedEquation.replace(
      new RegExp(escapedMatch, "g"),
      replacement
    )
  }

  logger.info("KPI references substituted in equation.", {
    originalEquation: equation,
    substitutedEquation
  })
  return substitutedEquation
}

/**
 * @function calculateKpiRollupValue
 * @description [PLACEHOLDER] Calcula el valor de un KPI de rollup agregando valores de KPIs con el mismo nombre
 * en organizaciones hijas, utilizando el tipo de agregación especificado.
 * @param {string} kpiId - El ID del KPI de rollup (padre).
 * @param {string} organizationId - El ID de la organización padre.
 * @param {'Sum' | 'Average' | 'Last Value'} aggregationType - El tipo de agregación a realizar.
 * @returns {Promise<string | null>} El valor agregado calculado o null si no hay datos o la agregación falla.
 * @notes
 *  Esta es una función placeholder. La implementación completa requerirá:
 *  1. Recorrer recursivamente la jerarquía de organizaciones hijas.
 *  2. Identificar KPIs con el mismo nombre en cada organización hija.
 *  3. Obtener los valores (`actualValue`) de esos KPIs hijos para un período relevante.
 *  4. Aplicar la lógica de agregación (Suma, Promedio, Último Valor).
 *  5. Considerar el manejo de diferentes períodos de tiempo y el `dataType` de los KPIs.
 *  Esta lógica será implementada en un paso posterior del plan de desarrollo.
 */
export async function calculateKpiRollupValue(
  kpiId: string,
  organizationId: string,
  aggregationType: "Sum" | "Average" | "Last Value"
): Promise<string | null> {
  logger.info(
    "PLACEHOLDER: Invocando la función de cálculo de rollup para KPI.",
    { kpiId, organizationId, aggregationType }
  )

  // Lógica compleja de obtención de hijos, sus KPIs, y agregación se implementará aquí en un paso posterior.
  // Por ahora, devolvemos un valor de ejemplo.
  switch (aggregationType) {
    case "Sum":
      return "1000" // Valor de ejemplo
    case "Average":
      return "150" // Valor de ejemplo
    case "Last Value":
      return "200" // Valor de ejemplo
    default:
      return null
  }
}
