# Implementation Plan - TASK_2026_430_83a2

**Verdict (revision 3, one storage format).** Keep the v2 per-key worker store, with no versions and no maintenance sweep. Fix the worker in five ways:

- Isolate faults, so one failed request cannot kill the worker.
- Make commits safe: allocate a fresh generation, then reconcile or retire.
- Load values lazily, with no pinning.
- Bound every read with worker-side projections and a 1 MiB total ceiling.
- Page writes and reads by operation, and shrink items against both size estimators.

The one v1 → v2 split produces lean details directly. New writers never store bulk inline, and the webview loads sub-agent output only when a card is expanded.

## Inputs and constraints

- **Requirements used:**
  - `context.md`, including "User decisions (after Codex round 2)".
  - `codex-plan-review.md`, `codex-plan-review-r2.md`.
  - TASK_2026_411 `implementation-plan.md`, `e2e-storage-fix-report.md` and `review-resolution.md`.
  - The root `CLAUDE.md` and the per-lib `CLAUDE.md` files for platform-electron, platform-core, agent-sdk, cli-agent-runtime, rpc-handlers, vscode-core, shared, chat, chat-streaming and ptah-electron.
- **Binding scope, verified by the orchestrator in git:**
  - Commit 122770d90 (the v2 worker store) is in no release tag. `electron-v0.1.70` ships the legacy single-JSON storage.
  - There is **one storage format**. There are no plan versions, receipts, sweeps, downgrade or old-writer compatibility, self-heal for installed users, or pending-maintenance signal.
  - Old sessions have no fidelity requirement.
  - Rebuilding from the retained v1 file is acceptable.
- **Consequence for shipped users.** Every real user upgrading from v0.1.70 takes the **v1 → v2 split path**. That split must produce lean, bounded data on its first commit.
- **Real-profile evidence (read-only scripts, from earlier revisions):**
  - `ptah.sessionMetadata` index: 177,177 bytes on disk, **363,670 by the worker estimator**, which is over 262,144.
  - Session details: 723 total, and 37 are over the estimator budget.
  - `cliSessions` references: 373 in total, of which 371 carry `stdout`.
  - All 371 agents with `stdout` already have segment sequences.
  - Of 388 agent-output values, 15 are object-shaped.
  - The largest sequence item is a 1,112,231-byte `segment:command`.
  - The largest detail after removing bulk fields is 209,917 bytes on disk and 415,730 by the estimator.
- **Design handoff:** none.
- **Missing decision-critical input:** none. The stdout rule below is an allowed simplification under the new user decision, and its reasoning is recorded.

## Codebase evidence

| Evidence                                                                                                                               | Location                                                                                                                | Implication                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The budget check runs outside `try`, and the promise chain has no rejection handler.                                                   | `electron-state-storage-worker.ts:18-48` (`:39`)                                                                        | One oversized response kills the worker and poisons the chain.             |
| `writeFlushRenameVerify` renames at `:410`, then can throw at `:417`. `CURRENT` is written last (`:354-359`).                          | `electron-state-storage-commit-store.ts:285-362,395-420`                                                                | A commit can publish and still throw.                                      |
| The next generation is `previous.generation + 1`, and final paths embed the generation.                                                | commit store `:286,305-313,335-342`                                                                                     | A failed attempt occupies N+1, so a retry collides or overwrites (N2).     |
| The runtime assigns its manifest only after `commit` returns.                                                                          | `electron-state-storage-worker-runtime.ts:470-482`                                                                      | The runtime's manifest goes stale after a published failure (the BLOCKER). |
| The host updates its cache only after a successful write.                                                                              | `electron-state-storage-worker-host.ts:215-235`                                                                         | An uncertain commit leaves the cache stale (N8).                           |
| `get` returns the whole value, `this.values` holds everything, and boot parses every blob.                                             | runtime `:212,243-251,437-439`; commit store `:184-207`                                                                 | Reads are unbounded and worker memory is proportional to the profile.      |
| Snapshot cursors are stored in a map and dropped only when the read finishes.                                                          | runtime `:215,491-543`                                                                                                  | Cursors hold state (N9).                                                   |
| A sequence page throws when a single item exceeds the budget or the value is not an array.                                             | runtime `:556-605`                                                                                                      | Oversized items and object-shaped values fail the whole page.              |
| The split keeps references without an id fat (`retainedSourceCount`) and throws on a session with no id.                               | runtime `:660-676`                                                                                                      | Details stay fat, and a single id-less session can fail the migration.     |
| The split merges tag by tag and keeps the longer array.                                                                                | runtime `:132-175`                                                                                                      | This stays valid, because no stdout partition exists anymore.              |
| The recipe extracts only `segments` and `streamEvents`.                                                                                | `session-metadata-store.ts:160-201`                                                                                     | `stdout` is never handled at split.                                        |
| A v1 boot commits every v1 key, including the 158 MB array, before the split runs.                                                     | commit store `:93-110`; runtime `:437-449`                                                                              | First-boot I/O is doubled and the fat array lands as a blob.               |
| An absent v2 root, or an unparsable pointer on a store with no committed mutation, retries from v1. A missing v1 file is read as `{}`. | commit store `:151,158-161,256-259`                                                                                     | This is the rebuild path and the answer when v1 is absent.                 |
| The split returns early once the index schema matches.                                                                                 | runtime `:634-652`                                                                                                      | Dev v2 stores are never re-split.                                          |
| The host reconstructs whole values for the cache.                                                                                      | host `:531-591`                                                                                                         | Anything cached is fully hydrated on the main thread.                      |
| Sequence writes send each item whole after pulling out strings over 32 KiB. The scalar write estimates its payload heuristically.      | host `:92-169,265-297,398-408,604`                                                                                      | A write that is large only because of its structure fails.                 |
| The worker estimator counts 2 bytes per UTF-16 unit. The RPC measurement is JSON UTF-8.                                                | protocol `:575`; `session-metadata-store.ts:263-275,952-958`                                                            | Items must be shrunk against both budgets.                                 |
| Save migration assembles all output on the main thread.                                                                                | `session-metadata-store.ts:520-606,820-846`                                                                             | Delete it.                                                                 |
| Restore and page authorization read the full detail.                                                                                   | `session-metadata-store.ts:671-680,1005-1012`; `session-rpc.handlers.ts:822-833`; `chat-session.service.ts:854,918-932` | These reads need a worker-side projection.                                 |
| The live writer puts `stdout` and `segments` inline on the reference.                                                                  | `agent-events.ts:399,406-408,430-433`                                                                                   | New writers must stop doing this.                                          |
| `readOutputForPersistence` keeps a 100 KB stdout tail. The restore buffer comes from `ref.stdout ?? ''`.                               | `agent-process-manager.service.ts:812,1089-1092`; `agent-process-manager-helpers.ts:156`                                | Restored `ptah_agent_read` stdout becomes empty (accepted, see decision).  |
| The card renders segments first and falls back to `stdout`. The loader pages all agents eagerly.                                       | `agent-card.component.ts:179-187`; `session-loader.service.ts:969-990`                                                  | A text segment renders correctly, and loading should be lazy on expand.    |
| `CliStateStorage` only implements get, update and keys.                                                                                | `platform-cli/.../cli-state-storage.ts:16-46`                                                                           | The sync path uses in-memory records.                                      |
| The RPC error-code union has no code for a stale cursor.                                                                               | `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:8-19`                                                           | Add one code.                                                              |

## Architecture decision

- **Chosen: keep the v2 worker store with one format.** The table lists every fix.

  | Area          | Fix                                                                                                                                                                             |
  | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Worker loop   | Fault isolation.                                                                                                                                                                |
  | Commit        | Allocate generations past every occupied manifest or blob generation. Classify publication. Reconcile or retire. Invalidate and refresh the host cache on an uncertain outcome. |
  | Worker values | Lazy, verified per-key values in a byte-bounded LRU with no pinning.                                                                                                            |
  | Cursors       | Stateless, generation-bound cursors for scalar, sequence and snapshot reads.                                                                                                    |
  | Reads         | Worker-side omission projections with a 1 MiB JSON ceiling, checked before any byte is sent.                                                                                    |
  | Page items    | Items shrunk to satisfy both estimators.                                                                                                                                        |
  | Writes        | Paged by operation.                                                                                                                                                             |
  | v1 → v2 split | Applied before the first commit. Produces lean details.                                                                                                                         |

- **Rationale:**
  - Every root cause is inside the adapter.
  - One format removes every history-compatibility mechanism the reviews kept finding holes in (N3–N7).
- **The `stdout` rule, decided (simplest rule that is still correct):**
  - `stdout` is never kept in a detail.
  - At split and at live save, it becomes a single `{ tag: 'segment', value: { type: 'text', content: stdout } }` item, **only when the agent's destination sequence would otherwise have no items**.
  - Otherwise it is dropped and the drop is counted.
  - **Why:**
    - On the real profile, all 371 stdout-bearing agents already have segment sequences. `stdout` there is a 100 KB rendered tail that duplicates them.
    - Converting unconditionally would bring back placement, variant and deduplication rules (old findings 2 and 3, N4, N7) for no user value.
    - Dropping it unconditionally would lose all output for adapters that emit only raw text.
  - This honours the earlier user decision (a text segment) where it matters, and the new decision (materially simpler) everywhere else.
