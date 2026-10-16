import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { historicalScoringCorpus } from "./scoring-regression-corpus";

const [source, output] = process.argv.slice(2);
assert(source && output, "Pass the preserved Phase 1 G directory and a new output file.");
const reportPath = path.resolve(source, "report.json");
const textPath = path.resolve(source, "synthetic-original.txt");
assert((await stat(reportPath)).size < 5_000_000);
assert((await stat(textPath)).size < 200_000);
const report = await readFile(reportPath);
const text = await readFile(textPath);
const corpus = historicalScoringCorpus(report, text.toString("utf8"));
assert.deepEqual(await readFile(reportPath), report, "Preserved source report changed.");
assert.deepEqual(await readFile(textPath), text, "Preserved synthetic original changed.");
await writeFile(path.resolve(output), `${JSON.stringify(corpus, null, 2)}\n`, { flag: "wx" });
console.log(
  JSON.stringify({ cases: corpus.cases.length, provenance: corpus.provenance, modelCalls: 0 }),
);
