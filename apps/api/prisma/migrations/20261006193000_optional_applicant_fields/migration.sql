ALTER TABLE "users"
  ADD COLUMN "preferred_name" TEXT,
  ADD COLUMN "name_pronunciation" TEXT,
  ADD COLUMN "pronouns" TEXT,
  ADD COLUMN "current_company" TEXT,
  ADD COLUMN "portfolio" TEXT,
  ADD COLUMN "additional_links" JSONB;
