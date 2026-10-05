REVISE — 4/10

# Phase 6 Code Review — `TASK_2026_596_0a19`

Scope: the supplied committed range `c1ee76c22^..46ba54af7` for `libs/frontend` and `apps/ptah-extension-webview`, with the binding Gate 2 amendments, design §1–§4/§8, and Batches 16–21. I read the affected limit store, chat host, tile view-model/renderers, dashboard card, and the relevant session-routing implementation. The focused Chat UI plan-limit Jest run passed: 4 suites / 54 tests. That run does not exercise multi-surface loading, push-versus-failed-pull ordering, or an unresolved parent session.

1. **Serious — grid panes overwrite each other's fetch scope.** `libs/frontend/core/src/lib/services/plan-limits.store.ts:78,98-101`

   Failure scenario: open two grid-mode chat surfaces for different sessions. Each surface calls `load({sessionIds, ownerKeys})`; the shared `scope` is overwritten/merged as a single last-caller state, rather than retained per live surface. The request and subsequent host push therefore omit the other surface's session or historical run owner. That tile then renders its owner/usage as unavailable even though the host has the data. This is a common grid-mode action and is a silent, success-looking loss of quota information.

   Fix: make scope registration per surface. A registration must own its `sessionIds` and `ownerKeys`; each load must send the de-duplicated union of all registrations; `DestroyRef` must release that registration. The in-progress design using `registerScope(destroyRef)`, `Map`-backed registrations, unioning in the request, and release on destroy is the correct design. It needs committed integration coverage for two simultaneous sessions, one scope shrinking, and destruction of one surface.

2. **Serious — a failed pull can erase a newer pushed snapshot.** `libs/frontend/core/src/lib/services/plan-limits.store.ts:196-207`

   Failure scenario: a `planLimits:changed` push installs a current snapshot while an earlier request is still in flight. The request then fails or is malformed. `applyEmpty()` writes an empty snapshot using browser `Date.now()` without comparing against the installed snapshot's `generatedAt`; unlike `apply()`, it bypasses the ordering guard. If the pushed host timestamp is later than the browser timestamp (or simply represents newer evidence), the UI replaces current windows, owner identities, and reset data with an empty successful-looking “unavailable” state.

   Fix: route the failure state through the same monotonic snapshot ordering rule, or retain the last valid snapshot and expose a separate load-error state. Never use a local timestamp to outrank host-generated evidence. Add a push-then-failed-pull regression test.

3. **Serious — an unowned lane is rendered in every session's quota tiles.** `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:475-478`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:866-869`

   Failure scenario: immediately after a lane is created, its `parentSessionId` has not resolved. `agentsForSession()` intentionally applies the falsy-tolerant `agentVisibleInSession` rule, so every mounted chat view receives that run. `sessionLaneRuns()` passes the result to the new plan-limit view model, making one lane's tokens, cost, state, and owner label appear in every session's lane tiles until attribution arrives. This contradicts the two-session isolation requirement and can disclose work/account information across concurrently visible session tiles.

   Fix: quota/stat tiles must use an exact-parent-session accessor (unresolved parent means no session tile yet), while preserving any deliberate global visibility only for the agent-monitor UI. Add the Batch 20 regression with two mounted sessions and a lane transitioning from unresolved to one resolved parent.

