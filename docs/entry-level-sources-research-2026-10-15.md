# Entry-level job sources not yet ingested (research, 2026-10-15)

Scope: ATS boards and public feeds with entry-level tech jobs (new grad, junior, intern, co-op) that
`apps/api/src/modules/job-sources/` does not ingest yet, with emphasis on Canada and Toronto. The repo
already covers Ashby, Greenhouse, Lever, SmartRecruiters, Workable, Workday, Simplify lists, RemoteOK,
WWR, HN, Google Careers, YC, HiringCafe, SerpApi, Apify, and LinkedIn (`http.ts` allowlist, `catalog.ts`).
Endpoints marked "probed" were called on 2026-10-15/16 with plain GETs or POSTs and no login.

## Summary and ranked recommendation

Two findings change the picture. RBC, BMO, TD, CIBC, Canadian Tire, and Thomson Reuters already apply
through Workday, and `catalog.ts` already lists RBC, BMO, TD, and CIBC. So the big Canadian gap is
**SAP SuccessFactors career sites** (Scotiabank, Rogers, TELUS, CN, Sobeys) and **Phenom sites backed
by SuccessFactors** (Bell, OpenText).

1. **SuccessFactors career sites (RMK / "jobs2web")**. High Canadian value, low effort. The search page
   sorts by date and shows `jobDate` ("Oct 15, 2026"). The job page has
   `itemprop="datePosted"`. robots.txt disallows `/services/` but not `/search/`, `/job/`, or `/feeds/`.
2. **Phenom `/widgets` JSON** (Bell, OpenText, and other Phenom sites not on Workday). High value,
   medium effort. `postedDate` is an ISO timestamp. This endpoint is undocumented and internal.
3. **Canadian GitHub lists**. Cheap and high value for co-ops. `negarprh/Canadian-Tech-Internships-2027`
   has 489 rows (321 in Ontario), a "Date Posted" column, and direct ATS links. Also,
   `SimplifyJobs/Summer2026-Internships` was **renamed to Summer2027-Internships**. The allowlisted raw
   URL still serves the same content through the rename, but it should be repointed.
4. **Big-employer custom APIs**. Medium value, low effort: Microsoft (Eightfold PCSX `postedTs`, epoch
   seconds; Vancouver/Toronto roles), Nokia (Oracle Recruiting Cloud `PostedDate`; Ottawa/Kanata), and
   Amazon (`posted_date` as "October 16" text; Toronto/Vancouver new-grad SDE roles).
5. **Small-ATS adapters**. Cheap, but low Canadian entry-level value: Recruitee, Breezy, Personio,
   Teamtailor, Gem, Rippling, and Pinpoint. Add them only when discovery finds boards on them.
6. **Remote aggregators** (Himalayas, Jobicy). Low to medium value. Their ToS ask for attribution and
   forbid passing jobs on to other aggregators. Fine for one user's private queue; do not republish.
7. **Skip**: Job Bank (its ToS ban automated access), Adzuna (licence needed after a 14-day trial),
   Remotive, The Muse (stale for Canada), Arbeitnow (EU), USAJobs (US federal only), and the
   login-walled or anti-bot sites (Indeed, Handshake, RippleMatch, Wellfound, Levels.fyi, Built In,
   Welcome to the Jungle/Otta, Eluta, CareerBeacon, Talent.com).

## Table

