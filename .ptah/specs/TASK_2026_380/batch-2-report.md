# Batch 2 — backend implementation report (TASK_2026_380)

**Tasks completed**: 2.1, 2.2, 2.3, in that order.
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.
Every path below is inside that worktree. The main checkout was never touched, never
read, never written.
**No commit was made. No file under `libs/backend/persistence-sqlite` was modified.**

Batch 1 was already committed here as `0c7e4d05c perf(persistence-sqlite): batch 1 -
move integrity state off the boot path`, so the port, protocol, worker entry, tokens and
`SqliteIntegrityService` this batch wires are tracked, not dirty.

---

## Files

### CREATED

| Path                                                                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts`      | `ElectronIntegrityWorkerFactory` — `utilityProcess.fork(this.workerPath, [], { serviceName: 'ptah-integrity-worker' })`, wrapped in a private `ElectronIntegrityWorkerProcess` that maps `message` / `exit` / `kill` onto the child. Templated on `electron-embedder-worker-factory.ts:44-63`, including its `import electron, { type UtilityProcess } from 'electron'` + module-scope destructure. **One deliberate difference: it posts no `init`** — the integrity worker is single-shot and takes the db path on the `check` request, per `worker-process.port.ts:28-33`. The constructor therefore takes one argument (the path), not two. |
| `apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.spec.ts` | 6 specs. Fork called once with the CONFIGURED path and the service name; **no `init` posted**; `postMessage` / `kill` forwarded; a `message` payload reaches the message listener; `on('exit')` maps the numeric code (`[[0], [3]]`); a second `spawn()` forks a second child. `jest.mock('electron', …)` supplies `utilityProcess`, which the shared `apps/ptah-electron/__mocks__/electron.ts` does not carry.                                                                                                                                                                                                                                |
| `libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`              | `CliIntegrityWorkerFactory` on `node:worker_threads`, templated on `cli-embedder-worker-factory.ts:14-40` (same `type: 'module'` cast seam, same `terminate()` on `kill`). Also posts no `init`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `apps/ptah-electron/tsconfig.integrity-worker.json`                                  | Copy of `tsconfig.embedder-worker.json` pointed at `libs/backend/persistence-sqlite/src/lib/integrity/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/ptah-cli/tsconfig.integrity-worker.json`                                       | Same, extending `apps/ptah-cli/tsconfig.build.json`. **Not in the task file list — see deviation 1.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### MODIFIED

| Path                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/ptah-electron/src/di/phase-2-libraries.ts`                    | Import of `ElectronIntegrityWorkerFactory`; and, inside the existing try/catch beside the embedder factory (now `:308-330`), `integrityWorkerEntry` derived from the same `dirnameGlobal ?? path.join(os.homedir(), '.ptah')` expression the embedder path uses, registered as `useValue` under `PERSISTENCE_TOKENS.INTEGRITY_WORKER_PATH`, plus `INTEGRITY_WORKER_PROCESS_FACTORY` as a `useValue` instance. **Both land BEFORE `registerPersistenceSqliteServices`**, so `SqliteIntegrityService` resolves a factory instead of its optional `null`. |
| `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts` | Same two registrations beside the CLI embedder factory, path `path.join(__dirname, 'integrity-worker.mjs')`, before `registerPersistenceSqliteServices`. Carries the A-2 comment (below).                                                                                                                                                                                                                                                                                                                                                              |
| `apps/ptah-electron/project.json`                                   | New `build-integrity-worker` target + **three list edits** (named individually below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/ptah-cli/project.json`                                        | New `build-integrity-worker` target + **one list edit** (named below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`            | `type SqliteIntegrityService` added to the existing `persistence-sqlite` import; three module constants (`INTEGRITY_HANDLER_NAME = 'db:integrity'`, `INTEGRITY_CRON_EXPR = '30 3 * * *'`, `INTEGRITY_BOOT_DISPATCH_DELAY_MS = 60_000`); `registerIntegrityCheckJob(...)` modelled on `registerSkillDrainJobs`; and a call site wrapped in the file's own non-fatal try/catch, immediately after the drain block and inside the same `CRON_JOB_STORE && CRON_HANDLER_REGISTRY` guard. **307 → 422 lines**, well under the 700 ceiling.                  |
| `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`       | New `describe('database integrity check job')` with 7 specs. 457 → 656 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

---

## The FOUR worker-build lists, named individually

The HIGH-severity risk row is discharged. All four edited:

1. **`apps/ptah-electron/project.json` → `build.dependsOn`** — `"build-integrity-worker"`
   added after `"build-voice-worker"`, before `"ptah-extension-webview:build"`.
   _(Proved by `nx build ptah-electron` emitting the file — see Verification.)_
2. **`apps/ptah-electron/project.json` → `build-dev.commands`** —
   `"nx build-integrity-worker ptah-electron"` added after the voice line, before
   `copy-wasm`. This is the list `electron:serve` runs.
3. **`apps/ptah-electron/project.json` → `serve:watch.commands`** —
   `"nx build-integrity-worker ptah-electron --watch"` added after the voice watch line.
   _(The prompt calls this "serve watch `commands` (~:273-274)"; the target's actual name
   in the file is `serve:watch`. The `serve` target itself lists no worker builds — it
   delegates to `build-dev`, which is list 2.)_
4. **`apps/ptah-cli/project.json` → `restore-cli-manifest.dependsOn`** —
   `"build-integrity-worker"` added after `"build-embedder-worker"`, before the
   `ptah-tui` object. This is the CLI's worker chain: `build-embedder-worker` depends on
   `build`, and `restore-cli-manifest` depends on both workers.

Both new esbuild targets carry exactly the required options:
`main: libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`,
`outputFileName: "integrity-worker.mjs"`, `external: ["better-sqlite3"]`, `format: esm`,
`platform: node`, `target: node20`, `skipTypeCheck: true`, `deleteOutputPath: false`,
`.js → .mjs` out-extension — copied from `build-embedder-worker` in each file
respectively (the two differ: the Electron one has `dependsOn: []` and a file-scoped
`outputs`; the CLI one has `dependsOn: ["build"]` and `outputs: ["{options.outputPath}"]`).

---

## Task 2.3 — what was implemented

- **Handler** `db:integrity`, registered through `handlerRegistry.register` behind
  `has()` (`start-thoth-cron.ts:103`/`:206` idiom), so a second `startThothCron` does not
  hit `HandlerRegistry.register`'s duplicate-name throw.
- **Job** upserted unguarded (idempotent by definition, exactly as the backup and drain
  jobs are): `id: '@ptah/db-integrity-check'`, `name: 'Database Integrity Check'`,
  `cronExpr: '30 3 * * *'`, `timezone: 'UTC'`, `prompt: 'handler:db:integrity'`,
  `enabled: true`. It appears in `cron:list` for free.
- **Handler body**: resolves `PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE`, returns
  `{ outcome: 'skipped', reason: 'not-due' }` when `isDue()` is false, otherwise
  `void integrity.dispatchIfDue()` and returns
  `{ summary: 'integrity check dispatched (runs out of process)' }`.
- **Boot dispatch**: one `setTimeout(…, 60_000)`, `unref`'d through the repo's guarded
  shape (`(t as { unref?: () => void }).unref?.()`, per
  `agent-process-manager.service.ts:1311`), armed INSIDE the `!has()` branch so two
  `startThothCron` calls arm one timer. Its body resolves the service in a
  `catch (bootErr: unknown)` — the timer fires on its own stack, where a throw from a
  torn-down container has nowhere to go.
- **The dispatch is never awaited** — not in the handler, not in the timer.
- **Guarded by `container.isRegistered(SQLITE_INTEGRITY_SERVICE)`**; the whole call site
  is inside its own non-fatal try/catch that warns and continues.
- `persistence-sqlite` still imports nothing from `cron-scheduler`; the seam stays in
  `thoth-runtime`, which already imported `PERSISTENCE_TOKENS`.

New specs (7): job upserted with the exact id/expression object; handler registered
**once** across two calls while `upsert` runs **twice**; exactly one timer armed across
two calls, at 60 000 ms, `unref` called once, `dispatchIfDue` not called before it fires
and called exactly once after; a resolve-throwing container does not make the timer
throw; the handler returns its summary even when `dispatchIfDue` returns a promise that
never settles (the never-awaited proof); a not-due tick returns the skipped outcome and
dispatches nothing; a container without the service registers no handler, upserts only
`@ptah/daily-backup`, arms no timer and does not throw.

The boot timer is asserted through a `jest.spyOn(global, 'setTimeout')` capture rather
than Jest fake timers, so the delay is read off the spy's arguments and the callback is
invoked by hand — every assertion is a call count or an argument, never a timing.

---

## Verification

| Command                                                                                                              | Result                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine ptah-electron`                  | **`Successfully ran target test for 3 projects`** (header read; N = 3). thoth-runtime 3 suites / **52** tests passed (was 45); cli-engine 17 suites / 169 passed; ptah-electron 33 of 34 suites passed, 1 skipped, **416** passed / 4 skipped / 0 failed. |
| `npx jest --config apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron electron-integrity-worker-factory` | 1 suite / **6 passed** — confirms the new spec is picked up, not silently unmatched.                                                                                                                                                                      |
| `npx jest --config libs/backend/thoth-runtime/jest.config.ts --rootDir libs/backend/thoth-runtime start-thoth-cron`  | 1 suite / **20 passed** (was 13).                                                                                                                                                                                                                         |
| `npx nx build ptah-electron`                                                                                         | **succeeded**, 10 tasks.                                                                                                                                                                                                                                  |
| `ls -la dist/apps/ptah-electron/integrity-worker.mjs`                                                                | **exists**, 3 400 bytes, beside `embedder-worker.mjs` and `voice-worker.mjs`. Its only `better-sqlite3` occurrence is `const Database = __require("better-sqlite3")` — the external held.                                                                 |
| `npx nx build ptah-cli`                                                                                              | **succeeded**, 28 tasks.                                                                                                                                                                                                                                  |
| `npx nx build-integrity-worker ptah-cli`                                                                             | **succeeded**; `dist/apps/ptah-cli/integrity-worker.mjs` exists, 3 400 bytes. Run explicitly because `nx build ptah-cli` is `build-esbuild + copy-wasm` and does not reach the worker chain — `restore-cli-manifest` does, and that is the list I edited. |
| `npx eslint` on all 7 touched/created `.ts` files                                                                    | **clean, no output.**                                                                                                                                                                                                                                     |
| `npx nx run-many -t typecheck -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine ptah-electron`             | thoth-runtime **clean**, cli-engine **clean**, ptah-electron **FAILED with 5 errors, none in a file this batch touched** — see the blocking note below.                                                                                                   |
| `wc -l libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`                                                       | **422** (was 307). Under the 700 ceiling.                                                                                                                                                                                                                 |

`typecheck:all` and `lint:all` were not run — the orchestrator owns them, and
`typecheck:all` currently reports 39 pre-existing `libs/api/*` errors in this worktree
(Prisma client not generated).

### Blocking note for the team-leader: a second agent is live in this worktree

My brief said I was the only agent here. `git status --short` says otherwise: an
in-flight **Batch 3** implementation is present and currently does not compile.
Untracked/modified files that are not mine and are not Batch 1:

`libs/backend/platform-core/src/interfaces/boot-readiness.interface.ts`,
`libs/backend/platform-core/src/{di/tokens.ts,index.ts}`,
`libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.{handlers,schema}.ts` (+ the two
barrels and `host-profile/manifest.ts`),
`libs/backend/vscode-core/src/services/null-boot-readiness{,.spec}.ts`,
`libs/backend/vscode-core/src/{di/register-platform-agnostic.ts,messaging/rpc-handler.ts}`,
`libs/shared/src/lib/types/rpc.types.ts`,
`apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`,
`apps/ptah-electron/src/{activation/bootstrap.ts,main.ts}`.

The five `ptah-electron:typecheck` errors all originate there:

```
apps/ptah-electron/src/activation/bootstrap.ts(130,38): TS2344 '"snapshot"' does not satisfy 'keyof BootCoordinator'
apps/ptah-electron/src/main.ts(66,60): TS2345 'BootCoordinator' not assignable to 'Pick<BootCoordinator, "snapshot">'
apps/ptah-electron/src/services/platform/electron-boot-readiness.ts(27,67): TS2344 same
apps/ptah-electron/src/services/platform/electron-boot-readiness.ts(30,12): TS2571 Object is of type 'unknown'
libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.ts(59,40): TS2739 'BootReadinessChangedPayload' missing Promise members
```

None of them names a Batch 2 file, and `ptah-electron:test` (416 passing) and both builds
are green over the same tree. I did not touch, revert or restage any of it. **Batch 2
must not be commit-gated on that typecheck until Batch 3's owner lands `BootCoordinator.snapshot`** — a
`git stash`-based confirmation would have disturbed the other agent, so I did not attempt one.

---

## Plan deviations

1. **`apps/ptah-cli/tsconfig.integrity-worker.json` was created; the task file list names
   only the Electron one.** The CLI's `build-integrity-worker` needs a `tsConfig`, and
   the CLI already keeps its own `tsconfig.embedder-worker.json` for exactly this reason
   (the two apps have different `paths` maps — `vscode` resolves to the Electron shim in
   one and the `cli-engine` shim in the other). Pointing the CLI target at the Electron
   tsconfig would have crossed that boundary. Two lines of content, same shape as its
   sibling.

2. **The cron handler calls `isDue()` before dispatching, and returns a `skipped`
   outcome when it is false.** The plan specifies only `{ summary }` or
   `{ outcome: 'skipped', reason }`. Without the pre-check every nightly tick would be
   recorded as `succeeded` while doing nothing — the exact fault TASK_2026_315 fixed for
   the drain tiers (`start-thoth-cron.ts:118-124`). `isDue()` is public on the service and
   costs one store read that already degrades to `null` on any throw.

3. **The boot timer is armed inside the `!handlerRegistry.has()` branch**, so it is
   one-per-process rather than one-per-`startThothCron`. The acceptance says "the boot
   timer is `unref`'d and calls `dispatchIfDue` exactly once"; arming per call would
   arm two on a re-activation. `dispatchIfDue`'s own single-flight flag would have
   collapsed them anyway, but two timers is not what "one boot dispatch" means.

4. **`ElectronIntegrityWorkerFactory`'s constructor takes one argument.** The embedder
   template takes `(workerPath, modelCacheDir)` because it posts an `init`. This port
   posts none, so a second constructor argument would have nothing to carry.

5. **`INTEGRITY_WORKER_PATH` is registered but nothing resolves it.** Deliberate and
   pre-authorised by Batch 1: the token exists so both worker paths are registered the
   same way (`tokens.ts:39-43`), exactly like `EMBEDDER_WORKER_PATH`, which is likewise
   declared and never resolved. Each host's factory is constructed with the same string.

---

## Out-of-scope observations

- **The CLI registers a factory nothing dispatches (A-2, refuted assumption).** The
  registration site carries the required one-line note, expanded to a short block so it
  cannot be missed: it names `startThothCron` as the only dispatch site, says
  `cli-engine` never calls it, and states that this is the accepted degrade for a
  short-lived process — not dead code and not a wiring bug. If someone later wants the
  CLI to check, the change is one `startThothCron` call, not a second seam.
- **The packaged path is unproven.** `nx build` emits `integrity-worker.mjs`, but
  whether `utilityProcess.fork` can load the ABI-143 `better-sqlite3` from it is a
  packaged-run question (`nx package ptah-electron` + `verify-packed-native.js`), and so
  is assumption A-1 (can a read-only connection open the WAL database while the main
  process holds it). Both belong to Batch 5's live cold boot. Nothing in this batch
  opened `~/.ptah/state/ptah.sqlite`; no test in it opens any real database.
- **`start-thoth-cron.ts:207-251` still runs the daily `db.backup()` (a full ~1 GB
  copy) plus `quick_check`, `incremental_vacuum` and `optimize` on the main process.**
  Batch 1 recorded this; it is still true, and the worker this batch wires is what makes
  moving it a small change later. Not touched.
- **`apps/ptah-electron/CLAUDE.md`'s "Build & Run" section now understates the chain** —
  it lists `build-main + build-preload + build-embedder-worker + webview` and does not
  mention `build-voice-worker` (already stale before this batch) or
  `build-integrity-worker`. Documentation is outside this batch's ownership; flagging it
  for whoever closes the task.
