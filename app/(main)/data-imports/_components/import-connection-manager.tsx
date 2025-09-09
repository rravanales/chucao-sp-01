/**
 * @file app/(main)/data-imports/_components/import-connection-manager.tsx
 * @brief Componente de cliente para gestionar las conexiones de importación.
 * @description Este componente permite a los usuarios visualizar, crear, editar y eliminar
 * conexiones a fuentes de datos externas (bases de datos, hojas de cálculo).
 * Utiliza Server Actions para todas las operaciones CRUD y `shadcn/ui` para la interfaz.
 * Las credenciales sensibles se gestionan mediante cifrado/descifrado.
 * (UC-202: Gestionar Conexiones de Importación de Datos)
 */
"use client"

import React, { useState, useEffect } from "react"
import {
  SelectImportConnection,
  importConnectionTypeEnum,
  SelectKpi
} from "@/db/schema"
import {
  createImportConnectionAction,
  updateImportConnectionAction,
  deleteImportConnectionAction,
  testImportConnectionAction
} from "@/actions/db/import-connections-actions"
import { ActionState } from "@/types"
import { useToast } from "@/components/ui/use-toast"
import { useRouter } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  MoreVertical,
  Edit,
  Trash2,
  Database,
  FileSpreadsheet,
  TestTube,
  Loader2,
  Save,
  PlusCircle // FIX #3: import faltante
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"

// ================================================
// FIX #1: Definir un Zod schema local para validar
// los detalles de conexión (Excel / DB), en lugar
// de importar un símbolo inexistente.
// Es flexible (.passthrough) y opcionaliza campos.
// ================================================
const ImportConnectionDetailsSchema = z
  .object({
    // Excel
    filePath: z.string().min(1, "filePath requerido").optional(),
    sheetName: z.string().optional(),

    // Bases de datos
    server: z.string().optional(),
    port: z.number().int().optional(),
    databaseName: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    query: z.string().optional()
  })
  .passthrough()

/**
 * @interface ImportConnectionManagerProps
 * @description Propiedades para el componente ImportConnectionManager.
 * @property {SelectImportConnection[]} connections - Array de conexiones de importación existentes.
 */
interface ImportConnectionManagerProps {
  connections: SelectImportConnection[]
}

/**
 * @interface ImportConnectionFormProps
 * @description Propiedades para el formulario de conexión de importación.
 * @property {SelectImportConnection | null} [connection] - Conexión existente para edición, o null para creación.
 * @property {() => void} onSuccess - Callback a ejecutar después de una operación exitosa (creación/edición).
 */
interface ImportConnectionFormProps {
  connection?: SelectImportConnection | null
  onSuccess: () => void
}

/**
 * Define el esquema de validación para el formulario de conexión de importación.
 * Es una combinación del esquema de creación y actualización de Server Actions.
 */
const formSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre de la conexión es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  connectionType: z.enum(importConnectionTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de conexión inválido." })
  }),
  connectionDetails: z
    .string()
    .min(1, "Los detalles de conexión son requeridos.")
    .max(
      2000,
      "Los detalles de conexión no pueden exceder los 2000 caracteres."
    )
    .refine(val => {
      try {
        const parsed = JSON.parse(val)
        const detailsValidation =
          ImportConnectionDetailsSchema.safeParse(parsed)
        return detailsValidation.success
      } catch {
        return false
      }
    }, "Los detalles de conexión deben ser un JSON válido y seguir el esquema esperado.")
})

/**
 * @function ImportConnectionForm
 * @description Componente de formulario para crear o editar una conexión de importación.
 * Maneja la lógica de envío, validación y feedback al usuario.
 */
