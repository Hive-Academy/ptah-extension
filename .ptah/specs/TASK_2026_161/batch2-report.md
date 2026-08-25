# TASK_2026_161 · Batch 2 (issue #430 item C) — Process-tree-kill fix

Systemic fix so abort/timeout actually reaps the whole process subtree of every
spawn-based SDK adapter, instead of orphaning descendants (or, on Windows, only
killing a `cmd.exe` shim). All target files live under
`libs/backend/cli-agent-runtime/src/lib/cli-agents/` (note: the adapters are in
the `cli-adapters/` subfolder — the task's paths omitted that segment; corrected
against the actual tree).

## Checkbox results

1. **`killProcessTree` added to `cli-adapter.utils.ts`** — Done. New exported
   `async killProcessTree(pid, signal='SIGTERM', onError?)`. Windows =
   `taskkill /pid <pid> /T /F` (best-effort, `onError` on failure). POSIX =
   `process.kill(-pid)` group-kill with single-process `process.kill(pid)`
   fallback on ESRCH, then a timed SIGKILL escalation after `KILL_GRACE_PERIOD`.
   Added the requested short-circuit: before escalating, `process.kill(pid, 0)`
   is used to detect an already-exited process and resolve without SIGKILL. The
   grace-period timer is `unref()`'d. `KILL_GRACE_PERIOD` (5000) is imported from
   `../agent-process-manager-helpers` (verified relative path: utils is in
   `cli-adapters/`, helpers in the parent `cli-agents/`). Added `execFile` +
   `promisify(execFile)` → `execFileAsync`.

2. **`detached` added to `spawnCli`** — Done. `detached: process.platform !== 'win32'`
   added to the `crossSpawn` options; all existing options (cwd, stdio, env,
   windowsHide/needsConsole) preserved. Gives POSIX children a real process group
   for `process.kill(-pid)` to target.

3. **pi / antigravity / opencode routed through `resolveDirectSpawn()`** — Done,
   matching the copilot reference pattern (`spawnCli(desc.command,
[...desc.prefixArgs, ...args], {...})`). Descriptor resolved once per run in
   each `runSdk` (binary is stable across turns). opencode passes its already-
   resolved `binary` (native `.exe` from `resolveOpencodeNativeBinary` or the
   `.cmd` shim — `resolveDirectSpawn` returns the `.exe` unchanged) and keeps its
   `env` (OPENCODE_CONFIG_CONTENT). antigravity keeps `needsConsole` + spawnEnv;
   pi keeps its stdin RPC channel. The short-lived `models` / `--list-models` /
   `--version` probe spawns were **left unchanged** as instructed.

4. **`getPid` added to `SdkHandle` and the 4 spawn adapters** — Done. Optional
   `readonly getPid?: () => number | undefined` on the interface. Returned as
   `getPid: () => activeChild?.pid` for the mutable-child adapters (pi, copilot)
   and `getPid: () => child.pid` for the single-const adapters (antigravity,
   opencode).

5. **Abort/killChild handlers tree-kill** — Done. copilot/antigravity/opencode
   `onAbort` now `void killProcessTree(child.pid)` (guarded on `child?.pid &&
!child.killed`). pi's `killChild` keeps the `{"type":"abort"}` `writeRequest`
   first, then `void killProcessTree(child.pid)` in place of `child.kill('SIGTERM')`.
   Pi's `agent_settled` vs `agent_end`/willRetry settle logic is untouched.

6. **`AgentProcessManager.killProcess()` points at the shared helper** — Done.
   - Tracked-`ChildProcess` branch: the inline Windows `taskkill` + POSIX
     group-kill/SIGKILL logic replaced with a single
     `await killProcessTree(child.pid, 'SIGTERM', captureTreeKillError)`, where
     `captureTreeKillError` preserves the Sentry capture (errorSource
     `AgentProcessManager.killProcess.treeKill`).
   - SDK branch: after `sdkAbortController.abort()`, if
     `tracked.sdkHandle?.getPid?.()` yields a pid it is tree-killed (same Sentry
     onError). The blind `setTimeout(resolve, 500)` is replaced with
     `Promise.race([tracked.sdkHandle?.done ?? Promise.resolve(),
setTimeout(KILL_GRACE_PERIOD)])` (the Secondary improvement, included).
   - Removed the now-unused `execFileAsync` and its `execFile` / `promisify`
     imports (verified: only other `ChildProcess` import kept — it is still used
     for the `process` field type). `KILL_GRACE_PERIOD` remains imported/used.

