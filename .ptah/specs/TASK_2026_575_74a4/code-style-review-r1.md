# Code Style Review (Round 1) — `TASK_2026_575_74a4`

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 3                                    |
| Files reviewed  | 14                                   |

## Status of round 1 serious findings

### 1. Inverted dependency: utility module imports from Angular service module — RESOLVED

- **Files:**
  - [`libs/frontend/dashboard/src/lib/models/session-analytics.models.ts:1-105`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/models/session-analytics.models.ts#L1-L105) (new domain models module)
  - [`libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:22-25`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts#L22-L25)
  - [`libs/frontend/dashboard/src/lib/utils/format.utils.ts:1-4`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/utils/format.utils.ts#L1-L4)
  - [`libs/frontend/dashboard/src/lib/utils/token-segments.ts:1`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/utils/token-segments.ts#L1)
  - [`libs/frontend/dashboard/src/index.ts:24`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/index.ts#L24)
- **Verification:**
  - **Clean layering:** Pure domain interfaces (`DashboardStatsStatus`, `DashboardSessionEntry`, `SessionCostEstimate`) and calculation logic (`sessionCostEstimate`) were cleanly extracted into `session-analytics.models.ts`.
  - **Byte-identical logic:** In [`libs/frontend/dashboard/src/lib/models/session-analytics.models.ts:88-104`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/models/session-analytics.models.ts#L88-L104), `sessionCostEstimate` contains the exact byte-for-byte logic from round 0, preserving all lower-bound and nullability semantics without behavioural change.
  - **Dependency direction:** Utilities (`format.utils.ts`, `token-segments.ts`), components (`session-stats-card.component.ts`, `session-detail-modal.component.ts`, `analytics-card.component.ts`), and unit specs now depend downward on `models/session-analytics.models.ts` rather than upward on `services/session-analytics-state.service.ts`.
  - **Public API preserved:** [`libs/frontend/dashboard/src/index.ts:24`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/index.ts#L24) exports `DashboardSessionEntry` directly from `./lib/models/session-analytics.models`, preserving the public contract for external consumers with zero breakage.
  - **No backward-compatibility shim:** No deprecated re-export or alias shim was left in `session-analytics-state.service.ts`.

### 2. File size near 1,000-line hard ceiling: session-stats-owner.service.ts — RESOLVED

- **Files:**
  - [`libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts:1-94`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts#L1-L94) (new collaborator module)
  - [`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:50`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L50)
- **Verification:**
  - **Extraction of pure predicates:** Monotonicity predicates (`isSameUsage`, `isGrown`) and private `dollarsAreObserved` were moved to `run-result-monotonicity.ts`.
  - **Byte-identical logic:** The extracted functions in [`run-result-monotonicity.ts:18-93`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts#L18-L93) match the previous implementations byte-for-byte, preserving dual-mode checks (`'reported'` dollar monotonicity vs `'unreported'` tokens-only monotonicity).
  - **No runtime circular dependency:** `run-result-monotonicity.ts` has no DI and no runtime state. It imports `RunUsageResult` via `import type { RunUsageResult } from './session-stats-owner.service'` ([`run-result-monotonicity.ts:8`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts#L8)). TypeScript completely erases this type import at compile time, ensuring no circular module evaluation at runtime.
  - **Pragmatic boundary cut:** `acceptedTurnCost`, `subtractRunBase`, and `resolveRunBase` remain in `session-stats-owner.service.ts` because unit specs import `resolveRunBase` and `subtractRunBase` from the service path; extracting them would cause circular imports or unnecessary spec churn.
  - **File length compliance:** `session-stats-owner.service.ts` dropped from 987 lines to 903 lines (an 84-line reduction). Under the repository guideline (*"soft file ceiling 700 lines warn; past 1000 warrants a deliberate look, not a reflex split"*), 903 lines safely retreats from the 1000-line ceiling while maintaining high cohesion of owner lifecycle state.
  - **Repository naming conventions:** The new file uses `run-result-monotonicity.ts` (kebab-case, domain-specific name; no generic `utils` or `helpers`).

---

## Blocking issues

None.

---

## Serious issues

None remaining. Both round 0 serious findings are resolved.

---

## Minor issues (carried over from round 0)

1. **Heterogeneous wire payload derivations across consumers:** [`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L39-L45`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts#L39-L45), [`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L220-L224`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L220-L224), and [`apps/ptah-tui/src/hooks/use-sessions.ts#L52`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/hooks/use-sessions.ts#L52). Each consumer creates a distinct `Pick`, `Omit`, or `Partial` slice of `ResultStatsPayload`.
2. **Untyped payload cast in TUI controller:** [`apps/ptah-tui/src/hooks/use-sessions.ts#L336`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/hooks/use-sessions.ts#L336) passes `payload as SessionStatsPush` directly from an `unknown` event argument without structural validation.
3. **Formatting divergence between TUI and webview:** [`apps/ptah-tui/src/lib/status-line.ts#L120`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/lib/status-line.ts#L120) and [`apps/ptah-tui/src/hooks/use-commands.ts#L317`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/hooks/use-commands.ts#L317) use ASCII `'>='` while webview components use `&ge;` (`≥`) with screen-reader text.

---

## File-by-file

### `libs/frontend/dashboard/src/lib/models/session-analytics.models.ts`
Score 10/10 — 0B, 0S, 0M. New domain model file housing `DashboardStatsStatus`, `DashboardSessionEntry`, `SessionCostEstimate`, and `sessionCostEstimate`. Pure, self-contained, and depends only on `@ptah-extension/shared`.

### `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts`
Score 9/10 — 0B, 0S, 0M. Cleans out co-located domain models and calculation functions in favor of importing `session-analytics.models.ts`. Reduced to 597 lines with zero re-export shims.

### `libs/frontend/dashboard/src/lib/utils/format.utils.ts`
Score 10/10 — 0B, 0S, 0M. Now imports from `../models/session-analytics.models`. Dependency direction is strictly unidirectional (`utils -> models`).

### `libs/frontend/dashboard/src/lib/utils/token-segments.ts`
Score 10/10 — 0B, 0S, 0M. Imports `DashboardSessionEntry` from `../models/session-analytics.models`, removing transitive coupling to the Angular service.

### `libs/frontend/dashboard/src/index.ts`
Score 10/10 — 0B, 0S, 0M. Barrel re-exports `DashboardSessionEntry` from `./lib/models/session-analytics.models`, preserving the public contract.

### `libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts`
Score 10/10 — 0B, 0S, 0M. New pure collaborator module containing `isSameUsage`, `isGrown`, and `dollarsAreObserved`. Type-only import of `RunUsageResult` ensures zero runtime circular dependency.

### `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`
Score 9/10 — 0B, 0S, 0M. Imports `isGrown` and `isSameUsage` from `./run-result-monotonicity`. File size successfully reduced to 903 lines, safely beneath the 1000-line hard ceiling.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.ts`
Score 9/10 — 0B, 0S, 0M. Updated import to `./models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-detail-modal.component.ts`
Score 9/10 — 0B, 0S, 0M. Updated import to `./models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts`
Score 9/10 — 0B, 0S, 0M. Updated import to `./models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.spec.ts`
Score 9/10 — 0B, 0S, 0M. Tests updated to import `sessionCostEstimate` from `../models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/utils/format.utils.spec.ts`
Score 9/10 — 0B, 0S, 0M. Spec updated to import `DashboardSessionEntry` from `../models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. Spec updated to import `DashboardSessionEntry` from `../models/session-analytics.models`.

### `libs/frontend/dashboard/src/lib/components/session-analytics/session-detail-modal.component.spec.ts`
Score 9/10 — 0B, 0S, 0M. Spec updated to import `DashboardSessionEntry` from `../models/session-analytics.models`.

---

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| ------------------------------------ | ------ | -------- |
| Angular 22 standalone components only | PASS | `libs/frontend/dashboard/src/lib/components/*` |
| Mandatory `ChangeDetectionStrategy.OnPush` | PASS | All dashboard presentation components comply |
| Clean dependency flow (no utils -> services) | PASS | [`format.utils.ts:1-4`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/utils/format.utils.ts#L1-L4) imports from `models/` |
| No runtime circular dependencies | PASS | [`run-result-monotonicity.ts:8`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/run-result-monotonicity.ts#L8) uses `import type` |
| File ceiling (avoid >1000 lines) | PASS | [`session-stats-owner.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L1-L903) reduced to 903 lines |
| Public API backward compatibility | PASS | [`libs/frontend/dashboard/src/index.ts:24`](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/index.ts#L24) exports `DashboardSessionEntry` |
| No dead shims or backward-compat aliases | PASS | `session-analytics-state.service.ts` contains no redundant re-exports |
| Purpose-driven naming (no helpers/utils dump) | PASS | `run-result-monotonicity.ts`, `session-analytics.models.ts` |

---

## Maintenance debt

- Introduced: None.
- Retired: Inverted utility-to-service import in `format.utils.ts`; monolithic monotonicity logic inside `session-stats-owner.service.ts`.
- Net: Negative debt. The structure is significantly more legible, cohesive, and maintainable.

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: None. The architectural refactors cleanly resolved both serious findings with zero behaviour change, zero circular imports, and full test/lint/typecheck pass.
- What a 10/10 version would do differently:
  1. Unify client-side wire event types across `chat`, `chat-streaming`, and `ptah-tui` into `@ptah-extension/shared`.
  2. Add runtime schema validation to `use-sessions.ts` event handlers before processing `unknown` push payloads.
