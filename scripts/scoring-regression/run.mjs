import { assertDatabaseUnchanged, databaseFingerprint } from "../apply-e2e/ui-database.mjs";
import { runRegression } from "../questions-regression/runner.mjs";

let protectedClone;

await runRegression({
  name: "scoring-regression",
  envPrefix: "OPENAPPLY_SCORING_TEST",
  verifier: "scripts/verify-scoring.ts",
  subject: "scoring",
  databaseStage: "scoring evaluation database regression",
  uiStage: "rendered scoring evaluation verification",
  emailDomain: "scoring.example.test",
  firstName: "Scoring",
  rememberClone: async ({ inGuest, clone }) => {
    protectedClone = await databaseFingerprint(inGuest, clone);
  },
  assertCloneUnchanged: async ({ inGuest }) => {
    if (!protectedClone) return false;
    assertDatabaseUnchanged(
      protectedClone,
      await databaseFingerprint(inGuest, protectedClone.database),
      { allowLogin: true },
    );
    return true;
  },
  observe: async (ui, config) => (await import("./observe-ui.mjs")).observeScoringUi(ui, config),
});
