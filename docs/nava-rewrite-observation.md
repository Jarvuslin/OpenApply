# Nava Benefits rewrite-only test — October 7, 2026

This report records the earlier blocked attempt. The later completed short-prompt run and its follow-up are recorded in [nava-short-prompt-preview-2026-10-07.md](nava-short-prompt-preview-2026-10-07.md).

Requested job: https://jobs.ashbyhq.com/nava-benefits/d1ef174d-42dd-4910-9b46-05cdee223db0?source=LinkedIn+Paid

Requested source: `C:/Users/7474g/Downloads/Software_Engineer_Resume.pdf`, 98,589 bytes, SHA-256 `24409d82222865e760a51f946da935d4a56c34bab870756260dea2b81a436abf`.

Scope: OpenApply's own Claude agent produces a proposed tailored PDF for this one job. No application, employer upload, signup, mailbox access or submission. The outer assistant starts the normal app controls and observes; it does not write the resume or repair the app during the test.

## Result

**Blocked before agent dispatch. No rewritten PDF was produced or observed.** This is not a rewrite-quality failure or a completed application.

- Clicked Create chat once for `Nava Benefits · resume PDF test`, using Assistant / Claude Code. The dialog remained on `Creating…`; no rewrite brief was sent.
- A read-only database check found no matching Nava thread for the trial user. The previous three-job thread (`299dae08-bedf-4715-b095-543e44cc06e2`) existed with zero messages and zero runs, confirming its earlier timed-out brief did not persist.
- Reloaded the stalled chat page without resending or recreating anything. The account and connected companion appeared, but the chat list did not load and the conversation displayed `Could not load this conversation.`
- API health returned 200 and PostgreSQL showed no lock waits. The companion was connected and idle. These checks do not establish the cause of the authenticated browser request failures.
- The New chat request has no explicit deadline in `apps/web/src/components/features/chat/new-chat-dialog.tsx`; its busy state also disables Cancel. This explains the indefinite modal behavior if its request stalls, but does not establish why the request stalled.

The existing primary resume remains an older `Yuchen_Lin_OG` base. The current Tailor for job dialog does not pass a selected resume ID, so a future attempt must explicitly select or upload the supplied Software Engineer PDF and pass its verified base ID. It must not silently tailor the old primary.

The existing renderer uses an OpenApply template; exact source-PDF layout preservation is not established. A future generated PDF must be shown and compared honestly, rather than represented as an exact-format rewrite without verification.

## Evidence and boundaries

Screenshot: `.temp/nava-rewrite-dispatch-blocked.jpg`.

No application work, profile changes, credentials, new resume upload, code patch, service restart, corrective agent prompt or alternate agent execution occurred during this attempt. The only written artifacts were this observation report and its screenshot. Gmail OAuth remained on hold. The supplied job's role details were not retrieved successfully, so no fit assessment is claimed.
