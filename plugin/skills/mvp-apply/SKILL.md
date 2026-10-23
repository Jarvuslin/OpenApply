---
name: mvp-apply
description: Enqueue the selected approved application jobs in the common queue.
argument-hint: "<campaign-id> [--job <key>]... [--original-resume]"
---

# Queue selected applications

Start with `openapply-api GET /api/health`. Stop clearly if the API is unavailable.
Read `../_shared/queue-workspace.md`, `../_shared/setup.md` and `../_shared/submission-recovery.md`.

Fetch the owned campaign and resolve only the user's selected saved job keys to owned job IDs.
Preserve explicit original-document selection in campaign policy before admission. Enqueue
those exact IDs through `POST /api/work-queue/enqueue` with a stable request UUID. Report the
Queue link and admission result. A rejected or uncertain admission is inspected with the
same request identity, never replaced with a broader selection.

Do not launch job workers, drain a campaign, claim Pilot work, open a browser or submit from
this skill. The companion owns concurrent application workers, finite model allocations,
per-job browser processes and API leases. An application item executes exactly one job.

Never restart a begun, unknown or legacy ambiguous submission. Recover actual receipt/result
storage only. Missing facts remain named questions; a later answer does not authorize replay.
The queue applies account/company caps and domain pacing. Do not raise caps or enqueue a new
batch automatically when the current one ends.
