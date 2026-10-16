---
name: pilot
description: Explain, check or run a Pilot, a saved rule-based job search that finds matching jobs and can add them to the queue.
argument-hint: "(optional pilot name)"
---

# Pilots

Start with `openapply-api GET /api/health`. Stop clearly if the API is unavailable.

A pilot is a saved set of rules (roles, level, location, work mode, minimum fit against the
original resume, posted-within windows) with an optional schedule and a max jobs per run. Each
run lists matching jobs for review; a scheduled run adds them to the queue when the pilot is set
to "Add to my queue". The user creates and edits pilots on the Pilots page
(`$OPENAPPLY_WEB/pilots`).

- Status: `openapply-api GET /api/pilots`, then `GET /api/pilots/<id>` and
  `GET /api/pilots/<id>/results` for the one the user named.
- Run once, only on the user's explicit request: `POST /api/pilots/<id>/run`, then report that
  results appear on the pilot's review list. Stop a running pilot with `POST /api/pilots/<id>/stop`.

A pilot finds and lists jobs; the queue applies. Queued jobs run under the queue's own limits,
and progress, Pause/Stop and results live on the Queue page. Application work follows
`../_shared/queue-workspace.md` for exactly one owned job.
