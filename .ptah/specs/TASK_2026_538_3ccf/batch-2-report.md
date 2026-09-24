# Batch 2 report - TASK_2026_538

Written by the orchestrator, not by the executor. The first executor (antigravity lane `326e238e`) failed with a
quota error (429) before it edited any file. The second executor (Glm lane `20d18ebf`, ptah-cli, Ollama Cloud) made
all the edits and ran typecheck and lint. Then it stopped on an Ollama Cloud session limit (429) before it wrote
this report. The content below comes from `git diff`, the new spec file and the lane output (`ptah_agent_read`).

## Task 2.1 - `IpcBridge.sendToRenderer` returns a boolean, and `hasLiveRenderer` is added

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\ipc-bridge.ts`
- `sendToRenderer(message): boolean`. It returns `true` for a queued batched stream event and for a
  `webContents.send`. It returns `false` when there is no window or when `webContents.isDestroyed()` is true.
- `hasLiveRenderer(): boolean` uses `getWindow()` and `isDestroyed?.()`. It does not log.
- The existing call sites did not change (they ignore the return value).

## Task 2.2 - Electron adapter

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\webview-manager-adapter.ts`
  - `sendMessage` returns the `sendToRenderer` result inside `try/catch (error: unknown)`. A throw gives `false`.
  - `getActiveWebviews(): readonly string[]` gives `['ptah.main']` when `hasLiveRenderer()` is true, else `[]`.
- File (CREATE): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\webview-manager-adapter.spec.ts`
  - The spec has 6 cases: live window, no window, a window destroyed between two enumerations, a send delivered
    (with the forwarded payload), a send dropped (false), and a send that throws (false and no rejection).

## Task 2.3 - CLI adapter

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\transport\cli-webview-manager-adapter.ts`
  - `getActiveWebviews(): readonly string[]` returns `[]`. The doc comment says that CLI and TUI render no surfaces,
    so `no-surface` is the correct, successful answer. The method does not throw.
- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\transport\cli-webview-manager-adapter.spec.ts`
  - One new `describe` block with 2 cases. The existing cases did not change.

## Verification

- Lane: `npx nx run-many -t typecheck,lint -p ptah-electron @ptah-extension/cli-engine` gave "Successfully ran
  targets typecheck, lint for 2 projects".
- Orchestrator: `npx nx run-many -t test -p ptah-electron @ptah-extension/cli-engine` failed on 2 suites only:
  `apps/ptah-electron/src/config/better-sqlite3-packaging.spec.ts` and `apps/ptah-electron/src/windows/shell-csp.spec.ts`.
  Both fail with `ENOENT ... node_modules\electron\package.json` / `node_modules\electron\path.txt`. The worktree has
  no Electron binary. Both specs start a real Electron process. This is an environment issue from before this task.
  Batch 2 does not touch those files.

## Open items

- Req 11.1 through `createDashboardBroadcast`, and the type-level `DashboardSurfaceHost` check, are in Task 14.1
  and Task 14.2 (R7). They are not in this batch.
- The "destroyed between enumeration and send" case tests two enumerations and a separate false send. It does not
  test one enumeration followed by one send. The reviewer decides if this is sufficient.
