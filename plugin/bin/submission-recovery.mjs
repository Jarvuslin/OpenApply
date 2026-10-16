// @ts-check
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const secretQuery = /token|auth|code|secret|password|session|key|signature|credential/i;

/** @param {string} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value @param {string[]} required @param {string[]} optional */
function objectKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

/** @param {unknown} value @param {number} max @param {boolean} [allowEmpty] */
function boundedText(value, max, allowEmpty = false) {
  if (typeof value !== "string") throw new Error("Expected bounded receipt text");
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > max) throw new Error("Invalid receipt text length");
  return text;
}

/** @param {string | null | FormData} body */
function normalizeReceipt(body) {
  if (typeof body !== "string") throw new Error("Submission receipt requires a JSON body");
  const input = JSON.parse(body);
  if (
    !objectKeys(input, ["checkpointId", "confirmation"]) ||
    typeof input.checkpointId !== "string" ||
    !UUID.test(input.checkpointId) ||
    !objectKeys(input.confirmation, ["url", "text", "observedAt"], ["reference"])
  ) {
    throw new Error("Invalid submission receipt shape");
  }
  const source = input.confirmation;
  const url = new URL(boundedText(source.url, 10000));
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Expected an HTTP receipt URL");
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (secretQuery.test(key)) url.searchParams.delete(key);
  }
  const observedAt = boundedText(source.observedAt, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(observedAt) ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new Error("Invalid receipt timestamp");
  if (new Date(observedAt).toISOString().slice(0, 19) !== observedAt.slice(0, 19)) {
    throw new Error("Invalid receipt calendar date");
  }
  const confirmation = {
    url: url.toString(),
    text: boundedText(source.text, 10000),
    observedAt,
    ...(source.reference === undefined
      ? {}
      : { reference: boundedText(source.reference, 500, true) }),
  };
  return { checkpointId: input.checkpointId.toLowerCase(), confirmation };
}

/** @param {string} base @param {string} path */
function recoveryRoute(base, path) {
  const normalizedPath = path.startsWith("api/") ? `/${path}` : path;
  const pathname = new URL(normalizedPath, base).pathname.replace(/\/$/, "");
  const match = /^\/api\/campaigns\/([^/]+)\/jobs\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const endpoint = decodeURIComponent(match[3]);
  if (endpoint !== "submission-receipt" && endpoint !== "submission-attempt") return null;
  const campaignId = decodeURIComponent(match[1]);
  const jobKey = decodeURIComponent(match[2]);
  if (!UUID.test(campaignId) || !jobKey || jobKey.length > 1000) {
    throw new Error("Invalid submission recovery route");
  }
  const origin = new URL(base);
  origin.username = "";
  origin.password = "";
  origin.search = "";
  origin.hash = "";
  const parts = [
    ".openapply",
    "submission-recovery",
    hash(origin.toString().replace(/\/+$/, "")),
    campaignId.toLowerCase(),
    hash(jobKey),
  ];
  return { directory: join(homedir(), ...parts), parts, kind: endpoint };
}

/** List paths only after the API has authenticated ownership of this job.
 * @param {string} base @param {string} method @param {string} path */
export function showSubmissionRecovery(base, method, path) {
  if (method !== "GET") return;
  const route = recoveryRoute(base, path);
  if (route?.kind !== "submission-attempt" || !existsSync(route.directory)) return;
  for (const name of readdirSync(route.directory).sort()) {
    if (name.endsWith(".json") && UUID.test(name.slice(0, -5))) {
      process.stderr.write(`submission recovery available: ${join(route.directory, name)}\n`);
    }
  }
}

/**
 * Persist exactly the normalized receipt bytes sent to the API before making a network request.
 * @param {string} base @param {string} method @param {string} path
 * @param {string | null | FormData} body
 */
export function prepareSubmissionRecovery(base, method, path, body) {
  const route = recoveryRoute(base, path);
  if (!route) return body;
  if (method !== "POST" || route.kind !== "submission-receipt") return body;

  const receipt = normalizeReceipt(body);
  const serialized = JSON.stringify(receipt);
  let directory = homedir();
  for (const part of route.parts) {
    directory = join(directory, part);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const destination = join(directory, `${receipt.checkpointId}.json`);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    // Linking publishes complete bytes atomically without replacing earlier evidence.
    try {
      linkSync(temporary, destination);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      if (readFileSync(destination, "utf8") !== serialized) {
        throw new Error("A different receipt is already retained for this checkpoint");
      }
    }
    chmodSync(destination, 0o600);
    if (process.platform !== "win32") {
      const directoryDescriptor = openSync(directory, "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } finally {
    unlinkSync(temporary);
  }
  process.stderr.write(`submission recovery saved: ${destination}\n`);
  return serialized;
}
