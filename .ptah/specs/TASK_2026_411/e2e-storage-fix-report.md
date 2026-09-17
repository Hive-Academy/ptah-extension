# TASK_2026_411 — `electron-e2e` CI hang: state-storage fix report

Branch `fix/task-411-profile-performance`, worktree
`.claude-worktrees/task-411-profile-performance`. Two commits, not pushed.

## Root cause, restated after verifying it in the source

Every Electron launch built **two** worker-backed `ElectronStateStorage`
instances over **one** storage directory.

1. `libs/backend/platform-electron/src/registration.ts` registered
   `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` with `useValue: new
   ElectronStateStorage(...)`. `useValue` is evaluated at registration time, and
   `ElectronStateStorage`'s constructor immediately calls `workerHost.start()`,
   so a worker thread started the moment phase 0 ran.
2. `apps/ptah-electron/src/di/phase-1-infra.ts` then constructed
   `WorkspaceAwareStateStorage`, whose constructor calls its factory eagerly
   (`workspace-aware-state-storage.ts:71`), producing a **second** worker-backed
   store, and overrode the same token with it.
3. Both resolve the same directory. `registration.ts:83-89` falls back to
   `<userData>/workspace-storage/default` when `options.initialFolders?.[0]` is
   absent — which is every fresh launch and every e2e launch. So both workers
   opened the same `workspace-state.json` and the same `workspace-state.v2`
   commit root, and raced on `quarantineIncompleteV2()` / `commit()`.
4. `bootstrap.ts:306-310` awaits `.whenReady()` before IPC and RPC exist. The
   store the app kept is the one behind that gate; nothing disposed the orphan,
   whose worker kept running. `main.ts:88-104` returns early on failure, so
   `post-window.ts:103` never loads the renderer and the window stays on the
   static `preparing-workspace.html`.

The asymmetry named in the brief is the decisive evidence for **which** instance
is authoritative: only the phase-1 store carries `migrations:
[SESSION_METADATA_MIGRATION]` and `cacheExcludeKeyPrefixes`. The eager one in
`registration.ts` had neither, so it could never have been the intended owner —
it was pure collateral.

I verified each link against source rather than accepting the prior diagnosis:
the `useValue` eagerness, the identical default path on both sides, the
constructor-time factory call, and the absence of any resolve of the token
between phase 0 and the phase-1 override (`registerExtensionContextShim`
resolves only `STATE_STORAGE` and `SECRET_STORAGE`;
`registerStateStorageAdapters`, the first real consumer, runs in **phase 3**).
That last fact is what makes a lazy registration safe.

## Which owner I chose, and why

**`platform-electron`'s registration stops constructing eagerly.** It is now a
memoized `useFactory`.

Rejected alternative: making `phase-1-infra` reuse the already-registered
instance. That would have forced the app to adopt a store built *without* the
migrations and cache exclusions it requires, inverting which side owns the
storage policy, and would have left `platform-electron` still spawning a worker
for hosts that never want one.

Why a memoized factory rather than simply not registering the token:

- The brief requires the token to still resolve for any consumer. It does — a
  host that does not override it gets a fully working store, built on first
  resolve.
- Memoizing preserves the **reference identity** `useValue` guaranteed. A plain
  per-resolve factory would hand every consumer its own worker over one commit
  root, which is the same defect wearing a different hat. A spec asserts `toBe`
  identity for exactly this reason.
- The Electron host overrides the token in phase 1 before anything resolves it,
  so in the shipping path the factory is never invoked and **zero** wasted
  workers are created.

`platform-vscode` and `platform-cli` registrations are untouched; neither was
ever worker-backed. No DI phase manifest needed updating: the token set is
unchanged, only the construction timing. `expected-resolvable.ts` lists RPC
handler classes, not platform tokens, so it was correctly left alone
(`expected-absent.ts` exists only for the VS Code and CLI hosts).

## Bounded wait: mechanism and failure mode

`ElectronStateStorageWorkerHost.ensureInitialized` now races the `initialize`
handshake **and its first snapshot read** — together, the precise definition of
"first ready" — against `handshakeTimeoutMs`, default
`DEFAULT_STATE_WORKER_HANDSHAKE_TIMEOUT_MS = 120_000`.

On expiry: the worker is failed exactly as a crash would fail it (pending
requests rejected, handle terminated), then a typed
`StateStorageRecoveryRequiredError('worker-unresponsive')` is thrown.

Failure mode by design:

- It is **not** an `ElectronStateWorkerCrashedError`, so `withRestart` does not
  retry a worker that has already proven unresponsive.
