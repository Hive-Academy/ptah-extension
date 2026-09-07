# TASK_2026_389 — Electron e2e harness: slow, noisy, tests less than it appears to

## Why

Filed after a `nx run ptah-electron-e2e:e2e` run (observed 5.5 min for the 7
`specs/git/*` files) surfaced several harness issues. Each claim in the
originating report was verified against source before being written here;
several needed correction. Do not treat the original report as accurate on
its own — this file is the corrected record.

## Verified claims

### 1. The app boots once per TEST, not once per run — TRUE

`apps/ptah-electron-e2e/src/support/fixtures.ts:39-46` declares `electronApp`
with Playwright's default (test) scope:

```ts
electronApp: async ({}, use) => {
  const app = await launchPtah();
  try { await use(app); } finally { await app.close().catch(() => {}); }
},
```

Every test that consumes `electronApp` (directly or via `mainWindow` /
`rpcBridge` / `ui`, all of which depend on it) gets a fresh boot and a fresh
close. `apps/ptah-electron-e2e/playwright.config.ts:22-23` pins `workers: 1,
fullyParallel: false`, so these boots are strictly serial. Confirmed.

### 2. "PTAH_E2E is set but nothing reads it" — FALSE, corrected

`apps/ptah-electron-e2e/src/support/electron-launcher.ts:79` does set
`PTAH_E2E: '1'` on every launch. But it is **not** true that nothing reads it
— a repo-wide grep for `PTAH_E2E` (excluding specs/docs/task folders) finds
it read in four production files:

- `apps/ptah-electron/src/services/update/update-manager.ts:133-141` — skips
  the GitHub Releases update check entirely when `PTAH_E2E === '1'` (opt back
  in via `PTAH_E2E_ALLOW_UPDATE_CHECK=1`, used by `auto-updater.spec.ts`).
  Documented in `apps/ptah-electron/CLAUDE.md`'s Deployment Notes.
- `apps/ptah-extension-vscode/src/activation/bootstrap.ts:74-77` — seeds
  `previousUserContext` so `verifyLicense()` takes the zero-network community
  path under test (this is the VS Code host's own e2e harness, a different
  app, but the same env var name and the same intent).
