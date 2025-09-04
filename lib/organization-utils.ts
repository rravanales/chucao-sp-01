/**
 * @file lib/organization-utils.ts
 * @brief Proporciona funciones de utilidad para la gestión y replicación de estructuras organizacionales
 * y elementos de Scorecard en DeltaOne.
 * @description Este módulo contiene funciones auxiliares para replicar la jerarquía de Scorecards
 * (elementos y KPIs) de una organización plantilla a una nueva organización, y para obtener
 * organizaciones descendientes, crucial para la funcionalidad de permisos de rollup.
 */

import {
  kpisTable,
  scorecardElementsTable,
  organizationsTable,
  InsertKpi,
  InsertScorecardElement,
  SelectKpi,
  SelectScorecardElement,
  SelectOrganization
} from "@/db/schema"
import { getLogger } from "@/lib/logger"
import { eq, inArray } from "drizzle-orm"

const logger = getLogger("organization-utils")

/**
 * @typedef {Map<string, string>} IDMap
 * @description Un mapa para almacenar la relación entre el ID antiguo (de la plantilla)
 * y el nuevo ID (de la organización replicada) para los elementos de Scorecard.
 */
type IDMap = Map<string, string>

// Fila tipada para el join elemento + KPI
type Row = { element: SelectScorecardElement; kpi: SelectKpi | null }

/**
 * @function replicateScorecardStructure
 * @description Replicará la estructura completa de Scorecards y KPIs de una organización plantilla
 * a una nueva organización hija, manteniendo las relaciones jerárquicas y generando nuevos IDs.
 * Se ejecuta dentro de una transacción de base de datos para asegurar la atomicidad.
 * @param {typeof db} drizzle - La instancia de Drizzle ORM (usando la transacción actual).
 * @param {string} templateOrgId - El ID de la organización plantilla.
 * @param {string} newOrgId - El ID de la nueva organización hija donde se replicará la estructura.
 * @param {string} userId - El ID del usuario que realiza la operación (para createdBy, si aplica).
 * @returns {Promise<void>} Una promesa que se resuelve cuando la replicación ha terminado, o se rechaza si hay un error.
 * @throws {Error} Si la replicación falla en algún punto (ej. no se encuentran elementos de plantilla).
 * @notes
 * - Se asume que los KPIs de la plantilla tienen un `scorecardElementId` válido que apunta a un `scorecard_element`.
 * - Los `owner_user_id` de los elementos de Scorecard replicados se establecen en `null` inicialmente
 *   para evitar la asignación automática de propietarios de la plantilla, que podría no ser deseada.
 * - Los campos `createdAt` y `updatedAt` se establecen al momento de la replicación.
 */
