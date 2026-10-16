import { writeFile } from "node:fs/promises";
import { bootstrapDiagnostic, environmentDiagnostic } from "./bootstrap-diagnostic.mjs";

async function failed(error) {
  const report = { passed: false, stage: "fixture bootstrap", error };
  try {
    await writeFile(process.env.OPENAPPLY_QUEUE_EXPERIENCE_REPORT, JSON.stringify(report), {
      flag: "wx",
    });
  } catch (failure) {
    if (failure?.code !== "EEXIST")
      process.stdout.write('{"passed":false,"stage":"bootstrap report unavailable"}');
  }
  process.exitCode = 1;
}
try {
  const { EnvSchema } = await import("../../apps/api/src/env.schema.ts");
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) await failed(environmentDiagnostic(parsed.error.issues));
  else await import("../../apps/api/scripts/queue-experience-ui-fixtures.ts");
} catch (error) {
  await failed(bootstrapDiagnostic(error));
}
