# Code Logic Review — Round 1 (`FIX_PLUGIN_SESSION_ROOT`)

- **Verdict**: APPROVED
- **Score**: 9/10
- **Review family**: antigravity (implementers: kimi-code for M-1, codex for M-2)

## Summary

| Metric              | Value            |
| ------------------- | ---------------- |
| Overall score       | 9/10             |
| Assessment          | APPROVED         |
| Blocking issues     | 0                |
| Serious issues      | 0                |
| Moderate issues     | 0                |
| Minor issues        | 1 (carried m-1)  |
| Failure modes found | 0                |

**Score separation**:
- Separated from **7-8 (Sound with moderate gaps)**: Both Moderate findings from Round 0 (`M-1` and `M-2`) and their corresponding failure modes (`FM-1` and `FM-2`) are resolved with targeted behavioral regression specs.
- Separated from **10/10**: The minor read-only legacy warning log (`m-1` from Round 0 at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:531-536`) remains unaddressed when inspecting a pre-lineage worktree session before it is resumed, and `readSessionPolicyRoots` performs a redundant `validateSessionPolicyRoot` call after `resolveSessionFolder` already validated the candidate.

---

## Per-Finding Verification

### [M-1] `sessionNotice` is not cleared when switching directly between two persisted session tabs — **FIXED** (implementer: `kimi-code`)

- **Fix Location**: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:800-823`
- **Verification Details**:
  1. **Synchronous clear before new request**: Inside the `effect()` watching `this.tabs.activeTabSessionId()`, `this.sessionNotice.set(null)` is now called unconditionally on line `805` inside `untracked()` before `if (sessionId === null) { return; }` (`:806-808`) and before `this.rpcService.call('plugins:get-config', { sessionId }, { timeout: 10000 })` (`:810-811`).
  2. **Stale-reply guard (`sessionNoticeRequestId`)**: `const requestId = ++this.sessionNoticeRequestId` (`:802`) still increments on every effect run before `untracked()`, and both `.then()` (`:812-816`) and `.catch()` (`:817-821`) guard writes to `this.sessionNotice` with `if (requestId === this.sessionNoticeRequestId)`. If Session A's RPC resolves or rejects after switching to Session B (or `null`), it is ignored.
  3. **Null-session path**: When `sessionId === null`, `requestId` increments (`:802`), `this.sessionNotice.set(null)` runs (`:805`), and the effect returns early (`:806-808`) without issuing an RPC call.
  4. **No same-session flicker or spurious effect re-run**:
     - The `effect()` (`:800-823`) reads only one reactive dependency outside `untracked()`: `this.tabs.activeTabSessionId()` (`:801`).
     - In `TabManagerService` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:516-520`), `activeTabSessionId` is defined as:
       ```ts
       readonly activeTabSessionId = computed(
         () =>
           this._tabs().find((t) => t.id === this._activeTabId())?.claudeSessionId ??
           null,
         { equal: (a, b) => a === b },
       );
       ```
     - Even though `_tabs` updates every ~16ms during streaming, `activeTabSessionId` uses `{ equal: (a, b) => a === b }` on primitive `string | null` values, so Angular suppresses downstream notifications whenever the active tab's `claudeSessionId` string is unchanged. The `effect()` in `PluginCatalogPanelComponent` only re-runs when the active tab's `claudeSessionId` actually transitions to a different value.
  5. **Regression spec verification (`plugin-catalog-panel.component.spec.ts:603-641`)**:
     - `'clears the current notice as soon as the session changes'` mounts the component with `FIRST_SESSION_ID` (`:610-612`), resolves `FIRST_SESSION_ID`'s RPC with `/sessions/first`, settles the fixture, and asserts the `[data-testid="plugin-session-notice"]` banner is rendered in the DOM (`:614-621`).
     - It then switches `activeTabSessionId.set(SECOND_SESSION_ID)`, flushes effects and runs `fixture.detectChanges()` while `SECOND_SESSION_ID`'s promise is still pending in `pending`, asserting both `fixture.componentInstance.sessionNotice() === null` and `host.querySelector('[data-testid="plugin-session-notice"]') === null` (`:623-630`).
     - Finally, it resolves `SECOND_SESSION_ID` with `/sessions/second`, settles the fixture, and asserts `/sessions/second` is rendered and `/sessions/first` is absent (`:632-640`). This exercises the full `A rendered -> B pending -> B resolved` lifecycle.

---

### [M-2] `resolveSessionFolder` / `readSessionPolicyRoots` returns un-realpathed `folder` string despite JSDoc contract — **FIXED** (implementer: `codex`)

- **Fix Location**: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-552`
- **Verification Details**:
  1. **Physical `folder` resolution**: `readSessionPolicyRoots` now captures `const candidate = await this.historyRead.resolveSessionFolder(sessionId)` (`:544`), passes `candidate` through `await validateSessionPolicyRoot(candidate, this.workspaceProvider, this.platformInfo)` (`:545-549`) to obtain the `fs.realpath`-resolved `folder`, passes `folder` into `await this.restoreLineage(sessionId, folder)` (`:550`), and returns `{ folder, ancestorRoots: roots }` (`:551`).
  2. **`resolveSessionFolder` unchanged for other callers**: `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:61-101` is completely untouched. Callers of `resolveSessionFolder` (`ChatHistoryReadService.readForResume` / `readPage` in `chat-history-read.service.ts:67,86`, `ChatSessionService` resume/continue paths in `chat-session.service.ts:1420,2112`, `agent-rpc.handlers.ts:1745`, and `session-rpc.handlers.ts:1207`) preserve their existing path-spelling behavior.
  3. **Error handling when validation throws**: Both `this.historyRead.resolveSessionFolder(sessionId)` and `validateSessionPolicyRoot(...)` throw `RpcUserError` with code `'SESSION_NOT_FOUND'` or `'SESSION_FOLDER_UNAVAILABLE'` (`session-folder.ts:28-31, 70-73, 97-100`), and `restoreLineage` throws `RpcUserError('...', 'SESSION_FOLDER_UNAVAILABLE')` on malformed or cyclic lineage (`chat-session.service.ts:487-490, 512-515`). In `PluginRpcHandlers.sessionNoticeFor` (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:371-398`), the `try / catch` block catches `RpcUserError`, logs at `debug` (`'RPC: plugins:get-config session notice unavailable'`), and returns `undefined` so `plugins:get-config` still succeeds with the project's plugin configuration.
  4. **Downstream consistency between `folder`, `ancestorRoots`, `getSessionPluginNotice`, and `harnessRootFor`**:
     - `folder` is now the physical path from `validateSessionPolicyRoot`, and every element in `ancestorRoots` returned by `restoreLineage` -> `validatedLineage` (`chat-session.service.ts:360-389, 496-520`) is also the physical path returned by `validateSessionPolicyRoot`.
     - In `restoreLineage` (`chat-session.service.ts:497-516` and `:526`), `executionRoot` is now `folder` (physical), which is compared against `physicalRoots` and deduplicated in `validatedLineage` (`seen = new Set([local])`).
     - In `PluginLoaderService.getSessionPluginNotice(sessionFolder, ancestorRoots, projectRoot)` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1031-1097`), `home.harnessRootFor(sessionFolder)` (`:1039`) invokes `resolveHarnessWorkspaceRoot(sessionFolder)` (`libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:66-84`). Because `sessionFolder` is now physical, `findAncestorWith` walks the physical directory tree upward and locates the enclosing worktree's `.git` or `.ptah` marker even when `SessionMetadata.workingDirectory` was a symlink pointing to a subdirectory inside the worktree.
     - `keyOf(layer)` (`plugin-loader.service.ts:1041-1042`) applies `canonicalRootKey(home.harnessRootFor(layer))` (`plugin-config-home.ts:164-173`, which runs `fs.realpathSync.native` and lowercase folding on `win32`) to `sessionRoot`, `projectRoot`, and every `layer` in `[sessionFolder, ...ancestorRoots]`, ensuring consistent canonical comparison across all layers.
  5. **New symlink spec & Windows CI portability (`chat-session-policy-roots.spec.ts:247-273`)**:
     - The spec creates a worktree directory containing a `.git` marker and a `packages/app` subdirectory, symlinks `app-link -> packages/app` using `symlinkSync(physicalFolder, linkedFolder, 'dir')` (`:255`), and verifies `readSessionPolicyRoots` returns `folder: realpathSync(linkedFolder)` (`:265-268`) while leaving metadata untouched (`assertReadOnly(h)`).
     - Using `'dir'` (rather than `'junction'`) is intentional and required here because `fs.realpath` on Windows resolves directory symlinks just like POSIX, whereas matching `session-folder.spec.ts:88, 95, 133` already uses `symlink(..., 'dir')` in the same project (`@ptah-extension/rpc-handlers`).
     - Checking `.github/workflows/` confirms that unit test jobs for `@ptah-extension/rpc-handlers` (`ci.yml` `test-shard` at line `200` and `nightly-coverage.yml` at line `32`) run exclusively on `ubuntu-latest`. The only Windows jobs in `.github/workflows/` are `ci.yml` `git-real-git` (`:341`, which runs only `vscode-core:test-real-git`, `ptah-electron --testPathPatterns=real-git`, and `platform-electron --testPathPatterns=editor-merge.real`), `publish-electron.yml` (`:284`, which runs only `nx test persistence-sqlite`), and `publish-cli.yml` (`smoke`, disabled with `if: false`). Thus `symlinkSync(..., 'dir')` in `chat-session-policy-roots.spec.ts` will not hit unprivileged Windows runner `EPERM` failures in CI.

---

## Five Logic Questions (Round 1 Delta)

1. **How does this fail silently — where does a failure produce a success-looking result?**
   - No new silent failures introduced. In `PluginCatalogPanelComponent` (`plugin-catalog-panel.component.ts:817-821`), an RPC rejection clears `sessionNotice` to `null` (handled degradation so the catalog panel remains usable). In `PluginRpcHandlers.sessionNoticeFor` (`plugin-rpc.handlers.ts:383-398`), `RpcUserError` is logged at `debug` and unexpected errors at `warn`, returning `undefined` so project plugin config still loads.
2. **What user action produces unexpected behaviour?**
   - None found. Switching between two session tabs now clears the previous tab's `sessionNotice` synchronously (`plugin-catalog-panel.component.ts:805`) before the new tab's RPC settles.
3. **What input data makes this produce a wrong answer rather than an error?**
   - None found. A symlinked `workingDirectory` pointing into a worktree subdirectory is now resolved to its physical path in `readSessionPolicyRoots` (`chat-session.service.ts:545-549`) before `harnessRootFor` performs lexical marker ascent.
4. **What happens when a dependency fails, times out, or returns a shape it should not?**
   - If `resolveSessionFolder` or `validateSessionPolicyRoot` fails (missing directory, dangling symlink, unauthorized workspace), `readSessionPolicyRoots` rejects with `RpcUserError('...', 'SESSION_FOLDER_UNAVAILABLE')`, which `sessionNoticeFor` catches and degrades to `undefined`. If `plugins:get-config` times out after 10,000 ms (`plugin-catalog-panel.component.ts:811`), `.catch()` leaves `sessionNotice` as `null`.
5. **What is missing that the requirements never mentioned?**
   - Nothing blocking or moderate. Note that in `PluginLoaderService.getSessionPluginNotice` (`plugin-loader.service.ts:1031-1097`), `incomplete` reflects unreadable nearer layers (`read.status === 'error'` at `:1062-1063`), while `restoreLineage`'s `legacy` flag (`chat-session.service.ts:537`) is not forwarded out of `readSessionPolicyRoots` (`chat-session.service.ts:550-551`). This matches the existing committed Batch 1/2/3 design and specs.

---

## New Defects

None.

---

## Carried Minor Observations (Non-Blocking)

1. **`[m-1]` (Minor, carried from Round 0)**: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:531-536` — `restoreLineage` logs `this.logger.warn('[RPC] Legacy session policy lineage has unknown earlier ancestors', { sessionId })` on every read-only `readSessionPolicyRoots` call for a legacy distinct-cwd session until that session is resumed.
2. **Double validation of `candidate` (Minor / Non-blocking)**: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:544-549` — `this.historyRead.resolveSessionFolder(sessionId)` already calls `validateSessionPolicyRoot` internally (`session-folder.ts:79`), and `readSessionPolicyRoots` immediately calls `validateSessionPolicyRoot` a second time (`chat-session.service.ts:545-549`) to get the physical path, followed by a third call inside `restoreLineage` (`chat-session.service.ts:493, 497, 527`). The extra `fs.realpath`/`fs.stat`/`fs.access` syscalls on a single directory per tab switch are negligible in cost and preserve `resolveSessionFolder`'s return value for other callers.

---

## Tooling & Skill Notes

- **Review family**: `antigravity` (implementers: `kimi-code` for M-1, `codex` for M-2).
- **Ptah Diagnostics**: `ptah_get_diagnostics` was called on the 4 modified files (`plugin-catalog-panel.component.ts`, `plugin-catalog-panel.component.spec.ts`, `chat-session.service.ts`, `chat-session-policy-roots.spec.ts`), and timed out after 45s across 3 retries (`typescript-compiler — Unavailable: TypeScript check still running after 45s`). Per coordinator instructions, no heavy shell checks were launched from this lane; both implementer fix reports recorded passing `npm run verify -- -t test,lint,typecheck` runs for `chat-ui` and `rpc-handlers`.
