# 1. Retire the old local Pilot loop

Date: 2026-10-14. Status: accepted.

## Context

The old Pilot ran as a 30-second loop in the terminal host (`apps/terminal/Pilot/`). It refreshed an
agenda in the API (`apps/api/src/modules/pilot/agenda/`) and turned agenda items into queue work
through `POST /api/work-queue/schedule`. Its web screens were deleted in the 2026-10-13 debloat.
After that, only `POST /api/pilot/start` and the host's `/pilot/start` could turn it on, and nothing
in the product calls either. Rule-based Pilots (`/pilots`, `apps/api/src/modules/pilots`) replace it.

## Decision

The old loop is retired. Migration `20261022000000_stop_old_pilot` sets `pilot_states.running` to
false for everyone; the host loop stops itself when the API reports it is not running.

The loop, its agenda and its routes are deleted as bloat review item 45, once that item is approved.
Pilot questions, checkpoint approvals, the journal and the `/pilot/events` stream are used by other
features and stay.

## Consequences

- Chores that only ran inside the agenda refresh no longer run for anyone: question expiry,
  promoting scored pending jobs, closing idle campaigns, stale mail sync and inbox classification.
  Any of these that are still wanted need their own scheduled job.
- Do not add a way to start the old loop again. New recurring job finding goes into Pilots.
