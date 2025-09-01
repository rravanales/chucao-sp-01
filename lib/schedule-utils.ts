import { ScheduleConfig } from "@/types/schedule-types"
import {
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  getDay,
  getDate,
  getMonth,
  setDate,
  setMonth,
  isAfter,
  isBefore,
  lastDayOfMonth
} from "date-fns"

/**
 * @file lib/schedule-utils.ts
 * @brief Proporciona utilidades para el manejo de la lógica de programación de tareas.
 * @description Este módulo contiene funciones auxiliares para determinar si una tarea programada
 * (como una importación de KPI) está pendiente de ejecución, basándose en su configuración
 * de frecuencia y la última vez que se ejecutó.
 * Se utiliza 'date-fns' para un manejo robusto de fechas.
 * Se asume que todas las fechas (lastRunAt, currentTime, ScheduleConfig.time) son tratadas en UTC
 * para evitar problemas de zona horaria con cron jobs.
 */

/**
 * @function adjustToScheduleTime
 * @description Ajusta una fecha dada a la hora programada especificada en ScheduleConfig, en UTC.
 * @param {Date} date - La fecha a ajustar.
 * @param {string} time - La hora en formato "HH:MM".
 * @returns {Date} La fecha ajustada a la hora programada en UTC.
 */
function adjustToScheduleTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number)
  let adjustedDate = setHours(date, hours)
  adjustedDate = setMinutes(adjustedDate, minutes)
  adjustedDate = setSeconds(adjustedDate, 0)
  adjustedDate = setMilliseconds(adjustedDate, 0)
  return adjustedDate
}

/**
 * @function getPreviousScheduledRunTime
 * @description Calcula la última hora programada para una configuración de horario dada,
 * en relación con un momento de referencia, asegurándose de que la fecha resultante
 * sea en el pasado o presente del `referenceTime`.
 * @param {ScheduleConfig} scheduleConfig - La configuración de programación.
 * @param {Date} referenceTime - El tiempo de referencia (ej. `new Date()`, en UTC).
 * @returns {Date} La última fecha y hora en que la tarea debería haberse ejecutado, ajustada a UTC.
 * @notes
 *   - Esta función es crucial para identificar la "ventana" de ejecución actual de un cron job.
 *   - Si el 'scheduleConfig.time' para el 'referenceTime' actual ya ha pasado,
 *     la función devuelve la hora programada del período anterior.
 */
