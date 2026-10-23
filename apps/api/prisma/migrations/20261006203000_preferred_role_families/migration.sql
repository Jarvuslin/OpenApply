UPDATE "users"
SET "job_preferences" = jsonb_set("job_preferences", '{roles}', '[]'::jsonb)
WHERE NOT ("job_preferences" ? 'roles');

ALTER TABLE "users"
ALTER COLUMN "job_preferences" SET DEFAULT '{"roles":[],"levels":[],"yearsExperience":null,"workModes":[],"employmentTypes":[]}'::jsonb;
