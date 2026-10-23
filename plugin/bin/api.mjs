// @ts-check
// Calls the OpenApply API as the session's user. Node's fetch does TLS through OpenSSL, so it works
// inside the Codex Windows sandbox, where Schannel-based HTTP clients cannot get credentials.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { prepareSubmissionRecovery, showSubmissionRecovery } from "./submission-recovery.mjs";

const USAGE = `usage: openapply-api <METHOD> <path> [--query key=value]... [--data <json>|@<file>|- | --file <field>=<absolute-path>]... [--out <file>]

  openapply-api GET /api/user
  openapply-api GET /api/applied --query search=Acme --query limit=100
  openapply-api POST /api/campaigns --data @body.json
  openapply-api POST /api/campaigns/1/jobs/example/submission-resume --file file=/absolute/resume.pdf
  openapply-api GET /api/resumes/3/pdf --out resume-3.pdf`;

const REQUEST_TIMEOUT_MS = 120_000;

/** @returns {Record<string, string>} */
function workHeaders() {
  const id = process.env.OPENAPPLY_WORK_ITEM_ID;
  const lease = process.env.OPENAPPLY_WORK_LEASE_TOKEN;
  if (!id && !lease) return {};
  if (
    !id ||
    !lease ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
    !/^[a-zA-Z0-9_-]{32,128}$/.test(lease)
  )
    fail("Queue execution requires a valid paired work item and lease; no request was sent.");
  return { "X-OpenApply-Work-Item": id, "X-OpenApply-Work-Lease": lease };
}

/** @param {string} text */
function redact(text) {
  for (const value of [process.env.OPENAPPLY_API_TOKEN, process.env.OPENAPPLY_WORK_LEASE_TOKEN])
    if (value) text = text.replaceAll(value, "[redacted]");
  return text;
}

/**
 * @typedef {object} ApiRequest
 * @property {string} method HTTP method, upper-cased.
 * @property {string} path API-relative path as given on the command line.
 * @property {[string, string][]} query Query parameters, URL-encoded when the URL is built.
 * @property {string | null} data Inline JSON, `@<file>`, or `-` for stdin.
 * @property {[string, string][]} files Multipart field names and absolute file paths.
 * @property {string | null} out File that receives the response body instead of stdout.
 */

/** A usage or request failure reported on stderr without a stack trace. */
class CliError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode 2 for bad usage, 1 for a failed request.
   */
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

/**
 * @param {string} message
 * @param {number} [exitCode]
 * @returns {never}
 */
function fail(message, exitCode = 2) {
  throw new CliError(message, exitCode);
}

/**
 * @param {string[]} argv Arguments after the script path.
 * @returns {ApiRequest}
 */
function parseArgs(argv) {
  const [method, path, ...rest] = argv;
  if (!method || !path || method === "--help" || method === "-h") fail(USAGE);

  /** @type {ApiRequest} */
  const request = {
    method: method.toUpperCase(),
    path,
    query: [],
    data: null,
    files: [],
    out: null,
  };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1] ?? null;
    if (value === null) fail(`${flag} needs a value\n\n${USAGE}`);

    if (flag === "--query" || flag === "-q") {
      const separator = value.indexOf("=");
      if (separator < 1) fail(`--query takes key=value, got "${value}"`);
      request.query.push([value.slice(0, separator), value.slice(separator + 1)]);
    } else if (flag === "--data" || flag === "-d") {
      request.data = value;
    } else if (flag === "--file") {
      const separator = value.indexOf("=");
      if (separator < 1) fail("--file takes <field>=<absolute-path>");
      const filePath = value.slice(separator + 1);
      if (!isAbsolute(filePath)) fail("--file requires an absolute file path");
      request.files.push([value.slice(0, separator), filePath]);
    } else if (flag === "--out" || flag === "-o") {
      request.out = value;
    } else {
      fail(`unknown option ${flag}\n\n${USAGE}`);
    }
  }
  if (request.data !== null && request.files.length > 0) {
    fail("--file cannot be combined with --data");
  }
  return request;
}

