# Batch 10 — Close F1: make the curator stall distinguishable from an empty result

**Status**: COMPLETE — not committed (team-leader commits after MODE 2).
**Branch**: `ak/boot-blocker-quota-gate`
**Closes**: `batch-2-implementation.md` §6 (F1), §8 (the observed cold start).
**Decisions implemented**: U5 (stats discriminator), U6 (no-throw holds), U7 (not deferred).
**Review round 1**: APPROVED WITH FINDINGS — 1 material (**F-1**), 2 minor (**m1**, **m2**).
All three addressed; see §7. F-1 is a code fix with its own mutation check, m1 and m2 are
report corrections the reviewer ruled must not change code.

---

## 1. What was wrong, restated in one line

Batch 2's quota gate expressed "stop" as `runQuery → ''` → `extract() → []`, which is the
same value a pass that ran and found nothing produces — so `MemoryTriggerService` marked its
drained observations processed and discarded them, and the boot scan advanced its watermark
past sessions it had never curated.

## 2. The fix, in the order the signal travels

| #   | File                                                                                   | Change                                                                                                                              |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `libs/backend/memory-contracts/src/lib/curator-llm.port.ts`                            | `ICuratorLLM.extract` now returns `CuratorExtraction` — `{status:'extracted', drafts}` \| `{status:'stalled', reason, providerId}`. |
| 2   | `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts` | `runQuery` returns `CuratorQueryOutcome` instead of `''`; `extract` maps the cooling-down arm to `status:'stalled'`.                |
| 3   | `libs/backend/memory-curator/src/lib/memory-curator.service.ts`                        | `CuratorRunStats` gains required `outcome: 'ran' \| 'stalled'`; new `recordCuratorStall`.                                           |
| 4   | `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`               | `invokeCurate` inspects `stats.outcome` and skips `markProcessed`; `runBootScan` maps it onto the runner's outcome.                 |
| 5   | `libs/backend/memory-curator/src/lib/triggers/episode-tracker.ts`                      | New `detach()` / `reattach()`.                                                                                                      |
| 6   | `libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts`                     | `run` returns `BootScanItemOutcome`; a stall stops the scan and leaves the watermark.                                               |
| 7   | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`               | Boot-scan callback returns `'ran'` (see m1 in §7 for the honest strength of that seam).                                             |
| 8   | `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`                    | **F-1 fix.** `memory:runNow` carries `outcome` onto the response and the `manual-run` event.                                        |

Barrels: `memory-contracts/src/index.ts`, `memory-curator/src/index.ts`,
`memory-curator/src/lib/curator-llm/curator-llm.interface.ts`.

### Why the port, and not a field on `CuratorRunStats` alone

Task 10.1 required the signal be carried **from the point the information is first lost**.
That point is `runQuery → ''`, not `extract() → []`. Reconstructing it downstream would mean
inferring "did this run?" from a zero count, which is the exact overloading the task forbids.

The port change is also the only place in the chain that is **compile-forced**: a caller that
ignores `status` cannot reach `drafts` at all. `CuratorRunStats.outcome` is required, so every
producer must answer, but TypeScript cannot force a consumer to _read_ a field — the trigger
service's branch is pinned by spec instead (§4).

**The stalled arm carries no `drafts` property.** The empty extraction stays empty; the fix
adds a signal, it does not invent a result. Pinned.

### U6 held: nothing new throws

`extract` still resolves on the stall. `ICuratorLLM` grows no failure mode. The existing
`ProviderAuthError` fallback is byte-unchanged, and the WARN line
`curator provider is rate-limited; skipping this curation pass until its quota refills` with
its load-bearing `curatorProviderId: ""` field is untouched — pinned by the pre-existing spec
at `sdk-internal-query.curator-llm.spec.ts` which still asserts `curatorProviderId: ''`.

### `resolve()` deliberately has no stalled arm

A cooldown starting _between_ `extract` and `resolve` degrades to "persist the drafts
unmerged" (`mergeTargetId: null`). Nothing is discarded, so the caller has no decision to
make and a discriminator there would be ceremony. Documented on the port and at the call site.

---

## 3. Task 10.2 — the three pieces of state, each decided explicitly

The task required all three be enumerated. F1 existed because only the first was ever examined.

### (a) `observation_queue.processed_at` — **skip `markProcessed`**

`drainForSession` is a pure `SELECT ... WHERE processed_at IS NULL`; it mutates nothing. So
_not_ calling `markProcessed` is the entire mechanism: the rows are still NULL and the next
drain returns them. `invokeCurate` returns before the mark on `outcome === 'stalled'`.

### (b) `episodes.reset` at `:696` — **undone, not deferred, and the reason matters**

Deferring the reset past the stall check is **wrong**, and this is the non-obvious part. The
reset fires before the async curate on purpose: turns arriving _during_ the pass land in a
fresh buffer, and a reset applied afterwards would swallow them. Moving it would trade one
lost episode for another.

So the effect is undone instead. `episodes.reset(sessionId)` on the curate path became
`episodes.detach(sessionId)`, which clears the buffer identically but hands it back; on a
stall `invokeCurate` calls `episodes.reattach(sessionId, detached)`.

`reattach` **merges** rather than overwrites — restored events first (they are older), the
same `MAX_ASSISTANT_MESSAGES` / `MAX_FAILURES` caps re-applied, `recoveredTools` unioned, and
a restored "still failing" marker cannot un-recover a tool the newer buffer already recovered.
A merge is required, not a nicety: the detach→reattach window spans an `await`.

The `isEmpty` early-return at `:653` and `flushSessionEnd`'s reset at `:433` are unchanged —
neither is on the curate path.

**Known, accepted:** a stall on the `session-end` trigger reattaches a buffer for a session
`flushSessionEnd` has already torn down, leaving one orphan object (bounded by the two caps
above, tens of KB worst case) that nothing reads. The alternative — a liveness gate — cannot
be written correctly, because `this.sessions` is populated only by `onStop` while
episode/commit triggers arrive via `onPostToolUse`, so the gate would wrongly refuse valid
reattaches. The observation rows, which are the actual data, survive either way.

### (c) The boot-scan watermark — **not advanced, and the scan stops**

`BootScanRunner.run`'s callback now returns `'ran' | 'stalled'`. On `'stalled'` the runner
increments a new `stalled` counter, **does not** touch `maxMtime`, and **breaks** out of the
loop.

Breaking is not just cheaper, it is _required for correctness_: `eligible` is sorted by mtime
ascending and the watermark is the MAX over handled items, so letting a later session succeed
after an earlier one stalled would jump the watermark over the stalled session and lose it by
exactly the route `markProcessed` did. It also removes the tight
`findSessionsDirectory` → skip loop seen at `coldstart-306.log:1232-1260`.

`BootScanResult` gains `stalled: number`, surfaced on the existing `boot-scan` event.

### The inverse is preserved

A pass that RAN and found nothing keeps its old behaviour exactly — rows marked, watermark
advanced, `curator-run` event pushed. Turning "found nothing" into a retry would be F1
inverted. Pinned by two dedicated specs (§4).

---

## 4. Task 10.3 — the discriminating specs, and the mutation check

### The discriminating spec

> **`leaves the drained observations processed_at IS NULL and re-drains them on the next pass`**
> — `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts`, in
> `describe('a stalled curation pass keeps its input (TASK_2026_306 F1)')`.

It drives a real `stop` trigger through `MemoryTriggerService` against a curator returning
`outcome: 'stalled'`, then asserts:

1. the pass **did** drain (`drainForSession`'s first result is non-empty) — so this is not a
   "nothing happened" assertion;
2. `markProcessed` was **never** called;
3. every row in `rowsBySession` still has `processedAt === null`;
4. a fresh `drainForSession('s1', 500)` returns **the same row ids** — the survival claim
   stated the way the next pass would ask it.

The fake queue store in that spec file models `processed_at` for real: `markProcessed` stamps
`processedAt`, and `drainForSession` filters `r.processedAt === null`. So assertion 4 is a
genuine round-trip, not a mock-call count.

**No assertion in this batch merely checks that the extraction is empty.** Every stall spec
asserts either the discriminator itself or the survival of state.

### Mutation check — run, red confirmed, restored

| Mutation                                                                                  | Result                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory-trigger.service.ts`: `if (stats.outcome === 'stalled')` → `if (false as boolean)` | **2 failed** — `leaves the drained observations processed_at IS NULL and re-drains them on the next pass`, and `restores the episode buffer that tryEpisodeCurate cleared before the pass`. 352 passed. |
| `boot-scan-runner.ts`: `if (outcome === 'stalled')` → `if (false as boolean)`             | **2 failed** — `does NOT advance the watermark past the stalled session`, and `keeps the watermark at the last session that actually ran`. 352 passed.                                                  |
| `memory-rpc.handlers.ts`: drop `outcome: stats.outcome` from `runStats` (F-1)             | **2 failed** — `reports outcome "stalled" on the response AND the manual-run event`, and `reports outcome "ran" for a pass that dispatched and found nothing`. 2407 passed.                             |

