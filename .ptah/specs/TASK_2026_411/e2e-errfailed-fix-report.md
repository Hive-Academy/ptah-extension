# PR #494 — the two CI failures

Branch `fix/task-411-profile-performance`, failing head `beba0cd74`.

## Failure 1 — every Electron e2e test fails, suite hits the 45-minute cap

### The mechanism (proven)

A **sync-IPC deadlock between the preload script and the new preparing shell.**

1. `apps/ptah-electron/src/preload.ts:18` calls
   `ipcRenderer.sendSync('get-startup-config')` at **module scope**. Every window
   this app opens runs that preload, and `sendSync` blocks the renderer until the
   main process replies.
2. Electron **never replies to a sync channel that has no listener**. It prints
   `WebContents #N called ipcRenderer.sendSync() with 'get-startup-config'
   channel without listeners` and leaves the renderer blocked.
3. The only responder was registered at `apps/ptah-electron/src/activation/post-window.ts:71`,
   inside `registerPostWindow`.
4. This branch made the **preparing shell the first window**. `main.ts:81` creates
   it and `await`s `loadFile(preparingShellPath)` **before** `bootstrapElectron`,
   and `registerPostWindow` runs only after `bootstrapElectron` returns.

That closes a ring: the shell's preload waits for a responder → the renderer never
finishes loading → `did-finish-load` never fires → the awaited `loadFile` never
settles → `bootstrapElectron` is never called → the responder is never registered.
The app is wedged before any test assertion runs.

`ERR_FAILED (-2)` is the **symptom of the teardown, not the cause**. Electron's
`loadURL`/`loadFile` rejects with it from `did-stop-loading` when a pending
navigation is abandoned — the CI stack frame says so literally:
`at WebContents.stopLoadingListener`. It fires 30 s later, when Playwright gives
up and closes the app.

### Evidence chain (CI run 34660703174, head `beba0cd74`)

| Time | Line | Reading |
| --- | --- | --- |
| 00:13:23.8 | `Running 175 tests using 1 worker` | suite starts |
| 00:13:28.3 | `WebContents #1 called ipcRenderer.sendSync() with 'get-startup-config' channel without listeners` | the shell's preload blocks; **main is alive** (it logged this) |
| — | 30 s of silence | nothing else is logged: boot never advances |
| 00:13:58.3 | `Saving window bounds` | Playwright's 30 s launch budget expires, window closes |
| 00:13:58.3 | `ERR_FAILED (-2) ... at WebContents.stopLoadingListener` | the still-pending load is abandoned |
| 00:13:58.5 | `✘ 1 auto-updater.spec.ts:26 (34.1s)` | first failure, ≈30 s + overhead |

Corroboration, in order of strength:

- **The one passing test is the only one that never launches the app.**
  `auto-updater.spec.ts:186` reads `electron-builder.yml` off disk and passes in
  **17 ms**. Every other spec in the run launches Electron, and every one of them
  fails at ≈31 s — the signature of a fixed timeout, not of varied assertions.
- **The warning does not exist on `main`.** Green run 25274718285 contains
  **0** occurrences of `without listeners`; this branch emits exactly one per
  launch. On `main` the first window is created at `post-window.ts:99`, *after*
  line 71 registers the channel, so the ring never closes.
- **Deterministic, and it must be**: the ordering is unconditional in source, which
  matches four consecutive runs hitting the cap.

### Why the rejection was also fatal on its own

`main.ts:71` is `app.whenReady().then(async () => { ... })` with no `.catch`. The
`loadFile` rejection propagated out of that callback as an unhandled rejection, so
even a merely *aborted* shell load would skip `bootstrapElectron` and leave a
blank window. Two defects, one line apart.

### Ruled out, with reasons

- **Missing asset** — `ERR_FILE_NOT_FOUND` is `-6`; this is `-2`. The stack frame
  names `stopLoadingListener`, an abandonment path, not a resolution failure.
- **Malformed `?state=preparing` query** — that is just Electron printing the
  resolved URL.
- **A later `loadFile` superseding the first** — the renderer swap in
  `post-window.ts` is downstream of `bootstrapElectron` and is never reached.
- **Two `ElectronStateStorage` instances racing** — real, already fixed in
  `73efbfbf3` / `a9f2fd97d`, and not this.

### The fix

- **NEW** `apps/ptah-electron/src/activation/startup-config-ipc.ts` — the one
  responder, with `readStartupConfig(container)` separated from registration.
  `null` is a first-class answer: the shell renders no workspace, so an empty
  config is correct at that moment, and the renderer asks again when the same
  window is navigated to the Angular bundle. `event.returnValue` is assigned on
  **every** path including failure — leaving it unset is the wedge itself.
- **`main.ts`** — `registerStartupConfigIpc(() => bootContainer)` runs before the
  first window is created, reading the container through a closure so it serves
  the real one the moment boot produces it. The awaited shell load is wrapped in
  `try/catch`, and the recovery/activate loads carry `.catch` handlers, so no
  navigation failure can abort the boot again.
- **`post-window.ts`** — the duplicate registration is deleted (replaced by a
  comment recording why it may not live there). No second listener, no shim.

### New coverage

`apps/ptah-electron/src/activation/startup-config-ipc.spec.ts`, 9 tests:

