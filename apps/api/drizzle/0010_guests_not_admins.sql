-- No-sign-in mode used to make every visitor a site admin and an admin of every team. Now the site admin is whoever
-- uses the setup code (./launch.sh admin-code), and a team's admin is whoever made it. Sites with accounts have no
-- guests, so nothing changes there.
UPDATE "users" SET "role" = 'user' WHERE "guest" = true;--> statement-breakpoint
UPDATE "team_members" SET "role" = 'member'
WHERE "role" = 'admin'
  AND "user_id" IN (SELECT "id" FROM "users" WHERE "guest" = true)
  AND "user_id" IS DISTINCT FROM (SELECT "created_by" FROM "teams" WHERE "teams"."id" = "team_members"."team_id");
