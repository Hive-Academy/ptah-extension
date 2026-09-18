# Fix round 2 of 2 — backend (`TASK_2026_469_3e56`)

All four new defects from `verify-round-1-backend.md` are fixed. Nothing else in
that file's table was marked NOT FIXED. No file outside `libs/backend/**` was
edited (the parallel frontend lane is untouched).

## Defect 1 — early-exit candidate reported as success

**Status: FIXED**

A candidate that starts and exits at once is now rejected inside a bounded
probe window (`TERMINAL_EXIT_PROBE_MS` = 1500 ms) and the launch moves to the
next candidate. Exit code 0 still counts as success, so the legitimate fast
returns (`git-bash.exe`, the `cmd.exe /c start` trampoline) keep working. A
non-zero exit, a null-code (signal) exit, an `error` event, or ANY exit from a
`Microsoft\WindowsApps\` stub path (broken `wt.exe` alias) is a failure. The
probe reads the port's synchronous `exitCode` before attaching listeners, so an
exit that happened before attach is still seen. The timer is cleared in
`finish()` and `unref()`d. Only the `IProcessSpawner` port is used.

- `libs/backend/platform-core/src/utils/terminal-launch.ts:170` — `TERMINAL_EXIT_PROBE_MS`
- `libs/backend/platform-core/src/utils/terminal-launch.ts:187` — `spawnTerminalProcess` (probe wired at the `whenSpawned` await)
- `libs/backend/platform-core/src/utils/terminal-launch.ts:289` — `isWindowsAppsStub`
- `libs/backend/platform-core/src/utils/terminal-launch.ts:311` — `exitsInsideProbeWindow`
- `libs/backend/platform-core/src/index.ts:258` — `TERMINAL_EXIT_PROBE_MS` barrel export

Tests (`libs/backend/platform-core/src/utils/terminal-launch.spec.ts`):

- `:294` `tries the next candidate when the first candidate starts and exits at once with a non-zero code`
- `:311` `tries the next candidate when the spawner reports an error after the start`
- `:328` `reports success when the candidate stays alive through the probe window` (fake timers, advances exactly `TERMINAL_EXIT_PROBE_MS`)
- `:405` `treats an immediate exit of the WindowsApps wt.exe stub as a failure and falls back` (stub exits 0 — still a failure)
- `:430` `counts the cmd.exe start trampoline fast clean exit as success`

## Defect 2 — no fallback on non-Windows hosts

**Status: FIXED**

Follow-on candidates are now built from `terminalExecutableCandidates` for
EVERY platform. The old `platform === 'win32'` gate is gone. Path comparison is
case-insensitive with win32 normalization on win32, POSIX-normalized elsewhere
(`normalizeForComparison`, terminal-launch.ts:275).

- `libs/backend/platform-core/src/utils/terminal-launch.ts:202-208` — candidate list built for every platform, starting after the detected candidate's index
- `libs/backend/platform-core/src/utils/terminal-launch.ts:275` — `normalizeForComparison`

Tests (`terminal-launch.spec.ts`):

- `:273` `walks the whole built-in list before failing on a non-Windows host` (all 5 Linux candidates attempted, exact command order pinned)
- `:243` `tries the next candidate when the first candidate never starts` (Linux: x-terminal-emulator → gnome-terminal)
- `:229` `attempts only the detected candidate when it is not in the built-in list` (`targetIndex === -1` branch, previously untested)

## Defect 3 — unreachable handler-level fallback

**Status: FIXED**

The dead per-candidate retry loop in `EditorRpcHandlers.openDetected` is
deleted. Detection yields at most ONE target per id, so there was nothing for it
to iterate. One fallback location remains: `spawnTerminalProcess`
(platform-core), where the candidate order lives.

- `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:174-196` — `openDetected` now detects, launches once, and reports; doc comment states the fallback owner

Test (`libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.spec.ts`):

- `:173` `answers a failed launch with fixed copy, never a retry loop` (asserts exactly one `openWorkspace` call, fixed copy, and the real error only logged)

## Defect 4 — spec drives a call shape no production adapter uses

**Status: FIXED**

The test-only `candidates` parameter is REMOVED from `spawnTerminalProcess` —
production callers (`cli-editor-launcher.ts`, `electron-editor-launcher.ts`)
call it with 4 arguments, and now so does every spec. The win32 fallback specs
drive the production call shape: they set `process.env['ComSpec']` to a path
that is absolute on every host (CI is Linux) and build the `wt.exe` path with
the same formula production uses (`LOCALAPPDATA` fallback to
`homedir/AppData/Local`).

- `libs/backend/platform-core/src/utils/terminal-launch.ts:187-194` — `spawnTerminalProcess(spawner, target, workspaceRoot, platform)` — no `candidates` parameter

Tests (`terminal-launch.spec.ts:348` sub-describe `the built-in win32 list (production call shape)`):

- `:376` `falls back from a detected wt.exe to the cmd.exe candidate`
- `:405` `treats an immediate exit of the WindowsApps wt.exe stub as a failure and falls back`
- `:430` `counts the cmd.exe start trampoline fast clean exit as success`

## Adapter spec compatibility (consequence of defects 1+4)

Both terminal-launching adapter specs' fake handles now carry `exitCode: 0`,
`once`, `off` — the fields the new probe reads. A fake handle without them would
hang the probe window or read `undefined` as a non-zero exit.

- `libs/backend/platform-cli/src/implementations/cli-editor-launcher.spec.ts:14-19`
- `libs/backend/platform-electron/src/implementations/electron-editor-launcher.spec.ts:8-13`

## Verification

Test command (run from repo root):

```
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/rpc-handlers @ptah-extension/vscode-core --parallel=1 --skip-nx-cache
```

Header: `NX   Running target test for 5 projects:` — 5 requested, 5 listed.

Per-project results:

- platform-core: `Test Suites: 42 passed, 42 total` / `Tests: 4 todo, 802 passed, 806 total`
- vscode-core: `Test Suites: 39 passed, 39 total` / `Tests: 663 passed, 663 total`
- rpc-handlers: `Test Suites: 101 passed, 101 total` / `Tests: 33 skipped, 3074 passed, 3107 total`
- platform-cli: `Test Suites: 15 passed, 15 total` / `Tests: 3 todo, 217 passed, 220 total`
- platform-vscode: `Test Suites: 18 passed, 18 total` / `Tests: 3 todo, 208 passed, 211 total`

Final line: `NX   Successfully ran target test for 5 projects`

Typecheck command (run from repo root):

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine
```

