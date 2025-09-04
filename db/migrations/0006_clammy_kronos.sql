ALTER TABLE "kpis" DROP CONSTRAINT "scorecard_element_id_unique";--> statement-breakpoint
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_scorecard_element_id_unique" UNIQUE("scorecard_element_id");