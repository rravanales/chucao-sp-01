/**
 * @file app/api/cron/run-scheduled-import/route.ts
 * @brief Endpoint de API para ejecutar importaciones de KPI programadas.
 * @description Esta ruta de API es invocada por Vercel Cron Jobs para procesar
 * todas las importaciones de KPI que están programadas y pendientes de ejecución.
 * Realiza una verificación de seguridad para asegurar que la solicitud proviene
 * de Vercel Cron y delega la ejecución real a la Server Action `executeSavedKpiImportAction`.
 * Registra el éxito o fracaso de cada importación.
 */

import { NextResponse } from "next/server"
import { db } from "@/db/db"
import { savedImportsTable, SelectSavedImport } from "@/db/schema"
import { isNotNull } from "drizzle-orm"
import { getLogger } from "@/lib/logger"
import { executeSavedKpiImportAction } from "@/actions/db/import-actions"
import { isScheduledImportDue } from "@/lib/schedule-utils" // Import the new utility
import { ScheduleConfig } from "@/types/schedule-types" // Import the type

const logger = getLogger("cron-scheduled-imports")

/**
 * Maneja las solicitudes POST para ejecutar importaciones de KPI programadas.
 * Esta función es invocada por Vercel Cron Jobs.
 * @param {Request} request - La solicitud HTTP entrante.
 * @returns {Promise<NextResponse>} Una respuesta JSON indicando el estado de la operación.
 */
export async function POST(request: Request) {
  // 1. Verificar la clave secreta de Vercel Cron para seguridad
  const cronSecret = request.headers.get("x-vercel-cron-auth")
  if (cronSecret !== process.env.CRON_SECRET) {
    logger.warn("Unauthorized cron job access attempt.")
    return new NextResponse("Unauthorized", { status: 401 })
  }

  logger.info("Starting scheduled KPI imports check.")

  try {
    const currentTime = new Date() // Current time in UTC for comparison

    // 2. Obtener todas las importaciones guardadas que tienen una configuración de programación
    // y cuyo scheduleConfig no es nulo
    const scheduledImports: SelectSavedImport[] = await db
      .select()
      .from(savedImportsTable)
      .where(isNotNull(savedImportsTable.scheduleConfig))

    if (scheduledImports.length === 0) {
      logger.info("No scheduled KPI imports found.")
      return NextResponse.json({
        success: true,
        message: "No se encontraron importaciones programadas."
      })
    }

    logger.info(
      `Found ${scheduledImports.length} scheduled imports. Checking which are due.`
    )

    const results = []
    for (const savedImport of scheduledImports) {
      // 3. Determinar si la importación está pendiente de ejecución
      // Asegurarse de que scheduleConfig sea un objeto ScheduleConfig válido
      const scheduleConfig = savedImport.scheduleConfig as ScheduleConfig | null

      if (!scheduleConfig) {
        logger.warn(
          `Skipping scheduled import ${savedImport.name} (ID: ${savedImport.id}) due to invalid schedule configuration.`
        )
        results.push({
          id: savedImport.id,
          name: savedImport.name,
          status: "skipped",
          message: "Configuración de programación inválida."
        })
        continue
      }

      const isDue = isScheduledImportDue(
        scheduleConfig,
        savedImport.lastRunAt,
        currentTime
      )

      if (isDue) {
        logger.info(
          `Executing due scheduled import: ${savedImport.name} (ID: ${savedImport.id})`
        )
        // 4. Ejecutar la Server Action para la importación, actuando en nombre del usuario creador
        const executionResult = await executeSavedKpiImportAction(
          { id: savedImport.id },
          savedImport.createdById // Pass the creator's ID as the executor
        )

        if (executionResult.isSuccess) {
          logger.info(
            `Scheduled import ${savedImport.name} (ID: ${savedImport.id}) executed successfully.`
          )
          results.push({
            id: savedImport.id,
            name: savedImport.name,
            status: "success",
            message: executionResult.message
          })
        } else {
          logger.error(
            `Scheduled import ${savedImport.name} (ID: ${savedImport.id}) failed: ${executionResult.message}`
          )
          results.push({
            id: savedImport.id,
            name: savedImport.name,
            status: "failure",
            message: executionResult.message
          })
          // Note: executeSavedKpiImportAction updates lastRunAt on success.
          // For failure, we might want to log, but not update lastRunAt to retry, or update with an error flag.
          // For now, it's just logging errors.
        }
      } else {
        logger.info(
          `Scheduled import ${savedImport.name} (ID: ${savedImport.id}) not due yet.`
        )
        results.push({
          id: savedImport.id,
          name: savedImport.name,
          status: "skipped",
          message: "No está pendiente de ejecución."
        })
      }
    }

    logger.info("Finished checking scheduled KPI imports.")
    return NextResponse.json({
      success: true,
      message: "Proceso de importaciones programadas completado.",
      results
    })
  } catch (error) {
    logger.error(
      `Error during scheduled KPI imports cron job: ${error instanceof Error ? error.message : String(error)}`
    )
    return NextResponse.json(
      {
        success: false,
        message:
          "Error interno del servidor al procesar importaciones programadas."
      },
      { status: 500 }
    )
  }
}
