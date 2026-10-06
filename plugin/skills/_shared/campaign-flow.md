# Campaign Flow - Shared Mechanics and Rules

The blocks every campaign skill shares (`apply`, `auto-apply`, `resume-campaign`, `search`,
and the pilot's campaign items). Load profile, resume, and
credentials per `./setup.md` first; each skill states only its deltas from what's here.

## Applied-check (dedupe before opening a tab)

```bash
jobpilot-api GET /api/applied/check --query "url=<job-url>" --query "title=<title>" --query "company=<company>"
```

Exact URL match plus fuzzy title+company over a 30-day window; `.match.kind` is `url` or
`fuzzy` (with a score). Default handling for apply flows on `.applied`: create the Job as
`pending`, POST its `/result` with `{outcome:"skipped", skipReason:"Already applied (<kind>)"}`,
and move on without opening a tab.

The server enforces the same rule: moving a job into `applying` - the `PATCH` below or the
pilot's claim - 409s on a duplicate with a message opening `Already applied (<kind>)`. That is the
verdict, not a transient failure, and the server has already written the job's `skipped` result.
Move to the next item; never retry the transition or re-write the result.

## Terminal result writes

Non-terminal transitions go through `PATCH /api/campaigns/$CID/jobs/<key>`
(`pending` → `approved` → `applying`). A terminal outcome goes through ONE call -
`POST /api/campaigns/$CID/jobs/<key>/result` - which atomically updates the Job and creates the
Application + initial event on `applied`. Payload shapes (`appliedAt` is the current UTC time, ISO 8601):

```jsonc
// applied - resumeId/resumeVariantId name the resume that was uploaded (see below); omit either when empty
{ "outcome": "applied", "appliedAt": "<now>", "matchScore": <0-100>, "resumeId": "<resumeId>", "resumeVariantId": "<resumeVariantId>" }
// failed (login failure, unexpected page, validation, crash)
{ "outcome": "failed", "failReason": "<failReason>", "retryNotes": "<retryNotes>" }
// skipped (user cancelled, cap reached, ...)
{ "outcome": "skipped", "skipReason": "<skipReason>" }
```

**Always send `resumeId` on `applied`**, and `resumeVariantId` too whenever a tailored variant was
uploaded - including when `tailor-resume` reused an existing one. This is the only record of what the
candidate actually submitted; without it the application's Documents card has nothing to show.

## job-worker apply-mode input

```json
{ "mode": "apply", "campaignId": "<CID>", "jobKey": "<key>", "url": "<job-url>",
  "board": "<domain>", "digest": <DIGEST>, "resumeId": "<RESUME_ID>",
  "defaultStartDate": "<autoApply.defaultStartDate>", "salaryExpectation": <remembered-or-null>,
  "preSubmitReview": <bool> }
```

Omit `digest` and the worker fetches it from the saved Job. The worker returns one of
`applied` / `failed` / `skipped` / `needs_user` and closes its own completed-job tabs before returning -
re-select tab 0, then map the outcome to a terminal write (above). `needs_user` routing:

- `category:"salary"` (no profile salary preference matched) - ask the user once, remember the
  answer for the campaign, re-delegate with `salaryExpectation` set.
- `category:"verification"` (2FA, failed login, or blocking CAPTCHA): save a question, PATCH the job to `needs_user`, leave its tab open, park this job and continue with the next approved job.
- `category:"payment"` - never pay: POST `/result` `{outcome:"failed", failReason:"Payment required"}`.

## Rules

1. **Never skip silently.** Every `skipped` write carries a non-empty `skipReason`. No valid
   reason → not a skip.
2. **The Campaign is the audit trail.** PATCH non-terminal transitions; POST `/result` for
   terminal outcomes, so SSE reflects reality.
3. **Never process payments** - record `failed` with `"Payment required"`.
4. On a blocking CAPTCHA, call `jobpilot-api GET /api/captcha/status`. Invoke `solve-captcha` only when `entitled:true`. Otherwise, or if solving fails, return `needs_user` with `category:"verification"`, leave that tab open, and let the orchestrator park this job and continue to the next. Never silently skip a challenge, change browser identity, or use proxies to evade it. Logins and registration follow `./auth.md`.
5. **Eligibility** follows `./eligibility.md`.
6. **Pace** 3-5s between submissions on the same domain.
7. **Be honest about match scores** - label stretches as stretches.
8. **One worker at a time** - the browser is shared; never delegate the next job until the
   current worker returns.
