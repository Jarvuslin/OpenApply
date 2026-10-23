-- The old local Pilot loop is retired and nothing in the product can start it again.
UPDATE "pilot_states" SET "running" = false WHERE "running";
