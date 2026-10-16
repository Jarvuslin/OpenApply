# Discover sources, applied status, and scale

> The source lists here are out of date. See [job-board-architecture.md](job-board-architecture.md) for current sources and how search works.

Updated October 7, 2026. This describes the current local implementation and provider research, not a claim of complete market coverage.

## What changed

- Discover has manual **Mark applied**; clicking the resulting **Applied** label removes that manual mark. There is no separate Undo control. Confirmed agent submissions appear as applied automatically and retain their submission history. An attempted submission or opening a career page does not count.
- Applied information is private to the signed-in candidate. Public job pages never expose it. Manual marking requires a browser session; agents must continue recording the existing confirmed submission receipt.
- Saved batch application lists exclude already-applied listings. The saved heart remains independent of application status.
- Search controls now include Canada/US countries and market shortcuts, company inclusion/exclusion, title exclusions, posting/added dates and custom ranges, applied activity, and optional inclusion of unspecified levels.
- Market shortcuts replace city/workplace restrictions but preserve other search filters. Profile defaults and Reset to match profile remain independent of the current search. A US-remote listing describes the job's location; it does not establish the candidate's work authorization.

## Shared collection

The API maintains a catalog of 57 employer ATS feeds and five other public feeds, including Google Careers, in `apps/api/src/modules/job-sources/catalog.ts`. This is application configuration maintained by OpenApply, not a list each candidate has to enter. The catalog includes employers recruiting in Canada and the US; the underlying shared index also retains listings elsewhere. The latest expansion adds 34 verified ATS employers, with [source evidence and early-career examples](employer-feed-verification-2026-10-08.md).

Collection runs outside Discover requests, at API startup and on a five-minute scheduler. Successful employer feeds are due again after 30 minutes; public feeds and failed feeds are due after one hour. Persisted per-feed leases prevent overlapping API instances or the maintenance command from claiming the same feed. There are two feed workers, per-host request throttling, bounded request timeouts and response sizes, and a 2,000-posting cap per catalog employer feed with explicit truncation reporting. Ordinary user imports retain their 500-posting cap. The automatic catalog uses public HTTP feeds and no LLM calls or paid provider keys.

Set `JOB_FEED_REFRESH_ENABLED=false` to disable automatic refresh. To refresh due feeds manually:

```powershell
cd apps/api
bun run scripts/refresh-job-feeds.ts
```

Ashby ingestion preserves listed/unlisted status, workplace, employment type, primary/secondary country metadata, published pay units, and publication dates. Greenhouse update times are not represented as posting dates. Escaped employer HTML is converted to readable text. Listing identity preserves job identifiers such as `gh_jid`, while removing referral parameters such as `gh_src`.

The starter catalog expands coverage; it does not discover every employer or every opening. Source metadata can be absent. Closed-posting reconciliation and a larger employer directory are further work; existing saved/application history must survive any future expiry policy.

The employer catalog is 16 Ashby employers, 37 Greenhouse employers, Palantir on Lever, ServiceNow and Canva on SmartRecruiters, and Hugging Face on Workable. These are selected employer boards, not the entire databases of those platforms.

| ATS | Connected employers |
| --- | --- |
| Ashby | OpenAI, Notion, Ramp, Linear, Cohere, Ashby, Zip, Cerebras, Wealthsimple, 1Password, Replit, Supabase, Perplexity, ElevenLabs, Modal, Cursor |
| Greenhouse | Anthropic, Figma, Datadog, Cloudflare, MongoDB, Airbnb, Affirm, Robinhood, Reddit, Coinbase, Stripe, Databricks, Discord, Duolingo, Dropbox, GitLab, Asana, Scale AI, Brex, Instacart, Roblox, DoorDash, Gusto, Chime, Lyft, Pinterest, Twilio, Okta, Elastic, Samsara, Fastly, Cockroach Labs, Squarespace, Toast, Klaviyo, Webflow, Vercel |
| Lever | Palantir |
| SmartRecruiters | ServiceNow, Canva |
| Workable | Hugging Face |

