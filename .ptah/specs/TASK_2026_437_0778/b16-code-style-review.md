# Code Style Review — `TASK_2026_437_0778` Batch 16

## Summary

| Metric          | Value                         |
| --------------- | ----------------------------- |
| Overall score   | 8/10                          |
| Assessment      | APPROVED                      |
| Blocking issues | 0                             |
| Serious issues  | 1                             |
| Minor issues    | 3                             |
| Files reviewed  | 17 (9 production, 8 spec/doc) |

Scope reviewed: `libs/backend/vscode-core/src/diagnostics/background-work-governor.ts` (+spec, new),
`event-loop-monitor.ts` (+spec), `arm-diagnostics.ts` (+spec), `diagnostics/index.ts`, `src/index.ts`,
`src/di/tokens.ts`, `src/di/register-platform-agnostic.ts`, `libs/backend/vscode-core/CLAUDE.md`;
`libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts` (+spec),
`src/lib/di/register.ts`, `src/lib/internal-query/internal-query.service.ts` (+spec),
`src/lib/di/register.compaction-boundary-registry.smoke.spec.ts`, `libs/backend/agent-sdk/CLAUDE.md`;
the three hosts' `container.smoke.spec.ts`. Uncommitted `libs/backend/platform-{core,cli,electron}/**`
edits from another executor were excluded per instruction.

## Five style questions

### 1. What breaks in six months?

Nothing structural. The one place a later change is most likely to snap something is
`internal-query.service.ts`: it is 699 lines, one line under the 700-line soft ceiling
(root `CLAUDE.md` "File size"), and Batches 17 and 18 both touch adjacent gate/lane logic in
the same file (`batches.md:988-1034`). The file already crosses the ceiling once either batch adds
a line without also trimming one — at which point the fix is the same facade split available now:
promote `InternalQueryConcurrencyGate` (already a self-contained, independently testable collaborator
at `internal-query.service.ts:210-445`) to its own file and have `InternalQueryService` inject it.
Doing that now, while the class boundary is still fresh, costs less than doing it under time pressure
once two more batches have added lines around it.

### 2. What would a new team member misread?

`register.ts:434` gates the foreground-source wiring behind
`container.isRegistered(TOKENS.BACKGROUND_WORK_GOVERNOR, true)` — a reader who does not know tsyringe's
`isRegistered(token, recursive)` second argument could mistake this for a plain existence check and
miss that it also walks parent containers, which is exactly what makes the "a test host with no
governor is silently fine" property hold. The comment immediately above it (`register.ts:427-433`)
already explains the intent, so this is a one-time cost, not a defect.

### 3. What does this cost to maintain?

Low. The state machine (`background-work-governor.ts`) is small, has one clearly bounded
responsibility ("may background work start a unit now"), and every fan-out point (foreground sources,
lag hysteresis, `whenClear` waiters) is independently unit-tested with a fake clock — no real timer in
the entire spec file. The gate's governed-admission logic in `internal-query.service.ts` reuses the
existing FIFO-scan `drain()` rather than adding a second queue or a second lock, so the marginal
complexity of "background lanes also wait on the governor" is one boolean term
(`this.admissible(lane) && this.governorAdmits(w)`, `internal-query.service.ts:435`), not a parallel
code path.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally. It follows precedent set by earlier batches rather than inventing new shapes:

- `BACKGROUND_WORK_GOVERNOR`'s `useFactory: instanceCachingFactory(...)` registration
  (`register-platform-agnostic.ts:118-122`) follows the exact justification pattern the file already
  uses for `DEGRADATION_REPORTER` two lines below (`:134-138`), and the one `register.ts` already
  documents for `CompactionBoundaryGenerationRegistry` (`register.ts:386-401`): an interface-typed
  constructor parameter defeats tsyringe's `design:paramtypes` auto-wiring, so a factory is required,
  not a stylistic choice.
- `ForegroundActivitySource` living in vscode-core while its only implementation lives in agent-sdk
  mirrors the existing `IHarnessPreflight` structural port (agent-sdk `CLAUDE.md:43-48`) — same shape,
  same reason (the natural dependency edge points the wrong way for a concrete interface).