- **Missing id, single rule:** bulk on a reference with no usable `agentId` is dropped. A session item with no usable `sessionId` is skipped instead of failing the migration.
- **Counting units (R3-3).** Every counter counts **`cliSessions` references, one per reference**, whatever the number of bulk fields on it. The exception is `skippedItemCount`, which counts session items.

  | Counter                     | What is counted, once each                                                                                                                           |
  | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `droppedStdoutCount`        | A reference with a usable `agentId` whose non-empty `stdout` was dropped because its destination already had items.                                  |
  | `stdoutFallbackCount`       | A reference whose `stdout` became the single text segment.                                                                                           |
  | `droppedBulkWithoutIdCount` | A reference with no usable `agentId` that carried any of `stdout`, `segments` or `streamEvents`. It is **not** also counted in `droppedStdoutCount`. |
  | `skippedItemCount`          | A session item with no usable `sessionId`.                                                                                                           |
  - The split reports these counters in its receipt.
  - Live saves report the same units through the store logger (component 5):
    - `_saveInternal` reports `strippedBulkRefCount`: references whose bulk was removed before writing.
    - `saveAgentOutput` reports `stdoutDropped: true` or `stdoutFallback: true`.
  - Both log at `info` when a value is non-zero. Specs assert these calls.

- **Dev v2 stores: not detected and not discarded automatically.**
  - A fat detail cannot be recognised from manifest metadata. Exact detection means parsing every detail on every boot, and a marker would be a version field, which the user rejected.
  - Pre-fix dev stores are made safe instead:
    - Reads are always projected, so omitted bulk never leaves the worker.
    - The next write of a detail is lean.
    - Scalar continuations carry the projection (R3-1).
    - **Accepted limitation:** on an existing dev v2 store, object-shaped legacy agent output returns an isolated `not-a-sequence` failure for that agent's output page only. Paging on such stores is therefore not guaranteed to succeed for every agent. No compatibility mechanism is added for this.
  - **Rebuild procedure (dev only):** delete `workspace-state.v2/`. The next boot takes `retry-v1` (commit store `:151`) and re-splits with the corrected recipe. This one-time instruction goes in the **batch report and the release note**. It is not handled in code.
  - **If v1 is absent:** the store is `{}` (`:256-259`), so there are no sessions.
- **Revised main-thread guarantee (N10):**
  1. No worker message is larger than 262,144 bytes by the estimator.
  2. A projected read returns at most 1 MiB of JSON UTF-8, otherwise `StateStorageValueTooLargeError`. The worker measures before sending, so the main thread receives nothing for a rejected read.
  3. The host cache holds only keys that are not excluded: the index plus small keys.
     - The index is hydrated on main in O(sessions): about 245 bytes per session, about 177 KB today.
     - This is stated explicitly and **not** bounded by a constant. Paging the index is future work.
  4. An output page is at most the RPC JSON budget of 256 KiB.
- **Accepted behaviour change:** `ptah_agent_read` on a restored (not live) agent returns empty stdout, because references no longer carry it. This follows from "new writers never store bulk inline" and the fact that old sessions carry no fidelity requirement. The UI still shows the output through paging.
- **Rejected alternatives:**
  - **SQLite.**
    - It is Electron-only and global.
    - It opens after the window, while session RPCs run before it.
    - It would add a migration.
    - It has ABI hazards. See the revision-1 evidence: `persistence-sqlite/CLAUDE.md:7,108-113`.
  - **Structural detection by parsing every detail at boot.** Cost on every boot, for dev-only data.
  - **Converting `stdout` unconditionally.** Brings back the placement, variant and deduplication rules.
  - **Keeping a fat source array as generation 1.** Unnecessary I/O, because v1 is retained.
  - **Cursor pinning.** Unbounded memory (N9).
- **Assumptions:**
  - **A1.** A real-shape 328 MB v1 split, applied before the first commit, finishes inside `DEFAULT_STATE_WORKER_HANDSHAKE_TIMEOUT_MS` (120 s, `host.ts:64`) on the reference host. **Check:** the perf spec (`PTAH_PERF_SPECS=1`). If it misses the budget, escalate. Do not raise the timeout silently. This is now the shipped-user path.
  - **A2.** Streaming hash verification at boot for about 240 MB of blobs takes 1–3 s. **Check:** the same perf spec.
  - **A3.** `SessionLoaderService` is `providedIn: 'root'`, so it can host an `effect()`. **Check:** its `@Injectable`.
  - **A4.** `ptah-electron`'s `test.dependsOn` can include `build-state-storage-worker` (`apps/ptah-electron/project.json:187-200`), so test 1 layer (b) runs against the real bundle. **Check:** the `test` target's `dependsOn` and the esm-bundle-gate expected-target list. Add the target in B0 if it is missing, and run `npx nx reset` only when no other executor is active.
- **Effect on existing code:**
  - **Replaced:**
    - the worker loop;
    - runtime value hydration, commit bookkeeping and snapshot cursors;
    - commit-store loading, generation allocation and the commit API;
    - host `get`, the write-packing heuristics and the post-write cache logic;
    - the recipe fields (`onMissingId`, stdout fallback);
    - the receipt counters;
    - `readWorkerOutputPage`'s budget search.
  - **Deleted:**
    - `leanCliSessions`, `migrateRefOutput` and `getAgentOutput`;
    - inline bulk in `agent-events.ts`;
    - eager webview paging;
    - the `append-json-string-slice` request.
  - **Unchanged:** the manifest and `CURRENT` schemas, readiness gating, VS Code and CLI adapters, and RPC method names.

## Component specifications

### 1. Contracts (platform-core, shared)

- **Purpose:** The port vocabulary, pure budget helpers and one RPC error code. This component ships first, so later components never duplicate code (N11).
- **Responsibilities:**
  - **`getAsync` projection:** `IAsyncStateStorage.getAsync<T>(key, defaultValue?, options?: { projection?: { omit: readonly StateStorageJsonPath[] } })`.
    - `'*'` matches every array index or object key.
  - **`StateStorageSequenceReadOptions`** gains `maxJsonBytes?`, `jsonEnvelopeBytes?` and `maxItemBytes?`.
  - **`StateStorageSequencePage`** gains `truncatedItems?: { index; originalJsonBytes }[]`.
  - **Errors:** `StateStorageValueTooLargeError { key, bytes }`, `StateStorageCursorStaleError { key }`.
  - **Breaking plan/receipt changes.** These are **not** part of the additive batch. They land in compilation group G (see the handoff):
    - `StateStorageNestedExtractionPlan.onMissingId` becomes `'drop-bulk'`, replacing `'retain-source'`.
    - New `dropFields: StateStorageJsonPath[]`, always removed from the detail.
    - New `textFallback?: { sourcePath; itemTemplate; contentPath }`, used only when the destination would be empty.
    - `StateStorageMigrationReceipt.retainedSourceCount` is replaced by the four counters defined in the architecture decision: `droppedStdoutCount`, `stdoutFallbackCount`, `droppedBulkWithoutIdCount` and `skippedItemCount`.
  - **Pure helpers in `utils/json-budget.ts`:**
    - `jsonUtf8Bytes(value)`.
    - `omitJsonPaths(value, paths)`. Clones the value by walking it and returns a new object; the input is not mutated.
    - `shrinkJsonStringLeaves(value, { maxEstimatorBytes, maxJsonBytes, estimate })`. Shrinks string leaves on code-point boundaries and adds the suffix `[truncated N bytes]` inside both budgets. Returns `null` if the value cannot fit.
  - **shared:** add `'OUTPUT_CURSOR_STALE'` to `RpcErrorCode`.
- **Verified contracts:**
  - `async-state-storage.interface.ts:13-59`
  - `state-storage-maintenance.interface.ts:27-69`
  - `state-storage-errors.ts:3,12`
  - `index.ts:20-50`
  - `rpc-error-codes.types.ts:8-19`
- **Dependencies:** none. Both are leaf libraries.
- **Integration points:** platform-electron, agent-sdk, vscode-core (forwards `options`), rpc-handlers, chat.
- **Failure behaviour:** types only. The helpers never throw on valid JSON.
- **Quality requirements:** shrink output satisfies both budgets, never splits a surrogate pair, and accounts for the suffix.
- **Verification seam:** helper specs covering control characters (6 JSON bytes each), multibyte and astral characters, suffix overhead, the `null` case, and wildcard omission.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/async-state-storage.interface.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/state-storage-maintenance.interface.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/state-storage-errors.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-core/src/index.ts`
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-core/src/utils/json-budget.ts` (+ `.spec.ts`)
  - MODIFY `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`

### 2. Commit store: verify-only load, fresh generations, publication outcome

- **Purpose:** Boot without parsing values, and never collide with or overwrite an attempted generation.
- **Responsibilities:**
  - **`initialize()`:**
    - A valid `CURRENT` returns `{ manifest }` after a streaming hash, existence and length check. No values are parsed, and the verdicts at `:143-222` are unchanged.
    - The v1 path returns `{ legacyValues, sourceSha256 }` **without committing**. The runtime commits once, after the split (component 3).
    - It scans the file names in `manifests/` and `values/` (`manifest.<g>.json`, `<hash>.<g>.json`, `.tmp` excluded) and records `highestOccupiedGeneration`.
  - **`readValue(key)`:** re-verifies length and hash, then parses with Zod. A mismatch throws `StateStorageRecoveryRequiredError(reason)`.
  - **`commit({ changes: ReadonlyMap<string, JsonValue|undefined>, previous, commitKind })`:**
    - `generation = max(previous?.generation ?? 0, highestOccupiedGeneration) + 1`.
    - `highestOccupiedGeneration` is set to `generation` **before any write**, so a failed attempt is never reused, on the same runtime or after a restart (the next scan sees its files).
    - `previousGeneration` stays `previous.generation`. The schema only requires it to be lower (`manifest.ts:58-68`).
    - Errors are wrapped as `ElectronStateCommitError { phase }`:
      - `'post-publication'` once the `CURRENT` rename has been attempted;
      - `'pre-publication'` before that.
  - **`readPointer()`:** reads and parses `CURRENT` only. Used for the runtime's reconcile.
  - `commitMutation` and `commitMigration` keep their epoch rules (`:112-141`).
