/**
 * @file app/(main)/settings/app/page.tsx
 * @brief Página de administración de la configuración general de la aplicación DeltaOne.
 * @description Este Server Component se encarga de:
 *   - Autenticar al usuario para asegurar el acceso.
 *   - Obtener las configuraciones actuales de la aplicación, como la terminología personalizada
 *     y el estado de activación de los Strategy Maps, mediante Server Actions.
 *   - Pasar estas configuraciones como props al componente cliente `AppSettingsForm` para
 *     su visualización y edición.
 * Es un punto central para que los administradores personalicen la experiencia de la aplicación
 * (UC-403: Personalizar Terminología de la Aplicación, UC-404: Activar/Desactivar Strategy Maps).
 */

import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { getAppSettingAction } from "@/actions/db/app-settings-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import AppSettingsForm from "./_components/app-settings-form"
import { SelectAppSetting } from "@/db/schema"
import { Separator } from "@/components/ui/separator"

export default async function AppSettingsPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/login")
  }

  // Obtener configuraciones de la aplicación
  const [terminologySettingRes, strategyMapsSettingRes] = await Promise.all([
    getAppSettingAction("custom_kpi_term"), // Ejemplo: 'KPI' en lugar de 'Measures'
    getAppSettingAction("enable_strategy_maps") // true/false para Strategy Maps
  ])

  // Manejo de errores para la obtención de configuraciones
  if (!terminologySettingRes.isSuccess || !strategyMapsSettingRes.isSuccess) {
    return (
      <div className="container mx-auto py-12">
        <h1 className="mb-4 text-2xl font-bold">
          Error al cargar configuraciones
        </h1>
        <p className="text-red-500">
          {terminologySettingRes.message || strategyMapsSettingRes.message}
        </p>
      </div>
    )
  }

  const customKpiTerm: SelectAppSetting | null = terminologySettingRes.data
  const enableStrategyMaps: boolean =
    strategyMapsSettingRes.data?.settingValue === "true"

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Configuración de la Aplicación</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Personalización General</CardTitle>
        </CardHeader>
        <CardContent>
          <AppSettingsForm
            initialCustomKpiTerm={customKpiTerm}
            initialEnableStrategyMaps={enableStrategyMaps}
          />
        </CardContent>
      </Card>
    </div>
  )
}
