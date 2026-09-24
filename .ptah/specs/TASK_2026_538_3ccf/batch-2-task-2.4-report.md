# Backend implementation — TASK_2026_538, Batch 2, Task 2.4

Implemented the production destroyed-window signal and its regression coverage. The requested IPC tests, Electron typecheck and Electron lint pass.

## Absolute files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\activation\bootstrap.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\webview-manager-adapter.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\ipc-bridge.live-renderer.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-2-task-2.4-report.md` (this required report)

## Implementation

- Extracted and exported `createMainWindowHandleGetter(getMainWindow)` in bootstrap.ts and wired the production IpcBridge construction to it.
- The getter returns null for an absent or destroyed BrowserWindow. A live handle forwards `isDestroyed: () => win.isDestroyed() || win.webContents.isDestroyed()`, including destruction after handle creation, and preserves the existing send forwarding.
- The return type is derived from `ConstructorParameters<typeof IpcBridge>[1]`, matching the existing private GetWindowFn / ElectronWindowHandle contract without editing or widening it. The input requires only the native BrowserWindow members used by the getter, allowing a structurally typed fake without a BrowserWindow cast.
- Replaced the adapter's unused catch binding with `catch {`, preserving the comment and false return.
- The new spec calls the actual exported production getter and constructs the real IpcBridge using the same minimal DependencyContainer fixture shape as ipc-bridge.window-availability.spec.ts. No existing spec was edited.

## Spec cases

1. Live window: hasLiveRenderer is true, the adapter reports ptah.main, sendToRenderer is true, and the exact channel/message reach webContents.send.
2. Still-referenced native window flips to destroyed: getter returns null, hasLiveRenderer becomes false, active surfaces become empty, sendToRenderer returns false, and send is not called. A throwing webContents destruction check also proves native destruction short-circuits safely.
3. webContents flips to destroyed while the native window stays live: liveness becomes false, surfaces become empty, send returns false, and send is not called.
4. No window: no live renderer, no surfaces, and false send.
5. A previously created handle observes subsequent native window destruction and short-circuits the webContents check.

## Stack and repository evidence

- package.json and package-lock.json: Electron ^44.4.3, TypeScript 6.0.3, tsyringe ^4.10.0, Jest ^30.0.2.
- bootstrap.ts is the Electron main-process composition root; IpcBridge resolves existing collaborators from its DependencyContainer. No new registration or dependency.
- ipc-bridge.ts supplies the thin handle contract and already checks optional webContents.isDestroyed in hasLiveRenderer and non-batched sendToRenderer.
- eslint.config.mjs enforces module boundaries; this change stays inside the Electron application.
- apps/ptah-electron/jest.config.ts uses ts-jest with the Node environment and Electron module mock. project.json declares the Electron typecheck and lint targets.
- No external input boundary was added; this change adapts an internal native window handle.
- ptah_search_files found no AGENTS.md or CLAUDE.md; native reads were used for instruction and implementation content.

## Verification

Both requested commands were run once, with PowerShell `Select-Object -Last` as the equivalent of `tail`. Exit codes below are the native command exit codes.

### IPC Jest — passed, exit 0

Requested: `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/ipc 2>&1 | tail -25`

Actual: `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/ipc`, stderr merged, last 25 lines retained.

```text
node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
Test Suites: 5 passed, 5 total
Tests:       29 passed, 29 total
Snapshots:   0 total
Time:        28.632 s
Ran all test suites matching apps/ptah-electron/src/ipc.
EXIT_CODE=0
```

PowerShell represented Jest's stderr stream as NativeCommandError metadata; Jest itself exited 0 and reported 5 passing suites / 29 passing tests.

### Electron typecheck and lint — passed, exit 0

Requested: `npx nx run-many -t typecheck,lint -p ptah-electron 2>&1 | tail -20`

Actual: `npx nx run-many -t typecheck,lint -p ptah-electron`, stderr merged, last 20 lines retained.

```text
√  nx run ptah-electron:lint
√  nx run ptah-electron:typecheck



 NX   Successfully ran targets typecheck, lint for project ptah-electron


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

View logs and investigate cache misses at https://nx.app/runs/5opiE58tZp

  Run duration:      37.2s
  Cache:             0/2 hit (0%)
  Critical path:     37.2s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        ptah-electron:typecheck    37.2s
EXIT_CODE=0
```

### Scoped diagnostics tool

Called ptah_get_diagnostics after edits with the three changed source/spec paths. It returned: “typescript-compiler — Unavailable. TypeScript check still running after 45s. It was not cancelled.” The requested explicit Electron typecheck subsequently passed.

## Deviations and anything not done

- No functional plan deviations.
- No workspace-wide verification, build, existing-spec edits, changes to shared/rpc-handlers, or git commands.
- The two known Electron packaging/CSP ENOENT suites are outside the requested IPC test directory and were not run.
- No required implementation or requested verification remains outstanding. Batch acceptance/review and git operations remain with the invoking workflow.