All three sources restored; the suites are back to 354 and 2409 passed.

The inverse guards (`a pass that RAN and found nothing still marks its rows processed`,
`a run that reports "ran" but extracted nothing still advances the watermark`) stay **green**
under both mutations — correctly, since the mutation makes everything take the "ran" branch.
They exist to stop the opposite wrong fix ("never mark anything"), and each mutation above
proves its partner is load-bearing.

### Spec inventory — counted, not estimated

`it(`/`test(` blocks added by this batch: **13** (11 in round 1, 2 for F-1 in round 2). Three
of those **replace** an existing case in place, so net executed cases: **+10**.

| Lib              | Baseline (clean, stashed)             | After                | Δ      |
| ---------------- | ------------------------------------- | -------------------- | ------ |
| `memory-curator` | 348 passed / 57 skipped / 405 total   | **354 / 57 / 411**   | **+6** |
| `agent-sdk`      | 1043 passed / 1043 total              | **1045 / 1045**      | **+2** |
| `rpc-handlers`   | 2407 passed / 31 skipped / 2438 total | **2409 / 31 / 2440** | **+2** |

The `memory-curator` +6: three in `boot-scan-runner.spec.ts` (watermark), three in
`memory-trigger.service.spec.ts` (rows, inverse, episode restore).
The `agent-sdk` +2: `carries no drafts on the stalled arm` and
`a pass that RAN and found nothing reports status "extracted" with an empty list`.
The `rpc-handlers` +2 (F-1): `reports outcome "stalled" on the response AND the manual-run
event` and `reports outcome "ran" for a pass that dispatched and found nothing`.

