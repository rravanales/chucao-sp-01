/**
 * @file types/permissions-types.ts
 * @brief Define los tipos de datos para la gestión de permisos de usuario.
 * @description Este archivo contiene interfaces TypeScript que estructuran la información
 * de los permisos de usuario obtenidos del backend. Estos tipos son fundamentales
 * para implementar las verificaciones de autorización en el frontend, controlando
 * la visibilidad y habilitación de elementos de UI basados en los roles y permisos del usuario.
 */

/**
 * @interface UserPermission
 * @description Representa un permiso específico asignado a un usuario (a través de sus grupos).
 * @property {string} permissionKey - La clave única que identifica el permiso (ej. 'organization:create').
 * @property {boolean} permissionValue - El valor del permiso (true si está concedido, false si está denegado).
 * @property {string | null} organizationId - El ID de la organización a la que aplica el permiso, o `null` si es global.
 */
export interface UserPermission {
  permissionKey: string
  permissionValue: boolean
  organizationId: string | null
}

/**
 * @interface UserPermissionsMap
 * @description Tipo auxiliar para un acceso más eficiente a los permisos por clave y organización.
 * Mapea la clave del permiso a un objeto que contiene permisos específicos por `organizationId` (o `global` para `null`).
 */
export type UserPermissionsMap = {
  [key: string]: {
    [organizationId: string]: boolean // organizationId puede ser 'global' para permisos nulos
  }
}
