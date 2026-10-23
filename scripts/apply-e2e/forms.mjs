function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

function page(title, body, layout = "receipt") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | OpenApply local fixture</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#f4f7fa;color:#172635;margin:0}main{max-width:900px;margin:28px auto;padding:32px;background:white;border:1px solid #c4ced8;border-radius:8px}h1{line-height:1.2}label{display:block;margin:18px 0}input,select,textarea,button{box-sizing:border-box;font:inherit;padding:10px;max-width:100%}input:not([type=radio]),select,textarea{display:block;width:100%;margin-top:6px;border:1px solid #617386;border-radius:4px}button,.button{display:inline-block;background:#185b46;color:white;border:0;border-radius:4px;padding:12px 20px;text-decoration:none;cursor:pointer}small{display:block;color:#435569}.notice{padding:12px;background:#fff0c9;border:1px solid #926713}.muted{color:#435569}fieldset{margin:20px 0;padding:18px;border:1px solid #a5b6c5}legend{font-weight:600}fieldset label{display:inline-flex;align-items:center;gap:8px;margin:8px 20px 8px 0}[hidden]{display:none!important}a{color:#185b46}.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.attachment{padding:18px;border:1px dashed #84998c;background:#f7fbf8}.application-list{list-style:none;padding:0}.application-list>li{display:grid;grid-template-columns:200px 1fr;gap:24px;padding:20px 0;border-bottom:1px solid #ddd}.application-list label{margin:0}.question-card{padding:18px 0;border-bottom:1px solid #ddd}.tabs{display:flex;gap:28px;border-bottom:1px solid #bac4d0;padding:12px 0}.tabs [aria-selected=true]{font-weight:700;border-bottom:3px solid #5750b3}.ashby-section{padding:20px 0;border-bottom:1px solid #ddd}.answer-buttons label{padding:10px 20px;border:1px solid #8c89aa;border-radius:6px}.answer-buttons label:has(input:checked){background:#e8e6ff;border-color:#5750b3}body[data-layout=ashby] button{background:#5750b3}.wizard-layout{display:grid;grid-template-columns:190px 1fr;gap:30px}.wizard-progress{padding:0;list-style:none}.wizard-progress li{padding:12px;border-left:3px solid #b6c7d6}.wizard-progress [aria-current=step]{background:#e4eef7;border-color:#185b88;font-weight:600}body[data-layout=unfamiliar] button{background:#185b88}dl{display:grid;grid-template-columns:150px 1fr;gap:8px}dd{margin:0}dt{font-weight:600}
</style></head><body data-layout="${layout}"><main><p class="notice"><strong>LOCAL TEST FIXTURE</strong> — synthetic applications only. No employer, no email sent. Automated testing is explicitly permitted.</p>${body}</main></body></html>`;
}

function hidden(name, value) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function controlId(job, name) {
  return job.controlIds[name] ?? name;
}

function textInput(job, name, label, type = "text") {
  return `<label for="${controlId(job, name)}">${label} *<input id="${controlId(job, name)}" name="${name}" type="${type}" maxlength="200" required></label>`;
}

function contactFields(job) {
  const names = job.nameFields
    .map((name) =>
      textInput(
        job,
        name,
        { name: "Full name", firstName: "First name", lastName: "Last name" }[name],
      ),
    )
    .join("");
  return `${names}${textInput(job, "email", "Email address", "email")}`;
}

function yesNo(job, name, label) {
  const id = controlId(job, name);
  if (job.id === "greenhouse") {
    return `<label for="${id}">${escapeHtml(label)} *<select id="${id}" name="${name}" required><option value="">Select...</option><option value="yes">Yes</option><option value="no">No</option></select></label>`;
  }
  const style = job.id === "ashby" ? "answer-buttons" : "radio-question";
  return `<fieldset id="${id}" class="${style}"><legend>${escapeHtml(label)} *</legend><label for="${id}-yes"><input id="${id}-yes" type="radio" name="${name}" value="yes" required>Yes</label><label for="${id}-no"><input id="${id}-no" type="radio" name="${name}" value="no" required>No</label></fieldset>`;
}

function eligibilityFields(job) {
  const needValue = job.sponsorshipField === "doesNotNeedSponsorship" ? "no" : "yes";
  const detailsId = controlId(job, "sponsorshipDetails");
  return `${yesNo(job, "workAuthorization", "Are you currently legally authorized to work in Canada?")}${yesNo(job, job.sponsorshipField, job.sponsorshipQuestion)}<label id="sponsorship-details" for="${detailsId}" hidden>Please describe the sponsorship you will require *<textarea id="${detailsId}" name="sponsorshipDetails" maxlength="500" disabled></textarea></label><script>