- `libs/backend/rpc-handlers/src/lib/verify-and-report.ts:105-108` — enables
  `assertRpcRegistration` (registration-drift throws before the webview
  mounts) whenever `NODE_ENV === 'development'` OR `PTAH_E2E === '1'`.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:600-632`
  — gates the test-only `agent:e2eSeedPermission` RPC method behind
  `PTAH_E2E === '1'` as belt-and-braces on top of IPC being otherwise
  unreachable from outside the app.

So the flag is a real, if narrow, test-mode signal — it is just not wired to
the three expensive subsystems that actually cost time on every boot:

- **Embedder warmup** (`apps/ptah-electron/src/activation/boot-coordinator.ts`)
  — no `PTAH_E2E` check anywhere in this file (grepped; only
  `update-manager.ts` and its spec reference the flag under
  `apps/ptah-electron/src`).
- **Messaging gateway start**
  (`apps/ptah-electron/src/activation/start-messaging-gateway.ts`) — no
  `PTAH_E2E` check.
- **Membership/license priming**
  (`apps/ptah-electron/src/activation/bootstrap.ts:46-70`,
  `licenseService.verifyLicense()`) — no `PTAH_E2E` check; this is a
  different `bootstrap.ts` than the VS Code one cited above (electron app,
  not the VS Code extension host).

Net correction: "the application has no test mode" is too strong. The
correct framing is "PTAH_E2E is a real, narrow test-mode signal that three
specific expensive subsystems do not honour yet."

### 3. Boots pay a 30s dead wait — TRUE, and the source location is found

`BootCoordinator` lives at
`apps/ptah-electron/src/activation/boot-coordinator.ts`. It was not missing
from `.ts` sources — a scoped repo-wide grep timed out earlier and had to be
re-run path-scoped; it is a normal, well-documented class (also described in
`apps/ptah-electron/CLAUDE.md`).

- `WARMUP_BARRIER_TIMEOUT_MS = 30_000` — `boot-coordinator.ts:164`.
- The exact warning string is assembled, not literal, at
  `boot-coordinator.ts:386-389`:
  ```ts
  console.warn(`[BootCoordinator] Embedder warmup barrier timed out after ${WARMUP_BARRIER_TIMEOUT_MS} ms ` + '(the memory curator never became available); skipping warmup.');
  ```
- The barrier is armed in `armWarmup()` (`boot-coordinator.ts:376-395`) and
  waits for BOTH `did-finish-load` (renderer loaded) AND
  `refs.memoryCurator !== null` (`boot-coordinator.ts:152-164`, confirmed by
  `apps/ptah-electron/CLAUDE.md`'s own description of the barrier).
- The comment at `boot-coordinator.ts:158-162` explains _why_ 30s: it is
  "comfortably past the worst measured case" for a cold-start migration +
  content download that creates the curator. A test boot with no workspace
  never creates a memory curator at all (there is nothing to migrate against
  such a workspace), so the barrier reliably times out at the full 30s on
  every no-workspace spec — this is the single biggest per-test cost in the
  suite, run 100% for zero test value on any spec that isn't exercising
  memory/curator behaviour.

Whether the "messaging gateway starting without persistence (degraded)" log
line is expected: yes, that's `start-messaging-gateway.ts` waiting on
`coordinator.whenPersistenceSettled()` and getting `sqliteOpen: false` when
there is no workspace (see `boot-coordinator.ts:274-285`, the backstop that
settles persistence as `false` for "a launch with no workspace root"). This
is by design for a no-workspace boot, not a bug — but it does mean the
gateway still spins up its non-persistent listeners on every boot regardless
of whether the spec touches gateway behaviour.

### 4. Many specs run with NO workspace open — TRUE, more precisely bounded than the original claim

`launchPtah()` (`electron-launcher.ts:63-122`) passes no `opts.args` unless
the caller supplies them, and each test's `electronApp` fixture calls
`launchPtah()` with no arguments unless it uses a different fixture file.
`apps/ptah-electron/src/activation/workspace-restore.ts:95-102` confirms the
two log lines quoted in the report and their meaning: with no persisted
state and no CLI arg, the app "starts without workspace."

I checked every spec's fixture import (43 files under
`apps/ptah-electron-e2e/src/specs/**`):

**5 specs already launch against a real, on-disk git workspace** (not zero,
contradicting the framing that no git spec has a real repo):

- `git/hunk-apply-real-rpc.spec.ts`
- `git/glyph-margin-visual.spec.ts`
- `git/hunk-revert-top-layer.spec.ts`
- `git/hunk-widget-mouse.spec.ts`

  — all four import `../../support/real-rpc-fixtures`, whose `electronApp`
  fixture (`real-rpc-fixtures.ts:259-274`) calls
  `launchPtah({ args: [repo.root], ... })` with `repo` built by
  `git-scratch-repo.ts`'s `createThreeHunkRepo()` — a throwaway repo with one
  committed baseline and three known unstaged hunks, isolated `HOME`/`USERPROFILE`
  so it never touches the developer's real `~/.ptah` state.

- `permission/config-change-permission-survival.spec.ts` imports
  `../../support/permission-seam-fixtures`, whose `electronApp` fixture
  (`permission-seam-fixtures.ts:161-162`) also passes `args: [repo.root]`.

**The remaining ~38 spec files** (`smoke`, `state`, `rpc`, `rpc-new-features`,
`setup-wizard(+wizard-dom)`, `startup-config`, `auto-updater`, `clipboard`,
`electron-browser-capabilities`, `lifecycle`, `license-watcher`,
`git-watcher` — entirely `test.skip(true, ...)`, see below —
`perf/startup-tti`, `settings/settings`, `harness/*` (3 files),
`canvas/canvas`, `tasks/*` (3 files), `dashboard/dashboard`,
`chat/*` (2 files), `thoth/*` (6 files), `theme/theme`, `marketplace/*` (2
files), `tribunal/tribunal`, and 3 of the 7 git specs —
`git/git-dock.spec.ts`, `git/diff-view-state.spec.ts`,
`git/perf-m1-diff-redisplay.spec.ts`) import `../support/fixtures` (or the
relative equivalent), whose `electronApp` calls plain `launchPtah()` — no
workspace. `tray-icon-packaging.spec.ts` and `tray-keepalive.spec.ts` don't
use the shared fixtures at all; they call `electron-launcher.ts` directly and
also pass no workspace arg — tray behaviour genuinely doesn't need one.

**Important nuance the original report missed**: the 3 no-workspace git specs
are not weaker versions of the same test the real-RPC specs run — they
intentionally test a different layer. `git-dock.spec.ts` and
`diff-view-state.spec.ts` install `ui.mockRpc(...)` and drive the dock/editor
UI with synthetic `ui.pushEvent({ type: 'git:status-update', ... })` calls;
they are testing the Angular component's reaction to an RPC push, not git
itself, and a real repository would add cost without adding coverage for
what they assert. `perf-m1-diff-redisplay.spec.ts` should be checked case by
case if its name implies it wants to measure something a mock can't
represent, but it's plausibly also UI-only. The real gap, if there is one, is
narrower than "git specs prove less than they appear to" — it's "confirm each
mocked git spec's docstring states plainly that it is UI-only," not "give
every git spec a real repo."

Also worth noting: `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` is
entirely gated behind `test.skip(true, '...')` at line 61-64 — every test in
that file is currently skipped (ESM main-bundle limitation, documented in the
file), so it contributes ~0 to both the "7 git specs, 5.5 min" measurement
and to the no-workspace count in any way that matters today.

### 5. A local failure is hard to diagnose — TRUE

`playwright.config.ts:25-26,44`: `retries: 0`, `timeout: 60_000`,
`trace: isCI ? 'retain-on-failure' : 'off'`. Against a boot that alone can
burn ~30s (the warmup barrier) plus git-subprocess cold-spawn cost
documented in `real-rpc-fixtures.ts:88-93` (4.4-11.3s on Windows for the
first `git` spawn), 60s leaves little room, and a local run gets a
screenshot only (`screenshot: 'only-on-failure'`), no trace. Confirmed as
described.

### 6. Concurrent runs starve each other — TRUE

`playwright.config.ts:22-23` — `workers: 1, fullyParallel: false` — matches
`apps/ptah-electron-e2e/CLAUDE.md`'s stated guideline: "Tests must remain
serial — the Electron app owns global state (DI container, file handles,
sockets)." No harness-level lock currently prevents two invocations of `nx
run ptah-electron-e2e:e2e` from running at once and corrupting each other's
temp `PTAH_DB_PATH` / `userDataDir` isolation guarantees (those are per
_launch_, not per suite run) — worth an explicit call-out in the CLAUDE.md
guidelines, not a code fix.

## Assessment of the proposed sequencing

The proposed order (make `PTAH_E2E` mean more → give git specs a real
workspace → raise timeout/keep traces → worker-scope `electronApp`) is
directionally right but item 2 needs to shrink given what's already built:

1. **Gate `PTAH_E2E` on the three subsystems that don't check it yet —
   agreed, do this first.** Safe, independent, and it is the fix for the
   single largest per-test cost found (the unconditional 30s warmup-barrier
   timeout on every no-workspace boot). Candidate shape: skip
   `armWarmup()`'s wait (or short-circuit it) when `PTAH_E2E === '1'` and no
   memory curator will ever be created for the launched workspace — mirror
   the `update-manager.ts` pattern (`PTAH_E2E` skip + an
   `_ALLOW_`-prefixed opt-back-in for specs that legitimately want warmup
   behaviour, if any exist — a repo-wide check found no spec currently
   asserts on warmup completion, so an opt-back-in may not even be needed).
   Do the same for the messaging gateway start and the electron
   `bootstrap.ts` membership priming call. Each is independent and can land
   as its own small change; verify with the existing
   `boot-coordinator.spec.ts` "warmup barrier" describe block
   (`apps/ptah-electron/src/activation/boot-coordinator.spec.ts:306+`) plus a
   fresh e2e timing comparison (before/after wall time on a no-workspace
   spec like `smoke.spec.ts`).

2. **"Give git specs a real workspace fixture" is largely already done —
   narrow this item.** `real-rpc-fixtures.ts` + `git-scratch-repo.ts` already
   provide exactly this (temp repo, known commits, three known dirty hunks),
   consumed by 4 of 7 git specs plus the permission-survival spec. The
   remaining work here, if any, is: (a) confirm the 3 mocked git specs are
   correctly scoped to UI-only assertions (documentation/audit task, likely
   no code change), and (b) if any other spec family besides git would
   benefit from a real workspace (e.g. `harness/new-project*.spec.ts`,
   `tasks/tasks-board.spec.ts` — these operate over `.ptah/specs/`, which
   needs a real folder on disk to mean anything), check whether they already
   have one. Not investigated further here — worth a quick per-family audit
   before assuming a gap exists.

3. **Raise the per-test timeout and keep traces locally on failure — agreed,
   safe, independent.** `playwright.config.ts:26,44`: bump `timeout` (60s is
   tight even before touching warmup) and change `trace: isCI ? ... : 'off'`
   to `'on-first-retry'` or `'retain-on-failure'` unconditionally — the
   `isCI` split earns nothing once `retries: 0` locally (there is no retry to
   trigger the "on-first-retry" saving) so pick `'retain-on-failure'` for
   both branches, or raise `retries` to 1 locally as well.

4. **Worker-scoped `electronApp` is correctly flagged as the riskiest, and
   sequencing it last behind the other three is right.** It directly
   contradicts `apps/ptah-electron-e2e/CLAUDE.md`'s explicit guideline that
   the app owns global state and tests must stay serial. Concretely, a
   worker-scoped app would carry state across tests via at least: `BootRefs`
   held in the coordinator (DI singletons, git watcher, cron, memory
   curator), the SQLite connection at `PTAH_DB_PATH` (would need a reset or a
   fresh DB per test even inside one worker-lifetime process), and any
   workspace switch a test performs (`workspace-restore.ts`'s persisted
   `ptah.workspaces` state and the `onDidChangeWorkspaceFolders` listener
   chain). No reset primitive exists today: `rpc-bridge.ts`'s `RpcBridge`
   class has no reset/clear method, and there is no `workspace:reset` or
   `test:reset` RPC handler in `rpc-handlers`. Building one is real,
   cross-cutting work (would touch `BootCoordinator`, `WorkspaceContextManager`,
   `GitWatcherService`, the memory curator, and the RPC surface's
   `ALLOWED_METHOD_PREFIXES` gate per this repo's dual-registration rule) —
   proportionate to gate it behind the other three, prove the speed win is
   still needed after items 1-3 land (the 30s-per-boot warmup removal alone
   may make per-test boot acceptable), and treat as its own task with its own
   architecture pass rather than a batch here.

## Scope for this task

In scope:

- Gate embedder warmup, messaging gateway start, and membership/license
  priming behind `PTAH_E2E` (mirroring the existing `update-manager.ts`
  pattern), with tests proving the gate (extend
  `boot-coordinator.spec.ts`'s warmup-barrier describe block; add coverage
  for the gateway and bootstrap gates).
- Raise `playwright.config.ts`'s per-test `timeout` and normalize `trace` to
  capture on failure locally as well as in CI.
- Add the "do not run two `ptah-electron-e2e:e2e` invocations concurrently"
  guideline explicitly to `apps/ptah-electron-e2e/CLAUDE.md` (docs only).
- Audit (not necessarily change) the 3 mocked git specs and any other
  workspace-shaped spec family (`harness/*`, `tasks/*`) for whether their
  mocked-vs-real fixture choice matches what they claim to test; file
  findings, only change fixtures where the mismatch is real.

Out of scope (needs its own task after the above lands and is measured):

- Worker-scoping `electronApp` and the reset infrastructure it requires.

## Not investigated further (flag for whoever picks this up)

- Whether `tasks/tasks-board.spec.ts` and `harness/new-project*.spec.ts`
  need a real on-disk `.ptah/specs/` or generated-project workspace the way
  the git specs do — a quick read of those specs' fixture usage and mockRpc
  calls will answer it in minutes; not done here to keep this filing
  bounded.
- Exact wall-clock savings from gating warmup/gateway/membership on
  `PTAH_E2E` — should be measured with a before/after timing run once
  implemented, not estimated here.

---

## Addendum — `os.homedir()` is not isolated by the harness

Added 2026-09-07, diagnosed by the session owning the MCP directory work and
independently confirmed here.

`apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts:175` asserts
`mcpDirectory:listOAuthConnected` returns an empty servers array on a fresh
launch. It fails on this machine and has since 2026-08-25 — thirteen days
before the MCP commit first suspected of causing it.

**The harness isolates two things and not a third.** `launchPtah` gives each
run its own `--user-data-dir` and its own SQLite database via `PTAH_DB_PATH`.
It does not isolate `os.homedir()`. `apps/ptah-electron-e2e/CLAUDE.md` already
states this plainly: "`--user-data-dir` moves Electron's userData, **not**
`os.homedir()`".

So any store that hardcodes a path under the home directory reads the
developer's real data during a test. Confirmed in this tree:

- `smithery-installed-manifest.ts:33` — `os.homedir()`, hardcoded.
- `McpOAuthInstalledManifestStore` — same shape, reads
  `~/.ptah/mcp-oauth-installed.json`, which on this machine holds one real
  record written 2026-08-25.
- The `~/.ptah/mcp-installed.json` intent store shares the root and holds a
  real entry here too, so any future "fresh launch is empty" assertion over
  `listInstalled` will fail identically.

There is **no `PTAH_HOME` override anywhere in the tree** — verified. This
would be a new seam, not a switch someone forgot to flip.

**Why it matters beyond one test.** The failure is machine-dependent: it passes
on CI and on any machine that has never connected an OAuth MCP server, and
fails permanently for anyone who has. That is worse than a consistently red
test, because it makes the suite's result depend on the developer's own
history.

**Fix**: give those stores a resolvable root instead of a hardcoded
`os.homedir()`, and have `launchPtah` point it at a temp directory, exactly as
it already does for `PTAH_DB_PATH`. Do not weaken the assertion — empty on a
fresh launch is the correct test; the harness simply does not currently
establish "fresh".

This belongs here rather than with the MCP work: it is a harness isolation gap
that happens to be observable through an MCP surface, and it sits beside the
per-test boot cost and the no-workspace launches already recorded above.
