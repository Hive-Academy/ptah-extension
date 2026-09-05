# Batches - TASK_2026_380

Total tasks: 14 components in 16 tasks | Batches: 5 | Complete: 0/5

**Repository root for every path in this file (a git worktree on branch
`electron-cold-start-380`):**
`D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`

> **Path translation is mandatory.** `implementation-plan.md` writes every file
> path as `D:/projects/ptah-extension/...` (the main checkout). Every executor
> MUST rewrite that prefix to
> `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/...`
> before any Read or Write. Editing the main checkout would put this task's work
> on `main` outside the branch and outside every commit made here.

**Execution constraints for this task**

- CLI delegation is DISABLED (user decision, `context.md`). Sub-agents only:
  `backend-developer`, `frontend-developer`, `devops-engineer`, `senior-tester`,
  `code-logic-reviewer`, `code-style-reviewer`.
- No executor edits this file. The team-leader owns every status word here.
- No executor commits. One commit per batch, made by the team-leader after an
  accepting review verdict.
- Commit convention (commitlint-conventional, husky must run — never
  `--no-verify`): `perf(scope): batch N - …` / `feat(scope): …` /
  `refactor(scope): …`, body optional, message ending with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never `nx test a b c` — Nx runs the first project only and turns the rest into
  Jest path filters, exiting 0 having run nothing. Always
  `npx nx run-many -t test -p …`, and read the
  `Running target test for N projects` header to confirm N.

---

## Plan validation

Status: **PASSED WITH RISKS**

Anchors re-verified on disk in this worktree at `7619bebd2` (the same commit the
plan was written against). All of the following hold exactly as the plan claims:

| Claim                                                                                                                                                                                                                                         | Verified                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `runBootChecks` at `sqlite-connection.service.ts:602`, called at `:214`                                                                                                                                                                       | yes, both lines                                  |
| Highest shipped migration is `0041`; next id is `0042`                                                                                                                                                                                        | yes (`migrations/index.ts:69,317`)               |
| `SkillTriggerService.start()` runs `void this.runBootScan(...)` synchronously behind `readBootScanFlag()`                                                                                                                                     | yes (`skill-trigger.service.ts:166-169`)         |
| `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS = 24 h`                                                                                                                                                                                                | yes (`skill-md-migration.ts:57`, read at `:226`) |
| `ALLOWED_METHOD_PREFIXES` exists at `rpc-handler.ts:44` and has no `'boot:'`                                                                                                                                                                  | yes                                              |
| `boot-heavy-services.ts` anchors: `bootThothRuntime` `:139`, `markPersistenceSettled` `:150`, `refreshUserLayer` `:176`, `reconcileHarness` `:235`, `scanAndImport` `:319`, duck-typed `broadcastMessage` `:350-358`, `startThothCron` `:370` | yes, every one                                   |
| File sizes: `boot-coordinator.ts` 468, `sqlite-connection.service.ts` 839, `skill-trigger.service.ts` 922, `start-thoth-cron.ts` 307, `electron-shell.component.ts` 363                                                                       | yes                                              |
| Electron header right-hand group `<div class="flex items-center gap-0.5 no-drag">` containing `<ptah-theme-toggle />`                                                                                                                         | yes (`electron-shell.component.ts:209-212`)      |
| `app.html` loading branch `@if (appState.isLoading() \|\| isInitializing())` with a bare spinner                                                                                                                                              | yes (`app.html:4-13`)                            |
| `MESSAGE_HANDLERS` provider array in `app.config.ts:112-125`                                                                                                                                                                                  | yes                                              |
| `measure-boot-rpcs.mjs` exists                                                                                                                                                                                                                | yes (`apps/ptah-electron-e2e/scripts/`)          |

Assumptions:

- **A-1 — a read-only `better-sqlite3` connection can open the WAL database while
  the main process holds it open.** Unverified with the app running. The worker
  must classify any open failure as `unavailable` and write **no** record.
  Verified by Task 2.1's failure-path spec and by Batch 5's live cold boot.
- **A-2 — `cli-engine` calls `startThothCron`.** **REFUTED by grep in this
  worktree: `startThothCron` appears nowhere under
  `libs/backend/cli-engine/src`.** The plan pre-authorised this outcome
  ("state it in the batch notes rather than adding a second dispatch site"), so
  scope is unchanged: the CLI ships the worker factory and the port answer, and
  simply never dispatches. Task 2.2 must carry a one-line comment at the CLI
  registration site saying exactly that, so the next reader does not mistake an
  uncalled factory for dead code.
- **A-3 — `rpc.types.ts` line anchors** (`:629`, `:3391`, `:3805`) came from a
  directed sub-agent read, not the architect's own. Task 3.3 opens the file and
  reads before editing; a missing `RPC_METHOD_ENTRIES` key is a compile error, so
  the backstop is real.
- **A-4 — `context.md`'s `skippedByMarker:false` reading** is contradicted by the
  live table; the plan treats root cause 4 as refuted. Task 1.5 adds the
  `markerOutcome` token that will name the true cause on the next launch either
  way. No scope change.

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Severity | Mitigation                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`apps/ptah-electron/project.json` has THREE more worker-build call sites the plan does not name** — `build-dev.commands` (`:222-223`) and `serve`'s watch `commands` (`:273-274`) each list `build-embedder-worker` and `build-voice-worker` explicitly, in addition to `build.dependsOn` (`:187-191`). Adding only `build.dependsOn` leaves `electron:serve` and every dev build without `integrity-worker.mjs`, so the factory finds no file and the check silently never runs in development. | HIGH     | Task 2.2 must add `build-integrity-worker` to **all four** lists and say so in its report. Batch 2 verification runs `nx build ptah-electron` **and** asserts `dist/apps/ptah-electron/integrity-worker.mjs` exists.                                                        |
| Executors edit the main checkout instead of the worktree, because every path in `implementation-plan.md` is written against `D:/projects/ptah-extension/`.                                                                                                                                                                                                                                                                                                                                         | HIGH     | The path-translation rule at the top of this file is repeated in every batch prompt. Batch verification runs `git status --short` from the worktree and rejects a batch whose files are not dirty there.                                                                    |
| A new RPC namespace missing from `ALLOWED_METHOD_PREFIXES` throws at **registration**, i.e. crashes the app at boot rather than failing a test.                                                                                                                                                                                                                                                                                                                                                    | HIGH     | Task 3.3 is the dual-registration task and lands `'boot:'` in `rpc-handler.ts`, the `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` entries, and the `manifest.ts` partition entry **in one task**. `rpc-allowlist.spec.ts` is the gate; Batch 3 does not close until it passes. |
| Migration `0042` written into the developer's real `~/.ptah/state/ptah.sqlite` leaves an older installed build unable to open it.                                                                                                                                                                                                                                                                                                                                                                  | HIGH     | Every harness or manual run in Batches 1-5 sets `PTAH_DB_PATH` to a **temp copy**. Named in Task 1.1's acceptance criteria and in Batch 5's.                                                                                                                                |
| `SkillTriggerService`'s 17-argument constructor is built positionally by two specs; a new parameter breaks both.                                                                                                                                                                                                                                                                                                                                                                                   | MEDIUM   | Task 1.4 adds fields and methods only, **no constructor parameter**. Batch 1 verification runs the existing `skill-trigger.service.spec.ts` and `skill-trigger.integration.spec.ts` unchanged.                                                                              |
| Five shared files are touched by two components each (`boot-heavy-services.ts`, `message-constants.ts`, `core/services/index.ts`, `app.config.ts`, `chat-ui/src/index.ts`). Splitting a pair across batches or lanes produces a merge conflict on every hunk.                                                                                                                                                                                                                                      | MEDIUM   | The batching below keeps each pair inside one batch **and** one task owner: 8 + 14c in Task 1.6; 10 + 14b in Batch 3; 12 + 13 + 14d + 14e in Batch 4.                                                                                                                       |
| Components 6 and 9 both touch `platform-core` (different files: `file-settings-keys.ts` vs `di/tokens.ts` + `index.ts`) and this is one worktree.                                                                                                                                                                                                                                                                                                                                                  | MEDIUM   | 6 is in Batch 1, 9 in Batch 3. Sequential batches, so they never run concurrently. Within Batch 1, only lane S touches `platform-core`.                                                                                                                                     |
| The boot screen dismisses at `phase === 'harness'`; a host that never emits `harness` would leave the user behind the screen.                                                                                                                                                                                                                                                                                                                                                                      | MEDIUM   | `BootStatusService` defaults to `ready` (Task 4.1), so the screen renders only after a `warming` push actually arrives, and `failed` routes to the existing error branch. Task 4.2's spec covers the unknown-phase degrade.                                                 |
| The dispatch timer or the worker keeps the process alive on quit.                                                                                                                                                                                                                                                                                                                                                                                                                                  | MEDIUM   | Task 2.3's boot dispatch is `unref`'d; Task 1.3's service kills the worker after a bounded budget. Both asserted by call-count specs.                                                                                                                                       |
| `INDEXING_PROGRESS` fires per file; thousands of events could evict every other subsystem from a 50-slot ring.                                                                                                                                                                                                                                                                                                                                                                                     | LOW      | Task 4.3 implements the 750 ms latest-wins coalescing and the two specs that pin it (100 messages 10 ms apart → one slot; two 2 s apart → two slots).                                                                                                                       |
| `chat-ui` gaining a dependency for the ticker animation.                                                                                                                                                                                                                                                                                                                                                                                                                                           | LOW      | CSS-only transition. Task 4.4 adds no package; Batch 4 review checks `chat-ui`'s externals are unchanged.                                                                                                                                                                   |

