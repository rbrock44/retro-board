-- Boards are either the team's Current board or archived; "closed" is gone.
UPDATE "boards" SET "status" = 'archived' WHERE "status" = 'closed';
