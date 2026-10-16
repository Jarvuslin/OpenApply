# Affirm trial diagnosis and upstream comparison

Reviewed 2026-10-06 against local HEAD `18433567` plus the uncommitted trial changes. Career-ops source inspected at `3be1cdf033d54e977c9770441122c9e7cf3c823f`. This is a source comparison and local failure diagnosis, not a benchmark proving one product gets more interviews.

## Actual outcome

OpenApply's embedded Claude Code `openapply:job-worker` submitted the Affirm Software Engineer I, Frontend (Upfunnel) application. The employer displayed a confirmation. OpenApply did not record an application because retaining the submitted PDF failed. The campaign remained `applying`; the other four tests were not attempted. Do not submit to Affirm again.

The original PDF was used as the user requested after accepting the formatting limitation. The downloaded local copy matched the source hash. This verifies that local copy, not independently the bytes ultimately stored by the employer. No employer account was required; account creation, login recovery, email verification, long-form answers and resume rewriting were not exercised.

Local evidence, deliberately not committed: `.temp/visible-trial-tests.json`, `.temp/vt-affirm-score.json`, `.temp/visible-trial/affirm-employer-confirmation.jpg`, and the embedded-agent transcript under the user's Claude projects directory. Screenshots taken by the outer observer are observer evidence, not embedded-worker artifacts.

## What came from JobPilot

Local Git history identifies shared upstream base `7b48de76` (2026-09-30); OpenApply fork changes begin at `d353c0aa` (2026-10-04). README attribution names `suxrobGM/jobpilot`.

| Area | Origin |
| --- | --- |
| Deterministic fit score, keyword matching, confidence and resume experience fallback | JobPilot; `scoring/fit.ts` and `profile-fit.ts` differ from that base only by package rename |
| Job worker, browser form filling, account instructions, cover letters and application submission | JobPilot foundation, subsequently modified in OpenApply |
| Tailoring engine and fixed Jake PDF renderer | JobPilot foundation; this explains why generating a new PDF changes the original layout |
| Application history, event timeline and analytics | JobPilot foundation |
| Public ATS adapters, provider discovery and employer URL resolver | OpenApply additions (`7f74dc15`), with career-ops acknowledged as an influence on discovery/request shapes |
| MVP queue, headed VM browser/staging and country-specific eligibility inputs | OpenApply additions/modifications |
| Mandatory receipt, all-field answers, immutable submitted PDF and new upload route | Uncommitted work added for this trial; the upload failure belongs to this work |

## Why recording failed

1. The worker uploaded the staged original to Affirm.
2. At 14:49:52 and 14:49:58 Toronto time, OpenApply's `submission-resume` endpoint returned HTTP 500, `Body already used`.
3. The worker clicked Submit at 14:50:05 despite those failures.
4. It read the employer confirmation at approximately 14:50:08.
5. A third archive attempt failed. The returned worker JSON also did not match the new result contract.
6. The orchestrator did not POST a successful result without the required artifact. Consequently there was no application row to count in analytics.

The upload failure is reproduced through the shipped Elysia controller, authentication and route rate limiter, with only storage stubbed. Elysia inferred that the body was needed through the generic rate-limit hook, parsed it, and then the handler called `request.formData()` again. The older upload pattern had been copied without exercising this route through HTTP.

Repair: declare `parse: "none"` on this route so its explicit `request.formData()` is the only parser. Regression: valid multipart passes unchanged bytes to storage and returns 200; missing file returns 400; anonymous requests return 401. Before repair, the first two reproduced the same 500. Earlier service-level tests had not covered the framework parsing boundary.

The second failure is architectural: the evidence gate guarded the later database write, not the earlier external browser Submit. Instructions alone did not stop the worker. Its private reasoning is unavailable. The trace's explicit `head -5` file read does not establish that the full custom-agent instructions were absent: the parent dispatched the real custom agent, whose instructions may load automatically.

The handback used top-level `fields`/`confirmation`/`submissionResume` instead of nested `submission`, `time` instead of `observedAt`, a job key instead of a job UUID, and `resumeVariantId:null` instead of an omitted optional UUID. It could not pass unchanged through the new result API. The null instruction has now been corrected; general handback validation remains a separate improvement.

## Answer accuracy and evidence gaps

