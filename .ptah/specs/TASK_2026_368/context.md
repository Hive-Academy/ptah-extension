# Context

## Symptom

Every spec in `apps/ptah-electron-e2e` fails the same way:

```
Tearing down "electronApp" exceeded the test timeout of 60000ms.
Worker teardown timeout of 60000ms exceeded.
```

The test body passes. The screenshot at failure shows the final step of the
body already reached. Only `app.close()` hangs.

## What was ruled out, with evidence

| Suspect                         | Evidence against                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new spec                    | The pre-existing, committed `streaming-message-handlers.spec.ts` hangs identically                                                                   |
| Hidden second `BrowserWindow`   | `ElectronBrowserCapabilities` creates its window only inside `ensureSession()`, which only the browser-tool methods call                             |
| Tray keep-alive                 | No `trayKeepalive` key in `~/.ptah/settings.json`, no tray line in the trace                                                                         |
| `worker_threads` spawner Worker | `PTAH_SDK_INLINE_SPAWN=1` bypasses the Worker entirely; the run still hung 1.2 min                                                                   |
| Inspector holding the process   | Trace shows `Debugger ending`, not `Waiting for the debugger to disconnect`                                                                          |
| Child or utility process        | Process snapshots at 40 s, 70 s and 100 s: main `electron.exe` alive, responding, **no window title**, children are only the GPU and network helpers |
| Disposal chain overrunning      | Every await in `shutdown.ts` is bounded at 2 s; worst case ~8 s, not 60                                                                              |

## What was proven

The built `main.mjs` was instrumented with `[QUIT-TRACE]` lines at every stage
of the quit sequence and the short spec re-run. The Electron process printed:

```
[QUIT-TRACE] before-quit event
[Ptah Electron] Saving window bounds: {...}
[QUIT-TRACE] will-quit event; quitSequenceStarted=false
[QUIT-TRACE] handleWillQuit entered
[QUIT-TRACE] deferring quit (preventDefault)
[QUIT-TRACE] runDeferredDisposal start
[QUIT-TRACE] disposeAfterPersistence done
[QUIT-TRACE] chain settled; re-issuing app.quit()
```

Then nothing. No second `will-quit`, no `quit` event, no process exit, for the
full 60 s.

That is Electron issue #33643 exactly: on Windows, after `event.preventDefault()`
in `will-quit`, a subsequent `app.quit()` does not restart termination. The
issue's workaround is to wrap the second call in `setTimeout`.

The same bundle was then patched so the re-issued quit runs from a macrotask:

```
[QUIT-FIX] will-quit event; quitSequenceStarted=false
[QUIT-FIX] macrotask app.quit()
[QUIT-FIX] will-quit event; quitSequenceStarted=true
[QUIT-FIX] process exit code=0
[QUIT-FIX] app quit event fired
  1 passed (10.5s)
```

From a 1.2-minute hang to a 10.5-second pass.

## Why it was never caught

- `deferQuit` first appeared in `61c54bb36` on 2026-08-28 (TASK_2026_331 B1).
- The last green run of `.github/workflows/electron-e2e.yml` is `45b2ccf70` on
  2026-08-25. Every run since was cancelled or skipped.
- `8f64cf668` (Aug 26), `cbddddd05` (Sep 1) and `5c15c1d1b` (Sep 2) each
  reworked the deferred chain further. None was e2e-verified.
- The issue is reported against Windows. CI runs on Linux under xvfb, so a
  Linux run may pass. That is not evidence the desktop app quits on Windows.

## The desktop app is affected, not only the tests

`requiresDeferredDisposal` is true whenever `agentProcessManager` is non-null,
which the pre-window phase makes true on essentially every run. So every quit
of the packaged app on Windows takes this path. The expected user-facing
symptom is a windowless `electron.exe` left behind after closing Ptah, and a
following launch that exits immediately on `requestSingleInstanceLock`.

## Fix

`apps/ptah-electron/src/main.ts`, the `quit` dep passed to `handleWillQuit`:

```ts
quit: () => setTimeout(() => app.quit(), 0),
```

The fix sits at the injection site on purpose. `shutdown.ts` stays pure and
its unit specs, which inject a synchronous `quit` and assert on call counts,
are untouched. The `window-all-closed` quit is a first quit and is left alone.

## Verification

- Bundle-level proof: the `[QUIT-FIX]` run above.
- Source-level: typecheck, `ptah-electron` unit specs, then a `build-dev`
  rebuild and both chat e2e specs. Recorded in
  `tmp/logs/e2e-fix-verify.log`.

## Follow-ups this uncovers

- `shutdown.ts:405-407` states the `finally` re-issue guarantees the app is
  never unquittable. That claim is false on Windows without the macrotask.
- The MCP HTTP server is closed nowhere in the quit chain. It did not cause
  this hang, but it is a live listener at quit.
- The full e2e suite should be re-run. Every spec has been failing on
  teardown for the same reason, so the true pass/fail state of the suite is
  unknown since Aug 28.