The broad public feeds are [Remote OK](https://remoteok.com/faq), [We Work Remotely](https://weworkremotely.com/remote-job-rss-feed), the newest monthly Hacker News Who is hiring thread, and [Hacker News job stories](https://github.com/HackerNews/API). Hiring comments are capped at 500 and job stories at 200; actual availability may be lower. HN job stories include YC companies but are not the full Y Combinator jobs database. Cards and detail pages retain original source links and readable attribution.

[Google Careers](https://www.google.com/about/careers/applications/jobs/results/) is a separate, no-key employer feed checked hourly. It reads the first page of four official software-engineer searches: Early experience in Canada and the US first, then the newest Canadian and US results. Each search contributes at most 20 candidates, with at most 60 unique live detail pages checked and three detail requests in flight. HTTP-200 "Job not found" pages are excluded; unexpected layouts fail the refresh instead of silently becoming an empty healthy feed. Real titles, locations, descriptions and career links are retained. An actual Early badge supplies entry-level metadata only when the title has no explicit level; query membership alone does not establish seniority. Posting dates remain unknown because these pages do not supply them. This bounded feed is not complete Google coverage and is distinct from the Google Jobs aggregator.

The live Google adapter check found 56 open jobs, including 21 with an actual Early badge and 20 with a Canadian location. Google searches match job content, so these are not all software-engineer titles; many current Early results are data-center roles. Discover's own title, location and experience filters remain necessary.

Meta's official search currently serves an application shell to the plain-HTTP connector, so Meta is not connected. LinkedIn-only and other employers outside the configured catalog require broader provider discovery or additional verified connectors; expanding this catalog does not make it an exhaustive market index.

LinkedIn, Indeed, Glassdoor, and Y Combinator have prepared Apify actor slots. Google Jobs has a SerpApi connector. Configure an API key and compatible actor in **Settings → Connections**; no paid account or actor was selected for the user. Optional per-actor query/location/limit field mappings accommodate different actor inputs. These connectors do not provide direct access to the job boards' private databases, and an actor's coverage depends on its implementation and account access.

[HiringCafe's official MCP](https://hiringcafe.com/documentation/hiringcafe-chatgpt-app) supports private, on-demand previews without an API key. Its search returns at most 25 jobs, one per company, and has no next-page API. Previews are cached privately in memory for 15 minutes, link to HiringCafe, and never enter the shared index. HiringCafe's [terms](https://hiringcafe.com/terms-and-conditions) restrict republication; neither its free preview nor a configured actor is treated as permission for shared imports.

## Paging and freshness

- Discover defaults to newest first. Genuine publication dates are retained when available; otherwise the listing's first-seen date supplies its sorting date, while the card clearly says the posting date is unavailable.
- The first response establishes an `indexedBefore` cutoff. Later pages exclude newly indexed listings until the user refreshes results, so incoming rows do not shift the current page. This is an arrival cutoff, not an immutable snapshot of later edits to existing listings.
- The browser caches fetched pages and prefetches only the next database page. Paging never launches a paid scrape or downloads the entire index into the browser.
- Discover and Saved use 12 listings per page, filling four rows in the three-column desktop grid. Old `pageSize` URL overrides are removed; other tables retain their existing page sizes.
- A foreground Discover tab checks for matching arrivals every 60 seconds. A **Show new jobs** banner resets the cutoff and opens page one. Changing filters also resets the cutoff; neither action modifies the profile.
- **Sources and freshness** shows actual feed health, last successful import, and connectors requiring setup. **Check for new jobs** schedules due sources in the background with a short request cooldown; it does not override source intervals.
- **Find more jobs**, also offered at the end of results, runs an explicit provider search. SerpApi advances its returned next-page token. Apify actors without a supported cursor are treated as a single bounded batch; the UI does not pretend there are more pages. Paid searches have a persisted lease, 60-second cooldown, and ten-batch cap per user/search per 24-hour budget window. Failed calls still consume a batch allowance because providers may charge them.

After the last indexed page, users can wait for incoming feed jobs, broaden filters, or use Find more jobs. Viewing a listing does not mark it as seen or applied. Employer refresh intervals, network delays, source coverage, and provider limits mean this is periodic updating rather than a real-time copy of the whole job market.

## How upstream projects find jobs

The configured Git upstream is [suxrobGM/jobpilot](https://github.com/suxrobGM/jobpilot). Its [search workflow](https://github.com/suxrobGM/jobpilot/blob/main/plugin/skills/search/SKILL.md) opens a selected job board in the user's browser, searches, paginates, and saves discovered jobs. Its autonomous Pilot orchestrates those searches. It is not an included, continuously refreshed copy of the whole job market. Browser searching uses the local agent subscription and consumes that subscription's usage.

[CareerOps' scan workflow](https://github.com/career-ops-hq/career-ops/blob/main/modes/scan.md) combines configured company portals, HTTP/API or local parsers, browser navigation, and broader web-search queries. Its [scanner](https://github.com/career-ops-hq/career-ops/blob/main/scan.mjs) performs the configured HTTP work without LLM tokens, with deduplication and optional liveness verification. Its coverage depends on the configured sources and queries. Those mechanics are useful for our background collector; importing the project does not supply universal coverage.

## Provider comparison

Prices below were checked October 7, 2026 and can change. These are provider charges, separate from OpenApply hosting and storage.

| Provider | Best use here | Current pricing/constraints |
| --- | --- | --- |
| [TheirStack](https://theirstack.com/en/pricing) | Broad normalized job data, company fields, and updates that can populate a shared job board | API starts at $49/month for 1,500 credits; one returned job costs one credit. 20,000 credits/month costs $240. 500 results/page and four requests/second. |
| [SerpApi Google Jobs](https://serpapi.com/google-jobs-api) | Search-driven discovery across employers beyond our catalog | [Pricing](https://serpapi.com/pricing), USD: 250 searches/month free; $25/month for 1,000; $75/month for 5,000; $150/month for 15,000. A successful search/page request is one search, not one job. This is SerpApi's third-party API for Google Jobs results; it needs a SerpApi key. |
| [Adzuna](https://developer.adzuna.com/) | A publisher-oriented job-search API | App ID/key required. [Terms](https://developer.adzuna.com/docs/terms_of_service) require attribution and define commercial-use conditions; verify the intended use and allowance before integrating. |
| [Apify](https://apify.com/pricing) | Targeted collection from a particular board through a chosen actor | USD: Free includes $5/month in usage credits; Starter is $19/month including $19 credits, then pay as you go. Scale is $199/month including $199 credits. Actor charges, compute and proxies vary; a subscription is not unlimited scraping. OpenApply supports configurable actor connectors. |

**Recommendation:** keep direct employer feeds as the inexpensive base. Evaluate TheirStack as the main broader provider if its coverage and budget fit; use SerpApi for targeted search expansion. An application-owned provider account would remove the need for each candidate to supply a key. No new provider account, subscription, or paid request was created for this change.

For the currently prepared connectors, only SerpApi and Apify keys are relevant. Both offer free tiers; neither requires starting on a paid plan. A read-only audit after the connector work found no saved provider connections, so Google Jobs and the Apify-based boards are prepared but inactive. The automatic employer/public feeds and the bounded HiringCafe preview need neither key.

TheirStack's [terms](https://theirstack.com/en/docs/legal/terms-and-conditions) explicitly discuss job-board display and integrated downstream products. They also impose redistribution and post-termination restrictions, so a subscription should not be treated as permission to serve a permanent public copy after cancellation. Adzuna likewise has attribution/use conditions. Provider storage and display rules belong in the connector design.

## Storage and performance

Before expansion, 1,031 listings occupied 14,254,080 bytes in the listing/source tables including indexes. An earlier snapshot held 5,997 listings and 28,606,464 bytes (27.28 MiB). After the 34 additional ATS employers and Google Careers imported, the October 7 Toronto / October 8 UTC measurement is **12,241 published listings** and **44,662,784 bytes (42.59 MiB)**, including table/index and recent-update overhead. All **62 catalog feeds** refreshed successfully, with no active leases or latest-refresh failures at the audit. Google contributed 56 listings, with logos on 51 and an extracted experience requirement on 55; non-Google brands can retain initials. These are worldwide listings across levels, not 12,241 entry-level software jobs. Before the Google import, the browser verified 35 strict US/Canada entry-level results containing “software.” Logos are URL references, not image files stored in PostgreSQL. Full application documents and PDFs have separate storage costs.

A five-run local measurement of the paginated Canada/US entry-level listing service took 280 ms on first connection and approximately 8–9 ms for subsequent calls. This is a small local sample, not a load test or a guarantee at production scale.

More jobs increase storage and import work. The query path uses server-side filters, pagination, country/date/application indexes, and existing text-search indexes. Background refresh limits concurrency. At larger scale, measure query latency and database size, retain one shared posting instead of a copy per candidate, cache common searches, and reconcile stale postings while preserving private history. A provider offloads collection and enrichment, but still has API latency, quotas, fees, and permitted-cache limits.

## Company logos

The page-three gaps were source-specific rather than a pagination limit: 212 Coinbase postings referenced an image returning 404, 139 Reddit postings missed a valid logo class in the board HTML, and six Hugging Face postings lost their Workable tenant context. The resolver now validates image responses with the existing DNS-pinned public-host checks, tries other genuine candidates when one is broken, recognizes the relevant metadata, and caches page/image lookups so it does not request a logo for every listing.

Remote OK and We Work Remotely employer logo metadata is preserved when supplied. Job-board homepage branding is excluded, including redirect destinations. A conditional backfill updated 793 affected rows: 145 missing logos filled, 241 stale/incorrect images replaced, and 407 job-board images initially removed. Four of those were subsequently recovered from verified matching-company metadata, for **390 missing or incorrect logos repaired** and **403 remaining listings using initials**. All Coinbase, Reddit, and Hugging Face listings now have logos. The repair changed no job identity, saved state, or application history; a final repeat changed zero rows.

The logo repair passed 97 focused tests, API typecheck, and scoped Biome. The pagination change passed web typecheck, and browser verification confirmed twelve cards with all twelve logos loaded on the affected Canadian page three.

## Validation

The expanded listing/source and automation-guard suite passes 252 tests, including Google live-page parsing/closure detection, source coverage, snapshot filters, private preview isolation, durable paid-search leases/cursors, cooldown, and budget cases. API and web typechecks and scoped Biome pass for this expansion. Earlier verification also passed 14 Discover UI logic tests and contract tests. Browser verification covers manual mark/undo, US remote, date filtering, reset to profile, stable paging, the new-jobs banner and refresh action, live HiringCafe previews, and missing-account handling. The temporary manual application used for earlier testing was undone; no real application or paid provider request was sent. Repository-wide CI stops at pre-existing lint/format failures; the remaining full-gate steps were not run as a single successful gate.
