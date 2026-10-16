---
name: resume-campaign
description: Resume a paused OpenApply campaign by id. Re-flips the campaign to in_progress and replays the apply loop on any remaining approved jobs without re-asking for fit confirmation.
argument-hint: "<campaign-id>"
---

# Resume Campaign - Continue a Paused Campaign

Follow `../_shared/queue-workspace.md`. Resolve the intended owned campaign, then
POST `/api/work-queue/campaign/<id>` with a stable request UUID, `action:"resume"`
and the current provider. Return the Queue link; do not run the legacy apply loop
below or reset submission attempts. The API owns safe resumption and lease recovery.

Start with `openapply-api GET /api/health`. Stop clearly if the API is unavailable.

Resumes a `paused` Campaign by replaying the apply loop on jobs that
are still `approved` (or `pending` if approval was implicit). The user already
approved the fit when the campaign was first launched, so no re-confirmation gate.

Live view: `$OPENAPPLY_WEB/campaigns/<campaign-id>`.

## Setup

Follow `../_shared/setup.md` to load profile, resume, credentials - its health check
aborts with the standard message if the backend is unreachable.

## Phase 0: Resolve Campaign

Argument is `<campaign-id>`. If missing, list candidates and ask:

```bash
openapply-api GET /api/campaigns --query status=paused
```

Show each of `.items` as `campaignId`, `status`, `source`, `query`.

Fetch the campaign + jobs:

```bash
CAMPAIGN_ID="<campaign-id>"
openapply-api GET "/api/campaigns/$CAMPAIGN_ID"
openapply-api GET "/api/campaigns/$CAMPAIGN_ID/jobs" --query page=1 --query limit=100
```

**Saved profile list:** before the legacy checks below, inspect `config.discovery`. When present,
an explicit resume continues that same list even if collection has not saved its first job.
For `paused`, POST `/status {status:"in_progress",actor:"agent"}`; for `in_progress`, continue
without toggling status. A completed/failed list stays closed. Preserve discovery phase, selected
resume, limits and preview/apply intent. Follow `../_shared/profile-discovery.md` with that saved
intent and then return. Preview lists only collect/score. Never treat their pending rows as
implicitly approved, skip leftovers at a cap, or enter the legacy completion loop below.

Verify status is `paused`. If `completed` or `failed`, stop:
**"Campaign <id> is already <status>. Nothing to resume."** If `in_progress`, stop:
**"Campaign <id> is still in progress. Stop the campaign from the UI first."**

Refuse to resume if no job in `.items` is `approved`, `pending`, or `applying`: say **"No
resumable jobs (approved/pending/applying). If none were ever added, start fresh with the
auto-apply skill."** and stop.

## Phase 1: Re-open the Campaign

Command status back to `in_progress`:

```bash
openapply-api POST "/api/campaigns/$CAMPAIGN_ID/status" --data '{"status":"in_progress","actor":"agent"}'
```

Keep the campaign's `config.maxApplications` as `MAX_APPS` (absent means no limit) for the stop
condition below.

## Phase 2: Replay Apply Loop

For each job where `status === "approved"`, `"pending"`, or `"applying"`, score-descending - the **same per-job flow as the apply skill's Apply Loop**, delegated to the `job-worker` subagent one at a time:

1. **Inspect the attempt before fit/promotion** - GET each job's `/submission-attempt` and follow `../_shared/submission-recovery.md`. Recover persisted/local real receipts through storage only. A begun, unknown or legacy outcome cannot restart the form; preserve it and park the exact unresolved issue. Only an absent or unstarted prepared attempt may continue fit checks. For pending jobs without a current assessment, delegate score mode with `save:"patch"` per `../_shared/original-fit.md`. Approve only a qualifying row, then PATCH to applying; preserve already-applying status.
2. **Apply** - delegate to `job-worker` with the apply-mode input from
   `../_shared/campaign-flow.md`, `digest` omitted (the worker fetches it from the saved Job)
   and `minMatchScore` from the campaign or profile. Review follows uncertainty, not the cap.

3. **Validate handback** - POST unchanged worker JSON to `/worker-result-check` per `../_shared/campaign-flow.md`. Verify recorded application IDs, recover recording-pending storage only, and write only validated pre-submit failed/skipped outcomes. Route a named needs_user answer back to the worker, which must inspect the attempt again first.
4. **Limit** - if `MAX_APPS` set and `summary.applied >= MAX_APPS`, POST `/result` `outcome:"skipped"`, `skipReason:"Max applications limit reached"` for each remaining `approved` job and end the loop.

### Between jobs: honor user Stop

Re-fetch the campaign between jobs and exit cleanly if the user stopped it:

```bash
openapply-api GET "/api/campaigns/$CAMPAIGN_ID"
```

If `.status` is `paused`, POST `/result` `outcome:"skipped"`, `skipReason:"Campaign paused by
user"` for each remaining `approved` job, then stop.

## Phase 3: Summary

Skip the completion command for `config.standing:true`. Leave that campaign open for future selections.

```bash
openapply-api POST "/api/campaigns/$CAMPAIGN_ID/status" --data '{"status":"completed"}'
```

Print a summary table and the campaign link `$OPENAPPLY_WEB/campaigns/<CAMPAIGN_ID>`.
Suggest re-running the `auto-apply` skill in `retry-failed <CAMPAIGN_ID>` mode if any jobs failed.

## Rules

The shared campaign rules (`../_shared/campaign-flow.md`) apply throughout. On top of them:

1. **No new confirmation gate.** The user already approved the fit when the campaign was first launched.
2. **`source` is automatic.** `/result` records the campaign's original `source` (`apply` or `auto_apply`) on the Application; don't pass one.
3. **Idempotent.** Resuming the same campaign a second time should be a no-op when no `approved` jobs remain.
