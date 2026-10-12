# Batch 17F — Phase 4 review fix (code-logic Finding 2)

## Part A — backend

**Finding**: `begin` returned `accepted: true` for a live op in `closing`, where `captureDraft` declines the composer text; the frontend cleared the composer on any accepted result, so the text was lost.

**Contract** (`libs/shared/src/lib/types/session-handover.types.ts`): the accepted branch of `BeginSessionHandoverResult` gains `readonly draftCaptured?: boolean` — true only when the operation now owns the `queuedInput` text; absent/false means the caller keeps its composer text.

**Coordinator** (`libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`, `begin`): the `captureDraft` result now becomes a `{ draftCaptured: true }` fragment that is added to every accepted return (the non-gatable repeat, the `continueNow` start and the gate). Which phases capture (`DRAFT_CAPTURE_PHASES`) is unchanged. G1-G5 are unchanged: only `begin` sets `userConfirmed`, and only `startConfirmed` calls `complete()`.

**Pass-through**: `requestFromAgent` does not take a draft, so it never sets the field. The `session:beginHandover` handler (`libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts:99`) returns `coordinator.begin(...)` without changing it. rpc-handlers was not edited.

**Specs** (coordinator spec, D24 block):
- `reports draftCaptured only when the op took the composer text`: a begin with no text has no field; `waiting-for-turn-end` and `starting-successor` return `draftCaptured: true`.
- `never takes or claims the composer text at closing (Finding 2)`: begin at `closing` is accepted, `draftCaptured` is falsy, the "Draft not captured" warning is logged, and the late text is never delivered.

**Verification** (under the shared lock, scoped):
- jest coordinator spec (`--maxWorkers=2 --coverage=false`): 64/64 passed. Note: the vscode mapper in the brief (`mocks/vscode.ts`) does not exist. I used `__mocks__/vscode.ts` instead.
- `npx nx typecheck shared --parallel=1 --skip-nx-cache`: passed.
- `npx nx typecheck agent-sdk --parallel=1 --skip-nx-cache`: passed.
- eslint on the 3 changed files: 0 errors. One warning remains, `no-useless-assignment` on `delivered`, and it was there before this change. `max-lines` is kept at the 700 limit.

**Deviations**: none in behaviour. I compacted `begin` to stay within `max-lines`.

**For the frontend**: clear the tab's queued content only when `result.accepted && result.draftCaptured === true`.

## Part B — frontend

**Fix 1 (logic F2, data loss)** — `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts` `beginHandover`: on an accepted begin, the tab's queued content is cleared (still only when it equals the text sent) and the operation id is added to `queuedInputOperations` only when `queuedInput && data.draftCaptured === true`. Any other accepted result (e.g. at `closing`) keeps the composer text and does not show "Your queued message will be sent…".

**Fix 2 (logic F1)** — `session-budget-banner.component.ts`: new `handoverCancellable` computed (`phase === 'writing-handoff'`); "Cancel (keep working)" renders only then. This matches the coordinator's `CANCELLABLE_PHASES` among the progress phases. The other cancellable phases are already covered: `waiting-for-turn-end` (Cancel in handover-waiting), `awaiting-confirmation` (agent-request Cancel; a parked user begin shows the handoff/limit stage), `failed` ("Keep working"). `armed` has no banner action.

**Fix 3 (style F1)** — `ENDED_HANDOVER_PHASES` (`ReadonlySet<SessionHandoverPhase>`: closed, failed, cancelled) is exported from `libs/shared/src/lib/types/session-handover.types.ts`, directly after the phase type (append only; `BeginSessionHandoverResult` is untouched), and reaches consumers through `libs/shared/src/index.ts:56`. The local copies in `chat-view.component.ts` and `session-budget-actions.service.ts` are removed, both now import the shared set, and the now-unused `SessionHandoverPhase` imports are gone.

**Fix 4 (style F2)** — one pure `displayBudgetStage(stage, live)` (with `STAGE_RANK`) in `components/molecules/notifications/session-budget-format.ts`. The service's `displayStage` and the banner's private `displayStage` both call it; the banner's hand branching and the service's `STAGE_RANK` are removed. I kept the banner free of the service, as the brief's alternative allows. Its existing input is `liveStage`, not a display stage, so switching inputs would have changed its API and its specs. The service already imports a util from `components/` (`stream-presentation-store.service.ts:18`), so this follows existing precedent. The behaviour is identical: live limit wins, live handoff wins over anything below limit, and otherwise the authoritative stage is shown.

**Specs**
- actions: the existing accepted begins that expect clearing or the carried flag now send `draftCaptured: true` (continue transfer, newer-content preservation, `continueNowAnyway` at `starting-successor`, R5 flagged). New: `keeps the composer text when an accepted begin did not capture it (closing)`. It checks no clear, the text is unchanged, and the carried flag is not set.
- banner: new `offers Cancel only while the handoff is written…`, which shows Cancel in `writing-handoff` and no Cancel in `starting-successor`, `successor-confirmed` or `closing`.

**Verification** (each run under the shared lock, scoped)
- jest on the actions, banner and chat-view specs (`--maxWorkers=2 --coverage=false`, marked + `__mocks__/vscode.ts` mapper): 3 suites, 221/221 passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed.
- `npx nx typecheck shared --parallel=1 --skip-nx-cache`: passed.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: passed, 0 errors and 34 warnings in total. eslint on the 7 changed files gives 0 errors and 1 warning, `max-lines` on `chat-view.component.ts` (1218 > 700). That warning was there before this change, which only removes lines from the file.

**Deviations**: Fix 4 uses the shared pure function rather than a new banner input, for the reason above. No change in behaviour.
