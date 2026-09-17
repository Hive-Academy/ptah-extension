# Batches - TASK_2026_430_83a2

Total tasks: 31 | Batches: 8 (B0, B1, G, B3, B4, B5, B6, B7) | Complete: 8/8

Source of truth: `implementation-plan.md` revision 3 (approved by the user 2026-09-13, Codex round-3 fixes included). Earlier plan revisions are ignored.

CLI delegation: DISABLED (Ptah MCP server unreachable). Every batch goes to a sub-agent executor.

## Plan validation

Status: PASSED WITH RISKS

### Assumptions

- A1 — A real-shape 328 MB v1 split applied before the first commit finishes inside `DEFAULT_STATE_WORKER_HANDSHAKE_TIMEOUT_MS` (120 s). Unverified. Checked in Task G.9 with `PTAH_PERF_SPECS=1`. If it misses, STOP and escalate; never raise the timeout.
- A2 — Streaming hash verification of about 240 MB of v2 blobs at boot takes 1-3 s. Unverified. Checked in Task G.9.
- A3 — `SessionLoaderService` is `providedIn: 'root'`. VERIFIED: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:69` `@Injectable({ providedIn: 'root' })`.
- A4 — `build-state-storage-worker` is in `ptah-electron` `test.dependsOn`. VERIFIED: `apps/ptah-electron/project.json:388-394`, and it is already in the esm-bundle-gate expected lists (`apps/ptah-electron/src/config/esm-bundle-gate.spec.ts:157,235`). B0 needs NO `project.json` change and NO `npx nx reset`.
- A5 (new) — A Jest spec in `apps/ptah-electron` can construct `ElectronStateStorage` with the default worker factory and spawn the real `dist/apps/ptah-electron/state-storage-worker.mjs` under `worker_threads`. Unverified. Checked first in Task 0.2. If Jest cannot spawn the real bundle, STOP and report; do not substitute a mock for layer (b).
- A6 (new) — `getCliSessionsForRestore` and `get()` return types already mark `stdout`, `segments` and `streamEvents` optional on the reference type, so projected references need no shared type change. Unverified. Checked first in Task 3.1; if a required field breaks consumers (`chat-session.service.ts:919`, `session-rpc.handlers.ts:795`), STOP and report.

### Stress-test findings (compile transitions the plan missed, and how the grouping fixes them)

1. **G consumer table is incomplete (RISK, fixed by grouping).** `rg retain-source|retainedSourceCount` finds two spec consumers outside platform-electron that the plan's G table omits:
   - `libs/backend/platform-core/src/state-storage-capabilities.spec.ts:44` (`retainedSourceCount: 0`)
   - `libs/backend/vscode-core/src/services/workspace-aware-state-storage.spec.ts:166` (`retainedSourceCount: 0`)
     and platform-electron spec consumers: `worker-host.spec.ts:481,541,610`, `worker-protocol.spec.ts:34,144`, `worker-runtime.error-paths.spec.ts:250-308,627-773`, `large-profile.perf.spec.ts:71-102`, plus `append-json-string-slice` in `worker-host.spec.ts:285,406,1165-1244`. All are added to G (Task G.10). The vscode-core spec is also touched by B1; B1 runs before G, so there is no ownership overlap.
2. **B0 cannot use B1/G types and still be "red for the right reason" (RISK, fixed by splitting assertions).** On `main`, `getAsync` takes two arguments, `StateStorageSequencePage` has no `truncatedItems`, the receipt has no `droppedStdoutCount`, and there is no `onMigrationReceipt`. A B0 spec that references them fails at TypeScript compile, not with `Worker message exceeds 262144 bytes`, and B0 runs in parallel with B1. Decision: B0 asserts only through `main`-typed API (index read, unprojected detail read, existing `readJsonSequence`, existing `replaceJsonSequence` item write, no crash error). The projection, `truncatedItems`, text-fallback and four-counter assertions are added in Task G.8 when layer (a) switches to `createElectronStateWorkerMessageLoop`.
3. **B0 cannot be committed on its own (RISK, fixed by commit grouping).** B0 is red by design. A standalone red commit breaks the branch. Decision: B0 files are committed in the same commit as G, which turns them green.
4. **`AgentOutputCursorStaleError` needs a barrel export (RISK).** B4 imports it into rpc-handlers from `@ptah-extension/agent-sdk`, but the plan says the barrel is unchanged. `libs/backend/agent-sdk/src/index.ts:23-28` must export it. Added to B3 (Task 3.3).
5. **`onMigrationReceipt` has no owning file in the plan (RISK).** B6 wires it in `phase-1-infra.ts`, but component 4 does not list adding the option. G owns adding the optional callback to `ElectronStateStorageWorkerOptions` in `electron-state-storage.ts` (Task G.7).
6. **Parallel B5 vs G typecheck noise (RISK).** While G is mid-flight the full-list typecheck fails for reasons outside B5. B5 verifies only its own projects; the team-leader runs the full-list typecheck after both land.
7. **`session-loader.service.ts` is reported by grep as a binary file** (it contains a non-UTF-8 or control byte). B5 executor must preserve the file's existing bytes outside the edited regions and must not re-encode the file.
8. No `getAgentOutput` production caller exists outside `session-metadata-store.ts` (only its spec at `:569,909,1054`), so the deletion in B3 is safe. `SESSION_METADATA_MIGRATION` is consumed by `apps/ptah-electron/src/di/phase-1-infra.ts:38,112` by name only, so G's literal edit does not touch the app.

### Risks

| Risk                                                                                              | Severity       | Mitigation                                                                 |
| ------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| Post-publication commit failure leaves runtime or host cache stale (plan BLOCKER, N8)             | HIGH           | Tasks G.2, G.4, G.7; tests 2-3 in G.8; mandatory code-logic-reviewer on G  |
| Stateless scalar continuation loses projection (R3-1)                                             | HIGH           | Tasks G.3, G.7; test 1a in G.8                                             |
| v1 split exceeds 120 s handshake on the shipped-user path (A1)                                    | HIGH           | Task G.9 perf run; escalate on miss                                        |
| Oversized item fails whole sequence page                                                          | MEDIUM         | Tasks 1.1 (shrink helper), G.3 (dual-budget packing); test 7               |
| Write-path deletions in agent-sdk drop output that has no other home                              | MEDIUM         | Task 3.1 text fallback; test 8; mandatory code-logic-reviewer on B3        |
| Parallel executors share the checkout                                                             | MEDIUM         | File-disjoint ownership lists below; no `npx nx reset` needed by any batch |
| platform-electron specs flaky under disk load (`TASK_2026_411/e2e-storage-fix-report.md:175-187`) | LOW            | Re-run platform-electron alone before calling a failure real               |
| Dev v2 stores with object-shaped output return `not-a-sequence`                                   | LOW (accepted) | Release note item below; no code                                           |

### Edge cases

- Session item with no usable `sessionId` — skipped, `skippedItemCount` (Task G.5).
- Reference with no usable `agentId` carrying bulk — bulk dropped, `droppedBulkWithoutIdCount` once per reference (Task G.5).
- Reference with `stdout` and an empty destination — single text segment, `stdoutFallbackCount` (Tasks G.5, 3.1).
- Object-shaped legacy agent output — converted by the merge at split (Task G.5); on existing dev v2 stores, isolated `not-a-sequence` (Task G.3).
- A single sequence item over both budgets — shrunk with `truncatedItems`, or `value-too-large` if shrink returns `null` (Task G.3).
- Projection hash mismatch or missing projection on continuation — `cursor-stale` (Tasks G.3, G.7).
- LRU eviction between scalar pages — identical result (Task G.3, test 1a).
- Uncertain commit whose cache refresh also fails — sticky `recovery-required` (Task G.7).
- v1 file absent — store is `{}`, no sessions (unchanged commit-store path, Task G.2).
- Stale output cursor in the UI — reset and restart once, then warn and stop (Task 5.2).
- Restored agent `ptah_agent_read` — empty stdout, accepted (Task 3.2 restore spec).

### Release note and batch-report item (must appear in `g-report.md`, `b3-report.md` and the final release note)

- Dev profiles only: delete `workspace-state.v2/` once to rebuild a dev profile from the retained v1 `workspace-state.json` with the corrected lean split. Sessions written after the dev v2 migration are lost; this is accepted.
- On an existing dev v2 store that is not rebuilt, object-shaped legacy agent output returns an isolated `not-a-sequence` failure for that agent's output page only.
- `ptah_agent_read` on a restored (not live) agent returns empty stdout. The UI still shows the output through paging.

### Execution order and parallelism

```text
B0 (tests, red)  ∥  B1 (additive contracts)
        \              /        \
         \            /          B5 (webview lazy output)  -- may run in parallel with G, B3, B4
          G (atomic gate, includes B0 swap)
          |        \
          B3        B6 (phase-1-infra wiring)  -- B6 may run in parallel with B3
          |
          B4