### Spec-assertion integrity

`git diff -U0 -- '*.spec.ts'` has **26 removed lines**, all accounted for and **none a
weakened assertion**:

- 3 `it(` titles + 3 bodies, rewritten in place for the new return shape. One of them —
  `extracts nothing rather than riding the active provider` → `reports status "stalled" — NOT
an empty extraction` — became **strictly stronger**: `resolves.toEqual([])` passed both
  before and after the fix and was the worthless assertion the task warned about; it now
  asserts the discriminator.
- The remaining 20 are mock return values updated from `[]`/`[draft]` to
  `{status:'extracted', drafts:[…]}`, `curate` mocks gaining `outcome: 'ran'`, and
  `expect(result).toEqual({scanned:0,succeeded:0,skipped:0})` gaining `stalled: 0` — a
  strengthening, since the exact-equality now covers the new field.

One mock was a latent lie and is now honest: `memory-trigger.service.spec.ts` had
`curate: jest.fn().mockResolvedValue(undefined)` for a method typed to return
`CuratorRunStats`.

---

## 5. Verification — actual output

All numbers below are from the **round-2 re-run**, after the F-1 fix.

```
npx nx run-many -t test -p memory-curator,agent-sdk,skill-synthesis,rpc-handlers,ptah-electron --skip-nx-cache
  @ptah-extension/memory-curator:  Test Suites: 3 skipped, 22 passed, 22 of 25 total
  @ptah-extension/memory-curator:  Tests:       57 skipped, 354 passed, 411 total
  @ptah-extension/agent-sdk:       Test Suites: 74 passed, 74 total
  @ptah-extension/agent-sdk:       Tests:       1045 passed, 1045 total
  @ptah-extension/skill-synthesis: Test Suites: 6 skipped, 65 passed, 65 of 71 total
  @ptah-extension/skill-synthesis: Tests:       37 skipped, 1324 passed, 1361 total   ← baseline exactly
  @ptah-extension/rpc-handlers:    Test Suites: 87 passed, 87 total
  @ptah-extension/rpc-handlers:    Tests:       31 skipped, 2409 passed, 2440 total
  ptah-electron:                   Test Suites: 1 skipped, 20 passed, 20 of 21 total
  ptah-electron:                   Tests:       4 skipped, 255 passed, 259 total
  NX   Successfully ran target test for 5 projects
```

