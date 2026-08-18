# TASK_2026_256 — implementation report

Extract the six queue stage handlers out of `skill-synthesis.service.ts`.
Behaviour-preserving structural work. Worktree `D:/projects/ptah-extension-256`,
branch `ak/task-256-stage-handlers`. Nothing committed.

## Verdict

Split landed. Both suites come back at exactly their recorded counts with skip
counts unchanged, and the registration-above-early-returns rule is **pinned by an
existing test** — verified by mutation, not by inspection.

---

## Line counts

| File | Before | After |
| --- | ---: | ---: |
| `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts` | 2027 | **1232** |
| `libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts` | — (new) | **879** |
| `libs/backend/skill-synthesis/src/lib/candidate-body.ts` | — (new) | **47** |

Net +131 lines across the three files. All of it is the new file's header
docblock plus the `SkillStageWorkers` port declaration and its rationale; no
handler body was rewritten.

(The task brief quotes 1929 for the "before" figure, measured at `868da42d1`.
TASK_2026_253 landed on top of it since — hence 2027 on this branch.)

---

## What moved

To `queue/stage-handlers.service.ts`, as `SkillStageHandlersService`:

- `registerStageHandlers()` — now `registerStageHandlers(workers)`
- the six stage methods: `runPrefilterStage`, `runEmbeddingStage`,
  `runArchaeologyStage`, `runJudgePanelStage`, `runReplayStage`,
  `runTriggerEvalStage`
- the chain producers: `enqueueArchaeology`, `enqueueCandidateGates`,
  `enqueueGate`
- the gate helpers: `gateTarget`, `gateClusterSessionIds`,
  `recordVerdictFallback`, `candidateBody`
- `withClaimHeartbeat` and its `CLAIM_HEARTBEAT_MS` constant
- the `TRIGGER_EVAL_MEASURED_REASON` constant

To `candidate-body.ts`: the module-private `readCandidateBodyFile`. It had two
callers and the split separated them — `candidateBody` went with the handlers,
`backfillEmbeddings` stayed — so the function had to move somewhere both can see
rather than be copied a fourth time. `skill-promotion.service.ts` and
`skill-curator.service.ts` still hold their own copies; folding those in remains
the separate cleanup the original docblock filed.

## What stayed on `SkillSynthesisService`

Lifecycle (`start`/`stop`, the session-end subscription, the curator start, the
embedding-backfill enqueue), `readSettings` + `SETTINGS_DEFAULTS`,
`enqueueAnalyze`, `analyzeSession`, `backfillEmbeddings`, `passesPrefilter`,
`readVerdict`, `isDominatedByAuthoredSkill`, the event ring / eligibility
counters / diagnostics readers, and the RPC-backing `promote`, `reject`,
`rejectBulk`, `promoteBulk`, `rejectByPattern`.

## The one design decision worth flagging

`SkillStageHandlersService` does **not** inject `SkillSynthesisService`. That
would be a tsyringe resolution cycle — the synthesis service injects the stage
handlers. The three workers the handlers dispatch into arrive instead as a
narrow port:

```ts
export interface SkillStageWorkers {
  analyzeSession(sessionId, workspaceRoot, options): Promise<RegisterCandidateResult | null>;
  backfillEmbeddings(): Promise<number>;
  readSettings(): SkillSynthesisSettings;
}
```

`start()` calls `this.stageHandlers?.registerStageHandlers(this)`. The brief's
shape (`start()` calls `stageHandlers.registerStageHandlers()`) is otherwise
unchanged; the argument is what makes it cycle-free.

`SkillQueueSource` is re-used for the `source` field rather than importing
`AnalyzeSource` back from the service — `skill-queue.types.ts:51` already
aliases one to the other, so the new file has no import edge back at all.

## Constructor changes (both classes)

`SkillSynthesisService` lost four injections it no longer uses —
`SKILL_DRAIN_SERVICE`, `SESSION_ARCHAEOLOGIST_SERVICE`, `JUDGE_PANEL_SERVICE`,
`REPLAY_VALIDATOR_SERVICE`, `TRIGGER_EVAL_SERVICE` — and gained
`SKILL_STAGE_HANDLERS_SERVICE`. Leaving them in place would have been dead
injections. Positional tail is now `… queue (14), verdicts (15), stageHandlers
(16)`; four specs that construct the service by hand were adjusted (see below).

