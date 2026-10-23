import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CASES, SYNTHETIC_APPLICANT } from "./cases.mjs";
import {
  renderError,
  renderFinalStep,
  renderFirstStep,
  renderJob,
  renderReceipt,
  renderSecondStep,
} from "./forms.mjs";

const BODY_LIMIT = 2 * 1024 * 1024;
const PDF_LIMIT = 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function invalid(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

function readBody(request) {
  return new Promise((accept, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(invalid("Request exceeds the 2 MiB limit.", 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => accept(Buffer.concat(chunks)));
    request.on("error", reject);
    request.on("aborted", () => reject(invalid("Request interrupted.", 400)));
  });
}

async function parseForm(request, origin) {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) {
    throw invalid("Expected a multipart application form.", 415);
  }
  if (Number(request.headers["content-length"]) > BODY_LIMIT) {
    throw invalid("Request exceeds the 2 MiB limit.", 413);
  }
  const body = await readBody(request);
  try {
    const form = await new Request(origin, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
    const values = {};
    for (const [name, value] of form.entries()) {
      if (Object.hasOwn(values, name)) throw invalid(`Duplicate form field: ${name}`);
      Object.defineProperty(values, name, { value, enumerable: true });
    }
    return values;
  } catch (error) {
    if (error.status) throw error;
    throw invalid("Malformed multipart form.", 400);
  }
}

function validateText(value, name, min, max) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw invalid(`${name} must contain ${min}–${max} characters.`);
  }
}

function validateContact(fields, job, key) {
  if (fields.idempotencyKey !== key) throw invalid("Invalid application identity.", 400);
  if (
    job.nameFields.some((name) => fields[name] !== SYNTHETIC_APPLICANT[name]) ||
    fields.email !== SYNTHETIC_APPLICANT.email
  ) {
    throw invalid("This fixture accepts only the documented synthetic applicant.");
  }
}

function validateEligibility(fields, job) {
  if (!["yes", "no"].includes(fields.workAuthorization)) {
    throw invalid("Answer the current work authorization question with Yes or No.");
  }
  const sponsorship = fields[job.sponsorshipField];
  if (!["yes", "no"].includes(sponsorship))
    throw invalid("Answer the sponsorship question with Yes or No.");
  const needsSponsorship =
    job.sponsorshipField === "doesNotNeedSponsorship"
      ? sponsorship === "no"
      : sponsorship === "yes";
  if (needsSponsorship) validateText(fields.sponsorshipDetails, "Sponsorship details", 10, 500);
  if (
    !needsSponsorship &&
    fields.sponsorshipDetails !== undefined &&
    fields.sponsorshipDetails !== ""
  ) {
    throw invalid("Sponsorship details must be empty when sponsorship is not required.");
  }
}

function assertKnownFields(fields, names) {
  for (const name of Object.keys(fields)) {
    if (!names.includes(name)) throw invalid(`Unexpected form field: ${name}`);
  }
}

async function validateApplication(fields, job, key) {
  validateContact(fields, job, key);
  assertKnownFields(fields, [
    ...job.nameFields,
    "email",
    "workAuthorization",
    "idempotencyKey",
    job.sponsorshipField,
    "sponsorshipDetails",
    "whyUs",
    "resume",
  ]);
  validateEligibility(fields, job);
  validateText(fields.whyUs, "Why this company", 80, 1200);
  const file = fields.resume;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    throw invalid("Upload a resume PDF.");
  }
  if (
    !file.name ||
    !/\.pdf$/i.test(file.name) ||
    file.type !== "application/pdf" ||
    file.size < 40 ||
    file.size > PDF_LIMIT
  ) {
    throw invalid("Resume must be a PDF between 40 bytes and 1 MiB.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (
    !/^%PDF-(1\.[0-9]|2\.0)/.test(bytes.subarray(0, 8).toString("ascii")) ||
    !/%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"))
  ) {
    throw invalid("The resume does not have a valid PDF header and end marker.");
  }
  const posted = Object.fromEntries(
    Object.keys(fields)
      .sort()
      .filter((name) => name !== "resume" && name !== "idempotencyKey")
      .map((name) => [name, fields[name]]),
  );
  const resume = { filename: file.name, size: bytes.length, sha256: sha256(bytes) };
  return { fields: posted, resume, bytes };
}

