import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentRuntime, guestCommand, run } from "./runtime.mjs";

const GUEST_PNG = /^\/home\/pilot\/openapply\/[A-Za-z0-9_./-]+\.png$/;

/** Validates the browser's screenshot path inside the VM before anything is read. */
export function guestScreenshotPath(path) {
  if (typeof path !== "string" || !GUEST_PNG.test(path) || path.split("/").includes(".."))
    throw new Error(
      "Usage: openapply-screenshot <PNG path the browser saved under /home/pilot/openapply>",
    );
  return path;
}

async function main() {
  const path = guestScreenshotPath(process.argv[2]);
  const id = process.env.OPENAPPLY_WORK_ITEM_ID;
  if (!id) throw new Error("openapply-screenshot runs only inside a queue worker.");
  // The browser runs in the VM; base64 keeps the bytes intact through the console pipe.
  const encoded = await run(guestCommand(currentRuntime(), ["base64", "-w0", path], "pilot"), {
    capture: true,
    timeout: 30_000,
  });
  const dir = mkdtempSync(join(tmpdir(), "openapply-screenshot-"));
  try {
    const file = join(dir, "submission.png");
    writeFileSync(file, Buffer.from(encoded, "base64"));
    execFileSync(
      process.execPath,
      [
        join(import.meta.dirname, "api.mjs"),
        "POST",
        `/api/work-queue/${id}/screenshot`,
        "--file",
        `file=${file}`,
      ],
      { stdio: "inherit", windowsHide: true },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("screenshot.mjs")) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
