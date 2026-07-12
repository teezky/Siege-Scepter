CREATE TABLE "city_units" (
	"city_id" uuid NOT NULL,
	"unit_id" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "city_units_city_id_unit_id_pk" PRIMARY KEY("city_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "player_pve_completions" (
	"player_id" uuid NOT NULL,
	"encounter_id" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_pve_completions_player_id_encounter_id_pk" PRIMARY KEY("player_id","encounter_id")
);
--> statement-breakpoint
CREATE TABLE "pve_battle_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"encounter_id" text NOT NULL,
	"victory" boolean NOT NULL,
	"attacker_power" integer NOT NULL,
	"defender_power" integer NOT NULL,
	"units_sent" jsonb NOT NULL,
	"units_lost" jsonb NOT NULL,
	"reward" jsonb NOT NULL,
	"fought_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "city_units" ADD CONSTRAINT "city_units_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_pve_completions" ADD CONSTRAINT "player_pve_completions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pve_battle_reports" ADD CONSTRAINT "pve_battle_reports_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pve_battle_reports" ADD CONSTRAINT "pve_battle_reports_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pve_reports_player_fought_idx" ON "pve_battle_reports" USING btree ("player_id","fought_at");