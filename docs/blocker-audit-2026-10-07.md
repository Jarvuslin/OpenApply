# OpenApply blocker audit — October 7, 2026

Follow-up: [nava-short-prompt-preview-2026-10-07.md](nava-short-prompt-preview-2026-10-07.md) records the subsequent live preview using the already-running API routes. It also records the correction to the connection-slot allocator that caused recurring reconnect banners. The server/companion restart limitation below still applies to the newly compiled changes.

## Scope and boundaries

Reviewed the browser/API boundary, authentication/session handling, chat persistence and dispatch, companion/provider execution, resume upload/extraction/tailoring/saving, scoring/campaign/application records, history/analytics, and launcher/plugin integration. This is a review of the main execution paths across the repository, not proof that every code path is defect-free.

No employer forms, submissions, mailbox actions or resume inference were performed during the repairs. The Nava Benefits rewrite remains a preview-only task to be run by OpenApply's own agent after runtime activation. Gmail OAuth remains on hold.

## Chat startup diagnosis

- The browser held six persistent connections to the API while ordinary authenticated requests timed out. Settings, documents and chat pages all reported `document.visibilityState === 'visible'`, including inactive in-app tabs. Per-tab stream sharing and visibility cleanup could therefore still exhaust the browser connection pool.
- Direct authenticated reads of the same chat API completed successfully in **16–21 ms**. PostgreSQL had no lock waits. The earlier preview thread contained **zero messages and zero runs**; the Nava chat creation had not persisted.
- This points to browser transport starvation, rather than a failed Claude rewrite or stalled chat database query. HTTP/1 server-sent events share a small connection budget across tabs; [MDN documents the six-connection limit](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).
- New-chat creation lacked a deadline and disabled its only close control while waiting. It also lacked an idempotent creation identity, making a blind retry unsafe after an ambiguous response.

## Repairs in this patch set

| Area | Change |
| --- | --- |
| Live events | Share a stream across tabs, cap persistent upstream connections, retain replay cursors, transfer ownership and clean up cancelled subscribers. |
| Account boundaries | Keep streams scoped to the confirmed account; login/logout clears cross-tab streams, cached data and pending chat drafts. |
| Chat creation | Stable request IDs, bounded waits, recoverable drafts and safe retries in New chat, skill injection and job chats. Definitive rejection unlocks a draft; ambiguous failure retains its identity. |
| Selected resume | Both Tailor controls pass the selected base ID. An invalid explicit base must stop instead of silently choosing the primary. |
| Original source | Reject replacement of a base already extracted or linked to variants/applications; upload a new base instead of pairing a new PDF with old facts. |
| Autosave | Preserve a failed draft for Retry and serialize overlapping saves so an older failure cannot replace newer edits. |
| Rewrite guard | Reject the demonstrated added/dropped factual words in bullet rewrites. This is conservative lexical protection, not complete semantic verification. |
| Bullet preservation | Ranking no longer silently drops bullets after the sixth when no limit was requested. |
| Source review | Fetch the explicitly selected source through the authenticated API; do not read the primary resume's server-local path on the agent's machine. |
| Windows extraction | Explicit UTF-8 process pipes preserve accents, Chinese characters and punctuation. |
| Analytics | Submitted totals/weekly counts retain applications after later interview, offer, rejection or withdrawal statuses. |
| History | Resolve linked job details through the submission record when canonical URL normalization prevents exact source-URL matching. |

## Remaining findings

| Priority | Finding | Consequence / next repair |
| --- | --- | --- |
| P1 before submissions | Ashby `source` query variants can have different canonical submission keys. | A second campaign job can miss a previous submission whose outcome is unknown. Normalize provider-specific tracking and migrate existing keys with collision handling; never discard an unknown reservation. |
| P1 for unattended work | A hung Claude child has no inactivity deadline while companion heartbeats continue. | Work and browser ownership can remain occupied indefinitely. Interrupt visibly on a bounded progress timeout; never automatically replay employer actions. |
| P1 for recovery | A deleted provider session keeps a stale `--resume` ID. | Add explicit session reconstruction from saved context without replaying an ambiguous application. |
| P1 for manual editing | Switching extraction UI to manual editing does not cancel the pending extraction write. | A late extraction can overwrite manual changes. Add cancellation and a version check before persistence. |
| P1 for visible trials | VM startup accepts any existing host CDP response / guest Chromium process. | Validate the expected guest profile, display and headed process before reporting ready. |
| P2 | Resume detail initially failing to load can remain a progress bar. | Render a clear load error with a safe read-only Retry. |
| Product limitation | The PDF renderer uses OpenApply's template. | Exact preservation of the uploaded PDF's layout is not implemented; show the actual generated PDF and disclose the difference. |
| Deployment | Linux release artifacts are advertised while browser helpers reject Linux. | Align advertised support and runtime support before a Linux release. |
| Local build environment | Native Windows release publish cannot find the C++ linker. | Development companion build works; install/configure the supported native build prerequisites before producing a release. |

## Activation and verification

The database reports **54 migrations, all applied**. The development companion builds successfully. Native release publish is blocked by the missing platform linker.

The assistant's attempt to restart the idle API and companion was rejected by automatic approval review with only **“blocked by policy.”** That command did not run. Manual activation instructions are in `local-restart-after-audit.md`. Do not claim the server/companion fixes or the Nava PDF were exercised until the updated processes are loaded.

Fresh root verification:

- **693 API tests, 38 contract tests, 142 web tests and 311 .NET tests passed** (1,184 total).
- API/web typechecks, knip and full Biome CI passed. Biome reported three informational suggestions in existing scripts, with no errors or warnings.
- The previously failing conversation loaded after the new browser transport was loaded in all open OpenApply tabs. Its reconnecting indicator subsequently cleared. The earlier unsent three-job draft remained intact and was not retried.
- Authenticated probes of chat and Pilot SSE returned 200 in 1–2 ms with an initial connected frame; CORS preflight for the replay header returned 204. Streams were closed immediately without logging private event payloads.
- Browser evidence: `.temp/chat-loading-repaired.jpg`.

The frontend recovery is verified. The new server-side creation identity/retry behavior, resume guards, analytics changes and companion UTF-8 fix still require the blocked service restart before live testing. No Nava chat request, tailored PDF or submission has been generated in this repair run.
