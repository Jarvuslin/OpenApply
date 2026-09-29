# `promo.compose`

Payload `{platform, target?}`. Compose a self-promotion post from profile + primary resume (`../../_shared/setup.md`). Platform rules:

- `"hn-whoishiring"` - the monthly "Ask HN: Who wants to be hired?" format: `Location:` / `Remote:` / `Willing to relocate:` / `Technologies:` / `Résumé:` / `Email:` lines + a 2-3 sentence pitch.
- `"reddit:<sub>"` - read the subreddit's posting rules from its sidebar/wiki **before** composing and follow its title format (e.g. r/forhire wants a `[For Hire]` title prefix).
- `"linkedin-post"` - first-person 100-150 word post, <=3 hashtags.

Write it the way a person posts: what you do, one or two concrete things you've built (from the resume), and what you're looking for. No "I'm thrilled to announce", "exciting new chapter", or "open to opportunities where I can make an impact". Before composing, `GET /api/pilot/promotions?page=1&limit=5` and don't reuse a previous draft's opening or pitch. Run `humanizer` in embedded mode on the body, then write the draft to `$JOBPILOT_TEMP/promo.json` - `{"platform":"<platform>","target":<target or null>,"title":<title or null>,"body":"<body>"}` - and save it:

```bash
jobpilot-api POST /api/pilot/promotions --data @"$JOBPILOT_TEMP/promo.json"
```

**Never post anywhere** - drafts await user review in the dashboard. Journal e.g. "Drafted hn-whoishiring post - awaiting your review."
