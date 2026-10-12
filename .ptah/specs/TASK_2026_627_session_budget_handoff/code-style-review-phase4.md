# Code Style Review, Phase 4 new public API (TASK_2026_627, Batches 9-17)

Score: 7/10. Verdict: REVISE (small, cheap consolidations; no boundary or type-safety break).

Scope examined: the shared contract additions, `requestFromAgent`, `parkLimitHandoverIfIdle`, `peekDraft`/`acknowledgeDraft`, `restoreDraftToInput`, the banner inputs/outputs, `session-budget-format.ts` and the chat-view bindings. No lint or test run was needed; this is a read-only structural pass over the diff.

## What passes

- Imports use the `@ptah-extension/shared` barrel; no deep imports or new cross-layer edges were found.
- The banner is OnPush with `input()`/`output()`; `ChatViewComponent` uses `inject()`, `computed` and `untracked`.
- No new `any`. `import type` is used in `session-budget-format.ts`.
- Return types are explicit on the new methods (`requestFromAgent`, `parkLimitHandoverIfIdle`, `peekDraft`, `restoreDraftToInput`, the `onBudget*` handlers).
- `SESSION_BUDGET_ACTIONS` uses `satisfies`.
- `session-budget-format.ts` is pure and has a single responsibility.
- The `lanes: null` and `draftText` doc comments say what the value means.

## Findings

### 1. Serious: `ENDED_HANDOVER_PHASES` is defined twice (the flagged item)

