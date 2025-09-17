/**
 * @file types/permissions-types.ts
 * @brief Define tipos relacionados con la gestión de permisos de usuario.
 * @description Este archivo unifica y mejora la versión 1 con los aportes de la versión 2:
 *  - Mantiene la interfaz UserPermission para modelar la respuesta del backend (compatibilidad).
 *  - Define UserPermissionsMap usando un sentinel 'global' para permisos sin organización
 *  - Agrega PermissionContextType para el contexto de permisos en el frontend.
 *  - Incluye utilidades para normalizar el organizationId y una fábrica de hasPermission.
 */

import { z } from "zod"

/** =========================
 *  Permission keys (v2)
 *  ========================= */
export type PermissionKey =
  | "user:manage"
  | "group:manage"
  | "group:assign_members"
  | "group:assign_permissions"
  | "organization:manage"
  | "kpi:manage"
  | "scorecard_element:manage"
  | "import:manage_connections"
  | "import:manage_saved_imports"
  | "alert:manage"

/** =========================
 *  Backend shapes (v1 & v2)
 *  ========================= */

// v1 (backend legacy)
export interface BackendUserPermissionV1 {
  permissionKey: string
  permissionValue: boolean
  organizationId: string | null
}

// v2 (typed)
export interface BackendUserPermissionV2 {
  key: PermissionKey
  value: boolean
  organizationId: string | null
}

// Aceptamos ambos formatos de backend
export type BackendUserPermission =
  | BackendUserPermissionV1
  | BackendUserPermissionV2

const isV1 = (p: BackendUserPermission): p is BackendUserPermissionV1 =>
  (p as BackendUserPermissionV1).permissionKey !== undefined

const isV2 = (p: BackendUserPermission): p is BackendUserPermissionV2 =>
  (p as BackendUserPermissionV2).key !== undefined

/** =========================
 *  Org scoping & maps
 *  ========================= */

export type OrgScope = string | "global"

export const toOrgScope = (organizationId?: string | null): OrgScope =>
  organizationId ?? "global"

// Compat: mapa laxa (acepta claves no declaradas, ej. flags experimentales)
export type UserPermissionsMap = Record<string, Record<OrgScope, boolean>>

// Opcional: versión estricta si quieres cerrar a PermissionKey
export type StrictUserPermissionsMap = {
  [K in PermissionKey]?: Record<OrgScope, boolean>
}

/** =========================
 *  Contexto (no romper v1)
 *  ========================= */

// v1: conserva nombres/props (incluye isLoading)
export interface PermissionContextType {
  userPermissions: UserPermissionsMap | null
  // alias v2: algunos consumidores nuevos esperan `permissions`
  permissions?: UserPermissionsMap | null
  isLoading: boolean
  hasPermission: (
    permissionKey: string, // mantener string para compatibilidad
    organizationId?: string | null
  ) => boolean
}

/** =========================
 *  Utilidades
 *  ========================= */

export const normalizeOrganizationId = (
  organizationId: string | null | undefined
): string => (organizationId == null ? "global" : organizationId)

/**
 * Fábrica v1 con fallback:
 * 1) permiso por org → 2) global → 3) false
 */
export const makeHasPermission =
  (permissions: UserPermissionsMap | null) =>
  (permissionKey: string, organizationId?: string | null): boolean => {
    if (!permissions) return false
    const scoped = permissions[permissionKey]
    if (!scoped) return false
    const scope = toOrgScope(organizationId)
    return scoped[scope] ?? scoped["global"] ?? false
  }

/**
 * Alias v2 de la fábrica, manteniendo el comportamiento con fallback.
 * Firma más estricta en la sobrecarga, pero implementación acepta string.
 */
export function createHasPermission(permissions: UserPermissionsMap | null): {
  (key: PermissionKey, organizationId?: string | null): boolean
  (key: string, organizationId?: string | null): boolean
}
export function createHasPermission(permissions: UserPermissionsMap | null) {
  return makeHasPermission(permissions)
}

/**
 * Construye un UserPermissionsMap desde una lista (acepta v1 y v2).
 */
export const buildUserPermissionsMap = (
  list: BackendUserPermission[]
): UserPermissionsMap => {
  const map: UserPermissionsMap = {}
  for (const p of list) {
    const permissionKey = isV1(p) ? p.permissionKey : p.key
    const permissionValue = isV1(p) ? p.permissionValue : p.value
    const scope = toOrgScope(p.organizationId)

    map[permissionKey] ??= {}
    map[permissionKey][scope] = permissionValue
  }
  return map
}

/** =========================
 *  Schemas
 *  ========================= */

// Mantiene nombres v1 (backend contracts existentes)
export const upsertPermissionSchema = z.object({
  groupId: z.string().uuid("ID de grupo inválido."),
  permissionKey: z.enum(
    [
      "user:manage",
      "group:manage",
      "group:assign_members",
      "group:assign_permissions",
      "organization:manage",
      "kpi:manage",
      "scorecard_element:manage",
      "import:manage_connections",
      "import:manage_saved_imports",
      "alert:manage"
    ],
    { errorMap: () => ({ message: "Clave de permiso inválida." }) }
  ),
  permissionValue: z.boolean(),
  organizationId: z
    .string()
    .uuid("ID de organización inválido.")
    .nullable()
    .optional()
})
