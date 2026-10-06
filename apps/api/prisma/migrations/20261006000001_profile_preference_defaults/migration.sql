UPDATE "users" SET "job_preferences" = '{"levels":[],"yearsExperience":null,"workModes":[],"employmentTypes":[]}'::jsonb WHERE "job_preferences" = '{}'::jsonb;
ALTER TABLE "users" ALTER COLUMN "job_preferences" SET DEFAULT '{"levels":[],"yearsExperience":null,"workModes":[],"employmentTypes":[]}'::jsonb;
