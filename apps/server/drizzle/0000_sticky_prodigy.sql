CREATE TYPE "public"."construction_status" AS ENUM('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "city_buildings" (
	"city_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"level" integer NOT NULL,
	CONSTRAINT "city_buildings_city_id_building_id_pk" PRIMARY KEY("city_id","building_id")
);
--> statement-breakpoint
CREATE TABLE "city_resources" (
	"city_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"amount_at_ref" bigint NOT NULL,
	"rate_per_hour" integer NOT NULL,
	"ref_time" timestamp with time zone NOT NULL,
	CONSTRAINT "city_resources_city_id_resource_pk" PRIMARY KEY("city_id","resource")
);
--> statement-breakpoint
CREATE TABLE "construction_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"building_id" text NOT NULL,
	"target_level" integer NOT NULL,
	"status" "construction_status" NOT NULL,
	"queue_position" integer NOT NULL,
	"started_at" timestamp with time zone,
	"completes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_buildings" ADD CONSTRAINT "city_buildings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "city_resources" ADD CONSTRAINT "city_resources_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "construction_orders" ADD CONSTRAINT "construction_orders_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cities_player_idx" ON "cities" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "construction_city_status_idx" ON "construction_orders" USING btree ("city_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_unique" ON "players" USING btree ("username");--> statement-breakpoint
CREATE INDEX "sessions_player_idx" ON "sessions" USING btree ("player_id");