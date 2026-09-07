# Batches - TASK_2026_383

Total tasks: 12 batches | Complete: 6/12

**Working tree for ALL executor work**:
`D:/projects/ptah-extension/.claude-worktrees/task-383`, branch
`task/383-degradation-audit`, branched from `electron-cold-start-380`
(PR #463, unmerged). Every batch prompt must state this. The canonical task
folder is `D:/projects/ptah-extension/.ptah/specs/TASK_2026_383` — reports and
measured tables are written there, not into the worktree mirror.

---

## Plan validation

Status: **PASSED WITH RISKS**

Twelve file:line claims were checked against the task-383 worktree. Ten hold
exactly. Two are wrong and one is misleading; all three are recorded below and
the affected batches carry the correction.

### Claims verified correct

| Claim                                                                                                                                                                                                      | Result                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `eslint.config.mjs:297` — `'no-restricted-syntax': ['error', ...MESSAGE_LITERAL_SELECTORS]` for `**/*.ts`                                                                                                  | Exact. The "do not touch this rule" argument stands.                          |
| `.github/workflows/ci.yml` runs no ESLint step; 120 lines; di-lint self-test + lint at `:108-111`; `nx affected -t test --coverage` at `:117-118`; `nx affected -t build` at `:120`                        | Exact. A `warn` severity enforces nothing.                                    |
| `tools/di-lint/project.json` — `tags: ["type:tool"]`, cached `lint` target with `{workspaceRoot}/libs/**/src/**/*.ts` + `apps/**` inputs, `self-test` target running `node tools/di-lint/run-self-test.js` | Exact, verbatim. Component 4 has a real template.                             |
| `integrity-worker-bundle.spec.ts` — `describe.each(HOSTS)` `:83`, dual-idiom banner `:94-106`, `describe.skip` on missing artifact `:108`, index-ordering assertion `:120-131`                             | Exact.                                                                        |
| `integrity-worker-protocol.ts` — `type: 'check'` `:27`, `IntegrityWorkerInbound = IntegrityCheckRequest` `:32` (an alias, widenable), `IntegrityVerdict` `:39`, `isIntegrityCheckRequest` `:82`            | Exact.                                                                        |
| **All four `backup()` call sites** — `migration-runner.ts:91`, `start-thoth-cron.ts:372`, `cli-engine/bootstrap/thoth-runtime.ts:432`, `persistence-rpc.handlers.ts:433`                                   | Exact, and an exhaustive `\.backup\(` sweep found no fifth.                   |
| `backup.service.ts` — `backup(db, kind)` at `:95`, `@inject(SQLITE_DB_PATH) dbPath` at `:109`, `await db.backup(dest)` at `:191`, chmod `0o700`/`0o600` at `:189`/`:193`                                   | Exact. The `db` parameter is genuinely redundant.                             |
| `exec-git.ts:148` — `crossSpawn(gitCommand(), args, {...})`                                                                                                                                                | Exact.                                                                        |
| `chat-lifecycle.service.ts:50-77` — five detached `.catch()`-terminated calls, no `await` between them                                                                                                     | Exact.                                                                        |
| `integrity-check.service.ts` — budget `:71`, `dispatching` `:79`, `isOptional: true` `:98`, `runWorker` `:222`, `asResponse` `:318`                                                                        | Exact.                                                                        |
| `boot-coordinator.ts:370` — `this.phase = 'settled'`                                                                                                                                                       | Exists. Component 3's "assumption" is resolved: the hook is this transition.  |
| `apps/ptah-electron/project.json` `build.dependsOn` `:215-219` — exactly 5 entries                                                                                                                         | Exact.                                                                        |
| `activity:event` in `message-constants.ts:227` **and** `payload-map.ts:318` with its type imported at `:126`                                                                                               | Exact. The new type needs an import line **and** a `MessagePayloadMap` entry. |

### Plan corrections

These override the plan where they disagree. Do not silently deviate further.

- **PC-1 (changes component 14).** `model-state.service.ts:151` calls
  `this.loadModels()`, **not `refreshModels()`**. `refreshModels()` is a public
  wrapper at `:246` that delegates to `loadModels()` at `:264`. Line `:152` is a
  **second** constructor call, `void this.hydratePricing()`, which is **out of
  scope** and must not be deleted. Component 14's remedy is: delete line `151`
  only.
- **PC-2 (changes component 14).** `TabManagerService.createTab:782` calls
  `this.modelRefresh.refreshModels()` — an injected collaborator, not
  `ModelStateService` directly. Before relying on `createTab` as the boot-path
  cover for the deleted constructor call, the executor must confirm
  `modelRefresh` resolves to `ModelStateService` and cite the binding in its
  report. If it does not, deleting `:151` removes the boot fetch outright.
- **PC-3 (changes every verification command).** The plan's command at
  `implementation-plan.md:1193` passes `-p shared`. The project name is
  `@ptah-extension/shared`. A misspelled name is **silently dropped** from
  `run-many`. Every command in this file uses names read from `project.json`.
- **PC-4 (cosmetic, component 7).** The `wire-runtime.ts` swallow is at line
  **325**, not 324: `void booter.startOrJoin(startupWorkspaceRoot).catch(() => undefined);`
- **PC-5 (cosmetic, component 13).** `agent-selector.component.ts`: `ngOnInit` is
  `:157-159`, `preloadAgents` is `:165-174`, `toggleDropdown` is `:180`. The plan
  said `:158-167` / `:188`.
- **PC-6 (reduces component 6's value).**
  `session.headless.integration.spec.ts:62` sets `const STUB_CLAUDE_AVAILABLE = false;`
  — a hardcoded constant. The suite is **unconditionally skipped today**, so
  changing the `existsSync(DIST_BIN)` conjunct has **zero observable effect**.
  Make the edit (it is cheap and correct) but do not report it as a fixed
  green-by-skip. The two sites that actually change behaviour are
  `apps/ptah-cli/src/smoke.spec.ts:27` and the bundle gate's `:108`.
- **PC-7 (adds a site to component 7).** `backup.service.ts:179` carries a
  **third** `'unavailable'` guard — "db.backup() is unavailable on this database
  instance" — beyond the two at `:249`/`:268` the plan names. It exists only
  because the service receives a foreign `db` handle. It disappears with the
  parameter. Recorded so no batch preserves it out of caution.
- **PC-8 (resolves two ellipsis paths).** The plan writes `…` for two files. The
  real paths are
  `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts`
  and `libs/backend/vscode-core/src/di/tokens.ts` /
  `libs/backend/vscode-core/src/di/register.ts`.
- **PC-9 (widens component 11).** `measure-boot-rpcs.mjs` calls `app.close()` at
  **both** `:215` and `:237`, not only `:237`. The `--keep-db` and PID-scoped
  cleanup work must cover both exit paths.

### Risks

| Risk                                                                                                                                                                                                                                                                                                                                                    | Severity | Mitigation                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R-1.** `start-thoth-cron.ts:365-368` returns `{ summary: 'skipped: no sqlite connection' }` **before** the backup. After the signature change the backup no longer needs the connection, so leaving the guard in place silently keeps skipping daily backups on any host with no live connection — the exact invisibility this task exists to remove. | HIGH     | Batch 8, Task 8.2: move the guard below the `backup('daily')` call so it gates only the two write pragmas, or state in the batch report why it must stay. Pin with a spec case: no connection → backup still attempted.                                                                    |
| **R-2.** Assumption A-1 — `db.backup(dest)` on a `{ readonly: true }` connection. Unverified at the C++ binding.                                                                                                                                                                                                                                        | MEDIUM   | Batch 6, Task 6.1 runs the check **first**. Failure flips one flag (open read-write, never issue a write statement); the batch continues.                                                                                                                                                  |
| **R-3.** "No worker factory → no backup" removes the safety net four migrations name as the canonical recovery path.                                                                                                                                                                                                                                    | HIGH     | Accepted only with both halves: a top-severity degradation event (Batch 7) **and** a green bundle gate (Batch 4). Batch 7 may not be marked COMPLETE until Batch 4 is COMPLETE.                                                                                                            |
| **R-4.** Component 6 makes `apps/ptah-cli` tests **fail** when `dist/apps/ptah-cli/main.mjs` is absent. `ci.yml:117-120` runs `nx affected -t test` **before** `nx affected -t build`. On that ordering the dist does not exist when the test runs, and this change converts a false green into a false red for the whole CI job.                       | HIGH     | Batch 4, Task 4.3 verifies the chain **before** landing the flip. If the dist is not guaranteed, add the build to the job (Batch 4 owns `ci.yml` for this) rather than weakening the rule. This risk is confirmed likely, not hypothetical — the ordering is visible in the workflow file. |
| **R-5.** The audit tool's ratchet baseline is generated by the tool itself. A detector bug bakes a wrong baseline into the repo.                                                                                                                                                                                                                        | MEDIUM   | Batch 3's `self-test` target is the guard, modelled on `di-lint/run-self-test.js` — plant a fixture violation, pass **only** on exit 1. Plus a mutation check: break the detector, confirm the self-test fails.                                                                            |
| **R-6.** Assumption A-3 — the ~268 sentinel sites are mostly legitimate. If defects exceed ~15%, the burn-down needs re-scoping.                                                                                                                                                                                                                        | MEDIUM   | Batch 5 reports the legitimate/defect/test-only split per lib and **stops** at the threshold rather than opening more libs.                                                                                                                                                                |
| **R-7.** Assumption A-4 — the five measured costs reproduce cold.                                                                                                                                                                                                                                                                                       | HIGH     | Batch 9 is the gate. Batches 10 and 11 may not be assigned until Batch 9's table is in the task folder. If numbers move >30%, the remedies are re-selected and the team-leader returns to the orchestrator before Batch 10.                                                                |
| **R-8.** Component 5 assumes `embedder-worker.ts` / `voice-worker.ts` have deterministic bare-run behaviour. If one hangs or exits 0, the executable assertion has nothing to assert.                                                                                                                                                                   | LOW      | Batch 4, Task 4.1: confirm per worker; add a `--self-test` entry argument to whichever needs one and report which.                                                                                                                                                                         |
| **R-9.** Component 15 assumes `IProcessSpawner`'s surface covers `exec-git`'s needs (stdout capture, exit code, timeout).                                                                                                                                                                                                                               | LOW      | Batch 11, Task 11.3 reads `platform-core`'s `ProcessSpawnRequest` / `SpawnedProcessHandle` first. A missing field means the port is **extended**, not bypassed.                                                                                                                            |
| **R-10.** Two batches edit `project.json`. The Nx daemon serves stale `project.json` even with `--skip-nx-cache` (380 item 15).                                                                                                                                                                                                                         | LOW      | Every affected batch runs `npx nx reset` first.                                                                                                                                                                                                                                            |
| **R-11.** Component 17 touches `session-loader.service.ts`, which 380 follow-up item 8 also targets. Item 8 is out of scope.                                                                                                                                                                                                                            | LOW      | Named explicitly in Batch 10's prompt as forbidden scope creep, so a reviewer does not read its absence as an oversight.                                                                                                                                                                   |

### Edge cases

- Worker exceeds budget on a 1 GB copy → killed, no artifact, no record. Batch 7.
- Partial destination file after a failed copy → unlinked **in the worker** before
  return, or a partial file takes the newest rotation slot and evicts a good
  backup. Batch 6.
- POSIX `chmod` 0600/0700 lockdown moves into the worker; losing it reopens a
  local-information-disclosure hole. Batch 6/7, pinned by a POSIX-guarded spec.
- `db:reset` must keep awaiting the backup — it is the one caller where "never
  block" would be wrong (5-step ordered flow, `persistence-rpc.handlers.ts:425-440`).
  Batch 8.
- A degradation code interpolated from an error message makes the count
  meaningless. Batch 1 pins codes as string literals with a spec.
- A boot with 40 degradations must produce **one** summary line, not 40. Batch 2.
- Persisted Track C caches must be shape-validated on read; a corrupt entry is
  ignored, not repaired. Batch 11.

### Assumptions carried

- A-1 (readonly backup) — unverified, checked in Batch 6 Task 6.1.
- A-2 (`PRAGMA optimize` cost) — unverified, timed in Batch 9.
- A-3 (sentinel sites mostly legitimate) — unverified, measured in Batch 5.
- A-4 (five boot costs reproduce) — unverified, **gate** in Batch 9.
- Component 3's `BootCoordinator` hook — **now verified**: `boot-coordinator.ts:370`.
- Component 6's CI dist chain — **now suspected false**, see R-4.

---

## Batch 1: Degradation contract and reporter — COMPLETE (`00e5464c0`)

- Components: 1, 2
- Recommended executor: `backend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential (1 → 2)
- Depends on: none
- Parallel with: Batch 3
- Files owned (exclusive):
  - CREATE `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts` + `.spec.ts`
  - MODIFY `libs/shared/src/index.ts`,
    `libs/shared/src/lib/types/messages/message-constants.ts`,
    `libs/shared/src/lib/types/messages/payload-map.ts`
  - CREATE `libs/backend/vscode-core/src/logging/degradation-reporter.ts` + `.spec.ts`
  - MODIFY `libs/backend/vscode-core/src/di/tokens.ts`,
    `libs/backend/vscode-core/src/di/register.ts`,
    `libs/backend/vscode-core/src/index.ts`

### Task 1.1: `DegradationEvent` wire contract — COMPLETE

- Pattern to follow: `libs/shared/src/lib/types/rpc/rpc-activity.types.ts` —
  payload interface `:76-86`, closed source array `:44-55`, guard `:118-131`.
- Register in `message-constants.ts` beside `ACTIVITY_EVENT: 'activity:event'`
  (`:227`), and in `payload-map.ts` **twice**: the type import (beside `:126`)
  and the `MessagePayloadMap` entry (beside `:318`).
- Barrel: one line in `libs/shared/src/index.ts`'s `types/rpc/*` block (`:51-56`).
- No RPC namespace. `ALLOWED_METHOD_PREFIXES` in
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts` is **not** touched.
- `libs/shared` must still import no `@ptah-extension/*` lib.

### Task 1.2: `DegradationReporter` — COMPLETE

- Depends on: Task 1.1
- Broadcast mechanics copied from
  `libs/backend/thoth-runtime/src/lib/activity-emitter.ts:62-94`: resolve
  `TOKENS.WEBVIEW_MANAGER` lazily per emit behind `isRegistered`, `void
...broadcastMessage(...).catch(...)`, whole body in a swallowing try.
- **Never throws.** No webview manager → still counts. Broadcast rejects → still
  counts.
- Count map bounded; past the cap, drop with one `logger.error`.
- Does **not** log and does **not** decide severity — the call site keeps its
  own `logger.warn`.
- Token `Symbol.for(...)` in `di/tokens.ts`, bound in `di/register.ts`.

### Batch 1 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/vscode-core
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/vscode-core
npx nx affected -t typecheck
```

Read back `Running target test for 2 projects` on each `run-many`.

Acceptance: the guard rejects malformed payloads without throwing; the reporter
counts with no webview manager registered and with a rejecting broadcast;
`snapshot()` returns per-code counts; codes are string literals.

Commit: `feat(shared): batch 1 - degradation event contract and reporter`

### Batch 1 verification record — COMPLETE

**Commit `00e5464c0`** on `task/383-degradation-audit`, 11 files, +852/-1.
Staged by explicit path while Batch 3 was live in the same worktree;
`.github/workflows/ci.yml`, `eslint.config.mjs` and `tools/degradation-audit/`
were confirmed unstaged before and after the commit and are untouched by it.

Verification re-run by the team-leader, not taken from the report:

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/vscode-core`
  — first run served from the Nx cache, so it was re-run with
  `--skip-nx-cache` for real execution evidence. Header read back:
  `Running target test for 2 projects`. `shared` 56 suites / 1400 tests,
  `vscode-core` 31 suites / 503 tests, all passing. Matches the report exactly.
- `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/vscode-core`
  — 0 errors. All 11 warnings are pre-existing and in files this batch did not
  touch (`file-system-manager`, `output-manager`, `status-bar-manager`,
  `webview-manager`, `logger`, `git-info.service`). No warning is attributable
  to a Batch 1 file.
- `npx nx affected -t typecheck` was **not** used as the gate. The executor's
  claim that its only failures are 13 `libs/api` projects missing the generated
  Prisma client was verified independently: `libs/api/core/src/lib/generated`
  does not exist in this worktree. The scoped substitute
  `npx nx run-many -t typecheck -p @ptah-extension/shared
@ptah-extension/vscode-core ptah-electron @ptah-extension/cli-engine`
  passed for all 4 projects.
- Files read on disk, not accepted from the report: the contract, the reporter,
  and every modified file's diff. Real implementations throughout — no TODO,
  PLACEHOLDER, STUB, empty body or mock-data marker in the diff. `libs/shared`
  still imports no `@ptah-extension/*` lib (the one textual match is a doc
  comment).

Reviews: `code-style-reviewer` (the gate reviewer for this batch) **APPROVED**,
9/10, 2 minor. `code-logic-reviewer` also run, **APPROVED**, 8/10, 0 blocking,
0 serious, 3 moderate. No finding met the rejection bar.

Findings dispositioned before the commit:

| Finding                                                                                                                      | Disposition                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Style minor 1 — `tokens.ts` comment claimed the token "Lives beside LOGGER" while it is declared after `CPU_PROFILE_CAPTURE` | **Fixed by the team-leader** as a one-line comment reword (trivial, no behaviour): now names the diagnostics grouping and keeps the accurate no-new-dependency-edge rationale. Included in `00e5464c0`.                                                                                 |
| Style minor 2 — reporter imports `TOKENS` by relative path rather than the lib barrel                                        | No action. The reviewer states this is not a violation; relative import is the correct in-lib pattern and matches `register-platform-agnostic.ts`.                                                                                                                                      |
| Logic M-1 — `logging/index.ts` modified but not in "Files owned" and not declared as a deviation                             | Recorded here rather than rejected. It is the necessary intermediate barrel between `degradation-reporter.ts` and `vscode-core/src/index.ts`, which **is** in the owned list, so the export chain cannot land without it. Documentation gap in the report, not drift outside the batch. |
| Logic M-2 — `report()` does no runtime validation of its input                                                               | No action. This is an internal typed seam, not an external boundary; the repo rule is Zod at external boundaries and trust internal types past that. The outbound wire shape _is_ guarded by `isDegradationEventPayload`.                                                               |
| Logic M-3 — a repeated `code` with mismatched `source`/`severity` is overwritten last-wins                                   | No action. Documented design (`DegradationCount.severity` is "the most recent report"). Detecting a reused code is Batch 3's audit tool, which is the stated backstop.                                                                                                                  |
| Logic minor — `reportCapOnce` latches before the log attempt, so a logger registered later never gets the notice             | No action. Working as documented ("at most once per process"); a comment-precision nit on a diagnostic path.                                                                                                                                                                            |

Deviation D-1 (binding in `di/register-platform-agnostic.ts` rather than
`di/register.ts`) is **accepted and load-bearing**. `register.ts` is the VS Code-only
entry and delegates to the platform-agnostic file, so the single binding still
reaches all three hosts; binding in `register.ts` would have hidden the reporter
from the Electron and CLI hosts that Batches 2 and 7 consume it from. Verified
reachable via `apps/ptah-electron/src/di/phase-1-infra.ts` and
`libs/backend/cli-engine/src/lib/container.ts`. Deviation D-2
(`DegradationSnapshot.broadcastFailures`) is accepted as additive.

**Carried forward to Batch 2**: inject `TOKENS.DEGRADATION_REPORTER`;
`snapshot().total === 0` is the `info`-line condition and `entries` is already
sorted count-desc then code-asc. **To Batch 3**: the audit tool must flag a
dynamic `code` expression at every `reporter.report(...)` call site — that is
the only real backstop for the interpolated-code failure mode, which Batch 1
can contain (64-code cap, one latched `logger.error`) but cannot prevent.

---

## Batch 2: Boot summary and the named degradation fixes — COMPLETE (`7319d02cd`)

- Components: 3, 7
- Recommended executor: `backend-developer` (with `apps/ptah-electron/CLAUDE.md` in hand)
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- Depends on: Batch 1
- Parallel with: Batch 4
- Files owned (exclusive):
  - MODIFY `apps/ptah-electron/src/activation/boot-coordinator.ts` + `boot-coordinator.spec.ts`
  - MODIFY `apps/ptah-electron/src/activation/wire-runtime.ts` + `wire-runtime.spec.ts`
  - MODIFY `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts`

### Task 2.1: boot degradation summary line — PENDING

- Hook is **verified**: `boot-coordinator.ts:370` (`this.phase = 'settled'`).
  The plan listed this as an assumption; it is resolved. Cite the method name in
  the report.
- Exactly **one** line per boot: `info` at zero, `warn` otherwise, naming the top
  codes and counts. Not one line per code.
- Wrapped so a summary failure cannot affect the terminal transition.
- CLI: emit the same line from `cli-engine` **only if** a boot terminal already
  exists there. If it does not, record it — do not invent one.

### Task 2.2: `wire-runtime.ts` startup swallow — PENDING

- Depends on: Task 2.1 (same directory, avoid a mid-batch conflict)
- **PC-4**: the site is line **325**, not 324.
- Replace `.catch(() => undefined)` with the logging form its own sibling at
  `:290-295` already uses, **plus**
  `reporter.report({ code: 'electron.boot.startOrJoin-failed', ... })`.
- Spec: force `startOrJoin` to reject; assert both the log and the report. Host
  is the `wire-runtime.boot-order.spec.ts` / `wire-runtime.spec.ts` family.

### Task 2.3: `cli-master-key-provider.ts` keytar probe — PENDING

- `await import('keytar').catch(() => null)` at `:139`, inside `tryLoadKeytar`.
- This is the archetypal **legitimate optional capability**. Classify it as such
  and add a reported code, or suppress it with a reason. Do not delete the
  fallback.

### Batch 2 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p ptah-electron @ptah-extension/platform-cli
npx nx run-many -t lint -p ptah-electron @ptah-extension/platform-cli
npx nx affected -t typecheck
```

Acceptance: a boot with zero degradations logs one `info` line; a forced
`startOrJoin` rejection produces both a log and exactly one report; the keytar
site is classified in the diff.

Commit: `fix(electron): batch 2 - report the swallowed startup boot and summarise degradations`

### Batch 2 verification record — COMPLETE (`7319d02cd`, 5 files, +712/-2)

Reviews both accepted: `code-logic-reviewer` Revision 1 re-review **APPROVED**
9/10 (the serious abort-path gap now has three specs; FM-1, FM-3 and the
workspace-switch moderate all closed as the review itself recommended, by
narrowing the documented guarantee rather than widening scope);
`code-style-reviewer` **APPROVED** 8/10.

All gates re-run by the team-leader with `--skip-nx-cache`, not read off the
report:

- `npx nx run-many -t test -p ptah-electron @ptah-extension/platform-cli` —
  header read back `Running target test for 2 projects`. `platform-cli` 12
  suites, 197 passed + 3 todo. `ptah-electron` 35 of 36 suites, 457 passed + 8
  skipped. Matches `batch-2-report.md` exactly. The 8 skipped and 3 todo are
  pre-existing and individually named in the report: 4 skips are the
  `existsSync(host.bundle)` guard in `integrity-worker-bundle.spec.ts:108`
  (**Batch 4, Task 4.2 owns that policy**), 4 are the `better-sqlite3`
  `nativeAvailable` guard in `wizard-seed.integration.spec.ts:316` (**explicitly
  out of scope for Batch 4**), and the 3 todo are pre-existing
  `[DECISION REQUIRED]` regenerate-vs-throw questions in the keytar spec that
  touch nothing this batch changed.
- `npx nx run-many -t lint -p ptah-electron @ptah-extension/platform-cli` —
  2 projects, **0 errors** (3 + 5 warnings, all pre-existing and outside this
  batch's files).
- `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/platform-cli` —
  2 projects, clean. `nx affected -t typecheck` is again not the gate, for the
  `libs/api` ungenerated-Prisma reason recorded under Batch 1 and re-verified.
- **Degradation-audit cross-check**: a full scan with Batch 3's tool present
  reports zero rows for `cli-master-key-provider.ts`, zero `bare-suppression`
  and zero `orphaned-suppression`. Batch 2's two keytar suppressions are
  recognised in place, which is the orchestrator's ruling holding in practice.

Deviations accepted: **D-1** — the summary fires from the post-window chain's
`.finally()` rather than beside `this.phase = 'settled'` at `:370`. This is
better than the batch text, not a shortfall: the `.then()` runs only on a
successful boot, so a summary hung there would print nothing for a failed boot —
the boot whose degradations a reader most needs — and `.finally()` runs after the
phase, the readiness emit and `markPersistenceSettled`, which makes "a summary
failure cannot affect the terminal transition" true by construction. Both
properties are pinned by named specs, as is the abort path. **D-2** — the
coordinator gained an `armBootSummary` hook rather than resolving the reporter
itself, preserving the file's documented no-runtime-import invariant
(`boot-coordinator.ts:42-44`) and matching the `onReadinessChange` / `armWarmup`
shape it already uses twice. **D-3** — two keytar suppressions rather than one,
because `tryLoadKeytar` swallows twice for one reason. **D-4** — the log suffix
differs from its sibling so two call sites of one method are distinguishable in a
log. All four accepted.

Recorded, not fixed here: `cli-engine` has **no boot terminal**, so no CLI
summary line was invented — the batch instruction's explicit fallback. Giving the
workspace-switch swallow a code, and `notifyCorruption`'s third bare catch, are
both named as out of scope and left for a later triage pass.

**Committed** as `7319d02cd`, second of the two, after Batch 3's `52fe10711`, in
the required order. Staged by explicit path; the pre-commit hook ran clean and
was never bypassed. Working tree afterwards carries nothing but the untracked
`.ptah/specs/TASK_2026_383/` mirror and `npm-ci.log`, neither of which belongs to
any batch.

The post-Batch-3 audit cross-check was re-run against the committed tree and is
the evidence the orchestrator's suppression ruling held end to end:
`apps/ptah-electron: 28 ok (baseline 28)`, `libs/backend/platform-cli: 3 ok
(baseline 3)`, `TOTAL 564`, and zero rows for `wire-runtime.ts`,
`boot-coordinator.ts` or `cli-master-key-provider.ts`, with zero
`orphaned-suppression` and zero `bare-suppression` repo-wide. Batch 2 therefore
adds no unsuppressed degradation sites and no orphaned markers.

---

## Batch 3: `tools/degradation-audit` and its CI wiring — COMPLETE (`52fe10711`)

- Component: 4 (the tool only — the classification pass is Batch 5)
- Recommended executor: `devops-engineer`
- Fallback executor: `backend-developer`
- Execution mode: `sub-agent`, sequential
- Depends on: none
- **Parallel with: Batch 1** (fully file-disjoint)
- Files owned (exclusive):
  - CREATE `tools/degradation-audit/project.json`,
    `check-degradation.ts`, `run-self-test.js`, `baseline.json`,
    `__fixtures__/*.ts`
  - MODIFY `.github/workflows/ci.yml` (this batch owns the file until it commits)
  - MODIFY `eslint.config.mjs` — **only** `no-empty` with `allowEmptyCatch: false`,
    and the narrowly-scoped type-aware `no-floating-promises` block. **No change
    to any `no-restricted-syntax` entry.** Verified: `:297` carries
    `['error', ...MESSAGE_LITERAL_SELECTORS]` for `**/*.ts` and a narrowing
    config would delete it.

### Task 3.1: the audit tool — PENDING

- Copy `tools/di-lint/project.json` verbatim in shape: `tags: ["type:tool"]`,
  cached `lint` target with inputs `{projectRoot}/check-degradation.ts`,
  `{workspaceRoot}/libs/**/src/**/*.ts`, `{workspaceRoot}/apps/**/src/**/*.ts`,
  command `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`,
  plus a `self-test` target running `node tools/degradation-audit/run-self-test.js`.
- **AST detection, not regex** — the 508-vs-300 disagreement is exactly what a
  regex gets wrong on nested-block catches.
- **Exclusions**: `*.spec.ts`, `*.test.ts`, `dist`, `node_modules`,
  `apps/*-e2e/**`, `libs/frontend/webview-e2e-harness/**`. Without the last two
  the inventory is 85% harness noise.
- Suppression syntax:
  `// degradation-audit: optional-capability — <why>` or
  `// degradation-audit: reported — <CODE>`. A bare suppression with no reason is
  itself a violation.
- Per-directory `baseline.json` ratchet. Not global — one lib's burn-down must
  not fund another lib's regression.
- A parse failure is a **tool failure** (non-zero exit), never a skip.
- Deterministic: sort output by path.

### Task 3.2: self-test and CI steps — PENDING

- Depends on: Task 3.1
- `run-self-test.js` follows `tools/di-lint/run-self-test.js:1-27` — spawn the
  linter with `--self-test` against a planted fixture, **pass only on exit 1**.
- Two CI steps beside di-lint's two (`ci.yml:108-111`).
- **Mutation check (R-5)**: break the detector, confirm the self-test fails;
  restore.
- Measure and record the tool's wall time against di-lint's.

### Batch 3 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx reset
npx nx run degradation-audit:self-test
npx nx run degradation-audit:lint
npx nx run di-lint:self-test && npx nx run di-lint:lint
npx nx affected -t lint
```

Acceptance: the self-test exits 0 only because the linter exited 1; the lint
target emits a sorted per-directory table; a planted violation above baseline
fails; `--update-baseline` lowers a dropped count; `di-lint` still passes
(proving `eslint.config.mjs` was not broken).

Commit: `build(tools): batch 3 - ratcheted degradation audit with a self-test`

### Batch 3 verification record — COMPLETE (`52fe10711`, 22 files, +1310)

Committed on the second attempt, after the hook blocker below was fixed. The
rejection and its resolution are kept in full, because the defect was invisible
to both reviews and only appeared when a commit was actually attempted.

**Second pass, after the fix.** `.prettierignore` gained
`tools/degradation-audit/__fixtures__/__parse-failure__/` — the directory, not
the single file — with a comment beside the license-server precedent, and
`prettier --write` ran over the tool (only `check-degradation.ts` changed).
Re-verified by the team-leader: `prettier --check` over
`tools/degradation-audit/**` reports "All matched files use Prettier code
style"; `degradation-audit:self-test` still emits its 12 fixture rows and both
parse-guard checks still pass, so ignoring the fixture for formatting did not
weaken the guard that consumes it; `degradation-audit:lint` still reports
`TOTAL 564` at baseline, so the reformat changed no detector behaviour; and the
`eslint.config.mjs` constraint still holds — the only non-comment changed line
is `no-empty`, with zero diff lines touching `no-restricted-syntax`.

**One deviation, owned by the team-leader, not the executor.** `batches.md`
prescribed `build(tools): …`, but commitlint's `scope-enum` has no `tools`
entry, so that subject is unusable in this repository. Committed as
`build(ci): …` instead — a registered scope that covers both the tool and the
CI gate it adds. Recorded in the commit body. A cleaner long-term fix is to
register `degradation-audit` in the scope enum the way the sibling `di-lint`
already is; that is a one-line config change belonging to Batch 12's
documentation pass, not to this batch.

**Post-commit sanity**: `degradation-audit:lint` `TOTAL 564` and
`di-lint:lint` `1446 @inject sites … (660 tokens)` both green against the
committed tree.

<details>
<summary>The original rejection (kept for the record)</summary>

Reviews both accepted: `code-logic-reviewer` Revision 2 re-review **APPROVED**
8/10 (B-1 and S-3 fixed, 0 blocking, 0 serious, 0 moderate, 1 cosmetic minor);
`code-style-reviewer` **APPROVED** 8/10. Every functional gate re-run by the
team-leader and green:

- `npx nx run degradation-audit:self-test --skip-nx-cache` — 12 fixture
  violations, exit 0 only via the linter's exit 1, both parse-guard checks pass.
  Rows match `batch-3-report.md`'s transcript exactly, including the new
  `orphaned-suppression` kind.
- `npx nx run degradation-audit:lint --skip-nx-cache` — `TOTAL 564`, every
  directory at or under baseline, exit 0.
- `npx nx run di-lint:self-test` and `di-lint:lint` — both green, which is the
  standing proof `eslint.config.mjs` still loads.
- `npx nx affected -t lint --base=origin/main` — 73 projects, exit 0.
- **`eslint.config.mjs` constraint holds.** The only non-comment changed line in
  the whole diff is `'no-empty': ['error', { allowEmptyCatch: false }]`. Zero
  added or removed lines touch `no-restricted-syntax`;
  `MESSAGE_LITERAL_SELECTORS` is untouched context.
- `.github/workflows/ci.yml` adds only the two-step degradation-audit block
  beside di-lint's, same shape.
- Tool source is real: 876-line AST detector, 64-line self-test runner, 14
  fixtures. No TODO/PLACEHOLDER/STUB anywhere in the batch.
- The orchestrator's suppression ruling is confirmed live: a full scan reports
  **zero** rows for `cli-master-key-provider.ts`, zero `bare-suppression` and
  zero `orphaned-suppression` repo-wide.

**Blocking defect: the deliberately-malformed parse-guard fixture broke the
repository's pre-commit hook.**
`tools/degradation-audit/__fixtures__/__parse-failure__/malformed.ts` is
unparseable by design — that is its job — but husky's pre-commit hook runs
`nx format:write` over staged files, Prettier could not parse it, and it exited
non-zero (`SyntaxError: ':' expected. (7:10)`), so the commit was refused. Hooks
were not bypassed and nothing was committed. The repository had already solved
this once: `.prettierignore` carries
`apps/ptah-license-server/prisma/seed/__fixtures__/malformed.json` under a
comment ending "Without this entry the pre-commit hook fails on a fixture that
is doing its job." The fix applied was that precedent, one directory wider.

</details>

Reviews both accepted: `code-logic-reviewer` Revision 2 re-review **APPROVED**
8/10 (B-1 and S-3 fixed, 0 blocking, 0 serious, 0 moderate, 1 cosmetic minor);
`code-style-reviewer` **APPROVED** 8/10. Every functional gate re-run by the
team-leader and green:

- `npx nx run degradation-audit:self-test --skip-nx-cache` — 12 fixture
  violations, exit 0 only via the linter's exit 1, both parse-guard checks pass.
  Rows match `batch-3-report.md`'s transcript exactly, including the new
  `orphaned-suppression` kind.
- `npx nx run degradation-audit:lint --skip-nx-cache` — `TOTAL 564`, every
  directory at or under baseline, exit 0.
- `npx nx run di-lint:self-test` and `di-lint:lint` — both green, which is the
  standing proof `eslint.config.mjs` still loads.
- `npx nx affected -t lint --base=origin/main` — 73 projects, exit 0.
- **`eslint.config.mjs` constraint holds.** The only non-comment changed line in
  the whole diff is `'no-empty': ['error', { allowEmptyCatch: false }]`. Zero
  added or removed lines touch `no-restricted-syntax`;
  `MESSAGE_LITERAL_SELECTORS` is untouched context.
- `.github/workflows/ci.yml` adds only the two-step degradation-audit block
  beside di-lint's, same shape.
- Tool source is real: 876-line AST detector, 64-line self-test runner, 14
  fixtures. No TODO/PLACEHOLDER/STUB anywhere in the batch.
- The orchestrator's suppression ruling is confirmed live: a full scan reports
  **zero** rows for `cli-master-key-provider.ts`, zero `bare-suppression` and
  zero `orphaned-suppression` repo-wide. Batch 2's keytar comments suppress
  cleanly as written.

**Blocking defect, found only at the commit step: the deliberately-malformed
parse-guard fixture breaks the repository's pre-commit hook.**

`tools/degradation-audit/__fixtures__/__parse-failure__/malformed.ts` is
unparseable by design — that is exactly its job, and the parse-guard test that
consumes it is a genuine improvement. But husky's pre-commit hook runs
`nx format:write` over staged files, Prettier cannot parse the file, and it
exits non-zero:

```
[error] tools/degradation-audit/__fixtures__/__parse-failure__/malformed.ts:
        SyntaxError: ':' expected. (7:10)
husky - pre-commit script failed (code 1)
```

The commit was refused. Hooks were not bypassed and nothing was committed; HEAD
is still Batch 1's `00e5464c0` and the working tree is byte-identical to what the
executor left (the aborted `format:write` wrote nothing). This is not a
reviewable code-quality issue, which is why both reviews reasonably missed it —
it only appears when a commit is actually attempted.

The repository has already solved this exact problem once, and the fix is a
one-line precedent match. `.prettierignore` carries:

```
# Deliberately-invalid fixtures. The community seed must abort on a malformed
# export (MG-1.2), and the only honest way to test that is with a file that is
# genuinely unparseable — which is also a file prettier cannot format. Without
# this entry the pre-commit hook fails on a fixture that is doing its job.
apps/ptah-license-server/prisma/seed/__fixtures__/malformed.json
```

Returned to the `devops-engineer` with these instructions:

1. Add `tools/degradation-audit/__fixtures__/__parse-failure__/` to
   `.prettierignore`, with a comment in the same voice as the existing
   malformed-fixture entry directly above it. Ignore the **directory**, not the
   single file, so a second parse-failure fixture does not reintroduce the
   break. `.prettierignore` is added to Batch 3's owned files for this.
2. Run `npx nx format:write` over `tools/degradation-audit/` — `prettier --check`
   currently reports `check-degradation.ts` as unformatted, so the hook would
   reformat it during the commit and produce a diff nobody wrote. Formatting it
   beforehand keeps the committed bytes the executor's own.
3. Prove the fix the way it failed: stage the batch by explicit path and run a
   real `git commit`. It must reach the commit-msg stage without the hook
   erroring. Do not use `--no-verify`.
4. Optional, non-blocking: the logic review's one cosmetic minor — restore the
   "no reason" vs "unrecognised form" distinction in `parseMarkerLine` /
   `resolveSuppression` (`check-degradation.ts:370-378`, `:439`). Detection and
   suppression are unaffected either way.

No other change is required — every functional gate above already passes and
does not need re-running beyond the self-test and lint.

---

## Batch 4: ESM bundle gate, skip policy, probe hardening — COMPLETE (`56d708910`)

- Components: 5, 6, 11
- Recommended executor: `devops-engineer`
- Fallback executor: `senior-tester`
- Execution mode: `sub-agent`, sequential
- Depends on: Batch 3 (both may edit `ci.yml`; Batch 3 commits first)
- **Parallel with: Batch 2**
- Files owned (exclusive):
  - REWRITE `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` →
    `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` (rename; the old name
    would be the accumulation)
  - CREATE a build-artifact skip helper in each of `apps/ptah-cli/src/` and
    `apps/ptah-electron/src/` (an existing `support`-style location, **not** a new
    shared lib — two apps do not justify one)
  - MODIFY `apps/ptah-cli/src/smoke.spec.ts`,
    `apps/ptah-cli/src/cli/commands/session.headless.integration.spec.ts`
  - MODIFY `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs`
  - MODIFY `.github/workflows/ci.yml` **only** if Task 4.3 proves the dist chain absent

### Task 4.1: generalized ESM bundle gate — COMPLETE

- Template verified: `integrity-worker-bundle.spec.ts` `describe.each(HOSTS)`
  `:83`, dual-idiom banner `:94-106`, artifact skip `:108`, index ordering
  `:120-131`.
- Discover targets from `project.json` where `options.format` equals `['esm']`
  across `apps/ptah-electron`, `apps/ptah-cli`, `apps/ptah-extension-vscode`,
  `apps/ptah-tui`. **Anti-vacuity**: the discovered set must be non-empty and
  must contain the nine known targets, so a rename fails loudly instead of
  shrinking the suite to zero.
- **Conditional** require invariant, not unconditional: if the bundle contains
  `Dynamic require of`, `createRequire(import.meta.url)` must appear at a lower
  index. `embedder-worker.mjs` and `voice-worker.mjs` emit no shim and must
  correctly pass without a banner.
- **Executable self-test** — spawn each built bundle under
  `node --input-type=module` with a bounded timeout, killed by PID, and assert it
  fails **only** with the module's own entry guard. The integrity worker's is
  verbatim `'integrity-worker.ts must be run as a worker (no Electron parentPort
and no worker_threads parentPort)'` (`integrity-worker.ts:97`).
  **R-8**: confirm per worker whether `embedder-worker.ts` / `voice-worker.ts`
  fail deterministically when run bare; add a `--self-test` entry argument to
  whichever does not, and **report which needed it**.
- **Wiring assertion**: each `apps/ptah-electron` worker target name appears in
  `build.dependsOn` (verified `:215-219`, exactly 5 entries), in
  `build-dev.options.commands` and in `serve:watch.options.commands`.
- **Mutation check**: delete a banner from `project.json`, confirm exactly one
  spec fails, restore.

### Task 4.2: build-artifact skip policy — COMPLETE

- Depends on: Task 4.1 (the gate's own `:108` skip folds into it)
- Rule: skip permitted **only** when `PTAH_ALLOW_SKIP_UNBUILT` is set. Unset →
  the suite **fails** with a message naming the exact build command
  (`nx build ptah-cli`) and the env var.
- **In scope, exactly two behavioural sites**: `smoke.spec.ts:27`
  (`describeIfBuilt`) and the bundle gate's `:108`.
- **PC-6**: `session.headless.integration.spec.ts:62` hardcodes
  `STUB_CLAUDE_AVAILABLE = false`, so the suite is unconditionally skipped today
  and the `existsSync(DIST_BIN)` conjunct change has **zero observable effect**.
  Make the edit; do not count it as a fixed green-by-skip.
- **Out of scope, do not touch**: the ~75 `nativeAvailable ? describe :
describe.skip` native-module guards; the four `process.platform === 'win32'`
  guards; the six env-flag guards; `bootstrap-regression.e2e.spec.ts:33`, whose
  CI exclusion is documented in its own header at `:28-32`.

### Task 4.3: CI dist-chain verification — COMPLETE

- Depends on: Task 4.2
- **R-4, HIGH.** `ci.yml:117-118` runs `nx affected -t test` and `:120` runs
  `nx affected -t build` — tests run **before** the build. On that ordering
  `dist/apps/ptah-cli/main.mjs` does not exist when `smoke.spec.ts` runs, and
  Task 4.2 converts a false green into a false red for the whole job.
- Verify the chain. If the dist is not guaranteed, **add the build to the job**
  rather than weakening the rule. Report the resolution explicitly.

### Task 4.4: `measure-boot-rpcs.mjs` hardening — COMPLETE

- `--keep-db` skips the temp-dir deletion at `:241-242` and **prints the retained
  path** so it is not orphaned silently.
- **PC-9**: `app.close()` is called at **both** `:215` and `:237`. Both exit
  paths need the flag honoured.
- Any kill must be **PID-scoped**. `taskkill /F /IM electron.exe` matches every
  Electron app on the machine and once killed the developer's own running Ptah.
- Verify: run with and without the flag; confirm the copy survives or is removed.

### Batch 4 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx reset
npx nx build-integrity-worker ptah-electron --skip-nx-cache
npx nx build-integrity-worker ptah-cli --skip-nx-cache
npx nx run-many -t test -p ptah-electron ptah-cli
npx nx run-many -t lint -p ptah-electron ptah-cli
```

Acceptance: the gate discovers >= 9 ESM targets and fails on a renamed one;
every built bundle loads as a process and fails only on its own entry guard;
`smoke.spec.ts` fails with the dist removed and no env var, skips with the env
var, runs with the dist present; R-4 is resolved and the resolution is stated.

Commit: `test(electron): batch 4 - execute every esm bundle and fail rather than skip`

### Batch 4 verification record — COMPLETE (`56d708910`, 17 files, +1496/-151)

Reviews both accepted after one revision: `code-logic-reviewer` Revision 1
re-review **APPROVED** 8/10 with the blocking FM-1, the serious
`build.dependsOn` finding and both moderates all closed; `code-style-reviewer`
**APPROVED** 8/10. Gates re-run by the team-leader, not read off the report:

- `npx nx run-many -t test -p ptah-electron ptah-cli ptah-extension-vscode
ptah-tui --skip-nx-cache` — header read back **`Running target test for 4
projects and 37 tasks they depend on`**, exit 0. `ptah-electron` 35/36 suites
  480 passed, `ptah-cli` 66/67 suites 985 passed, `ptah-tui` 26 suites 330
  passed, `ptah-extension-vscode` 5 suites 40 passed. The "37 tasks they depend
  on" **is** the R-4 proof: the nine ESM builds were pulled in by the test graph
  itself, with no separate build step in the command.
- **`ptah-electron`'s skips drop from 8 to 4.** The four
  `existsSync(host.bundle)` bundle-gate skips are gone because the artifacts now
  exist when the gate runs; the remaining four are the `better-sqlite3`
  `nativeAvailable` guards in `wizard-seed.integration.spec.ts`, explicitly out
  of scope. This is the batch's headline effect, measured rather than asserted.
- `npx nx run-many -t lint` for the same four — **0 errors**, warnings all
  pre-existing.
- `npx nx run degradation-audit:lint --skip-nx-cache` — `TOTAL 564` at baseline,
  with each app at its own: `ptah-cli 29/29`, `ptah-electron 28/28`,
  `ptah-extension-vscode 9/9`, `ptah-tui 1/1`. Zero `orphaned-suppression` and
  zero `bare-suppression` repo-wide.
- **`git diff HEAD -- .github/workflows/ci.yml` is empty**, confirming the
  reorder was reverted. Against `origin/main` the file differs by exactly the
  9-line degradation-audit step Batch 3 added and nothing else.
- **No worker source under `libs/backend/**`was touched** —`git diff --stat`lists only`apps/` paths.
- **No cycles.** `nx graph` generated clean, and each host's `test.dependsOn`
  names only its own build targets: electron `[build-main,
build-embedder-worker, build-integrity-worker, build-voice-worker]`, cli
  `[build-esbuild, build-embedder-worker, build-integrity-worker]`, vscode
  `[build-esbuild]`, tui `[build]`. No cross-host entry anywhere, so an
  unaffected project pays nothing.
- The four `project.json` diffs are **purely additive** `test.dependsOn` blocks —
  no banner and no `build.dependsOn` entry was altered.
- Replace-not-accumulate holds: `integrity-worker-bundle.spec.ts` is **deleted**
  in the same commit that adds the four per-host gates.
- The executable self-test list is genuinely tied to discovery, not to a
  hardcoded id list: worker-shaped targets are derived from the discovered
  target name by suffix, `Object.keys(WORKER_ENTRY_GUARDS)` is asserted equal to
  that discovered set, and the spawn suite iterates the same set. A new
  `build-*-worker` target without a guard now fails loudly.
- Task 4.4 read on disk: `--keep-db` is honoured at **both** `app.close()` exit
  paths (PC-9), the retained paths are printed, and no `taskkill` or `/IM`
  appears anywhere — every kill is PID-scoped.

**R-4 is resolved at the graph level rather than by CI step order**, which is
strictly stronger than the mitigation `batches.md` anticipated: Nx schedules a
`dependsOn` task whenever the dependent task is scheduled, independent of the
affected-marking of sibling projects and independent of where a build step sits
in the workflow. That is why reverting the `ci.yml` reorder is correct and not a
regression. **R-8 is answered "neither"**: no `--self-test` argument was added to
`embedder-worker.ts` or `voice-worker.ts` because both already throw
synchronously at module evaluation when spawned bare, verified by spawning all
five built worker bundles under a bounded, PID-killed timeout.

Accepted cost, recorded: the per-host split duplicates the discovery and
conditional-require logic four times, and `build-artifact-gate.ts` now exists in
four copies. This is the direct consequence of the ruling that four apps do not
justify a shared lib, and it is what buys the cross-host false-red immunity.
`apps/ptah-extension-vscode/tsconfig.app.json` gained one exclusion for
`build-artifact-gate.ts`, because that host's `build-esbuild` has no
`skipTypeCheck` and the file uses bare Jest globals — the same treatment
`*.spec.ts` already receives.

Worktree litter noted, not committed: an empty untracked `nul` file (a Windows
`> nul` redirect artifact) and `npm-ci.log`. Neither belongs to any batch.

---

## Batch 5: Triage classification — six uncontested libs — COMPLETE (`39aba3486`)

- Component: 4's classification pass (the ~268-row triage table)
- Recommended executor: **CLI lanes x 3**, then a `backend-developer` sub-agent to
  reconcile. A CLI agent never commits.
- Fallback executor: `backend-developer` sub-agent, sequential
- Execution mode: `parallel`, `cli:codex`, `cli:antigravity`,
  `cli:pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d` (Claude). Max 3 concurrent, so
  two rounds of three. `cli:pc-85830910-3d81-4248-84c1-4fa52752dd19` (Ollama
  Cloud) is the spare if a lane fails.
- Depends on: Batch 3 (the tool must exist and emit the table)
- Parallel with: Batch 6 (different libs entirely)
- **Libs owned, one per lane — these six are touched by no other batch**:
  1. `libs/backend/harness-sync` (~18 sites)
  2. `libs/backend/cli-agent-runtime` (~18)
  3. `libs/backend/agent-generation` (~14)
  4. `libs/backend/workspace-intelligence` (~13)
  5. `libs/backend/skill-synthesis` (~13)
  6. `libs/backend/vscode-lm-tools` (~11)
- **Deliberately excluded** (owned by other batches; classified in Batch 12
  instead): `rpc-handlers`, `vscode-core`, `agent-sdk`, `apps/ptah-electron`.

### Task 5.1-5.6: one lib per lane — COMPLETE

Each lane receives: one library's absolute path, the tool's emitted rows for that
library, the three labels (**legitimate optional capability** → keep, add a
reported code or a suppression with a reason; **defect** → do not fix, record;
**test-only** → suppress with a reason), the exact suppression syntax, and a
prohibition on editing anything outside its library.

- The lane's only edit is a suppression comment or a report call. **No behavioural
  change.** A defect is recorded in the batch report for a later task, not fixed
  here.
- Each lane reports its legitimate/defect/test-only split.

### Task 5.7: reconcile and re-baseline — COMPLETE (re-baseline landed in Batch 6's commit `a5f4f945f`)

- Depends on: Tasks 5.1-5.6
- **A-3 / R-6 gate**: if defects exceed ~15% of classified sites, **stop**, report
  the split, and do not open the remaining libs. The team-leader returns to the
  orchestrator before Batch 12.
- Run `--update-baseline` and commit the lowered counts.

### Batch 5 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run degradation-audit:lint
npx nx run-many -t test -p @ptah-extension/harness-sync @ptah-extension/cli-agent-runtime @ptah-extension/agent-generation @ptah-extension/workspace-intelligence @ptah-extension/skill-synthesis @ptah-extension/vscode-lm-tools
```

Read back `Running target test for 6 projects`. Acceptance: every suppression
carries a reason; no behavioural diff in any lane; baseline drops for all six
directories; the split is reported.

Commit: `chore(audit): batch 5 - classify degradation sites across six libraries`

### Batch 5 verification record — COMPLETE (`39aba3486`, 79 files, +446/-9)

Reviews both accepted after one revision: `code-logic-reviewer` **APPROVED**
8/10; `code-style-reviewer` Revision 1 re-review **APPROVED** 9/10 (the serious
finding — 109 of 142 markers running 150-301 characters on one line — fixed by a
mechanical rewrap to 80 columns, with the reason text proven unchanged by
comparing the normalised concatenation before and after).

Gates re-run by the team-leader:

- **Comment-only, proven rather than asserted.** `git diff -U0` over the six libs
  showed **zero** non-comment added lines, **zero** non-comment removed lines and
  **zero** `.spec.ts` files across all 79 files. This is the strongest available
  evidence for this batch: no production behaviour and no test outcome can depend
  on it.
- 142 markers, per-lib counts matching the report exactly (harness-sync 23,
  cli-agent-runtime 28, agent-generation 30, workspace-intelligence 13,
  skill-synthesis 34, vscode-lm-tools 14). Zero added lines over 80 characters;
  zero markers lacking a reason word on their own line.
- `npx nx run degradation-audit:lint --skip-nx-cache` — **TOTAL 422**, with all
  six directories at their reported counts (agent-generation 1,
  cli-agent-runtime 2, harness-sync 6, skill-synthesis 6, vscode-lm-tools 2,
  workspace-intelligence 1). Zero `bare-suppression`, zero
  `orphaned-suppression`.
- **Exactly 18 unsuppressed sites remain** across the six libs, matching the
  defect list one for one and confirming the 160 − 142 = 18 arithmetic. The
  defects were recorded, not suppressed — the distinction this batch exists to
  preserve.
- Marker reasons sampled and read in context: each names what is optional and
  what the fallback returns. The style review's m-2 duplicate-reason finding is
  visibly fixed — `copyFileAtomic` and `writeTextAtomic` now cross-reference each
  other by name.
- `npx nx run-many -t test` for the six projects — header read back **`Running
target test for 6 projects`**, green **in one pass**, 5384 passing (373 / 957 /
  634 / 1008 / 1401 / 1011), skips pre-existing. No isolation re-run was needed
  because nothing failed.

**A-3 / R-6 gate did NOT trip.** 18 defects of 160 classified sites = **11.25%**,
under the ~15% threshold, so Batch 12 may open the remaining libraries. The
largest unclassified directories for that pass are `agent-sdk` (33),
`rpc-handlers` (40) and `apps/ptah-cli` (29).

**One honest correction to the commit record.** The commit was made, then its
message amended before anything was pushed. The pre-commit hook's own
`nx format:write` added a trailing comma to six lines of
`agent-generation/.../setup-status.service.ts` — a file Prettier had never
formatted — so the committed diff is not literally comment-only. Stripping the
commas makes each pair byte-identical, so the change is semantically inert, but
the first message claimed "zero non-comment lines added or removed" and that
claim no longer matched the commit. The message now states the exception
explicitly. This is the hazard root `CLAUDE.md` warns about (husky reformatting
staged files into a diff nobody wrote), showing up in miniature.

**Scope substitution**: `batches.md` prescribed `chore(audit)`, but commitlint's
`scope-enum` has no `audit` entry (verified against `.commitlintrc.json`).
Committed as `chore(ci)`, the same registered-scope substitution made for Batch 3
and accurate because these suppressions feed the CI ratchet.

**Re-baseline deliberately deferred.** `baseline.json` is untouched in this
commit and confirmed absent from `git show --name-only`. `--update-baseline` has
no per-directory scoping, so running it here would rewrite every entry including
`libs/backend/persistence-sqlite`, which Batch 6 was actively changing in the
same worktree — baking another batch's mid-flight count into the ratchet. The
ratchet only fails on an _increase_, so leaving the six baselines high is safe;
the audit passes today, it is simply not yet ratcheted tight. **Task 5.7's
`--update-baseline` runs as part of the Batch 6 commit step**, once that lib's
own count is final. The six entries to lower are: `agent-generation` 31 → 1,
`cli-agent-runtime` 30 → 2, `harness-sync` 29 → 6, `skill-synthesis` 40 → 6,
`vscode-lm-tools` 16 → 2, `workspace-intelligence` 14 → 1.

**Staging isolation held**: 79 files staged by explicit path, zero under
`persistence-sqlite` and zero under `tools/`. Batch 6's seven dirty files
(including its new `integrity-worker-backup.integration.spec.ts`) were untouched
before and after the commit.

Follow-ups filed, none blocking:

1. **Suite instability, pre-existing.** Nx reports flaky tasks and five of six
   projects emit `A worker process has failed to exit gracefully`. Three distinct
   failure shapes have now been seen across runs (a ts-transform crash, a
   real-time timer race, a 5 s timeout), including when projects run alone. A
   comment-only diff cannot cause it, and this run was green in one pass, but the
   instability is real and deserves its own task.
2. **Tool blind spot** — a marker on a `catch` that is not itself flagged is
   neither honoured nor reported, so the tool header's "a misplaced comment is
   never silent" promise has a gap. Found the hard way when a lane pasted a
   marker ~160 lines from the site it described. Batch 12 / tool owner.
3. **Undocumented tool constraint** — a wrapped marker must carry at least one
   word of reason on its **own** line or it is read as a bare suppression. This
   cost one hand edit during the rewrap. The tool header should state it and show
   a wrapped example.
4. **`--update-baseline` needs a `--dir` filter.** With several batches sharing
   one worktree, a global rewrite is a genuine foot-gun — it is the reason
   Task 5.7 had to be deferred at all.

Lane note: of six CLI lanes, one (antigravity, `cli-agent-runtime`) produced zero
edits after ~4 hours and was re-spawned on another vendor; one (codex,
`skill-synthesis`) landed all its edits but died on a usage limit before
reporting, so that lib's per-row reasons were reconstructed and re-read by the
reconciling sub-agent rather than taken from the lane. The reconciler also
overrode one misplaced marker in `skill-scorecard.service.ts`, which is what
finding 2 above was discovered through.

---

## Batch 6: Track B — worker protocol widening — COMPLETE (`a5f4f945f`)

- Component: 8
- Recommended executor: `backend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- **Depends on: Batches 1, 2, 4 COMPLETE.** This is the task's stated sequencing
  rule and it is load-bearing (R-3): Track B's "no worker → no backup" failure
  mode is acceptable only because the gate proves the bundle loads and the
  reporter makes the failure countable.
- Parallel with: Batch 5, Batch 9
- Files owned (exclusive):
  - MODIFY `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts` + `.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/index.ts`

### Task 6.1: assumption A-1 check — RUN FIRST — COMPLETE (branch A: read-only backup works, no flag)

- In the worker, open a copy of a real database with `{ readonly: true }` and call
  `backup()` to a temp path; assert the destination passes `quick_check`.
- **If it throws**, the worker opens read-write instead and never issues a write
  statement. That is one flag, not an architecture change. The batch continues
  either way; the report must say which branch was taken.

### Task 6.2: widen the protocol — COMPLETE

- Depends on: Task 6.1
- `IntegrityWorkerInbound` (`:32`, currently an alias) becomes
  `IntegrityCheckRequest | BackupRequest`.
- `BackupRequest`: `{ id: number; type: 'backup'; dbPath: string; destPath: string }`.
  **`destPath` is computed on the host** — the worker must stay a leaf that
  imports only its protocol module.
- `BackupResponse` **reuses `IntegrityVerdict`** (`:39`). `BackupIntegrity`
  (`backup.service.ts:53`) is **deleted** in Batch 7 — one three-valued verdict
  type in this lib, not two.
- `isBackupRequest` shaped like `isIntegrityCheckRequest` (`:82-93`).
- `integrity-worker.ts:193`'s `subscribe(...)` gains a second branch. The
  unrecognised-payload drop is unchanged.
- Reuse `openReadOnly` (`:120`) and `classifyQuickCheck` (`:76`) — post-copy
  validation runs **in the worker** (this absorbs 380 follow-up item 16).
- **Unlink a partial destination before returning.** Without this a partial file
  takes the newest rotation slot and evicts a good backup.
- Carry the POSIX `chmod` 0700/0600 lockdown (`backup.service.ts:189`, `:193`)
  into the worker. Pin it with a POSIX-guarded spec case — losing it silently
  reopens a local-information-disclosure hole.
- Validate `destPath` in the worker as absolute and under the database's own
  directory tree. IPC is an external boundary. Match the file's hand-written
  narrowing style rather than introducing Zod into the one file that must bundle
  in isolation; note the divergence.
- Every escape lands on `'unavailable'` with a `detail`, never `'corrupt'`.

### Batch 6 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx reset
npx nx run-many -t test -p @ptah-extension/persistence-sqlite
npx nx build-integrity-worker ptah-electron --skip-nx-cache
npx nx build-integrity-worker ptah-cli --skip-nx-cache
npx nx run-many -t test -p ptah-electron ptah-cli
```

Acceptance: A-1 resolved and reported; the new guard rejects malformed backup
requests; a failed copy leaves no artifact; the rebuilt bundles still pass the
Batch 4 gate; `integrity-worker.ts` still imports only its protocol module.

Commit: `feat(persistence-sqlite): batch 6 - teach the integrity worker to take a backup`

### Batch 6 verification record — COMPLETE (`a5f4f945f`, 8 files, +1582/-34)

Reviews both accepted after one revision: `code-logic-reviewer` Revision 1
re-review **APPROVED** 8/10 (the serious finding — A-1 unpinned by any automated
test — closed by a checked-in integration spec, and all three moderates plus five
failure modes closed); `code-style-reviewer` **APPROVED** 8/10. Gates re-run by
the team-leader:

- `npx nx run-many -t test -p @ptah-extension/persistence-sqlite ptah-electron
ptah-cli --skip-nx-cache` — header read back **`Running target test for 3
projects and 34 tasks they depend on`**, exit 0. `persistence-sqlite` 317
  passed, `ptah-electron` 480 passed, `ptah-cli` 985 passed.
- **Both integrity worker bundles rebuilt** (via the Batch 4 `test.dependsOn`
  wiring, inside the same `--skip-nx-cache` run) and **both per-host gates pass
  fully with zero skips**: `ptah-electron` 27/27, `ptah-cli` 12/12, run
  explicitly after the fact. That includes the bare-spawn executable self-test
  against the newly rebuilt worker.
- **`integrity-worker.ts` imports exactly one monorepo module** —
  `./integrity-worker-protocol` — plus `node:fs` and `node:worker_threads`. The
  acceptance criterion holds after the `performBackup` extraction.
- **The entry-guard message is unchanged** and still matches verbatim:
  `integrity-worker.ts:114` against `esm-bundle-gate.spec.ts:301`.
- `integrity-check.service.ts`'s diff is the type-alias swap plus the additive
  `type === 'backup'` rejection — no behavioural change, as claimed.
- `ensureBackupDirectory` read on disk: it early-returns on an existing
  directory, so the rollback can only remove a directory it created, and a
  failed rollback never replaces the original error.
- Barrel changes are purely additive (six new exports, no removals).
- **No hook reformat drift** this time — `git diff HEAD` was empty after the
  commit, unlike Batch 5.

**A-1 is resolved as branch A**: a `{ readonly: true, fileMustExist: true }`
connection can call `backup()` and the copy passes `quick_check`, including
against a live writer inserting throughout. No read-write fallback flag was
added; the source is never written. The evidence is now
`integrity-worker-backup.integration.spec.ts` (8 cases) rather than prose.

**Recorded, not treated as a failure: the integration suite self-skips locally.**
This checkout's `better-sqlite3` is compiled for the Electron ABI (143) while
Jest runs on Node's, so the native probe fails and the suite skips — the
pre-existing `realbinary` convention, and it prints its reason
(`[integration-spec] native probe failed; A-1 suite skipped: …`). This is not a
dead test: `ci.yml` carries an explicit `npm rebuild better-sqlite3` step for the
runner ABI (verified in the file), so the 8 cases run in CI, and the reviewer ran
them 8/8 under a matching ABI locally. The executor also ran the whole lib under
`ELECTRON_RUN_AS_NODE` and got 35/35 suites with every native guard open.

Three deviations accepted, all recorded in the commit body:

1. **`performBackup` lives in the protocol module.** `integrity-worker.ts` throws
   at module scope with no parent port, so Jest cannot import it — the entire
   executable body of the backup command was in the one file no test can reach.
   Moving it was the fix the serious review finding actually demanded. It does
   stretch the "protocol" name, and the module is now **666 lines against the
   700-line soft ceiling** — Batch 7 has little room there, and if a third
   command arrives the split to make is per-command (`check` / `backup`), not a
   `helpers` file.
2. **The COPY is validated read-write**, not with `openReadOnly`. A read-only
   connection cannot checkpoint on close, so validating that way plants `-wal`
   and `-shm` beside the artifact; rotation selects by filename prefix, the
   sidecars carry the backup's own prefix and sort after it, so they would take
   rotation slots and evict a real backup. Measured, not reasoned about — and it
   restores what the shipped `backup.service.ts` already did. Only the private
   copy is opened read-write; the source never is.
   `removeBackupArtifact` sweeps the sidecars too.
3. **A type-only edit to `integrity-check.service.ts`**, outside the declared file
   list, because widening the outbound union broke it in eight places.
   `IntegrityCheckOutbound` states what was already true. **Batch 7 owns this
   file next and should use the alias rather than re-deriving it.**

**Task 5.7's re-baseline landed here**, as ruled. Sequence followed exactly:
`degradation-audit:lint` first confirmed `persistence-sqlite` at **6 of 6** and
**TOTAL 422**; then `--update-baseline`; then the diff was checked to lower
**exactly** the six Batch 5 directories to their recorded values —
`agent-generation` 31 → 1, `cli-agent-runtime` 30 → 2, `harness-sync` 29 → 6,
`skill-synthesis` 40 → 6, `vscode-lm-tools` 16 → 2, `workspace-intelligence`
14 → 1 — with **every other entry unchanged**. `persistence-sqlite` did **not**
drop below 6, so Batch 6 removed no site; its six are all pre-existing, and the
worker's new catches are not flagged because none swallows — each carries
`describe(error)` into the response `detail`, which is the point of the
`'unavailable'` verdict. The audit re-runs green against the tightened baseline,
so the ratchet is now **armed** on those six libraries: any regression there now
fails CI rather than being absorbed by a loose baseline.

Carried to Batch 7: drop the now-redundant `db` parameter from
`SqliteBackupService.backup(db, kind)` rather than branching on it — the worker
opens by path. And the rotation-prefix hazard above deserves a spec in the
rewritten `backup.service.spec.ts`: `rotate` must not be able to count a `-wal`
or `-shm` file as a backup, whoever created it.

---

## Batch 7: Track B — `SqliteBackupService` worker-driven — COMPLETE (`52e8d9f39`)

- Component: 9
- Recommended executor: `backend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- Depends on: Batch 6 (both touch `persistence-sqlite/src/index.ts` — strictly serial)
- Files owned (exclusive):
  - REWRITE `libs/backend/persistence-sqlite/src/lib/backup.service.ts` + `.spec.ts`
  - CREATE `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` + `.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` + `.spec.ts`
  - MODIFY `libs/backend/persistence-sqlite/src/lib/di/register.ts`,
    `libs/backend/persistence-sqlite/src/index.ts`

### Task 7.1: extract `DbWorkerRunner` — COMPLETE

- `SqliteIntegrityService.runWorker` (`:222-312`) — spawn, single settle on
  reply/exit/budget/abort, kill on every path — becomes an injected collaborator.
  **Do not duplicate it into the backup service.**
- **Facade rule**: `SqliteIntegrityService` keeps its name, its token, and a
  public surface of exactly `isDue` / `dispatchIfDue` / `dispose` (`:15-18`).
- `SqliteIntegrityService.dispatching` (`:79`) is a per-service flag and must
  **not** be shared with backup.

### Task 7.2: rewrite the backup service — COMPLETE

- Depends on: Task 7.1
- **Signature**: `backup(db, kind)` (`:95`) → `backup(kind)`. The `db` parameter
  existed only for `await db.backup(dest)` at `:191`; `dbPath` is already
  injected at `:109`.
- Inject `PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY` with
  `{ isOptional: true }` — the same shape as `integrity-check.service.ts:98`.
- **DELETE**: `checkIntegrity` (`:231-284`), `loadBetterSqlite3ValidationFactory`
  (`:64-70`), `setValidationFactory` (`:129-131`), the `validationFactory` field
  (`:125-126`), the `BackupIntegrity` type (`:53`), and **PC-7**: the third
  `'unavailable'` guard at `:179` ("db.backup() is unavailable on this database
  instance"), which exists only because the service receives a foreign handle.
  Deleted, not commented out.
- **Unchanged**: `rotate` (`:330-369`), `KEEP_BY_KIND` (`:81-85`), `dirFor`
  (`:134-140`), `prefixFor` (`:143-149`), `compactIso`. Artifacts land in the
  same directories under the same retention.
- **No in-process fallback.** No factory → `null`, a top-severity degradation
  event, `logger.warn`. Two implementations of one job is what the repo rule
  forbids, and it would keep the 27 s path alive as the silent fallback.
- Budget must be **larger** than `INTEGRITY_WORKER_BUDGET_MS` (5 min,
  `integrity-check.service.ts:71`) or explicitly justified against it. A 1 GB copy
  plus validation is strictly more work than a `quick_check`, and a tight budget
  silently means "backups stopped".
- **Never throws** (`:88-95`).
- Spec (~20 construction sites) rewrites against a **stub worker factory**, not
  `setValidationFactory`. Load-bearing cases: no factory → `null` + exactly one
  report; `'unavailable'` → `null`, artifact absent; `'corrupt'` → `null`,
  artifact deleted; `'ok'` → path returned, rotation callable.

### Batch 7 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p @ptah-extension/persistence-sqlite
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite
npx nx affected -t typecheck
```

Acceptance: R-3's two halves both hold (loud event **and** green gate from Batch
4); the chmod lockdown survives, pinned by a POSIX-guarded case; no in-process
fallback exists anywhere in the diff.

Commit: `perf(persistence-sqlite): batch 7 - run the database backup out of process`

### Batch 7 verification record — COMPLETE (`52e8d9f39`, 9 files, +1521/-591)

Reviews: `code-logic-review.md` 9/10 APPROVED after one revision
(sidecar-aware `discardArtifact`, serialized overlapping calls);
`code-style-review.md` 8/10 APPROVED.

Gates run in the task-383 worktree, `--skip-nx-cache`:

| Gate                           | Result                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| `test` persistence-sqlite      | 20 suites pass (266 tests), 8 ABI-skipped, **8 fail at compile** |
| `lint` persistence-sqlite      | clean                                                            |
| `typecheck` persistence-sqlite | one error: `migration-runner.ts:91` TS2554                       |
| `degradation-audit:lint`       | persistence-sqlite 5 (baseline 6), TOTAL 421, ratchet green      |

The 8 compile failures are the accepted Batch 8 break and nothing else.
Distinct TS errors across all 36 suites: `migration-runner.ts:91:63`
TS2554 (14 occurrences, 7 suites import it transitively) and
`migration-runner.spec.ts:186,208` TS2345 (its fake still has the
`(db, kind)` signature). Failing suites: `migration-runner.spec.ts`,
`0024`, `0028`, `0031`, `0038`, `0039` migration specs,
`sqlite-connection.service.spec.ts`, `sqlite-connection.realbinary.spec.ts`.
These are a different class from the 8 ABI-skipped `realbinary` suites
(Electron ABI 143 vs Node 137, self-skip locally, CI rebuilds).

Batch 8 must restore this lib to fully green. The team-leader agent
that started this verification died on an API rate limit (HTTP 429);
the orchestrator completed verification and the commit directly.

Not re-baselined (Batch 12 owns the final `--update-baseline`).

---

## Batch 8: Track B — backup call sites — COMPLETE (`bbaaf98a4`)

- Component: 10
- Recommended executor: `backend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- Depends on: Batch 7
- Files owned (exclusive):
  - MODIFY `libs/backend/persistence-sqlite/src/lib/migration-runner.ts` + spec
  - MODIFY `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` + spec
  - MODIFY `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` + specs
  - MODIFY `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts` + specs

All four sites verified at the exact lines the plan claims. No fifth site exists.

### Task 8.1: `migration-runner.ts:91` — PENDING

- `await this.backupService.backup('pre-migration')`. The surrounding try/catch,
  the `backupDest !== null` guard and `rotate('pre-migration', 3)` are unchanged.
- No structural edit — `applyAll` is already `async` and already `await`s here.
  Replacing a synchronous C++ copy with an awaited worker round-trip frees the
  event loop across the same `await` and preserves the ordering guarantee for
  free.

### Task 8.2: `start-thoth-cron.ts:372` — PENDING

- **R-1, HIGH.** `:365-368` returns `{ summary: 'skipped: no sqlite connection' }`
  **before** the backup. After the signature change the backup no longer needs
  the connection. Leaving the guard where it is silently keeps skipping daily
  backups on any host with no live connection.
- **Move the guard below the `backup('daily')` call** so it gates only the two
  write pragmas (`incremental_vacuum(100)` at `:387`, `optimize` at `:397`),
  which still need the live handle — or state in the report why it must stay.
- Pin with a spec case: no connection → backup still attempted.
- `withActivityEmit` (`:366`) and the `@ptah/daily-backup` job are unchanged.
- `start-thoth-cron.spec.ts:123-159` and `:749` already assert `backup` was called
  with specific arguments; those expectations change shape and are the regression
  proof.

### Task 8.3: `cli-engine/bootstrap/thoth-runtime.ts:432` — PENDING

- The CLI twin of 8.2. Same guard question, same answer.

### Task 8.4: `persistence-rpc.handlers.ts:433` — PENDING

- `backup('reset')`, **awaited**. This is the one caller where "never block"
  would be wrong: it sits inside a 5-step ordered flow (`:425-440`) where the
  backup must complete before the connection is closed and the file renamed.
  Do **not** make it fire-and-forget.

### Batch 8 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers
npx nx affected -t typecheck
```

Read back `Running target test for 4 projects`. Acceptance: zero remaining
`backup(db, ...)` call sites repo-wide; R-1 resolved with a spec; `db:reset`
ordering preserved; an unavailable backup still does not block a migration.

Commit: `refactor(persistence-sqlite): batch 8 - drop the db handle from every backup call site`

### Batch 8 verification record — COMPLETE (`bbaaf98a4`, 7 files, +133/-29)

Tasks 8.1–8.4 all COMPLETE. Reviews: logic APPROVED (0 blocking, 2
moderate), style APPROVED 8/10 (0 blocking, 2 minor). Revision 1 fixed
the shared finding: both cron sites' null-backup summary now reads
`backup not taken; see the database.backup degradation report` (the
literal prefix of the two codes the service emits). The orchestrator
also fixed the stale `db.backup unavailable` comment at
`migration-runner.spec.ts:245`.

R-1 decisions: `start-thoth-cron.ts` guard MOVED below `backup('daily')`
(gates only the two write pragmas). CLI `thoth-runtime.ts` guard REMOVED
(no pragmas follow) and `registerBackupJob`'s `refs` parameter dropped.
The outer `startCron` connectionless early-return is untouched (the
scheduler is SQLite-backed). `db:reset` ordering byte-identical to HEAD
aside from the argument, pinned by a spec that asserts `backup` then
`close`.

Gates, uncached, `Running targets test, lint, typecheck for 4 projects`:

| Project            | Tests                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| persistence-sqlite | 27 suites / 345 pass, 9 skipped (ABI) — Batch 7's 8 compile failures gone |
| thoth-runtime      | 4 / 70                                                                    |
| cli-engine         | 17 / 169                                                                  |
| rpc-handlers       | 94 / 2715                                                                 |

Lint 0 errors, typecheck clean, `degradation-audit:lint` TOTAL 421
(persistence-sqlite 5 vs baseline 6, cli-engine 12/12, rpc-handlers 40/40).

Follow-ups filed for Batch 12:

- `IBackupService` fakes in three specs are untyped object literals
  (style minor, pre-existing shape).
- cli-engine specs log `migrationRunner.runMigrations is not a function`
  from `with-engine.ts:292` — a fake without that method; pre-existing,
  not this batch.
- `voice-rpc.handlers.spec.ts` timed out once under parallel load and Nx
  flagged `thoth-runtime:test` flaky; both pass in isolation (goes with
  the concurrency-flakiness task already filed).

---

## Batch 9: Track C — cold re-measurement (THE GATE) — PENDING

- Component: 12
- Recommended executor: `senior-tester`
- Fallback executor: `devops-engineer`
- Execution mode: `sub-agent`, sequential
- Depends on: Batch 4 (needs `--keep-db`)
- Parallel with: Batches 5, 6
- Files owned: **none in the worktree.** Output is a measured table written to
  `D:/projects/ptah-extension/.ptah/specs/TASK_2026_383/test-report.md`.
- **Hard gate: Batches 10 and 11 may not be assigned until this batch is
  COMPLETE.** (A-4 / R-7.)

### Task 9.1: cold re-measurement — PENDING

Method, reproduced from `TASK_2026_380/test-report.md` so it is not re-derived:

- `npx nx reset` first — the Nx daemon serves a stale `project.json` even with
  `--skip-nx-cache` (380 item 15).
- `npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron`.
- Copy the real ~1 GB database plus its `-wal` and `-shm` siblings to a temp path
  with `Copy-Item`. **Never open the real file.** Pass it via `--db=` /
  `PTAH_DB_PATH`.
- Cold cache: `RAMMap -Es` if an elevated session is available; otherwise the
  32 GB scratch write+read fallback — and **say which was used**. The 380 report
  specifically warns that a measurement depending on full-file I/O needs a real
  cold cache.
- `NODE_ENV=production` suppresses the console transport (`logger.ts:95`), so
  `[event-loop] lag` lines never reach the probe's stdout. Poll the app's own
  `logs/Ptah Electron-*.log` and copy it out **before** cleanup, or use
  `--keep-db`.
- Command:
  `node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs --ws=D:/projects/ptah-extension --db=<copy> --seconds=120 --keep-db`

Produce a table of, per handler, arrival ms, duration ms, and the event-loop lag
spikes across the window — the **same** method the 380 report used, so the
numbers are comparable. Baseline to beat: `auth:getAuthStatus` 2244,
`config:models-list` 2296, `session:list` 2291, `git:info` 2476,
`autocomplete:agents` 4095.

### Task 9.2: time `PRAGMA optimize` in isolation — PENDING

- **A-2.** It stays on the host by necessity (it writes) and it is unbounded,
  unlike `incremental_vacuum(100)`. Time it on the same 1 GB copy. If it is
  seconds, it is a named follow-up needing its own decision — record it, do not
  absorb it.

### Batch 9 verification

- The recorded table exists in the task folder and states which cold-cache method
  was used.
- **Gate**: if the numbers do not reproduce within ~30%, the Batch 10/11 remedies
  **do not ship as written**. The team-leader returns the measured table to the
  orchestrator and the remedies are re-selected before either batch is assigned.

Commit: `test(electron): batch 9 - cold re-measurement of the boot rpc window`

---

## Batch 10: Track C — frontend remedies — PENDING

- Components: 13, 17, and 14's frontend half
- Recommended executor: `frontend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- Depends on: **Batch 9 COMPLETE and its gate passed**
- Parallel with: Batch 11 (fully file-disjoint)
- Files owned (exclusive):
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts` + spec
  - MODIFY `libs/frontend/core/src/lib/services/model-state.service.ts` + spec
  - MODIFY `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` + spec
  - MODIFY `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts` + spec
    (**PC-8**: this is the real path; the plan wrote an ellipsis)

### Task 10.1: delete the eager agent preload — PENDING

- **PC-5**: `ngOnInit` is at `:157-159`, `preloadAgents` at `:165-174`,
  `toggleDropdown` at `:180`.
- Delete the `ngOnInit` preload. The dropdown already loads on open, guarded by
  `_isCached` / `_isLoading` (`agent-discovery.facade.ts:50-55`) and a
  `_generation` stale guard.
- Deleted, not flagged off. If `preloadAgents` has no remaining caller, delete
  the method too.
- Risk: the first dropdown open becomes slower. If the measured open-latency is
  unacceptable, arm the preload on **first user interaction with the composer**
  rather than on mount — decide from the measurement, not in advance.

### Task 10.2: drop the constructor model fetch — PENDING

- **PC-1**: the constructor call at `:151` is `this.loadModels()`, **not**
  `refreshModels()`. Delete line `151` only. Line `:152`
  (`void this.hydratePricing()`) is **out of scope** and stays.
- **PC-2**: before relying on `createTab` as the boot-path cover, confirm that
  `TabManagerService:782`'s `this.modelRefresh.refreshModels()` resolves to
  `ModelStateService.refreshModels` (`:246` → `loadModels` `:264`). Cite the
  binding in the report. If it does not resolve there, deleting `:151` removes
  the boot fetch outright and the task changes shape — stop and report.
- In-flight coalescing keyed on `WorkspaceScopeService.scopeKey()` (`:264-282`)
  means the two calls were already one RPC, just fired earlier than needed.

### Task 10.3: one `session:list` loader — PENDING

- Give `SessionLoaderService` a shared in-flight promise — the same `_loadPromise`
  single-flight shape `AuthStateService` already uses at
  `auth-state.service.ts:575-591`. The existing 300 ms trailing debounce at
  `session-loader.service.ts:176-192` does not span the two callers
  (`chat-lifecycle.service.ts:55` and `session-analytics-state.service.ts:225`).
- Have the dashboard's analytics state consume the loader instead of issuing its
  own RPC. Two frontend edits; no backend change.
- **R-11, forbidden scope**: 380 follow-up item 8 (`SessionLoaderService` resume
  failure is log-only, `:837-843`) touches this same file and is **out of scope**.
  Do not pick it up opportunistically.

### Batch 10 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/dashboard
npx nx run-many -t lint -p @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/chat @ptah-extension/dashboard
```

Read back `Running target test for 5 projects`. Acceptance: no
`autocomplete:agents` and no constructor-fired `config:models-list` in the boot
window; exactly one `session:list`; the dropdown still populates on open;
`hydratePricing` still fires.

Commit: `perf(chat-ui): batch 10 - stop fetching agents, models and sessions eagerly at boot`

---

## Batch 11: Track C — backend remedies — PENDING

- Components: 15, 16, and 14's backend half
- Recommended executor: `backend-developer`
- Fallback executor: `claude` sub-agent
- Execution mode: `sub-agent`, sequential
- Depends on: **Batch 9 COMPLETE and its gate passed**
- Parallel with: Batch 10
- Files owned (exclusive):
  - MODIFY `libs/backend/vscode-core/src/utils/exec-git.ts`,
    `libs/backend/vscode-core/src/services/git-info.service.ts` + specs
  - MODIFY `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts` + spec + DI registration
  - MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts` + spec
  - MODIFY the Electron DI registration for the git spawner under `apps/ptah-electron/src/services/`

### Task 11.1: persist the SDK model catalog — PENDING

- Coordinates with Task 10.2 but shares no file. The existing `modelsCache` is
  keyed by an auth fingerprint with a `cacheGeneration` guard and **no TTL**, so a
  cross-boot store in `IStateStorage` is a faithful extension.
- The persisted entry must carry the **fingerprint**, not just the payload — a
  stale catalog must never outlive an auth change. `clearCache()` /
  `invalidateForAuthChange()` clear the persisted copy too.
- Shape-validate on read; a corrupt entry is **ignored, not repaired**.

### Task 11.2: persist the CLI health verdict — PENDING

- Cost source is a `crossSpawn` of `claude --version`
  (`claude-cli-detector.ts:24`, `:524`, `:536`). All three existing caches are
  process-local, so nothing survives a restart.
- Persist the **detector-level** verdict in `IStateStorage`, keyed by
  `(resolved executable path, mtimeMs, size)`. A CLI upgrade changes at least one,
  so invalidation is exact and needs no TTL guess.
- A key mismatch → ignored. A stat failure → "no persisted entry", i.e. today's
  behaviour. `clearCache()` drops the persisted entry alongside the in-memory one.
- Precedent for trusting a stale memo already exists at `auth-rpc.handlers.ts:668`.

### Task 11.3: route `git:info` through `IProcessSpawner` — PENDING

- **R-9, run first**: read `platform-core`'s `ProcessSpawnRequest` /
  `SpawnedProcessHandle` before writing the adapter. `exec-git` needs stdout
  capture, an exit code and a timeout. If a field is missing, the port is
  **extended**, not bypassed.
- Inject `IProcessSpawner` optionally into the `exec-git` call path
  (`exec-git.ts:148`, verified) and spawn through it when present. The Electron
  host binds `OffThreadProcessSpawner` (`SDK_TOKENS.SDK_PROCESS_SPAWNER`,
  `agent-sdk/src/lib/di/register.ts:316`); a host that binds nothing keeps
  today's inline `crossSpawn`.
- This is the primitive TASK_2026_341 already built: inline spawn froze the main
  process ~1.6 s per launch; off-thread the host loop max delay stayed at 29 ms.
- **Do not** add a settled cache for `getGitInfo` — its exclusion is documented
  and deliberate (`git-info.service.ts:253-257`). The remedy is _where_ the spawn
  runs, not _whether_ it runs.

### Batch 11 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/agent-sdk ptah-electron
npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk ptah-electron
npx nx affected -t typecheck
```

Read back `Running target test for 3 projects`. Acceptance: `git:info` spawns off
the main thread under the Electron host and inline elsewhere;
`auth:getAuthStatus` reuses a persisted verdict on the second boot; a corrupt
persisted entry is ignored without throwing.

Commit: `perf(vscode-core): batch 11 - spawn git off-thread and persist cli detection across boots`

---

## Batch 12: Contested-lib triage, docs, and the after-measurement — PENDING

- Components: 4's remaining classification; documentation; Track B and C proof
- Recommended executor: **CLI lanes x 3** for the triage, then `senior-tester`
  for the measurement, then a `backend-developer` sub-agent for docs
- Fallback executor: `backend-developer` sub-agent, sequential
- Execution mode: mixed — `parallel` for 12.1, `sub-agent` for 12.2 and 12.3
- Depends on: Batches 1-11 all COMPLETE
- Files owned (exclusive at this point — their owning batches have landed):
  - suppression comments in `libs/backend/rpc-handlers`,
    `libs/backend/vscode-core`, `libs/backend/agent-sdk`, `apps/ptah-electron`
  - `tools/degradation-audit/baseline.json`
  - per-lib `CLAUDE.md` for `persistence-sqlite`, `thoth-runtime`, `vscode-core`,
    `shared`, `apps/ptah-electron`
  - root `CLAUDE.md` — the `npx nx reset` gotcha (380 item 15)
  - `D:/projects/ptah-extension/.ptah/specs/TASK_2026_383/test-report.md`,
    `future-enhancements.md`

### Task 12.1: triage the four contested libs — COMPLETE (`096c1719f`, 61 files, +323/-9)

Ran ahead of Batch 9 (blocked on the machine window). Four
`backend-developer` sub-agent lanes instead of CLI lanes, after Batch 5's
CLI failures; rows and per-lane reports in `triage/`.

| Directory          | Sites | Legit | Defect | Audit after      |
| ------------------ | ----- | ----- | ------ | ---------------- |
| rpc-handlers       | 40    | 39    | 1      | 1 (baseline 1)   |
| vscode-core        | 17    | 17    | 0      | 0 (entry pruned) |
| agent-sdk          | 33    | 29    | 4      | 4 (baseline 4)   |
| apps/ptah-electron | 28    | 24    | 4      | 4 (baseline 4)   |

118 sites, 109 markers, 9 defects = 7.6% (R-6 threshold ~15%, not
tripped). No `reported` labels: none of the four routes a catch through
`DegradationReporter` yet. Reviewed by `code-style-reviewer`, APPROVED,
one duplicated reason reworded by the orchestrator.

Re-baselined here (safe: no other batch mid-flight in the worktree).
TOTAL 421 → 312. `--update-baseline` also carried persistence-sqlite
6 → 5 from Batches 7-8.

Gates: audit self-test + lint green. `run-many test` for the four
projects: one suite (`skills-sh-legacy-adoption`) timed out under
parallel load; rpc-handlers then passed whole in isolation
(94 / 2715). vscode-core 31 / 503, agent-sdk 35 / 480, ptah-electron
86 / 1439 green in one pass.

**Correction to the commit record** (same hazard as Batch 5): the
pre-commit `nx format:write` collapsed an empty `dispose(): void {}`
body in `apps/ptah-electron/src/di/electron-adapters.ts` and removed
two blank lines in `agent-sdk/.../claude-cli-path-resolver.ts`. The
committed diff is therefore not literally comment-only; the three
changes are whitespace-only and semantically inert. The commit message
claims "zero non-comment lines"; this record is the correction. Not
amended (repo rule: new commits, never amend).

Nine defects recorded for a follow-up task (per-site fixes in the lane
reports): rpc-handlers `agent-rpc.handlers.ts:947`; agent-sdk
`subagent-message-dispatcher.ts:424`, `sdk-transcript-reader.adapter.ts:40`,
`session-importer.service.ts:634`, `settings-export.service.ts:96`;
ptah-electron `editor-rpc.handlers.ts:977`, `ipc-bridge.ts:313`,
`electron-browser-capabilities.ts:433,513`. Two out-of-scope notes from
the electron lane: `electron-safe-storage-vault.ts:116-119` reads
`/etc/machine-id` outside its try, so the AES-GCM fallback is unreachable
on Windows/macOS; `electron-browser-capabilities.ts:610` returns an
object carrying an `error` field that the detector does not flag.

- One lane per lib, max 3 concurrent: `rpc-handlers` (~19), `vscode-core` (~14),
  `apps/ptah-electron` (~14), `agent-sdk` (~13). Same three labels, same
  suppression syntax, same prohibition on behavioural change.
- Re-baseline and commit the lowered counts.
- If Batch 5's R-6 gate tripped, this task does not run until the burn-down plan
  is re-scoped.

### Task 12.2: after-measurement — PENDING

- Re-run Batch 9's exact method. Both tables go into `test-report.md` — the 380
  numbers as the before, these as the after.
- **Track B target**: no main-thread event-loop lag spike above 500 ms
  attributable to the backup, on the first boot that applies a pending migration
  against a copy of a real ~1 GB database. The one-time migration-apply cost
  itself (27.3 s in the 380 report) is **not** in scope — that is `applyOne`
  executing SQL, not the backup.
- **Track C target**: main-thread lag spikes under 500 ms across the full 15 s
  window after the first answered RPC.
- Assert a healthy Electron boot emits **zero** degradation events, end to end.

### Task 12.3: documentation and naming debt — COMPLETE except A-2 (`96f20674d`, 5 files, +72/-3)

`future-enhancements.md` created in the task folder (27 recorded defects
with suggested fixes, tool follow-ups, flakiness task, rename trigger,
380 item 5 placement, A-2 placeholder). Root `CLAUDE.md` gained the
`nx reset` paragraph; `vscode-core`, `shared`, `ptah-electron`,
`thoth-runtime` CLAUDE.md files refreshed. `persistence-sqlite` verified
current. Remaining: the A-2 `PRAGMA optimize` line, after Batch 9.

- Record in `future-enhancements.md`: the integrity-worker rename to a neutral
  `db-worker` name, with its explicit trigger — **rename when a third command
  lands**. Deliberately not done here because the rename touches the esbuild
  target name in three wiring places per host, on a branch that must rebase.
- Record 380 follow-up item 5 (escalate N consecutive `unavailable` verdicts) as
  belonging in the single-row `db_integrity_check_state` table from migration
  `0042`, **not** in the reporter — the reporter's counts are deliberately
  in-memory and per-boot.
- Record A-2's answer if `PRAGMA optimize` proved costly, and any defect rows the
  triage lanes found but did not fix.
- Root `CLAUDE.md`: the `npx nx reset` gotcha.

### Batch 12 verification

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
npx nx reset
npx nx run degradation-audit:self-test && npx nx run degradation-audit:lint
npx nx run di-lint:self-test && npx nx run di-lint:lint
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers @ptah-extension/agent-sdk
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/chat-state @ptah-extension/dashboard
npx nx run-many -t test -p ptah-electron ptah-cli
npx nx affected -t typecheck
npx nx affected -t build
```

Read back the `Running target test for N projects` header on every `run-many` and
confirm N is 7, 5 and 2 respectively — a misspelled project is dropped silently.

Commit: `chore(audit): batch 12 - close the triage, record the after-measurement`

---

## Execution order and parallelism

```
Batch 1  ──┐                          Batch 3 ──┐          (parallel pair)
           ├─ Batch 2 ──┐                       ├─ Batch 4 ─┐
           │            │                                    │
           └────────────┴────────────────────────────────────┤
                                                             │
                        ┌────────────────────────────────────┤
                        │                                    │
                     Batch 5 (CLI x3)                     Batch 9 (GATE)
                        │                                    │
                     Batch 6                     ┌───────────┴───────────┐
                        │                        │                       │
                     Batch 7                  Batch 10               Batch 11
                        │                        │                       │
                     Batch 8                     └───────────┬───────────┘
                        │                                    │
                        └────────────── Batch 12 ────────────┘
```

- **Parallel-safe pairs**: (1, 3), (2, 4), (5, 6), (5, 9), (6, 9), (10, 11).
- **Strictly serial**: 1 → 2; 3 → 4; 6 → 7 → 8 (all share
  `persistence-sqlite/src/index.ts`); 9 → 10 and 9 → 11 (the measurement gate).
- **Sequencing rule, non-negotiable**: Batches 1, 2 and 4 must be COMPLETE before
  any Track B or Track C code lands. Track A's instruments exist so Tracks B and
  C can prove themselves through them.
- **Max 3 concurrent CLI lanes** in Batches 5 and 12.

## Review gates (applied by the team-leader in MODE 2)

Each batch stops at NEEDS REVIEW before any commit. The reviewer is chosen by
what the batch actually changed:

| Batch | Reviewer                           | Why                                                                                                                                    |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `code-style-reviewer`              | Contract shape, barrel and payload-map registration, dependency direction, token naming. Behaviour is trivial.                         |
| 2     | `code-logic-reviewer`              | Failure paths and the swallow fix are the whole subject.                                                                               |
| 3     | `code-logic-reviewer`              | Detector correctness and the self-test's exit-1 contract. A wrong detector bakes a wrong baseline into the repo (R-5).                 |
| 4     | `code-logic-reviewer`              | The skip-policy inversion can turn a false green into a false red (R-4).                                                               |
| 5     | `code-style-reviewer`              | Comment-only diffs; the question is whether each reason is real, not whether it runs.                                                  |
| 6     | **both** — logic first, then style | External-boundary validation, partial-artifact cleanup, chmod survival, and a union widening that must not break the leaf-import rule. |
| 7     | **both** — logic first, then style | Deleted fallback, budget choice, facade-rule split. The highest-risk batch in the task (R-3).                                          |
| 8     | `code-logic-reviewer`              | R-1's guard placement and `db:reset` ordering are behavioural.                                                                         |
| 9     | none — `senior-tester` produced it | The gate is the measured table itself. Team-leader verifies the table exists and states its cold-cache method.                         |
| 10    | `code-logic-reviewer`              | Deleting a boot fetch is only safe if PC-2's cover holds.                                                                              |
| 11    | **both** — logic first, then style | Persisted-cache invalidation is a correctness question; the optional port injection is a boundary question.                            |
| 12    | `code-style-reviewer`              | Documentation, suppressions and recorded measurements.                                                                                 |

Reject any batch on: TODO / PLACEHOLDER / STUB markers, empty method bodies,
hardcoded mock data standing in for real logic, logging that replaces an
implementation, a suppression comment with no reason, or a `nx test a b c`
invocation anywhere in a report.

## Rebase step (after PR #463 merges)

While #463 is open, `task/383-degradation-audit` stays on
`electron-cold-start-380`. When it merges:

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-383
git fetch origin
git rebase origin/main
```

**Rebase, do not merge `main` in.** The expected conflict surface is small and
predictable: `apps/ptah-electron/project.json`,
`libs/backend/persistence-sqlite/src/lib/di/{tokens,register}.ts`,
`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`,
`libs/shared/src/index.ts`, and `.github/workflows/ci.yml`. Keeping the
worker/port/token/**target** names unchanged is what keeps that surface small —
a build-target rename is the hazard `apps/ptah-electron/CLAUDE.md` warns about.

After the rebase, re-run Batch 12's full verification block before opening the
PR. Never open a PR against a `release/*` branch and never merge into one.
