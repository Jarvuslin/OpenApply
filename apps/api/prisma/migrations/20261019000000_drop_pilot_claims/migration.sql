-- The model-driven Pilot cycle that granted claims is retired; nothing reads or writes them.

-- DropForeignKey
ALTER TABLE "pilot_claims" DROP CONSTRAINT "pilot_claims_user_id_fkey";

-- DropTable
DROP TABLE "pilot_claims";

-- DropEnum
DROP TYPE "pilot_claim_outcome";
