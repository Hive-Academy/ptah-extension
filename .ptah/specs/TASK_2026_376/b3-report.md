# Batch B3 report — F4, the memory curator loses a curation window silently

Executor: CLI agent. Date: 2026-09-03.
Write boundary respected: only `libs/backend/memory-curator/**` changed.
`libs/backend/agent-sdk/src/lib/internal-query/**` was read and left untouched — see
"What I did not change" below for why.

---

## 1. What the log actually shows

The brief states that window two of a transcript queues behind window one. The
code says otherwise, and the correction matters because it changes the fix.

`CuratorWindowRunner.extractAcrossWindows` spends windows **sequentially**, and
`InternalQueryService.holdSlotUntilDone` releases the slot when the consumer
breaks out of the stream — which `SdkInternalQueryCuratorLlm.runQuery` does at
the `result` message. So a pass **releases its lane slot between window N and
window N+1**. Two windows of one pass never hold the lane at the same time.

That release is the fault. The gate's `drain()` scans for the first admissible
waiter and wakes it the instant the slot frees, so when a **second curation
pass** is queued, it is admitted in the gap and window N+1 goes to the back of
the lane queue behind a whole competing query. The captured log agrees: the
split line names session `50653b50`, and the `extracted: 0` failure names a
**different** session, `ff10bd1d`. Two passes, not two windows of one pass.

The consequence is worse than the finding states. On the failure path
`MemoryTriggerService.invokeCurate` treats any `outcome: 'ran'` as consent to
advance state, so `observationQueue.markProcessed(ids)` ran on rows that were
never curated. The rows are gone, not merely uncurated.

## 2. Approach chosen — (a), with the residual case covered

**Primary: one curation pass at a time.** `curate()` now submits every pass
through `CuratorJobQueue`, a promise chain held by the singleton service. A pass
holds its position across all of its queries, so no sibling curator query can
enter the lane in the gap between two of its windows.

The argument that this is free: `lane: 'memory-curator'` has **exactly one call
site in the repository** (`SdkInternalQueryCuratorLlm.runQuery`, verified by
grep) and a per-lane ceiling of one. Two passes were therefore **already**
serialised — by the gate, one query at a time, with a destructive 60-second
ceiling on each wait. The queue moves that same waiting one level up, where it
is ordered and loses nothing. Throughput is identical.

**Residual: the global ceiling.** The queue cannot cover a wait caused by
`blockedBy: 'global'` — `skill-synthesis` and `default` can hold both slots at
once. For that case a queue timeout is retried on the same query against
`QueueSlotRetryBudget`: **one allowance of 2, shared by every extract window and
the resolve call of a pass**. There is no delay, because a FIFO wait is the
backoff. A retry costs nothing upstream — the query never dispatched.

**Terminal: defer, never report a run.** When the allowance is spent, the pass
returns `outcome: 'stalled'` through `recordCuratorDeferral`, not `'ran'`.
`MemoryTriggerService` then leaves the `observation_queue` rows unprocessed and
`BootScanRunner` leaves its watermark, so the dropped window is re-queued for
the next drain. This is option (c)'s requirement satisfied as the terminal case
rather than as the whole fix.

### Why the error is matched by name

`InternalQueryQueueTimeoutError` lives in `@ptah-extension/agent-sdk`, which
depends on this lib through the curator port, so importing the class here would
close the cycle. `queue-slot-timeout.ts` matches on `Error.name` and walks the
`cause` chain, because the adapter always re-throws the timeout wrapped in
`CuratorLlmQueryError`. This is the convention the adapter itself already uses
for `ProviderAuthError` and `ProviderQuotaError`, stated in its own docblock.
The walk is depth-bounded (8) and terminates on a cyclic chain — pinned by a
spec.

## 3. Approaches rejected

**(b) retry alone.** Rejected as the primary fix. It leaves the curator
inflicting the contention on itself, so every multi-window pass keeps paying up
to 60 seconds per window to discover that its own sibling is ahead of it. The
test in section 5 fails on `gate.timeouts` when the job queue is removed and the
retry layer is left in place — retry rescues the curation, it does not stop the
waste. Retry is kept as the cover for the global-ceiling case only.

**(c) make the loss loud only.** Rejected as the whole fix — it repairs the
reporting and leaves the defect. Its two requirements are nonetheless honoured:
a deferred pass is not reported as a run, and its input is re-queued.

