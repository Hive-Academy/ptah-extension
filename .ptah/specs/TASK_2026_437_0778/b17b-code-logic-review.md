# Code Logic Review — `TASK_2026_437_0778` Batch 17b

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

Scope reviewed (uncommitted diff, `D:\projects\ptah-437`): `libs/backend/skill-synthesis/src/lib/{skill-repropagation.port.ts, skill-promotion.service.ts, skill-enhancer.service.ts}` (+ their specs, and `skill-curator.service.spec.ts` / `skill-invocation-tracker.spec.ts` as touched-but-not-changed-production-code specs); `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (+ spec); `libs/backend/harness-sync/src/lib/{propagation/harness-propagation.service.ts, sources/user-layer-refresher.port.ts}` (+ spec); `apps/ptah-electron/src/activation/{skill-repropagation.ts, plugin-activation.ts}` (+ specs); `apps/ptah-electron/CLAUDE.md`. Read the full, not-just-diffed, bodies of `skill-curator.service.ts`, `skill-promotion.service.ts`, `skill-enhancer.service.ts`, `plugin-activation.ts` and `coalesced-job.ts` to trace every caller of `SkillRepropagationPort.repropagate` end to end. `CliSkillRepropagation` (3-param, ignores origin) confirmed unchanged and out of scope by design; VS Code's `NoOpSkillRepropagation` confirmed unchanged.

## Five logic questions

### 1. How does this fail silently?

- **`acceptSuggestion` (`skillSynthesis:acceptSuggestion`, a literal user click) never reaches `SkillRepropagationPort` at all** — `skill-curator.service.ts:524-578` materializes a promoted `SKILL.md` and upserts the registry row directly, with no call to `this.repropagation`. The RPC resolves successfully (`{ accepted: true, filePath }`), so the click reads as done, but the harness surfaces (`.claude/skills` and the rival-CLI mirrors) are not refreshed until the next unrelated activation/propagation. This is a pre-existing gap (confirmed absent in `HEAD`'s copy of the file, not introduced by this diff), but the task explicitly named "curator suggestion accept" as a click path to verify for this batch, and it is still unaddressed — a user who accepts a suggestion and immediately opens a Claude/Codex session in the same workspace will not see the new skill.
- **A governor-defect (non-`AbortError`) rejection during a background skill re-propagation's user-layer wait is still swallowed as `console.warn` + fail-open** (`plugin-activation.ts:184-219`, unchanged by this batch) — consistent with the rest of the codebase per the Batch 17 delta review, so not a new defect, but worth restating: the caller (`emitRepropagation`/`repropagate`) already treats any repropagation failure as non-fatal (`skill-promotion.service.ts:356-360`, `skill-enhancer.service.ts:740-745`), so two independent "swallow and continue" layers stack here with only a `warn`/`debug` log between them and silence.

### 2. What user action produces unexpected behaviour?

- **Clicking "run curator now" (`skillSynthesis:runCurator`) can still take much longer than a single click implies**, because `userInitiated: true` on `runManual` only skips the governor wait for the _harness refresh_ step — it does not change `ENHANCE_MAX_SLUGS_PER_PASS` (3) or make the enhancement loop concurrent. If the workspace has 3 enhancement-eligible candidates, the manual run still walks all 3 sequentially (each a real LLM judge call plus a directory-walk repropagation), same as before this batch; that part is unchanged and not a regression, but see Serious #1 for the _background_ version of this same loop, which the batch does materially worsen.
- **Accepting a curator suggestion looks identical whether or not the new skill actually reached the harness** (#1 above) — the RPC's `{ accepted: true }` gives no signal either way.

### 3. What input data produces a wrong answer rather than an error?

- No input-shape defect found in the reviewed diff. `origin` is consistently an optional `QueryOrigin` (`{ userInitiated?: boolean }`) threaded as a plain parameter, never read off a mutable field, so no input can corrupt a sibling call's origin (see Data flow #3).

### 4. What happens when a dependency fails?

- **`BackgroundWorkGovernor.whenClear()` rejecting with anything other than `AbortError`**: verified unchanged from the Batch 17 delta-reviewed state — `plugin-activation.ts:184-219` warns once and fails open (runs the pass). This batch adds a new _governed_ reason (`skill-repropagation`) to the same gate, so it inherits that already-reviewed discipline for free; no new failure-mode surface introduced here.
- **`HarnessPropagationService.propagate` itself throwing**: `ElectronSkillRepropagation.repropagate` (`skill-repropagation.ts:59-92`) still wraps the whole body in `try/catch`, logs a `warn`, and returns — unaffected by the origin change, still non-fatal, still consistent with the "residency change is already committed" contract in `skill-promotion.service.ts:330-335`.

### 5. What is missing that the requirements never mentioned?

- No mechanism limits how long a _background_ enhancement pass can be held in aggregate across several candidates in one curator pass — the per-candidate 10-minute governor ceiling was designed (Batch 17) for one independent unit each, not for a tight sequential loop over up to 3 units per pass that now each can independently pay that ceiling (Serious #1).
- No decision recorded anywhere in `batches.md`/`context.md` about whether `acceptSuggestion` was deliberately left out of the origin-threading work or simply not traced — Batch 17b's own task description names `skill-enhancer.service.ts` and `skill-promotion.service.ts` as "direct callers" and does not mention `skill-curator.service.ts`'s `acceptSuggestion`, so this reads as an oversight in scoping rather than a deliberate exclusion.

## Failure modes

### Curator background pass can serialize N × 10 minutes behind the governor

- Trigger: the curator interval fires `runPass` → `runEnhancementPass` (`skill-curator.service.ts:640-690`) with no `origin.userInitiated`, and the workspace has 2-3 enhancement-eligible candidates while the main loop is lagging or a turn is generating for the whole window.
- Symptom: `runEnhancementPass`'s `for` loop `await`s `this.enhancer.enhance(...)` per candidate (`:681-684`); `enhance` → `applyProposal` → `repropagate` → `ElectronSkillRepropagation.repropagate` (no `userInitiated`) → `HarnessPropagationService.propagate(..., { userLayerRefreshReason: 'skill-repropagation' })` → `admitUserLayerPass` gated by the governor, ceiling `DEFAULT_MAX_DEFER_MS` = 600,000 ms. With `ENHANCE_MAX_SLUGS_PER_PASS = 3` (`skill-curator.service.ts:88`), a pass that stays governed for every candidate can take up to 30 minutes to clear `runEnhancementPass` alone, before `runSuggestionPass` (also awaited in the same `runPass`, `:233,341`) even starts.
- Evidence: `skill-curator.service.ts:88,640-690`; `skill-enhancer.service.ts:590-624,692-745`; `plugin-activation.ts:184-219` (10-min ceiling); no test in this batch's diff exercises more than one candidate's repropagation being held at once, so this compounding is unverified by any spec.
- Current handling: none — no fan-out, no fire-and-forget, no per-pass time budget distinct from the per-call governor ceiling.
- Recommendation: either (a) have the curator loop enqueue the repropagation without awaiting its user-layer refresh (fire it and let the coalescer serialize the actual directory work, while `runEnhancementPass` moves on to the next candidate and to `runSuggestionPass`), or (b) cap the aggregate wait for one curator pass (e.g., a single shared `AbortSignal`/deadline across all candidates in the loop) so one lagging main loop cannot turn a periodic curator tick into a multi-candidate pile-up. Given `runPass` is fire-and-forget from `setInterval` (`:186-192`, no overlap guard), a pass this long also raises the odds of the next scheduled tick starting while the previous one is still mid-loop — a pre-existing absence of an overlap guard that this change makes materially more likely to matter.

### `acceptSuggestion` click never repropagates

- Trigger: a user calls `skillSynthesis:acceptSuggestion` on a pending curator suggestion.
- Symptom: the skill is materialized on disk and registered in `skill_registry`, but nothing tells `HarnessPropagationService`/`IUserLayerRefresher` a new user-layer source exists, so `.claude/skills` (and the rival-CLI mirrors) do not see it until an unrelated propagation happens to run.
- Evidence: `skill-curator.service.ts:524-578` (no `this.repropagation` reference anywhere in the method or the file, confirmed via `git show HEAD:...| grep repropagat` returning nothing); `skills-synthesis-rpc.handlers.ts:1544-1562` (the RPC handler passes no origin and does not call any repropagation port either).
- Current handling: none. Pre-existing (not introduced by this diff), but within this batch's own stated completeness scope.
- Recommendation: either wire `acceptSuggestion` through `SkillRepropagationPort.repropagate('skill', slug, workspaceRoot, { userInitiated: true })` (it is a click, so it should never wait), or record an explicit, reviewed decision that suggestion-accept intentionally defers to the next activation and say why (e.g., "acceptance is rare enough that a stale harness until next boot is acceptable") so the gap is a decision, not a blind spot.

### Two independent non-fatal layers around a background repropagation failure

- Trigger: `HarnessPropagationService.propagate` throws or the governor wait rejects unexpectedly during an auto-enhance/auto-promote.
- Symptom: a residency change (promotion/demotion) or an enhancement is committed to the store but the harness copy silently lags; the only trace is a `warn` at the promotion/enhancer layer (`skill-promotion.service.ts:356-360`, `skill-enhancer.service.ts:740-745`) and, one layer further down, another independent `warn`/`debug` inside `plugin-activation.ts`/`ElectronSkillRepropagation` — nothing correlates them or surfaces a retry.
- Evidence: `skill-promotion.service.ts:330-360`, `skill-enhancer.service.ts:731-747`.
- Current handling: fail-open at every layer, by design (documented rationale: "residency change is still committed"). Acceptable as a deliberate degradation, but there is no metric/counter distinguishing "repropagation deferred, will heal at next activation" from "repropagation actually failed" — both look identical in the logs.
- Recommendation: not blocking for this batch; worth a follow-up to at least tag the warn with whether the cause was a governed timeout (self-healing at next activation) vs. a real propagation error (needs attention).

## Blocking issues

None found. The origin-threading itself is complete, correctly typed, uses non-shifting default parameters (`origin: QueryOrigin = {}` always added as the LAST positional parameter, verified against every call site below), and is not stored on any service instance, so no cross-request leakage is possible.

## Serious issues

### Background enhancement pass can serialize multiple 10-minute governor waits inside one curator tick

- File: `libs/backend/skill-synthesis/src/lib/skill-curator.service.ts:88,640-690`
- Scenario: the periodic curator interval selects 2-3 enhancement-eligible candidates while the app stays busy/lagging for most of the interval.
- Impact: what was designed as "one background unit waits up to 10 minutes" (Batch 17's own contract) becomes "up to 3 background units wait up to 10 minutes each, sequentially, inside one pass" for this specific caller, because the loop `await`s each candidate's full enhance-and-repropagate chain before starting the next. This is a genuine widening of INV-7's intended blast radius introduced by wiring the governor into a tight loop that Batch 17b did not itself write but did newly gate.
- Fix: see "Failure modes" above — decouple the per-candidate repropagation wait from the loop that selects the next candidate, or bound the pass's total governed time.

## Moderate and minor issues

- `acceptSuggestion` (`skillSynthesis:acceptSuggestion`) never calls `SkillRepropagationPort.repropagate` — pre-existing, but left unaddressed despite being named in this batch's own completeness scope (Moderate; `skill-curator.service.ts:524-578`).
- No spec in this diff exercises more than one candidate's repropagation being deferred in the same `runEnhancementPass`/`runPass` invocation, so the compounding described in the Serious issue above is unverified, not just unfixed (Minor, test-coverage).
- The Electron end-to-end specs (`plugin-activation.spec.ts:802-928`) use a hand-rolled fake `propagation.propagate` that forwards `userLayerRefreshReason` to the REAL `refresh()`/gate/coalescer; the actual label-forwarding through the real `HarnessPropagationService.propagate` is pinned separately in `harness-propagation.service.spec.ts:77-98`. No single test exercises the real `HarnessPropagationService` wired to the real Electron gate together — acceptable as a boundary split (each half is genuinely covered), but worth naming as the one seam with no full integration test (Minor).

## Data flow

1. **Click paths** (`promote`, `promoteBulk`, `enhanceNow`, `applyProposal`, `revertEnhancement`) — RPC handler sets `{ userInitiated: true }` literally, never from parsed/Zod-validated params (`skills-synthesis-rpc.handlers.ts:452-453,1039,1091,1136,1228,1684-1685`) — OK, matches the Batch 16b rule exactly.
2. `promote`/`promoteBulk` → `SkillSynthesisService.promote`/`promoteBulk` → `SkillPromotionService.evaluate(candidateId, settings, nowFn, origin)` (`skill-synthesis.service.ts:1213-1219,1257-1275`) — OK, origin passed positionally at the position that has existed since Batch 16b; no shift.
3. `evaluate` → `emitRepropagation([demotedSlug, candidate.name], origin)` (`skill-promotion.service.ts:344,348`) — NEW this batch — OK, `origin` is the same local parameter `evaluate` received, not a field.
4. `emitRepropagation` → `this.repropagation.repropagate('skill', slug, workspaceRoot, origin)` (`:348-353`) — OK, per-slug loop, each iteration reuses the same `origin` value (correct: one promotion's demotion+promotion share one cause).
5. `applyProposal`/`revert`/`enhance` (enhancer) → private `repropagate(slug, kind, origin)` → `this.repropagation.repropagate(kind, slug, cwd, origin)` (`skill-enhancer.service.ts:563,707,738-743`) — OK, `origin` parameter is mandatory (no default) on the private method, forcing every one of its 2 call sites to state it explicitly; the public methods default it to `{}` — correct choice, since a caller that forgets to pass anything is background, the safe default.
6. `SkillInvocationTracker.recordInvocation` → `this.promotion.evaluate(input.skillId, settings, nowFn)` — no 4th arg (`skill-invocation-tracker.ts:80-84`) — OK, defaults to `origin = {}`, i.e. background, which is correct: an invocation-count crossing a threshold is not a click.
7. `SkillCuratorService.runManual(origin)` (click, `userInitiated: true` from `runCurator` RPC) vs. the `setInterval` callback in `start()` calling `this.runPass(s)` with no origin (`:186-192,206-217`) — both route through the SAME `runPass(settings, origin = {})` — OK, `origin` is a plain call parameter each time, not stored on `this`, so a manual run and an interval tick firing back-to-back or concurrently cannot leak one's origin into the other's in-flight call (verified: `currentSettings`/`currentIntervalHours` are the only persisted fields, and neither carries `origin`).
8. `runPass` → `runEnhancementPass(settings, origin)` → `this.enhancer.enhance(candidate.slug, settings, { kind, userInitiated: origin.userInitiated })` (`:681-684`) — OK for the single-candidate case; see Serious #1 for the multi-candidate sequential-wait compounding.
9. Electron adapter: `ElectronSkillRepropagation.repropagate(kind, slug, root, origin = {})` → `propagation.propagate(root, \`skill-repropagation:${kind}\`, origin.userInitiated === true ? {} : { userLayerRefreshReason: SKILL_REPROPAGATION_USER_LAYER_REASON })` (`skill-repropagation.ts:59-83`) — OK, the branch is a strict `=== true`check so`undefined`/`false` both take the governed branch, matching the port doc's stated contract.
10. `HarnessPropagationService.propagate` → `options.userLayerRefreshReason === undefined ? refresher.refresh(cwd) : refresher.refresh(cwd, options.userLayerRefreshReason)` (`harness-propagation.service.ts:104-110`) — OK, preserves the exact one-argument call for every other caller (`plugins:save-config`, `plugins:uninstall-external`, `harness:create-skill`, `wizard:submit-selection`, etc.) — confirmed via the two new specs plus the pre-existing ones, none of which regressed.
11. `createUserLayerRefresher(container).refresh(cwd, reason?)` → `refreshUserLayer(container, cwd, reason ?? 'harness-propagation')` (`plugin-activation.ts:551-558`) → `userLayerJobFor(container).request(normalizedKey, reason, payload)` — OK, reason becomes one entry in the coalescer batch's `reasons` list.
12. `admitUserLayerPass` gate: `request.reasons.every(r => GOVERNED_USER_LAYER_REASONS.has(r))` (`:180-183`) — verified by reading `coalesced-job.ts` in full: a batch is only ever gated while it is still `pending`; a request that lands while a run is already executing (removed from `pending`) starts a fresh batch chained behind the running one via the per-key `chains` map, so "runs never overlap" holds and a background request joining a batch already running for a click correctly waits its turn for the NEXT pass rather than corrupting the in-flight one. A background reason joining a currently-HELD (still-pending, not yet running) batch that also has a click's ungoverned reason correctly releases the whole batch at once (`request()`'s `existing.admission?.abort()` re-asks `admit`, whose `.every(...)` now sees the non-governed reason and returns `'run'` immediately) — directly pinned by `plugin-activation.spec.ts:882-909` ("a clicked re-propagation joining a held background one releases it at once, as ONE pass").
13. `runUserLayerPass` → `mirrorUserLayer` → `reconcileUserLayer` → (conditionally) `syncSkillRegistryCatalog` — unchanged by this batch, confirmed via diff (no hunks in this function).

