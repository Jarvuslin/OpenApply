import { runRegression } from "../questions-regression/runner.mjs";

await runRegression({
  name: "answer-bank-regression",
  envPrefix: "OPENAPPLY_BANK_TEST",
  verifier: "scripts/verify-answer-bank.ts",
  subject: "answer-bank",
  databaseLabel: "answer bank",
  uiStage: "rendered saved-answer verification",
  observe: async (ui, config) => (await import("./observe-ui.mjs")).observeAnswerBankUi(ui, config),
});
