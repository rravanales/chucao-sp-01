/**
 * @file app/api/cron/check-alerts/route.ts
 * @brief Implementa la lógica para verificar y enviar alertas mediante un trabajo cron.
 * @description Este archivo contiene un endpoint protegido que es invocado por Vercel Cron Jobs.
 * Realiza la validación de las alertas configuradas en el sistema, evalúa sus condiciones y,
 * en caso de ser necesario, envía notificaciones por correo electrónico a los destinatarios
 * correspondientes. Asegura la autenticación mediante un secreto (`CRON_SECRET`) y maneja
 * errores para garantizar la estabilidad del proceso.
 */

import { NextResponse } from "next/server"
import { db } from "@/db/db"
import { alertsTable, groupMembersTable, profilesTable } from "@/db/schema"
import { getLogger } from "@/lib/logger"
import { inArray } from "drizzle-orm"
import { sendEmail } from "@/lib/mailer" // Import the mailer utility

const logger = getLogger("cron-check-alerts")

/**
 * Handles incoming requests from Vercel Cron Jobs to check and send alerts.
 * This route is protected by `CRON_SECRET`.
 * @param {Request} request - The incoming request object.
 * @returns {Promise<NextResponse>} A JSON response indicating the status of the alert check.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    logger.error("CRON_SECRET environment variable is not set.")
    return NextResponse.json(
      {
        success: false,
        message: "Server configuration error: CRON_SECRET missing."
      },
      { status: 500 }
    )
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized access attempt to cron job endpoint.")
    return NextResponse.json(
      { success: false, message: "Unauthorized." },
      { status: 401 }
    )
  }

  logger.info("Cron job 'check-alerts' started.")

  try {
    const allAlerts = await db.select().from(alertsTable)
    logger.info(`Found ${allAlerts.length} alerts to process.`)

    for (const alert of allAlerts) {
      logger.info(`Processing alert: ${alert.id}, Type: ${alert.alertType}`)

      // Placeholder for complex alert evaluation logic
      // In a real scenario, this would involve detailed checks for each alert type:
      // - 'Red KPI': Fetch KPI values, compare to thresholds, check if 'Red'.
      // - 'Update Reminder': Check kpi_updaters and kpi_values for overdue updates.
      // - 'Note Reply': Check for new replies to notes.
      // - 'Custom KPI Change': Evaluate conditionDetails against actual KPI values.

      // For this atomic step, we'll simulate an alert trigger based on a simple condition.
      // This will be refined in future steps with a dedicated alert evaluation engine.
      const shouldTrigger = Math.random() < 0.2 // 20% chance to "trigger" for demonstration

      if (shouldTrigger) {
        logger.info(
          `Alert ${alert.id} (${alert.alertType}) condition met. Preparing to send notification.`
        )

        const recipientEmails: string[] = []

        // Fetch user emails from profilesTable (type-safe guards)
        const userIds = Array.isArray(alert.recipientsUserIds)
          ? alert.recipientsUserIds
          : []
        if (userIds.length > 0) {
          const users = await db
            .select({ email: profilesTable.email })
            .from(profilesTable)
            .where(inArray(profilesTable.userId, userIds))
          recipientEmails.push(
            ...(users.map(u => u.email).filter(Boolean) as string[])
          )
        }

        // Fetch group member emails (type-safe guards)
        const groupIds = Array.isArray(alert.recipientsGroupIds)
          ? alert.recipientsGroupIds
          : []
        if (groupIds.length > 0) {
          const groupMembers = await db
            .select({ userId: groupMembersTable.userId })
            .from(groupMembersTable)
            .where(inArray(groupMembersTable.groupId, groupIds))

          const memberUserIds = groupMembers
            .map(gm => gm.userId)
            .filter(Boolean)
          if (memberUserIds.length > 0) {
            const groupUsers = await db
              .select({ email: profilesTable.email })
              .from(profilesTable)
              .where(inArray(profilesTable.userId, memberUserIds))
            recipientEmails.push(
              ...(groupUsers.map(u => u.email).filter(Boolean) as string[])
            )
          }
        }

        const uniqueRecipientEmails = Array.from(new Set(recipientEmails))

        if (uniqueRecipientEmails.length > 0) {
          const emailSubject = `DeltaOne Alert: ${alert.alertType} Triggered!`
          const emailBody = `Dear User,\n\nThis is an automated alert from DeltaOne.\n\nYour alert of type '${alert.alertType}' (ID: ${alert.id}) has been triggered.\n\n${alert.kpiId ? `Associated KPI ID: ${alert.kpiId}\n` : ""}Condition details: ${JSON.stringify(alert.conditionDetails, null, 2)}\nFrequency: ${JSON.stringify(alert.frequencyConfig, null, 2)}\n\nPlease log in to DeltaOne for more details.\n\nBest regards,\nDeltaOne Team`

          const emailHtml = `
            <p>Dear User,</p>
            <p>This is an automated alert from DeltaOne.</p>
            <p>Your alert of type '<strong>${alert.alertType}</strong>' (ID: ${alert.id}) has been triggered.</p>
            ${alert.kpiId ? `<p>Associated KPI ID: ${alert.kpiId}</p>` : ""}
            <p>Condition details: <code><pre>${JSON.stringify(alert.conditionDetails, null, 2)}</pre></code></p>
            <p>Frequency: <code><pre>${JSON.stringify(alert.frequencyConfig, null, 2)}</pre></code></p>
            <p>Please log in to <a href="YOUR_DELTACLOUD_URL">DeltaOne</a> for more details.</p>
            <p>Best regards,<br/>DeltaOne Team</p>
          `

          const emailSent = await sendEmail({
            to: uniqueRecipientEmails,
            subject: emailSubject,
            text: emailBody,
            html: emailHtml
          })

          if (emailSent) {
            logger.info(
              `Email notification sent for alert ${alert.id} to ${uniqueRecipientEmails.length} recipients.`
            )
          } else {
            logger.error(
              `Failed to send email notification for alert ${alert.id}.`
            )
          }
        } else {
          logger.warn(
            `Alert ${alert.id} triggered but no recipient emails found.`
          )
        }
      }
    }

    logger.info("Cron job 'check-alerts' finished successfully.")
    return NextResponse.json({
      success: true,
      message: "Alerts checked successfully."
    })
  } catch (error) {
    logger.error(
      `Error during cron job 'check-alerts': ${error instanceof Error ? error.message : String(error)}`,
      { error }
    )
    return NextResponse.json(
      {
        success: false,
        message: `Failed to check alerts: ${error instanceof Error ? error.message : String(error)}`
      },
      { status: 500 }
    )
  }
}
