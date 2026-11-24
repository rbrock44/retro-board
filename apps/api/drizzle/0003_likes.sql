ALTER TABLE "votes" ALTER COLUMN "count" SET DEFAULT 1;
--> statement-breakpoint
UPDATE "votes" SET "count" = 1 WHERE "count" <> 1;
