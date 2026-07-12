ALTER TABLE "cities" ADD COLUMN "population" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "next_arrival_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "city_buildings" ADD COLUMN "workers" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "city_resources" DROP COLUMN "rate_per_hour";--> statement-breakpoint
-- Backfill cities created before the population system (values mirror
-- POPULATION.startingPopulation and STARTING_WORKER_ALLOCATION in @siege/shared).
UPDATE "cities" SET "population" = 12, "next_arrival_at" = now() + interval '15 minutes' WHERE "population" = 0;--> statement-breakpoint
UPDATE "city_buildings" SET "workers" = 4 WHERE "building_id" IN ('sawmill', 'farm');--> statement-breakpoint
-- Move every city's resource reference time to "now": rates changed meaning
-- (worker-based, net of food upkeep), so old linear extrapolation must not
-- span the migration moment.
UPDATE "city_resources" SET "ref_time" = now();