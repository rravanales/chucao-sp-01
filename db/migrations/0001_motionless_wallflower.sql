CREATE TYPE "public"."scorecard_element_type" AS ENUM('Perspective', 'Objective', 'Initiative', 'KPI');--> statement-breakpoint
CREATE TYPE "public"."kpi_aggregation_type" AS ENUM('Sum', 'Average', 'Last Value');--> statement-breakpoint
CREATE TYPE "public"."kpi_calendar_frequency" AS ENUM('Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually');--> statement-breakpoint
CREATE TYPE "public"."kpi_data_type" AS ENUM('Number', 'Percentage', 'Currency', 'Text');--> statement-breakpoint
CREATE TYPE "public"."kpi_scoring_type" AS ENUM('Goal/Red Flag', 'Yes/No', 'Text');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"template_from_dataset_field" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorecard_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"organization_id" uuid NOT NULL,
	"element_type" "scorecard_element_type" NOT NULL,
	"owner_user_id" text,
	"weight" numeric DEFAULT '1.0' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scorecard_element_id" uuid NOT NULL,
	"scoring_type" "kpi_scoring_type" NOT NULL,
	"calendar_frequency" "kpi_calendar_frequency" NOT NULL,
	"data_type" "kpi_data_type" NOT NULL,
	"aggregation_type" "kpi_aggregation_type" NOT NULL,
	"decimal_precision" integer DEFAULT 0 NOT NULL,
	"is_manual_update" boolean DEFAULT false NOT NULL,
	"calculation_equation" text,
	"rollup_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scorecard_element_id_unique" UNIQUE("scorecard_element_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scorecard_elements" ADD CONSTRAINT "scorecard_elements_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."scorecard_elements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scorecard_elements" ADD CONSTRAINT "scorecard_elements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scorecard_elements" ADD CONSTRAINT "scorecard_elements_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_scorecard_element_id_scorecard_elements_id_fk" FOREIGN KEY ("scorecard_element_id") REFERENCES "public"."scorecard_elements"("id") ON DELETE cascade ON UPDATE no action;