```

- First assignment: **B0 (senior-tester) and B1 (backend-developer), in parallel.** Their file lists are disjoint.
- G starts only after both B0 and B1 are COMPLETE (B0 = red output recorded in `b0-report.md` and verified by the team-leader; B1 committed).
- B5 starts after B1 is committed.
- B3 and B6 start after G is committed. B4 starts after B3 is committed.

### Commit policy

- Commitlint config: `D:/projects/ptah-extension/.commitlintrc.json`. Types: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test. Scope must be one of the listed lower-case scopes (relevant: `platform-core`, `shared`, `platform-electron`, `vscode-core`, `agent-sdk`, `cli-agent-runtime`, `rpc-handlers`, `chat`, `chat-streaming`, `electron`). Subject lower-case start, no trailing period, max 72; header max 100; body lines max 100.
- Commits happen on the current branch, by the team-leader, only after the orchestrator asks the user. Executors never commit. Never `--no-verify`; if a hook fails, STOP and report.
- Pre-commit runs `nx format:write` and `nx affected --target=lint` on staged files. Before a pathspec commit, confirm `git diff -- <paths>` is empty.

---

## Batch B0: Red regression through existing entry points — COMPLETE (2a365495c)

- Recommended executor: senior-tester
- Fallback executor: backend-developer (tests only, same constraints)
- Execution mode: sequential
- Rationale: Two spec files that must fail on `main` for one specific runtime reason; no production code. Needs judgement about reproducing `worker.ts:20-48` exactly.
- Tasks: 2 | Depends on: none | Parallel with: B1
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b0-report.md`
- code-logic-reviewer: not mandatory (reviewed as part of G, where it goes green)
- Commit: none standalone. B0 files are committed together with G.

### Open assumptions to verify first

- A4 is already verified (no `project.json` change). Confirm it did not change on disk before starting.
- A5: confirm Jest in `ptah-electron` can spawn the real worker bundle. STOP and report if not.

### Task 0.1: Layer (a) platform-electron regression spec against `main` symbols — RED VERIFIED

- File (CREATE): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-oversized-profile.spec.ts`
- Plan reference: implementation-plan.md:497-527 (test 1)
- Pattern to follow: `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage.degraded-paths.spec.ts` (temp-dir fixtures, `workerFactory`); worker loop to mirror: `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker.ts:18-48`
- Implementation details:
  - Build the v1 JSON fixture in an OS temp dir (`fs.mkdtemp(os.tmpdir())`): 1,000-session array; one session with 28 references each carrying 102,400 UTF-16 units of `stdout` plus existing segment outputs; one reference with `stdout` and no destination; one reference with no id; one session with no `sessionId`; one 1.1 MB `command` item; one object-shaped agent output; one nested item made only of 20 KiB strings whose estimator total exceeds 262,144.
  - Construct `ElectronStateStorage` with the existing `workerFactory` option (`electron-state-storage.ts:32`). The fake worker reproduces `worker.ts:20-48` exactly using only `main` symbols: `parseElectronStateWorkerRequest` -> `new ElectronStateWorkerRuntime().handle` -> `assertElectronStateWorkerPayloadWithinBudget(response)` outside `try` -> a throw emits the fake's `error` event.
  - Use `SESSION_METADATA_MIGRATION`'s current shape through a local mirror or the agent-sdk export only if platform-electron may import it (it may not; platform-electron is domain-agnostic, so mirror it the way `large-profile.perf.spec.ts:70-102` does).
  - Assertions compile against `main` types only: index read resolves; unprojected detail read of the fat session resolves and holds no `stdout`, `segments` or `streamEvents` on any reference; `readJsonSequence` on the agent with the 1.1 MB item resolves; `replaceJsonSequence` with the structural 20 KiB-string item succeeds; no `ElectronStateWorkerCrashedError` is thrown at any point.
  - Do NOT reference `getAsync` options, `truncatedItems`, the four new counters or `onMigrationReceipt` (they do not exist on `main`; see stress-test finding 2).
- Validation notes: The spec must compile under `npx nx run-many -t typecheck -p @ptah-extension/platform-electron`. It must fail at runtime, and the recorded failure must contain `Worker message exceeds 262144 bytes`. If it fails for any other reason, STOP and report.

### Task 0.2: Layer (b) ptah-electron spec against the real worker bundle — RED VERIFIED

- File (CREATE): `D:/projects/ptah-extension/apps/ptah-electron/src/di/state-storage-oversized-profile.bundle.spec.ts`
- Plan reference: implementation-plan.md:515-517
- Pattern to follow: `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-1-infra.ts:106-116` (how the real store is built with `workerPath`); `D:/projects/ptah-extension/apps/ptah-electron/src/config/esm-bundle-gate.spec.ts` (dist-path conventions)
- Implementation details: Temp-dir v1 fixture with at least one detail whose raw value exceeds 262,144 bytes by the estimator (a compact variant of Task 0.1's fat session is enough); construct `ElectronStateStorage` with the default worker factory and `workerPath` resolved to `dist/apps/ptah-electron/state-storage-worker.mjs`; assert the index read and detail read resolve with no crash error. Same `main`-typed-only rule as Task 0.1.
- Validation notes: Depends on A5. Red on `main` with `Worker message exceeds 262144 bytes`.

### Batch B0 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary (not applicable to tests beyond using the existing parsers).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah` or anything under it. Temp-dir fixtures only.
- Do NOT change any production file. Tests only.
- STOP and report on any out-of-scope lint or test failure instead of fixing it.
- Do not touch unstaged files outside this batch; concurrent agents may share the checkout.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (it should not in B0), run `npx nx reset` only when no other executor is active; B1 runs in parallel, so STOP and report instead.
- Record the exact failing output of both layers (test names, error class, message, byte count) in `b0-report.md` BEFORE any production change exists anywhere in the checkout.

### Batch B0 verification commands

```bash
npx nx run ptah-electron:build-state-storage-worker
npx nx run-many -t typecheck -p @ptah-extension/platform-electron ptah-electron
npx nx test @ptah-extension/platform-electron --testPathPatterns=electron-state-storage-oversized-profile
npx nx test ptah-electron --testPathPatterns=state-storage-oversized-profile.bundle
```

(Single-project `nx test` with a path pattern is allowed. Confirm the typecheck header reads `Running target typecheck for 2 projects`.)

### Batch B0 acceptance

- Both spec files exist and typecheck green on `main`.
- Both specs are red, each with `Worker message exceeds 262144 bytes` in the recorded output in `b0-report.md`.
- `git status --short` shows only the two new spec files plus `b0-report.md` from this batch.

---

## Batch B1: Additive contracts — COMPLETE (759df02bc)

- Recommended executor: backend-developer
- Fallback executor: senior-tester is not a fit; re-run backend-developer
- Execution mode: sequential
- Rationale: Small cross-lib additive change in three leaf-ish libs; every member is optional or a new export, so no existing consumer changes.
- Tasks: 4 | Depends on: none | Parallel with: B0
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b1-report.md`
- code-logic-reviewer: not mandatory; code-style-reviewer recommended (public port vocabulary)
- Commitlint scope: `platform-core`
- Suggested commit subject: `feat(platform-core): add json budget helpers and projected read options`

### Open assumptions to verify first

- None blocking. Confirm `IAsyncStateStorage` implementers (`ElectronStateStorage`, `WorkspaceAwareStateStorage`, spec fakes) still type-check with the optional third parameter.

### Task 1.1: `json-budget.ts` pure helpers — COMPLETE

- Files (CREATE): `D:/projects/ptah-extension/libs/backend/platform-core/src/utils/json-budget.ts`, `D:/projects/ptah-extension/libs/backend/platform-core/src/utils/json-budget.spec.ts`
- Plan reference: implementation-plan.md:172-176,186-187
- Pattern to follow: `D:/projects/ptah-extension/libs/backend/platform-core/src/utils/path-containment.ts` (+ spec)
- Implementation details: `jsonUtf8Bytes(value)`; `omitJsonPaths(value, paths)` clone-walk with `'*'` wildcard over array indexes and object keys, no input mutation; `shrinkJsonStringLeaves(value, { maxEstimatorBytes, maxJsonBytes, estimate })` shrinking on code-point boundaries with suffix `[truncated N bytes]` inside both budgets, returning `null` when it cannot fit.
- Quality requirements: never splits a surrogate pair; suffix counted; control characters count 6 JSON bytes each.
- Tests: control characters, multibyte, astral, suffix overhead, `null` case, wildcard omission, non-mutation.

### Task 1.2: Port additions and errors — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/async-state-storage.interface.ts`, `D:/projects/ptah-extension/libs/backend/platform-core/src/state-storage-errors.ts`, `D:/projects/ptah-extension/libs/backend/platform-core/src/index.ts`
- Plan reference: implementation-plan.md:161-166
- Implementation details: `getAsync<T>(key, defaultValue?, options?: { projection?: { omit: readonly StateStorageJsonPath[] } })`; `StateStorageSequenceReadOptions` gains optional `maxJsonBytes`, `jsonEnvelopeBytes`, `maxItemBytes`; `StateStorageSequencePage` gains optional `truncatedItems?: { index: number; originalJsonBytes: number }[]`; new `StateStorageValueTooLargeError { key, bytes }` and `StateStorageCursorStaleError { key }` following the existing error classes at `state-storage-errors.ts:3,12`; export helpers and errors from `index.ts`.
- Validation notes: Do NOT touch `state-storage-maintenance.interface.ts` (`onMissingId`, receipt) — that is G.

