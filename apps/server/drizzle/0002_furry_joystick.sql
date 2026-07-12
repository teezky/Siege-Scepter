CREATE TABLE "player_research" (
	"player_id" uuid NOT NULL,
	"tech_id" text NOT NULL,
	"researched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_research_player_id_tech_id_pk" PRIMARY KEY("player_id","tech_id")
);
--> statement-breakpoint
ALTER TABLE "player_research" ADD CONSTRAINT "player_research_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: cities created before the knowledge resource need its row
-- (settles UPDATE per resource id and would otherwise silently skip it).
INSERT INTO "city_resources" ("city_id", "resource", "amount_at_ref", "ref_time")
SELECT "id", 'knowledge', 0, now() FROM "cities"
ON CONFLICT DO NOTHING;