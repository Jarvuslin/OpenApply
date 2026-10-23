# Queue experience regression

Seed once from preserved Phase 8 synthetic evidence:

```
node scripts/queue-experience-regression/run.mjs --run-id phase9-seed-20261008-a --seed-source .temp/telegram-regression/telegram-db-20261008-b
```

The seed command only creates a verified disposable clone, copies storage, and adds a fresh synthetic account. It never starts UI services or calls providers. It preserves a new Phase 9 source report, database fingerprint, and storage hash.

Render against another clone, reusing that source after UI-only fixes:

```
node scripts/queue-experience-regression/run.mjs --run-id phase9-ui-20261008-a --ui-source .temp/queue-experience-regression/phase9-seed-20261008-a
node --test scripts/queue-experience-regression/*.test.mjs
```

The observer uses 1366×768 and 1440×900. Only exact-target Pause/Resume/Stop controls reach the API. All other records and artifact bytes stay protected; login refresh tokens and the exact controlled work item/event rows are the only integrity exemptions. The UI clone resets only its synthetic password before taking its baseline. Both grants are empty, the model budget is zero, and no companion is connected.

Worker status, the two owned viewer rows' active-detail state, explicit view-token response and JPEG frames are intercepted synthetic UI fixtures. Those rows stay queued in the database with zero executions and leases. This gate proves display, identity rejection, switching, stale-state removal and polling cancellation. It does not prove actual worker execution or screenshot capture; terminal ownership tests and the isolated Chromium broker test provide those separate measurements. The seeded submitted record is clearly synthetic and copies a hash-verified fixture PDF. It is not employer acceptance.

Reports contain closed failure categories, bounded request metadata, masked laptop screenshots, and no passwords or tokens. Source report bytes, database contents, artifact storage and staged source inventories are checked without rewriting the preserved source.