- `ElectronStateStorage` maps it to `readinessState: { status:
  'recovery-required', reason: 'worker-unresponsive' }`, and `main.ts` renders
  the recovery shell with `Error code: worker-unresponsive`. The shell reads the
  code generically, so no asset change was needed.
- The timer is `unref()`-ed — a liveness backstop must never be why the process
  stays alive — and cleared on either outcome.

`worker-unresponsive` is **host-only by construction**. I added it to
`StateStorageRecoveryReason`, which broke the worker runtime's type assignment
and surfaced a real boundary: the worker must not be able to claim a reason it
cannot reach. The protocol now owns
`ELECTRON_STATE_WORKER_RECOVERY_REASONS` (`as const satisfies readonly
StateStorageRecoveryReason[]`, so it stays a provable subset as the port union
grows), the zod schema is derived from that list, and
`electron-state-storage-worker-runtime.ts` narrows through
`isElectronStateWorkerRecoveryReason`. A non-wire reason degrades to `io-failed`
rather than being forwarded as an unparseable reply — which, on that exact code
path, would itself have been a lost reply.

**Scope, stated honestly.** I bounded the handshake/first-ready only, as the
brief specified. Steady-state `send()` calls remain unbounded; a blanket
per-operation timeout risks aborting legitimate long writes. The residual
exposure is a lost reply *after* boot, which is not the reported defect but is
not closed either. The duplicate-instance bug was fixed on its own merits, not
papered over by the timeout.

The opt-in 256 MB perf spec passes `handshakeTimeoutMs: 600_000`, so the budget
stays a liveness backstop rather than becoming a performance assertion that
advisory spec would flake on.

## New coverage, and exactly how it catches this

The hole: all 35 `ElectronStateStorageWorkerHost` constructions in the existing
spec inject a fake `workerFactory`, so the default `new Worker(workerPath)` path
had **zero** coverage, and the only real-artifact spec is `describe.skip`-ped
behind `PTAH_PERF_SPECS=1`. Nothing counted worker **constructions**.

Three new specs, all in ordinary CI:

1. `libs/backend/platform-electron/src/registration.workspace-state-storage.spec.ts`
   — mocks `node:worker_threads` and counts `new Worker(...)`. Asserts zero
   workers at registration, exactly one on resolve with `toBe` identity across
   resolves, and zero when a host overrides the token first. It mocks the module
   rather than injecting a factory deliberately: injecting one would re-open the
   very hole being closed.
2. `apps/ptah-electron/src/di/workspace-state-storage-single-instance.spec.ts` —
   runs the **real** `registerPhase0Platform` + `registerPhase1Infra` with no
   `initialFolders` (the e2e/fresh-launch case) and asserts exactly one worker
   construction, plus that the token still resolves to the workspace-aware store.
3. `libs/backend/platform-electron/src/implementations/electron-state-storage-handshake.spec.ts`
   — a silent worker under fake timers proves the typed rejection, the
   `recovery-required` readiness state and that the worker is reaped; a third
   case drives the **real** `ElectronStateWorkerRuntime` in-process on the real
   clock to prove a healthy handshake is not failed.

**A subtlety that nearly made these specs worthless.** `new Worker(...)` happens
one microtask after construction (the host reaches it through its promise
request-chain), so a count asserted synchronously reads zero — and would have
read zero for the buggy code too. Every count is now taken after an explicit
`flushWorkerConstruction()`.

**Falsification — I proved the specs fail on the bug.** I temporarily restored
the eager `useValue` and re-ran:

- registration spec: 2 failures — `spawns NO worker at registration time`
  received a 1-element array; the override case likewise.
- DI single-instance spec: 2 failures — received **2** worker constructions
  where 1 is expected. That is the duplicate-instance defect reproduced as a red
  test.

The lazy factory was then restored and both suites re-verified green.

## Gate results

| Gate | Result |
| --- | --- |
| `nx test @ptah-extension/platform-electron` (isolated) | **PASS** — 22 suites, 346 tests (1 suite skipped = opt-in perf) |
| `nx test ptah-electron` (isolated, incl. DI smoke specs) | **PASS** — 38 suites, 504 tests |
| `nx run-many -t test -p platform-electron vscode-core platform-core` | Header confirmed `Running target test for 3 projects`. platform-core 550 passed, vscode-core 530 passed. **platform-electron flaked under parallel load** — see below |
| `nx run-many -t typecheck -p platform-electron vscode-core platform-core ptah-electron` | **PASS** — `Successfully ran target typecheck for 4 projects` |
| `nx run di-lint:lint` | **PASS** — `di-lint OK: 1463 @inject sites all resolve to a registered token (668 tokens)` |
| VS Code host `nx test ptah-extension-vscode` (incl. `container.smoke.spec.ts`) | **PASS** — 5 suites, 39 tests |
| CLI `nx test @ptah-extension/cli-engine` | **PASS** — 17 suites, 173 tests |
| CLI `nx test ptah-cli` (incl. `container.smoke.spec.ts`) | 65 suites / 984 tests pass; **4 pre-existing environmental failures** — see below |

