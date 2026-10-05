# Batch 33 report: budget UI follow-ups

Executor: frontend-developer. No commit. Tasks 33.1, 33.2, 33.3, 33.4, 33.5 and 33.7 are done. **Task 33.6 is BLOCKED**:
assumption A2 is false, and the plan says to stop and report in that case (see Open notes).

## Files changed (worktree `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g`)

- `libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`: 33.1 and 33.5.
- `libs\frontend\chat\src\lib\components\templates\chat-view.component.html`: binds `[previewFailed]="budgetPreviewFailed()"` (33.5).
- `libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`: four new specs (33.1, 33.5).
- `libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`: 33.2, 33.3, 33.5, and the `restore-failed` copy from Batch 28.
- `libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.spec.ts`: updated copy expectations, plus new specs.
- `libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.ts` (+ `.spec.ts`): 33.4. **Not on the batch file list** (see deviations).
- `libs\frontend\chat-state\src\lib\tab-manager.service.ts` (+ `tab-manager.intent-mutators.spec.ts`): 33.4, the new `clearSessionBudgets()`. **Not on the batch file list.**
- `libs\frontend\chat-state\src\lib\tab-workspace-partition.service.ts` (+ `.spec.ts`): 33.4, the new `findBackgroundTabIds(predicate)`. **Not on the batch file list.**
- `libs\frontend\chat\src\lib\components\molecules\agent-card\subagent-usage-summary.component.ts` (+ `.spec.ts`): 33.7.
- `session-stats-summary.component.ts` (chat-ui): **not changed** (33.6 is blocked).

## What each task does

- **33.1 (M6)**:
  - `_budgetActionState` now stores `{ state, base }`, where `base` is the tab budget object the action ran against.
  - `resolvedSessionBudget` rule:
    - When both revisions are numbers, the newer one wins; a tie goes to the action.
    - When either revision is null, the action state wins only while the tab still holds `base`. A later snapshot without a revision always replaces it.
    - The old `?? -1` comparison, which let a stale action state win forever, is gone.
  - Clearing on a tab or session change:
    - `_budgetActionState` and `_budgetPreview` are now `linkedSignal`s with the source `budgetScope = resolvedTabId|resolvedSessionId`.
    - They reset to `null` whenever that source changes. No effect is needed: a component effect needed full change detection in the spec harness (NG0101).
- **33.2 (M3 UI, F-B)**:
  - The banner has a new warning line `session-budget-read-status`. It shows on the handoff and limit stages when `handoff.readStatus` is set.
  - `read-failed` gets the accepted F-B text. `workspace-unknown` gets a matching sentence.
- **33.3 (M8, F-B, F-C copy only)**:
  - Both tighten bodies that suggest `/compact` gain the M8 note.
  - The blocked limit copy replaces "/compact and /clear still work." with: "/clear still works.", followed by the accepted F-B sentence.
  - The exact-match exemption is unchanged (F-C (a)).
- **33.4 (F.4, F-D)**:
  - After a confirmed write of `sessionBudget.enabled = false`, the settings card calls `TabManagerService.clearSessionBudgets()`.
  - That method sets `sessionBudget: null` on every tab that has one: active-workspace tabs through `_tabs`, and background workspaces through `findBackgroundTabIds` + `updateBackgroundTab`.
  - A failed or unconfirmed write clears nothing. No backend contract changed.
- **33.5 (F-B)**:
  - `onBudgetPreview` now always records an outcome. `content: null` marks a failure, which covers a failed RPC and a success without a handoff.
  - The banner's new `previewFailed` input replaces the "Loading the handoff…" `<pre>` with an error line and a "Try again" button that re-emits `previewRequested`.
  - A retry first resets a failed entry, so "Loading…" shows while it reloads. A preview that already loaded stays until it is replaced.
