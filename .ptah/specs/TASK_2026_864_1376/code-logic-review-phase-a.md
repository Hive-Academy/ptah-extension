# Code Logic Review, Phase A (backend + Electron), TASK_2026_864_1376

Score: 7/10. Verdict: REVISE (0 Blocking, 2 Serious, 5 Moderate, 3 Minor).

Scope: I read the full code for B5 to B9 (CodexLoginService, auth:getCodexReadiness, auth:codexLogin and cancel, Electron composition, replay sanitizer, quit sequence). I read the other batches only through the interfaces they expose. I did not run any tests, per instruction. I did not re-read the manifest specs or the reader's logging, so those items stay unconfirmed.

## What holds up

- Cancel during start: `launch` re-checks `attempt.settled` after each await (service.ts:83, 86, 97). Same-tick cancel before spawn never spawns. Cancel after spawn awaits `whenSpawned` and then kills the tree (service.ts:199-209).
- A late `close` cannot publish success: `settle` runs `cleanup` (listeners removed) and `complete` returns if `settled` (service.ts:176). A success needs `signed-in` from `getSignInOutcome` after `clearCache`. A bare exit 0 is not enough.
- The post-settle `error` event is safe: the off-thread spawner keeps a no-op `error` listener (off-thread-process-spawner.ts:265, 654, 715).
- Logs contain error names and fixed copy only. No URL, code, path or CLI output is logged.
- URL handling is sound: https only, no userinfo, 4096 length cap, ANSI stripped, opened once via `browserAttempted`.
- auth:codexLogin order is service, then unchanged runner path, then a fixed failure with no `openTerminal`. Failed and cancelled map to `success:false` per R1-4. Succeeded runs clearCache, reset (with `.catch`) and invalidate on the state push. The status broadcast is best effort (interactive-login-methods.ts:264-278).
- Readiness method: an absent reader gives a fixed result, an unknown trigger is dropped, and a bad `refresh` throws `INVALID_PARAMS`. The ambient trigger test is in B6.
- Electron DI: the selection is lazy and a missing token becomes `CodexExecutableUnavailableError`. The quit handle never resolves the service during quit (codex-login-composition.ts:20-24).
- Replay sanitizer drops `auth:codexLogin`, `auth:codexLoginCancel` and `auth:codexLoginStatus` before the allow-list test (scenario-sanitizer.ts hunks of 314dfe114). A custom allow list cannot re-admit them.
- Quit: an active sign-in defers quit. `stop()` starts beside `killRunningChecks`, is awaited under a 2000 ms budget (shutdown.ts:543-563), and a rejected or hung stop still lets quit continue (spec in bbe593ffa).

## Findings

1. **Serious. A hung kill is never bounded, so the child can outlive the app and block restart.** `stop` awaits `child.whenSpawned`, then `killTree(pid)` (codex-login.service.ts:203-204). The SIGKILL fallback at :207 runs only on a throw. If `whenSpawned` or `killProcessTree` never settles, the codex login process stays alive. The quit budget lets Ptah exit anyway, so an orphaned `codex login` can keep its local callback port. `restart` also awaits `stopPromise` unbounded (service.ts:82), so the RPC hangs. Fix: race `killTree` against a short internal timer (about 1500 ms), then call `child.kill('SIGKILL')` and resolve. This answers the R1-5 question: today a hung stop leaves the child running.

2. **Serious. A new start after cancel or timeout does not wait for the old process to die.** `start` only waits when `active` is unsettled (service.ts:79). `stop` settles first and kills afterwards (:196-209). Cancel then start with `restart:false`, which is the normal retry path after a timeout, spawns a second `codex login` while the first is still dying. That can hit a callback-port conflict and fail the second attempt as `exited`. Fix: at the top of `start`, `await this.active?.stopPromise` whenever it exists, whether or not the attempt is settled.

3. **Moderate. If no URL is ever parsed, the user waits for 10 minutes with no signal.** The state stays `running` and nothing tells the user that no link was found (service.ts:148-161). The service also sets `BROWSER=/usr/bin/true` on Linux (:156-160), so codex will not open a browser itself. A change in codex's output format would look like a hang. Fix: after about 20 s in `running` with no URL, surface a hint or fall back to device mode.

4. **Moderate. The user code can be wrong.** `CODE` (service.ts:13) matches any `XXXX-XXXX` token on any stdout or stderr line, and the first match is kept in `userCode` (:153-155). In browser mode, stray tokens such as request ids could be shown as a code. Fix: accept codes only in device mode, or only on a line near the URL.

5. **Moderate. The tail of the output is lost.** `LineSplitter` does not flush a trailing partial line at close. `LineSplitter.push` also clears the whole buffer when a partial line passes 8192 characters. An unterminated final line carrying the code or URL would be dropped (cli-login-output.ts LineSplitter). Fix: add a `flush()` and call it on close.

6. **Moderate. Concurrent start requests are not distinguished.** A second `start` while one is active, or while `starting` is in flight, returns the existing state (service.ts:80, 86). Its `onState` is ignored and a different `mode` is silently ignored. This is harmless for the broadcast design but surprising. At minimum, document it or return the active mode in the response so the UI can tell.

7. **Moderate. The RPC boundary coerces input without validation.** In `auth:codexLogin` an unknown `mode` becomes `browser` and a non-boolean `restart` becomes `false` (interactive-login-methods.ts:200-205). The sibling `getCodexReadiness` throws `INVALID_PARAMS` for bad input, so the two are inconsistent. Fix: parse both with a schema.

8. **Minor.** `getCodexReadiness` with no reader returns `signIn: unreadable` with `binary.reason: 'local'` (codex-readiness-method.ts:35-39). The UI cannot tell this from a real read failure. Consider a distinct reason.

9. **Minor.** `codexErrorCopy` duplicates `ERROR_COPY` from the service (interactive-login-methods.ts:280-289). The two strings can drift. Export the service's map instead.

10. **Minor.** `dispose` marks the service disposed permanently. That is correct for quit, but the quit handle's `stop` is also called on the synchronous inactive path, where nothing awaits it. No defect today, but it is fragile if quit is ever cancelled.

## Five logic questions (short)

1. Silent failure: a kill hang is silent (finding 1). The sign-in state shows `cancelled` while the process lives.
2. Unexpected user action: cancel then immediately retry (finding 2). Also, launching sign-in and ignoring the browser gives no progress feedback (finding 3).
3. Wrong answer: the user code can be a false positive (finding 4).
4. Dependency failure: selection failure maps to `unavailable`, a spawn error to `spawn-failed`, an auth read throw to `no-credentials`. All are handled. A kill dependency that hangs is not (finding 1).
5. Missing: a bounded kill, a no-URL fallback, and an output flush at close.

## Requirements and constraints

- R1-8 (no real codex login in tests): not violated in the batches I read. Batches 5 and 7 use fakes and an injected spawner and `killTree`.
- The Kimi extraction move (B2) and the platform-cli and cli-engine runner path are untouched in B5 to B9, apart from the shared helper imports.
- DI registration is Electron only and lazy.
