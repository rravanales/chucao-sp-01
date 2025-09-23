// app/(main)/data-imports/_components/import-connection-form.tsx
"use client"

import React from "react"

type Props = {
  onSuccess?: () => void
}

export default function ImportConnectionForm({ onSuccess }: Props) {
  // TODO: reemplazar por el formulario real
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Aquí irá el formulario de conexión de importación.
      </p>
      <button
        type="button"
        className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm"
        onClick={() => onSuccess?.()}
      >
        Guardar (stub) y cerrar
      </button>
    </div>
  )
}