- **Behavioural** — the responder answers before any container exists; answers
  with the live workspace once one arrives; still answers when the provider
  throws; registers exactly one listener when called twice.
- **Ordering (this is the one that catches this bug)** — `main.ts` must register
  the responder before `createMainWindow(` and before `loadFile(preparingShellPath`,
  and `post-window.ts` must not contain `ipcMain.on('get-startup-config'`. Run
  against the failing head, both assertions fail.
- **Pins the premise** — preload still blocks at module scope on this exact
  channel, so the ordering rule cannot quietly become unnecessary.
- **Guards the rejection defect** — the shell load is inside a `try` that precedes
  `bootstrapElectron`.

These are source-order assertions because `main.ts` uses `import.meta` and is not
importable under ts-jest; that is the repository's existing pattern for this file
(`state-storage-readiness-gate.spec.ts`). The e2e suite is untouched and the
45-minute timeout is unchanged.

## Failure 2 — degradation-audit ratchet

CI reported **three** failing directories, not one (run 34660703224):

```
libs/backend/platform-electron: 13 FAIL (baseline 4)
libs/backend/vscode-core:        1 FAIL (baseline 0)
libs/frontend/dashboard:         1 FAIL (baseline 0)
```

The brief quoted only the dashboard line, so fixing dashboard alone would have
left the job red. All ten new sites are this branch's own state-storage-worker
code. Each got a `// degradation-audit:` marker with a real justification, in the
placement zone the tool accepts. No `--update-baseline`.

- **`session-analytics-state.service.ts:446`** (`reported`) — the error *is*
  surfaced: `_loadError` is what the analytics card renders. The bare `return` the
  audit saw guards only a **superseded** load; writing a stale load's error there
  would overwrite the live one with an aborted request's message.
- **`electron-state-storage.ts:101`** (`reported`) — the subscription exists only
  to suppress an unhandled-rejection warning; `readinessState` keeps the error and
  every `whenReady()` caller still receives it.
- **`worker-host.ts:613`** (`reported`) — routed, not swallowed: `onWorkerFailure`
  rejects every pending operation with the crash error.
- **`worker-host.ts:319`, `:432`, `:641`; `commit-store.ts:58`, `:225`, `:364`,
  `:371`; `workspace-aware-state-storage.ts:93`** (`optional-capability`) —
  best-effort cleanup after the real failure has already been rethrown or
  reported, plus one existence probe where the rejection *is* the answer.

## Gates (all foreground, all green)

| Gate | Result |
| --- | --- |
| `npx jest --config apps/ptah-electron/jest.config.ts` | 39 passed, 1 skipped / 40 suites; 513 passed. Covers the new spec, `state-storage-readiness-gate`, `di/container.smoke`, `main.quit-path`, `main.metadata-flush`. Run directly with `PTAH_ALLOW_SKIP_UNBUILT=1`: the Nx `test` target's `dependsOn` builds cannot run in this worktree. |
| `npx nx run degradation-audit:lint` | **PASS**. `platform-electron: 4 ok (baseline 4)`; dashboard and vscode-core at 0. Total 315 → 304. |
| `npx nx run di-lint:lint` | PASS — 1463 `@inject` sites, 668 tokens |
| `npx nx run-many -t test -p @ptah-extension/dashboard @ptah-extension/platform-electron` | **2 projects**; 71 + 346 passed |
| `npx nx run-many -t test -p @ptah-extension/platform-electron @ptah-extension/vscode-core` | **2 projects**; 346 + 530 passed |
| `npx nx run-many -t typecheck -p @ptah-extension/dashboard @ptah-extension/platform-electron ptah-electron` | 3 projects, PASS |
| `npx nx run-many -t typecheck -p @ptah-extension/platform-electron @ptah-extension/vscode-core` | 2 projects, PASS |

## What stays unverified without a local e2e run

This worktree cannot launch Electron or Playwright (`node_modules` lacks
`electron`, `@playwright/test`, `web-tree-sitter`, `prismjs`, `daisyui`), and
nothing was installed. So:

- The deadlock was **not** reproduced locally. It is proven from source plus CI
  logs, and the chain above is complete and falsifiable — but the proof that the
  suite now returns to its 6–8 minute runtime can only come from CI.
- Unverified locally: that the shell paints, that the renderer swap still hands
  Angular the real `workspaceRoot` on the second preload run, and that no
  *other* startup defect sits behind this one. The first launch-based spec to go
  green settles all three.
- `nx run ptah-electron-e2e:e2e` and the app's own `test` target (whose
  `dependsOn` builds the ESM workers) were not run here for the same reason.

## Out-of-scope observations

- `libs/backend/platform-electron` and `libs/backend/vscode-core` were edited to
  clear the ratchet even though they sit outside this task's batch. Leaving them
  would have left `degradation-audit:lint` red. Comment-only changes; both libs'
  full suites and typechecks pass.
- `.ptah/specs/TASK_2026_411/ci-fixes-report.md` is untracked and belongs to
  another agent. Left alone, not committed.
- `apps/ptah-electron/__mocks__/electron.ts` gained `removeAllListeners` so the
  shared mock matches the `ipcMain` surface now used.