| Source | Type | Access | ToS risk | Posting-time field + format | Entry-level / Canada | Example (probed unless noted) |
| --- | --- | --- | --- | --- | --- | --- |
| SuccessFactors career site | ATS (SAP) | Public HTML + RSS | Low-med (robots blocks `/services/`) | Search `span.jobDate` "Oct 15, 2026"; job page `itemprop=datePosted` "Thu Oct 08 02:00:00 UTC 2026"; RSS `pubDate` (date only, sometimes refresh date) | High: Scotiabank, Rogers, TELUS, CN, Sobeys | `https://jobs.rogers.com/search/?q=intern&sortColumn=referencedate&sortDirection=desc` |
| Phenom (on SuccessFactors) | Career-site layer | Undocumented POST JSON, no auth | Medium | `postedDate` "2026-10-15T00:00:00.000+0000"; `dateCreated` exact timestamp | High: Bell, OpenText (RBC and BMO are Phenom over Workday, already covered) | `POST https://jobs.bell.ca/widgets` with `ddoKey: refineSearch` |
| Canadian GitHub lists | Community list | raw GitHub markdown | Low-med (no licence file) | "Date Posted" `Oct 10, 2026` (negarprh); "Age" `2d` (speedyapply); "Posted" `4h` (zapply) | High for co-ops | `raw.githubusercontent.com/negarprh/Canadian-Tech-Internships-2027/main/README.md` |
| Simplify Summer2027 | Community JSON | raw GitHub | Low (already used) | `date_posted` epoch seconds | High; 369 active Canadian rows | `.../SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json` |
| vanshb03 Summer2027 | Community JSON | raw GitHub, MIT | Low | `date_posted` epoch seconds | Low: 471 rows, last post 2026-08-21 | `.../vanshb03/Summer2027-Internships/dev/.github/scripts/listings.json` |
| Microsoft (Eightfold PCSX) | Employer API | GET JSON, robots `Allow: /api/pcsx` | Low-med | `postedTs` / `creationTs` epoch seconds | Medium: Vancouver, some Toronto | `apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=software&location=Canada` |
| Oracle Recruiting Cloud | ATS | Public REST, no auth | Low-med | `PostedDate` "2026-10-15" (date) | Medium: Nokia (Ottawa); other Canadian tenants unverified | `fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_1,...` |
| Amazon jobs | Employer API | GET `search.json` | Low-med | `posted_date` "October 16" (no year); `updated_time` "about 2 hours" | High: Toronto/Vancouver SDE new grad | `www.amazon.jobs/en/search.json?base_query=software&sort=recent` |
| Avature | ATS | Public RSS on some tenants | Low | RSS `pubDate` RFC 822 | Medium: EA, Ubisoft (Montreal, Toronto) | `jobs.ea.com/en_US/careers/SearchJobs/feed/` |
| Recruitee | ATS | `GET /api/offers/` | Low | `published_at` "2026-10-15 09:31:36 UTC"; `created_at` | Low (mostly EU) | `bunq.recruitee.com/api/offers/` |
| Breezy HR | ATS | `GET /json` | Low | `published_date` ISO | Low | `breezy.breezy.hr/json` |
| Personio | ATS | `GET /xml` | Low | `<createdAt>` ISO | Low (EU) | `personio.jobs.personio.de/xml` |
| Teamtailor | ATS | `GET /jobs.rss` | Low | `pubDate` RFC 822 | Low-med | `career.teamtailor.com/jobs.rss` |
| Gem | ATS | `GET job_board/v0/{board}/job_posts` | Low | `first_published_at`, `created_at` ISO (Greenhouse-shaped) | Low-med (startups) | `api.gem.com/job_board/v0/gem/job_posts` |
| Rippling ATS | ATS | `GET api/v2/board/{slug}/jobs` | Low | List: none. Detail: `createdOn` ISO with offset | Low-med | `ats.rippling.com/api/v2/board/rippling/jobs` |
| Pinpoint | ATS | `GET /postings.json` | Low | None in list (`deadline_at` only) | Low | `workwithus.pinpointhq.com/postings.json` |
| BambooHR | ATS | `GET /careers/list` (JSON with `Accept: application/json`) | Low | List: none seen. Detail `datePosted` (unverified) | Low-med (Canadian SMBs) | `zapier.bamboohr.com/careers/list` returned an empty list |
| Himalayas | Remote feed | Free, key optional | Medium (no aggregators) | `pubDate` epoch seconds | Low-med; `country=CA` filter | `himalayas.app/jobs/api` |
| Jobicy | Remote feed | Free | Low-med (credit, original apply URL) | `pubDate` ISO | Low; `geo=canada` | `jobicy.com/api/v2/remote-jobs?geo=canada` |
| Remotive | Remote feed | Free | High (24h delay, no third-party boards) | `publication_date` ISO, no zone | Low | `remotive.com/api/remote-jobs` |
| Arbeitnow | Feed | Free | Low | `created_at` epoch seconds | Very low (EU) | `www.arbeitnow.com/api/job-board-api` |
| The Muse | Feed | Free (key optional) | Low | `publication_date` ISO | Low: Toronto entry level returned 2025 Optum remote roles | `www.themuse.com/api/public/jobs?level=Entry%20Level&location=Toronto%2C%20Canada` |
| Adzuna | Aggregator API | Free key | High for product use | `created` ISO UTC | Medium (adzuna.ca); links route through Adzuna | docs only |
| Job Bank (Canada) | Government | Atom feed + monthly CSV | High for feed (automated access banned); low for CSV (OGL) | Atom `<updated>` ISO; CSV is monthly | Medium; few tech new-grad roles | `www.jobbank.gc.ca/jobsearch/feed/jobSearchRSSfeed?searchstring=software+developer&locationstring=Toronto%2C+ON&sort=D` |
| iCIMS, Jobvite, Taleo, UKG, Paylocity, JazzHR, Dover | ATS | Not confirmed | — | Unverified | Unverified | See notes |

## Per-source notes

