# Profile discovery: save a list, score it, then apply

Used by `search` for previews and `auto-apply` for an explicitly authorized application run.
Start with `openapply-api GET /api/health`; stop clearly if the API is unavailable. Read setup,
blocked-sites, original-fit, campaign-flow and submission-recovery. Keep the headed browser
and campaign progress visible. The API owns state; never create a second orchestrator or write
the database directly.

## Resolve the saved list

With a campaign ID, GET `/api/campaigns/<id>` and preserve its selected `config.resumeId`,
minimum, maximums and `config.discovery`. A preview does not authorize applications. Never
change the main profile or primary resume to suit this search.

Without a campaign, use the requested original resume or the saved primary and POST
`/api/job-sources/profile-list` with `{resumeId,intent:"preview"|"apply",maxJobs,maxApplications}`.
Omit unrequested limits to use the API defaults (100 candidates, 5 submissions). Explicit
user limits override defaults. The response has `campaignId`, `resumeId`, `minScore`, `searches`
and `coverage`. A plain request to find jobs is preview; an explicit request to find and apply
authorizes apply. Link `$OPENAPPLY_WEB/campaigns/<id>` immediately.

Saved roles and locations drive the searches. With no role restriction, resume job titles are
query suggestions only, not new user preferences. Inspect the original resume to refine vague
suggestions such as "jobs". Do not replace an entry-level preference with the seniority of a
past title. Keep skill-based query variants broad enough to find transferable work.

## Collect before applying

If `coverage.phase` is `complete`, reuse the saved list; do not scrape again. Otherwise:

1. Read `/api/job-sources/connections` and `/api/job-boards`. For each planned query/location,
   use an already enabled HTTP connector when available:
   `POST /api/job-sources/discover {campaignId,provider,query,location,limit,board?}`.
   Read its fetched/saved/resolved/truncated counts. Public employer boards use
   `POST /api/job-sources/boards {campaignId,provider,slug}`. Never enable a paid connector,
   invent an API key or import cookies just to continue discovery.
2. When connectors are unavailable, use available web search/full-page fetching or an allowed
   configured board in the visible browser. Save each actual result in the same campaign as
   pending with a stable key and original URL. Resolve aggregator links to employer postings
   before form work. Never browse a blocked site or bypass a runtime restriction.
3. Read complete employer descriptions, including paragraphs outside Requirements. Save them
   without summarizing or truncating. Provider snippets remain discovery data until the full
   posting is obtained. Canonicalize/dedupe across providers and check prior applications;
   keep each candidate's source URL. Reuse existing rows on interruption rather than cloning.
4. Paginate supported sources until their actual end or the saved candidate limit. Some HTTP
   providers expose only one response: report that coverage limit instead of repeatedly
   fetching the same page or claiming the whole market was searched. Never say "all jobs"
   without qualifying the sources, pages and stopping reason. Retain source errors visibly.

Fetch every saved page (`GET /api/campaigns/<id>/jobs`, limit up to100); `.pagination` governs
coverage. Do not treat the first UI page or first connector response as the complete list.

## Score the whole collected list

Delegate batches of at most five to one `job-worker` at a time in score mode, passing the
saved `campaignId`, `resumeId`, campaign minimum and existing `{jobKey,url,title,company}`
rows with `save:"patch"`. The worker must read the full posting and save original-source
evidence, gaps, `roleMatch` and `preferenceChecks`. Digests and rewritten PDFs are not scoring
sources. Missing full text remains unscored; explain and park the affected row, then continue.

Reconcile **every retrieved candidate** with its saved row and current score or named unresolved
reason. A candidate is not qualified merely because it was imported. Preserve exact employer
eligibility questions; ordinary qualification gaps are candid stretch-fit information, not
automatic knockouts. Your configured minimum may be20; do not substitute a personal60/80 rule.
Missing preference details in a posting are visible unknowns, not invented matches.

After all resolvable rows are scored and unresolved rows are visibly parked, POST
`/api/job-sources/profile-list/<id>/complete {reason:"<sources/pages, exhaustion/limit/blockers>"}`.
Include honest browser-search coverage in the reason when those sources were not imported
through the connector API. A409 means remaining work is unresolved; inspect the named row,
do not force the phase through a generic config update. Report ready, skipped and unresolved
counts separately. Keep the campaign in progress so a prepared preview can later be applied.

For preview intent, stop here with the saved list link. Do not approve or apply any row.

## Apply from the saved list

Require `config.discovery.phase:"complete"` and `intent:"apply"`. The explicit UI action
"Apply from this list" calls POST `/api/job-sources/profile-list/<id>/apply {maxApplications}`;
a request to apply a previously previewed list may use that same endpoint within its
stated count. Never interpret a request to inspect scores as application authorization.

1. Inspect saved submission attempts before changing any applying/approved/parked row. A
   begun, unknown or recording-pending attempt is recovery work, never a fresh form.
2. Read all pages and rank eligible saved rows by score (stable creation/key tie-break).
   Exclude known role/preference conflicts, scores below the saved minimum and hard unmet
   eligibility. Park required unknown facts. A `needs_review` verdict with ordinary gaps is
   for agent review, not routine user approval. Never rewrite a cached score to qualify.
3. Re-read the campaign before each job. Stop for pause, non-apply intent or the saved
   `maxApplications` reached by real recorded applications. Do not replenish this list with
   another scrape during the apply phase. Preserve leftover candidates for later.
4. For an eligible pending row PATCH approved, then applying. Let server gates and duplicate
   protection reject stale/unknown inputs. Pass the exact saved job key and resume to one
   apply-mode worker. Never dispatch a naked URL that creates a new campaign or changes base.
5. The worker checks existing accounts, tailors a minor factual one-page PDF, saves before/after
   wording and final answers, reviews the actual form and submits within authorization.
   All actual runtime restrictions still apply. Park only the affected case and continue.
6. Validate the unchanged handback through worker-result-check. Count only recorded application
   IDs backed by a genuine receipt and exact archived PDF. Recover receipt persistence without
   another Submit. Audit saved answers, history and analytics; report unavailable checks.

Never mark the whole campaign completed while pending or parked candidates remain. At a cap,
leave the remaining list available and report that the authorized batch ended. A successful
rewrite, a click on Submit or a queued record is not a confirmed application.