- **Verified contracts:** commit store `:93-141,143-222,249-283,285-362,395-420`; manifest `:45-137`.
- **Dependencies:** manifest and protocol schemas.
- **Integration points:** runtime (component 3).
- **Failure behaviour:** classified errors. Boot verdicts are the same as in 411.
- **Quality requirements:**
  - Boot heap does not depend on blob contents.
  - No attempted generation is reused.
- **Verification seam:** the existing fault matrix (`commit-store.spec.ts:10-22` steps), plus:
  - For **every** step from `blob-written` to `current-flushed`: inject a throw, then a **successful** commit on the same instance, then the same after a fresh instance (restart).
  - A published manifest N+1 without a `CURRENT` move leaves the store readable at N, and the next commit is N+2.
  - An orphan blob `<hash>.<N+1>.json` alone also forces N+2.
  - Tampered, missing or short blobs are rejected on read.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts` (+ spec)

### 3. Worker side: loop, runtime, lazy values, split, protocol

- **Purpose:** Every response is bounded and every failure stays inside one request. The durable truth is never lost track of.
- **Responsibilities:**
  - **Loop (new `electron-state-storage-worker-loop.ts`):**
    - `.then(run, run)` chaining.
    - One `try` covers parse, handle, estimator check, response parse and `postMessage`.
    - On a throw it posts `failure` with `response-too-large` or `internal-error` for that `operationId`.
    - A failure to post is swallowed, with a `degradation-audit` marker.
    - `worker.ts` becomes a bootstrap only.
  - **Lazy values (new `electron-state-storage-value-store.ts`):**
    - A byte-bounded LRU (32 MiB by estimator) over `readValue`.
    - `has` and `keys` come from the manifest.
    - **No pinning.** Every page read re-reads the value, which is usually an LRU hit, and validates the cursor generation.
  - **Commit bookkeeping (runtime):**
    - Every mutation goes through `commitGuarded`.
    - On `ElectronStateCommitError`, the runtime evicts the changed keys from the LRU and calls `readPointer()`:
      - Pointer generation equals the runtime manifest: nothing landed. Reply `commit-failed` with `landed: false`.
      - Pointer names the attempted generation and its manifest verifies: adopt it. Reply `commit-failed` with `landed: true`.
      - Anything else: **retire**. Every later request replies `recovery-required`, or `commit-uncertain` when there is no durable reason.
  - **Cursors (stateless):**
    - Scalar: `g<blobGeneration>.p<projectionHash>.<operationOffset>`.
      - `projectionHash` is the first 16 hex characters of SHA-256 over the canonical JSON of the projection's `omit` paths. A request with no projection uses the literal `none`.
      - Every `read-scalar-page` continuation carries the same `projection` as the initial `get`.
      - The worker recomputes the hash and rejects a mismatch with `cursor-stale`.
      - It then loads the value (LRU or `readValue`), checks the generation, **reapplies `omitJsonPaths` and the 1 MiB ceiling**, regenerates operations from the projected value, and skips to the offset.
      - Offsets therefore always refer to the projected operation stream, so an LRU eviction between pages changes nothing.
    - Sequence: `g<blobGeneration>.<index>`.
    - Snapshot: `g<manifestGeneration>.<operationOffset>`.
    - The worker regenerates operations and skips to the offset. That costs quadratic time only up to the 1 MiB projected ceiling and the small cached-key set.
    - A generation mismatch replies `cursor-stale`.
    - The `snapshotCursors` map (`runtime.ts:215`) is deleted.
  - **Projected `get`:**
    - Apply `omitJsonPaths`, then check `jsonUtf8Bytes` against a 1 MiB ceiling. Over the ceiling, reply `value-too-large` and send no content.
    - Otherwise reply `value` if it fits the estimator, or `value-paged` with pages packed by the real estimator including the envelope.
    - An unprojected `get` of a non-cached key has the same ceiling.
  - **Sequence page:**
    - Honour `g`-cursors.
    - A non-array value replies `not-a-sequence`.
    - Pack items so the estimator size is ≤ `maxBytes` and `jsonUtf8Bytes(items)` plus `jsonEnvelopeBytes` is ≤ `maxJsonBytes`.
    - An item that fits neither alone is shrunk with `shrinkJsonStringLeaves` and reported in `truncatedItems`. If shrinking returns `null`, reply `value-too-large`.
  - **Item writes:** `append-json-sequence-item-ops { sequenceId, itemIndex, operations }` assembles one item from snapshot operations. `append-json-string-slice` is deleted.
  - **Split (moved to new `electron-state-storage-array-split.ts`, no change beyond the rules below):**
    - Runs in `initialize` on `legacyValues` **before the first commit**, so generation 1 is already lean. The fat source array is never written.
    - For each item without a usable id: skip it and increment `skippedItemCount`.
    - For each nested reference:
      - With an id: merge `sequenceFormat` fields into the destination using the existing longer-array merge (`runtime.ts:132-175`). Object-shaped destinations are converted by the same merge (`:143-155`). Then apply the text fallback:
        - If the merged destination is empty and `textFallback.sourcePath` is a non-empty string, write the single text item and increment `stdoutFallbackCount`.
        - Otherwise, if that string is non-empty, increment `droppedStdoutCount`.
      - Without an id: if the reference carries any of `stdout`, `segments` or `streamEvents`, increment `droppedBulkWithoutIdCount`, once per reference.
      - In both cases, delete `fields` and `dropFields` from the reference.
    - An existing v2 store still returns early on a matching index schema (`:634-652`).
  - **Protocol:**
    - Requests:
      - `get` gains `projection?`.
      - Add `read-scalar-page { key, cursor, maxBytes, projection? }`.
      - `read-json-sequence` gains the dual-budget fields.
      - Add `append-json-sequence-item-ops`.
    - Responses:
      - Add `value-paged` and `scalar-page`.
      - `json-sequence-page` gains `truncatedItems?`.
      - `failure` gains `landed?`.
    - New codes: `response-too-large`, `value-too-large`, `not-a-sequence`, `cursor-stale`, `commit-failed`, `commit-uncertain`, `internal-error`.
    - Split-plan and receipt schemas follow component 1.
- **Verified contracts:** worker `:10-48`; runtime `:132-175,210-709`; protocol `:157-223,286-483,536-633,781-946`.
- **Dependencies:** components 1 and 2.
- **Integration points:** host (component 4). Build entry `apps/ptah-electron/project.json:193` is unchanged.
- **Failure behaviour:** Every error is a typed per-request failure. A retired runtime refuses every request.
- **Quality requirements:**
  - Every response ≤ 262,144 bytes by estimator.
  - Worker heap bounded by the LRU plus one value in flight, except during the one-time v1 split (A1).
  - Zero `unhandledRejection`.
- **Verification seam:** The runtime and loop are driven in-process through a `MessageChannel` with temp-dir fixtures and `ElectronStateFaultInjector`.
- **Files:**
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-loop.ts` (+ `.spec.ts`)
  - REWRITE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker.ts`
  - REWRITE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts` (+ `worker-runtime.error-paths.spec.ts`)
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-value-store.ts` (+ `.spec.ts`)
  - CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.ts` (+ `.spec.ts`)
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` (+ spec)

### 4. Host, `ElectronStateStorage`, workspace forwarding

- **Purpose:** The main-thread adapter receives only bounded, projected content. It keeps its cache truthful and writes in bounded pages.
- **Responsibilities:**
  - **`getAsync(key, default, options)`:**
    - An unprojected cached key answers from the cache.
    - Otherwise send `get`, follow `value-paged` pages, and reassemble. `refreshSnapshot`'s assembly is reused as an internal function in the host file, with no new file.
    - Every `read-scalar-page` continuation re-sends the projection from the original `get` (R3-1).
    - On `cursor-stale`, restart once, then throw `StateStorageCursorStaleError`.
    - `value-too-large` becomes `StateStorageValueTooLargeError`.
  - **Uncertain commit (N8):**
    - On `commit-failed`, `commit-uncertain` or `io-failed` from any mutating request:
      1. Delete the cache entries of the touched keys.
      2. For each touched key that is not excluded, send `get`.
      3. Re-cache the result, or delete the entry if absent.
      4. Only then surface the error.
    - If that refresh fails, set a sticky `readinessState = recovery-required`, so `assertReady` fails fast.
    - `recovery-required` responses set the same state.
  - **Writes:** `writeLargeScalar` and `executeReplaceJsonSequence` pack operation pages by calling `assertElectronStateWorkerPayloadWithinBudget` on the candidate request. The `128 +` heuristic (`host.ts:265-297`) and `extractLargeStrings`' whole-item send (`:398-408`) are removed.
  - **`withRestart`:** retries only a crash, once. A typed failure is never retried. The existing chain swallow at `:680-684` is kept.
  - **`readJsonSequence`:** forwards dual budgets and surfaces `truncatedItems`.
  - **Forwarding:** `WorkspaceAwareStateStorage.getAsync` forwards `options` (`workspace-aware-state-storage.ts:165-170`).
- **Verified contracts:** host `:92-169,191-235,247-330,386-446,531-614,676-698`; `electron-state-storage.ts:108-156,183-238`.
- **Dependencies:** components 1 and 3. Domain-agnostic.
- **Integration points:** agent-sdk (component 5).
- **Failure behaviour:** Typed errors go only to their caller. After an uncertain commit, the cache matches durable state or the store fails closed.
- **Quality requirements:**
  - No message over 262,144 bytes in either direction.
  - A projected read delivers at most 1 MiB of JSON to main.
- **Verification seam:** Host spec against the real loop and runtime through a `MessageChannel`, instrumented to record estimator bytes per message and total received JSON bytes per call.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts` (+ spec, `error-paths.spec.ts`)
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage.ts` (+ `electron-state-storage.spec.ts`, `degraded-paths.spec.ts`)
  - MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts`
  - MODIFY `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts` (+ spec)

