# TASK_2026_368 — review gate

**Task**: Electron main process never exits after a deferred will-quit on Windows
**Status under review**: `in_review`
**Fix commit**: `6351b2694` — `fix(electron,e2e): re-issue the deferred quit from a macrotask so Windows exits`
**Reviewers**: Codex CLI (independent, read-only) + adjudication by the gate agent
**Date**: 2026-09-08

---

## 1. Acceptance criteria

Criteria extracted from `.ptah/specs/TASK_2026_368/task.md` and `context.md`
(the "Fix" and "Verification" sections).

| #   | Criterion (as promised by the task)                                                                                                        | Verdict         | Evidence                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | The `quit` dep handed to `handleWillQuit` schedules `app.quit()` on a macrotask instead of calling it directly                              | **SATISFIED**   | `apps/ptah-electron/src/main.ts:259` — `quit: () => setTimeout(() => app.quit(), 0)`, with the rationale comment at `main.ts:250-258` |
| AC2 | Every post-`preventDefault()` quit re-issue goes through a macrotask; first quits stay synchronous                                          | **NOT MET**     | `apps/ptah-electron/src/main.ts:110-114` still defers in `before-quit` and re-issues from a promise `.finally`                        |
| AC3 | `shutdown.ts` stays pure — no `app` import, no scheduling, unit specs untouched                                                             | **SATISFIED**   | `git show --stat 6351b2694` touches `main.ts` only; `shutdown.ts:413-427` still calls the injected `deps.quit()` from `finally`       |
| AC4 | The false "the `finally` re-issue guarantees the app is never unquittable" claim is corrected (listed in the task as a *follow-up*)         | **NOT DONE**    | `apps/ptah-electron/src/activation/shutdown.ts:404-408` — comment unchanged, still attributes the guarantee to `finally` alone        |
| AC5 | Verification: typecheck + `ptah-electron` unit specs + a rebuilt e2e run, recorded in `tmp/logs/e2e-fix-verify.log`                         | **SATISFIED**   | `tmp/logs/e2e-fix-verify.log` — typecheck OK, `410 passed` unit tests, `4 passed (39.2s)` e2e, `exit=0`                               |
| AC6 | A regression net exists that fails if the macrotask is reverted                                                                             | **PARTIAL**     | `apps/ptah-electron-e2e/src/specs/lifecycle.spec.ts:34,82,110,128` (25 s close budget) catches it — **on Windows only**; CI is Linux |
| AC7 | Windows desktop-app symptom (zombie `Ptah.exe` after close) is fixed for the packaged build                                                 | **UNPROVEN**    | See blocker B1: the packaged build takes an earlier deferral that e2e never exercises                                                |

---

## 2. Codex raw verdict

```
AC1 — SATISFIED.   main.ts:249-259 passes deferQuit + quit: () => setTimeout(() => app.quit(), 0).
AC2 — NOT SATISFIED. main.ts:110-114 calls event.preventDefault(), awaits the Sentry flush, then
                     .finally(() => app.quit()) — a promise continuation, not a macrotask. The tray
                     dep (main.ts:177) and window-all-closed dep (main.ts:212) are first quits and
                     are correctly synchronous.
AC3 — SATISFIED.   shutdown.ts imports only the BootRefs type; commit 6351b2694 did not modify it.
AC4 — PARTIAL.     shutdown.ts:405-407 comment unchanged; does not document the macrotask contract.
AC5 — NOT SATISFIED. No automated regression test asserts the macrotask injection.
                     main.metadata-flush.spec.ts:349-367 reads main.ts as text but checks only
                     delegation; main.quit-path.spec.ts injects a synchronous jest.fn().
AC6 — SATISFIED.   6351b2694 changes only the injection; no shutdown spec was weakened or deleted.

Blockers:
- main.ts:110-114 unfixed promise-continuation quit after before-quit preventDefault().
- No targeted regression test that fails if the timer is reverted.
- Sentry flush rejection silently swallowed by .catch(() => undefined) at main.ts:111-114.
- The MCP HTTP server remains outside BootRefs and the shutdown chain (starts via
  wire-runtime.ts bringUpSubsystems; CodeExecutionMCP.disposeAsync() at
  http-mcp-server.service.ts:606-609 is never invoked on quit).
- shutdown.ts:182-184 launches providerProxyPool.disposeAll() inside a synchronous nonFatal
  wrapper; a later rejection is unhandled and cleanup is not awaited. Same shape for the early
  metadata flush at shutdown.ts:465-467.
- The timer re-issue is neither starved nor double-fired: main.ts:221-222 sets the one-shot guard
  before starting the chain. No dead-guard defect found.

VERDICT: NEEDS_WORK
```