4. **Moderate — lane model scope is permanently unknown, so model-specific quota cannot be evaluated.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:87-105`; `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:170-212`

   Failure scenario: a lane runs on an owner with an Opus-only weekly window or model-scoped owner evidence. `toStatsLimitLaneRun()` always sends `modelScope: null`, even when the lane record has a model. The shared evaluator correctly conservatively returns `model-scope-unknown`; it will never show that lane's applicable model window or an actual at-limit state. The informational tone is correct, and it does not borrow another model's quota, but permanent “Model unknown” defeats the requested per-model detection for affected lanes.

   Fix: persist and pass an authoritative backend-resolved model scope with the lane run (or explicitly keep this as a documented unavailable capability). Do not infer it from a display model string. Cover an Opus lane in a Sonnet session and confirm the model-specific window is evaluated after the scope arrives.

## Five logic questions

1. **How does this fail silently?** The shared scope collision (`plan-limits.store.ts:78,98-101`) drops another grid surface from a normal request; the stale-empty path (`:196-207`) replaces fresh data with “unavailable.” Neither reports a visible fetch failure tied to the lost session.
2. **What user action produces unexpected behaviour?** Opening two session tiles, or creating a lane before its parent session resolves, displays missing quota for one tile or the transient lane in every tile (`agent-monitor.store.ts:475-478`, `chat-view.component.ts:866-869`).
3. **What input data makes this produce a wrong answer rather than an error?** A model-scoped window with a lane whose run has no resolved scope produces “Model unknown,” not the lane's actual window state (`chat-view.component.ts:104`; `lane-tiles.ts:211-212`).
4. **What happens when a dependency fails, times out, or returns a shape it should not?** A malformed or failed RPC is converted to an empty snapshot (`plan-limits.store.ts:150-157`), which can supersede a newer push because `applyEmpty()` has no `generatedAt` guard (`:203-207`). Malformed pushes are correctly ignored (`:163-171`).
5. **What is missing that the requirements never mentioned?** The requirements specify scopes and release but do not state the atomic behaviour when a live push races a failed pull. The implementation needs an explicit “retain last good snapshot + load error” contract and test.

## Requirements fulfilment

| Requirement | Status | Evidence |
| --- | --- | --- |
| Unknown is never zero; informational estimate/model-scope notes | Complete in examined VM | `lane-tiles.ts:105-135,394-438`; `plan-window-detail.component.ts:39-68` |
| A1/R7 no owner borrowing | Complete in examined VM | `lane-tiles.ts:186-206,209-275` |
| A2 no hidden model window | Complete in examined VM | `lane-tiles.ts:218-239` |
| A3 view-scoped, stable expansion retention | Complete | `stats-tile-expansion.state.ts:3-45`; `chat-view.component.ts:187-192` |
| Local zone and locale, not UTC | Complete | `chat-view.component.ts:855-859`; `provider-account-card.component.ts:340-345` |
| Requirement 8: lane usage outside session totals | Complete in examined UI path | `stats-limit-view-model.ts:11-16,50-61`; `lane-tiles.ts:105-136,600-611` |
| Grid-surface scope isolation | Missing in committed range | Finding 1 |
| Push/failure freshness ordering | Missing | Finding 2 |
| Two-session lane isolation before parent resolution | Missing | Finding 3 |

## What is correct

- The tile disclosure is a real button with `aria-expanded`, `aria-controls`, a hidden sibling panel, and stable view-scoped `${sessionId}::${tileId}` expansion keys (`plan-limit-tile.component.ts:41-105`; `stats-tile-expansion.state.ts:3-45`).
- Owner comparison is conservative: missing/unknown recorded owners render “Unknown owner” and borrow no current-session windows (`lane-tiles.ts:186-206`); different owners retain their own snapshot (`:209-275`).
- Lane token and cost subtotal data is modeled separately from session totals, and unknown usage remains textually unknown rather than zero (`stats-limit-view-model.ts:11-16`; `lane-tiles.ts:105-136,600-611`).
- Reset time formatting receives the host zone and Angular locale rather than a hard-coded UTC value (`chat-view.component.ts:855-859`; `provider-account-card.component.ts:340-345`).
- The dashboard uses standalone/OnPush/inject patterns and does not contain the forbidden `text-base-content/NN` classes in the reviewed card. No TODO/PLACEHOLDER/STUB marker or empty implementation body was found in the reviewed plan-limit UI files.

## Re-review (fix round 1)

REVISE — 6/10

Re-reviewed only the uncommitted fixes for findings 1–3, the fix report, and their focused specs. Finding 4 (authoritative lane model scope) remains the named follow-up and was not re-scored as a fix-round regression.

1. **Resolved — grid scope isolation.** `libs/frontend/core/src/lib/services/plan-limits.store.ts:144-161,203-217`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:867-871,1065-1074`; `libs/frontend/core/src/lib/services/plan-limits.store.spec.ts:318-410`

   Each chat surface now receives a distinct registration; `DestroyRef` releases it, later updates after release are ignored, and request construction unions and de-duplicates every live surface's `sessionIds` and `ownerKeys`. The focused specifications cover interleaved panes, duplicate ids, an empty pane, dashboard provider-only loads, explicit release, and destruction. The dashboard's `{ providerId }` load retains chat scope. No remaining finding for original finding 1.

