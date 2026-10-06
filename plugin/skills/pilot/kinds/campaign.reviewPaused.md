# `campaign.reviewPaused`

Payload `{campaignId, query, board, pausedAt}` - a stuck paused auto-apply campaign. No browser, no worker. `GET /api/campaigns/$CID`; classify from `statusActor`/`statusReason` (fallback: `/jobs/reasons` + recent journal): missing resume, verification wall, user pause, or unknown.

- Missing resume and the file is restorable per `../../_shared/setup.md` → resume:

```bash
openapply-api POST /api/campaigns/$CID/status --data '{"status":"in_progress","actor":"pilot"}'
```

- Anything else → ask; never silently override a user pause. `subjectType:"campaign"` + `subjectId` are load-bearing (suppress re-review while open, route the answer):

```bash
openapply-api POST /api/pilot/questions --data @"$OPENAPPLY_TEMP/question.json"
```

`$OPENAPPLY_TEMP/question.json`:

```json
{
  "kind": "choice",
  "subjectType": "campaign",
  "subjectId": "<campaignId>",
  "prompt": "Campaign '<query>' is paused (<reason>). Resume it?",
  "options": ["Resume", "Keep paused", "Complete campaign"],
  "deepLink": "<OPENAPPLY_WEB>/campaigns/<campaignId>"
}
```

Journal the outcome: "Resumed campaign '<query>' - resume restored." / "Campaign '<query>' paused (<reason>) - asked whether to resume."
