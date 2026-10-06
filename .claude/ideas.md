# Agent efficiency backlog

Unscheduled ideas retained from the upstream brainstorm. Current behavior and scope are documented in README.md and docs/mvp.md.

## Pilot agent: efficiency, intelligence, autonomy

### Efficiency

1. **Headless runs with structured events.** The host injects a skill into a TUI and scrapes
   the PTY for the sentinel. That is why it needs the repeated-line detector, the two-minute
   completion poll, and the double Enter for Codex. Both CLIs offer a clean mode the host does
   not use:

   ```
   claude -p --output-format stream-json --mcp-config <file>
   codex exec --json --output-last-message <file>
   ```

   The host would see every tool call and the exact cost per cycle. "Stuck" becomes "same tool
   call three times" instead of "six repeated lines". Codex can force the final message into a
   JSON schema, which makes the sentinel a typed result. Keep the terminal panel by rendering
   the event stream.
   First step: a runner in `apps/terminal/Pilot/` that spawns print mode for one cycle and
   treats the final JSON message as the sentinel.

2. **Cycle packets.** Each agenda item sends the agent back to the API for the job, profile,
   resume, and prior letters. Have the server assemble one packet per item, trimmed to a token
   budget, so a cycle makes one read.
   First step: `GET /api/pilot/agenda/:itemId/packet`.

3. **Batch cycles.** One item per cycle pays for the skill read and browser warmup every time.
   Let the agenda mark items that share a board and kind as a batch of up to three. The agent
   claims and releases each in turn, so a crash loses one item, not the batch.

5. **Liveness probe without a model.** Let the host fetch each approved posting URL with a
   plain HTTP request before the item enters the agenda. A closed posting costs one request
   instead of one cycle.

6. **Per-kind time budgets.** The sentinel timeout is 20 minutes for every kind. The cost panel
   already knows the median per kind. Send a p90-based budget in each item and let the host
   enforce it.

### Intelligence

7. **Job fact sheet once per job.** Scoring is a skills overlap, which cannot read "hybrid
   three days in Austin" or "clearance required". Extract a structured fact sheet per job once
   (location mode, seniority, sponsorship, comp, hard blockers, the angle to pitch) and store
   it. Scoring, tailoring, and any later autopsy read the same record.

8. **Expected value instead of fixed priorities.** Priority is a constant per kind plus the
   match score. Add freshness decay, employer responsiveness, and crowding. A fresh posting at
   a company that replies should outrank a stale one with a slightly better score. Start with
   hand weights and tune them from outcomes later.

9. **Predict, then get scored.** Have the agent write a decision record per application: why
   this job, the angle, and its own probability of a reply. Compare with outcomes monthly. An
   agent that sees its own calibration stops overreaching.

10. **A failure note on the subject.** When a claim fails, the agent writes one line of what it
    tried and where it broke on the job itself. The retry reads it first.

### Autonomy

11. **Provisional answers.** For low-risk question kinds, the pilot states its intended answer
    and proceeds unless the user objects before a deadline. Never for 2FA or send approvals.
    Pair it with precedents: an answered question becomes a reusable fact, so the same question
    is never asked twice.

12. **Submission intent check.** The claim gates the start of a cycle, but a cycle runs for
    many minutes and the final click is unguarded. Right before submitting, the agent posts an
    intent with the payload summary. The server checks caps, duplicates, and policy in one
    transaction and gets the last word. A receipt falls out for free.

13. **Two lanes on one machine.** Run a browser lane and a text-only lane as separate sessions.
    The claims table already makes this safe. A captcha in the browser lane then no longer
    stops document work.
    First step: a lane filter on the agenda.

14. **Board circuit breaker.** Three identical failures on one board in a day pause that board
    for a day, with one journal note. Today the item comes back after each cooldown. This is
    automatic and temporary, unlike the manual parking removed on 2026-07-22.

15. **Skills served by the API.** The host already writes bundled skills to disk before each
    Codex launch. Fetch them from the API instead, versioned. A prompt fix then reaches every
    user without a plugin release, and prompt experiments can run per fleet segment.

Suggested start: idea 1, since 6, 10, and 13 get much simpler once the host has structured
events. Required-question pre-scan is now implemented in the worker instructions.