- Both new/changed index barrels (`diagnostics/index.ts`, `src/index.ts`) keep the established
  `export { … }` / `export type { … }` split for every new symbol — no regression here.

### 5. What would you have done differently, and why is that better rather than merely other?

I would extract `InternalQueryConcurrencyGate` into its own file (`internal-query-concurrency-gate.ts`)
in this batch rather than leaving it as a second exported class inside `internal-query.service.ts`.
The facade rule's own guardrails are satisfied today — the gate already has its own contract
(`GateAdmissionOptions`, `AcquireRequest`), is already exercised by its own `describe` blocks in the
spec file, and is already a collaborator constructed once in `InternalQueryService`'s constructor
rather than mixed into its methods. The only thing missing is the file boundary. Doing the split now,
while it is a pure move with no behaviour change, is cheaper than doing it once Batch 17 or 18 has
added lines around the seam and the diff has to disentangle unrelated changes from the same commit.

## Blocking issues

None.

## Serious issues

### `internal-query.service.ts` is at the 700-line soft ceiling with two dependent batches still to land

- File: `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts` (699 lines total;
  `InternalQueryConcurrencyGate` at `:210-445`, `InternalQueryService` at `:451-699`)
- Problem: root `CLAUDE.md` sets a 700-line soft ceiling and names the facade rule as the split
  mechanism: "the public class keeps its name, DI token and method signatures; the extracted concern
  becomes a collaborator injected into it." That is already true here in substance —
  `InternalQueryConcurrencyGate` is a separate class with its own state, constructed once
  (`internal-query.service.ts:468`) and injected nowhere else — but the two classes still share one
  file. `batches.md:988-1034` schedules Batch 17 (four independent seams) and Batch 18 (curator/
  skill-synthesis back-off) against the surrounding code, and Batch 17's own task list already warns
  that only one of its four lanes may touch the file index to avoid a collision (`batches.md:1003`);
  the concurrency-gate file is the next predictable collision point.
- Tradeoff: leaving it combined risks a future batch adding a handful of lines that quietly cross 700,
  at which point the split is done under a "shrink this file" mandate instead of as a clean, reviewable
  move — exactly the "helpers/utils/misc" trap the facade rule is written to avoid, except here the
  risk is the opposite failure mode (deferring a well-defined split until it is forced).
- Recommendation: move `InternalQueryConcurrencyGate`, `GateAdmissionOptions`, `AcquireRequest`, `Waiter`,
  `abortError`, `normalizeLimit` and the gate's own doc comment into
  `internal-query-concurrency-gate.ts` (nameable, already independently testable — its own `describe`
  blocks in the spec file do not touch `InternalQueryService` at all). `InternalQueryService` keeps its
  name, its DI token and every public method signature unchanged; only its constructor's internal
  `new InternalQueryConcurrencyGate(...)` call changes to an import. This is a pure move, so it is safe
  to schedule as a small follow-up rather than blocking this batch on it.

## Minor issues

- `register.ts:427-442`: the inline `{ isForegroundBusy, onForegroundChange }` object satisfying
  `ForegroundActivitySource` is unnamed glue with no independent logic (it forwards directly to
  `turnStateRegistry.hasGenerating()` / `.onGeneratingChange()`), so it does not need its own file or
  class — flagging only because the task brief asked the question directly. It is smaller and more
  direct than the nearby `SessionIdResolvedCallbackRegistry.register(...)` callback
  (`register.ts:447-462`) that already sets this file's precedent for inline wiring; no change needed.
