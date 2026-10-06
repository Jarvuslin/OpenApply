# `job.apply`

Delegate ONE `job-worker` invocation in apply mode - the input JSON from `../../_shared/campaign-flow.md` (campaignId, jobKey, url, board, digest, resumeId, plus profile fields per `../../_shared/setup.md`) plus `claimId:$CLAIM_ID` (lets the worker heartbeat through a long apply), all read from the claim payload. Heartbeat once more when it returns. Handle the four outcomes per `../../_shared/campaign-flow.md` (Terminal result writes):

- `applied` / `failed` / `skipped` → `POST /api/campaigns/$CID/jobs/$KEY/result` with the shared payload shapes. Pass the worker's `resumeId`/`resumeVariantId` straight through on `applied`.
- `needs_user` → ask the user, then park the job:

Pass the worker's `kind`, `question`, and `options` through verbatim (`options` defaults `[]`).

```json
{
  "kind": "<worker kind>",
  "subjectType": "job",
  "subjectId": "<campaignId>:<jobKey>",
  "prompt": "<worker question>",
  "options": <worker options, else []>,
  "deepLink": "<OPENAPPLY_WEB>/campaigns/<campaignId>"
}
```

Write that to `$OPENAPPLY_TEMP/question.json`, then:

```bash
openapply-api POST /api/pilot/questions --data @"$OPENAPPLY_TEMP/question.json"
openapply-api PATCH /api/campaigns/$CID/jobs/$KEY --data '{"status":"needs_user"}'
```

For `two_factor`: the server auto-expires the question in ~5 minutes and the parked job is skipped cleanly - do nothing special, keep moving.
