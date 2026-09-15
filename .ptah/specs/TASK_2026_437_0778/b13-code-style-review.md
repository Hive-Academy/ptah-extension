# Code Style Review — Batch 13 (`TASK_2026_437_0778`, C12 reusable bounded spawn workers)

## Summary

| Metric          | Value                                          |
| ---------------- | ----------------------------------------------- |
| Overall score    | 7/10                                             |
| Assessment       | APPROVE_WITH_FIXES                               |
| Blocking issues  | 0                                                 |
| Serious issues   | 1                                                 |
| Minor issues     | 2                                                 |
| Files reviewed   | 4 (spawner, worker source, spec, CLAUDE.md)      |

Scope: only the Batch 13 diff was read — `git -C D:\projects\ptah-437 diff` against the four
named files. `off-thread-process-spawner.ts` was read in full (1016 lines), not just the diff
hunks, because the new `SpawnWorkerPool`/`PooledSpawnWorker` classes interleave with pre-existing
`WorkerBackedProcess` code and a hunk-only read would have missed how they interact.

## Five style questions

### 1. What breaks in six months?

The file is 1016 lines and will keep growing — Batch 13 already documents that this is the
"C12" fix for a prior worker-per-spawn problem; the next lifecycle nuance (a second pool tier, a
priority lane, per-command TTLs) has nowhere to land except this same file, because
`SpawnWorkerPool` (`off-thread-process-spawner.ts:383-471`) and `PooledSpawnWorker`
(`:294-375`) are private classes with no module boundary of their own. Six months from now a
reviewer either grows this file past 1200 lines or does the extraction under time pressure,
which is a worse moment to do it than now (§5).

### 2. What would a new team member misread?

Nothing structural — the file's own header comment (`:51-61`) explains the pool before any code
does, and `SpawnWorkerLease`/`SpawnWorkerSink` (`:266-281`) name the two roles precisely. The one
place a newcomer could get lost is scanning for "where does a lease id come from" — `nextLeaseId`
(`:284`) is a module-level mutable counter shared by every `OffThreadProcessSpawner` instance in
the process, which is correct (ids only need to be process-unique per the comment) but is easy to
misread as per-pool state on a fast read.

### 3. What does this cost to maintain?

Every future change to pool behaviour (idle cap, TTL, soft-cap policy) requires touching a file
whose top third is unrelated `WorkerBackedProcess`/`InlineProcess` plumbing, so a reviewer must
hold the whole 1016-line file in their head to be confident a pool change didn't disturb the
per-child state machine below it. The classes are already decoupled in practice — `SpawnWorkerPool`
talks to its callers only through `SpawnWorkerSink`/`SpawnWorkerLease` and takes a plain `Logger`,
not a DI token — so the coupling is purely textual, not structural, which is exactly what makes
this an avoidable cost rather than an unavoidable one.

### 4. Where is this inconsistent with the rest of the repository?

`CLAUDE.md`'s own facade rule (root `CLAUDE.md`, "File size" bullet) says a split is warranted
when a nameable, cohesive collaborator can be extracted without changing the host's public name,
DI token or method signatures — the worked example is `SkillSynthesisService` /
`StageHandlersService`. `SpawnWorkerPool` already IS that shape today: `OffThreadProcessSpawner`
already treats it as an owned collaborator (`this.pool = new SpawnWorkerPool(logger)`,
`off-thread-process-spawner.ts:880`), constructed once and never reached into from outside. Every
other file in this batch that carries a similarly self-contained body already lives on its own
file — `off-thread-process-spawner-source.ts` is precisely "the worker body is a thin pipe... not
a subsystem" pulled out for its own reasons (its header cites the identical precedent,
`ts-diagnostics-worker-source.ts`). The pool is the same kind of self-contained subsystem and
was not given the same treatment.

### 5. What would you have done differently, and why is that better?

