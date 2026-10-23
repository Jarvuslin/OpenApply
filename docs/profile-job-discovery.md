# Profile-based job discovery and saved application lists

Discover now offers two actions. **Find jobs for my profile** collects and scores a private
candidate list. **Find and apply** also authorizes applications from that list up to the chosen
limit. A prepared preview can later be applied without creating another list or searching again.

The original resume selector fixes the scoring source for the list. Desired roles, level and
locations guide search queries. If roles are unrestricted, job titles evidenced in the selected
original resume suggest queries without changing profile preferences. Qualification scores
remain original-resume versus full JD; a rewrite cannot inflate the original score.

## Data flow

1. Create a Campaign with a selected original resume, saved minimum score, candidate limit,
   application limit and preview/apply intent.
2. Collect results from configured HTTP connectors, public employer boards or permitted agent
   search. Save private candidate rows with complete source descriptions, canonical identities
   and source attribution. Public search excerpts remain separate.
3. Open full postings and score saved candidates. Persist original-source evidence/gaps plus
   separate level, work-mode, employment-type, location and explicit hard-eligibility checks.
4. Complete collection through the dedicated endpoint after every resolvable candidate is
   assessed. Unavailable/blocked rows retain their reasons and are excluded from application
   readiness. Coverage states sources, observed counts, limits and stopping reason.
5. Apply only from the saved list, after explicit apply authorization. Recheck current fit,
   preferences, list intent and submission reservations. Use one application worker at a time.
6. Preserve factual rewrites, exact uploaded/archived PDFs, field answers and genuine employer
   receipts. Submission uncertainty remains a reservation; restarting must not submit twice.

The minimum is a user choice, including 20/100. Missing resume evidence does not prove a person
lacks a skill. Ordinary qualification gaps do not become hard eligibility knockouts. Known
preference conflicts and genuinely nonnegotiable employer requirements remain separate checks.
Unstated employer preferences are visible unknowns; sponsorship silence is not a promise.

## Scope and honest coverage

This does not promise every opening on the internet. Default collection is bounded to 100
candidates and automatic applications to five, editable before launch. Providers may return
only one response or limited pages, require the user's own connector, or fail. These limitations
must appear in coverage rather than silently looking like an exhausted market. No new paid
connector is enabled automatically.

Campaign rows are paginated. Existing campaign details show scores, evidence and checks. The
general job library is also paginated instead of showing only its first twelve rows. A qualified
count represents promoted scored candidates and historical submitted records, not newly queued jobs.

## Activation and validation

The implementation is saved in the workspace. The live stack stopped during the separate
five-application trial, so no new discovery run or UI rendering is claimed as verified here.
Read `five-application-trial-2026-10-07.md` for the interrupted run and receipt-recovery requirements.
Use the normal local startup procedure after review; no database migration is needed for this
feature.

Final local validation on October 7: 303 API tests across discovery, campaign, application,
scoring and Pilot agenda modules passed; 43 contracts tests passed; API and web typechecks
passed. Two source-coverage grouping tests also passed. Scoped Biome and diff checks passed.
These checks use local test doubles and do not establish live provider, browser or employer
success. No application account, form or submission action was launched during this patch.

One remaining reliability limitation: initial list creation does not yet accept an idempotency
key. A lost response followed by a retry may create an extra campaign. Existing cross-campaign
submission guards still protect against duplicate employer applications; continue a known saved
list rather than blindly creating another after a timeout.
