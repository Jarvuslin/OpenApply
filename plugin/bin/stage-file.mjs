import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { currentRuntime, guestCommand, run } from "./runtime.mjs";
import { workerControl } from "./worker-control.mjs";

const workerKeys = [
  "OPENAPPLY_WORK_ITEM_ID",
  "OPENAPPLY_WORK_LEASE_TOKEN",
  "OPENAPPLY_BROWSER_SESSION_ID",
  "OPENAPPLY_WORKER_CAPABILITY",
  "OPENAPPLY_BROWSER_CDP_PORT",
  "OPENAPPLY_BROWSER_OUTPUT_DIR",
];

export async function stageFile(
  sourcePath,
  { environment = process.env, runtime = currentRuntime, execute = run, fetcher = fetch } = {},
) {
  const source = path.resolve(sourcePath);
  const extension = path.extname(source).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(extension))
    throw new Error("Only PDF, DOCX and TXT application files can be staged.");
  const owned = workerKeys.some((key) => environment[key] !== undefined && environment[key] !== "");
  const base = owned
    ? (await workerControl("attach", environment, fetcher)).outputDir
    : "/home/pilot/openapply";
  const directory = owned ? `${base}/documents` : base;
  const file = await open(source, "r");
  let bytes;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > 20 * 1024 * 1024)
      throw new Error("Expected a nonempty application file under 20 MiB.");
    bytes = await file.readFile();
    if (bytes.length !== info.size)
      throw new Error("The application file changed while it was being staged.");
  } finally {
    await file.close();
  }
  const target = `${directory}/${randomUUID()}${extension}`;
  await execute(
    guestCommand(runtime(), [
      "sh",
      "-c",
      'set -eu; umask 077; if [ "$4" = owned ]; then test -d "$1"; else mkdir -p -- "$1"; fi; test "$(readlink -f -- "$1")" = "$1"; mkdir -p -- "$2"; test "$(readlink -f -- "$2")" = "$2"; set -C; cat > "$3"; chown pilot:pilot -- "$2" "$3"',
      "stage",
      base,
      directory,
      target,
      owned ? "owned" : "ordinary",
    ]),
    { input: bytes, capture: true },
  );
  return target;
}