### 5. Session metadata store and recipe (agent-sdk)

- **Purpose:** A lean recipe, and a store that never reads or writes bulk inline.
- **Responsibilities:**
  - **`SESSION_METADATA_MIGRATION` changes:**
    - `onMissingId: 'drop-bulk'`
    - `dropFields: [['stdout']]`
    - `textFallback: { sourcePath: ['stdout'], itemTemplate: { tag: 'segment', value: { type: 'text', content: '' } }, contentPath: ['value', 'content'] }`
  - **`DETAIL_PROJECTION`:** `{ omit: [['cliSessions','*','stdout'], ['cliSessions','*','segments'], ['cliSessions','*','streamEvents']] }`.
    - `get()` uses it on async storage.
    - Sync storage applies `omitJsonPaths` in memory, so both paths return the same shape.
  - **Writes:** `_saveInternal` removes `stdout`, `segments` and `streamEvents` from every reference before writing, on both storage kinds. `leanCliSessions`, `migrateRefOutput`, `leanCliSessionRef`, `getAgentOutput` and `MAX_PERSISTED_REF_SEGMENTS` are deleted.
  - **Write accounting.** When `strippedBulkRefCount > 0`, `_saveInternal` logs `info` with `{ sessionId, strippedBulkRefCount }`. The count is one per reference.
  - **`saveAgentOutput(agentId, { stdout?, segments?, streamEvents? })`:**
    - Writes segments, then streamEvents.
    - When both are empty and `stdout` is non-empty, it writes the single text segment instead.
    - Async storage uses `replaceJsonSequence`. Sync storage uses a `PersistedAgentOutput` whose `segments` hold that text segment.
    - The existing debug log (`:810-816`) becomes `info` whenever `stdoutDropped` or `stdoutFallback` is true, and its payload carries both booleans.
  - **`getCliSessionsForRestore`:** returns projected references.
  - **`getAgentOutputPage`, async:**
    - Exactly one `readJsonSequence` call, with:
      - `maxBytes = min(maxBytes, 256 KiB)`
      - `maxJsonBytes = rpcBudget`
      - `jsonEnvelopeBytes = rpcOutputPageBytes([], cursorReservation, false)`
      - `maxItemBytes` equal to the same bound.
    - `StateStorageCursorStaleError` becomes `AgentOutputCursorStaleError`.
    - The widen/narrow search (`:915-966`) is deleted.
    - The guard at `:952-958` stays as an assertion.
  - **`getAgentOutputPage`, sync:**
    - Cursor is `s<savedAt>.<index>`.
    - Oversized items go through `shrinkJsonStringLeaves` with both budgets.
- **Verified contracts:** `session-metadata-store.ts:142-206,242-312,460-606,671-680,775-846,849-1012`; barrel `agent-sdk/src/index.ts:26-27`.
- **Dependencies:** component 1.
- **Integration points:** rpc-handlers (component 7), cli-agent-runtime (component 6), and the composition root. `phase-1-infra.ts:112` is unchanged because the export name stays the same.
- **Failure behaviour:** Page errors are rethrown as typed errors.
- **Quality requirements:**
  - A source-level spec proves that no read of a detail runs without a projection.
  - No output is assembled on main.
  - The file shrinks, because the deletions exceed the additions.
- **Verification seam:** `session-metadata-store.spec.ts`, with the async fake and a sync fake that has no sequence API.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (+ spec)

### 6. CLI agent writer

- **Purpose:** New writers never store bulk inline.
- **Responsibilities:**
  - When `saveAgentOutput` exists, the reference in `agent-events.ts` omits `stdout` and `segments` (`:399,406-408`).
  - `saveAgentOutput` receives `stdout` (`:430-433`).
  - `SdkSessionMetadataStoreLike` is widened to match (`:44-60`).
  - `AgentProcessManager` is unchanged. The accepted restored-stdout change follows from the references, and the restore spec is updated to match.
- **Verified contracts:** `agent-events.ts:44-60,342-436`; `agent-process-manager.service.ts:802-866`.
- **Dependencies:** agent-sdk public barrel.
- **Integration points:** `SessionMetadataStore`.
- **Failure behaviour:** Unchanged. The retry wraps bulk first, then the reference (`:424-463`).
- **Quality requirements:** not applicable.
- **Verification seam:** The agent-events spec checks that references carry no bulk and that `saveAgentOutput` gets `stdout`. `agent-process-manager.restore.spec.ts` checks that a restored reference with no `stdout` yields an empty buffer.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts`

### 7. RPC handlers

- **Purpose:** Surface typed storage failures without leaking internals.
- **Responsibilities:**
  - **`session:cli-output-page`** (`session-rpc.handlers.ts:818-834`):
    - `AgentOutputCursorStaleError` becomes `RpcUserError('Agent output changed', 'OUTPUT_CURSOR_STALE')`.
    - `StateStorageValueTooLargeError` becomes an `RpcUserError` with a fixed message.
    - Raw `error.message` is never passed to the client.
  - **Membership check:** stays `get(sessionId)`, which is now projected.
  - **`chat:resume` and `session:cli-sessions`:** no code change beyond spec mocks.
- **Verified contracts:** `session-rpc.handlers.ts:774-859`; `chat-session.service.ts:854,912-939`.
- **Dependencies:** components 1 and 5.
- **Integration points:** webview. No new method, and no change to `ALLOWED_METHOD_PREFIXES`.
- **Failure behaviour:** `session:cli-sessions` still returns `[]` on failure (`:800-810`).
- **Quality requirements:** not applicable.
- **Verification seam:** `session-rpc.handlers.spec.ts`.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` (+ spec)

### 8. Webview lazy output

- **Purpose:** Load sub-agent output only when a card is expanded, and recover from a stale cursor.
- **Responsibilities:**
  - **`AgentMonitorStore`** adds:
    - `cliOutputDemand`, a computed of restored cards with `expanded && historyDone !== true`;
    - `resetCliOutputHistory(sessionId, agentId)`, which clears history-derived `segments` and `streamEvents`, resets the cursor and done flag, and bumps `streamRevision`.
  - **`SessionLoaderService`:**
    - Removes the eager `loadCliOutputPages` calls (`:902`, `:1116`).
    - Adds an `effect()` over `cliOutputDemand` that loads one card at a time per session.
    - On `OUTPUT_CURSOR_STALE`: reset and restart once, then warn and stop.
- **Verified contracts:** `agent-monitor.store.ts:943-960,1030-1139`; `session-loader.service.ts:896-1118`.
- **Dependencies:** chat → chat-streaming (one way), plus the shared code from component 1.
- **Integration points:** `session:cli-output-page`.
- **Failure behaviour:** Existing warn and marker drop (`:983-989`).
- **Quality requirements:**
  - Zero page RPCs before a card is expanded.
  - OnPush and signals.
- **Verification seam:**
  - `session-loader.service.spec.ts` and `session-loader.cli-restore.spec.ts`: no request before expand, one sequence after expand, and the stale reset.
  - Store spec for the reset.
