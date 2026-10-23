# 3. Keep the two key-sorting JSON hash functions separate

Date: 2026-10-14. Status: accepted.

## Context

Finding 26 of the 2026-10-13 bloat review merged the copies of the SHA-256 helper into
`apps/api/src/common/crypto/hash.ts`. Two key-sorting JSON functions were left:

- `resume/resume-artifact-store.ts` sorts object keys with `localeCompare`;
- `scoring-evaluation/evaluation.hash.ts` sorts them by UTF-16 code unit.

Both feed hashes that are stored in the database (artifact lookup keys and evaluation payload
hashes). The two orders differ for some keys, for example mixed case.

## Decision

Keep them separate. Do not merge them, and do not change either sort order.

## Consequences

- Stored hashes stay valid with no data migration.
- The keys hashed today are fixed ASCII field names, so neither order causes a bug.
- If the scoring evaluation module is removed (bloat review item 39), `evaluation.hash.ts` goes with
  it, and this ADR no longer applies.
- A future merge needs a data migration that rehashes every stored value.
