# TASK_2026_352 — Boot-time internal LLM query cost

Three independent cost faults on one boot: an **unbounded prompt**, an
**unconditional boot spend**, and a **host-wide serialisation**. They are
separable and each has its own root cause.

## Evidence

Baseline log: `D:\projects\ptah-extension\tmp\logs\log.log`.

- **`1017`** — `promptLength: 170655`, `systemPromptAppendLength: 19972`. The
  query it belongs to is `1008`: `cwd D:\projects\qa3elhamor`, `model "haiku"`,
  `mcpServerRunning:true`, `mcpPort:51821`, `maxTurns:1`. That signature is
  `SdkInternalQueryCuratorLlm` — workspace root as cwd, the bare `haiku` tier
  (`CURATOR_DEFAULT_MODEL_TIER`), and `resolveMcpSessionWiring`. It is the
  memory curator, not a skill-synthesis lane (`943`, `1060`, `1353` are the
  lanes: `cwd C:\Users\abdal`, dated model id, `mcpServerRunning:false`).
- **`676`, `678`** — `[memory-curator] boot-scan cold start — bounded to the
last 7 days`, fired twice (once per pipeline) within the first second of the
  trigger service starting.
- **`694`, `853`, `882`** — `session enqueued for synthesis … source: "boot"`,
  `turnCount` 15 / 268 / 19.
- **`938`, `955`, `1011`, `1070`, `1104`, `1365`, `1380`, `1408`, `1424`** —
  `one-shot query waiting for a concurrency slot: {limit:1, inFlight:1,
queued:0}`. Nine waits across ten queries: every query but the first blocked
  on the one before it, and the two families alternate (curator at `1008`,
  lane at `1060`, curator at `1080`, …).
- **`1095`** `drain finished … tier:"frequent" … durationMs:122278`;
  **`1453`** `tier:"nightly" … durationMs:156208`. Both inside the first
  minutes after launch, both while the window was still coming up.
- **`1009`, `1371`, `1415`, `1444`** — `budget recorded` totalling ≈ $0.19 for
  one boot. Note `1009` is `stage: "prefilter"` — the prefilter stage DOES
  spend, which matters below.

## Root cause

### F1 — the 170 KB prompt: the boot scan bypasses the only clamp there is

`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:880-883`

```ts
transcript = await this.transcriptReader.read(scanSessionId, scanWorkspaceRoot);
```

…and then `:893-898` hands that string straight to `curator.curate({transcript})`.

Compare the live-trigger path, `:773-786`:

```ts
jsonlText = await this.transcriptReader.read(sessionId, workspaceRoot, {
  tailBytes: TRANSCRIPT_TAIL_BYTES,        // 512 KB of RAW jsonl
});
…
const transcript = composeTranscript(jsonlText, drainedRows, episodeSnap);
```

`composeTranscript` (`:1147-1170`) is the **only** place `MAX_JSONL_BYTES`
(32 KB, `:1069`) is applied. The boot callback calls neither half: no
`tailBytes`, so `SessionHistoryReaderService` reads and formats the WHOLE
session file; and no `composeTranscript`, so the formatted result is never
clamped. A 268-turn session (`log.log:853`) therefore produced the 170 655-char
prompt at `1017`. `SdkTranscriptReaderAdapter.read`'s own docblock
(`agent-sdk/src/lib/sdk-transcript-reader.adapter.ts:18-24`) states the
contract the boot path violates: _"a caller wanting N bytes of formatted
transcript should ask for a comfortably larger raw window **and clamp the
result**."_

Nothing below that call site defends: `SdkInternalQueryCuratorLlm.runQuery`
(`:250-317`) forwards `prompt` verbatim, and `SdkQueryRunner.runOneShot` only
_logs_ `input.prompt.length` (`:280`). There is no cap anywhere on the curator
path.

### F2 — boot-source LLM stages run during the first minutes after launch

Two producers, neither gated on the host being settled.

1. `memory-trigger.service.ts:196-199` — `start()` fires `runBootScan`
   immediately, and that callback calls `curator.curate` **inline** (`:893`),
   i.e. one LLM round trip per eligible session, throttled only by
   `BootScanRunner`'s 200 ms delay and the hourly `maxCuratesPerHour` limiter.
