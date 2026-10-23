# Astra: plan, build and test the apply pipeline

Prepared 2026-10-08 on branch `openapply/trim-and-reshape` (uncommitted work in progress; inspect
it before changing anything). Local checkout: `D:\Dev\OpenApply`.

## Your job

Plan, then implement and test, the changes below. Work in phases. Each phase ends with passing
tests and a short written result. Do not start a phase until the previous one passes.

First, write the plan to `.claude/plans/apply-pipeline.md`: phases, files you expect to touch,
data model changes, test strategy, and open questions. Post a short summary of it to the user.
Then start Phase 1. Stop and ask the user at every **Ask first** marker below.

## Read before planning

- `AGENTS.md`, `CLAUDE.md`, every file in `.claude/rules/`, `README.md`
- `docs/mvp.md`, `docs/architecture.md`, `docs/hosted-companion.md`
- `docs/five-application-trial-2026-10-07.md` and `docs/visible-trial-handoff.md` (the last
  real trial and why it did not count)
- `plugin/agents/job-worker.md`, `plugin/skills/{auto-apply,apply,mvp-apply,search}/SKILL.md`,
  `plugin/skills/_shared/{form-filling,application-review,campaign-flow,untrusted-content}.md`

## Where things stand (verified 2026-10-08)

- **No end-to-end application has ever completed.** The five-application trial was interrupted
  during scoring with 0 verified submissions. There is no repeatable E2E test.
- **The API server calls no AI models.** All model work runs on the user's machine through their
  own Claude Code or Codex CLI, launched by the .NET companion (`apps/terminal`).
- **Models:** agent sessions and `job-worker` use `sonnet` (`plugin/settings/claude.json`,
  `plugin/agents/job-worker.md`); Codex uses `gpt-6-luna` (`plugin/settings/codex.json`).
  One-shot inference (resume extraction, connection and Gmail checks) uses `haiku` via
  `/inference` (`apps/terminal/Inference/InferenceEndpoints.cs`).
- **Pipeline stages today:**

  | Stage | State |
  | --- | --- |
  | Find jobs (Greenhouse, Lever, Ashby feeds; HiringCafe, SerpApi, Apify) | Built, server, no model |
  | Score fit | Built, `job-worker` score mode, Sonnet, up to 5 jobs per call |
  | Collect form questions before applying | **Missing.** Fetchers in `apps/api/src/modules/job-sources/` pull job lists only |
  | Reusable saved answers | **Partial.** An answer is passed only for the one question that blocked that job |
  | Tailor resume | Built, `tailor-resume`, Sonnet |
  | Fill and submit | Built, model-driven click by click through Playwright. **No scripted ATS fillers** |
  | Concurrency | **One worker at a time** (`mvp-apply`, `auto-apply`) |
  | Blockers | Built. `needs_user` becomes a pilot question, job is parked, queue continues |
  | Recording | Built: submission attempts, receipts, `/worker-result-check` |

- **Chat is how work reaches the agent.** `runInject` in `apps/web/src/providers/agent-provider.tsx`
  creates a chat thread and message so the companion picks the work up, then routes the user to
  `/chat`. Every agent action (new campaign, resume, retry, rescan, inbox scan) navigates away.
- **Telegram does not exist yet.** Nothing has been started.

## Product decisions already made

1. The core product is an **apply queue**, not a chat. Campaigns, saved-job apply, Pilot and
   chat-triggered runs all become ways of putting jobs into one queue.
2. Each queued job has an explicit state machine owned by the API:
   `queued → preparing → ready → filling → needs_user → submitted | skipped | failed`
   with a reason on every terminal state. Chat transcripts are never the source of job status.
3. Use code for facts, a cheap model for decisions that can be undone (with code checks), and
   Sonnet or the user for anything that cannot be undone. Submitting is irreversible.
4. Chat leaves the main path. It may stay as a contextual side panel ("Ask about this job").
5. Telegram becomes the conversation channel: questions, approvals, plain-language
   instructions, digests, and "send a job link to apply".
