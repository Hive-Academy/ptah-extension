# Review 10b.0b revise 2

Verdict: REVISE
Score: 7/10
Review family: grok (implementer: codex)

## Defects

1. **Moderate** — `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:574-584`. The new guard records `CodexProcessFailureError('Codex process exited', method)` only when `child.exitCode !== null`. A signal death leaves `exitCode` null.

   Listener order is the reported root cause and is still true. `codex-context.ts:131-132` registers `exit` and `close` on the child before `CodexAppServerProcess` registers `onExit` / `onClose` at `codex-app-server-process.ts:193-194`. The context listener calls `close()` synchronously (`codex-context.ts:926-969`) and rejects pending requests before `onExit` (`codex-app-server-process.ts:515-516`) can run `fail()`.

   The production spawner is the off-thread handle behind `SDK_PROCESS_SPAWNER` (`apps/ptah-electron/src/di/codex-runtime-composition.ts:418-419`). That handle can finish with `exitCode === null` and `signalCode` set:
   - Worker `finish()` assigns `code` and `exitSignal`, sets `exitObserved`, then emits `exit` (`off-thread-process-spawner.ts:484-492`, getters at `349-360`). A signal exit keeps `code` null (`markSignalDeath` at `520-524`).
   - Worker `endAbnormally()` sets `signalCode` and emits `error` then `exit` without setting `exitObserved` (`417-426`). The context `error` listener is the same `onFailure`, so `close()` still runs first.
   - The inline fallback sets `exitObserved` before it re-emits Node's `exit` (`662-665`, `683-684`) and does not expose `signalCode`. Node's own `exitCode` stays null when `signalCode` is set.

   `SpawnedProcessHandle` (`process-spawner.interface.ts:136`) only publishes `exitCode`, so the guard cannot see the other flags without a structural check. For those exits, `close()` still rejects the pending `thread/start` with `Error('Codex process closed')` at `593-597` and clears the map. `onExit` then stores a typed failure with no method, too late for the promise. `codex-runtime.ts:140-147` therefore does not throw `CodexPreTurnConfigRejectedError` even when the stderr tail is a config refusal. That is not what `onExit` -> `fail('Codex process exited')` produces when it wins the race.

   A deliberate close of a live child is unaffected: `exitCode`, `signalCode`, and `exitObserved` are all still unset, the guard stays false, and line 593 keeps `Error('Codex process closed')`.

   For a numeric exit the new error matches `fail()`: same class, message `'Codex process exited'`, and the single pending method (or `undefined` when more than one request is pending). No `cause` is attached; `onExit` also passes no cause. The debug log inside `fail()` is skipped because `close()` assigns `this.failure` directly and the later `fail()` sees `first === false`. `codex-runtime.ts:122-138` still logs the open failure and the stderr tail.

   Chat and gateway do not branch on this type. Grep of `libs/backend/codex-runtime/src`, `libs/backend/agent-sdk/src/lib/codex-app-server`, and `libs/backend/rpc-handlers/src/lib/chat/codex-host` found no `CodexProcessFailureError` and no `'Codex process closed'` checks outside the process file. `codex-chat-adapter.ts:679-687` wraps any open failure as `Codex chat open: runtime-failed`. The user-visible adapter message does not change. The lane classifier does.

   **Fix:** Treat the child as already exited when `exitCode !== null`, or `'signalCode' in child` and `signalCode != null`, or `'exitObserved' in child` and `exitObserved === true`. Keep the `!this.failure` and `pending.size > 0` checks. Do not use `killed` alone. Narrow with `in` checks; do not import `agent-sdk`. Extend the process-failure spec so a signal-only exit (`exitCode` null, `signalCode` set or `exitObserved` true) still rejects with `CodexProcessFailureError` whose method is `thread/start`.

## Checked

- Root cause: confirmed. Context `exit`/`close` listeners at `codex-context.ts:131-132` run before process listeners at `codex-app-server-process.ts:193-194`. `onFailure` starts `process.close()` before `onExit`/`onClose`.
- Numeric exit vs `onExit`: same `CodexProcessFailureError('Codex process exited', sole pending method)`. Difference is the skipped `fail()` debug log. Chat/gateway user text stays `Codex chat open: runtime-failed`. Lane config classification changes only when the rejected error is that typed failure and the stderr tail matches `codex-runtime.ts:32-34`.
- Live deliberate close (`exitCode` null, no signal, `exitObserved` not set): still `Error('Codex process closed')` at `codex-app-server-process.ts:593`.
- Spec fake: `FakeChild` still implements `SpawnedProcessHandle` with `exitCode`. The TOML case sets `exitCode = 1`, ends stdout and stderr, then emits `close` (`codex-runtime.spec.ts:2236-2244`). `final()` returns when `exitCode !== null` (`149-155`), so stdin end does not emit a second close. In that `close` emission the context listener runs `close()` and the process `onClose` then `cleanup()` clears the one-second kill timer (`611-622`, `637-638`) before the turn returns. `afterEach` (`341-350`) still expects `exit`/`close`/stdout/stdin listeners removed. No intentionally pending timer from this case. Jest was not run.
- `codex-context.spec.ts:22` uses `toHaveProperty(['mcp_servers.ptah'])` so the literal dotted key is rejected while `toEqual(config)` still checks the nested `mcp_servers.ptah` object. That matches the lane config shape.
- Repo rules on the revise-2 hunks: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, readonly mock assignment, or private bracket access. `ptah-review-logic` was read. Ptah MCP tools were not in the connected tool list (`tasks` only); this file is the review record. Tests, lint, typecheck, and diagnostics were not run (lane rule).
