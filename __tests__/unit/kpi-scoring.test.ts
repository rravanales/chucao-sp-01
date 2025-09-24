/**
 * @file __tests__/unit/kpi-scoring.test.ts
 * @brief Pruebas unitarias para la lógica de cálculo de puntuación y color de KPI (numérico).
 * @description Pruebas para la función `calculateKpiScoreAndColor` tal como está
 * implementada actualmente (4 parámetros, sin tipos Yes/No ni Text).
 */

import { describe, test, expect } from "vitest"
import { calculateKpiScoreAndColor } from "@/lib/kpi-scoring"

describe("calculateKpiScoreAndColor (numérico, 4 args)", () => {
  // --- Goal/Red Flag (Numérico) ---
  describe("Goal/Red Flag Scoring", () => {
    // Escenario 1: Por encima del umbral Amarillo (Verde)
    test("Debe retornar Verde si actual >= target", () => {
      // Firma real: (actual, target, thresholdRed, thresholdYellow)
      const result = calculateKpiScoreAndColor(
        100,   // actual
        100,   // target
        80,    // red
        90     // yellow
      )
      expect(result.color).toBe("Green")
      expect(result.score).toBe(100)
    })

    // Escenario 2: Entre Rojo y Amarillo (Amarillo)
    test("Debe retornar Amarillo si actual >= amarillo y < target", () => {
      // actual 85, yellow 90, red 80 → Yellow, score 50 (según lógica actual, sin interpolación)
      const result = calculateKpiScoreAndColor(
        85,   // actual
        100,  // target
        80,   // red
        90    // yellow
      )
      expect(result.color).toBe("Yellow")
      expect(result.score).toBe(50)
    })

    // Escenario 3: Por encima de rojo pero debajo de amarillo (Rojo, 25)
    test("Debe retornar Rojo (25) si actual >= rojo y < amarillo", () => {
      const result = calculateKpiScoreAndColor(
        82,   // actual
        100,  // target
        80,   // red
        90    // yellow
      )
      expect(result.color).toBe("Red")
      expect(result.score).toBe(25)
    })

    // Escenario 4: Por debajo de rojo (Rojo, 0)
    test("Debe retornar Rojo (0) si actual < rojo", () => {
      const result = calculateKpiScoreAndColor(
        70,   // actual
        100,  // target
        80,   // red
        90    // yellow
      )
      expect(result.color).toBe("Red")
      expect(result.score).toBe(0)
    })

    // Escenario 5: Valor actual nulo/NaN
    test("Debe retornar null/null si actual es null o NaN", () => {
      const res1 = calculateKpiScoreAndColor(
        null, // actual
        100,
        80,
        90
      )
      expect(res1.color).toBeNull()
      expect(res1.score).toBeNull()

      const res2 = calculateKpiScoreAndColor(
        Number.NaN as unknown as number,
        100,
        80,
        90
      )
      expect(res2.color).toBeNull()
      expect(res2.score).toBeNull()
    })

    // Escenario 6: Target null pero hay umbrales
    test("Target null: usa solo umbrales", () => {
      const r1 = calculateKpiScoreAndColor(95, null, 80, 90)
      expect(r1.color).toBe("Yellow")
      expect(r1.score).toBe(75)

      const r2 = calculateKpiScoreAndColor(85, null, 80, 90)
      expect(r2.color).toBe("Red")
      expect(r2.score).toBe(50)

      const r3 = calculateKpiScoreAndColor(70, null, 80, 90)
      expect(r3.color).toBe("Red")
      expect(r3.score).toBe(0)
    })
  })

  // --- Tipos no soportados por la función actual ---
  describe.skip("Yes/No Scoring", () => {
    test("Pendiente: implementar wrapper que soporte Yes/No", () => {
      // La función actual no recibe tipo ni maneja Yes/No
    })
  })

  describe.skip("Text Scoring", () => {
    test("Pendiente: implementar wrapper que trate KPIs de tipo texto", () => {
      // La función actual no recibe tipo ni maneja Text
    })
  })
})