6. The web app is laptop-only. Do not add or maintain mobile layouts.

## Phases

### Phase 1: repeatable end-to-end test (do this first)

Nothing else is trustworthy until one application can go all the way through on demand.

- Build **local fixture application forms** that imitate Greenhouse, Lever and Ashby: single
  page and multi-page, required and conditional questions, resume upload, a work-authorization
  yes/no, a sponsorship yes/no, a free-text "why us", and a confirmation receipt page. Serve
  them from localhost only. They must record what was submitted so the test can assert on it.
- Write an E2E scenario that runs the real flow against those fixtures: profile and resume in
  place, job queued, scored, resume tailored, form filled by OpenApply's own agent, submitted,
  receipt captured, application recorded, visible on Dashboard, Applications and Analytics.
- Make it runnable with one command, and document it in `docs/development.md`.
- Assert on submitted values, not just "it finished". A wrong sponsorship answer is a failure.
- Record which parts are automated (`bun test`, `dotnet test`) and which need the local agent
  and a visible browser.

**Ask first:** before any application to a real employer. Real applications come only after the
fixture E2E passes, and only with the user's explicit go-ahead and case list.

### Phase 2: queue the work without chat

- Add a work queue in the API that the companion pulls from directly. Chat runs become one kind
  of work item, not the only one.
- Implement the per-job state machine from decision 2, with tests for every transition and for
  recovery after a crash mid-submit (use the existing receipt/result recovery; never rerun an
  employer form that may have been submitted).
- Agent actions in the web app stop navigating to `/chat`. Show a toast with "Open progress"
  instead.
- Data migrations, not compatibility shims (`CLAUDE.md`).

### Phase 3: collect questions before the browser opens

- Extend the Greenhouse, Lever and Ashby source modules to fetch each job's application
  questions. Verify what each public API actually exposes before relying on it (Greenhouse's job
  board API is believed to return questions with `questions=true`; Lever and Ashby are unknown).
  Where no API exists, fall back to reading the form page in plain code.
- Store questions per job. Batch the unanswered ones across the queue into one "Needs you" list
  before submitting starts, so a run rarely stops mid-form.
- Treat posting and form text as untrusted input (`untrusted-content.md`).

### Phase 4: answer bank

- Store every answer the user gives, with the exact question text, a normalized form, and its
  category. Answers are reused across jobs.
- Matching is done in code first (exact, then normalized). A model may only *suggest* a match,
  shown to the user, never applied silently.
- Sensitive categories need user confirmation once per exact question and then reuse only on an
  exact normalized match: work authorization, sponsorship, salary, EEO, criminal history,
  relocation, start date, notice period.
- Guard against opposite-meaning questions ("authorized to work" vs "require sponsorship").
  Write tests for these pairs specifically.
- A model never writes a factual answer. Facts come from the profile or the bank, or the user is
  asked. Question cards get a "Save to profile" option.

### Phase 5: scripted form fillers

- Write Playwright fillers for Greenhouse, Lever and Ashby that fill known fields from the
  profile and answer bank in code.
- Only unknown free-text questions go to the model, on Sonnet, grounded in resume evidence
  (`resume-evidence.md`). Anything unclear becomes `needs_user`.
- Keep the final pre-submit review (`application-review.md`) on Sonnet.
- Fall back to the existing full `job-worker` flow when a form does not match its filler.
- Test every filler against the Phase 1 fixtures, including the conditional questions.

### Phase 6: cheaper scoring, measured before switching

- Move hard filters (location, work authorization, salary, seniority) into code.
- Run scoring on Haiku in **shadow mode** next to Sonnet first. Log both. Require the model to
  quote evidence from the posting and verify in code that every quote appears in it.
- Build a regression set from existing scored jobs in the database.
- Report agreement, especially near the cutoff. Send scores near the cutoff to Sonnet.
  **Ask first** before making Haiku the default, with the numbers.

### Phase 7: throughput and limits

- Allow 2–3 parallel workers, with a per-domain pace limit and random delays.
- Daily cap (default about 30–40, user-adjustable), fit cutoff, and no more than a few
  applications to the same company per period.
