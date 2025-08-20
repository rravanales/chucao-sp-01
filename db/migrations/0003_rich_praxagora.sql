CREATE TYPE "public"."import_connection_type" AS ENUM('Excel', 'Microsoft SQL Server', 'Oracle', 'MySQL', 'PostgreSQL', 'Hive');--> statement-breakpoint
CREATE TABLE "import_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"connection_type" "import_connection_type" NOT NULL,
	"connection_details" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_connections_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "saved_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"kpi_mappings" jsonb NOT NULL,
	"transformations" jsonb,
	"schedule_config" jsonb,
	"last_run_at" timestamp,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_imports_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "import_connections" ADD CONSTRAINT "import_connections_created_by_user_id_profiles_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_imports" ADD CONSTRAINT "saved_imports_connection_id_import_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."import_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_imports" ADD CONSTRAINT "saved_imports_created_by_user_id_profiles_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;