# Code Logic Review — `TASK_2026_437_0778` Batch 16

Scope: `BackgroundWorkGovernor` core (`libs/backend/vscode-core/src/diagnostics/background-work-governor.ts`),
`EventLoopMonitor.onSample` addition, DI wiring in `register-platform-agnostic.ts` / `arm-diagnostics.ts` /
three hosts, `SessionTurnStateRegistry` foreground source (`libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts`

- `di/register.ts:427-442`), and gate admission in `internal-query.service.ts`. Read in full, alongside
  `implementation-plan.md` item 14 / INV-7 / AC-9, `batches.md` Batch 16/17/18, and both touched `CLAUDE.md`
  files. `ptah_get_diagnostics` was not used — this is a read-only review per the invocation; the evidence
  below is from direct code reading and the checked-in specs.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 4              |
| Failure modes found | 5              |

## Five logic questions

### 1. How does this fail silently?

- `libs/backend/agent-sdk/src/lib/skill-enhancer.service.ts:755-761` calls `this.internalQuery.execute({...})`
  with no `lane`. `resolveLane` (`internal-query.service.ts:109-112`) folds an absent lane to `'default'`,
  and `'default'` is by design never governed (`internal-query.service.ts:236`, `279`). The skill-enhancer
  call is invoked from `SkillCuratorService`'s periodic curation daemon (`skill-curator.service.ts:1-8`,
  `:663`) — a background pipeline, not a user action — so it silently defeats AC-9 for that call site while
  every dashboard signal (the degradation report, the `CLAUDE.md` doc) says background lanes are governed.
  Nothing errors; the call simply runs at the worst possible moment and nobody is told.
- A governor resolution failure inside `arm-diagnostics.ts:141-160` (`attachGovernor`) is caught and logged
  at `warn`, but that log line is easy to miss in a large boot log, and the failure mode it produces — the
  governor never learns about lag, so INV-7's lag half is permanently disabled for the process — looks
  identical to "no lag ever happened."

### 2. What user action produces unexpected behaviour?

- A user running the setup wizard, or invoking `chat:resume`/a harness LLM call, on the `default` lane can
  be queued behind the skill-enhancer's own `default`-lane call (see above): `DEFAULT_MAX_CONCURRENT_PER_LANE`
  is 1 (`internal-query.service.ts:88`), so the two contend for the same single slot. If the enhancer call
  is already in flight when the user's action queues, the user's call can wait the full
  `DEFAULT_QUEUE_TIMEOUT_MS` (60 s, `:99`) and then fail with `InternalQueryQueueTimeoutError` — a
  user-visible error whose root cause (an unrelated background daemon) is invisible from the wizard's or
  harness's own logs.
- A user who leaves a long agent turn "generating" and pins the memory curator / skill synthesis backlog
  behind it sees background lane work start anyway after ~10 minutes even though the turn is still running
  (the deferral ceiling, `background-work-governor.ts:142`, `internal-query.service.ts:359-370`) — documented
  and intentional (R-P7), but worth surfacing since it means "background yields to foreground" is a soft,
  time-bounded guarantee, not an absolute one.

### 3. What input data produces a wrong answer?

- A single, very large blocking synchronous burst (the exact freeze this feature exists to survive, per the
  file header of `background-work-governor.ts:6-13`) can produce **zero** `lagging` transitions. `EventLoopMonitor.sample()` is invoked from a `setInterval` callback
  (`event-loop-monitor.ts:168-173`), which cannot run while the loop is blocked. The delay histogram itself
  keeps recording during the block (native, off-JS-thread), but the _read_ is deferred until the loop frees
  up, and `sample()` resets the histogram unconditionally on every read (`:217`). So a total freeze followed
  by full recovery produces at most ONE post-freeze sample carrying the accumulated delay, then a second,
  now-quiet sample. `LAG_ENTER_WINDOWS` is 2 consecutive breaching windows (`background-work-governor.ts:125`),
  so a single freeze-then-recover event can never reach `lagging` — the enter streak gets to 1 and then resets
  to 0 on the next (post-recovery, quiet) sample. This is the worst-case scenario named in the class's own
  file header, and it is not handled: the governor's lag half only protects against _sustained_ partial
  lag (repeating breaches every 2 s), which is what actually happened in the 2026-09-14 incident the header
  cites, so the motivating case is covered — but the doc's confidence ("background work yields ... to
  measured lag") overstates what a single catastrophic stall gets. Worth a doc caveat at minimum.

### 4. What happens when a dependency fails?