Move `SpawnWorkerSink`, `SpawnWorkerLease`, `nextLeaseId`, `PooledSpawnWorker` and
`SpawnWorkerPool` (`:266-471`, ~210 lines) into a new `spawn-worker-pool.ts`, alongside
`POOL_MAX_IDLE`, `POOL_IDLE_TTL_MS`, `LIVE_WORKER_SOFT_CAP` and `OVER_CAP_WARN_INTERVAL_MS`. It
clears the nameability test (`SpawnWorkerPool`, not `helpers`/`utils`), lands comfortably over the
~150-line floor the guardrail sets, and is a pure move: `HostMessage`/`WorkerMessage` stay in the
main file (both sides need them) and get imported as types, `OFF_THREAD_SPAWNER_WORKER_SOURCE`
moves its one remaining consumer (`PooledSpawnWorker`'s constructor) with it. The three exported
constants are consumed only by the spec (they are not in the `helpers/index.ts` barrel — confirmed
below), so moving them costs the spec one import-path edit and nothing else. This was a small,
low-risk move available inside this batch; it was not taken, and the batch shipped instead with
the pool bolted onto the front of an already-large file. This is the review's one Serious
finding — see below.

## Blocking issues

None.

## Serious issues

### `SpawnWorkerPool` / `PooledSpawnWorker` should have been extracted to `spawn-worker-pool.ts` in this batch

- File: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:266-471`
- Problem: this batch pushed the file from a pre-existing size (already carrying
  `WorkerBackedProcess`/`InlineProcess`) to 1016 lines — past this repo's stated 700-line soft
  ceiling and into the "deliberate look" zone the root `CLAUDE.md` names for anything past 1000.
  The added block is a self-contained, nameable, already-collaborator-shaped subsystem
  (`SpawnWorkerPool` is instantiated once in `OffThreadProcessSpawner`'s constructor and reached
  only through `acquire`/`dispose`; `PooledSpawnWorker` is reached only through the pool). It
  communicates with the rest of the file exclusively through `SpawnWorkerSink`/`SpawnWorkerLease`,
  and depends on nothing private to `WorkerBackedProcess`.
- Impact: the next person touching pool lifecycle (idle cap, TTL, soft-cap policy, or adding a
  priority tier) has to read and hold the unrelated per-child state machine (`WorkerBackedProcess`,
  `:479-821`) in their head to be confident the change is isolated. The file is also now the
  largest changeable unit for two genuinely separate concerns (thread-pool lifecycle vs.
  process-shim lifecycle), so a future diff touching either one will show noise from the other in
  review.
- Fix: extract `SpawnWorkerSink`, `SpawnWorkerLease`, `nextLeaseId`, `PooledSpawnWorker`,
  `SpawnWorkerPool`, `POOL_MAX_IDLE`, `POOL_IDLE_TTL_MS`, `LIVE_WORKER_SOFT_CAP`,
  `OVER_CAP_WARN_INTERVAL_MS` into `libs/backend/agent-sdk/src/lib/helpers/spawn-worker-pool.ts`.
  Keep `HostMessage`/`WorkerMessage` in `off-thread-process-spawner.ts` (both files need them;
  import as `type`). `OffThreadProcessSpawner` keeps its name, DI token and both public method
  signatures (`spawn`, `spawnProcess`) unchanged — this is a pure facade-rule move, not a redesign.
  Not blocking because the code is correct as written and the 700-line ceiling is warn-level, not
  a hard gate — but it is the one piece of this batch that does not match the repo's own stated
  standard for when to split.

## Minor issues

- `off-thread-process-spawner.spec.ts:564-573,714-728` — two of the worker-reuse specs spawn real
  `git --version` with no availability guard (contrast the `.cmd`-wrapper specs at `:447-452`,
  which check `process.platform === 'win32'` before running). This has repo precedent
  (`libs/backend/vscode-core/src/services/git-info.service.apply-hunks.spec.ts` does the same), so
  it is consistent with how this codebase already tests git-shelling code, not a novel risk — but
  it is one more spec that fails opaquely (spawn-worker-pool internals, not "git missing") on a
  CI image without git on PATH.
- `off-thread-process-spawner.spec.ts:314-328` and `:526-546` — both `describe` blocks
  (`spawnProcess - the IProcessSpawner port` and `worker reuse (TASK_2026_437 C12)`) independently
  set up `jest.spyOn(Worker.prototype, 'postMessage')` in `beforeEach`/`afterEach` and read
  `postSpy.mock.calls`/`.mock.contexts`, with two near-identical but not-quite-identical helpers
  (`spawnMessages()` filters+maps calls; `spawnWorkers()` walks calls and pulls `mock.contexts` by
  index). Not wrong, and the two helpers do answer genuinely different questions (message content
  vs. thread identity), but a single shared `postSpy` fixture at the top of the file would remove
  the duplicated spy lifecycle without losing either helper.

## File-by-file

### off-thread-process-spawner.ts

Score 7/10 — 0 blocking, 1 serious, 0 minor. The pool implementation itself is correct and
carefully reasoned (lease-id filtering for stale messages, `lost`-flag ordering in `terminate()`
so a self-inflicted `exit` isn't double-reported, `unref()` discipline on both idle-park and grace
timers). The one real gap is the missed extraction (Serious, above); everything else — naming,
`catch (error: unknown)` discipline (`:798`), constant placement, DI boundary (plain `Logger`
passed down, no `@injectable` leakage into the collaborator) — matches the file's own established
style.

### off-thread-process-spawner-source.ts

Score 9/10 — 0/0/0. The `id`-stamping protocol addition (`createState`, per-message `send`)
correctly generalizes the existing single-child protocol to sequential reuse without adding any
`require()` beyond `node:worker_threads`/`node:child_process`, honouring the file's own stated
constraint against module resolution inside the `eval`'d body. Confirmed no stray backtick or
`${` sequence inside the `String.raw` template (`:92-300`) — the constraint the header comment
itself calls out. The updated header doc (`:52-91`) accurately describes the new per-child state
reset and stderr-mode branching.

### off-thread-process-spawner.spec.ts

Score 7/10 — 0/0/2 (see Minor issues). Genuinely exercises real children rather than mocking the
worker protocol, which is the only way a typo in the `eval`'d source would be caught (the file's
own stated rationale, `:27-31`). The fake-timer test (`:691-712`) is done correctly: fake timers
are scoped to the host's `setTimeout`-based TTL park, while the child spawn itself still resolves
through real inter-thread messaging (`doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask']`
keeps promise resolution live) — this is a subtle thing to get right and it is.

### CLAUDE.md (agent-sdk)

Score 9/10 — 0/0/0. The new bullet (`:83`) is accurate against the implementation: pool location,
`POOL_MAX_IDLE`/`POOL_IDLE_TTL_MS`/`LIVE_WORKER_SOFT_CAP` values, the reuse-eligibility condition
(`exitReported && !killedFlag && !abandoned`, matching `off-thread-process-spawner.ts:786`), the
lease-id mechanism, and the test list all check out against the code as written. It correctly says
"(same file)" for `SpawnWorkerPool` — if the Serious finding above is acted on, this line needs a
one-word update to the new file name.

## Pattern compliance

| Repository rule or nearby convention                                              | Status         | Evidence                                                                 |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| Facade rule: extract a nameable, cohesive collaborator rather than grow the host file | FAIL           | `off-thread-process-spawner.ts:266-471`; see Serious issue above          |
| File size ceiling treated as "deliberate look," not automatic alarm, past 1000 lines | PASS (partial) | File is 1016 lines; reviewed in full per that rule, and the look concludes an extraction was available |
| `catch (error: unknown)`, narrow before use                                        | PASS           | `off-thread-process-spawner.ts:798-803`, `:811-819`                       |
| No `@ts-ignore` without `@ts-expect-error` + reason                                 | PASS           | none present in the diff                                                  |
| Constants not needed by consumers stay out of the public barrel                    | PASS           | `POOL_MAX_IDLE`/`POOL_IDLE_TTL_MS`/`LIVE_WORKER_SOFT_CAP` absent from `libs/backend/agent-sdk/src/lib/helpers/index.ts:191-196` |
| Worker-source `String.raw` constraint (no backtick, no `${`)                        | PASS           | verified no bare backtick/`${` inside the template body, `off-thread-process-spawner-source.ts:92-300` |
| CLAUDE.md kept in sync with the implementation it documents                         | PASS           | `libs/backend/agent-sdk/CLAUDE.md:83` matches constants, reuse condition and mechanism |
| Sibling precedent for extracting an eval'd/standalone worker body to its own file  | PASS           | `off-thread-process-spawner-source.ts` already split out per the same reasoning the pool now needs |

## Maintenance debt

- Introduced: a bounded worker pool that removes a real V8-isolate-per-spawn cost (C10), with a
  correct reuse/discard policy and accurate documentation — net reduction in runtime cost, net
  small increase in file-level complexity.
- Retired: nothing removed; the pool is additive to the existing shim architecture.
- Net: positive for runtime behaviour, slightly negative for file navigability until the
  extraction in the Serious finding is done — at 210 self-contained lines it is a cheap fix
  relative to the win it protects.

## Verdict

- Recommendation: APPROVE_WITH_FIXES (the pool logic is correct and thoroughly tested; the fix is
  the extraction, not a behaviour change)
- Confidence: HIGH
- Key concern: `SpawnWorkerPool`/`PooledSpawnWorker` are a textbook facade-rule extraction
  candidate that shipped in-file instead, pushing `off-thread-process-spawner.ts` to 1016 lines.
- What a 10/10 version would do differently: extract `spawn-worker-pool.ts` as described above,
  update the one `CLAUDE.md` "(same file)" reference, and leave `off-thread-process-spawner.ts`
  holding only `WorkerBackedProcess`, `InlineProcess` and `OffThreadProcessSpawner` — the three
  classes that actually share the `SpawnPlan`/`HostMessage`/`WorkerMessage` protocol types.
