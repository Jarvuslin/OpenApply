# Next chat: one visible OpenApply application trial

Prepared 2026-10-06. Code baseline: `1589c77c` on `openapply/trim-and-reshape`.
Local checkout: `D:\Dev\OpenApply`. Remote: `https://github.com/Jarvuslin/OpenApply`.

## User's requested outcome

Direct, OpenApply-owned Gmail OAuth is on hold. Do not implement it or request Google Cloud credentials during this trial unless the user changes that decision.

In the new chat, demonstrate one real flow through OpenApply: the user supplies a resume, the app extracts and saves their profile, finds a suitable job, prepares a tailored resume, fills the application and answers questions, submits it, and records the result in the dashboard and analytics. The user wants to watch the agent's browser actions in a visible VM browser throughout.

The app's selected Claude Code or Codex agent must do the application work. The outer chat may inspect, fix and test OpenApply, start its controls, observe the run and explain failures. It must not quietly fill the employer form itself or write an artificial successful application to make the demonstration pass. Identify any manual intervention in the final trial report.

This is a future trial, not a completed application. No real application was submitted while preparing this handoff.

## Start with the actual local environment

Read `AGENTS.md`, `CLAUDE.md`, the relevant `.claude/rules/` files, `README.md`, and `docs/mvp.md`. Inspect the current branch and working tree before changes. The previous code change passed 949 tests plus a production web build; those checks do not prove a complete real application.

The new chat needs local execution and browser access on the machine running OpenApply. Uploading repository files into a ChatGPT project alone does not establish a connection to this machine's localhost services. Prefer a local Codex chat attached to `D:\Dev\OpenApply`. If transferring a source snapshot, exclude `.env*`, database dumps, storage, browser profiles and `.temp`; supply the intended resume separately.

Known local addresses:

| Surface | Address |
| --- | --- |
| Workspace | `http://localhost:4100/workspace` |
| Workbench / Discover / Connections | `http://localhost:4100/mvp` |
| Documents | `http://localhost:4100/documents/resumes` |
| Analytics | `http://localhost:4100/analytics` |
| VM viewer | `http://localhost:6080/vnc.html?autoconnect=1` |
| API health | `http://localhost:4101/api/health` |
| Companion health | `http://localhost:4102/healthz` |

Windows uses the existing WSL distribution `OpenApply-MVP`; its Postgres is exposed on port 5433. Do not reset, reseed or recreate the VM. Start with `node scripts/openapply.mjs doctor` and inspect service health. Start missing services with the documented launcher only when needed. On this machine Bun and .NET are under `D:\Dev\tools\bun` and `D:\Dev\tools\dotnet` if not on PATH.

Process records are under `.temp/mvp/`, but verify the live port owners, command lines, executable paths and start times before stopping anything. An earlier Bun wrapper exited while a Next.js child continued serving stale UI on 4100; the current production web server was subsequently launched directly with Node. Do not assume the recorded wrapper is the actual listener. Preserve the existing encryption key and database. Do not restart during an application.

## Make the run genuinely visible

`scripts/mvp-vm-start.sh` launches headed Chromium on Xvfb display `:99`, using the persistent `/home/pilot/browser` profile. noVNC displays that virtual desktop. The browser has no `--headless` flag; this is a visible browser inside the VM rather than a separate host Chrome window.

`plugin/bin/openapply-browser.mjs` runs the bundled Playwright MCP in the VM and attaches to guest `127.0.0.1:9222`. Require the worker to use that browser. Use `openapply-stage` for a resume upload and its returned guest path; do not guess paths.

Before touching an employer, verify the VM Chromium process arguments/display and demonstrate that an innocuous navigation performed by the app agent appears in the viewer. A host CDP response on port 9222 is insufficient: `start-mvp.ps1` currently accepts any response there, and the VM startup script accepts any existing Chromium process. A provider can also remain running after browser MCP configuration fails. Diagnose those cases rather than substituting a hidden or host browser.

Keep the VM viewer visible alongside the Agent panel or progress view. Show browser actions, uploads, questions and application state. Resume parsing, API-based discovery and database writes should show clear progress even though they do not produce browser clicks. No automatic video recording has been verified; retain local screenshots/checkpoints explicitly if needed.

## Trial sequence and acceptance criteria

