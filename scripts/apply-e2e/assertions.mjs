import { isDeepStrictEqual } from "node:util";
import { requireLoopback, sha256 } from "./api.mjs";
import { CASES, expectedWhyUs, SYNTHETIC_APPLICANT } from "./cases.mjs";

export function validateManifest(manifest, runId) {
  if (manifest.runId !== runId || manifest.cases?.length !== CASES.length)
    throw new Error(`Expected this run's ${CASES.length} fixture cases`);
  const origin = requireLoopback(manifest.origin).origin;
  const ids = new Set();
  const urls = new Set();
  for (const fixture of manifest.cases) {
    const expected = CASES.find((item) => item.id === fixture.id);
    if (
      !expected ||
      fixture.sponsorshipField !== expected.sponsorshipField ||
      fixture.expectedSponsorship !== expected.expectedSponsorship ||
      JSON.stringify(fixture.nameFields) !== JSON.stringify(expected.nameFields)
    )
      throw new Error("Manifest changed canonical identity or sponsorship semantics");
    const url = requireLoopback(fixture.url);
    if (
      url.origin !== origin ||
      url.pathname !== `/runs/${runId}/${fixture.id}` ||
      url.search ||
      url.hash
    )
      throw new Error("Fixture URL escaped the current loopback run");
    if (ids.has(fixture.id) || urls.has(url.href)) throw new Error("Fixture cases must be unique");
    ids.add(fixture.id);
    urls.add(url.href);
  }
  return manifest;
}

function normalized(value) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value) && value.length === 1) return normalized(value[0]);
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function checkpointField(fields, id, label, controlId) {
  for (const fieldId of [controlId, id].filter(Boolean)) {
    const byId = fields.filter((field) => field.id === fieldId);
    if (byId.length === 1) return byId[0];
  }
  const byLabel = fields.filter((field) => normalized(field.label) === normalized(label));
  return byLabel.length === 1 ? byLabel[0] : undefined;
}

function groundedChanges(audit) {
  const pairs = [
    audit?.summary,
    audit?.headline,
    ...(audit?.experience ?? []).flatMap((entry) => entry.bullets ?? []),
    ...(audit?.projects ?? []).flatMap((entry) => entry.bullets ?? []),
  ];
  return pairs.filter(
    (pair) =>
      pair?.grounding &&
      typeof pair.original === "string" &&
      pair.original.trim() &&
      typeof pair.tailored === "string" &&
      pair.tailored.trim() &&
      pair.original !== pair.tailored,
  );
}

