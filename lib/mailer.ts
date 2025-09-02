/**
 * @file lib/mailer.ts
 * @brief Implementa la funcionalidad para el envío de correos electrónicos en el sistema.
 * @description Este archivo contiene funciones para configurar y utilizar un cliente SMTP
 * mediante Nodemailer. Permite enviar correos electrónicos con soporte para texto plano
 * y HTML, asegurando la validación de las configuraciones necesarias y el manejo de errores
 * durante el proceso de envío.
 */

import nodemailer from "nodemailer"
import { getLogger } from "@/lib/logger"

const logger = getLogger("mailer")

/**
 * @interface EmailOptions
 * @description Define las opciones para enviar un correo electrónico.
 * @property {string | string[]} to - El/los destinatario/s del correo electrónico.
 * @property {string} subject - El asunto del correo electrónico.
 * @property {string} text - El cuerpo del correo electrónico en texto plano.
 * @property {string} [html] - El cuerpo del correo electrónico en formato HTML (opcional).
 */
interface EmailOptions {
  to: string | string[]
  subject: string
  text: string
  html?: string
}

/**
 * @constant transporter
 * @description Configura el objeto Nodemailer transporter utilizando las credenciales SMTP
 * del entorno. Esto permite el envío de correos electrónicos a través de un servidor SMTP.
 * Se inicializa de forma lazy para asegurar que las variables de entorno estén cargadas.
 */
let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (transporter) {
    return transporter
  }

  const smtpHost = process.env.SMTP_HOST
  const smtpPort = process.env.SMTP_PORT
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    logger.error("Missing SMTP environment variables. Email sending will fail.")
    throw new Error("Missing SMTP configuration. Cannot send emails.")
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort, 10),
    secure: parseInt(smtpPort, 10) === 465, // true for 465, false for other ports (like 587)
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
    // Optional: add TLS options if necessary, e.g., rejectUnauthorized: true
  })

  return transporter
}

/**
 * @function sendEmail
 * @description Envía un correo electrónico utilizando la configuración SMTP definida.
 * @param {EmailOptions} options - Un objeto que contiene los destinatarios, el asunto y el cuerpo del correo.
 * @returns {Promise<boolean>} `true` si el correo se envió con éxito, `false` en caso contrario.
 * @throws {Error} Si faltan las variables de entorno SMTP o si falla el envío del correo.
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const mailer = getTransporter()

    const info = await mailer.sendMail({
      from: process.env.SMTP_USER, // Sender address defaults to SMTP_USER
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html
    })

    logger.info(`Email sent: ${info.messageId}`, {
      to: options.to,
      subject: options.subject
    })
    return true
  } catch (error) {
    logger.error(
      `Failed to send email to ${options.to}: ${error instanceof Error ? error.message : String(error)}`,
      { error }
    )
    return false
  }
}