2. `skill-trigger.service.ts`'s boot scan enqueues `source:'boot'` rows
   (`log.log:694,853,882`), and `SkillDrainService.drain` picks them up on the
   very next cron tick. Its gate 4 (`skill-drain.service.ts:649-655`) is
   `foreground.msSinceLastActivity(now) < foregroundBackoffMs` — and
   `ForegroundActivityTracker.msSinceLastActivity` returns
   `Number.POSITIVE_INFINITY` before the first event
   (`foreground-activity.tracker.ts:74`), **by design**. So at boot the
   foreground gate is guaranteed to pass, which is exactly when the host is
   least idle. That is how a `frequent` tick spent 122 s (`1095`) and a
   `nightly` tick 156 s (`1453`) while the app was still starting.

The row already carries what a fix needs: `source` is a real column on
`skill_synthesis_queue` (`skill-queue.store.ts:60,82,222,693`), so a boot-sourced
row is distinguishable from a `session-end` / `idle` / `turn-complete` one at
selection time.

### F3 — `limit: 1` is host-wide, and the two background families are unrelated

`agent-sdk/src/lib/internal-query/internal-query.service.ts:38` —
`DEFAULT_MAX_CONCURRENT = 1`, enforced by a single `InternalQueryConcurrencyGate`
on a `Lifecycle.Singleton` service. The docblock's justification is
TASK_2026_323 blocker B6: each one-shot spawns a real `claude` subprocess and
that spawn blocked the Electron main thread.

**That premise no longer holds.** TASK_2026_341 moved the spawn onto a worker
thread (`OffThreadProcessSpawner`); eleven measured launches came back in 1–7 ms
against a 1576–1732 ms baseline, with no `[event-loop] lag` line following any
of them. A second concurrent one-shot no longer multiplies main-thread lag, so
serialising the memory curator behind skill-synthesis (and back) now buys
nothing and costs the nine waits at `938 … 1424`.

## Files

**agent-sdk** (this task touches `internal-query.service.ts` + its spec ONLY —
siblings own the rest of the lib):

- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`
- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.types.ts`
- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts` (one added field)

**memory-curator**:

- `libs/backend/memory-curator/src/lib/curator-llm/clamp-transcript.ts` (NEW)
- `libs/backend/memory-curator/src/lib/curator-llm/clamp-transcript.spec.ts` (NEW)
- `libs/backend/memory-curator/src/lib/memory-curator.service.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts`
- `libs/backend/memory-curator/src/index.ts`
- specs: `memory-curator.service.spec.ts`, `memory-trigger.boot-defer.spec.ts` (NEW)

**skill-synthesis**:

- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`
- `libs/backend/skill-synthesis/src/lib/internal-query.interface.ts`
- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts`
- specs: `skill-drain.boot-deferral.spec.ts` (NEW), `lane-runner.service.spec.ts`

## Plan

1. **Clamp (F1).** New pure `clampTranscript(text, maxChars)` in
   `memory-curator/src/lib/curator-llm/clamp-transcript.ts`. Deterministic
   head+tail with a record-boundary preference and an explicit elision marker
   naming the dropped char and record counts. Head budget 25 %, tail the
   remainder: the head carries the user's stated intent, the tail carries the
   outcome AND the already-summarised `# Structured observations` /
   `# Episode summary` sections `composeTranscript` appends. Apply it in
   `MemoryCuratorService.doCurate` — the ONE point every caller (PreCompact,
   the boot scan, `memory:rebuildIndex`, `curateNow`) passes through — and log
   a warn naming what was dropped. Also give the boot-scan `read()` the
   `tailBytes` the live path uses, so the oversized string is never read off
   disk in the first place.
2. **Defer boot-source LLM stages (F2).**
   - `SkillDrainService`: a new `bootDeferralMs` config
     (`skillSynthesis.drain.bootDeferralMs`, default 300 000). While
     `now - processStartedAt < bootDeferralMs`, `select()` filters out rows whose
     `source` is `'boot'`; every other source is unaffected. Counted on the
     summary as `bootDeferred` so the log says what was held back. `0` disables.
     This composes with gate 4 rather than replacing it: gate 4 answers "is the
     user typing", this answers "has the host settled".
   - `MemoryTriggerService`: arm the boot scan on a timer
     (`memory.bootScanDelayMs`, default 300 000) instead of firing it inside
     `start()`. When the timer fires while foreground activity is more recent
     than `memory.bootScanIdleBackoffMs`, re-arm rather than run. The re-arm is
     unbounded on purpose — it only ever continues while the user is actively
     working, and `stop()` clears it.
