# Code Logic Review — `TASK_2026_437_0778` (Batch 16b delta)

Scope: user-initiated internal-query work bypassing `BackgroundWorkGovernor`.
Reviewed strictly the files the batch names: `internal-query-concurrency-gate.ts`
(unchanged in this delta — already merged with Batch 16 base; lines 33-43, 56,
255 read for context only), `internal-query.service.ts`, `internal-query.types.ts`,
`sdk-internal-query.curator-llm.ts` (+spec), `curator-llm.port.ts`,
`curator-llm.interface.ts`, `curator-window-runner.ts`, `memory-curator.service.ts`
(+spec), `memory-rpc.handlers.ts` (+spec), `internal-query.interface.ts`
(skill-synthesis), `lane-runner.service.ts` (+spec), `skill-judge.service.ts`
(+spec), `skill-promotion.service.ts` (+spec), `skill-synthesis.service.ts`
(+spec), `skill-enhancer.service.ts` (+spec), `skill-curator.service.ts` (+spec),
`skill-synthesizer.service.ts` (+spec), `skill-gap-curator.service.ts` (+spec),
`skills-synthesis-rpc.handlers.ts` (+spec), `container.ts` /
`container-governor-shutdown.spec.ts` (cli-engine), plus the CLAUDE.md deltas.

Files present in `git status` but **not** named by the batch (the three
`container.smoke.spec.ts`, `register.ts`, `session-turn-state.registry.ts`,
`arm-diagnostics.ts`, `event-loop-monitor.ts`, `di/tokens.ts`,
`register-platform-agnostic.ts`) were treated as Batch 16 base content already
under its own approval and are out of scope here, except where they were read
for context (`arm-diagnostics.ts`'s governor-dispose wiring, needed to verify
the CLI shutdown handle in requirement 7).

Verified by running the specs directly (`npx jest -c <config> <file>
--maxWorkers=2`): `internal-query.service.spec.ts` (22/22),
`lane-runner.service.spec.ts` (45/45), `skill-promotion.service.spec.ts`
(44/44), `memory-curator.service.spec.ts` (54/54),
`skills-synthesis-rpc.handlers.spec.ts` (245/245),
`container-governor-shutdown.spec.ts` (2/2). All green.

## Summary

| Metric              | Value                                  |
| ------------------- | -------------------------------------- |
| Overall score       | 8/10                                   |
| Assessment          | APPROVED                               |
| Blocking issues     | 0                                      |
| Serious issues      | 0                                      |
| Moderate issues     | 1                                      |
| Failure modes found | 2 (both pre-existing, recorded as FUs) |

## Five logic questions

### 1. How does this fail silently?

No new silent-failure path was found. The one candidate — a lane run that is
cancelled at host shutdown (`LaneRunnerService.callOnce` → `AbortError` →
`{ kind: 'cancelled' }` → `SkillJudgeService.judge` → `unscored`,
`skill-judge.service.ts:178-186,199-207`) — resolves to the same `unscored`
verdict a timeout or a "no JSON" answer produces, which is the documented "we
ran and do not know" state, not a fabricated success. This is pre-existing
behaviour from before Batch 16b and not something this delta introduced or
changed.

The one place a silent regression _could_ have entered — a call site building
a fresh options object that drops `userInitiated` on its way through — was
checked hop by hop for both pipelines (memory: RPC → `curate` → `doCurate` →
`extractAcrossWindows`/`resolveWithinBudget` → adapter → `execute`; skills: RPC
→ `promote`/`promoteBulk`/`runManual`/`enhance`/`generateProposal`/`runDigest`
→ `evaluate`/`runPass`/`generateCandidate`/`applyDescriptionRewrites` →
`judge.judge`/`laneRunner.run` → `execute`) and at every hop the field is either
carried by reference in the same options object or explicitly re-passed as a
named property. No hop rebuilds an options literal without it.

### 2. What user action produces unexpected behaviour?

