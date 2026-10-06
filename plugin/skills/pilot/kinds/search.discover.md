# `search.discover`

Payload `{searchId, query, board?, resumeId?, minScore, campaignId?, newJobsTarget, maxPages}`. Run ONE board search, modeled on the `search` skill (login per `../../_shared/auth.md`). `SEARCH_ID=<payload.searchId>` - the run is reported against it before Record. A `campaignId` in the payload means reuse it (`CID=<payload.campaignId>`); never open a second campaign for one search. Only when it is absent, create one - `pilotSearchId` is load-bearing, it is how the next cycle finds this campaign again:

```bash
openapply-api POST /api/campaigns \
  --data '{"query":"<query>","source":"auto_apply","createdBy":"pilot","pilotSearchId":"<SEARCH_ID>","config":{"resumeId":"<resumeId>","minScore":<n>,"board":"<board>"}}'
```

Read `.campaignId` from the response as `CID`.

Paginate per `../../_shared/browser-tips.md` (**Pagination & infinite scroll**) up to `maxPages` pages. Score every row **in-context** - no per-job navigation, no worker delegation, since the shared browser tab would serialize them anyway. Per row: dedupe via `GET /api/applied/check`, then create every Job as a non-terminal `pending` row carrying the `digest` you scored it from (`../../_shared/digest-schema.md`; row shape per the `search` skill) - a row with no `skills` simply has none. Already-applied or ineligible → immediately POST its `skipped` outcome and reason to `/jobs/<key>/result`. Eligible rows keep their score and stay `pending`; one too thin to score confidently stays `pending` without `matchScore` for `campaign.scorePending` later. The server auto-promotes rows scoring ≥ threshold on the next agenda refresh, so **do not apply** in this cycle.

Track `JOBS_SEEN` (rows read) and `NEW_JOBS` (fresh eligible `pending` rows you created - not dupes or ineligible rows). Stop when `NEW_JOBS >= newJobsTarget`, the page cap (`maxPages`) is hit, or the board has no next page (`REACHED_END=true`; leave it `false` if you stopped for either other reason). Heartbeat after each page and at least every ~10 minutes.

Before SKILL.md step 5 (Record), report the run - a `404` means the search was deleted mid-run, so journal that and move on:

```bash
openapply-api POST /api/pilot/searches/$SEARCH_ID/run-result \
  --data '{"jobsSeen":<JOBS_SEEN>,"newJobs":<NEW_JOBS>,"reachedEnd":<REACHED_END>}'
```

The journal narrative should include the pages read and new-jobs count.
