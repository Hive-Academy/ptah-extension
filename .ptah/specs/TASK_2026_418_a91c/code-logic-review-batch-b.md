# Code Logic Review — `TASK_2026_418_a91c` Batch B (frontend)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2 (both handled correctly; documented for audit) |

## Scope examined

Full uncommitted diff in the worktree (27 files, `chat-types`, `chat-state`, `chat-streaming`,
`chat`, `chat-ui`, `harness-builder`), read in full (not only changed hunks) against:
`.ptah/specs/TASK_2026_418_a91c/context.md`, `implementation-plan.md` (Batch B section,
Component 1 and Component 2 contracts), `batch-b-report.md` including Revision 1, and
`.ptah/specs/TASK_2026_533_b7e1/context.md` + `implementation-plan.md` for the backend-authority
boundary. Traced the full data path for both context capacity (backend `ContextCapacity` →
`TurnModelUsage`/`LiveModelStatsPayload` → `deriveLiveModelStats` → `TabManagerService` /
`SurfaceSessionStatsRegistry` → `SessionStatsSummaryComponent`) and compaction measurement
(`compaction_complete` event → `AccumulatorCore` → `StreamingHandlerService` → `ChatStore` →
`CompactionLifecycleService` → `ConversationRegistry` → `CompactionMarkerComponent`). Ran
`ptah_get_diagnostics` scoped to the five most logic-dense production files in this batch
(`session-live-stats.util.ts`, `conversation-registry.service.ts`, `tab-manager.service.ts`,
`session-stats-summary.component.ts`, `compaction-marker.component.ts`); zero diagnostics
against those files. The 266 reported errors are all in unrelated spec files (branded
`TabId`/`SessionId` string literals, mock-RPC typing) predating this batch, matching what
`batch-b-report.md` already disclosed.

## Five logic questions

### 1. How does this fail silently?

No silent-success failure mode was found in the reviewed paths. The design's own bias is
toward *hiding* data rather than fabricating it (em dash instead of a guessed percentage),
which is the correct failure direction for this task's stated goal ("no guessed capacity
anywhere"). The one place a value is dropped without an explicit warning is
`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:165-171`,
where the prior revision's `console.warn` on suppressed context-fill was deleted (the old
"suppressed context-fill update" log). This is intentional — `derived.live` is no longer ever
`null`, so there is nothing left to warn about — but it does mean an unknown-context turn now
produces zero console signal at all, silent by design rather than by accident. Not a defect,
but worth naming since a future regression in `deriveLiveModelStats` producing a bad value
would no longer have this canary.

### 2. What user action produces unexpected behaviour?

- Switching between two providers/models mid-session (e.g., resuming a Codex-proxy session in
  a tab that last showed an Anthropic-native context fill) correctly clears the badge to "—"
  rather than keeping the old percentage, because every consumer
  (`session-live-stats.util.ts:72-83`, `tab-manager.service.ts:1946-1958`,
  `session-stats-summary.component.ts:694-711`) independently re-checks
  `capacity.model === <current model>` before trusting `capacity.tokens`. Verified against
  `session-live-stats.util.spec.ts`'s "rejects unverified or mismatched capacity" cases.
- Expanding the stats card in an unknown-context state does not un-hide the token count or
  progress bar — the compact and expanded layouts share the same `hasKnownContextWindow()`
  gate (`session-stats-summary.component.ts:251`, `:427`), confirmed by
  `session-stats-summary.component.spec.ts`'s new "renders unknown main context as an em dash"
  cases, which explicitly assert this after a simulated click on `stats-expand`.

### 3. What input data produces a wrong answer?