### Task 1.3: Shared RPC error code — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`
- Plan reference: implementation-plan.md:176
- Implementation details: add `'OUTPUT_CURSOR_STALE'` to `RpcErrorCode`. If an exhaustive map or Zod enum over the union exists elsewhere in `libs/shared`, update it in the same task (find it with `ptah_lsp_references`); if it lives outside `libs/shared`, STOP and report.

### Task 1.4: Workspace-aware forwarding — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts`, `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/workspace-aware-state-storage.spec.ts`
- Plan reference: implementation-plan.md:331
- Implementation details: `getAsync` forwards `options` to the delegate (`:165-170`); spec asserts the options object reaches the delegate unchanged. Do not edit the `retainedSourceCount` fixture at spec `:166` (that is G).

### Batch B1 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary (none in this batch; do not add worker protocol changes).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`. Temp-dir fixtures only.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; B0 runs concurrently in platform-electron and apps/ptah-electron.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (it should not), run `npx nx reset` only when no other executor is active; B0 is active, so STOP and report instead.
- Additive only: no required members, no renamed or removed exports.

### Batch B1 verification commands

```bash
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/vscode-core
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
```

Headers must read `Running target test for 3 projects` and `Running target typecheck for 10 projects`. The B0 spec files are expected to typecheck; their runtime red state is not a B1 failure.

### Batch B1 acceptance

- All four tasks present on disk with real implementations.
- Full-list typecheck green; three test projects green.
- No change to `state-storage-maintenance.interface.ts` or any platform-electron file.

---

## Batch G: Atomic compilation gate — worker, commit store, host, split, recipe literal — COMPLETE (2a365495c)

- Recommended executor: backend-developer (single executor for the whole group)
- Fallback executor: backend-developer re-invoked with the remaining G tasks only; no commit until the whole G gate passes
- Execution mode: sequential
- Rationale: Every breaking contract change lands with every consumer (plan R3-2). Durable storage engine with generation safety; cross-file refactor inside one lib plus contract edits in three others. Cannot be parallelised without intermediate compile breaks.
- Tasks: 10 | Depends on: B0 (red recorded), B1 (committed) | Parallel with: B5
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/g-report.md` (must include the release-note item above and the A1/A2 perf numbers)
- code-logic-reviewer: MANDATORY on the whole group
- Commitlint scope: `platform-electron`
- Suggested commit subject (includes B0 files): `fix(platform-electron): bound state worker reads and isolate request faults`

### Open assumptions to verify first

- A1 and A2 (Task G.9). Run the perf spec before declaring G done; on an A1 miss, STOP and escalate.
- Re-run `rg "retain-source|retainedSourceCount|append-json-string-slice|loaded\.values"` over `libs` and `apps` at the start; every hit must be in the G file list below. A hit outside it: STOP and report.

### Task G.1: Breaking plan and receipt contracts — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/state-storage-maintenance.interface.ts`
- Plan reference: implementation-plan.md:167-171,94-107
- Implementation details: `onMissingId: 'drop-bulk'` replaces `'retain-source'` (`:45`); add `dropFields: readonly StateStorageJsonPath[]`; add optional `textFallback?: { sourcePath; itemTemplate; contentPath }`; receipt `retainedSourceCount` (`:66`) replaced by `droppedStdoutCount`, `stdoutFallbackCount`, `droppedBulkWithoutIdCount`, `skippedItemCount`.

### Task G.2: Commit store verify-only load, fresh generations, publication phase — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.spec.ts`
- Plan reference: implementation-plan.md:196-227
- Implementation details: `initialize()` returns `{ manifest }` after streaming hash/existence/length check, or `{ legacyValues, sourceSha256 }` for v1 without committing; scans `manifests/` and `values/` names (excluding `.tmp`) for `highestOccupiedGeneration`; `readValue(key)` re-verifies and Zod-parses, throws `StateStorageRecoveryRequiredError`; `commit({ changes, previous, commitKind })` with `generation = max(previous?.generation ?? 0, highestOccupiedGeneration) + 1`, raised before any write; `ElectronStateCommitError { phase: 'pre-publication' | 'post-publication' }`; `readPointer()`. Epoch rules at `:112-141` and boot verdicts at `:143-222` unchanged.
- Tests (test 2): fault at every step `blob-written`..`current-flushed` then a successful commit on the same instance and after a fresh instance; manifest N+1 without `CURRENT` move -> readable at N, next commit N+2; orphan blob `<hash>.<N+1>.json` alone forces N+2; tampered, missing and short blobs rejected on read.

### Task G.3: Worker loop, lazy value store, runtime, stateless cursors — COMPLETE

- Files: CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-loop.ts` (+ `electron-state-storage-worker-loop.spec.ts`); REWRITE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker.ts` (bootstrap only); CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-value-store.ts` (+ `electron-state-storage-value-store.spec.ts`); REWRITE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts` (+ `electron-state-storage-worker-runtime.error-paths.spec.ts`)
- Plan reference: implementation-plan.md:229-270,293-301
- Pattern to follow: facade rule — runtime keeps its class name and `handle` signature; loop, value store and array split are collaborators.
- Implementation details:
  - Loop `createElectronStateWorkerMessageLoop`: `.then(run, run)` chaining; one `try` over parse, handle, estimator check, response parse and `postMessage`; posts `failure` with `response-too-large` or `internal-error` for that `operationId`; a post failure is swallowed with a `degradation-audit` marker.
  - Value store: byte-bounded LRU (32 MiB by estimator, size injectable for tests) over `readValue`; `has`/`keys` from manifest; no pinning; `snapshotCursors` map deleted.
  - `commitGuarded`: on `ElectronStateCommitError` evict changed keys, `readPointer()`; pointer == runtime manifest -> `commit-failed` `landed: false`; pointer names attempted generation and verifies -> adopt, `commit-failed` `landed: true`; otherwise retire, later requests `recovery-required` or `commit-uncertain`.
  - Cursors: scalar `g<blobGeneration>.p<projectionHash>.<operationOffset>` (hash = first 16 hex of SHA-256 over canonical JSON of `omit` paths, literal `none` when absent); continuation must carry the same projection, recompute hash, mismatch -> `cursor-stale`; reapply `omitJsonPaths` and the 1 MiB ceiling before regenerating operations. Sequence `g<blobGeneration>.<index>`. Snapshot `g<manifestGeneration>.<operationOffset>`.
  - Projected `get`: omit, then `jsonUtf8Bytes` vs 1 MiB -> `value-too-large` with no content; else `value` or `value-paged` packed by the real estimator including envelope. Unprojected `get` of a non-cached key has the same ceiling.
  - Sequence page: non-array -> `not-a-sequence`; dual-budget packing; single oversized item shrunk via `shrinkJsonStringLeaves` and reported in `truncatedItems`, `null` -> `value-too-large`.
  - Item writes: `append-json-sequence-item-ops`; `append-json-string-slice` handler deleted (`:274-317`).
- Tests: test 4 (loop fault isolation, zero `unhandledRejection`), test 5 (abandoned reads leave zero internal state; sequence rewrite between pages -> `cursor-stale`; heap probe over 1,000 abandoned reads within LRU bound), reconcile/retire at runtime level (test 3 part).

### Task G.4: Protocol schemas — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts`
- Plan reference: implementation-plan.md:281-292,597-601
- Implementation details: `get` gains `projection?`; add `read-scalar-page { key, cursor, maxBytes, projection? }`; `read-json-sequence` gains dual-budget fields; add `append-json-sequence-item-ops`; remove `append-json-string-slice` (`:225-250,348`); responses add `value-paged`, `scalar-page`; `json-sequence-page` gains `truncatedItems?`; `failure` gains `landed?`; codes `response-too-large`, `value-too-large`, `not-a-sequence`, `cursor-stale`, `commit-failed`, `commit-uncertain`, `internal-error`; split-plan schema (`:180,185-198`) and receipt schema (`:200-210`) follow Task G.1. All new shapes Zod-validated.

### Task G.5: Array split module — COMPLETE

