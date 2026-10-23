# One-job common-queue application test

This explicitly approved test runs one synthetic Greenhouse application through the current
production `QueueRuntime`. It reuses disposable database provisioning and the existing
application/receipt/PDF assertions. The historical `apply:e2e` command remains disabled.
It does not test Add-job intake preparation, automatic discovery, Gmail, external accounts,
or all ATS layouts. Prepared scoring and documents are labelled separately from live execution.

Model-free checks:

```powershell
node --test scripts/queue-apply-regression/run.test.mjs scripts/queue-apply-regression/prepared-job.test.mjs scripts/apply-e2e/environment.test.mjs
$env:OPENAPPLY_E2E_DOTNET = 'D:/Dev/tools/dotnet/dotnet.exe'
node scripts/queue-apply-regression/run.mjs --preflight
```

`--preflight` only checks local metadata/infrastructure. It neither generates an answer nor
measures remaining subscription quota. The run repeats routing validation immediately before
dispatch. Existing Windows/WSL or macOS/Lima browser infrastructure and the dedicated ports
documented in `scripts/apply-e2e/environment-preflight.mjs` must be available.

After explicit approval, supply a new private approval file. Example ceilings are not approval:

```json
{
  "version": 1,
  "approved": true,
  "purpose": "queue-application-test",
  "runId": "REPLACE-WITH-NEW-LOWERCASE-UUID",
  "provider": "claude",
  "model": "sonnet",
  "approvalReference": "user:EXACT-AUTHORIZATION-REFERENCE",
  "approvedAt": "REPLACE-WITH-UTC-TIME",
  "expiresAt": "REPLACE-WITH-UTC-TIME-WITHIN-24-HOURS",
  "acceptObservedLimitOvershoot": true,
  "maxCampaigns": 1,
  "maxAutomaticRetries": 0,
  "cases": ["greenhouse"],
  "budget": {
    "maxRequests": 60, "maxTokens": 2000000, "maxSubagents": 4,
    "maxTurns": 20, "maxWorkerTurns": 50, "maxBudgetUsd": 3, "maxSeconds": 600
  }
}
```

```powershell
node scripts/queue-apply-regression/run.mjs --run-id UUID --approval-file ABSOLUTE_PRIVATE_APPROVAL --evidence-dir ABSOLUTE_NEW_DIRECTORY
```

The outer approval is consumed once before provisioning. The exact single-WorkItem grant is
derived only after API preparation and queue eligibility checks pass. Startup, claim, model and
submission failures are never automatically retried. Subscription token accounting is observed
after responses and can overshoot; dollar values are list equivalents, not permission for API
billing. Zero/incomplete telemetry is reported as unavailable, never proof of free execution.

The harness cannot write checkpoints, begin attempts, receipts, application results or worker
handbacks. A private loopback observer records only an actual current-lease worker result-check
request and its validated response. Original field fidelity, exact uploaded bytes, actual receipt
and canonical recording assertions remain intact. Synthetic campaign completion is a separate
harness lifecycle command issued only after the worker reaches submitted with a validated handback.
UI verification is separate and must not rerun the model. Review the retained database, worker
profile, fixture submit count and grant/ledger before any subsequent explicitly approved run.

The private staged Claude settings append `mcp__*gmail*` and `mcp__*Gmail*` denial rules,
preserving existing permissions and inventorying the transformation. Installed settings remain
unchanged. This is a configured Gmail connector tool restriction; it does not establish a complete
MCP, network or operating-system sandbox, or verify access to any mailbox. Successful completion
also requires the final metadata ledger and exactly one total fixture Submit request after cleanup.

A canonical `submitted` queue state does not mean the provider process has finished. The runner
waits for the actual claimed execution to drain from the same companion connection before
collecting the handback and stopping owned services. Polling remains inside the original finite
deadline. Missing handback, incomplete usage, changed execution ownership or a deadline stop
remains a failed test; none authorizes replay of a recorded or ambiguous submission.
Success also requires no companion runtime error and a fresh canonical observer read confirming
the exact current execution is submitted and inactive. This does not assert a separate persisted
execution status absent from that API. Every observed model must belong to the approved Sonnet family.
