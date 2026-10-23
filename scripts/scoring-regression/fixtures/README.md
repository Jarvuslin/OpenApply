# Historical scoring integrity corpus

`phase1-g.json` contains only the known synthetic applicant, four fictional local
postings, and their preserved rubric-version-2 assessments. It excludes run
transcripts, credentials, submission records, real applicant data and server
configuration. The provider-facing contexts have `cachedAssessment: null`;
historical judgments are stored separately.

The exporter `apps/api/scripts/export-scoring-corpus.ts` reads the preserved G
report and `synthetic-original.txt` without changing either. It verifies the
known applicant text, scoped fictional companies, exact posting/source/preference
hashes, every quotation, and the server's score arithmetic. New output uses an
exclusive create; the exporter cannot overwrite existing evidence. Provenance
contains the source report and original-text hashes.

All four scores are 100. These positive fixtures prove data integrity, not
representative model quality or a Haiku/Sonnet comparison. Actual historical
model/version and usage are unavailable from this report. Authored edge cases and
simulated outputs must retain their separate provenance. Nothing here authorizes
an inference request or a default-model change.