- `background-work-governor.ts` exports `GovernorTimers` and `LagSampleSource` as types
  (`:52-56` re-export list in `diagnostics/index.ts`), but neither is re-exported from
  `vscode-core/src/index.ts`'s top-level barrel, and neither appears in the vscode-core `CLAUDE.md`
  Public API line. That is consistent — both are internal seams (a fake-clock interface used only by
  this class's own spec, and a narrowed `EventLoopMonitor` view used only by `attachLagSource`) — but
  the asymmetry between the two barrels is worth a one-line comment at the diagnostics barrel saying so,
  the same way `spawn-worker-pool.ts`'s constants are called out as "deliberately NOT in the barrel"
  (agent-sdk `CLAUDE.md`) rather than left to be inferred.
- `arm-diagnostics.ts:141-160` (`attachGovernor`) and the pre-existing `armWatchdog` beside it both
  swallow their resolution/attach failure into a `logger.warn` with no `DegradationReporter.report(...)`
  call and no `// degradation-audit:` marker. Per the vscode-core `CLAUDE.md` "When a `catch` may
  degrade" rule this would normally need one or the other. This is not a regression introduced by this
  batch — `armWatchdog`'s identical shape predates it — so it reads as an existing, accepted exemption
  (diagnostics arming failing is not itself the kind of "capability fell back to a default" the
  reporter tracks) rather than a new defect; noting it only because `attachGovernor` extends the exact
  same pattern rather than revisiting it.

## File-by-file

### `background-work-governor.ts` (new)

Score 9/10 — 0 blocking, 0 serious, 0 minor. Clean single-responsibility state machine: derived state
only, no owned queue beyond `whenClear` waiters, every timer `unref()`-ed and documented as to why
(`:44-49`). Fail-open on a throwing foreground source (`:344-354`) and fail-open on a throwing `onChange`
listener (`:415-424`) are both consistent with the repo's degradation posture. `dispose()` resolving
pending waiters as `'clear'` rather than leaving them to hang (`:318-330`) is the right call for a
diagnostics-adjacent class.

### `background-work-governor.spec.ts` (new)

Score 9/10. Fake clock and fake sources throughout (`createClock`, `createForeground`,
`createLagSource`) — no spec depends on a real 10-minute timer. Covers hysteresis boundary conditions
(exactly-at-threshold, exit-bar edge case at `:163-172`), replacement of a stale lag source (`:202-218`),
abort ordering, and dispose. This is the version other new diagnostics classes in this lib should be
measured against.

### `event-loop-monitor.ts`

Score 8/10. `onSample` is added as a parallel listener set to the existing `onLag`, documented as to
why `onLag` cannot serve the governor (`:130-136`) — a real distinction (breach-only vs. every-window),
not duplication for its own sake. `notify()` is reused for both sets via the existing generic helper.

### `arm-diagnostics.ts`

Score 8/10. `attachGovernor` follows the same failure-boundary shape as the pre-existing `armWatchdog`
(each failure caught and logged independently so one diagnostic's failure to arm cannot cost the whole
handle) — see Minor issue on the degradation marker above.

### `internal-query.service.ts`

Score 7/10 — 0 blocking, 1 serious (file-size/split timing), 0 minor. The governed-admission logic
itself is sound: `isGoverned`/`governorClear`/`governorAdmits` are three small, named predicates rather
than one tangled condition, `handleGovernorChange` re-times every gated waiter and re-drains
(`:377-385`), and the queue-timeout-stops-while-governed accounting is documented at the class level
(`:201-205`) and matches the spec (`:883-916` in the spec file testing exactly that boundary). See
Serious issue for the one recommendation.

### `session-turn-state.registry.ts`

Score 9/10. `hasGenerating()` is a bounded scan (`TURN_RECORD_MAP_LIMIT`), and every phase-changing
method that can end a `generating` record (`markGenerating`, `settleTurn`, `forceIdle`, `clear`,
`evictOldestRecord`) calls `notifyGeneratingChange()` — this was cross-checked against the vscode-core
`CLAUDE.md` claim ("after `markGenerating`/`settleTurn`/`forceIdle`, and a `clear` or eviction that
drops a generating record") and the code matches exactly, including the eviction path
(`:520-536`) that is easy to forget.

### `register.ts`

Score 8/10. The foreground-source wiring at `:427-442` is defensive (`isRegistered` guard, degrades to
"no foreground signal" rather than throwing) and correctly typed against the concrete
`BackgroundWorkGovernor` only because `addForegroundSource` is not part of the read-only
`BackgroundWorkSignal` interface the rest of the codebase depends on — the narrower interface is used
everywhere it is sufficient (`internal-query.service.ts`), and the concrete class only where the wider
surface is genuinely needed. That is the correct interface-segregation call, not an oversight.

### `register.compaction-boundary-registry.smoke.spec.ts`

Score 9/10. Extends an existing DI-smoke-spec pattern (real `registerSdkServices` container, stubbed
collaborators) with a focused new `describe` block that pins exactly the property the plan's D2 defect
handling requires — DI wiring verified through a real container smoke test, not through
`expected-resolvable.ts`. Includes the "no governor registered, no throw" case (`:275-277`), the one a
CLI host without the governor in its container will actually hit.

### Three hosts' `container.smoke.spec.ts`

Score 8/10 each, identical shape across CLI/Electron/VS Code — `BACKGROUND_WORK_GOVERNOR` resolves to a
singleton, starts clear, exposes `whenClear`. Consistent with the `MAIN_LOOP_WATCHDOG` pin immediately
above each in the same files, which is the established pattern for plan defect D2.

### `libs/backend/vscode-core/CLAUDE.md`, `libs/backend/agent-sdk/CLAUDE.md`

Score 9/10. Every numeric claim in the new "Background work yields" section
(hysteresis thresholds, 10-minute ceiling, fail-open behaviour) was checked line-by-line against
`background-work-governor.ts` and matches exactly, including the log line text
(`[background-work] deferral ceiling reached — proceeding`) and the degradation code string
(`agent.internal-query.ungoverned`, verified against `internal-query.service.ts:122`).

## Pattern compliance

| Repository rule or nearby convention                                                                   | Status     | Evidence                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| agent-sdk → vscode-core only; no reverse edge                                                          | PASS       | `background-work-governor.ts` has no import of agent-sdk; `ForegroundActivitySource` is the structural port agent-sdk implements |
| New DI tokens pinned via each host's `container.smoke.spec.ts`, not `expected-resolvable.ts` (D2)      | PASS       | all three hosts' specs updated identically                                                                                       |
| `instanceCachingFactory` used only where `useClass`/`registerSingleton` cannot resolve the constructor | PASS       | `register-platform-agnostic.ts:118-122`, matches the documented `CompactionBoundaryGenerationRegistry` precedent                 |
| `export type` for type-only exports in both index.ts files                                             | PASS       | `diagnostics/index.ts:7-11,44-53,56-59`; `src/index.ts:153-166`                                                                  |
| File size soft ceiling 700 lines / facade rule on split                                                | AT CEILING | `internal-query.service.ts` 699 lines; gate already a nameable, independently-tested collaborator not yet in its own file        |
| `catch (error: unknown)` with `instanceof Error` narrowing                                             | PASS       | `background-work-governor.ts:347`, `arm-diagnostics.ts:118,154,179`                                                              |
| Timers never keep the process alive (`unref()`)                                                        | PASS       | `background-work-governor.ts:150`; `internal-query.service.ts:319,369`                                                           |
| CLAUDE.md accuracy against shipped code                                                                | PASS       | cross-checked numeric thresholds, log strings, degradation code                                                                  |
| Degradation events use a string-literal `code`, not an interpolated one                                | PASS       | `internal-query.service.ts:592` `DEGRADE_UNGOVERNED` is a module-level literal                                                   |

## Maintenance debt

- Introduced: one new state-machine class with clean boundaries (`BackgroundWorkGovernor`), one new
  structural port (`ForegroundActivitySource`), one new admission term on an existing, already-tested
  gate. Debt introduced is proportional to the feature — no speculative abstraction, no new
  indirection layer beyond what INV-7 requires.
- Retired: nothing removed; this is additive.
- Net: slightly negative for `internal-query.service.ts` specifically (one file now at the soft ceiling
  with two more batches scheduled to touch it), neutral to positive everywhere else — the governor
  itself is a well-isolated addition that reduces coupling risk for its adopters rather than increasing
  it (each adopter only needs `BackgroundWorkSignal`, not the concrete class).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `internal-query.service.ts` is one line under the file-size soft ceiling while two more
  scheduled batches (17, 18) still touch code around it; the pending gate extraction is low-risk and
  should happen before either lands, not after the file is already over the line.
- What a 10/10 version would do differently: extract `InternalQueryConcurrencyGate` into its own file
  now, as a pure move with no behaviour change, ahead of Batches 17/18; add the one-line "why not in
  the top-level barrel" comment for `GovernorTimers`/`LagSampleSource` at the diagnostics barrel.

---

## Delta review (review fixes)

Scope: the fixes made in response to the review above and to the logic review, re-read against the
working tree in `D:\projects\ptah-437` (read-only; no nx/test runs; `npx eslint`/`npx prettier --check`
allowed). Uncommitted `libs/backend/platform-{core,cli,electron}/**` edits from another executor
excluded per instruction. New files: `libs/backend/agent-sdk/src/lib/internal-query/internal-query-concurrency-gate.ts`
(+spec), `libs/backend/agent-sdk/src/lib/helpers/turn-state-foreground-source.ts` (+spec). Changed:
`internal-query.service.ts`, `session-turn-state.registry.ts` (+spec), `di/register.ts`,
`background-work-governor.ts` (+spec), `event-loop-monitor.ts` (+spec), `arm-diagnostics.ts` (+spec),
`libs/backend/cli-engine/src/lib/container.ts`, `libs/backend/skill-synthesis/src/lib/internal-query.interface.ts`,
`skill-enhancer.service.ts` (+spec), both CLAUDE.md files.

### The Serious finding is resolved

`InternalQueryConcurrencyGate`, `GateAdmissionOptions`, `AcquireRequest`, `Waiter`, `abortError` and
`normalizeLimit` now live in `internal-query-concurrency-gate.ts` (451 lines, `internal-query-concurrency-gate.spec.ts`
alongside it). `internal-query.service.ts` is down to 305 lines, keeps its class name, DI token, every
public method signature, `DEFAULT_INTERNAL_QUERY_LANE`/`DEFAULT_MAX_CONCURRENT`/`*_KEY` constants and
`resolveLane` — exactly the facade-rule shape recommended (public class keeps name/token/signatures;
extracted concern becomes an injected collaborator). Confirmed nothing outside `internal-query.service.ts`
imports the gate directly (`grep -rn "internal-query-concurrency-gate"` outside the two new files hits
only the service and its own spec) — no premature re-export, no barrel entry added. Batches 17/18 now
have a materially smaller collision surface in the file they were scheduled to touch.

### New structure: `TurnStateForegroundSource`

`libs/backend/agent-sdk/src/lib/helpers/turn-state-foreground-source.ts` (+spec) replaces the inline
object-literal adapter that lived in `register.ts:434-441` in the prior version. This is the right call
now that the class carries real logic of its own — a stale-generating-record ceiling
(`STALE_GENERATING_CEILING_MS`, 60 min) with its own `unref()`-ed timer, per-key warn de-duplication
(`warnedStale`), and multi-listener fan-out — none of which was present when the adapter was nine lines
of pure delegation (the prior review's judgement that the inline form was fine applied to that shape,
not this one). Placement next to `session-turn-state.registry.ts` in `helpers/` is correct: it is a
collaborator of the registry, not a generic diagnostics helper, and the naming
(`TurnStateForegroundSource`, `GeneratingSessionsSource`, `ForegroundSourceClock`) reads as what it is
rather than a mechanism name. `di/register.ts:440` now reads
`.addForegroundSource(new TurnStateForegroundSource(turnStateRegistry, logger))` — one line, easy to
verify against the class it names. The registry's `hasGenerating(): boolean` was correctly replaced
throughout (registry, source, both specs, both CLAUDE.md files) with `generatingSessions(): GeneratingSession[]`
— a strictly more informative surface (carries `since`, which the source needs for the stale check) with
no leftover reference to the old name anywhere in the diff.

### `BackgroundWorkGovernor`: `LAG_FREEZE_MAX_MS`, `'disposed'`, `logCeilingOnce`

- `LAG_FREEZE_MAX_MS` (1 s, immediate entry into `lagging` on one frozen window) is documented with the
  mechanism reason (a total freeze produces at most one post-freeze window whose p99 reads healthy, so
  the two-window rule can never fire for it) both in the class header and in the `handleSample` doc
  comment, and the CLAUDE.md prose matches it exactly, including the Node 24.15 measurement it is based
  on (0-33 ms `max` recorded for a 1.5-5 s block, per `event-loop-monitor.ts:213-227`).
- `'disposed'` is a genuinely terminal state: every method that could resurrect it (`onChange`,
  `addForegroundSource`, `attachLagSource`, `recompute`) checks `this.current === 'disposed'` and no-ops.
  `dispose()` sets `current = 'disposed'` before touching anything else, so the teardown it triggers
  cannot re-derive `'clear'` and release waiters through the normal path — verified by reading the order
  in `background-work-governor.ts:366-383` (state flip, then detach, then reject-with-`AbortError`, then
  notify `'disposed'`, then clear listeners). This is the correct order: a listener still attached when
  `notify('disposed')` fires gets the terminal state, and only then is it dropped.
- `logCeilingOnce` + `ceilingLoggedLanes` (governor side) and `ceilingReportedLanes` (gate side) are two
  independent per-lane, per-episode de-dupe sets guarding two different log lines
  (`[background-work] deferral ceiling reached` vs. `background lane held past the deferral ceiling`) —
  not duplicated logic, since each fires from a different clock (the governor's own `whenClear` ceiling
  vs. the gate's per-waiter defer timer) and each is cleared on its own object's transition back to
  clear (`background-work-governor.ts:467-470`; `internal-query-concurrency-gate.ts:371`).
- The gate's new `'disposed'` handling (`handleGovernorDisposed`, `governorDisposed` flag,
  `SHUTDOWN_MESSAGE`) mirrors the governor's contract precisely: a later `acquire` on a governed lane
  rejects at once (`:263-265`) rather than queuing and then immediately rejecting, which would have cost
  a spurious queue-timeout timer for no reason.

### `EventLoopMonitor` lateness-based max — correctly scoped

`event-loop-monitor.ts:228-241` takes `maxMs` as `Math.max(toMs(histogram.max), roundMs(lateMs))`, where
`lateMs` is the sampler's own tick lateness. `lastSampleAt` is initialised in `start()` (`:165`) before
the first `setInterval` fires, so the first real sample's `lateMs` is computed against a real baseline,
not `0` read as "no data" (which would have silently under-reported the first window). The residual gap
documented in the class doc (a block shorter than one interval starting in the 20 ms post-reset slot)
is stated as a residual, not implied to be closed — accurate self-description.

### `arm-diagnostics.ts:159` — governor now fully disposed, not just detached

`attachGovernor` returns `() => governor.dispose()` instead of the prior version's
`governor.attachLagSource(...)` detacher. This is a real behavioural widening (the returned function
used to only unhook the lag source; it now tears down the whole governor, including every foreground
source and every pending `whenClear` waiter) and it is deliberate and documented at the call site
(`:139-142`): the diagnostics handle's `dispose()` is the one shutdown path in all three hosts, so this
is where "stop admitting background work during quit" has to happen. The CLI's non-`--verbose` branch
(`cli-engine/container.ts:421-430`) independently reaches the same disposal through a hand-built
`{ dispose }` object rather than through `armDiagnostics`, since that path never arms diagnostics at
all — both routes are exercised by the respective specs (`arm-diagnostics.spec.ts:194-205` for the armed
path; no CLI-container-level spec was added for the unarmed branch, see Minor below).

### `libs/backend/cli-engine/src/lib/container.ts` at 880+ lines

The addition itself (the `else` branch at `:421-430`) is small, reuses the pre-existing `_diagnostics`
seam, and is typed narrowly (`_diagnostics: { dispose(): void } | undefined`, not the full
`DiagnosticsHandle`) so the branch that never calls `captureCpuProfile` cannot be mis-typed into
promising one. That part is fine. The file itself, though, is pre-existing debt this batch did not
create but does add to: at 901 lines it is well past the 700-line soft ceiling, and unlike Electron's
equivalent DI bootstrap — split across `bootstrap.ts` (380 lines), `wire-runtime.ts` (615 lines) and
`di/phase-1-infra.ts` (163 lines) — `cli-engine`'s container has never been split. This is not a
regression introduced by Batch 16 (the file was already over the ceiling before this change) and the
15 lines added here are clearly placed next to the code they extend, so it is not blocking; naming it
because the coordinator asked directly. If cli-engine's container is ever split under the facade rule,
diagnostics/governor wiring (`armDiagnostics`, the two `_diagnostics` branches, `disposeDiagnostics`) is
a plausible, nameable extraction on its own.

### skill-synthesis: `USER_INITIATED_QUERY_LANE` vs. `DEFAULT_INTERNAL_QUERY_LANE`

Two string literals both equal to `'default'`, in two libraries that cannot import each other
(`internal-query.interface.ts:20-31`'s own header explains why: avoiding a circular dependency back into
agent-sdk). This is not an oversight — the constant's doc comment states outright that it "Mirrors
agent-sdk's `DEFAULT_INTERNAL_QUERY_LANE`, which this library cannot import" — but it is a real,
named risk rather than a false one: nothing short of this comment and a cross-referenced test would stop
the two values drifting apart if agent-sdk's default lane name ever changed. `lane: string` being made
REQUIRED on `IInternalQuery.execute` (`:87`, changed from optional) is the correct mitigating move — it
forces every skill-synthesis caller to make an explicit choice between `USER_INITIATED_QUERY_LANE` and
`SKILL_SYNTHESIS_QUERY_LANE` rather than silently falling through to whatever the concrete service
treats as default, which is exactly the failure mode (a background call landing in the ungoverned bucket)
this whole batch exists to close. `skill-enhancer.service.ts:371` correctly branches
`options.manual ? USER_INITIATED_QUERY_LANE : SKILL_SYNTHESIS_QUERY_LANE`, and both new spec files
(`skill-enhancer.service.spec.ts`, `skill-synthesis.service.enqueue.spec.ts`) were extended rather than
left stale.

### `degradation-audit: optional-capability` marker on the empty catch in the registry

`session-turn-state.registry.ts:565-569`'s `notifyGeneratingChange` swallows a subscriber's throw with
an entirely empty `catch {}` block, marked `// degradation-audit: optional-capability - a throwing
subscriber loses only its own notification...`. Checked against `tools/degradation-audit/check-degradation.ts`:
`empty-catch` is a distinct violation kind the AST walker specifically looks for, and `optional-capability`
is one of exactly two recognised suppression kinds for it (`reported` being the other) — so this is not
a stretched use of the marker, it is the tool's own intended use for exactly this shape. It also matches
the two pre-existing precedents in `main-loop-watchdog.ts:130,149` (both empty-ish catches, both marked
`optional-capability`, both explaining why the lost work is non-critical). Separator is a bare `-`, one
of the three the header permits (`-`, `–`, `—`). No change needed.

### Minor (new)

- No spec directly exercises `CliDIContainer`'s non-`--verbose` `_diagnostics` disposal branch
  (`cli-engine/container.ts:425-430`) the way `arm-diagnostics.spec.ts` exercises the armed path — the
  governor's own `dispose()` is well covered, but the wiring that reaches it from the CLI's unarmed
  boot path is not. Low risk (the branch is three lines forwarding to an already-tested method), worth
  a follow-up rather than blocking.
- `GeneratingSessionsSource.generatingSessions()` is typed `readonly GeneratingSession[]` in the
  foreground-source file but the registry's concrete return type is the mutable `GeneratingSession[]`
  (`session-turn-state.registry.ts:289`) — compatible by variance, not a defect, just worth knowing the
  registry's own public method is one notch more permissive than the interface that consumes it.

### Verdict (delta)

- Recommendation: APPROVE
- Confidence: HIGH
- The Serious finding from the base review (file-size/split timing on `internal-query.service.ts`) is
  fully resolved via the facade-rule split. No new Blocking or Serious issues found in the fixes. The
  `'disposed'` governor state, the freeze-detection lag rule, the stale-generating-record ceiling and
  the skill-synthesis lane tightening are all correctly implemented, correctly tested with fake
  clocks/fake sources (no real timers introduced anywhere), and accurately documented in both CLAUDE.md
  files, cross-checked line by line. Two Minor items remain (an untested CLI disposal branch, a
  readonly/mutable variance note) — neither changes the verdict.
