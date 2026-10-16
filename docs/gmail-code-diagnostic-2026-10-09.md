# Claude Gmail code diagnostic — 2026-10-09

One explicitly authorized, bounded Claude Code run successfully searched the existing Gmail
connector. The query returned zero matching threads. **Search access passed; message reading,
code extraction, fresh-code validity, account creation and queued-worker integration remain
unverified.** No live run was repeated.

## Scope and observed result

- Runtime: direct Claude Code diagnostic, not the OpenApply queue/job-worker execution path.
- Mailbox: `jarvis.lin74@gmail.com`, explicitly confirmed by the user for Claude. No
  authenticated profile was returned; this is not provider-verified mailbox identity.
- Search: exact recipient, last 30 days, Alcoa content, verification/activation terms, and
  sender domains `alcoa.com`, `workday.com`, `myworkday.com` or `myworkdayjobs.com`.
- Exactly one `ToolSearch` call discovered Gmail `search_threads` and `get_message`.
- Exactly one `search_threads` call, `pageSize=1`, metadata-only view, succeeded with `{}`:
  zero threads, no pagination. No broader search or polling followed.
- Zero message-body reads. Code and verification-link presence were not established.
- No signup had been submitted by this test or the preceding Workday attempt, so there was
  no known current verification request timestamp. This was a historical access diagnostic,
  not an execution of the fresh-request `get-code` acceptance requirements.
- No signup, application submission, mail mutation, provider switch or separate API key use.

The supported schemas were checked against Google's
[search_threads](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/search_threads)
and [get_message](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/get_message)
references. An empty result only establishes that this narrow query had no matches; it does
not prove the mailbox contains no verification mail or verify the connected account address.

## Measured usage

| Measurement | Result |
| --- | --- |
| Claude sessions / automatic retries | 1 / 0 |
| Distinct observed assistant request IDs / reported turns | 3 / 3 |
| Actual model | `claude-sonnet-5-5` |
| Wall time / CLI-reported model run duration | 9,763 ms / 6,342 ms |
| Final input tokens, excluding separately reported cache fields | 6 |
| Cache creation input tokens | 11,617 |
| Cache read input tokens | 17,456 |
| Final output tokens | 356 |
| Thinking tokens | 0 |

Final CLI aggregate usage is authoritative for the figures above. Individual streamed
assistant messages contain partial output-token figures and must not be summed as a complete
output total. Cache fields represent provider-reported token accounting, not unique mail text
or a percentage of remaining subscription quota.

Auth status was `claude.ai`, `firstParty`, `pro`. The CLI's `costUSD=0.0535312` has
`costBasis=list`; it is a list-price estimate, **not evidence of an API credit charge** or a
measurement of Pro quota used. `fallback_credit` was null. No API credential was supplied.

## Safeguards and local checks

The temporary runner enforced a one-use run directory, six-turn cap, 120-second timeout,
one metadata query and at most one eligible individual-message read. It disabled session
persistence, plugins and unused built-in tools; removed inherited OpenApply/API credentials;
and denied mail mutations, browser actions, shell tools, subagents and retries. Raw model
output and email bodies were not written to the report. The child exited normally and its
scratch settings/state directory was removed.

Syntax checks, subscription-auth preflight and eight model-free gate assertions passed before
launch. Independent review identified two latent gate issues: a failed optional profile read
could bypass the profile guard when discovery omitted it, and a broad code-shaped regex
could match ordinary words. Both were corrected; three additional deterministic assertions
passed. Neither path was exercised by the completed live run (zero profile/body reads), and
no live retry was needed. Code-presence model output remains a diagnostic claim, not proof
that a code was accepted by an employer.

Preserved evidence:
`.temp/full-workflow-20261008/gmail-code-diagnostic-20261009/report.json`.

## Remaining test

A fresh-code test needs a real, authorized verification request addressed to the confirmed
mailbox, with the actual request time and employer sender/tenant established from that flow.
Then one scoped lookup can test message reading and code/link extraction. An employer page
must confirm verification separately before account creation is reported as successful.
