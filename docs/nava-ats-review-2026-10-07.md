# Nava rewrite and ATS evaluation

Reviewed 2026-10-07. OpenApply's Claude reviewed the existing final PDF in chat
`7d0ce165-e36b-4891-afc1-e6e02b95b816`; the outer assistant independently checked its claims.
No resume was edited, no saved score changed and no application was submitted during this review.

## Conclusion

The final PDF is technically readable in OpenApply's PDF.js extraction and is a credible stretch
application for the posted AI Engineer work. It is not possible to calculate a defensible
probability of passing Nava's actual screening from this document and the public JD alone.
Neither the saved 35 nor a keyword-coverage percentage is that probability.

The three edits make existing evidence slightly easier to read. They introduce no additional
qualifications or missing platform experience. The improvement over the original resume is
modest; this should not be presented as a substantial ATS-score increase.

## What changed

| Edit | Effect for this JD |
| --- | --- |
| AdReady: “backed by 36 unit tests running” → “; 36 unit tests run” | Shorter phrasing; same testing evidence and keywords. |
| Compugen RAG: moves the existing 100-query / 86% top-1 / 94% top-5 evaluation result earlier | Makes evaluation evidence easier to notice; no new claim. |
| Compugen: “to return JSON-structured actions” → “that returns JSON-structured actions” | Grammar change; negligible matching effect. |

The original source remains untouched. The edited source additionally inserts OT1 encoding and
`rmdefault=cmr`, guards two pdfTeX-specific commands for Tectonic, and adds a trailing newline.
These are four compatibility line changes, not content tailoring.

## Format and parsing evidence

- Original and final: one 612 × 792 point US Letter page; the same six embedded Computer Modern
  font families and sizes; all six have Unicode text maps; three links in each document.
- Margins, spacing commands, section definitions and resume macros remain unchanged.
- It is not pixel-identical: the shorter AdReady bullet saves one line. Projects and Skills move
  upward approximately 9.1 and 8.5 points; earlier headings vary by roughly one point between
  pdfTeX and Tectonic. There is no clipping or page-boundary overflow in the inspected render.
- Fresh raw OpenApply PDF.js extraction retains all 14 bullets, correct sections, contact details,
  technology names and numeric evidence. React, Node.js, TypeScript, Python, PostgreSQL and AWS
  are all present in both. The raw extractor reports no fi/fl Unicode ligatures in either output.
- Other extraction engines differ: pypdf inserts spaces within some kerned words and can return
  ligature characters. That is a parser-specific observation, not a demonstrated Nava ATS failure.

The app agent described the final PDF as slightly worse for ATS and attributed text ordering and
ligatures to skipped `glyphtounicode`. That causal claim is not supported by its check. Final font
resources do contain `ToUnicode`, and fresh OpenApply extraction preserves normal bullet/section
order and normalizes the relevant text. No result here validates every employer's parser.

## Evidence against the posting

| Nava emphasis | Evidence in the final resume | Assessment |
| --- | --- | --- |
| TypeScript/Python full-stack and core infrastructure stack | TypeScript/Python; React/Next.js, Node.js, PostgreSQL and AWS; shipped applications | Clear direct overlap |
| LLM evaluation and handling unreliable outputs | Evaluator agents with cited evidence, deterministic guardrails, 36 CI tests, RAG evaluation metrics | Strong relevant evidence; formal tracing workflows not described |
| Shipping usable AI features | Production summary, internal RAG assistant, video-ad evaluation pipeline, real-time multimodal assistant | Relevant evidence; exact ownership and operational scope need interview detail |
| Durable long-running agent state and replay | RabbitMQ fault isolation and reliability are related; durable agent state/replay not described | Transferable experience, direct evidence missing |
| Zero-trust context sandboxes | No direct resume evidence | Not evidenced, not proof the candidate lacks it |
| Model routing and token economics | Intent routing and multiple model tools are related, but model selection/token-cost optimization not shown | Partial adjacent evidence |

The posting explicitly welcomes applicants who do not meet every bullet, accepts internal users
and inherited systems, and does not require a specific framework/provider/audience size. Internship
or contract titles do not themselves disprove ownership. Conversely, being remote does not establish
Canadian hiring eligibility or sponsorship availability; those remain unverified for this role.

The saved 35 uses 60% requirement / 40% responsibility evidence, with strong=1 and partial=0.5.
It combines several technologies or outcomes into single criteria and treats the stack paragraph
as one requirement. This loses useful distinctions and can make a reasonably related candidate
look much weaker. It is a coarse agent judgment, not a calibrated screening model. Keep the saved
original-source score auditable; use explanations and ranking, not a purported hiring probability.

## Product behavior and format support

The saved minimum remains 20; Nava's 35 clears that numeric floor. Ranking-only mode can use the
existing minimum of zero, while preserving role/location/level preferences, truthful required
answers and duplicate/submission safeguards. Twenty remains a cutoff; it does not remove numerical
rejection entirely. No profile setting was changed during this review.

Each base resume needs an explicitly selected template. For this resume, preserve the supplied
LaTeX, fonts and compiler settings; edit only designated content blocks, compile and compare page
count, font families, extracted facts and rendered layout. Other resumes can deliberately use this
same template or supply their own source template. A PDF-only input does not provide enough source
information to guarantee identical editable layout/fonts. Do not silently substitute a generic
template or shrink type to force a page count.

This remains a standalone local PDF. OpenApply's variant endpoint still renders JakeTemplate;
registering source templates and compiled variant bytes in the product/application workflow is
not implemented. The prior API threshold-inheritance fixes also await activation.

## Sources and limits

- [Nava AI Engineer posting](https://jobs.ashbyhq.com/nava-benefits/d1ef174d-42dd-4910-9b46-05cdee223db0),
  checked against the full saved 6,724-character JD at `.temp/nava-desc.txt`.
- [Ashby AI-assisted review](https://docs.ashbyhq.com/ai-assisted-application-review): employers
  configure criteria; a public JD does not expose their complete review configuration.
- [Ashby automatic rejection](https://docs.ashbyhq.com/auto-reject-applications): employers can set
  rules based on application answers, independently of resume wording.

No access to Nava's private screening configuration, no real ATS upload or submission test, and
no evidence that Nava has enabled any particular Ashby AI/rejection feature. Therefore no pass
percentage, guarantee or verified employer-screening outcome is reported.
