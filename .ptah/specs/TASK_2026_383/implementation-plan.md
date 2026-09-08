# Implementation Plan - TASK_2026_383

> All paths are relative to the worktree
> `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/` unless
> written absolute. That worktree is `main` + the six TASK_2026_380 commits
> (PR #463, unmerged) and is the base branch for this task.

## Inputs and constraints

- **Requirements used**:
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_383/task.md`
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_383/context.md`
  - `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/.ptah/specs/TASK_2026_380/future-enhancements.md` (items 1, 2, 5, 11, 16)
  - `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/.ptah/specs/TASK_2026_380/test-report.md` (Finding F-1, measurement method, residual-jank table)
- **Corrections applied**: none (no `task-description.md`, no `research-report.md`,
  no prior `implementation-plan.md` in this folder).
- **Design handoff used**: none — no UI surface is created by this task. The one
  renderer-visible change (Track C item C-1) _removes_ an eager call; it changes
  no layout, token or component contract.
- **Missing decision-critical input**: none. Three of `context.md`'s stated sweep
  numbers did not survive re-measurement against the worktree; the corrected
  numbers are in **Codebase evidence** below and they change Track A's scope.
  This is recorded rather than silently absorbed.
- **Tooling note**: `ptah_get_dependents` timed out (index build) on both
  `backup.service.ts` and `integrity-worker-protocol.ts`. Blast radius for every
  file this plan touches was established by exhaustive content search instead and
  is enumerated verbatim under **Team-leader handoff → Files affected**.

### Four premises in `context.md` that the evidence corrects

These are not quibbles — each one changes what a batch is allowed to do.

| `context.md` says                | Verified in the worktree                                                                                                                                                                                                                                                 | Consequence                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 508 catch-return-sentinel sites  | ~300 matches (~268 production, ~32 spec) under a bounded multiline regex; the 508 figure was measured on `main` with a looser pattern                                                                                                                                    | The triage table is ~268 production rows, not 530. Still large; the per-lib ownership model stands.                                        |
| 20 promise-swallow sites         | ~225 matches, but **157 of them are in `apps/ptah-electron-e2e`** and 8 more in `libs/frontend/webview-e2e-harness` — harness code, not product                                                                                                                          | Production promise-swallows are ~35. The audit must exclude e2e harnesses by path, or the inventory is 85% noise.                          |
| Lint rule needed for empty catch | **9** empty catches repo-wide; **7 are in specs** and the 2 production ones are detector fixtures inside `libs/backend/workspace-intelligence/src/quality/rules/error-handling-rules.ts`                                                                                 | `no-empty`/`allowEmptyCatch: false` is nearly free and nearly pointless. Ship it (cost ~0) but do not treat it as the Track A deliverable. |
| "Forbid green-by-skip"           | 97 conditional skips exist. **~75 are `nativeAvailable ? describe : describe.skip`** guarding `require.resolve('better-sqlite3')` — a deliberate, load-bearing convention across `persistence-sqlite`, `skill-synthesis`, `memory-curator`, `task-specs`, `rpc-handlers` | A blanket ban breaks ~75 legitimate suites. The rule must target **build-artifact** skips only: exactly 3 sites.                           |

## Codebase evidence

| Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                | Architectural implication                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`no-restricted-syntax` is a single rule with a single severity, and flat config _replaces_ its option array per file match. The repo already documents this trap.**                                                                                                                                                                                                                        | `eslint.config.mjs:8-12` (the exported-const comment), `:297` (`['error', ...MESSAGE_LITERAL_SELECTORS]` for `**/*.ts`), `:350-358` (re-stated for `apps/**/*.ts`)                                                                                                                                                                                                                                                                                      | A warn-level `CatchClause` selector added to `no-restricted-syntax` for `**/*.ts` **silently deletes the two error-level message-literal guards**. The sentinel-catch audit must NOT live in this rule.                                                                                                                                                    |
| **ESLint runs in no CI job.** `ci.yml` runs `di-lint:self-test`, `di-lint:lint`, `nx affected -t test --coverage`, `nx affected -t build` — and stops (file is 120 lines).                                                                                                                                                                                                                   | `.github/workflows/ci.yml:107-120`; only other `lint` occurrence repo-wide is `publish-cli.yml:322`, scoped to `ptah-cli`                                                                                                                                                                                                                                                                                                                               | A `warn`-severity ESLint rule enforces **nothing** anywhere. The pre-commit hook runs `nx affected --target=lint --max-warnings=-1`, which does not fail on warnings (`.lintstagedrc.mjs`). The audit needs its own gate, not a severity.                                                                                                                  |
| **`tools/di-lint` is the repository's own precedent for exactly this shape**: an Nx `type:tool` project with a `lint` target (a `ts-node` script over `libs/**` + `apps/**`) and a `self-test` target that runs the linter against a planted fixture and asserts exit 1. Both are CI steps.                                                                                                  | `tools/di-lint/project.json` (whole file), `tools/di-lint/run-self-test.js:1-27`, `tools/di-lint/__fixtures__/unregistered-inject.ts`, `.github/workflows/ci.yml:105-111`                                                                                                                                                                                                                                                                               | Track A's audit is a second `tools/*` project modelled on this, not an ESLint rule. It gets a self-test for the same reason di-lint has one: "a broken linter can't silently pass".                                                                                                                                                                        |
| **No type-aware ESLint anywhere.** Zero occurrences of `projectService` or `parserOptions` in `eslint.config.mjs`, `eslint.angular.config.mjs`, or any of the 6 per-project configs.                                                                                                                                                                                                         | `grep -rn "projectService\|parserOptions" --include=eslint.config.mjs` → no hits                                                                                                                                                                                                                                                                                                                                                                        | `@typescript-eslint/no-floating-promises` requires standing up type-aware parsing from scratch. Repo-wide that is a multi-minute parse over ~2681 `.ts` files for a rule no CI job runs. Scope it.                                                                                                                                                         |
| **9 esbuild targets across 4 apps emit `format: ["esm"]`. Exactly 3 carry no banner and no `esbuildConfig`.**                                                                                                                                                                                                                                                                                | `apps/ptah-cli/project.json` `build-embedder-worker` (~:140); `apps/ptah-electron/project.json` `build-embedder-worker` (~:146) and `build-voice-worker` (~:197). Banner present: `ptah-cli:build-esbuild`, `ptah-cli:build-integrity-worker`, `ptah-electron:build-integrity-worker`, `ptah-extension-vscode:build-esbuild`, `ptah-tui:build`. `ptah-electron:build-main` gets its banner from `esbuildConfig: apps/ptah-electron/esbuild.config.cjs`. | The gate must accept **both** idioms (inline banner OR `esbuildConfig` file), which `integrity-worker-bundle.spec.ts:94-106` already does.                                                                                                                                                                                                                 |
| **The three unbannered bundles are latent, not broken — measured against the real artifacts.** `dist/apps/ptah-electron/embedder-worker.mjs`: 0 `Dynamic require of` shims, 0 `createRequire`. `voice-worker.mjs`: same. Both `integrity-worker.mjs` bundles: 1 shim, 1 `createRequire`. Neither `embedder-worker.ts` nor `voice-worker.ts` contains `require`, `__dirname` or `__filename`. | `grep -c` over the four built `.mjs` files; `grep -n "require\|createRequire\|__dirname\|__filename"` over both worker sources → no hits                                                                                                                                                                                                                                                                                                                | **The gate's assertion must be conditional, not unconditional.** "Every ESM target must have a banner" is a cargo-cult rule against two bundles that provably do not need one. The correct invariant is: _if the built bundle emits a `Dynamic require of` shim, a `createRequire(import.meta.url)` must appear before it_ — plus an executable self-test. |
| **`db.backup()` is one synchronous full-file copy on the first slice, and nothing in the options can change that.** `runBackup` calls `backup.transfer(rate)` with `rate = 0` (unlimited) on the first `setImmediate` step, and only then sets `rate = 100`. A `progress` handler runs _after_ that first unlimited transfer.                                                                | `node_modules/better-sqlite3/lib/methods/backup.js:33-64`                                                                                                                                                                                                                                                                                                                                                                                               | The 1 GB copy genuinely blocks the main thread in one C++ call. There is no cheaper in-process fix (no chunk-rate option, no `progress` trick). A worker is the only lever — the same conclusion TASK_2026_380 reached for `quick_check`.                                                                                                                  |
| **`SqliteBackupService` then runs a SECOND full-file synchronous read on the main thread** — it reopens the finished 1 GB copy and runs `PRAGMA quick_check` on it.                                                                                                                                                                                                                          | `backup.service.ts:195` → `checkIntegrity` `:231-284`, pragma at `:255`                                                                                                                                                                                                                                                                                                                                                                                 | Track B moves _both_ halves (copy + validate) or it moves half the cost. Item 16 of 380's follow-ups is therefore not optional here; it is inside this move.                                                                                                                                                                                               |
| **`IBackupService.backup(db, kind)` takes the live host handle purely to call `db.backup()`.** The service already injects the db _path_ separately.                                                                                                                                                                                                                                         | `backup.service.ts:87-104` (interface), `:109` (`@inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) dbPath`), `:191` (`await db.backup(dest)`)                                                                                                                                                                                                                                                                                                                  | A worker opens by path. The `db` parameter is the one thing blocking the move and it is already redundant with an injected field. Drop the parameter; do not add a branch that ignores it.                                                                                                                                                                 |
| **Four `backup()` call sites, and they are the complete set.**                                                                                                                                                                                                                                                                                                                               | `migration-runner.ts:91` (`'pre-migration'`), `thoth-runtime/start-thoth-cron.ts:372` (`'daily'`), `cli-engine/bootstrap/thoth-runtime.ts:432` (`'daily'`), `rpc-handlers/persistence-rpc.handlers.ts:433` (`'reset'`)                                                                                                                                                                                                                                  | Signature change is a 4-line edit plus ~20 spec call sites in `backup.service.spec.ts` and 2 in `start-thoth-cron.spec.ts`. Bounded and enumerable.                                                                                                                                                                                                        |
| **The daily cron handler's `incremental_vacuum(100)` and `optimize` are WRITES to the live connection** and cannot move to a read-only worker.                                                                                                                                                                                                                                               | `start-thoth-cron.ts:387` and `:397`; CLI twin at `cli-engine/bootstrap/thoth-runtime.ts`                                                                                                                                                                                                                                                                                                                                                               | Track B's boundary: the worker owns _copy + validate_; the host keeps the two write pragmas. `incremental_vacuum(100)` is bounded to 100 pages; `optimize` is not bounded and is a separate, un-measured cost.                                                                                                                                             |
| **The pre-migration backup is already `await`ed inside an `async applyAll`.**                                                                                                                                                                                                                                                                                                                | `migration-runner.ts:65-101`, `await this.backupService.backup(...)` at `:91`                                                                                                                                                                                                                                                                                                                                                                           | "Off the main thread" for this site needs **no structural change to `applyAll`**. Replacing a synchronous C++ copy with an awaited worker round-trip frees the event loop across the same `await`. The ordering guarantee (backup completes before migration) is preserved for free.                                                                       |
| **The integrity worker already proved a second process can read the live 1 GB WAL database while the host holds it** — `quick_check` + `foreign_key_check` in 1983 ms, verdict persisted.                                                                                                                                                                                                    | `TASK_2026_380/test-report.md` "A-1 live proof", worker at `integrity/integrity-worker.ts:120-125` (`readonly: true, fileMustExist: true`)                                                                                                                                                                                                                                                                                                              | The transport, the ABI story, the read-only-against-WAL question and the never-block contract are all settled. Track B is wiring on a proven substrate, not new design.                                                                                                                                                                                    |
| **The worker port and factory are single-shot per spawn and carry no per-command state.**                                                                                                                                                                                                                                                                                                    | `integrity/worker-process.port.ts:27-34` (`spawn()`, no `init` message); `apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts:56-61` (`utilityProcess.fork` per `spawn()`)                                                                                                                                                                                                                                                    | A second command needs no lifecycle change: each command gets its own process. `SqliteIntegrityService.dispatching` (`integrity-check.service.ts:79`) is a per-service flag and must not be shared with backup.                                                                                                                                            |
| **The worker's inbound narrowing is already a discriminated union on `type`.**                                                                                                                                                                                                                                                                                                               | `integrity/integrity-worker-protocol.ts:25-32` (`type: 'check'`), `isIntegrityCheckRequest` `:82-93`, dispatch at `integrity-worker.ts:193-201`                                                                                                                                                                                                                                                                                                         | Adding `type: 'backup'` is an additive union widening with an existing narrowing seam. No rewrite.                                                                                                                                                                                                                                                         |
| **A worker target must be wired in three places or the dev build silently ships without it.**                                                                                                                                                                                                                                                                                                | `apps/ptah-electron/project.json`: `build.dependsOn` (5 worker/webview entries), `build-dev.commands`, `serve:watch.commands`; the app's own CLAUDE.md states the rule                                                                                                                                                                                                                                                                                  | Any _new_ esbuild target multiplies wiring risk by 3 per host. This is the decisive argument against a sibling backup worker.                                                                                                                                                                                                                              |
| **`OffThreadProcessSpawner` already exists and already solves "`child_process.spawn` blocks the calling thread on Windows"** — measured `claude.exe` 1850–1975 ms inline vs host loop max 29 ms off-thread. It implements `platform-core`'s `IProcessSpawner` and is bound to `SDK_TOKENS.SDK_PROCESS_SPAWNER`.                                                                              | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:1-52`; token `agent-sdk/src/lib/di/tokens.ts:51`; bound `agent-sdk/src/lib/di/register.ts:316`; consumers `cli-detection.service.ts:47`, `sdk-model-service.ts:264`, `sdk-query-runner.service.ts:176`, `ptah-cli-registry.ts:123`                                                                                                                                                | Track C's spawn-bound handlers do not need a new deferral mechanism. They need to **use the primitive TASK_2026_341 already built**.                                                                                                                                                                                                                       |
| **`git:info` does NOT use it.** `execGit` spawns through `crossSpawn` directly.                                                                                                                                                                                                                                                                                                              | `libs/backend/vscode-core/src/utils/exec-git.ts:148` (`crossSpawn(gitCommand(), args, …)`), wrapper `:219`; `GitInfoService.execGit` `git-info.service.ts:2283`, `computeGitInfo` `:341-352`                                                                                                                                                                                                                                                            | This is the single clearest Track C defect: a known-blocking spawn on a path with a known non-blocking adapter available through `platform-core`.                                                                                                                                                                                                          |
| **`autocomplete:agents` (4095 ms, the outlier) is pure disk I/O with a process-local, TTL-less, LRU-8 cache.**                                                                                                                                                                                                                                                                               | `agent-discovery.service.ts:106` (`private readonly caches = new Map<string, AgentInfo[]>()`), search `:240-268`, scan `:360` (`fs.readdir`) and `:412` (`fs.readFile` per agent `.md`), invalidation `:306`                                                                                                                                                                                                                                            | Nothing survives a restart, so **every cold boot pays the full scan**.                                                                                                                                                                                                                                                                                     |
| **…and it is fired eagerly from a component `ngOnInit`, while a lazy path already exists.**                                                                                                                                                                                                                                                                                                  | `libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts:158-167` (`ngOnInit` → `preloadAgents()`) and `:188` (`toggleDropdown` → same)                                                                                                                                                                                                                                                                                          | The largest single number in the jank window is bought by a preload for a dropdown the user has not opened. Deleting the eager call is a one-line frontend change.                                                                                                                                                                                         |
| **`config:models-list` fires from a service constructor**, before any consumer asks.                                                                                                                                                                                                                                                                                                         | `libs/frontend/core/src/lib/services/model-state.service.ts:150-151`; RPC at `:287`; also fired by `chat-state/tab-manager.service.ts:782` on every `createTab` (including the boot tab)                                                                                                                                                                                                                                                                | The constructor call is redundant with the `createTab` call on the boot path.                                                                                                                                                                                                                                                                              |
| **`auth:getAuthStatus` already has three cache layers, all process-local.** Handler TTL 15 s (`AUTH_STATUS_CACHE_TTL_MS`, `auth-rpc.handlers.ts:77`), CLI health memo 5 min (`:90`, written `:687-690`), detector version probe 30 s (`claude-cli-detector.ts:76`). Cost source is `crossSpawn` of `claude --version` (`claude-cli-detector.ts:24`, `:524`, `:536`).                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing survives a restart. Cross-boot persistence of the health memo is the remedy, not a fourth in-memory cache.                                                                                                                                                                                                                                         |
| **`session:list` has two undeduped boot callers** and re-`readdir`s `~/.claude/projects` on each.                                                                                                                                                                                                                                                                                            | Handler `session-rpc.handlers.ts:294`; `listTranscriptIds` `:1280` → `fs.readdir` `:1288`; store blob read `session-metadata-store.ts:526`. Callers: `chat-lifecycle.service.ts:55` and `dashboard/session-analytics-state.service.ts:225`. Only mitigation is a 300 ms trailing debounce at `session-loader.service.ts:176-192`                                                                                                                        | Two ~2290 ms entries in the 380 boot log is exactly two callers, not one slow call.                                                                                                                                                                                                                                                                        |
| **Nothing sequences the five handlers against each other at boot.** `ChatLifecycleService.bootstrap` fires `session:list`, CLI restore, liveness reconcile, `auth:getAuthStatus` and license status detached in one synchronous block.                                                                                                                                                       | `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:50-77` (verbatim: five `.catch(...)`-terminated calls, no `await` between them)                                                                                                                                                                                                                                                                                               | The "all at once" in the 380 report is literal. Staggering is available as a remedy but is a _last_ resort — three of the five have a cheaper structural fix.                                                                                                                                                                                              |
| **`activity:event` is the repository's precedent for a push-only observability contract**: a closed source union, a payload interface, a `isActivityEventPayload` narrowing guard, one `MESSAGE_TYPES` entry — and **no RPC namespace**.                                                                                                                                                     | `libs/shared/src/lib/types/rpc/rpc-activity.types.ts` (whole file), `libs/shared/src/lib/types/messages/message-constants.ts:227` (`ACTIVITY_EVENT: 'activity:event'`), emitter `thoth-runtime/src/lib/activity-emitter.ts:62-94`                                                                                                                                                                                                                       | `DegradationEvent` copies this shape exactly and therefore incurs **no** RPC dual-registration obligation (`rpc-handler.ts:44-70` `ALLOWED_METHOD_PREFIXES` is untouched).                                                                                                                                                                                 |
| **The activity channel explicitly forbids reusing itself for failures.** "Why there is no `'error'` level … the ticker would become the _de facto_ error surface by accident"; and "No subsystem that ALREADY broadcasts may emit here too."                                                                                                                                                 | `rpc-activity.types.ts:12-21`; `activity-emitter.ts:26-28`                                                                                                                                                                                                                                                                                                                                                                                              | Degradation gets its own message type. Routing it through `activity:event` is explicitly ruled out by the code it would reuse.                                                                                                                                                                                                                             |
| **`Logger` is a concrete class, not an interface**, injected everywhere as `TOKENS.LOGGER`.                                                                                                                                                                                                                                                                                                  | `libs/backend/vscode-core/src/logging/logger.ts:47` (`export class Logger`), methods `:117/128/139/150`                                                                                                                                                                                                                                                                                                                                                 | A "logger wrapper" emission seam would mean subclassing or monkey-patching the one class every backend lib depends on, and would fire on `warn` calls that are not degradations. Rejected — see Architecture decision.                                                                                                                                     |
| **`wire-runtime.ts:324` swallows the startup boot outright**, while the sibling folder-change path at `:290-295` logs the same failure.                                                                                                                                                                                                                                                      | `apps/ptah-electron/src/activation/wire-runtime.ts:324` (`void booter.startOrJoin(startupWorkspaceRoot).catch(() => undefined);`) vs `:290-295`                                                                                                                                                                                                                                                                                                         | Named defect, fixed outright by this task. The two paths are the same call with two different error contracts — the divergence is the proof.                                                                                                                                                                                                               |
| **The bundle-gate template already exists and already `describe.skip`s on a missing artifact.**                                                                                                                                                                                                                                                                                              | `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts:83-133`, skip at `:108`                                                                                                                                                                                                                                                                                                                                                                  | Generalizing it means widening `HOSTS` into a derived list of every ESM target across both hosts, and adding the executable self-test the template lacks.                                                                                                                                                                                                  |
| **The three build-artifact skips are the entire "green-by-skip" population.**                                                                                                                                                                                                                                                                                                                | `apps/ptah-cli/src/smoke.spec.ts:25-27` (`describeIfBuilt`), `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts:108`, `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts:63-66`                                                                                                                                                                                                                                           | Three sites, not a class. A fourth pattern (`bootstrap-regression.e2e.spec.ts:33`, `process.env['CI'] ? describe.skip : describe`) is a _deliberate_ CI exclusion of network turns, documented in the file header at `:28-32`. Leave it alone.                                                                                                             |
| `measure-boot-rpcs.mjs` deletes its DB copy on exit and has no PID-scoped cleanup.                                                                                                                                                                                                                                                                                                           | `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs:71-87` (`prepareDb`), `:241-242` (`fs.rm` of both temp dirs), `:237` (`app.close()`)                                                                                                                                                                                                                                                                                                              | 380 item 11 is a prerequisite for Track B's and Track C's re-measurements, not a nice-to-have — both need to read state back after a run.                                                                                                                                                                                                                  |
| Nx will not accept `esbuildConfig` and `esbuildOptions` on the same target.                                                                                                                                                                                                                                                                                                                  | `TASK_2026_380/test-report.md` "F-1 fix" (cites `normalize.js:40`)                                                                                                                                                                                                                                                                                                                                                                                      | The gate cannot demand one idiom. It must accept either, which it already does.                                                                                                                                                                                                                                                                            |
| `nx test projA projB` silently runs zero tests and exits 0.                                                                                                                                                                                                                                                                                                                                  | root `CLAUDE.md` "Development Commands" (measured 2026-08-25)                                                                                                                                                                                                                                                                                                                                                                                           | Every multi-project verification command in this plan is `nx run-many -t test -p …`, and the executor must read back the `Running target test for N projects` header.                                                                                                                                                                                      |

## Architecture decision

- **Chosen approach**: three tracks with a hard ordering. **Track A builds two
  observation instruments — a degradation event contract and a generalized,
  _executing_ bundle gate — plus a standalone audit tool that produces a ratcheted
  inventory. Tracks B and C then prove themselves through those instruments.**

  Concretely:
  1. **The sentinel-catch audit is a `tools/*` Nx project, not an ESLint rule.**
  2. **`DegradationEvent` is a push-only wire contract in `libs/shared`**, copying
     `rpc-activity.types.ts` exactly, emitted through **one explicit reporter port
     in `vscode-core`** — never a logger wrapper, never `activity:event`.
  3. **The bundle gate asserts a conditional invariant and executes each bundle**,
     because two of the three unbannered targets provably do not need a banner.
  4. **Track B routes backup + validation through the existing integrity worker as
     a second protocol command**, and drops the `db` parameter from
     `IBackupService.backup`.
  5. **Track C is gated on a cold re-measurement**, and its designed remedies are
     three structural deletions/reuses plus two caches — not a stagger.

- **Rationale**:

  **(1) Why a tool, not a lint rule.** Three independent facts converge. First,
  `no-restricted-syntax` cannot carry a second severity: flat config replaces the
  rule's whole option array per file match, and `eslint.config.mjs:8-12` already
  documents that a narrowing config "would otherwise silently drop these two
  selectors". A warn-level `CatchClause` block for `**/*.ts` would delete the
  error-level message-literal guards at `:297`. Second, no CI job runs ESLint
  (`ci.yml` is 120 lines and has no lint step), and the pre-commit hook passes
  `--max-warnings=-1`, so a `warn` severity is enforcement theatre. Third, the
  repository already solved this exact problem once: `tools/di-lint` is an Nx
  `type:tool` project with a `lint` target over `libs/**` + `apps/**` and a
  `self-test` target that plants a fixture violation and asserts exit 1 — both
  wired into CI at `ci.yml:107-111`. Track A's audit is that shape, with a
  **ratcheted count** as the gate. The ratchet idiom is also already in the repo:
  CI's coverage step relies on per-project `coverageThreshold` stanzas "ratcheted
  to the current baseline" (`ci.yml:112-117`). A count that goes up fails; a count
  that goes down is free and the baseline is re-recorded.

  **(2) Why an explicit reporter, not a logger wrapper.** `Logger` is a concrete
  class (`logger.ts:47`) that every backend lib injects as `TOKENS.LOGGER`. A
  wrapper would have to subclass or patch it, would fire on every `warn` call
  including the many that are not degradations, and would give the event no stable
  code — the whole point of the contract is a **stable `code`**, which only the
  call site knows. So the seam is an injected reporter with one method, and a kept
  degrade site calls both: `logger.warn(...)` for the human-readable line and
  `reporter.report({ code, ... })` for the counted, structured event. Two calls at
  a site is the honest cost of a stable code, and it is exactly what
  `SqliteIntegrityService.record()` already does implicitly by logging at three
  different levels for three different verdicts (`integrity-check.service.ts:342-385`).

  **(3) Why a conditional bundle invariant.** Measured against the real artifacts:
  `embedder-worker.mjs` and `voice-worker.mjs` contain zero `Dynamic require of`
  shims and zero `createRequire`. Their sources contain no `require`, `__dirname`
  or `__filename`. Demanding a banner there would be a rule with no failure mode
  it prevents, and it would be deleted the first time someone asks why. The
  invariant that _does_ have teeth is the one F-1 violated: **a shim must never be
  reachable before a real `require` is defined** — plus, decisively, _the bundle
  must actually load_. `integrity-worker-bundle.spec.ts` asserts the first half by
  string index (`:120-131`); it never runs the file. The 380 tester proved the
  bundle by hand (`node --input-type=module -e "import(...)"`, test-report "Rebuild
  and bundle verification"). That manual step becomes the gate.

  **(4) Why the integrity worker gets a second command rather than a sibling
  worker.** A sibling worker costs, per host: one new esbuild target, one entry in
  `build.dependsOn`, one in `build-dev.commands`, one in `serve:watch.commands`
  (the app's own CLAUDE.md warns "a new worker target has to be added in all three
  places or the dev build silently ships without it") — six new wiring points
  across two hosts, plus a second host factory pair, a second DI token pair, and a
  second bundle-gate row. It buys isolation the code does not need: the factory
  already forks a **fresh process per `spawn()`** (`electron-integrity-worker-factory.ts:56-61`)
  with no `init` handshake (`worker-process.port.ts:27-34`), so a backup run and an
  integrity run never share a process even today. The inbound message is already a
  discriminated union narrowed on `type` (`integrity-worker-protocol.ts:82-93`),
  and both commands need the identical external (`better-sqlite3`), the identical
  banner, the identical read-only open and the identical three-valued verdict
  vocabulary. Item 16 of 380's follow-ups — folding backup validation into the
  integrity verdict — stops being a second-order consolidation and becomes a
  side-effect of the move.

  **(5) Why Track C's remedies are structural, not a stagger.** The 380 report
  called for "stagger or defer", but that was written before anyone read the
  handlers. Three of the five slow calls are _not slow work that needs
  rescheduling_ — they are work that should not run at boot at all
  (`autocomplete:agents` preloads a dropdown nobody opened;
  `config:models-list` fires from a constructor and again from `createTab`;
  `session:list` has two callers where one loader would do), and a fourth
  (`git:info`) spawns through `crossSpawn` on a path where `IProcessSpawner` /
  `OffThreadProcessSpawner` already exists and is already proven to take a
  1850–1975 ms Windows spawn down to a 29 ms host-loop delay. A stagger would move
  the jank later without removing it; these remove it. Only the fifth
  (`auth:getAuthStatus`) genuinely needs a cache, and it needs a **cross-boot**
  one, because all three of its existing caches are process-local.

- **Rejected alternatives**:
  - _`no-restricted-syntax` with a `CatchClause` selector at `warn`._ Deletes the
    error-level message-literal selectors for every `**/*.ts` file
    (`eslint.config.mjs:8-12`, `:297`), and enforces nothing because no CI job runs
    ESLint. Rejected on both counts independently.
  - _`@typescript-eslint/no-floating-promises` repo-wide._ Requires standing up
    type-aware parsing that does not exist anywhere today (zero `projectService` /
    `parserOptions` occurrences), across ~2681 `.ts` files, to produce warnings no
    job reads. **Narrowed**, not dropped: a type-aware block scoped to
    `apps/ptah-electron/src/**`, `libs/backend/thoth-runtime/src/**` and
    `libs/backend/persistence-sqlite/src/**` — the boot-critical surface where an
    un-awaited promise is a boot defect, and where `wire-runtime.ts:324` already
    produced one. If even that parse cost proves unacceptable in the pre-commit
    hook, the fallback is an AST selector in the audit tool instead; the executor
    measures before choosing.
  - _A logger wrapper as the emission seam._ See rationale (2). Also rejected:
    _both_ wrapper and explicit emitter — two seams for one contract is how the
    count becomes unreliable.
  - _Routing degradation through `activity:event`._ Explicitly forbidden by the
    contract's own header (`rpc-activity.types.ts:12-21`) and by the emitter's rule
    against double-emission (`activity-emitter.ts:26-28`).
  - _A new `degradation:` RPC namespace._ Would require the dual registration
    (`libs/shared/.../rpc.types.ts` + `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES`).
    Unnecessary: this is a push, and `activity:event` proves a push needs neither.
  - _A sibling backup worker._ See rationale (4).
  - _Renaming the integrity worker/port/token/target to a neutral `db-worker`
    name._ Naming accuracy is real — the port will spawn a process that does two
    jobs. But "replace, do not accumulate" targets two implementations living side
    by side, and this leaves exactly one. Against it: the rename touches
    `tokens.ts`, `register.ts`, `worker-process.port.ts`, `integrity-check.service.ts`,
    two host factories, the barrel, the bundle spec, **and the esbuild target name
    in three wiring places per host** — on an unmerged branch that must rebase onto
    `main`. The build-target rename is precisely the hazard the app's CLAUDE.md
    warns about. **Resolution: no rename in this task.** Record it as naming debt
    with an explicit trigger — _rename when a third command lands_ — in
    `future-enhancements.md`.
  - _Keeping an in-process backup fallback for hosts with no worker factory._ That
    is two implementations of one job, which is exactly what the repo rule forbids,
    and it would keep the 27 s main-thread path alive as the silent fallback the
    whole task exists to eliminate. Instead: no factory → no backup, `null` return,
    a **loud** degradation event. Justified because every host that registers
    `SQLITE_CONNECTION` also builds and registers the worker
    (`build-integrity-worker` exists in both `ptah-electron` and `ptah-cli`
    `project.json`), and VS Code registers no SQLite connection at all
    (`worker-process.port.ts:13-18`).
  - _Staggering the five boot RPCs behind `bootScanDelayMs`-style timers
    (`skill-trigger.service.ts:813-841`)._ Moves jank rather than removing it, and
    the arm-not-run pattern is right for a background scan, not for calls a
    rendered surface is waiting on. Kept in reserve for whichever handlers survive
    the structural fixes.

- **Assumptions**:
  - **A-1: `db.backup(dest)` succeeds on a connection opened with
    `{ readonly: true }`.** `better-sqlite3`'s JS layer has no readonly guard
    (`backup.js:8-33` validates only filename/options), and SQLite's Online Backup
    API reads the source, but the C++ binding is unverified for this case.
    _Check that resolves it_: in the worker, open a copy of a real database
    read-only and call `backup()` to a temp path; assert the destination passes
    `quick_check`. If it throws, the worker opens **read-write** instead — WAL still
    permits a second writer-capable connection, and the worker never issues a write
    statement. This check is the first thing Batch B1 runs; a failure changes one
    flag, not the architecture.
  - **A-2: the daily cron's `PRAGMA optimize` is not itself a multi-second
    main-thread cost on a 1 GB database.** It stays on the host by necessity (it
    writes). _Check_: time it in isolation during Track B's re-measurement, on the
    same 1 GB copy. If it is seconds, it is a named follow-up — it cannot be moved
    to the read-only worker and needs its own decision.
  - **A-3: the ~268 production sentinel-catch sites are dominated by legitimate
    optional-capability probes**, so the ratchet baseline is a large number that
    mostly never moves. _Check_: the first `tools/degradation-audit:lint` run
    emits the triage table; Batch A4 classifies the top-10 libs' rows and reports
    the legitimate/defect/test-only split. If defects exceed ~15% the burn-down
    plan needs re-scoping and the team-leader is told before more libs are opened.
  - **A-4: the measured 2244/2296/2291/2476/4095 ms costs reproduce on a cold
    re-measurement.** They were measured once, in one 380 run. _Check_: Batch C0.
    This is a hard gate — see Ordering.

- **Effect on existing code**:
  - **Replaced**: `SqliteBackupService`'s in-process copy-and-validate body — the
    worker path replaces it; no in-process fallback survives.
    `IBackupService.backup(db, kind)` → `backup(kind)`, at all four call sites.
    `wire-runtime.ts:324`'s swallow → the logging form its sibling at `:290-295`
    already uses.
  - **Extended, not rewritten**: `integrity-worker-protocol.ts` (union widened),
    `integrity-worker.ts` (second branch in the existing dispatch),
    `integrity-worker-bundle.spec.ts` (generalized in place — it does not become a
    second spec beside the old one).
  - **Deleted**: the eager `preloadAgents()` call in `agent-selector.component.ts:158-167`;
    the constructor `refreshModels()` in `model-state.service.ts:150-151`. Deleted,
    not flagged off.
  - **Left alone**: the ~75 `nativeAvailable ? describe : describe.skip` guards;
    `bootstrap-regression.e2e.spec.ts:33`'s CI exclusion; `db:reset`'s
    close-and-rename sequence (only its backup call changes shape); the two write
    pragmas in the daily cron handler; every `no-restricted-syntax` selector.

---

## Component specifications

### 1. `DegradationEvent` wire contract

- **Purpose**: one shape for "a capability degraded to a default", carrying a
  stable code that a count can be keyed on.
- **Responsibilities**: the payload interface; the closed `DegradationSource`
  union; the `DegradationSeverity` union; the runtime narrowing guard; the
  `MESSAGE_TYPES` entry. Nothing else — no emitter, no transport, no counting.
- **Verified contracts and entry points**:
  - Shape copied from `libs/shared/src/lib/types/rpc/rpc-activity.types.ts` —
    payload interface (`:76-86`), `ACTIVITY_SOURCE_VALUES` closed array
    (`:44-55`), `isActivityEventPayload` guard (`:118-131`).
  - Message-type registration: `libs/shared/src/lib/types/messages/message-constants.ts:227`
    (`ACTIVITY_EVENT: 'activity:event'`) is the sibling entry; `payload-map.ts`
    must gain the new type (shared CLAUDE.md rule 5: "Message protocol is
    append-only … requires extending `payload-map.ts`").
  - Barrel: `libs/shared/src/index.ts` re-exports each `types/rpc/*` module
    explicitly (`:50-56` block); add one line there.
- **Dependencies**: none. `libs/shared` imports no other `@ptah-extension/*` lib
  (shared CLAUDE.md, "Internal: none"). Direction: everything depends on it.
- **Integration points**: emitted by component 2; consumed by component 3 (the
  boot summary) and by the e2e assertion in component 5. Frontend consumption is
  **out of scope** — no ticker row, no panel. The contract exists so the count is
  machine-readable; a surface for it is a later product decision.
- **Failure behaviour**: none — pure types plus a guard. The guard returns `false`
  rather than throwing, matching `isActivityEventPayload`.
- **Quality requirements**: `code` must be a stable string literal per site, never
  interpolated from an error message (an interpolated code makes the count
  meaningless). Enforce that in review, and pin it with a spec asserting every
  emitted code in the repo is a literal.
- **Verification seam**: a unit spec over the guard, mirroring
  `rpc-activity.types.ts`'s own coverage — malformed payloads rejected,
  empty-string fields admitted or rejected per the documented rule.
- **Files**: CREATE
  `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts`; CREATE
  `libs/shared/src/lib/types/rpc/rpc-degradation.types.spec.ts`; MODIFY
  `libs/shared/src/index.ts`,
  `libs/shared/src/lib/types/messages/message-constants.ts`,
  `libs/shared/src/lib/types/messages/payload-map.ts`.

### 2. `DegradationReporter` (the emission seam)

- **Purpose**: the one way a kept degrade site says "I degraded", and the one
  place the per-code counts live.
- **Responsibilities**: accept a report; increment an in-memory count keyed by
  `code`; broadcast the push (best-effort); expose `snapshot()` for the boot
  summary. It does **not** decide severity, does not format sentences, and does
  not log — the call site keeps its existing `logger.warn`.
- **Verified contracts and entry points**:
  - Lives in `libs/backend/vscode-core`, beside `Logger`
    (`libs/backend/vscode-core/src/logging/logger.ts:47`), because every backend
    lib already injects `TOKENS.LOGGER` from there — so the new token adds no new
    dependency edge anywhere.
  - Broadcast mechanics copied verbatim from
    `libs/backend/thoth-runtime/src/lib/activity-emitter.ts:62-94`: resolve
    `TOKENS.WEBVIEW_MANAGER` **lazily, per emit, behind `isRegistered`** (`:68`),
    `void …broadcastMessage(...).catch(...)` (`:79-86`), whole body in a
    swallowing try (`:87-92`).
  - Token registered in `libs/backend/vscode-core`'s existing `TOKENS` registry
    (same file as `TOKENS.LOGGER` / `TOKENS.WEBVIEW_MANAGER`), `Symbol.for(...)`
    per the repo naming rule.
- **Dependencies**: `@ptah-extension/shared` (the contract), tsyringe. Direction is
  shared → vscode-core → every backend lib, which is the existing direction.
- **Integration points**: injected at each kept degrade site converted in Track A
  Batch A5 and at the sites Tracks B and C create. Registered once in
  `vscode-core`'s `register*` entry.
- **Failure behaviour**: **never throws.** A resolve failure, a missing webview
  manager, a rejected broadcast — all swallowed, exactly as `createActivityEmitter`
  does. A reporter that could throw would turn every degrade site into a crash
  site, which is strictly worse than the silence this task is fixing.
- **Quality requirements**: the count map must be bounded — cap distinct codes
  (a code is a literal, so an unbounded map means a bug) and drop with one
  `logger.error` past the cap.
- **Verification seam**: unit spec with a stub container: no webview manager
  registered → still counts, still does not throw; broadcast rejects → still
  counts; `snapshot()` returns per-code counts.
- **Files**: CREATE
  `libs/backend/vscode-core/src/logging/degradation-reporter.ts` and its
  `.spec.ts`; MODIFY the `TOKENS` file, the lib's `register` module, and
  `libs/backend/vscode-core/src/index.ts`.

### 3. Boot degradation summary line

- **Purpose**: make the count visible once per boot, at a level a human reads.
- **Responsibilities**: at the Electron boot's terminal phase, read
  `reporter.snapshot()` and emit exactly one line — `info` when the count is zero,
  `warn` otherwise, naming the top codes and their counts.
- **Verified contracts and entry points**: the boot phase vocabulary is
  `starting → database → harness → sessions → index → settled`, owned by
  `BootCoordinator`, with `settled` set by the coordinator itself (per
  `apps/ptah-electron/CLAUDE.md`, "Boot phase vocabulary"). The summary hangs off
  that transition. **Assumption**: the exact hook is `BootCoordinator`'s own
  `settled` transition in `apps/ptah-electron/src/activation/boot-coordinator.ts`;
  the executor confirms the method name before wiring and cites it in the batch
  report.
- **Dependencies**: the reporter (component 2). One direction, app → lib.
- **Integration points**: the Electron host only. The CLI gets the same line from
  `cli-engine` **only if** a boot terminal already exists there; if it does not, do
  not invent one — record it instead.
- **Failure behaviour**: wrapped so a summary failure cannot affect the boot's
  terminal transition.
- **Quality requirements**: one line, not one line per code. A boot with 40
  degradations must not produce 40 lines — that reproduces the invisibility.
- **Verification seam**: the e2e assertion in component 5 is the real proof; a unit
  spec pins the zero-count and non-zero-count wording.
- **Files**: MODIFY `apps/ptah-electron/src/activation/boot-coordinator.ts` (or the
  confirmed terminal site), plus its spec.

### 4. `tools/degradation-audit` — the inventory and its ratchet

- **Purpose**: produce the classification inventory, and fail CI when the
  unclassified count grows.
- **Responsibilities**: walk `libs/**/src/**/*.ts` and `apps/**/src/**/*.ts`
  (excluding `*.spec.ts`, `*.test.ts`, `dist`, `node_modules`, and **`apps/\*-e2e/**`and`libs/frontend/webview-e2e-harness/\*\*` — 165 of the 225 promise-swallows live
  there and they are harness code); detect the two patterns; emit a triage table;
  compare the count to a checked-in baseline; exit non-zero when it grows.
- **Patterns detected** (AST, not regex — a regex under-counts nested-block
  catches, which is exactly why the sweep's 508 and the re-measured ~300 disagree):
  1. A `CatchClause` whose body contains no `throw`, no call to a `.error(...)`
     member, and reaches a `ReturnStatement` with a literal argument
     (`null`/`false`/`true`/`undefined`/`[]`/`{}`/a string literal).
  2. A `.catch(...)` whose argument is an arrow function returning one of the
     same literals, or with an empty body.
  3. A `CatchClause` with an empty body (the `no-empty` overlap; ~9 sites, kept
     for completeness at near-zero cost).
- **Suppression**: a site is excluded from the count by an inline marker on the
  line above, carrying a reason — `// degradation-audit: optional-capability — <why>`
  or `// degradation-audit: reported — <CODE>`. A bare suppression with no reason
  is itself a violation. This is what converts "the inventory" into "the triage
  table": classification is a code change, reviewable in a diff, not a spreadsheet
  that rots.
- **Verified contracts and entry points**: modelled on `tools/di-lint` —
  `project.json` with `tags: ["type:tool"]`, a cached `lint` target
  (`nx:run-commands` → `npx ts-node --transpile-only …`) whose `inputs` list the
  script plus `{workspaceRoot}/libs/**/src/**/*.ts` and
  `{workspaceRoot}/apps/**/src/**/*.ts`, and a `self-test` target running
  `node tools/degradation-audit/run-self-test.js`. `tools/di-lint/run-self-test.js:1-27`
  is the exact self-test shape: spawn the linter with `--self-test` against a
  planted fixture, **pass only on exit 1**.
- **Baseline / ratchet**: a checked-in `baseline.json` mapping each library or app
  directory to its current unsuppressed count. The tool fails when any directory
  exceeds its baseline; a directory that drops below is rewritten by
  `--update-baseline` and the drop is committed. Per-directory, not global, so one
  lib's burn-down cannot silently fund another lib's regression. Same discipline as
  CI's per-project `coverageThreshold` ratchet (`ci.yml:112-117`).
- **Dependencies**: `ts-node` + the TypeScript compiler API (already a workspace
  dependency; `typescript` is an esbuild external in every host). No `@ptah-*`
  imports — `type:util`/`type:tool` isolation.
- **Integration points**: two CI steps beside di-lint's two.
- **Failure behaviour**: a parse failure on one file is reported and counted as a
  tool failure (exit non-zero), never skipped. A tool that silently skips files it
  cannot parse is the same defect class it is auditing.
- **Quality requirements**: must complete inside the CI job's remaining budget
  (di-lint's comparable walk is already a CI step, so the order of magnitude is
  known-acceptable). Must be deterministic — sort output by path.
- **Verification seam**: the `self-test` target itself; plus a unit-level fixture
  set asserting each pattern is detected and each suppression form is honoured.
- **Files**: CREATE `tools/degradation-audit/project.json`,
  `tools/degradation-audit/check-degradation.ts`,
  `tools/degradation-audit/run-self-test.js`,
  `tools/degradation-audit/baseline.json`,
  `tools/degradation-audit/__fixtures__/*.ts`; MODIFY `.github/workflows/ci.yml`.

### 5. Generalized ESM bundle gate

- **Purpose**: prove every ESM bundle both _would_ load and _does_ load, in both
  hosts, from a single spec.
- **Responsibilities**: derive the target list from `project.json` rather than
  hard-coding it; assert the conditional require invariant; execute each built
  bundle with a self-test argument and assert it fails only on its own entry
  guard; assert each worker target is wired into all three build chains.
- **Assertions**, in order of strength:
  1. **Discovery**: for each of `apps/ptah-electron`, `apps/ptah-cli`,
     `apps/ptah-extension-vscode`, `apps/ptah-tui`, enumerate every target whose
     `options.format` equals `['esm']`. Anti-vacuity: the discovered set must be
     non-empty and must contain the nine known targets, so a renamed target fails
     loudly instead of shrinking the suite to zero.
  2. **Conditional require invariant** (replaces the unconditional banner check):
     when the built bundle exists, if it contains `Dynamic require of` then it must
     contain `createRequire(import.meta.url)` at a **lower index**. This is
     `integrity-worker-bundle.spec.ts:120-131` generalized, and it correctly says
     nothing about `embedder-worker.mjs` / `voice-worker.mjs`, which emit no shim.
  3. **Executable self-test** — the assertion F-1 needed and no spec has:
     `spawn` the built bundle under `node --input-type=module` (or `import()` it in
     a child), and assert the process fails **only** with the module's own entry
     guard, never with a module-resolution or dynamic-require error. The integrity
     worker's guard string is verbatim `'integrity-worker.ts must be run as a
worker (no Electron parentPort and no worker_threads parentPort)'`
     (`integrity-worker.ts:96-98`) — the 380 tester used exactly this signal by
     hand. **Assumption**: `embedder-worker.ts` and `voice-worker.ts` have
     equivalent entry guards; if one instead hangs or exits 0 when run bare, that
     worker gets a `--self-test` argument added to its entry so the gate has
     something deterministic to assert. The executor confirms per worker and
     reports which needed the argument.
  4. **Wiring**: for each worker target in `apps/ptah-electron/project.json`,
     assert its name appears in `build.dependsOn`, in `build-dev.options.commands`
     and in `serve:watch.options.commands` — the three places the app's CLAUDE.md
     says a worker must be listed.
  5. **Presence in CI**: assertions 2-4 must not be `describe.skip`ped away — see
     component 6.
- **Verified contracts and entry points**: the template is
  `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` (whole file);
  `describe.each(HOSTS)` at `:83`, dual-idiom banner acceptance at `:94-106`,
  index-ordering assertion at `:120-131`, artifact skip at `:108`. It lives in
  `src/config/` beside `packaged-deps.spec.ts` "because that is where this app
  already asserts against its own `project.json` build wiring" (`:31-32`).
- **Dependencies**: `fs`, `path`, `child_process`. No product imports.
- **Integration points**: runs under `apps/ptah-electron`'s Jest project, therefore
  inside `nx affected -t test` in CI. It asserts about `apps/ptah-cli` too, which
  the existing spec already does — a deliberate, documented cross-app read.
- **Failure behaviour**: a missing `project.json` target is a failure, not a skip.
  A missing **bundle** is handled by component 6.
- **Quality requirements**: spawning up to 5 bundles must stay inside the Jest
  timeout; give each spawn its own bounded timeout and kill by PID.
- **Verification seam**: mutation check, as the 380 tester ran — delete a banner
  from `project.json`, confirm exactly one spec fails, restore. Repeat for the
  executable assertion by pointing one host at a deliberately broken bundle
  fixture.
- **Files**: REWRITE
  `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` → rename to
  `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` (the file's subject is no
  longer one worker; the old name would be the accumulation).

### 6. Build-artifact skip policy

- **Purpose**: stop a suite reporting green when it ran nothing, **without**
  breaking the ~75 native-module guards that are deliberate.
- **Responsibilities**: define one shared helper that decides whether a
  build-artifact-dependent suite may skip; apply it at the three sites; make the
  CI path un-skippable.
- **Rule**: skip is permitted **only** when `process.env['PTAH_ALLOW_SKIP_UNBUILT']`
  is set. In CI it is not set, so a missing `dist` makes the suite **fail** with a
  message naming the build command. Locally a developer opts in once. This inverts
  today's default, which is "skip silently, report green".
- **In scope — exactly three sites**:
  - `apps/ptah-cli/src/smoke.spec.ts:25-27` (`describeIfBuilt`)
  - `apps/ptah-electron/src/config/…` bundle gate `:108` (folded into component 5)
  - `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts:63-66`
    — **partially**: its guard is `integrationsEnabled && existsSync(DIST_BIN) &&
STUB_CLAUDE_AVAILABLE`. Only the `existsSync(DIST_BIN)` conjunct changes; the
    other two are env/tooling gates and stay.
- **Explicitly out of scope**: the ~75 `nativeAvailable ? describe : describe.skip`
  guards across `persistence-sqlite`, `skill-synthesis`, `memory-curator`,
  `messaging-gateway`, `task-specs` and `rpc-handlers`; the four
  `process.platform === 'win32'` guards; the six env-flag guards; and
  `bootstrap-regression.e2e.spec.ts:33`, whose CI exclusion is documented in its
  own header at `:28-32`. **CI must still build the dists it now requires** — if
  `nx affected -t test` can reach `apps/ptah-cli`'s tests without having built
  `dist/apps/ptah-cli/main.mjs`, this change turns a false green into a false red.
  The batch that lands this **must** verify the CI dependency chain first and, if
  the dist is not guaranteed, add the build to the job rather than weaken the rule.
- **Verified contracts and entry points**: `smoke.spec.ts:12-27` documents the
  current intent ("SKIPPED automatically … so the dev-loop test runs stay fast") —
  that intent is preserved by the env var, not discarded.
- **Failure behaviour**: the failure message must name the exact command
  (`nx build ptah-cli`) and the env var. A gate whose message does not tell you how
  to satisfy it gets disabled.
- **Verification seam**: run the suite with the dist removed and no env var →
  fails; with the env var → skips; with the dist present → runs.
- **Files**: CREATE a small shared test helper (an existing `src/support`-style
  location in each app, not a new shared lib — two apps do not justify one);
  MODIFY `apps/ptah-cli/src/smoke.spec.ts`,
  `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts`;
  MODIFY `.github/workflows/ci.yml` only if the dist chain proves absent.

### 7. Named degradation fixes (Track A's own defects)

- **Purpose**: fix the sites this task commits to fixing outright, rather than only
  recording them.
- **In scope**:
  - **`apps/ptah-electron/src/activation/wire-runtime.ts:324`** — replace
    `.catch(() => undefined)` with the logging form its own sibling already uses at
    `:290-295` (`console.error('[Ptah Electron] Failed to boot heavy services lazily:', err)`),
    plus a `reporter.report({ code: 'electron.boot.startOrJoin-failed', … })`. The
    two calls are the same method with two different error contracts; that
    divergence is the evidence this is a defect and not a choice.
  - **The three unbannered ESM targets** — `ptah-cli:build-embedder-worker`,
    `ptah-electron:build-embedder-worker`, `ptah-electron:build-voice-worker`.
    Because both bundles provably emit no shim today, the fix is **the gate
    (component 5), not a banner**. Adding a banner to a bundle with no `require` is
    a rule with no failure mode; the gate is what makes the next `require` fail
    loudly at build time instead of silently at runtime. If, at implementation
    time, either bundle _does_ emit a shim (rebuild and re-measure — the counts in
    this plan are from one build), then that target gets the inline banner
    idiom verbatim from `apps/ptah-cli/project.json`'s `build-integrity-worker`.
  - **`libs/backend/persistence-sqlite/src/lib/backup.service.ts:249,268`** — the
    two `'unavailable'` returns around the native load. Track B replaces this whole
    method, so these are fixed _by_ Track B, not separately. Recorded here so no
    batch fixes them twice.
  - **`libs/backend/platform-cli/src/settings/cli-master-key-provider.ts:139`
    (`await import('keytar').catch(() => null)`)** — classify and, if kept, add a
    reported code. This is the archetypal legitimate optional capability; it is
    named in `context.md` and is a good first triage-table row.
- **Verification seam**: for `wire-runtime.ts:324`, a unit spec forcing
  `startOrJoin` to reject and asserting both the log and the report; the existing
  `wire-runtime.boot-order.spec.ts` family is the host.
- **Files**: MODIFY `apps/ptah-electron/src/activation/wire-runtime.ts`,
  `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts`, plus specs.

---

### 8. Worker protocol widening (Track B)

- **Purpose**: teach the existing worker to take a backup as a second command.
- **Responsibilities**: the request/response types for `type: 'backup'`; the
  narrowing guard; the dispatch branch in the worker; the verdict vocabulary reuse.
- **Verified contracts and entry points**:
  - Widen `IntegrityWorkerInbound` (`integrity-worker-protocol.ts:32`) from an alias
    to a union: `IntegrityCheckRequest | BackupRequest`.
  - `BackupRequest`: `{ id: number; type: 'backup'; dbPath: string; destPath: string }`.
    The **destination path is computed on the host**, not in the worker —
    `destPath` derivation depends on `dirFor`/`prefixFor`/`compactIso`
    (`backup.service.ts:134-160`) and on `KEEP_BY_KIND` (`:81-85`), and the worker
    must stay a leaf that imports only its protocol module
    (`integrity-worker-protocol.ts:8-11`: "the ONLY thing `integrity-worker.ts`
    imports from the monorepo").
  - `BackupResponse`: `{ id; ok: true; verdict: IntegrityVerdict; bytesWritten;
durationMs; quickCheck; detail }`. **Reuses `IntegrityVerdict`**
    (`:39`) — `'ok'` the copy landed and validated, `'corrupt'` the copy's
    `quick_check` answered non-`ok`, `'unavailable'` the question could not be
    asked. That vocabulary and its "never record an unasked question" rule are
    documented at `:13-21` and are exactly `backup.service.ts:43-53`'s existing
    `BackupIntegrity` type — which this **replaces**, rather than keeping two
    three-valued verdict types in one lib.
  - Guard `isBackupRequest`, shaped like `isIntegrityCheckRequest` (`:82-93`).
  - Dispatch: `integrity-worker.ts:193-201`'s `subscribe(...)` gains a second
    branch. The unrecognised-payload drop (`:194-198`) is unchanged.
  - The worker's `openReadOnly` (`:120-125`) is reused for the backup source, with
    the `{ readonly: true }` flag subject to **assumption A-1**.
  - Post-copy validation runs **in the worker**, reusing `classifyQuickCheck`
    (`:76-79`) on the destination file — this is 380 follow-up item 16, absorbed.
- **Dependencies**: none new. `better-sqlite3` stays the single external.
- **Integration points**: `SqliteBackupService` (component 9) is the only sender.
- **Failure behaviour**: identical to the check command — every escape lands on
  `'unavailable'` with a `detail`, never `'corrupt'`
  (`integrity-worker.ts:34-39`). The worker additionally **unlinks a partial
  destination before returning**, preserving `backup.service.ts:9-15`'s invariant
  ("A failed backup leaves NO artifact behind") — which is what makes rotation
  safe (`:312-329`). Moving the copy without moving that cleanup would let a
  partial file take the newest rotation slot and evict a good backup.
- **Quality requirements**: `destPath` must be validated in the worker as an
  absolute path under the same directory tree as `dbPath` — the worker takes it
  from IPC, which is an external boundary (repo rule: Zod at external boundaries;
  the existing guards here are hand-written narrowings, so match the local style
  and note the divergence rather than introducing Zod into the one file that must
  bundle in isolation).
- **Verification seam**: `integrity-worker-protocol.spec.ts` extends to the new
  guard and verdict mapping (pure, already unit-tested as such). The **executing**
  proof is component 5's self-test plus the live re-measurement in Batch B3.
- **Files**: MODIFY
  `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts`,
  `…/integrity/integrity-worker.ts`,
  `…/integrity/integrity-worker-protocol.spec.ts`,
  `libs/backend/persistence-sqlite/src/index.ts` (export the new types beside the
  existing protocol exports).

### 9. `SqliteBackupService` — worker-driven

- **Purpose**: same public job (backup + rotate, never throw, never leave an
  unvalidated artifact) with the copy and the validation off the main thread.
- **Responsibilities**: compute the destination path; drive one worker run; map the
  verdict; discard on `'corrupt'`; report degradation on `'unavailable'`; rotate.
- **Verified contracts and entry points**:
  - **Interface change**: `backup(db: SqliteDatabase, kind: BackupKind)` →
    `backup(kind: BackupKind)` (`backup.service.ts:87-104`). The `db` parameter
    existed only for `await db.backup(dest)` at `:191`; the path is already
    injected at `:109`.
  - Injects `PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY`
    `{ isOptional: true }` — the same optional-injection shape
    `SqliteIntegrityService` uses (`integrity-check.service.ts:97-100`).
  - `rotate(kind, keep)` (`:330-369`) and `KEEP_BY_KIND` (`:81-85`) unchanged.
  - The worker run loop — spawn, single settle on reply/exit/budget/abort, kill on
    every path — is `SqliteIntegrityService.runWorker` (`:222-312`). **Do not
    duplicate it.** Extract it into a small collaborator both services inject
    (facade rule: `SqliteIntegrityService` keeps its name, token and public surface
    of exactly `isDue` / `dispatchIfDue` / `dispose`, documented at `:15-18`; the
    run loop becomes an injected collaborator). The collaborator is nameable —
    `DbWorkerRunner` — passing the repo's anti-`helpers`/`utils` test.
  - `checkIntegrity` (`:231-284`), `loadBetterSqlite3ValidationFactory` (`:64-70`),
    `setValidationFactory` (`:129-131`) and the `validationFactory` field
    (`:125-126`) are **DELETED** — the worker validates now. Deleting
    `setValidationFactory` removes a test seam; the specs that use it move to
    stubbing the worker factory instead, which is a truer seam.
- **Dependencies**: `vscode-core` (Logger, reporter), the local worker port, the
  db path. No new lib edges.
- **Integration points**: four callers, all updated —
  `migration-runner.ts:91`, `thoth-runtime/start-thoth-cron.ts:372`,
  `cli-engine/bootstrap/thoth-runtime.ts:432`,
  `rpc-handlers/persistence-rpc.handlers.ts:433`.
- **Failure behaviour**:
  - **No worker factory** → return `null`, emit a degradation event at the highest
    severity the contract carries, log at `warn`. **Does not block migration** —
    `migration-runner.ts:88-101` already treats a `null` backup as non-fatal and
    only calls `rotate` when a path came back (`:98-100`). That behaviour is
    preserved exactly.
  - **`'unavailable'`** → `null` + degradation event; artifact discarded if one
    exists.
  - **`'corrupt'`** → `null` + `logger.warn` + discard, matching `:196-203`.
  - **Never throws**, matching the documented contract at `:88-95`.
  - **`db:reset`**: the backup completes _before_ the connection is closed and the
    file renamed (`persistence-rpc.handlers.ts:385-433` is a 5-step ordered flow).
    Awaiting the worker preserves that ordering; it must not be made
    fire-and-forget. Call this out in the batch — it is the one caller where
    "never block" would be wrong.
- **Quality requirements**: the worker budget for a backup must be **larger** than
  `INTEGRITY_WORKER_BUDGET_MS` (5 min, `integrity-check.service.ts:71`) or at
  minimum justified against it — a 1 GB copy plus validation is strictly more work
  than a `quick_check`. A budget set too tight silently means "backups stopped",
  which is the exact failure shape `:66-70` warns about.
- **Verification seam**: `backup.service.spec.ts` (≈20 construction sites) rewrites
  against a stub worker factory. The load-bearing new cases: no factory → `null` +
  one report; `'unavailable'` → `null`, artifact absent; `'corrupt'` → `null`,
  artifact deleted; `'ok'` → path returned, rotation callable.
- **Files**: REWRITE
  `libs/backend/persistence-sqlite/src/lib/backup.service.ts`; REWRITE
  `libs/backend/persistence-sqlite/src/lib/backup.service.spec.ts`; CREATE
  `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` + spec;
  MODIFY `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`
  (inject the runner), `…/integrity/integrity-check.service.spec.ts`,
  `libs/backend/persistence-sqlite/src/lib/di/register.ts`,
  `libs/backend/persistence-sqlite/src/index.ts`.

### 10. Backup call-site updates

- **Purpose**: apply the one-parameter signature and keep each site's own contract.
- **Responsibilities**: nothing beyond the call change — no site gains logic.
- **Verified contracts and entry points**:
  - `migration-runner.ts:88-101` — `await this.backupService.backup('pre-migration')`.
    The surrounding try/catch, the `backupDest !== null` guard and the
    `rotate('pre-migration', 3)` call are unchanged. This is where "the main
    process awaits a worker rather than blocking the event loop" happens, and it
    needs no structural edit because `applyAll` is already `async` and already
    `await`s here.
  - `thoth-runtime/start-thoth-cron.ts:359-425` — `backup('daily')`. The
    `refs.sqliteConnection` null-guard at `:365-368` now guards only the two write
    pragmas (`:387`, `:397`), which still need the live handle. The
    `withActivityEmit` wrapper (`:361`) and the `@ptah/daily-backup` job at
    `:415-422` are unchanged.
  - `cli-engine/bootstrap/thoth-runtime.ts:429-446` — the CLI twin, same shape.
  - `rpc-handlers/persistence-rpc.handlers.ts:433` — `backup('reset')`, awaited,
    ordering preserved.
- **Failure behaviour**: unchanged at every site. Each already treats `null` as
  non-fatal.
- **Verification seam**: `start-thoth-cron.spec.ts:123-159` and `:749` already
  assert `backup` was called with specific arguments — those expectations change
  shape and are the regression proof.
- **Files**: MODIFY `libs/backend/persistence-sqlite/src/lib/migration-runner.ts`,
  `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`,
  `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`,
  `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts`, and the
  specs for each.

### 11. `measure-boot-rpcs.mjs` hardening (380 item 11)

- **Purpose**: make the probe re-runnable and safe, because Tracks B and C both
  need to read state back after a run.
- **Responsibilities**: `--keep-db` skips the temp-dir deletion; process cleanup
  tracks the spawned PID.
- **Verified contracts and entry points**: `prepareDb()` at `:71-87` creates the
  temp dir; `:241-242` deletes both temp dirs unconditionally; `app.close()` at
  `:237`. The 380 tester had to drive the app by hand to read back
  `db_integrity_check_state` because of exactly this (test-report, "A-1 live
  proof").
- **Failure behaviour**: `--keep-db` prints the retained path so it is not
  orphaned silently.
- **Quality requirements**: any kill must be PID-scoped. `taskkill /F /IM
electron.exe` matches every Electron app on the machine and once killed the
  developer's own running Ptah (380 item 11).
- **Verification seam**: run with and without the flag; confirm the copy survives
  or is removed.
- **Files**: MODIFY `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs`.

---

### 12. Track C — cold re-measurement (the gate)

- **Purpose**: re-establish the five numbers before any remedy is written.
  TASK_2026_380's own rule: "Any fix should re-run `measure-boot-rpcs.mjs` cold …
  before adding any new deferral, rather than guessing at the fix."
- **Responsibilities**: produce a table of, per handler, arrival ms, duration ms,
  and the event-loop lag spikes across the window — against the **same** method the
  380 report used, so the numbers are comparable.
- **Method** (from `TASK_2026_380/test-report.md` "Environment and safety" and
  "Execution", reproduced so it is not re-derived):
  - Build: `npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`.
    Run `npx nx reset` first — the Nx daemon serves a stale `project.json` even
    with `--skip-nx-cache` (380 item 15).
  - Copy the real 1 GB database plus its `-wal` and `-shm` siblings to a temp path
    with `Copy-Item`; **never open the real file**. Pass it via `--db=` /
    `PTAH_DB_PATH`.
  - Cold cache: `RAMMap -Es` if an elevated session is available; otherwise the
    32 GB scratch write+read fallback, and **say which was used** — the 380 report
    flags the fallback's lower fidelity and specifically warns that a measurement
    depending on full-file I/O needs a real cold cache.
  - `NODE_ENV=production` suppresses the console transport (`logger.ts:95`), so
    `[event-loop] lag` lines never reach the probe's stdout. Poll the app's own
    `logs/Ptah Electron-*.log` and copy it out **before** the probe's cleanup — or
    use `--keep-db` from component 11.
- **Failure behaviour**: if the numbers do not reproduce within ~30%, **the design
  below does not ship as written**. The batch returns the measured table and the
  remedies are re-selected against it. This is the gate, not a formality.
- **Verification seam**: the recorded table itself, committed to the task folder.
- **Files**: none (produces `test-report.md` content).

### 13. Track C — `autocomplete:agents` (4095 ms): delete the eager preload

- **Purpose**: remove the single largest number in the jank window.
- **Verified contracts and entry points**: `AgentSelectorComponent.ngOnInit` calls
  `preloadAgents()` at
  `libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts:158-167`;
  `toggleDropdown` at `:188` already calls the same path. Backend cost is a cold
  full scan — `fs.readdir` (`agent-discovery.service.ts:360`) plus one `fs.readFile`
  per agent `.md` (`:412`) — behind a process-local, TTL-less, LRU-8 `Map` (`:106`)
  that no restart survives.
- **Remedy**: delete the `ngOnInit` preload. The dropdown loads on open, which is
  the path that already exists and is already guarded by `_isCached` / `_isLoading`
  (`agent-discovery.facade.ts:50-55`) and a `_generation` stale guard (`:44`, `:72`).
- **Failure behaviour / risk**: the first dropdown open becomes slower. Mitigate by
  arming the preload on **first user interaction with the composer** rather than on
  mount, if the measured open-latency is unacceptable — decide from the
  measurement, not in advance.
- **Verification seam**: the re-measurement shows no `autocomplete:agents` in the
  boot window; an existing `agent-selector` spec asserts the dropdown still
  populates on open.
- **Files**: MODIFY `agent-selector.component.ts` + spec.

### 14. Track C — `config:models-list` (2296 ms): drop the constructor fetch

- **Verified contracts and entry points**: `ModelStateService` fires
  `refreshModels()` from its **constructor** at
  `libs/frontend/core/src/lib/services/model-state.service.ts:150-151`; the RPC is
  at `:287`; `TabManagerService.createTab` fires the same at
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:782` on every tab
  including the boot tab; in-flight coalescing exists keyed on
  `WorkspaceScopeService.scopeKey()` (`:264-282`). Backend cost is two awaits:
  an SDK CLI subprocess (`sdk-model-service.ts:576`, already routed through
  `OffThreadProcessSpawner`) **and** a `fetch` to `https://api.anthropic.com/v1/models`
  (`sdk-model-service.ts:781`, 5 s abort at `:784`).
- **Remedy**: delete the constructor call — `createTab` already covers the boot
  path, and the coalescer means the two were one RPC anyway, just fired earlier
  than needed. Then persist the SDK catalog across boots: the existing
  `modelsCache` is keyed by an auth fingerprint with a `cacheGeneration` guard
  (`:230`, `:246`, `:359-370`) and **no TTL**, so the cross-boot store is a
  faithful extension — persist it in `IStateStorage` under the same fingerprint
  key, and let `clearCache()` / `invalidateForAuthChange()` (`:341`, and the
  `/v1/models` drop) clear the persisted copy too.
- **Failure behaviour**: a stale persisted catalog must never outlive an auth
  change; the fingerprint key is what guarantees that, and the persisted entry must
  carry the fingerprint, not just the payload.
- **Files**: MODIFY `model-state.service.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`, + specs.

### 15. Track C — `git:info` (2476 ms): route through `IProcessSpawner`

- **Verified contracts and entry points**: `computeGitInfo`
  (`libs/backend/vscode-core/src/services/git-info.service.ts:341-352`) runs
  `isGitRepo` plus `execGit(['status','--porcelain=v2','--branch'])`; `execGit`
  (`:2283`) delegates to `libs/backend/vscode-core/src/utils/exec-git.ts:219`,
  whose spawn is `crossSpawn(gitCommand(), args, …)` at `:148`. `getGitInfo` is
  **deliberately excluded from the settled read cache** (rationale at `:253-257`);
  only in-flight coalescing applies (`:307`, `:336`).
- **Remedy**: inject `IProcessSpawner` (from `@ptah-extension/platform-core`,
  which `vscode-core` may depend on) into the `exec-git` call path, optionally, and
  spawn through it when present. The Electron host binds the off-thread
  implementation; a host that binds nothing keeps today's inline `crossSpawn`. This
  is the primitive TASK_2026_341 built for exactly this measurement
  (`off-thread-process-spawner.ts:1-24`: inline spawn froze the main process ~1.6 s
  per launch; off-thread the host loop max delay stayed at 29 ms).
- **Assumption**: `IProcessSpawner`'s `spawnProcess` surface
  (`off-thread-process-spawner.ts:47-52` describes it as needing stderr, pid,
  `detached` and Windows `.cmd` resolution) covers `exec-git`'s needs — it captures
  stdout, needs an exit code and a timeout. _Check_: read
  `platform-core`'s `ProcessSpawnRequest` / `SpawnedProcessHandle` before writing
  the adapter; if a field is missing, the port is extended, not bypassed.
- **Do not** add a settled cache for `getGitInfo` — its exclusion is documented and
  deliberate. The remedy is where the spawn runs, not whether it runs.
- **Files**: MODIFY `libs/backend/vscode-core/src/utils/exec-git.ts`,
  `libs/backend/vscode-core/src/services/git-info.service.ts`, the Electron DI
  registration, + specs.

### 16. Track C — `auth:getAuthStatus` (2244 ms): persist the CLI health memo

- **Verified contracts and entry points**: cost source is a `crossSpawn` of
  `claude --version` (`claude-cli-detector.ts:24`, spawn helper `:524`, call `:536`)
  reached via `performHealthCheck` (`:250`, `findExecutable` + `probeVersion` at
  `:325`), driven from `probeClaudeCli` (`auth-rpc.handlers.ts:655`,
  `startClaudeCliProbe` `:679-690`). Three caches exist and all are process-local:
  handler TTL 15 s (`:77`), CLI health memo 5 min (`:90`), detector version probe
  30 s (`claude-cli-detector.ts:76`, settled+in-flight sharing at `:330`, successes
  only at `:341`). Probes are capped at 5 s by `withProbeTimeout` (`:569`), and an
  expired memo is already reused as the timeout fallback (`:668`) — the precedent
  for trusting a stale memo.
- **Remedy**: persist the **detector-level** verdict across boots in
  `IStateStorage`, keyed by `(resolved executable path, mtimeMs, size)`. A CLI
  upgrade changes at least one of those, so invalidation is exact and needs no TTL
  guess. `clearCache()` drops the persisted entry alongside the in-memory one.
- **Failure behaviour**: a persisted entry whose key no longer matches is ignored,
  not repaired. A stat failure means "no persisted entry", i.e. today's behaviour.
- **Files**: MODIFY `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`
  (+ its DI registration for `IStateStorage`), + specs.

### 17. Track C — `session:list` (2291 ms × 2): one loader, coalesced

- **Verified contracts and entry points**: handler
  `session-rpc.handlers.ts:294`; costs are `fs.readdir` over
  `~/.claude/projects` at `:1288` (via `listTranscriptIds` `:1280`) and a state-blob
  read at `session-metadata-store.ts:526`. Two boot callers:
  `chat-lifecycle.service.ts:55` and
  `libs/frontend/dashboard/src/…/session-analytics-state.service.ts:225`. Only
  mitigation is a 300 ms trailing debounce at `session-loader.service.ts:176-192`,
  which does not span the two callers.
- **Remedy**: give `SessionLoaderService` a shared in-flight promise (the same
  `_loadPromise` single-flight shape `AuthStateService` already uses at
  `auth-state.service.ts:575-591`) and have the dashboard's analytics state consume
  the loader instead of issuing its own RPC. Two frontend edits; no backend change.
- **Note**: 380 follow-up item 8 (`SessionLoaderService` resume failure is
  log-only, `session-loader.service.ts:837-843`) touches this same file. It is
  **out of scope here** — flagged so the batch does not absorb it by accident, and
  so a reviewer does not mistake its absence for an oversight.
- **Files**: MODIFY `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`,
  `libs/frontend/dashboard/src/…/session-analytics-state.service.ts`, + specs.

---

## Integration architecture

- **Data flow — degradation (Track A)**:
  degrade site → `logger.warn(...)` (human line, unchanged) **and**
  `DegradationReporter.report({ code, source, severity, detail })` → in-memory
  count keyed by `code` → best-effort `webviewManager.broadcastMessage(
MESSAGE_TYPES.DEGRADATION_EVENT, payload)` → _(no frontend consumer in this
  task)_. Separately, at the Electron boot's terminal phase:
  `reporter.snapshot()` → one summary log line.

- **Data flow — backup (Track B)**:
  caller → `SqliteBackupService.backup(kind)` → compute `destPath` from `dbPath` +
  `kind` (host-side, `dirFor`/`prefixFor`/`compactIso`) → `DbWorkerRunner` →
  `IIntegrityWorkerProcessFactory.spawn()` → `postMessage({ id, type: 'backup',
dbPath, destPath })` → **worker process**: open source, `db.backup(destPath)`,
  reopen destination, `quick_check`, classify, unlink on failure → reply
  `{ verdict, bytesWritten, durationMs, quickCheck, detail }` → host maps verdict →
  `'ok'` returns the path (caller may `rotate`), `'corrupt'` discards and returns
  `null`, `'unavailable'` reports degradation and returns `null` → the two write
  pragmas (`incremental_vacuum(100)`, `optimize`) run on the host's live
  connection, as today.

- **Data flow — boot RPC (Track C)**: unchanged in shape. What changes is that two
  calls are no longer issued at boot (components 13, 14), one spawns on a worker
  thread instead of the main thread (15), one reads a persisted verdict instead of
  spawning (16), and one is issued once instead of twice (17).

- **State or persistence**:
  - Degradation counts: **in-memory, per boot**. Deliberately not persisted — the
    question is "did this boot degrade", and a persisted counter would need its own
    retention and reset policy for no measured benefit. 380 follow-up item 5
    (escalate N consecutive `unavailable` integrity verdicts) is the one case that
    genuinely needs persistence, and it already has a home: the single-row
    `db_integrity_check_state` table from migration `0042`
    (`integrity-check-state.store.ts`). Implement item 5 there, as a counter column
    or a derived read, **not** in the reporter.
  - Backup artifacts: unchanged on disk — same directories (`dirFor`, `:134-140`),
    same prefixes (`:143-149`), same `KEEP_BY_KIND` retention (`:81-85`). The
    invariant that only validated files exist under those prefixes is preserved by
    moving the unlink into the worker (component 8).
  - Track C caches: `IStateStorage`, keyed so invalidation is exact (auth
    fingerprint for models; executable path+mtime+size for CLI health). No TTL
    guesses.
  - Audit baseline: `tools/degradation-audit/baseline.json`, checked in.

- **External boundaries**:
  - Worker IPC is an external boundary in both directions. Inbound is narrowed by
    `isIntegrityCheckRequest` / the new `isBackupRequest`; outbound is narrowed by
    `SqliteIntegrityService.asResponse` (`:318-333`), whose rule — "an unrecognised
    shape is `null`, inconclusive, rather than a fabricated verdict" — extends to
    the backup response unchanged.
  - `destPath` arrives over IPC and is used to write a file. Validate it in the
    worker as absolute and under the database's own directory tree.
  - The persisted Track C caches are read back from `IStateStorage` and must be
    shape-validated on read; a corrupt entry is ignored, not repaired.
  - No new HTTP surface, no new RPC method, no change to
    `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44-70`).

- **Failure and rollback**:
  - Backup worker unavailable → **no backup, migration proceeds**. This is a real
    reduction in the safety net that migrations `0016`, `0017`, `0018` and `0039`
    each name as "the canonical recovery path". It is accepted only because it is
    (a) loud, via a top-severity degradation event and a `warn` log, and (b) gated
    by component 5, which fails the build when the bundle cannot load. Both halves
    are required; neither alone is sufficient.
  - Backup `'corrupt'` → artifact deleted, `null` returned, rotation not called for
    that run. Identical to today (`backup.service.ts:196-203`).
  - Worker exceeds budget or the host quits → killed, no artifact retained, no
    record written. Same four-path settle as `runWorker` (`:222-312`).
  - Track C: each remedy is independently revertible — deleting a call, adding a
    persisted cache, and injecting a spawner are three unrelated diffs. None
    depends on another landing.
  - Audit ratchet regression → CI fails with the directory and the delta. The
    escape hatch is a suppression comment **with a reason**, which is a reviewable
    diff, not a config flag.

- **Observability**: this is the task's subject. Three evidence paths where there
  were none: the per-code degradation count and its one boot summary line; the
  ratcheted audit inventory in CI; and a bundle gate that _executes_ the artifact
  rather than reading it as a string. Finding F-1 would have been caught by the
  third in the build that introduced it, and by the first on its first run.

## Architecture-level quality requirements

- **Functional**:
  - Track A: every ESM bundle in both hosts loads without a module-resolution
    error, proven by execution; the audit produces a per-directory inventory and
    fails on growth; a healthy Electron boot emits zero degradation events, proven
    end-to-end; the three build-artifact skips fail rather than pass when the dist
    is absent and the opt-out env var is unset; `wire-runtime.ts:324` logs and
    reports.
  - Track B: the pre-migration and daily backups produce byte-identical artifacts
    to today, in the same directories, under the same retention; a failed or
    unavailable backup never blocks a migration; a partial artifact never survives.
  - Track C: no `autocomplete:agents` and no constructor-fired `config:models-list`
    in the boot window; exactly one `session:list`; `git:info` spawns off the main
    thread; `auth:getAuthStatus` reuses a persisted verdict on the second boot.
- **Performance**:
  - Track B: on the first boot that applies a pending migration against a copy of
    a real ~1 GB database, **no main-thread event-loop lag spike above 500 ms
    attributable to the backup**, measured by `measure-boot-rpcs.mjs` with
    `--keep-db`. The one-time migration-apply cost itself (27.3 s, lag to 3.2 s in
    the 380 report) is **not** in scope — that is `applyOne` executing SQL, not the
    backup.
  - Track C: **main-thread lag spikes under 500 ms across the full 15 s window
    after the first answered RPC**, measured by the same script and the same
    log-capture method as `TASK_2026_380/test-report.md` criterion 2. That table is
    the before; the new table is the after; both go in `test-report.md`.
  - Track A: the audit tool must not make the CI job or the pre-commit hook
    noticeably slower than di-lint already does. Measure and record.
- **Security**: `destPath` validated as absolute and in-tree before the worker
  writes. The POSIX `chmod` lockdown on backup files and their directory (0600 /
  0700, `backup.service.ts:186-193`, the F-M2 fix) **must survive the move** — it
  now happens in the worker, and losing it would silently reopen a
  local-information-disclosure hole. Pin it with a POSIX-guarded spec case.
- **Maintainability**:
  - `libs/shared` imports no `@ptah-extension/*` lib. `persistence-sqlite` imports
    nothing from the monorepo. `integrity-worker.ts` imports only its protocol
    module. Frontend never imports backend. All four hold after this task.
  - `SqliteIntegrityService`'s public surface stays exactly `isDue` /
    `dispatchIfDue` / `dispose` (`integrity-check.service.ts:15-18`) — the run-loop
    extraction is a facade-rule split, not an API change.
  - One three-valued verdict type in `persistence-sqlite`, not two:
    `BackupIntegrity` (`backup.service.ts:53`) is deleted in favour of
    `IntegrityVerdict`.
  - No new esbuild target, so no new three-place wiring obligation.
  - No `no-restricted-syntax` selector is added, removed or re-scoped.
  - `catch (error: unknown)` narrowed with `instanceof Error`; tokens as
    `Symbol.for(...)` in the lib's `tokens.ts` with registration in `register.ts`;
    files under the 700-line soft ceiling, and where a split is needed the facade
    rule applies with a nameable collaborator.
- **Testability**:
  - Behaviour that must be covered, expressed as behaviour: a built ESM bundle
    loads as a process; a backup runs to completion in a worker and its artifact
    validates; a backup that cannot run returns `null`, reports, and does not block
    a migration; a partial artifact is removed before the call returns; a degrade
    site increments exactly one count; a boot with no degradations logs the
    zero-count line; a suite whose dist is missing fails in CI; the audit's ratchet
    fails on a planted new violation and its self-test fails when the detector is
    broken.
  - Mutation checks, not just green ticks — the 380 tester's discipline (delete the
    banner, confirm exactly one spec fails, restore). Apply it to the bundle gate,
    the ratchet and the skip policy.
  - Multi-project runs use `nx run-many -t test -p …` and the executor reads back
    the `Running target test for N projects` header.

## Team-leader handoff

- **Recommended executors**:
  - Components 1, 2, 8, 9, 10, 16 (`libs/shared` contract, the reporter, worker
    protocol, backup service, call sites, the CLI-health persistence) —
    **backend-developer**: DI registration, port boundaries and hexagonal direction
    are the whole difficulty.
  - Components 4, 5, 6, 11 and the CI edits (`tools/degradation-audit`, the bundle
    gate, the skip policy, the probe script) — **devops-engineer**: these are build
    targets, `project.json`, workflow files and a measurement script.
  - Components 13, 14 (frontend half), 17 (`agent-selector`, `ModelStateService`,
    `SessionLoaderService`, dashboard analytics) — **frontend-developer**: Angular
    lifecycle, signals and injection sites.
  - Components 3, 7, 15 (boot summary, `wire-runtime.ts`, `exec-git`) —
    **backend-developer**, but with the Electron host's boot rules in hand
    (`apps/ptah-electron/CLAUDE.md`).
  - Component 12 (the cold re-measurement) — **senior-tester**. It is a
    measurement, not an implementation, and it gates everything downstream of it.
  - Component 4's classification pass (the ~268-row triage table) is the
    **CLI-agent delegation candidate**: file-disjoint, mechanical, and the
    per-lib chunks are independent. Discover agents via `ptah_agent_list`; the task
    prompt records `codex`, `antigravity`, `claude cli`
    (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`) and `ollama cloud` as present on
    2026-09-06. Max 3 concurrent. Give each agent one library, the three
    classification labels, the suppression-comment syntax, and absolute paths. The
    architect/team-leader reconciles; a CLI agent never commits.

- **Complexity**: **HIGH.** Not because any one component is hard — most are small
  — but because the task spans `libs/shared`, four backend libs, three frontend
  libs, two apps, one e2e script, the CI workflow and a new `tools/*` project;
  because it changes a published interface (`IBackupService.backup`) with four
  production call sites and ~22 spec sites; because it touches the pre-migration
  backup, which four migrations name as the canonical recovery path; and because it
  sits on an unmerged branch that must rebase.

- **Dependencies and ordering** (component-level; the team-leader owns batching):
  1. **Component 11** (`--keep-db` + PID kill) has no dependencies and unblocks
     both re-measurements. Do it first — it is XS.
  2. **Components 1 → 2 → 3** in that order (contract, then reporter, then
     summary). Component 7's `wire-runtime` fix needs 2.
  3. **Components 4, 5, 6** are independent of 1-3 and of each other, except that
     6 folds the bundle gate's own skip into 5.
  4. **Track A's 5 (bundle gate) and 2 (reporter) must be green before any Track B
     or Track C work merges.** This is the task's stated sequencing rule and it is
     load-bearing: Track B's "no worker → no backup" failure mode is only
     acceptable _because_ the gate proves the bundle loads, and Track C's remedies
     are only verifiable because the degradation count exists.
  5. **Component 8 → 9 → 10** strictly in order (protocol, then service, then call
     sites). Assumption A-1's check runs at the top of 8's batch; a failure changes
     one flag and the batch continues.
  6. **Component 12 gates 13-17.** No Track C remedy may be written before the
     cold re-measurement lands. If the numbers move, the remedies are re-selected.
  7. **Component 4's classification pass** runs after 4's tool exists and can run
     in parallel with everything in Tracks B and C.

- **Parallel-safe work** (file-disjoint, verified against the file list below):
  - Lane 1: components 1, 2, 3, 7 (`libs/shared`, `vscode-core`, `ptah-electron`
    activation).
  - Lane 2: components 4, 5, 6, 11 (`tools/`, `apps/*/src/config`, `apps/ptah-cli`
    specs, the e2e script, `ci.yml`).
  - Lane 3: components 8, 9, 10 (`persistence-sqlite`, `thoth-runtime`,
    `cli-engine`, `rpc-handlers`) — **after** lanes 1-2 are green.
  - Lane 4: components 13, 17 and 14's frontend half (`chat-ui`, `frontend/core`,
    `frontend/chat`, `frontend/dashboard`) — **after** component 12.
  - **Collisions to avoid**: component 7 and component 3 both touch
    `apps/ptah-electron/src/activation/` — different files, but the same batch is
    safer. Component 9 and component 8 both touch
    `persistence-sqlite/src/index.ts` — sequence them. Component 17 touches
    `session-loader.service.ts`, which 380 follow-up item 8 also targets; item 8 is
    out of scope and must not be picked up opportunistically.

- **Files affected**

  **CREATE**
  - `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts` (+ `.spec.ts`)
  - `libs/backend/vscode-core/src/logging/degradation-reporter.ts` (+ `.spec.ts`)
  - `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` (+ `.spec.ts`)
  - `tools/degradation-audit/project.json`
  - `tools/degradation-audit/check-degradation.ts`
  - `tools/degradation-audit/run-self-test.js`
  - `tools/degradation-audit/baseline.json`
  - `tools/degradation-audit/__fixtures__/` (fixture files)
  - a build-artifact skip helper in each of `apps/ptah-cli` and `apps/ptah-electron`

  **MODIFY**
  - `libs/shared/src/index.ts`
  - `libs/shared/src/lib/types/messages/message-constants.ts`
  - `libs/shared/src/lib/types/messages/payload-map.ts`
  - `libs/backend/vscode-core/src/index.ts`, its `TOKENS` file, its `register` module
  - `libs/backend/vscode-core/src/utils/exec-git.ts`
  - `libs/backend/vscode-core/src/services/git-info.service.ts` (+ specs)
  - `libs/backend/persistence-sqlite/src/index.ts`
  - `libs/backend/persistence-sqlite/src/lib/di/register.ts`
  - `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts` (+ `.spec.ts`)
  - `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
  - `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` (+ `.spec.ts`)
  - `libs/backend/persistence-sqlite/src/lib/migration-runner.ts` (+ `.spec.ts`)
  - `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` (+ `.spec.ts`)
  - `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` (+ specs)
  - `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts` (+ specs)
  - `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts` (+ specs, + DI registration)
  - `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts` (+ specs)
  - `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts`
  - `libs/frontend/core/src/lib/services/model-state.service.ts` (+ spec)
  - `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (+ spec)
  - `libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts` (+ spec)
  - `libs/frontend/dashboard/src/…/session-analytics-state.service.ts` (+ spec)
  - `apps/ptah-electron/src/activation/wire-runtime.ts` (+ spec)
  - `apps/ptah-electron/src/activation/boot-coordinator.ts` (+ spec)
  - `apps/ptah-electron/src/services/…` DI registration for the git spawner
  - `apps/ptah-cli/src/smoke.spec.ts`
  - `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts`
  - `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs`
  - `.github/workflows/ci.yml`
  - `eslint.config.mjs` — **only** to add `no-empty` (`allowEmptyCatch: false`) and
    the narrowly-scoped type-aware `no-floating-promises` block. **No change to any
    `no-restricted-syntax` entry.**
  - per-lib `CLAUDE.md` for `persistence-sqlite`, `thoth-runtime`, `vscode-core`,
    `shared`, and `apps/ptah-electron` where a documented rule changes
  - root `CLAUDE.md` — the `npx nx reset` gotcha (380 item 15), since two batches
    here will hit it

  **REWRITE**
  - `libs/backend/persistence-sqlite/src/lib/backup.service.ts`
  - `libs/backend/persistence-sqlite/src/lib/backup.service.spec.ts`
  - `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` →
    `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`

- **Verification points**
  - **Contracts to honour**: `IBackupService`'s "never throws, no artifact left on
    failure, a returned path passed `quick_check`" (`backup.service.ts:88-104`);
    `SqliteIntegrityService`'s public surface of exactly `isDue` / `dispatchIfDue` /
    `dispose` (`:15-18`); the three-valued verdict rule (`integrity-worker-protocol.ts:13-21`);
    `integrity-worker.ts` imports only its protocol module (`:41-43`); `libs/shared`
    imports no `@ptah-extension/*` lib; the frontend↔backend isolation rule;
    `ALLOWED_METHOD_PREFIXES` unchanged (`rpc-handler.ts:44-70`).
  - **References to confirm before writing code**: the exact `BootCoordinator`
    terminal-transition method (component 3); `platform-core`'s
    `ProcessSpawnRequest` / `SpawnedProcessHandle` fields (component 15); whether
    `embedder-worker.ts` / `voice-worker.ts` have deterministic bare-run behaviour
    (component 5); whether CI's `nx affected -t test` guarantees
    `dist/apps/ptah-cli/main.mjs` exists (component 6). Each is an **Assumption**
    in this plan, not a verified contract, and each batch report must say how it
    resolved.
  - **Data changes**: none to the schema. Migration `0042`'s
    `db_integrity_check_state` table is read and written exactly as today; 380
    follow-up item 5's escalation counter, if picked up, extends it — that is the
    only candidate for a new migration and it is not in this task's scope.
  - **Commands that must pass**:
    ```bash
    npx nx reset
    npx nx run-many -t test -p shared @ptah-extension/vscode-core \
      @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime \
      @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/agent-sdk
    npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat \
      @ptah-extension/chat-ui @ptah-extension/chat-state @ptah-extension/dashboard
    npx nx run-many -t test -p ptah-electron ptah-cli
    npx nx run-many -t lint -p <every project touched>
    npx nx affected -t typecheck
    npx nx run di-lint:self-test && npx nx run di-lint:lint
    npx nx run degradation-audit:self-test && npx nx run degradation-audit:lint
    npx nx build-integrity-worker ptah-electron --skip-nx-cache
    npx nx build-integrity-worker ptah-cli --skip-nx-cache
    npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron
    node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs \
      --ws=D:/projects/ptah-extension --db=<copy of a 1 GB db> --seconds=120 --keep-db
    ```
    Read back the `Running target test for N projects` header on every `run-many`
    and confirm N matches the count asked for — a misspelled project is dropped
    silently. `npx nx reset` first, always: the Nx daemon serves a stale
    `project.json` even with `--skip-nx-cache`, and two batches here edit
    `project.json`.

- **Base branch and rebase**
  - Branch from **`electron-cold-start-380`**, not `main`. Track B depends on the
    integrity worker infrastructure, which exists only there.
  - When PR #463 merges, **rebase onto `main`** — do not merge `main` in. The
    likely conflict surface is small and predictable: `apps/ptah-electron/project.json`,
    `libs/backend/persistence-sqlite/src/lib/di/{tokens,register}.ts`,
    `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` and
    `libs/shared/src/index.ts`. Deliberately keeping the worker/port/token/target
    **names unchanged** (see Rejected alternatives) is what keeps that surface
    small.
  - Never open a PR against a `release/*` branch, and never merge into one.