- **Files:**
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (+ spec)
  - MODIFY `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (+ specs)

## Integration architecture

- **First boot after upgrade (shipped users).** The worker reads v1, applies the corrected split in memory, then commits generation 1 lean: the index, lean details, and agent sequences. The store becomes ready, and the host snapshot hydrates the index and small keys.
- **List.** `session:list` calls `getAll`, which answers from the host cache.
- **Resume.**
  1. `get(sessionId, DETAIL_PROJECTION)` returns at most 1 MiB, or a typed error.
  2. Lean references are restored.
  3. Cards render collapsed.
  4. On expand, `session:cli-output-page` performs a projected membership check, then one dual-budget `readJsonSequence`.
  5. A stale cursor resets the card.
- **Agent exit.**
  1. `saveAgentOutput` writes the sequence, or the text fallback.
  2. `addCliSession` writes a lean reference.
- **Commit failure.**
  - The runtime reconciles against `CURRENT` (landed or not landed), or retires.
  - The host refreshes the touched cache keys before surfacing the error.
  - The next commit uses a fresh generation.
- **State ownership.** The worker owns durable state and a bounded LRU. The host owns a cache of small keys that are not excluded. No cursor state exists anywhere.
- **External boundaries.** Zod on every worker message, a hash re-check on every blob read, and `SessionCliOutputPageParamsSchema` at the RPC boundary.
- **Rollback.**
  - There is no `materialize-v1`, and none is promised. This is recorded as unmet from TASK_2026_411.
  - v1 is retained untouched, so deleting `workspace-state.v2/` rebuilds from it.
  - v0.1.70 never reads v2 (git-verified), so no downgrade contract exists.
- **Observability.** Split receipt counters (`droppedStdoutCount`, `stdoutFallbackCount`, `droppedBulkWithoutIdCount`, `skippedItemCount`) are logged by `ElectronStateStorage` at ready, through an optional `onMigrationReceipt` callback wired in `phase-1-infra.ts:106-116` to the Logger. Typed errors carry keys and byte counts, never content.

## Architecture-level quality requirements

- **Functional:**
  - A real-shape v1 fixture boots.
  - `session:list`, `chat:resume` and `session:cli-sessions` succeed.
  - No `ptah.session:*` value contains `stdout`, `segments` or `streamEvents`.
  - Agents that have no sequence items but do have `stdout` get exactly one text segment.
- **Performance:**
  - Estimator bound per message.
  - 1 MiB JSON bound per projected read.
  - RPC JSON bound per output page.
  - Boot heap for an existing v2 store does not depend on value contents.
  - The v1 split finishes within the handshake budget (A1).
- **Security:** no content in logs, hash-verified reads, Zod at boundaries.
- **Maintainability:**
  - platform-electron stays domain-agnostic, and platform-core stays a leaf.
  - No version fields, receipts or sweeps.
  - The deletions listed above are carried out.
  - The facade rule applies to the runtime split into loop, value store and array split.
- **Testability:** every typed failure is asserted, and the regression fixture fails on `main`.

## Test plan

1. **Regression (red on `main` first).** File: `electron-state-storage-oversized-profile.spec.ts`.
   - The v1 JSON fixture contains:
     - a 1,000-session array;
     - one session with 28 references, each carrying 102,400 units of `stdout` and existing segment outputs;
     - one reference with `stdout` and no destination;
     - one reference with no id;
     - one session with no `sessionId`;
     - one 1.1 MB `command` item;
     - one object-shaped agent output;
     - a nested item built only from 20 KiB strings whose estimator total exceeds 262,144.
   - **Red on `main` through existing entry points only (R3-2).** Two layers:
     - **(a) platform-electron spec.** Uses `ElectronStateStorage` with the existing `workerFactory` option (`electron-state-storage.ts:32`). The fake worker reproduces `electron-state-storage-worker.ts:20-48` exactly, using only symbols that exist on `main`:
       1. `parseElectronStateWorkerRequest`
       2. `new ElectronStateWorkerRuntime().handle`
       3. `assertElectronStateWorkerPayloadWithinBudget(response)` outside `try`
       4. a throw emits the fake's `error` event, mirroring an unhandled rejection in the worker.
     - **(b) `apps/ptah-electron` spec.** Spawns the real bundle `dist/apps/ptah-electron/state-storage-worker.mjs`, produced by `build-state-storage-worker` (`apps/ptah-electron/project.json:187-200`), through the default factory.
       - Assumption A4: that target must be in `ptah-electron` `test.dependsOn`, following the esm-bundle-gate pattern. Check it, and add it in batch B0 if it is missing.
     - Both layers run before any production change. Record the failure on `main`: `Worker message exceeds 262144 bytes`.
     - Once group G lands, layer (a) swaps its hand-rolled loop for `createElectronStateWorkerMessageLoop`. The assertions stay identical, and layer (b) is unchanged.
   - Assert:
     - the index read resolves;
     - the projected detail resolves and holds no bulk;
     - the output page resolves with `truncatedItems`;
     - the structural item write succeeds;
     - the text fallback exists only for the reference with no destination;
     - receipt counters: `droppedStdoutCount === 28`, `stdoutFallbackCount === 1`, `droppedBulkWithoutIdCount === 1`, `skippedItemCount === 1`;
     - no crash error.
   - On `main`, the counter assertions are not reached, because the index read crashes first.
     1a. **Projected scalar continuation (R3-1).** Uses a dev-shaped v2 fixture: a detail with 28 fat references whose projection is under 1 MiB but spans more than one estimator page.
   - **Multi-page projected read.** The assembled result deep-equals `omitJsonPaths(raw, DETAIL_PROJECTION)` and holds no `stdout`, `segments` or `streamEvents`.
   - **LRU eviction between pages.** Use a test LRU sized so the value is evicted between continuations. The result is identical.
   - **Changed projection.** A continuation sent with a different projection returns `cursor-stale`. A continuation with no projection after a projected start returns `cursor-stale`.
   - **Raw size above 1 MiB, projection below.** A raw value over 1 MiB whose projection fits the ceiling resolves.
2. **Commit generations (N2).** For every pre-publication fault step: a successful mutation on the same runtime, then another after a restart. Also: a manifest N+1 published without `CURRENT`, and an orphan blob N+1.
3. **Reconcile or retire (BLOCKER, N8).**
   - Faults at `current-renamed` and `current-verified`, followed by another mutation on the same runtime: files referenced by `CURRENT` stay byte-identical, and the host cache for the index equals the durable value.
   - A reconcile failure retires the store and sets readiness to `recovery-required`.
4. **Fault isolation.** Over-budget responses, runtime throws and invalid requests fail only their own operation, and the next request succeeds. Zero `unhandledRejection`. A typed failure is not retried, and a crash is retried once.
5. **Cursors (N9).**
   - Abandoned scalar, sequence and snapshot reads leave no worker state; assert internal map counts are zero.
   - A sequence rewrite between pages replies `cursor-stale`, and the host restarts once.
   - A worker heap probe over 1,000 abandoned reads stays within the LRU bound.
6. **Main-thread total (N10).**
   - A detail with 1.5 MiB of metadata that is not output returns `StateStorageValueTooLargeError`, and main receives zero content bytes.
   - The largest real-shape detail delivers at most 1 MiB, with no omitted fields.
7. **Dual budget.** Pages of items full of control characters, multibyte and astral characters, and suffix overhead satisfy both the estimator and `rpcOutputPageBytes`. The guard at `session-metadata-store.ts:952-958` never fires.
8. **Domain.**
   - The store spec on async and sync fakes covers:
     - projection parity;
     - bulk removed on write, with `strippedBulkRefCount` logged once per reference;
     - `saveAgentOutput` text fallback only when there is no other output, with `stdoutDropped` and `stdoutFallback` logged;
     - sync cursor and shrink behaviour.
   - Agent-events: references have no bulk.
   - Restore spec: the restored buffer is empty.
   - RPC spec: error mapping.
9. **UI.** No page before expand, lazy load on expand, and a stale reset that restarts once.
10. **Perf (opt-in, `PTAH_PERF_SPECS=1`).**
    - A real-shape 328 MB v1 split: time to ready is below 120 s (A1), and worker peak heap is recorded.
    - Hash-verify boot of a 240 MB v2 store (A2).

**Commands** (never multi-project `nx test`; check that each `Running target … for N projects` line shows the expected N):

```bash
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/agent-sdk
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run di-lint:lint
npx nx run degradation-audit:lint
```

Run platform-electron on its own to confirm any flake, since it is known to be fragile under disk load (`e2e-storage-fix-report.md:175-187`). Smoke tests: `nx test ptah-extension-vscode` and `nx test @ptah-extension/cli-engine`.

## Team-leader handoff

- **Recommended executors:**
  - backend-developer: components 1–7.
  - frontend-developer: component 8.
  - senior-tester: batch B0 (test 1 layers a and b, red on `main` through existing entry points). Tests 1a–3 are written inside group G, and 4–9 follow as their batches land.
  - code-logic-reviewer (mandatory): group G as a whole, plus component 5's write-path deletions.
- **Complexity: HIGH.** This is a durable storage engine with generation safety. It spans 5 backend libs, `shared`, and 2 frontend libs, and it is now the path every shipped user takes on upgrade.
- **Batches (every batch leaves the workspace compiling; R3-2):**

  | Batch                                                                                            | Content                                                                                                                                                                                                                                                                                   | Compiles because                                                                                              |
  | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
  | **B0** (tests only)                                                                              | Test 1 layers (a) and (b) against `main` symbols. Add `build-state-storage-worker` to `ptah-electron` `test.dependsOn` if absent (A4).                                                                                                                                                    | No production change. Both layers must be red.                                                                |
  | **B1** (additive only)                                                                           | Component 1's additive parts: `json-budget.ts`, the two new error classes, optional `getAsync` `options`, optional sequence read fields, optional `truncatedItems`, shared `'OUTPUT_CURSOR_STALE'`. Also component 4's one-line `WorkspaceAwareStateStorage.getAsync` options forwarding. | All new members are optional or new exports. No existing consumer changes.                                    |
  | **G** (one atomic compilation gate, declared as a group; one executor or one integration commit) | Component 1's breaking plan and receipt edits; all of component 2; all of component 3; component 4 except the forwarding already in B1; and **only** the `SESSION_METADATA_MIGRATION` literal edit in component 5.                                                                        | Every breaking change lands together with every consumer.                                                     |
  | **B3**                                                                                           | The rest of component 5, plus component 6.                                                                                                                                                                                                                                                | `saveAgentOutput`'s new `stdout` parameter is optional, so component 6 compiles against it in the same batch. |
  | **B4**                                                                                           | Component 7.                                                                                                                                                                                                                                                                              | Needs `AgentOutputCursorStaleError` from B3.                                                                  |
  | **B5**                                                                                           | Component 8. Can run in parallel with G, B3 and B4 once B1 has landed.                                                                                                                                                                                                                    | Needs only the shared code from B1.                                                                           |
  | **B6**                                                                                           | `phase-1-infra.ts` `onMigrationReceipt` logger wiring.                                                                                                                                                                                                                                    | Needs G's option.                                                                                             |

  Group G contents, by breaking change and its consumers:

  | Breaking change                       | Consumers that must change with it                                                                                                  |
  | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | `onMissingId` literal                 | `state-storage-maintenance.interface.ts:45`, `worker-protocol.ts:180`, `session-metadata-store.ts:194`, `worker-runtime.ts:670-676` |
  | Receipt fields                        | `state-storage-maintenance.interface.ts:66`, `worker-protocol.ts:200-210`, `worker-runtime.ts:629,648,658,704`                      |
  | Split-plan schema typing              | `worker-protocol.ts:185-198`                                                                                                        |
  | Commit-store `initialize` result      | `worker-runtime.ts:437-439`                                                                                                         |
  | Removal of `append-json-string-slice` | `worker-protocol.ts:225-250,348`, `worker-runtime.ts:274-317`, `worker-host.ts:409-429`                                             |

  After G, test 1 layer (a) switches its hand-rolled loop to `createElectronStateWorkerMessageLoop`.

- **Parallel-safe work:**
  - B0 and B1 can run in parallel.
  - G is serial inside itself.
  - B5 can run in parallel with G, B3 and B4.
  - B4 follows B3.
  - B6 follows G.
- **Files affected:**
  - **CREATE:**
    - `libs/backend/platform-core/src/utils/json-budget.ts` (+ spec)
    - platform-electron `electron-state-storage-worker-loop.ts` (+ spec)
    - platform-electron `electron-state-storage-value-store.ts` (+ spec)
    - platform-electron `electron-state-storage-array-split.ts` (+ spec)
    - platform-electron `electron-state-storage-oversized-profile.spec.ts`
  - **REWRITE:**
    - platform-electron `electron-state-storage-worker.ts`
    - platform-electron `electron-state-storage-worker-runtime.ts`
  - **MODIFY:**
    - platform-core: `async-state-storage.interface.ts`, `state-storage-maintenance.interface.ts`, `state-storage-errors.ts`, `index.ts`
    - shared: `rpc-error-codes.types.ts`
    - platform-electron: `electron-state-storage-commit-store.ts`, `-worker-protocol.ts`, `-worker-host.ts`, `electron-state-storage.ts`, plus their specs and `large-profile.perf.spec.ts`
    - vscode-core: `workspace-aware-state-storage.ts` (+ spec)
    - agent-sdk: `session-metadata-store.ts` (+ spec)
    - cli-agent-runtime: `wiring/agent-events.ts` (+ spec), `agent-process-manager.restore.spec.ts`
    - rpc-handlers: `session-rpc.handlers.ts` (+ spec)
    - apps/ptah-electron: `src/di/phase-1-infra.ts` (`onMigrationReceipt` logger wiring only)
    - chat-streaming: `agent-monitor.store.ts` (+ spec)
    - chat: `session-loader.service.ts` (+ specs)
- **Verification points:**
  - Resolve A1–A4 before building on them.
  - Test 1 (B0) must be red on `main` through existing entry points, with the output recorded.
  - Tests 1a–3 must pass before group G is accepted.
  - Run `npx nx run-many -t typecheck` over the full project list at the end of **every** batch.
  - Put the one-time instruction "delete `workspace-state.v2/` to rebuild from v1", and the object-shaped dev-store `not-a-sequence` limitation, in the batch report and the release note.
  - Fixtures live in temp dirs only. Never touch `C:/Users/abdal/AppData/Roaming/Ptah/...`.
  - No explanatory comments. Use `catch (error: unknown)`. Zod on new worker operations. `degradation-audit` markers must stay accurate.
  - Carry out every deletion listed in the architecture decision. Add no version fields, receipts, sweeps or compatibility flags.
  - Tell the user about the accepted `ptah_agent_read` restored-stdout change, and about the dev rebuild procedure (delete `workspace-state.v2/`).
  - Out of scope, to record in `future-enhancements.md`:
    - `materialize-v1` (unmet from TASK_2026_411);
    - a paged session index (the O(sessions) main-thread index);
    - `isReferencedAsChildSession` reading `cliSessions` from lean index items (`session-metadata-store.ts:1407-1419`);
    - whole-index rewrite per save (`:479-488,632-647`);
    - unreferenced generation-blob sweep.

## Review resolution (Codex round 1)

Superseded where round 2 and the new scope apply.

| #   | Finding                                                  | Verdict                                           | Current handling                                                                                                                                             |
| --- | -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Post-publication commit failure (BLOCKER)                | Accepted                                          | Component 2: phase classification and fresh generations. Component 3: reconcile or retire. Component 4: cache refresh. Tests 2–3.                            |
| 2   | `stdout` placement and cursors                           | Retired by scope (placement) / accepted (cursors) | There is no stdout partition. The text fallback exists only for an empty destination. Generation-bound cursors plus a UI reset (components 3 and 8, test 5). |
| 3   | Unsafe tail-window choice                                | Retired by scope                                  | Old sessions carry no fidelity requirement. `stdout` is never merged with other output; it is a fallback only (architecture decision).                       |
| 4   | Restore memoizes a pending absence; sync lacks sequences | Retired by scope                                  | No pending state and no lazy stdout loader. Sync paths use in-memory records (component 5).                                                                  |
| 5   | Main-thread hydration                                    | Accepted                                          | Worker-side projection plus a 1 MiB ceiling (components 3 and 4, test 6).                                                                                    |
| 6   | Maintenance progress model                               | Retired by scope                                  | No sweep. The corrected split runs once, before the first commit.                                                                                            |
| 7   | Structurally large writes                                | Accepted                                          | Operation-paged item writes (components 3 and 4, test 1).                                                                                                    |
| 8   | Dual estimator                                           | Accepted                                          | Component 1 helpers and component 3 packing (test 7).                                                                                                        |
| 9   | `materialize-v1` absent                                  | Accepted                                          | Claim withdrawn and recorded as unmet.                                                                                                                       |

## Review resolution (Codex round 2)

| #   | Finding                                             | Verdict                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                           | Plan change                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | A projected save discards output retained inline    | Retired by scope                         | Inline retention no longer exists. The split drops bulk for references without an id (`onMissingId: 'drop-bulk'`, replacing `retain-source` at `state-storage-maintenance.interface.ts:45`, `runtime.ts:670-676`). Writers remove bulk before writing, so a projected save has nothing to discard. Pre-fix dev stores lose inline bulk on the next write, which the user accepted. | Architecture decision (missing-id rule); components 3 and 5                                                                                                                                                                                                                      |
| N2  | The collision guard strands writes                  | Accepted                                 | `commit-store.ts:286` derives N+1 from `previous`. The failed attempt's files remain (`:305-313,335-342`).                                                                                                                                                                                                                                                                         | Component 2: `highestOccupiedGeneration` from manifest **and** blob file names, raised before any write. Collision guard removed. Test 2 checks a successful mutation after every pre-publication fault, on the same runtime and after a restart.                                |
| N3  | `pendingMaintenance` is unreachable                 | Retired by scope                         | No maintenance or pending signal exists. `getAsync` stays value-returning (`async-state-storage.interface.ts:40`).                                                                                                                                                                                                                                                                 | Removed from components 1, 3, 5 and 6                                                                                                                                                                                                                                            |
| N4  | Deduplication breaks the latest-snapshot preference | Retired by scope                         | No variants and no deduplication. There is at most one text fallback item, and only when the destination is empty.                                                                                                                                                                                                                                                                 | Architecture decision (`stdout` rule)                                                                                                                                                                                                                                            |
| N5  | Downgrade premise vs `electron-v0.1.70`             | Accepted as fact / retired by scope      | The orchestrator verified that `122770d90` is not an ancestor of `electron-v0.1.70`, whose tree has no worker files. No downgrade contract is claimed.                                                                                                                                                                                                                             | Integration architecture (rollback)                                                                                                                                                                                                                                              |
| N6  | A resumed scan skips intervening writes             | Retired by scope                         | No sweep and no watermark.                                                                                                                                                                                                                                                                                                                                                         | Removed                                                                                                                                                                                                                                                                          |
| N7  | Sync live saves erase migrated variants             | Retired by scope                         | No preserved variants. A sync `saveAgentOutput` replaces its record as it does today (`session-metadata-store.ts:787,807-808`), which is correct under the simplified rule.                                                                                                                                                                                                        | Component 5                                                                                                                                                                                                                                                                      |
| N8  | Stale host cache after a commit that landed         | Accepted                                 | `host.ts:215-235` updates the cache only after success.                                                                                                                                                                                                                                                                                                                            | Component 4: invalidate and refresh the touched keys before surfacing the error, or fail closed. Test 3 at host level.                                                                                                                                                           |
| N9  | Cursor pinning defeats the memory bound             | Accepted (simplified)                    | `runtime.ts:215,491-543` keeps cursor state until the read finishes.                                                                                                                                                                                                                                                                                                               | Component 3: stateless generation-bound cursors for all read kinds; pinning and `snapshotCursors` removed. Test 5 covers abandonment and heap.                                                                                                                                   |
| N10 | 256 KiB main-thread guarantee not enforced          | Amended (guarantee revised and enforced) | `host.ts:561-580` reconstructs whole values.                                                                                                                                                                                                                                                                                                                                       | Architecture decision: explicit 4-part guarantee (per-message estimator; 1 MiB projected-read ceiling measured in the worker before sending; index cache O(sessions), stated as unbounded; RPC page budget). Test 6 uses an adversarial detail with metadata that is not output. |
| N11 | Handoff dependency gaps                             | Accepted                                 | The shared merge helper no longer exists. The one shared change (`OUTPUT_CURSOR_STALE`) and all platform-core helpers now belong to component 1, which is first in order.                                                                                                                                                                                                          | Component 1; handoff ordering; tests gate integration                                                                                                                                                                                                                            |

## Review resolution (Codex round 3)

| #    | Finding                                                         | Verdict                      | Evidence                                                                                                                                                                                                                                            | Plan change                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-1 | A stateless scalar continuation loses its projection            | Accepted                     | `worker-runtime.ts:491-543` keeps an iterator today. `worker-host.ts:549-580` assembles exactly the operations it receives. The revision-3 `read-scalar-page` carried no projection.                                                                | Component 3: cursor `g<gen>.p<projectionHash>.<offset>`; the projection is re-sent on every continuation; projection and 1 MiB ceiling are reapplied before operations are regenerated; a mismatch returns `cursor-stale`. The protocol adds `projection?` to `read-scalar-page`. Component 4: the host re-sends the projection. Test 1a covers a multi-page read, LRU eviction between pages, and changed or missing projection. |
| R3-2 | The handoff does not compile batch by batch                     | Accepted                     | `session-metadata-store.ts:194` (`'retain-source'`); `worker-protocol.ts:180,185-198,200-210`; `worker-runtime.ts:437-439,629-704`; string-slice consumers `worker-protocol.ts:225-250,348`, `worker-runtime.ts:274-317`, `worker-host.ts:409-429`. | Handoff batches B0–B6: additive contracts first (B1); every breaking change grouped with its consumers in atomic group G; the test-1 red baseline goes through existing `main` entry points (`workerFactory` fake mirroring `worker.ts:20-48`, plus the real `state-storage-worker.mjs` bundle) and switches to the extracted loop after G; typecheck at the end of every batch. A4 added.                                        |
| R3-3 | Drop accounting contradicts the stdout rule                     | Accepted                     | `worker-runtime.ts:673` counts missing ids only. `session-metadata-store.ts:810-816` logs output counts with no drop accounting.                                                                                                                    | Architecture decision: counting units defined, one per `cliSessions` reference, with four receipt counters. Component 3: counter placement in the split. Component 5: `strippedBulkRefCount`, `stdoutDropped` and `stdoutFallback` logged at info on live saves. Test 1 expects 28 / 1 / 1 / 1. Test 8 asserts the live-save logs.                                                                                                |
| Note | Dev v2 store: object-shaped output, and the rebuild instruction | Accepted (stated limitation) | Object-shaped values fail `readSequencePage` (`worker-runtime.ts:563-565`).                                                                                                                                                                         | Architecture decision: an isolated `not-a-sequence` failure per agent is an accepted limitation. The one-time "delete `workspace-state.v2/`" instruction goes in the batch report and release note (handoff verification points).                                                                                                                                                                                                 |

## Addendum: B7 — bounded-memory v1 split

**Verdict.** Replace the whole-file v1 parse with a byte-level structural scanner written in-house, with no new dependency.

- The scanner makes two passes over the file:
  1. Validate and index. Nothing is written.
  2. Stream blobs through a new streaming initial-commit sink.
- Values are still parsed with `JSON.parse`, one bounded byte span at a time.
- Publication stays one atomic `CURRENT` write.
- **Target:** peak worker used heap **≤ 256 MiB** on the 328.6 MB fixture, against 1,028.5 MB today. The design expectation is 100–160 MB. Peak is bounded by the largest single parsed span plus open merge state, not by file size.

### B7.1 Evidence (committed code, `fix/task-430-state-worker-bounded` @ `a070b312a`)

| Evidence                                                                                                                                                                                                                                                                                                                                         | Location                                                                    | Implication                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `loadLegacy` reads the whole file, calls `JSON.parse(bytes.toString('utf8'))`, runs a Zod record parse over the whole object, and hashes `sha256(bytes)`                                                                                                                                                                                         | `electron-state-storage-commit-store.ts:372-400`                            | The heap holds three copies at once (buffer, UTF-16 string, object graph). This is the 1,028.5 MB peak (`completion-report.md:57`).    |
| `initialize()` runs `loadLegacy` before `quarantineIncompleteV2` and returns `legacyValues`                                                                                                                                                                                                                                                      | commit store `:135-148`                                                     | A malformed v1 file fails before any v2 write. That ordering must be kept.                                                             |
| A missing file (`ENOENT`) is read as `'{}'`. A parse or schema failure throws `StateStorageRecoveryRequiredError('migration-failed')`                                                                                                                                                                                                            | commit store `:379-395`                                                     | These error contracts must be kept.                                                                                                    |
| `initializeFromLegacy` builds `new Map(Object.entries(legacyValues))`, applies each plan's changes, then calls `store.commitInitial(values, sourceSha256)`                                                                                                                                                                                       | `electron-state-storage-worker-runtime.ts:439-461`                          | Every value is in memory at once. The migration is exactly one atomic commit.                                                          |
| `writeGeneration` writes each blob (stringify, write, fsync, rename, verify), then the manifest, then `CURRENT` last (the publication step)                                                                                                                                                                                                      | commit store `:408-504,537-564`                                             | Blobs can be streamed one at a time within the existing durability model.                                                              |
| A crash before `CURRENT` leaves no valid pointer, which triggers `retry-v1` and quarantine                                                                                                                                                                                                                                                       | commit store `:249-259,402-406`                                             | A half-written split is never readable as complete.                                                                                    |
| The in-memory split walks items in array order and references in nested order. A merge depends only on earlier state of the same destination. The fallback test is `merged.length === 0`. A later duplicate id overwrites the detail key. A summary is kept for every item. The receipt `sourceSha256` is `sha256(JSON.stringify(sourceArray))`. | `electron-state-storage-array-split.ts:136-190,233-265,267-341`             | The streaming replay must reproduce this order. The hash can be rebuilt incrementally as `'[' + items.map(stringify).join(',') + ']'`. |
| `runSplit` on an existing v2 store keeps using the in-memory split                                                                                                                                                                                                                                                                               | runtime `:497-509`                                                          | The in-memory split stays, both for that path and as the differential test oracle.                                                     |
| The v1 sync writer uses `JSON.stringify(this.data, null, 2)`                                                                                                                                                                                                                                                                                     | `electron-state-storage.ts` `persist` / `persistSync`                       | v1 is pretty-printed. The scanner must skip JSON whitespace. Raw spans cannot be copied as blobs and must be re-serialized.            |
| The worker bundle is esbuild with `thirdParty: false`                                                                                                                                                                                                                                                                                            | `apps/ptah-electron/project.json:187-200`; `validate-deps` `:376-381`       | An npm parser would become a runtime external. It would need entries in the generated `package.json`, `validate-deps`, and packaging.  |
| The initialize request accepts `migrations: z.array(stateStorageArraySplitPlanSchema).max(64)`                                                                                                                                                                                                                                                   | `electron-state-storage-worker-protocol.ts:238-246`                         | This is where the streaming-compatibility refine on plans goes.                                                                        |
| The perf spec already polls `worker.getHeapStatistics()` into `peakUsedHeapBytes`                                                                                                                                                                                                                                                                | `electron-state-storage-large-profile.perf.spec.ts:224-240,368-375,512-515` | The heap assertion can reuse the existing probe.                                                                                       |

### B7.2 Decision: in-house structural scanner, no new dependency

- **Chosen:** a byte-level scanner reading a `FileHandle` stream in 64 KiB chunks.
  - It tracks only depth, in-string state, escape state, and top-level key, value, and element boundaries.
  - It emits **byte offsets only**, never values.
  - Each value is decoded from its exact span with `Buffer.toString('utf8')`, then `JSON.parse`, then `electronStateJsonValueSchema`. That is the same decode and validation chain as today.
- **Why this wins:**
  1. **Exact `JSON.parse` parity.** Numbers, escapes and `__proto__` behave exactly as they do today, which is what makes the differential test byte-identical. npm token parsers assemble values themselves.
  2. **Chunk boundaries inside multi-byte UTF-8 characters are harmless.** Every structural byte (`" \ { } [ ] , :`) is below 0x80, and every UTF-8 continuation byte is 0x80 or above. The scanner never decodes a chunk, and a whole span is decoded once.
  3. **About 250 pure lines, and easy to fuzz.**