| Lib               | Baseline (clean, stashed) | Round 1     | Round 2 (F-1)   | Δ total |
| ----------------- | ------------------------- | ----------- | --------------- | ------- |
| `memory-curator`  | 348 / 405                 | 354 / 411   | **354 / 411**   | +6      |
| `agent-sdk`       | 1043 / 1043               | 1045 / 1045 | **1045 / 1045** | +2      |
| `rpc-handlers`    | 2407 / 2438               | 2407 / 2438 | **2409 / 2440** | +2      |
| `skill-synthesis` | 1324 / 1361               | 1324 / 1361 | **1324 / 1361** | 0       |
| `ptah-electron`   | 255 / 259                 | 255 / 259   | **255 / 259**   | 0       |

`memory-contracts` has no `test` target (types only); it is covered by `typecheck` and by its
consumers.

**One flake seen and chased down.** The first concurrent five-project run failed
`adoptLegacySkillsShInstalls — what the lockfile attests › is idempotent — a second sweep
finds nothing left to do` in `rpc-handlers`. That file is **not in this batch's diff**
(`git status` confirms it unmodified), and it passed on an isolated `nx test rpc-handlers`
immediately before and after, plus on a repeat of the identical concurrent invocation. A
temp-directory race under parallel load, not a regression. Both the isolated and the repeated
concurrent run are reported above at 87/87 suites green.

```
npx nx run-many -t lint -p memory-curator,agent-sdk,skill-synthesis,rpc-handlers --skip-nx-cache
  NX   Successfully ran target lint for 4 projects
  memory-curator   ✖  6 problems (0 errors,  6 warnings)
  agent-sdk        ✖ 38 problems (0 errors, 38 warnings)
  skill-synthesis  ✖ 35 problems (0 errors, 35 warnings)
  rpc-handlers     ✖ 19 problems (0 errors, 19 warnings)
```

**0 errors.** `memory-contracts` has no `lint` target.

Both files this batch grew were checked against their own baseline rather than assumed:

- `memory-rpc.handlers.ts` — `npx eslint` on that single file emits **nothing**, both with the
  F-1 change stashed and with it applied. Project total is **19 before and 19 after**
  (measured by stashing the two `memory-rpc.handlers.*` files and re-linting). This batch adds
  zero warnings to `rpc-handlers`.
- `memory-trigger.service.ts` — see the m2 entry in §7.

```
npx nx run-many -t build -p memory-curator,memory-contracts,agent-sdk,skill-synthesis,rpc-handlers,ptah-electron,ptah-extension-vscode
  NX   Successfully ran target build for 7 projects and 29 tasks they depend on

npx nx run-many -t typecheck -p memory-contracts,memory-curator,agent-sdk,skill-synthesis,rpc-handlers
  NX   Successfully ran target typecheck for 5 projects
```

