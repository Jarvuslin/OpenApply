# Nava short-prompt preview — October 7, 2026

## First completed run

OpenApply chat: `f20db84b-8ab5-4bc4-9013-ef9ea7ab4594` (`Nava · score and resume`). Claude run: `bc7f291a-7150-4b4f-a65b-7b13c89b66e7`; provider session: `a33f2dad-d22e-4743-9af9-f246e6c1d279`. Ran approximately 11:50–11:52 Toronto. The previously blocked attempt in `nava-rewrite-observation.md` remains a separate attempt.

Source: `C:/Users/7474g/Downloads/Software_Engineer_Resume.pdf` (98,589 bytes). SHA-256 before/after: `24409d82222865e760a51f946da935d4a56c34bab870756260dea2b81a436abf`.
Job: https://jobs.ashbyhq.com/nava-benefits/d1ef174d-42dd-4910-9b46-05cdee223db0?source=LinkedIn+Paid

The outer assistant sent a short natural-language request through normal chat: score the original against the complete JD, make only minor factual edits, show the PDF and changes, keep the original intact, disclose format limitations, preview only. No API workflow instructions were supplied in the user-facing request. No corrective prompts or code changes to the resume workflow were made during this run.

## Observed result

- Claude read the specified local PDF, invoked `openapply:tailor-resume`, read chat-workspace/setup guidance and retrieved the target full Ashby description (6,679 characters).
- It correctly checked existing source hashes and rejected two older saved resume bases as substitutes for the specified source.
- It reported **about 65/100** and discussed stack/evaluation strengths and durable-agent, sandbox, routing/cost and platform-ownership gaps. This is an **agent estimate**, not a persisted server original-fit assessment: no score-fit request or evidence matrix was saved.
- It wrote an independent HTML/Chrome rendering script in `.temp/tailor/build.mjs` and copied a real 66,955-byte PDF to `C:/Users/7474g/Downloads/Software_Engineer_Resume_Nava_AI_Engineer_PREVIEW.pdf`.
- The four reported changes reorder Python/TypeScript in the summary and three skill lists. It made no bullet rewrites.
- Read-only database inspection found **zero new campaigns, jobs, resume bases, variants, application attempts or applications** for this run. No Nava fitAssessment was stored. The response provided a local file path as code text rather than an OpenApply document link.
- No employer upload/submission, account creation or email actions occurred. The agent fetched the JD through Ashby's API; the headed VM browser was not exercised by this preview.

## Artifact verification

Both PDFs are one-page Letter documents. The original bytes remain unchanged. The preview changes Computer Modern fonts to Cambria and changes line wrapping, spacing and bullet indentation. Thus it fails exact-format preservation. An initial screenshot-based concern about right-edge clipping was disproved by closer inspection: the rightmost text is within the page and the project heading/date fit.

Independent pypdf extraction of the preview joins some words/bullets (`andreplace`, `control.Built`, `backend.Designed`, `engineering,LangChain`), unlike the original at those locations. This is a concrete extraction-quality issue, not proof of rejection by every ATS.

Evidence: `.temp/nava-short-prompt-result.jpg`, `.temp/Software_Engineer_Resume.png`, `.temp/Software_Engineer_Resume_Nava_AI_Engineer_PREVIEW.png`, `.temp/nava-preview-text-diff.txt`. Inspection only rendered/read the files; the outer assistant did not edit the resume or generate replacement content.

## Verdict

Partial useful preview; **failed integrated scoring/variant workflow and exact-format requirements**. A completed chat turn and an existing local PDF do not prove that the application workflow can select, upload or retain that document. Nothing was submitted.

## Repair following observation

The chat's real chat/Pilot event URLs collided under the prior fixed connection-slot hash, unnecessarily rotating every five seconds with unused capacity. Streams now acquire either free slot; genuine source failures remain `reconnecting`, while scheduled capacity waits are distinct. All 21 targeted SSE tests pass, including real channel URLs, bounded capacity, replay, account isolation and teardown. The completed chat loaded without the recurring banner during inspection.

Automatic ordinary-language resume/scoring routing is being strengthened in shared agent guidance, with a separate follow-up run to be recorded below. Existing API/companion processes have not been restarted; earlier server/companion fixes are not claimed as live-tested.
## Follow-up after automatic routing repair

Fresh chat: `7d0ce165-e36b-4891-afc1-e6e02b95b816` (`Nava · saved score and resume`). Finished at **12:03:32 Toronto**. The whole user-facing request was:

> Score and lightly tailor this resume for this job, then show me the score and PDF in OpenApply. Keep the same format; tell me if you can’t. Preview only—don’t apply.
>
> Resume: C:/Users/7474g/Downloads/Software_Engineer_Resume.pdf
>
> Job: https://jobs.ashbyhq.com/nava-benefits/d1ef174d-42dd-4910-9b46-05cdee223db0?source=LinkedIn+Paid

