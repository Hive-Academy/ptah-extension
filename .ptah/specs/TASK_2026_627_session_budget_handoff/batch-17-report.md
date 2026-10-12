# Batch 17 report — Chat view: banner while streaming, bindings, draft effect (F2-part)

Executor: frontend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
(branch `fix/session-budget-handoff`). No git operations were run. Batch 16 files were not edited.

## Files

- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`

## Task 17.1

- Visibility (Decision 7): `showSessionBudgetBanner` keeps every existing condition: a notice, main
  panel showing, the active tab. It is true when the tab is `loaded`, or when it is `streaming` and
  either the display stage (`SessionBudgetActionsService.displayStage()`) is `handoff`/`limit` or the
  handover is pending (phase not `closed`/`failed`/`cancelled`, which includes an agent request in
  `awaiting-confirmation`). An ended handover, or a stage below handoff, still waits for the
  terminal turn_state. The "rendered only after this tab is idle" comment was replaced. A local
  `ENDED_HANDOVER_PHASES` set matches the private one in the actions service. That service is outside
  this batch, so the set could not be exported from it.
- Bindings (html, banner block): `[turnRunning]`, `[liveStage]`, `[wrapUpRequested]`,
  `[queuedMessageCarried]` take the actions-service signals. `(requestWrapUp)` →
  `requestWrapUp()`. `(continueNowAnyway)` → `continueNowAnyway()`. `(approveAgentRequest)` →
  `continueInNewSession()` (the Approve path, D23). The banner computes the display stage from
  `budget` plus `liveStage` on its own, as built in Batch 16.
- Draft effect: one constructor effect reads `resolvedHandover()` and `chatInputRef()`. Without a
  composer it returns, and the draft stays unacknowledged. With a composer, `untracked`
  `applyHandoverDraft` runs `peekDraft(resolvedSessionId())` → `restoreDraftToInput(text)` →
  `acknowledgeDraft(operationId)`. A throw is logged and the acknowledgement is skipped. Captured
  text never goes through `restoreContentToInput`, `restoreInputs` or the send/queue path.
- Pitfalls: the view starts nothing. Every handover begin comes from a banner output, so a user
  click. D17 is not touched. Wrap-up is guarded by the service (`turnRunning`), and a spec pins that
  nothing is sent while idle. R3: the draft write only happens for `cancelled`/`failed` (`peekDraft`),
  so it never focuses during a running wait. The banner sits above the sticky composer and does not
  move it. The R3 visual check stays with the user's manual Electron run.

## Specs (chat-view.component.spec.ts)

- Rewritten (not loosened): "waits for terminal turn_state …" now uses a below-handoff (`tighten`)
  budget, because an authoritative `limit` now shows while streaming by design.
- S13: a live handoff while streaming shows the banner and binds live stage and turn; an
  authoritative handoff or limit shows it (`it.each`); the live stage drops once idle; an agent
  request mid-turn below handoff shows it; a pending handover without a budget shows it, and a
  cancelled one waits for idle; wrap-up calls `session:budgetAction{request-wrap-up}` once, then
  `wrapUpRequested`; no wrap-up RPC while idle; Continue now anyway sends `continueNow: true`; Approve
  sends no `continueNow`; no send-path call.
- S23 (view half): during a `waiting-for-turn-end` wait the banner shows, and a view send
  (`handleResumeAgent`) goes through `chatStore.sendOrQueueMessage` with no handover RPC. The
  coordinator `admitOrHold` half is in the coordinator spec (Batch 9).
- S20 (new describe, rendered surface with the `viewChild` replaced by a writable signal):
  - compact → full: no composer → not acknowledged; mount → applied once, then `peekDraft` null.
  - re-mount does not re-apply.
  - a second view does not re-apply.
  - a throwing write leaves the draft unacknowledged.
  - nothing is written for a pending phase or for a terminal state without a draft.
  - `restoreContentToInput` and the send path are never called.

## Verification (each command ran under `.ptah/tmp-check-lock`)

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper=…`:
  1 suite, 87 tests passed. The `NG0101 ApplicationRef.tick is called recursively` console noise
  comes from the harness under `TestBed.tick()`. The existing plan-limits cases print it too.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: succeeded (one existing NG8107
  warning in `peer-session-send-dialog.component.ts`).
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: 0 errors, 34 warnings (same as the
  Batch 16 baseline). In the changed files there are only two warnings, and both were there before:
  `max-lines` on `chat-view.component.ts` and a `no-non-null-assertion` at spec :1361.
- G1 over `libs` (excluding specs): `coordinator.begin(` appears only in
  `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts:99`. The other
  `.begin(` hits belong to unrelated objects: turn tracker, timing, recorder, git-ui.

## Deviations

- Logging uses `console.warn('[ChatView] …')`, not a Logger. The chat lib has no Logger service; the
  view and `SessionHandoverClientService` already log with `console.warn`.
- The S20 view specs replace the `chatInputRef` signal with a writable signal, because the test
  template swaps children for `NO_ERRORS_SCHEMA`, so no real `ChatInputComponent` mounts. The real
  composer write is covered in `chat-input.component.spec.ts` (Batch 16).
- The S23 spec stubs `removeResumableSubagent` on the shared ChatStore stub inside that one case.