**Raising `maxConcurrentPerLane` or `DEFAULT_MAX_CONCURRENT`.** Forbidden by the
brief and by `libs/backend/agent-sdk/CLAUDE.md:83`. Not attempted.

**Holding one gate slot across the whole pass (a "lease" API on
`InternalQueryService`).** This is the most direct reading of option (a) and it
is the right long-term shape, but it is **out of this batch's write boundary**:
the lease would have to be threaded through `ICuratorLLM` (`memory-contracts`)
and `SdkInternalQueryCuratorLlm` (`agent-sdk/.../curator-llm-adapter/`), neither
of which this batch may touch. The job queue achieves the same property — a pass
is never overtaken by another pass — without changing the port. Recorded here as
the follow-up if the lane ever gains a second caller.

**Mapping the timeout onto `CuratorStallReason`.** `CuratorStallReason` is a
closed union in `libs/backend/memory-contracts` (out of boundary), so the
deferral carries its own arm on `WindowedExtraction` instead and reuses the
existing `rate-limited` diagnostics event with
`reason: 'concurrency-slot-timeout'`. `MemoryCuratorEvent.stats` is a free-form
record, so no frontend change was needed — and none was permitted.

## 4. The diff

`git` was not run (forbidden by the brief), so the changes are reproduced here
by file and line.

### New — `libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.ts` (73 lines)

```ts
export class CuratorJobQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** Passes submitted and not yet settled, including the running one. */
  get pending(): number {
    return this.depth;
  }

  /** Run `job` once every pass submitted before it has settled. */
  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    const started = this.tail.then(job);
    this.tail = started.then(
      () => undefined,
      () => undefined,
    );
    const settle = (): void => {
      this.depth--;
    };
    void started.then(settle, settle);
    return started;
  }
}
```

The tail is the settled-either-way continuation and the caller receives the real
promise. That is what makes a failed pass unable to take down the drain for
other sessions.

### New — `libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.ts` (87 lines)

```ts
export const QUEUE_SLOT_TIMEOUT_ERROR_NAME = 'InternalQueryQueueTimeoutError';
const MAX_CAUSE_DEPTH = 8;

export function isQueueSlotTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false;
    if (current.name === QUEUE_SLOT_TIMEOUT_ERROR_NAME) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export const CURATOR_QUEUE_RETRY_BUDGET = 2;

export class QueueSlotRetryBudget {
  private used = 0;
  constructor(private readonly limit: number = CURATOR_QUEUE_RETRY_BUDGET) {}
  tryConsume(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
  get spent(): number {
    return this.used;
  }
}
```

### Changed — `curator-llm/curator-window-runner.ts`

`WindowedExtraction` gains a fourth arm (`:44`):

```ts
  | {
      readonly status: 'deferred';
      readonly reason: 'concurrency-slot-timeout';
      readonly completedWindows: number;
      readonly retriesSpent: number;
    };
```

`extractAcrossWindows` takes the shared allowance and routes a congestion
failure away from `failed` (`:170-207`):

```ts
  async extractAcrossWindows(
    windows: readonly CuratorWindow[],
    signal?: AbortSignal,
    budget: QueueSlotRetryBudget = new QueueSlotRetryBudget(),
  ): Promise<WindowedExtraction> {
    ...
      try {
        extraction = await this.extractOneWindow(chunk, budget, signal);
      } catch (error: unknown) {
        // An aborted pass keeps its existing `failed` reporting. `deferred`
        // promises the caller that the pass is worth retrying, and a caller
        // that has withdrawn is not asking for that promise.
        if (isQueueSlotTimeout(error) && !signal?.aborted) {
          this.logger.info(
            '[memory-curator] curation window kept losing its concurrency slot; deferring the pass',
            { completedWindows, windows: windows.length, retriesSpent: budget.spent },
          );
          return {
            status: 'deferred',
            reason: 'concurrency-slot-timeout',
            completedWindows,
            retriesSpent: budget.spent,
          };
        }
        return { status: 'failed', error };
      }
```

New private `extractOneWindow` (`:230-248`) — the retry itself:

