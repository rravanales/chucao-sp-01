/**
 * @file __tests__/server-actions/kpi-actions.test.ts
 * @brief Pruebas unitarias para las Server Actions de gestión de KPI (UC-101, 102, 103, 501).
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { db } from "@/db/db"
import { auth } from "@clerk/nextjs/server"
import {
  createKpiAction,
  updateKpiConfigurationAction,
  updateKpiManualValueAction,
  setKpiCalculationEquationAction,
  enableKpiRollupAction,
  assignKpiUpdatersAction,
} from "@/actions/db/kpi-actions"
import { fail } from "@/types"
import {
  kpiScoringTypeEnum,
  kpiDataTypeEnum,
  kpiAggregationTypeEnum,
  kpiCalendarFrequencyEnum,
  SelectKpi,
  SelectKpiValue,
  SelectScorecardElement,
} from "@/db/schema"
import { calculateKpiScoreAndColor } from "@/lib/kpi-scoring"

// -------------------------------------------------------------
// Mocks globales
// -------------------------------------------------------------
vi.mock("@/db/db")
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}))
vi.mock("@/lib/kpi-scoring", () => ({
  calculateKpiScoreAndColor: vi.fn(),
}))
vi.mock("@/lib/kpi-calculation-engine", () => ({
  extractKpiReferences: vi.fn().mockReturnValue([]),
}))
vi.mock("@/actions/db/alert-actions", () => ({
  processKpiAlerts: vi.fn(),
}))

// -------------------------------------------------------------
// Helpers y constantes seguras de enums (un solo literal, no arrays)
// -------------------------------------------------------------
const SCORING_GOAL =
  kpiScoringTypeEnum.enumValues[0] as (typeof kpiScoringTypeEnum.enumValues)[number] // "Goal/Red Flag"
const SCORING_YESNO =
  kpiScoringTypeEnum.enumValues[1] as (typeof kpiScoringTypeEnum.enumValues)[number] // "Yes/No"

const FREQ_MONTHLY =
  kpiCalendarFrequencyEnum.enumValues[2] as (typeof kpiCalendarFrequencyEnum.enumValues)[number] // "Monthly"

const DT_NUMBER =
  kpiDataTypeEnum.enumValues[0] as (typeof kpiDataTypeEnum.enumValues)[number] // "Number"
const DT_TEXT =
  kpiDataTypeEnum.enumValues[3] as (typeof kpiDataTypeEnum.enumValues)[number] // "Text"

const AGG_SUM =
  kpiAggregationTypeEnum.enumValues[0] as (typeof kpiAggregationTypeEnum.enumValues)[number] // "Sum"

// -------------------------------------------------------------
// Mocks específicos
// -------------------------------------------------------------
const mockAuth = (userId: string | null) => {
  (auth as unknown as any).mockResolvedValue({ userId })
}

const mockScorecardElement: SelectScorecardElement = {
  id: "scorecard-element-id-123",
  name: "KPI Link",
  description: null,
  parentId: null,
  organizationId: "org-123",
  elementType: "KPI",
  ownerUserId: null,
  weight: "1.0", // decimal -> string
  orderIndex: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockKpi: SelectKpi = {
  id: "kpi-id-456",
  scorecardElementId: mockScorecardElement.id,
  scoringType: SCORING_GOAL,
  calendarFrequency: FREQ_MONTHLY,
  dataType: DT_NUMBER,
  aggregationType: AGG_SUM,
  decimalPrecision: 0,
  isManualUpdate: true,
  calculationEquation: null,
  rollupEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/**
 * Configura respuestas básicas de insert/update/select/delete/transaction.
 * Puedes sobreescribir por-caso con .mockImplementationOnce en los tests.
 */
const setupDbStubs = (returningRow: any = mockKpi, selectRows: any[] = [mockKpi]) => {
  ;(db.insert as unknown as any).mockReturnValue({
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returningRow]),
  })
  ;(db.update as unknown as any).mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returningRow]),
  })
  ;(db.select as unknown as any).mockReturnValue({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(selectRows),
  })
  ;(db.delete as unknown as any).mockReturnValue({
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  })
  ;(db.transaction as unknown as any).mockImplementation((callback: any) => callback(db))
}