## Requirements fulfilment

| Requirement                                                                                                           | Status   | Gap                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Optional `{ userInitiated? }` on `SkillRepropagationPort.repropagate`                                                 | COMPLETE | Signature and JSDoc match the plan exactly; `CliSkillRepropagation` deliberately left at 3 params (out of scope, port arg is optional).  |
| Click paths (`promote`, `promoteBulk`, `enhanceNow`, `applyProposal`, `revertEnhancement`) pass `userInitiated: true` | COMPLETE | All five verified by direct read of the RPC handler file; no click path found missing it among the port's actual callers.                |
| Background triggers (auto-enhance interval, auto-promotion via invocation tracker) pass no origin (background)        | COMPLETE | `skill-invocation-tracker.ts:80-84` and the curator interval in `skill-curator.service.ts:186-192` both correctly omit `userInitiated`.  |
| Electron maps `userInitiated` to ungoverned `harness-propagation`, else governed `skill-repropagation`                | COMPLETE | `skill-repropagation.ts:59-83`; `plugin-activation.ts:152-155` adds the reason to `GOVERNED_USER_LAYER_REASONS`.                         |
| `IUserLayerRefresher.refresh` gains an optional reason; other callers unaffected                                      | COMPLETE | `harness-propagation.service.ts:104-110`; verified via the two new specs plus the untouched existing ones.                               |
| Same rejection rule as Batch 17 (`AbortError` cancels, other rejection warns + runs); `activation` never waits        | COMPLETE | Inherited unchanged from `admitUserLayerPass`; no new branch introduced.                                                                 |
| "No click path left without `userInitiated`" (task's own completeness check, naming curator suggestion accept)        | PARTIAL  | `acceptSuggestion` never reaches the port at all — see Failure modes / Moderate above. Not a regression, but named in scope and unfixed. |
| Curator background pass origin isolation (no leakage between manual and interval passes)                              | COMPLETE | `origin` is a plain call parameter throughout; verified no service field carries it.                                                     |

Implicit requirements not addressed: an aggregate time budget (or a fire-and-forget path) for a curator pass that repropagates several candidates in one tick (Serious #1); a decision — made or recorded — on whether `acceptSuggestion` should repropagate.

## Edge cases

| Case                                                                            | Handled | How                                                                                                       | Concern                                                                                                |
| ------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Click joins a held background batch                                             | YES     | Non-governed reason added → `.every()` fails → `admission.abort()` → re-ask → `'run'`                     | None — spec-covered end to end (`plugin-activation.spec.ts`)                                           |
| Background request arrives while a click's batch is already RUNNING             | YES     | `pending` map has no entry mid-run; a new batch is created and chained after the running one via `chains` | None — verified by code reading of `coalesced-job.ts`, not directly spec'd for this exact interleaving |
| Manual `runCurator` concurrent with an interval tick                            | Partial | Origin is per-call, no leakage                                                                            | No overlap guard on `runPass` itself (pre-existing, unrelated to origin correctness)                   |
| Multiple candidates enhanced in one background curator pass, governor busy      | NO      | Sequential `await` per candidate, no fan-out or shared deadline                                           | Up to N × 10 min held (Serious #1)                                                                     |
| `acceptSuggestion` click                                                        | NO      | No repropagation call exists                                                                              | Harness stays stale until next unrelated activation (Moderate)                                         |
| `revert`/`applyProposal` default `origin = {}` when a caller forgets to pass it | YES     | Defaults to background/governed, the safe direction                                                       | None                                                                                                   |
| Governor absent (bare host/spec)                                                | YES     | `resolveUserLayerGovernor` returns `null` → `admitUserLayerPass` runs at once                             | None — unchanged, inherited from Batch 17                                                              |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the origin-threading itself is correct and complete for every caller the task named except one (`acceptSuggestion`), but wiring the governor into `SkillCuratorService.runEnhancementPass`'s sequential candidate loop turns a "one background unit waits up to 10 minutes" contract into "up to three background units wait up to 10 minutes each, one after another, inside a single curator tick" — a real widening of how long a background pass can be held that nothing in this batch bounds or fixes.
- What a robust implementation would add: (1) decouple the curator's per-candidate repropagation from the loop that selects the next candidate (fire-and-forget the refresh, or bound the pass's total governed wait); (2) wire `acceptSuggestion` through the repropagation port with `userInitiated: true`, or record an explicit reviewed decision not to; (3) a spec that drives more than one candidate's deferred repropagation through one `runEnhancementPass` call to pin whatever behaviour is chosen for (1).

---

## Delta review (review fixes)

Scope: the five fixes reported for the base review's findings, re-verified against the current (still uncommitted) tree in `D:\projects\ptah-437`. Read-only; no build/test run beyond what evidence below cites. Cross-checked against `b17b-code-style-review.md` for the style half, per the coordinator's request to cover it briefly.

### Serious 1 (curator background pass can serialize N × 10 minutes) — fixed, and verified by the harder shape

`ElectronSkillRepropagation.repropagate` (`apps/ptah-electron/src/activation/skill-repropagation.ts:59-95`) now branches on `origin.userInitiated`: a click `await`s the private `propagate(...)` in full; background work fires `void this.propagate(...)` and returns immediately. `propagate` (:97-124) is unconditionally wrapped in one `try/catch` with no rethrow path, so the JSDoc's claim "never rejects" is correct — confirmed there is no `await` or `throw` after the `catch` block, so `void`-ing it cannot produce an unhandled rejection.

This closes the finding at its root: `SkillCuratorService.runEnhancementPass`'s loop (`skill-curator.service.ts:640-690`, unchanged by this fix — the fix is entirely in the Electron adapter) still `await`s `this.enhancer.enhance(...)` per candidate, but `enhance → applyProposal → repropagate (private) → SkillRepropagationPort.repropagate` now resolves at once for a background origin instead of waiting out the governor, so the loop itself no longer accumulates a wait per candidate. The 10-minute cost is paid at most once per coalescing window regardless of how many candidates the curator processes in one pass, because every fire-and-forget call in the loop lands in the same per-workspace coalescer batch (`plugin-activation.ts`'s `userLayerJobFor`) within the same synchronous burst.

Verified directly by `plugin-activation.spec.ts`'s new "a 3-candidate enhancement loop finishes while the governor is busy, and its refreshes merge into ONE held pass" — asserts `loopFinished === true` and `governor.whenClear` called exactly once for 3 sequential `repropagate` calls, then one `mirrorAll` call after release. This is a harder, more direct proof than a curator-level spec would have been: it drives the exact shape (`N` sequential awaits into the same coalescer window) rather than a single candidate. `skill-repropagation.spec.ts`'s "a background call resolves while the propagation is still held, and the propagation still runs" independently pins the adapter-level half (resolves before `finish()`, then the held promise still completes and logs `debug`, never `warn` for the success path).

Fire-and-forget safety, checked point by point:

- **Unhandled rejection**: none possible — `propagate` swallows every error internally before returning (`skill-repropagation.ts:118-124`); `skill-repropagation.spec.ts`'s "a background call logs a rejected propagation once and never rejects" pins this directly.
- **Outliving app shutdown**: unchanged mechanism, and it inherits an existing precedent rather than introducing a new risk category. `BackgroundWorkGovernor.isClear()` returns `this.current === 'clear'` (`background-work-governor.ts:256-258`), so a disposed governor is NOT reported clear; `admitUserLayerPass` therefore falls through to `whenClear()`, which checks `this.current === 'disposed'` FIRST and rejects with `AbortError` before ever queuing a waiter (`background-work-governor.ts:284-286`) — the gate's existing `AbortError → 'skip'` branch (`plugin-activation.ts:207-213`, unchanged) applies identically whether the caller awaited the outer promise or fire-and-forgot it, because the gate itself, not the caller, decides whether the pass runs. This exact "kick off a governed user-layer refresh and do not await it from the trigger site" shape already exists for `content-download-complete` (`boot-heavy-services.ts:203-241`, `contentDownload.ensureContent().then(...).catch(...)` with no `await` from the caller) — so this fix extends an established, already-shipped pattern rather than inventing a new one.
- **Ordering between two background requests for the same slug**: does not matter. The coalescer is keyed by normalized workspace root, not by slug, and every run is a full mirror + reconcile + catalog sync regardless of which reason(s) triggered it — two background repropagations for the same or different slugs either join one batch (if within the coalescing window) or run two full, idempotent passes in sequence (if not); neither ordering can produce a wrong end state.

### Moderate (acceptSuggestion never repropagates) — fixed and correctly scoped

`SkillCuratorService.acceptSuggestion` is now `async`, takes a trailing `origin: QueryOrigin = {}`, and calls a new private `repropagateAccepted(slug, origin)` after `this.suggestionStore.accept(id)` (`skill-curator.service.ts:547-604`). `repropagateAccepted` never throws (wraps the port call in `try/catch`, warns on failure, "the skill is still accepted" — matching the exact non-fatal contract every other repropagation caller uses). The RPC handler (`skills-synthesis-rpc.handlers.ts:1555-1558`) now `await`s the call and passes `{ userInitiated: true }` with the same one-line "skips the governor" comment style used at the other four call sites.

**(b) Caller completeness, verified by grep**: `acceptSuggestion` has exactly one production caller — `skills-synthesis-rpc.handlers.ts:1555` — now correctly `await`ed. The `ICuratorService` interface in that same file was updated to `Promise<{ accepted: boolean; filePath: string }>`, so a stale synchronous caller would now be a type error, not a silent bug; none exists. The frontend (`skill-synthesis-rpc.service.ts:605`, `skill-synthesis-state.service.ts:438`) only calls the RPC method by name and is unaffected by the backend method's sync→async change. No other caller (UI flow, another RPC handler, a spec) invokes `SkillCuratorService.acceptSuggestion` directly outside `skill-curator.service.spec.ts`'s own new tests.

**(b) DI registration across hosts**: `SKILL_REPROPAGATION_TOKEN` is never actually "absent" for any host — `skill-synthesis`'s own `di/register.ts:212-213` registers a default `NoOpSkillRepropagation` for whichever host loads the library's base registration, and Electron (`phase-2-libraries.ts:368-369`) and the CLI (`register-thoth-libraries.ts:132-133`) each override it with their real adapter. `PLATFORM_TOKENS.WORKSPACE_PROVIDER` is likewise registered in all three hosts. So:

- **Electron**: real propagation, governed by origin as designed.
- **CLI**: real propagation via `CliSkillRepropagation`, which now accepts (and ignores) the optional fourth `_origin` parameter — consistent with how it already ignores origin for promotion/enhancement, so `acceptSuggestion` behaves the same as every other click-driven repropagation on this host.
- **VS Code**: resolves the base `NoOpSkillRepropagation`, whose `repropagate()` body is `async repropagate(): Promise<void> { return; }` — a genuine no-op that resolves immediately and never touches the harness. This is correct and consistent: VS Code already has no push-repropagation for promote/enhance/revert (a pre-existing, accepted limitation predating this task), so `acceptSuggestion` joining that same limitation is uniform behaviour, not a new gap introduced by this fix.

**(c) Workspace root `''` fallback**: `SkillCuratorService.workspaceRoot()` (`:612-620`) mirrors `SkillPromotionService`'s identical private method exactly (`this.workspace?.getWorkspaceRoot() ?? ''`, comment explicitly says "the value `SkillPromotionService` passes"), and `HarnessPropagationService.propagate` treats an empty/whitespace `cwd` as "no workspace" and returns `null` without touching any workspace (unchanged skip-guard: `cwd === undefined || cwd === null || cwd.trim() === ''`). So a headless accept with no open workspace correctly SKIPS the refresh rather than reconciling the wrong (or a default) workspace — traced end to end, not merely asserted by the new unit spec (which only exercises the `'/ws'` present-workspace path).

Verified by `skill-curator.service.spec.ts`'s new `describe('acceptSuggestion re-propagates the accepted skill', ...)` block: origin forwarding to the exact accepted slug and workspace root, non-fatal on a throwing port, and no repropagation call for a suggestion that was not actually accepted (already-accepted / not-found).

### Style items — briefly

Both Serious findings from `b17b-code-style-review.md` are resolved by this fix round:

- **`harness-sync/CLAUDE.md` silence on `userLayerRefreshReason`** — fixed. `harness-sync/CLAUDE.md:583-593` now documents the field beside the existing `skipUserLayerRefresh` treatment, states the distinction from `reason`, names `ElectronSkillRepropagation` as the only setter, and the trigger table gained a `Suggestion accept` row.
- **CLI adapter's silent divergence** — fixed. `cli-skill-repropagation.ts:41-42` adds `_origin?: QueryOrigin` with the recommended one-line comment ("The CLI has no background-work governor, so the origin is ignored (FU-17b)"), matching the fix the style review itself proposed almost verbatim.
- The Minor "two-branch `refresh(cwd)`/`refresh(cwd, reason)` forwarding" is also fixed: `harness-propagation.service.ts:107-109` is now a single `await this.refresher.refresh(cwd, options.userLayerRefreshReason)` call, exactly the style review's suggested collapse.
- Not addressed (both pre-existing Minor, not in the fix list): `plugin-activation.ts` is now 760 lines (was already over the 700-line soft ceiling before this batch); `skill-enhancer.service.ts:610-619`'s `applyEnhancement`→`applyProposal` call still builds `{ userInitiated: options.userInitiated }` as a fresh literal rather than composing `options`. Neither is a defect and neither was in this fix round's scope.

### New observations from this fix round

- `skill-curator.service.ts` is now counted at 725 lines (tracked as new follow-up FU-17b-b per the coordinator's own note) — over the 700-line soft ceiling, introduced by this exact fix (the `acceptSuggestion` async conversion + `repropagateAccepted` + `workspaceRoot` + two new constructor params). Consistent with the repo's warn-level (not blocking) file-size convention; noted, not filed as a new issue, since the coordinator already opened a follow-up for it.
- No new failure mode found in the fixed code beyond what is already covered above — the fire-and-forget change and the `acceptSuggestion` wiring were the two structurally significant changes in this round, and both were traced end to end above.

### Delta verdict

- Recommendation: APPROVE
- Confidence: HIGH
- What changed since the base review: Serious 1 (curator pass serialization) is fixed at its root cause — background repropagation is fire-and-forget from the caller's perspective, verified never to reject, verified shutdown-safe via the existing governor `disposed` check, and verified by a spec that drives the exact multi-candidate shape the base review flagged. The Moderate `acceptSuggestion` gap is fixed completely: wired through the port with the correct origin, its one production caller updated and awaited, correct behaviour confirmed across all three hosts' DI registration, and the empty-workspace-root fallback traced to a safe skip rather than a misdirected refresh. Both Serious style findings and one style Minor are also resolved.
- Outstanding: none blocking. Two pre-existing Minor style items (file size, one inline-literal echo) remain, both out of this fix round's scope and non-behavioural. FU-17b-b (file size) is already tracked.
