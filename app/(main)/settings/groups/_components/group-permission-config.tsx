/**
 * @file app/(main)/settings/groups/_components/group-permission-config.tsx
 * @brief Componente de cliente para la gestión de grupos y permisos de usuario.
 * @description Este componente proporciona una interfaz para listar, crear, editar y eliminar
 * grupos de usuarios (UC-402). También sentará las bases para la gestión de miembros
 * y la asignación de permisos, incluyendo permisos organizacionales (UC-503).
 * Utiliza Server Actions para todas las operaciones CRUD y Shadcn UI para la interfaz.
 */
"use client"

import React, { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  SelectGroup,
  SelectOrganization,
  SelectProfile,
  userGroupTypeEnum
} from "@/db/schema"
import {
  createGroupAction,
  updateGroupAction,
  deleteGroupAction,
  assignGroupMembersAction,
  assignGroupPermissionsAction
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
  Trash2,
  Users,
  Key,
  PlusCircle,
  Loader2,
  Save
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
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
  FormMessage
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select as UiSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"

/**
 * @interface GroupPermissionConfigProps
 * @description Propiedades para el componente GroupPermissionConfig.
 * @property {SelectGroup[]} initialGroups - Lista inicial de grupos.
 * @property {SelectOrganization[]} allOrganizations - Todas las organizaciones disponibles para asignar permisos.
 * @property {SelectProfile[]} allProfiles - Todos los perfiles de usuario disponibles para asignar como miembros.
 */
interface GroupPermissionConfigProps {
  initialGroups: SelectGroup[]
  allOrganizations: SelectOrganization[]
  allProfiles: SelectProfile[]
}

/**
 * @interface GroupFormProps
 * @description Propiedades para el formulario de creación/edición de grupo.
 * @property {SelectGroup | null} [group] - Grupo existente para edición, o null para creación.
 * @property {() => void} onSuccess - Callback a ejecutar después de una operación exitosa.
 * @property {() => void} onClose - Callback para cerrar el diálogo.
 */
interface GroupFormProps {
  group?: SelectGroup | null
  onSuccess: () => void
  onClose: () => void
}

/**
 * @schema groupFormSchema
 * @description Esquema de validación para el formulario de grupo.
 */
const groupFormSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del grupo es requerido.")
    .max(255, "El nombre no puede exceder los 255 caracteres."),
  groupType: z.enum(userGroupTypeEnum.enumValues, {
    errorMap: () => ({ message: "Tipo de grupo de usuario inválido." })
  })
})

/**
 * @function GroupForm
 * @description Formulario para crear o editar un grupo de usuarios.
 * @param {GroupFormProps} props - Propiedades del formulario.
 * @returns {JSX.Element}
 */
