# Batch 1, lane P — backend implementation report (TASK_2026_380)

**Tasks completed**: 1.1, 1.2, 1.3 (in order).
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.
Every path below is inside that worktree. The main checkout was never touched.

---

## Files

### CREATED

| Path                                                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.ts` | Migration `0042`. One `CREATE TABLE IF NOT EXISTS db_integrity_check_state`, static SQL, no interpolation, no rebuild, no backfill. Single row keyed `id INTEGER PRIMARY KEY CHECK (id = 1)`; `checked_at`, `quick_check_ok`, `foreign_key_violations`, `duration_ms`, `page_count` all `INTEGER NOT NULL`; `detail TEXT` nullable. The header records the measurements that justify the table and states why `0041`'s per-root key is deliberately NOT copied.                                                            |
| `…/migrations/0042_db_integrity_check_state.spec.ts`                                  | Registry entry (version 42, plain `sql`, not vec-gated, highest bundled), static-SQL assertions, and a behavioural half that brings a temp database to version 41 through every bundled migration and then applies `0042` **twice**. Pins both halves of the single-row constraint: `id = 2` is rejected AND two writes leave one row.                                                                                                                                                                                     |
| `…/lib/integrity/integrity-check-state.store.ts`                                      | `IntegrityCheckStateStore` + the `IntegrityCheckState` type. Static `SELECT`/`UPSERT` constants, private `db` getter over `connection.db`. `read()` returns `null` on any throw (logged at `debug`), `write()` warns and swallows. Absorbs `PERSISTENCE_UNAVAILABLE`.                                                                                                                                                                                                                                                      |
| `…/lib/integrity/integrity-check-state.store.spec.ts`                                 | Stub-connection specs: row mapping incl. `quick_check_ok = 0` decoding to a FAILED (not missing) verdict, read-degrades-to-`null` on `PERSISTENCE_UNAVAILABLE` / a throwing `SELECT` / a non-`Error` throw, write-swallows with a warn, and the six bound values in schema order.                                                                                                                                                                                                                                          |
| `…/lib/integrity/integrity-worker-protocol.ts`                                        | Request/response types, the `'ok' \| 'corrupt' \| 'unavailable'` verdict, and two pure functions: `classifyQuickCheck` and `isIntegrityCheckRequest`. The only monorepo module the worker imports.                                                                                                                                                                                                                                                                                                                         |
| `…/lib/integrity/integrity-worker-protocol.spec.ts`                                   | Unit tests for both pure functions. `classifyQuickCheck`: only trimmed `ok` is `'ok'`; any other **string** is `'corrupt'` (the pragma answered); any **non-string** is `'unavailable'` (no answer).                                                                                                                                                                                                                                                                                                                       |
| `…/lib/integrity/integrity-worker.ts`                                                 | The worker entry. Dual-transport shim copied from `memory-curator/.../embedder-worker.ts:33-83` (Electron `process.parentPort` delivers `{ data }`, `node:worker_threads` delivers the raw payload); no `electron` import. Opens with `readonly: true, fileMustExist: true`, runs `quick_check`, `foreign_key_check` and `page_count`, posts one result, never writes. The whole body is one `try` whose every escape lands on `verdict: 'unavailable'`. Imports nothing from the monorepo except its own protocol module. |
| `…/lib/integrity/worker-process.port.ts`                                              | `IIntegrityWorkerProcess` / `IIntegrityWorkerProcessFactory`, mirroring `memory-curator/.../worker-process.port.ts:9-20`. Declared locally, not in `platform-core`, for the documented reason. Unlike the embedder's factory it sends no `init`: the worker is single-shot and takes the db path on the request.                                                                                                                                                                                                           |
| `…/lib/integrity/integrity-check.service.ts`                                          | `SqliteIntegrityService`. Exactly `isDue(now?)` and `dispatchIfDue()` public. `DB_INTEGRITY_CHECK_INTERVAL_MS = 7 days`, `INTEGRITY_WORKER_BUDGET_MS = 5 min`. Single-flight flag set synchronously before the first `await`. `dispatchIfDue()` never throws and never rejects. No factory ⇒ one `info` line and return. `unavailable` / `ok: false` / exit-before-reply / unrecognised shape ⇒ warn, **no record**. Worker killed on every settle path; budget timer `unref`'d.                                           |
| `…/lib/integrity/integrity-check.service.spec.ts`                                     | 26 specs, all call counts, never timings. Covers the whole acceptance list plus spawn-throws, store-read-throws, flag-released-after-failure, and the two kill properties.                                                                                                                                                                                                                                                                                                                                                 |

### MODIFIED

| Path                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…/lib/migrations/index.ts`                              | Append only: the `0042` import and the `{ version: 42, … }` entry after `41`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `…/lib/di/tokens.ts`                                     | Three new `Symbol.for(...)` entries: `INTEGRITY_WORKER_PROCESS_FACTORY`, `INTEGRITY_WORKER_PATH`, `SQLITE_INTEGRITY_SERVICE`. Each documented. Nothing existing touched.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `…/lib/di/register.ts`                                   | `container.registerSingleton(SQLITE_INTEGRITY_SERVICE, SqliteIntegrityService)`, with a comment saying why the singleton matters (the single-flight flag _is_ the one-spawn guarantee). Lazy, so it is safe on a host with no worker factory.                                                                                                                                                                                                                                                                                                                                                      |
| `…/src/index.ts`                                         | Exports the service and its two constants, the store, `classifyQuickCheck` / `isIntegrityCheckRequest`; `export type` for `IntegrityCheckState`, the two port interfaces and the six protocol types.                                                                                                                                                                                                                                                                                                                                                                                               |
| `…/lib/sqlite-connection.service.ts`                     | **Deletion only.** `runBootChecks` (was `:602-635`) and its call site (was `:214`) are gone. No other change. File is **839 → 797 lines** — it shrank, as required.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `…/lib/sqlite-connection.service.spec.ts`                | The five specs whose subject was the deleted method are gone (two `D3` `quick_check` cases, three `D10` `foreign_key_check` cases). Replaced by ONE spec, `D3: openAndMigrate runs neither quick_check nor foreign_key_check`, which asserts on `FakeSqliteDatabase.pragmas` rather than on an absent log line — a log assertion would still pass if the pragma ran and only its logging were dropped, which is the expensive half. It also drives a corrupt-looking database and asserts boot still opens, preserving the "the check never gated anything" evidence. 100 lines deleted, 18 added. |
| `…/migrations/{0028,0030,0038,0039,0040,0041}_*.spec.ts` | Six one-line ratchets: `expect(Math.max(...MIGRATIONS.map(m => m.version))).toBe(41)` → `42`, plus the surrounding provenance comment each of those files keeps.                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## Stack observed

