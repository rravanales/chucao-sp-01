/**
 * @file lib/logger.ts
 * @brief Implementa un sistema de logging simple para la aplicación.
 * @description Este módulo proporciona una función para obtener un logger con un prefijo específico,
 * que imprime mensajes en la consola. Esto es útil para rastrear eventos en el servidor
 * y en Server Actions.
 */

/**
 * @typedef {'info' | 'warn' | 'error'} LogLevel
 * @description Define los niveles posibles de log: informativo, advertencia y error.
 */
type LogLevel = "info" | "warn" | "error"

/**
 * @interface Logger
 * @description Interfaz para el objeto logger, con métodos para diferentes niveles de log.
 * @property {function(message: string, ...args: any[]): void} info - Registra mensajes informativos.
 * @property {function(message: string, ...args: any[]): void} warn - Registra advertencias.
 * @property {function(message: string, ...args: any[]): void} error - Registra errores.
 */
interface Logger {
  info: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
}

/**
 * @function getLogger
 * @description Obtiene una instancia de logger con un prefijo dado.
 * @param {string} prefix - El prefijo para los mensajes de log (ej. "organization-actions").
 * @returns {Logger} Una instancia de Logger con métodos para `info`, `warn` y `error`.
 * @example
 * const logger = getLogger("my-module");
 * logger.info("Esto es un mensaje informativo.");
 * logger.error("Se produjo un error:", error);
 */
export function getLogger(prefix: string): Logger {
  /**
   * @private
   * @function log
   * @description Función interna para formatear y registrar mensajes de log.
   * @param {LogLevel} level - El nivel del log.
   * @param {string} message - El mensaje principal a registrar.
   * @param {...any[]} args - Argumentos adicionales para incluir en el log (ej. objetos de error).
   */
  const log = (level: LogLevel, message: string, ...args: any[]) => {
    const timestamp = new Date().toISOString()
    console[level](
      `[${timestamp}] [${prefix}] ${level.toUpperCase()}: ${message}`,
      ...args
    )
  }

  return {
    info: (message, ...args) => log("info", message, ...args),
    warn: (message, ...args) => log("warn", message, ...args),
    error: (message, ...args) => log("error", message, ...args)
  }
}
