# ATS fixture structure observations

Observed October 8, 2026. Public application pages were inspected read-only. No
employer fields were filled, files uploaded, accounts created, or applications
submitted. Fixtures keep synthetic employers, postings, applicant facts, and
receipts; they reproduce selected structures rather than complete vendor UIs.

| Fixture | Observed structure used as a reference |
| --- | --- |
| Greenhouse | Job description followed by one application form; separate first/last name; attachment group; custom eligibility questions and prose fields. |
| Lever | Single long application page; resume first, then identity/contact details, links, and employer-defined question sections. |
| Ashby | Overview/Application tabs; one grouped application page, upload control, opaque custom-field identifiers, and button-style Yes/No choices. |
| Unfamiliar | Deliberately synthetic wizard with different field order, conditional questions, separate contact/eligibility/document steps, and a final submit action. No vendor attribution. |

## Greenhouse

The [Afresh application](https://job-boards.greenhouse.io/afresh/jobs/6108299004)
exposed `first_name`, `last_name`, `email`, `resume`, and `question_…` IDs. The
observed identity controls lacked HTML `name` attributes; submission uses
JavaScript. ARIA-required attributes and custom comboboxes appear in the form.
The resume group offers attachments and manual text entry.

The [official Job Board API documentation](https://docs.greenhouse.io/job-board.html)
describes application field names, multipart attachments, native-select
alternatives, and question retrieval with `questions=true`. The local fixture's
POST transport is controlled test infrastructure, not a claim that the live
React page submits through an ordinary HTML form.

## Lever

The [CIC application](https://jobs.lever.co/cic/d28988a7-1ae5-4099-810a-ecf635ccf14e/apply)
uses a multipart POST form named `application-form`. Its file input is
`name="resume"` with ID `resume-upload-input`; contact controls include `name`,
`email`, `phone`, `location`, and `org`. Links use names such as `urls[LinkedIn]`.
Employer-defined groups use names shaped like `cards[UUID][field0]`, with native
selects, radios, checkboxes, and textareas. The submit button ID is `btn-submit`.

The [official postings API documentation](https://github.com/lever/postings-api)
describes configurable application fields and multipart resume submission.
Its public listing schema does not establish access to every custom question.

## Ashby

The [Everstar application](https://jobs.ashbyhq.com/everstar/681719d5-f43f-4f38-84f3-b784ce9ee9df/application)
exposed `_systemfield_name`, `_systemfield_email`, and `_systemfield_resume`,
with UUID-shaped IDs for custom fields and button-style Yes/No choices. The
observed page has Overview/Application navigation rather than a multistep form.

The [official custom careers guide](https://developers.ashbyhq.com/docs/creating-a-custom-careers-page)
documents field paths, types, and requiredness. The associated
[jobPosting.info API](https://developers.ashbyhq.com/reference/jobpostinginfo)
requires `jobsRead`; its schema must not be assumed available through the public
postings feed.

## Deliberate test variations

Conditional sponsorship follow-ups and the inverse sponsorship question are
controlled correctness cases. Their dynamic behavior was not established on the
three reference pages. Multipage coverage belongs to the unfamiliar fixture.
PDF-only uploads, local receipt persistence, and synthetic identity restrictions
are fixture constraints, not claims about vendor restrictions.