- **Batch 28 `restore-failed` copy**: a tighten window with `applied: true, reason: 'restore-failed'` now says that the restore failed. It still offers "Restore auto-compact".
- **33.7 (F-E)**: the subagent cost tooltip now covers a missing cache price.

## New or changed user-visible strings (verbatim)

- Banner, read status `read-failed`: `The transcript could not be read; the handoff may be incomplete.`
- Banner, read status `workspace-unknown`: `This session's workspace is not known, so the transcript was not read; the handoff may be incomplete.`
- Banner, tighten advisory: `<amount>. Run /compact or start a fresh session for unrelated work to slow the spend. /compact frees context but does not reset this session's budget.`
- Banner, tighten not applied: `<amount>. Ptah could not lower auto-compact here (<reason>). Use /compact or start a fresh session to slow the spend. /compact frees context but does not reset this session's budget.`
- Banner, tighten `restore-failed`: `<amount>. Ptah could not restore auto-compact; it stays at <target> tokens for this session. Try Restore auto-compact again.`
- Banner, limit with blocking on (the pause sentence): `New messages here are paused after the current turn (one queued message may still run). /clear still works. /compact frees context but does not reset this session's budget; at the limit only a bare /compact is allowed.`
- Banner, preview failure: `Could not load the handoff.` + button `Try again`
- Subagent cost tooltip (was `No price is known for this model`): `No price is known for this model or its cache tokens`

## Checks (all exit 0 at the end)

- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/chat-state --parallel=2`: "Successfully ran targets typecheck, lint, test for 3 projects", exit 0.
  - chat-state is included because the batch changed it.
  - Earlier runs failed only on my own new specs: an invalid SessionId in a fixture, a missing partition mock, and an effect flush. All three were fixed.
- `npx nx run @ptah-extension/chat:lint` after the prettier write: exit 0.
- `npx nx run di-lint:lint`: exit 0. `npx nx run degradation-audit:lint`: exit 0. Both were served from the Nx cache.
- `npx prettier --check` on the changed files flagged two spec files. I ran `--write` on both.
- No baseline PNGs were touched (git status shows none).
- The backend files in git status (agent-sdk, cli-agent-runtime, rpc-handlers, vscode-lm-tools, shared `rpc.types.ts`) belong to the parallel batches. I did not touch them.

## Plan deviations

- **33.4 touches files outside the batch list.** F-D (a) says "when the settings card saves … clear `sessionBudget` on every open tab", so it needs the settings card plus a tab-state mutator.
  - Files: `session-budget-settings.component.ts`, `tab-manager.service.ts` (a new intent-named mutator, following the "INTENT-NAMED MUTATORS" rule at `tab-manager.service.ts:1349-1363`) and `tab-workspace-partition.service.ts`, each with its spec.
  - The parallel backend batches 25 and 29 own none of these files.
- **33.5 adds a "Try again" button.** F-B text is "Could not load the handoff. Try again." I made "Try again" an actual button so the retry is reachable in one keyboard step. It re-emits the existing `previewRequested` output.

## Open notes

- **33.6 BLOCKED (A2 false).** `SessionBudgetState` (`libs\shared\src\lib\types\session-budget.types.ts:110-137`) has no `tightenPercent` or `handoffPercent`. They exist only on `SessionBudgetConfig` (149-152), and no settings feed reaches the frontend (F.4).
  - The chip tooltip at `session-stats-summary.component.ts:991` still hard-codes 50/80/100.
  - The fix needs a shared type change: add both percents to `SessionBudgetState` and have the backend populate them. That goes to the team-leader, per A2.
- F-D side effect: clearing `sessionBudget` also hides an active rotation advisory until the next stats snapshot brings it back. The rotation advisory is published even while the budget is off. This is the literal F-D (a) behaviour.
- When `/clear` is sent, the F-B sentence "only a bare /compact is allowed" sits next to "/clear still works." Both are true: the exemption covers exactly `/compact` and `/clear` (`chat-session.service.ts:172-175`).