- Files (CREATE): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.spec.ts`
- Plan reference: implementation-plan.md:271-280,94-107
- Pattern to follow: current split `electron-state-storage-worker-runtime.ts:132-175,629-709` (moved, then changed only by the rules below)
- Implementation details: runs in runtime `initialize` on `legacyValues` before the first commit (generation 1 lean, fat array never written); skip id-less items (`skippedItemCount`); with id: longer-array merge (object-shaped destinations converted by the same merge), then text fallback (`stdoutFallbackCount`) or count drop (`droppedStdoutCount`); without id: `droppedBulkWithoutIdCount` once per reference carrying any of `stdout`/`segments`/`streamEvents`, not also counted as dropped stdout; delete `fields` and `dropFields` from every reference. Existing v2 store still returns early on matching index schema (`:634-652`).
- Tests: every counter unit, one per reference; fallback only for empty destination; object-shaped destination merge; id-less session skipped without failing.

### Task G.6: Recipe literal only — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- Plan reference: implementation-plan.md:350-353,587
- Implementation details: ONLY the `SESSION_METADATA_MIGRATION` literal (`:160-201`): `onMissingId: 'drop-bulk'`, `dropFields: [['stdout']]`, `textFallback: { sourcePath: ['stdout'], itemTemplate: { tag: 'segment', value: { type: 'text', content: '' } }, contentPath: ['value', 'content'] }`. No other change to this file (the rest is B3).

### Task G.7: Host, `ElectronStateStorage`, receipt callback — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts` (+ `electron-state-storage-worker-host.spec.ts`, `electron-state-storage-worker-host.error-paths.spec.ts`), `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage.ts` (+ `electron-state-storage.spec.ts`, `electron-state-storage.degraded-paths.spec.ts`)
- Plan reference: implementation-plan.md:310-343,474
- Implementation details: `getAsync(key, default, options)` — unprojected cached key from cache; otherwise `get`, follow `value-paged`, reassemble with `refreshSnapshot`'s assembly as an internal function in the host file; every `read-scalar-page` re-sends the original projection; `cursor-stale` restarts once then throws `StateStorageCursorStaleError`; `value-too-large` -> `StateStorageValueTooLargeError`. Uncertain commit (`commit-failed`, `commit-uncertain`, `io-failed` on any mutation): delete touched cache entries, re-`get` each non-excluded touched key, re-cache or delete, then surface; refresh failure sets sticky `readinessState = recovery-required`; `recovery-required` responses set the same. Writes: `writeLargeScalar` and `executeReplaceJsonSequence` pack by `assertElectronStateWorkerPayloadWithinBudget` on the candidate request; remove the `128 +` heuristic (`:265-297`) and `extractLargeStrings` whole-item send (`:398-429`). `withRestart` retries only a crash, once; keep the chain swallow at `:680-684`. `readJsonSequence` forwards dual budgets and surfaces `truncatedItems`. Add optional `onMigrationReceipt?: (receipt) => void` to `ElectronStateStorageWorkerOptions`, invoked once at ready with the split receipt (stress-test finding 5).
- Tests: test 3 at host level (faults at `current-renamed` and `current-verified` then another mutation; `CURRENT`-referenced files byte-identical; index cache equals durable value; reconcile failure -> `recovery-required`); test 4 host part (typed failure not retried, crash retried once); test 6 (1.5 MiB non-output metadata -> `StateStorageValueTooLargeError` with zero content bytes on main; largest real-shape detail delivers at most 1 MiB); host spec instrumented for estimator bytes per message and total received JSON bytes per call.

### Task G.8: Regression and projected-continuation specs — COMPLETE

- Files: MODIFY `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-oversized-profile.spec.ts` (from B0); CREATE `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-projected-read.spec.ts`
- Plan reference: implementation-plan.md:518-532
- Implementation details: layer (a) swaps its hand-rolled loop for `createElectronStateWorkerMessageLoop`, keeps every B0 assertion identical, and adds: projected detail holds no bulk; output page resolves with `truncatedItems`; text fallback exists only for the reference with no destination; receipt counters via `onMigrationReceipt`: `droppedStdoutCount === 28`, `stdoutFallbackCount === 1`, `droppedBulkWithoutIdCount === 1`, `skippedItemCount === 1`. Layer (b) `apps/ptah-electron/src/di/state-storage-oversized-profile.bundle.spec.ts` is unchanged and must go green against the rebuilt bundle. New test 1a spec (dev-shaped v2 fixture, 28 fat references, projection under 1 MiB spanning more than one estimator page): multi-page result deep-equals `omitJsonPaths(raw, DETAIL_PROJECTION-equivalent paths)`; LRU sized to evict between continuations gives identical result; changed projection and missing projection on continuation -> `cursor-stale`; raw over 1 MiB with projection under ceiling resolves. Test 7 dual budget: control, multibyte, astral, suffix overhead pages satisfy both estimator and JSON budgets.

### Task G.9: Perf spec and A1/A2 — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts`
- Plan reference: implementation-plan.md:136-137,556-558
- Implementation details: update the `SESSION_METADATA_MIGRATION_MIRROR` (`:70-102`) to the G.6 recipe; real-shape 328 MB v1 split time-to-ready < 120 s with worker peak heap recorded; hash-verify boot of a 240 MB v2 store timed. Record both numbers in `g-report.md`. A1 miss: STOP and escalate, do not raise the timeout.

### Task G.10: Remaining spec consumers of the breaking contracts — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/libs/backend/platform-core/src/state-storage-capabilities.spec.ts` (`:44`)
  - `D:/projects/ptah-extension/libs/backend/vscode-core/src/services/workspace-aware-state-storage.spec.ts` (`:166`)
  - `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-handshake.spec.ts` and `electron-state-storage-manifest.spec.ts` only if they break against G.2/G.4
- Plan reference: stress-test finding 1
- Implementation details: replace `retainedSourceCount` fixtures with the four counters; no behaviour change.

### Batch G executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary: every new request, response, failure code, cursor field and blob read.
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`. Temp-dir fixtures only, including the perf spec.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; B5 may be running concurrently in `libs/frontend/chat` and `libs/frontend/chat-streaming`.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (none is planned), run `npx nx reset` only when no other executor is active; if B5 is active, STOP and report.
- Keep platform-electron domain-agnostic: no session vocabulary in platform-electron source. Keep `degradation-audit` markers accurate.
- Carry out the deletions: `snapshotCursors`, `append-json-string-slice` (protocol, runtime, host, specs), the `128 +` heuristic, `extractLargeStrings` whole-item send, `retain-source`, `retainedSourceCount`. No version fields, receipts beyond the four counters, sweeps or compatibility flags.
- Tests 1a, 2 and 3 must pass before reporting done.
- `g-report.md` must contain the release-note item from the Plan validation section.

### Batch G verification commands

```bash
npx nx run ptah-electron:build-state-storage-worker
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/agent-sdk
npx nx run-many -t test -p @ptah-extension/vscode-core ptah-electron
npx nx test @ptah-extension/platform-electron
PTAH_PERF_SPECS=1 npx nx test @ptah-extension/platform-electron --testPathPatterns=large-profile.perf
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run di-lint:lint
npx nx run degradation-audit:lint
```

Headers: `test for 4 projects`, `test for 2 projects`, `typecheck for 10 projects`. On Windows PowerShell set `$env:PTAH_PERF_SPECS='1'` before the perf command. If B5 is mid-flight and the typecheck fails only in `chat` or `chat-streaming`, report it and let the team-leader re-run after B5 lands.

### Batch G acceptance

- Every G file exists with real implementations; no `TODO`, stub or placeholder.
- `rg "retain-source|retainedSourceCount|append-json-string-slice|snapshotCursors"` over `libs` and `apps` returns nothing.
- B0 layer (a) and layer (b) specs green with the added typed assertions; tests 1a, 2, 3, 4, 5, 6, 7 green.
- A1 < 120 s and A2 numbers recorded in `g-report.md`.
- code-logic-reviewer verdict APPROVED on the whole group.

---

## Batch B3: Session metadata store and CLI agent writer — COMPLETE (f770af256)

- Recommended executor: backend-developer
- Fallback executor: backend-developer re-invoked on remaining tasks
- Execution mode: sequential
- Rationale: Write-path deletions and a new read contract in one file, plus the one writer that must stop storing bulk inline; tightly coupled through `saveAgentOutput`.
- Tasks: 3 | Depends on: G (committed) | Parallel with: B6, B5
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b3-report.md` (must include the release-note item, especially restored `ptah_agent_read` empty stdout)
- code-logic-reviewer: MANDATORY (component 5 write-path deletions)
- Commitlint scope: `agent-sdk`
- Suggested commit subject: `fix(agent-sdk): keep session details lean and page agent output once`

### Open assumptions to verify first

- A6 (reference field optionality). STOP if a required field breaks consumers.

