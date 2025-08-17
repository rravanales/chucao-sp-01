# CONTRIBUTING.md

## Propósito 
Este documento tiene como objetivo proporcionar directrices claras para los desarrolladores que deseen **contribuir al proyecto de implementación de DeltaOne**. Al seguir estos estándares, aseguramos una colaboración fluida, mantenemos la calidad del código y facilitamos el proceso de revisión.

### Estándares de Codificación
*   **Importaciones**: Usa `@` para importar cualquier elemento del proyecto, a menos que se especifique lo contrario.
*   **Nomenclatura**: Usa `kebab-case` para todos los archivos y carpetas, a menos que se especifique lo contrario.
*   **Componentes Shadcn**: **No actualices los componentes de Shadcn** a menos que se especifique lo contrario.
*   **Variables de Entorno**: Si actualizas variables de entorno, también actualiza el archivo `.env.example`. Todas las variables de entorno deben ir en `.env.local` y las que se acceden desde el frontend deben usar el prefijo `NEXT_PUBLIC_`.
*   **Tipos**:
    *   Las importaciones de tipos deben usar `@/types`.
    *   Nombra los archivos de tipos como `ejemplo-types.ts`.
    *   Todos los tipos deben ir en la carpeta `types/`.
    *   Asegúrate de exportar los tipos en `types/index.ts`.
    *   **Prefiere interfaces sobre alias de tipo**.
    *   Para tipos de base de datos, usa `@/db/schema`.
*   **Reglas de Backend**:
    *   **Nunca generes migraciones**; ignora la carpeta `db/migrations`.
    *   Los esquemas deben ir en `db/schema` y ser exportados en `db/schema/index.ts`.
    *   Siempre incluye las columnas `createdAt` y `updatedAt` en todas las tablas.
    *   Asegúrate de configurar `onDelete: "cascade"` cuando sea necesario para las claves foráneas.
    *   **Usa enums para columnas con un conjunto limitado de valores posibles**.
    *   Para el manejo de fechas, **siempre convierte los objetos `Date` de JavaScript a cadenas ISO (`.toISOString()`)** antes de las operaciones de base de datos.

### Cómo Crear Ramas de Git y Seguir una Convención de Nombres:
*   Se recomienda seguir un flujo de trabajo de Git basado en características (feature branches).
*   Nombra tus ramas de forma descriptiva, por ejemplo: `feature/UC-XXX-nombre-caracteristica`, `bugfix/issue-YYY-descripcion-bug`.

### Proceso de Creación de Pull Requests (PRs):
*   Abre una Pull Request a la rama `main` (o la rama de desarrollo designada).
*   Proporciona una descripción clara y concisa de los cambios, incluyendo una referencia al caso de uso (UC) o requisito (SRS) que aborda.
*   Asegúrate de que todas las pruebas pasen antes de enviar la PR para revisión.

### Cómo Ejecutar Pruebas y Escribir Nuevas
*   (Esta sección detallaría los comandos para ejecutar pruebas unitarias, de integración y end-to-end, y las directrices para escribir nuevas pruebas, lo cual no está explícitamente en las fuentes proporcionadas, pero es fundamental en un `CONTRIBUTING.md`).