None found that produces a *wrong* (misleading) number; the design consistently degrades to
"—" instead. The closest near-miss: `session-live-stats.util.ts:86-89` and
`tab-manager.service.ts:1959-1962` both include the raw (possibly invalid/mismatched)
`contextCapacity` object in the payload they hand downstream, even when their own
`contextWindow` computation rejected it (set to `0`). This is not a defect in this diff because
every downstream reader (`session-stats-summary.component.ts:694-711`, and
`tab-manager.service.ts`'s own re-derivation on the next post-compaction seed) re-validates
`stats.contextWindow === capacity.tokens` before using it, so a stale/invalid capacity object
riding along in the payload cannot surface as a fabricated percentage today. It is a latent
sharp edge: if a future consumer reads `liveModelStats.contextCapacity.tokens` directly instead
of going through `hasKnownContextWindow()`/the window field, it would silently reintroduce a
guessed number. Recommend, non-blocking: null out `contextCapacity` at the same point
`contextWindow` is forced to `0`, so there is exactly one place capacity validity is decided.

### 4. What happens when a dependency fails?

- Missing/undefined `lastTurnContextTokens` (backend never sent a main-request frame): always
  resolves to `contextKnown: false`, never a cumulative substitute — the entire fallback branch
  that used to sum `inputTokens + cacheReadInputTokens + outputTokens` was deleted from
  `session-live-stats.util.ts` (confirmed by the rewritten spec: "publishes explicit unknown
  when lastTurnContextTokens is absent").
- Missing/invalid `contextCapacity` (backend catalog lookup failed or returned unqualified
  evidence): `contextWindow` forced to `0`, `hasKnownContextWindow()` false, badge shows "—".
- Malformed/legacy compaction marker in `localStorage` (old persisted record with no
  `boundaryId`/`measurement`, or a measurement whose internal `boundaryId` doesn't match the
  record's `boundaryId`): `ConversationRegistry.validMeasurement`
  (`conversation-registry.service.ts:414-441`) rejects it and the marker deserializes with
  `measurement: undefined`, i.e., neutral wording, never "shrank". Covered by the "loads legacy
  or malformed provenance neutrally" parametrized spec (5 malformed shapes).
- A `PostCompact` push notification that arrives before its `compact_boundary` counterpart, or
  an advisory-fallback timeout firing with no SDK pair at all
  (`compaction-lifecycle.service.ts:389,721-725`): the marker's `preTokens`/`postTokens`/
  `boundaryId`/`measurement` are all reset to `null`/`undefined` rather than continuing to show
  the *previous* compaction's numbers under the new boundary. This is a deliberate, tested
  behaviour change (see Failure modes below) and is the conservative direction required by the
  task brief ("stale or mismatched pairs must not produce a misleading 'saved N tokens'").

### 5. What is missing that the requirements never mentioned?

- The `preTokens`/`postTokens` scalar `input()`s on `CompactionMarkerComponent`
  (`compaction-marker.component.ts:98-99`) are now dead: `tokenLine()` reads only
  `this.measurement()`, never `this.preTokens()`/`this.postTokens()`. The parent template still
  binds them (`chat-view.component.html:56-57`). Harmless (no logic depends on them), but it is
  unused surface area that a future reader could mistake for still being load-bearing. Not
  flagged as a style-reviewer duplicate finding since it borders on logic clarity (an unused
  input silently doing nothing is exactly the shape of a stub the reviewer brief asks to catch);
  including it here for completeness, kept at Minor severity.
- No spec exercises the exact interaction in `compaction-lifecycle.service.ts:679-686` — the
  `boundaryId: this.isAuthoritativelyCompletedGeneration(key) ? prior?.boundaryId : undefined`
  guard passed into `setCompactionMarkerSummary` for the `SESSION_COMPACTION_COMPLETE` push path.
  The equivalent registry-level behaviour (summary-only completion without an identified
  boundary clears the pair) is unit-tested in `conversation-registry.service.spec.ts`, but the
  lifecycle-level wiring that decides *whether* to pass the real boundary id through is not
  covered by a dedicated `compaction-lifecycle.service.spec.ts` case in this diff. Traced the
  logic by hand (see Failure modes) and it behaves correctly, but it is undertested for a path
  this security-sensitive to "no misleading saved N tokens".

## Failure modes

### Late/duplicate compaction pair cannot resurrect a stale measurement

- Trigger: a `PostCompact` push notification or an advisory-fallback timeout fires for a
  session whose `compact_boundary` stream event has not yet arrived (or never arrives),
  while an *earlier* compaction's `preTokens`/`postTokens`/`measurement` are still stored on
  the conversation's marker record.
- Symptom (if mishandled): the marker could show "shrank 1000 → 600" for a boundary that has
  nothing to do with the numbers displayed.
- Evidence: `compaction-lifecycle.service.ts:721-725` (advisory fallback, no boundary data at
  all) and `:679-686` (PostCompact push, boundary id withheld unless the generation is already
  authoritative) both route through `ConversationRegistry.setCompactionMarkerTokens`/
  `setCompactionMarkerSummary`. There, `sameBoundary` requires `fields.boundaryId` to be a
  non-empty string equal to the prior boundary id (`conversation-registry.service.ts:299-303`);
  when it is `undefined` (the unidentified case), `summaryOnly` retention is bypassed and the
  merge falls through to `fields.preTokens`/`fields.postTokens` (i.e., `null`), clearing the
  stale pair rather than keeping it.
- Current handling: correct — traced by hand across both call sites and confirmed by the
  renamed/flipped test `conversation-registry.service.spec.ts` "an unidentified completion
  never borrows earlier endpoints" (previously "a later null never clobbers an already-set
  field", which asserted the *opposite*, stale-preserving behaviour the plan explicitly called
  out as the bug to remove: "Never synthesize a new pair by null-coalescing old and new
  endpoints").
- Recommendation: none required. Flagging as a failure mode because it is exactly the kind of
  race the task asked to guard against, and it is worth an explicit acknowledgement that the
  fix is real, not just a renamed assertion.

### Post-compaction seed forced to unknown capacity for a cross-model badge

- Trigger: `TabManagerService.seedPostCompactionContext`/`applyCompactionComplete` runs after a
  live badge was showing a *different* model's verified capacity (e.g., a provider/model switch
  happened between turns without an intervening live update).
- Symptom (if mishandled): the post-compaction badge could keep showing the old model's window
  as if it applied to the new model, producing a wrong percentage.
- Evidence: `tab-manager.service.ts:1946-1958` requires `capacity.model === priorLiveStats.model`
  before accepting `capacity.tokens`; a mismatch forces `contextWindow: 0`.
- Current handling: correct, and it is model-name-scoped rather than capacity-object-identity
  scoped, so it survives serialisation/deserialisation of the payload.
- Recommendation: none required.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — `session-live-stats.util.ts:86-89` and `tab-manager.service.ts:1959-1962` carry
  an unvalidated `contextCapacity` object downstream even when the same function's own
  `contextWindow` computation just rejected it. No user-visible defect today because every
  reader re-validates, but it is a single point of truth violation that a future direct reader
  of `contextCapacity.tokens` could reintroduce a guessed percentage through. Suggest zeroing/
  clearing `contextCapacity` alongside `contextWindow` at the point of rejection.
- **Minor** — `compaction-marker.component.ts:98-99`: `preTokens`/`postTokens` inputs are dead
  code post-refactor (only `measurement` drives `tokenLine()`); the parent
  (`chat-view.component.html:56-57`) still binds them. No behavioural effect; candidate for
  removal in a follow-up cleanup.
- **Minor** — no dedicated `compaction-lifecycle.service.spec.ts` case for the
  `isAuthoritativelyCompletedGeneration` boundary-id gate on the `SESSION_COMPACTION_COMPLETE`
  push path (`compaction-lifecycle.service.ts:679-686`). The registry-level behaviour it feeds
  is tested; the lifecycle-level decision of *what* to pass is not directly tested at that
  layer.
- **Minor** — `session-stats-aggregator.service.ts` dropped the diagnostic
  `console.warn('[ChatStore] handleSessionStats: suppressed context-fill update ...')` without a
  replacement signal. Correct given `derived.live` is never `null` anymore, but it does remove a
  canary that would have caught a regression in `deriveLiveModelStats` producing an unexpectedly
  unknown result for a turn that should have been known.

## Data flow

**Context capacity:**
1. Backend attaches `ContextCapacity` (exact provider + model) to each `modelUsage` row and to
   `SessionStatsEntry.contextSnapshot` — OK (Batch A, out of scope here, but consumed correctly).
2. `TurnModelUsage.contextCapacity` reaches `deriveLiveModelStats`
   (`session-live-stats.util.ts:37-99`) — OK: numerator (`lastTurnContextTokens`) and capacity
   are validated independently; window is `0` unless capacity passes model/source/provider/
   finite-positive checks.
3. `SessionStatsAggregatorService.handleSessionStats` installs `derived.live` unconditionally
   (`session-stats-aggregator.service.ts:165-169`) — OK: explicit-unknown objects always
   overwrite a stale fill (matches the required "explicit unknown update must clear a previous
   fill").
4. `TabManagerService.setLiveModelStats` / `SurfaceSessionStatsRegistry.record` store the
   payload; the registry's `turn.live ?? existing?.live ?? null` (`surface-session-stats.
   registry.ts:87`) correctly distinguishes "no update" (`null`) from "explicit unknown"
   (a real object with `contextKnown: false`) — OK, verified by the new registry spec.
5. `SessionStatsSummaryComponent.hasKnownContextWindow()` re-derives its own known/unknown
   verdict independently of what upstream computed — OK, defense in depth; gates progress bar,
   percent label, warning threshold and tooltip uniformly across both layouts.
6. History/resume path (`SessionLoaderService.applyLoadedSessionStats`) now reuses
   `deriveLiveModelStats` directly instead of a bespoke `wireContextWindow` fallback that used
   to call `getModelContextWindow` — OK, single code path for live and historical derivation.
7. Post-compaction seed (`TabManagerService.postCompactionContextStats`) re-validates capacity
   against the *current* model before reusing it — OK (see Failure modes).

**Compaction measurement:**
1. `SystemMessageTransformer` (backend, out of scope) assigns `boundaryId` and emits
   `CompactionMeasurement` only for a complete same-boundary pair — assumed per Batch A contract.
2. `AccumulatorCore.process` forwards `boundaryId`/`measurement` unchanged on
   `compaction_complete` (`accumulator-core.service.ts:577-578`) — OK, tested.
3. `StreamingHandlerService.processStreamEvent` forwards both fields through both declared
   result shapes (`streaming-handler.service.ts:187-188`, `:333-334`, `:410-411`) — OK, tested.
4. `ChatStore` forwards to `CompactionLifecycleService.handleCompactionComplete`
   (`chat.store.ts:378-379`) — OK.
5. `CompactionLifecycleService` forwards to `ConversationRegistry.setCompactionMarkerTokens` on
   both the normal path (`:553-559`) and the late-boundary-merge path
   (`mergeLateCompactionBoundary`, verified forwarding) — OK.
6. `ConversationRegistry.setCompactionMarkerTokens`/`setCompactionMarkerSummary` atomically
   replace the pair only for a self-consistent, same-boundary, finite-nonnegative,
   decreasing-or-neutral measurement; a new `compactionStart` invalidates the prior pair; an
   unidentified completion clears rather than inherits — OK, extensively tested (10+ new/changed
   cases), traced by hand for the two call sites that supply `boundaryId: undefined`.
7. `localStorage` round-trip validates the persisted measurement's internal `boundaryId` against
   the record's own `boundaryId` before trusting it (`readPersisted`/`validMeasurement`) — OK.
8. `CompactionMarkerComponent.tokenLine()` requires `pair.boundaryId === this.boundaryId()` and
   `pair.preTokens > pair.postTokens` before rendering "shrank"; anything else (including a
   valid-but-equal/increasing same-boundary pair) renders neutrally — OK, tested including the
   boundary-mismatch case explicitly.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Percent/progress shown only with authoritative provider evidence for the exact provider/model | COMPLETE | None found; verified at three independent layers (util, tab-manager, component). |
| Explicit unknown update clears a previous fill | COMPLETE | `deriveLiveModelStats` never returns `live: null`; registry distinguishes no-update vs. explicit-unknown. |
| No guessed capacity anywhere, including harness-builder | COMPLETE | Harness builder binds the shared `SessionStatsSummaryComponent` and its `liveModelStats` input directly; no separate capacity logic; `getModelContextWindow` fallback removed from `tab-manager.service.ts` and `session-loader.service.ts`. |
| Before/after compaction figures shown only for same-boundaryId pair | COMPLETE | `validMeasurement` and `CompactionMarkerComponent.tokenLine()` both re-check boundary identity. |
| Stale/mismatched pairs must not produce misleading "saved N tokens" | COMPLETE | Unidentified completions clear rather than inherit; mismatched boundary ids render neutrally; see Failure modes. |
| No frontend recomputation of cost/tokens moved to backend snapshot | COMPLETE | `session-stats-aggregator.service.ts`, `surface-session-stats.registry.ts` install snapshots by assignment only (`installSessionStatsMock`/`peek().snapshot` reference-equality asserted in specs); no `session-stats-snapshot.ts` file in this diff, confirming it was not touched. |
| 5 migrated legacy assertions genuine, not weakened | COMPLETE | All five (`tab-manager.service.spec.ts` x4, `harness-builder-view.component.spec.ts` x1) add real provider-catalog evidence fixtures rather than deleting assertions; one test's title and expectation were correctly flipped from a since-forbidden null-coalescing behaviour to the required non-inheriting behaviour, matching the plan's explicit instruction to remove that anti-pattern. |
| Stale state across tab switch/resume/reload/multi-tab | COMPLETE | Resume path unified through `deriveLiveModelStats`; multi-tab fan-out in `compaction-lifecycle.service.ts` unchanged by this batch and continues to route through the same per-conversation registry, which the new atomic-replacement logic makes safer, not less safe. |

Implicit requirements not addressed: none identified beyond the Minor items above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Provider switch mid-session (context) | YES | Model-name equality check in every consumer | None |
| Zero as explicit numerator (`lastTurnContextTokens: 0`) | YES | `numerator >= 0` accepted, distinct from `undefined`/`NaN` | None |
| Capacity `tokens` finite but `<= 0` | YES | Rejected by `capacity.tokens > 0` check | None |
| Equal/increasing compaction pair | YES | Neutral rendering (`pair.preTokens <= pair.postTokens` → null) | Plan allows optionally showing labeled samples in this case; current code shows nothing extra, which is within "if useful" discretion, not a violation |
| Duplicate identical boundary completion | YES | `sameBoundary && summaryOnly` retains prior pair | None |
| Late boundary after advisory fallback fired | YES | `mergeLateCompactionBoundary` forwards fresh boundary/measurement, overwriting the fallback's cleared state | Relies on pre-existing (untouched) advisory-correlator generation matching; not re-verified in this review since that file is outside Batch B |
| Legacy persisted marker (no boundaryId) | YES | `validMeasurement` rejects, `measurement: undefined` | None |
| Cross-provider same model-id collision (e.g. `openrouter` vs `openai-codex` both claiming `m`) | YES | `providerId` embedded in `ContextCapacity` re-checked at UI layer alongside model | Provider isolation itself is a Batch A (backend) guarantee; frontend correctly propagates and re-checks it but cannot itself prevent a backend from mislabeling `providerId` |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the unused `contextCapacity` payload riding downstream even after being rejected
  (Moderate finding above) — currently harmless because every reader re-validates, but it is the
  one place a future edit could reintroduce a guessed percentage without touching the code that
  actually validates capacity.
- What a robust implementation would add: (1) collapse capacity validation to a single shared
  predicate used by `session-live-stats.util.ts`, `tab-manager.service.ts`, and
  `session-stats-summary.component.ts` instead of three independent copies of the same
  model/source/provider/finite-positive check, to remove the current duplication risk; (2) a
  `compaction-lifecycle.service.spec.ts` case for the `isAuthoritativelyCompletedGeneration`
  boundary-id gate on the PostCompact push path; (3) restore a lightweight dev-mode signal (even
  just a debug-level log) when a turn's context flips from known to unknown, since the explicit
  `console.warn` that used to serve as a regression canary was removed.