---

## 3. Adjudication

Every Codex claim was re-opened at the line it names.

**Confirmed and carried forward**

- `main.ts:110-114` — confirmed verbatim. `event.preventDefault()` at 110, then
  `.finally(() => app.quit())` at 114. This is the identical
  microtask-continuation-after-`preventDefault()` shape the task exists to fix.
  Codex under-stated it: I additionally established that this path is
  **production-only and untested** (see B1).
- `shutdown.ts:404-408` — confirmed, comment unchanged.
- `main.ts:177` / `main.ts:212` — confirmed first quits (tray menu item and
  `window-all-closed`); leaving them synchronous is correct, exactly as
  `context.md:91` says.
- `main.ts:221-222` guard — confirmed correct; the re-emitted `will-quit`
  returns at 221 and Electron proceeds to exit. No starvation or double-fire.
- `shutdown.ts:182-184` `void refs.providerProxyPool?.disposeAll()` inside a
  synchronous `nonFatal` — confirmed (`nonFatal` is a plain `try/catch` at
  `shutdown.ts:150-159`, so a rejection escapes). Pre-existing, out of this
  task's scope; recorded as a note, not a blocker.
- MCP HTTP server absent from the quit chain — confirmed: `grep -n "mcp\|MCP"`
  over `shutdown.ts` and `boot-coordinator.ts` returns nothing. Already named as
  a follow-up in `context.md:104-105`; note, not a blocker.

**Corrected**

- Codex's AC5 ("no regression net at all") is **too strong**.
  `apps/ptah-electron-e2e/src/specs/lifecycle.spec.ts` asserts a clean close
  inside `CLEAN_CLOSE_BUDGET_MS = 25_000` (`lifecycle.spec.ts:34`, asserted at
  `:82-86`, `:109-113`, `:127-131`). Reverting the macrotask makes that spec
  fail on Windows. The real defect is narrower and is carried as **B2**: that
  net never runs on the platform where the bug exists —
  `.github/workflows/electron-e2e.yml` is `runs-on: ubuntu-latest`, and
  `context.md:70-71` itself states a Linux run may pass regardless.
- Codex's AC6 "SATISFIED" for git history is confirmed
  (`git show --stat 6351b2694`: `main.ts` + two spec-folder docs + one unrelated
  chat e2e spec), but its AC5/AC6 numbering does not match the task's own
  verification section; the table in §1 is the authoritative mapping.

**Added (missed by Codex)**

- The proof that B1 is production-only and structurally invisible to the test
  suite: `apps/ptah-electron/esbuild.config.cjs:68` defines
  `__SENTRY_DSN__: isProd ? "<dsn>" : ""`, and
  `apps/ptah-electron/src/activation/bootstrap.ts:232-241` only calls
  `sentryService.initialize(...)` when that string is non-empty. The e2e harness
  runs a dev build, so `isInitialized()` is `false` and the `before-quit`
  deferral is never taken — including in `lifecycle.spec.ts`'s
  "production-mode launch" test, which sets `NODE_ENV=production` at *runtime*
  while `__SENTRY_DSN__` was already baked at *build* time.
- The cheap fix for B2 already exists in the repo: `main.metadata-flush.spec.ts`
  already slices the `will-quit` body out of `main.ts` as text
  (`main.metadata-flush.spec.ts:349-357`) and asserts textual contracts against
  it (`:358-367`). A two-line `expect(willQuitBody).toContain('setTimeout')`
  there pins the fix on every platform.
- Verification breadth: `tmp/logs/e2e-fix-verify.log` records `4 passed` — the
  two chat specs. The suite has 32 spec files. `context.md:106-108` says the
  full suite must be re-run because its true state is unknown since Aug 28; no
  log of such a run exists in `tmp/logs/`.

---

## 4. Blockers

### B1 — The production `before-quit` deferral still re-issues `app.quit()` from a microtask (major)

`apps/ptah-electron/src/main.ts:110-114`

```ts
if (sentryService.isInitialized()) {
  event.preventDefault();
  void sentryService
    .flush(2000)
    .catch(() => undefined)
    .finally(() => app.quit());
}
```

