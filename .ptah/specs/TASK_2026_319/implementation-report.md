# Implementation report — TASK_2026_319

**Verdict: both defects fixed, verification gate green, task record corrected.**

`memory.triggers.bootScan` still defaults to `true`. Neither
`memory-trigger-config.ts:53` nor `platform-core/src/file-settings-keys.ts:555`
was touched.

---

## Defect 1 — the cold start read unbounded history

**File:** `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\boot-scan-runner.ts`

`readWatermark` returned `number` and collapsed three different situations onto
`0`: no row, a row holding `0`, and a read that threw. With a watermark of `0`
every session file satisfied `mtime > watermark`, so the first launch in any
workspace curated that project's whole Claude history.

### Changes

1. **`readWatermark` now returns `number | null`.** `null` means "this pipeline
   has no mark for this fingerprint". A row is only accepted when its value is a
   finite number; a non-numeric stored value degrades to `null` rather than
   being fed into an arithmetic comparison.

2. **The `catch` path returns `null` too**, so a locked or corrupt database
   takes the cold path _and its floor_ instead of scanning everything. It now
   also emits `logger.warn('[boot-scan] watermark read failed — treating as
cold', …)`, narrowed with `err instanceof Error`. `readWatermark` gained a
   `logger: Logger` parameter for this, matching `writeWatermark`, which already
   took one.

3. **`COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000`**, declared next to the
   runner with the docblock the task asked for: what it bounds, why seven days
   rather than "since install" (an install timestamp would express the intent
   exactly, but it is a durable fact nothing stores and the same DB reset that
   produces a cold read would erase it — a rolling week is the bounded
   approximation that self-heals), and the explicit note that a persisted
   watermark is never floored in either direction.

4. **The floor is applied only on absence:**

   ```ts
   const now = options.now ?? Date.now();
   const watermark = persisted ?? now - COLD_START_LOOKBACK_MS;
   ```

   A cold start also logs one `info` line naming the pipeline, fingerprint and
   floor, so the reason a boot scanned nothing is visible.

5. **`BootScanRunnerOptions.now?: number`**, defaulting to `Date.now()`, for
   testability. No global clock abstraction — the floor is the only consumer and
   a port for one subtraction would not earn itself.

### The shared runner: the floor applies to BOTH pipelines

This is the runner `memory` and `skills` share. The floor bounds both, and that
is correct — neither pipeline should reach back into a history the user
accumulated before Ptah existed. Recorded in a new class-level docblock on
`BootScanRunner` and pinned by a spec that runs the `skills` pipeline through
the same assertion.

### The write guard still holds, and the rolling behaviour is intended