### The two gate caveats, stated plainly

**`platform-electron` flakes inside the parallel `run-many`, not in isolation.**
Two `run-many` attempts failed in **different** pre-existing, disk-heavy specs:
first `electron-state-storage-worker-host.spec.ts` (`io-failed`), then
`electron-state-storage-commit-store.spec.ts` (exceeded the 5 s per-test
timeout). `git diff --name-only HEAD` confirms **I touched neither spec**. Both
pass consistently when the project runs alone (verified four times). The
signature — different victim each run, only under three concurrent Jest
projects, in the two specs that hammer temp directories with real fsync and
rename — is disk contention on Windows, not a logic regression. I am flagging it
rather than burying it: it is a pre-existing fragility this branch did not
introduce and did not fix.

**`ptah-cli` has 4 failures that are environmental.** All four are in
`esm-bundle-gate.spec.ts` and self-describe: `requires a build -- run
nx run ptah-cli:build-embedder-worker`. Unfiltered, `nx test ptah-cli` fails even
earlier at `ptah-cli:copy-wasm` with `WASM file not found ...
node_modules\web-tree-sitter` — exactly the missing dependency the brief named.
The CLI container smoke spec itself passes. A fifth failure I initially saw
(`formatter.spec.ts`, "writes a colored notification") was **caused by my own
`NO_COLOR`/`FORCE_COLOR` grep environment** and disappears without it — noted so
nobody re-chases it.

## What remains unverified without a local e2e run

This worktree cannot run the suite: `node_modules` lacks `electron`,
`@playwright/test`, `web-tree-sitter`, `prismjs` and `daisyui`. I did not try to
install them. Therefore:

- **That the e2e job returns to 6-8 minutes is unproven.** I proved the
  duplicate construction is gone at the DI level; I could not observe a real
  Electron launch.
- **The real `new Worker` thread in an Electron main process is still untested
  here.** My specs mock `node:worker_threads` or drive the runtime in-process.
  The genuine artifact runs only under `PTAH_PERF_SPECS=1`, which needs a build
  this worktree cannot produce.
- **The 120 s default is a judgement call, not a measurement.** I could not time
  a real v1→v2 migration on CI hardware. If a legitimate large-profile migration
  on a slow runner exceeds it, users would see a `worker-unresponsive` recovery
  screen instead of a slow boot — a loud, diagnosable failure rather than the
  silent hang, but still a behaviour change worth watching in the first CI run.
- **Whether S2 (added wall-clock per launch) alone still strains the 45-minute
  budget** is untested. One worker plus a migration commit per launch across 253
  fresh launches remains real cost; removing the duplicate halves the worker
  work but does not eliminate it.
- I did not reproduce the original race; it is timing-dependent and
  platform-specific (CI is Linux/xvfb). The duplicate **construction** is
  static and certain, and that is what I fixed and pinned.

## Repository state

`git log --oneline -5` (at time of writing, before this report was committed):

```
a9f2fd97d fix(platform-electron): bound the state storage worker handshake
73efbfbf3 fix(platform-electron): construct one workspace state storage per launch
4c81a166e fix(agent-sdk): sort agent files deterministically and drop the single-pass loop
56cd72cdf fix(auth-providers): drop the codex home resolver di seams
d035565c7 docs(task-specs): record TASK_2026_411 b9 lint closure
```

`git status --short`:

```
?? .ptah/specs/TASK_2026_411/ci-fixes-report.md
```

That untracked file belongs to another agent in this session; I did not create,
modify or commit it. **Nothing was pushed.**

### Files changed

Commit `73efbfbf3`:

- `libs/backend/platform-electron/src/registration.ts` — memoized lazy factory
- `libs/backend/platform-electron/src/registration.workspace-state-storage.spec.ts` — new
- `apps/ptah-electron/src/di/workspace-state-storage-single-instance.spec.ts` — new

Commit `a9f2fd97d`:

- `libs/backend/platform-core/src/interfaces/state-storage-readiness.interface.ts` — `worker-unresponsive`
- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts` — bounded handshake
- `libs/backend/platform-electron/src/implementations/electron-state-storage.ts` — option passthrough
- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` — wire-reason list + guard
- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts` — narrow through the guard
- `libs/backend/platform-electron/src/implementations/electron-state-storage-handshake.spec.ts` — new
- `libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts` — explicit budget