`SkillStageHandlersService` takes exactly the collaborators the brief names, with
optionality preserved verbatim: `logger` and `store` required;
`SKILL_QUEUE_STORE`, `SKILL_DRAIN_SERVICE`, `SESSION_ARCHAEOLOGIST_SERVICE`,
`JUDGE_PANEL_SERVICE`, `REPLAY_VALIDATOR_SERVICE`, `TRIGGER_EVAL_SERVICE` all
`{isOptional: true}` (`stage-handlers.service.ts:131-176`).

## DI

- New token `SKILL_STAGE_HANDLERS_SERVICE: Symbol.for('PtahSkillStageHandlersService')`
  — `di/tokens.ts:113`
- `container.registerSingleton(SkillStageHandlersService)` — `di/register.ts:88`
- `container.register(SKILL_SYNTHESIS_TOKENS.SKILL_STAGE_HANDLERS_SERVICE, {
  useToken: SkillStageHandlersService })` — `di/register.ts:167`
- Barrel: `SkillStageHandlersService` + `type SkillStageWorkers` — `src/index.ts:247`

`di/register.spec.ts`'s "registers every declared SKILL_SYNTHESIS_TOKENS member"
and the globally-unique-description assertion both still pass.

---

## The seven rules that must not break

| # | Rule | Where it now lives | Preserved how |
| --- | --- | --- | --- |
| 1 | Registration ABOVE both of `start()`'s early returns | `skill-synthesis.service.ts:273` | The call sits above `if (this.started) return;` (274) and above the `enabled` guard (275-281). **Pinned — see below.** |
| 2 | Nothing outside `lanes/lane-runner.service.ts` may contain `queueItemId` | new files | `grep -c` over both new files returns 0. `skill-drain.failures.spec.ts:89` ("the lane-failure queue write has exactly one owner (P1-7)") run explicitly and green. |
| 3 | `drain()` must never throw | `stage-handlers.service.ts` throughout | No handler propagates; the three chain producers keep their own `catch (error: unknown)` + warn (`:314`, `:432`, `:544`). Pinned by "a throwing stage never escapes drain()" in `skill-synthesis.stage-handlers.spec.ts`. |
| 4 | `prefilter` passes `force: true` | `stage-handlers.service.ts:249` | Moved verbatim with its full "why this is not a bypass" docblock. Pinned by "the same-process dedup trap (B0.9.1)". |
| 5 | `archaeology` / `judge-panel` / `trigger-eval` chain from the END of a successful prefilter, `dependsOn` NULL | `stage-handlers.service.ts:262-263` (call sites), `:283` / `:390` (producers) | Producers still fire only after `analyzeSession` returned a candidate; neither `enqueue` call passes `dependsOn`. Pinned by "the gate producers" block, which asserts `dependsOn: null` on the real store. |
| 6 | `replay` keeps its handler and no producer | `stage-handlers.service.ts:227` (handler) vs `:415-421` (`enqueueCandidateGates`, which names only the two) | Pinned by "writes NO replay row — the gate has a handler and deliberately no producer". |
| 7 | The three phase-3 gates register CONDITIONALLY | `stage-handlers.service.ts:214-232` | `if (this.judgePanel)` / `if (this.replayValidator)` / `if (this.triggerEval)`, plus `if (this.archaeologist)` at `:209`. Pinned by "does NOT register %s in a host without the service". |

**Outcome mapping** (`lane-failed` verbatim, gate-disabled → `skipped`,
ran-but-unmeasured → `unscored`, measured → `done`) is byte-identical — every
`switch`/`if` ladder and every reason token moved unchanged. I deliberately did
**not** fold the six mappings into one: the four outcomes agree, but the FACT
that selects them differs in kind per gate (a verdict status; a permanent
property of a cluster; membership of `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS`), so
a shared mapper would have to re-derive that from outside the gate that knows it.
Unifying would have been a behaviour risk for no structural gain.

**TASK_2026_253 carried across intact**: `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS`
is still the classifier at `stage-handlers.service.ts:721-724`, permanent →
`skipped`, retryable → `unscored`. Not reverted, not "simplified".

### Rule 1 is pinned, and I verified it rather than assuming