### Optional items (SKIPPED as instructed)

- No `%SystemRoot%\System32\taskkill.exe` hardening.
- No other refactors. codex-cli / cursor-cli adapters untouched.

## Files touched

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`

## Typecheck

`npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` → **EXIT 0**
(no type errors). No new dependency added (`tree-kill` NOT installed).

## Caveats / deviations

- **POSIX detached-stdio smoke test could not be run** — this is a Windows host,
  so the `detached:true` + piped-stdio interaction on macOS/Linux (flagged as
  worth a smoke test in the research doc, Q2) was not exercised here. All streams
  remain `pipe`, so behavior is expected to be unaffected, but it is unverified
  on POSIX.
- **Helper best-effort POSIX semantics**: `killProcessTree` only has a pid, so it
  cannot listen for a specific child's `exit`; it waits the full grace period
  (minus the `process.kill(pid,0)` already-gone short-circuit) before SIGKILL.
  This matches the best-effort contract in the spec. The manager/adapters own
  their own exit wiring; the manager additionally awaits `sdkHandle.done` (capped)
  so it still observes real settlement.
- **New import edge**: `cli-adapter.utils.ts` now imports `KILL_GRACE_PERIOD`
  from `../agent-process-manager-helpers` (a leaf constants module, no back-import
  of utils), so no import cycle is introduced.
- **Defense-in-depth double-kill**: on abort, both the adapter's `onAbort` and
  the manager's SDK branch may call `killProcessTree` for the same pid. This is
  intentional and safe — the second call hits the already-exited short-circuit /
  best-effort catch.

## Revision (post-logic-review)

Applied 4 fixes from the logic review; everything else kept. Lib typecheck
re-run → **EXIT 0**.

- **Fix 1 (blocking) — POSIX helper no longer blocks the full grace period.**
  `killProcessTree`'s POSIX wait was a single `setTimeout(KILL_GRACE_PERIOD)` that
  always waited ~5s even when the process died instantly (a regression vs the old
  manager code that raced `child.on('exit')`). Replaced with a 100ms poll loop
  using `process.kill(pid, 0)` as a bare-pid liveness probe: it resolves as soon
  as the process is gone (ESRCH) and only escalates to `killGroup('SIGKILL')` if
  still alive after `KILL_GRACE_PERIOD`. Still needs no `ChildProcess` handle.
  File: `cli-adapters/cli-adapter.utils.ts`.

- **Fix 2 (blocking) — removed dead `Promise.race` in the manager SDK branch.**
  `tracked.sdkHandle.done` is frozen to turn-1's promise (already settled for any
  continuation turn), so the race never actually waited for the current turn.
  Removed it entirely. When a live PID is exposed, we now rely on `killProcessTree`
  (which, post-Fix-1, blocks until real exit); when no PID is exposed, we keep a
  brief 500ms settle wait. `KILL_GRACE_PERIOD` became unused in the manager and
  was dropped from its import.
  File: `agent-process-manager.service.ts`.

- **Fix 3 (cheap regression) — `detached` is now opt-in, not unconditional.**
  `spawnCli` previously forced `detached: process.platform !== 'win32'` on ALL
  spawns, including short-lived `--version`/`models`/`--list-models` probes that
  are never tree-killed and only gained POSIX orphan risk. Added `detached?: boolean`
  to the options type; the crossSpawn call now computes
  `process.platform !== 'win32' && options.detached === true`. Only the 4 main-run
  task spawns (pi, antigravity, opencode, copilot — the same ones routed through
  `resolveDirectSpawn`) pass `detached: true`; all probe spawns omit it (→ false).
  Files: `cli-adapter.utils.ts` + the 4 adapters.

- **Fix 4 (trivial consistency) — copilot resets `activeChild` between turns.**
  `copilot-sdk.adapter.ts` never nulled `activeChild` on turn completion (unlike
  pi's `finish()`), so a relaxed status guard could let `getPid()` return a stale
  dead PID. Set `activeChild = undefined` in both the per-turn `'close'` and
  `'error'` handlers, mirroring pi's pattern.
  File: `cli-adapters/copilot-sdk.adapter.ts`.