Header: `NX   Running target typecheck for 8 projects:` — 8 requested, 8 listed.

Final line: `NX   Successfully ran target typecheck for 8 projects`

### Extra check (not in the prescribed list)

`npx nx test @ptah-extension/platform-electron --skip-nx-cache` — run because
this round edits `electron-editor-launcher.spec.ts`, which is NOT in the
prescribed test list. Result: `Test Suites: 1 failed, 2 skipped, 35 passed, 36
of 38 total` / `Tests: 3 failed, 4 skipped, 3 todo, 615 passed, 625 total`.
`electron-editor-launcher.spec.ts` passed. The 3 failures are all in
`workspace-watch-host.stress.spec.ts` with the message
`workspace-watch-host stress rig: D:\projects\ptah-extension\dist\apps\ptah-electron\workspace-watch-host.mjs is missing; run npx nx run ptah-electron:build-workspace-watch-host first.`
That is a pre-existing environmental failure (a dist bundle this machine has
not built). It is unrelated to this change and outside this batch's scope.

## Plan deviations

None.

## Out-of-scope observations

- The first platform-core test run printed `A worker process has failed to exit
gracefully and has been force exited`. A repeat run of the same suite did not
  print it. The probe always clears its timer in `finish()` and calls
  `unref()`, so it does not hold a Jest worker; the warning is intermittent and
  platform-core contains fork-based watch-host specs that plausibly cause it.
  All suites passed in both runs.
