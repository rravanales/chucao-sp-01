/**
 *  @file types/permissions-types.ts
 *  @brief Define tipos relacionados con la gestión de permisos de usuario.
 *  @description Este archivo unifica y mejora la versión 1 con los aportes de la versión 2:
 *   - Mantiene la interfaz `UserPermission` para modelar la respuesta del backend (compatibilidad).
 *   - Define `UserPermissionsMap` usando un sentinel `'global'` para permisos sin organización
 *     (evita usar `null` como clave de objeto en JS/TS).
 *   - Agrega `PermissionContextType` para el contexto de permisos en el frontend.
 *   - Incluye utilidades para normalizar el `organizationId` y una fábrica de `hasPermission`.
 */

/**
 *  @interface UserPermission
 *  @description Representa un permiso específico asignado a un usuario (a través de sus grupos).
 *  @property {string} permissionKey - La clave única que identifica el permiso (ej. 'organization:create').
 *  @property {boolean} permissionValue - El valor del permiso (true si está concedido, false si está denegado).
 *  @property {string | null} organizationId - El ID de la organización a la que aplica el permiso, o `null` si es global.
 */
export interface UserPermission {
  permissionKey: string
  permissionValue: boolean
  organizationId: string | null
}

/**
 *  @type OrgScope
 *  @description Clave de alcance para indexar permisos por organización.
 *  - Para permisos globales (cuando el backend entrega `organizationId: null`) se usa el sentinel `'global'`.
 *  - Para permisos por organización, se usa el UUID de la organización (string).
 */
export type OrgScope = string | "global"

/**
 *  @type UserPermissionsMap
 *  @description Tipo auxiliar para un acceso más eficiente a los permisos por clave y organización.
 *  Mapea la `permissionKey` a un objeto que contiene permisos específicos por `OrgScope`.
 *  NOTA: Usamos `'global'` como representación del caso `organizationId: null` que viene del backend.
 *
 *  Ejemplo de forma:
 *  {
 *    "organization:create": { "global": true, "org-uuid-1": false },
 *    "project:read": { "org-uuid-1": true, "org-uuid-2": true }
 *  }
 */
export type UserPermissionsMap = Record<string, Record<OrgScope, boolean>>

/**
 *  @interface PermissionContextType
 *  @description Define la estructura del objeto de contexto de permisos para el frontend.
 *  @property {UserPermissionsMap | null} userPermissions - Un mapa de los permisos del usuario actual, o null si no se han cargado.
 *  @property {boolean} isLoading - Indica si los permisos están cargándose.
 *  @property {(permissionKey: string, organizationId?: string | null) => boolean} hasPermission - Función para verificar si el usuario tiene un permiso específico.
 */
export interface PermissionContextType {
  userPermissions: UserPermissionsMap | null
  isLoading: boolean
  hasPermission: (
    permissionKey: string,
    organizationId?: string | null
  ) => boolean
}

/**
 *  Normaliza un `organizationId` que puede venir como `string | null | undefined` desde el backend o la UI
 *  a la clave de alcance (`OrgScope`) que usamos en el mapa: UUID de org o `'global'`.
 */
export const toOrgScope = (organizationId?: string | null): OrgScope =>
  organizationId ?? "global"

/**
 *  Fábrica de verificador de permisos.
 *  - Prioriza el permiso específico por organización (si existe).
 *  - Si no hay permiso específico, cae al permiso global (si existe).
 *  - Si no encuentra ninguno, retorna `false`.
 *
 *  Esta función es opcional: puedes inyectarla en tu contexto como `hasPermission`.
 */
export const makeHasPermission =
  (permissions: UserPermissionsMap | null) =>
  (permissionKey: string, organizationId?: string | null): boolean => {
    if (!permissions) return false
    const scoped = permissions[permissionKey]
    if (!scoped) return false

    const scope = toOrgScope(organizationId)
    // 1) Intenta permiso por organización; 2) fallback a global; 3) false
    return scoped[scope] ?? scoped["global"] ?? false
  }

/**
 *  (Opcional) Utilidad para construir un `UserPermissionsMap` a partir de una lista de `UserPermission`
 *  entregada por el backend. Mantiene compatibilidad con v1 y aplica la normalización `null -> 'global'`.
 */
export const buildUserPermissionsMap = (
  userPermissionsList: UserPermission[]
): UserPermissionsMap => {
  const map: UserPermissionsMap = {}

  for (const {
    permissionKey,
    permissionValue,
    organizationId
  } of userPermissionsList) {
    const scope = toOrgScope(organizationId)
    map[permissionKey] ??= {}
    map[permissionKey][scope] = permissionValue
  }

  return map
}
