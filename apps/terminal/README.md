# OpenApply terminal host

A local .NET process that runs Claude Code or Codex for the web app. The common queue and the legacy
PTY share one runtime. The API owns question, application and run state.

## Layout

Each folder is one feature and holds its endpoints, request and response records, and logic.

| Folder | What it does |
| --- | --- |
| `Hosting/` | DI and middleware, `/healthz` and `/shutdown`, the install layout, the origin allowlist, the `openapply://` scheme. |
| `Providers/` | What to launch. `Provider` is the registry; `ClaudeProvider` and `CodexProvider` hold each CLI's arguments and quirks. |
| `Sessions/` | The live session. `TerminalSession` owns it, `PtyProcess` wraps one spawned process, `TerminalRelay` bridges WebSockets. |
| `Agent/` | Agent process launcher used by queue workers: provider protocols, process lifetime and model budgets. |
| `Queue/` | Sole authenticated work consumer, durable API leases, cancellation, event redaction and queue endpoints. |
| `Questions/` | Code-only owned-job form inspection, bounded observations and authenticated API persistence. |
| `Pilot/` | Optional code-only scheduler feeding the common queue; configuration and event wakeups. |
| `Updates/` | `HostUpdater` installs a newer GitHub release; `HostHandoff` passes the port to the relaunched host. |

## Runtime flows

- **Queue.** `POST /queue/connect` verifies a terminal token with a read-only API request and keeps
  the connection in memory. There is no startup connection. `QueueRuntime` alone claims work from
  `/api/work-queue/claim`, heartbeats the lease, and publishes readable events. Closing the page does
  not cancel work; `DELETE /queue/connection` interrupts the process. Lease loss stops the process
  and prevents stale completion. Failed, stopped or expired work is never automatically replayed.
  Application completion remains subject to canonical submission receipts in the API.
- **Agent processes.** Queue workers launch providers through `Agent/AgentProcess`.
  Claude uses structured JSON and Codex uses app-server with the existing permission policy.
  Provider selection stays explicit; neither the queue nor Pilot probes readiness or falls back to
  another provider. Tool arguments, tool output, thinking and stderr are not forwarded.
- **Session.** `/sessions/start` calls `TerminalSession.Start`, which prepares the provider's workspace (Codex
  mirrors the bundled skills into `.agents/skills`), builds the `OPENAPPLY_*` environment, and spawns a new
  `PtyProcess`. `TerminalRelay` broadcasts output to every WebSocket and keeps a 512 KB replay for reconnects.
- **Questions.** `POST /questions/collect` receives `apiToken`, `apiUrl`, `jobId`, `requestId` and
  `expectedCollectionVersion`. It fetches the owned job, acquires the shared browser gate, and runs
  a fixed DOM collector in a fresh guest Chromium context before storing versioned observations.
  It works with a zero model budget and creates no queue work. API credentials remain inside the
  host HTTP client; browser subprocesses receive only a validated job URL and fixture opt-in.
  Greenhouse, Lever and Ashby job URLs are supported. Loopback fixtures require the host setting
  `OPENAPPLY_QUESTION_ALLOW_LOOPBACK=1`. Unknown/hidden/custom fields and unvisited steps remain
  partial; the collector neither fills fields nor submits forms. GET/HEAD requests and validated
  same-job redirects are the only permitted browser traffic. Cancellation closes the isolated
  browser; unconfirmed shutdown keeps the gate closed until the companion restarts.
- **Pilot.** `/pilot/start` saves the optional scheduler settings. `PilotLoop` checks server run-state
  and calls `/api/work-queue/schedule`; its event listener wakes admission when useful. It never
  launches or injects into a PTY, executes a model, retries an application, or connects the executor.
  Stopping Pilot stops future scheduling; existing queue entries require explicit Pause/Stop actions.
  `CycleRunner`, `PilotSession` and their sentinel/restart machinery have been removed.
- **Update.** `HostUpdater` downloads the release, moves the running executable aside, and copies the release
  over the install. `HostHandoff.Relaunch` starts the new host, which waits for this one to release the port.
  Only the executable and `plugin/` are the updater's; the rest of the install root may be user state.

## Shared state

- `AgentRuntimeGate` prevents queue work, question collection, preparation previews and a legacy terminal from controlling the browser together.
  Pilot scheduling does not own the browser and can coexist with a manually connected queue worker.
  Recovery requires saved submission checkpoints and actual receipts; model completion alone is
  insufficient.
- `TerminalSession.sync` guards the current `PtyProcess` and the active provider. Replacing or stopping a
  session disposes its process, which never reports an exit afterwards, so a stale exit cannot stop a newer one.
- `TerminalRelay.sync` orders replay writes against client registration and guards the client map.
- `PilotStore.sync` guards the in-memory settings and serializes the atomic `pilot.json` replacement.
- `PilotLoop.sync` guards the scheduler cancellation source and its status; a stop cancels admission.

## Invariants

- Queue credentials stay in memory and child environment variables, never command arguments or logs.
  `OPENAPPLY_WORK_ITEM_ID` and `OPENAPPLY_WORK_LEASE_TOKEN` authorize plugin submission checkpoints;
  every attempt remains bound to its owner, work item, job and live lease.
- `OPENAPPLY_MODEL_BUDGET` also applies to queue execution. A zero, invalid, or already-used
  one-run budget prevents claims before API mutation. No provider is prepared or probed.
  Budgeted hosts reject legacy PTY, inference, connector, update and Pilot control endpoints and
  do not start the saved Pilot scheduler. Existing process-level limits and usage ledgers remain active.
- On Windows a kill-on-close Job Object ends the agent tree if the host exits or crashes.
- `pilot.json` retains its wire shape, DPAPI protection on Windows and mode `0600` on Unix.
- The former model acceptance route cannot be treated as compatible evidence for queue applications.
  A future real campaign needs new explicit approval and a queue-aware harness. Preserved application
  evidence and model-free UI regression remain separate from that gate.

## Preparation preview

`POST /preparation/fill` receives `apiToken`, `apiUrl`, `jobId`, `requestId`,
`expectedCollectionVersion` and `manifestHash` after an explicit user action. It works with a
zero model budget and never claims queue work. The host fetches the owned manifest and downloads
only its confirmed document references, with redirects disabled and PDF hash/size checks.
Credentials stay in the host; the fixed guest helper receives confirmed facts and bounded PDF
bytes over stdin, never paths or API credentials.

The isolated preview fills exact native fields, freezes networking before entering facts or
documents, and records typed readback as observed evidence. Unknown controls, new questions,
multi-page steps and network-backed uploads require explicit fallback. No Next, final-review or
Submit action is performed. The preview context closes, so the response always says
`contextRetained: false` and `submissionAllowed: false`; it is a check, not a retained application.

`plugin/bin/preparation-fill.mjs` exports `fillOwnedPage` for a future queue worker with a
verifiably owned browser page and blocked network. Live worker handoff is not wired yet. Reuse
requires the common application lease/submission fences and final review after new explicit
model approval. This helper cannot itself authorize submission or model fallback.