The agent read the updated shared preview guide and did the work itself. No corrective message or manual API write was supplied during the run. The headed VM visibly opened the Nava posting (`.temp/nava-saved-preview-headed-browser.jpg`).

### Verified saved outputs

- New base: `a4a33c9d-cdb0-45b7-a0ce-58a8e6422ad5`. Saved source is exactly 98,589 bytes with the original SHA-256 above. Existing primary `e92427e4-4026-4ba8-9feb-0c57c441b28c` remained unchanged.
- Campaign: `8886ee8d-1436-4a91-b6eb-28ce3e7710c6`, `source=search`, `standing=false`, completed.
- Job: `e7bb3012-95a3-4f6f-b3dd-8e6d1f04e727`, key `nava-ai-engineer-d1ef174d`. The full saved JD is 6,724 characters. Saved `fitAssessment` uses the supplied source hash/base, not a variant.
- **Server-computed original resume score: 35/100.** Requirements score 42 at 60% weight and responsibilities 25 at 40% weight, six criteria each. The saved confidence value describes evidence-rating certainty; it is not hiring probability. The job is skipped for being below the saved 65 threshold. `eligible:false` here reflects that threshold, not proof of legal work ineligibility.
- Saved role preferences were unrestricted (`desiredRoles=[]`), level Entry, location Toronto; Canadian authorization and sponsorship need were retained. The agent reports related stack/LLM evaluation evidence, with durable agent state, zero-trust sandboxing, multi-model routing/cost and platform ownership gaps.
- Variant: `5d0186bf-2c18-4921-bc1d-6908af2c6729`, under the new base. It only reorders skills and bullets; no wording changes were found between extracted base and variant. This is light tailoring, not a substantive rewrite.
- **Zero new submission attempts and zero applications.** Original file hash remains unchanged. No mailbox/account actions occurred.

### Actual PDF and remaining failures

The outer assistant downloaded the exact saved variant through the normal resume library link **after** the agent finished, without editing it: `C:/Users/7474g/Downloads/nava-benefits-ai-engineer.pdf`, 9,432 bytes, SHA-256 `24f43132c195d5db47016c24672a61ebaf713d1356ce17f57684e95d230144dc`.

That hash also matches the official saved API artifact `apps/api/storage/resumes-generated/variant-5d0186bf-2c18-4921-bc1d-6908af2c6729-1791388996135-v2.pdf`; it is not the first run's standalone HTML/Chrome substitute. The worker recovered three local scripting errors (shell redirection and exact evidence quotes crossing source line breaks) before the scoring API accepted the evidence. No outer-agent repair of those tool calls occurred.

Visual inspection found **two pages versus the original one**, different typography, section ordering and spacing. This is an **alternate-template preview**, not exact-format preservation. All pages were rendered for inspection at `.temp/nava-saved-variant-1.png` and `.temp/nava-saved-variant-2.png`.

Two source facts were omitted during extraction: the education location `Kingston, Ontario` and the Oppfy date annotation `Multiple engagements`. Both are absent from the extracted base before tailoring, so the variant guard cannot recover them. This remains an extraction/schema issue; the original source still retains both. The agent correctly reported the existing LinkedIn mismatch without silently changing either the resume or profile.

The agent acknowledged that it had not visually inspected its PDF. It also printed code-formatted IDs/paths instead of working Markdown links, and described an API PDF path as if it were on the web origin. Following this run, the guide was tightened to require actual PDF inspection (or explicitly incomplete review) and clickable links using the proper web/API origins. **These final instruction refinements have not had a third live run.**

The campaign UI displays the persisted 35/100, skipped count one, and applied count zero. Its detailed evidence panel fails to load because the currently running API has only PATCH, not the new GET, at `/api/campaigns/{id}/jobs/{key}`. The source implementation exists but needs normal service activation. No restart was attempted during this trial, and the earlier automatic-review rejection was not bypassed. Screenshot: `.temp/nava-saved-score-evidence.jpg`.

### Result and verification

**Passed:** ordinary short-prompt routing through saved source, full JD, original-fit scoring, linked variant, headed-browser observation, unchanged original and no submission.

**Failed/incomplete:** exact-format preservation; two source annotations lost in extraction; agent-owned visual review; clickable links in this run; live evidence drill-down until API restart. The outcome is a partially passing preview, not a passing application trial.

Code verification for this follow-up: 21 SSE tests and eight chat-policy tests passed; worker API/web typechecks and knip passed; root full Biome CI passed with three pre-existing informational suggestions; `git diff --check` passed except the existing terminal-file CRLF notice. The browser stopped showing repeated reconnect banners during both completed runs. No server/companion activation is claimed.

