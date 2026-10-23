---
name: apply
description: Resolve a requested job or saved campaign and enqueue its authorized work through the common queue.
argument-hint: "[job_url_or_pasted_job_page | campaign <id>] (omit to resolve saved pasted links)"
---

# Queue an application request

Start with `openapply-api GET /api/health` and read
`../_shared/queue-workspace.md`. This entry point admits saved work. The companion
owns claims, browser allocation and execution. Do not launch a worker, score,
tailor, fill or submit from this entry point. A leased application follows
queue-workspace directly for exactly its saved job, including truthful answers,
original-source review, checkpoint, receipt and submission-recovery requirements.

## Resolve the requested scope

- `campaign <id>`: fetch `GET /api/campaigns/<id>` and its saved jobs.
- URL or pasted posting: use the supplied URL or visible Apply link. If no link
  exists, request it. Reuse the matching owned job/campaign when one exists.
- No argument: inspect saved in-progress apply campaigns with queued links.
  Continue only when the intended campaign is unambiguous. Otherwise request
  the missing selection. If none exists, link `/campaigns/new`.

Preserve the campaign's selected original resume, minimum fit score, limits,
review/application intent and provider. Never clear a limit or broaden the job
set because a campaign has no queued rows. Existing application authorization
continues for its stated scope; review alone does not authorize applying.
Missing applicant facts must be resolved from evidence or the user.

For a new single-job request, load relevant configuration through
`../_shared/setup.md`, then generate and retain a `clientCampaignId` UUID before
creating the saved campaign:

```bash
openapply-api POST /api/campaigns --data '{"clientCampaignId":"<retained UUID>","query":"Review <job URL>","source":"apply","config":{"maxApplications":1,"resumeId":"<selected original resume id>","minScore":<minimum>},"urls":["<job-url>"]}'
```

Keep the returned campaign ID and load its seeded job identifiers. Do not create
another job, invent a score, or treat a hostname placeholder as the full posting.
If the creation response is uncertain, reuse the exact body and `clientCampaignId`;
this identifier is separate from the later queue admission idempotency key.
Use the typed campaign preparation action for incomplete posting/scoring work.

## Admit work once

For already eligible owned jobs covered by the saved application intent, POST
`/api/work-queue/enqueue` with `idempotencyKey`, exact `jobIds` (at most 100),
the inherited provider and the appropriate source. The API owns duplicate,
eligibility, cap and current-state checks; conflicts are not permission to bypass
them. Never promote an unscored or unresolved job merely to get it into the queue.

For a campaign action, POST `/api/work-queue/campaign/<id>` with
`{idempotencyKey,action,provider,jobIds}`. For a URL or selected subset, include the
exact resolved job IDs even when reusing a larger campaign. Omit `jobIds` only for
an explicitly authorized whole-campaign action. Use `start` or `resume` as appropriate.
`rescan` and `retry_failed` require that explicit requested scope; genuine
pre-submit failures differ from unknown submissions and retained receipts.
Resume can also resume saved application work in that scope, so it requires the
corresponding application authorization. Review-only work must never resume
application items. These actions use the common queue, not a second execution loop.

Use one fresh request UUID per intended admission and retain it. After an
uncertain response, inspect saved state and reuse that UUID rather than creating
another request to evade deduplication. Follow `../_shared/submission-recovery.md`
for begun/unknown attempts or receipts: recovery may finish recording, but must
never repeat Submit. UI, transport and staging failures do not justify rescoring,
retailoring or another application attempt.

## Report saved state

Stop after admission and link `/queue` and the saved campaign. Distinguish queued,
running, blocked and recorded outcomes. Missing budgets, an offline companion or
an unsupported preparation executor leave work pending; report the actual blocker
without invoking an independent fallback. Current preparation dispatch has an
unresolved isolation gate that user approval alone cannot clear.

Only the canonical Application and its durable receipt establish a recorded
submission. A completed model turn, queue admission or rendered UI is not that
proof. Do not mark the entire campaign complete from this entry point.