None found that is new here. One pre-existing behaviour worth naming as a
follow-up rather than a defect (already recorded by the orchestrator as
FU-16b-a): a user's `memory:runNow` click resolves to the `user-action` lane
only for a _new_ curation pass. `MemoryCuratorService.curate` coalesces on
`workspaceRoot::sessionId` (`memory-curator.service.ts:344-347`) — if a
background pass for the same session is already in flight, `runNow` is handed
that promise as-is, still running on the governed `memory-curator` lane. A user
who clicks `runNow` while a PreCompact-triggered background pass for the same
session is mid-flight can still wait behind the governor, indistinguishably
from the bug this batch closes. This is documented in the method's own comment
(`memory-curator.service.ts:341-343`) and was explicitly called out by the
orchestrator as a recorded follow-up, not a blocking defect for this review.

### 3. What input data produces a wrong answer?

Nothing wrong-answer shaped. `resolveLane` (`internal-query.service.ts:50-53`)
trims and lowercases before comparing against `GOVERNED_BACKGROUND_LANES` and
`USER_ACTION_QUERY_LANE`, so a caller cannot accidentally mint
`'User-Action'` as a distinct, ungoverned-by-luck lane with its own ceiling —
it folds to `'user-action'` either way. The RPC → lane hop never trusts
client input for `userInitiated`: every RPC handler site sets the literal
`true` (`skills-synthesis-rpc.handlers.ts:452,661,1038,1090,1680,1893`;
`memory-rpc.handlers.ts:628`), never reads it off the parsed webview payload —
confirmed by grep, no `userInitiated` appears in any Zod params schema in
either handler file.

### 4. What happens when a dependency fails?

Covered by the existing (pre-16b) lane-runner failure ladder — `timeout`,
`cancelled` (host shutdown / caller abort), `auth-unresolvable`,
`quota-exhausted`, `structured-output-unsupported` — none of which this delta
changes. The one dependency this delta _adds_ a call into,
`BackgroundWorkGovernor.dispose()` from the CLI's unarmed shutdown path
(`container.ts:230-246`), is deferred-resolution: `governorShutdownHandle`
does not call `container.resolve` until `dispose()` actually runs, pinned by
`container-governor-shutdown.spec.ts:65-72` (`resolve` not called before
dispose). A CLI command that never touches a background query therefore never
constructs the governor just to shut it down.

### 5. What is missing that the requirements never mentioned?

- The `promoteBulk` doc comment at `skill-synthesis.service.ts:1259-1261`
  still describes wizard/curator serialisation on "the one default-lane slot"
  — a leftover from before this batch existed. Since Batch 16b, a
  `userInitiated: true` `promoteBulk` runs on `user-action`, not `default`, so
  a wizard call on `default` no longer interleaves with it the way the comment
  describes. Not a logic defect (the code is correct), but the comment
  documents behaviour the code no longer has. See Moderate issues.
- No test pins that a _second_ concurrent RPC-driven user action (e.g. a
  `promote` click while a `runManual` click is still running) is admitted
  rather than queued behind the `user-action` per-lane ceiling of 1
  (`DEFAULT_MAX_CONCURRENT_PER_LANE`). That is expected — the lane's whole
  point is FIFO ordering under one slot — but it means two simultaneous user
  clicks now compete with each other on the same footing they used to compete
  with background work, which nobody asked this batch to change and nothing
  in it does; noting only because it is untested territory the delta widens.

## Failure modes

### Coalescing onto an in-flight background pass keeps its lane (FU-16b-a)

- Trigger: `memory:runNow` for a session that already has a PreCompact- or
  interval-triggered curation pass in flight.
- Symptom: the RPC call appears to "run now" but its underlying LLM calls are
  still on the governed `memory-curator` lane and may wait behind a generating
  chat turn.
- Evidence: `memory-curator.service.ts:344-347` (coalescing check precedes the
  `userInitiated` callOptions build at line 510); the returned promise is the
  original background invocation's promise, whose `callOptions` were built
  from the _original_ caller's `input.userInitiated` (absent).
- Current handling: documented in the method's own doc comment; recorded by
  the orchestrator as FU-16b-a, explicitly not a defect for this review.
- Recommendation: unchanged from the orchestrator's disposition — leave as a
  tracked follow-up.

### Background lanes can hold both global slots (FU-16b-c, pre-existing)