const GroupForm: React.FC<GroupFormProps> = ({ group, onSuccess, onClose }) => {
  const { toast } = useToast()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEditMode = !!group

  const form = useForm<z.infer<typeof groupFormSchema>>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: {
      name: group?.name || "",
      groupType: group?.groupType || "View Only" // Default to 'View Only'
    }
  })

  const onSubmit = async (values: z.infer<typeof groupFormSchema>) => {
    setIsSubmitting(true)
    let result: ActionState<SelectGroup>
    try {
      if (isEditMode) {
        result = await updateGroupAction({ id: group.id, ...values })
      } else {
        result = await createGroupAction(values)
      }

      if (result.isSuccess) {
        toast({
          title: "Éxito",
          description: `Grupo ${isEditMode ? "actualizado" : "creado"} correctamente.`
        })
        onSuccess()
        onClose()
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre del Grupo</FormLabel>
              <FormControl>
                <Input placeholder="Ej: Administradores" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="groupType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de Grupo</FormLabel>
              <UiSelect onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo de grupo" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {userGroupTypeEnum.enumValues.map(type => (
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
          {isEditMode ? "Guardar Cambios" : "Crear Grupo"}
        </Button>
      </form>
    </Form>
  )
}

/**
 * @function GroupPermissionConfig
 * @description Componente principal para la gestión de grupos y sus permisos.
 * @param {GroupPermissionConfigProps} props - Propiedades iniciales.
 * @returns {JSX.Element}
 */
const GroupPermissionConfig: React.FC<GroupPermissionConfigProps> = ({
  initialGroups,
  allOrganizations,
  allProfiles
}) => {
  const { toast } = useToast()
  const router = useRouter()
  const [groups, setGroups] = useState<SelectGroup[]>(initialGroups)
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
  const [isEditGroupDialogOpen, setIsEditGroupDialogOpen] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<SelectGroup | null>(null)

  useEffect(() => {
    setGroups(initialGroups)
  }, [initialGroups])

  const handleDeleteGroup = async (groupId: string) => {
    const result = await deleteGroupAction({ id: groupId })
    if (result.isSuccess) {
      toast({ title: "Éxito", description: "Grupo eliminado correctamente." })
      router.refresh()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive"
      })
    }
  }

  const handleOpenEditGroupDialog = (group: SelectGroup) => {
    setSelectedGroup(group)
    setIsEditGroupDialogOpen(true)
  }

  // Esto es un placeholder para la complejidad de la gestión de miembros y permisos.
  // En una implementación completa, cada grupo tendría una sub-vista para manejar esto.
  const renderGroupDetails = (group: SelectGroup) => {
    // Obtener miembros del grupo
    const members = allProfiles.filter(
      profile =>
        // Esto requeriría una acción para obtener miembros por grupo
        // Por simplicidad, asumimos que 'allProfiles' tiene la info o la obtenemos dinámicamente.
        // Aquí simulamos que un miembro es "asignado" (requiere lógica real)
        false
    )
    return (
      <div className="text-muted-foreground space-y-2 text-sm">
        <p>
          <strong>Tipo:</strong>{" "}
          <Badge variant="secondary">{group.groupType}</Badge>
        </p>
        <p>
          <strong>Miembros:</strong> (Funcionalidad de asignación en progreso)
        </p>
        <p>
          <strong>Permisos:</strong> (Funcionalidad de gestión de permisos en
          progreso)
        </p>
        {/* Aquí se podría integrar un componente de gestión de miembros y otro de permisos */}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Dialog
          open={isCreateGroupDialogOpen}
          onOpenChange={setIsCreateGroupDialogOpen}
        >
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 size-4" /> Nuevo Grupo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Crear Nuevo Grupo</DialogTitle>
              <DialogDescription>
                Define el nombre y tipo del nuevo grupo de usuarios.
              </DialogDescription>
            </DialogHeader>
            <GroupForm
              onSuccess={() => router.refresh()}
              onClose={() => setIsCreateGroupDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          No hay grupos de usuarios configurados. Haz clic en "Nuevo Grupo" para
          empezar.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre del Grupo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(group => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{group.groupType}</Badge>
                </TableCell>
                <TableCell>
                  {new Date(group.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  {new Date(group.updatedAt).toLocaleDateString()}
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
                      <Dialog
                        open={
                          isEditGroupDialogOpen &&
                          selectedGroup?.id === group.id
                        }
                        onOpenChange={setIsEditGroupDialogOpen}
                      >
                        <DialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={e => {
                              e.preventDefault()
                              handleOpenEditGroupDialog(group)
                            }}
                          >
                            <Edit className="mr-2 size-4" /> Editar
                          </DropdownMenuItem>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
                          <DialogHeader>
                            <DialogTitle>
                              Editar Grupo: {selectedGroup?.name}
                            </DialogTitle>
                            <DialogDescription>
                              Modifica los detalles del grupo y gestiona
                              miembros/permisos.
                            </DialogDescription>
                          </DialogHeader>
                          {selectedGroup && (
                            <GroupForm
                              group={selectedGroup}
                              onSuccess={() => router.refresh()}
                              onClose={() => setIsEditGroupDialogOpen(false)}
                            />
                          )}
                          {/* Aquí se integrarían sub-componentes para gestión de miembros y permisos */}
                          {/* <div className="mt-4 border-t pt-4">
                            <h3 className="mb-2 text-lg font-semibold flex items-center gap-1">
                                <Users className="size-4" /> Miembros del Grupo
                            </h3>
                            <p className="text-muted-foreground text-sm">Próximamente: gestiona quién pertenece a este grupo.</p>
                          </div>
                          <div className="mt-4 border-t pt-4">
                            <h3 className="mb-2 text-lg font-semibold flex items-center gap-1">
                                <Key className="size-4" /> Permisos del Grupo
                            </h3>
                            <p className="text-muted-foreground text-sm">Próximamente: asigna permisos específicos por organización.</p>
                          </div> */}
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
                              permanentemente el grupo y todas las asociaciones
                              de miembros y permisos con este grupo.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteGroup(group.id)}
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
    </div>
  )
}

export default GroupPermissionConfig