Edge cases:

- Worker cannot load `better-sqlite3` / cannot open the file / the pragma throws
  ⇒ `unavailable`, **no record written**, next window retries — Task 1.3, Task 2.1.
- `checked_at > now` (clock skew) ⇒ due — Task 1.3.
- Two `dispatchIfDue()` calls in flight ⇒ one spawn — Task 1.3.
- No worker factory registered (any host without one) ⇒ one `info` log, no
  dispatch, no throw — Task 1.3.
- `bootScanDelayMs: 0` restores the previous immediate scan; `backoffMs: 0`
  ignores activity — Task 1.4.
- A settings write to an unregistered key is silently dropped ⇒ both new keys go
  in `FILE_BASED_SETTINGS_KEYS` **and** `FILE_BASED_SETTINGS_DEFAULTS` — Task 1.4.
- Marker store `write` throws ⇒ `markerWritten === false` with `errors: []` —
  Task 1.5.
- A push emitted at `did-finish-load` is lost because Angular is not yet
  listening ⇒ the pull RPC is mandatory, and `once` becomes `on` so a renderer
  reload is also covered — Task 3.2, Task 3.3.
- `WEBVIEW_MANAGER` absent or throwing at emit time ⇒ caught, warned, boot
  continues — Task 3.2, Task 3.4.
- VS Code webview never receives `boot:readinessChanged` ⇒ `BootStatusService`
  defaults to `ready` so the shell is never gated there — Task 4.1.
- Malformed activity payload ⇒ dropped by `isActivityEventPayload`, never
  rendered — Task 1.6, Task 4.3.
- `phase === 'settled'` produces no ticker item; an empty `items()` renders the
  idle dot; an empty `summary` falls back to the `source` label — Task 4.3, 4.4.

---

## Batch 1: Foundations — persistence state, skill deferral, wire contracts — IN_PROGRESS

- Components: 1, 2, 3 (lane P) · 6, 7 (lane S) · 8, 14c (lane C)
- Recommended executor: `backend-developer` — one per lane (three sub-agents), or
  one sub-agent running the three lanes back to back
- Fallback executor: a single `backend-developer` doing 1.1 → 1.6 sequentially
- Execution mode: **parallel across the three lanes, sequential inside each lane**
- Rationale: the three lanes share no file and no project (`persistence-sqlite` /
  `skill-synthesis` + `platform-core` / `libs/shared`), so three sub-agents in
  this one worktree cannot collide on an edit. Inside lane P the order is
  strict — 1 → 2 → 3 — because the service reads the store and drives the port.
  **No lane runs `nx` commands**; the team-leader runs the whole verification set
  once after all three report, so the Nx daemon is never driven by three agents
  at once.
- Tasks: 6 | Depends on: none

### Task 1.1: Migration `0042` + `IntegrityCheckStateStore` (component 1) — PENDING

- Lane: P
- Files:
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.ts`
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.spec.ts`
  - MODIFY `…/libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (append only)
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.ts`
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check-state.store.spec.ts`
- Plan reference: implementation-plan.md:287-329
- Pattern to follow: `libs/backend/persistence-sqlite/src/lib/migrations/0041_skill_md_migration_state.ts:60-65`;
  store shape `libs/backend/skill-synthesis/src/lib/skill-md-migration-state.store.ts:38-97`
- Quality requirements: static SQL only, no `${…}` interpolation
  (ESLint `no-template-curly-in-migration`, Semgrep `sql-injection-in-migration`);
  `MIGRATIONS` is forward-only and append-only; `CREATE TABLE IF NOT EXISTS`,
  no rebuild, no backfill; `catch (error: unknown)`.
- Validation notes: single row keyed `id INTEGER PRIMARY KEY CHECK (id = 1)` —
  the record describes the file it lives in, which is why `0041`'s per-root key
  is deliberately NOT copied. Absence of the row means "never checked".
- Implementation details: columns `checked_at`, `quick_check_ok`,
  `foreign_key_violations`, `duration_ms`, `page_count` all `INTEGER NOT NULL`,
  `detail TEXT` nullable. `read` returns `null` on any throw (a missing record may
  only cause a check to run, never to be skipped); `write` warns and swallows;
  the store absorbs `PERSISTENCE_UNAVAILABLE` from `connection.db`.
- Acceptance: the migration spec applies the SQL **twice** against an in-memory
  database and asserts idempotence and column shape; the store spec drives a stub
  connection and asserts read-degrades-to-`null` and write-swallows. Any manual
  run against a real database uses a temp copy via `PTAH_DB_PATH`.

### Task 1.2: Integrity worker entry, protocol and port (component 2) — PENDING

- Lane: P | Depends on: Task 1.1
- Files:
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts`
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/worker-process.port.ts`
- Plan reference: implementation-plan.md:331-376
- Pattern to follow: transport shim copied verbatim from
  `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:33-83`; port
  shape from `…/embedder/worker-process.port.ts:9-20`; three-valued verdict from
  `libs/backend/persistence-sqlite/src/lib/backup.service.ts:44-53`
- Quality requirements: must **not** import `electron`; opens with
  `readonly: true` and `fileMustExist: true`; never writes; depends on nothing in
  the monorepo except its own protocol module so it stays bundleable in isolation.
- Validation notes: risk A-1. An open failure, a missing native module, a locked
  file or a thrown pragma all resolve to `'unavailable'` — **never** `'corrupt'`.
  `'corrupt'` is reserved for `quick_check` returning something other than `'ok'`.
- Implementation details: request `{ id, type: 'check', dbPath }`; response
  `{ id, ok: true, verdict, quickCheck, foreignKeyViolations, durationMs, pageCount, detail }`
  or `{ id, ok: false, error }`. Electron `process.parentPort` delivers `{ data }`,
  `node:worker_threads` `parentPort` delivers the raw payload.
- Acceptance: the protocol module and the verdict-classification function are
  pure and unit-tested; the entry itself is exercised end to end by Task 1.3's
  spec through a fake factory.

### Task 1.3: `SqliteIntegrityService` + deletion of `runBootChecks` (component 3) — PENDING

- Lane: P | Depends on: Task 1.1, Task 1.2
- Files:
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`
  - CREATE `…/libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.spec.ts`
  - MODIFY `…/libs/backend/persistence-sqlite/src/lib/di/tokens.ts`
  - MODIFY `…/libs/backend/persistence-sqlite/src/lib/di/register.ts`
  - MODIFY `…/libs/backend/persistence-sqlite/src/index.ts`
  - REWRITE (deletion) `…/libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` —
    delete `runBootChecks` (`:602-635`) **and** its call site (`:214`), nothing else
