/**
 * @file vitest.config.ts
 * @brief Configuración para Vitest, nuestro runner de pruebas unitarias.
 * @description Configura el ambiente de pruebas para Node.js (ideal para Server Actions)
 * y asegura que los alias de TypeScript (`@/`) se resuelvan correctamente.
 * También configura la generación de reportes de cobertura.
 */

import { defineConfig } from "vitest/config"
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Entorno: Node.js, ya que las Server Actions corren en el servidor.
    environment: "node", 
    // Patrones de archivos de prueba
    include: ["**/*.test.ts"], 
    // Rutas a ignorar (exclusiones de la regla de no modificar migraciones)
    exclude: ["node_modules", "db/migrations"],
    setupFiles: ["./lib/__tests__/setup-mocks.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Incluye la cobertura para las acciones críticas y librerías de negocio
      include: ["actions/db/**/*.ts", "lib/**/*.ts"],
      // Excluye archivos que no se prueban en unitarias o que son mocks/types/config.
      exclude: [
        "actions/stripe-actions.ts", // Lógica de terceros (Stripe)
        "actions/**/*.test.ts",
        "lib/utils.ts", // Funciones simples de utilidad
        "lib/encryption.ts", // Solo tiene funciones placeholder para la implementación actual
        "lib/logger.ts", // No necesitamos probar el logger
        "lib/mailer.ts", // Dependencia externa (Nodemailer) que se mochea
        "types/**/*.ts",
        "db/**/*.ts",
      ],
    },
    globals: true, // Permite el uso de describe, test, expect globalmente
  },
})