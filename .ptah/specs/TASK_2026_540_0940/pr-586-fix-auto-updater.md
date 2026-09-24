# PR 586 — auto-updater e2e flake fix (CI run 35972122158)

Date: 2026-09-24 · Branch: `feat-task-540-global-config-menu` · Task: TASK_2026_540_0940

## Failing test

`apps/ptah-electron-e2e/src/specs/auto-updater.spec.ts` — "app remains functional after updater path completes"
(test declared at line 211; the failing assertion was at line 224 before this change). CI run 35972122158:

```text
expect(JSON.stringify(after ?? {})).toContain('auto-updater-spec')
Received: "{}"
```

The test called `rpcBridge.setState(marker)`, then `mainWindow.waitForTimeout(150)`, then `rpcBridge.getState()`.
It ran 1.4 s after launch and passed on two earlier CI runs — a classic latency-dependent flake.

## Confirmed cause — pending async write, read back through a synchronous cache

Evidence chain, every link read in this worktree:

1. `apps/ptah-electron-e2e/src/support/rpc-bridge.ts:204-213` — `setState` emits `'set-state'` on `ipcMain`
   from inside `app.evaluate`. The registered handler is `async` and `ipcMain.emit` does not await it, so the
   evaluate resolves immediately while the write is still in flight (fire-and-forget).
2. `apps/ptah-electron/src/ipc/ipc-bridge.ts:512-521` — the `'set-state'` handler runs
   `await this.stateStorage.update('webview-state', state)` — a whole-key replace on the workspace store.
3. `libs/backend/platform-electron/src/implementations/electron-state-storage.ts:139-165` — workspace stores are
   worker-backed: `update` awaits a worker round-trip (`workerHost.update`, line 161) and only afterwards refreshes
   the synchronous in-memory cache (`this.data = workerHost.getCache()`, line 163). The worker also needs a
   first-ready handshake before serving anything (constructor sets `readinessState = { status: 'not-ready' }`,
   line 73; the cache is hydrated when `readyPromise` resolves, lines 90-98).
4. `apps/ptah-electron-e2e/src/support/rpc-bridge.ts:182-198` — `getState` emits `'get-state'` synchronously and
   captures `event.returnValue`.
5. `apps/ptah-electron/src/ipc/ipc-bridge.ts:499-511` — the `'get-state'` handler calls
   `stateStorage.get('webview-state')`, which reads the synchronous cache
   (`electron-state-storage.ts:116-120`, `this.data[key]`); on a not-ready store `assertReady()` throws
   (`electron-state-storage.ts:265-272`) and the handler's catch returns `{}` (ipc-bridge.ts:504-510).

So the read at T+150 ms returned the **pre-write** cache. The e2e harness gives every launch a fresh profile
(`apps/ptah-electron-e2e/src/support/electron-launcher.ts:126-127` — `mkdtemp` user-data dir, fresh
`PTAH_E2E_DB_PATH`), so the prior value of `webview-state` is unset → `state ?? {}` → `JSON.stringify({})` = `"{}"`.
Under CI boot load at 1.4 s after launch, the worker-backed commit (or the handshake itself) outran the fixed
150 ms budget; on the two earlier runs it landed in time.

### Renderer-clobber hypothesis — investigated and ruled out

The renderer *can* whole-key-replace `webview-state`: `apps/ptah-electron/src/preload.ts:30-31`
(`window.vscode.setState` → `ipcRenderer.send('set-state')`) and
`libs/frontend/core/src/lib/services/vscode.service.ts:237-248` (merge the key, then rewrite the whole state).
The production callers found:

- `libs/frontend/core/src/lib/services/theme.service.ts:231` — boot-time, but only on the localStorage-mirror
  recovery path, which cannot fire on the harness's fresh `mkdtemp` profile (no mirror, no persisted theme);
- `theme.service.ts:354` (`setTheme`) and `libs/frontend/git-ui/src/lib/services/git-review.service.ts:95,199` —
  user-triggered actions; this test performs none.

No renderer write occurs inside the window on this harness — and a clobber would have left a non-empty foreign
object in state, not `"{}"`.

## Fix (test-only)

`apps/ptah-electron-e2e/src/specs/auto-updater.spec.ts:219-231` — replaced the fixed
`waitForTimeout(150)` + one-shot read with a poll of `getState` alone, keeping the single `setState(marker)`:

```ts
await mainWindow.waitForLoadState('domcontentloaded');
const marker = { e2eMarker: 'auto-updater-spec', ts: Date.now() };
await rpcBridge.setState(marker);
// 'set-state' is fire-and-forget: the IpcBridge handler awaits an async
// workspace-storage commit (worker round-trip), while 'get-state' answers
// synchronously from the in-memory cache. Under CI boot load that commit
// can outrun any fixed sleep, so poll the read until the marker lands
// instead of guessing a 150ms budget.
await expect
  .poll(async () => JSON.stringify((await rpcBridge.getState()) ?? {}), {
    timeout: 10_000,
  })
  .toContain('auto-updater-spec');
```

Choice of poll shape: the evidence shows the sole failure mode is a **pending async commit**, not a concurrent
renderer write replacing the marker. Re-setting the marker on every poll iteration (the alternative shape) would
also pass but would mask a genuinely lost write; polling the read alone proves exactly the contract under test —
the set persists and becomes visible — while tolerating commit latency. The original comment's intent (skipping
the updater must not disturb boot wiring; state persistence must still work) is unchanged; the removed
`waitForTimeout` is gone. The `after` local was inlined into the poll.

## Verification

```text
npx nx run-many -t typecheck,lint -p ptah-electron-e2e --skip-nx-cache
NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e
Run duration: 8.8s · Cache: Skipped (--skip-nx-cache) · exit code 0
```

The Electron e2e suite was intentionally not run, per task constraints.

## Also recorded

`.ptah/specs/TASK_2026_550_9a28/context.md` — appended the section "## CI flakes seen on PR 586 (2026-09-24)"
with one bullet each for runs 35964056447 (`config-menu-keyboard.spec.ts:79`), 35970324119
(`git/git-dock.spec.ts:319`), 35972122158 (`auto-updater.spec.ts:224`, this fix) and 35964417827
(`chat/compaction-duplicate-session.spec.ts:52`, not investigated), closing with the flake-audit sentence.
No other section of that file was changed.