function makeManifest(runId, origin) {
  return {
    runId,
    origin,
    applicant: SYNTHETIC_APPLICANT,
    cases: CASES.map((job) => {
      const company = `${job.company} ${runId}`;
      return {
        ...job,
        company,
        description: `${company} is a synthetic employer whose mission is to ${job.mission}. We are hiring a software engineer to build accessible web application dashboards and reliable APIs. Required skills: TypeScript, React, Node.js, PostgreSQL, automated testing, and accessible user interfaces. You will improve application workflows, test frontend and backend behavior, and collaborate on maintainable product software. An Accessible application dashboard project is relevant experience. This Canada remote role is full time, welcomes candidates with current Canadian work authorization, and offers future employer sponsorship when required. No degree, minimum years, clearance, relocation, or demographic answers are required. Salary: CAD 100,000–130,000 annually. This is a local test job, not a real employment offer.`,
        url: `${origin}/runs/${runId}/${job.id}`,
        fields: [
          ...job.nameFields.map((id) => ({
            id,
            label: { name: "Full name", firstName: "First name", lastName: "Last name" }[id],
          })),
          { id: "email", label: "Email address" },
          {
            id: "workAuthorization",
            label: "Are you currently legally authorized to work in Canada?",
            expected: "yes",
          },
          {
            id: job.sponsorshipField,
            label: job.sponsorshipQuestion,
            expected: job.expectedSponsorship,
          },
          { id: "sponsorshipDetails", label: "Please describe the sponsorship you will require" },
          { id: "whyUs", label: `Why do you want to work at ${company}?` },
          { id: "resume", label: "Resume PDF" },
        ].map((field) => ({ ...field, controlId: job.controlIds[field.id] ?? field.id })),
      };
    }),
  };
}

