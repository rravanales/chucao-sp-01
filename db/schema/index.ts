/**
 * @file db/schema/index.ts
 * @brief Exporta todos los esquemas de base de datos de la aplicación.
 * @description Este archivo actúa como un punto de entrada centralizado para importar y exportar
 * todos los esquemas Drizzle definidos en la carpeta db/schema/.
 */
export * from "./profiles-schema"
export * from "./organizations-schema" // Exportar el esquema de organizaciones
export * from "./scorecard-elements-schema" // Exportar el esquema de elementos del Scorecard
export * from "./kpis-schema" // Exportar el esquema de KPIs
export * from "./kpi-values-schema" // Exportar el esquema de valores de KPI
export * from "./kpi-updaters-schema" // Exportar el esquema de encargados de actualización de KPI
export * from "./import-connections-schema" // Exportar el esquema de conexiones de importación
export * from "./saved-imports-schema" // Exportar el esquema de importaciones guardadas
export * from "./alerts-schema" // Exportar el esquema de alertas
export * from "./groups-schema" // Exportar el esquema de grupos de usuarios
export * from "./group-members-schema" // Exportar el esquema de miembros de grupo
export * from "./group-permissions-schema" // Exportar el esquema de permisos de grupo
export * from "./app-settings-schema" // Exportar el esquema de configuración de la aplicación