`if (maxMtime > watermark)` is unchanged. On a cold start `watermark` is the
floor rather than a stored value, so `maxMtime` only exceeds it when something
inside the window actually ran. A cold boot that finds nothing in the last seven
days therefore writes **no row**, and the next boot re-floors to a fresh
`now - 7 days`. Verified and pinned ("writes NO watermark when the 7-day window
is empty, so the next boot re-floors"); a comment above the guard says the
behaviour is intended so it is not "fixed" later.

---

## Defect 2 — the boot scan bypassed the hourly budget

**File:** `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`

Confirmed on the code before the change: `rateLimiter.tryAcquire` was reached
only from `onUserPromptSubmit` (the cue path) and `tryEpisodeCurate` (the
episode path). `runBootScan`'s `run` callback called `this.curator.curate`
directly, and `MemoryCuratorService.curate` holds no limiter — its only internal
gate is the provider QUOTA gate that yields `outcome: 'stalled'`. So
`maxCuratesPerHour` did not constrain the boot scan at all.

### Change

The `run` callback now opens with:

```ts
const decision = this.rateLimiter.tryAcquire(RATE_LIMIT_KEY, this.readMaxCuratesPerHour());
if (!decision.allowed) {
  this.curator.pushEvent({
    kind: 'rate-limited',
    timestamp: Date.now(),
    sessionId: scanSessionId,
    stats: {
      source: 'boot',
      limit: decision.limit,
      resetAt: decision.resetAt,
      usedThisWindow: decision.usedThisWindow,
    },
  });
  return 'stalled';
}
```

Same `RATE_LIMIT_KEY` (`'memory.curate'`) and the same event shape as `:470` and
`:657`, so all three paths draw from one bucket and the Memory tab shows a
consistent reason. It sits at the very top of the callback — ahead of the
transcript read as well as the curate — so a refused session costs no file I/O
either.

`'stalled'`, not `'ran'`, is the load-bearing half. It reuses machinery that
already exists and is already tested: `BootScanRunner` stops the entire scan on
`'stalled'`, does not advance the watermark past that item, and leaves the
remaining sessions for the next boot. I read the comment block on that branch
first — `eligible` is sorted mtime-ascending while the watermark is the MAX over
handled items, so letting a later item succeed past a stalled one would jump the
watermark over the stalled session and lose it. Returning `'ran'` would record a
session that was never read.

### `skill-synthesis` was deliberately NOT wired to the limiter

**File:** `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts`

Its `run` callback calls `synthesis.enqueueAnalyze`, a local SQLite insert that
spends nothing upstream; what the row eventually costs is gated later by the
drain's own token budget and tier caps. Charging it to the curate budget would
starve real curation to pay for free work. The only change on that side is a
comment amendment recording the asymmetry as deliberate, appended to the
existing "Always `'ran'`" block. Both sides now point at each other.

---

## Specs

### `boot-scan-runner.spec.ts` — new `describe('the cold-start floor (TASK_2026_319)')`, 7 cases

Two new fixtures were needed because the existing `makeSqlite` reports "no row"
for any value `<= 0` — the very conflation being removed:

- `makeSqliteWithRow(value)` — the row exists and holds `value`, including `0`.
- `makeSqliteReadThrows(state)` — the watermark SELECT throws.

Cases:

| Case                                                                | Proves                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| older than 7 days ineligible, inside the window eligible            | the floor exists and is a floor, not a switch                                |
| persisted watermark used verbatim, even one older than 7 days       | a live mark is never floored forward                                         |
| persisted watermark of `0` honoured                                 | a stored zero is not an absent row                                           |
| a read that THROWS is treated as cold                               | the catch path floors rather than scanning everything                        |
| the same floor applies to the `skills` pipeline                     | the shared runner bounds both                                                |
| empty window writes NO watermark                                    | the rolling re-floor still holds                                             |
| a non-empty cold window still runs and still advances the watermark | **paired positive** — the floor cannot be satisfied by making the scan inert |

### `memory-trigger.boot-scan-budget.spec.ts` — new file, 4 cases

Drives the REAL `CuratorRateLimitService` and the REAL `BootScanRunner` through
`MemoryTriggerService.start()`, over a real temp sessions directory, because the
property under test is the interaction between them. The harness awaits the
runner's terminal `boot-scan` event rather than sleeping.

| Case                                                                      | Proves                                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| budget exhaustion stops the scan                                          | `curate` called once with a limit of 1 over 2 sessions; `rate-limited` emitted with `source: 'boot'`; `boot-scan` reports `stalled: 1`; watermark stops below the refused session |
| the refused session is eligible again on the next boot                    | second run over the same watermark row curates exactly the session the first run refused — **nothing was lost**                                                                   |
| with budget available the scan runs everything and advances the watermark | **paired positive** — no `rate-limited` event, `succeeded: 2`, watermark advanced                                                                                                 |
| cold start bounded to 7 days end-to-end                                   | the floor reaches the service path, not just the runner                                                                                                                           |

### Mutation-verified (both fixes)

Each guard was mutated and the specs were confirmed to fail, then restored:

- `persisted ?? now - COLD_START_LOOKBACK_MS` → `persisted ?? 0`:
  **5 of 11 failed.**
- `this.readMaxCuratesPerHour()` → `0` (which `CuratorRateLimitService` treats as
  unlimited): **the 2 budget-refusal tests failed, both paired positives kept
  passing** — so the positives are not inert and the negatives are not vacuous.

---

## Verification gate — actual output

```
npx nx run memory-curator:typecheck
  NX   Successfully ran target typecheck for project @ptah-extension/memory-curator

npx nx run memory-curator:lint
  ✖ 6 problems (0 errors, 6 warnings)
  NX   Successfully ran target lint for project @ptah-extension/memory-curator

npx nx run memory-curator:test
  Test Suites: 2 skipped, 24 passed, 24 of 26 total
  Tests:       60 skipped, 376 passed, 436 total
  NX   Successfully ran target test for project @ptah-extension/memory-curator

npx nx run skill-synthesis:typecheck
  NX   Successfully ran target typecheck for project @ptah-extension/skill-synthesis

npx nx run skill-synthesis:test
  Test Suites: 6 skipped, 65 passed, 65 of 71 total
  Tests:       37 skipped, 1324 passed, 1361 total
  NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

All runs used `--skip-nx-cache`.

Targeted run of the new work only:

```
npx nx run memory-curator:test -t "TASK_2026_319"
  Test Suites: 24 skipped, 2 passed, 2 of 26 total
  Tests:       425 skipped, 11 passed, 436 total
```

### On the 6 lint warnings

All six are **pre-existing and warn-level**; zero errors. They are the
`max-lines` soft ceiling on `memory-search.service.ts` (843) and
`memory-trigger.service.ts` (931), a `no-non-null-assertion` in
`memory-search.service.spec.ts`, and two unused type imports in
`memory-trigger.coalesce.spec.ts`. My change adds ~18 lines of code plus
comments to `memory-trigger.service.ts`, which was already well past the ceiling
before this task; per the repo's file-size rule this is a warn, not an alarm, and
splitting the file was out of scope here.

---

## Task record corrected

**`context.md`:**

- The "Budget-limited downstream" bullet is corrected in place: it states plainly
  that the claim was **false when written**, explains why (`curate` has no
  limiter; `tryAcquire` was only on the cue and episode paths), and says the
  claim is true as of this task and only as of this task. A following paragraph
  adds the matching hole in the watermark bullet — it was only reassuring in
  steady state, which is why TASK_2026_315's verification boot saw nothing.
- **`## Decision (2026-08-24, user)`** rewritten as
  "**keep `true`, bound the cold start**". It preserves the fact that flipping to
  `false` was considered and recorded, states that it was superseded the same day
  before any code was written, and gives the reasoning: the objection was
  "unbounded and unbudgeted", both of which were fixable defects rather than
  properties of the feature, and turning the feature off would have hidden them.
  It then lists the two fixes, names both defaults as unchanged, and closes with
  "do not re-litigate without reading the two fixes — the version of this feature
  that motivated the flip no longer exists".

**`task.md`:** the `status:` line only, `backlog` → `in_review`, via `Edit`. The
`>-` block scalars for `title` and `description` were not touched.

The `description` frontmatter still carries the same "budget-limited downstream"
phrase in its narrative of _why TASK_2026_315 declined to act_. I left it alone
deliberately: it is a quotation of the prior task's reasoning, the carrier is
machine-read, and rewriting a `>-` block scalar is the exact operation the repo
rules warn makes a task vanish from the board. The correction lives in
`context.md`, which is where prose belongs.

---

## Files changed

| File                                                                                                              | Change                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\boot-scan-runner.ts`                     | cold-start floor, `readWatermark` → `number \| null`, `now?` option, docblocks |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.service.ts`               | budget gate in the boot-scan `run` callback, returning `'stalled'`             |
| `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts`               | comment only — records the deliberate asymmetry                                |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\boot-scan-runner.spec.ts`                | +7 cases, +2 sqlite fixtures                                                   |
| `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\triggers\memory-trigger.boot-scan-budget.spec.ts` | **new** — 4 cases                                                              |
| `D:\projects\ptah-extension\.ptah\specs\TASK_2026_319\context.md`                                                 | corrected budget claim + rewritten decision                                    |
| `D:\projects\ptah-extension\.ptah\specs\TASK_2026_319\task.md`                                                    | `status:` line → `in_review`                                                   |

Nothing under `libs/backend/workspace-intelligence/**`, `apps/ptah-cli/**` or
`.github/**` was touched. No git operations were performed.
