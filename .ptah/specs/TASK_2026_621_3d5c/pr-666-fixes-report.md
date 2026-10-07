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

## Revision 2 (SonarCloud)

### Reliability bugs — valid and fixed

The four `typescript:S9383` reports were valid: the turn-complete, episode,
commit-detect, and idle handlers started the promise returned by
`tryEpisodeCurate` and did not observe a rejection
(`memory-trigger.service.ts:448`, `:627`, `:651`, `:709`). Those callbacks
must remain synchronous so that SDK hook timing is unchanged. They now call
`dispatchEpisodeCurate` (`:810-831`), which attaches a rejection handler and
logs the session, source, and error through the injected logger. The derived,
handled promise is explicitly ignored only after the rejection handler is
attached. The handler does not return a literal sentinel, so it needs no
degradation-audit marker; it always logs the failure.

Pinning spec: `memory-trigger.service.spec.ts` test "logs a rejected
asynchronous turn-complete dispatch" mocks a rejected pass and verifies the
injected logger receives the error. It fails without the rejection handler.

### Small code-smell fix

`typescript:S6582` was valid at `memory-trigger.service.ts:871`. The
rate-limiter snapshot condition now uses `snap?.windowStartMs`, with identical
behavior for an absent snapshot.

### Deferred code smells

- `boot-scan-runner.ts:411` (`S3776`): extracting the retry state machine is
  not behavior-preserving as a small change: it coordinates ledger mutation,
  abort handling, slot reservation, throttle timing, and retry tally updates.
  Deferred to avoid changing boot-scan reliability behavior while closing the
  gate.
- `memory-trigger.service.ts:918` (`S3776`): the curate outcome state machine
  has coupled queue, detached-episode, retry-budget, and rate-limit-refund
  side effects. A safe split needs a focused refactor beyond this Sonar fix.
- `boot-scan-runner.ts:496` (`S9382`): the await remains deliberately
  sequential. It enforces `throttleMs` between retry attempts and preserves
  the ledger/slot ordering; parallel retries would defeat both constraints.

### Checks

Exact observed result lines:

- `npx nx test memory-curator --skip-nx-cache`: `Test Suites: 47 passed, 47 total`; `Tests:       894 passed, 894 total`; `NX   Successfully ran target test for project @ptah-extension/memory-curator`
- `npx nx run-many -t typecheck,lint -p memory-curator`: `NX   Successfully ran targets typecheck, lint for project @ptah-extension/memory-curator`
- `npx nx run degradation-audit:lint`: `degradation-audit: TOTAL 294 unsuppressed site(s)`; `NX   Successfully ran target lint for project degradation-audit` (the memory-curator audit count remains at its baseline of 20 or fewer).
- `npx prettier --check libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts`: `All matched files use Prettier code style!`

## Revision 1 — independent review fixes

### 1. Terminal-row pagination — valid

Evidence: `listGivenUp` applied `LIMIT 20` before the runner compared stored and current mtime, so unchanged or deleted terminal rows could permanently fill the result. `boot-scan-failure-ledger.ts` now accepts an offset, and `boot-scan-runner.ts` pages terminal rows until it finds at most 20 changed generations. Only changed, present files increment that admission count; unchanged and missing files do not consume it.

Pinning specs: `boot-scan-runner.spec.ts` proves a changed row after 20 missing rows is admitted, proves an unchanged-mtime row is not admitted, and therefore proves missing rows do not consume the changed-generation budget.

### 2. Session-end skipped dispatch — valid

Evidence: the previous `Promise.resolve()` return from `tryEpisodeCurate` made the session-end `.finally` clear `failedPasses` when dispatch was coalesced, rate-limited, held by backoff, or empty. That could reset the retry count owned by a live pass.

Change: `tryEpisodeCurate` now returns `null` for every skipped dispatch and a promise only after it actually starts `invokeCurate`. `flushSessionEnd` clears state only for that actual pass. It uses `then(success, failure)` rather than discarding a derived `finally` promise, and the ending-session token is registered only after a pass starts.

Pinning spec: `memory-trigger.service.spec.ts` starts a pending pass, fires a coalesced session-end event, then verifies the resulting failed-pass count increments from 1 to 2 rather than being reset.

### 3. Failed session-end episode reattachment — valid

Evidence: `invokeCurate` reattached a detached episode after a failed or stalled pass, while `flushSessionEnd` had already reset the ended session. The reattached buffer was then left behind.

Change: session-end passes no longer reattach their detached episode for either failed or stalled outcomes; non-end passes preserve their existing retry behavior.

Pinning spec: `memory-trigger.service.spec.ts` verifies the session episode remains empty after a failed session-end pass.

### 4. Bounded thrown scan runs and hard stops — valid

Evidence: a thrown `options.run` was logged but did not call `recordFailure`, so an admitted terminal row could retry once per boot indefinitely. The runner now records the thrown attempt through the existing ledger cap; no-ledger scans retain their established continue-after-throw behavior. The retention hard-stop behavior is explicitly asserted as unread (`stuckKept: null`) for a time-budget stop.

Pinning specs: `boot-scan-runner.spec.ts` verifies a thrown run calls `recordFailure`; `memory-retention.service.spec.ts` verifies a hard time-budget stop leaves the stuck count unread.

### Revision 1 checks

- `npx nx test memory-curator --skip-nx-cache --maxWorkers=2`
  Exact result lines: `Test Suites: 47 passed, 47 total`; `Tests:       893 passed, 893 total`; `NX   Successfully ran target test for project @ptah-extension/memory-curator`.

- `npx nx run-many -t typecheck,lint -p memory-curator --parallel=2`
  Exact result line: `NX   Successfully ran targets typecheck, lint for project @ptah-extension/memory-curator`.

- `npx nx run degradation-audit:lint`
  Exact result line: `NX   Successfully ran target lint for project degradation-audit`.

- `npx prettier --check <changed files>`
  Exact result line: `All matched files use Prettier code style!`
