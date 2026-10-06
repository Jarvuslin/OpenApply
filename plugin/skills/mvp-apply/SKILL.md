---
name: mvp-apply
description: Drain the standing campaign's approved jobs one worker at a time, parking questions and verification without stopping the queue.
argument-hint: "<campaign-id>"
---

# Apply selected jobs

Start with `jobpilot-api GET /api/health`. Stop clearly if the API is unavailable.
Read `../_shared/setup.md`, `../_shared/blocked-sites.md` and `../_shared/campaign-flow.md`.
The user has approved these selected jobs. Do not add a count cap or request routine confirmation again.

1. Fetch `GET /api/campaigns/<id>`. Stop if it is not an in-progress apply campaign. Load its resume and minimum score.
2. Fetch approved jobs with `GET /api/campaigns/<id>/jobs --query status=approved --query limit=100`. Always reread page 1 after processing a batch, since removing approved rows shifts later pages.
3. For each row, recheck campaign status and stop if paused. Dedupe as described in campaign-flow. PATCH that job to applying. A 409 means inspect its current state and move on, never submit twice.
4. Delegate exactly one job-worker in apply mode with campaignId, jobKey, canonical URL, resumeId and minMatchScore. Wait for its compact result before the next job. Never reuse another job's browser or reasoning context.
5. Record applied, failed or skipped through the result endpoint. On needs_user, save a Pilot question with the job subject, issues and document links, PATCH needs_user, leave the tab open and continue. Resume that job only after a relevant answer arrives. Record signup, verification and submission outcomes separately when the worker reports them.
6. Repeat until no approved rows remain. Leave the standing campaign in progress. Report counts and link to its campaign page. Never mark an application submitted without visible employer confirmation.

Use the configured Playwright MCP and persistent VM browser. Before uploading a local resume, run `openapply-stage "<local-resume-path>"` and use its returned guest path. Do not translate drive letters or guess Mac paths. API and document work run on the host.

Use `../_shared/auth.md` for signup and `../_shared/mailbox.md` for email. Missing mailbox access parks the job. A blocking CAPTCHA follows the entitlement check in campaign-flow. Solving disabled or unsuccessful means needs_user with category verification, never a silent skip.
