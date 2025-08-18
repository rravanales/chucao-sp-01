/**
 * @file lib/encryption.ts
 * @brief Módulo para funciones de cifrado y descifrado de texto.
 * @description Este archivo contiene utilidades para cifrar y descifrar cadenas de texto
 *              utilizando AES-256-CBC, destinadas a proteger información sensible como
 *              credenciales de bases de datos antes de su almacenamiento.
 *              Utiliza una clave de cifrado definida en las variables de entorno para
 *              mantener la seguridad.
 */

import crypto from "crypto"

// Longitud del Vector de Inicialización (IV) para AES-256-CBC
// Se recomienda que sea un valor fijo o derivado de una forma segura si el IV es dinámico.
// Para este ejemplo, se usará un IV de 16 bytes.
const IV_LENGTH = 16 // Para AES-256-CBC, el IV es de 16 bytes (128 bits)

/**
 * @function encrypt
 * @description Cifra una cadena de texto utilizando AES-256-CBC.
 * @param {string} text La cadena de texto a cifrar.
 * @returns {string} El texto cifrado en formato hexadecimal, que incluye el IV al inicio.
 * @throws {Error} Si ENCRYPTION_KEY no está definida en las variables de entorno.
 */
export function encrypt(text: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY

  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY environment variable is not defined.")
  }

  // Asegurar que la clave tenga el tamaño correcto para AES-256 (32 bytes = 256 bits)
  const key = crypto.scryptSync(encryptionKey, "salt", 32) // Derivar una clave segura

  // Generar un vector de inicialización (IV) aleatorio
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)
  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")

  // Devolver el IV junto con el texto cifrado para descifrarlo más tarde
  return iv.toString("hex") + ":" + encrypted
}

/**
 * @function decrypt
 * @description Descifra una cadena de texto cifrada utilizando AES-256-CBC.
 * @param {string} text El texto cifrado en formato hexadecimal, que incluye el IV al inicio.
 * @returns {string} El texto descifrado.
 * @throws {Error} Si ENCRYPTION_KEY no está definida en las variables de entorno o el formato del texto cifrado es incorrecto.
 */
export function decrypt(text: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY

  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY environment variable is not defined.")
  }

  const key = crypto.scryptSync(encryptionKey, "salt", 32) // Derivar la misma clave

  const textParts = text.split(":")
  if (textParts.length !== 2) {
    throw new Error("Invalid encrypted text format.")
  }

  const iv = Buffer.from(textParts[0], "hex")
  const encryptedText = textParts[1]

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)
  let decrypted = decipher.update(encryptedText, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}
