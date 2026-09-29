# JobPilot terminal host

A local .NET process that runs one Claude Code or Codex PTY for the web app. It owns no cloud state: it
launches the provider with the user's JobPilot API environment and relays raw terminal traffic.

## Layout

Each folder is one feature and holds its endpoints, request and response records, and logic.

| Folder | What it does |
| --- | --- |
| `Hosting/` | DI and middleware, `/healthz` and `/shutdown`, the install layout, the origin allowlist, the `jobpilot://` scheme. |
| `Providers/` | What to launch. `Provider` is the registry; `ClaudeProvider` and `CodexProvider` hold each CLI's arguments and quirks. |
| `Sessions/` | The live session. `TerminalSession` owns it, `PtyProcess` wraps one spawned process, `TerminalRelay` bridges WebSockets. |
| `Pilot/` | The autonomous loop: `PilotLoop` runs cycles, `CycleRunner` runs one, `PilotSession` drives the terminal for it. |
| `Updates/` | `HostUpdater` installs a newer GitHub release; `HostHandoff` passes the port to the relaunched host. |

## Runtime flows

- **Session.** `/sessions/start` calls `TerminalSession.Start`, which prepares the provider's workspace (Codex
  mirrors the bundled skills into `.agents/skills`), builds the `JOBPILOT_*` environment, and spawns a new
  `PtyProcess`. `TerminalRelay` broadcasts output to every WebSocket and keeps a 512 KB replay for reconnects.
- **Pilot.** `/pilot/start` saves `PilotSettings` to `pilot.json`; every save wakes `PilotLoop`. Each cycle
  starts with one `/api/pilot/activity` probe that gates on the server's run-state and gives `CycleRunner` its
  completion baseline. The runner sends the cycle, waits for the sentinel (or a server-recorded completion the
  TUI garbled), and climbs check-in, skip, then restart when a run looks stuck. `PilotEventListener` holds
  the API's event stream open and wakes the loop when new work can start the next cycle early.
- **Update.** `HostUpdater` downloads the release, moves the running executable aside, and copies the release
  over the install. `HostHandoff.Relaunch` starts the new host, which waits for this one to release the port.
  Only the executable and `plugin/` are the updater's; the rest of the install root may be user state.

## Shared state

- `TerminalSession.sync` guards the current `PtyProcess` and the active provider. Replacing or stopping a
  session disposes its process, which never reports an exit afterwards, so a stale exit cannot stop a newer one.
- `TerminalRelay.sync` orders replay writes against client registration and guards the client map.
- `PilotStore.sync` guards the in-memory settings and serializes the atomic `pilot.json` replacement.
- `PilotLoop.sync` guards the live cycle's cancellation source. The loop publishes it before reading the
  settings, so a stop either cancels that cycle or is seen by its read.

## Invariants

- A stop on request raises one requested exit (for Pilot waiters) and never shows a crash banner.
- `PilotApi` probes and reports never throw except on the caller's own cancellation; a failed probe returns null.
- A wake that leaves the pilot running never interrupts the agent mid-turn; a stop does.
- `pilot.json` keeps its wire shape, is DPAPI-protected on Windows, and is created with mode `0600` on Unix.