export function getPreviousScheduledRunTime(
  scheduleConfig: ScheduleConfig,
  referenceTime: Date
): Date {
  let prevRun = adjustToScheduleTime(referenceTime, scheduleConfig.time)

  switch (scheduleConfig.frequency) {
    case "daily":
      // Si la hora programada para hoy ya pasó, la última ejecución debió ser ayer a esa hora
      if (isAfter(prevRun, referenceTime)) {
        prevRun = addDays(prevRun, -1)
      }
      break
    case "weekly":
      if (scheduleConfig.dayOfWeek !== undefined) {
        const currentDayOfWeek = getDay(referenceTime) // 0 (Sunday) - 6 (Saturday)
        let daysDiff = currentDayOfWeek - scheduleConfig.dayOfWeek

        // Si el día de la semana programado aún no ha llegado esta semana, o ya pasó hoy
        if (
          daysDiff < 0 ||
          (daysDiff === 0 && isAfter(prevRun, referenceTime))
        ) {
          daysDiff += 7 // Retrocede a la semana anterior para encontrar el día programado
        }
        prevRun = addDays(prevRun, -daysDiff)
      } else {
        // Fallback si dayOfWeek no está configurado (debería ser validado por Zod)
        // Para evitar que se considere "siempre debido", retrocedemos un día
        if (isAfter(prevRun, referenceTime)) {
          prevRun = addDays(prevRun, -1)
        }
      }
      break
    case "monthly":
      if (scheduleConfig.dayOfMonth !== undefined) {
        const currentDayOfMonth = getDate(referenceTime)
        // Si el día del mes programado aún no ha llegado este mes, o ya pasó hoy
        if (
          currentDayOfMonth < scheduleConfig.dayOfMonth ||
          (currentDayOfMonth === scheduleConfig.dayOfMonth &&
            isAfter(prevRun, referenceTime))
        ) {
          prevRun = addMonths(prevRun, -1)
        }
        // Asegurarse de que el día del mes no exceda el último día del mes (ej. Febrero 30)
        prevRun = setDate(
          prevRun,
          Math.min(scheduleConfig.dayOfMonth, getDate(lastDayOfMonth(prevRun)))
        )
      } else {
        if (isAfter(prevRun, referenceTime)) {
          prevRun = addDays(prevRun, -1)
        }
      }
      break
    case "quarterly":
    case "annually":
      if (scheduleConfig.monthOfYear !== undefined) {
        const currentMonth = getMonth(referenceTime) + 1 // 1-12
        // Si el mes programado aún no ha llegado este año, o ya pasó este mes/día
        if (
          currentMonth < scheduleConfig.monthOfYear ||
          (currentMonth === scheduleConfig.monthOfYear &&
            isAfter(prevRun, referenceTime))
        ) {
          prevRun = addYears(prevRun, -1)
        }
        prevRun = setMonth(prevRun, scheduleConfig.monthOfYear - 1) // Establecer el mes objetivo (date-fns usa 0-11)
        prevRun = setDate(prevRun, 1) // Por defecto el día 1 del mes para estas frecuencias
      } else {
        if (isAfter(prevRun, referenceTime)) {
          prevRun = addDays(prevRun, -1)
        }
      }
      break
    case "custom":
      // Para 'custom', se asume que Vercel Cron es el que maneja el momento exacto.
      // La "última ejecución programada" es simplemente la hora actual de la invocación
      // menos un pequeño margen para asegurar que `lastRunAt` sea evaluado correctamente.
      // No se puede predecir la hora exacta del último trigger de un cron personalizado con esta lógica.
      // Por simplicidad en este contexto, podemos usar `referenceTime` directamente,
      // la verificación `isBefore(lastRunAt, previousScheduledRun)` manejará si ya se ejecutó.
      return referenceTime
  }
  return prevRun
}

/**
 * @function isScheduledImportDue
 * @description Determina si una importación programada está pendiente de ejecución.
 *
 * Esta función evalúa si la 'lastRunAt' de una importación cae antes de la ventana
 * de tiempo de su última ejecución programada, asumiendo que el cron job externo
 * (como Vercel Cron) ya ha disparado esta lógica.
 *
 * @param {ScheduleConfig} scheduleConfig - La configuración de programación de la importación.
 * @param {Date | null | undefined} lastRunAt - La fecha y hora de la última ejecución *exitosa* de la importación (en UTC).
 * @param {Date} currentTime - La hora actual en la que se está evaluando (ej. `new Date()`, en UTC).
 * @returns {boolean} `true` si la importación está pendiente de ejecución, `false` en caso contrario.
 */
export function isScheduledImportDue(
  scheduleConfig: ScheduleConfig,
  lastRunAt: Date | null | undefined,
  currentTime: Date
): boolean {
  if (!scheduleConfig) {
    return false // No hay configuración de programación
  }

  // Si nunca se ha ejecutado, está pendiente.
  if (!lastRunAt) {
    return true
  }

  // La lógica principal es determinar la última vez que *debió* ejecutarse el cron job
  // y verificar si 'lastRunAt' es anterior a ese momento.
  const previousScheduledRun = getPreviousScheduledRunTime(
    scheduleConfig,
    currentTime
  )

  // Si 'lastRunAt' es anterior a la última ejecución programada esperada, significa que está pendiente.
  // Es 'isBefore' porque si lastRunAt es EXACTAMENTE igual a previousScheduledRun, significa que YA se ejecutó
  // para esa ventana. Si fuera 'isBeforeOrEqual', correría dos veces en el mismo punto de tiempo.
  return isBefore(lastRunAt, previousScheduledRun)
}
