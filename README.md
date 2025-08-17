*   **`README.md`**:

    *   **Propósito**: Este `README.md` sirve como la guía principal para comprender, instalar y ejecutar el proyecto de implementación de DeltaOne. Está diseñado para ingenieros de software, desarrolladores y cualquier persona que necesite interactuar con la base de código.

        *   **Título del Proyecto**: **Implementación Inicial y Configuración de Scorecards y KPIs en DeltaOne para Gestión Estratégica**.

        *   **Descripción**: Este proyecto se centra en establecer una **plataforma integral y estandarizada para la configuración y gestión centralizada de Scorecards y KPIs** (Indicadores Clave de Rendimiento). Busca abordar la actual dispersión de información, las actualizaciones manuales propensas a errores y la visibilidad limitada del rendimiento en tiempo real, lo que ha llevado a una **toma de decisiones reactiva** y a la falta de alineación estratégica.

            Las **funcionalidades clave** incluidas en esta fase inicial son:

            *   **Configuración y gestión de Scorecards y KPIs**:
                *   Implementación de la **estructura del Scorecard** para organizar métricas de rendimiento y estrategia.
                *   Definición y configuración de **KPIs**, incluyendo tipos de puntuación como **Goal/Red Flag, Sí/No y Texto**.
                *   Configuración de **actualizaciones manuales de valores de KPI** y asignación de "Updaters".
                *   Capacidad para **calcular valores de KPI automáticamente** usando ecuaciones basadas en otros KPIs.
                *   **Asignación de propietarios** a los KPIs y gestión de la **ponderación** de los elementos del Scorecard.
                *   Habilitación de la **auditoría de cálculos de KPI y puntuaciones** para asegurar la confianza en los datos.
            *   **Implementación de importaciones de datos solo para KPIs**:
                *   Configuración de **importaciones de valores de KPI desde hojas de cálculo (Excel)** mediante "Simple Value Imports".
                *   Configuración de **importaciones avanzadas** desde hojas de cálculo y **bases de datos relacionales** como Microsoft SQL Server, Oracle, MySQL, PostgreSQL, Hive, usando "Standard Value Imports".
                *   Configuración de **conexiones de importación** y capacidad de **transformar datos** durante el proceso de importación (ej. limpieza, filtrado).
                *   **Programación de importaciones recurrentes** para automatización.
            *   **Configuración de Alertas para eventos específicos de KPI y notas**:
                *   Implementación de **alertas automáticas para KPIs que se vuelven "Rojos"** y **recordatorios de actualización de KPI**.
                *   Habilitación de **alertas cuando se responda a una nota** y capacidad de **requerir una nota** al actualizar KPIs a bajo rendimiento.
                *   Creación de **alertas personalizadas** para cambios en la puntuación o el valor del KPI.
            *   **Administración de usuarios, grupos y permisos con capacidad de personalizar la terminología y metodología**:
                *   Configuración de **usuarios individuales** e **importación masiva de usuarios**.
                *   Creación y gestión de **grupos de usuarios** (Power Users, Update Users, Interactive Users, View Only) para definir permisos.
                *   Asignación de **permisos basados en la organización** y **personalización de la terminología** de la aplicación (ej. cambiar "Measures" a "KPIs").
                *   Activación/Desactivación de "Strategy Maps".
            *   **Organizaciones**:
                *   Configuración de la **jerarquía de organizaciones** dentro de la herramienta.
                *   Implementación de **KPIs de rollup** que agregan automáticamente valores de KPIs de organizaciones hijas a las padre.
                *   Configuración de **organizaciones basadas en plantillas a partir de campos de datasets** e integración de **permisos organizacionales a través de grupos de árboles de rollup**.

        *   **Instalación**:
            *   Asegúrate de tener **Node.js** instalado en tu sistema.
            *   **Clona este repositorio**.
            *   Instala las dependencias del proyecto ejecutando `npm install` o `yarn install` en la raíz del proyecto.
            *   Configura las **variables de entorno** en un archivo `.env.local` en la raíz del proyecto. **Todas las variables de entorno deben ir en este archivo**. Las variables destinadas al frontend deben prefijarse con `NEXT_PUBLIC_`.
            *   Asegúrate de que tu instancia de **PostgreSQL** esté operativa y configurada según los detalles de conexión en tus variables de entorno. El backend interactúa con la base de datos utilizando **Drizzle ORM**.
            *   Configura el servicio de autenticación **Clerk** y el backend de **Supabase** según la documentación oficial de estos servicios.

        *   **Scripts Disponibles**:
            *   `npm run dev` o `yarn dev`: Inicia la aplicación en modo desarrollo.
            *   `npm run build` o `yarn build`: Compila la aplicación para producción.
            *   `npm start` o `yarn start`: Inicia la aplicación compilada en modo producción.

        *   **Estructura de Directorios**:
            *   `actions/`: Contiene las **acciones del servidor** (Server Actions).
                *   `actions/db/`: Acciones relacionadas con la base de datos.
            *   `app/`: Maneja el **enrutador de Next.js** para las rutas de la aplicación, páginas y componentes.
                *   `_components/`: Componentes específicos de una ruta.
                *   `layout.tsx`: Layouts para las rutas.
                *   `page.tsx`: Páginas para las rutas.
            *   `components/`: **Componentes compartidos** reutilizables en toda la aplicación.
            *   `db/`: Contiene la lógica relacionada con la base de datos.
                *   `schema/`: **Esquemas de la base de datos**.
            *   `hooks/`: **Hooks personalizados** de React.
            *   `lib/`: Código de librería general.
            *   `prompts/`: Archivos de prompts (si aplica).
            *   `public/`: Archivos estáticos.
            *   `types/`: **Definiciones de tipos**.
            *   `ui/`: **Componentes de interfaz de usuario** reutilizables (Shadcn/UI).

        *   **Pila Tecnológica**:
            *   **Frontend**: **Next.js, Tailwind CSS, Shadcn/UI, Framer Motion**.
            *   **Backend**: **PostgreSQL, Supabase, Drizzle ORM, Server Actions**.
            *   **Autenticación**: **Clerk**.
            *   **Despliegue**: **Vercel**.

        *   **Despliegue**: La aplicación se despliega en **Vercel**.