const sponsorshipControls = [...document.querySelectorAll('[name="${job.sponsorshipField}"]')];
const details = document.getElementById('sponsorship-details');
function updateSponsorship() {
  const select = sponsorshipControls.find(control => control.tagName === 'SELECT');
  const value = select ? select.value : sponsorshipControls.find(control => control.checked)?.value;
  const required = value === '${needValue}';
  details.hidden = !required;
  details.querySelector('textarea').disabled = !required;
  details.querySelector('textarea').required = required;
}
for (const control of sponsorshipControls) control.addEventListener('change', updateSponsorship);
window.addEventListener('pageshow', updateSponsorship);
updateSponsorship();
</script>`;
}

function whyUs(job) {
  return `<label for="${controlId(job, "whyUs")}">Why do you want to work at ${escapeHtml(job.company)}? *<textarea id="${controlId(job, "whyUs")}" name="whyUs" minlength="80" maxlength="1200" rows="6" required></textarea><small>Use 80–1200 characters grounded in your experience and the company mission.</small></label>`;
}

function resume(job) {
  return `<div class="attachment"><label for="${controlId(job, "resume")}">Resume PDF *<input id="${controlId(job, "resume")}" name="resume" type="file" accept=".pdf,application/pdf" required></label><small>Attach your resume / CV. PDF only, up to 1 MiB. This local fixture does not connect cloud storage.</small></div>`;
}

function opening(job, key, suffix = "/apply", id = "application-form") {
  return `<form id="${id}" method="post" enctype="multipart/form-data" action="${escapeHtml(job.url)}${suffix}">${hidden("idempotencyKey", key)}`;
}

function tabs(job, selected) {
  return `<nav class="tabs" aria-label="Job pages"><a role="tab" aria-selected="${selected === "overview"}" href="${job.url}">Overview</a><a role="tab" aria-selected="${selected === "application"}" href="${job.url}/start">Application</a></nav>`;
}

function jobHeader(job) {
  return `<h1>${escapeHtml(job.title)}</h1><p><strong>${escapeHtml(job.company)}</strong> · Remote, Canada · Full time</p>`;
}

export function renderJob(job, key) {
  const intro = `${jobHeader(job)}<h2>About the role</h2><p>${escapeHtml(job.description)}</p>`;
  if (job.id === "greenhouse") {
    return page(
      job.title,
      `${intro}<section id="application"><h2>Apply for this job</h2><p class="muted">Required fields are marked *</p>${opening(job, key)}<div class="contact-grid">${contactFields(job)}</div>${resume(job)}${eligibilityFields(job)}${whyUs(job)}<button type="submit">Submit application</button></form></section>`,
      job.id,
    );
  }
  const navigation = job.id === "ashby" ? tabs(job, "overview") : "";
  return page(
    job.title,
    `${navigation}${intro}<a class="button" href="${job.url}/start">Apply for this test role</a>`,
    job.id,
  );
}

function wizard(job, step, body) {
  const labels = ["Contact", "Eligibility", "Motivation and resume"];
  const steps = labels
    .map(
      (label, index) =>
        `<li${index + 1 === step ? ' aria-current="step"' : ""}>${index + 1}. ${label}</li>`,
    )
    .join("");
  return page(
    job.title,
    `${jobHeader(job)}<div class="wizard-layout"><aside><ol class="wizard-progress" aria-label="Application progress">${steps}</ol></aside><section><p>Page ${step} of 3</p>${body}</section></div>`,
    job.id,
  );
}

export function renderFirstStep(job, key) {
  if (job.id === "lever") {
    return page(
      job.title,
      `${jobHeader(job)}<h2>Submit your application</h2>${opening(job, key)}<ul class="application-list"><li><strong>Resume / CV</strong>${resume(job)}</li><li><strong>Contact information</strong><div>${contactFields(job)}</div></li></ul><section class="question-card"><h3>Work eligibility</h3>${eligibilityFields(job)}</section><section class="question-card"><h3>Motivation</h3>${whyUs(job)}</section><button id="btn-submit" type="submit">Submit application</button></form>`,
      job.id,
    );
  }
  if (job.id === "ashby") {
    return page(
      job.title,
      `${jobHeader(job)}${tabs(job, "application")}${opening(job, key, "/apply", "ashby-application")}<section class="ashby-section"><h2>Foundations</h2>${contactFields(job)}${resume(job)}</section><section class="ashby-section"><h2>Qualifications</h2>${whyUs(job)}</section><section class="ashby-section"><h2>Logistics</h2>${eligibilityFields(job)}</section><button type="submit">Submit Application</button></form>`,
      job.id,
    );
  }
  return wizard(
    job,
    1,
    `${opening(job, key, "/step/1", "contact-page")}<fieldset><legend>How can we contact you?</legend>${contactFields(job)}</fieldset><button type="submit">Continue to eligibility</button></form>`,
  );
}

export function renderSecondStep(job, fields) {
  const retained = ["idempotencyKey", ...job.nameFields, "email"]
    .map((name) => hidden(name, fields[name]))
    .join("");
  return wizard(
    job,
    2,
    `<form id="eligibility-page" method="post" enctype="multipart/form-data" action="${job.url}/step/2">${retained}${eligibilityFields(job)}<button type="submit">Continue to documents</button></form>`,
  );
}

export function renderFinalStep(job, fields) {
  const retained = [
    "idempotencyKey",
    ...job.nameFields,
    "email",
    "workAuthorization",
    job.sponsorshipField,
    "sponsorshipDetails",
  ]
    .filter((name) => fields[name] !== undefined)
    .map((name) => hidden(name, fields[name]))
    .join("");
  return wizard(
    job,
    3,
    `<dl><dt>Applicant</dt><dd>${escapeHtml(fields.name)}</dd><dt>Email</dt><dd>${escapeHtml(fields.email)}</dd><dt>Authorization</dt><dd>${escapeHtml(fields.workAuthorization)}</dd><dt>Sponsorship</dt><dd>${escapeHtml(fields[job.sponsorshipField])}</dd></dl><form id="documents-page" method="post" enctype="multipart/form-data" action="${job.url}/apply">${retained}<fieldset><legend>Tell us why you are interested</legend>${whyUs(job)}</fieldset><fieldset><legend>Attach your document</legend>${resume(job)}</fieldset><button type="submit">Send local application</button></form>`,
  );
}

export function renderReceipt(submission) {
  const applicant =
    submission.fields.name ?? `${submission.fields.firstName} ${submission.fields.lastName}`;
  return page(
    "Application received",
    `<h1>Test application received</h1><p>${escapeHtml(submission.receipt.text)}</p><p>Receipt reference: <strong data-receipt-id="${escapeHtml(submission.receipt.id)}">${escapeHtml(submission.receipt.id)}</strong></p><p>Applicant: ${escapeHtml(applicant)}</p><p>This receipt confirms one local fixture submission only.</p>`,
  );
}

export function renderError(message) {
  return page(
    "Application error",
    `<h1>Application could not be accepted</h1><p role="alert">${escapeHtml(message)}</p><p>Return to the application and correct the indicated fields.</p>`,
  );
}
