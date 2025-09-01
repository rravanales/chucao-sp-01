import { kpiColorEnum } from "@/db/schema"

export type KpiColor = (typeof kpiColorEnum.enumValues)[number]

/**
 * Calcula score y color para KPIs tipo Goal/Red Flag.
 * Asume "mayor o igual es mejor" respecto del target.
 */
export function calculateKpiScoreAndColor(
  actualValue: number | null,
  targetValue: number | null,
  thresholdRed: number | null,
  thresholdYellow: number | null
): { score: number | null; color: KpiColor | null } {
  if (actualValue === null || isNaN(actualValue)) {
    return { score: null, color: null }
  }

  let score: number | null = null
  let color: KpiColor | null = null

  if (targetValue !== null) {
    if (actualValue >= targetValue) {
      score = 100
      color = "Green"
    } else if (thresholdYellow !== null && actualValue >= thresholdYellow) {
      score = 50
      color = "Yellow"
    } else if (thresholdRed !== null && actualValue >= thresholdRed) {
      score = 25
      color = "Red"
    } else {
      score = 0
      color = "Red"
    }
  } else if (thresholdRed !== null || thresholdYellow !== null) {
    if (thresholdYellow !== null && actualValue >= thresholdYellow) {
      score = 75
      color = "Yellow"
    } else if (thresholdRed !== null && actualValue >= thresholdRed) {
      score = 50
      color = "Red"
    } else if (actualValue < (thresholdRed ?? thresholdYellow ?? -Infinity)) {
      score = 0
      color = "Red"
    } else {
      score = null
      color = null
    }
  } else {
    score = null
    color = null
  }

  if (score !== null) {
    score = Math.max(0, Math.min(100, score))
  }

  return { score, color }
}
