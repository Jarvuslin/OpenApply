---
name: auto-apply
description: Discover jobs from the profile and original resume, save and score the complete candidate list, then apply to suitable saved rows within the authorized limit.
argument-hint: "[query] [--campaign <id>] [--board <domain>] [--min-score N] [--max-apps N] [--max-jobs N] | resume | retry-failed <id>"
---

# Find jobs, then apply from the saved list

Follow `../_shared/queue-workspace.md` before dispatch. Resolve the saved authorized
campaign and enqueue its typed start/resume/retry_failed task. Return the Queue link.
Do not execute a browser/application loop from this manual entry point.
The leased preparation task may follow the collection/scoring procedures below;
its apply stage enqueues eligible exact job IDs instead of invoking apply workers.

Start with `openapply-api GET /api/health`. Stop clearly if the API is unavailable.
Read `../_shared/setup.md`, `../_shared/blocked-sites.md`, `../_shared/profile-discovery.md`
and `../_shared/campaign-flow.md`. Use OpenApply's agent and headed browser throughout.
Launching an apply campaign authorizes its bounded application work; final AI review does not
require routine per-job user approval. Actual runtime restrictions still apply.

## Resolve the request

- `resume`: resolve the named existing campaign, or the unambiguous active campaign. Inspect
  saved attempts first per submission-recovery; never restart a begun or unknown submission.
- `retry-failed <id>`: inspect every affected submission-attempt. Only a genuinely pre-submit
  retryable failure may use `/retry`. Receipt/result persistence is storage-only recovery.
- `--campaign <id>`: use that exact saved list and selected original resume. Do not create a
  replacement campaign or silently switch to the primary resume.
- Without a campaign: follow profile-discovery to create a list with intent `apply`. Use saved
  preferences and minimum; explicit limits override defaults. No board flag is required.

When a legacy UI creates an empty campaign without `config.discovery`, initialize it through
POST `/api/job-sources/profile-list/<id>/initialize {intent:"apply"}`. This preserves its query,
selected resume and existing limits and supplies missing defaults. Generic config PATCH cannot
add or change discovery state. The initialize endpoint refuses a nonempty legacy campaign;
inspect/recover its saved attempts and use `resume-campaign` instead of repurposing it. In
particular, never retrofit a running application test or abandon its saved receipt state.

For an explicit `--board`, keep that configured source in `config.board` and include it in the
collection plan. Missing configuration is a reported source limitation; available permitted
employer sources may still serve the same requested role/location. Never bypass blocked-site
rules. For inline `--min-score`, save the changed minimum with optimistic concurrency before
requesting context; preserve all other config fields. A changed minimum never changes a score.

## Run the staged workflow

Follow `../_shared/profile-discovery.md` end to end:

1. Collect/deduplicate into the private saved campaign, preserving full JDs and source coverage.
2. Score every resolvable candidate against the selected original resume in batches of at most
   five, saving evidence/gaps and separate preference/eligibility checks. Park unresolved rows.
3. Complete discovery through its dedicated endpoint; never bypass a rejected stage gate.
4. Enqueue eligible exact saved job IDs in rank order. The common companion queue owns bounded concurrent workers and isolated browsers. Honor server reservations, account/company caps and domain pacing; never spawn an application loop here.
5. Keep minor factual rewrites, exact uploaded PDFs, final field answers and genuine receipts.
   Validate worker handbacks and reconcile application history with analytics.

Do not interleave a new scrape with every application. A candidate limit is coverage scope,
not a claim that all jobs on the internet were found. Report sources/pages and the actual
stopping reason. A low score that meets the user's minimum is a possible stretch, not a
reason to impose a higher private threshold.

## Finish or resume

Count only verified recorded applications. Report skipped, blocked, unscored and unused rows
separately. At the saved application limit, leave the remaining list available for a later
explicit batch. Do not refill the list or raise its cap automatically. Preserve paused and
uncertain attempts. Mark completed only when no pending/parked work remains; otherwise leave
the saved campaign resumable and explain its remaining state.

Link `$OPENAPPLY_WEB/campaigns/<id>` and the saved application records. Never claim success
from a Submit click, a generated resume or an application status without employer confirmation.