- Plan reference: implementation-plan.md:378-427
- Pattern to follow: `EMBEDDER_WORKER_PATH` token entry in the same
  `di/tokens.ts`; optional-factory injection as `memory-curator` does it
- Quality requirements: **delete, do not disable** — no flag, no dead branch, no
  second path beside the new one; `catch (error: unknown)` throughout; the
  dispatch is `unref`-safe and must not keep the process alive; `export type` for
  type re-exports from `src/index.ts`; `sqlite-connection.service.ts` (839 lines)
  must shrink, never grow.
- Validation notes: the check has never gated anything (it is wrapped in
  `try/catch` and never marks the connection unavailable), so removing it from
  the boot path is behaviour-preserving, not a weakening.
- Implementation details: `DB_INTEGRITY_CHECK_INTERVAL_MS = 7 days`. Due when
  there is no record, when `now - checked_at >= interval`, when `checked_at > now`
  (clock skew), or when the last verdict was not `'ok'`. Public surface is exactly
  `isDue(now?)` and `dispatchIfDue()`. `dispatchIfDue()` never throws and never
  rejects; no factory ⇒ one `info` log and return; `unavailable` ⇒ warn and write
  **no** record; a dispatch already in flight ⇒ no-op; the worker is killed after
  a bounded budget.
- Acceptance (call counts, never timings): due-with-no-record dispatches once; a
  6-day-old record dispatches zero times; an 8-day-old record dispatches once; a
  failed prior verdict dispatches regardless of age; two concurrent
  `dispatchIfDue()` calls produce one spawn; an `unavailable` verdict writes zero
  records; a clean verdict writes exactly one.

### Task 1.4: Skill boot-scan deferral + settings keys (component 6) — PENDING

- Lane: S
- Files:
  - MODIFY `…/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`
  - MODIFY `…/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`
  - MODIFY `…/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts`
  - CREATE `…/libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.boot-defer.spec.ts`
  - MODIFY `…/libs/backend/platform-core/src/file-settings-keys.ts`