- **Rejected:** `stream-json`, `@streamparser/json`, `clarinet`.
  - All are MIT or BSD pure JS, and all work on Windows.
  - Each would add an esbuild external (`thirdParty: false`), a generated `package.json` entry, a `validate-deps` update, and an asar packaging check.
  - Each would also need a parity audit of how it assembles values.
  - The VS Code marketplace trademark scanner does not apply to this Electron-only bundle.
- **Net:** more risk and no capability gain. No clarification is needed.

### B7.3 Design

#### Scanner: `electron-state-storage-legacy-scanner.ts` (domain-agnostic)

- Entry point: `scanLegacyObject(handle, { splitKeys }, visitor)`.
- Grammar:
  - optional JSON whitespace (a BOM is rejected);
  - `{`;
  - `"key" : value` pairs separated by commas;
  - `}`;
  - trailing whitespace only.
- Keys are decoded with `JSON.parse` of the key span.
- Visitor callbacks:
  - `onEntry(key, valueStart, valueEnd)` for every top-level entry.
  - `onElement(key, index, start, end)` for elements of arrays whose key is in `splitKeys`.
- The scanner buffers no values. Callers read spans with `readSpan(handle, start, end)`, which uses a positional `handle.read`.
- It maintains a streaming `sha256` over every byte. That hash becomes `sourceV1Sha256`, so the meaning is unchanged.
- **Throws `ElectronStateLegacyFormatError`** on:
  - a BOM, an unterminated string or a depth mismatch;
  - a top level that is not an object;
  - trailing garbage, truncation, or an empty file;
  - a **duplicate top-level key**. `JSON.parse` would let the last one win. v1 is always written by `JSON.stringify` and cannot contain duplicates, and last-wins would need a third pass, so this divergence is deliberate and tested.
