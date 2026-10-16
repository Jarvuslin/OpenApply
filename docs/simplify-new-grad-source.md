# Simplify new-grad discovery source

The adapter reads factual listing fields from the public
[SimplifyJobs/New-Grad-Positions repository](https://github.com/SimplifyJobs/New-Grad-Positions).
It preserves the employer's application link and attributes discovery to the repository.
It does not require a provider account or API key.

The source is enabled in the shared hourly catalog. The first completed refresh imported or
refreshed all **539** normalized postings with direct apply links, using two collection requests
and no truncation. Existing ATS postings are merged rather than duplicated.

## What is included

Each refresh fetches two fixed files from the repository's current `dev` branch:

- [Structured listing data](https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json)
- [Rendered curated list](https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md)

A listing must have both `active: true` and `is_visible: true`, and its employer application
link must appear in an unlocked application cell under a **New Grad Roles** heading in the
README. Raw JSON membership alone is insufficient: it also contains closed and unlisted
candidates. The repository's own rendering additionally filters rows and marks some stale
community submissions inactive.

Only HTTPS application links accepted by OpenApply are retained. Private-address literals,
credentials, alternate ports, known aggregator/redirect links, malformed records, and
duplicate posting identities are excluded. The adapter does not follow application links
or scrape employer job descriptions during collection.

The adapter returns at most 1,000 jobs, ordered by the source's addition timestamp. If the
list grows beyond that cap, the oldest curated additions are omitted. HTTP reads retain the
existing 20 MB per-response limit, request deadline, retry limit, and host throttling. Raw
data is limited to 50,000 records. A changed or incomplete README layout fails the refresh
instead of treating the entire raw JSON file as public listings.

## Metadata and duplicate handling

- Title, company, and location come from the structured data. Country and remote eligibility
  are not inferred from the repository's overall US/Canada/remote scope.
- The explicit new-grad table supplies entry-level metadata only when the title's level is
  unknown. An explicit senior, lead, manager, intermediate, or internship title takes priority.
- `date_posted` is used only to choose recent curated additions. Community additions assign it
  when approved into the repository; `date_updated` also reflects repository operations.
  Neither is presented as an employer publication date. `postedAt` remains unknown.
- Full descriptions, salary, and employer logos are absent from this dataset and are not
  fabricated. The actual employer posting is required for the complete description before
  assessment or application.
- Application URLs retain their actual destination. A separate canonical identity removes
  tracking parameters and normalizes Ashby `/application` and Lever `/apply` variants to the
  posting URLs used by the existing ATS adapters. Attribution points to the GitHub repository.
- Source flags are maintained by the upstream project. An active flag is not an independent
  real-time check that the employer still accepts applications.

The current repository meanings are documented in its
[edit form](https://github.com/SimplifyJobs/New-Grad-Positions/blob/dev/.github/ISSUE_TEMPLATE/edit_role.yaml),
[contribution processing](https://github.com/SimplifyJobs/New-Grad-Positions/blob/dev/.github/scripts/contribution_approved.py),
and [list rendering](https://github.com/SimplifyJobs/New-Grad-Positions/blob/dev/.github/scripts/util.py).

## Verification snapshot

Read-only verification on October 8, 2026 UTC returned:

| Stage | Count |
| --- | ---: |
| Raw JSON rows | 19,742 |
| Raw active rows | 3,117 |
| Raw active and visible rows | 3,116 |
| Apply links in the rendered curated list | 541 |
| Normalized adapter output | 539 |
| Distinct employer names in output | 265 |

The raw JSON response was 13,482,159 bytes; the README response was 765,458 bytes. Counts
change as the repository updates. The two files are fetched separately, so a concurrent
upstream update can temporarily omit a row until the next refresh; both inputs must agree
before inclusion.

Examples observed in the output included
[Stripe's Toronto new-grad software role](https://stripe.com/jobs/search?gh_jid=8157838),
[Amazon's Vancouver early-career software role](https://amazon.jobs/en/jobs/10502743/software-development-engineer-early-career-2026),
and [Chalk's new-grad software role](https://jobs.ashbyhq.com/chalk/927c74a5-1b40-490d-b3be-a29baec4db6f).
The list contains some locations outside the repository's stated US/Canada focus; normal
Discover filters still apply.

## Licensing finding

At verification time the repository had no tracked LICENSE file, GitHub repository metadata
reported `license: null`, and GitHub's repository-license endpoint returned 404. README and
CONTRIBUTING did not provide an explicit data redistribution license. This integration is an
independent parser of factual job fields; it does not copy the repository's implementation,
README prose, or full job descriptions. Public visibility must not be described as a verified
commercial redistribution license. See
[GitHub's explanation of repositories without a license](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
