ALTER TABLE "city_buildings" ADD COLUMN "plot_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "construction_orders" ADD COLUMN "plot_index" integer;--> statement-breakpoint
-- Backfill BEFORE the unique index: assign every pre-plot-system building its
-- default plot (mirrors DEFAULT_PLOT_ASSIGNMENT in @siege/shared — one
-- distinct plot per building id, so this can never collide within a city).
UPDATE "city_buildings" SET "plot_index" = CASE "building_id"
  WHEN 'townHall' THEN 9
  WHEN 'sawmill' THEN 8
  WHEN 'farm' THEN 13
  WHEN 'warehouse' THEN 4
  WHEN 'house' THEN 14
  WHEN 'quarry' THEN 12
  WHEN 'ironMine' THEN 17
  WHEN 'academy' THEN 10
  WHEN 'barracks' THEN 18
  ELSE 0 END;--> statement-breakpoint
-- Pending brand-new-building orders reserve their default plot the same way.
UPDATE "construction_orders" SET "plot_index" = CASE "building_id"
  WHEN 'townHall' THEN 9
  WHEN 'sawmill' THEN 8
  WHEN 'farm' THEN 13
  WHEN 'warehouse' THEN 4
  WHEN 'house' THEN 14
  WHEN 'quarry' THEN 12
  WHEN 'ironMine' THEN 17
  WHEN 'academy' THEN 10
  WHEN 'barracks' THEN 18
  ELSE 0 END
WHERE "target_level" = 1 AND "status" IN ('QUEUED', 'IN_PROGRESS');--> statement-breakpoint
CREATE UNIQUE INDEX "city_buildings_plot_unique" ON "city_buildings" USING btree ("city_id","plot_index");