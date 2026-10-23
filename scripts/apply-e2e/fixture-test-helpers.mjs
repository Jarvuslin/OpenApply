import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectedWhyUs, SYNTHETIC_APPLICANT } from "./cases.mjs";
import { startFixtureServer } from "./fixture-server.mjs";

// These requests test the fixture, never the OpenApply agent or its submission protocol.
export const TEST_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
);

export async function setupFixture(test) {
  const outputDir = await mkdtemp(join(tmpdir(), "openapply-fixture-test-"));
  const fixture = await startFixtureServer({ port: 0, runId: "fixture-unit-test", outputDir });
  test.after(async () => {
    await fixture.close();
    await rm(outputDir, { recursive: true, force: true });
  });
  return { ...fixture, outputDir };
}

export async function applicationForm(job, overrides = {}) {
  const entryUrl = `${job.url}${job.entryPath}`;
  const html = await (await fetch(entryUrl)).text();
  const key = html.match(/name="idempotencyKey" value="([^"]+)"/)[1];
  const fields = {
    idempotencyKey: key,
    ...Object.fromEntries(job.nameFields.map((name) => [name, SYNTHETIC_APPLICANT[name]])),
    email: SYNTHETIC_APPLICANT.email,
    workAuthorization: "yes",
    [job.sponsorshipField]: job.expectedSponsorship,
    sponsorshipDetails: SYNTHETIC_APPLICANT.sponsorshipDetails,
    whyUs: expectedWhyUs(job),
    resume: new Blob([TEST_PDF], { type: "application/pdf" }),
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value instanceof Blob) form.append(key, value, "Morgan-Fixture-Resume.pdf");
    else form.append(key, value);
  }
  return form;
}

export async function submit(fixture, job, overrides = {}) {
  return fetch(`${job.url}/apply`, {
    method: "POST",
    headers: { Origin: fixture.origin },
    body: await applicationForm(job, overrides),
    redirect: "manual",
  });
}
