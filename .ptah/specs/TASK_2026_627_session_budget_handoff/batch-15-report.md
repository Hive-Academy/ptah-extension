# Batch 15 report — Frontend services: live stage, draft bookkeeping, actions (F1)

Executor: frontend-developer. No git operations run. Only Batch 15 files were edited.

## Task 15.1: Aggregator applies and clears `liveBudgetStage` — implemented

- `handleLiveSessionStats`: for each bound tab, `installSessionStats` returns whether the revision
  floor admitted the snapshot. Only when it did and the payload carries the field
  (`liveBudgetStage !== undefined`) is `TabManagerService.setLiveBudgetStage(tab, session, stage)`
  called. Absent field: no change. `null`: clear. Value: set. The surface path (no tab) is unchanged.
- `handleSessionStats`: a turn result (not a snapshot-only broadcast) clears the stage on every bound
  tab, next to `clearCompactionState`. A snapshot-only broadcast returns before that.
- Spec (`describe('liveBudgetStage')` in the real-TabManager live suite, S21): a value sets it; absent
  keeps it; `null` clears it; a rejected (older) revision changes nothing, neither a value nor `null`;
  a result clears it; a snapshot-only `session:stats` does not. The mock-TabManager suite got a
  `setLiveBudgetStage` stub (the result path now calls it); no existing assertion changed.

## Task 15.2: `peekDraft` and `acknowledgeDraft` — implemented

- `peekDraft(sessionId)` returns `{ operationId, text }` only for a `cancelled`/`failed` state whose
  `draftText` is a string that is not empty after trimming, and whose operation is not acknowledged.
  It reads only; nothing is mutated. R-P6: the boundary guard does not validate `draftText`, so
  `peekDraft` checks `typeof === 'string'` itself (spec covers a numeric `draftText`).
- `acknowledgeDraft(operationId)` adds to a private `Set` on the root-provided service, so a canvas
  tile and the main panel share it.
- Spec (S20 part): peek in both terminal phases, twice, no change and no RPC; ignored in
  `waiting-for-turn-end`/`awaiting-confirmation`/`starting-successor`/`closed`; null without a draft,
  for whitespace, for a non-string; acknowledgement hides only that operation (a later operation's
  draft is offered).

## Task 15.3: `SessionBudgetActionsService` — implemented

- `SessionBudgetView.activeTab` widened with optional `status` and `liveBudgetStage` (the chat view
  already passes the full `TabState`, so no view change is needed).
- New public signals: `turnRunning` (`status === 'streaming'`), `liveStage` (counts only while
  streaming and with a non-null tab budget), `displayStage` (higher of `budget().stage` and
  `liveStage` by rank; `null` without a budget; R-P4), `wrapUpRequested`, `queuedMessageCarried`.
- `requestWrapUp()`: allowed only while a turn runs at display stage `handoff`/`limit` and not
  already requested for `${sessionId}|${stage}`. The key is a `linkedSignal` reset when the
  tab/session changes or `turnRunning` flips, so it re-enables when the tab leaves `streaming`; a
  higher stage is a new key. It goes through `runAction('request-wrap-up')`. A `WRAP_UP_UNAVAILABLE`
  refusal shows the info notice "The agent is not working on a turn right now." (not an error). Any
  other failure clears the key so the user can retry.
- `continueNowAnyway()`: the same begin path with `continueNow: true`. `continueInNewSession()`
  sends no `continueNow`. Both share one private `beginHandover(continueNow)`. It is also the
  Approve path for an agent request (documented). The S12 gone-source fallback is unchanged and
  green.
- `queuedContent` is still cleared only on `accepted`, and only when it is unchanged. When the
  accepted begin sent a non-empty `queuedInput`, its `operationId` is added to a per-view set.
  `queuedMessageCarried` is true while the shown session's handover has that id and has not reached
  `closed`/`failed`/`cancelled` (R5 copy, R-P11).
- `cancelHandover` already recorded the returned `state` via `handoverClient.record` (revision
  guarded). R-P7 is now pinned by a spec: the cancel result's `draftText` is reachable through
  `peekDraft`.
