# `interview.prep`

Payload `{applicationId, company, jobTitle, jobUrl, resumeId}`. Generate a prep sheet by following the `interview` skill's procedure (JD from `jobUrl` if reachable, else the application's stored data; resume per `../../_shared/setup.md`). Save it as `$JOBPILOT_TEMP/prep.json` - `{"kind":"note","notes":"[interview-prep]\n<sheet>"}` - then:

```bash
jobpilot-api POST /api/applied/$APP_ID/events --data @"$JOBPILOT_TEMP/prep.json"
```

The `[interview-prep]` marker prefix is load-bearing - the server dedupes on it. Journal: "Prep sheet ready for <company> <jobTitle> interview."
