# PR 3 fix round — code-logic review S-1..S-4 + M-2 (TASK_2026_597)

Source: `pr3-phase-end-code-logic-review.md` § Serious issues (S-1..S-4), M-2 (F-1..F-4, F-6).
Scope held to those five findings. No commit, `batches.md` untouched.

## Per finding

### S-1 (F-1) Stop / interrupt released the budget

- Fix: `interruptSession` no longer calls `releaseBudget`. Stop (`chat:abort`), `/clear` and the dead-record cleanups
  before resume or a slash command tear down the record, but the conversation continues under the same SDK id. Stage,
  blocked state, extensions ("Allow 20% more"), compactions, dismissals, window and handoff all survive. The budget is
  released only on a real end: `endSession`, a token-matched `endSessionIfTokenMatches` (stream exit), or `clearAll` on
  dispose. After a Stop, the stream-exit `endSessionIfTokenMatches` returns `false` because `chat:abort` already removed
  the record, so nothing is released there either. The stats-owner release on interrupt is unchanged; the gate now
  decides from the kept entry. Owner revisions come from a process-wide monotonic counter
  (`session-stats-owner.service.ts:377,648`), so the resumed owner's snapshots still pass the kept entry's revision
  guard.
- Code: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1436-1449` (doc and body).
- Spec: `sdk-agent-adapter.spec.ts` "keeps the budget of an interrupted session (Stop is not a session end)" replaces the
  old "releases ... interrupted session" spec, which asserted the bug. The multi-key release coverage moves to a new
  spec, "releases the budget under every key when endSession ends the session".

### S-2 (F-2) the gate ignored settings changes

- Fix: `canSend` reads the CURRENT config on every call. If the budget is disabled the answer is OK at once. If a stored
  figure exists and `configKeyOf(config) !== entry.configKey`, the stored snapshot is re-evaluated through
  `applyEvaluation`, exactly as the next result would: the stage resets on a config change and the actions of any newly
  entered stage are scheduled. The verdict comes from the re-evaluated figure. Raising the limit, turning
  `blockAtLimit` off or disabling the budget therefore unblocks immediately. Re-enabling with the same settings blocks
  again, which is correct because the figure is still over the limit.
- Code: `session-budget.service.ts:205-220` (`canSend`), `:374-389` (`checkStored`).
- Specs (`session-budget.service.spec.ts`, `canSend` describe):
  - "S-2: disabling the budget while blocked opens the gate at once; re-enabling blocks again"
  - "S-2: turning blockAtLimit off while blocked opens the gate with no new result"
  - "S-2: raising the limit while blocked re-evaluates the stored figure"
  - "S-2: lowering the limit refuses with the re-evaluated state"

### S-3 (F-3) silent refusal; extend impossible without a stored figure

- Shared (additive): `ChatContinueResult.budget?: SessionBudgetState` in `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:171-176`.
- Backend: `refuseIfBudgetReached` returns `budget: check.state` with the refusal (`chat-session.service.ts:481`).
- Backend: when there is no stored figure, `checkSnapshot` evaluates the owner's snapshot, falling back to the snapshot
  the entry kept. The entry kept one when the figure was dropped while the budget was disabled, which is the review's
  trigger. A blocking figure is now INSTALLED on the entry through `installFigure`, so the refusal is backed by state
  that `extend` and `dismiss` act on (`session-budget.service.ts:396-437`).
- Backend: `extend` builds the figure from the current snapshot when there is no stored figure
  (`entryWithCurrentFigure`, `:616-650`, `:706-718`). With no snapshot at all it keeps the existing "No budget state for
  this session" error. **Choice: create the entry from the current snapshot rather than reject.** It is the safer
  option because that snapshot is exactly the figure the gate refuses on and the one the chip shows. Rejecting would
  leave a refused user with no in-banner way to proceed except toggling settings, which is the failure F-3 describes.
  Extend still applies only at `limit`. It adds the same 20%. No figure is invented.
- Frontend (minimal): add `TabManagerService.installSessionBudget(tabId, budget)`
  (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2237-2247`). It sets `sessionBudget` only when the budget's
  `sessionId` matches the tab's bound `claudeSessionId` and never touches the stats snapshot. `MessageSenderService`
  installs `result.data.budget` on a `SESSION_BUDGET_REACHED` refusal before rolling back
  (`message-sender.service.ts:726-731`), so the banner shows the limit and its "Allow 20% more" / "Continue in new
  session" actions.
- Specs:
  - `session-budget.service.spec.ts`:
    - "S-3: a refusal from the snapshot installs its figure, so extend works and the gate opens"
    - "S-3: a figure dropped while disabled is rebuilt from the kept snapshot when re-enabled over the limit"
    - "S-3: extend with no stored figure builds one from the current snapshot"
    - The existing on-the-fly spec now checks its below-limit case on a fresh harness, because a refusal now stores its
      figure.
  - `chat-session-budget.spec.ts`: `REFUSED` now requires `budget`. The real-stage-machine spec asserts that the
    refusal carries the live `limit` state (revision 2, blocked).
  - `message-sender.service.spec.ts`: "installs the budget state a refusal carries on the tab". The existing refusal
    specs assert that nothing is installed when the refusal carries no budget.
  - `tab-manager.intent-mutators.spec.ts`: "installSessionBudget installs a refusal state for the bound session only".

