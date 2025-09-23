/**
 * @file lib/db-helpers2.ts
 * Utilidades de mocking para Drizzle con Vitest.
 */

import { db } from "@/db/db"
import type { ActionState } from "@/types"
// (Deja estos imports si realmente los usas en otros helpers)
import type { InferInsertModel, InferSelectModel } from "drizzle-orm"
import type { InsertKpi, SelectKpi } from "@/db/schema"

// ✅ Usa Vitest (no Jest)
import { vi, type Mock, type MockedFunction } from "vitest"

// Tipos genéricos para mockear el cliente de Drizzle
type MockedDrizzleClient = typeof db

/**
 * Transacción simulada (solo las firmas que necesitas en tests)
 */
interface MockTransaction {
  select: Mock
  insert: Mock
  update: Mock
  delete: Mock
}

/**
 * DB mockeada
 */
export type MockDB = MockedDrizzleClient & {
  transaction: MockedFunction<
    (
      cb: (tx: MockTransaction) => unknown | Promise<unknown>
    ) => Promise<unknown>
  >
}
/**
 * Crea un objeto MockDB con funciones mock (Vitest)
 */
export function createMockDB(): MockDB {
  // mocks encadenables tipo db.select().where().execute()
  const chainable = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([])
  }

  const mockTransaction: MockTransaction = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }

  const mockDB = {
    // tablas con API encadenable simulada
    profiles: { ...chainable },
    kpis: { ...chainable },

    // API de nivel de cliente
    ...chainable,

    // transacción que inyecta la tx mock
    transaction: vi.fn(
      async (cb: (tx: MockTransaction) => unknown | Promise<unknown>) => {
        return cb(mockTransaction)
      }
    )
  } as unknown as MockDB

  return mockDB
}

/**
 * Mock de auth() de Clerk
 */
export function createMockAuth(
  userId: string | null = "mock-user-id-123"
): () => Promise<{ userId: string | null }> {
  return async () => ({ userId })
}

/**
 * Logger mock (Vitest)
 */
export function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}

/**
 * Tipo auxiliar para funciones mockeadas (de Vitest)
 */
export type { MockedFunction } from "vitest"

// --- Tipos para Server Actions mockeadas ---
export type MockAction<T> = (
  data: T,
  ...args: any[]
) => Promise<ActionState<any>>
export type MockedAction<T> = MockedFunction<MockAction<T>>