### Task 3.1: `SessionMetadataStore` lean reads, lean writes, single-call paging — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts`
- Plan reference: implementation-plan.md:346-387
- Implementation details: `DETAIL_PROJECTION = { omit: [['cliSessions','*','stdout'], ['cliSessions','*','segments'], ['cliSessions','*','streamEvents']] }`; `get()` passes it on async storage, sync storage applies `omitJsonPaths` in memory; `getCliSessionsForRestore` returns projected references; `_saveInternal` strips the three fields from every reference on both storage kinds and logs `info` `{ sessionId, strippedBulkRefCount }` when > 0; delete `leanCliSessions`, `migrateRefOutput`, `leanCliSessionRef`, `getAgentOutput`, `MAX_PERSISTED_REF_SEGMENTS`, and save-migration output assembly (`:520-606,820-846`); `saveAgentOutput(agentId, { stdout?, segments?, streamEvents? })` writes segments then streamEvents, or the single text segment when both are empty and `stdout` non-empty (async `replaceJsonSequence`, sync `PersistedAgentOutput`), log at `:810-816` becomes `info` when `stdoutDropped` or `stdoutFallback` with both booleans; async `getAgentOutputPage` does exactly one `readJsonSequence` with `maxBytes = min(maxBytes, 256 KiB)`, `maxJsonBytes = rpcBudget`, `jsonEnvelopeBytes = rpcOutputPageBytes([], cursorReservation, false)`, `maxItemBytes` same bound; `StateStorageCursorStaleError` -> new `AgentOutputCursorStaleError`; delete widen/narrow search (`:915-966`); keep guard `:952-958` as assertion; sync page cursor `s<savedAt>.<index>` with dual-budget shrink.
- Tests (test 8): async and sync fakes (sync fake has no sequence API) — projection parity; bulk removed on write and `strippedBulkRefCount` logged once per reference; text fallback only with no other output, `stdoutDropped`/`stdoutFallback` logged; sync cursor and shrink; exactly one `readJsonSequence` call per page; a source-level spec proving no detail read runs without a projection; replace the `getAgentOutput` usages at spec `:569,909,1054`.
- Quality: the file shrinks (deletions exceed additions); record before/after line counts in the report.

### Task 3.2: CLI agent writer stops storing bulk inline — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts`, `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.spec.ts`, `D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts`
- Plan reference: implementation-plan.md:389-405
- Implementation details: widen `SdkSessionMetadataStoreLike.saveAgentOutput` (`:44-60`) with optional `stdout`; when `saveAgentOutput` exists the reference omits `stdout` and `segments` (`:399,406-408`) and `saveAgentOutput` receives `stdout` (`:430-433`); retry order unchanged (`:424-463`). `AgentProcessManager` production code unchanged. Restore spec asserts a restored reference with no `stdout` yields an empty buffer.

### Task 3.3: agent-sdk barrel export — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts`
- Plan reference: stress-test finding 4
- Implementation details: export `AgentOutputCursorStaleError` from the `./lib/session-metadata-store` block at `:23-28`. If `libs/backend/agent-sdk/src/lib/helpers/index.ts` re-exports session-metadata-store symbols, mirror the export there too (dual-barrel rule).

### Batch B3 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary (none added here; do not change platform-electron).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`. Temp-dir fixtures only.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; B6 and B5 may run concurrently.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (none planned), run `npx nx reset` only when no other executor is active; otherwise STOP and report.
- Do not edit the `SESSION_METADATA_MIGRATION` literal (landed in G).
- `b3-report.md` must contain the release-note item.

### Batch B3 verification commands

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run di-lint:lint
```

Headers: `test for 3 projects`, `typecheck for 10 projects`.

### Batch B3 acceptance

- `rg "leanCliSessions|migrateRefOutput|leanCliSessionRef|getAgentOutput\b|MAX_PERSISTED_REF_SEGMENTS"` over `libs` returns nothing.
- No `readJsonSequence` retry loop remains in `getAgentOutputPage`.
- Specs assert the three `info` logs and the one-call paging.
- code-logic-reviewer verdict APPROVED.

---

## Batch B4: RPC handler error mapping — COMPLETE (18fe5a66b)

- Recommended executor: backend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: One handler file and its spec.
- Tasks: 1 | Depends on: B3 (committed) | Parallel with: B5
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b4-report.md`
- code-logic-reviewer: recommended (error-message leakage), not mandatory
- Commitlint scope: `rpc-handlers`
- Suggested commit subject: `fix(rpc-handlers): map stale output cursor and oversized value errors`

### Open assumptions to verify first

- `AgentOutputCursorStaleError` is importable from `@ptah-extension/agent-sdk` (B3 Task 3.3).

### Task 4.1: `session:cli-output-page` typed error mapping — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`, `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:407-424
- Implementation details: in `:818-834`, `AgentOutputCursorStaleError` -> `RpcUserError('Agent output changed', 'OUTPUT_CURSOR_STALE')`; `StateStorageValueTooLargeError` -> `RpcUserError` with a fixed message; never forward raw `error.message`; membership check stays `get(sessionId)` (now projected); `chat:resume` and `session:cli-sessions` only get spec mock updates; `session:cli-sessions` still returns `[]` on failure (`:800-810`). No new method, no `ALLOWED_METHOD_PREFIXES` change.

### Batch B4 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof` before use.
- Zod at every new worker boundary (none here; `SessionCliOutputPageParamsSchema` stays the RPC boundary).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; B5 may run concurrently.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (none planned), run `npx nx reset` only when no other executor is active; otherwise STOP and report.

### Batch B4 verification commands

```bash
npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/vscode-core
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
```

Headers: `test for 2 projects`, `typecheck for 10 projects`.

### Batch B4 acceptance

- Spec asserts both mappings and that the client message never contains the thrown error's message.

---

## Batch B5: Webview lazy sub-agent output — COMPLETE (151fb39ad)

- Recommended executor: frontend-developer
- Fallback executor: frontend-developer re-invoked on remaining task
- Execution mode: sequential
- Rationale: Store signal plus a service effect that consumes it; coupled across two frontend libs (chat -> chat-streaming, one way).
- Tasks: 2 | Depends on: B1 (committed) | Parallel with: G, B3, B4, B6
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b5-report.md`
- code-logic-reviewer: recommended (effect re-entrancy and stale-reset loop), not mandatory
- Commitlint scope: `chat`
- Suggested commit subject: `fix(chat): load sub-agent output only when a card is expanded`

### Open assumptions to verify first

- A3 verified (`providedIn: 'root'`).
- Confirm how the webview RPC client surfaces `RpcUserError` codes to `SessionLoaderService` (`libs/frontend/core`), so `'OUTPUT_CURSOR_STALE'` is matched on the real field. Read-only; do not change `libs/frontend/core`. If the code is not surfaced, STOP and report.

### Task 5.1: `AgentMonitorStore` demand signal and reset — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`, `D:/projects/ptah-extension/libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`
- Plan reference: implementation-plan.md:430-432
- Implementation details: `cliOutputDemand` computed of restored cards with `expanded && historyDone !== true`; `resetCliOutputHistory(sessionId, agentId)` clears history-derived `segments` and `streamEvents`, resets cursor and done flag, bumps `streamRevision` (`:943-960,1030-1139`).

### Task 5.2: `SessionLoaderService` lazy effect — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`, `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`, `D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.cli-restore.spec.ts`
- Depends on: Task 5.1
- Plan reference: implementation-plan.md:433-449
- Implementation details: remove eager `loadCliOutputPages` calls (`:902`, `:1116`); add an `effect()` over `cliOutputDemand` that loads one card at a time per session; on `OUTPUT_CURSOR_STALE` reset and restart once, then warn and stop; keep existing warn and marker drop (`:983-989`).
- Validation notes: the file is flagged as binary by grep; preserve its bytes outside edited regions, do not re-encode.
- Tests (test 9): zero page RPCs before expand; one sequence after expand; stale reset restarts once then stops.

### Batch B5 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary (none here; do not add backend imports — frontend must not import backend libs).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`.
- Signals + `inject()`, `ChangeDetectionStrategy.OnPush` unchanged.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; G, B3, B4 or B6 may run concurrently in backend libs and `apps/ptah-electron`.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (none planned), run `npx nx reset` only when no other executor is active; otherwise STOP and report.

### Batch B5 verification commands

```bash
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/chat-streaming @ptah-extension/chat
```

Headers: `test for 2 projects`, `typecheck for 3 projects`. The team-leader runs the full 10-project typecheck once B5 and any concurrent backend batch have both landed.

### Batch B5 acceptance

- No `loadCliOutputPages` call outside the demand effect.
- Specs prove zero RPCs before expand and the single stale restart.

---

## Batch B6: Split receipt logger wiring — COMPLETE (d687ed0d1)

