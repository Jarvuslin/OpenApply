# Campaign Flow - Shared Mechanics and Rules

The blocks every campaign skill shares (`apply`, `auto-apply`, `resume-campaign`, `search`,
and the pilot's campaign items). Load profile, resume, and
credentials per `./setup.md` first; each skill states only its deltas from what's here.

Dispatch boundary: follow `queue-workspace.md`. Only a leased application WorkItem may
invoke an apply-mode worker, exactly once for its owned job. Campaign preparation
and Pilot tasks enqueue work and never execute the application loops described by older
skills. The companion owns all queue claims and heartbeats; Pilot claims are retired.

## Applied-check (dedupe before opening a tab)

```bash
openapply-api GET /api/applied/check --query "url=<job-url>" --query "title=<title>" --query "company=<company>"
```

Exact URL match plus fuzzy title+company over a 30-day window; `.match.kind` is `url` or
`fuzzy` (with a score). Default handling for apply flows on `.applied`: create the Job as
`pending`, POST its `/result` with `{outcome:"skipped", skipReason:"Already applied (<kind>)"}`,
and move on without opening a tab.

The server enforces the same rule: moving a job into `applying` - the `PATCH` below or the
pilot's claim - 409s on a duplicate with a message opening `Already applied (<kind>)`. That is the
verdict, not a transient failure, and the server has already written the job's `skipped` result.
Move to the next item; never retry the transition or re-write the result.

## Durable results and strict worker handback

Before re-entering an existing application, read `./submission-recovery.md` and GET `/api/campaigns/$CID/jobs/$KEY/submission-attempt`. Recovery takes precedence over dedupe, retry, scoring, status changes and employer form actions. A prior begin or unknown legacy outcome never becomes a fresh attempt because a worker, question or campaign restarted.

The apply worker saves and reads back the reviewed checkpoint, reserves it through `/submission-begin`, performs its one Submit only after `began:true`, retains the actual receipt with `/submission-receipt`, and records with:

```json
{ "outcome":"applied", "checkpointId":"<saved reviewed checkpoint UUID>" }
```

This `/result` body is built from durable server evidence. No caller `appliedAt`, raw `submission`, resume IDs or score fields are accepted for new recording. A failed storage response after employer confirmation is recovery work, never a new application.

For every apply-mode worker return, save its exact JSON to a job-prefixed scratch file and validate it before taking any outcome action:

```bash
openapply-api POST /api/campaigns/$CID/jobs/$KEY/worker-result-check --data @"<worker-handback-file>"
```

The endpoint uses the strict shared `submissionWorkerResultSchema`; never strip unknown keys, invent missing evidence or translate an old `applied` blob into success. An invalid/malformed handback or validation HTTP failure is an integration issue: GET the existing attempt, preserve state and recover from actual evidence. Never relaunch a fresh form as a fallback.

| Validated handback | Orchestrator action |
| --- | --- |
| `recorded` with `applicationId`, `checkpointId` | Validation must confirm persisted `state:"recorded"` and matching IDs. Read the saved Application/dashboard state and count that actual record once. No additional applied result write or browser action. |
| `recording_pending` with `checkpointId`, `context`, optional `recoveryFile` | Employer confirmation was observed but recording is incomplete. Inspect the persisted attempt and replay only its actual retained receipt/result per recovery guidance. Do not count applied, mark failed/skipped, retry the employer form or pretend storage succeeded. |
| `failed` with `failReason`, optional `retryNotes` | Only before a begun/unknown attempt: POST `/result` with those exact outcome fields. |
| `skipped` with `skipReason` | Only before a begun/unknown attempt: POST `/result` with the actual reason. |
| `needs_user` with category/kind/question and optional context/options | Park the named blocker as below, preserving any reserved attempt and page. An answer does not reset submission state. |

The optional `observations` array contains bounded site facts only and is not part of `/result`. Never add `attemptId` or other undeclared handback fields. For `recording_pending`, `recoveryFile` must be a real path printed by the helper; omit it when retention itself failed. A server `unknown` state with a locally retained real receipt can be recording-pending work, but it is never a recorded success.

Pre-submit terminal examples:

```jsonc
{ "outcome":"failed", "failReason":"<actual pre-submit failure>", "retryNotes":"<optional retry context>" }
{ "outcome":"skipped", "skipReason":"<actual pre-submit reason>" }
```

Non-terminal transitions still use PATCH (`pending` → `approved` → `applying`). If guards reject a transition because submission may have started, inspect the attempt and recover; never clear the guard or force a failed/skipped state.
## job-worker apply-mode input

```json
{ "mode": "apply", "campaignId": "<CID>", "jobKey": "<key>", "url": "<job-url>",
  "board": "<domain>", "digest": <DIGEST>, "resumeId": "<RESUME_ID>",
  "defaultStartDate": "<explicitly confirmed availability, otherwise omit>", "salaryExpectation": <confirmed-or-null>,
  "minMatchScore": <campaign-minimum-or-null>, "answers": <explicit-user-answers-or-null> }
```

Omit `digest` and the worker fetches it from the saved Job. Apply mode returns `recorded` / `recording_pending` / `failed` / `skipped` / `needs_user`; validate every return as above. Only completed tabs close; preserve uncertain and parked tabs. `needs_user` routing:

Pass availability only when it is explicitly confirmed, never from a legacy seed. Preserve any observed job discovery source as context, without claiming that it establishes the user's first awareness of the employer. Every application uses `application-review.md`: the worker reviews exact answers and the actual staged PDF, then submits under existing authorization. Do not request another final click or approval for an authorized job/batch/trial.

- `category:"salary"` or `category:"review"`: save a Pilot question naming the missing fact, unresolved preference or actual integration/runtime blocker with relevant field/document context. Use kind question/choice for facts; approval only for a real runtime approval or explicit user decision. PATCH the job to needs_user, preserve its tab and continue. An answer resolves only the named issue; existing application authorization persists.
- `category:"verification"` (2FA, failed login, or blocking CAPTCHA): save a question, PATCH the job to `needs_user`, leave its tab open, park this job and continue with the next approved job.
- `category:"payment"` - never pay: POST `/result` `{outcome:"failed", failReason:"Payment required"}`.

Fit follows `original-fit.md`; score and reason are server-owned and must not be sent in terminal results. A near-threshold score, gaps or `needs_review` assessment requires agent inspection, not routine user approval. Ask only for unresolved applicant facts or user preference decisions. Never derive review from `maxApplications`.

A standing campaign remains `in_progress` when its approved queue is empty. Do not complete it automatically.

## Rules

1. **Never skip silently.** Every `skipped` write carries a non-empty `skipReason`. No valid
   reason → not a skip.
2. **The Campaign is the audit trail.** PATCH non-terminal transitions; POST `/result` for
   terminal outcomes, so SSE reflects reality.
3. **Never process payments** - record `failed` with `"Payment required"`.
4. On a blocking CAPTCHA, call `openapply-api GET /api/captcha/status`. Invoke `solve-captcha` only when `entitled:true`. Otherwise, or if solving fails, return `needs_user` with `category:"verification"`, leave that tab open, and let the orchestrator park this job and continue to the next. Never silently skip a challenge, change browser identity, or use proxies to evade it. Logins and registration follow `./auth.md`.
5. **Eligibility** follows `./eligibility.md`.
6. **Pace** 3-5s between submissions on the same domain.
7. **Be honest about match scores** - label stretches as stretches.
8. **One worker at a time** - the browser is shared; never delegate the next job until the
   current worker returns.
