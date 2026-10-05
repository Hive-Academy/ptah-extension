## Frontend implementation — `TASK_2026_597_ab22`, batch 59

**Tasks completed**: 59.1 (live and resume entry paths), 59.2 (`SESSION_BUDGET_REACHED` on send)

Worktree root used: `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget` (batches.md names the
`task-597-followups` root).

**Files** (all paths under `libs/frontend/chat/src/lib/`):

- MODIFIED `services/chat-store/session-stats-aggregator.service.ts`. `SessionStatsSnapshotEvent` gets an optional
  `budget?: SessionBudgetState`. `SessionStatsResultEvent` already had it through `ResultStatsPayload`. Both tab
  install calls (snapshot-only and turn result) now pass `stats.budget` to `installSessionStats` in the same call
  as its snapshot. No snapshot (missing, malformed, or for another session) means no install, so the budget is
  never installed on its own. The workflow-surface (no tab) path ignores the budget, because surfaces have no
  budget UI.
- MODIFIED `services/chat-store/session-loader.service.ts`. `applyResumeStats` takes `options.budget` and passes
  it to `applyLoadedSessionStats` together with the snapshot. Both resume entry points forward
  `data.budget`: `switchSession` (`resumeResult.data?.budget`) and the restored-tab path
  (`result.data?.budget`).
- MODIFIED `services/message-sender.service.ts`:
  - `SendOutcome` gets `errorCode?: 'SESSION_BUDGET_REACHED'`.
  - New private `isSessionBudgetReached` reads the code from the envelope or from `data`, following the
    `handleAuthRequired` pattern.
  - On that code, `runContinueConversation` removes the boundary and the optimistic bubble, sets the tab to
    loaded and idle, and returns `{success:false, error, errorCode}`.
  - It does not retry, start a new chat (`chat:start`) or show the auth banner.
  - Every other failure behaves as before. Its outcome carries no `errorCode`, and the bubble is dropped only
    for a queue flush.
- MODIFIED `services/chat-store/message-dispatch.service.ts` (APPROVED DEVIATION, see below).
  `showSendFailure` ("Message delivery failed. …") is skipped only when
  `outcome.errorCode === 'SESSION_BUDGET_REACHED'`. This applies on both the direct-send path and the
  queue-flush path. The queue flush still re-queues the text, and nothing retries it.
- MODIFIED `components/molecules/chat-input/chat-input.component.ts` (APPROVED DEVIATION). `handleSend` keeps the
  composer text, files and images only when the outcome is `SESSION_BUDGET_REACHED`. Any other outcome clears the
  composer as before.
- MODIFIED specs:
  - `session-stats-aggregator.service.spec.ts`: new `session budget` block. It checks that the budget is
    installed with the snapshot on the turn-result and snapshot-only paths, and is not installed when the
    snapshot is missing or for another session. Three existing `toHaveBeenCalledWith` assertions gain the
    trailing `undefined` budget argument.
  - `session-loader.service.spec.ts`: checks the budget is installed with the snapshot on the restored-tab path
    and on `switchSession`. One existing assertion gains a trailing `undefined`.
  - `message-sender.service.spec.ts`: tests the code on `data` and on the envelope. Each checks the outcome,
    that the bubble and boundary were removed, the tab is loaded and idle, there is one `chat:continue` and no
    `chat:start`, and no auth banner. It also checks that another rejection returns no `errorCode`.
  - `message-dispatch.service.spec.ts`: no notice on a direct send. A refused flush is re-queued with no notice
    and no retry.
  - `chat-input.component.spec.ts`: the draft is kept on the budget code and cleared on any other failure.

**Stack observed**:

- Angular with signals, `inject()` and `providedIn: 'root'` services.
- Tab state is written through `TabManagerService` (`chat-state/src/lib/tab-manager.service.ts:2225-2268`).
- The 58.2 `budgetPatch` (`:146-153`) drops a budget keyed to another session.
- Specs are Jest with TestBed and mocked collaborators.

**Design fidelity**: no design handoff for this batch. The plan is implementation-plan-addendum-n7-n8.md
§ 9 (lines 282-284, 292 and 296).

**States covered**:

- At the budget limit the send is refused without a generic notice. The draft and attachments stay in the
  composer, and the bubble is removed.
- The limit state comes from `tab.sessionBudget`, which arrived with the stats broadcast or the resume reply.
  `ChatContinueResult` carries no budget, so nothing more can be written at send time. The banner that shows
  the state is Batch 60.

**Verification** (in the worktree, output tailed):

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat ptah-extension-webview`: all 4 tasks passed. Both
  deviation files are in `@ptah-extension/chat`, so no extra project was needed.
- `npx nx run-many -t test -p @ptah-extension/chat --maxWorkers=2 --skip-nx-cache`: 161 of 161 suites passed;
  2971 tests passed and 2 were skipped (both skips were there before).
- `npx nx run degradation-audit:lint --skip-nx-cache`: passed (exit 0).
  - All counts are at their baseline.
  - The listed `chat` findings (`conversation.service.ts:350`, `voice-input.service.ts`,
    `subagent-transcript-viewer.service.ts`) were there before and are in files this batch did not edit.
  - The new code has no catch that returns a bare literal.

**Plan deviations**:

- APPROVED by the coordinator ("OK a+b", keyed only on `outcome.errorCode === 'SESSION_BUDGET_REACHED'`, with a
  spec for each). The two files are `message-dispatch.service.ts` and `chat-input.component.ts`. Without them,
  59.2's "restore the draft, no generic error" could not be met from `message-sender.service.ts` alone:
  - the dispatch service appended "Message delivery failed." to the transcript for every `success:false`
    (`message-dispatch.service.ts:201-203`, `:246-249`);
  - the composer was cleared after every send (`chat-input.component.ts:1368`).
- The budget code is handled on `chat:continue` only. A new chat has no budget to reach, so `chat:start` is
  unchanged.

**Out-of-scope observations**:

- If the tab has no budget state when the backend refuses (for example the broadcast was lost), the draft stays
  in the composer but nothing explains why. This depends on Batch 60 rendering `tab.sessionBudget`. A follow-up
  could have `chat:continue` return the budget with the error code.
