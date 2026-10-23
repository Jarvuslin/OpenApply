# Employer feed expansion verification

Verified on October 7, 2026 in Toronto (October 8 UTC). Added 34 employer feeds to the
existing 23, for 57 employer feeds. Each added feed returned a nonempty list through the
existing `fetchAts(fetchSourceJson, provider, slug, company)` connector. These checks only
read public employer feeds; they did not write jobs or change collector leases.

The new feeds returned **6,431 global postings** at verification time. This is a source
snapshot, not a count of newly imported, distinct, US/Canadian, or entry-level jobs. Roles
include engineering, research, design, product, and other departments. Profile-derived
Discover filters still control which listings a user sees.

## Verified additions

Greenhouse identity was checked using board metadata and/or employer-owned posting links.
Ashby identity was checked against the public board title; Cursor's official careers page
links directly to its Ashby board. Canva's public API identifies the company as Canva.

| Employer | Provider / board slug | Postings | Primary evidence |
| --- | --- | ---: | --- |
| Stripe | greenhouse / stripe | 722 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/stripe) |
| Databricks | greenhouse / databricks | 893 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/databricks) |
| Discord | greenhouse / discord | 47 | [Employer posting](https://job-boards.greenhouse.io/discord/jobs/8806482002) |
| Duolingo | greenhouse / duolingo | 59 | [Employer posting](https://careers.duolingo.com/jobs/8851677002?gh_jid=8851677002) |
| Dropbox | greenhouse / dropbox | 31 | [Employer posting](https://jobs.dropbox.com/listing/8159652?gh_jid=8159652) |
| GitLab | greenhouse / gitlab | 216 | [Employer posting](https://job-boards.greenhouse.io/gitlab/jobs/8860302002) |
| Asana | greenhouse / asana | 102 | [Employer posting](https://www.asana.com/jobs/apply/8165477?gh_jid=8165477) |
| Scale AI | greenhouse / scaleai | 187 | [Employer posting](https://job-boards.greenhouse.io/scaleai/jobs/4739727005) |
| Brex | greenhouse / brex | 281 | [Employer posting](https://www.brex.com/careers/8871793002?gh_jid=8871793002) |
| Instacart | greenhouse / instacart | 126 | [Employer posting](https://instacart.careers/job/?gh_jid=8250324) |
| Roblox | greenhouse / roblox | 260 | [Employer posting](https://careers.roblox.com/jobs/8143982?gh_jid=8143982) |
| DoorDash | greenhouse / doordashusa | 466 | [Employer posting](https://job-boards.greenhouse.io/doordashusa/jobs/8139265) |
| Canva | smartrecruiters / Canva | 125 | [Public feed](https://api.smartrecruiters.com/v1/companies/Canva/postings?limit=100&offset=0&status=PUBLIC) |
| Gusto | greenhouse / gusto | 96 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/gusto) |
| Chime | greenhouse / chime | 71 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/chime) |
| Lyft | greenhouse / lyft | 191 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/lyft) |
| Pinterest | greenhouse / pinterest | 179 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/pinterest) |
| Twilio | greenhouse / twilio | 130 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/twilio) |
| Okta | greenhouse / okta | 372 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/okta) |
| Elastic | greenhouse / elastic | 417 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/elastic) |
| Samsara | greenhouse / samsara | 240 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/samsara) |
| Fastly | greenhouse / fastly | 49 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/fastly) |
| Cockroach Labs | greenhouse / cockroachlabs | 18 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/cockroachlabs) |
| Squarespace | greenhouse / squarespace | 32 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/squarespace) |
| Toast | greenhouse / toast | 305 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/toast) |
| Klaviyo | greenhouse / klaviyo | 141 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/klaviyo) |
| Webflow | greenhouse / webflow | 22 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/webflow) |
| Vercel | greenhouse / vercel | 85 | [Board metadata](https://boards-api.greenhouse.io/v1/boards/vercel) |
| Replit | ashby / replit | 71 | [Employer board](https://jobs.ashbyhq.com/replit) |
| Supabase | ashby / supabase | 53 | [Employer board](https://jobs.ashbyhq.com/supabase) |
| Perplexity | ashby / perplexity | 129 | [Employer board](https://jobs.ashbyhq.com/perplexity) |
| ElevenLabs | ashby / elevenlabs | 141 | [Employer board](https://jobs.ashbyhq.com/elevenlabs) |
| Modal | ashby / modal | 41 | [Employer board](https://jobs.ashbyhq.com/modal) |
| Cursor | ashby / cursor | 133 | [Official careers page](https://cursor.com/careers) |

Feed requests used the existing adapters' public endpoints: Greenhouse board jobs with
`content=true`, Ashby's public job board API, and SmartRecruiters public company postings.
Canva required two pages. No provider accounts or API keys were needed.

## Examples relevant to early-career discovery

These are observed source titles and locations, not resume-fit assessments:

- [Replit: Software Engineer - New Grad (2027)](https://jobs.ashbyhq.com/replit/b5e81eae-06f9-4798-8988-2d06ca936dbc/application), Foster City, CA.
- [Cursor: Software Engineer, New Grad 2027](https://jobs.ashbyhq.com/cursor/d0e5b41d-84ab-4887-bd3a-55589b11dd7b/application), San Francisco, New York, and Palo Alto.
- [Vercel: Software Engineering Intern - Summer '27](https://job-boards.greenhouse.io/vercel/jobs/6181759004), hybrid San Francisco.
- [Pinterest: Machine Learning Intern 2027](https://www.pinterestcareers.com/jobs/?gh_jid=8138080), Toronto.
- [Lyft: Business Systems Engineer Intern, Finance Technology (Summer 2027)](https://app.careerpuck.com/job-board/lyft/job/8802222002?gh_jid=8802222002), Toronto.
- [Modal: ML Research Intern](https://jobs.ashbyhq.com/modal/38888294-6bc7-4dab-b072-6d0f0c2ed79a/application), New York and San Francisco.

## Limits and exclusions

- These ATS additions do not provide Meta, LinkedIn, or Indeed coverage. Google Careers
  has a separate bounded connector described in [Discover sources and scale](discover-sources-and-scale.md).
- HubSpot's tested `hubspot` / `hubspotjobs` Greenhouse slugs and Rippling's tested Greenhouse
  slug returned 404. They were not added. The same applies to tested Greenhouse slugs for
  Confluent, Sentry, Plaid, and Snowflake, and the tested Lever Plaid slug.
- Vercel's Ashby feed was empty; its verified Greenhouse feed was added instead. The tested
  `anysphere` Ashby slug returned 404; Cursor's official careers links verify `cursor`.
- Airtable's Ashby feed was empty and its Greenhouse feed contained four unrelated-to-engineering
  roles; it was omitted. The `intercom` Greenhouse board now identifies itself as Fin, so it
  was omitted pending independent company identity verification.
- Greenhouse supplies a modification timestamp, not an original posting date. The existing
  adapter keeps `postedAt` unknown rather than presenting edits as new postings.
- Canva's SmartRecruiters listing feed lacks full descriptions in the existing adapter.
  Its original posting must be opened for the complete description before assessment or
  application.
- Public feed access is not a promise of exhaustive coverage or a redistribution license.
  Source links, reasonable polling, and source-specific terms still apply.