- Evidence: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:93` and `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:80` hold the same set, `closed|failed|cancelled`. Their doc comments already differ: "nothing is pending" in one, "no longer carries anything" in the other.
- Cost: the two sets gate different decisions. The chat-view copy decides whether the banner shows while streaming (`chat-view.component.ts:973`). The actions-service copy decides pending state (`session-budget-actions.service.ts:247`). A new terminal phase added to `SessionHandoverPhase` would have to be added in two places, and a miss would show the banner in one place but not the other.
- Fix: yes, one shared export. Put a single `isHandoverEnded(phase)` (or the set) next to `SessionHandoverPhase` in `libs/shared/src/lib/types/session-handover.types.ts`, in the same way `isTerminalTurnPhase` sits beside its type in `stream-background.ts:231-249`. Better still, expose an `isPending` computed from `SessionBudgetActionsService`, since chat-view already injects it, and delete both local sets.

### 2. Serious: display-stage logic duplicated in the banner and the actions service

- Evidence: the banner's private `displayStage` (`session-budget-banner.component.ts:508-519`) uses hand-written branching. `SessionBudgetActionsService.displayStage` (`session-budget-actions.service.ts:222-229`) uses `STAGE_RANK`. Both compute "higher of the authoritative and live stage".
- Cost: the two implementations are already shaped differently. Chat-view's mid-turn visibility uses the service's version and the banner's content uses its own. If the stage ladder changes (for example a new stage between handoff and limit), the banner could stay hidden while its content is computed differently.
- Fix: choose one owner. Either pass `displayStage` as an input from the service, or export a `higherStage(a, b)` helper from a shared file (for instance `session-budget-format.ts`, or next to `SessionBudgetStage`) and use it in both places.

### 3. Moderate: the literal `'handoff' | 'limit' | null` is repeated 7 times with no named type

- Evidence:
  - `libs/shared/src/lib/types/messages/session-stats-live.ts:37`
  - `libs/shared/src/lib/types/agent-adapter.types.ts:123`
  - `libs/frontend/chat-types/src/lib/chat-types.ts:662`
  - `session-budget-actions.service.ts:32` and the `liveStage` computed generic at about `:63`
  - `session-budget-banner.component.ts:465`
  - plus `LiveBudgetStage` as a local alias in `session-stats-live.ts:40`
- `SessionBudgetStage` already exists at `libs/shared/src/lib/types/session-budget.types.ts:15`.
- Fix: export `type SessionLiveBudgetStage = Extract<SessionBudgetStage, 'handoff' | 'limit'>` from shared and use it everywhere. This also removes the need for the local alias.

### 4. Moderate: naming drift across the new surface

- Evidence:
  - The same concept is `liveBudgetStage` (wire, tab and adapter), `liveStage` (service and banner input) and `LiveBudgetStage` (type alias).
  - The banner pairs input `wrapUpRequested` with output `requestWrapUp`.
  - The banner output is `continueNowAnyway` while the wire field is `continueNow`.
  - `approveAgentRequest` is routed to `continueInNewSession` (`chat-view.component.ts:1362`), so the output name and the action name do not line up.
- Cost: this is the surface a new maintainer greps. Prefer one root name. Pick `liveBudgetStage` for stored state and `liveStage` only for the banner input, and say so once in a comment, or rename consistently.

### 5. Moderate: `WRAP_UP_UNAVAILABLE_NOTICE` is narrower than the error code it renders

- Evidence: the shared doc (`session-budget.types.ts:317-320`) lists four causes: no budget entry, not at the handoff or limit stage, no turn running, or the host cannot deliver the notice. The frontend constant at `session-budget-actions.service.ts:66-67` always says "The agent is not working on a turn right now."
- Cost: the user gets a misleading message for three of the four causes.
- Fix: use a generic message, such as "The agent could not be asked to wrap up right now."

### 6. Minor: `peekDraft` widens a typed field to `unknown`

- Evidence: `session-handover-client.service.ts:` `const text: unknown = state.draftText;` followed by a `typeof` check. `draftText` is already typed `string | undefined`.
- Cost: this suggests the type is not trusted and adds noise. If the intent is to guard wire data, validate in the transport parser. If not, use `const text = state.draftText` and `if (!text?.trim())`.

### 7. Minor: `SESSION_BUDGET_ACTIONS` is not checked for exhaustiveness

- Evidence: `libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.schema.ts:16-24`. `satisfies readonly SessionBudgetAction[]` only proves every listed item is valid. It does not prove none is missing, so a new union member would be rejected by the zod enum at runtime.
- Fix: add a compile-time check that `SessionBudgetAction` is assignable to `(typeof SESSION_BUDGET_ACTIONS)[number]`, or derive the union from the array.

### 8. Minor: `armAtTerminal(…, true, rec.messageQueue)` takes a bare boolean

- Evidence: `session-lifecycle-manager.ts:547-551` passes a positional `true` for `atBlockingLimit`. The call is readable only because of the method's doc comment.
- Suggestion: acceptable now. It would read better with a named options object if the coordinator is split (627-L7 is already deferred, so no action is needed).

### 9. Minor: `restoreDraftToInput` and `restoreContentToInput` overlap

- Evidence: `chat-input.component.ts` around 1500-1520. The two methods are documented against each other and differ only in the merge policy. This is acceptable, because the drop-versus-append behaviour is a deliberate difference (D24), and it is documented. Keep as is. No action is required beyond a cross-reference in `restoreContentToInput`'s doc comment.

## Pattern compliance

| Convention | Status | Evidence |
| --- | --- | --- |
| Barrel imports only (`@ptah-extension/shared`) | PASS | no deep imports in the diff |
| Standalone, OnPush, `input()`/`output()` | PASS | `session-budget-banner.component.ts:430-496` |
| `inject()` DI, no constructor injection | PASS | `session-handover-client.service.ts` (`inject(ClaudeRpcService)`) |
| Explicit return types, no new `any` | PASS | all new methods |
| `import type` for type-only imports | PASS | `session-budget-format.ts:1-4` |
| Single shared definition for repeated domain constants | FAIL | findings 1, 2, 3 |
| Typed shared contract with the closed set enumerated | PARTIAL | finding 7 |
| Naming consistent across layers | PARTIAL | finding 4 |

## Verdict

REVISE. The structure is sound and respects the layer and import boundaries. Findings 1 to 3 are cheap consolidations that remove three drift points in the new public surface. Finding 5 is a small user-facing correctness issue in the copy. The rest are minor.

Confidence: HIGH on findings 1 to 3, 5 and 7, which were checked at file:line. MEDIUM on finding 4, which is a naming preference.
