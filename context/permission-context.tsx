"use client"

/**
 * @file context/permission-context.tsx
 * @brief Proporciona un contexto de permisos global para la aplicación DeltaOne.
 * @description Este componente `PermissionProvider` carga los permisos del usuario
 * al inicio de la aplicación y los pone a disposición de todos los componentes
 * hijos a través de un `Context`. Esto permite una verificación de permisos
 * centralizada y eficiente en todo el frontend. Incluye un hook `usePermissions`
 * para un consumo sencillo.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  JSX
} from "react"
import {
  UserPermissionsMap,
  PermissionContextType
} from "@/types/permissions-types"
import { useToast } from "@/components/ui/use-toast"

// Sentinel consistente con el tipo UserPermissionsMap de v1/opción A
const GLOBAL_SCOPE = "global" as const

// Definir el valor por defecto del contexto
const PermissionContext = createContext<PermissionContextType | undefined>(
  undefined
)

interface PermissionProviderProps {
  children: React.ReactNode
  initialPermissions: UserPermissionsMap | null
}

/**
 * @function PermissionProvider
 * @description Componente proveedor del contexto de permisos.
 * Carga los permisos iniciales y proporciona una función para verificarlos.
 * @param {PermissionProviderProps} { children, initialPermissions } - Los componentes hijos y los permisos iniciales obtenidos del servidor.
 * @returns {JSX.Element} El proveedor de contexto de permisos.
 */
export function PermissionProvider({
  children,
  initialPermissions
}: PermissionProviderProps): JSX.Element {
  const [userPermissions, setUserPermissions] =
    useState<UserPermissionsMap | null>(initialPermissions)
  const [isLoading] = useState<boolean>(false) // MVP: no recargamos en cliente
  const { toast } = useToast()

  useEffect(() => {
    if (initialPermissions) {
      setUserPermissions(initialPermissions)
    } else {
      // MVP: si no hay permisos iniciales, inicializamos vacío y avisamos
      setUserPermissions({})
      toast({
        title: "Permisos no disponibles",
        description:
          "No se pudieron cargar los permisos iniciales. Algunas funcionalidades podrían estar limitadas.",
        variant: "destructive"
      })
    }
  }, [initialPermissions, toast])

  /**
   * @function hasPermission
   * @description Verifica si el usuario actual tiene un permiso específico.
   * Prioriza el permiso específico por organización y luego el global.
   */
  const hasPermission = useCallback(
    (permissionKey: string, organizationId: string | null = null): boolean => {
      if (!userPermissions) return false

      const byScope = userPermissions[permissionKey]
      if (!byScope) return false

      // Primero: permiso específico de organización (si existe)
      const scopeKey = organizationId ?? GLOBAL_SCOPE
      if (Object.prototype.hasOwnProperty.call(byScope, scopeKey)) {
        return byScope[scopeKey]
      }

      // Fallback: permiso global
      if (Object.prototype.hasOwnProperty.call(byScope, GLOBAL_SCOPE)) {
        return byScope[GLOBAL_SCOPE]
      }

      return false
    },
    [userPermissions]
  )

  // Usar useMemo para memoizar el objeto de contexto y evitar re-renders innecesarios.
  const contextValue = useMemo(
    () => ({
      userPermissions,
      isLoading,
      hasPermission
    }),
    [userPermissions, isLoading, hasPermission]
  )

  return (
    <PermissionContext.Provider value={contextValue}>
      {children}
    </PermissionContext.Provider>
  )
}

/**
 * @function usePermissions
 * @description Hook personalizado para acceder al contexto de permisos.
 * Lanza un error si se usa fuera de un `PermissionProvider`.
 * @returns {PermissionContextType} El objeto de contexto de permisos.
 */
export function usePermissions(): PermissionContextType {
  const context = useContext(PermissionContext)
  if (context === undefined) {
    throw new Error("usePermissions must be used within a PermissionProvider")
  }
  return context
}