```ts
  private async extractOneWindow(
    chunk: CuratorWindow,
    budget: QueueSlotRetryBudget,
    signal?: AbortSignal,
  ): Promise<CuratorExtraction> {
    for (;;) {
      try {
        return await this.llm.extract(chunk.text, signal);
      } catch (error: unknown) {
        if (!isQueueSlotTimeout(error)) throw error;
        if (signal?.aborted) throw error;
        if (!budget.tryConsume()) throw error;
        this.logger.info(
          '[memory-curator] curation window lost its concurrency slot; re-queuing it',
          { retriesSpent: budget.spent },
        );
      }
    }
  }
```

Existing rules are unchanged: a non-congestion throw still abandons the run, a
`stalled` window still stops the loop, `signal.aborted` is still checked between
windows, and the duplicate-draft union is untouched.

### Changed — `memory-curator.service.ts`

- `:131` — `private readonly jobQueue = new CuratorJobQueue();`, constructed
  here for the same reason as `windowRunner` (no lifecycle, no alternative
  implementation, no other consumer). Its being a field of the **singleton**
  service is what makes "one pass at a time" host-wide.
- `:294` — `curate()` wraps the tracer span in `this.jobQueue.run(...)`.
  Coalescing is still checked **first**, so a second trigger for a session
  already queued joins that entry rather than adding one.
- `:461` — `doCurate` creates one `QueueSlotRetryBudget` per pass and passes it
  to `extractAcrossWindows`.
- `:467` — the `deferred` arm returns `recordCuratorDeferral(...)`.
- `:526-548` — `resolve` goes through the new `resolveWithinBudget` and a
  queue-slot timeout there defers too. That discards the extracted drafts and
  re-curates next pass, which costs the extracts again but loses nothing;
  recording a run would mark the rows processed and lose the session.
- `:714-732` — `resolveWithinBudget`, the twin of `extractOneWindow`.
  Deliberately not folded into a shared generic: the two differ in what they do
  when the allowance runs out (one returns an arm, one throws).
- `:752-790` — `recordCuratorDeferral`. Same shape as `recordCuratorStall`:
  touches neither `lastRunAtMs` nor `lastRunStatsCache`, pushes no
  `curator-run`, persists nothing, returns `outcome: 'stalled'`.
- `:75-96` — `CuratorRunOutcome`'s docblock now names both gates that produce
  `'stalled'`.
- `:803` — `recordCuratorError`'s "deliberately left at its pre-existing
  behaviour" note now records the one failure that no longer reaches it.

### Changed — specs

- `curator-window-runner.spec.ts` — six new cases (retry keeps the drafts, a
  sibling window runs after a predecessor had to wait, defer once the allowance
  is spent, ONE allowance shared across the set, a non-congestion failure is
  still `failed`, an aborted pass does not re-queue).
- `memory-curator.service.spec.ts` — three new cases behind a `FakeLaneGate`
  (see section 5), plus two adjustments to existing cases, both stated in the
  file:
  - the in-flight dedupe case needed `await Promise.resolve()` before its
    assertion, because a pass now starts on the next microtask. The property it
    pins — two concurrent calls, ONE extract — is unchanged.
  - `'different sessions run in parallel'` was renamed to `'different sessions
each get their own extract'`. Its assertion is unchanged; the old title was
    made false by this batch and a false title is a trap.
- New `curator-job-queue.spec.ts` and `queue-slot-timeout.spec.ts`.

### Changed — `libs/backend/memory-curator/CLAUDE.md`

One new Guidelines bullet stating the rule, the measurement, and the two fixes
that are forbidden here (`maxConcurrentPerLane`, `maxConcurrent`), plus the
`curator-llm/` structure entry.

## 5. The test that pins the fix

`memory-curator.service.spec.ts`, `'a sibling window is not lost when a
predecessor outlives the wait ceiling'`. `FakeLaneGate` is the real gate
narrowed to one lane, a ceiling of one, FIFO admission and a wait ceiling, and
it rejects a timed-out waiter with an `InternalQueryQueueTimeoutError` wrapped
in a `CuratorLlmQueryError` — the exact shape the adapter throws. Every
millisecond figure is scaled from production (60 000 ms budget, 24-37 s windows)
so the ratio that produces the defect survives: a 40 ms query against a 15 ms
wait ceiling.

One session curates a transcript that really does plan several windows (asserted,
so the test cannot pass for the wrong reason) while a second session curates
concurrently. Both must finish with `outcome: 'ran'` and `extracted > 0`, and
`gate.timeouts` must be **0**.

Measured with the job queue bypassed (`Promise.resolve().then(...)` in place of
`this.jobQueue.run(...)`, everything else intact):