- Recommended executor: backend-developer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: One composition-root edit consuming G's optional callback.
- Tasks: 1 | Depends on: G (committed) | Parallel with: B3, B4, B5
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b6-report.md`
- code-logic-reviewer: not mandatory
- Commitlint scope: `electron`
- Suggested commit subject: `feat(electron): log state split receipt counters at ready`

### Open assumptions to verify first

- `onMigrationReceipt` exists on `ElectronStateStorageWorkerOptions` (G Task G.7).

### Task 6.1: `phase-1-infra.ts` `onMigrationReceipt` wiring — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/apps/ptah-electron/src/di/phase-1-infra.ts`
- Plan reference: implementation-plan.md:474
- Pattern to follow: existing Logger usage in the same file around `:106-116`
- Implementation details: pass `onMigrationReceipt` that logs the four counters at `info` with no content. If an existing DI spec (`container.smoke.spec.ts`, `workspace-state-storage-single-instance.spec.ts`) breaks, update only the assertion that covers the new option; anything else, STOP and report.

### Batch B6 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every new worker boundary (none here).
- Never touch `C:/Users/abdal/AppData/Roaming/Ptah`.
- STOP and report on out-of-scope lint or test failures instead of fixing them.
- Do not touch unstaged files outside this batch; B3, B4 or B5 may run concurrently.
- Do not commit. Never bypass hooks.
- If a `project.json` changes (none planned), run `npx nx reset` only when no other executor is active; otherwise STOP and report.

### Batch B6 verification commands

```bash
npx nx run-many -t test -p ptah-electron @ptah-extension/platform-electron
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run di-lint:lint
npx nx run degradation-audit:lint
```

Headers: `test for 2 projects`, `typecheck for 10 projects`.

### Batch B6 acceptance

- Receipt logged once at ready with counters only; no content in the log payload.

---

## Final verification (Mode 3, after all batches COMPLETE)

```bash
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/agent-sdk
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run-many -t typecheck -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/platform-electron @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers @ptah-extension/chat-streaming @ptah-extension/chat ptah-electron
npx nx run di-lint:lint
npx nx run degradation-audit:lint
npx nx test ptah-extension-vscode
npx nx test @ptah-extension/cli-engine
```

- Headers: 4, 3, 3 and 10 projects.
- Release-note item present in the final summary to the user.
- Out-of-scope items go to `future-enhancements.md`: `materialize-v1` (unmet from TASK_2026_411); paged session index; `isReferencedAsChildSession` reading `cliSessions` from lean index items (`session-metadata-store.ts:1407-1419`); whole-index rewrite per save (`:479-488,632-647`); unreferenced generation-blob sweep.

---

## Batch B7: Bounded-memory v1 split (streaming legacy scanner + streaming initial commit) — COMPLETE (25782e755)

- Recommended executor: backend-developer (single executor for the whole batch)
- Fallback executor: backend-developer re-invoked with the remaining B7 tasks only; no commit until the whole B7 gate passes
- Execution mode: sequential
- Rationale: Durability-critical first-upgrade path. Tasks 7.2-7.7 form one compilation gate: deleting `loadLegacy`, `commitInitial` and `legacyValues` breaks the runtime and the commit-store spec until the stream path lands. Task 7.1 is a pure module that compiles alone but is consumed by 7.4, and 7.8 needs the rebuilt bundle. All files are in one lib, so no parallel split is safe. The addendum's B7a/B7b/B7c hint is folded into one batch and one commit, as the orchestrator instructed.
- Tasks: 8 | Depends on: B0, B1, G, B3, B4, B5, B6 and both review-fix commits (all committed; HEAD `a070b312a`)
- Source of truth: `implementation-plan.md` "## Addendum: B7 — bounded-memory v1 split" (lines 689-904), approved by the user 2026-09-13
- Report file: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_430_83a2/b7-report.md` (must include before/after perf numbers and the resolution of every B7 risk below)
- code-logic-reviewer: MANDATORY on the whole batch (parity with the in-memory split, pass 1 before any write, sink publication phase, open-destination closure, stat check)
- Commitlint scope: `platform-electron`
- Suggested commit subject: `fix(platform-electron): split legacy state file without whole-file parse`

### B7 plan validation

Status: PASSED WITH RISKS

Assumptions (verify first, before writing production code):

- A-B7-1 — Every consumer of `commitInitial`, `legacyValues`, `loadLegacy` and `kind: 'legacy'` is inside the B7 file list. VERIFIED at `a070b312a`: `rg "commitInitial|legacyValues|loadLegacy"` over `libs` and `apps` hits only `electron-state-storage-commit-store.ts:44-45,144-147,202,372`, `electron-state-storage-worker-runtime.ts:422-454`, `electron-state-storage-commit-store.spec.ts:82-83,127-128,141,176-177`, and a stale comment at `electron-state-storage-large-profile.perf.spec.ts:341`. Re-run at start; a hit outside the list: STOP and report.
- A-B7-2 — `electronStateJsonRecordSchema` (`electron-state-storage-worker-protocol.ts:64`) has no consumer other than `loadLegacy` (`commit-store.ts:392`). VERIFIED by `rg`. After `loadLegacy` is deleted it is unused and must be deleted too. Re-check specs before deleting.
- A-B7-3 — `SESSION_METADATA_MIGRATION` has `sourceKey === indexKey === 'ptah.sessionMetadata'`, `detailKeyPrefix 'ptah.session:'`, and one nested extraction with `destinationKeyPrefix 'ptah.agentOutput:'`. VERIFIED (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:149-155`). No namespace overlaps another. The refine must accept `sourceKey === indexKey` within one plan.
- A-B7-4 — The fault injector fires the `blob-*`, `manifest-*` and `current-*` steps from `writeFlushRenameVerify` (`commit-store.ts:537-564`). VERIFIED. `writeBlob` must route through it so the Task 7.7 crash tests exercise real steps.
- A-B7-5 — How an error thrown from `store.initialize()` or the initial commit surfaces through `ElectronStateWorkerRuntime.handle` -> `failureFor` (`worker-runtime.ts:368-400`) today. Unverified. Read it and keep the exact wire result for each existing failure class (recovery `migration-failed`, `io-failed`, `internal-error`). The new `ElectronStateLegacyFormatError` must map to `recovery-required` / `migration-failed`.
- A-B7-6 — The worker bundle picks up the new modules with no `project.json` change (`apps/ptah-electron/project.json:187-200`, `thirdParty: false`, no new dependency). Expected; confirm the bundle builds. No `npx nx reset` is needed or allowed.