- No captured text goes through `sendOrQueueMessage`. The specs assert that the send mock is not
  called on continue now and on cancel.
- Spec cases added (S12 untouched, S13, S18, S21 display half / 627-L16 display half): display
  stage rise, no lowering, ignored on `loaded`/`awaiting-background`/`resuming`, null without a
  budget; wrap-up once per stage, a new stage allows one more, reset after leaving streaming, no call
  while idle or below handoff, the refusal notice, re-enable after a transport error; continue now
  payload; continue never sends `continueNow`; R5 flag set / not set without queued text / not set
  on a refused begin / cleared at `cancelled`; agent request Approve → `beginHandover`, Cancel →
  `cancelHandover`; cancel records the draft.

## Task 15.4: Clear `liveBudgetStage` on disable and on persist/restore — implemented

- `clearSessionBudget()` and `clearSessionBudgets()` patch `{ sessionBudget: null,
  liveBudgetStage: null }` (D25). The `clearSessionBudgets` filter is unchanged: a tab without a
  budget never shows a live stage, because `liveStage` requires a budget.
- `tab-persistence.ts`: `projectTabForPersist` and `sanitizeRestoredTab` set `liveBudgetStage: null`.
  `liveBudgetStage` was also added to `NON_PERSISTED_TAB_KEYS`, so a live-stage change alone does not
  cause a `localStorage` write. This follows the file's own rule for fields both readers null.
- Spec: the exact payload at `tab-manager.intent-mutators.spec.ts` is now
  `{ sessionBudget: null, liveBudgetStage: null }`, and the case also sets and asserts the cleared
  stage on an active tab. Added a `clearSessionBudget` case (another session keeps both; the bound
  session clears both). Added a `tab-restore-sanitize.spec.ts` case: projection and restore both
  null the stage, and the input object is not mutated.

## Changed files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-handover-client.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-handover-client.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\services\session-budget-actions.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-manager.intent-mutators.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-persistence.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat-state\src\lib\tab-restore-sanitize.spec.ts` (the tab-persistence spec, permitted by Task 15.4)

## Risk handling

- R-P4: `displayStage` created as a computed beside `budget`.
- R-P6: `peekDraft` validates `draftText` itself.
- R-P7: the existing `record` of the cancel result is kept and now covered by a spec.
- R-P11 / R5: `queuedMessageCarried` flag per `operationId`.
- D24: the services never write to a composer or the send path. Applying the draft (peek, then
  `restoreDraftToInput`, then acknowledge, only with a mounted composer) belongs to Batches 16 and 17.
- 627-L16 display half: the live stage counts only while `streaming` with a budget.

## Verification (each run under `.ptah/tmp-check-lock`)

- `npx jest -c libs/frontend/chat/jest.config.ts <aggregator, handover-client, budget-actions specs> --coverage=false --maxWorkers=2 --moduleNameMapper=<marked/vscode mapper>`:
  3 suites, 133 tests passed.
- `npx jest -c libs/frontend/chat-state/jest.config.ts tab-manager.intent-mutators, tab-restore-sanitize, tab-manager.service, session-identity, tab-manager.history-window specs --coverage=false --maxWorkers=2`:
  5 suites, 234 tests passed.
- Persistence-adjacent chat-state specs (conversation-registry, tab-manager.lifecycle,
  tab-manager.persistence, tab-workspace-partition.reload, tab-workspace-partition.service,
  tab-persistence.backoff): 6 suites, 146 tests passed.
- `npx nx typecheck @ptah-extension/chat-state --parallel=1 --skip-nx-cache`: succeeded.
- `npx nx lint @ptah-extension/chat-state --parallel=1 --skip-nx-cache`: 0 errors, 2 warnings
  (baseline: `no-non-null-assertion` in `tab-manager.cross-workspace.spec.ts:115`, and `max-lines` on
  `tab-manager.service.ts`).
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: succeeded. The expected
  `budget-auto` failure in `session-budget-banner.component.spec.ts` did not appear.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: 0 errors, 35 warnings. None are in
  Batch 15 files: `npx eslint` on the six changed chat files printed no problems.