- Trigger: `memory-curator` and `skill-synthesis` background lanes both busy
  at once with `DEFAULT_MAX_CONCURRENT = 2`, `DEFAULT_MAX_CONCURRENT_PER_LANE
= 1`.
- Symptom: a `user-action` caller can still queue at the GLOBAL ceiling behind
  two background calls, even though `user-action` is never _governor_-gated.
  `isGoverned('user-action')` is `false` (not in `GOVERNED_BACKGROUND_LANES`),
  but `admissible()` (`internal-query-concurrency-gate.ts:432-436`) still
  checks `this.active < this.limit` first — governance and the global slot
  ceiling are independent gates, and this batch does not (and was not asked
  to) exempt `user-action` from the global ceiling.
- Evidence: `internal-query-concurrency-gate.ts:87` (`DEFAULT_MAX_CONCURRENT =
2`), `:432-436` (`admissible`).
- Current handling: pre-existing from Batch 16 base; recorded by the
  orchestrator as FU-16b-c, explicitly not a defect for this review.
- Recommendation: unchanged from the orchestrator's disposition.

No new failure mode was found that the orchestrator has not already recorded.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Stale doc comment describes pre-16b lane behaviour

- File: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1259-1261`
- The comment says each `promoteBulk` judge call "takes the one default-lane
  slot and releases it before the next id asks, so a wizard call queued
  meanwhile is admitted between two items". Since this batch, a
  `userInitiated: true` call (the only caller of `promoteBulk`, per
  `skills-synthesis-rpc.handlers.ts:1680`) runs on `user-action`, not
  `default` — a wizard call on `default` no longer contends with it at all.
  The code is correct; the comment misdescribes which lane is in play and
  should be updated to avoid misleading the next reader into thinking
  `promoteBulk` still shares a slot with the wizard.

### `session-turn-state.registry.ts`, `register.ts` diffs outside the named batch scope

Both files carry substantial diffs (94 and 26 lines) that are not named in the
batch's file list, which only mentions `turn-state-foreground-source.ts` as a
doc-only touch. They implement the foreground-detection wiring the governor
needs (Batch 16 base), so they were read for context but not reviewed
line-by-line here — flagging only so the base-batch review record is checked
to confirm it actually covered `session-turn-state.registry.ts`'s 94-line
diff, since this delta's own file list did not.

## Data flow

1. RPC handler receives a client call with no `userInitiated` in its Zod
   schema — OK, cannot be forged from the webview.
2. Handler hardcodes `userInitiated: true` (or, for `runManual`, passes
   `{ userInitiated: true }`) into the service call — OK, single write site
   per RPC, six of them, all literal `true`.
3. Service layer (`SkillSynthesisService.promote/promoteBulk`,
   `SkillCuratorService.runManual/runPass`, `SkillGapCuratorService.runDigest`,
   `MemoryRpcHandlers` direct call) forwards the origin object by reference or
   as a named field into the next layer down — OK, pinned by
   `skill-synthesis.service.spec.ts:368-379`, `skill-promotion.service.spec.ts