Stress-test findings (plan gaps the executor closes inside the addendum's intent; none is a BLOCKER):

1. **A missing or index-shaped source must not emit the index (RISK HIGH).** `computeElectronStateArraySplit` (`array-split.ts:279-307`) returns NO changes when the source key is absent, and NO changes when the source is an object whose `schemaVersion === indexSchemaVersion`. The addendum's pass 2 step 3 puts the index unconditionally, and step 2 skips the source key unconditionally. Mitigation in Task 7.4: pass 1 classifies each plan's source as `absent`, `index-shaped` or `array`. Only `array` plans skip the source/index key in step 2 and put the index in step 3. `absent` gives `sourceSha256 = sha256(JSON.stringify(null))`. `index-shaped` gives `sha256(JSON.stringify(source))` and `itemCount = items.length`, and the key passes through untouched in step 2. Any other non-array source throws in pass 1 -> `migration-failed`, before any write. Task 7.7 differential cases cover all three classes.
2. **Multi-plan read-through (RISK MEDIUM).** Today `initializeFromLegacy` (`worker-runtime.ts:439-461`) applies plans in order over one `Map`, so plan N reads plan N-1's outputs. A streaming sink cannot read back. The addendum refine covers only `sourceKey`/`indexKey` against other plans, and nested `destinationKeyPrefix`es against each other. It does not cover `detailKeyPrefix` vs `destinationKeyPrefix` within a plan (in memory, a detail set at item end is read back by a later reference), or detail/destination prefix overlap across plans. Mitigation in Task 7.6: the refine rejects any overlap between output namespaces, across and within plans (`indexKey` as an exact key; `detailKeyPrefix` and every `destinationKeyPrefix` as prefixes; overlap means one prefix starts with the other, or an exact key starts with a prefix). It also rejects any plan `sourceKey` inside another plan's output namespace. A plan's own `sourceKey === indexKey` is allowed. Task 7.4 then processes plans independently in `migrations` order, and receipts keep that order. Task 7.7 adds one two-plan disjoint differential fixture.
3. **Pass 2 failures must stay pre-publication (RISK HIGH).** An error thrown by `produce` (span I/O, stat mismatch, duplicate `sink.put`) must leave no `CURRENT` and be classified `pre-publication`. The next `initialize()` must go through `retry-v1`. Mitigation: Task 7.3 (`produce` runs inside the same phase tracking as `writeGeneration`, before the manifest) and Task 7.7 (stat change and an injected pass-2 read failure assert no `CURRENT`).
4. **Duplicate top-level key divergence (ASSUMPTION, deliberate).** `JSON.parse` is last-wins; the scanner rejects. The addendum accepts this because v1 is written only by `JSON.stringify`. Task 7.1 tests it, and `b7-report.md` records it.
5. **Pass 1 retains only small tuples (RISK MEDIUM).** Pass 1 must not keep a reference into a parsed item. `project` already `structuredClone`s each field (`array-split.ts:94-106`), so index summaries are safe. Offsets, `lastItemIndexById` and `lastOccurrence` must hold primitives only. The Task 7.8 heap assertion is the check.
6. **File-size ceiling (RISK LOW).** `worker-runtime.ts` has 836 lines and `worker-protocol.ts` has 1,084; both are already over the 700-line warn. New split logic goes in `electron-state-storage-legacy-split.ts`, not the runtime, and `initializeFromLegacy` must shrink or stay flat. The refine is the only protocol growth. No new `max-lines` warning on a file that had none.
7. **degradation-audit baseline (RISK LOW).** `tools/degradation-audit/baseline.json:27` holds `libs/backend/platform-electron: 4`. New `catch` sites (ENOENT on open, close in `finally`) must not add unsuppressed sites, and any genuine swallow carries an accurate marker.
8. **Stale reference to a deleted symbol (RISK LOW).** `large-profile.perf.spec.ts:341` names `ElectronStateCommitStore.loadLegacy`. Remove that stale symbol from the comment block when editing the file; add no new comments.
9. **Whitespace and re-serialization (ASSUMPTION).** v1 is pretty-printed by `electron-state-storage.ts` `persist`/`persistSync` (`JSON.stringify(data, null, 2)`). Blobs are re-serialized with `JSON.stringify` and never copied from spans. The Task 7.7 differential runs both pretty and compact fixtures.

Edge cases:

- v1 file absent -> empty committed store, `sourceV1Sha256 = sha256('{}')`, each plan's receipt as "absent" (Tasks 7.4, 7.5, 7.7).
- Malformed or truncated v1 -> `migration-failed`, no `workspace-state.v2` created, nothing quarantined, v1 bytes unchanged, zero sink puts (Tasks 7.1, 7.5, 7.7).
- Existing incomplete v2 plus malformed v1 -> fails in pass 1, and the incomplete v2 is NOT quarantined, because quarantine now runs after pass 1 (Task 7.7).
- Duplicate session id -> the detail is emitted once, at the last index; references of every duplicate are still merged; one summary per item (Tasks 7.4, 7.7).
- Agent re-associated across sessions -> its destination stays open until its last occurrence (Tasks 7.4, 7.7).
- Destination present in v1, before or after the source key -> merged from its v1 span and not re-emitted in step 2 (Tasks 7.4, 7.7).
- Missing `sessionId` -> `skippedItemCount`. Missing `agentId` with bulk -> `droppedBulkWithoutIdCount` (Task 7.4).
- Chunk split inside a 4-byte UTF-8 character, inside `\"` or `\\`, or on a quote (Task 7.1).
- v1 `size` or `mtimeMs` changes between passes -> `migration-failed`, no `CURRENT` (Tasks 7.3, 7.4, 7.7).
- Crash at any durable step -> next boot `retry-v1`, quarantine, and output equal to the oracle (Task 7.7).

### Open assumptions to verify first

- A-B7-1, A-B7-2, A-B7-5 and A-B7-6 above. Record each result in `b7-report.md` before writing production code.
- `git status --short` shows no tracked change under `libs/backend/platform-electron` before starting. The modified `.ptah/specs/TASK_2026_411/task.md` and `.ptah/specs/TASK_2026_412/task.md` belong to other work: do not touch or stage them.

### Task 7.1: Legacy structural scanner — COMPLETE

- Files (CREATE): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-scanner.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-scanner.spec.ts`
- Plan reference: implementation-plan.md:717-756, 851-853
- Pattern to follow: pure-module style of `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.ts`; temp-dir fixtures as in `electron-state-storage-commit-store.spec.ts:40-90`
- Implementation details: `scanLegacyObject(handle, { splitKeys, chunkBytes? }, visitor)` reads a `FileHandle` in 64 KiB chunks (chunk size injectable for tests). It tracks depth, in-string state, escape state, and top-level key/value/element boundaries only. It emits byte offsets: `onEntry(key, valueStart, valueEnd)`, and `onElement(key, index, start, end)` for split keys whose value is an array. Keys are decoded with `JSON.parse` of the key span. A streaming `sha256` over every byte is returned with `size` as the scan result. `readSpan(handle, start, end)` does a positional read. `ElectronStateLegacyFormatError` is thrown on a BOM, an unterminated string, a depth mismatch, a non-object top level, trailing garbage, truncation, an empty file, or a duplicate top-level key. Invalid numbers or literals inside a span are caught later by `JSON.parse` of the span (Task 7.4), not by the scanner.
- Tests: grammar (pretty and compact, whitespace variants, nested arrays and objects in values, escaped quotes and backslashes in keys and values, integer-like keys, a split key holding a non-array); chunk fuzzing with chunk sizes 1, 2, 3, 7, 64 and 4096 plus 200 seeded random chunkings, with identical offsets, event sequences and hash; split points inside 4-byte UTF-8, inside `\"` and `\\`, and on quotes; the malformed set (truncation at every byte of a small fixture, unterminated string, trailing garbage, array or primitive top level, BOM, empty file, duplicate key), each throwing `ElectronStateLegacyFormatError`.
- Quality: no values buffered; about 250 lines; no session vocabulary.

### Task 7.2: Array-split named exports — COMPLETE

- File (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-array-split.ts`
- Plan reference: implementation-plan.md:791
- Implementation details: export `mergeExtraction`, `fallbackText`, `fallbackItem`, `bulkPaths`, `usableId`, `project`, `getAtPath` and `deleteAtPath` (and `sha256Json`, `isJsonObject`, `isNonEmpty` only if Task 7.4 needs them). No logic change; `computeElectronStateArraySplit` behaviour is unchanged, and `electron-state-storage-array-split.spec.ts` passes unchanged.
- Validation notes: do not duplicate any of these helpers in the legacy-split module.

### Task 7.3: Commit store streaming initial commit — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.spec.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts` (in this task, delete `electronStateJsonRecordSchema` only, per A-B7-2)
- Plan reference: implementation-plan.md:801-810, 830-834
- Pattern to follow: existing `commit` / `writeGeneration` / `writeFlushRenameVerify` (`commit-store.ts:408-564`)
- Implementation details:
  - The `ElectronStateInitialization` legacy arm becomes `{ kind: 'legacy'; legacyFilePath: string }`. `initialize()` no longer quarantines or scans on the legacy arm; the current arm is unchanged.
  - Delete `loadLegacy`, `commitInitial`, and the `legacyValues` / `sourceSha256` fields.
  - Add `commitInitialStream(sourceV1Sha256, produce: (sink) => Promise<void>)`. It runs `quarantineIncompleteV2`, then `scanOccupiedGenerations`, then allocates the generation exactly as `commit` does, then calls `produce(sink)`. `sink.put(key, value)` writes immediately through an extracted private `writeBlob(key, value, generation, operationId)` (stringify, write, fsync, rename, verify) and records only the `ElectronStateBlob`. A second `put` of the same key throws. Then the manifest and `CURRENT` are written exactly as today, with the same `ElectronStateCommitError` phase classification; `produce` failures are `pre-publication`.
  - `writeGeneration` reuses `writeBlob`, so mutation and migration commits stay byte-identical.
- Spec: migrate `openStore` / `openFailingStore` (`:72-90`, `:176-177`) to `commitInitialStream`; update the legacy-initialize assertions (`:127-128`, `:141`) to the new shape. Add `commitInitialStream` cases: a duplicate put throws pre-publication with no `CURRENT`; a `produce` throw leaves no `CURRENT` and the next `initialize()` returns legacy; blob bytes from `sink.put` equal a mutation commit's blob bytes for the same value. The existing fault-at-every-step tests stay green.

### Task 7.4: Streaming legacy split module — COMPLETE

- Depends on: Tasks 7.1, 7.2, 7.3
- File (CREATE): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-split.ts`
- Plan reference: implementation-plan.md:758-799, 823-828
- Pattern to follow: `computeElectronStateArraySplit` and `extractReference` (`array-split.ts:233-341`) for order and counter rules
- Implementation details:
  - **Pass 1 (no writes).** Run the scanner. Parse and Zod-validate (`electronStateJsonValueSchema`) every non-split span and every split element, then discard the value. Record offsets. Classify each plan's source (finding 1). Feed `JSON.stringify(item)` into an incremental receipt hash shaped `'[' + items.join(',') + ']'`. Resolve ids, `skippedItemCount`, `lastItemIndexById`, index summaries via `project`, `lastOccurrence[destinationKey]`, and `droppedBulkWithoutIdCount` by `bulkPaths`. Record v1 `size` and `mtimeMs`.
  - **Pass 2 (the `produce` callback).** Per plan, in order, walk items in array order with `structuredClone`. Merge each reference with the open destination, else the parsed v1 span of that key, else `undefined`. Apply the fallback-or-drop counters and `extractedValueCount` exactly as `extractReference`. Call `sink.put` and close the destination at `lastOccurrence`. Delete `fields` and `dropFields`. Call `sink.put(detailKey)` at `lastItemIndexById`. Then put non-split keys in file order, skipping the source/index keys of `array` plans, emitted detail keys, and destinations that had occurrences. Then put the index for `array` plans. Then re-`stat` v1 and throw `StateStorageRecoveryRequiredError('migration-failed')` on a `size` or `mtimeMs` change, before control returns to the sink (pre-publication).
  - Return receipt counters per plan, in `migrations` order.
- Validation notes: pass 1 retains primitives and cloned summaries only (finding 5); no session vocabulary; plans are processed independently (finding 2).

### Task 7.5: Runtime `initializeFromLegacy` — COMPLETE

- Depends on: Task 7.4
- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.error-paths.spec.ts`
- Plan reference: implementation-plan.md:812-821
- Implementation details: `initializeFromLegacy(store, legacyFilePath, migrations)` opens the handle read-only (ENOENT -> empty source, `sha256('{}')`, receipts as absent), runs pass 1, calls `store.commitInitialStream(scanSha256, pass2)`, adopts the manifest, and builds receipts from the pass 1 and pass 2 counters plus `committedGeneration` and `commitId`. It maps `ElectronStateLegacyFormatError` and Zod or `JSON.parse` span failures to `StateStorageRecoveryRequiredError('migration-failed')`, and closes the handle in `finally`. `computeMigration` / `runSplit` for existing v2 stores are unchanged. The runtime file must not grow (finding 6).
- Spec: error paths for a malformed v1 (wire `recovery-required` / `migration-failed`), a missing v1 (ready, empty store), and a close failure that does not mask the primary error. Existing runtime error-path cases stay green (A-B7-5).

### Task 7.6: Protocol plan refine — COMPLETE

- Files (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts`, `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.spec.ts`
- Plan reference: implementation-plan.md:793-799
- Implementation details: a `superRefine` on `initializeRequestSchema.migrations` (`:238-246`) requires distinct `sourceKey`s, non-prefix `sourceArrayPath`s within a plan, non-overlapping output namespaces across and within plans, and no `sourceKey` inside another plan's output namespace (finding 2). A plan's own `sourceKey === indexKey` is allowed. A violation answers `invalid-request` through the existing parse path.
- Spec: rejected cases are a duplicate `sourceKey`, overlapping destination prefixes, a detail/destination prefix overlap within a plan, a cross-plan overlap, and a `sourceKey` inside another plan's namespace. Accepted cases are a mirror of `SESSION_METADATA_MIGRATION` (mirrored the way `large-profile.perf.spec.ts:70-102` does) and a two-plan disjoint set.

### Task 7.7: Differential, malformed, crash and stat-change specs — COMPLETE

- Depends on: Tasks 7.3-7.6
- File (CREATE): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-legacy-split.spec.ts`
- Plan reference: implementation-plan.md:838-862
- Implementation details:
  - **Fixtures:** seeded PRNG, pretty and compact, with every fixture element listed at plan lines 839-848, plus the three source classes (absent, index-shaped, array) and one two-plan disjoint set.
  - **Oracle:** whole-file `JSON.parse` -> `Map` -> `computeElectronStateArraySplit` per plan in order -> blobs through the same `writeBlob` path.
  - **Differential asserts, per key:** identical blob bytes, `byteLength` and `sha256`; identical manifest `values` key set; identical receipt counters and receipt `sourceSha256`; identical `sourceV1Sha256`.
  - **Malformed and truncated v1, through the runtime:** `migration-failed`; no `workspace-state.v2`; no quarantine, also with a pre-existing incomplete v2; v1 bytes unchanged; zero sink puts. A missing v1 gives an empty committed store.
  - **Crash:** fault injector at every `blob-*`, `manifest-*`, `current-written` and `current-flushed` step, on the first, a middle and the last blob. The next `initialize()` goes through `retry-v1` and quarantine and equals the oracle.
  - **Stat change between passes:** `migration-failed`, no `CURRENT`.

### Task 7.8: Perf heap assertion — COMPLETE

- Depends on: Tasks 7.1-7.7 and a rebuilt worker bundle
- File (MODIFY): `D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts`
- Plan reference: implementation-plan.md:863-868
- Implementation details: reuse the existing heap probe (`:219-240`, `:368`, `:511-515`). Add `workerPeakUsedHeapMb <= 256` (fail if the probe returns `null`) next to `migrationElapsedMs < 120_000` (`:399`). Keep the A2 and main-thread assertions. Remove the stale `loadLegacy` symbol at `:341` (finding 8). Record the before numbers (1,028.5 MB / 9,353 ms, from `completion-report.md`) and the after numbers in `b7-report.md`. If the 256 MiB target is missed: STOP and report with the numbers; do not raise the target or the timeout.

### Batch B7 executor instructions (repeat in the prompt)

- No explanatory comments in code.
- `catch (error: unknown)`; narrow with `instanceof Error` before `.message`.
- Zod at every boundary: every parsed v1 span goes through `electronStateJsonValueSchema`; the migrations refine guards the worker request.
- Never touch `C:/Users/abdal/AppData` or anything under it. Temp-dir fixtures only (`fs.mkdtemp(os.tmpdir())`), including the perf spec.
- Keep platform-electron domain-agnostic: no session or agent vocabulary in production sources.
- Replace, do not accumulate: `loadLegacy`, `commitInitial`, `legacyValues` and `electronStateJsonRecordSchema` are deleted, not kept beside the stream path. No compatibility flag, and no second split path for legacy boots.
- No new dependency, no `project.json` change, no change outside `libs/backend/platform-electron`.
- STOP and report on any out-of-scope lint, typecheck or test failure instead of fixing it.
- Do not touch unstaged files outside this batch; other agents may share the checkout.
- Do not commit. Never bypass hooks. Never run `npx nx reset`.
- `b7-report.md` records the assumption results, the resolution of every B7 risk, the duplicate-key divergence, before/after perf numbers, and every verification header.

### Batch B7 verification commands

Run serially, one command at a time, to avoid OS memory kills (see `completion-report.md` §2). On Windows PowerShell, set `$env:PTAH_PERF_SPECS='1'` before the perf command and clear it afterwards.

```bash
npx nx run ptah-electron:build-state-storage-worker --skip-nx-cache
npx nx test @ptah-extension/platform-electron --testPathPatterns=electron-state-storage-legacy-scanner --skip-nx-cache
npx nx test @ptah-extension/platform-electron --testPathPatterns=electron-state-storage-legacy-split --skip-nx-cache
npx nx test @ptah-extension/platform-electron --skip-nx-cache
npx nx test ptah-electron --testPathPatterns=state-storage-oversized-profile.bundle --skip-nx-cache
PTAH_PERF_SPECS=1 npx nx test @ptah-extension/platform-electron --testPathPatterns=large-profile.perf --skip-nx-cache
npx nx run-many -t typecheck -p @ptah-extension/platform-electron ptah-electron --skip-nx-cache
npx nx run-many -t lint -p @ptah-extension/platform-electron ptah-electron --skip-nx-cache
npx nx run di-lint:lint
npx nx run degradation-audit:lint
```

- Jest 30 uses `--testPathPatterns` (plural). Single-project `nx test` with a path pattern is allowed; never `nx test projA projB`.
- Headers must read `Running target typecheck for 2 projects` and `Running target lint for 2 projects`. Record the suites/tests counts from each test run.
- Lint: 0 errors; no new `max-lines` warning on a file that had none; `worker-runtime.ts` line count flat or lower.
- degradation-audit: `libs/backend/platform-electron` still `4 ok (baseline 4)`.
- If a full platform-electron run fails under disk or memory load only in a file B7 did not touch, re-run it alone before calling the failure real.

### Batch B7 acceptance

- All 8 tasks are on disk with real implementations; no `TODO`, stub or placeholder.
- `rg "loadLegacy|commitInitial\b|legacyValues|electronStateJsonRecordSchema"` over `libs` and `apps` returns nothing.
- The differential spec is byte-identical to the oracle across pretty, compact, all three source classes and the two-plan set. Chunk fuzzing is green. Malformed cases leave no v2 and no quarantine. Crash and stat-change cases are green.
- Perf: `workerPeakUsedHeapMb <= 256` and `migrationElapsedMs < 120,000` on the 328.6 MB fixture, with before/after recorded in `b7-report.md`.
- The B0 layer (b) bundle spec is green against the rebuilt bundle.
- code-logic-reviewer verdict APPROVED on the whole batch.

### Batch B7 commit note (team-leader)

- Stage the B7 files explicitly with `git add <paths>`. Confirm that `git diff --cached --name-only` lists only B7 files. Then run a plain `git commit` with no pathspec. A pathspec commit re-reads those paths from the working tree and interacts badly with the lint-staged `nx format:write` hook.
- After the B7 commit, re-run the Mode 3 final verification above.