## 6. Blast radius beyond the three tasks

Recorded because the task list did not name these and they were compile-forced:

1. **`skill-synthesis/src/lib/triggers/skill-trigger.service.ts`** — `BootScanRunner`'s `run`
   became `Promise<BootScanItemOutcome>`, which `enqueueAnalyze`'s
   `Promise<EnqueueOutcome | null>` does not satisfy. The callback now awaits and returns
   `'ran'`, with a comment stating why the skills pipeline can never stall: enqueueing is a
   local INSERT and spends nothing upstream.

   **The "compile-forced to answer" framing is weaker than it sounds, and the reviewer was
   right to flag it (m1).** The required return type forces a future author to write
   _something_, but `'ran'` is already written — so if the skills pipeline ever gains an
   inline provider call, it inherits F1 silently rather than failing to compile. The comment
   at the call site is the real mitigation, not the type. Recorded, not fixed: a stronger
   guard would mean inventing a failure mode for a condition that cannot arise today.

2. **`rpc-handlers/.../memory-rpc.handlers.spec.ts`** and
   **`apps/ptah-electron/src/activation/wire-runtime.spec.ts`** — `curate` mocks gained
   `outcome: 'ran'`. No production code in either project changed.
3. **No shared/frontend change.** `MemoryDiagnosticsResult.lastRunStats` is already
   `Record<string, number|string|boolean|null>`, so `outcome` rides it unmodified. The stall
   event reuses the existing `'rate-limited'` event kind rather than adding one — the
   frontend's `event-feed.component.ts` ends its switch in `assertNever(ev.kind)`, so a new
   kind would have been a breaking frontend compile for no gain, and `'rate-limited'` already
   renders as a warning and already means exactly this.

## 7. Review round 1 — findings and how each was answered

### F-1 (material) — the fifth caller dropped the discriminator. **FIXED.**

`memory-rpc.handlers.ts` `memory:runNow` — the user-driven **"Run now"** button — called
`curator.curate` and then built both the `manual-run` event and the RPC response from
`{extracted, merged, created, skipped}` only. `outcome` was discarded, so a user clicking Run
now during a cooldown got `success: true, extracted: 0`: the exact "ran and found nothing"
reading this batch exists to eliminate, at the one surface a human actively drives and is
actively waiting on.

**It was missed, not decided.** §8 lists the deliberate non-changes and this was not among
them. The four other callers were each traced during round 1 and are clean; the fifth was not
traced because `markProcessed` has exactly one call site backend-wide and the audit followed
the data-loss route rather than the legibility route. The reviewer's severity call is right:
this is not recurring data loss — `runNow` never marks anything processed — it is F1's
**legibility half** surviving where the discriminator now existed and was thrown away.

**Decision: thread it through.** Both the response and the event now carry
`outcome: stats.outcome`, and a stalled pass additionally logs
`[memory] runNow — pass stalled before dispatch; nothing was consumed`.

Two sub-decisions worth stating, because either could reasonably have gone the other way:

- **`success` stays `true`.** The RPC completed; the `success: false` branch is reserved for a
  thrown failure and already carries `error`. Reporting a gated background pass as a failed
  user request would swap one ambiguity for another and would make the frontend's
  `throw new Error(result.error || 'memory:runNow failed')` fire on a non-error. The
  discriminator lives in `stats.outcome`, where a consumer can read it without guessing.
- **No wire-contract change and no frontend change were needed.**
  `MemoryRunNowResult.stats` is already
  `Readonly<Record<string, number | string | boolean | null>> | null`, and the `manual-run`
  event's `stats` is the same shape, so `outcome` rides both as a plain additive field.
  `MemoryDiagnosticsRpcService.runNow` passes the result straight through. This is why the fix
  is 33 lines and not a contract migration — and it is also why leaving it undone would have
  been hard to justify.

Pinned by two specs whose counts are identical and whose `outcome` is opposite, so the field
is the only thing separating them. Mutation-checked: removing `outcome` from `runStats` turns
**both** red (§4).

