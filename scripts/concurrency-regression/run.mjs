import { databaseFingerprint } from "../apply-e2e/ui-database.mjs";
import { runRegression } from "../questions-regression/runner.mjs";
import { assertPassedDatabaseEvidence, assertSyntheticSnapshot } from "./evidence.mjs";
import { assertConcurrencyCloneUnchanged, otherControlsFingerprint } from "./integrity.mjs";

let protectedClone;
let protectedControls;

await runRegression({
  name: "concurrency-regression",
  envPrefix: "OPENAPPLY_CONCURRENCY_TEST",
  verifier: "scripts/verify-concurrency.ts",
  subject: "concurrency",
  uiStage: "rendered concurrency policy verification",
  assertSyntheticSnapshot,
  assertPreviousEvidence: assertPassedDatabaseEvidence,
  databasePassed: (result) => result.passed === true,
  storage: true,
  rememberClone: async ({ inGuest, clone, source }) => {
    protectedClone = await databaseFingerprint(inGuest, clone);
    protectedControls = await otherControlsFingerprint(inGuest, clone, source.ui.userId);
  },
  assertCloneUnchanged: async ({ inGuest, source }) => {
    if (!protectedClone) return false;
    assertConcurrencyCloneUnchanged(
      protectedClone,
      await databaseFingerprint(inGuest, protectedClone.database),
      protectedControls,
      await otherControlsFingerprint(inGuest, protectedClone.database, source.ui.userId),
    );
    return true;
  },
  observe: async (ui, config) =>
    (await import("./observe-ui.mjs")).observeConcurrencyUi(ui, config),
});