beforeEach(() => {
  vi.clearAllMocks()
})

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------
describe("createKpiAction (UC-101)", () => {
  const validData = {
    scorecardElementId: mockScorecardElement.id,
    scoringType: SCORING_GOAL,
    calendarFrequency: FREQ_MONTHLY,
    dataType: DT_NUMBER,
    aggregationType: AGG_SUM,
    decimalPrecision: 0,
    isManualUpdate: true,
    calculationEquation: null,
    rollupEnabled: false,
  }

  test("Debe fallar si el usuario no está autenticado", async () => {
    mockAuth(null)
    const result = await createKpiAction(validData)
    expect(result).toEqual(fail("No autorizado. Debe iniciar sesión."))
  })

  test("Debe crear un KPI exitosamente con configuración válida", async () => {
    mockAuth("user-id-test")

    // 1) select scorecardElement existe
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockScorecardElement]),
    }))
    // 2) select KPI inexistente previo
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    }))
    // 3) insert retorna creado
    setupDbStubs({ ...mockKpi, ...validData })

    const result = await createKpiAction(validData)
    if (!result.isSuccess) throw new Error(result.message)

    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(result.data).toMatchObject(validData)
  })

  test("Debe fallar si el tipo de scoring no coincide con el tipo de dato (Regla de negocio)", async () => {
    mockAuth("user-id-test")
    setupDbStubs()

    const invalidData = {
      ...validData,
      scoringType: SCORING_GOAL,
      dataType: DT_TEXT, // inconsistente
    }

    const result = await createKpiAction(invalidData)
    expect(result.isSuccess).toBe(false)
    expect(result.message).toContain(
      "Inconsistencia entre el tipo de puntuación y el tipo de dato del KPI.",
    )
  })

  test("Debe fallar si no se selecciona exactamente una de las tres opciones de actualización (manual, equation, rollup)", async () => {
    mockAuth("user-id-test")
    setupDbStubs()

    const invalidData = {
      ...validData,
      isManualUpdate: false,
      calculationEquation: null,
      rollupEnabled: false, // ninguna activa
    }
    const result = await createKpiAction(invalidData)
    // La validación de exclusividad probablemente la tengas en la propia action
    // (si no, adapta este test a tu lógica real). Aquí solo verificamos que falle.
    expect(result.isSuccess).toBe(false)
  })
})

describe("updateKpiConfigurationAction (UC-101)", () => {
  test("Debe actualizar la configuración de un KPI exitosamente", async () => {
    mockAuth("user-id-test")

    const updatedData = {
      scoringType: SCORING_YESNO,
      dataType: DT_NUMBER,
      isManualUpdate: true,
    }
    const updatedKpi = { ...mockKpi, ...updatedData }

    // Mock de select para verificar existencia previa del KPI (si tu action lo requiere)
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockKpi]),
    }))
    ;(db.update as unknown as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedKpi]),
    })

    const result = await updateKpiConfigurationAction(mockKpi.id, updatedData)
    if (!result.isSuccess) throw new Error(result.message)

    expect(db.update).toHaveBeenCalledTimes(1)
    expect(result.data.scoringType).toBe(SCORING_YESNO)
  })
})

describe("setKpiCalculationEquationAction (UC-103)", () => {
  test("Debe configurar la ecuación y deshabilitar la actualización manual", async () => {
    mockAuth("user-id-test")
    const equation = "([KPI:ventas] + [KPI:gastos]) / 2"
    const expectedUpdate = {
      calculationEquation: equation,
      isManualUpdate: false,
      rollupEnabled: false,
    }
    const updatedKpi = { ...mockKpi, ...expectedUpdate }

    // Mockear la existencia del KPI (si tu action lo requiere)
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockKpi]),
    }))

    ;(db.update as unknown as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedKpi]),
    })

    const result = await setKpiCalculationEquationAction({
      kpiId: mockKpi.id,
      calculationEquation: equation,
    })
    if (!result.isSuccess) throw new Error(result.message)

    expect(db.update).toHaveBeenCalledTimes(1)
    expect(result.data.calculationEquation).toBe(equation)
    expect(result.data.isManualUpdate).toBe(false)
  })
})