1. **Profile and resume:** Use the resume supplied for this trial. Preserve the source file, show extracted facts and save missing answers through onboarding. Do not silently reuse an old applicant, mailbox, test profile or blanket "yes" answers. Prior search preference was Toronto, Canada; confirm it is still appropriate for the new applicant. Establish factual work authorization, sponsorship, experience, location and other mandatory answers before submission.
2. **Discover one suitable role:** Use a live allowed employer/ATS source, match the profile and explain why the selected role fits. Respect the current location, job-level and experience filters. Use the actual listing and canonical application URL, not a fixture. Audit the standing queue before enabling Pilot; only the selected trial job should run, with other queued applications left intact and held back.
3. **Prepare and review:** Inspect required form questions before unnecessary tailoring. Show the original and tailored resume, the rewrite comparison and the rendered PDF. Preserve factual accuracy. Record the base resume and exact variant selected for upload. Resolve material missing answers through the app and save reusable profile facts.
4. **Run the app agent:** Use the approved queue / `mvp-apply` path and one fresh `job-worker` for the selected job. Watch it fill the real form and upload the exact staged document. Use confirmed profile facts for questions; park for genuinely unknown required answers. The outer chat must not take over the form to make the trial succeed.
5. **Submit and retain evidence:** Follow the user's approval and the active runtime's rules for the actual employer and submission. Prepare a concrete application before any required confirmation; avoid repeating approval already granted for the same action. A clicked Submit button is not success. Require the visible employer confirmation/receipt, retain evidence before closing the tab, and treat an ambiguous timeout as unresolved rather than submitting again.
6. **Record through the normal workflow:** The worker returns its result; the orchestrator records it through `/api/campaigns/<campaignId>/jobs/<jobKey>/result`. Verify exactly one persisted application with the correct employer, role, URL, status, timestamps and resume/variant IDs. Do not manually insert a successful application or adjust counts.
7. **Verify dashboard and analytics:** Confirm the application appears in `/workspace?tab=applications`, its application detail and the campaign. Record pre-trial totals, then explicitly refresh `/analytics` and verify the matching submitted/applied metric increases by one under the same filters/date range. Workspace SSE currently does not automatically invalidate analytics queries. Check persistence after reload and that result retries do not create duplicates.
8. **Report the evidence:** Link the job, selected resume variant, confirmation evidence, application and analytics. Distinguish passed, blocked and not-exercised stages. State which model/provider performed the work and any human/outer-chat intervention. A draft or prepared form is not a full successful trial.

## Known gaps to handle honestly

- **Gmail:** The real background Claude check passed a bounded metadata-only Gmail search. The standard connector exposes `search_threads`, but no authenticated account-profile tool. A saved user-confirmed email has `identityVerified:false`; that is not proof of mailbox identity. Current `get-code`, import and reply instructions still require trustworthy current-session identity, so autonomous email activation remains blocked with that connector alone. The job-worker allowlist also lacks the observed `mcp__claude_ai_Gmail__*` prefix; main-session access is not proof of worker access. Codex background Gmail checks remain unsupported. Do not reopen the paused OAuth project or claim those gaps are solved.
- **Conditional signup:** A suitable direct-apply employer form can exercise the requested resume-to-submission flow without account creation or email activation. Explicitly mark those stages "not exercised." If the selected role requires unsupported authentication, show the blocker; do not silently bypass it or report activation as successful.
- **CAPTCHA:** Paid solver setup is on hold and solving is disabled by default. Do not enable a solver or spend credits. A real blocking challenge must be surfaced and handled according to the current runtime's rules; simulated challenges are not evidence.
- **Preparation route:** `plugin/skills/mvp-trial/SKILL.md` still references `/api/public/jobs/:slug` although public listings are disabled and Discover uses authenticated `/api/jobs/:slug`. Verify and fix this narrow mismatch before relying on the preparation action.
- **Receipts:** Result recording creates an application/event, but a durable screenshot or receipt reference is not currently required by the result schema. Preserve real confirmation evidence explicitly; do not mistake a stored `applied` status alone for proof of submission.
- **Automation readiness:** An independent complete employer signup, activation, sign-in and submission has not passed. The purpose of this trial is to establish what really works, fix concrete blockers and expose unresolved ones.

Useful implementation paths: `plugin/skills/extract-resume/`, `plugin/skills/tailor-resume/`, `plugin/skills/review-resume/`, `plugin/skills/mvp-trial/`, `plugin/skills/mvp-apply/`, `plugin/agents/job-worker.md`, `plugin/skills/_shared/campaign-flow.md`, `plugin/skills/_shared/mailbox.md`, `plugin/skills/get-code/`, `apps/api/src/modules/campaign/jobs/job-result.ts`, and `apps/web/src/components/features/mvp/`.

## Prompt for the new chat

> Work in D:\Dev\OpenApply. Read AGENTS.md, CLAUDE.md and docs/visible-trial-handoff.md. Direct Gmail OAuth remains on hold. Run one real, visible end-to-end OpenApply trial using the resume I provide: extract and complete my profile, find a suitable job, show the tailored resume and rewrite review, have OpenApply's own Claude/Codex agent fill and submit the application in the headed VM browser, then verify its real confirmation, dashboard record and analytics. Keep the VM viewer and agent progress visible. Fix concrete app blockers, but do not quietly do the agent's application work yourself or fabricate a successful record. Resolve missing factual answers, honor existing approvals and applicable runtime rules, and clearly report anything blocked or not exercised.