:1036-1048`, `memory-curator.service.spec.ts:1866-1894`,
   `skill-curator.service.spec.ts` (new `describe` block).
4. Domain service (`SkillPromotionService.applyJudgeGate`,
   `SkillCuratorService.runPass`'s sub-passes, `CuratorWindowRunner`) calls
   `judge.judge(...)` / `laneRunner.run(...)` / `llm.extract/resolve(...)`
   with the origin threaded into the call — OK, verified per call site above.
5. `skillQueryLane(origin)` / the curator adapter's inline ternary map
   `userInitiated === true` to the lane string, else the governed background
   lane — OK, single conversion point per pipeline
   (`lane-runner.service.ts:182-186`,
   `sdk-internal-query.curator-llm.ts:412-418`).
6. `InternalQueryService.execute` resolves the lane via `resolveLane` (trim +
   lowercase) and asks the gate for a slot — OK, `GOVERNED_BACKGROUND_LANES`
   is an allow-list so an unrecognised lane (including `user-action`) is never
   governor-gated (`internal-query-concurrency-gate.ts:56-59,254-256`).
7. Gate admits or queues by global + per-lane ceilings, plus governor
   admission for the two named background lanes — OK, unchanged from Batch 16
   base, exercised by the existing gate spec.

No step in this chain drops the origin field or trusts an external source for
it.

## Requirements fulfilment

| Requirement                                                                                | Status   | Gap                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC paths set `userInitiated: true`, reaching `execute` as `user-action` through every hop | COMPLETE | None found; verified for promote, promoteBulk, runManual (overlap/synthesis/suggestion-judge/enhance sub-passes), digest (rewrite-gated), enhanceNow, previewEnhancement, memory `runNow`                                                     |
| No background path sets it                                                                 | COMPLETE | `memory-trigger.service.ts` (interval + boot scan), `skill-invocation-tracker.ts` (auto-promotion), `skill-curator.service.ts`'s interval `runPass`, `JudgePanelService` (queue drain) all omit the field                                     |
| RPC params schema never accepts `userInitiated` from the client                            | COMPLETE | grep confirms no Zod schema field named `userInitiated`; every set site is a literal `true`                                                                                                                                                   |
| Allow-list semantics; no background caller on an unlisted lane                             | COMPLETE | Only `memory-curator` and `skill-synthesis` lane strings are used for background LLM calls; `archaeologist` etc. are skill-lane IDs that map through `skillQueryLane` to `skill-synthesis`, not raw internal-query lanes                      |
| `manual` vs `userInitiated` independence in the enhancer                                   | COMPLETE | `skill-enhancer.service.ts:347,350,357` gate on `manual` only; lane selection gates on `userInitiated` only (`skillQueryLane(options)`)                                                                                                       |
| Cancelled judge leaves candidates consistent                                               | COMPLETE | Cancellation maps to the pre-existing `unscored` verdict shape, same as a timeout; no partial write                                                                                                                                           |
| Memory contracts port change backward compatible                                           | COMPLETE | `CuratorCallOptions` is optional on both `ICuratorLLM` methods; single production implementation (`SdkInternalQueryCuratorLlm`)                                                                                                               |
| CLI `governorShutdownHandle` spec meaningful                                               | COMPLETE | Asserts actual disposal + pending-waiter rejection + deferred construction, not a trivial resolve check                                                                                                                                       |
| Layering: no field-drop gap hidden by double-mocking                                       | COMPLETE | Each intermediate service (`SkillSynthesisService`, `SkillPromotionService`, `SkillCuratorService`, `MemoryCuratorService`) has its own spec asserting the field crosses that specific hop, in addition to the RPC-level and lane-level specs |

Implicit requirements not addressed: none found beyond the two recorded FUs
(coalescing-onto-background-lane, global-ceiling contention) the orchestrator
already scoped out of this review.

## Edge cases

| Case                                                          | Handled                | How                                                                                                   | Concern                                                            |
| ------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Lane string case/whitespace variance (`'User-Action '`)       | YES                    | `resolveLane` trims + lowercases                                                                      | None                                                               |
| `userInitiated: false` explicitly passed                      | YES                    | `=== true` check everywhere, not truthy check                                                         | None                                                               |
| Two RPC clicks racing on `user-action`'s single per-lane slot | YES (by FIFO queueing) | Same gate mechanics as any other lane                                                                 | Untested by this batch's specs, but not a regression it introduces |
| Coalesced `runNow` onto in-flight background pass             | PARTIAL                | Returns the original governed-lane promise                                                            | FU-16b-a, orchestrator-scoped follow-up                            |
| Host shutdown mid-judge                                       | YES                    | `AbortError` → `cancelled` → `unscored`                                                               | None                                                               |
| CLI never touching a background query                         | YES                    | Governor resolved lazily at dispose only                                                              | None                                                               |
| `digest` RPC with `allowRewrite: false`                       | YES                    | `userInitiated` still passed to `applyDescriptionRewrites` but unused when `authorClauses` is skipped | None                                                               |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the coalescing gap (FU-16b-a) is the one place a user click can
  still wait behind the governor after this batch, but it is documented,
  bounded to one specific race (a `runNow` landing on a session already being
  curated in the background), and the orchestrator has already scoped it out
  as a tracked follow-up rather than a blocking defect.
- What a robust implementation would add: (1) update the stale
  `promoteBulk` doc comment at `skill-synthesis.service.ts:1259-1261`; (2) a
  regression test asserting a `runNow` that coalesces onto an in-flight
  background pass is itself surfaced somehow (log line, degradation event) so
  FU-16b-a is at least observable in production rather than only in a code
  comment; (3) a test pinning that two simultaneous `user-action` callers
  queue FIFO rather than starve each other, now that user actions share a
  slot the way background lanes always have.