describe("enableKpiRollupAction (UC-501)", () => {
  test("Debe habilitar rollup, deshabilitar manual y limpiar la ecuación", async () => {
    mockAuth("user-id-test")
    const expectedUpdate = {
      rollupEnabled: true,
      isManualUpdate: false,
      calculationEquation: null,
    }
    const updatedKpi = { ...mockKpi, ...expectedUpdate }

    // Mockear la existencia del KPI (si tu action lo requiere)
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockKpi]),
    }))

    ;(db.update as unknown as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([updatedKpi]),
    })

    const result = await enableKpiRollupAction({
      kpiId: mockKpi.id,
      rollupEnabled: true,
    })
    if (!result.isSuccess) throw new Error(result.message)

    expect(db.update).toHaveBeenCalledTimes(1)
    expect(result.data.rollupEnabled).toBe(true)
    expect(result.data.isManualUpdate).toBe(false)
    expect(result.data.calculationEquation).toBeNull()
  })
})

describe("assignKpiUpdatersAction (UC-102)", () => {
  test("Debe asignar un nuevo Updater exitosamente", async () => {
    mockAuth("admin-user")

    // KPI existe
    ;(db.select as unknown as any).mockImplementationOnce(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([mockKpi]),
    }))

    // UPSERT en kpi_updaters (tabla de unión) retorna el updater creado/actualizado
    ;(db.insert as unknown as any).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ kpiId: mockKpi.id, userId: "updater-1", canModifyThresholds: false }]),
    })

    const result = await assignKpiUpdatersAction({
      kpiId: mockKpi.id,
      userId: "updater-1",
      canModifyThresholds: false,
    })
    if (!result.isSuccess) throw new Error(result.message)

    expect(db.insert).toHaveBeenCalledTimes(1)
  })
})

describe("updateKpiManualValueAction (UC-102)", () => {
  const periodDate = "2024-06-01"
  const validUpdateData = {
    kpiId: mockKpi.id,
    periodDate,
    actualValue: "150",
    targetValue: "100",
    thresholdRed: "80",
    thresholdYellow: "120",
    note: "Excelente rendimiento",
  }
  const mockKpiUpdater = {
    kpiId: mockKpi.id,
    userId: "updater-user",
    canModifyThresholds: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const mockKpiValue: SelectKpiValue = {
    id: "value-id",
    kpiId: mockKpi.id,
    periodDate: "2024-06-01", // string (date en Drizzle)
    actualValue: "150",
    targetValue: "100",
    thresholdRed: "80",
    thresholdYellow: "120",
    score: "150", // decimal -> string
    color: "Green",
    updatedByUserId: "updater-user",
    isManualEntry: true,
    note: "Excelente rendimiento",
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  test("Debe fallar si el usuario no es el Updater designado (simulación)", async () => {
    mockAuth("unauthorized-user")

    // 1) select de updaters: no es updater
    ;(db.select as unknown as any).mockResolvedValueOnce([])

    const result = await updateKpiManualValueAction(validUpdateData)
    expect(result.isSuccess).toBe(false)
    expect(result.message).toContain("No tiene permisos")
  })

  test("Debe actualizar el valor, calcular el score y el color para Goal/Red Flag", async () => {
    mockAuth("updater-user")

    // 1) Es updater
    ;(db.select as unknown as any).mockResolvedValueOnce([mockKpiUpdater])

    // 2) Config del KPI
    ;(db.select as unknown as any).mockResolvedValueOnce([mockKpi])

    // 3) Mock del cálculo de score/color
    ;(calculateKpiScoreAndColor as unknown as any).mockReturnValue({ score: 100, color: "Green" })

    // 4) UPSERT de kpi_values
    ;(db.insert as unknown as any).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([mockKpiValue]),
    })

    const result = await updateKpiManualValueAction(validUpdateData)
    if (!result.isSuccess) throw new Error(result.message)

    expect(result.data.actualValue).toBe("150")
    expect(result.data.color).toBe("Green")
    expect(calculateKpiScoreAndColor).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalledTimes(1)
  })
})