- `SessionTurnStateRegistry.notifyGeneratingChange` (`session-turn-state.registry.ts:538-540`) calls every
  subscribed listener with **no try/catch**, unlike every other fan-out in this batch
  (`EventLoopMonitor.notify`, `event-loop-monitor.ts:241-255`, and `BackgroundWorkGovernor.notify`,
  `background-work-governor.ts:415-425`, both isolate listeners). The class's own doc
  (`session-turn-state.registry.ts:74`) says "A listener must not throw: ... The governor's listener is its
  own failure boundary" — true only because the CURRENT sole registered listener
  (`di/register.ts:437-441`, wrapping `refreshForeground`'s try/catch) happens to be safe. `notifyGeneratingChange`
  is called from `markGenerating`, `settleTurn`, `forceIdle`, `clear`, and `evictOldestRecord` — the turn
  state machine's hot path. A second consumer added later (there is nothing stopping one; `onGeneratingChange`
  is a public method) that throws would propagate out of `settleTurn`/`markGenerating` and abort the stream
  transformer's processing of a real turn. This is a latent correctness risk in a class explicitly designed
  around "never breaks the turn machine."
- `arm-diagnostics.ts`'s `attachGovernor` and `armWatchdog` both fail closed (logged, `null` returned) —
  correct pattern, consistent with the rest of the file.
- `internal-query.service.ts`'s governor is `{ isOptional: true }` (`:463-464`) and every governed read goes
  through `governorClear()` which treats `governor === null` as clear (`:387-389`) — correct fail-open.

### 5. What is missing that the requirements never mentioned?

- No time-based reaper for a `TurnRecord` stuck in `generating` (teardown never ran). The map is bounded by
  `TURN_RECORD_MAP_LIMIT` (256, LRU) and the file's own doc block (`:174-198`) explains the eviction argument
  in detail, but eviction only reaches a stuck record once 256 _other_ distinct session ids have been
  touched since — in normal single/few-tab desktop use that can be "never" for the life of the process. A
  stuck record means `hasGenerating()` returns `true` forever, so every background-lane call incurs the full
  `maxDeferMs` (10 min) wait before proceeding, on every call, indefinitely. AC-9's literal text ("0
  background-lane queries admitted until idle or 10 min") is still satisfied (each call _does_ eventually
  proceed), but INV-7's actual intent — background work resumes promptly once the foreground is idle — is
  permanently defeated for the life of the process. Nothing in the plan or this batch adds a stale-turn
  reaper (e.g., an age check inside `hasGenerating()` or a periodic sweep).
- No dedup on the deferral-ceiling log: `onDeferralCeiling` (`internal-query.service.ts:365`,
  wired at `:470-475`) logs once per **waiter**, not once per **lane**. Under sustained foreground busy with
  a backlog of several queued memory-curator/skill-synthesis calls, each one independently reaching the
  10-minute ceiling produces its own `warn` line — the "timeout once per lane" question the task raises is
  still open; the current behaviour is once-per-call.
- The governor's `dispose()` (`background-work-governor.ts:323-331`, explicitly designed to release pending
  `whenClear` waiters as `'clear'` on shutdown) is never called by any of the three hosts. Grepping
  `armDiagnostics` callers and the DI registration shows the returned `DiagnosticsHandle.dispose()`
  (`arm-diagnostics.ts:108-114`) only detaches the lag source and disposes the `EventLoopMonitor` — it does
  not resolve to the governor's own `dispose()`. So the shutdown behaviour this method exists for (item 6
  in the review brief) is unreachable in production; it is exercised only by the unit spec.

## Failure modes

### Background pipeline call bypasses the governor via the default lane

- Trigger: `SkillCuratorService`'s periodic pass calls `SkillEnhancerService.enhance`, which calls
  `internalQuery.execute()` without a `lane`.
- Symptom: the enhance call is admitted immediately regardless of foreground/lag state, and it can also
  block a genuinely user-initiated `default`-lane call behind it for up to `DEFAULT_QUEUE_TIMEOUT_MS`.
- Evidence: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:755-761` (no `lane`);
  `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:109-112,236,279` (default is
  ungoverned); `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts:1-8,663` (background caller).
- Current handling: none — the omission is silent; there is no lint or type-level requirement that a
  library's background call sites pass a lane.
- Recommendation: pass `lane: 'skill-synthesis'` (or a distinct `'skill-enhancer'` lane) at the call site;
  consider a narrower `IInternalQuery` type per library that pre-binds the lane, so a call site cannot
  omit it by accident (`lane-runner.service.ts:579` already does this correctly with
  `SKILL_SYNTHESIS_QUERY_LANE`).

### Total-freeze event never enters `lagging`

- Trigger: one very large synchronous block (seconds) followed by full recovery, sampled by
  `EventLoopMonitor` at a 2 s interval.
- Symptom: `BackgroundWorkGovernor` never transitions to `lagging` for that freeze; background work that
  was only gated on lag (not on a foreground turn) is never held back during or immediately after the
  worst stall.
- Evidence: `libs/backend/vscode-core/src/diagnostics/event-loop-monitor.ts:168-173,208-217` (sampling is
  `setInterval`-driven and cannot fire mid-block; histogram reset is unconditional per read);
  `libs/backend/vscode-core/src/diagnostics/background-work-governor.ts:122-125,359-366` (2 consecutive
  breaching windows required to enter).
- Current handling: none; not discussed in the plan beyond the hysteresis rationale for _sustained_ lag.
- Recommendation: decide explicitly whether this is acceptable (nothing can start new background work
  during an actual block anyway, so the residual risk is only the recovery window immediately after) and
  document it, rather than leaving the class doc's confident framing ("yields ... to measured lag")
  unqualified.

### `SessionTurnStateRegistry` listener fan-out is unguarded

- Trigger: any future `onGeneratingChange` subscriber that throws.
- Symptom: the exception propagates out of `markGenerating` / `settleTurn` / `forceIdle` / `clear` /
  `evictOldestRecord` — i.e., out of the stream transformer's turn-settlement call — potentially aborting
  processing of a real turn's terminal message.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:538-540` (no try/catch),
  contrasted with `event-loop-monitor.ts:241-255` and `background-work-governor.ts:415-425` (both isolate).