3. **Per-lane concurrency (F3).** `InternalQueryConfig` gains
   `lane?: string`. `InternalQueryConcurrencyGate` admits a waiter when
   `active < globalLimit` **and** `activeInLane < perLaneLimit`; `drain()` walks
   the FIFO queue and admits the first admissible waiter rather than only the
   head, so a lane-blocked waiter cannot block an unrelated lane. One gate
   object, one queue, one admission rule — no second lock, so no deadlock.
   Defaults: global 2 (`ptah.internalQuery.maxConcurrent`), per lane 1
   (`ptah.internalQuery.maxConcurrentPerLane`). The curator adapter passes
   `lane: 'memory-curator'`; `LaneRunnerService` passes
   `lane: 'skill-synthesis'`; everything else stays on `'default'`.

## Acceptance criteria

1. `clampTranscript` returns its input unchanged at or below the cap; above it
   returns exactly `maxChars` or fewer characters, containing the head, the
   elision marker with the real dropped counts, and the tail. Deterministic:
   the same input yields the same output. A text with no record boundaries is
   still clamped to the cap.
2. `MemoryCuratorService.curate` never hands `ICuratorLLM.extract` more than
   `CURATOR_TRANSCRIPT_MAX_CHARS`, whatever the caller passes, and logs a warn
   naming `originalChars` / `keptChars` / `droppedChars` when it clamps.
3. The memory boot scan reads with `tailBytes`, not unbounded.
4. `SkillDrainService` does not claim a `source:'boot'` row inside the boot
   deferral window, DOES claim a `source:'session-end'` row in the same tick,
   and claims the boot row once the window has passed. `bootDeferralMs: 0`
   disables the gate.
5. `MemoryTriggerService.start()` does not run the boot scan synchronously; it
   runs after `bootScanDelayMs`, re-arms while foreground activity is recent,
   and `stop()` cancels a pending run.
6. Two queries on DIFFERENT lanes run concurrently at the default limits; two
   on the SAME lane serialise; a third lane waits for a global slot; a
   lane-blocked waiter does not block an admissible waiter behind it in the
   queue; abort and queue-timeout still remove a waiter cleanly.
7. `npx nx run-many -t test -p @ptah-extension/agent-sdk
@ptah-extension/memory-curator @ptah-extension/skill-synthesis` green with a
   3-project header; typecheck green. `catch (error: unknown)` throughout, no
   `@ts-ignore`.

## Test projects

`@ptah-extension/agent-sdk`, `@ptah-extension/memory-curator`,
`@ptah-extension/skill-synthesis`

## Overlap

Concurrent siblings in `agent-sdk`: TASK_2026_349 (`SdkQueryOptionsBuilder`),
TASK_2026_350 (`SlashCommandInterceptor` / `SessionLifecycle` /
`SdkMessageTransformer`), TASK_2026_353 (`SdkModelService` / `JsonlReader` /
`SessionHistoryReader`). None touches `internal-query/`. TASK_2026_351 landed in
`skill-synthesis` and this task builds on it — the `mcpPort` widening of the
local `IInternalQuery` mirror stays, and `lane` is appended beside it.

## Implementation notes

### F1 — the prompt cap

**NEW `libs/backend/memory-curator/src/lib/curator-llm/clamp-transcript.ts`** —
`clampTranscript(text, maxChars = CURATOR_TRANSCRIPT_MAX_CHARS)`, pure and
deterministic, returning `{text, originalChars, keptChars, droppedChars,
droppedRecords, clamped}`. Head + elision marker + tail, split 25/75, cutting on
`\n\n` record boundaries when one sits within 2 000 characters of the budget
edge and at the exact budget otherwise.

Applied in **`MemoryCuratorService.doCurate`** (`clampForModel`), which is the
one point every caller passes through — PreCompact, the boot scan,
`memory:rebuildIndex`, `curateNow`. Deliberately not at any call site, because
the fault was a call site that forgot. A clamp logs
`[memory-curator] transcript exceeded the curator prompt cap` with
`originalChars` / `keptChars` / `droppedChars` / `droppedRecords`.

The boot-scan `read()` (`memory-trigger.service.ts`) now passes
`TRANSCRIPT_TAIL_BYTES`, matching `invokeCurate`, so the oversized string is no
longer read and formatted off disk just to be thrown away.

**One design correction found by the spec, worth recording.** The first version
budgeted the marker from provisional figures and then trimmed the tail if the
real marker turned out longer (more digits). That trim made the number the
marker PRINTS differ from the `droppedChars` the function REPORTS — the tail
characters removed by the trim were dropped but not counted in the marker. The
budget is now taken against an UPPER BOUND, `buildMarker(originalChars,
originalChars)`: no count the marker can carry exceeds `originalChars`, so the
real marker always fits, no post-hoc trim is ever needed, and the two numbers
are equal by construction. It costs a handful of characters of budget and buys
an invariant.

