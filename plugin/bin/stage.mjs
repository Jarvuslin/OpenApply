import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { currentRuntime, guestCommand, run } from "./runtime.mjs";

try {
  if (process.argv.length !== 3) throw new Error("Usage: openapply-stage <local PDF or DOCX path>");
  const source = path.resolve(process.argv[2]);
  const extension = path.extname(source).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(extension))
    throw new Error("Only PDF, DOCX and TXT application files can be staged.");
  const file = await open(source, "r");
  let bytes;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > 20 * 1024 * 1024)
      throw new Error("Expected a nonempty application file under 20 MiB.");
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  const target = `/home/pilot/openapply/${randomUUID()}${extension}`;
  await run(
    guestCommand(currentRuntime(), [
      "sh",
      "-c",
      'set -eu; umask 077; mkdir -p /home/pilot/openapply; cat > "$1"; chown -R pilot:pilot /home/pilot/openapply',
      "stage",
      target,
    ]),
    { input: bytes, capture: true },
  );
  console.log(target);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
