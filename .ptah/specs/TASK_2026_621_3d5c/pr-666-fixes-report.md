# PR #666 review and CI fixes

## 1. Degradation audit CI failure — valid

Evidence: each of the four ledger catch bodies returned a sentinel after logging at `libs/backend/memory-curator/src/lib/triggers/boot-scan-failure-ledger.ts:118`, `:141`, `:156`, and `:170`. These operations intentionally degrade: a ledger failure must not stop the boot scan, and the runner preserves safety by keeping the watermark below an unrecorded failed session.

Change: added the required first-line `degradation-audit: reported` marker in every catch body, with the specific degradation reason. The baseline was not changed.

Pinning verification: `npx nx run degradation-audit:lint`.

## 2. Retention stuck-row count after row budget — valid

Evidence: `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:401` previously guarded the independent stuck-row count with `!stop`; the purge sets `stop = 'row-budget'` at `:369`, so `stuckKept` was incorrectly left unknown.

Change: the count now runs when `stop === null || stop === 'row-budget'`, while hard stops remain unread. Updated the existing row-cap unit expectation at `memory-retention.service.spec.ts:1062` and matching real-SQLite integration expectation at `memory-retention.integration.spec.ts:1058`; both now pin `stuckKept` while the row budget is exhausted.

## 3. Changed `given_up` generation below watermark — valid

Evidence: normal admission at `boot-scan-runner.ts:196` requires `mtime > watermark`, while retry admission at `:400` reads only `listPending`; terminal `given_up` rows were therefore omitted. A changed file can retain an older mtime when copied with preserved timestamps, and clock skew can also place it below an already advanced watermark.

Change: added a bounded `listGivenUp` ledger query with stored mtime, then independently admits changed terminal generations before retry-slot reservation and normal scanning. The normal scan's `eligible` list includes that work, so the existing reserved-slot behavior applies. `boot-scan-runner.spec.ts` now pins a changed `given_up` file whose new mtime remains below the stored watermark.

## 4. Session-end failed-pass state after rekey — valid

Evidence: `memory-trigger.service.ts:480` starts the end pass without awaiting it; `invokeCurate` records failed attempts at `:904`, and successful/terminal processing normally clears them at `:932`. A failed end pass could retain the count after teardown. `rekeySession` at `:366` moves already-recorded state to the new ID, leaving either the original or rekeyed key vulnerable to inheritance.

Change: end passes now return their settling promise to `flushSessionEnd`; that path clears failure state after settlement under both the initial and rekeyed identity. A lightweight identity record follows `rekeySession` during the pending pass. `memory-trigger.service.spec.ts` pins a failed, deferred end pass rekeyed from `s1` to `s2` and verifies no failure count remains.

## Checks

- `npx nx test memory-curator --testPathPatterns="boot-scan|memory-trigger|memory-retention" --maxWorkers=2`
  Exact result line: `NX   Successfully ran target test for project @ptah-extension/memory-curator`
  (`Test Suites: 10 passed, 10 total`; `Tests: 236 passed, 236 total`.)

- `npx nx test memory-curator --maxWorkers=2`
  Exact result line: `NX   Successfully ran target test for project @ptah-extension/memory-curator`
  (`Test Suites: 47 passed, 47 total`; `Tests: 888 passed, 888 total`.)

- `npx nx run-many -t typecheck,lint -p memory-curator --parallel=2`
  Exact result line: `NX   Successfully ran targets typecheck, lint for project @ptah-extension/memory-curator`

- `npx nx run degradation-audit:lint`
  Exact result line: `NX   Successfully ran target lint for project degradation-audit`

- `npx prettier --check <changed files>`
  Exact result line: `All matched files use Prettier code style!`