- **DI**: tsyringe, `Symbol.for(...)` tokens in `lib/di/tokens.ts`, registered in
  `registerPersistenceSqliteServices` (`lib/di/register.ts`). Optional injection
  as `{ isOptional: true }` with a `null` default — read from
  `memory-curator/.../embedder-worker-client.ts:86-92`.
- **Worker port pattern**: host-implemented factory declared in the owning lib,
  never in `platform-core`, never `import 'electron'` —
  `memory-curator/.../worker-process.port.ts:1-21`.
- **Verdict vocabulary**: `'ok' | 'corrupt' | 'unavailable'` and the rule that an
  inconclusive check is never reported as corruption — `backup.service.ts:44-53`,
  with the `fileMustExist` rationale at `:56-69`.
- **Store shape**: static SQL constants, private `db` getter, `read` → `null`,
  `write` → warn+swallow — `skill-synthesis/.../skill-md-migration-state.store.ts:38-97`.
- **Migration conventions**: forward-only append, static SQL, `IF NOT EXISTS`,
  long explanatory header — `migrations/0041_skill_md_migration_state.ts` and its
  spec.
- **Test conventions**: `createMockLogger` from `lib/testing/mock-logger.ts`;
  `FakeSqliteDatabase` from `lib/testing/fake-sqlite-database.ts` (its `pragmas`
  array is what the new `D3` spec asserts on); the `better-sqlite3` →
  `node:sqlite` opener fallback in migration specs, needed because the repo's
  `better-sqlite3` is rebuilt for Electron ABI 143 and cannot load under the Jest
  runner's Node (ABI 137).
- `catch (error: unknown)` with `instanceof Error` narrowing throughout.

## Verification

Per the batch prompt I ran **no** `nx`, `typecheck:all` or `lint:all` — two other
agents share this worktree.