- Canadian sponsorship Yes was confirmed by the user. Toronto/Ontario was consistent with the supplied location.
- The orchestrator instructed the worker to answer no previous Affirm employment because the resume did not list Affirm. That inference is invalid. Company-specific employment history requires confirmation.
- The selected source answer described the agent's discovery path, which does not establish how the applicant first learned about the employer.
- An exact country-option lookup timed out; a broader lookup recovered. Empty catch handling obscured the recovery.
- The claimed form screenshot was not present at the reported host path and was requested before the resume upload. There was no complete, durable worker-captured final form snapshot.
- The staged upload displayed a UUID filename, while the handback used the original filename. Receipt timestamps were also slightly inconsistent.
- The signup password had been placed in the orchestrator prompt during preparation. It was not used at Affirm. Future credentials belong in the scoped vault, not transcripts or journals.

## Matching diagnosis

Affirm's recorded preparation scores changed 10 → 59 → 88 as the agent changed the digest. The final digest removed competencies from the scored skill list and asserted zero required years where no number was stated. This demonstrates input instability, not improved candidate qualifications.

`scoreFit` weights skills overlap 50%, experience 20%, and whether the JD's own skills appear in its own requirements 30%. That last component does not measure candidate evidence. Its confidence measures the presence of input fields, not correctness. The function itself does not enforce Toronto or entry-level preferences; other discovery/agent gates must do that.

Synthetic local diagnostics, separate from any real application:

| Fixture | Observed result |
| --- | --- |
| Same matching skills, required years unknown versus asserted zero | 90/100 → 100/100; confidence 0.8 → 1 |
| Retain testing, debugging and code review in the scored skill list | 75/100 instead of 100; the digest's completeness materially changes the result |
| No matching candidate skills, but job skills repeated in requirements | 40/100; `trust` means trust that low score, not approve the application |
| Commentary saying the JD does not state sponsorship restrictions | Incorrect sponsorship blocker |
| One month of employment in early 2020, no explicit experience override | Seven years in October 2026: the fallback counts elapsed calendar time since the earliest start |

The sponsorship false positive and experience fallback remain diagnosed, not repaired in this change. The explicit profile years override bypasses that fallback, so the fixture alone does not prove it affected Affirm. The remaining BMO Associate or Vice President listing also needs renewed entry-level validation before any application.

## Career-ops comparison