**SuccessFactors career sites.** The career sites of Scotiabank, Rogers, TELUS, CN, and Sobeys load
SuccessFactors assets (fingerprinted from `jobs.scotiabank.com`, `jobs.rogers.com`,
`careers.telus.com`, `careers.cn.ca`, and `jobs.sobeys.com`). TELUS also links to `myworkdayjobs.com`.
- `/search/?q=…&sortColumn=referencedate&sortDirection=desc&startrow=N` shows 25 results per page,
  with a "Results 26 – 50 of 960" label (Scotiabank, "intern") and a `jobDate` on each row.
- Each job page has `itemprop="datePosted" content="Thu Oct 08 02:00:00 UTC 2026"`.
- RSS at `/feeds/(keywords)/?locale=en_US` returns only 20 items. Rogers had a mix of `pubDate`
  values, but every Scotiabank item read "Fri, 16 Oct 2026 2:00:00 GMT". Treat RSS dates as
  unreliable and prefer `jobDate` or `datePosted`.
- `/sitemap.xml` on Scotiabank is a 39 MB Google Base RSS with all 1,497 jobs, carrying
  `g:expiration_date` but no posting date.
- robots.txt on both sites disallows `/services/` (the RSS alias `/services/rss/job/`), `/applybutton/`,
  and `/talentcommunity/`; see `https://jobs.rogers.com/robots.txt`.
- Job links go to the employer site, and the apply step runs inside SuccessFactors.

**Phenom.** These sites embed `phApp.ddo` JSON in `/search-results`. `POST /widgets` with
`{"ddoKey":"refineSearch","keywords":…,"from":0,"size":10,…}` returned JSON with `totalHits` and jobs
carrying `postedDate` and `dateCreated` (Bell, probed).
- RBC and BMO apply URLs point to `rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1` and
  `bmo.wd3.myworkdayjobs.com/External`, which are already in `catalog.ts`.
- Bell and OpenText job pages reference `successfactors.eu/odata/v2/JobReqScreeningQuestion`, so they
  have no Workday fallback.
- robots.txt (`https://jobs.rbc.com/robots.txt`) disallows `*/apply`, `*/jobcart`, and `*/px-widgets`,
  but not `/widgets` or `/search-results`. The endpoint is undocumented, so its schema can change
  without notice.

**GitHub lists.** Data was read from raw files; licences came from the GitHub API, where only vanshb03
reports `"spdx_id":"MIT"` and the others have no licence. The facts in these lists are probably not
copyrightable, but a list compiled without a licence is legally grey. OpenApply already relies on
Simplify on the same basis.
- `negarprh/Canadian-Tech-Internships-2027` (1,246 stars, pushed 2026-10-15): a markdown table
  `| Company | Role | Location | Apply | Date Posted |` linking straight to the ATS (for example
  `jobs.lever.co/magnetforensics/...`).
- `speedyapply/2027-SWE-College-Jobs`: `NEW_GRAD_INTL.md`, with an `Age` column (`2d`) and 78 Canadian
  mentions.
- `zapplyjobs/Canada-Internships-2027`: a `Posted` column (`4h`), but its links go through `zapply.jobs`
  redirects rather than the employer.
- `SimplifyJobs/Summer2026-Internships` now returns HTTP 301 from `api.github.com` (renamed). Its raw
  `listings.json` is byte-identical to the Summer2027 file (17,304 rows).
- `SimplifyJobs/New-Grad-Positions` is still active (pushed 2026-10-16).
- `vanshb03/Summer2027-Internships` has been stale since 2026-08-21.

**Microsoft (Eightfold).**
- `/api/apply/v2/jobs` returned 403 "Not authorized for PCSX".
- `/api/pcsx/search?domain=microsoft.com&query=…&location=Canada&start=0` returned `data.positions[]`
  with `postedTs`, `creationTs`, `standardizedLocations`, and `positionUrl`.
- robots.txt (`https://apply.careers.microsoft.com/robots.txt`) explicitly allows `/api/pcsx`.
- Other Eightfold tenants have different domains. The tenant `aexp.eightfold.ai` returned 404.

**Oracle Recruiting Cloud.** `jobs.nokia.com/en/sites/CX_1` is ORC. The public `hcmRestApi` finder
call above returned `TotalJobsCount: 54`, plus `Id`, `Title`, `PostedDate` (date only), and
`PrimaryLocation`. Page through results with `limit`/`offset` inside `finder=`. This is the documented
"Candidate Experience" REST resource (docs not fetched in this pass). No Canadian bank or telecom
using ORC was confirmed.