| Command                                                                                                                                                        | Result                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npx jest --config libs/backend/persistence-sqlite/jest.config.ts --rootDir libs/backend/persistence-sqlite libs/backend/persistence-sqlite/src/lib/integrity` | **3 suites / 43 tests passed**                                    |
| `npx jest --config libs/backend/persistence-sqlite/jest.config.ts --rootDir libs/backend/persistence-sqlite` (whole lib)                                       | **26 suites passed, 8 skipped; 278 passed, 69 skipped, 0 failed** |
| `npx tsc -p libs/backend/persistence-sqlite/tsconfig.lib.json --noEmit`                                                                                        | **clean, no output**                                              |
| `wc -l libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts`                                                                                   | **797** (was 839)                                                 |

Notes on the skips, so they are not read as green-by-omission:

- `sqlite-connection.realbinary.spec.ts` self-skips with a printed reason —
  `better-sqlite3` is `NODE_MODULE_VERSION 143` (Electron) and the Jest runner is 137. Pre-existing, unrelated to this batch.
- The behavioural half of `0042_db_integrity_check_state.spec.ts` did NOT skip:
  it resolved an opener through the `node:sqlite` fallback and ran all four
  cases. Confirmed by the test count (20 in the two Task 1.1 suites).
- No test in this batch opens `~/.ptah/state/ptah.sqlite`. The migration spec uses
  `fs.mkdtempSync` temp files; every other spec uses `:memory:` or a stub.

Not run, and why: `nx build ptah-electron` and anything that would produce
`integrity-worker.mjs` — the esbuild targets are Task 2.2's, in a later batch.
The worker entry therefore has no bundle yet and is exercised only through the
protocol unit tests and the service's fake factory, exactly as the plan's
verification seam specifies.

## Plan deviations

1. **Six existing migration specs were edited (not in my file list).**
   `0028`, `0030`, `0038`, `0039`, `0040` and `0041` each assert
   `Math.max(...MIGRATIONS.map(m => m.version))` equals `41`. Appending `0042`
   breaks all six. Each of those files' own comment states the assertion is a
   ratchet that "moves forward with every appended migration", so bumping them to
   `42` is the documented maintenance, not a scope change. One-line edits plus
   the provenance comment those files keep.

2. **`sqlite-connection.service.spec.ts` was edited (not in my file list).**
   Five specs directly tested `runBootChecks`, which Task 1.3 deletes; they fail
   as written. Deleting them and leaving nothing would remove the evidence that
   the pragma is gone, so they were replaced by one spec asserting the pragma
   list. Net −82 lines. The plan says "no other change to `sqlite-connection.service.ts`"
   and that holds — the production file carries the deletion and nothing else.

3. **`integrity-worker-protocol.spec.ts` added (not in the Task 1.2 file list).**
   Task 1.2's acceptance says "the protocol module and the verdict-classification
   function are pure and unit-tested", but the file list names no spec. The
   worker ENTRY cannot be imported under Jest — it subscribes to a parent port at
   module scope and throws when there is none — so the pure half needs its own
   file. 71 lines.

4. **`INTEGRITY_WORKER_BUDGET_MS` is a module constant, not a DI token.** The
   plan authorises exactly two new host tokens plus the service token, so the
   kill budget takes no fourth. Five minutes, deliberately generous: the measured
   cold cost on the 1 GB file is 20-26 s, and the budget exists so the worker
   cannot outlive the host, not to police its speed — a kill writes no record, so
   a tight budget would silently mean "never checked" forever. The spec drives it
   with Jest fake timers, so this is still a call-count assertion.

5. **`IntegrityCheckStateStore` is injected by its class as the token**
   (`@inject(IntegrityCheckStateStore)`), not by a new symbol. The plan lists no
   token for it and it is an internal collaborator of one service in the same
   lib; adding a fifth symbol for it would put a lib-private class on the DI
   surface for nothing. tsyringe resolves an `@injectable()` class without an
   explicit registration.

6. **Worker request id is the constant `1`.** The worker is single-shot — one
   spawn, one request, one reply, then killed — so there is no correlation
   problem for a counter to solve. The `id` field is kept because the embedder's
   protocol has one and the response echo is what lets the service reject a
   malformed reply.

## Open questions / notes for the team-leader

- **A-1 is still unverified and this batch could not verify it.** Whether a
  read-only `better-sqlite3` connection can open the WAL database while the main
  process holds it open is a live-run question. The code honours the mitigation
  the plan requires — any open failure is `'unavailable'` and writes no record —
  and the service spec pins that, but the live answer waits for Batch 5.
- **Nothing calls `dispatchIfDue()` yet.** That is Task 2.3 / component 5 by
  design, so between this batch and that one the integrity check does not run at
  all. That is a strict improvement over the old boot pragma (which cost 20-26 s
  and gated nothing), but it should not be mistaken for "wired".
- **`INTEGRITY_WORKER_PATH` is registered by nobody yet.** It is declared here so
  Task 2.2 has the token to register against, exactly like `EMBEDDER_WORKER_PATH`.
  Batch 2 owns all four `apps/ptah-electron/project.json` call sites flagged in
  the HIGH risk row.
- **Out of scope, observed:** `start-thoth-cron.ts:207-251` still runs the daily
  `db.backup()` (a full 1 GB copy) plus `quick_check`, `incremental_vacuum` and
  `optimize` on the main process. The plan already records this as a follow-up;
  the worker this batch builds is what makes it a small change later. Not touched.