export async function replicateScorecardStructure(
  // Tipamos 'any' para no depender de que 'db' se exporte desde '@/db/schema'
  // y permitir pasar un tx o el cliente de Drizzle desde fuera.
  drizzle: any,
  templateOrgId: string,
  newOrgId: string,
  userId: string
): Promise<void> {
  logger.info(
    `Starting scorecard replication from templateOrgId: ${templateOrgId} to newOrgId: ${newOrgId}`
  )

  // 1. Obtener todos los elementos de Scorecard y KPIs de la organización plantilla.
  // Se unen para asegurar que los KPIs están vinculados a sus Scorecard Elements.
  const templateElementsAndKpis: Row[] = await drizzle
    .select({
      element: scorecardElementsTable,
      kpi: kpisTable
    })
    .from(scorecardElementsTable)
    .leftJoin(
      kpisTable,
      eq(kpisTable.scorecardElementId, scorecardElementsTable.id)
    )
    .where(eq(scorecardElementsTable.organizationId, templateOrgId))
    .orderBy(scorecardElementsTable.parentId, scorecardElementsTable.orderIndex) // Ordenar para replicar jerarquía consistentemente

  if (templateElementsAndKpis.length === 0) {
    logger.warn(
      `No scorecard elements found for template organization ${templateOrgId}. Skipping replication.`
    )
    return
  }

  const oldElementIdToNewElementIdMap: IDMap = new Map()
  const elementsToInsert: InsertScorecardElement[] = []
  const kpisToInsert: InsertKpi[] = []

  // Separar elementos y KPIs y prepararlos para la inserción.
  const templateElements: SelectScorecardElement[] = templateElementsAndKpis
    .map((row: Row) => row.element)
    .filter(
      (
        element: SelectScorecardElement,
        index: number,
        self: SelectScorecardElement[]
      ) =>
        self.findIndex((e: SelectScorecardElement) => e.id === element.id) ===
        index
    ) // Deduplicar elementos

  const templateKpis: SelectKpi[] = templateElementsAndKpis
    .map((row: Row) => row.kpi)
    .filter(
      (kpi: SelectKpi | null | undefined): kpi is SelectKpi => kpi != null
    )

  // 2. Insertar nuevos Scorecard Elements y construir el mapa de IDs.
  // Esto se hace en un bucle inteligente para manejar la jerarquía.
  const rootElements = templateElements.filter(e => !e.parentId)

  const processElements = async (elements: SelectScorecardElement[]) => {
    for (const element of elements) {
      const newElementId = crypto.randomUUID() // Generar un nuevo ID para el elemento
      oldElementIdToNewElementIdMap.set(element.id, newElementId)

      // Determinar el nuevo parentId usando el mapa
      const newParentId = element.parentId
        ? oldElementIdToNewElementIdMap.get(element.parentId) || null
        : null

      const newElement: InsertScorecardElement = {
        id: newElementId,
        name: element.name,
        description: element.description,
        parentId: newParentId, // El nuevo parentId mapeado
        organizationId: newOrgId, // Asociar a la nueva organización
        elementType: element.elementType,
        ownerUserId: null, // Establecer propietario a null por defecto al replicar
        weight: element.weight,
        orderIndex: element.orderIndex,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      elementsToInsert.push(newElement)
    }
  }

  // Procesar elementos sin padre primero (raíces)
  await processElements(rootElements)

  // Procesar elementos hijos, asumiendo que sus padres ya han sido procesados y mapeados
  // Esto es simplificado; para jerarquías muy profundas y desordenadas se necesitaría un enfoque recursivo más robusto o un ordenamiento topológico.
  // Para la mayoría de los Scorecards, un ordenamiento básico por parentId debería ser suficiente.
  // Mejor aún, agrupar por nivel para asegurar que los padres se insertan antes que los hijos.
  const elementsByParentId = new Map<string | null, SelectScorecardElement[]>()
  templateElements.forEach((element: SelectScorecardElement) => {
    const parentId: string | null = element.parentId ?? null
    if (!elementsByParentId.has(parentId)) {
      elementsByParentId.set(parentId, [])
    }
    elementsByParentId.get(parentId)!.push(element)
  })

  let currentLevelElements: SelectScorecardElement[] =
    elementsByParentId.get(null) || []
  let nextLevelElements: SelectScorecardElement[] = []

  // Procesa nivel por nivel para asegurar que los padres existan antes de los hijos
  while (currentLevelElements.length > 0) {
    nextLevelElements = []
    for (const element of currentLevelElements) {
      if (!oldElementIdToNewElementIdMap.has(element.id)) {
        // Si no fue procesado como raíz (ya fue manejado arriba)
        const newElementId = crypto.randomUUID()
        oldElementIdToNewElementIdMap.set(element.id, newElementId)

        const newParentId = element.parentId
          ? oldElementIdToNewElementIdMap.get(element.parentId) || null
          : null

        const newElement: InsertScorecardElement = {
          id: newElementId,
          name: element.name,
          description: element.description,
          parentId: newParentId,
          organizationId: newOrgId,
          elementType: element.elementType,
          ownerUserId: null,
          weight: element.weight,
          orderIndex: element.orderIndex,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        elementsToInsert.push(newElement)
      }

      // Añadir hijos al siguiente nivel
      if (elementsByParentId.has(element.id)) {
        nextLevelElements.push(...(elementsByParentId.get(element.id) || []))
      }
    }
    currentLevelElements = nextLevelElements
  }

  if (elementsToInsert.length > 0) {
    await drizzle.insert(scorecardElementsTable).values(elementsToInsert)
    logger.info(`Inserted ${elementsToInsert.length} new scorecard elements.`)
  }

  // 3. Insertar nuevos KPIs vinculados a los nuevos Scorecard Elements.
  for (const kpi of templateKpis) {
    const newScorecardElementId = oldElementIdToNewElementIdMap.get(
      kpi.scorecardElementId
    )
    if (newScorecardElementId) {
      const newKpi: InsertKpi = {
        id: crypto.randomUUID(), // Generar un nuevo ID para el KPI
        scorecardElementId: newScorecardElementId, // Vincular al nuevo Scorecard Element
        scoringType: kpi.scoringType,
        calendarFrequency: kpi.calendarFrequency,
        dataType: kpi.dataType,
        aggregationType: kpi.aggregationType,
        decimalPrecision: kpi.decimalPrecision,
        isManualUpdate: kpi.isManualUpdate,
        calculationEquation: kpi.calculationEquation, // Copiar la ecuación si existe
        rollupEnabled: kpi.rollupEnabled, // Copiar el estado de rollup
        createdAt: new Date(),
        updatedAt: new Date()
      }
      kpisToInsert.push(newKpi)
    } else {
      logger.warn(
        `Could not find new scorecard element ID for template KPI ${kpi.id}. Skipping KPI replication.`,
        { kpiId: kpi.id, templateScorecardElementId: kpi.scorecardElementId }
      )
    }
  }

  if (kpisToInsert.length > 0) {
    await drizzle.insert(kpisTable).values(kpisToInsert)
    logger.info(`Inserted ${kpisToInsert.length} new KPIs.`)
  }

  logger.info(
    `Scorecard replication completed successfully for newOrgId: ${newOrgId}`
  )
}

/**
 * @function getDescendantOrganizations
 * @description Obtiene de forma recursiva todos los IDs de las organizaciones descendientes
 * de una organización dada (hijos, nietos, etc.).
 * @param {typeof db} drizzle - La instancia de Drizzle ORM.
 * @param {string} organizationId - El ID de la organización padre.
 * @returns {Promise<string[]>} Una promesa que resuelve con un array de IDs de organizaciones descendientes.
 */
export async function getDescendantOrganizations(
  // Mismo criterio que arriba: no dependemos del tipo 'db' exportado.
  drizzle: any,
  organizationId: string
): Promise<string[]> {
  logger.info(
    `Fetching all descendant organizations for organizationId: ${organizationId}`
  )

  let allDescendants: string[] = []
  let parentIdsToSearch: string[] = [organizationId]

  // Consulta recursiva para encontrar todos los descendientes
  while (parentIdsToSearch.length > 0) {
    const children: SelectOrganization[] = await drizzle
      .select()
      .from(organizationsTable)
      .where(inArray(organizationsTable.parentId, parentIdsToSearch))

    if (children.length === 0) {
      break // No more children found
    }

    const newDescendantIds = children.map((org: SelectOrganization) => org.id)
    allDescendants = [...allDescendants, ...newDescendantIds]
    parentIdsToSearch = newDescendantIds // Search for children of current children
  }

  logger.info(
    `Found ${allDescendants.length} descendant organizations for ${organizationId}.`
  )
  return allDescendants
}
