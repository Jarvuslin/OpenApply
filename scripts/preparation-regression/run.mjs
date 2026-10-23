import { ports } from "../apply-e2e/environment-preflight.mjs";
import { runRegression } from "../questions-regression/runner.mjs";
import { startPreparationHost } from "./ui-host.mjs";

await runRegression({
  name: "preparation-regression",
  envPrefix: "OPENAPPLY_PREPARATION_TEST",
  verifier: "scripts/verify-preparation.ts",
  subject: "preparation",
  uiStage: "rendered form-preparation verification",
  storage: true,
  startHost: ({ root, evidenceDir, commandFor, source }) =>
    startPreparationHost({
      root,
      evidenceDir,
      commandFor,
      companionPort: ports.companion,
      webUrl: `http://127.0.0.1:${ports.web}`,
      fixtureUrl: source.ui.fixtureUrl,
    }),
  uiHostPorts: [ports.companion],
  observe: async (ui, config) =>
    (await import("./observe-ui.mjs")).observePreparationUi(ui, config),
});