const ImportConnectionForm: React.FC<ImportConnectionFormProps> = ({
  connection = null,
  onSuccess
}) => {
  const isEditMode = !!connection
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: connection?.name || "",
      connectionType: connection?.connectionType || "Excel",
      connectionDetails: connection?.connectionDetails
        ? JSON.stringify(connection.connectionDetails, null, 2)
        : '{\n  "filePath": "",\n  "databaseName": "",\n  "server": "",\n  "port": 5432,\n  "user": "",\n  "password": "",\n  "query": ""\n}'
    }
  })

  useEffect(() => {
    if (connection) {
      form.reset({
        name: connection.name,
        connectionType: connection.connectionType,
        connectionDetails: JSON.stringify(connection.connectionDetails, null, 2)
      })
    } else {
      form.reset({
        name: "",
        connectionType: "Excel",
        connectionDetails:
          '{\n  "filePath": "",\n  "databaseName": "",\n  "server": "",\n  "port": 5432,\n  "user": "",\n  "password": "",\n  "query": ""\n}'
      })
    }
  }, [connection, form])

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true)
    let result: ActionState<SelectImportConnection>

    try {
      const parsedDetails = JSON.parse(values.connectionDetails)
      if (isEditMode && connection?.id) {
        result = await updateImportConnectionAction(connection.id, {
          name: values.name,
          connectionType: values.connectionType,
          connectionDetails: JSON.stringify(parsedDetails)
        })
      } else {
        result = await createImportConnectionAction({
          name: values.name,
          connectionType: values.connectionType,
          connectionDetails: JSON.stringify(parsedDetails)
        })
      }

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description: `Conexión ${isEditMode ? "actualizada" : "creada"} correctamente.`
        })
        onSuccess()
        router.refresh()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        })
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Error al procesar los detalles de conexión: ${error.message}`,
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTestConnection = async () => {
    setIsTestingConnection(true)
    try {
      const values = form.getValues()
      const result = await testImportConnectionAction({
        connectionType: values.connectionType,
        connectionDetails: values.connectionDetails
      })

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description:
            "Conexión probada exitosamente. Los detalles son válidos."
        })
      } else {
        toast({
          title: "Error",
          description: `Fallo al probar la conexión: ${result.message}`,
          variant: "destructive"
        })
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Error al intentar probar la conexión: ${error.message}`,
        variant: "destructive"
      })
    } finally {
      setIsTestingConnection(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre de la Conexión</FormLabel>
              <FormControl>
                <Input placeholder="Nombre único de la conexión" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="connectionType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de Conexión</FormLabel>
              <UiSelect onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo de conexión" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {importConnectionTypeEnum.enumValues.map(type => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </UiSelect>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="connectionDetails"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Detalles de Conexión (JSON)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder={`Ejemplo:\n{\n  "filePath": "/path/to/data.xlsx",\n  "sheetName": "Sheet1"\n}\n\nO para DB:\n{\n  "server": "my.database.server",\n  "databaseName": "mydb",\n  "user": "dbuser",\n  "password": "dbpassword",\n  "query": "SELECT * FROM sales"\n}`}
                  rows={10}
                  className="font-mono"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleTestConnection}
            disabled={isTestingConnection || isSubmitting}
            className="flex-1"
          >
            {isTestingConnection ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <TestTube className="mr-2 size-4" />
            )}{" "}
            Probar Conexión
          </Button>
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}{" "}
            {isEditMode ? "Guardar Cambios" : "Crear Conexión"}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/**
 * @function ImportConnectionManager
 * @description Componente principal para la gestión de conexiones de importación.
 * Muestra una tabla con las conexiones existentes y maneja la eliminación y edición.
 */
const ImportConnectionManager: React.FC<ImportConnectionManagerProps> = ({
  connections
}) => {
  const { toast } = useToast()
  const router = useRouter()

  // FIX #2: deleteImportConnectionAction espera string, no { id: string }
  const handleDeleteConnection = async (id: string) => {
    const result = await deleteImportConnectionAction(id)
    if (result.isSuccess) {
      toast({
        title: "Éxito",
        description: "Conexión eliminada correctamente."
      })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  const getIconForConnectionType = (
    type: (typeof importConnectionTypeEnum.enumValues)[number]
  ) => {
    switch (type) {
      case "Excel":
        return <FileSpreadsheet className="size-4" />
      case "Microsoft SQL Server":
      case "Oracle":
      case "MySQL":
      case "PostgreSQL":
      case "Hive":
        return <Database className="size-4" />
      default:
        return null
    }
  }

  return (
    <div>
      {connections.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          No hay conexiones de importación configuradas. Haz clic en "Nueva
          Conexión" para empezar.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Creada</TableHead>
              <TableHead>Última Actualización</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map(connection => (
              <TableRow key={connection.id}>
                <TableCell className="font-medium">{connection.name}</TableCell>
                <TableCell className="flex items-center gap-2">
                  {getIconForConnectionType(connection.connectionType)}{" "}
                  {connection.connectionType}
                </TableCell>
                <TableCell>
                  {new Date(connection.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {new Date(connection.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="size-8 p-0">
                        <span className="sr-only">Abrir menú</span>
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <Dialog>
                        <DialogTrigger asChild>
                          <DropdownMenuItem onSelect={e => e.preventDefault()}>
                            <Edit className="mr-2 size-4" /> Editar
                          </DropdownMenuItem>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                          <DialogHeader>
                            <DialogTitle>
                              Editar Conexión de Importación
                            </DialogTitle>
                            <DialogDescription>
                              Modifica los detalles de tu conexión de
                              importación.
                            </DialogDescription>
                          </DialogHeader>
                          <ImportConnectionForm
                            connection={connection}
                            onSuccess={() => router.refresh()}
                          />
                        </DialogContent>
                      </Dialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={e => e.preventDefault()}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 size-4" /> Eliminar
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ¿Estás absolutamente seguro?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer. Esto eliminará
                              permanentemente la conexión de importación y todas
                              las importaciones guardadas que la utilicen.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                handleDeleteConnection(connection.id)
                              }
                              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                            >
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Dialog para crear conexión */}
      <Dialog>
        <DialogTrigger asChild>
          <Button className="mt-4" size="sm">
            <PlusCircle className="mr-2 size-4" /> Nueva Conexión
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Crear Nueva Conexión de Importación</DialogTitle>
            <DialogDescription>
              Configura una nueva conexión a tu fuente de datos (ej. base de
              datos, archivo).
            </DialogDescription>
          </DialogHeader>
          <ImportConnectionForm onSuccess={() => router.refresh()} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ImportConnectionManager
