# `campaign.strategyReview`

Payload `{campaignId, query, config, counts, topSkipReasons}`. Quiet-agenda deep think, **no browser**. Reason over the yield: is the query too broad/narrow, `minScore` mistuned, skip reasons clustered? Decide ONE concrete adjustment (rewrite query and/or shift `minScore` by at most ±10 within [50,95]). Build the updated config from a fresh `GET /api/campaigns/$CID` and pass its `updatedAt` as the guard; a `409` = the user edited mid-review - re-fetch and re-decide once:

```bash
jobpilot-api PATCH /api/campaigns/$CID --data @"$JOBPILOT_TEMP/campaign.json"
```

`$JOBPILOT_TEMP/campaign.json` is `{"config": <updated config>, "expectedUpdatedAt": "<campaign updatedAt>"}`.

Journal with detail `{type:"strategyReview"}` (SKILL.md step 5): "Campaign '<query>' yielding 12% - narrowed query to '<new>', minScore 70->65." The `detail.type` marker is load-bearing - the server dedupes reviews on it. Larger changes than the bounds → ask the user with a `choice` question instead of applying.

**Search stewardship.** When the diagnosis implicates the search itself - fundamentally dry or mistargeted, not merely campaign tuning - make at most ONE search change per cycle, instead of or alongside config tuning: `POST`/`PATCH`/`DELETE /api/pilot/searches[/:id]` (`GET /api/pilot/searches` for ids). Update `reason` to say why, and journal the change.
