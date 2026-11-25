-- A team's fresh board is now called "Current" (was "Current retro").
UPDATE "boards" SET "title" = 'Current' WHERE "title" = 'Current retro' AND "status" = 'open';
