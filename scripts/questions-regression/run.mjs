import { runRegression } from "./runner.mjs";

await runRegression({
  name: "questions-regression",
  envPrefix: "OPENAPPLY_QUESTIONS_TEST",
  verifier: "scripts/verify-application-questions.ts",
  subject: "question",
  uiStage: "rendered Needs-you verification",
  observe: async (ui, config) => (await import("./observe-ui.mjs")).observeQuestionsUi(ui, config),
});
