# `networking.followup`

Payload `{campaignId, messageId, contactId, contactName, contactEmail, subject, sentAt, daysSince, channel, autonomy}`. Compose a two- or three-sentence follow-up that refers to the original `subject` and adds one thing the first message didn't have: a different proof point from the resume, a link to recent work, or a narrower ask. No "just following up", "circling back", "bumping this", or guilt about their inbox. Plain ASCII, then `humanizer` in embedded mode. Create it as a **new** draft via `POST /api/campaigns/$CID/networking` (the shape the `networking` skill saves a draft, on the payload's `channel`, reusing `contactId`); capture the returned draft's `id` as `DRAFT_MSGID`. Then apply the **autonomy gate** on the payload's `autonomy`. It never says `"off"`: the server drops the item instead.

- `"auto"` → send immediately and record sent, exactly as `./networking.send.md` (messageId = `$DRAFT_MSGID`).
- `"draft"` → stop after saving; the user picks the draft up at `$JOBPILOT_WEB/networking/messages`.
- `"review"` → POST a question against the draft and stop - `subjectType:"networking"` + the draft's messageId is what lets a later cycle's `question.answered` route the answer:

```bash
jobpilot-api POST /api/pilot/questions --data @"$JOBPILOT_TEMP/question.json"
```

`$JOBPILOT_TEMP/question.json`:

```json
{
  "kind": "approval",
  "subjectType": "networking",
  "subjectId": "<DRAFT_MSGID>",
  "prompt": "Send follow-up to <contactName> re <subject>?",
  "options": ["Send", "Skip"],
  "deepLink": "<JOBPILOT_WEB>/networking/messages?message=<DRAFT_MSGID>"
}
```