- A missing file (`ENOENT`) is treated as `'{}'`, as today.

#### Streaming split: `electron-state-storage-legacy-split.ts` (domain-agnostic, driven by `StateStorageArraySplitPlan`)

**Pass 1: validate and index, with no writes.**

- **Non-split entries:** parse the span, run Zod, discard the value, record `key → {start, end}`.
- **Split elements:**
  - Parse the span and run Zod.
  - Feed `JSON.stringify(item)` into the receipt hash. A missing key and a non-array source keep today's rules (`array-split.ts:279-307`).
  - Record `{start, end}`.
  - Resolve `usableId`. A missing id increments `skippedItemCount`.
  - Update `lastItemIndexById`, and push `project(item, summaryFields)` into the index items.
  - For each reference of each nested extraction:
    - with an id: `lastOccurrence[destinationKey] = (itemIndex, refIndex)`;
    - without an id: `droppedBulkWithoutIdCount++`, by the `bulkPaths` rule.
- **Guarantee:** a malformed or truncated v1 fails here, before quarantine or any write, exactly as today.
- **Memory retained:** O(entries + items + references) of small tuples, plus index summaries of about 245 B per session.

**Pass 2: runs inside `commitInitialStream`, after quarantine and the generation scan.**

1. **Items, in array order.** Parse one element span, then `structuredClone` it as today. For each nested extraction, and each reference in order:
   - With an id:
     - `existing` is the open destination state if there is one, otherwise the parsed v1 span of that key, otherwise `undefined`.
     - Merge with `mergeExtraction`, update the fallback-or-drop counters, and increment `extractedValueCount`.
     - If this reference is `lastOccurrence[destinationKey]`, call `sink.put(destinationKey, merged)` and close the destination. Otherwise keep it open.
   - Delete `fields` and `dropFields` from the reference.
   - After the item's references: if `itemIndex === lastItemIndexById[id]`, call `sink.put(detailKey, detail)`.
