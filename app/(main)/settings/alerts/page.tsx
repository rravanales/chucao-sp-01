/**
 * @file app/(main)/settings/alerts/page.tsx
 * @brief Página de administración de alertas para configurar y gestionar las notificaciones en DeltaOne.
 * @description Server Component: autentica, obtiene datos y renderiza el form cliente.
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAllAlertsAction } from "@/actions/db/alert-actions"
import {
  getAllKpisForSelectAction,
  type KpiSelectOption
} from "@/actions/db/kpi-actions"
import { getAppSettingAction } from "@/actions/db/app-settings-actions"
import { getAllProfilesAction } from "@/actions/db/profiles-actions"
import { getAllGroupsAction } from "@/actions/db/user-group-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import AlertSettingsForm from "./_components/alert-settings-form"
import { SelectAlert, SelectProfile, SelectGroup } from "@/db/schema"

export default async function AlertSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  const [
    alertsRes,
    kpisRes,
    requireNoteForRedKpiSettingRes,
    enableNoteReplyAlertsSettingRes,
    profilesRes,
    groupsRes
  ] = await Promise.all([
    getAllAlertsAction(),
    getAllKpisForSelectAction(),
    getAppSettingAction("require_note_for_red_kpi"),
    getAppSettingAction("enable_note_reply_alerts"),
    getAllProfilesAction(),
    getAllGroupsAction()
  ])

  if (!alertsRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">Error al cargar alertas</h1>
        <p className="text-red-500">{alertsRes.message}</p>
      </div>
    )
  }

  if (!kpisRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">Error al cargar KPIs</h1>
        <p className="text-red-500">{kpisRes.message}</p>
      </div>
    )
  }

  if (!profilesRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar perfiles de usuario
        </h1>
        <p className="text-red-500">{profilesRes.message}</p>
      </div>
    )
  }

  if (!groupsRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar grupos de usuario
        </h1>
        <p className="text-red-500">{groupsRes.message}</p>
      </div>
    )
  }

  const alerts: SelectAlert[] = alertsRes.data || []
  const kpis: KpiSelectOption[] = kpisRes.data || []
  const profiles: SelectProfile[] = profilesRes.data || []
  const groups: SelectGroup[] = groupsRes.data || []

  const requireNoteForRedKpiEnabled =
    requireNoteForRedKpiSettingRes.isSuccess &&
    requireNoteForRedKpiSettingRes.data?.settingValue === "true"

  const enableNoteReplyAlertsEnabled =
    enableNoteReplyAlertsSettingRes.isSuccess &&
    enableNoteReplyAlertsSettingRes.data?.settingValue === "true"

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Configuración de Alertas</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gestionar Notificaciones y Automatizaciones</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertSettingsForm
            initialAlerts={alerts}
            allKpis={kpis}
            allProfiles={profiles}
            allGroups={groups}
            initialRequireNoteForRedKpi={requireNoteForRedKpiEnabled}
            initialEnableNoteReplyAlerts={enableNoteReplyAlertsEnabled}
          />
        </CardContent>
      </Card>
    </div>
  )
}