Degradations, both bounded: a cap too small to hold the marker returns a bare
tail slice (what the live path already does, never longer than the cap); a
non-finite or non-positive cap falls back to the 32 KB default.

### F2 — deferring boot-source work

**`SkillDrainService`** — `skillSynthesis.drain.bootDeferralMs` (default
300 000, `0` disables). `select()` filters out rows whose `source` is `'boot'`
while `now - startedAt < bootDeferralMs`, counting them on the new
`DrainSummary.bootDeferred`. `startedAt` is a construction-time field rather
than `process.uptime()` so a spec can drive the window through the injected
`now`.

Two shape decisions:

- **A row filter, not a sixth gate.** A gate above the loop would also have held
  back `session-end` / `idle` / `turn-complete` work the user's own session just
  produced — a worse trade than the one it replaces. The filter holds back only
  the backlog from sessions that ended before this process started.
- **It composes with gate 4 rather than replacing it.** Gate 4 asks "is the user
  typing"; this asks "has the host settled". Gate 4 alone could never answer the
  second question, because `msSinceLastActivity` returns
  `Number.POSITIVE_INFINITY` before the first chat turn, so it is _guaranteed_
  to pass at boot.

`bootDeferred` counts rows held out of the eligible WINDOW, not rows that would
have been dispatched. With `perWorkspaceBatch: 1` those differ; the window
figure is the one that says how much backlog is waiting.

**`MemoryTriggerService`** — `start()` now calls `scheduleBootScan` instead of
`void runBootScan`. `memory.triggers.bootScanDelayMs` (default 300 000) is the
settle window; when the timer fires with foreground chat more recent than
`memory.triggers.bootScanIdleBackoffMs` (default 300 000) it re-arms instead of
running. The re-arm is unbounded on purpose — it only continues while activity
keeps arriving, so it terminates as soon as the user stops. The timer is
`unref`'d and cleared by `stop()`. A new `lastActivityAt` field is stamped in
`onActivity` ABOVE the `idleMs` guard: `idleMs <= 0` disables the per-session
idle TIMER, it does not mean the user stopped typing.

Neither key is added to `MemoryTriggersDto` / `MEMORY_TRIGGER_PREFIXES` — they
are cost/latency knobs, not per-trigger toggles the settings panel round-trips,
following `maxObservationsPerCurate`.

### F3 — per-lane concurrency

`DEFAULT_MAX_CONCURRENT` 1 → **2**; new `DEFAULT_MAX_CONCURRENT_PER_LANE` = 1
(`ptah.internalQuery.maxConcurrent` / `.maxConcurrentPerLane`).
`InternalQueryConfig.lane` is optional, trimmed and lower-cased, defaulting to
`'default'`. The curator adapter passes `'memory-curator'`; `LaneRunnerService`
passes `SKILL_SYNTHESIS_QUERY_LANE` — ONE lane for all four `SkillLane`s,
because they are routes for a single pipeline and a per-`SkillLane` name would
let one drain tick hold the whole host-wide budget.

`InternalQueryConcurrencyGate.acquire` takes an object now (`AcquireRequest`)
and admits on `active < limit && activeInLane < perLaneLimit` — ONE object, ONE
queue, ONE predicate. The alternative, a lane semaphore nested inside a global
one, is two locks needing an ordering argument to stay deadlock-free; there is
nothing to argue about when nothing is held while waiting.

**`drain()` scans rather than popping the head.** With a single ceiling the head
is always the right waiter; with a per-lane ceiling it may be inadmissible, and
waking only the head would let a queued skill-synthesis call block a
memory-curator call behind it — the exact coupling the lanes remove. It admits
the first waiter whose lane has room; order stays FIFO within a lane. The
`activeByLane` entry is deleted rather than zeroed on release, so a host with
dynamic lane names cannot leak map entries.

Raising the global limit alone would NOT have fixed the logged defect —
skill-synthesis would simply have taken both slots. The per-lane ceiling is the
load-bearing half.

### Scope note

The task brief said "if you touch InternalQueryService, touch only that file and
its spec". Three further files in `agent-sdk` were unavoidable and are all
strictly additive: `internal-query/internal-query.types.ts` (the `lane` field —
same folder, no sibling owns it),
`curator-llm-adapter/sdk-internal-query.curator-llm.ts` (one added property on
an existing object literal), and `CLAUDE.md`. None is in TASK_2026_349's, 350's
or 353's area (`SdkQueryOptionsBuilder`, `SlashCommandInterceptor` /
`SessionLifecycle` / `SdkMessageTransformer`, `SdkModelService` / `JsonlReader`
/ `SessionHistoryReader`).