### S-4 (F-4) a read-back miss cleared the configured window

- Fix: the not-honoured branch no longer sends `autoCompactWindow: null`. It calls `revertSessionAutoCompactWindow`,
  which sends the previous override if one existed, otherwise `configuredAutoCompactWindow(modelClass)`. That helper is
  now shared with `restoreSessionAutoCompactWindow`, so both paths resolve the value the same way. The override is
  cleared only after the runtime accepted that value. `null` goes out only when no window is configured (compaction
  off, or no threshold set). Restore sends the same `null` in that case, and it means "the runtime decides", which is
  the user's configured state, not a cleared one. The doc comment, step 4, was updated.
- Code: `session-control.service.ts:744-756` (not-honoured branch), `:783-797` (revert), `:802-813` (shared resolver),
  restore at `:836`.
- Specs (`session-control.service.spec.ts`):
  - The renamed spec "a read-back miss restores the configured window (never null) ..." asserts that the second
    `applyFlagSettings` sends `600_000`, the configured `compaction.threshold`, not `null`.
  - New spec "a read-back miss with no configured window sends null back (the runtime decides), as restore does".

### M-2 (F-6) override and runtime diverged on a second read-back failure

- Invariant: once the target has reached the runtime, `rec.autoCompactOverride` always describes what the runtime holds.
- Fix: `targetSent` and `revertAttempted` flags drive the `catch`:
  - The failure happened before the target was sent: the record keeps the previous override (unchanged behaviour).
  - The target was sent and the second read-back failed: the previous or configured window is put back once. On success
    the override is the previous value, so runtime and record agree.
  - The put-back also fails, or the not-honoured put-back itself failed: the override stays `target`, because the
    runtime holds it. The config re-apply keeps sending it and `restore-window` has something to undo. The not-honoured
    put-back is not retried.
  - All of these report `{ applied: false, reason: 'failed' }`.
- Code: `session-control.service.ts:688-777`.
- Specs (`session-control.service.spec.ts`):
  - "a second read-back failure after the target was sent puts the configured window back and clears the override (M-2)"
  - "when the put-back fails too, the target stays recorded because the runtime holds it (M-2)". This spec also shows
    that a subsequent restore sends the configured window.
  - "a not-honoured put-back that fails keeps the target recorded and is not retried"

## Files

- MODIFIED `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`: optional `ChatContinueResult.budget`
- MODIFIED `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (+ spec): S-1
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts` (+ spec): S-2, S-3
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts` (+ spec): S-4, M-2
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ `chat-session-budget.spec.ts`): refusal carries `budget`
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (+ `tab-manager.intent-mutators.spec.ts`): `installSessionBudget`
- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.ts` (+ spec): install the refusal state

## Checks

Projects: the 5 changed projects, plus every project that imports `ChatContinueResult` or calls `chat:continue`
(`rpc-handlers`, `chat`, `harness-builder`, `mcp-apps-page`, `ptah-cli`, `ptah-tui`).

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat-state @ptah-extension/chat @ptah-extension/harness-builder @ptah-extension/mcp-apps-page ptah-cli ptah-tui`
  → "Successfully ran targets typecheck, lint for 9 projects". 0 errors. Running `eslint` on the changed files alone
  gives 4 warnings: three `max-lines` and one `no-useless-assignment` at `sdk-agent-adapter.ts:277`. All four come
  from code that existed before this round.
- `npx nx run-many -t test -p <same 9> --maxWorkers=2`: the first run had 1 failure. The rpc-handlers
  real-stage-machine spec expected the old refusal without `budget`, and the spec was updated for the new contract.
  The re-run gives "Successfully ran target test for 9 projects and 35 tasks they depend on".
- `npx nx run di-lint:lint` → Successfully ran target lint for project di-lint.
- `npx nx run degradation-audit:lint` → Successfully ran target lint for project degradation-audit. It flags nothing in
  the changed files; its listed findings are all in `libs/web/*`, which existed before this round.
- `npx prettier --check` on the changed files → all formatted.

## Out-of-scope observations

- Because Stop now keeps the entry, an entry for a session ended by `/clear` (which uses `interruptSession`, after
  which the SDK starts a new id) lives until a real end or dispose. It is bounded by sessions per process and belongs to
  the already-tracked M-7 (release on eviction / resurrection).
- `extend` on a stored figure whose settings changed since it was computed uses `reevaluate` with the current config,
  so the result is correct. The `stage !== 'limit'` precheck still reads the stored stage. That only matters between a
  settings change and the next `canSend`, which now re-evaluates. Not changed.
