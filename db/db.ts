/* Configures Drizzle for the app. */
import { config } from "dotenv"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import {
  profilesTable,
  organizationsTable,
  scorecardElementsTable,
  kpisTable,
  kpiValuesTable,
  kpiUpdatersTable,
  importConnectionsTable,
  savedImportsTable,
  alertsTable,
  groupsTable,
  groupMembersTable,
  groupPermissionsTable,
  appSettingsTable
} from "./schema"

config({ path: ".env.local" })

const schema = {
  profiles: profilesTable,
  organizations: organizationsTable,
  scorecardElements: scorecardElementsTable,
  kpis: kpisTable,
  kpiValues: kpiValuesTable,
  kpiUpdaters: kpiUpdatersTable,
  importConnections: importConnectionsTable,
  savedImports: savedImportsTable,
  alerts: alertsTable,
  groups: groupsTable,
  groupMembers: groupMembersTable,
  groupPermissions: groupPermissionsTable,
  appSettings: appSettingsTable
}

const client = postgres(process.env.DATABASE_URL!)

export const db = drizzle(client, { schema })
