# 2. Drop the old Pilot push notifications

Date: 2026-10-14. Status: accepted.

## Context

Two push notifications linked to `/pilot`, a page deleted in the 2026-10-13 debloat:

- the morning digest, sent from the old agenda refresh (`pilot/agenda/digest.ts`);
- "Pilot alert", sent when the terminal's Pilot loop journals a failure (`pilot/journal.service.ts`).

Both come only from the old loop, which ADR 1 retires.

## Decision

Remove both pushes. They get no replacement link. Journal entries are still written.

## Consequences

- No push notification links to `/pilot`.
- A daily summary, if wanted later, is a new feature with its own timed job, linking to `/queue`.
