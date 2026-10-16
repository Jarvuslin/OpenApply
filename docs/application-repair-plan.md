# Application repair patches

Requested 2026-10-06. Apply and verify each patch before starting the next. Preserve the existing real Affirm submission; never submit it again. Gmail OAuth remains on hold.

| Patch | Intended behavior | Status |
| --- | --- | --- |
| 1. Job preferences | Choose software engineering, frontend, backend, full stack and other role families in onboarding/settings; empty means any role | Complete: 22 targeted tests and API/web typechecks pass; additive local migration applied |
| 2. Original resume matching | Compare the uploaded original against the full JD and responsibilities; show resume evidence, gaps and separate preference relevance; remove self-overlap points, mutable resume overrides and elapsed-time experience guesses | Complete: 76 scoring/source tests, 70 integration tests, 7 contract tests and API/web typechecks pass |
| 3. Application review | Use the existing JobPilot worker with fuller field readback guidance; review supported answers and documents, then submit autonomously without routine user final-click approval | Complete: guidance checks pass; 32 contract and 15 onboarding tests plus API/web typechecks pass; availability default migration applied |
| 4. Durable submission state | Save reviewed fields/PDF before attempting; retain employer confirmation separately; validate results and retry recording without repeating submission | Complete: focused API, contract and CLI tests pass; local migration applied, API restarted; Affirm preserved as unknown without an application record |
| 5. Dashboard resilience | Ensure delayed or failed loading is visible and recoverable; avoid hidden-tab event streams consuming connections | Complete: 91 web tests pass; deadlines/Retry work live; analytics uses one event feed, and fresh profile plus analytics tabs both load |

The outer coding agent patches and verifies the product. Employer application actions belong to OpenApply's embedded Claude/Codex agent. Tests here use local fixtures; they do not count as the remaining four real applications.

Application autonomy keeps required user input for genuinely unknown facts, failed existing-account login, verification or runtime-required approvals. It does not invent eligibility or success. The employer receipt remains necessary before recording an application as submitted.

## Final verification

| Check | Result |
| --- | --- |
| Biome CI | Pass; three existing informational suggestions in unrelated scripts |
| Knip | Pass |
| API typecheck | Pass |
| Web typecheck | Pass |
| API tests | 642 passed |
| Contracts tests | 34 passed |
| Terminal tests | 273 passed; isolated artifacts directory preserved the running companion |
| Web tests | 91 passed |
| API CLI/recovery tests | 13 passed |
| Diff whitespace check | Pass |

The first full API run caught two missing standard skip-reason phrases in the agent guidance. Those phrases were restored with explicit confirmed-fact requirements; the full suite then passed. Review also caught and fixed receipt recovery after resume deletion and submission permission after a campaign stop.

All additive migrations were applied to the existing local database. The API was restarted through the documented launcher after checking the live process identity. The headed VM and embedded Claude session were preserved; the agent remained READY. No employer form was filled or submitted by the outer coding agent.

Live checks: the original PDF still matches the uploaded source byte-for-byte; the role picker is present without changing saved preferences; the existing Affirm job shows an unknown legacy reservation and has no fabricated application record. Its real employer confirmation remains visible in the VM. After reproducing the analytics stall with two visible dashboard tabs, consolidating status events onto the workspace stream allowed both the profile and a fresh analytics reload to load. Analytics correctly shows zero recorded applications.

The remaining four real applications, account-creation flows, and exact-format resume rewriting have not been retested. The chosen trial document policy remains unchanged original PDF with proposed edits shown separately. Historical Affirm reconciliation still needs the embedded agent and genuine retained evidence; it must never submit again.