The brief warns that no existing test catches this by construction. That is not
correct on this branch — `skill-synthesis.stage-handlers.spec.ts:359` ("registers
handlers even when the master switch is off at start") drains with
`enabled: false` and asserts the row is skipped by the HANDLER's reason
(`no candidate from this session`) rather than `no handler for stage prefilter`.

I confirmed it by mutation: moved `registerStageHandlers(this)` below the
`enabled` guard and re-ran the spec →

```
Test Suites: 1 failed, 1 total
Tests:       1 failed, 39 passed, 40 total
```

Restored, re-ran → `40 passed`. So the rule is genuinely pinned for the `enabled`
guard. The `if (this.started) return;` guard is **not** separately pinned, but
that is harmless by construction: registration is idempotent and the first
`start()` call reaches it regardless, so moving below that one guard alone is not
a regression. I have added both facts to `CLAUDE.md`.

---

## Test counts — before and after

Recorded before any edit, re-run after:

| Suite | Before | After |
| --- | --- | --- |
| `skill-synthesis` (suites) | 6 skipped, 62 passed, 62 of 68 total | 6 skipped, 62 passed, 62 of 68 total |
| `skill-synthesis` (tests) | **37 skipped**, 1268 passed, 1305 total | **37 skipped**, 1268 passed, 1305 total |
| `rpc-handlers` (suites) | 79 passed, 79 total | 79 passed, 79 total |
| `rpc-handlers` (tests) | **31 skipped**, 2142 passed, 2173 total | **31 skipped**, 2142 passed, 2173 total |

Both runs with `--skip-nx-cache`. **Skip counts identical** — no suite went dark.

Also green:

- `npx nx typecheck skill-synthesis`
- `npx tsc --noEmit -p libs/backend/skill-synthesis/tsconfig.spec.json` (the lib
  typecheck target does not cover specs; ran it explicitly)
- `npx nx lint skill-synthesis` — 0 errors (30 pre-existing warnings, all in
  spec files, none in the new code)
- `npx nx run-many -t typecheck -p skill-synthesis rpc-handlers thoth-runtime
  cli-engine ptah-electron ptah-extension-vscode` — the barrel and the service
  constructor both changed, so every consumer was re-checked
- Guard specs run explicitly: `skill-drain.failures.spec.ts` +
  `regex-demotion.spec.ts` → 21 passed

## Specs touched (construction only — no assertion changed)

- `skill-synthesis.stage-handlers.spec.ts` — `makeService` now builds a
  `SkillStageHandlersService` from the same doubles and passes it in. Every test
  still drives `svc.start()`, so the registration seam is still what is under
  test.
- `skill-synthesis.service.enqueue.spec.ts` — `setupP24` likewise; the candidate
  store double was hoisted to a `const` so both objects share it.
  `withArchaeologist` still selects the same thing.
- `skill-synthesis.service.spec.ts` — `verdicts` moved from constructor index 17
  to 15.
- `prefilter-corpus-measurement.spec.ts` — one trailing `null` removed.
- `regex-demotion.spec.ts` — untouched (passes 10 args).

## Docs

`libs/backend/skill-synthesis/CLAUDE.md`:

- "Internal Structure" gains `src/lib/queue/stage-handlers.service.ts` and
  `src/lib/candidate-body.ts`, documented like the other entries; the
  `src/lib/queue/` line now names `SkillStageHandlersService`.
- "Public API" gains `SkillStageHandlersService`.
- The registration-seam bullet now says `start()` delegates, and records that the
  ordering is pinned and by which test (with the mutation result).
- The conditional-gate bullet now points at
  `SkillStageHandlersService.registerStageHandlers()`.

## Defects noticed, not fixed (structural task)

None new. The two known gaps are unchanged and still documented in place:
`JudgePanelService` and `TriggerEvalService` have no `lane-failed` channel out of
them, so a timed-out lane lands as `unscored` on the default 30-minute backoff
instead of the lane's own `retryAfterMs`. Widening `JudgePanelResult` remains the
real fix and belongs in the file that owns the gate.

One cosmetic follow-up, already noted in the source: `TRIGGER_EVAL_MEASURED_REASON`
still lives beside the handler rather than with `TRIGGER_EVAL_SKIP_REASONS` in
`gates/trigger-eval.service.ts`, where `REPLAY_REASONS.measured` sets the
precedent. It moved file with the handler; relocating it is a one-line change in
a file this task does not own.
