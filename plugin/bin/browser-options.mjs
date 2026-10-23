import { posix } from "node:path";

const DEFAULT_OUTPUT_DIR = "/home/pilot/openapply";

export function browserCommands(environment) {
  if (
    (environment.OPENAPPLY_WORK_ITEM_ID || environment.OPENAPPLY_BROWSER_SESSION_ID) &&
    (!environment.OPENAPPLY_BROWSER_SESSION_ID ||
      !environment.OPENAPPLY_BROWSER_CDP_PORT ||
      !environment.OPENAPPLY_BROWSER_OUTPUT_DIR)
  )
    throw new Error(
      "Owned worker browsers require a verified session endpoint; shared-browser fallback is forbidden.",
    );
  const portValue = environment.OPENAPPLY_BROWSER_CDP_PORT ?? "9222";
  if (typeof portValue !== "string" || !/^\d+$/.test(portValue)) {
    throw new Error("OPENAPPLY_BROWSER_CDP_PORT must be an integer from 1024 to 65535.");
  }
  const port = Number(portValue);
  if (environment.OPENAPPLY_BROWSER_SESSION_ID && port === 9222)
    throw new Error("An owned worker cannot use the shared browser port.");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("OPENAPPLY_BROWSER_CDP_PORT must be an integer from 1024 to 65535.");
  }
  const outputDir = environment.OPENAPPLY_BROWSER_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;
  if (
    environment.OPENAPPLY_BROWSER_SESSION_ID &&
    outputDir !== `${DEFAULT_OUTPUT_DIR}/queue-workers/${environment.OPENAPPLY_BROWSER_SESSION_ID}`
  )
    throw new Error("The output directory does not belong to this browser session.");
  if (
    typeof outputDir !== "string" ||
    !/^\/[A-Za-z0-9_./-]+$/.test(outputDir) ||
    posix.resolve(outputDir) !== outputDir ||
    (outputDir !== DEFAULT_OUTPUT_DIR && !outputDir.startsWith(`${DEFAULT_OUTPUT_DIR}/`))
  ) {
    throw new Error(
      "OPENAPPLY_BROWSER_OUTPUT_DIR must be a normalized absolute path under /home/pilot/openapply with only letters, digits, dots, dashes, underscores, and slashes.",
    );
  }
  return {
    prepare: [
      ["mkdir", "-p", "--", outputDir],
      ["chown", "pilot:pilot", "--", outputDir],
    ],
    launch: [
      "sh",
      "-c",
      'cd "$1" && shift && exec "$@"',
      "openapply-browser",
      outputDir,
      "node",
      "/home/pilot/openapply-tools/node_modules/@playwright/mcp/cli.js",
      "--cdp-endpoint",
      `http://127.0.0.1:${port}`,
      "--output-dir",
      outputDir,
    ],
  };
}
