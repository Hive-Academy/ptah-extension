# Batch 28 report: Restore shape and handoff read status (F.1 M1, M3 backend)

Decision applied: F-A (new `restore-failed` reason). Builds on Batch 16. Nothing committed.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\shared\src\lib\types\session-budget.types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\shared\src\lib\types\session-budget.types.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-control.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-control.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\session-budget\session-budget.service.spec.ts`
- MODIFIED (outside the batch file list, needed for the build) `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`

## Task 28.1: Restore failure shape (F-A)

- `SessionBudgetWindowReason` has a new member, `'restore-failed'`. The doc for `SessionBudgetWindow` now says
  `applied` means "the window is in force". It also says `reason` comes with `applied: true` only as `restore-failed`.
- `restoreSessionAutoCompactWindow` returns `{ target, applied: true, reason: 'restore-failed' }` in two cases: when
  there is no live query, and when `applyFlagSettings` throws or times out. In both cases the override stays recorded.
  The `applySessionAutoCompactWindow` doc describes the restore failure. The lowering path still returns `failed`.
- `SessionBudgetService.restoreWindow` now checks for `reason === 'restore-failed'`. Before, it checked for
  `'failed'`, so a lowering failure (`applied: false, failed`) left in place no longer reads as a failed restore.
- Specs:
  - control spec: the failed-restore case expects `restore-failed`. A new case covers "no live query": nothing is sent
    and the override is kept.
  - budget spec: the restore failure case now uses `restore-failed` and asserts the error text. A new case checks that
    `applied: false, failed` does not fail the restore.
  - types spec: `restore-failed` with `applied: true` survives a JSON round trip.

## Task 28.2: `SessionBudgetHandoff` read status (M3)

- New `SessionBudgetHandoffReadStatus = 'workspace-unknown' | 'read-failed'`, plus an optional
  `SessionBudgetHandoff.readStatus`. The field is absent when the transcript was read.
- `buildHandoff` now returns `{ document, readStatus? }`:
  - `workspace-unknown` when `getSessionWorkspace` returns undefined;
  - `read-failed` when the builder reports `readError`.
  - The WARN-once (`handoff-read`) stays as it was.
- `writeHandoff` copies `readStatus` into `entry.handoff`. `previewHandoff` only takes the document; the action result's
  `handoff` shape is unchanged.
- The raw `readError` text can hold a filesystem path, so it stays in the log only. The status crosses to the webview as
  an enum.
- Specs:
  - budget spec, unknown workspace: `readStatus` is `workspace-unknown`.
  - budget spec, read error: `readStatus` is `read-failed`, the error text is not in the state, and there is exactly one
    `handoff-read` WARN.
  - budget spec, successful read: no `readStatus` property.
  - types spec: the field is optional and both values survive a JSON round trip.

## Out-of-batch edit (required by the shared type change)

`session-budget-banner.component.ts` had `WINDOW_REASON_TEXT: Record<Exclude<SessionBudgetWindowReason, 'disabled'>,
string>`. Adding a member to the union breaks that map and the `window.reason ?? 'failed'` lookup at compile time. The
change is type-only:

- `Exclude<…, 'disabled' | 'restore-failed'>`;
- `restore-failed` maps to the `failed` key at the lookup.

This branch is never reached, because `restore-failed` always comes with `applied: true` and the banner returns
earlier on `window.applied`. No user-visible text changed. The banner copy for a failed restore and for the M3
read-status warning belongs to Batch 33 (F-B).

## Checks (run in the worktree)

| Command | Exit | Result |
| --- | --- | --- |
| `npx prettier --write <7 files>` | 0 | formatted |
| `npx nx run-many -t typecheck,lint,test -p shared agent-sdk --parallel=2 -- --maxWorkers=2` | 1 | shared:test, agent-sdk:lint and agent-sdk:test passed. Both typecheck tasks failed only on `TS5023: Unknown compiler option '--maxWorkers=2'`, a passthrough mistake in my command. They were re-run clean below. |
| `npx nx affected -t typecheck --exclude='api-*,ptah-license-server,ptah-landing-page-e2e' --parallel=2` | 0 | "Successfully ran target typecheck for 63 projects", including shared, agent-sdk, chat, chat-ui, rpc-handlers, ptah-extension-vscode, ptah-electron, ptah-cli, ptah-extension-webview |
| `npx nx run di-lint:lint` | 0 | pass |
| `npx nx run degradation-audit:lint` | 0 | pass |
| `npx nx run-many -t lint,test -p @ptah-extension/chat --parallel=2` | 0 | lint: 0 errors, 32 warnings (none added here); tests: 169 suites, 3128 passed, 2 skipped |

The first chat run failed with an Nx plugin worker crash ("Plugin worker exited unexpectedly"), not a check failure.
The retry passed.

The output above does not show whether `shared:lint` ran on the first run-many. The 4 successful tasks there were
shared:test, shared:lint, agent-sdk:lint and agent-sdk:test (6 tasks, 2 failed only on the flag).

## Open notes

- Batch 33 (UI) should render `handoff.readStatus` using the F-B copy ("The transcript could not be read; the handoff
  may be incomplete."). If it wants restore-failed copy, it should handle `window.reason === 'restore-failed'` in the
  `applied: true` branch.
- `SessionBudgetActionResult.handoff` (preview/write action result) does not carry `readStatus`. The published state
  `handoff` does. Batch 33 can read it from `state.handoff`, or the shape can be widened later if the preview modal
  needs it.
- Nothing touched in Batch 24A or Batch 32 files.