- Current handling: relies on convention ("a listener must not throw") plus the fact that today's one
  registered listener happens to be safe.
- Recommendation: wrap the loop in `notifyGeneratingChange` with the same isolate-and-log pattern used
  elsewhere in this same batch, for consistency and because the call sites are a genuine hot path.

### Stuck-generating record starves background work indefinitely

- Trigger: a turn record whose teardown never ran (the scenario the file's own eviction doc calls out) and
  a workspace with too few concurrent session ids to cycle it out of the 256-entry LRU map.
- Symptom: every background-lane call pays the full 10-minute deferral ceiling, forever, defeating INV-7's
  purpose while technically still satisfying AC-9's literal wording.
- Evidence: `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:174-198` (eviction
  argument, phase-blind by design); `background-work-governor.ts:142` (10-min ceiling is the only bound).
- Current handling: none; no age-based reaper.
- Recommendation: add a bound, e.g. treat a `generating` record older than some threshold (turn duration is
  already visible via `state.timestamp`) as not-busy in `hasGenerating()`, or log a warning distinguishing
  "stuck" from "long turn."

### Governor `dispose()` is unreachable in production

- Trigger: any host shutdown/deactivate path.
- Symptom: the shutdown semantics documented and unit-tested for `dispose()` (release pending waiters as
  `'clear'`) never run outside the spec; the governor singleton is torn down only partially (its lag source
  is detached by `armDiagnostics`'s handle, but the governor object itself, its foreground sources and any
  pending `whenClear` waiters are not released).
- Evidence: `libs/backend/vscode-core/src/diagnostics/arm-diagnostics.ts:107-117` (handle's `dispose` never
  calls `governor.dispose()`); no other caller of `TOKENS.BACKGROUND_WORK_GOVERNOR` found in
  `apps/*/src/di` or `libs/backend/vscode-core/src/di` outside the smoke specs.
- Current handling: the unref'd timers mean this is not a hang risk, so the omission is not itself
  dangerous — but the documented intent ("do background jobs start during app quit?") is simply not wired.
- Recommendation: either call `governor.dispose()` from the diagnostics handle's `dispose()`, or document
  explicitly that the governor's `dispose()` is spec-only today and state why that's acceptable (unref'd
  timers make it low-risk).

## Blocking issues

None. Nothing found causes data loss, corruption, or a security exposure; the worst failure modes above are
either bounded by an existing ceiling or are pre-existing behaviour this batch does not worsen.

## Serious issues

### `skill-enhancer.service.ts` background LLM call is ungoverned and can starve a real `default`-lane caller

- File: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:755-761`
- Scenario: the periodic curator daemon runs `enhance()` while a user is mid-wizard-step or harness LLM
  call also queued on `default` (per-lane limit 1).
- Impact: the user's own action can time out with `InternalQueryQueueTimeoutError` for a reason entirely
  invisible to them; separately, AC-9 is not actually true for every skill-synthesis LLM call, only the ones
  that remember to pass a lane.
- Fix: pass an explicit non-default lane at this call site (see Failure modes above).

### `SessionTurnStateRegistry.notifyGeneratingChange` has no listener isolation

- File: `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:538-540`
- Scenario: a second `onGeneratingChange` subscriber (nothing prevents one) throws.
- Impact: breaks `markGenerating`/`settleTurn`/`forceIdle`/`clear` — the turn state machine itself — for the
  live turn being processed at that moment.
- Fix: isolate the loop the same way `EventLoopMonitor.notify` and `BackgroundWorkGovernor.notify` do.

### Total-freeze events can bypass the lag half of the governor entirely

- File: `libs/backend/vscode-core/src/diagnostics/event-loop-monitor.ts:168-173,208-217`;
  `libs/backend/vscode-core/src/diagnostics/background-work-governor.ts:122-125`
- Scenario: one long synchronous block that ends cleanly.
- Impact: the class doc's stated guarantee ("background work yields ... to measured lag") does not hold for
  the single-worst-case freeze, only for sustained partial lag. Likely acceptable (nothing new can start
  mid-block anyway) but currently undocumented as a known limit.
- Fix: document the limit explicitly, or (if genuinely needed) add a "was recently blocked" latch fed by a
  timestamp gap check rather than relying purely on the 2-window hysteresis.

## Moderate and minor issues

- No dedup on the per-waiter deferral-ceiling log — `internal-query.service.ts:365`, `:470-475`. Under a
  sustained backlog this produces one `warn` line per queued call reaching the ceiling, not once per lane;
  flagged as an open question in the task brief and still open.
- New governor-gate specs in `internal-query.service.spec.ts:883-935` use real `setTimeout`/`wait()` with
  10-40 ms windows rather than a fake clock, in a repo whose own Batch 5 outcome already recorded a
  real-timer spec (`git-info.service.review.spec.ts`) timing out under parallel CI load. The
  `background-work-governor.spec.ts` file, by contrast, uses a full fake clock and is fully deterministic.
  Real-timer flakiness risk in the gate specs is small (short windows, `libuv` not blocked in a unit-test
  process) but is a known repo failure class.
- `BackgroundWorkGovernor` and `DegradationReporter` are both registered with tsyringe's module-level
  `instanceCachingFactory` (`register-platform-agnostic.ts:118-122,134-137`), which caches per-closure, not
  per-container (`instancePerContainerCachingFactory` is the per-container variant and is not used here).
  This matches the existing `DEGRADATION_REPORTER` convention one line above it, so it is not a new
  divergence introduced by this batch, but it does mean any future test or host that creates two containers
  from the same call to `registerVsCodeCorePlatformAgnostic`-adjacent code and expects two independent
  governors would get one shared instance. Worth a one-line comment noting the choice is deliberate (matches
  `DEGRADATION_REPORTER`), since a reader unfamiliar with the two tsyringe factory helpers could "fix" it
  into a regression.
- `handleGovernorChange` (`internal-query.service.ts:378-385`) re-arms every gated waiter's queue-timeout
  clock on every governor transition, which is correct, but does mean a governor that flaps between
  `foreground-busy`/`clear` rapidly (unlikely given the hysteresis, but the foreground half has none) could
  churn the whole waiter list on each flap; bounded by the number of queued waiters, so low risk in practice.

## Data flow

1. `EventLoopMonitor.start()` arms a 2 s `setInterval`, unref'd — OK, matches existing pattern.
2. Each window, `sample()` reads+resets the histogram and fans out to `sampleListeners` (new `onSample`)
   before the threshold test — OK; isolated per listener.
3. `armDiagnostics` wires the governor's `attachLagSource(monitor)` before `monitor.start()` — OK, so no
   window is missed; on failure, falls back to a null detacher and logs — OK.
4. `BackgroundWorkGovernor.handleSample` accumulates enter/exit streaks and calls `recompute()` — OK, but see
   the total-freeze gap above (question 3 / Serious issue 3).
5. agent-sdk `di/register.ts:434-441` wraps `SessionTurnStateRegistry` as a `ForegroundActivitySource`,
   guarded by `isRegistered(..., true)` — OK, registration order is verified across all three hosts
   (`phase-1-infra.ts` before `phase-2-libraries.ts` in Electron/VS Code; explicit ordering in
   `cli-engine/container.ts:391,598`).
6. `SessionTurnStateRegistry.markGenerating`/`settleTurn`/`forceIdle`/`clear`/`evictOldestRecord` call
   `notifyGeneratingChange` — gap: no listener isolation (Serious issue above).
7. `InternalQueryService.acquireSlot` resolves the lane, reports "ungoverned" once per process if
   applicable, and calls `gate.acquire()` — OK; the `'default'` shortcut is correct in principle, but is
   fed a background call it should not receive (Serious issue above).
8. `InternalQueryConcurrencyGate.acquire`/`drain`/`handleGovernorChange` implement the third admission term
   correctly for whatever lane IS passed — OK, well covered by both real-governor and fake-signal specs.
9. On shutdown: nothing calls `BackgroundWorkGovernor.dispose()` — gap (Moderate/Serious per host risk
   tolerance; not blocking because unref'd timers make it low-risk rather than a hang).

## Requirements fulfilment

| Requirement                                                                       | Status   | Gap                                                                                                       |
| --------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| State machine `clear \| foreground-busy \| lagging` with the specified hysteresis | COMPLETE | Total-freeze edge case not handled/documented (see above)                                                 |
| `whenClear` with ceiling, abort, lane-tagged log                                  | COMPLETE | None found                                                                                                |
| `EventLoopMonitor.onSample`                                                       | COMPLETE | None found                                                                                                |
| Foreground source over `SessionTurnStateRegistry`                                 | COMPLETE | Listener fan-out unguarded (Serious)                                                                      |
| Gate admission for background lanes, default never gated                          | PARTIAL  | `default` is correctly never gated, but a background call (skill-enhancer) incorrectly lands on `default` |
| Governor resolution failure → always clear + one degradation                      | COMPLETE | Verified by spec `reports the missing governor exactly once`                                              |
| DI registration in all three hosts, registration order                            | COMPLETE | Verified via `phase-1-infra.ts`/`phase-2-libraries.ts`/`cli-engine/container.ts` ordering                 |
| CLI without `--verbose` → foreground-only                                         | COMPLETE | Confirmed via `container.smoke.spec.ts` (bound on every boot)                                             |

Implicit requirements not addressed: a bound on a `generating` record stuck by a dead teardown (starves
background work far longer than any turn realistically runs); wiring the governor's own `dispose()` into an
actual host shutdown path.

## Edge cases

| Case                                                    | Handled | How                                                                                                   | Concern                                                                                          |
| ------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sustained partial lag (the 2026-09-14 incident)         | YES     | 2-window enter / 3-window exit hysteresis                                                             | None — this is the case the design targets                                                       |
| Single catastrophic freeze, clean recovery              | NO      | Sampling cannot observe mid-block; single post-freeze sample rarely satisfies the 2-window enter rule | Documented residual risk, not called out in code                                                 |
| Foreground busy for hours (long turn)                   | YES     | `whenClear` ceiling (10 min) bounds each wait                                                         | Every background call still pays the full ceiling every time until idle — expected, not a bug    |
| Record stuck in `generating` forever                    | PARTIAL | LRU eviction eventually clears it                                                                     | Requires 256 other distinct session ids to cycle through; can be "never" in light single-tab use |
| Governor throws from a foreground source                | YES     | try/catch in `refreshForeground`, treated as idle                                                     | None                                                                                             |
| Governor `onChange`/turn-registry listener throws       | PARTIAL | `BackgroundWorkGovernor.notify` isolates; `SessionTurnStateRegistry.notifyGeneratingChange` does not  | Real gap for future subscribers                                                                  |
| Background call omits `lane`                            | NO      | Silently resolves to `'default'`, ungoverned                                                          | Exactly what happens in `skill-enhancer.service.ts`                                              |
| Abort while queued (gate and governor)                  | YES     | Both `whenClear` and `acquire` remove the waiter and its timers on abort                              | None                                                                                             |
| App/extension shutdown with pending `whenClear` waiters | PARTIAL | `dispose()` exists and is spec-tested                                                                 | Never invoked by any host in this batch                                                          |
| Governor caching factory across multiple containers     | PARTIAL | Module-level cache (matches `DEGRADATION_REPORTER` precedent)                                         | Undocumented as deliberate; could be "fixed" by a future reader into a real bug                  |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a background LLM call (`skill-enhancer.service.ts`) silently lands on the ungoverned `default`
  lane, which both defeats AC-9 for that call site and can produce a user-visible queue-timeout error on an
  unrelated foreground action sharing that lane.
- What a robust implementation would add: (1) an explicit non-default lane at every skill-synthesis call
  site, ideally enforced by a narrower injected type so omission is a compile error, not a runtime default;
  (2) try/catch isolation in `SessionTurnStateRegistry.notifyGeneratingChange`, matching the pattern already
  used in the same batch's other two listener fan-outs; (3) a documented (or code-level) bound on how long a
  `generating` record may starve background work when its teardown never ran; (4) either wiring
  `governor.dispose()` into a real shutdown path or documenting why it is intentionally spec-only; (5) a
  one-line comment on the `instanceCachingFactory` choice for the governor, since it is easy to mistake for a
  bug next to `instancePerContainerCachingFactory`'s existence in the same package.

---

## Delta review (review fixes)

Scope: the nine fixes claimed against the base review, verified directly on disk in
`D:\projects\ptah-437` (read-only; no `nx` runs). Every file below was read in full or in the
relevant range; nothing here is taken from the executor's own report without independent
confirmation.

### 0. Gate extraction — CONFIRMED, clean move

`internal-query-concurrency-gate.ts` (450 lines) is `InternalQueryConcurrencyGate` moved out
verbatim plus the two new behaviours (shutdown, ceiling dedup — items 5 and 6 below).
`internal-query.service.ts` (305 lines) imports it (`:24-25`) and still constructs the one
instance (`:74`) — the facade rule is honoured: the service keeps its name, token and methods.
The old real-timer gate describe block that lived in `internal-query.service.spec.ts` is gone
from that file entirely (only one unrelated `setTimeout(resolve, 0)` remains, `:267`); it now
lives in `internal-query-concurrency-gate.spec.ts` on fake timers (item 7). No behavioural diff
found beyond the two new fixes.

### 1. Lane fix — CONFIRMED, closes the Serious finding from the base review

`skill-enhancer.service.ts:371` now passes `options.manual ? USER_INITIATED_QUERY_LANE :
SKILL_SYNTHESIS_QUERY_LANE` into `generateCandidate`, which forwards it to `execute()` at `:769`
as `lane`. `internal-query.interface.ts:31` defines `USER_INITIATED_QUERY_LANE = 'default'`
mirroring agent-sdk's own constant (documented as deliberate, since this library cannot import
agent-sdk), and `:90` makes `lane` a **required** field on `IInternalQuery.execute`'s config —
so a future call site omitting it is a compile error, not a silent default. This is exactly the
fix the base review recommended. Call-site table confirmed by direct grep: `lane-runner.service.ts:579`
hardcodes `SKILL_SYNTHESIS_QUERY_LANE` for every lane the runner drives (judge, curator's
synthesis pass, synthesizer, archaeologist, replay-validator, trigger-eval, candidate-namer all
go through it); `curator-job-queue.ts`'s one call site is tagged `lane: 'memory-curator'`
(unchanged, already correct pre-fix). No other `internalQuery.execute()` / `IInternalQuery.execute()`
call site without a lane was found in `libs/backend/skill-synthesis` or `libs/backend/memory-curator`.

### 2. Registry listener isolation — CONFIRMED

`session-turn-state.registry.ts:559-568` (`notifyGeneratingChange`) now wraps the listener call
in `try { listener(); } catch { /* degradation-audit: optional-capability ... */ }` — an empty
catch with a marker comment, matching the repository's `degradation-audit` convention and closing
the Serious finding from the base review (this was previously the one fan-out in the batch without
isolation).

### 3. Freeze detection — CONFIRMED, and the judge questions are answered by the code itself

Two independent, complementary fixes, both directly inspected:

- `background-work-governor.ts:140-152` adds `LAG_FREEZE_MAX_MS = 1_000`: `handleSample` (`:421-434`)
  now enters `lagging` on a **single** window whose `maxMs >= 1000`, in addition to the existing
  2-window p99 rule. This directly answers the base review's "total freeze never enters `lagging`"
  finding — but only if the freeze is actually _visible_ in a sample, which is fix (3b)'s job.
- `event-loop-monitor.ts:208-232` (`sample()`) now computes `maxMs = max(toMs(histogram.max),
roundMs(lateMs))`, where `lateMs = now - lastSampleAt - sampleIntervalMs` — the sampler's own
  tick lateness. The doc block at `:203-227` states the executor's own measurement (Node 24.15: a
  1.5 s and a 5 s block starting within one histogram resolution window after `reset()` left
  `histogram.max` at 0-33 ms) and names the residual gap explicitly (a block shorter than one
  interval that both starts inside that ~20 ms post-reset slot and ends before the next tick is
  seen by neither signal).

Judging the four sub-questions:

- **Is tick lateness a correct freeze measure?** Yes for its stated purpose. `performance.now()`
  read from a JS callback correctly captures "how late did this callback actually run," which is
  exactly what a synchronous block produces, independent of whatever the histogram observed in the
  same window. Combining the two with `Math.max` is the right operator — either signal seeing the
  freeze is enough to report it, and neither signal is trusted alone.
- **Timer drift / Windows coalescing** — not a false-positive risk at this threshold: ordinary
  Windows timer coalescing and `setInterval` scheduling jitter run tens of milliseconds at most in
  the applicable power states, two orders of magnitude under `LAG_FREEZE_MAX_MS` (1000 ms) and
  still under the 250 ms default `warnThresholdMs` used for the ordinary lag log. No evidence found
  of a plausible jitter source in this stack reaching 1 s.
- **`unref()`** — the sampler was already `unref()`-ed before this fix and remains so; tick lateness
  is computed from wall-clock deltas between actual callback firings, not from the timer's own
  scheduling metadata, so `unref()` has no interaction with the measurement's correctness.
- **System sleep** — the code's own doc admits it plainly: a real suspend/resume also makes the
  first post-resume tick "late," so it reads as one freeze-triggered `lagging` entry, held for the
  existing 3-window (6 s) exit hysteresis. This is an acceptable, self-correcting cost: the
  consequence is background work is deferred a few extra seconds after the machine wakes up, not a
  wrong answer or a stuck state — and erring toward "let things settle after a resume" is the safer
  side to be wrong on. No change needed; the trade-off is honestly documented rather than hidden.

This fix set adequately closes the base review's Serious freeze-detection finding, with the
residual (sub-interval blocks landing exactly in the post-reset window) both real and explicitly
acknowledged rather than silently left in the original.

### 4. `generatingSessions()` + `TurnStateForegroundSource` — CONFIRMED, closes the stale-generating Serious finding, with one accepted trade-off

`session-turn-state.registry.ts:289-297` (`generatingSessions()`) returns `{ sessionId, since }`
per generating record, `since` being `record.state.timestamp` — confirmed by the doc comment at
`:285-287` and by the code itself that nothing re-commits a `generating` record between its start
and its settlement (`applySnapshot` refuses to touch a `generating` record, `:369-371` in the
pre-delta file; `rekey` carries the state object over rather than re-timestamping it). So **`since`
is the turn's start time, not last-activity** — confirming the coordinator's second reading, not
the first.

`turn-state-foreground-source.ts` is new and well-built: `STALE_GENERATING_CEILING_MS = 60 *
60_000` (`:30`), one warn per `sessionId@since` de-duplicated via a `warnedStale` set that self-prunes
when the record settles or is evicted (`:88-105`), an `unref()`-ed timer armed for the
earliest stale deadline and only while at least one listener is subscribed (`armStaleTimer`,
`:127-137`, cleared in the `onForegroundChange` unsubscribe path at `:118-124`), and its own
`notify()` isolates listeners with try/catch (`:143-153`) — consistent with fix 2. Wired correctly
at `di/register.ts:436-441` as the governor's sole `ForegroundActivitySource`, replacing the raw
`hasGenerating()`/`onGeneratingChange` closure the base review read.

Judging the "is turn-start-not-last-activity acceptable" question: yes, with one caveat worth a
one-line doc addition. The 60-minute ceiling is generous against any turn this codebase's own
stall/timeout machinery would let run (no evidence of an explicit multi-hour turn budget was found
in `libs/backend/agent-sdk/src/lib`, but the class doc's claim that "the SDK's own stall handling
ends a dead one well before this" was not independently verified in this pass — flagged as
Moderate, not Serious, because the failure mode if the claim is wrong is soft: a legitimately
active 61-minute-plus turn merely stops holding background work back a little early, which is a
performance regression for that one turn, not a correctness break, a data-loss risk, or a repeat of
the stale-forever bug this fix exists to close. Recommend either citing the actual mechanism that
bounds real turn length, or softening the class doc's "far past any real turn" claim to acknowledge
it is a chosen ceiling rather than a proven one.

### 5. Shutdown wiring — CONFIRMED, closes the "dispose is unreachable" finding

- `background-work-governor.ts` gained a real `'disposed'` state (`:68-72`), a terminal `dispose()`
  (`:366-383`) that detaches every source, rejects every pending `whenClear` waiter with
  `AbortError` (not `'clear'` — the base review's own recommendation), notifies listeners
  `'disposed'` **before** clearing them, and guards every other public method (`onChange`,
  `whenClear`, `addForegroundSource`, `attachLagSource`, `recompute`) to no-op once disposed.
- `arm-diagnostics.ts`'s `attachGovernor` (`:134-165`) now returns `governor.dispose` as the
  handle's disposer (`dispose = () => governor.dispose()`, folded into `unsubscribers`), and the
  function's own doc states the handle's `dispose()` is the shutdown path in all three hosts. This
  directly fixes the "governor.dispose() is unreachable in production" finding.
- `cli-engine/src/lib/container.ts:411-427` covers the CLI's non-`--verbose` boot, where
  `armDiagnostics` never runs: it constructs a synthetic diagnostics handle whose `dispose()`
  lazily resolves `TOKENS.BACKGROUND_WORK_GOVERNOR` and disposes it, and `:282` confirms
  `CliDIContainer._diagnostics?.dispose()` is actually invoked on teardown.
- Gate side: `internal-query-concurrency-gate.ts` subscribes to `governor.onChange` and branches
  on `state === 'disposed'` (`:211-214`) into `handleGovernorDisposed()` (`:381-386`), which cancels
  every currently-queued **gated** waiter with an `AbortError` and sets `governorDisposed = true` so
  a later governed `acquire()` rejects immediately (`:262-265`). `default`-lane callers are
  unaffected, matching the design note.

Checked the two specific risks the coordinator raised:

- **Do background callers handle the shutdown `AbortError` without error-level logging or
  degradation noise?** Traced representative call sites: `skill-curator.service.ts:262-268` wraps
  `laneRunner.run()` in try/catch and logs at `warn` ("lane call threw") before returning an empty
  report on ANY thrown error, not just abort — this is the pre-existing, repo-wide pattern (also
  seen in `sdk-internal-query.curator-llm.ts`, all `warn`, no `error`). One path deserves a closer
  look: `lane-runner.service.ts`'s `callOnce` (`:634-637`) only classifies a caught error as
  `{ kind: 'cancelled' }` when **its own** local `controller.signal.aborted` is true; the
  gate/governor's shutdown `AbortError` is a _different_ signal (rejected from
  `internalQuery.execute()` before any local controller involvement), so it does not match that
  check and instead re-throws. That re-thrown error is still caught one level up by every
  `laneRunner.run()` caller inspected (`skill-curator.service.ts`, and by the same generic
  try/catch-and-`warn` shape used by `skill-judge.service.ts`, `skill-synthesizer.service.ts`) so
  the end result is a `warn`-level "lane call threw" log, not an `error` or a degradation report —
  acceptable, but the log message does not distinguish "cancelled for shutdown" from "a real
  transport fault," which is a minor observability gap worth a one-line fix (check `error.name ===
'AbortError'` in `callOnce`'s catch alongside the local-signal check) rather than a correctness
  problem.
- **Can `'disposed'` break an exhaustive switch or another `onChange` consumer?** No other
  `BackgroundWorkState` consumer exists yet in the codebase beyond the gate (grepped
  `BackgroundWorkState` across `libs` and `apps`: only type re-exports in
  `vscode-core/src/{index,diagnostics/index}.ts` besides the governor and the gate itself). Batch
  17's adopters (symbol indexer, refresh coalescer, backup/file-index, editor detection) do not
  exist on disk yet, so there is nothing today for the new state to break. This is a real forward
  risk to flag for Batch 17's authors — an adopter that switches on `BackgroundWorkState` without a
  `default`/`disposed` arm would silently mis-handle shutdown — but it is not a defect in this
  batch.

### 6. Ceiling log dedup — CONFIRMED, both places

- `internal-query-concurrency-gate.ts`: `ceilingReportedLanes` (`:201`) gates `onDeferralCeiling`
  per lane (`:353-356`), cleared when the governor clears (`handleGovernorChange`, `:371`) — so the
  dedup window is "one deferral episode," matching the option doc at `:118-122` ("once per lane per
  deferral episode; an episode ends when the governor clears").
- `background-work-governor.ts`: `ceilingLoggedLanes` (`:221`) gates `logCeilingOnce` (`:389-397`)
  the same way, cleared in `recompute()` when the state returns to `clear` (`:467-469`) and again on
  `dispose()` (`:382`).

Both closes the base review's "no dedup on the ceiling log" Moderate finding. Verified the episode
boundary is the same concept in both places (state returns to `clear`), so the two logs — the
gate's own `onDeferralCeiling` callback (wired to `logger.warn` in `internal-query.service.ts`) and
the governor's internal `whenClear` ceiling log — cannot double-count within one episode, though they
remain two separate call sites that can each log once per episode (by design: one is the gate's
per-lane admission ceiling, the other is `whenClear`'s own caller-supplied lane tag; a caller using
both paths in the same episode would still see two lines, one from each mechanism — a corner case,
not a regression from this fix).

### 7. Fake timers in the new gate spec — CONFIRMED

`internal-query-concurrency-gate.spec.ts:187-191` states the rule ("Jest fake timers drive every
ceiling, so no case depends on real time") and uses `jest.useFakeTimers()` +
`jest.advanceTimersByTimeAsync(...)` throughout (`:230,305,308,329,340,376,397,401,423`). This
closes the base review's Moderate flakiness finding — the real-`setTimeout` 10-40 ms waits from the
old `internal-query.service.spec.ts` governor-gate tests are gone, not merely duplicated
(confirmed above under item 0).

### 8. Comments

Spot-checked throughout the above; documentation is accurate to the code in every file read for
this delta (no stale doc found describing pre-fix behaviour).

### Known open item — confirmed accurate, no additional path found

Verified the five call sites the orchestrator names are real and unaddressed as of this diff:
`skills-synthesis-rpc.handlers.ts` — `promote` (`:442-450`, calling `this.synthesis.promote(id)`),
`promoteBulk` (`:1656-1666`), `runManual` (`:653`, on the curator's `laneRunner.run({ laneId:
'synthesis', ... })` path), and `digest` (`:1849-1878`, whose doc block itself states "the sweep's
one LLM call runs on the `synthesis` lane with no budget gate underneath it"); and
`memory-rpc.handlers.ts` — `memory:runNow` (registered `:124`, handler `:594+`). All five ultimately
reach either `LaneRunnerService.run()` (which hardcodes `lane: SKILL_SYNTHESIS_QUERY_LANE` at
`lane-runner.service.ts:579` for every caller, manual or not) or the memory curator's own
governed path, with no `manual`/`userInitiated` flag threaded through today — confirmed by grep,
no `userInitiated` field exists anywhere in `libs/backend/rpc-handlers` or
`libs/backend/skill-synthesis` yet. No RPC handler was found calling `laneRunner`,
`SkillJudgeService`, or `internalQuery` directly (they all go through a service layer), and no
additional user-initiated-but-governed path was found beyond the five named. The orchestrator's
plan (an explicit optional `userInitiated` field set by these RPC handlers, Batch 16b) is the right
shape for the fix and nothing here contradicts it.

### Delta verdict

- Assessment: **APPROVE**
- Confidence: HIGH
- All three Serious findings from the base review (skill-enhancer on the ungoverned default lane,
  unisolated registry listener fan-out, total-freeze detection gap) and the base review's four
  Moderate findings (no per-lane ceiling dedup, real-timer gate specs, stuck-generating starvation,
  unreachable governor `dispose()`) are directly and correctly fixed on disk, each verified by
  reading the actual diff rather than trusting the executor's description.
- Residual, non-blocking items for a future pass: (a) `lane-runner.service.ts:634-637`'s
  `callOnce` catch does not recognize a governor-shutdown `AbortError` as `'cancelled'` the way it
  recognizes its own local abort, producing a slightly less precise (but still `warn`-level, still
  harmless) log line at quit; (b) the "far past any real turn" claim behind the 60-minute stale
  ceiling in `turn-state-foreground-source.ts` is asserted, not derived from a cited turn-length
  bound elsewhere in agent-sdk; (c) `BackgroundWorkState`'s new `'disposed'` member has no consumer
  yet to break, but Batch 17's adopters should be written with it in mind from the start.
- Top remaining risk: none blocking. The `'disposed'`-unaware-adopter risk in (c) is the one worth
  carrying forward into Batch 17's own review.
