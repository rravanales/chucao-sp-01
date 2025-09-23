/**
 * @file lib/__tests__/setup-mocks.ts
 * @brief Configuración global para el entorno de pruebas de Vitest.
 * @description Este archivo inicializa los mocks esenciales antes de que se ejecute cualquier prueba
 * (setupFiles en vitest.config.ts), aislando las Server Actions de las dependencias externas
 * como Drizzle ORM, Clerk y el logger.
 */

import { vi } from "vitest"
import { createMockDB, mockLogger } from "../db-helpers2"

// 1. Mocking para Drizzle ORM
// Importamos el módulo real de la base de datos para reemplazar la exportación de `db`
vi.mock("@/db/db", () => ({
  db: createMockDB()
}))

// 2. Mocking para Clerk Authentication
// Reemplazamos la exportación de `auth` de Clerk para inyectar un usuario simulado
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => ({ userId: "test-user-id-123" }))
}))

// 3. Mocking para el Logger
// Reemplazamos la función getLogger para usar un logger simulado
vi.mock("@/lib/logger", () => ({
  getLogger: vi.fn(() => mockLogger())
}))

// 4. Mocking para la Librería de Cifrado (encryption)
// Se simula la librería de cifrado, ya que su lógica no debe ser el foco de las pruebas de acción.
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn(data => `ENCRYPTED(${data})`),
  decrypt: vi.fn(data => data.replace("ENCRYPTED(", "").replace(")", ""))
}))

// 5. Mocking para el Router de Next.js
// Se utiliza en componentes cliente que llaman a router.refresh()
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn()
  })),
  // También mockeamos `revalidatePath` y `revalidateTag` si se usan en Server Actions
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn()
}))

// 6. Mocking para Next.js Server Actions (si se llama a otras acciones, aunque se prefiere importarlas directamente para probar)
// Se deja opcional, ya que usualmente las acciones que invocan otras acciones se prueban a nivel de integración.