This is the same pattern the task exists to fix, on the event that fires
**before** `will-quit`. The comment the fix itself added says so in as many
words (`main.ts:251-253`): "once `will-quit` has called `preventDefault()`, an
`app.quit()` issued from the same task **or a microtask continuation** is
silently ignored — no second `before-quit`, no `will-quit`, no exit".

Why it matters and why nothing caught it:

- `apps/ptah-electron/esbuild.config.cjs:68` — `__SENTRY_DSN__` is a real DSN
  only when `NODE_ENV=production` at build time.
- `apps/ptah-electron/src/activation/bootstrap.ts:232-241` — Sentry initializes
  only when that DSN is non-empty.
- Therefore **only packaged release builds** take this branch. Dev and e2e
  builds have an empty DSN, `isInitialized()` is `false`, `preventDefault()` is
  never called in `before-quit`, and the trace in `context.md:33-41` shows
  exactly that: `before-quit` passes straight through to `will-quit`.

Consequence: on a released Windows build the quit defers at `before-quit`
first. If Electron ignores that microtask re-issue — which is the task's own
stated model of the bug — the process never reaches the fixed `will-quit` path
at all, and the user-facing symptom described in `context.md:128-134`
(a resident windowless `Ptah.exe` that blocks the next launch through
`requestSingleInstanceLock`) is **not** fixed by this task. The task cannot
honestly be closed as "Windows now exits" while the only quit path a shipped
user takes is untouched and untested.

Fix shape is one line, mirroring `main.ts:259`:
`.finally(() => setTimeout(() => app.quit(), 0))`.

### B2 — The regression net for this fix cannot run on the affected platform (medium)

- The net exists: `apps/ptah-electron-e2e/src/specs/lifecycle.spec.ts:34`
  (`CLEAN_CLOSE_BUDGET_MS = 25_000`), asserted at `:82-86`, `:109-113`,
  `:127-131`.
- It never runs on Windows: `.github/workflows/electron-e2e.yml` →
  `runs-on: ubuntu-latest`. `context.md:70-71` concedes "a Linux run may pass.
  That is not evidence the desktop app quits on Windows."
- No unit-level pin exists either: `main.quit-path.spec.ts` injects a
  synchronous `jest.fn()` quit (by design, per `context.md:89-91`), and no spec
  anywhere mentions `setTimeout`, `macrotask` or `33643`.

Net effect: `quit: () => setTimeout(() => app.quit(), 0)` can be reverted or
lost in a refactor and every gate in CI stays green. A platform-independent pin
is available for two lines in the harness that already exists at
`apps/ptah-electron/src/main.metadata-flush.spec.ts:349-367`.

---

## 5. Notes (not blockers)

- **Stale comment**, `apps/ptah-electron/src/activation/shutdown.ts:404-408`:
  "`deps.quit()` is in a `finally` so no failure inside the chain can leave the
  app unquittable." That guarantee now depends entirely on the *injected* dep
  being macrotask-deferred. `context.md:101-103` already lists correcting this
  as a follow-up; it was not done.
- **MCP HTTP server is closed nowhere in the quit chain.** No `mcp` reference in
  `shutdown.ts` or `boot-coordinator.ts`; `CodeExecutionMCP.disposeAsync()`
  exists but no Electron quit path calls it. Named as a follow-up at
  `context.md:104-105`; still open.
- **`void refs.providerProxyPool?.disposeAll()`** inside a synchronous
  `nonFatal` (`shutdown.ts:182-184`, `nonFatal` at `:150-159`) — a rejection
  becomes an unhandled rejection and the cleanup is not awaited. Same shape for
  the early metadata flush (`shutdown.ts:465-467`). Both pre-date this task.
- **Verification breadth**: only 4 e2e tests were re-run
  (`tmp/logs/e2e-fix-verify.log`) against 32 spec files. `context.md:106-108`
  asks for a full-suite re-run; no such log exists.

---

## 6. Final verdict

**NEEDS_WORK.**

The one-line fix the task promised is present, correct, and proven at
`main.ts:259` — the `will-quit` deferral now exits. But the task's own headline
claim, that a Windows user no longer gets a zombie `Ptah.exe`, is not delivered:
the packaged build defers one event earlier, at `before-quit`
(`main.ts:110-114`), and re-issues its quit from a promise continuation — the
exact construct this task diagnosed as broken. That path is reachable only in
release builds, which is why the e2e proof, run against a dev build, says
nothing about it. Close B1, and add the two-line textual pin for B2 so the fix
survives CI on Linux, and this is ready.
