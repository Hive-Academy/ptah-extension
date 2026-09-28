# Task Context - TASK_2026_550_9a28

## User Request

Filed from TASK_2026_540_0940 QA (2026-09-24). The user asked to file the Electron e2e follow-ups as a task and include
it in the 540 PR. Source evidence: `.ptah/specs/TASK_2026_540_0940/test-report.md`.

## Task Type

DEVOPS (test infrastructure), with a BUGFIX part if the start-up hang is in product code.

## Problem 1 - one Electron boot per test

`apps/ptah-electron-e2e/src/support/fixtures.ts:57` declares `electronApp` with no `scope`, so Playwright uses test
scope. Every test calls `launchPtah()` (`src/support/electron-launcher.ts`), which creates a fresh `mkdtemp`
user-data dir and database dir, boots the whole main process and waits for `renderer/index.html`. With `workers: 1`
(`playwright.config.ts:22`) the suite is serial, so boot time is paid once per test. A local run of 13 config-menu
tests took about 6 minutes. CI (`.github/workflows/electron-e2e.yml:116`) runs the full suite the same way.

Direction: a worker-scoped `electronApp` with a per-test reset (renderer reload, RPC mock reset, state reset through
the existing `ui.prepare()` path). Keep a test-scoped opt-out for specs that need a clean profile or a main-process
restart (startup-config, persistence, state IPC, smoke launch checks).

Risks: tests that leak state (persisted workspace folders, settings files, SQLite rows, IPC listeners) will start to
depend on order. Every spec needs an isolation review, and the opt-out list must be explicit.

## Problem 2 - intermittent start-up hang (local, Windows)

In the 540 QA run, 35 of 44 failures were launches that never reached `renderer/index.html` (`waitForURL`,
`electronApp` fixture or `beforeEach` timeout). The window stays on `assets/preparing-workspace.html`
("Preparing workspace history"). The main-process log stops after `[IpcBridge] IPC listeners initialized` and never
reaches `Subsystems brought up`, so the hang is inside `wireRuntimePreWindow` / `registerPostWindow`
(`apps/ptah-electron/src/main.ts:235-253`). The same spec passes on another launch. 540 changes no main-process code.

Direction: add step timing logs across `wireRuntimePreWindow` / `registerPostWindow`, reproduce with a loop of
launches, find the awaited step that does not settle. If it is a product bug (a user could hit it at start-up), fix it
as a BUGFIX; if it is an e2e-environment effect, fix the launcher.

## Acceptance

- The full `ptah-electron-e2e:e2e` suite passes locally and on CI with no start-up timeouts over repeated runs.
- Suite time drops clearly from the per-test boot baseline (measure before and after).
- Specs that need a clean profile are listed and keep a fresh launch.

## Related

- TASK_2026_540_0940 (found during its QA).

## CI flakes seen on PR 586 (2026-09-24)

- Run 35964056447: `config-menu-keyboard.spec.ts:79` — ArrowDown before the first item had focus (fixed in b7ac3b35a).
- Run 35970324119: `git/git-dock.spec.ts:319` — debounced diff refresh (`diff-tabs.service.ts` `DIFF_REFRESH_DEBOUNCE_MS`) re-requested an open tab's diff after the static mock was swapped (fixed in 8382e1458 with a path-keyed mock).
- Run 35972122158: `auto-updater.spec.ts:224` — the spec's `rpcBridge.setState(marker)` is fire-and-forget into an async workspace-storage commit while `rpcBridge.getState()` answers synchronously from the in-memory cache, so the fixed 150 ms sleep read the pre-write cache (`"{}"`) under CI boot load; the sleep is now a poll (fixed in this change).
- Other branches the same day failed on `chat/compaction-duplicate-session.spec.ts:52` (run 35964417827, not investigated).

Each run failed a different test that passed on the other runs, so the suite needs a flake audit (fixed sleeps, static mocks swapped mid-test, renderer writes racing test writes) as part of this task.

## Moved in from TASK_2026_389 (2026-09-24)

- Audit the 3 mocked git specs (`git-dock`, `diff-view-state`, `perf-m1-diff-redisplay`) and the
  `harness/*` and `tasks/*` families for whether their mocked-vs-real fixture choice matches what they
  claim to test. Do it as part of the per-spec isolation review this task already requires.