2. **Moderate — refresh failure is retained but not disclosed.** `libs/frontend/core/src/lib/services/plan-limits.store.ts:84-95,175-194,220-234`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:886-903`; `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:350-367`

   Failure scenario: a user presses Refresh while a valid snapshot is held and the RPC fails or is malformed. `applyLoadFailure()` correctly preserves the snapshot and sets `loadError`; the empty first-read placeholder is correctly stamped `generatedAt: 0`, so browser time cannot outrank host evidence. The push-then-failed-pull regression is covered (`plan-limits.store.spec.ts:474-510`). However, neither the chat limit model nor the dashboard reads `PlanLimitsStore.loadError()`. For up to the normal freshness interval the retained windows can continue to look current, and the explicit refresh has no visible failure result. The shared classifier will eventually age each window from its own `observedAt`, so this is not permanent fresh-looking data and is safer than clearing live evidence; it is still a silent failed refresh during that interval.

   Fix: surface `loadError` as a neutral/stale “refresh failed — showing last observed data” notice adjacent to the retained snapshot, including the observation time already available in the window model. Keep the existing age-based classification; do not mutate the host snapshot or invent a browser timestamp.

3. **Resolved — unresolved lanes no longer leak into every session's quota tiles.** `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:475-490`; `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:862-881`; `libs/frontend/chat-streaming/src/lib/agent-monitor.empty-session-id.spec.ts:348-377`

   The new exact-parent accessor returns no lane for an unresolved or empty parent and is used by both tile construction and owner-key scope calculation. The old tolerant `agentsForSession()` remains unchanged for agent-monitor visibility. The regression proves unresolved-to-resolved ownership moves the lane to one session only. No remaining finding for original finding 3.

No regression was found in the prior correct paths: unknown usage remains distinct from zero; owner/model separation remains conservative; stable expansion and local-time formatting are untouched; lane subtotals remain outside session totals.

## Re-review (bounded correction)

APPROVED — 8/10

No remaining findings in this bounded correction.

The retained-snapshot failure state is now visible without changing the snapshot: `PlanLimitsStore.applyLoadFailure()` retains held data and marks the error, while `apply()` clears that error before preserving the newer-host-snapshot rule (`libs/frontend/core/src/lib/services/plan-limits.store.ts:234`, `libs/frontend/core/src/lib/services/plan-limits.store.ts:248`). The chat binding forwards that state into the chat-ui view model (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:898`), whose status message only exists for a failed refresh with held owners and uses the shared local absolute-time formatter (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.ts:78`). The summary renders it as the neutral `role="status"` line (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:73`); the dashboard applies the same held-owner gate and formatter (`libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:378`, `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:475`).

The focused specs cover the chat forwarding/clear transition, absent-owner suppression, local-time observation text, both summary layouts, and dashboard failure-then-push behavior. The exact-parent lane accessor and per-surface scope registration remain present (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:851`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:867`). No chat-ui import of an orchestrator library or prohibited `text-base-content/NN` class was introduced in the reviewed paths.

## Re-review (visual fix round)

APPROVED — 8/10

No remaining findings in this visual-fix scope.

The dashboard section header now permits a narrow viewport to wrap its non-shrinking chip/action group below a title block with a bounded basis, while status-chip text remains unbroken (`libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:154`). The shared tile-face class uses the base-content focus outline for plan, lane, and subtotal tiles, replacing the low-contrast info outline without adding prohibited text-colour classes (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile.styles.ts:21`).

The restored-lane face is safe: it looks up only the recorded lane owner snapshot (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:213`), suppresses last-known rendering for an actual same-owner match (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:329`), and builds its neutral `Last known` chip solely from that snapshot's rendered windows or owner evidence (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:347`). Its state remains `unknown`; an unknown value or no owner evidence still reads `Limit unknown` rather than zero (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:351`). The explicit panel wording identifies the data as last-known, so it cannot represent a current read (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:394`). Unknown identities continue through the early unknown-owner branch and cannot be classified as same owner (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:189`). The mapping uses a display name or the typed product label, never a raw CLI id (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:110`).

Focused specs prove the recorded-owner 60% value is used instead of the current session owner's 40%, retain `unknown` state, preserve unknown-value fallback, render the restored Ptah CLI label, and assert the new focus class (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts:626`, `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts:289`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1733`). The prior scope-union, push/failure, exact-parent, and load-error-notice mechanisms remain intact (`libs/frontend/core/src/lib/services/plan-limits.store.ts:144`, `libs/frontend/core/src/lib/services/plan-limits.store.ts:234`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:882`, `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:916`).
