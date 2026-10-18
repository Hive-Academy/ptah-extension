# Console audit - TASK_2026_687_615f (round 2)

## Method

- App: Electron dev app PID 29516 (started 17:40 from the `command-center-open-issues` worktree, renderer
  `dist/apps/ptah-electron/renderer/index.html`, built 17:39), CDP port 9334 only.
- `page.on('console')` (warning and error, with location) and `page.on('pageerror')` (with stack) attached to every page
  in the context and to new pages (`ctx.on('page')`) BEFORE `page.reload()`. Waited 8 s after reload, then visited all 7
  top-bar tabs (Chat, Voice, Apps, Tasks, Tribunal, Analytics, Setup hub), every other top-bar control (Thoth,
  Marketplace, Settings, Notifications, theme menu, Workspaces and Git toggles), Setup hub and Chat again, then the Voice
  page with toast, mic-denied, pending question and 24 synthetic agents (valid statuses) at 3 viewports and 2 themes.
- Main-process side: `%TEMP%/cc687/electron.log` (942+ lines, last write 18:06) searched for `[renderer] console.*`,
  `[ERROR]` and `[WARN]`. Scripts: `%TEMP%/cc687/audit.js`, `audit2.js`.
- Real data only on the audited surfaces (workspace `ptah-final-run-ws`, 11 sessions, git changes). No messages sent, no
  fake agents during the tab walk.

## Result

Across reload plus every tab and surface: **0 `pageerror`, 0 console errors, 1 console warning** (one unique message,
count 1 per load). `electron.log` has **0 `[ERROR]` lines** and 2 `[renderer] console.warning` lines, both the same
warning (one per load: initial launch and my reload). The user-reported "lots of console errors" was not reproduced in this
build with the real session data.

## Groups

| #   | Level       | Message (unique)                                                                                                                                                    | Source                                                           | Count                     | Surface                | Class                                                |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- | ---------------------- | ---------------------------------------------------- |
| 1   | warning     | `NG0914: The application is using zoneless change detection, but is still loading Zone.js ...`                                                                      | `renderer/chunk-6PMU5XP4.js:23669` (Angular core `console.warn`) | 1 per load (2 in the log) | startup, every surface | dev-only / expected                                  |
| 2   | warn (main) | `[CodeExecutionMCP] Failed to register for claude/antigravity in ...\.claude-worktrees\command-center\dist\apps\ptah-electron\main.mjs\.mcp.json: ENOENT / ENOTDIR` | `electron.log` lines 871, 874                                    | 2                         | startup                | dev-only (stale persisted workspace)                 |
| 3   | warn (main) | `MCP port 51820 (EADDRINUSE) ... Started on port 51821`                                                                                                             | `electron.log:604`                                               | 1                         | startup                | expected (another Ptah instance running)             |
| 4   | warn (main) | `Lane outcomes start failed (non-fatal): {"error":{}}`                                                                                                              | `electron.log:46`                                                | 1                         | startup                | possible product nit (empty error object, non-fatal) |
| 5   | warn (main) | `[harness-sync] Blocked: desired paths an unowned file occupies` (1 blocked of 99)                                                                                  | `electron.log:877, 878, 936`                                     | 3                         | activation             | expected (user-owned file in the way)                |
| 6   | warn (main) | `[RPC] slow handler` provider:getPlanLimits 3.3-9.5 s, agent:detectClis 6.5 s, session:list 1.38 s, event-loop lag 2.7 s                                            | `electron.log`                                                   | about 8                   | startup                | perf, not console errors                             |

### 1. NG0914 (Angular zoneless warning)

- Stack: `console.warn` from Angular core, chunk `chunk-6PMU5XP4.js:23669:12`.
- Cause: the Electron renderer is built from the shared webview app, which keeps `"polyfills": ["zone.js"]`
  (`apps/ptah-extension-webview/project.json:15`) while `app.config.ts` uses `provideZonelessChangeDetection`
  (`apps/ptah-extension-webview/src/app/app.config.ts`). Angular prints this once in dev mode. Harmless; it is the only
  renderer warning. Optional fix (needs a build): drop zone.js from the polyfills for the Electron target if no
  dependency needs it.

### 2. CodeExecutionMCP register failures

- The workspace list contains a stale folder entry `main.mjs` (visible in the Workspaces panel). The path
  `...\command-center\dist\apps\ptah-electron\main.mjs` is a file, so writing `.mcp.json` below it gives ENOENT/ENOTDIR.
  `resolveInitialWorkspaceArg` (`apps/ptah-electron/src/activation/bootstrap.ts:202`) requires a directory, so the current
  launch does not create it; it is persisted state from an earlier launch. Dev-only. Possible hardening: skip or prune
  workspace entries that are not directories.

### Not reproduced: TypeError reading 'map' | 'length' | 'charAt' of undefined

Round 1 saw about 80 lines of this while 24 synthetic agents were injected. Root cause confirmed from source: those
fake agents used status `'cancelled'`, which is not an `AgentStatus` (`running|completed|failed|timeout|stopped`).
`STATUS_WORDS[...]` returns `undefined` and `capitalise(undefined)` throws on `charAt`
(`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:598-615`). In this round the agents used only
valid statuses and nothing was logged. Test artifact, not a product bug, though a defensive fallback
(`STATUS_WORDS[run.status] ?? run.status`) at `lane-tiles.ts:611,614,634` would stop one bad status from breaking the
whole tile list.

## Product bugs found

None reproduced. Only optional hardening: item 1 (zone.js polyfill), item 2 (workspace entry pruning), item 4 (empty
error object logged by the lane outcomes start), and the `lane-tiles.ts` status fallback above.

## If the user still sees many errors

They most likely come from a different state than this audit: a session with real delegated agents or lanes whose
status or fields differ from the typed shape (see `lane-tiles.ts`), a packaged build with a different CSP, or DevTools
open on a dev build. Ask for one concrete message and its source from the `[renderer] console.error` line in the log (it
now carries message and source).
