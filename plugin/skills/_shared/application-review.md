# AI review before authorized submission

The user authorizes the application scope; the agent performs the final review and Submit. An already authorized campaign, selected job or application trial does not need another approval or a human final click. A review is the agent's work, not a new permission gate. Keep the headed VM page and progress visible. First inspect the existing attempt per `submission-recovery.md`; an unknown or previously begun attempt must never re-enter this as a fresh submission.

## Review the actual application

1. Confirm the employer, role and URL still match the selected job. Inspect changed source and eligibility before proceeding. Use the original-resume assessment and explicit user facts; the existence of a score does not establish an unknown eligibility answer.
2. Complete the fresh per-page sweep in `form-filling.md`, including repeated and conditional controls. Compare every retained answer with the actual current values, selected labels and checked states. Inspect the final review page or employer preview when available; correct parsing errors before submitting. Do not assume a resume upload populated structured employment/education fields correctly.
3. Review all factual claims against the original resume text already loaded from scoring context and explicit confirmed profile/user facts. A tailored document is wording, not a new source of facts. Check employers, role titles, dates, graduation, metrics, employment versus project/internship scope, and country-specific authorization. Remove unsupported prose; ask only if a required fact remains missing.
4. Review the exact final resume PDF selected for this job, its document mode and actual content. For generated documents, download the immutable revision PDF URL returned by the artifact API, compare its local SHA-256 with `pdfSha256`, and keep `{revision,resumeId,variantId?}` with it. Confirm it is the file passed to `openapply-stage` and the returned guest path passed to the employer upload. Keep the local filename/hash-to-guest-path mapping; a generated staging basename is not a different resume. Verify the visible attachment/preview. Never infer a remote digest from an upload label or claim exact formatting without checking it. If a format constraint cannot be met, resolve that document failure before sending.
5. Retain every step's final nonsecret field answers, including generated free text, using the submission field schema. Retain the exact PDF through the submission-resume endpoint and validate its returned job UUID, filename and SHA-256 against the local file reviewed/staged. Save the completed review, fields and PDF reference through `/submission-checkpoint`, then compare its readback with the actual form. Archiving a different or later regenerated PDF is not valid. A failed archive/checkpoint or incomplete readback stops before Submit; retain the visible form and report the specific failure.
6. When the required facts, controls, document, archive and checkpoint checks pass, follow `submission-recovery.md`: only a successful `/submission-begin` returning `began:true` permits the worker's one actual Submit. A false/lost response goes to recovery. Perform the click once in the worker flow, not separately in this checklist. A near-threshold score, candid qualification gap, campaign size or `needs_review` score alone does not trigger a human approval. Honor any actual runtime action restriction; report its specific blocked action instead of treating it as permission to bypass the runtime.

## Verify and report the outcome

Wait for the result and read the employer's actual confirmation text/URL. A click, closed modal, disabled button or timeout is not submission confirmation. Persist the actual receipt through `/submission-receipt` (the helper spools it before HTTP), then use the checkpoint-only applied `/result`. Return `recorded` only after the saved Application and attempt agree. If confirmation is absent, preserve the page, inspect available state and report unresolved; never blindly click Submit again.

If the employer confirms submission but OpenApply cannot save the result, say that precisely and retry only evidence/result persistence. Never submit again to repair app storage, invent a receipt or claim dashboard/analytics success before reading the saved record.

## Pause only for the actual blocker

- Missing required fact: return `needs_user`, category `review` (or `salary`), kind `question` or `choice`, with the exact named field and known context. A response answers only that question.
- Real account/email/SMS/MFA/CAPTCHA verification: follow `auth.md` and mailbox/challenge rules; preserve the tab and park only this job.
- Runtime approval: use kind `approval` only for an actual runtime action approval or an explicit user decision, and explain what requires it. Do not label the routine AI review as approval.
- Application integration failure: report the observed failure, preserve state, and never manufacture successful completion or take an unapproved alternative route.

## Flow checks

| Observed case | Required agent behavior |
| --- | --- |
| Authorized application; required fields known; correct staged PDF; archive succeeded | Fresh readback and factual review, durable checkpoint, `began:true`, one agent Submit and employer confirmation/recording checks. |
| Required start date or another fact unknown | Ask the named question and park that job before advancing; existing application authorization remains valid. |
| Selecting a country or answering Yes reveals another required field | Enumerate the new control, fill from confirmed evidence, read it back and repeat the sweep before Next. |
| Existing account rejects its password | Follow auth rules, preserve the page and ask for correct credentials/manual sign-in; no reset, alias or duplicate signup. |
| Submit clicked but no receipt visible | Inspect and report unresolved; no submitted record and no blind resubmit. |
| Employer receipt visible but OpenApply persistence fails | Preserve evidence and retry persistence only; explicitly report recording incomplete. |

Adapted field checks come from the pinned [career-ops apply guidance](https://github.com/career-ops-hq/career-ops/blob/3be1cdf033d54e977c9770441122c9e7cf3c823f/modes/apply.md); this workflow uses OpenApply's existing JobPilot-derived worker and its autonomous authorized submission flow.
