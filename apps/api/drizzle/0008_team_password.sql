ALTER TABLE "teams" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "password_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "owner_key_hash" text;