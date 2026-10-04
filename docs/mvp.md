# OpenApply MVP

Use the repository [README](../README.md) for current installation instructions. This document records capabilities and limitations without publishing applicant data or local run artifacts.

## Verified locally

- Onboarding autosaves incomplete drafts; original uploads and structured résumés survive reloads.
- PDF/DOCX/TXT extraction, generated résumé PDFs and a before/after rewrite review.
- Public Ashby/Greenhouse imports, including nullable remote flags and Ashby board names containing spaces.
- Location, title-derived job level and explicitly stated years-of-experience filters. Unknown experience is excluded when a numeric maximum is selected.
- Embedded Claude Code can inspect live forms through the VM's Playwright MCP, generate variants and journal preparation outcomes.
- Long multilingual composer messages survive terminal delivery using bracketed paste.
- A local rewrite completed from one instruction without corrective follow-ups; output quality was mixed and the suggestion remained unaccepted.

## Not yet established

- An unattended full application with no developer intervention.
- Signup, email activation and sign-in together through the embedded agent. An earlier operator-assisted employer account test is not proof of autonomous operation.
- Reusing Claude/Codex Gmail connectors inside the worker. The current email skill uses direct app OAuth.
- Reliable CAPTCHA handling; solving is disabled and blocking challenges pause.
- A working Windows Codex CLI launch across installations.

## Runtime design

The API owns profile facts, résumé versions, questions, application state and receipts. The Pilot host clears model context per cycle; per-job workers isolate browser content. Keep browser logins persistent. Execute jobs sequentially on the shared browser. Check hard eligibility and duplicate applications before acting. A fit score never overrides an explicit eligibility mismatch.

Record retries, missing facts and operator interventions. Do not claim an autonomous pass when an external operator repairs or completes a step. A visible employer receipt is required before an application is marked submitted. Unknown information remains unknown.

The optional local fixture is explicitly simulated and proves only fixture behavior. It must never be reported as a real Gmail, CAPTCHA or employer submission test.
