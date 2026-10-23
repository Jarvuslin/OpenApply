import { stageFile } from "./stage-file.mjs";

try {
  if (process.argv.length !== 3) throw new Error("Usage: openapply-stage <local PDF or DOCX path>");
  console.log(await stageFile(process.argv[2]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