/**
 * @param {[string, string][]} files
 * @returns {FormData}
 */
function readFiles(files) {
  const body = new FormData();
  for (const [field, filePath] of files) {
    const type =
      extname(filePath).toLowerCase() === ".pdf" ? "application/pdf" : "application/octet-stream";
    body.append(field, new Blob([readFileSync(filePath)], { type }), basename(filePath));
  }
  return body;
}

/**
 * Resolves `--data` to the JSON text to send, rejecting invalid JSON before any request.
 * @param {string | null} data
 * @returns {string | null}
 */
function readBody(data) {
  if (data === null) return null;

  let text = data;
  if (data === "-") text = readFileSync(0, "utf8");
  else if (data.startsWith("@")) text = readFileSync(data.slice(1), "utf8");

  // Windows PowerShell 5.1 writes UTF-8 files with a BOM, which JSON.parse rejects.
  text = text.replace(/^﻿/, "");
  try {
    JSON.parse(text);
  } catch {
    fail("request body is not valid JSON");
  }
  return text;
}

/**
 * @param {string} base The OPENAPPLY_API origin.
 * @param {string} rawPath
 * @param {[string, string][]} query
 * @returns {URL}
 */
function buildUrl(base, rawPath, query) {
  // Git Bash rewrites a leading-slash argument into a Windows path, so "api/user" is accepted too.
  const path = rawPath.startsWith("api/") ? `/${rawPath}` : rawPath;
  // Only API-relative paths, so the bearer token can never reach another origin.
  if (!path.startsWith("/") || path.startsWith("//")) {
    fail(`path must be API-relative, like /api/user - got "${rawPath}"`);
  }
  const url = new URL(base.replace(/\/+$/, "") + path);
  if (url.origin !== new URL(base).origin) fail(`path "${path}" leaves ${base}`);
  for (const [key, value] of query) url.searchParams.append(key, value);
  return url;
}

/** @returns {Promise<void>} */
async function main() {
  const request = parseArgs(process.argv.slice(2));
  const base = process.env.OPENAPPLY_API;
  if (!base)
    fail("OPENAPPLY_API is unset - this session is not running inside the OpenApply terminal host");

  const url = buildUrl(base, request.path, request.query);
  const queueHeaders = workHeaders();
  let body = request.files.length > 0 ? readFiles(request.files) : readBody(request.data);
  try {
    body = prepareSubmissionRecovery(base, request.method, request.path, body);
  } catch (error) {
    const reason = /** @type {Error & { code?: string }} */ (error);
    fail(
      `Submission recovery could not be prepared (${reason.code ?? reason.message}); no request was sent. Preserve the receipt and resolve local storage or payload validation before retrying.`,
      1,
    );
  }
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json", ...queueHeaders };
  if (process.env.OPENAPPLY_API_TOKEN)
    headers.authorization = `Bearer ${process.env.OPENAPPLY_API_TOKEN}`;
  // fetch sets the multipart boundary; a manual content-type would omit it.
  if (request.data !== null) headers["content-type"] = "application/json";

  /** @type {Response} */
  let response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const failure = /** @type {Error & { cause?: Error }} */ (error);
    fail(
      `${request.method} ${request.path} failed: ${failure.cause?.message ?? failure.message}`,
      1,
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    fail(
      `HTTP ${response.status} ${request.method} ${request.path}${detail ? `\n${detail}` : ""}`,
      1,
    );
  }

  showSubmissionRecovery(base, request.method, request.path);

  if (request.out !== null) {
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(request.out, bytes);
    process.stderr.write(`saved ${bytes.length} bytes to ${request.out}\n`);
    return;
  }

  process.stdout.write(redact(await response.text()));
}

// process.exit() with fetch handles still open aborts Node on Windows, so only set the exit code.
try {
  await main();
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`${redact(error.message)}\n`);
  process.exitCode = error.exitCode;
}