### m1 (minor, record only) — the skill-synthesis seam is weaker than claimed. **RECORDED.**

The report said the required `BootScanItemOutcome` return type means a future pipeline "has to
answer the question". That overstates it: the type forces a future author to write
_something_, but `'ran'` is already written, so a skills pipeline that later gains an inline
provider call inherits F1 silently. Corrected in §6; the call-site comment is the real
mitigation. No code change — a stronger guard would mean inventing a failure mode for a
condition that cannot arise today.

### m2 (minor, record only) — the raw line count. **RECORDED, with the ruling.**

The report quoted `899 → 913`, which is ESLint's metric (`skipBlankLines`, `skipComments`).
The raw count is **`wc -l` 1042 → 1088**, which crosses CLAUDE.md's "past 1000 means a
deliberate look, not an alarm" threshold and was not mentioned. Both numbers now recorded.

**Ruling (team-leader, upheld here): the facade rule is NOT triggered by this batch.** 14
logical lines to close live data loss is the right trade, and restructuring a 1088-line
service inside a data-loss fix would be the worse change.

**Follow-up candidate — extract a collaborator from `MemoryTriggerService`.** It now owns
trigger wiring, episode-buffer lifecycle, curate invocation, boot-scan mapping, coalescing and
rate-limiting. `episode-tracker.ts` (280 lines) is the precedent for the shape: a named
collaborator with its own lifecycle, injected rather than inlined. Per the facade rule the
public class keeps its name, DI token and method signatures. Not this batch.

---

## 8. Deliberate non-changes, stated so the reviewer does not have to guess

- **A failed curate still marks its rows processed.** `recordCuratorError` returns
  `outcome: 'ran'` — the call _was_ dispatched. Whether a failed pass should also preserve its
  input is a different question from F1 (a pass that never ran) and would change behaviour no
  task asked for. Commented at the site.
- **`lastRunAtMs` / `lastRunStatsCache` are not touched by a stall.** "Last run" means the
  last pass that ran; overwriting a real run's stats with zeroes would make the diagnostics
  panel report a clean empty pass while nothing had happened.
- **The hourly rate-limit token is still spent on a stalled pass.** `tryAcquire` fires before
  the curate and there is no refund API. Not data loss — the rows survive — but a long
  cooldown can eat the hourly budget so curation is throttled once quota returns. **Follow-up
  candidate**, not fixed here: refunding would mean a new `CuratorRateLimitService` method and
  a scope expansion this batch does not need. **Reviewer accepted this as properly scoped
  out** in round 1; carrying it forward as a named follow-up rather than a loose note.
- **`lastCurateAt` is still stamped on a stalled pass**, so `shouldCoalesce` throttles the
  retry for `COALESCE_WINDOW_MS`. Harmless and desirable — the retry is now cheap _and_
  lossless, so there is no reason to make it tighter.

## 9. Follow-ups this batch names but does not do

Both were reviewed and explicitly ruled out of scope; neither is data loss.

1. **Refund the hourly rate-limit token on a stalled pass** (§8). A long cooldown can eat the
   `maxCuratesPerHour` budget, so curation is throttled at the moment quota returns. Needs a
   new `CuratorRateLimitService` method.
2. **Extract a collaborator from `MemoryTriggerService`** (m2, §7). Raw `wc -l` is now
   **1088** (ESLint's blank/comment-skipped metric: **913**, up from 1042/899). The service
   owns trigger wiring, episode-buffer lifecycle, curate invocation, boot-scan mapping,
   coalescing and rate-limiting; `episode-tracker.ts` (280 lines) is the precedent for where
   the next collaborator splits off. Facade rule applies when it happens — same class name, DI
   token and method signatures.

## 10. Manual verification still owed

Per the Batch 10 verification block: a cold start against a genuinely exhausted provider
should show the same skip-pass WARN lines, but with the episodes **still pending** afterwards
and the boot scan stopping at the first stall instead of looping. Not attempted here — it
needs a live quota-exhausted provider.