2. **Non-split top-level keys, in file order.**
   - Skip the source key, the index key, emitted detail keys, and destination keys that had occurrences. Outputs win, matching today's `values.set`.
   - For every other key, parse its span and call `sink.put(key, value)`.
3. **Index:** `sink.put(indexKey, { schemaVersion, items })`.

**Before the sink publishes:** re-`stat` v1. `size` and `mtimeMs` must equal the pass 1 values, otherwise throw `migration-failed`. This check is pre-publication.

**Shared primitives.** `mergeExtraction`, `fallbackText`, `fallbackItem`, `bulkPaths`, `usableId`, `project`, `getAtPath` and `deleteAtPath` become **named exports of `electron-state-storage-array-split.ts`**. They are reused, never duplicated. `computeElectronStateArraySplit` does not change.

**Streaming plan constraints.** A Zod `superRefine` on `initialize.migrations` answers `invalid-request` unless:

- plan `sourceKey`s are distinct;
- no plan `sourceKey` or `indexKey` matches another plan's `detailKeyPrefix`, `destinationKeyPrefix` or `indexKey`;
- nested extractions within a plan have `sourceArrayPath`s that are not prefixes of one another, and `destinationKeyPrefix`es that do not overlap.

These rules make the per-destination replay equal to the in-memory order. `SESSION_METADATA_MIGRATION` satisfies them.

#### Streaming initial commit (commit store)

- The legacy result of `initialize()` becomes `{ kind: 'legacy', legacyFilePath }`.
- `loadLegacy`, the `legacyValues` field and `commitInitial(changes)` are **deleted**.
- **New `commitInitialStream(sourceV1Sha256, produce)`:**
  1. Run `quarantineIncompleteV2`. It moves here from `initialize()`, so it is gated by pass 1.
  2. Run `scanOccupiedGenerations` and the existing generation allocation.
  3. Call `produce(sink)`. `sink.put(key, value)` writes one blob immediately through an extracted `writeBlob(key, value, generation, operationId)` (stringify, write, fsync, rename, verify) and keeps only the `ElectronStateBlob` entry. Putting the same key twice throws.
  4. Write the manifest, then `CURRENT`, exactly as today, with the same `ElectronStateCommitError` phase classification.
- `writeGeneration` reuses `writeBlob`, so mutation and migration commits stay byte-identical.

#### Runtime: `initializeFromLegacy(store, legacyFilePath, migrations)`

1. Open the file handle.
2. Run pass 1.
3. Call `store.commitInitialStream(scanSha256, pass2)`.
4. Adopt the result and build receipts from the pass 1 and pass 2 counters.
5. Map `ElectronStateLegacyFormatError` and Zod failures to `migration-failed`.
6. Close the handle in `finally`.

A missing v1 file means an empty source, `sha256('{}')`, as today.

#### Memory bound

Peak ≈ one 64 KiB chunk + one parsed split item and its clone (real maximum about 3.1 MB on disk) + open destinations + one non-split value (real maximum about 8 MB) + O(entries) offsets and summaries.

- In practice only one destination is open per reference. Agents re-associated across sessions stay open until their last occurrence.
- The bound is not constant for adversarial shapes: one huge non-split value, or many destinations re-associated across sessions. This is stated, and the target is asserted on the real-shape fixture.

#### Crash safety

- A crash anywhere before the `CURRENT` rename leaves blobs with no pointer. The existing rule applies: `retry-v1`, quarantine, then a fresh split (commit store `:249-259`).
- v1 is opened read-only.
- No multi-commit scheme is introduced.

### B7.4 Test plan

1. **Differential (always on).** File: `electron-state-storage-legacy-split.spec.ts`.
   - **Fixtures** are generated from a seeded PRNG, in both pretty (`JSON.stringify(data, null, 2)`) and compact forms, and include:
     - fat references (`stdout`, `segments`, `streamEvents`);
     - destinations present or absent in v1, and placed before or after the source key;
     - a duplicate session id, a missing `sessionId`, a missing `agentId`;
     - an agent re-associated across two sessions;
     - object-shaped destinations;
     - a 1.1 MB string;
     - multi-byte and astral text;
     - escaped quotes and backslashes in keys and values;
     - integer-like keys.
   - **Oracle:** whole-file `JSON.parse`, then a `Map`, then `computeElectronStateArraySplit`, then blobs written through the same `writeBlob`.
   - **Assert, per key:** identical blob bytes, `byteLength` and `sha256`; an identical manifest `values` key set; identical receipt counters and receipt `sourceSha256`; an identical `sourceV1Sha256`.
2. **Chunk-boundary fuzzing (always on).** Run the scanner with chunk sizes 1, 2, 3, 7, 64 and 4096, plus 200 seeded random chunkings. Offsets and event sequences must be identical. Split points must be exercised inside 4-byte UTF-8 characters, inside `\"` and `\\` escapes, and on string quotes.
3. **Malformed or truncated input (always on).** Cases: truncation at every byte of a small fixture, an unterminated string, trailing garbage, an array or primitive at top level, a BOM, an invalid number or literal inside a span, and a duplicate top-level key. Every case must give:
   - `migration-failed`;
   - **no `workspace-state.v2` created and nothing quarantined**;
   - v1 bytes unchanged;
   - zero sink puts.

   A missing file (`ENOENT`) must give an empty committed store.

4. **Crash mid-split (always on).**
   - `ElectronStateFaultInjector` throws at every `blob-*`, `manifest-*`, `current-written` and `current-flushed` step, on the first, a middle and the last blob. The next `initialize()` must go through `retry-v1` and quarantine, and produce output equal to the oracle.
   - A `size` or `mtimeMs` change between the passes gives `migration-failed` with no `CURRENT` published.
5. **Plan refine (always on).** Overlapping prefixes and duplicate `sourceKey`s answer `invalid-request`. `SESSION_METADATA_MIGRATION` passes.
6. **Heap (opt-in, `PTAH_PERF_SPECS=1`).** On the 328.6 MB fixture:
   - `workerPeakUsedHeapMb ≤ 256`;
   - `migrationElapsedMs < 120,000`;
   - the existing A2 and main-thread assertions still pass.

   Record the before and after numbers in the batch report.

7. **Existing suites stay green:** oversized-profile, array-split, commit-store (migrated to `commitInitialStream`), runtime error paths, handshake.

Build the worker bundle before the perf run: `npx nx build-state-storage-worker ptah-electron`. After every B7 batch, run `npx nx run-many -t typecheck -p @ptah-extension/platform-electron ptah-electron`, then the platform-electron tests on their own.

### B7.5 Files

- CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-scanner.ts` (+ `.spec.ts`: grammar, fuzzing, malformed input)
- CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-split.ts` (+ `.spec.ts`: differential, crash, stat change)
- MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.ts` (named exports only, no logic change)
- MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts` (+ spec: `commitInitialStream`, `writeBlob`; `loadLegacy` and `commitInitial` deleted)
- MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts` (+ `worker-runtime.error-paths.spec.ts`)
- MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` (+ spec: migrations refine)
- MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts` (heap assertion)

Nothing changes in platform-core, agent-sdk, the app `project.json`, or dependencies.

### B7.6 Team-leader hints

- **Batches:**
  - **B7a:** scanner and its spec. A pure module that compiles alone.
  - **B7b:** one compilation gate, after B7a:
    - array-split exports;
    - commit-store `commitInitialStream`, deleting `loadLegacy` and `commitInitial`;
    - legacy-split;
    - runtime `initializeFromLegacy`;
    - protocol refine;
    - every spec that uses `commitInitial` or `legacyValues` (`commit-store.spec.ts:82-83,128,141,176-177`).
  - **B7c:** differential, fuzz, crash and perf assertions. The differential and crash specs may be written alongside B7b. The perf run needs the rebuilt worker bundle.
- **Executors:** backend-developer for B7a and B7b; senior-tester for B7c.
- **Blast radius:** the one-time legacy first boot of every v0.1.70 user. v2 boots, mutations, reads and domain libraries are untouched.
- **Failure behaviour:**
  - A malformed v1 gives `migration-failed` before any v2 write (the recovery shell, as today).
  - A crash mid-split gives `retry-v1` on the next boot.
- **code-logic-reviewer is mandatory.** It checks parity with the in-memory split, pass 1 running before any write, the sink publication phase, open-destination closure, and the stat check.
- **Complexity:** MEDIUM-HIGH. The surface is small, but this is the durability-critical first-upgrade path.
