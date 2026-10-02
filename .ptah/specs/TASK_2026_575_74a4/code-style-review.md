# Code Style Review — `TASK_2026_575_74a4`

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 2                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 34                                   |

## Five style questions

### 1. What breaks in six months?

- In [`libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L107-L123`](../../../libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L107-L123), `sessionCostEstimate` treats `pricingCoverage === 'partial'` as the sole condition under which a non-null `totalCost` is marked as a lower bound. If backend session accounting adds new partial states (e.g. `'subagent-unpriced'`, `'estimated'`, or `'degraded'`), `isLowerBound` will return `false`, causing the dashboard to silently display incomplete totals without the `≥` marker.
- In [`libs/shared/src/lib/utils/pricing.utils.ts#L253`](../../../libs/shared/src/lib/utils/pricing.utils.ts#L253), `TRAILING_VARIANT_TAGS = /(\[[^\]]*\])+$/` strips only bracketed suffixes (such as `[1m]`). When providers adopt alternative delimiter conventions (such as `:1m`, `@1m`, or `+1m` common in third-party model catalogs, or prefix annotations like `[preview]`), `stripModelVariantTags` will not match, causing pricing lookups for those variants to fail unless an exact catalog SKU exists.
- In [`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L751`](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L751), `TURN_COST_NOISE_USD = 1e-6` clamps float noise to 1 microdollar. If future micro-models or speculative sub-calls have per-token rates below $10^{-6}$ and low token counts, valid fractional deltas risk being treated as noise.

### 2. What would a new team member misread?

- **Per-turn cost vs message cost naming:** In [`libs/shared/src/lib/types/agent-adapter.types.ts#L56`](../../../libs/shared/src/lib/types/agent-adapter.types.ts#L56), the wire field was renamed from `cost` to `turnCost` to avoid aliasing with the session total. However, in [`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L256`](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L256) and [`#L287`](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L287), `stats.turnCost` is mapped back into `pendingStats.cost` and `updatedMessages[lastAssistantIndex].cost`. A new developer might assume `message.cost` is cumulative or misnamed, unless they read the comments explaining that chat message entities have historically treated `cost` as per-message.
- **Asymmetric lower-bound threshold in analytics:** In [`libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L358-L361`](../../../libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L358-L361), if any readable session has an unpriced status (`s.status === 'ok'` and `estimate.cost === null`), it increments `unknownCostSessionCount` and sets `totalCostIsLowerBound = true`. But in [`libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts#L439-L444`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts#L439-L444), `avgIsLowerBound` checks only `partiallyPricedSessionCount > 0` (because unpriced sessions are excluded from the denominator). This distinction is mathematically sound but easily misunderstood when viewing the aggregate cards.

### 3. What does this cost to maintain that a simpler shape would not?

- **Dual-mode monotonicity branches in `SessionStatsOwnerService`:** Lines [`#L911-L987`](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L911-L987) implement `dollarsAreObserved`, `isSameUsage`, and `isGrown`. They maintain two divergent validation paths: `'reported'` (strict dollar and token monotonicity) and `'unreported'` (tokens-only monotonicity, allowing dollar rate card drops mid-run). Every modification to owner state logic requires testing across both branches and their edge cases (mixed cost sources, rate drops, token growth).
- **Inverted utility-to-service dependency:** In [`libs/frontend/dashboard/src/lib/utils/format.utils.ts#L1-L4`](../../../libs/frontend/dashboard/src/lib/utils/format.utils.ts#L1-L4), a presentation formatting utility imports domain calculation logic (`sessionCostEstimate`) and data models (`DashboardSessionEntry`) from an Angular `@Injectable()` service file (`session-analytics-state.service.ts`). Changes to the service file risk triggering circular dependency lints or test mock setup issues for format specs.

### 4. Where is this inconsistent with the rest of the repository?

- **Co-location of domain models in an Angular service:** In other frontend packages (e.g. `libs/frontend/chat-types`, `libs/frontend/chat-routing`), domain models and types live in dedicated `types.ts` or `models.ts` files. In `libs/frontend/dashboard`, `DashboardSessionEntry`, `AggregateTotals`, `SessionCostEstimate`, and `sessionCostEstimate` are defined inside [`session-analytics-state.service.ts`](../../../libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L39-L173), forcing components and utilities to import the service module.
- **Wire event shape derivation:**
  - `chat` derives [`SessionStatsResultEvent`](../../../libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L39-L45) using `Omit<ResultStatsPayload, 'sessionId' | 'modelUsage'> & ...`.
  - `chat-streaming` derives [`SessionStatsFooter`](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L220-L224) using `Pick<ResultStatsPayload, 'turnCost' | 'tokens' | 'duration'> & ...`.
  - `ptah-tui` derives [`SessionStatsPush`](../../../apps/ptah-tui/src/hooks/use-sessions.ts#L52) using `Partial<ResultStatsPayload>`.
  Each consumer cuts its own ad-hoc slice of the wire payload rather than referencing a standardized client-side event shape.
- **Terminal vs Webview lower-bound formatting:** TUI uses ASCII `'>='` (in [`apps/ptah-tui/src/lib/status-line.ts#L120`](../../../apps/ptah-tui/src/lib/status-line.ts#L120) and [`apps/ptah-tui/src/hooks/use-commands.ts#L317`](../../../apps/ptah-tui/src/hooks/use-commands.ts#L317)), while the Angular webview components use `&ge;` (`≥`) with accessible `<span class="sr-only">At least</span>`. While terminal limitations explain the ASCII choice, the formatting helpers are duplicated across the two surfaces.

### 5. What would you have done differently?

1. **Extract Dashboard Domain Models and Estimation:** Move `DashboardSessionEntry`, `AggregateTotals`, `SessionCostEstimate`, and `sessionCostEstimate` out of [`session-analytics-state.service.ts`](../../../libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L39-L173) into a dedicated `session-analytics.models.ts` file in `libs/frontend/dashboard/src/lib/models/`. This enforces a clean unidirectional dependency graph: `services -> models`, `utils -> models`, and `components -> models`.
2. **Extract Monotonicity & Turn Delta Logic from `SessionStatsOwnerService`:** `session-stats-owner.service.ts` is 987 lines long. Following the project's facade rule, extracting `acceptedTurnCost`, `dollarsAreObserved`, `isSameUsage`, and `isGrown` into an injected collaborator (e.g. `SessionStatsMonotonicityCalculator` in `libs/backend/agent-sdk/src/lib/session-stats/session-stats-monotonicity.ts`) would bring the service well under the 700-line soft ceiling and isolate accounting math from lease/lifecycle management.

---

## Blocking issues

None. The branch introduces no architectural boundary violations, adheres to strict typing guidelines, preserves all hexagonal invariants, and has zero runtime suppressions.

---

## Serious issues

### Inverted dependency: utility module imports from Angular service module

- File: [`libs/frontend/dashboard/src/lib/utils/format.utils.ts:1-4`](../../../libs/frontend/dashboard/src/lib/utils/format.utils.ts#L1-L4)
- Problem: `format.utils.ts` imports `sessionCostEstimate` and `DashboardSessionEntry` from `../services/session-analytics-state.service`. Pure utilities should never depend on service layers.
- Tradeoff: Placing pure functions and interfaces in a service file couples stateless presentation utilities to stateful Angular service files. A separate `models/session-analytics.models.ts` file decouples domain contracts from Angular DI and state management.
- Recommendation: Extract domain interfaces and `sessionCostEstimate` to `libs/frontend/dashboard/src/lib/models/session-analytics.models.ts`.

### File size near 1,000-line hard ceiling: `session-stats-owner.service.ts`

- File: [`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:1-987`](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L1-L987)
- Problem: The service grew by 134 lines to 987 lines (13 lines below the 1000-line ceiling). The repository coding standards specify: *"Soft file ceiling 700 lines (warn); past 1000 warrants a deliberate look, not a reflex split."*
- Tradeoff: The file now combines multiple concerns: state management and generation leasing, transcript restore candidates, base subtraction, turn delta derivation (`acceptedTurnCost`), and dual-path monotonicity verification (`isGrown`/`isSameUsage`).
- Recommendation: Extract `acceptedTurnCost` and the monotonicity predicates (`isGrown`, `isSameUsage`, `dollarsAreObserved`) into a collaborator module (`session-stats-monotonicity.ts`), keeping `SessionStatsOwnerService` focused on owner state lifecycle.

---

## Minor issues

- **Heterogeneous wire payload derivations across consumers:** [`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L39-L45`](../../../libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L39-L45), [`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L220-L224`](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L220-L224), and [`apps/ptah-tui/src/hooks/use-sessions.ts#L52`](../../../apps/ptah-tui/src/hooks/use-sessions.ts#L52). Each consumer creates a distinct `Pick`, `Omit`, or `Partial` slice of `ResultStatsPayload`. A shared client payload type in `@ptah-extension/shared` would standardize consumer consumption.
- **Untyped payload cast in TUI controller:** In [`apps/ptah-tui/src/hooks/use-sessions.ts#L336`](../../../apps/ptah-tui/src/hooks/use-sessions.ts#L336), `payload as SessionStatsPush` is passed directly from an `unknown` event argument without structural validation. A type-guard predicate like `isSessionStatsPush(payload)` would prevent runtime surprises if an invalid event is emitted.
- **Formatting divergence between TUI and webview:** In [`apps/ptah-tui/src/lib/status-line.ts#L120`](../../../apps/ptah-tui/src/lib/status-line.ts#L120) and [`apps/ptah-tui/src/hooks/use-commands.ts#L317`](../../../apps/ptah-tui/src/hooks/use-commands.ts#L317), partial costs are formatted as `'>='` string prefixes, whereas webview components use `&ge;` with screen-reader labels. A shared string format helper across products would ensure identical wording.

---

## File-by-file

### `libs/shared/src/lib/types/agent-adapter.types.ts`
Score 9/10 — 0B, 0S, 0M. Clean wire field rename (`cost` -> `turnCost`) with thorough JSDoc documenting semantics, subagent spend inclusion, rounding (1e-6), and nullability.

### `libs/shared/src/lib/utils/pricing.utils.ts`
Score 9/10 — 0B, 0S, 0M. Well-structured exact-then-partial lookup order in `lookupPricingEntry`. Moves `normalizeModelKey` and `stripModelVariantTags` into shared utils without circular dependencies.

### `libs/shared/src/lib/utils/pricing.utils.spec.ts`
Score 9/10 — 0B, 0S, 0M. Clear regression test coverage for `[1m]` tags, provider prefixes, and exact match preference. Tests verify both pricing lookup and barrel exports.

### `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
Score 8/10 — 0B, 0S, 0M. Replaces duplicate local `normalizeModelKey` with shared export; handles `turnCost` and duplicate skipping cleanly; properly removes publication of cumulative totals as message costs.

### `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`
Score 9/10 — 0B, 0S, 0M. Comprehensive multi-turn test updates asserting that message footer receives delta while session stats snapshot receives cumulative total.

### `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`
Score 7/10 — 0B, 1S, 0M. Rigorous delta calculation via `acceptedTurnCost` net of base; solid rate-drop tolerance in `isGrown`. Docked for pushing file size to 987 lines (near 1000-line cap) instead of extracting monotonicity helpers.

### `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Thorough tests covering reported vs unreported runs, mid-run rate drops, non-monotonic rejections, restored bases, and turn cost telescoping.

### `libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts`
Score 9/10 — 0B, 0S, 0M. Exemplary contract tests validating live-vs-disk parity across parent and subagent ledgers, verifying that `recordAgent` does not double-count spend.

### `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
Score 9/10 — 0B, 0S, 0M. Clean deletion of 69 lines of dead code (`addStats` and `propagateStatsToParent`) that had no production callers.

### `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`
Score 9/10 — 0B, 0S, 0M. Renames `cost` to `turnCost` in logging and broadcast payloads; compiles cleanly against the shared wire contract.

### `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts`
Score 8/10 — 0B, 0S, 1M. Types `SessionStatsResultEvent` and `SessionStatsSnapshotEvent` directly from `ResultStatsPayload`. Ensures snapshot events do not touch message costs.

### `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Validates that successive turn costs (10, 5) land on assistant message footers while header displays authoritative snapshot (15).

### `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`
Score 8/10 — 0B, 0S, 0M. Routes `stats.turnCost` to `pendingStats.cost` and last assistant message `cost`. Properly preserves `null` for unknown costs without fallback to 0.

### `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Pins message finalization and streaming state handling for positive, zero, and null turn costs.

### `libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Verifies that `agent-stats.service` correctly sums per-call costs across child message events, skipping undefined entries.

### `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts`
Score 7/10 — 0B, 1S, 0M. Implements single-pass aggregation of `knownCost` with lower-bound tracking (`totalCostIsLowerBound`). Docked for co-locating domain models and pure estimation functions inside an Angular service file.

### `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Tests 3-session fixture (full, partial, none) verifying that partial sessions contribute `knownCost` to the aggregate and set lower-bound markers.

### `libs/frontend/dashboard/src/lib/utils/format.utils.ts`
Score 7/10 — 0B, 1S, 0M. Formatting logic (`costValueClass`, `sessionShowsLowerBound`, `formatSessionCost`) prevents green zero rendering. Docked for importing from `session-analytics-state.service`.

### `libs/frontend/dashboard/src/lib/utils/format.utils.spec.ts`
Score 9/10 — 0B, 0S, 0M. Thorough unit tests for session cost formatting, neutral classes for unpriced sessions, and coverage notes.

### `libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts`
Score 9/10 — 0B, 0S, 0M. Standalone Angular 22 component with `OnPush` change detection and signals. Renders semantic `&ge;` entity with accessible `<span class="sr-only">At least</span>`.

### `libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. Validates lower-bound markers on total and average costs, tooltip construction, and neutral classes for unknown totals.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.ts`
Score 9/10 — 0B, 0S, 0M. Clean signal-based computed properties for cost text, classes, and lower-bound status. Follows DaisyUI/Tailwind design tokens.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. Verifies that partial sessions show `≥` with priced subtotal and CLI-only sessions show "Unknown", never "$0.00".

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-detail-modal.component.ts`
Score 9/10 — 0B, 0S, 0M. Standalone component with `OnPush` change detection. Correctly passes `sessionShowsLowerBound` and displays per-model cost breakdowns.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-detail-modal.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. Tests modal cost display and coverage note rendering for partial and unpriced sessions.

### `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.html`
Score 9/10 — 0B, 0S, 0M. Corrects explanatory copy to indicate that partly priced sessions are included as a lower bound, and CLI-lane runs are omitted.

### `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. End-to-end integration tests verifying rendered text, lower-bound indicators, and status line copy.

### `apps/ptah-tui/src/hooks/use-sessions.ts`
Score 8/10 — 0B, 0S, 1M. Consumes `sessionStats` snapshot rather than per-turn cost or model row; provides `sessionCostFor` helper to prevent displaying another session's money. Docked for untyped payload cast.

### `apps/ptah-tui/src/hooks/use-sessions.spec.ts`
Score 9/10 — 0B, 0S, 0M. Tests verifying push and batch derivations, session ID mismatch isolation, and preservation of previous costs.

### `apps/ptah-tui/src/lib/status-line.ts`
Score 8/10 — 0B, 0S, 1M. Updates `StatusLineStats` with nullable `costUSD` and `costPartial`; hides cost when null instead of displaying $0; prefixes partial cost with `'>='`.

### `apps/ptah-tui/src/lib/status-line.spec.ts`
Score 9/10 — 0B, 0S, 0M. Validates status line behavior for unknown and partial costs.

### `apps/ptah-tui/src/hooks/use-commands.ts`
Score 8/10 — 0B, 0S, 0M. `/status` command outputs "unavailable" for null cost and `>=$x (partial pricing)` for partial cost.

---

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| Angular 22 standalone components only | PASS | [`metrics-cards.component.ts:27`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts#L27), [`session-stats-card.component.ts:25`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.ts#L25) |
| Mandatory `ChangeDetectionStrategy.OnPush` | PASS | [`metrics-cards.component.ts:29`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts#L29), [`session-stats-card.component.ts:27`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.ts#L27) |
| Signals + `inject()` state management | PASS | [`session-analytics-state.service.ts:259-280`](../../../libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L259-L280) |
| No `[innerHTML]` on data | PASS | Clean in all templates (0 occurrences in diff) |
| Tailwind / DaisyUI tokens for styling | PASS | [`metrics-cards.component.ts:37-61`](../../../libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts#L37-L61) (`bg-base-200/50`, `text-success`, `text-base-content-muted`) |
| No new `as any` or `@ts-ignore` | PASS | 0 new instances introduced across all 37 files in diff |
| `catch (error: unknown)` narrowing | PASS | [`session-stats-owner.service.ts:805`](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L805) |
| Hexagonal boundary: frontend ↮ backend via `libs/shared` | PASS | Backend and frontend communicate solely via `@ptah-extension/shared` types |
| Cross-lib imports only via package barrels | PASS | No deep imports (`src/lib/...`) across project boundaries |
| Kebab-case file naming convention | PASS | All files follow `kebab-case.ts` / `.html` / `.spec.ts` |
| No dead code / delete unused code | PASS | Deleted dead `SessionMetadataStore.addStats` and `propagateStatsToParent` |
| Soft file ceiling (~700 lines) | FAIL | [`session-stats-owner.service.ts`](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L1-L987) at 987 lines |

---

## Maintenance debt

- Introduced: Dual monotonicity paths in `SessionStatsOwnerService` (`dollarsAreObserved`); coupling between `format.utils.ts` and `session-analytics-state.service.ts`.
- Retired: Dead code in `SessionMetadataStore` (`addStats`, `propagateStatsToParent`); duplicate `normalizeModelKey` in `stream-transformer.ts`; incorrect cumulative-as-message-cost wire semantic.
- Net: Negative debt. The architectural contract is vastly clarified; wire types prevent silent aliasing; dead code was removed; comprehensive contract and parity tests guard against recurrence.

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `SessionStatsOwnerService` is 987 lines long and should be refactored via the facade rule in the next cycle before it exceeds 1000 lines.
- What a 10/10 version would do differently:
  1. Extract `DashboardSessionEntry`, `AggregateTotals`, `SessionCostEstimate`, and `sessionCostEstimate` into `libs/frontend/dashboard/src/lib/models/session-analytics.models.ts` to eliminate the inverted `utils -> services` dependency.
  2. Extract `acceptedTurnCost`, `dollarsAreObserved`, `isSameUsage`, and `isGrown` from `SessionStatsOwnerService` into a dedicated collaborator (`session-stats-monotonicity.ts`) to bring the service well below 700 lines.
  3. Standardize client-side wire event types in `@ptah-extension/shared` rather than having each frontend service create an ad-hoc `Pick`/`Omit`/`Partial` slice.