export async function startFixtureServer({ port = 14110, host = "127.0.0.1", runId, outputDir }) {
  if (host !== "127.0.0.1") throw new Error("Fixtures must bind to 127.0.0.1 only.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid fixture port.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId ?? ""))
    throw new Error("Invalid fixture run ID.");
  if (!outputDir) throw new Error("A dedicated per-run outputDir is required.");
  const directory = resolve(outputDir);
  await mkdir(directory, { recursive: true });
  const dataPath = resolve(directory, "submissions.json");
  let submissions = [];
  let submissionRequests = {};
  try {
    const persisted = JSON.parse(await readFile(dataPath, "utf8"));
    if (persisted.runId !== runId || !Array.isArray(persisted.submissions))
      throw new Error("Output directory belongs to another run or is malformed.");
    submissions = persisted.submissions;
    submissionRequests = persisted.submissionRequests;
    if (!submissionRequests || typeof submissionRequests !== "object")
      throw new Error("Fixture submission request evidence is missing.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let manifest;
  let origin;
  let writeQueue = Promise.resolve();
  const applicationKey = (job) => sha256(`${runId}:${job.id}:local-test-application`);
  const evidence = (rows) => ({
    runId,
    submissionRequests,
    submissions: rows.map((row) => ({
      ...row,
      submissionRequests: submissionRequests[row.caseId] ?? 0,
    })),
  });
  const persist = async (next) => {
    const temporaryPath = `${dataPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(evidence(next), null, 2)}\n`);
    await rename(temporaryPath, dataPath);
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Chromium sends Origin: null for form POSTs under no-referrer, even to the same origin.
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const sendHtml = (status, content) => {
      response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      response.end(content);
    };
    const sendJson = (data) => {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(`${JSON.stringify(data)}\n`);
    };
    try {
      if (
        request.socket.remoteAddress !== "127.0.0.1" ||
        request.headers.host !== new URL(origin).host ||
        !request.url.startsWith("/")
      ) {
        throw invalid("Loopback host required.", 403);
      }
      const url = new URL(request.url, origin);
      const job = manifest.cases.find(
        (candidate) =>
          url.pathname === new URL(candidate.url).pathname ||
          url.pathname.startsWith(`${new URL(candidate.url).pathname}/`),
      );
      const suffix = job ? url.pathname.slice(new URL(job.url).pathname.length) : null;
      if (request.method === "POST" && suffix === "/apply") {
        // A rejected browser POST still counts as a submit attempt for acceptance evidence.
        const recordRequest = writeQueue.then(async () => {
          submissionRequests[job.id] = (submissionRequests[job.id] ?? 0) + 1;
          await persist(submissions);
        });
        writeQueue = recordRequest.catch(() => {});
        await recordRequest;
      }
      if (request.headers.origin && request.headers.origin !== origin)
        throw invalid("Cross-origin request rejected.", 403);
      if (request.headers["sec-fetch-site"] === "cross-site")
        throw invalid("Cross-site request rejected.", 403);
      if (request.method === "POST" && request.headers.origin !== origin)
        throw invalid("Same-origin form submission required.", 403);
      if (request.method === "GET" && url.pathname === "/__fixture__/manifest")
        return sendJson(manifest);
      if (request.method === "GET" && url.pathname === "/__fixture__/submissions")
        return sendJson(evidence(submissions));
      if (request.method === "GET" && url.pathname.startsWith("/receipt/")) {
        const submission = submissions.find(
          (entry) => `/receipt/${entry.receipt.id}` === url.pathname,
        );
        if (submission) return sendHtml(200, renderReceipt(submission));
      }
      if (!job) throw invalid("Fixture route not found.", 404);
      const key = applicationKey(job);
      if (request.method === "GET" && suffix === "") return sendHtml(200, renderJob(job, key));
      if (request.method === "GET" && suffix === "/start" && job.entryPath === "/start")
        return sendHtml(200, renderFirstStep(job, key));
      if (request.method === "POST" && suffix === "/step/1" && job.steps === 3) {
        const fields = await parseForm(request, origin);
        validateContact(fields, job, key);
        assertKnownFields(fields, [...job.nameFields, "email", "idempotencyKey"]);
        return sendHtml(200, renderSecondStep(job, fields));
      }
      if (request.method === "POST" && suffix === "/step/2" && job.steps === 3) {
        const fields = await parseForm(request, origin);
        validateContact(fields, job, key);
        assertKnownFields(fields, [
          ...job.nameFields,
          "email",
          "idempotencyKey",
          "workAuthorization",
          job.sponsorshipField,
          "sponsorshipDetails",
        ]);
        validateEligibility(fields, job);
        return sendHtml(200, renderFinalStep(job, fields));
      }
      if (request.method === "POST" && suffix === "/apply") {
        const fields = await parseForm(request, origin);
        const validated = await validateApplication(fields, job, key);
        const fingerprint = sha256(
          JSON.stringify({ fields: validated.fields, resume: validated.resume }),
        );
        const operation = writeQueue.then(async () => {
          const previous = submissions.find((entry) => entry.caseId === job.id);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              throw invalid(
                "This application already has a receipt; changed duplicate rejected.",
                409,
              );
            return previous;
          }
          const receiptId = `fixture-${job.id}-${randomUUID()}`;
          const submission = {
            id: randomUUID(),
            runId,
            caseId: job.id,
            createdAt: new Date().toISOString(),
            fields: validated.fields,
            resume: validated.resume,
            idempotencyKey: key,
            fingerprint,
            receipt: {
              id: receiptId,
              url: `${origin}/receipt/${receiptId}`,
              text: `Your local test application for ${job.title} at ${job.company} has been received.`,
            },
          };
          await writeFile(resolve(directory, `${job.id}-resume.pdf`), validated.bytes);
          const next = [...submissions, submission];
          await persist(next);
          submissions = next;
          return submission;
        });
        writeQueue = operation.catch(() => {});
        const submission = await operation;
        response.writeHead(303, { Location: submission.receipt.url });
        return response.end();
      }
      throw invalid("Fixture route not found.", 404);
    } catch (error) {
      return sendHtml(
        error.status ?? 500,
        renderError(error.status ? error.message : "Fixture storage or request failed."),
      );
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 40;
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(port, host, accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  manifest = makeManifest(runId, origin);
  try {
    await writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (submissions.length === 0) await persist(submissions);
  } catch (error) {
    server.closeAllConnections();
    await new Promise((accept) => server.close(accept));
    throw error;
  }
  let closePromise;
  const close = () => {
    closePromise ??= writeQueue.then(async () => {
      server.closeAllConnections();
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    });
    return closePromise;
  };
  return {
    origin,
    manifest,
    close,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  const names = {
    "--port": "port",
    "--host": "host",
    "--run-id": "runId",
    "--run-dir": "outputDir",
  };
  for (let index = 0; index < args.length; index += 2) {
    const name = names[args[index]];
    if (!name || !args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error(
        "Usage: node fixture-server.mjs --run-id ID --run-dir PATH [--port 14110] [--host 127.0.0.1]",
      );
    options[name] = name === "port" ? Number(args[index + 1]) : args[index + 1];
  }
  const fixture = await startFixtureServer(options);
  process.stdout.write(
    `${JSON.stringify({ ready: true, runId: fixture.manifest.runId, origin: fixture.origin })}\n`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => void fixture.close().then(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