- Plan reference: implementation-plan.md:520-576
- Pattern to follow: `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:864-893`
  (`scheduleBootScan`), `:895-917` (readers, `readPositiveMs` and its "`0` is a
  legal value" rule), `:98-108` (fields), `:269-273` (activity stamp), `:241-245`
  (teardown); spec modelled on `memory-trigger.boot-defer.spec.ts`
- Quality requirements: **no new constructor parameter** — the 17-argument
  constructor is built positionally by `skill-trigger.service.spec.ts` and
  `skill-trigger.integration.spec.ts`; the file (922 lines) may gain only the
  nameable set below; the timer is `unref`'d.
- Validation notes: `SkillTriggerService.onActivity` (`:214-234`) does **not**
  stamp an activity instant today — the re-arm has no input until the stamp is
  added at the top of that method, **above** the `idleMs <= 0` early return at
  `:217`. Both new keys go in `FILE_BASED_SETTINGS_KEYS` **and**
  `FILE_BASED_SETTINGS_DEFAULTS`; the memory precedent of omitting them is a
  latent write-dropped bug, not a pattern to copy.
- Implementation details: adds `bootScanTimer`, `lastActivityAt: number | null`,
  `scheduleBootScan`, `readBootScanDelayMs`, `readBootScanIdleBackoffMs`,
  `readPositiveMs`, and one stamp line. `start()` `:166-169` calls
  `scheduleBootScan` **instead of** `void this.runBootScan(...)` — the old call
  does not survive behind a flag. `stop()` clears the timer before aborting the
  controller and nulls `lastActivityAt`. New keys
  `skillSynthesis.triggers.bootScanDelayMs` (300 000) and
  `…bootScanIdleBackoffMs` (300 000), kept out of `SKILL_TRIGGER_PREFIXES` and the
  settings-panel DTO.
- Acceptance: six cases in the new spec, under
  `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })` and the
  existing `advance` / `advanceUntil` helpers — nothing enqueued synchronously
  from `start()`; enqueued once after the delay; re-armed and deferred on
  activity then run after a full backoff; `stop()` cancels a pending scan;
  `delayMs: 0` runs immediately; `backoffMs: 0` ignores activity. Both existing
  trigger specs pass unchanged. `file-settings-keys.spec.ts`'s
  `DEFAULTS ⊆ KEYS` parity rule still passes.

### Task 1.5: SKILL.md rescan policy + marker diagnostics (component 7) — PENDING

- Lane: S | Depends on: nothing (may run before or after Task 1.4; different files)
- Files:
  - MODIFY `…/libs/backend/skill-synthesis/src/lib/skill-md-migration.ts`
  - MODIFY `…/libs/backend/skill-synthesis/src/lib/skill-md-migration.marker.spec.ts`
- Plan reference: implementation-plan.md:578-625
- Pattern to follow: the file's own call-counts-not-timing rule
  (`skill-md-migration.marker.spec.ts:5-7`) and its seven-mutation ledger header
- Quality requirements: the marker may only ever cause a walk, never wrongly
  prevent one — every new token maps to "walk" except `'current'`; the existing
  ledger header is updated, not bypassed.
- Validation notes: assumption A-4. There is **no defect** here — the live table
  proves the marker write path works; the 24 h ceiling is the real cause.
- Implementation details: `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS` → 7 days with a
  comment recording the justification. `MigrationResult` gains
  `markerOutcome: 'current' | 'no-store' | 'absent' | 'version-mismatch' | 'stale' | 'future-stamped' | 'unreadable'`
  and `markerWritten: boolean`; `isMarkerCurrent` returns the token;
  `skippedByMarker` becomes `markerOutcome === 'current'` and is kept for wire
  compatibility. `writeMarker` returns whether it stored anything. The two
  `logger.info` call sites (`skill-synthesis.service.ts:354-358`, `:365-369`)
  already spread the whole result, so no call-site change.
- Acceptance: one spec case per `markerOutcome` token, each asserting the token
  **and** whether `readdirSync`/`readFileSync` ran; plus a case where the store's
  `write` throws asserting `markerWritten === false` with `errors: []`.

### Task 1.6: Boot readiness widening + activity wire contract (components 8 + 14c) — PENDING

- Lane: C
- Files:
  - MODIFY `…/libs/shared/src/lib/types/rpc/rpc-readiness.types.ts`
  - MODIFY `…/libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts`
  - MODIFY `…/libs/shared/src/lib/types/rpc/rpc.types.ts` (registry entry + `RPC_METHOD_ENTRIES`)
  - CREATE `…/libs/shared/src/lib/types/rpc/rpc-activity.types.ts`
  - CREATE `…/libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts`
  - MODIFY `…/libs/shared/src/lib/types/messages/message-constants.ts` (**both** the
    comment rewrite at `:112-118` and the new `ACTIVITY_EVENT` constant — one owner)
  - MODIFY `…/libs/shared/src/lib/types/messages/message-type.ts`
  - MODIFY `…/libs/shared/src/lib/types/messages/payload-map.ts`
  - MODIFY `…/libs/shared/src/index.ts`
- Plan reference: implementation-plan.md:627-674 (component 8) and 1070-1112 (14c)
- Pattern to follow: `BACKEND_READINESS_VALUES` (`rpc-readiness.types.ts:47-55`)
  for the tuple + guard idiom; `isRpcReadinessError` (`:102-108`) for the
  admission-gate idiom
- Quality requirements: the message protocol is **append-only** — nothing is
  renamed (`libs/shared/CLAUDE.md` guideline 5); `export type` for every type
  re-export; `libs/shared` imports nothing from the monorepo; the payload is
  **widened, not forked** — no `V2` type, no parallel message.
- Validation notes: the `phase` label reverses the letter of two doc comments
  (`message-constants.ts:112-118`, `rpc-readiness.types.ts:83-89`). **Both
  comments must be rewritten in this same edit** to say that `phase` is a
  display-only label with no consumer semantics and the message stays
  edge-triggered — a type and its documentation must not disagree. Assumption A-3
  applies to `rpc.types.ts`: open and read before editing.
- Implementation details:
  `BootPhase = 'starting' | 'database' | 'harness' | 'sessions' | 'index' | 'settled'`,
  `BOOT_PHASE_VALUES`, `isBootPhase`; `BootReadinessChangedPayload` gains
  `phase`, optional `detail`, `startedAt`;
  `BootGetReadinessResult = BootReadinessChangedPayload`.
  `ActivitySource = 'boot' | 'memory' | 'indexing' | 'skills' | 'cron' | 'harness' | 'sessions' | 'embedder' | 'vec' | 'database'`,
  `ActivityLevel = 'info' | 'warn'` (**no `'error'`** — a ticker must not become
  the de-facto error surface), `ActivityEventPayload`, `ACTIVITY_SOURCE_VALUES`,
  `isActivitySource`, `isActivityEventPayload`. Add the `boot:getReadiness`
  method to `RpcMethodRegistry` **and** `RPC_METHOD_ENTRIES`.
- Acceptance: `isBootPhase` accepts every member and rejects a near-miss;
  `BOOT_PHASE_VALUES` and the union agree by `satisfies`;
  `isActivityEventPayload` accepts a minimal valid payload and rejects an unknown
  `source`, a non-finite `timestamp` and a missing `summary`; the payload types
  compile against `payload-map.ts`.

### Batch 1 verification

Run by the team-leader once, after all three lanes report:

```
npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis @ptah-extension/platform-core @ptah-extension/shared
npm run typecheck:all
npm run lint:all
```

- `Running target test for 4 projects` appears in the header.
- Every listed artifact exists on disk **in the worktree** (`git status --short`
  shows them).
- `runBootChecks` returns zero hits in `sqlite-connection.service.ts`.
- No `nx build` is required by this batch.
- Reviewer: **code-logic-reviewer** (failure paths, degrade rules, the deletion),
  then **code-style-reviewer** (migration idiom, `export type`, boundaries).
- Commit: `perf(persistence-sqlite): batch 1 - move integrity state off the boot path`

---

## Batch 2: Integrity worker hosts, build targets and scheduling — PENDING

- Components: 4, 5
- Recommended executor: `backend-developer` (the two factory classes, the DI
  registrations and the `thoth-runtime` seam), optionally handing the four
  `project.json` list edits and `tsconfig.integrity-worker.json` to
  `devops-engineer`
- Fallback executor: `backend-developer` for the whole batch — the esbuild targets
  are copies of an existing one
- Execution mode: **sequential**
- Rationale: component 4 implements the port Batch 1 declared and component 5
  calls the service Batch 1 built; both touch host wiring, and 5's spec extends
  the same `start-thoth-cron.spec.ts` that Batch 3 will extend again, so keeping
  them in one owner avoids a second pass over that file.
- Tasks: 2 | Depends on: Batch 1 (lane P)

### Task 2.1: Host integrity worker factories (component 4, code half) — PENDING

- Files:
  - CREATE `…/apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts`
  - CREATE `…/libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`
  - MODIFY `…/apps/ptah-electron/src/di/phase-2-libraries.ts` (insert beside the
    embedder factory at `:306-308`, before `registerPersistenceSqliteServices` at `:310`)
  - MODIFY `…/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts` (beside `:77-79`)
- Plan reference: implementation-plan.md:429-475
- Pattern to follow: `apps/ptah-electron/src/services/platform/electron-embedder-worker-factory.ts:44-63`
  (`utilityProcess.fork(path, [], { serviceName })`, immediate init post);
  `libs/backend/cli-engine/src/lib/thoth/cli-embedder-worker-factory.ts:14-40`
  (`node:worker_threads`)
- Quality requirements: `electron` stays in the Electron app, `node:worker_threads`
  stays in `cli-engine`; neither leaks into `persistence-sqlite`; the worker path
  is derived from `__dirname` exactly as both existing sites do; registration
  failure is caught by the existing try/catch and degrades to "no factory".
- Validation notes: **assumption A-2 is refuted — `cli-engine` never calls
  `startThothCron`, so the CLI registers a factory that nothing will dispatch.**
  This is the accepted degrade for a short-lived process. Add a one-line comment
  at the CLI registration site stating that the factory exists as the host answer
  to the port and that the CLI has no dispatch site today, so a future reader does
  not delete it as dead code or mistake it for a wiring bug.
- Acceptance: a spec asserting the Electron factory calls `utilityProcess.fork`
  with the configured path and returns a handle whose `on('exit')` maps the
  numeric code, mirroring the embedder factory's coverage.

### Task 2.2: Worker build targets (component 4, build half) — PENDING

- Depends on: Task 2.1
- Files:
  - CREATE `…/apps/ptah-electron/tsconfig.integrity-worker.json`
  - MODIFY `…/apps/ptah-electron/project.json`
  - MODIFY `…/apps/ptah-cli/project.json`
- Plan reference: implementation-plan.md:445-452
- Pattern to follow: the `build-embedder-worker` target in the same file
- Quality requirements: `main:
libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`,
  `outputFileName: integrity-worker.mjs`, `external: ["better-sqlite3"]`.
- Validation notes: **HIGH risk — `build.dependsOn` is not the only list.**
  `build-integrity-worker` must be added to **all four** places in
  `apps/ptah-electron/project.json`:
  `build.dependsOn` (`:187-191`), `build-dev.commands` (`:222-223`),
  `serve`'s watch `commands` (`:273-274`), and the mirror target in
  `apps/ptah-cli/project.json`'s build chain (`:157-158`). Omitting the dev and
  serve lists leaves `electron:serve` with no worker file, so the check silently
  never runs in development and nobody notices until production.
- Implementation details: report explicitly, per list, which four you edited.
- Acceptance: `nx build ptah-electron` produces
  `dist/apps/ptah-electron/integrity-worker.mjs`; `nx build ptah-cli` succeeds.

### Task 2.3: Integrity scheduling seam in `thoth-runtime` (component 5) — PENDING

- Depends on: Task 2.1
- Files:
  - MODIFY `…/libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
  - MODIFY `…/libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`
- Plan reference: implementation-plan.md:477-518
- Pattern to follow: the existing handler registration guarded by `has()`
  (`start-thoth-cron.ts:206`, `:103`) and `jobStore.upsert` (`:253-260`); the
  file's own non-fatal try/catch idiom
- Quality requirements: `persistence-sqlite` must never import `cron-scheduler`
  (the seam rule at `:30-40`); the dispatch is **never** awaited anywhere; the
  file is 307 lines and must stay well under the ceiling.
- Validation notes: cron expression `30 3 * * *` UTC — deliberately not `0 3`
  (the daily backup) and not `0 4` (the weekly skills drain), so an integrity read
  never contends with a 1 GB backup write on the same tick. Boot dispatch is a
  60 000 ms `unref`'d `setTimeout`, chosen so it cannot land inside the window
  Task 1.4 is clearing; it is not a setting.
- Implementation details: resolve `PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE`
  through the container guarded by `isRegistered`; job id
  `@ptah/db-integrity-check`, which appears in the existing `cron:list` surface
  for free.
- Acceptance: the handler registers once across two `startThothCron` calls; the
  job is upserted with the expected id and expression; the boot timer is `unref`'d
  and calls `dispatchIfDue` exactly once; a container without the integrity
  service registers nothing and throws nothing.

### Batch 2 verification

```
npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/persistence-sqlite ptah-electron
npm run typecheck:all
npm run lint:all
nx build ptah-electron
nx build ptah-cli
```

- `dist/apps/ptah-electron/integrity-worker.mjs` exists after the build.
- All four worker-target lists were edited and named in the report.
- Reviewer: **code-logic-reviewer** (degrade paths, `unref`, never-awaited
  dispatch), then **code-style-reviewer** (host/lib boundary, no `electron` in a
  lib).
- Commit: `perf(thoth-runtime): batch 2 - run the database integrity check out of process`

---

## Batch 3: Boot readiness port, RPC, Electron activation and the activity emitter — PENDING

- Components: 9, 10, 11, 14b
- Recommended executor: `backend-developer` (Electron main-process activation is
  backend work, not UI)
- Fallback executor: a second `backend-developer` pass on the RPC dual
  registration if the first attempt trips the boot-time prefix throw
- Execution mode: **sequential** — 9 → 11 → 10 → 14b
- Rationale: `boot-heavy-services.ts` is the busiest file in the plan and is
  edited by both component 10 (four phase anchors) and 14b (three emit anchors) at
  overlapping line ranges; they must have one owner. Component 9 touches
  `platform-core`, which Batch 1 lane S also touched — sequential batches keep the
  two apart. Component 11's failure mode is a crash at boot, so it lands before
  the activation edits that would otherwise mask it.
- Tasks: 4 | Depends on: Batch 1 (lane C). Independent of Batch 2, but scheduled
  after it so a single reviewer sees the backend in dependency order.

### Task 3.1: `IBootReadinessProvider` port + three host answers (component 9) — PENDING

- Files:
  - CREATE `…/libs/backend/platform-core/src/interfaces/boot-readiness.interface.ts`
  - MODIFY `…/libs/backend/platform-core/src/di/tokens.ts`
  - MODIFY `…/libs/backend/platform-core/src/index.ts`
  - CREATE `…/libs/backend/vscode-core/src/services/null-boot-readiness.ts`
  - MODIFY `…/libs/backend/vscode-core/src/di/register-platform-agnostic.ts`
  - CREATE `…/apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`
  - MODIFY `…/apps/ptah-electron/src/activation/bootstrap.ts` (beside the
    `WEBVIEW_MANAGER` registration at `:342`)
- Plan reference: implementation-plan.md:675-715
- Pattern to follow: `PLATFORM_TOKENS.SESSION_ATTACHMENT_GUARD`
  (`platform-core/src/di/tokens.ts:73-79`), the
  `if (!container.isRegistered(...))` idiom at
  `vscode-core/src/di/register-platform-agnostic.ts:73-76`, and
  `vscode-core/src/services/null-session-attachment-guard.ts`
- Quality requirements: `platform-core` stays a leaf with respect to other backend
  libs and imports no `electron`; `I`-prefixed port name; `UPPER_SNAKE`
  `Symbol.for(...)` token.
- Validation notes: the interface is **synchronous** —
  `getReadiness(): BootReadinessChangedPayload` — so a handler can answer without
  awaiting. One read-only method; no transitions, no subscription (the push
  channel is separate and host-owned).
- Implementation details: the null adapter always answers
  `{ readiness: 'ready', phase: 'settled', startedAt }`, so the CLI gets a correct
  answer for free and no host can present an unregistered token.
- Acceptance: `null-boot-readiness.spec.ts` asserts the always-ready answer; a
  `register-platform-agnostic` case asserts the null adapter is **not** registered
  when one already is.

### Task 3.2: `boot:getReadiness` RPC — the four-site registration (component 11) — PENDING

- Depends on: Task 3.1
- Files:
  - MODIFY `…/libs/backend/vscode-core/src/messaging/rpc-handler.ts` (add `'boot:'`
    to `ALLOWED_METHOD_PREFIXES` at `:44`)
  - CREATE `…/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.ts`
  - CREATE `…/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.handlers.spec.ts`
  - CREATE `…/libs/backend/rpc-handlers/src/lib/handlers/boot-rpc.schema.ts`
  - MODIFY `…/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
  - MODIFY `…/libs/backend/rpc-handlers/src/index.ts`
- Plan reference: implementation-plan.md:793-839
- Pattern to follow: `persistence-rpc.handlers.ts:138-143, 159-181` (the
  `static readonly METHODS … as const satisfies readonly RpcMethodName[]` +
  `register()` convention); `db:health`'s never-throw contract (`:13-14`);
  manifest entry shape at `host-profile/manifest.ts:347-350`
- Quality requirements: **dual registration is mandatory and its failure is a boot
  crash, not a 404** — `ALLOWED_METHOD_PREFIXES` **and** the shared
  `RpcMethodRegistry` / `RPC_METHOD_ENTRIES` (landed in Task 1.6). The manifest
  entry must keep the manifest a **total, disjoint partition** of
  `RPC_METHOD_NAMES`. A Zod schema for the (empty) params, per the
  boundary-validation rule. `export type` for the result re-export.
- Validation notes: `requires: []` — no new `Capability` member, because adding
  one would force every host profile to opt in and make `resolveRpcHandlerPlan`
  throw for any profile that forgot. The handler **never throws**: any failure
  reading the port returns `{ readiness: 'ready', phase: 'settled' }`, because a
  renderer that cannot learn the boot state must not sit behind a boot screen
  forever.
- Acceptance: the handler spec asserts the method registers under the `boot:`
  prefix without throwing, returns the port's snapshot, and returns the ready
  fallback when the port throws. `rpc-allowlist.spec.ts` passes — it is the
  partition gate and this task does not close until it is green.

### Task 3.3: `BootCoordinator` phase state, broadcaster and phase anchors (component 10) — PENDING

- Depends on: Task 3.1, Task 3.2
- Files:
  - MODIFY `…/apps/ptah-electron/src/activation/boot-coordinator.ts`
  - MODIFY `…/apps/ptah-electron/src/activation/boot-coordinator.spec.ts`
  - CREATE `…/apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts`
  - CREATE `…/apps/ptah-electron/src/activation/boot-readiness-broadcaster.spec.ts`
  - MODIFY `…/apps/ptah-electron/src/activation/boot-heavy-services.ts` (**shared
    with Task 3.4 — same owner, do 3.3's anchors first**)
  - MODIFY `…/apps/ptah-electron/src/activation/post-window.ts`
  - MODIFY `…/apps/ptah-electron/src/main.ts`
  - MODIFY `…/apps/ptah-electron/src/activation/boot-order.spec.ts`
- Plan reference: implementation-plan.md:716-791
- Pattern to follow: the duck-typed broadcast surface already used at
  `boot-heavy-services.ts:350-358`; lazy `TOKENS.WEBVIEW_MANAGER` resolution
  guarded by `isRegistered` (`register-shared-rpc-handlers.ts:35-39`,
  `phase-4-handlers.ts:78`)
- Quality requirements: **`BootCoordinator` must keep every import `import type`**
  — the broadcaster closes over the container, the coordinator stores a plain
  `emit` callback and never resolves DI. The coordinator's local `BootReadiness`
  (`:62`) is **replaced** by the shared `BackendReadiness`, not kept beside it.
  The file is 468 lines and this adds roughly 40; it must stay under 700.
  `setPhase` must never throw into the boot path — the emit is wrapped.
- Validation notes: phase anchors, exactly, in `boot-heavy-services.ts`:
  `database` immediately before `await bootThothRuntime(...)` (`:139`);
  `harness` immediately after `markPersistenceSettled(...)` (`:150`) and before
  `refreshUserLayer` (`:176`); `sessions` immediately before `scanAndImport`
  (`:319`); `index` immediately before `startThothCron` (`:370`); `settled` in
  `boot-coordinator.ts`'s `startPostWindow` `.then` (`:262`). **A `skills` phase is
  deliberately absent** — it would have to be emitted from inside
  `bootThothRuntime`, and `thoth-runtime` must not know a renderer exists.
  `post-window.ts:102-104` changes `once` to `on` and re-emits `snapshot()`, which
  covers a renderer reload; this does **not** replace the pull RPC, because
  `did-finish-load` fires before Angular installs its message listener.
- Implementation details: `private phase: BootPhase = 'starting'`,
  `readonly startedAt = Date.now()`, `setPhase(phase, detail?)` (edge-triggered,
  ignores a repeat), `snapshot(): BootReadinessChangedPayload`,
  `onReadinessChange(emit)`. The broadcaster is wired in `main.ts` immediately
  after the coordinator is constructed.
- Acceptance: `setPhase` emits once per distinct phase and zero times for a
  repeat; `snapshot()` reflects the last phase and the correct readiness; a
  throwing emitter does not propagate; the `failed` transition keeps the last
  phase; `boot-order.spec.ts` asserts the sequence
  `database → harness → sessions → index → settled`.

### Task 3.4: Back-office activity emitter (component 14b) — PENDING

- Depends on: Task 3.3 (same file, `boot-heavy-services.ts`)
- Files:
  - CREATE `…/libs/backend/thoth-runtime/src/lib/activity-emitter.ts`
  - CREATE `…/libs/backend/thoth-runtime/src/lib/activity-emitter.spec.ts`
  - MODIFY `…/libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
  - MODIFY `…/libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`
  - MODIFY `…/libs/backend/thoth-runtime/src/index.ts`
  - MODIFY `…/apps/ptah-electron/src/activation/boot-heavy-services.ts` (**shared
    with Task 3.3**)
- Plan reference: implementation-plan.md:1015-1068
- Pattern to follow: the guarded bridge shape at
  `boot-thoth-runtime.ts:245-345` (`:294-299`, `:340-345` are the individually
  guarded non-fatal try/catch blocks); the best-effort push idiom at
  `skill-synthesis.service.ts:1013-1027`
- Quality requirements: **`thoth-runtime` must not learn what a ticker is** —
  `createActivityEmitter(container, logPrefix)` resolves
  `TOKENS.WEBVIEW_MANAGER` lazily, guarded by `isRegistered`, broadcasts a generic
  payload and swallows every failure. No `electron` import, no renderer type. **No
  subsystem that already broadcasts may gain a second broadcast** — only the four
  silent sources are emitted here.
- Validation notes: emission sites are split on runtime-agnosticism.
  `start-thoth-cron.ts` wraps the handlers it already registers (`backup:daily`,
  `db:integrity` from Task 2.3, the three `skills:drain:*` tiers) — this covers
  every cron job Ptah ships; user-defined jobs are deliberately out of scope, as
  they would need an event surface on `CronScheduler`. Harness reconcile and
  session import are host activation work and emit from
  `boot-heavy-services.ts` through Task 3.3's broadcaster, at the anchors after
  `refreshUserLayer` (`:176`), after `reconcileHarness` (`:235`), and after
  `scanAndImport` returns its count (`:319-330`).
- Acceptance: a wrapped handler still returns its original `{ summary }` /
  `{ outcome: 'skipped', reason }` value and emits exactly one activity event; a
  container with no `WEBVIEW_MANAGER` runs the handler, emits zero, and does not
  throw.

### Batch 3 verification

```
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime @ptah-extension/shared ptah-electron
npm run typecheck:all
npm run lint:all
nx build ptah-electron
```

- `rpc-allowlist.spec.ts` passes (the manifest partition gate).
- `boot-order.spec.ts` asserts the full phase sequence.
- `boot-coordinator.ts` contains no runtime import (`import type` only) and is
  under 700 lines.
- Reviewer: **code-logic-reviewer** (boot-path failure containment, lazy
  resolution, the lost-push/pull argument), then **code-style-reviewer**
  (hexagonal boundary of the new port, dual registration, `thoth-runtime`
  agnosticism).
- Commit: `feat(electron): batch 3 - broadcast boot readiness and back-office activity`

---

## Batch 4: Renderer — boot status, boot screen, activity service and ticker — PENDING

- Components: 12, 13, 14d, 14e
- Recommended executor: `frontend-developer`
- Fallback executor: a second `frontend-developer` pass scoped to the failing
  component only
- Execution mode: **sequential** — 12 → 14d → 13 → 14e
- Rationale: three barrels and one provider array are each touched by two
  components (`core/services/index.ts` by 12 + 14d; `chat-ui/src/index.ts` by
  13 + 14e; `app.config.ts` by 12 + 14d). One executor, one pass, no conflicts.
  12 before 13 because the screen binds the service's signal; 14d before 14e
  because the ticker binds the service's signals.
- Tasks: 4 | Depends on: Batch 1 (lane C), Batch 3

### Task 4.1: `BootStatusService` (component 12) — PENDING

- Files:
  - CREATE `…/libs/frontend/core/src/lib/services/boot-status.service.ts`
  - CREATE `…/libs/frontend/core/src/lib/services/boot-status.service.spec.ts`
  - MODIFY `…/libs/frontend/core/src/lib/services/index.ts` (**shared with Task 4.2b**)
  - MODIFY `…/apps/ptah-extension-webview/src/app/app.config.ts` (**shared with Task 4.2b**)
- Plan reference: implementation-plan.md:841-887
- Pattern to follow: `providedIn: 'root'` + `implements MessageHandler` at
  `memory-curator-ui/.../vec-embedder-recovery.service.ts:34-71`; registration
  template at `app.config.ts:112-125`
- Quality requirements: `MessageHandler` is
  `{ handledMessageTypes; handleMessage }` — **not** `messageType`/`handle`;
  signals + `inject()`; the lib's coverage floor (statements 85 %, branches 75 %,
  functions 75 %, lines 85 %); no backend import.
- Validation notes: **the initial value is `ready` and that is load-bearing.** The
  same bundle runs in the VS Code webview, where no `boot:readinessChanged` will
  ever arrive; a `warming` default would hang that host behind a boot screen
  forever. The constructor's one-shot pull is guarded by the
  `VSCodeService.isElectron` **snapshot** idiom (`app.ts:47`) — the getter at
  `vscode.service.ts:171-173` is not reactive.
- Implementation details:
  `status = signal<BootReadinessChangedPayload>({ readiness: 'ready', phase: 'settled', startedAt: Date.now() })`;
  derived `isBooting`, `phase`, `detail`, `elapsedMs`; `handleMessage` narrows
  with `isBackendReadiness` + `isBootPhase` and drops anything malformed; a failed
  pull leaves the ready default.
- Acceptance: default is `ready` before any RPC resolves; a `warming` push flips
  `isBooting`; a malformed push is ignored; a rejected pull leaves the default; a
  batched push (through the router's `MESSAGE_TYPES.BATCH` unwrap) still lands.

### Task 4.2: `BackOfficeActivityService` (component 14d) — PENDING

- Depends on: Task 4.1 (shares `core/services/index.ts` and `app.config.ts`)
- Files:
  - CREATE `…/libs/frontend/core/src/lib/services/back-office-activity.service.ts`
  - CREATE `…/libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts`
  - MODIFY `…/libs/frontend/core/src/lib/services/index.ts`
  - MODIFY `…/apps/ptah-extension-webview/src/app/app.config.ts`
  - MODIFY `…/apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts`
- Plan reference: implementation-plan.md:1114-1216
- Pattern to follow: the multi-type handler at
  `vec-embedder-recovery.service.ts:34-71`; the subsystem-event-to-human-label
  service at `skill-synthesis-live.service.ts:73-119` (**reuse its phrasing at
  `:107-119` rather than inventing a second vocabulary for the same events**); the
  ring idiom at `skill-synthesis.service.ts:1008-1011`
- Quality requirements: `@ptah-extension/shared` only — no RPC, no `VSCodeService`,
  no backend import; signals + `inject()`; the lib's coverage floor; the single
  `setInterval` behind `isIdle` is cleared via `DestroyRef`.
- Validation notes: **coalescing is required, not an optimisation** —
  `INDEXING_PROGRESS` is broadcast per file and a workspace index emits thousands.
  Key on `` `${source}:${kind}` `` with latest-wins inside
  `ACTIVITY_COALESCE_WINDOW_MS` (750 ms), replacing in place and keeping position.
  `ACTIVITY_RING_CAPACITY = 50`. **No host branch is added** — the service is
  harmless under VS Code by construction, because its only consumer is
  `ElectronShellComponent`, which VS Code never renders.
- Implementation details: nine handled message types re-mapped in the frontend
  (`ACTIVITY_EVENT`, `BOOT_READINESS_CHANGED`, `MEMORY_EXTRACTED`,
  `MEMORY_OBSERVATION_CAPTURED`, `MEMORY_CORPUS_CHANGED`, `INDEXING_PROGRESS`,
  `INDEXING_COMPLETE`, `SKILL_SYNTHESIS_EVENT`, `VEC_STATUS_CHANGED`,
  `EMBEDDER_STATUS_CHANGED`), each a pure `(payload) => ActivityItem | null`.
  `null` for `phase === 'settled'` and for an unchanged status re-broadcast; an
  unknown `SKILL_SYNTHESIS_EVENT` kind degrades to a generic summary rather than
  `null`.
- Acceptance (state and call counts, never wall-clock timing): 60 pushes leave
  `recent().length === 50` newest first; 100 `INDEXING_PROGRESS` 10 ms apart
  occupy **one** slot with `latest().summary` equal to the last; two 2 s apart
  occupy two slots; `isIdle()` false immediately after a push and true after
  advancing a fake clock past `IDLE_AFTER_MS`; a malformed `ACTIVITY_EVENT`
  changes nothing; a `settled` boot phase produces no item; a batched message
  lands.

### Task 4.3: Boot screen + panel skeletons (component 13) — PENDING

- Depends on: Task 4.1
- Files:
  - CREATE `…/libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts`
  - CREATE `…/libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts`
  - CREATE `…/libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.spec.ts`
  - MODIFY `…/libs/frontend/chat-ui/src/index.ts` (**shared with Task 4.4**)
  - MODIFY `…/apps/ptah-extension-webview/src/app/app.html`
  - MODIFY `…/apps/ptah-extension-webview/src/app/app.ts`
  - MODIFY `…/libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- Plan reference: implementation-plan.md:889-955
- Pattern to follow: the duplicated daisyui skeleton markup at
  `plugin-status-widget.component.ts:35-44` and
  `setup-status-widget.component.ts:45-54` (the duplication is what justifies
  extracting one atom); the list-row repeat idiom at `corpus-list.component.ts:119-122, 227`
- Quality requirements: `ChangeDetectionStrategy.OnPush` mandatory; signals +
  `inject()`; Tailwind + daisyui only; component styles under 10 kb; no
  `[innerHTML]`; the atoms and molecules are **presentational — no service
  injection**; the boot screen is `role="status"` `aria-live="polite"` and the
  phase list is a real list.
- Validation notes: **the handover point is `phase === 'harness'`, not
  `settled`** — the screen owns the window in which nothing is usable, and the
  skeletons own the window in which parts are. Only two skeleton sites: the
  session sidebar list and the canvas region's existing `@else` spinner
  (`app-shell.component.html:673-678`). The navbar and workspace sidebar are
  layout state only and must keep painting instantly. VS Code is unaffected by
  construction (Task 4.1's `ready` default), so **no host branch is added**; if
  one ever is, it must use the `app.ts:47` snapshot idiom.
- Implementation details: `app.html`'s loading branch becomes
  `@if (appState.isLoading() || isInitializing() || bootStatus.isBooting())` and
  renders `<ptah-boot-progress>`; the screen lists the five phases with reached
  ones checked, shows `detail` and elapsed time derived from `startedAt`; an
  unknown phase renders "Starting"; a `failed` readiness routes to the existing
  error branch (`app.html:22-39`) with the boot detail as its message.
- Acceptance: component specs driving inputs — the phase list marks reached
  phases, elapsed renders from `startedAt`, an unknown phase degrades. One
  `webview-e2e-harness` case posts a `warming` readiness through the postmessage
  bridge and asserts the boot screen renders, then posts `harness` and asserts
  the shell appears.

### Task 4.4: `ptah-activity-ticker` + shell wiring (component 14e) — PENDING

- Depends on: Task 4.2, Task 4.3
- Files:
  - CREATE `…/libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts`
  - CREATE `…/libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.spec.ts`
  - MODIFY `…/libs/frontend/chat-ui/src/index.ts` (**shared with Task 4.3**)
  - MODIFY `…/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
- Plan reference: implementation-plan.md:1218-1291
- Pattern to follow: `ThemeToggleComponent` (exported at
  `chat-ui/src/index.ts:20`); the reduced-motion block every animated component
  here already carries, e.g. `execution-node.component.ts:298`
- Quality requirements: `OnPush`; **inputs only, no service injection in the
  component** (`libs/frontend/chat/CLAUDE.md` guideline 2); **no new external
  dependency** — CSS `translateY` + `opacity` over ~180 ms, `angular-gsap` is not
  a `chat-ui` dependency and is not being added; Tailwind + daisyui; styles under
  10 kb; the header row's `h-10` height must not change.
- Validation notes: the exact insertion point is **inside** the existing
  right-hand actions group at `electron-shell.component.ts:209-212`,
  **immediately before** `<ptah-theme-toggle />`, so the toggle keeps its
  far-right position. The ticker is `max-w-[22rem] truncate` and must carry
  `no-drag`, because the header row carries `titlebar-drag` on macOS and every
  other interactive child there already opts out. The click target is a
  `<button type="button">` with an `aria-label`, not a bare div, inside
  `role="status" aria-live="polite" aria-atomic="true"`.
- Implementation details: `items = input.required<readonly ActivityItem[]>()`,
  `idle = input.required<boolean>()`, `rotateMs = input<number>(4000)`,
  `activate = output<void>()`. The rotation timer advances the index and resets to
  `0` whenever `items()` gains a newer head. When `idle()` is true the component
  collapses to a muted dot that is still a click target and **stays in the DOM**,
  so the header does not reflow. `ElectronShellComponent` injects
  `BackOfficeActivityService`, binds `[items]`/`[idle]`, and wires
  `(activate)="openThoth()"` — **reusing** the existing method at `:341-344`
  including its `thothFirstRunDismissed` side effect, not duplicating navigation.
- Acceptance: with three items and a fake clock, advancing `rotateMs` twice shows
  items 0, 1, 2 in order (asserted by rendered text and advance count, not elapsed
  real time); a new head resets to index 0; `idle: true` renders the collapsed
  form and still emits `activate` on click; the reduced-motion rule comes from the
  stylesheet, not from TypeScript; an item with an empty `summary` renders its
  `source` as the fallback label. One `webview-e2e-harness` case posts an
  `ACTIVITY_EVENT` and asserts the header line renders its `summary`.

### Batch 4 verification

```
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat-ui @ptah-extension/chat ptah-extension-webview
npm run typecheck:all
npm run lint:all
```

- `Running target test for 4 projects` appears in the header.
- `chat-ui`'s dependency list is unchanged (no animation package added).
- No component in `chat-ui` injects a service.
- Reviewer: **code-style-reviewer** (OnPush, signals, the presentational rule, the
  barrel edits), then **visual-reviewer** on the running Electron build for the
  boot screen and the header ticker (contrast, focus, the `h-10` row, reduced
  motion), then **code-logic-reviewer** for the coalescing and ring behaviour.
- Commit: `feat(chat-ui): batch 4 - staged boot screen and back-office activity ticker`

---

## Batch 5: Acceptance measurement and final review — PENDING

- Components: none (verification only)
- Recommended executor: `senior-tester`
- Fallback executor: `devops-engineer` for the packaging half if the packaged run
  will not start
- Execution mode: **sequential**
- Rationale: the acceptance criteria are measurements against a packaged cold
  boot, not unit tests, and the plan makes one of them the sole authority for a
  scope decision (whether any readiness guard ships at all).
- Tasks: 2 | Depends on: Batches 1-4

### Task 5.1: Cold-cache boot measurement — PENDING

- File: `…/.ptah/specs/TASK_2026_380/test-report.md` (CREATE)
- Plan reference: implementation-plan.md:1762-1772
- Validation notes: **every run sets `PTAH_DB_PATH` to a temp copy of the ~1 GB
  database — never the production file.** A `0042` schema written into
  `~/.ptah/state/ptah.sqlite` leaves an older installed build unable to open it.
  The page cache must be cold; a freshly written copy is hot, which is exactly the
  mis-design that made TASK_2026_331's probe measure 1942 ms and cancel the work.
- Acceptance criteria (all four):
  1. `openAndMigrate()` under 3 s on a cold-cache boot of the packaged app.
  2. No lag warning above 500 ms before the first answered RPC.
  3. No skill boot-scan enqueue inside the first 5 minutes.
  4. On the same cold boot the header ticker narrates the phases as they happen
     and settles into its collapsed form once the boot is done.
- Also: re-run `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` **cold** and
  record whether any SQLite-backed method lands inside the readiness window.
  **That run, and only that run, authorises a readiness guard — on exactly the
  methods it names.** If it names none, record that no guard ships and why. Do not
  add guards speculatively.
- Also verify assumption A-1 live: with the app running, confirm the worker's
  read-only connection opens against the same WAL database, and that a forced
  open failure produces `unavailable` with no record written.

### Task 5.2: Final reviews — PENDING

- Depends on: Task 5.1
- Reviewers, in order: **code-logic-reviewer** (whole-task pass: boot-path failure
  containment, the four degrade rules, the coalescing), then
  **code-style-reviewer** (hexagonal boundaries, the three new ports/namespaces,
  barrel hygiene, file sizes).
- Outputs: `code-logic-review.md` and `code-style-review.md` in the task folder.

### Batch 5 verification

```
npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/skill-synthesis @ptah-extension/thoth-runtime @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/cli-engine
npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat-ui @ptah-extension/chat ptah-electron ptah-extension-webview
npm run typecheck:all
npm run lint:all
nx build ptah-electron
nx build ptah-cli
```

- Both `run-many` headers report 8 and 5 projects respectively.
- `dist/apps/ptah-electron/integrity-worker.mjs` exists.
- `test-report.md` records all four acceptance criteria with measured numbers.
- Commit: `test(ptah-electron): batch 5 - cold-start acceptance measurement`