```
● MemoryCuratorService — concurrency-slot loss (TASK_2026_376 F4) › a sibling window
  is not lost when a predecessor outlives the wait ceiling
Test Suites: 1 failed, 2 skipped, 29 passed, 30 of 32 total
Tests:       1 failed, 60 skipped, 466 passed, 527 total
```

The file was restored immediately afterwards.

## 6. Verify

Project names taken from each `project.json`: `@ptah-extension/memory-curator`
and `@ptah-extension/agent-sdk`.

```
npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/agent-sdk --skip-nx-cache
```

Header read and checked — `Running target test for 2 projects`, which is the
number asked for. Real output:

```
 NX   Running target test for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/agent-sdk

> nx run @ptah-extension/memory-curator:test

Test Suites: 2 skipped, 30 passed, 30 of 32 total
Tests:       60 skipped, 467 passed, 527 total
Snapshots:   0 total
Time:        27.774 s
Ran all test suites.

> nx run @ptah-extension/agent-sdk:test

Test Suites: 1 skipped, 85 passed, 85 of 86 total
Tests:       2 skipped, 1405 passed, 1407 total
Snapshots:   0 total
Time:        27.669 s
Ran all test suites.

 NX   Successfully ran target test for 2 projects
```

No failures. The two skipped memory-curator suites and the one skipped agent-sdk
suite are pre-existing.

Lint and types, same lib:

```
npx nx run-many -t lint typecheck -p @ptah-extension/memory-curator
...
✖ 6 problems (0 errors, 6 warnings)
> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json
 NX   Successfully ran targets lint, typecheck for project @ptah-extension/memory-curator
```

All six warnings are pre-existing and in files this batch did not touch
(`memory-search.service.*`, `memory-trigger.*`). No new file exceeds the 700-line
soft ceiling; the two new files are 73 and 87 lines and each owns one nameable
concern.

## 7. Invariants

- **A curator failure never takes down the drain for other sessions.**
  `CuratorJobQueue.tail` is the settled-either-way continuation, pinned by
  `'a failed job never takes down the queue'`.
- **The gate keeps ONE predicate and ONE queue.** No file under
  `libs/backend/agent-sdk/src/lib/internal-query/` was modified. The job queue
  admits nothing and counts no slots; every query it releases still faces the
  same `active < limit && activeInLane < perLaneLimit`. No lane bypass, no
  second semaphore.
- **FIFO within a lane is preserved.** Untouched. The curator's own passes are
  now FIFO as well.
- `catch (error: unknown)` narrowed with `instanceof Error` throughout
  (`isQueueSlotTimeout` does the narrowing for the callers that need it). No
  `@ts-ignore`, no compatibility shim, no new Zod boundary — none was crossed.

## 8. What I did not change, and what is left

- `libs/backend/agent-sdk/src/lib/internal-query/**` — read in full, unmodified.
  `DEFAULT_QUEUE_TIMEOUT_MS` is still 60 000 and both ceilings are untouched.
- The lease-shaped version of option (a) needs `memory-contracts` and the
  curator adapter, both outside this boundary. Worth doing if `memory-curator`
  ever gains a second internal-query caller, which would make the job queue
  insufficient on its own.
- `recordCuratorError`'s wider question — whether a **dispatched** failure
  should also preserve its input — is still open and still deliberately left
  where TASK_2026_306 left it. Only the never-dispatched case moved.

## 9. Note for the integrator — a concurrent batch touches the same error path

While this batch ran, another agent was editing
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts`
for finding F8 (`CuratorQueryOutcome` grows `tools-only` and `silent` arms).
That file is outside this batch's write boundary and was not modified here.

One coupling to check when the two batches meet: this batch recognises a queue
timeout by `Error.name` walked through the `cause` chain, and it relies on
`runQuery` continuing to re-throw with the original error as `cause`
(`new CuratorLlmQueryError(message, { cause: error })`). If F8 changes that
catch block so the cause is dropped, `isQueueSlotTimeout` stops matching and the
deferral path goes dark — silently, because the pass would fall back to
`recordCuratorError` and report `outcome: 'ran'` again. The spec
`'recognises it through the curator adapter wrapper'` in
`curator-llm/queue-slot-timeout.spec.ts` pins the shape this batch expects, but
it builds the wrapper itself, so it cannot catch a change made on the adapter
side. A one-line check of that catch block after both batches land is enough.
