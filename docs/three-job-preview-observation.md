# Three-job preview observation — October 7, 2026

## Authorized scope

The user selected **preview three jobs and rewrites only**. No employer submissions, account creation, form filling, uploads to employers or mailbox access were authorized for this short run. OpenApply's Claude agent was to perform extraction, discovery, original-source scoring and minor rewrite previews. The outer assistant was to observe after one initial brief and not rescue the workflow.

Source file: `C:/Users/7474g/Downloads/Software_Engineer_Resume.pdf`, 98,589 bytes; SHA-256 `24409d82222865e760a51f946da935d4a56c34bab870756260dea2b81a436abf`.

## Observed result

**Blocked during dispatch: 0 of 3 previews completed.** No scored candidate, JD-specific rewrite or generated PDF was observed. No application work was observed and the companion remained idle.

- Created OpenApply conversation **Three-job resume preview · Oct 7**, ID `299dae08-bedf-4715-b095-543e44cc06e2`.
- Chat creation spent a noticeable interval on “Creating…” but eventually completed without a repeated create action.
- Sent one preview-only briefing through the normal composer. The app later displayed **“signal timed out”** and **“This message may already be saved. Retry checks the same request.”**
- The companion reported `connected: true`, `running: false`, `runId: null`, `blockingReason: null`, `lastError: null`. No Claude progress appeared.
- A read-only page refresh was used to inspect persistence without resending. The conversation reload failed with **“Could not load this conversation.”**, so whether the timed-out message was persisted could not be confirmed from the UI. Do not describe it as definitely unsaved or automatically resend it with a new request identity.
- An independent Profile page displayed **“Could not load your profile.”** during UI verification. The available evidence does not establish the cause of these browser/API delays; a successful unauthenticated health check alone does not prove authenticated requests are healthy.
- The VM Chromium process was headed, using X11 and `/home/pilot/browser`, without a headless flag. Its noVNC viewer was opened from the chat. No outer-assistant browser action on an employer was performed.

The outer assistant did not press message Retry, restart services, change runtime configuration, send a corrective agent prompt, perform application work, or patch the app during this observation. Account credentials were not added to the agent chat or used. Gmail OAuth remained on hold.

Screenshot of the failed conversation reload: `.temp/three-job-preview-load-failure.jpg`. The separate `.temp/three-job-preview-send-timeout.jpg` capture shows the live VM drawer covering the chat; its Affirm receipt is the preserved previous trial, not evidence from this preview.

## Separate Profile feature

Before dispatch, Profile gained **Import from resume**: choose a saved resume or upload a source, preview blank contact/location fields, then Apply to draft and Save settings. Existing data and eligibility/preferences are protected. Saving rereads the current primary resume to avoid clearing or overwriting it from an old form draft. Unit tests, web typecheck and knip passed; the Profile loading failure prevented completing a live import UI check. No profile values were imported or saved by the observer.

The five-application plan and pass criteria are in `application-trial-plan.md`. This startup failure is not three successful tests and provides no evidence about discovery quality, scoring quality or rewrite quality. Those stages remain unexercised.