**Amazon.** `search.json` returns `posted_date` ("October 16", no year, so the year has to be inferred)
and `updated_time` (relative text), `job_path`, and `url_next_step`. With `country[]=CAN` it still
returned Redmond jobs, so the correct Canada filter parameter is unverified (`loc_query` and
`normalized_country_code[]` are candidates). robots.txt (`https://www.amazon.jobs/robots.txt`) only
disallows `/internal`.

**Avature.** `jobs.ea.com` and `careers.ubisoft.com` show Avature markers. EA's
`/careers/SearchJobs/feed/` returned RSS 2.0 with `pubDate` and links to `/careers/JobDetail/...`.
Feed availability varies by tenant.

**Small ATSs (probed).**
- Recruitee (`published_at`, `careers_apply_url`). Tenants checked: bunq and channable worked; mollie,
  miro, and picnic returned 404, so they are not on Recruitee.
- Breezy (`published_date`).
- Personio XML (`createdAt`).
- Teamtailor RSS (`pubDate`, `tt:` location namespace).
- Gem (`first_published_at`, the same shape as Greenhouse, so the Greenhouse parser can be reused).
- Rippling: the list has no date; the detail call `/jobs/{uuid}` returns `createdOn`.
- Pinpoint: no posting date in the list.
- BambooHR: `/careers/list` returns `{"meta":{"totalCount":0},"result":[]}` for a tenant with no
  openings. A tenant with live jobs was not found, so the date field is unverified.

**Not verified in this pass (endpoints known from community scrapers, not probed):**
- iCIMS: `careers-{tenant}.icims.com/jobs/search?in_iframe=1`, HTML with "Posted Date". The test tenant
  `careers-icims` returned 404 "gone".
- Jobvite: `jobs.jobvite.com/{tenant}/jobs`, HTML. The official feed needs an API key.
- Taleo: `{tenant}.taleo.net/careersection/rest/jobboard/searchjobs`, POST.
- UKG: `recruiting.ultipro.com/{tenant}/JobBoard/{guid}/JobBoardView/LoadSearchResults`, POST, with
  `PostedDate`.
- Paylocity: `recruiting.paylocity.com/recruiting/jobs/All/{guid}`.
- JazzHR: `{tenant}.applytojob.com`.
- Dover: `app.dover.com/api/v1/careers-page/{id}/jobs`.

Treat all of these as unverified until a Canadian entry-level tenant is found through discovery.

**Remote feeds.**
- Himalayas (`https://himalayas.app/api`): free key, 60 requests/min and 10k/day, data refreshed daily.
  Requires a link back and naming Himalayas; asks not to submit its jobs to other job boards or
  aggregators. `/jobs/api/search?country=CA`. `pubDate` is epoch seconds and there is cursor paging.
- Jobicy: the response's `friendlyNotice` asks for a credit with a direct link and for apply buttons to
  use the original job URL.
- Remotive: the response's `0-legal-notice` asks for no submission to third-party sites, a link back,
  at most 4 calls a day, and says jobs are delayed 24h.
- Arbeitnow: `created_at` epoch seconds; EU-focused.
- The Muse: has a useful `level=Entry Level|Internship` filter, but the Toronto results were 2025
  remote US roles.

**Adzuna** (`https://developer.adzuna.com/docs/terms_of_service`):
- Default limits are 25 hits/min and 250/day.
- Uses beyond ad listings and personal research are limited to a 14-day trial, after which a licence
  may be required.
- Requires an "Adzuna" attribution logo. `redirect_url` routes through Adzuna (per the docs at
  `https://developer.adzuna.com/docs/search`).
- `created` is ISO UTC.

**Job Bank Canada.**
- The Atom feed (probed) returns about 10 entries with `<updated>` and links to
  `jobbank.gc.ca/jobsearch/jobposting/{id}`. robots.txt sets `Crawl-delay: 5`.
- The job-seeker terms (`https://www.jobbank.gc.ca/termsofuseseeker`, found via search, not fetched)
  prohibit any "script, robot, spider … automated device" accessing the service.
- The open-data alternative is monthly CSV under the Open Government Licence
  (`https://open.canada.ca/data/en/dataset/ea639e28-c0fc-48bf-b5dd-b8899bd43072`). It lags by weeks,
  so it is no use for freshness.
- The XML feed channel is inbound only, for job boards sending postings to Job Bank
  (`https://www.jobbank.gc.ca/network`).

**Skipped (no public API, or login and anti-bot walls; not probed):** Indeed (Publisher API closed),
Handshake, RippleMatch, Wellfound, Levels.fyi, Built In, Welcome to the Jungle/Otta, Work at a Startup
(YC is already covered through yc-oss), Talent.com (partner XML only), Eluta, CareerBeacon, Government
of Canada GC Jobs/FSWEP, and USAJobs (free key, but US federal roles only). All of these are unverified.