| Area | Assessment from inspected source |
| --- | --- |
| Matching explanation | Stronger evidence structure: requirement-to-CV mapping, stated versus inferred importance, explicit gaps and separate evidence confidence. Its global 1–5 score is still an LLM judgment, not validated hiring probability. [Evaluation](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/modes/oferta.md), [scoring rules](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/modes/_shared.md) |
| Form preparation | More detailed instructions for fresh readback, required controls, repeated Workday sections, conditional fields and answer-length checks. This is useful implementation guidance; source inspection cannot prove better live success rates. [Apply mode](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/modes/apply.md) |
| Autonomous submission | Does not meet the requested behavior: it leaves final Submit to the candidate. Its preparation script prints field suggestions and never POSTs applications. [Preparation script](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/prepare-application.mjs) |
| Direct compatibility with this Affirm URL | The preparation script's allowlist omits `job-boards.greenhouse.io`, the host used by Affirm. Its browser instructions are broader, but that helper is not a drop-in replacement. [Host allowlist](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/prepare-application.mjs#L28-L36) |
| Existing accounts | Tracker-history checks are useful, but apply mode explicitly avoids logging into employer portals on the candidate's behalf. It does not supply the requested autonomous existing-account/password-recovery system. [Apply preflight](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/modes/apply.md) |
| Exact original resume format | Its documented PDF flow generates a designed resume. That does not establish support for minor edits to an arbitrary original PDF while retaining its exact layout. [README](https://github.com/career-ops-hq/career-ops/tree/3be1cdf033d54e977c9770441122c9e7cf3c823f#features) |

Recommendation: adapt its requirement evidence table and repeated field verification into OpenApply, while keeping the database, visible VM and employer-confirmation requirement. Do not replace the engine merely because its documentation is more detailed. A fair comparison needs the same frozen job descriptions/profile and independently graded answers, with no new employer submissions for benchmarking.

## Onboarding changes delivered

Added optional preferred name, name pronunciation, pronouns, current company, portfolio URL and up to ten additional links. Province/state, website, LinkedIn and GitHub already existed. Country-specific authorization and sponsorship now preserve true, false or unknown/null. Employer-specific previous employment and first-awareness questions were excluded. No new answers were inferred or saved to the applicant's profile.

The fields are connected through shared schemas, the API, nullable database columns, settings, onboarding review, draft restoration and validation. The additive migration `20261006193000_optional_applicant_fields` was applied to the local database. The API alone was restarted through the documented launcher after verifying its process identity; the VM and terminal were preserved.

The live profile UI displayed all six new fields empty, Ontario/Toronto unchanged, and Canadian authorization/sponsorship still Yes/Yes. No profile Save was clicked. The verification screenshot is `.temp/visible-trial/onboarding-fields-added.jpg`.

Agent instructions now map these optional fields, require checking existing sessions and normal sign-in/email-first flows before signup, treat an empty vault as unknown, park existing-account/wrong-password/ambiguous outcomes, explicitly stop before Submit on archive failure, and omit the variant ID for an unchanged original. These instruction changes are not a mechanically enforced browser barrier or a proven live account flow.

## Additional loading symptom

A fresh profile tab initially stayed fetching with no data, despite the API health endpoint responding. It loaded after the spare analytics tab was closed. Connection starvation is a supported hypothesis, not a confirmed root cause: the local API uses HTTP/1.1, every dashboard tab opens a pilot event stream, and analytics opens two additional streams. Sharing happens only within a tab. The expected subscription count for the observed tabs was five, so browser network evidence is still needed to account for the exact connection limit and any extra/transient streams.

Code inspection rules out the proposed SSE/session-lock interaction: event streams use a separate transport, and the 23 existing session-fetch tests pass. Those tests do not reproduce browser socket limits. Ordinary API queries lack deadlines/cancellation, and the profile view keeps showing progress when there is no data even after a query error. These amplify a stalled request. No general transport changes were made in this diagnosis. A targeted follow-up is to suspend hidden-tab event streams and refresh on return, with bounded GET cancellation and explicit error/retry UI.

## Remaining work before trusting a full run

Enforce and validate a durable pre-submit checkpoint; validate worker result objects; represent employer-confirmed but locally unrecorded outcomes without resubmitting; freeze source-backed matching inputs; repair the negation and experience bugs; remove conflicting generic answer defaults; add account-attempt/verification state; verify the full saved-answer/PDF/dashboard path. Gmail OAuth remains on hold.

The actual Affirm row has not been fabricated or marked submitted during this diagnosis. Recovery must use the existing employer receipt and original artifacts through the normal application workflow, never another Submit click.

Verification so far: 591 API tests, 29 contract tests and 78 web tests pass; API and web typechecks pass; Biome CI and Knip exit successfully. Biome reports three pre-existing informational suggestions in unrelated scripts. A successful automated test suite is not evidence that the employer workflow has passed again.

## Sequential repairs after diagnosis

The findings and test totals above describe the initial diagnosis. Follow [the repair plan](application-repair-plan.md) for the subsequent patches and final verification.

- Job preferences now include explicit role families. The applicant's saved selection remains empty (any role); the patch does not select a specialization on their behalf.
- Matching now compares the immutable uploaded original's text against the complete saved JD, including responsibilities. Each assessed criterion has source locations, a rating and an explanation. The server validates quotes, coverage, source hashes and arithmetic; semantic relevance remains the agent's judgment. Requirements contribute 60% and responsibilities 40%, renormalized when one group is absent. Role preference relevance is reported separately. Old digest/self-overlap and elapsed-calendar-time scoring are removed.
- Application guidance retains the JobPilot-derived worker and adapts career-ops field readbacks. The AI reviews and submits within the authorized scope; a routine human final-click gate is removed. Unknown required facts and actual runtime restrictions still require resolution. Existing-account checks precede signup, and a rejected password is a blocker rather than permission to create an alias or reset it.
- Reviewed answers and the exact PDF must be retained before requesting one submission attempt. Actual employer confirmation is persisted separately from the final Application transaction. The CLI also keeps a normalized receipt file before sending it, so a network/storage failure can recover without another Submit. Worker handbacks are checked against stored state before success is counted.
- Existing in-flight work is migrated to an honest unknown reservation. The local migration found Affirm still `applying` and created that reservation with no fabricated checkpoint, begin timestamp, receipt or Application. This preserves the earlier observed confirmation as a reconciliation task; it does not reconstruct unavailable evidence.
- Profile and analytics loading now distinguish errors from loading/empty states and offer Retry. Cached data and mounted profile edits survive refresh failures. API GET/HEAD requests have a 30-second deadline through body reads; hidden tabs release event streams, and active queries refresh when the tab returns. A later live run reproduced analytics stalling with two visible app tabs while the authenticated API returned in 32 ms outside the browser. Closing the profile tab and retrying immediately restored analytics. Consolidating analytics onto the workspace event stream then allowed a fresh profile and analytics reload to work together. This supports browser connection pressure; the exact socket limit was not measured. Application status/deletion and email-verdict updates now publish workspace events, so removing the extra inbox stream does not lose those refreshes.

These changes protect persisted state and guide the embedded agent. They do not intercept every raw browser action, prove independent employer acceptance, or demonstrate a completed signup flow. No further employer submission was made while patching. Gmail OAuth remains on hold.
