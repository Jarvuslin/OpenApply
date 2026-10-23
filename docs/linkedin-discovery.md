# Personal LinkedIn discovery

LinkedIn discovery is optional and off by default. Configure up to four saved searches in
**Settings → Connections → LinkedIn discovery**. This configuration is separate from the
candidate profile and Discover filters. The separate server-side
[JobSpy worker](../services/jobspy-worker/README.md) must be running with the owner's personal
OpenApply API token. It needs no LinkedIn account, cookies, browser, proxy or paid provider key.
Automated discovery is against LinkedIn's terms and may be rate limited.

## Collection and application boundary

- The worker uses the exact released `python-jobspy==1.2.0` package with a restricted logged-out
  HTTPS transport. It collects the last 24 hours, at most 50 results/five requests per search,
  and never requests job descriptions or follows redirects to a login page.
- Daily runs are claimed through `POST /api/job-sources/linkedin/runs`. The server locks the
  owner's settings, snapshots their searches, and gives the worker a hashed, expiring lease.
  Disabled users cannot claim runs. A claimed run advances the next eligible time by 24 hours.
- `POST /api/job-sources/linkedin/ingest` accepts that owner's leased results. It rejects client
  application URLs, cross-owner leases, excess results, missing searches and altered retries.
  Repeating a completed payload returns its original result without reimporting.
- Non-200/blocked/empty responses stop the entire worker run. The worker stores a 24-hour
  backoff on disk; the API stores a matching per-user cooldown. The worker retries no LinkedIn
  request. Pending API ingestion is persisted separately and can be retried idempotently.
- LinkedIn URLs are attribution only. The existing ATS resolver probes supported employer
  feeds and requires an unambiguous title/location match. It shares fetched responses within
  a run and stops starting resolution requests after a 90-second budget.
- Resolved postings are checked using the employer title, `listedExperience()` and saved
  location/remote/country rules. Explicit senior roles or excessive required experience are
  rejected. An entry title or verified permitted experience is required; internships follow
  the chosen search setting. No resume scoring is used.
- Unresolved postings remain visible as personal Discover listings without an apply URL.
  They cannot enter the apply queue. LinkedIn remains in the application's blocked-site list.
  Public lists, sitemap, facets and other users cannot reveal private listings or attribution.
- Listings dedupe by canonical source URL, verified employer URL, then existing posting identity.
  A later independent public ATS feed can promote a private listing without exposing its
  private LinkedIn attribution to other users.

## Live verification — October 7, 2026 Toronto / October 8 UTC

Three first-page `software engineer` / Canada searches were made: baseline, `f_E=1`
(Internship), and `f_E=2` (Entry level). Each returned HTTP 200 and ten cards. All three returned
the **same ten job IDs**, including senior titles. Therefore **`f_E` was not reliable and is
disabled in production**. The wrapper retains a tested experimental injection point for
isolated verification; saved experience preferences are enforced using the employer posting.

Observed traffic was **one page per test, three successful pages total**. No throttling occurred
in that sample. This is not a measurement of the maximum pages before throttling, and the
five-page production ceiling has not been verified live. No further LinkedIn requests were
made to measure the resolver.

The resolver was run against the ten unique saved cards using employer ATS feeds only:

| Outcome | Count |
| --- | ---: |
| Unique LinkedIn listings | 10 |
| Unambiguous employer ATS URLs | 3 |
| Unresolved | 7 |
| Resolver hit rate | **30%** |

Both 7shifts postings and the Emburse posting resolved. Canadian city/province abbreviations
were normalized using explicit region evidence; the confidence threshold remains 0.88.
The PointClickCare posting remains unresolved because its ATS location lacked province/country
evidence. Resolution is separate from entry-level eligibility: resolving a senior role does
not make it eligible for the apply queue. With Canada, entry level and at most two required
years selected, **one of the ten listings qualified**, two resolved listings were filtered out,
and seven remained unresolved. The qualifying 7shifts posting requires two years; it is not
described as a verified new-graduate role.

The small sample is not a general coverage estimate. The resolver currently supports Ashby,
Greenhouse, Lever, SmartRecruiters and Workable; company-specific systems such as Amazon's
are not automatically resolved by this implementation.

Aggregated guest-page evidence lives in
[the worker's live-check record](../services/jobspy-worker/docs/live-check-2026-10-07.json).
Local raw cards and resolver evidence were saved under `.temp/jobspy-live/` without importing
those sample jobs or enabling any user's settings.

## Validation

Coverage includes the pinned parser fixture, f_E injection, maximum pages/results/searches,
blocked-page and non-200 backoff, pending-payload recovery, token isolation, opt-in/daily claim
limits, owner/lease isolation, idempotent ingestion, ATS metadata filtering, listing dedupe,
private query boundaries, and rejection of unresolved/LinkedIn URLs by the apply queue.

The database migration is additive. The worker and API do not start an application or open
the user's LinkedIn session. See the worker README for local/container startup and scheduling.
