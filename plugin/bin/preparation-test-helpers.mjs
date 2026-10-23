import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { extractQuestions } from "./question-dom.mjs";

const modulePath = "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs";
export const skip =
  !existsSync(modulePath) || !existsSync("/usr/bin/chromium")
    ? "Run browser tests in the installed guest."
    : false;
export async function browserFor(t) {
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  return browser;
}
export async function manifestFor(page, values, url = "http://127.0.0.1:12345/form") {
  const jobId = randomUUID();
  const inventory = await page.evaluate(extractQuestions);
  return {
    job: { id: jobId, url },
    collectionVersion: 1,
    coverage: inventory.coverage,
    mode: "preview",
    submissionAllowed: false,
    questions: inventory.definitions.map((definition) => ({
      id: randomUUID(),
      jobId,
      current: true,
      definition,
      answer:
        values[definition.fields[0].key] === undefined
          ? null
          : {
              confirmedAt: new Date().toISOString(),
              values: [
                { fieldKey: definition.fields[0].key, value: values[definition.fields[0].key] },
              ],
            },
    })),
    documentFields: [],
  };
}
