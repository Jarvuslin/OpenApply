# Durable submission and recovery

Use this sequence for every apply worker, including retries, answered questions and resumed campaigns. It records a review checkpoint and reserves one submission attempt. These API checks protect OpenApply state and cooperative workers; they do not intercept arbitrary browser clicks. Keep the actual page and progress visible and follow runtime policies.

## Inspect before any employer action

```bash
openapply-api GET /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-attempt
```

Read `attempt` before opening, navigating or changing an employer form, and before deciding that a failed job is retryable. An API error is a blocker, not an absent attempt. The helper prints existing recovery file paths on stderr only after this owned lookup succeeds; paths alone are not proof of submission. Recovery calls work directly on the owned job: never reclaim it, requeue it or PATCH needs_user back to applying before saving its receipt/result.

| Persisted state | Action |
| --- | --- |
| `attempt:null` | Normal authorized application preparation may begin. |
| `prepared`, no `startedAt` | No submit has been reserved. Reinspect the existing form and PDF before using or replacing its checkpoint. |
| `unknown` or any `startedAt` without a stored receipt | Do not fill, begin or Submit again. Inspect the preserved page read-only. Replay a matching retained receipt when available; otherwise report the unknown outcome and park for evidence review. |
| `legacyOutcomeUnknown:true` | No trustworthy pre-submit checkpoint exists. Report unresolved; do not create one after the fact or submit again. |
| `recording_pending` | The employer receipt is saved. Retry only `/result` using the saved checkpoint ID. |
| `recorded` | Return the persisted application and checkpoint IDs; no form work. |

A matching local recovery JSON must identify this exact checkpoint. Never change its timestamp/text, substitute another job's receipt or treat a filesystem filename as confirmation. For an actual retained receipt, replay:

```bash
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-receipt --data @"<retained-recovery-file>"
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/result --data '{"outcome":"applied","checkpointId":"<saved-checkpoint-id>"}'
```

Read the persisted attempt after either an uncertain HTTP outcome or a successful result. Count success only when `state:"recorded"` and the persisted `applicationId` matches the returned Application's `id`. Storage recovery never calls `/submission-begin` or the employer Submit button.

## Save the reviewed application before Submit

1. Complete `form-filling.md` and the factual/document review in `application-review.md`. Keep the exact final nonsecret answers from every page, including cover-letter prose. Archive the actual staged PDF with `/submission-resume`; compare its returned hash to the reviewed local bytes. Resolve all issues before claiming that a check passed.
2. Save a JSON file under the job-prefixed scratch path containing:

```jsonc
{
  "fields": [{"id":"contact.email","label":"Email","type":"email","section":"Contact","value":"<confirmed actual answer>"}],
  "resume": {"jobId":"<archive job UUID>","sha256":"<actual archive SHA-256>","filename":"<actual PDF filename>"},
  "resumeId":"<selected base UUID>",
  "formUrl":"<current form URL without secrets>",
  "review": {
    "reviewedAt":"<actual current ISO timestamp>",
    "summary":"<specific review of actual fields, original-source facts and exact PDF>",
    "checks":{"job":true,"fields":true,"resume":true,"factualClaims":true},
    "issues":[]
  }
}
```

Include `resumeVariantId` only if that variant's PDF was uploaded. If replacing a still-prepared checkpoint, include its exact `expectedCheckpointId`. Do not fabricate check results, save a future timestamp or discard unresolved issues to satisfy validation.

For a generated canonical resume, add `resume.artifact` with the actual saved
`{revision,resumeId,variantId?}`. Keep the archive's `sha256`, `jobId` and `filename` alongside it.
The checkpoint checks ownership, selected IDs and that the archived bytes match that revision's
`pdfSha256`. Download/stage the immutable revision URL; never regenerate between review and upload.
Omit `artifact` for an explicitly selected unchanged original PDF, which is preserved by its own
archive hash. The application history retains the checkpoint's reference and exact uploaded bytes.

```bash
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-checkpoint --data @"<review-file>"
```

3. Read back `attempt.checkpoint` and its `checkpointId`. Compare the persisted nonsecret fields, resume hash/IDs and review with what is actually present on the employer form. The retained PDF is available at `GET /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-checkpoints/<checkpointId>/pdf`. A mismatch, failed checkpoint save or changed form requires correction and a fresh review/checkpoint before advancing.
4. Immediately before the single actual Submit, reserve the checkpoint:

```bash
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-begin --data '{"checkpointId":"<reviewed-checkpoint-id>"}'
```

Only this call's successful `began:true` response for the expected checkpoint allows the worker to perform its one Submit. `began:false`, an HTTP error, lost response or mismatched attempt goes to recovery; never infer success or retry the click. Do not perform the click once in the review checklist and a second time in the worker flow.

## Receipt and result after the single Submit

Read the real employer outcome. Missing confirmation leaves the attempt `unknown`: retain the page and report it, with no applied record and no blind resubmit. For a visible employer receipt, capture its exact text, URL, actual observation time and reference when present; exclude secrets. Then:

```bash
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/submission-receipt --data @"<receipt-file>"
openapply-api POST /api/campaigns/$CAMPAIGN_ID/jobs/$JOB_KEY/result --data '{"outcome":"applied","checkpointId":"<reviewed-checkpoint-id>"}'
```

The receipt file has exactly `{checkpointId,confirmation:{url,text,observedAt,reference?}}`. `openapply-api` validates its bounded shape, removes URL credentials/fragment/sensitive query parameters, and atomically retains the exact normalized POST bytes before sending them under `~/.openapply/submission-recovery/<API-base-hash>/<campaign-id>/<job-key-hash>/<checkpoint-id>.json`. It prints the recovery path on stderr, never the receipt contents. Replaying identical bytes is allowed; a conflicting receipt cannot replace the retained one. Local retention failure prevents the HTTP request. Preserve the visible receipt and report that specific failure instead of inventing a recovery path.

The API builds the applied record from the saved checkpoint and receipt. Do not send caller-created `appliedAt`, `submission`, resume IDs or score fields on `/result`. If receipt or result persistence fails after employer confirmation, return `recording_pending` with actual `checkpointId`, specific `context` and `recoveryFile` when a retained file exists. Retry only storage. Return `recorded` only after the saved attempt identifies the actual recorded Application. Leave unresolved tabs open. The orchestrator validates the unchanged handback through `/worker-result-check` before processing it; `recording_pending` is never counted as applied.
