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
