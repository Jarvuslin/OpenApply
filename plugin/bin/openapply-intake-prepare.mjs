import { intakePreparation } from "./intake-preparation.mjs";

try {
  const action = process.argv[2];
  if (process.argv.length !== 3) throw new Error("One fixed preparation action is required.");
  let input;
  if (action === "record-fit") {
    let text = "";
    for await (const chunk of process.stdin) {
      text += chunk.toString();
      if (text.length > 200000) throw new Error("Fit input exceeded its bound.");
    }
    input = JSON.parse(text);
  }
  process.stdout.write(JSON.stringify(await intakePreparation(action, input)) + "\n");
} catch {
  console.error(
    "Exact-scope intake preparation refused or stopped. No automatic retry or application was started.",
  );
  process.exitCode = 1;
}
