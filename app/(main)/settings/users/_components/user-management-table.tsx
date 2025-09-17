/**
 * @file app/(main)/settings/users/_components/user-management-table.tsx
 * @brief Componente de cliente para la administración y visualización de usuarios.
 * @description Versión 2.1: mantiene contrato de v1 y agrega control por permisos:
 *  - Props v1: initialProfiles, initialGroups (compatibles).
 *  - Nuevo (opcional): canManageUsers para habilitar/inhabilitar acciones (v2).
 *  - Conserva edición individual (UC-400), desactivación (UC-400) e importación masiva (UC-401).
 */
"use client"

import React, { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { SelectProfile, SelectGroup, membershipEnum } from "@/db/schema"
import {
  updateUserAction,
  deactivateUserAction,
  bulkImportUsersAction
} from "@/actions/db/user-group-actions"
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
  UserRoundX, // Icono para desactivar usuario
  UploadCloud, // Icono para importación masiva
  Loader2,
  Save,
  Users
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"

/**
 * @interface UserManagementTableProps
 * @description Propiedades para el componente UserManagementTable.
 * @property {SelectProfile[]} initialProfiles - Lista inicial de perfiles de usuario.
 * @property {SelectGroup[]} initialGroups - Lista inicial de grupos (para mostrar membresías).
 * @property {boolean} [canManageUsers] - Si el usuario puede gestionar (editar/desactivar/importar). Default: true.
 */
interface UserManagementTableProps {
  initialProfiles: SelectProfile[]
  initialGroups: SelectGroup[]
  canManageUsers?: boolean
}

/**
 * @interface UserEditFormProps
 * @description Propiedades para el formulario de edición de usuario.
 * @property {SelectProfile} user - El perfil de usuario a editar.
 * @property {() => void} onSuccess - Callback a ejecutar después de una actualización exitosa.
 */
interface UserEditFormProps {
  user: SelectProfile
  onSuccess: () => void
}

/**
 * @schema userEditFormSchema
 * @description Esquema de validación para el formulario de edición de usuario.
 */
const userEditFormSchema = z.object({
  userId: z.string().min(1, "El ID de usuario es requerido."),
  email: z.string().email("Correo electrónico inválido.").optional().nullable(),
  membership: z
    .enum(membershipEnum.enumValues, {
      errorMap: () => ({ message: "Tipo de membresía inválido." })
    })
    .optional()
})

/**
 * @function UserEditForm
 * @description Formulario para editar un perfil de usuario.
 */
const UserEditForm: React.FC<UserEditFormProps> = ({ user, onSuccess }) => {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<z.infer<typeof userEditFormSchema>>({
    resolver: zodResolver(userEditFormSchema),
    defaultValues: {
      userId: user.userId,
      email: user.email,
      membership: user.membership
    }
  })

  const onSubmit = async (values: z.infer<typeof userEditFormSchema>) => {
    setIsSubmitting(true)
    let result: ActionState<SelectProfile>
    try {
      result = await updateUserAction(values)
      if (result.isSuccess) {
        toast({ title: "Éxito", description: "Perfil de usuario actualizado." })
        onSuccess()
        router.refresh()
      } else {
        toast({
          title: "Error",
          description: result.message,
          variant: "destructive"
        })
      }
    } catch (e) {
      toast({
        title: "Error",
        description: `Fallo inesperado: ${e instanceof Error ? e.message : String(e)}`,
        variant: "destructive"
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Correo Electrónico</FormLabel>
              <FormControl>
                <Input
                  placeholder="correo@ejemplo.com"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="membership"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Membresía</FormLabel>
              <UiSelect onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo de membresía" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {membershipEnum.enumValues.map(type => (
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
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Save className="mr-2 size-4" />
          )}{" "}
          Guardar Cambios
        </Button>
      </form>
    </Form>
  )
}

/**
 * @interface BulkImportUsersFormProps
 * @description Propiedades para el formulario de importación masiva de usuarios.
 */
interface BulkImportUsersFormProps {
  onSuccess: () => void
  onClose: () => void // Para cerrar el diálogo
}

/**
 * @schema bulkImportFormSchema
 * @description Esquema de validación para el formulario de importación masiva de usuarios.
 */
const bulkImportFormSchema = z.object({
  file: z
    .instanceof(FileList)
    .refine(file => file?.length === 1, "Un archivo es requerido.")
})

/**
 * @function BulkImportUsersForm
 * @description Formulario para la importación masiva de usuarios mediante un archivo CSV Base64.
 */
const BulkImportUsersForm: React.FC<BulkImportUsersFormProps> = ({
  onSuccess,
  onClose
}) => {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<z.infer<typeof bulkImportFormSchema>>({
    resolver: zodResolver(bulkImportFormSchema)
  })

  const onSubmit = async (values: z.infer<typeof bulkImportFormSchema>) => {
    setIsSubmitting(true)
    try {
      const file = values.file?.[0]
      if (!file) {
        toast({
          title: "Error",
          description: "No se seleccionó ningún archivo.",
          variant: "destructive"
        })
        return
      }

      const reader = new FileReader()
      reader.readAsDataURL(file)

      reader.onload = async event => {
        const base64Content = event.target?.result as string

        // Extraer la parte base64 (después de la coma)
        const cleanBase64 = base64Content.includes(",")
          ? base64Content.split(",")[1]
          : base64Content

        if (!cleanBase64) {
          toast({
            title: "Error",
            description: "No se pudo leer el contenido Base64 del archivo.",
            variant: "destructive"
          })
          setIsSubmitting(false)
          return
        }

        const result = await bulkImportUsersAction({
          fileName: file.name,
          fileContentBase64: cleanBase64
        })

        if (result.isSuccess) {
          toast({
            title: "Éxito",
            description: `Importación masiva completada: ${result.data?.createdCount} creados, ${result.data?.updatedCount} actualizados, ${result.data?.failedCount} fallidos.`
          })
          onSuccess()
          onClose()
        } else {
          toast({
            title: "Error",
            description: result.message,
            variant: "destructive"
          })
        }
        setIsSubmitting(false)
      }

      reader.onerror = error => {
        toast({
          title: "Error",
          description: `Error al leer el archivo: ${error}`,
          variant: "destructive"
        })
        setIsSubmitting(false)
      }
    } catch (e) {
      toast({
        title: "Error",
        description: `Fallo inesperado: ${e instanceof Error ? e.message : String(e)}`,
        variant: "destructive"
      })
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="file"
          render={({ field: { value, onChange, ...fieldProps } }) => (
            <FormItem>
              <FormLabel>Archivo CSV de Usuarios</FormLabel>
              <FormControl>
                <Input
                  {...fieldProps}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={event => {
                    onChange(event.target.files)
                  }}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormDescription>
                Sube un archivo CSV con la lista de usuarios. Se espera un
                formato con columnas como <code>email</code>,{" "}
                <code>firstName</code>, <code>lastName</code> y opcionalmente{" "}
                <code>groupKeys</code> (separados por <code>;</code>).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <UploadCloud className="mr-2 size-4" />
          )}{" "}
          Importar Usuarios
        </Button>
      </form>
    </Form>
  )
}

/**
 * @function UserManagementTable
 * @description Componente principal para la gestión de usuarios.
 */
const UserManagementTable: React.FC<UserManagementTableProps> = ({
  initialProfiles,
  initialGroups,
  canManageUsers = true
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const [profiles, setProfiles] = useState<SelectProfile[]>(initialProfiles)
  const [isBulkImportDialogOpen, setIsBulkImportDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setProfiles(initialProfiles)
  }, [initialProfiles])

  const getUserGroups = (userId: string) => {
    // v1: muestra todos los nombres de grupo (placeholder).
    // Se mantiene por compatibilidad; si se añade mapping user->groups, reemplazar aquí.
    return initialGroups.map(group => group.name).join(", ")
  }

  const handleDeleteUser = async (userId: string) => {
    setIsSubmitting(true)
    const result = await deactivateUserAction({ userId })
    if (result.isSuccess) {
      toast({ title: "Éxito", description: "Usuario desactivado." })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
    setIsSubmitting(false)
  }

  return (
    <div>
      <div className="mb-4 flex justify-end gap-2">
        <Dialog
          open={isBulkImportDialogOpen}
          onOpenChange={setIsBulkImportDialogOpen}
        >
          <DialogTrigger asChild>
            <Button variant="outline" disabled={!canManageUsers}>
              <UploadCloud className="mr-2 size-4" /> Importar Usuarios
              Masivamente
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Importar Usuarios Masivamente</DialogTitle>
              <DialogDescription>
                Sube un archivo CSV para crear o actualizar múltiples cuentas de
                usuario.
              </DialogDescription>
            </DialogHeader>
            <BulkImportUsersForm
              onSuccess={() => router.refresh()}
              onClose={() => setIsBulkImportDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          No hay usuarios configurados. Puedes importar usuarios masivamente.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID de Usuario (Clerk)</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Membresía</TableHead>
              <TableHead>Grupos</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map(user => (
              <TableRow key={user.userId}>
                <TableCell className="font-medium">{user.userId}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.membership}</TableCell>
                <TableCell>
                  <Users className="mr-1 inline-block size-3" />{" "}
                  {getUserGroups(user.userId)}
                </TableCell>
                <TableCell>
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {new Date(user.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="size-8 p-0"
                        disabled={!canManageUsers}
                      >
                        <span className="sr-only">Abrir menú</span>
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <Dialog>
                        <DialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={e => e.preventDefault()}
                            disabled={!canManageUsers}
                          >
                            <Edit className="mr-2 size-4" /> Editar
                          </DropdownMenuItem>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                          <DialogHeader>
                            <DialogTitle>Editar Usuario</DialogTitle>
                            <DialogDescription>
                              Modifica los detalles del perfil de usuario.
                            </DialogDescription>
                          </DialogHeader>
                          <UserEditForm
                            user={user}
                            onSuccess={() => router.refresh()}
                          />
                        </DialogContent>
                      </Dialog>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={e => e.preventDefault()}
                            className="text-red-600"
                            disabled={!canManageUsers || isSubmitting}
                          >
                            <UserRoundX className="mr-2 size-4" /> Desactivar
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ¿Estás absolutamente seguro?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción desactivará al usuario, eliminándolo
                              de todos los grupos y estableciendo su membresía a
                              'free'. No se puede deshacer fácilmente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteUser(user.userId)}
                              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
                              disabled={!canManageUsers || isSubmitting}
                            >
                              {isSubmitting ? (
                                <Loader2 className="mr-2 size-4 animate-spin" />
                              ) : (
                                <UserRoundX className="mr-2 size-4" />
                              )}
                              Desactivar
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
    </div>
  )
}

export default UserManagementTable
