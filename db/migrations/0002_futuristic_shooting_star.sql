CREATE TYPE "public"."kpi_color" AS ENUM('Red', 'Yellow', 'Green');--> statement-breakpoint
CREATE TABLE "kpi_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kpi_id" uuid NOT NULL,
	"period_date" date NOT NULL,
	"actual_value" text,
	"target_value" text,
	"threshold_red" text,
	"threshold_yellow" text,
	"score" numeric,
	"color" "kpi_color",
	"updated_by_user_id" text,
	"is_manual_entry" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_updaters" (
	"kpi_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"can_modify_thresholds" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_values" ADD CONSTRAINT "kpi_values_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_values" ADD CONSTRAINT "kpi_values_updated_by_user_id_profiles_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_updaters" ADD CONSTRAINT "kpi_updaters_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_updaters" ADD CONSTRAINT "kpi_updaters_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_values_kpi_id_period_date_idx" ON "kpi_values" USING btree ("kpi_id","period_date");