- Before starting a run, show an estimate: time, how many jobs need the full agent, and expected
  share of the user's plan.
- A stuck job is parked and the queue moves on; one question never blocks the rest.
- Do not automate LinkedIn Easy Apply. Route LinkedIn jobs to the employer's own form when one
  exists; otherwise mark them for manual apply.

### Phase 8: Telegram

- Link accounts with a one-time code from Settings. Unlinking must be possible from both sides.
- Bot webhook in the API. Incoming messages are sorted into a fixed set of intents (send link,
  answer question, approve, skip, instruction, status) and validated in code.
- **Send a link:** code identifies the job (Discover index match, then follow "apply on company
  site" to the ATS), removes duplicates, scores, collects questions, then replies with one card:
  role, company, fit, unanswered questions, and buttons `[Apply now] [Add to queue] [Skip]`.
- Questions and approve-before-submit arrive as button cards and resolve the same API records the
  web "Needs you" list uses. One source of truth, two channels.
- Plain-language instructions ("stop applying to Amazon") become a structured rule plus a
  confirmation reply with Undo. Never change behavior from raw text alone.
- When the user's computer is offline, reply from API state and queue the work ("Your computer
  is offline; I'll start when it's back").
- Send a daily digest; interrupt only for blockers.
- Keep sensitive data out of Telegram: addresses, EEO answers, credentials, verification codes.
- Start with fixed message templates and code-only intent matching.
  **Ask first** before adding any server-side model (it would be the first per-user AI cost),
  and before creating a bot token or any external account. Never handle the token in chat;
  the user puts it in the environment.

### Phase 9: web UI

- A Queue page (table of jobs, state, reason, live browser side panel, Pause/Stop) and a single
  "Needs you" list with a nav badge.
- Remove Chat from the main nav once the Queue works.
- Fix these bugs found in the 2026-10-08 audit, since they sit on this path:
  - `apps/web/src/components/layout/app-shell.tsx:55` hardcodes `<AgentDock compact />`, so the
    inline dock is dead and the dock opens as a modal overlay (and auto-opens for users whose
    stored `dockExpanded` is true).
  - Creating a campaign navigates to the campaign page, then to `/chat`
    (`campaign-composer.tsx:106`, `agent-provider.tsx:159`). Fixed by Phase 2.
  - `pilot/overview/overview-tab.tsx:25` shows a skeleton forever on error.
  - `inbox/inbox-content.tsx:48` shows "No mailbox connected" when the request fails.
  - `now-running.tsx:21` shows "0/N applied" for search-only campaigns and prints the raw source.

## Rules for the whole job

- Follow the repository conventions in `CLAUDE.md` and `.claude/rules/`. Run `bun run test`,
  `bun run ci`, `bun run knip` and the terminal's `dotnet test` before each commit. Use the
  `verify` skill before committing and the `commit` skill to commit. Never run
  `biome check --write --unsafe`.
- Commit per phase on a feature branch. Never push to `main`, force-push, or open a PR without
  asking.
- Never put passwords, tokens or verification codes in logs, docs, commit messages or chat.
- The application work in any trial must be done by OpenApply's own agent. Do not fill employer
  forms yourself or write a fake successful application to make a test pass. Report any manual
  step.
- Report honestly. A stage that did not run did not pass. Write each phase's result to
  `docs/` in the same style as the existing trial reports: what ran, what passed, what failed,
  evidence, and what is next.

## Done means

- The fixture E2E passes on demand and is documented.
- Work reaches the agent through the queue, not chat, with tested state transitions.
- Questions are collected up front and answered from a tested answer bank.
- Greenhouse, Lever and Ashby fixtures are filled by scripted fillers, with model fallback.
- Haiku-vs-Sonnet scoring numbers are reported (the switch itself waits for the user).
- Telegram link intake, question cards and approvals work against a test bot, with no sensitive
  data in messages.
- One real application, authorized by the user, completed and recorded end to end.
