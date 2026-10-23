# Nava original-template preview — 2026-10-07

## Scope and result

Preview only for Nava Benefits' AI Engineer posting (`d1ef174d-42dd-4910-9b46-05cdee223db0`).
OpenApply's Claude authored the wording changes and compiled the PDF in chat
`7d0ce165-e36b-4891-afc1-e6e02b95b816`. No employer form, account, email or submission action was
performed. This is a **standalone LaTeX preview**, not a registered OpenApply resume variant.
The existing variant endpoint still renders the older template; its saved variant must not be
mistaken for this file or used as evidence that an application selected it.

The final PDF is **one US Letter page**, with the same six Computer Modern font families as the
original. Independent visual inspection found the original section order, margins, typography,
rules and content retained, with natural reflow after the shortened bullets. There is no clipped
text or second page. It is not pixel-identical to the original: the wording and resulting line
positions differ. Kingston and the Oppfy “Multiple engagements” annotation are present.

## Artifacts

Local artifacts are under `D:/Dev/OpenApply/.temp/nava-latex/`:

- `original.tex`: unchanged copy of the user's supplied source.
- `nava-ai-engineer.tex`: app-agent-edited source.
- `nava-ai-engineer.pdf`: final verified preview, **30,775 bytes**.
- `nava-ai-engineer.log`: compiler diagnostics (one template `fancyhdr` footskip warning; no
  overfull/underfull box warning found).
- `original-page-1.png` and `tailored-page-1.png`: independent rendered inspection images.
- `original-openapply-text.txt` and `tailored-openapply-text.txt`: text extracted through the
  actual OpenApply PDF.js source extractor, without saving a new resume or changing API state.

Final PDF SHA-256: `e91e4c665b1358d3f0d7c50b7048ccd30ddd406960032fd0d1e11484a5f0a628`.

Original source SHA-256: `01316fedc7b7071e8a8a61dc159ceb8f3c0eeef18bfaa4458f20d2c1ddc87270`.
Original supplied PDF SHA-256: `24409d82222865e760a51f946da935d4a56c34bab870756260dea2b81a436abf`.
Both originals remained unchanged.

## Exact content changes

1. AdReady guardrails: “backed by 36 unit tests running in GitHub Actions CI” becomes
   “; 36 unit tests run in GitHub Actions CI”.
2. Compugen RAG: the existing 100-query, 86% top-1 / 94% top-5 evaluation result moves earlier
   in the same bullet; FastAPI, LangChain, FAISS, catalog size and PostgreSQL remain.
3. Compugen intent routing: “to return JSON-structured actions” becomes
   “that returns JSON-structured actions”.

No new experience, tools, metrics or claims were added. The edited source also adds OT1 font
encoding and `rmdefault=cmr`, guards the two pdfTeX-only Unicode commands, and adds a final newline.
These compiler compatibility changes preserve the intended font family without altering margins
or layout macros.

All six final embedded font resources contain `ToUnicode` maps. The app agent's caveat that the
guard removes `glyphtounicode` does **not** establish missing PDF text mapping. OpenApply's own
PDF.js extraction preserves AWS, FAISS, Kingston, Multiple engagements and the numeric evidence.
A separate pypdf extractor inserted spaces within AWS/FAISS because of positioning; this was not
observed with OpenApply's parser. No employer-specific ATS parsing is claimed.

## Failures and disclosed intervention

- The native Codex LaTeX editor failed before processing the source with “Unable to find standard
  directories for platform”. Source files were opened/queued in its editor and preserved.
- OpenApply initially found no compiler on PATH. The outer assistant located Codex's existing
  bundled Tectonic and supplied its path after the agent finished that attempt.
- An initial cache-only run failed because no LaTeX support files were cached. The outer assistant
  then allowed ordinary first-run Tectonic cache downloads. No new compiler was installed and no
  resume was uploaded to an external compilation service.
- The first source compile failed on pdfTeX-only commands. Claude repaired them. It disclosed and
  recovered a transient shell-edit mistake before compiling.
- Independent inspection caught Latin Modern fonts in the first successful PDF. The outer
  assistant reported that mismatch to Claude; Claude restored Computer Modern and recompiled.
- The outer assistant copied the supplied source, configured/reported compiler failures,
  inspected bytes/diffs/pages/fonts and tested text extraction. It did **not** author resume
  wording, edit the final `.tex`, compile the final PDF or fake an application record.

This therefore passes the one-page, original-template artifact check **with disclosed diagnostic
assistance**. It is not evidence of an unattended end-to-end application pass.

## Matching behavior

The saved Nava score remains **35/100** against the original PDF and full JD: requirements 42 at
60% weight, responsibilities 25 at 40%. Strong evidence earns 1, partial evidence 0.5, and absent
evidence 0. Compound criteria can therefore be conservative. This measures documented coverage,
not hiring probability or everything the applicant can do. GitHub was not included.

The user's profile minimum was changed through Settings from 65 to **20**, saved and verified
after reload. Role/level/location and confirmed eligibility preferences were preserved. This did
not start Pilot, reopen the completed preview campaign or trigger an application. A threshold
change does not inflate the score or automatically rescan prior skipped jobs.

The matching UI now labels absent support “Not evidenced in resume”; strategy-review guidance
preserves a user-selected 0–100 floor instead of automatically pushing it back to at least 50.
Further threshold inheritance corrections are implemented:

- Existing campaigns resolve campaign override → profile minimum → default 60, consistently in
  on-demand scoring, Pilot promotion and score queues.
- A Pilot minimum override seeds new campaigns only. An omitted minimum remains inherited when
  unrelated goals are saved; the UI exposes “Use profile minimum”. Existing stored numeric
  overrides remain explicit, since historical intent cannot be reconstructed safely.
- Rescan loads the profile minimum instead of a hardcoded 60, honors explicit values including
  zero, and does not save a new override when the inherited value is unchanged.
- Agent guidance separates ordinary skill/degree/experience evidence gaps from actual declared
  knockouts and legal eligibility, retaining truthful required answers and selected seniority.

Verification: 41 Pilot API tests and five contracts/form tests passed; API and web typechecks,
targeted Biome and whitespace checks passed. Earlier matching-copy/strategy changes passed 17
scoring/promotion tests. Shared preview guidance now covers supplied LaTeX, font-family inspection,
bounded existing-compiler repair and the standalone-artifact integration limit.

The profile setting of 20 is live. **API-side threshold inheritance fixes await service activation**;
the old non-watching API process remains running. Earlier automatic approval review blocked service
restarts with “blocked by policy”; that block was not bypassed and no restart was attempted here.
See `local-restart-after-audit.md`. No new application campaign was started to test these changes.

## Product integration still needed

- Store the supplied LaTeX template separately from the immutable original PDF.
- Register each compiled variant's `.tex`, exact PDF bytes/hash, base/JD references and wording
  audit through the API; never overwrite the standard renderer's cache to imitate this.
- Make the application flow stage that registered PDF and retain its hash in submission evidence.
- Keep original-resume scoring distinct from any future GitHub/project-evidence assessment.
  A GitHub import should retain repository/file/commit citations and confirm the user's personal
  contribution before adding resume claims. No GitHub connection/import was implemented here.