### Tests

New: `clamp-transcript.spec.ts` (11), `memory-trigger.boot-defer.spec.ts` (6),
`skill-drain.boot-deferral.spec.ts` (7). Extended:
`memory-curator.service.spec.ts` (+4, asserting what the LLM RECEIVES rather
than what any caller sends), `internal-query.service.spec.ts` (+10 across the
service and the gate), `lane-runner.service.spec.ts` (+2).

Two existing specs were changed, both because the new behaviour genuinely
reaches them, and both opting out of a gate that now has its own dedicated spec:

- `memory-trigger.boot-scan-budget.spec.ts` sets `bootScanDelayMs: 0`. It is
  about the hourly BUDGET, not about when the scan starts.
- `skill-synthesis.stage-handlers.spec.ts`'s `makeDrainOver` sets
  `bootDeferralMs: 0`. `enqueueEmbeddingBackfill` writes a `source:'boot'` row
  from `start()`, and those suites are about stage DISPATCH.

**One test-design correction.** The boot-defer spec first used a fixed count of
`setImmediate` turns to let the real `fs.readdir` / `fs.stat` complete under
fake timers. That passed alone and failed inside a three-project `run-many`:
`fs/promises` dispatches to the libuv THREADPOOL, so on a saturated host a
completion needs far more loop turns than on an idle one — the assertion was
measuring the HOST. Positive assertions now use `advanceUntil(ms, predicate)`,
which yields until the condition holds or a large turn budget runs out; negative
assertions keep the fixed drain, where "still nothing after a generous drain" is
the actual claim.

### Verification

- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/memory-curator @ptah-extension/skill-synthesis --skip-nx-cache`
  — header `Running target test for 3 projects`, **exit 0**. memory-curator
  26/28 suites (2 pre-existing native-SQLite skips), 413 passed / 60 skipped;
  agent-sdk 81/82 suites, 1251 passed / 1 skipped; skill-synthesis 68/74 suites
  (6 pre-existing SQLite skips), 1381 passed / 37 skipped.
- `npx nx run-many -t typecheck -p` (same three) — green. `npx tsc --noEmit -p tsconfig.spec.json`
  for each of the three — green (the lib typecheck does not cover spec files).
- Dependent typecheck: `@ptah-extension/rpc-handlers`,
  `@ptah-extension/thoth-runtime`, `@ptah-extension/agent-generation`,
  `@ptah-extension/cron-scheduler` — green, so the new required
  `DrainSummary.bootDeferred` and the widened `InternalQueryConfig` break no
  consumer.
- Lint: agent-sdk **0 errors** / 38 warnings, memory-curator **0 errors** / 6
  warnings, skill-synthesis 0 errors. All warnings are pre-existing categories;
  `memory-trigger.service.ts` was already over the 700-line soft ceiling before
  this change and the deferral moved it to 993. Splitting it is a separate,
  deliberate refactor.

### Not done here / observed

- **No manual Electron boot verification** — this run had no Electron session.
  The observable claims to check on a real boot are: no `promptLength` above
  32 768 on a curator query; no `one-shot query waiting for a concurrency slot`
  line with `blockedBy: "global"` while only the curator and skill-synthesis are
  running; and no boot-source drain inside the first five minutes.
- **`prefilter` spends tokens but is NOT in `TOKEN_SPENDING_STAGES`.**
  `log.log:1009` records `stage: "prefilter"` at `costUsd 0.076551` — the
  largest single line of the boot's ~$0.19. `skill-synthesis/CLAUDE.md` states
  the complement of that set is "pure local computation", which is true of
  `embedding` and `clustering` and false of `prefilter`, whose handler runs
  `analyzeSession` → the synthesizer lane. The consequence is the same one
  TASK_2026_253 fixed for `trigger-eval`: the drain dispatches prefilter rows
  past `maxTokensPerDay`, so the daily ceiling is not a ceiling for them, and
  `STAGE_COST_RANK` ranks prefilter at 0 — so above 80 % of budget the drain
  actively PREFERS it. Not fixed here: it changes what the budget gate means for
  the highest-volume stage in the system and deserves its own task with its own
  measurement.
- **"A worker process has failed to exit gracefully"** is printed by all three
  projects, including `agent-sdk` where this task touched two files. It is the
  pre-existing, load-related Jest teardown warning TASK_2026_341 traced and
  documented (reproduced with that task's spec files excluded entirely). This
  task's only new timer, `bootScanTimer`, is `unref`'d and cleared by `stop()`.
