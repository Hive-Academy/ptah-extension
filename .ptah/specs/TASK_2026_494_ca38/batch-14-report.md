# Batch 14 report

Implemented the Apps focus-memory directive, workspace focus state, and B12 findings N2 and N3.

## Files written

- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\components\apps-focus-memory.directive.ts (created)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\components\apps-focus-memory.directive.spec.ts (created)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\apps-workspace-slice.ts (modified)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.ts (modified)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\apps-session.service.spec.ts (modified)
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-14-report.md (this report)

## Diff summary for modified files

- apps-workspace-slice.ts: added readonly lastFocusKey: string | null, initialized to null, and pure recordAppsFocusKey helper. Repeated identical keys preserve slice identity.
- apps-session.service.ts: added readonly computed lastFocusKey and non-throwing recordFocusKey targeting only workspaceKey(). Added a one-time real-workspace resolution effect that calls the existing dropSlice -> teardown -> releaseConversation path for the implicit slice. discard() uses removeAppsSlice for a missing slice and retains existing teardown/reset behavior for an existing slice.
- apps-session.service.spec.ts: added three regression specs for focus partitioning, complete boot-window release and implicit-map-entry removal, and no empty entry on discard. Existing B12 assertions and fixtures retained.

## Requirements and evidence

- Standalone host attribute directive: [ptahAppsFocusMemory], with host tabindex="-1". Initialization restores focus in afterNextRender. The Apps page host is owned by B15; applying the directive there remains that batch's integration work, as required by this batch's file restrictions.
- focusin records the closest keyed element contained by the host. Spec: `records the nearest key on focusin and removes the listener on destroy`.
- Literal attribute comparisons over querySelectorAll('[data-apps-focus-key]'); keys are never inserted into a selector. Spec: `handles a key containing quotes and brackets safely`.
- Restores a connected, focusable, enabled control and confirms it actually became active. Rejects disabled/aria-disabled, hidden/inert, non-focusable and CSS-hidden targets; catches focus failures and falls back to the host. Specs: `restores the recorded key after host destroy and re-create`, parameterized `falls back to the host with tabindex -1 for a %s control` (missing, disabled, detached, plain, hidden, inert), and `falls back without throwing when a control refuses focus`.
- DestroyRef removes the focusin listener and destroys the pending render callback. No timers and no style injection. Listener removal is asserted in the focusin spec.
- Per-workspace state: `records focus only in the active workspace slice and restores each key` uses the real session service; `restores each workspace slice key when its host is re-created` exercises directive restoration across mounts for two workspaces.
- N2: `releases the boot-window conversation and drops the implicit slice on first real workspace (N2)` checks inbox and workflow claim release, surface removal, sync.dispose exactly once, abort of an in-flight read, implicit slice absence, and no migration into the real workspace. The spec creates a service while the workspace is null to model boot; existing setup is unchanged.
- N3: `discard on a workspace that never started creates no empty slice (N3)` checks map identity and absence of the workspace entry, plus no surface close.

## Deviations

No scope deviations. Read-only inspection and verification logs used the system temporary directory. Only the five authorized source/spec files and this requested report were written in the worktree. No git commands were run. No B13 files, state files, barrels, configs, batch records, or other libraries were edited.

## Verification

Command: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache`

Initial run: test and typecheck passed; lint reported four unused catch variables in B14 files. Fixed the catches without changing the existing tests or fixtures. Final run result and last ten output lines follow.

Final result: PASS, all three targets green. No B13 failures reported.

```text

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      19.2s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     19.1s (1 task)
  Recoverable time:  70ms (0% of the run)
```
