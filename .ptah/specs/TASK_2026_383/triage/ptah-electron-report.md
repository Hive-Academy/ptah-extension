# TASK_2026_383 — Task 12.1 triage: `apps/ptah-electron`

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-383` (branch
`task/383-degradation-audit`). 28 flagged sites, all classified. Only edits made
are marker comments; `git diff -U0 -- apps/ptah-electron` shows comment lines
only.

## Split counts

| Label                          | Count |
| ------------------------------ | ----- |
| legitimate optional capability | 24    |
| reported                       | 0     |
| defect                         | 4     |
| test-only                      | 0     |

No site in this directory already emits a structured degradation report — the
two `DegradationReporter` call sites in `apps/ptah-electron` live in
`wire-runtime.ts`, which Batch 2 already marked and which is not in this row
set.

## All 28 sites

Line numbers are the ORIGINAL flagged lines (from `ptah-electron.rows.txt`);
markers shift later lines in the same file.

| #   | Site                                                   | Label               | Reason / note                                                                                                  |
| --- | ------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | `activation/plugin-activation.ts:240`                  | optional-capability | User-layer mirror is best effort; `null` = no roots resolved, harness reconciles the previously mirrored layer |
| 2   | `activation/plugin-activation.ts:449`                  | optional-capability | SQLite probe; `false` = no usable database, same answer as an unregistered connection                          |
| 3   | `activation/plugin-activation.ts:472`                  | optional-capability | Skill-candidate store is Thoth/Electron-only; `[]` = no slug folded into `disabledSkillIds`                    |
| 4   | `activation/skill-repropagation.ts:76`                 | optional-capability | Logger optional; `null` makes every `logger?.` a no-op instead of failing re-propagation                       |
| 5   | `activation/start-messaging-gateway.ts:87`             | optional-capability | Gateway is an opt-in channel; early return leaves it stopped, app fully usable                                 |
| 6   | `di/electron-adapters.ts:268`                          | optional-capability | Log-argument inlining; `'[Unserializable]'` keeps the message when an arg is cyclic                            |
| 7   | `di/phase-2-libraries.ts:129`                          | optional-capability | `harness.preflightTimeoutMs` read; `undefined` = use the `harness-sync` default                                |
| 8   | `di/phase-2-libraries.ts:151`                          | optional-capability | `harness.manageGitignore` read; `undefined` = use the `harness-sync` default                                   |
| 9   | `di/phase-2-libraries.ts:408`                          | optional-capability | Session-activity probe; `false` = no live session when no adapter resolves                                     |
| 10  | `ipc/ipc-bridge.ts:313`                                | **defect**          | Floating promise on the RPC ingress path — see D-2                                                             |
| 11  | `main.ts:120`                                          | optional-capability | Sentry flush on quit is best effort; `.finally` still calls `app.quit()`                                       |
| 12  | `rpc-host-profile.ts:60`                               | optional-capability | Worktree resolution is enrichment; `undefined` = no worktree matches that branch                               |
| 13  | `services/electron-browser-capabilities.ts:433`        | **defect**          | Floating `cleanup()` in the lifetime timer — see D-3                                                           |
| 14  | `services/electron-browser-capabilities.ts:497`        | optional-capability | Screencast frame ack; swallowing drops at most later frames of an optional recording                           |
| 15  | `services/electron-browser-capabilities.ts:513`        | **defect**          | Floating `cleanup()` in the inactivity timer — see D-3                                                         |
| 16  | `services/electron-browser-capabilities.ts:604`        | optional-capability | `Page.stopScreencast` on a session being torn down anyway; recorder still writes its frames                    |
| 17  | `services/electron-ide-capabilities.ts:277`            | optional-capability | AST analysis enrichment; `null` = no relative import resolved                                                  |
| 18  | `services/electron-ide-capabilities.ts:471`            | optional-capability | Comment/string exclusion is an optional filter; `[]` KEEPS every match                                         |
| 19  | `services/electron-ide-capabilities.ts:495`            | optional-capability | Unreadable file treated as one with no symbol; the search still reports the other files                        |
| 20  | `services/git-watcher.service.ts:288`                  | optional-capability | gitdir pointer follow is optional; `null` = no git context to watch                                            |
| 21  | `services/platform/electron-safe-storage-vault.ts:44`  | optional-capability | `false` selects the documented AES-256-GCM fallback; the token is still encrypted at rest                      |
| 22  | `services/platform/electron-safe-storage-vault.ts:81`  | optional-capability | `null` IS this port's decrypt-failure signal (header, architecture §9.4)                                       |
| 23  | `services/platform/electron-safe-storage-vault.ts:100` | optional-capability | Same signal for a wrong key / failed GCM auth tag                                                              |
| 24  | `services/rpc/handlers/editor-rpc.handlers.ts:977`     | **defect**          | `catch { return [] }` makes both callers' error handlers dead — see D-1                                        |
| 25  | `services/tray/tray.service.ts:192`                    | optional-capability | Tray keep-alive is optional; `null` is the R10 fail-safe, window-all-closed quits normally                     |
| 26  | `services/update/update-manager.ts:184`                | optional-capability | Update check is offline-tolerant; broadcasts the `error` lifecycle state, readable via `update:get-state`      |
| 27  | `windows/main-window.ts:50`                            | optional-capability | Unparseable navigation URL classified external; refused as a top-level navigation                              |
| 28  | `windows/main-window.ts:64`                            | optional-capability | Unparseable URL is never handed to `shell.openExternal`                                                        |

## Defects (not fixed, not suppressed)

### D-1 — `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:977`

**Masked**: `buildFileTree`'s own `catch { return []; }` wraps
`await this.fs.readDirectory(dirPath)`. Both callers already have the correct
handling — `editor:getFileTree` (`:352-365`) and `editor:getDirectoryChildren`
(`:388-402`) each `try`/`catch` the call, log at `error` and return
`{ success: false, error }`. Those handlers are structurally dead for any
`readDirectory` failure: a workspace root that cannot be enumerated (permission
denied, a disconnected network share, a deleted folder) returns
`{ success: true, tree: [] }` and the editor renders it as an empty project,
indistinguishable from a genuinely empty directory.

**Suggested fix**: let the top-level `readDirectory(dirPath)` rejection
propagate, and keep degradation only where it is genuinely per-node — attach
`.catch(() => [])` (or a `catch` inside the child branch) to the recursive
`this.buildFileTree(fullPath, …)` call at `:957`, so an unreadable SUBdirectory
renders as an empty folder while the requested directory's own failure reaches
the caller's existing error path. No new reporting surface is needed; the
callers already log and return `success: false`.

### D-2 — `apps/ptah-electron/src/ipc/ipc-bridge.ts:313`

**Masked**: `this.handleFireAndForgetMessage(messageType, msg);` is a bare call
to an `async` method inside the `ipcMain.on('rpc', async …)` handler. Because it
is not awaited, the enclosing `try`/`catch` at `:292`/`:337` cannot see a
rejection — it would surface as an unhandled rejection in the main process, not
as the "[IpcBridge] Unexpected error handling RPC message" line that the shape
of the code promises. This is the ingress path for every fire-and-forget
renderer message (SDK permission responses, AskUserQuestion answers, wizard
completion).

**Not a false positive of the structural detector** — the callee is genuinely
`async` and genuinely un-awaited. The impact is latent rather than live today:
every `case` body in `handleFireAndForgetMessage` (`:383-490`) is individually
wrapped in its own `try`/`catch` and the method contains no `await`, so its
promise cannot currently reject. That is an invariant nobody is enforcing — one
new `await`, or one `case` written without its own guard, turns it into a silent
unhandled rejection.

**Suggested fix**: `void this.handleFireAndForgetMessage(messageType, msg);`
with a `.catch()` that logs through the same console path as the enclosing
handler — or, since the method never awaits, drop `async` and make it
synchronous, which removes the class of failure rather than handling it.

### D-3 — `apps/ptah-electron/src/services/electron-browser-capabilities.ts:433` and `:513`

**Masked**: both timer callbacks call `this.cleanup();` bare —
`setTimeout(() => { this.cleanup(); }, MAX_LIFETIME_MS)` at `:432-434` and the
inactivity timer at `:512-514`. `cleanup()` (`:517-544`) awaits
`this.recorder.stopRecording(...)` and calls
`this.window.webContents.debugger.detach()`, either of which can throw. Two
consequences, both silent: the rejection is unhandled in the main process, and
— worse — everything after the failed `await` is skipped, so
`clearTimeout` on both timers, `debugger.detach()` and `this.window.destroy()`
never run. A browser session that fails to stop its recording therefore outlives
its own maximum lifetime with a live `BrowserWindow` and an attached CDP
debugger, which is exactly what these timers exist to prevent.

Neither site is on the boot path; both are on the automatic teardown path for a
capability that holds an OS window.

**Suggested fix**: `void this.cleanup().catch((error: unknown) => …)` at both
call sites, and move the `recorder.stopRecording` await inside `cleanup()` into
its own `try` so a recorder failure cannot skip the window and timer teardown
that follows it.

## Audit line

```
npx nx run degradation-audit:lint
  apps/ptah-electron: 4 ok (baseline 28)
```

4 unsuppressed sites = the 4 recorded defects. Zero `bare-suppression` and zero
`orphaned-suppression` anywhere in the run. (The tool now reports the third
floating promise at `:516` rather than `:513` — the marker comments above it
shifted the line; it is the same site.)

## Out-of-scope observations

- `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts:116-119`
  — `resolveMachineSeed()` calls `fs.readFileSync(candidate, 'utf8')` for
  `/etc/machine-id` and `/var/lib/dbus/machine-id` OUTSIDE the `try` that begins
  at `:120`. On Windows and macOS the first iteration throws `ENOENT` and
  propagates out of the method, so the AES-GCM fallback path is unreachable on
  the platforms the file header says it is "a last resort" for. Only reached
  when `safeStorage` is unavailable, so it is latent — but it is a plain bug,
  not a degradation-marker question. Not touched: outside the marker-only
  mandate for this lane.
- `electron-browser-capabilities.ts:610` — the outer
  `catch { return { filePath: '', …, error: '…' } }` in `stopRecording` was not
  flagged (the detector does not treat a populated object literal as a
  sentinel). It does carry an `error` field, so it is not silent; noted only so
  a later pass does not read its absence from the row set as an oversight.