export function assertCaseEvidence({
  fixture,
  submissions,
  job,
  attempt,
  application,
  variant,
  artifact,
  checkpointPdf,
  applicationPdf,
  originalText,
  sourceText,
  resumeId,
  startedAt,
  workerCheck,
}) {
  const checks = [];
  const check = (name, passed, detail) =>
    checks.push({ name, passed: Boolean(passed), ...(detail ? { detail } : {}) });
  const rows = submissions.filter((row) => row.caseId === fixture.id);
  check("exactly_one_fixture_submission", rows.length === 1, `Observed ${rows.length}`);
  const submitted = rows[0];
  if (!submitted) return { caseId: fixture.id, passed: false, checks };
  check("exactly_one_fixture_submit_request", submitted.submissionRequests === 1);
  const fields = submitted.fields;
  const expected = {
    ...Object.fromEntries(fixture.nameFields.map((name) => [name, SYNTHETIC_APPLICANT[name]])),
    email: SYNTHETIC_APPLICANT.email,
    workAuthorization: SYNTHETIC_APPLICANT.authorized,
    [fixture.sponsorshipField]: fixture.expectedSponsorship,
    sponsorshipDetails: SYNTHETIC_APPLICANT.sponsorshipDetails,
  };
  for (const [key, value] of Object.entries(expected)) {
    check(`submitted_${key}`, fields?.[key] === value);
  }
  const whyUs = fields?.whyUs ?? "";
  check("why_us_required_and_bounded", whyUs.trim().length >= 80 && whyUs.length <= 1200);
  check("why_us_matches_confirmed_synthetic_answer", whyUs === expectedWhyUs(fixture));
  check("job_applied", job?.status === "applied");
  check(
    "full_job_description_saved",
    Boolean(fixture.description) &&
      Boolean(job?.description) &&
      job.description.replace(/\s+/g, " ").includes(fixture.description.replace(/\s+/g, " ")),
  );
  const assessment = job?.fitAssessment;
  check(
    "fit_based_on_uploaded_original",
    assessment?.basis?.resumeId === resumeId &&
      assessment?.basis?.sourceSha256 === sha256(originalText),
  );
  check(
    "fit_source_text_hash",
    sourceText === originalText && assessment?.basis?.sourceTextSha256 === sha256(sourceText),
  );
  const quotations = assessment?.assessments?.flatMap((item) => item.evidence ?? []) ?? [];
  check(
    "fit_has_exact_original_quotes",
    quotations.length > 0 &&
      quotations.every((span) => sourceText.slice(span.start, span.end) === span.quote),
  );
  check(
    "fit_score_server_recorded",
    Number.isInteger(job?.matchScore) && job.matchScore === assessment?.score,
  );
  check(
    "submission_attempt_recorded",
    attempt?.state === "recorded" &&
      !attempt.legacyOutcomeUnknown &&
      Boolean(attempt.startedAt && attempt.recordedAt),
  );
  check(
    "attempt_application_identity",
    Boolean(application?.id) &&
      attempt?.applicationId === application.id &&
      attempt?.jobId === job?.id,
  );
  const canonicalFixture = requireLoopback(fixture.url);
  // The API canonicalizes application identity to HTTPS; the fixture is served over HTTP.
  canonicalFixture.protocol = "https:";
  check(
    "application_uses_fixture_job",
    application?.url === canonicalFixture.href &&
      attempt?.canonicalUrl === canonicalFixture.href &&
      attempt?.originalUrl === fixture.url &&
      application?.campaignId === job?.campaignId &&
      application?.status === "applied",
  );
  const checkpoint = attempt?.checkpoint;
  check(
    "checkpoint_has_review",
    Boolean(attempt?.checkpointId) &&
      checkpoint?.review?.issues?.length === 0 &&
      ["job", "fields", "resume", "factualClaims"].every(
        (key) => checkpoint?.review?.checks?.[key] === true,
      ),
  );
  check(
    "checkpoint_job_identity",
    checkpoint?.job?.id === job?.id &&
      checkpoint?.job?.url === fixture.url &&
      checkpoint?.job?.canonicalUrl === canonicalFixture.href,
  );
  const controls = new Map((fixture.fields ?? []).map((field) => [field.id, field]));
  for (const [key, value] of Object.entries({ ...expected, whyUs })) {
    const control = controls.get(key);
    const captured = checkpointField(
      checkpoint?.fields ?? [],
      key,
      control?.label,
      control?.controlId,
    );
    const sameValue = ["yes", "no"].includes(value)
      ? normalized(captured?.value) === value
      : captured?.value === value;
    check(`checkpoint_matches_${key}`, Boolean(captured) && !captured.redacted && sameValue);
    const saved = checkpointField(
      application?.submission?.fields ?? [],
      key,
      control?.label,
      control?.controlId,
    );
    const sameSavedValue = ["yes", "no"].includes(value)
      ? normalized(saved?.value) === value
      : saved?.value === value;
    check(`application_matches_${key}`, Boolean(saved) && !saved.redacted && sameSavedValue);
  }
  check(
    "application_retains_all_checkpoint_fields",
    Boolean(checkpoint?.fields) &&
      isDeepStrictEqual(application?.submission?.fields, checkpoint.fields),
  );
  check(
    "checkpoint_upload_hash",
    /^[a-f0-9]{64}$/.test(submitted.resume?.sha256 ?? "") &&
      submitted.resume?.sha256 === checkpoint?.resume?.sha256,
  );
  check(
    "archived_pdf_bytes_match_upload",
    Boolean(checkpointPdf) && sha256(checkpointPdf) === submitted.resume?.sha256,
  );
  check(
    "application_pdf_bytes_match_upload",
    Boolean(applicationPdf) && sha256(applicationPdf) === submitted.resume?.sha256,
  );
  check("pdf_signature", checkpointPdf?.subarray(0, 5).toString() === "%PDF-");
  check(
    "new_tailored_variant",
    Boolean(variant?.id) &&
      variant?.id === checkpoint?.resumeVariantId &&
      variant?.resumeId === resumeId &&
      variant?.jobUrl === fixture.url &&
      Date.parse(variant.createdAt) >= Date.parse(startedAt),
  );
  const changes = groundedChanges(variant?.rewrites);
  check("variant_has_actual_grounded_rewrite", changes.length > 0);
  const artifactChanges = groundedChanges(artifact?.audit);
  const artifactText = [
    artifact?.content?.summary,
    artifact?.content?.basics?.headline,
    ...(artifact?.content?.experience ?? []).flatMap((entry) => entry.bullets ?? []),
    ...(artifact?.content?.projects ?? []).flatMap((entry) => entry.bullets ?? []),
  ];
  check(
    "artifact_contains_reviewed_rewrite",
    changes.length > 0 &&
      changes.every((change) =>
        artifactChanges.some((candidate) => isDeepStrictEqual(candidate, change)),
      ) &&
      changes.some((change) => artifactText.includes(change.tailored)),
  );
  check(
    "artifact_matches_uploaded_pdf",
    artifact?.pdfSha256 === submitted.resume?.sha256 &&
      artifact?.revision === checkpoint?.resume?.artifact?.revision &&
      artifact?.variantId === variant?.id &&
      artifact?.job?.url === fixture.url &&
      artifact?.validation?.valid === true,
  );
  check("artifact_keeps_original_source", artifact?.source?.sha256 === sha256(originalText));
  const receipt = attempt?.receipt?.confirmation;
  check(
    "receipt_matches_fixture",
    receipt?.url === submitted.receipt?.url &&
      receipt?.reference === submitted.receipt?.id &&
      receipt?.text?.includes(submitted.receipt?.text),
  );
  check(
    "receipt_checkpoint_identity",
    attempt?.receipt?.checkpointId === attempt?.checkpointId && Boolean(attempt?.receiptStoredAt),
  );
  check(
    "application_retains_receipt",
    application?.submission?.confirmation?.url === receipt?.url &&
      application?.submission?.confirmation?.reference === receipt?.reference &&
      application?.submission?.confirmation?.text === receipt?.text,
  );
  check(
    "application_retains_resume",
    application?.submission?.resume?.sha256 === submitted.resume?.sha256 &&
      application?.resumeVariantUsed?.id === variant?.id,
  );
  check(
    "worker_handback_revalidated",
    workerCheck?.valid === true &&
      workerCheck?.outcome === "recorded" &&
      workerCheck?.attempt?.applicationId === application?.id &&
      workerCheck?.attempt?.checkpointId === attempt?.checkpointId,
  );
  return { caseId: fixture.id, passed: checks.every((item) => item.passed), checks };
}

export function assertAggregates({
  campaign,
  applications,
  summary,
  analytics,
  expected = CASES.length,
}) {
  const checks = [
    ["campaign_completed", campaign.status === "completed"],
    ["campaign_exact_total", campaign.summary.totalFound === expected],
    [
      "campaign_exact_applied",
      campaign.summary.applied === expected && campaign.summary.byStatus.applied === expected,
    ],
    [
      "applications_exact_total",
      applications.length === expected &&
        new Set(applications.map((item) => item.id)).size === expected,
    ],
    [
      "dashboard_summary_total",
      summary.total === expected && summary.byStatus.applied === expected,
    ],
    [
      "analytics_total",
      analytics.totals.applications === expected && analytics.totals.submitted === expected,
    ],
    [
      "analytics_status_breakdown",
      analytics.statusBreakdown.find((item) => item.status === "applied")?.count === expected,
    ],
  ].map(([name, passed]) => ({ name, passed }));
  return { passed: checks.every((item) => item.passed), checks };
}
