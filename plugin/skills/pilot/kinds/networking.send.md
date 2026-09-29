# `networking.send`

Payload `{campaignId, messageId, contactId, contactName, contactEmail, subject, body}`. Email channel only - the server never emits LinkedIn sends. Send via the email module exactly as the `networking` skill's Phase 4 email send (`POST /api/email/send {to,subject,body}`), then record:

```bash
jobpilot-api POST /api/campaigns/$CID/networking/$MSGID/result \
  --data '{"outcome":"sent","providerId":"<send providerId>","threadId":"<send threadId>"}'
```

Send failure → `/result` `{outcome:"failed", failReason:"<why>"}`. Journal with recipient + subject.
