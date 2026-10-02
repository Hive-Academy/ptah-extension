# Batches - TASK_2026_576_e16a

Total tasks: 87 | Batches: 69 | Complete: 34/69

Branch: `feat/task-2026-576-git-review` (P1, PR #611) and stacked phase branches — see "Stacked phase branches" in P2. Base: `main` 722d921ab.
Never commit to `main`. Stage only the files of the batch. Never stage `.ptah/specs/TASK_2026_555/**`, `research_notes/**`
or `.claude/skills/ptah-cli-usage/references/internal-mcp.md`.

## Execution defaults (recorded by team-leader)

- **Phase gates.** P1 (Batches 1-8) ships as its own PR. ~~Batches 9-69 wait until the user has merged the P1 PR~~
  (context.md Gate decisions; implementation-plan.md:1518) — superseded 2026-09-30 by "Stacked phase branches" (top
  of P2): each phase is stacked on the previous phase's branch. At the P1 boundary the team-leader runs a P1 verification
  (every P1 batch COMPLETE with a SHA, OS-matrix job defined, B7 before/after screenshots present) and the
  orchestrator hands the branch to the user for the PR. From P2 onward (context.md "Auto mode", 2026-10-01) the
  orchestrator pushes each phase branch and opens one stacked draft PR per phase; the user merges. P1 merged into
  `main` (PR #611); P2 = `feat/task-2026-576-p2` on `main` (PR #619); P3 = `feat/task-2026-576-p3` stacked on P2
  (PR #625, base `feat/task-2026-576-p2`); P4, P5 and Cutover each stack on the previous phase's branch. When a lower
  PR merges, `origin/main` (or the new base) is merged into the next branch: no rebase of a pushed branch, no force
  push. Each phase end is a checkpoint (phase-end review) before the next phase's branch is cut.
- **Cutover moved after P5 (validation finding V3).** The plan puts the review-shell mount (Component 23) and the
  old-surface deletion (Component 29) at the end of P4, but parity rows for the commit box, worktree section,
  branch details and fetch/pull/push (`parity-inventory.md:49-57, 64-65, 85-91`) move to P5 surfaces (commit composer,
  task/worktree view). The plan's own gate (Component 29 "blocks the deletion batch while any row lacks a green test",
  implementation-plan.md:1193) cannot pass before P5. So: P4 and P5 build the new surfaces **unmounted** behind the
  existing dock; the "Cutover" batches (58-69) switch the mount, prove parity, delete the old surface and remove Monaco.
  No component is redesigned; only the order changes.
- **Batch size rule.** ≤6 authored files and ≤2 libs per batch, one scoped verification command. Two recorded
  exceptions: (a) RPC-registration batches (27, 41, 47, 49, 53, 55) may add one list entry to host surface specs in other
  projects, because the manifest invariant (`manifest.ts:432-450`, host `rpc-surface.spec.ts`) makes the registry,
  the manifest and the host lists one atomic change; (b) the deletion batch (64) deletes many files, but authors ≤6.
- **Concurrency.** Batches run in order. A batch marked "Concurrency-eligible with" is file-disjoint from the named
  batches and may run at the same time if the orchestrator chooses.
- **Executors available.** Subagents: backend-developer, frontend-developer, devops-engineer, senior-tester.
  CLI lanes: only the user-approved lane set recorded in `context.md` "CLI Lanes" (one of them has no image input —
  never route visual review or screenshot work to it). Run `ptah_agent_list` before spawning.
- **Review routing (agent-lanes §6).** Subagent-authored code → reviewed by a CLI lane. Lane-authored code → reviewed
  by a subagent reviewer (code-logic-reviewer or code-style-reviewer). Rendered UI → visual-reviewer subagent (dark +
  light) in addition. Every P1 batch needs an accepting verdict before its commit. From P2 onward this per-batch
  review is replaced by the per-phase cadence (see "Review cadence (user decision 2026-09-30)" at the top of P2).
- **Visual evidence.** B7 changes the existing dock without a new design: before screenshots come from base
  722d921ab (a temporary worktree), after from the batch, dark + light. P3 card (B29-B31) is checked against
  `prototype/`. P4/P5 surfaces are unmounted until cutover; their visual review against `prototype/` happens at
  Batches 58-61 and is a completion gate.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1 Pierre slot/separator rule unchanged at tag `diffs-v1.5.1` — unverified; checked in Task 22.1.
- A2 Pierre + Shiki JS engine run without `eval` under both CSPs — unverified; checked in Task 22.2 (gate before any canvas batch).
- A3 `vscode.changes` argument shape at 1.100 — unverified; checked in Task 28.1.
- A4 `ChatStore.sendOrQueueMessage` can target a session — unverified; checked in Task 34.1.
- A5 SDK fires `WorktreeRemove` for Ptah worktrees — not needed for correctness; logged in QA (Task 13.1 logs which path fired).
- A6 `UserPromptSubmitPayload.workspaceRoot` is the session's directory — unverified; checked in Task 26.1.
- A7 Replayed messages keep SDK timestamps — unverified; checked in Task 31.1.
- A8 `statsJson: true` writes an esbuild metafile with `outputs[].inputs` — unverified; checked in Task 65.1 before Task 66.1 relies on it.
- A9 Angular file list + one Pierre instance per mounted file meets the Req 6.2 fixture — unverified; spike in Task 38.1.
- A10 `gh pr view --json ...` fields exist in gh ≥2.20 — unverified; checked in Task 49.1.
- A11 VS Code-family launcher targets accept `--merge` — unverified; checked in Task 52.1.
- A12 CodeMirror `EditorState.lineSeparator` round-trips CRLF — unverified; checked in Task 42.1.
- A13 (team-leader) The `capabilities()` helper defaults every capability to false, so only the Electron profile changes for `fileEditor` — verified: `apps/ptah-extension-vscode/src/rpc-host-profile.ts:24-30` passes a partial object.
- A14 (team-leader) Lib-owned RPC handler classes are constructed from `RPC_HANDLER_MANIFEST`, so new handler classes need a manifest entry and no host `registerSingleton` — verified: `register-rpc-surface.ts:95-128`. Host lists that name handlers (`apps/ptah-electron/src/di/phase-4-handlers.ts:140-175` smoke list, `expected-resolvable.ts`) are checked in each registration batch.
- A15 (team-leader) Widening `statusUnavailable` to a union breaks no consumer — verified by read: `git-status.service.ts:19-21` derives its type with `NonNullable<...>`, `tasks-ui/.../task-prompt-context.service.ts:125` tests truthiness; Task 1.1 runs git-ui typecheck to confirm.

| Risk                                                                                                                                                                                                                                                                                                            | Severity                                                                            | Mitigation                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1: Component 7 omits `SourceControlService`, which issues `git:stage/unstage/discard/commit` with the 30 s default (`source-control.service.ts:39-99`). Commit would still time out in the renderer (RC8) and RC1 results flow through it.                                                                     | HIGH                                                                                | Task 6.3 adds the file.                                                                                                                                      |
| V2: Component 7 omits `git-dock.component.ts`, which binds `isStatusUnavailable()` into the panel (`git-dock.component.ts:85`); the panel replaces the lists with a notice (`source-control-panel.component.ts:139-141`). RC3 "keep last known list, marked stale" cannot render without changing that binding. | MEDIUM                                                                              | Task 7.2 adds the file and its spec.                                                                                                                         |
| V3: Parity sequencing — the mount switch and deletion (Components 23, 29) precede the P5 successors for commit, worktree, branch-details and sync rows.                                                                                                                                                         | HIGH                                                                                | Cutover batches 58-69 run after P5; P4/P5 surfaces are built unmounted.                                                                                      |
| V4: New RPCs change host RPC surfaces. `file:saveContent` (capability `fileEditor`, Electron only) must be added to the VS Code and CLI expected-absent lists; `editor:openMerge` under `editorLauncher` may be absent on CLI/TUI.                                                                              | MEDIUM                                                                              | Registration batches 41 and 53 carry the host spec entries (exception (a)).                                                                                  |
| V5: An `RpcMethodRegistry` entry without a manifest entry fails `manifest.spec.ts` (union must equal `RPC_METHOD_NAMES`).                                                                                                                                                                                       | MEDIUM                                                                              | Registry edits (`rpc.types.ts`) always ship in the same batch as the manifest/handler change: 27, 41, 47, 49, 53, 55.                                        |
| V6: The plan swaps `DiffTabsService` → `ReviewDiffService` in `services.ts` during P4, while the old dock (which needs `DiffTabsService` push routing) is still mounted.                                                                                                                                        | MEDIUM                                                                              | Task 35.2 adds `ReviewDiffService` beside `DiffTabsService`; Task 64.1 removes `DiffTabsService` at deletion.                                                |
| V7: Windows `stat.ino` can be 0 or truncated (plan review finding 1).                                                                                                                                                                                                                                           | MEDIUM                                                                              | Task 5.2 compares `mtimeMs` + `size`, and `ino` only via `fs.statSync(p, { bigint: true })` and only when non-zero.                                          |
| V8: Command registration site (plan review finding 2).                                                                                                                                                                                                                                                          | LOW                                                                                 | Task 28.1 registers `ReviewCommands` next to `licenseCommands.registerCommands(this.context)` at `apps/ptah-extension-vscode/src/core/ptah-extension.ts:78`. |
| V9: P1 parser must not add `'U'`/`'T'` to `GitFileStatus.status`; the union grows in P2 (Component 13).                                                                                                                                                                                                         | LOW                                                                                 | Task 2.2 maps `u` records and `T` to today's values (`'M'`) in P1; Batch 15/16 introduce the new values with their consumers.                                |
| V10: Type-union growth in P2 (`'U'                                                                                                                                                                                                                                                                              | 'T'`) breaks exhaustive switches in git-ui if the type lands without the consumers. | MEDIUM                                                                                                                                                       | Batch 15 ships the union change with `source-control-file.component.ts` and `changed-file-tree.ts`. |
| V11: No CLI container spec asserts `GIT_INFO_SERVICE` (grep of `libs/backend/cli-engine/src` finds only `container.ts`).                                                                                                                                                                                        | LOW                                                                                 | Task 18.2 creates `container-git-info-singleton.spec.ts`.                                                                                                    |
| R1/R2 (plan): Pierre internals / CSP `eval`.                                                                                                                                                                                                                                                                    | HIGH                                                                                | Batch 22 resolves A1+A2 before Batch 35+. If A2 fails, stop and return a BLOCKER (fallback `@codemirror/merge` is an architecture change).                   |
| R3 (plan): watcher rewrite regresses Windows.                                                                                                                                                                                                                                                                   | HIGH                                                                                | Batch 3 keeps `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` unchanged; Batch 8 OS matrix.                                                           |
| R4 (plan): write-lock deadlock.                                                                                                                                                                                                                                                                                 | HIGH                                                                                | Task 2.1 `AsyncLocalStorage` reentrance error; Task 5.3 two-parallel-apply real-git spec.                                                                    |
| R5 (plan): lock recovery deletes a foreign `index.lock`.                                                                                                                                                                                                                                                        | HIGH                                                                                | Task 5.2, commit only, fingerprint match after tree exit (V7).                                                                                               |
| R6 (plan): hook-timeout calls wait in the background gate lane.                                                                                                                                                                                                                                                 | LOW                                                                                 | Task 5.2 measures start delay in the hooks real-git spec; >1 s → add `lane` option (recorded in the batch report).                                           |
| R7/R8 (plan): card join on replay; baseline directory.                                                                                                                                                                                                                                                          | MEDIUM                                                                              | Tasks 31.1 (A7) and 26.1 (A6).                                                                                                                               |
| R10 (plan): Monaco removal drops a capability.                                                                                                                                                                                                                                                                  | MEDIUM                                                                              | Batch 62 parity matrix gates Batches 63-66.                                                                                                                  |
| R11 (plan): `/services` entry trips Nx lazy-load lint.                                                                                                                                                                                                                                                          | LOW                                                                                 | Task 21.1 adds the lint exception only if lint fails.                                                                                                        |
| R12 (plan): VSIX chunk filter drops a shared chunk.                                                                                                                                                                                                                                                             | HIGH                                                                                | Task 66.1 drops only chunks whose every input is Electron-only; Task 67.1 opens the skills drawer in VS Code.                                                |

Edge cases:

- Abort before spawn releases the gate slot; abort after exit is a no-op — Task 1.2
- UTF-8 multibyte character split across chunks — Task 1.2
- Paths with `café`, CJK, Arabic, `a"b`, `a\b`, leading/trailing space; staged rename discard — Tasks 2.2, 4.1
- Unparseable status record: skipped and counted, never throws — Task 2.2
- Reentrant lock use throws synchronously; rejected body does not poison the chain — Task 2.1
- Linked worktree (commondir), files created after start, lock-then-rename writes, watcher overflow — Task 3.1
- `diff.noprefix`, custom `srcPrefix/dstPrefix`, textconv drivers — Task 4.1
- Probe `unknown` (git missing, timeout) never reports `isGitRepo:false` — Task 4.1
- Root commit and detached HEAD commit hash/subject — Task 5.2
- Aborted commit mid-hook leaves no `index.lock`; foreign lock never removed — Task 5.2
- Stale-keep only when a previous good entry exists for that workspace; transport failure never shown as git success — Tasks 6.1, 7.1
- Switch failure after stash pops the stash; pop failure keeps both errors — Task 10.1
- Locked worktree never force-removed; exclude write failure does not block add — Tasks 12.1, 13.1
- LFS pointer, >2 MiB side, submodule, symlink, delete/modify conflicts — Tasks 16.1, 17.1
- Outside-workspace paths refused by `ptah.review.*` with no absolute path in the message — Task 28.1
- Empty change set produces no card; baseline missing marks `baselineMissing` — Task 26.1
- Pierre hunk-count mismatch → file read-only — Task 22.1
- Save conflict (sha256 mismatch), symlink escape, rename failure keeps original, BOM + CRLF round-trip — Tasks 40.1, 42.1
- `gh` missing / unauthenticated / not GitHub / no PR — Task 49.1
- Root commit in history opens "Initial commit" — Task 56.1

---

# P1 — Reliability core (RC1-RC8) — ships as its own PR

## Batch 1: Shared git contracts and exec-git primitives — COMPLETE (74e50a10b)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane (single sequential lane)
- Execution mode: sequential
- Rationale: Task 1.2 consumes Task 1.1's types; both are contract changes other batches build on, so one owner keeps them consistent.
- Reviewer: CLI lane, logic scope (subagent-authored)
- Tasks: 2 | Depends on: none
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/git-ui` (git-ui for A15; tail output)

### Task 1.1: Git mutation failure codes, status-unavailable reasons, operation constants — COMPLETE

- Files:
  - MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts
  - CREATE D:/projects/ptah-extension/libs/shared/src/lib/constants/git-operation.constants.ts
  - CREATE D:/projects/ptah-extension/libs/shared/src/lib/constants/git-operation.constants.spec.ts
  - MODIFY D:/projects/ptah-extension/libs/shared/src/index.ts
- Plan reference: implementation-plan.md:186-226
- Pattern to follow: `libs/shared/src/lib/constants/workspace-scan.constants.ts` (+ its spec); barrel lines `libs/shared/src/index.ts:69-72`
- Quality requirements: every new field optional; `GIT_LOCKED_MESSAGE` is the only LOCKED text; spec asserts the reason union, `gitRpcTimeoutFor(600_000) === 615_000`, retry delays sum 3,100 ms.
- Validation notes: A15 — run git-ui typecheck. Do not add `'U' | 'T'` to `GitFileStatus` here (V9).
- Implementation details: add `GitMutationFailureCode`, optional `code?` on the nine result interfaces (`rpc-git.types.ts:229-270, 466-510, 589-594`), `hookOutput?/exitCode?/subject?` on `GitCommitResult`, exported `GitStatusUnavailableReason` replacing the inline literal at `:116`; constants file per plan lines 195-201; one `export *` line in the shared barrel.

### Task 1.2: exec-git cancellation, streaming output, lock and timeout classification — COMPLETE

- Depends on: Task 1.1
- Files:
  - MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts
  - MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts
- Plan reference: implementation-plan.md:228-250
- Pattern to follow: existing `terminate()` path `exec-git.ts:642-665`; gate release invariants `exec-git.ts:573-585`
- Quality requirements: existing `exec-git.spec.ts` stays green; gate slot always released; no new timers left after settle.
- Validation notes: abort before spawn rejects without spawning and releases the slot; abort after exit is a no-op; streaming `TextDecoder` per stream.
- Implementation details: `signal?: AbortSignal` and `onOutput?` on `ExecGitOptions` (`:405-446`); exported `GitCancelledError`, `GitTimeoutError` (replacing the plain `Error` at `:663-665`) and pure `isIndexLockFailure(stderr)`; new spec cases for mid-run abort, split multibyte chunk, lock-failure table.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- The scoped verification command passes; output tailed
- The CLI-lane logic reviewer returned an accepting verdict
- Edge cases (abort before spawn, split multibyte) are covered by specs

### Batch 1 result (team-leader)

- Verified on disk: all 6 files carry real logic (no TODO/STUB markers). Team-leader re-ran typecheck for shared,
  vscode-core, git-ui (pass), shared test (2208 pass), exec-git.spec.ts 3x in isolation (67/67 each), full vscode-core
  test uncached (686/686). One earlier cached full run reported 1 failure in 686 that did not reproduce; the suite was
  not identified — watch for a flaky vscode-core spec under load.
- Review: code-logic-review.md `# Batch 1`, CLI lane (antigravity), APPROVED 9/10, 0 blocking, 0 serious.
- Carried minor findings (defensive only; unreachable today because `execGitBuffer` checks `signal.aborted` before
  calling, and `GitProcessGate.acquire` never rejects). Owner: Task 4.1 (same project, `exec-git.ts` as the 6th file):
  - M1: `acquireUnlessAborted` (`exec-git.ts:~658`) has no entry check for an already-aborted signal.
  - M2: `void acquired.then(...)` in `acquireUnlessAborted` has no rejection handler; forward to `reject`.
- Carried note: new exec-git exports (`GitTimeoutError`, `GitCancelledError`, `isIndexLockFailure`) are not in the
  vscode-core barrel (`libs/backend/vscode-core/src/index.ts`). The first batch whose consumer sits outside
  vscode-core (Batch 5, rpc-handlers) must add them. Do not pass `-- --maxWorkers` to run-many with typecheck (TS5023).

## Batch 2: Pure collaborators — write lock and porcelain v2 status parser — COMPLETE (5ceb04e19)

- Recommended executor: CLI lanes x 2 (one per task)
- Fallback executor: backend-developer (sub-agent), sequential
- Execution mode: parallel
- Rationale: two independent pure modules in separate new files under `services/git/`; no shared registry or barrel is touched (internal to vscode-core, no barrel export per implementation-plan.md:1429).
- Reviewer: code-logic-reviewer (subagent; lane-authored)
- Tasks: 2 | Depends on: Batch 1
- Concurrency-eligible with: Batches 3, 6
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core`

### Task 2.1: `GitRepoWriteLock` — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-write-lock.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-write-lock.spec.ts
- Plan reference: implementation-plan.md:252-293
- Pattern to follow: path folding `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:304-311`
- Quality requirements: FIFO per normalized path; `AsyncLocalStorage` reentrance → synchronous `GitReentrantLockError`; retry sleeps `unref()`'d; injectable clock/sleep.
- Validation notes: R4. Rejected body never poisons the chain. Persistent lock → `{ code: 'LOCKED' }` with `GIT_LOCKED_MESSAGE`, never stderr.
- Implementation details: `run(workspacePath, body)`, `execWrite(args, cwd, options)` retrying only on `isIndexLockFailure` per `GIT_INDEX_LOCK_RETRY_DELAYS_MS`; fake-timer spec covering serialize, poison, reentrance, retry schedule.

### Task 2.2: Porcelain v2 `-z` status parser (P1 subset) — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.spec.ts
- Plan reference: implementation-plan.md:295-323
- Pattern to follow: output shapes of `parseBranchInfo`/`parseFileStatus`/`mapStatusCode` at `git-info.service.ts:3028-3162` (same `GitBranchInfo`/`GitFileStatus`)
- Quality requirements: O(n), no per-line regex, no trimming of path bytes; unparseable records skipped and counted (returned count), never throws.
- Validation notes: V9 — `u` records and `T` map to today's status values in P1; the new union values arrive in Batch 16.
- Implementation details: `parseStatusV2Z(output)` over NUL-terminated headers, type 1/2 (origPath from next field)/u/?/! records; table-driven spec with literal NUL fixtures for café, CJK, Arabic, `a"b`, `a\b`, leading/trailing space, rename, unmerged row.

### Batch 2 verification

- Both files pairs exist with real logic; scoped command passes
- code-logic-reviewer accepting verdict
- Reentrance, poison and unicode edge cases covered

### Batch 2 result (team-leader)

- Executor fallback: both recommended CLI lanes (antigravity x2) failed with HTTP 429 quota exhaustion before
  writing anything; Glm unavailable (Ollama Cloud usage limit). Ran the recorded fallback instead: one
  backend-developer sub-agent per task (file-disjoint), in parallel.
- Verified on disk: `git-write-lock.ts` (FIFO per folded key, AsyncLocalStorage reentrance -> synchronous
  `GitReentrantLockError`, poison-free chain, `execWrite` 1 + 5 retries on `isIndexLockFailure` only -> `LOCKED` with
  `GIT_LOCKED_MESSAGE`, unref'd sleep, injectable exec/sleep) and `git-status-parser.ts` (indexOf/substring scan, no
  regex/trim, type 1/2/u/?/!, V9 mapping kept, skipped records counted). No TODO/STUB markers.
- Team-leader verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core --skip-nx-cache`
  -> typecheck, lint, test all pass (1m 40s). Executor specs: 13/13 (lock), 33/33 (parser).
- Review: code-logic-review.md `# Batch 2`, in-process code-logic-reviewer, APPROVED 8/10, 0 blocking, 0 serious,
  2 moderate, 2 minor. **Same-side review, disclosed fallback**: no cross-vendor CLI lane was available (antigravity
  429, Glm Ollama limit); confidence MEDIUM.
- Moderate items carried (not fixed in Batch 2: neither is a defect in this batch's code; fixing now would cost a
  full executor + review round for doc/spec hardening):
  - MOD-1 (fire-and-forget inside a locked body escapes FIFO/reentrance) -> Task 5.1 validation note; the Batch 5
    reviewer must check it.
  - MOD-2 (cancel not observed during retry backoff) -> accepted bound: a cancellation during `execWrite` retry
    surfaces after at most one backoff step (max 1,600 ms, `GIT_INDEX_LOCK_RETRY_DELAYS_MS`). Task 5.2 (introduces
    `CANCELLED`) must state this bound in its report; a spec pinning it is optional there.
- Minor items, no action: `readXy` accepts `U` on type 1/2 records (git never emits it there; harmless); "5 attempts"
  plan wording vs 1 + 5 implementation — the constants file is authoritative.
- Carried to Batch 4: `!` records are unreachable under today's flags (no `--ignored`); Task 4.1 keeps the argv as
  planned and must not treat `'!'` entries as changes if `--ignored` is ever added.

## Batch 3: Electron git watcher redesign (RC5) — COMPLETE (e4cadb68d)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane (single sequential lane)
- Execution mode: sequential
- Rationale: rewrite of one 960-line service plus a new classifier it depends on; needs judgment on the degradation path.
- Reviewer: CLI lane, logic scope
- Tasks: 1 | Depends on: none (reads existing `GitChangeKind`)
- Concurrency-eligible with: Batches 2, 4, 5, 6, 7
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-electron`

### Task 3.1: One recursive `IWorkspaceWatcher` subscription on the common git dir + pure classifier — COMPLETE

- Files:
  - MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.ts
  - MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.spec.ts
  - CREATE D:/projects/ptah-extension/apps/ptah-electron/src/services/git-dir-change-classifier.ts
  - CREATE D:/projects/ptah-extension/apps/ptah-electron/src/services/git-dir-change-classifier.spec.ts
  - CREATE D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.real-git.spec.ts
- Plan reference: implementation-plan.md:380-424
- Pattern to follow: workspace subscription `git-watcher.service.ts:466-497`; mock `libs/backend/platform-core/src/testing/mocks/workspace-watcher.mock.ts`; in-process adapter used by `run-workspace-watcher-contract.ts`
- Quality requirements: one subscription per armed workspace released in `stop()`; no per-file timers; no poll; constructor signature unchanged (`boot-heavy-services.ts:403-410`).
- Validation notes: R3 — `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` must pass unchanged; commondir resolution; overflow → one refresh `['head','index','refs']`; subscription failure → warn + existing degradation (`:486-495`).
- Implementation details: remove `watchFile/watchDirectory` fs.watch handles (`:294-323, 520-580`); options per plan lines 385-390; `classifyGitDirChange(absPath, ownGitDir, commonDir)`; `'worktree-admin'` → `scheduleNestedRootsRefresh()`; real-git spec asserts a push within 3 s for add, commit, nested ref, packed-refs, MERGE_HEAD, linked-worktree commit.

### Batch 3 verification

- Files exist; scoped command passes (real-git spec runs locally)
- CLI-lane logic reviewer accepting verdict
- Report states that the e2e `git-watcher.spec.ts` file is untouched

### Batch 3 result (team-leader, round 1) — NOT ACCEPTED, revision requested

- Verified on disk: the five Task 3.1 files exist; no `fs.watch(` call, TODO/STUB/PLACEHOLDER marker remains in
  `git-watcher.service.ts` or `git-dir-change-classifier.ts`; e2e `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts`
  has no changes (R3). Executor: scoped `typecheck,test,lint -p ptah-electron` exit 0; reviewer re-ran the three specs
  (109/109 unit, 6/6 real-git on Windows).
- Review: code-logic-review.md `# Batch 3`, in-process code-logic-reviewer, APPROVED 8/10, 0 blocking, 0 serious,
  2 moderate. **Same-side review, disclosed fallback** (antigravity HTTP 429, Glm unavailable); confidence MEDIUM.
- Team-leader decision: not committed. task-description.md:192-198 (Requirement 1.7) names HEAD first, names
  `refs/remotes/origin/x`, and requires "repeated writes after git's lock-and-rename". The real-git spec is the only
  proof of that seam, and Batch 8 runs it on Linux, macOS and Windows to close R3; a HEAD case missing from it leaves
  the most common external operation (branch switch) proven by inference only. The fix is small and stays inside files
  this batch owns, so it is required now rather than carried.
- Required revision (Task 3.1, round 2), files limited to `git-watcher.real-git.spec.ts` and `git-watcher.service.ts`:
  1. Real-git case: `git symbolic-ref HEAD refs/heads/<existing other branch>` (writes only `HEAD` through
     `HEAD.lock` and rename) → `expectPush(main, 'head', ...)`; then, in the same test, a second write back to
     `refs/heads/main` → a second `'head'` push (the "repeated writes" clause). Restore HEAD to `main` at the end.
  2. Real-git case: `git switch -q <other>` (or `git checkout -q <other>`) → `'head'` push; switch back to `main`.
  3. Real-git case: `git update-ref refs/remotes/origin/x HEAD` (a remote-tracking ref created after start, directory
     absent before) → `'refs'` push; assert the directory did not exist first, as the nested-ref case does.
  4. `resolveGitDirs`: when `commondir` exists but its target does not, log one debug/warn line naming the fallback to
     the own git dir (reviewer moderate 2); cover it in `git-watcher.service.spec.ts` only if that file needs no other
     change — otherwise the log line alone.
  5. Correct the `modules/**` doc comment (`git-watcher.service.ts:~105-114`) to state the primary reason: submodule
     worktrees are already excluded by `nestedRepoDetection`.
  - Keep every existing case; do not touch Batch 4/7 files (`libs/backend/vscode-core/**`, `libs/frontend/git-ui/**`,
    e2e). Verify with the three specs (`--runInBand` for real-git) and `npx nx run-many -t typecheck,test,lint -p ptah-electron`.
- Carried with owner (no action this round): minor `REBASE_DIRS` depth looseness in `classifyOwn` — owner Batch 14
  (next batch in `apps/ptah-electron/src/services/`, edits `git-watcher.service.ts`); stale doc comment on shared
  `GitChangeKind` (`libs/shared/src/lib/types/messages/git-status.ts:3-17`) — owner Batch 15 (next batch editing
  shared git types).

### Batch 3 result (team-leader, round 2) — ACCEPTED

- Verified on disk: real-git spec now has 9 cases, including "repeated HEAD writes (lock-and-rename each time) each
  push a head change" (`git-watcher.real-git.spec.ts:274`), "a branch switch pushes a head change" (`:286`, `finally`
  restores `main`) and "a remote-tracking ref created after start pushes a refs change" (`:301`);
  `resolveGitDirs` warns "commondir target is missing" (`git-watcher.service.ts:446`) with a unit case
  (`git-watcher.service.spec.ts:1139`); `modules/**` comment leads with the `nestedRepoDetection` reason
  (`git-watcher.service.ts:105-117`). No `fs.watch(`/TODO/STUB/PLACEHOLDER markers; e2e `git-watcher.spec.ts`
  unchanged against `main` (R3).
- Evidence: executor ran the three specs (119/119, real-git 9/9) and `npx nx run-many -t typecheck,test,lint -p ptah-electron`
  exit 0; reviewer re-ran the three specs (119/119) and the real-git suite twice more (9/9 each, Windows).
- Review: code-logic-review.md `# Batch 3` "Round 2 recheck", APPROVED 9/10, 0 blocking/serious/moderate.
  **Same-side review, disclosed fallback** (no cross-vendor lane available); confidence MEDIUM.
- Carried: real-git suite evidence is Windows-only — Batch 8 OS matrix must run it on Linux and macOS before R3 is
  closed. `REBASE_DIRS` looseness (Batch 14) and `GitChangeKind` doc comment (Batch 15) stay carried as in round 1.

## Batch 4: GitInfoService facade A — RC4 status/discard, RC7 diff flags, RC3 tri-state probe — COMPLETE (d0e585e24)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane (single sequential lane)
- Execution mode: sequential
- Rationale: edits inside a 3,164-line hot-spot file; must keep net line count flat.
- Reviewer: CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 1, 2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core`

### Task 4.1: Wire parser, DIFF_FLAGS, `-c` classifier skip, `probeRepo`, reasoned `statusUnavailable` — COMPLETE

- Files:
  - MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts
  - MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.spec.ts
  - CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.status-unavailable.spec.ts
  - CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.paths.real-git.spec.ts
  - CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.diff-config.real-git.spec.ts
- Plan reference: implementation-plan.md:325-347, 363-378
- Pattern to follow: temp-repo real-git setup in `git-info.service.apply-hunks.spec.ts`; exec seams `git-info.service.ts:2911-2942`
- Quality requirements: `git-info.service.ts` does not grow in net lines (delete `:3028-3162` parser); public `isGitRepo()` kept.
- Carried from Batch 1: MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts (6th file) — fix review minors M1 (pre-aborted entry check in `acquireUnlessAborted`) and M2 (rejection handler on `acquired.then`), with a spec case in `exec-git.spec.ts`.
- Validation notes: probe `unknown` never yields `isGitRepo:false`; staged rename discard uses `restore --staged --worktree --source=HEAD -- <origPath> <path>`; no `.trim()` on paths; `isMutatingGitCommand` skips leading `-c k=v` pairs.
- Implementation details: status argv per plan line 330; `discardChanges` classification via `status --porcelain=v2 -z -- <paths>`; `DIFF_FLAGS` at `:105` gains `--no-textconv --src-prefix=a/ --dst-prefix=b/`; `computeGitInfo` maps `GitTimeoutError`→`timeout`, lock→`locked`, else `error`.

### Batch 4 verification

- Files exist; scoped command passes including both real-git specs
- CLI-lane logic reviewer accepting verdict
- Net line delta of `git-info.service.ts` reported (≤0)

### Batch 4 result (team-leader)

- Verified on disk: `git-info.service.ts` reads status with `STATUS_ARGS` (`status --porcelain=v2 -z --branch
--untracked-files=all`) through `parseStatusV2Z`; the old `parseBranchInfo`/`parseFileStatus`/`mapStatusCode` are
  gone; `!` records filtered; skipped records warned once per workspace (`warnOnce`). `probeRepo` is tri-state (only
  exit 128 "not a git repository" or `false` is `no`); `unknown` and a failing status return `statusUnavailable(reason)`,
  never `isGitRepo:false`. `classifyForDiscard` uses `-z` status, never trims paths, returns `LOCKED`/`GIT_ERROR`
  before any write when either read fails, and stages a rename discard as `restore --staged --worktree --source=HEAD --
<origPath> <path>`. `DIFF_FLAGS` gains `--no-textconv --src-prefix=a/ --dst-prefix=b/`; `isMutatingGitCommand` skips
  leading `-c k=v`. exec-git M1 (pre-aborted entry check) and M2 (rejection handler) fixed with spec cases. No
  TODO/STUB/PLACEHOLDER markers. Net delta of `git-info.service.ts`: 227 insertions / 235 deletions (-8).
- Evidence: executor `nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core --skip-nx-cache` exit 0,
  45/45 suites, 778/778; reviewer re-ran the suite uncached (778/778); team-leader re-ran the scoped command (pass).
  Real-git specs 14/14 on Windows; POSIX-only names (`a"b`, `a\b`, trailing space) are skipped on Windows — Batch 8
  OS matrix must run them on Linux/macOS.
- Review: code-logic-review.md `# Batch 4`, in-process code-logic-reviewer. Round 0 REVISE 6/10 (serious: staged-rename
  discard reported success when the rename-lookup read failed). Round 1 APPROVED 8/10, 0 blocking, 0 serious, 1 carried
  moderate. **Same-side review, disclosed fallback** (antigravity HTTP 429, Glm unavailable); confidence MEDIUM.
- Carried moderate (owner Task 5.1): the two status reads in `classifyForDiscard` run with no lock between them.
  Recorded in Task 5.1's validation notes.
- Out of scope, noted: `stashShow` does not use `DIFF_FLAGS` (read-only); checkout's dirty check still uses plain
  porcelain.

## Batch 5: GitInfoService facade B — RC1 commit result, RC2 timeouts and lock recovery, RC6 write lock; handler pass-through — COMPLETE (a925edcc2)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane (single sequential lane)
- Execution mode: sequential
- Rationale: same hot-spot file as Batch 4, plus a pass-through audit that depends on the new result fields.
- Reviewer: CLI lane, logic scope
- Tasks: 3 | Depends on: Batch 4
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core @ptah-extension/rpc-handlers`

### Task 5.1: Wrap locked operations in `GitRepoWriteLock` (RC6) — COMPLETE

- File: MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts
- Plan reference: implementation-plan.md:252-289, 356
- Pattern to follow: Task 2.1 API
- Quality requirements: locked bodies call only private helpers and reads (no-deadlock rule).
- Validation notes: push, fetch and worktree ops are not locked. Carried from Batch 2 review (MOD-1): every locked
  body must await everything it starts before returning — no `void`/unawaited promises, timers or event callbacks
  that spawn git — otherwise that work runs outside the FIFO while still holding the reentrance context. Report how
  the applyHunks ladder satisfies this; the Batch 5 reviewer checks it. Carried from Batch 4 review (moderate): the
  whole `discardChanges` body, including `classifyForDiscard` and both of its status reads, runs inside one
  `lock.run()` — wrapping only the final `checkout`/`restore`/`clean` calls reopens the two-read race. The Batch 5
  reviewer must confirm this lock scope.
- Implementation details: stage, unstage, discard, commit, checkout, applyHunks (whole ladder `:1559-1892`), stash apply/pop/drop, pull run inside one `run()`; mutating spawns go through `execWrite`.

### Task 5.2: Commit hook result, hook timeouts, own-lock recovery (RC1, RC2) — COMPLETE

- Depends on: Task 5.1
- Files: MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts
- Plan reference: implementation-plan.md:348-356, 365-370
- Pattern to follow: `commit` at `git-info.service.ts:946-979`
- Quality requirements: `HOOK_FAILED` returns `hookOutput` (stdout+stderr) and `exitCode`; hash/subject via `rev-parse --short HEAD` and `log -1 --format=%s`.
- Validation notes: V7 — lock fingerprint = `mtimeMs` + `size`, plus `ino` from `fs.statSync(p, { bigint: true })` only when non-zero; recovery after tree exit only, commit only, logged. R6 — record commit start delay; >1 s → note it for an explicit `lane` option. 60 s hook case tagged `slow`.
- Implementation details: `GIT_HOOK_TIMEOUT_MS` for commit, checkout, stash apply/pop, pull, push; `GIT_FETCH_TIMEOUT_MS` for fetch; gitdir cached per workspace via `rev-parse --git-dir`; `TIMEOUT`/`CANCELLED` codes.

### Task 5.3: Write-lock real-git spec and handler pass-through (Component 8) — COMPLETE

- Depends on: Task 5.1
- Files:
  - CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.write-lock.real-git.spec.ts
  - MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts
  - MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts (only if a handler reshapes the result)
- Plan reference: implementation-plan.md:287-289, 469-479
- Pattern to follow: `registerGitCommit` at `git-rpc.handlers.ts:552`
- Quality requirements: two parallel `applyHunks` on one file both succeed; held `.git/index.lock` → `LOCKED` after ~3.1 s, then success after removal.
- Validation notes: R4.
- Implementation details: handler spec asserts `hookOutput` and `code` reach the RPC result.
- Carried from Batch 1: if rpc-handlers imports `GitTimeoutError`/`GitCancelledError`/`isIndexLockFailure`, add them to the vscode-core barrel `libs/backend/vscode-core/src/index.ts` in this batch.

### Batch 5 verification

- Files exist; scoped command passes (slow case may be skipped locally, noted)
- CLI-lane logic reviewer accepting verdict
- V7 and R6 handling stated in the report
- **Carried from Batch 8 (gate for Batch 5 COMPLETE):** `npx nx run ptah-electron:validate-deps` passes. Wiring
  `GitRepoWriteLock` into `git-info.service.ts` bundles `git/git-write-lock.ts`, whose bare `'async_hooks'` import
  fails the check and the husky pre-commit hook. Change it to `'node:async_hooks'` (add `git-write-lock.ts` to this
  batch's files).
- **Carried from Batch 7 (team-leader decision, gate for Batch 5 COMPLETE):** the committed e2e
  `apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts` (failing hook via `core.hooksPath` keeps the
  message and shows `hookOutput` in `role="log"`; passing-hook control commits) must be run against a fresh
  `ptah-electron` build with Batch 5 in place and pass. It is the end-to-end proof that Batch 5's `hookOutput`
  reaches the renderer through the handler. Report the exact command and the pass line. A failure here is a Batch 5
  defect (producer side) unless the evidence points at the panel, in which case it returns to frontend-developer
  against Task 7.1.

### Batch 5 result (team-leader)

- Verified on disk: `discardChanges` runs `classifyForDiscard` (both status reads) and every write inside one
  `writeLock.run()` (`git-info.service.ts:950-979`); `git-write-lock.ts` imports `'node:async_hooks'`. Commit, remote
  sync and outcome mapping extracted into `git/git-commit-runner.ts`, `git/git-remote-sync.ts`,
  `git/git-mutation-outcome.ts`; `git-info.service.ts` net delta +221 / -293 (-72). Handler spec asserts `hookOutput`
  and `code` reach the RPC result; no handler reshapes the result, so `git-rpc.handlers.ts` is unchanged. rpc-handlers
  does not import `GitTimeoutError`/`GitCancelledError`/`isIndexLockFailure`, so the Batch 1 barrel carry is not
  needed. No TODO/STUB/PLACEHOLDER markers under `vscode-core/src/services`.
- Round 0 fixes also touched `utils/exec-git.ts` + spec (Windows: `killProcessTree` before `child.kill`, `onExit`
  with 6 spec cases) and `git-ui` `git-dock.component.ts` + spec (rail no longer unmounts while status is loading);
  the e2e spec sets repo-local `user.name`/`user.email`.
- V7: lock fingerprint in `git-commit-runner.ts:39-69` — `statSync(p, { bigint: true })`, `mtimeMs` + `size` always
  compared, `ino` only when both sides are non-zero; recovery is commit-only, after tree exit, logged.
- R6: commit start delay measured ~198-206 ms (< 1 s); no explicit `lane` option needed.
- Extra edit (orchestrator): `jest.setTimeout(30_000)` in `git-info.service.review.spec.ts` — it hit the 5 s default
  under full-suite load (2 of 2 runs) and passed alone; full suite passes after the edit.
- Gate evidence (Windows 11, working tree):
  - `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core @ptah-extension/rpc-handlers
@ptah-extension/git-ui --skip-nx-cache` → 6 targets pass.
  - Tests: vscode-core 47 suites, 801 passed / 2 skipped; git-ui pass; rpc-handlers 3389 passed, 1 failed = known
    unrelated `harness-skill-selection-rpc.service.spec.ts` "never writes state.json" (HANDOFF.md §3.5 ignore list).
  - `npx nx test @ptah-extension/vscode-core --testPathPatterns=real-git --passWithNoTests=false` → 4 suites, 31
    passed, 2 skipped (`[slow]` 60 s hook case runs in the Batch 8 CI job; one POSIX-only case). Hooks real-git spec
    3 runs in a row: 14 passed / 2 skipped each, no EPERM.
  - `npx nx run ptah-electron:validate-deps --skip-nx-cache` → pass.
  - `npx nx run ptah-electron-e2e:e2e --skip-nx-cache -- src/specs/git/commit-hook-failure.spec.ts --reporter=list`
    (fresh `ptah-electron:build-dev`) → `1 passed (2.5m)` (one test covers failing and passing hook).
- Review: `reviews/batch-5-code-logic-review.md`, antigravity CLI lane, logic scope, cross-side (author was in-process
  backend-developer/frontend-developer). Round 0 CHANGES_REQUIRED (BLK-1, BLK-2, SER-1, SER-2, MOD-1, MOD-2). Round 1
  APPROVED 9/10, all findings resolved, 0 new defects.
  The Round 1 lane process later exited with code 1 from a CLI error after it had written its section and its WROTE
  line; the result stands.
- Pre-commit blocker (resolved): the first commit attempt failed the husky hook on `degradation-audit:lint` —
  `libs/backend/vscode-core: 1 FAIL (baseline 0)`, `exec-git.ts:782 [promise-catch-sentinel]` (the BLK-1 Windows
  `terminate()` branch ended in `.catch(() => undefined)`). Fix (backend-developer, `exec-git.ts:782-797`): the win32
  branch now does `try { await killProcessTree(pid) } finally { if (!exitNotified) child.kill('SIGTERM') }`, so a
  rejected tree kill still sends SIGTERM; the `.catch` carries a `// degradation-audit: reported - ...` marker naming
  `armReleaseGrace` SIGKILL and the caller's timeout/cancel error as where the failure is surfaced. `baseline.json`
  unchanged. New spec case `git process supervision › cancellation › still sends SIGTERM on Windows when the tree kill
rejects`. Evidence (orchestrator): `npx nx run degradation-audit:lint --skip-nx-cache` → Successfully ran
  (vscode-core not listed); exec-git spec 76 passed; vscode-core typecheck + lint pass; hooks real-git spec 3 more
  runs in a row, 14 passed / 2 skipped each, no EPERM.
- Round 2 (antigravity, bounded post-approval hunk, final): APPROVED 10/10, 0 findings (`## Round 2 recheck`).

## Batch 6: Frontend services — RC3 stale-keep, RC8 renderer timeouts — COMPLETE (53e48e6ce)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: CLI lane (single sequential lane)
- Execution mode: sequential
- Rationale: four services share the new timeout helper and stale semantics; one owner keeps them consistent.
- Reviewer: CLI lane, logic scope
- Tasks: 3 | Depends on: Batch 1
- Concurrency-eligible with: Batches 2, 3, 4, 5
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 6.1: `GitStatusService` keeps last good data with `staleReason` — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts
- Plan reference: implementation-plan.md:436-439
- Pattern to follow: per-workspace cache `git-status.service.ts:300-328, 390-399`
- Quality requirements: stale-keep only for the target workspace and only when a previous good entry exists; `isGitRepo:false` without `statusUnavailable` is the only "not a repo".
- Validation notes: A15.
- Implementation details: expose `staleReason` and `isStale` signals; spec cases for keep, no-previous, workspace switch.

### Task 6.2: Branch/stash renderer timeouts — COMPLETE

- Files:
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-branches.service.ts
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-branches.service.spec.ts
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts
- Plan reference: implementation-plan.md:440-443
- Pattern to follow: `rpcCall(vscodeService, method, params, timeoutMs)` `libs/frontend/core/src/lib/services/rpc-call.util.ts:185-209`
- Quality requirements: push/pull/checkout/stash apply-pop use `gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS)`; fetch `gitRpcTimeoutFor(GIT_FETCH_TIMEOUT_MS)`.
- Validation notes: the private wrapper at `git-branches.service.ts:562-571` must accept and forward a timeout.
- Implementation details: spec asserts the timeout argument per call.

### Task 6.3: `SourceControlService` mutation timeouts (V1) — COMPLETE

- File: MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/source-control.service.ts
- Plan reference: implementation-plan.md:440-443 (RC8 intent; file added by team-leader, V1)
- Pattern to follow: Task 6.2
- Quality requirements: `commit` uses the hook timeout; stage/unstage/discard use the hook timeout too (they run under the write lock, which may wait behind a commit).
- Validation notes: V1.
- Implementation details: pass `gitRpcTimeoutFor(...)` as the fourth `rpcCall` argument in `:39-99`; spec coverage lands in Task 7.1 through the panel spec.

### Batch 6 verification

- Files exist; git-ui scoped command passes
- CLI-lane logic reviewer accepting verdict

### Batch 6 result (team-leader)

- Verified on disk: `git-status.service.ts` (`nextSnapshot`/`hasLastGoodData` stale-keep, `staleReason`/`isStale`,
  `markReadFailed` for transport failure / renderer timeout / malformed payload, `isCurrent()` guard, failed-read
  cache entry written without `fetchedAt`), `git-branches.service.ts` (checkout/push/pull 615,000 ms, fetch
  315,000 ms via `remoteAction`), `git-stash.service.ts` (apply/pop/drop hook timeout), `source-control.service.ts`
  (stage/unstage x2 each, discard, commit use `MUTATION_RPC_TIMEOUT_MS`; `git:showFile` keeps 30 s). No
  TODO/STUB markers in the diff.
- Accepted deviations: timeout threaded through `remoteAction` (the only push/pull/fetch path); `git-stash.service.spec.ts`
  edited though unlisted (exact-args assertion); stash drop uses the hook timeout (same write lock).
- Team-leader verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui --skip-nx-cache`
  -> typecheck, test, lint pass (executor: 27 suites / 443 tests).
- Review: code-logic-review.md `# Batch 6`, in-process code-logic-reviewer. Round 0 APPROVED 7/10 with 1 serious
  (transport-level `git:info` failure never marked stale) -> fixed in revise round 1, recheck RESOLVED, APPROVED
  8/10. **Same-side review, disclosed fallback** (Glm Ollama limit, antigravity 429); confidence MEDIUM.
- Moderate carried: no spec pins `source-control.service.ts` `MUTATION_RPC_TIMEOUT_MS` -> owned by Task 7.1 (made an
  explicit quality requirement there). Batch 7 is not optional.
- Minor carried, no action (decision): `'RPC timeout'` prefix is an unshared literal between `git-status.service.ts`
  and `libs/frontend/core/src/lib/services/rpc-call.util.ts:132`. Not fixed now: it is labelling-only (both
  `'timeout'` and `'error'` trigger stale-keep), a fix needs a third lib (frontend/core) outside this batch, and the
  producer string is already pinned by `rpc-call.util.spec.ts:183, 281` (`toContain('RPC timeout')`), so a rename
  fails a test. If a later batch edits `rpc-call.util.ts`, export the prefix there and import it in git-status.
- Minor carried, no action: `safeRpc` in `git-branches.service.ts` is pre-existing dead code; removal belongs to the
  cutover deletion (Batch 64) or any batch that next edits that file.

## Batch 7: Existing dock — RC1 results surfaced, RC3 stale list, commit hook e2e — COMPLETE (104dced82)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: CLI lane with image input (not the image-less lane)
- Execution mode: sequential
- Rationale: component template changes plus a real-hook e2e; rendered UI change.
- Reviewer: CLI lane, logic scope; plus visual-reviewer (before from base 722d921ab, after from this batch, dark + light)
- Tasks: 2 | Depends on: Batch 6 (Batch 5 for the e2e run)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui ptah-electron-e2e`

### Task 7.1: Panel awaits every result, shows errors and hook output — COMPLETE

- Files:
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.spec.ts
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts
- Plan reference: implementation-plan.md:432-435, 438, 450-456
- Pattern to follow: handlers at `source-control-panel.component.ts:457-496`
- Quality requirements: `!(result.success && result.data?.success)` → dismissible per-row/section error; `gitStatus.refresh()` after every mutation; commit failure keeps the message and shows `hookOutput` in a keyboard-scrollable `<pre role="log">`; success shows hash + subject. Error text is backend `error` or `GIT_LOCKED_MESSAGE`, never absolute paths.
- Carried from Batch 6 (review moderate, V1 regression guard): the panel spec (or a new
  `libs/frontend/git-ui/src/lib/services/source-control.service.spec.ts`, counted against the batch's file budget)
  must assert that `stageFile`, `unstageFile`, `stageAll`, `unstageAll`, `discardChanges` and `commit` pass
  `gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS)` (615,000) as the fourth `rpcCall` argument, and that `git:showFile` does
  not. Batch 7 is not complete without it.
- Validation notes: transport failure shown as transport error, never success. Replace the `{success:true}` commit mock (`spec:48`).
- Implementation details: stale notice "Git status is unavailable (<reason>) — showing the last known changes" replaces the list-hiding notice at `:139-141`.

### Task 7.2: Dock binding for stale list (V2) and commit-hook e2e — COMPLETE

- Depends on: Task 7.1
- Files:
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts
  - MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.spec.ts
  - CREATE D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts
- Plan reference: implementation-plan.md:437-439, 457
- Pattern to follow: binding at `git-dock.component.ts:83-87`; e2e fixtures in `apps/ptah-electron-e2e/src/specs/git/hunk-apply-real-rpc.spec.ts`
- Quality requirements: dock passes `staleReason` so the panel keeps the list marked stale.
- Validation notes: V2.
- Implementation details: e2e installs a failing pre-commit hook in a temp repo and asserts message kept + hook output visible.

### Batch 7 verification

- Files exist; scoped command passes
- CLI-lane logic reviewer and visual-reviewer accepting verdicts; before/after screenshots (dark + light) saved in the task folder `screenshots/b7/`

### Batch 7 result (team-leader)

- Verified on disk: `source-control-panel.component.ts` — `mutationFailureText` reports a transport failure as
  "Could not reach git: …", never success; `LOCKED` → `GIT_LOCKED_MESSAGE`; `runMutation` awaits, records the
  row/section error (or clears it on success), then `refreshStatus()` (`gitStatus.refresh().catch`); in-flight
  guard via `pending` keys + `canRunRow`/`canRunBulk`; `onCommit` returns unless `canCommit`, keeps the draft on every
  failure, shows `hookOutput` in `<pre role="log" tabindex="0">`, success shows hash + subject; draft, committing state
  and feedback are keyed by `workspaceRoot`. `source-control-file.component.ts` — `error`/`busy` inputs, dismissible
  row error (`role="alert"`, 24×24 dismiss, unique label per section). `git-dock.component.ts` binds
  `statusUnavailable()` + `staleReason()` and shows "Git status is unavailable (…)" instead of "not a Git repository"
  when a read failed. Panel spec pins 615,000 on the six mutations and no fourth argument on `git:showFile` (Batch 6
  carry-over closed). No TODO/STUB/PLACEHOLDER markers.
- Accepted additions beyond the file list: `apps/ptah-extension-webview/src/app/git-error-tint-contrast.spec.ts`
  (AA gate for `bg-error/10` over base-100/200/300 in anubis + anubis-light, min 11.52:1), added on visual review.
- Verification: executor and team-leader ran `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui
ptah-electron-e2e ptah-extension-webview --skip-nx-cache` → pass (8 targets).
- Review: code-logic-review.md `# Batch 7` round 0 NEEDS_REVISION 6/10 (2 serious) → revise round 1 APPROVED 8/10.
  visual-review.md `# Batch 7` round 0 CHANGES_REQUIRED 7/10 (target size, no contrast gate) → round 1 APPROVED
  (24×24 in both themes, contrast gate 8/8, row error captured). Before (722d921ab) / after / after-r1, dark + light,
  in `screenshots/b7/`; measurement JSON in `screenshots/b7-*.json`. **Same-side review, disclosed fallback**
  (antigravity HTTP 429, Glm unavailable); confidence MEDIUM. Prototype covers 1 of 5 states; the commit-result
  deviation is sanctioned by design-spec §0.
- **Decision — e2e run:** Batch 7 is committed now; `commit-hook-failure.spec.ts` cannot pass until Batch 5 returns
  `hookOutput`. Its passing run is a **Batch 5 verification gate** (recorded under "Batch 5 verification"), not
  Batch 8: Batch 5 produces the field, and Batch 8 is CI YAML only. Rationale for not holding: Batch 7 is
  file-disjoint from Batch 5, reviewed and approved; holding it would leave approved work uncommitted in a tree
  another executor is editing. If the e2e fails on panel evidence, Task 7.1 reopens.
- **Follow-up — intermittent row-error render timing** (visual-review.md "Row-level error", Minor, not a merge
  blocker): one capture run showed the row error appear only seconds after a confirmed `git:stage` failure; a second
  run rendered it correctly. **Owner: senior-tester at the P1 QA step (before the P1 handover)** — add a
  deterministic Electron e2e for a failing row stage (error visible, dismissible, button re-enabled) next to
  `commit-hook-failure.spec.ts`. If it reproduces, it goes back to frontend-developer against Task 7.1.
  **Closed (2026-09-30, senior-tester; no production code touched):**
  `apps/ptah-electron-e2e/src/specs/git/row-stage-failure.spec.ts` holds a real `.git/index.lock`, observes the
  `git:stage` RPC answer `LOCKED` with `GIT_LOCKED_MESSAGE` from the main process, then asserts `git-row-error`
  visible within Playwright's default 5 s (no sleep), exact lock text, no raw stderr, Stage button enabled and not
  `aria-busy`, 24×24 dismiss clears it; the lock is removed in `finally`; a control stage then succeeds. Pass lines: fresh
  build `1 passed (2.7m)`, 4 further runs without rebuild each `1 passed`, `commit-hook-failure.spec.ts` `1 passed
(2.6m)`, `ptah-electron-e2e:typecheck` pass. The timing issue did not reproduce (consistent with the Batch 5
  git-dock `isLoading` fix). Report: `test-report-p1-row-error.md`.
- Carried, pre-existing (reproduce on 722d921ab, not Batch 7): rail-width squeeze after a narrow resize; focus-ring
  legibility re-capture. Both belong to the cutover visual review (Batches 58-61).

## Batch 8: Cross-platform real-git CI job — COMPLETE (7447d68b4)

- Recommended executor: devops-engineer (sub-agent)
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: single workflow file.
- Reviewer: CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 3, 4, 5
- Verification: YAML lint of the workflow (`npx --yes yaml-lint .github/workflows/ci.yml` or the repo's existing workflow lint) and a dry read of the job matrix; the job itself runs on the P1 PR.

### Task 8.1: `git-real-git` OS-matrix job — COMPLETE

- File: MODIFY D:/projects/ptah-extension/.github/workflows/ci.yml
- Plan reference: implementation-plan.md:481-493
- Pattern to follow: existing `main` job at `ci.yml:35`
- Quality requirements: matrix ubuntu/windows/macos; `npx nx test @ptah-extension/vscode-core --testPathPattern=real-git` and `npx nx test ptah-electron --testPathPattern=real-git`; `slow` only on ubuntu.
- Validation notes: project names are `@ptah-extension/vscode-core` and `ptah-electron` (project.json `name`), not the short names in the plan.
- Implementation details: job fails the PR on failure.

### Batch 8 verification

- File exists with the job; lint passes; CLI-lane reviewer accepting verdict

### Batch 8 result (team-leader)

- **Scheduling (orchestrator decision, recorded):** Batch 8 was assigned in parallel with Batch 5, despite the
  declared "Depends on: 3, 4, 5". The reason is that its only file (`.github/workflows/ci.yml`) is disjoint from
  Batch 5's files (`libs/backend/vscode-core/**`, `libs/backend/rpc-handlers/**`). Spec selection is by filename
  pattern, so Batch 5's new `*.real-git.spec.ts` files are picked up with no workflow edit. The Batch 8 commit
  deliberately excludes every Batch 5 path.
- Verified on disk: `ci.yml` is additive only (the `main` job is untouched). It adds the new `git-real-git` job with
  matrix ubuntu/windows/macos, `fail-fast: false`, `timeout-minutes: 30` and `defaults.run.shell: bash`. It uses the
  same closed-PR/bot `if:` guard as `main`. It sets a global git identity, `init.defaultBranch main` and
  `commit.gpgsign false`. The cache keys are namespaced (`node-modules-realgit-…`, `nx-realgit-…`). The job keeps the
  `npm ci` fallback, the Linux-only platform binaries and `npm rebuild better-sqlite3`. Both test steps use
  `--testPathPatterns=real-git --passWithNoTests=false`; on windows/macos they add
  `--testNamePattern='^(?!.*\[slow\]).*$'`.
- Deviation from Task 8.1 text (accepted): the plan's singular `--testPathPattern` is replaced by the plural. The
  singular is not in the `@nx/jest` schema (`node_modules/@nx/jest/dist/src/executors/jest/schema.json:160` declares
  only `testPathPatterns`) and selected all 47 suites.
- Team-leader re-verification: js-yaml parses (jobs `main`, `git-real-git`; 10 steps). `--listTests` selects exactly
  4 vscode-core specs (hooks, paths, diff-config, write-lock; hooks and write-lock are Batch 5 in-progress files) and
  1 ptah-electron spec (`git-watcher.real-git.spec.ts`). actionlint is not installed, and Actions cannot run locally.
- `[slow]` convention: Batch 5 tags its 60 s hook-timeout case with `[slow]` in the `it(...)` name. If the tag is
  missing, the case runs on all three OSes, which is extra coverage rather than a gap.
- Review: `reviews/batch-8-code-logic-review.md`, **cross-side** (CLI lane antigravity). Round 0 CHANGES_REQUIRED
  5/10 (1 blocking: singular testPathPattern; 1 serious: cache-key collision with `main`; 2 moderate:
  passWithNoTests, global defaultBranch). Round 1 APPROVED 9/10 with all findings resolved. The reviewer re-ran
  `--listTests` (4 + 1) and the zero-match exit 1. From this batch on, cross-side reviews are separate files under
  `reviews/`.
- **Commit blocked by the pre-commit hook (not by Batch 8 content), 2026-09-29.** Husky runs
  `ptah-electron:validate-deps` against the **working tree**, which fails with "MISSING: async_hooks". The cause is
  Batch 5's uncommitted wiring: `git-info.service.ts:75` now imports `GitRepoWriteLock`, so `git/git-write-lock.ts:1`
  (Batch 2, `import { AsyncLocalStorage } from 'async_hooks'`, a bare specifier) enters the Electron main bundle for
  the first time, and `validate-deps` reads the bare name as an undeclared package. At HEAD the lock is not imported,
  so the check passes. Repo convention is `'node:async_hooks'` (`skill-synthesis/.../skill-budget.store.ts:65`,
  `vscode-lm-tools/.../mcp-request-context.ts:18`). **Fix owner: Batch 5 executor.** Change `git-write-lock.ts:1` to
  `'node:async_hooks'` and add that file to Batch 5's file list. The Batch 5 verification must include
  `npx nx run ptah-electron:validate-deps`. Hooks were not bypassed, and Batch 5 files were not stashed (they are
  being edited live). **Resolved:** the Batch 5 executor changed `git-write-lock.ts:1` to `'node:async_hooks'`.
  The team-leader re-ran `npx nx run ptah-electron:validate-deps --skip-nx-cache` on the working tree ("All external
  imports are covered"), then committed Batch 8 with hooks enforced. `git-write-lock.ts` stays unstaged and ships
  with Batch 5.
- R3 status: **not closed yet**. The Linux and macOS evidence for the Batch 3/4 real-git suites exists only after
  the job's first real run on the P1 PR.

### P1 boundary — handover

P1 boundary checklist additions (from Batch 8):

- [ ] The first real run of `git-real-git` happens on the P1 PR. All three matrix legs must be green before R3
      (Linux/macOS real-git evidence, carried from Batches 3 and 4) is closed. Record the run URL here.
- [ ] Tell the user to consider making `git-real-git` (all three matrix legs) a required status check in the GitHub
      branch protection for `main`. This is a repository setting outside the workflow file, so no batch can do it.
- [ ] Batch 5 must be COMPLETE before the P1 PR, because two of the four selected vscode-core specs are Batch 5's.

After Batch 8 is COMPLETE the team-leader verifies P1 (all eight SHAs resolve, B7 screenshots present, `git diff main --stat`
touches only P1 files), confirms the Batch 5 e2e gate (`commit-hook-failure.spec.ts` pass) and the Batch 7
follow-up (deterministic row-error e2e, senior-tester) are closed, and returns. The orchestrator reports to the user
for the P1 PR. ~~Batches 9-69 stay PENDING until the user confirms the P1 PR is merged.~~ Superseded 2026-09-30 by
"Stacked phase branches" (top of P2): P2 starts now, stacked on the P1 branch.

P1 verification (team-leader, 2026-09-30) — PASSED:

- All eight P1 SHAs resolve on the branch: 74e50a10b (B1), 5ceb04e19 (B2), e4cadb68d (B3), d0e585e24 (B4),
  a925edcc2 (B5), 53e48e6ce (B6), 104dced82 (B7), 7447d68b4 (B8).
- B7 visual evidence is tracked: 39 files in `screenshots/b7/` (before from 722d921ab, after, after-r1; dark + light)
  and 6 `screenshots/b7-*.json` measurement files.
- `git diff --name-only main...HEAD` (merge-base 722d921ab) touches only P1 paths: `libs/shared` git contracts (B1),
  `libs/backend/vscode-core` git services/exec-git (B1, B2, B4, B5), `apps/ptah-electron` git watcher (B3),
  `libs/backend/rpc-handlers` git handler spec (B5), `libs/frontend/git-ui` (B5, B6, B7),
  `apps/ptah-extension-webview` contrast spec (B7, accepted addition), `apps/ptah-electron-e2e` git specs (B7, P1 QA),
  `.github/workflows/ci.yml` (B8), and this task's `.ptah/specs/TASK_2026_576_e16a/**` docs. Nothing out of scope.
- Batch 5 e2e gate closed (`commit-hook-failure.spec.ts` `1 passed`); Batch 7 row-error follow-up closed (above).
- Still open for the P1 PR (not batch work): the first real `git-real-git` run (R3), and the branch-protection
  suggestion to the user.

P1 handover (2026-09-30):

- P1 approval: `reviews/p1-approval.md` — independent Glm lane, APPROVED; committed as b0a9b6f28
  (`docs(vscode-core): p1 approval by an independent lane`).
- The follow-up below landed on the P1 branch as 3346f60a6. The branch was pushed and **PR #611** opened against
  `main` (https://github.com/Hive-Academy/ptah-extension/pull/611). P1 PR review fixes land on the P1 branch
  (worktree `.claude-worktrees/task-576-p1`) and P2 is rebased on top.
- Open items on the P1 PR: R3 — the first `git-real-git` run on the PR, all three OS legs green (record the run URL
  here); recommend to the user that `git-real-git` (all three legs) become a required status check on `main`.

P1 follow-up (orchestrator, 2026-09-30, after the Glm approval):

- **Real-git suites split from the default test run.** The full vscode-core jest run (~15 workers) timed out
  (60-120 s) in the `*.real-git.spec.ts` suites under moderate load on Windows; it reproduced on b0a9b6f28 itself,
  so it is test infrastructure, not product code. No timeouts were raised. `jest.config.ts` now ignores
  `*.real-git.spec.ts`; the new `test-real-git` target (`jest.real-git.config.ts`, `runInBand`,
  `passWithNoTests: false`) runs them serially, and the `git-real-git` CI job calls it on all three OSes.
  Evidence: `vscode-core:test --coverage` 43 suites, 771 passed, thresholds met; `test-real-git` 4 runs, 4 suites,
  31 passed, 2 skipped. Author devops-engineer (in-process); review antigravity (CLI lane)
  `reviews/p1-followup-test-split-review.md` APPROVE, 0 blocking/serious. Minor 1 (tsconfig.spec include) fixed.
  Accepted, recorded: real-git specs no longer count toward the PR coverage gate (thresholds still pass), and
  developers changing git services must run `nx run @ptah-extension/vscode-core:test-real-git` locally.
- **Task images deleted at the user's request.** The 63 PNGs (`prototype/screenshots/` 24, `screenshots/b7/` 39)
  are removed; the prototype html/css/js stay and can be re-rendered. The review files record what the B7 captures
  showed. The user adds a `.gitignore` rule for images under `.ptah/specs/` in a separate PR.

---

# P2 — Reliability hardening (RC9-RC14) — stacked on the P1 branch

## Stacked phase branches (user decision 2026-09-30)

Recorded in `context.md`. One branch and one PR per phase, each based on the previous phase's branch.

- P1 = `feat/task-2026-576-git-review` (PR #611, HEAD 3346f60a6), worktree
  `D:/projects/ptah-extension/.claude-worktrees/task-576-p1`. P2 = `feat/task-2026-576-p2`, rebased on 3346f60a6,
  worktree `D:/projects/ptah-extension/.claude-worktrees/task-576-p2`. Worktrees live inside the workspace, so Node
  resolves the main `node_modules` upward and CLI lanes accept them as `workingDirectory`. The main checkout stays on
  `main`. P3, P4, P5 and Cutover follow the same pattern (`.claude-worktrees/task-576-p3`, …).
- "Depends on: P1 merged" now reads "stacked on the P1 branch" (Batches 9, 18, 19 say `P1 branch (stacked)`).
- P1 PR review fixes land on the P1 branch; P2 is then rebased on it. When P1 merges, P2 is rebased onto `main` and
  its PR targets `main`. (Done: P2 sits on `main` after the P1 merge. From then on, pushed phase branches are never
  rebased; a merged base is merged into the next branch instead — see "Phase gates" under Execution defaults.)
- The team-leader checks `git branch --show-current` = the phase branch before every commit.

## P2 execution waves (team-leader, 2026-09-30)

One checkout, no extra worktrees. A wave holds more than one batch only when the batches are file-disjoint AND
neither batch's typecheck/test scope compiles the other's files, so one executor's half-done edits cannot break the
other's checks. `git-info.service.ts` batches stay serial. Each batch is committed on its own once its checks pass;
in a two-batch wave the team-leader commits each batch separately by explicit path.

| Wave | Batches             | Why                                                                                                                                                                                                                    |
| ---- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 9 ∥ 19              | 9 = `vscode-core` only (hot spot); 19 = `git-ui` only. git-ui imports no backend lib (grep of `libs/frontend/git-ui/src`: 0 hits for vscode-core/rpc-handlers/agent-sdk), so neither scope compiles the other's files. |
| 2    | 18                  | `ptah-extension-vscode` and `cli-engine` both import `@ptah-extension/vscode-core` (`container.ts`), so 18 cannot run beside any vscode-core/shared batch; alone, after 9 is committed.                                |
| 3    | 10                  | `shared` + `git-info.service.ts`; shared is in every backend and git-ui scope.                                                                                                                                         |
| 4    | 11                  | rpc-handlers + git-ui; needs 10's params.                                                                                                                                                                              |
| 5    | 12                  | `shared` + `git-info.service.ts`.                                                                                                                                                                                      |
| 6    | 13                  | agent-sdk + rpc-handlers; needs 12.                                                                                                                                                                                    |
| 7    | 14                  | ptah-electron + git-ui; needs 13 (and 3).                                                                                                                                                                              |
| 8    | 15                  | `shared` union growth + git-ui; shared reaches every scope, so not beside 13/14.                                                                                                                                       |
| 9    | 16                  | `git-info.service.ts` + status parser; needs 15.                                                                                                                                                                       |
| 10   | 17                  | vscode-core review reader; needs 16.                                                                                                                                                                                   |
| end  | P2 phase-end review | per Review cadence (DONE 2026-10-01).                                                                                                                                                                                                  |

## Review cadence (user decision 2026-09-30)

Applies to P2, P3, P4, P5 and Cutover (Batches 9-69); recorded in `context.md`. It replaces the per-batch review rule
under "Execution defaults".

- **Per batch:** typecheck, lint and scoped unit tests for the batch's projects (plus the `*.real-git.spec.ts`
  suites when git behaviour changes), then the husky pre-commit hook (format, `nx affected -t lint` including
  `degradation-audit`, `ptah-electron:validate-deps`, commitlint), then the team-leader verifies on disk and
  commits. No per-batch lane review and no per-batch e2e.
- **Per phase end (P2, P3, P4, P5, Cutover):** one cross-side review lane on the whole phase diff, the full e2e set,
  and a visual review for UI phases. Findings are fixed in follow-up commits before the next phase starts.
- New UI stays unmounted until Batch 58.
- Each batch's "Reviewer" line below names the scope the phase-end review must cover for that batch; it is not a
  per-batch gate.

## Batch 9: Ref guard (RC14) — COMPLETE (7800dde50)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Rationale: guard + call-site edits in the hot-spot facade.
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: P1 branch (stacked)
- Wave: 1 (with Batch 19)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core`; real-git specs
  (`--testPathPatterns=real-git --passWithNoTests=false`); `npx nx run degradation-audit:lint`

### Task 9.1: `assertSafeRef`/`assertSafeRevision` and `--end-of-options` at call sites — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-ref-guard.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-ref-guard.spec.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ref-guard.real-git.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts
- Plan reference: implementation-plan.md:497-525
- Pattern to follow: `git-review-reader.service.ts:291`
- Quality requirements: `--output=/tmp/x` and `-b` refused, no file written; `validatePathSegment` comment corrected.
- Validation notes: `stash@{N}` built internally stays allowed.
- Implementation details: getLastCommit, checkout, addWorktree, removeWorktree (`-- <path>`).
- State (2026-09-30, end of session): IMPLEMENTED, **not committed** (uncommitted in worktree
  `.claude-worktrees/task-576-p2`). Files: the 4 above plus `git-info.service.spec.ts` (one expectation now includes
  `--end-of-options`; approved fifth file). Passing: ref-guard specs 86/86; `git-info.service.spec.ts` 154/154;
  vscode-core typecheck + lint; `degradation-audit:lint`. Deviation: `checkout -b` has no `--end-of-options` (`-b`
  takes the branch as its value).
- **Open gate before commit** (run with no lanes or agents active):
  1. Default unit run (real-git ignored): 4 failures in `git-info.service.remote-stash.spec.ts` (push, pull/fetch).
     That suite spawns real git but is not named `*.real-git.spec.ts`, so the P1 split (3346f60a6) misses it. Fix on
     the **P1 branch** (PR #611): rename it to `*.real-git.spec.ts` (check for other real-git suites without the
     suffix), then rebase P2.
  2. Serial real-git run (`--runInBand`, 5 suites incl. Batch 9's): 1 failure, the kill-guard test "a cancel of
     `commit -a` mid-hook kills the tree and Ptah removes the lock it left". It passes alone (14/14) and passed 10
     times before; it failed once when all 5 suites ran in one process. Rule out an interaction with the new
     ref-guard real-git suite: run `nx run @ptah-extension/vscode-core:test-real-git` 3 times; if it fails again,
     capture the assertion and return Batch 9 to backend-developer.
  3. Out of scope, noted: `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts:14` still names
     `validatePathSegment` as the guard.
- Gate closed (orchestrator, 2026-09-30):
  1. P1 fix e22402369 on the P1 branch (pushed, PR #611): `remote-stash`, `review` and `apply-hunks` specs spawn
     real git and are renamed to `*.real-git.spec.ts` (the only three without the suffix; `main-loop-watchdog.spec.ts`
     uses `mkdtempSync` but no git). P1 evidence: `vscode-core:test --coverage` 40 suites, 716 passed, thresholds
     met; `test-real-git` 3 runs, 7 suites, 86 passed, 2 skipped. P2 rebased on e22402369.
  2. The first P1 real-git attempt failed 2 tests (hooks, remote-stash; suites 220 s / 342 s) because an orphaned
     `grep` from another session (7 GB, scan of `claude.exe`) loaded the machine; it was stopped with the user's
     approval and the runs were repeated on a quiet machine.
  3. P2 with Batch 9: `vscode-core:test --coverage` 41 suites, 793 passed, thresholds met; `test-real-git` 3 runs,
     8 suites, 95 passed, 2 skipped. The kill-guard test passed in all three runs. Committed as 7800dde50.

## Batch 10: Branch switching backend (RC9) — COMPLETE (4ff38bc5c)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 9
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core @ptah-extension/shared`

### Task 10.1: `git switch` semantics with stash, force, track — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.switch.real-git.spec.ts
- Plan reference: implementation-plan.md:527-549
- Pattern to follow: `checkout` at `git-info.service.ts:2394-2437`
- Quality requirements: no `status --porcelain` pre-check; HEAD never detached (spec asserts `symbolic-ref HEAD`).
- Validation notes: switch failure after stash → pop; pop failure → both errors, stash kept.
- Implementation details: `GitCheckoutParams.stash?/track?`, `GitCheckoutResult.conflictingPaths?/stashRef?`.

## Batch 11: Branch switching handler and picker UI (RC9) — COMPLETE (2ae839735)

- Recommended executor: frontend-developer | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope; visual-reviewer (before/after picker, dark + light)
- Tasks: 1 | Depends on: Batch 10
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers @ptah-extension/git-ui`

### Task 11.1: Pass new params; "Stash & switch" primary, "Discard & switch" behind confirmation — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.spec.ts
- Plan reference: implementation-plan.md:538-540, 554-556
- Pattern to follow: `branch-picker-dropdown.component.ts:39-55, 158-182`
- Quality requirements: remote rows pass `track:true`; create-branch error shows the reason.
- Validation notes: parity row `parity-inventory.md:122` (force stays as secondary confirmed action).
- Implementation details: zod schema in `git-rpc.schema.ts` accepts the new optional fields if the handler validates with it (then that file is the 5th file).

## Batch 12: Worktree admin core (RC10) — COMPLETE (ca36b19de)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 11
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core @ptah-extension/shared`

### Task 12.1: Exclude on create, labels, prune, scoped params — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/agent-worktree-admin.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.worktrees.real-git.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/utils/git.utils.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/utils/git.utils.spec.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts
- Plan reference: implementation-plan.md:558-577, 589-595
- Pattern to follow: `parseWorktreeList` `git.utils.ts:43-57`; `AGENT_WORKTREE_DIR` `workspace-scan.constants.ts:88`
- Quality requirements: exclude line written once (commondir-aware `rev-parse --git-path info/exclude`); `worktree remove [--force] -- <path>`; new `pruneWorktrees`.
- Validation notes: exclude write failure warns and does not block add; locked worktree never force-removed.
- Implementation details: `GitWorktreeInfo.locked?/lockReason?/prunable?/prunableReason?`; `GitWorktreesParams = GitWorkspaceScopedParams`, add/remove params extend it.

## Batch 13: Worktree remove hook and RPC scoping (RC10) — COMPLETE (ddafac963)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 12
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers`

### Task 13.1: `WorktreeRemove` hook removes + prunes; handlers use `resolveRoot` — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts; MODIFY D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts
- Plan reference: implementation-plan.md:565, 572-576, 585-587
- Pattern to follow: `resolveRoot` `git-rpc.handlers.ts:287-311`; hook `worktree-hook-handler.ts:274-345`
- Quality requirements: path must be listed by `git worktree list` and under `<main>/.claude-worktrees/`; hook always returns `continue: true`.
- Validation notes: A5 — log which removal path fired.
- Implementation details: worktree RPCs (`:317-460`) honour `params.workspaceRoot`.
- Outcome (ddafac963): hook calls `removeWorktree(main, gitPath, true)` then `pruneWorktrees(main)`; prunable entry → prune only; locked → skipped. Log field `removalPath` (A5). `git:worktrees` validates with `parseGitWorkspaceScopedParams`; add/remove use `resolveRoot`. Verified: agent-sdk + rpc-handlers typecheck/lint/test green except the known unrelated `harness-skill-selection-rpc.service.spec.ts` failure (unchanged from main).

## Batch 14: Worktree removal detection and frontend scoping (RC10) — COMPLETE (6a62feb31)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 3, 13
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-electron @ptah-extension/git-ui`

### Task 14.1: Watcher re-lists worktrees on admin change (≤1 per 30 s piggyback); `WorktreeService` passes `workspaceRoot` — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.ts; MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/services/git-watcher.service.spec.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/worktree.service.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/worktree.service.spec.ts
- Plan reference: implementation-plan.md:566-570, 576, 596
- Pattern to follow: `scheduleNestedRootsRefresh` `git-watcher.service.ts:632`
- Quality requirements: no free-running timer (last-run timestamp); prunable under `.claude-worktrees/` → prune + `git:worktreeChanged {action:'removed'}`.
- Validation notes: parity row `parity-inventory.md:92` (removed worktree unregistered) stays green.
- Implementation details: as plan.
- Outcome: executor backend-developer; only the four listed files changed. Agent-worktree audit
  (`pruneVanishedAgentWorktrees`) runs at arm, on a worktree admin re-list, and on a status refresh, at most once per
  30 s (`lastWorktreeAuditAt` timestamp, no timer; cleared in `stop()`, so non-git workspaces never audit). Unlocked
  `prunable` entries under `<main>/.claude-worktrees/` → `pruneWorktrees(main)`, re-list, `git:worktreeChanged
  {action:'removed', path}` only for paths that left the list. Failures logged, never thrown. `WorktreeService` sends
  `workspaceRoot` from `GitStatusService.activeWorkspacePath()` on list/add/remove. Deviation (accepted): the 30 s
  throttle applies to the prune audit, not to the admin-change re-list — throttling the re-list would leave a second
  new worktree inside 30 s unexcluded from the workspace watch (event-storm regression). Parity row is at
  `parity-inventory.md:94` in this copy; still green. Verified by the orchestrator: `nx run-many -t typecheck,test,lint
  -p ptah-electron @ptah-extension/git-ui` green; `ptah-electron:validate-deps` green (executor). One earlier executor
  run had 7 `shell-csp.spec.ts` timeouts under load; green on rerun (file not touched).

## Batch 15: Status union growth and frontend consumers (RC12, V10) — COMPLETE (183aac6e6)

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 12
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/git-ui`

### Task 15.1: `GitFileStatus.status` gains `'U' | 'T'`, `conflict?`, `submodule?`; `GitInfoResult.operation?`; `GitBlobRead` outcomes — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/changed-file-tree.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/source-control/changed-file-tree.spec.ts
- Plan reference: implementation-plan.md:612-624, 644-646
- Pattern to follow: closed code sets `rpc-git.types.ts:299-322`
- Quality requirements: every `switch` over the status is exhaustive; `U` rendered as Conflicted, `T` as Type changed.
- Validation notes: V10; backend still emits the old values until Batch 16.
- Implementation details: typecheck finds all switches; add spec cases for U/T rows.
- Outcome (183aac6e6): new `GitConflictKind`, `GitRepoOperation(Kind)`, blob outcomes `too-large`/`lfs-pointer`. Badges: conflicted `!` (VS Code letters; `U` already = untracked), ignored now `I`; label carries meaning. `changed-file-tree.ts` unchanged (no status switch). Extra file: `describeBlob` cases in `git-info.service.ts`; `GitChangeKind` doc comment fixed (carried item closed). Follow-up for the change-set card: `.err-solid-text` class does not exist yet.

## Batch 16: Repo operation, conflict kinds, size limit and LFS in the facade (RC12) — COMPLETE (4b458351a)

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 15
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core`

### Task 16.1: `readRepoOperation`, `u` → `'U'` + conflict kind, `T`, submodule, blob too-large / LFS — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-repo-operation.reader.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-status-parser.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.operation.real-git.spec.ts
- Plan reference: implementation-plan.md:608-646
- Pattern to follow: `readBlob` `git-info.service.ts:1197-1264`; binary refusal `:1628-1646`
- Quality requirements: ≤1 extra spawn per status, only when needed; `GIT_DIFF_MAX_SIDE_BYTES` (add to `git-operation.constants.ts` — if so it is a shared file; keep it in the batch report as the 6th file).
- Validation notes: merge, rebase, cherry-pick conflicts incl. linked worktree; 3 MiB → too-large; LFS pointer labelled; `applyHunks` refuses both with `BINARY_UNSUPPORTED`.
- Implementation details: as plan.
- Outcome (4b458351a): new `git/git-repo-operation.reader.ts` (marker paths via one cached `rev-parse --git-path` per workspace, then fs checks only; rebase > merge > cherry-pick; `git am` not reported) and `git/git-blob-classifier.ts` (+spec; too-large / LFS / binary / text — reuse it in Batch 17). `GIT_DIFF_MAX_SIDE_BYTES = 2 MiB` in shared `git-operation.constants.ts`. Conflict kind order: submodule, symlink, delete-modify, add-add, content. Too-large size from `cat-file -s`; worktree side uses fs stat before reading. LFS `oid` keeps its `sha256:` prefix. Verified: vscode-core unit 817/817, real-git 131 passed / 2 skipped (11 suites), typecheck of vscode-core, rpc-handlers, git-ui, shared green.

## Batch 17: Review reader size limit (RC12) — COMPLETE (e44c7cb95)

- Recommended executor: CLI lane | Fallback: backend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 16
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core`

### Task 17.1: `GitReviewReaderService.readBlob` uses the 2 MiB limit and the new outcomes — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-review-reader.service.ts; MODIFY its spec D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-review-reader.service.spec.ts
- Plan reference: implementation-plan.md:622, 643
- Pattern to follow: Task 16.1 mapping of `GitOutputLimitError`
- Quality requirements: replaces the 64 MiB cap at `:383-387`.
- Validation notes: none beyond plan.
- Implementation details: spec for too-large and LFS pointer.
- Outcome: executor opencode lane (`opencode-go/kimi-k2.7-code`, backend-developer role); only the two listed files
  changed. `git show` runs with `maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES`; exit 0 → `classifyBlobBytes` (reused, local
  NUL sniff removed); `GitOutputLimitError` → `too-large` with the size from `cat-file -s` (falls back to the cap as a
  lower bound). Specs: too-large (real and fallback size), LFS pointer, runner option. Verified by the orchestrator:
  `nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-core` green. Lane report: `reviews/batch-17-report.md`.

## Batch 18: One `GitInfoService` per host (RC13) — COMPLETE (e7b30b433)

- Recommended executor: CLI lane | Fallback: backend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 2 | Depends on: P1 branch (stacked)
- Concurrency-eligible with: none in the single checkout (its scope compiles vscode-core); Wave 2
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-extension-vscode @ptah-extension/cli-engine`

### Task 18.1: VS Code singleton registration — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/phase-3-handlers.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/container.smoke.spec.ts
- Plan reference: implementation-plan.md:648-660
- Pattern to follow: `instanceCachingFactory` `libs/backend/auth-providers/src/lib/providers/register-providers.ts:63-67`
- Quality requirements: `resolve(TOKENS.GIT_INFO_SERVICE) === resolve(TOKENS.GIT_INFO_SERVICE)`.
- Validation notes: none.
- Implementation details: replace `phase-3-handlers.ts:58-60`.

### Task 18.2: CLI singleton registration + new spec (V11) — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/container.ts; CREATE D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/container-git-info-singleton.spec.ts
- Plan reference: implementation-plan.md:655-660
- Pattern to follow: `libs/backend/cli-engine/src/lib/container-governor-shutdown.spec.ts` (container setup)
- Quality requirements: same identity assertion.
- Validation notes: V11.
- Implementation details: replace `container.ts:445-447`.

## Batch 19: Scoped, queued diff refresh (RC11) — COMPLETE (0c3189fbc)

- Recommended executor: CLI lane | Fallback: frontend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: P1 branch (stacked)
- Concurrency-eligible with: Batch 9 only (Wave 1); git-ui imports no backend lib
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`; `npx nx run degradation-audit:lint`

### Task 19.1: Cause-scoped refresh with `rerunRequested` trailing run — COMPLETE

- Result (2026-09-30): executor Glm CLI lane (frontend-developer role); only the two listed files changed (+363/−8).
  `nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui` passed (git-ui jest 486/486; diff-tabs spec 64 tests,
  6 new RC11 cases); `degradation-audit:lint` passed (293 sites, unchanged). Committed as 39d0daffe, rebased to
  0c3189fbc. Per-phase cadence: no per-batch review; covered by the P2 phase-end review.

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts
- Plan reference: implementation-plan.md:662-680
- Pattern to follow: `diff-tabs.service.ts:468-517`
- Quality requirements: workspace-only cause refreshes 1 of 3; index cause refreshes all; exactly one trailing run.
- Validation notes: failed refresh keeps previous content (parity §7).
- Implementation details: replaces the drop at `:488`; logic written so it can be moved verbatim to `ReviewDiffService` (Task 35.1).

### P2 phase-end review

- [x] Phase-end review checkpoint (Review cadence): one cross-side review lane on the P2 phase diff, the full e2e set; findings fixed in follow-up commits before the next phase starts.

Outcome (orchestrator, 2026-10-01):

- Logic review, cross-side and cross-family: Glm lane on the subagent-authored batches
  (`reviews/p2-phase-review-glm.md`, APPROVED WITH FIXES 7/10 → round 1 APPROVED) and code-logic-reviewer subagent on
  the lane-authored Batches 17 and 19 (`reviews/p2-phase-review-subagent.md`, APPROVED WITH FIXES 7/10 → round 1
  APPROVED). Rejected with evidence, reviewer agreed: Glm F2 (JS `split(' ', 6)` truncates; parser is correct) and F4
  (the exclude line always starts with `/`; real-git spec added). Decision on Glm F1: a discard blocked by untracked
  files is refused with paths and a move-or-delete message; untracked files are never deleted.
- Fixes: 00f21739b (untracked switch blockers, git ≥2.24 message, `git:worktrees` invalid-params log), c9a316661
  (stash notice, discard refusal panel, degraded diff refresh), 218acd989 (stale after a dropped refresh, log
  throws), d792cd593 (stash named by short SHA).
- CI fixes: 8499ad4e8 (orphaned degradation-audit marker; worktree real-git spec uses `realpathSync.native` for
  Windows 8.3 temp paths and a read-only exclude file for POSIX; review-controls e2e checkout params),
  d83b3fbb1 (hunk-revert e2e poll tolerates the `git apply` unlink window).
- Full e2e set: CI `electron-e2e` green on d83b3fbb1 (199 specs); `webview-e2e`, `CLI E2E`, `git-real-git` on
  ubuntu/macos/windows green. The local full Electron run did not finish (stopped at 2 h): on this machine the
  e2e app competes with the user's running Ptah desktop app ("Renderer did not load … ERR_FAILED"); CI is the
  e2e evidence for this phase.
- Visual review (visual-reviewer, `reviews/p2-visual-review.md`, screenshots `screenshots/p2/`): round 0 APPROVED WITH
  FIXES 6/10 (error copy, destructive cue and badge letters under AA; focus ring) → fixed in 3c2d3c51e → round 1
  APPROVED 8/10.
- Carried to P3 Batch 24 (owns `styles.css`): light-theme focus ring 2.94–3.33:1 against the panel; error icon and
  error border 2.56–2.93:1 (non-text cues); the `[data-theme='anubis-light'] .btn-ghost` override at
  `styles.css:1838-1852` silently replaces any `text-*` colour on ghost buttons.
- Carried to P3/P5: real-git spec for the review reader 2 MiB cap and an exactly-2 MiB boundary case (Component 13);
  diff-tabs specs for the workspace-switch restore and `refs`/`initial` causes (moves with Task 35.1).

---

# P3 — Foundation

## P3 branch and execution waves (orchestrator, 2026-10-01)

Branch `feat/task-2026-576-p3` from P2 `ef6f18915`, worktree `.claude-worktrees/task-576-p3` (node_modules junction
to the main checkout), draft PR stacked on `feat/task-2026-576-p2`. When PR #619 merges, merge `origin/main` into
P3 and retarget its PR to `main` (no rebase, no force push).

Same wave rule as P2: a wave holds more than one batch only when the batches are file-disjoint; where one batch's
check scope compiles the other's library, the executor re-runs a failed check once before reporting. At most 3
executors at once.

| Wave | Batches  | Why                                                                                                                     |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1    | 20 ∥ 25  | 20 measures the base bundle (webview build only, report-only); 25 adds shared types + vscode-core delegates (no bundle change). |
| 2    | 21 ∥ 26  | 21 = git-ui entry + webview + `tsconfig.base.json` alias; 26 = rpc-handlers only. 21 must follow 20 (baseline).          |
| 3    | 22 ∥ 27  | 22 = git-ui renderer + `package.json` (exact `@pierre/diffs`); 27 = rpc-handlers registration + host lists.              |
| 4    | 23 ∥ 28  | 23 = git-ui diff-renderer entry (CLI lane); 28 = VS Code app commands.                                                    |
| 5    | 24       | ui + webview `styles.css`; takes the P2 carried items (light focus ring, error icon/border cues, `.btn-ghost` override). |
| 6    | 29       | chat-ui card; needs 24, 25.                                                                                              |
| 7    | 30       | chat store/actions + webview app config; needs 27, 28, 29.                                                               |
| 8    | 31       | transcript insertion + Electron e2e; needs 30.                                                                           |
| 9    | 32       | VS Code e2e; needs 31.                                                                                                    |
| end  | P3 phase-end review | per Review cadence; card visual review against `prototype/`.                                                  |

## Batch 20: Eager-bundle guard script and baseline measurements — COMPLETE

- Recommended executor: devops-engineer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: P2 complete. Must run before Batch 21 changes `app.config.ts` (baseline).
- Verification: `npx nx run ptah-extension-webview:verify-eager-bundle` in report-only mode on the base build

### Task 20.1: `assert-eager-bundle.mjs` (report-only + assert), Nx target, baseline rows — COMPLETE

- Files: CREATE D:/projects/ptah-extension/apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/project.json; CREATE D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/bundle-measurements.md
- Plan reference: implementation-plan.md:693-697, 1473-1479
- Pattern to follow: other scripts under `apps/ptah-extension-webview/scripts/` if present, else `scripts/copy-webview.js` style
- Quality requirements: follows static imports from `index.html` module scripts; fails on the listed selectors; prints gz of `main.js` and closure.
- Validation notes: assertion mode is expected to FAIL on the base build (git-ui is eager); record that as the baseline, run with `--report-only`. TTI baseline: `startup-tti.spec.ts` twice, second boot recorded.
- Implementation details: target `verify-eager-bundle` depends on `build`.
- Outcome: executor devops-engineer; only the three listed files. The script follows static imports from the
  `index.html` module scripts (not dynamic `import()`), prints raw/gzip sizes, fails on the plan's 8 markers;
  `--report-only` and `--dist <dir>` flags; exit 2 when the build output is missing. Baseline (production build):
  `main.js` 401,859 B gz (392.4 KB; research said 383.9 KB — Batch 21 compares against 401,859 B), eager closure
  817,717 B gz over 12 files; assert mode fails on the base build (`ptah-git-`, `ptah-diff-view` in `main.js`) as
  expected. TTI baseline (second boot, `startup-tti.spec.ts` via playwright, dev renderer) 14,557 ms; FCP 608 ms.
  Verified by the orchestrator: `verify-eager-bundle -- --report-only` reproduces the numbers; webview lint green.

## Batch 21: `@ptah-extension/git-ui/services` narrow entry — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 20
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui ptah-extension-webview` then `verify-eager-bundle` (assert mode passes; `main.js` gz ≤ baseline)

### Task 21.1: Entry file, path alias, app import switch, routing specs — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/services.ts; MODIFY D:/projects/ptah-extension/tsconfig.base.json; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-status-message-routing.spec.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts; MODIFY D:/projects/ptah-extension/eslint.config.mjs (only if lint requires)
- Plan reference: implementation-plan.md:684-714
- Pattern to follow: `libs/frontend/skill-synthesis-ui/src/services.ts:1-20`; `eslint.config.mjs:227-253`
- Quality requirements: routing spec assertions unchanged; dynamic full-barrel imports at `workspace-coordinator.service.ts:122`, `electron-shell.component.ts:372`, `file-link-router.service.ts:121` untouched.
- Validation notes: R11.
- Implementation details: exports GitStatusService, GitBranchesService, WorktreeService, DiffTabsService.
- Outcome: executor frontend-developer; listed files only (`eslint.config.mjs` not needed). The four services' own
  imports reach no component file. `verify-eager-bundle` assert mode passes (no forbidden markers). `main.js`
  362,218 B gz (−39,641 B vs the Batch 20 baseline); eager closure 778,076 B gz (−39,629 B). Deviation:
  `git-dock-arming-identity.spec.ts` imports `GitDockComponent`/`GitReviewService` from the full barrel and the four
  services from the narrow entry (same module files; identity assertions unchanged and green). Verified: git-ui 516
  tests, webview 232 tests, typecheck and lint green (executor); orchestrator re-ran the checks before commit.

## Batch 22: Pierre renderer host and hunk mapping (A1, A2 gate) — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batch 21
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 22.1: Dependency, config and `PierreDiffHostComponent` — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/package.json (+ lockfile); CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-config.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.spec.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/pierre-hunk-mapping.real-git.spec.ts
- Plan reference: implementation-plan.md:716-757
- Pattern to follow: `splitPatch`/`parseHunkRefs` `git-info.service.ts:1484-1533`
- Quality requirements: `"@pierre/diffs": "1.5.1"` exact; `lineDiffType: 'word'`; imperative `FileDiff`, disposed on destroy/input change; exactly one toolbar host per hunk (hunk at line 1, adjacent hunks); CRLF bytes untouched.
- Validation notes: A1 — read `DiffHunksRenderer.ts` and `getLineAnnotationName.ts` at tag `diffs-v1.5.1`, record in report. Mapping mismatch → `mappingError`, read-only.
- Implementation details: separator slot else annotation slot fallback.
- Outcome (22.1): executor frontend-developer; report `reviews/batch-22-report.md`. `"@pierre/diffs": "1.5.1"` exact;
  lockfile +129 lines, additions only (the executor's `npm install` replaced the worktree node_modules junction,
  hung on Electron's binary download and rolled back; the orchestrator restored the junction, ran
  `--package-lock-only --ignore-scripts`, and placed the package with its dependencies nested under
  `node_modules/@pierre/diffs/node_modules` in the shared main node_modules — additive only). Extra file
  `renderer/pierre-hunk-mapping.ts` (mapping without a runtime Pierre import, so the real-git spec tests shipped
  code). A1 (tag `diffs-v1.5.1`): a hunk gets a separator only when unchanged lines precede it (never at line 1),
  and with `hunkSeparators: 'line-info'` the separator holds no slot (only deprecated `'custom'` does) — so every
  toolbar lands in its `annotation-<side>-<line>` slot; the host decides from rendered slots, never from config.
  One slot per hunk proven on real git output (hunk at line 1, hunks one line apart). Spec found and fixed a stale
  hunk-list index on input change. Component unmounted. git-ui real-git spec runs in the normal git-ui `test`
  target (CRLF cases local Windows only). Verified: git-ui 536 tests, typecheck, lint green; eager bundle unchanged
  (362,218 B gz) and assert mode green.
- Outcome (22.2, A2): no blocker. App build has no Pierre code yet (unmounted); the one `new Function` hit is zod's
  feature test. An esbuild bundle of Pierre 1.5.1 + `pierre-config.ts` (411 chunks) has no `new Function` / `eval(`;
  Shiki's WASM loader is present but unused (`'shiki-js'` pinned). Electron console check moves to the first batch
  that mounts the host. **Open gate for P4, before Batch 44:** the VS Code webview `style-src` has no
  `'unsafe-inline'`, and Pierre injects `<style>` elements and style attributes; the skills drawer (Batch 44)
  renders `TextDiffViewComponent` in VS Code. Options to research and decide (independent lane): nonce
  propagation, `useCSSClasses`/constructable stylesheets, or a CSP change. Electron allows inline styles.

### Task 22.2: CSP check (A2) — COMPLETE

- Depends on: Task 22.1
- File: none authored; evidence in the batch report
- Plan reference: implementation-plan.md:146, 1488
- Pattern to follow: n/a
- Quality requirements: `grep -E "new Function|eval\("` over built lazy chunks is empty; one diff loads in Electron with devtools console clean.
- Validation notes: R2 — on failure stop and return; the `@codemirror/merge` fallback is an architecture change (BLOCKER to the orchestrator).
- Implementation details: n/a

## Batch 23: `diff-renderer` secondary entry and `TextDiffViewComponent` — COMPLETE

- Recommended executor: CLI lane | Fallback: frontend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 22
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui` + lazy-size row via the Batch 20 script

### Task 23.1: Entry, alias, wrapper, lazy-size measurement — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/renderer/text-diff-view.component.spec.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/diff-renderer.ts; MODIFY D:/projects/ptah-extension/tsconfig.base.json; MODIFY D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/bundle-measurements.md
- Plan reference: implementation-plan.md:741, 752-753, 1477
- Pattern to follow: Task 21.1 alias style
- Quality requirements: first realistic diff ≤ 217 KB gz; Pierre not in the eager closure.
- Validation notes: none.
- Implementation details: `TextDiffViewComponent` uses `parseDiffFromFile(old, new)`, unified only.
- Outcome: executor antigravity lane (frontend-developer role) after opencode Kimi failed twice ("Unknown error",
  both models) and Glm hit its Ollama usage limit (HTTP 429) — lane-authored, so the phase-end review uses a subagent
  reviewer. Report `reviews/batch-23-report.md`. Listed files only. Entry exports `PierreDiffHostComponent`,
  `TextDiffViewComponent` and their types. Lazy-size (esbuild ESM bundle of `diff-renderer.ts`, Angular and
  shared externalized — an approximation of the Angular build): first realistic diff (entry closure + the
  TypeScript grammar chunk) 153,279 B gz ≈ 149.7 KB (bar ≤ 217 KB); eager bundle unchanged (362,218 B gz), assert
  mode green. Orchestrator corrections before commit: error note `text-base-content/70` → `text-base-content-muted`
  (the sanctioned muted token), `catch (err: unknown)`. Verified: git-ui 544 tests, typecheck, lint green.

## Batch 24: `FileStatusBadgeComponent` with AA contrast — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, style scope; visual-reviewer (badge in anubis + anubis-light)
- Tasks: 1 | Depends on: P2 complete
- Concurrency-eligible with: Batches 20-23, 25-28
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui ptah-extension-webview`

### Task 24.1: Neutral chip with hue accent (Gate 2 default a) — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/file-status-badge/file-status-badge.component.ts; CREATE .../file-status-badge/file-status-badge.component.spec.ts; CREATE .../file-status-badge/index.ts (all under D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/); MODIFY D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/index.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/styles.css; CREATE D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts
- Plan reference: implementation-plan.md:768-794
- Pattern to follow: `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`
- Quality requirements: `base-content` on `base-300` ≥4.5:1 for every picker theme; `aria-label` full word; override classes scoped to anubis themes only.
- Validation notes: design-spec §13a resolved by default (a).
- Implementation details: inputs `status`, `conflictKind?`.
- Outcome: executor frontend-developer. `ptah-file-status-badge`: `text-base-content` letter on `bg-base-300`
  with a 2 px status-colour left border; full word (plus conflict kind) in `role="img"` `aria-label`/`title`;
  letters match the existing rows (U, !, I). styles.css (anubis themes only): `.err-solid-text`, `.ok-solid-text`,
  `.diff-add-text`, `.diff-del-text`; `--ptah-error-ink` drives `.text-error`/`.border-error` (≥5.5:1 on every
  base layer); light focus ring uses `--ptah-gold-strong` (5.24:1 on base-300, also covers the 25
  `focus-visible:outline-[oklch(var(--s))]` sites); `.btn-ghost` dark-text default moved to `@layer components`
  with lower specificity so `text-*` wins. Closes the P2 carried contrast items. Contrast spec: base-content on
  base-300 ≥4.5:1 in all 34 picker themes (min 5.98:1). Accepted deviations: the `.text-error`/`.border-error`
  change is global within anubis; the model-selector `.btn-ghost` child rule got the same specificity fix; badge
  not yet wired into rows (Component 29). Orchestrator fix: `pierre-diff-host.component.ts` `text-base-content/70`
  → `text-base-content-muted` (caught by `no-alpha-base-content.spec.ts`). Verified by the orchestrator:
  typecheck, test, lint green for ui, ptah-extension-webview, git-ui.

## Batch 25: Change-set shared types and facade delegates — COMPLETE

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: P2 complete
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core`

### Task 25.1: `rpc-change-set.types.ts`, push message type, `readChangeSetNumstat`, `readHeadText` — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-change-set.types.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-constants.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/messages/payload-map.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/index.ts (only if rpc type files are exported individually); MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.spec.ts
- Plan reference: implementation-plan.md:809-813, 821-822, 915
- Pattern to follow: untracked counter `git-info.service.ts:2958-2986`
- Quality requirements: no `RpcMethodRegistry` change here (V5); `readHeadText` capped at 2 MiB; unborn HEAD uses the empty-tree SHA.
- Validation notes: V5.
- Implementation details: `TurnChangeSet`, `TurnChangeSetFile`, `GIT_TURN_CHANGE_SET = 'git:turnChangeSet'`.
- Outcome: executor backend-developer. Types (`TurnChangeSet` + `truncatedCount`, optional `baselineMissing`;
  `TurnChangeSetFile`, `TurnChangeSetTotals`, `GitTurnChangeSetsParams/Result`, `GitTurnChangeSetPayload`), message
  constant and payload map entry. `rpc.types.ts` gets one barrel `export *` line (rpc type files are exported there,
  not in `index.ts`); `RpcMethodRegistry` unchanged (V5). New collaborator `git/git-change-set-numstat.reader.ts`
  (extra file): `diff --numstat -z --find-renames --end-of-options <sha> -- :(top,literal)<path>` in ≤16 KiB argv runs
  (Windows command-line cap), `ls-files --others` for paths missing from the diff (untracked counter, same limits),
  0/0 otherwise; unsafe paths and failures → null counts; unborn HEAD → empty-tree SHA. `readHeadText` reuses
  `readBlob` (2 MiB cap, too-large, classifier). Specs: 12 unit, new `git-info.service.change-set.real-git.spec.ts`
  (5). Verified: shared 2257 tests, vscode-core 836/837 with one `MainLoopWatchdog` timing failure under parallel
  load that passes alone (13/13, file untouched); real-git 139 passed / 2 skipped (12 suites, executor);
  degradation-audit green. Noted, not new: `readUntrackedNumstat` resolves against the workspace path, so untracked
  counts can be wrong when the workspace is a repo subfolder; SHA-256 repos fall back to null counts on unborn HEAD.

## Batch 26: Turn change-set recorder and store — COMPLETE

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 18, 25
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`

### Task 26.1: Baseline at prompt submit, diff at turn end, persist under its own key — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set.store.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:796-845
- Pattern to follow: `session-lifecycle-notifier.ts:58-65, 116-141`; storage key rule `session-metadata-store.ts:20-30`
- Quality requirements: ≤2,000 stat paths, ≤500 files, ≤100 sets/session; no timers; baseline Map entry deleted at turn end.
- Validation notes: A6 — read `user-prompt-submit-hook-handler.ts`; fallback to `SessionMetadata.workingDirectory`. Empty set → no record, no push; unavailable status → nothing; numstat failure → null counts + `countsUnavailable`.
- Implementation details: key `ptah.turnChangeSets:<sessionId>`.
- Outcome: executor backend-developer; the four listed files. Recorder listens on
  `UserPromptSubmitCallbackRegistry.register` (baseline stored before any await; ≤2,000 paths `fs.stat`-ed, 32 at a
  time) and on `onTurnEnded` + `onTurnFailed` (Map entry deleted before any await). Change = status/origPath/numstat
  signature, appear/disappear, or mtime/size. ≤500 files (rest → `truncatedCount`), `countsUnavailable` on a null
  count of a non-binary file, `baselineMissing` when no baseline. Empty set, non-git dir or unavailable status →
  nothing. Store `{ schemaVersion: 1, changeSets }`, newest 100 per session, serialised appends. No timers, no DI or
  RPC registration. A6: `user-prompt-submit-hook-handler.ts:54-59` sends `workspaceRoot: cwd` (the SDK query cwd,
  i.e. the worktree when the session runs in one); fallback `SessionMetadata.workingDirectory`. Accepted deviations:
  failed turns are recorded too; a prompt submitted mid-turn keeps the first baseline (an aborted turn without
  Stop/StopFailure keeps its entry until that session's next turn ends; ≤1 entry per session). Verified:
  rpc-handlers typecheck + lint green; tests 3426 passed / 1 failed (the known `harness-skill-selection` "never
  writes state.json", fails alone, unrelated) / 4 skipped; change-set specs 26/26 (event-driven waits after a
  timing flake); degradation-audit green. For Batch 27: Electron worker storage does not exclude
  `ptah.turnChangeSets:` from `cacheExcludeKeyPrefixes` (several MB per session could load at startup).

## Batch 27: Change-set RPC and registration — COMPLETE

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 26
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers ptah-electron ptah-extension-vscode @ptah-extension/cli-engine` (host surface specs; exception (a))

### Task 27.1: `GitChangeSetRpcHandlers`, registry, manifest, recorder activation — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-change-set-rpc.handlers.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/index.ts
- Plan reference: implementation-plan.md:816-817, 846-853
- Pattern to follow: manifest entry `manifest.ts:191-196`; registry + name map `rpc.types.ts:692, 3750-3775, 4003`
- Quality requirements: manifest invariant spec green; `requires: []`.
- Validation notes: V5, A14 — also check host handler name lists (`apps/ptah-electron/src/di/phase-4-handlers.ts:140-175`, `expected-resolvable.ts`) and add the class name only if those lists enumerate every lib-owned handler.
- Implementation details: recorder registered singleton beside `SessionLifecycleNotifier` (`register-shared-rpc-handlers.ts:49, 58-61`).
- Outcome: executor backend-developer. `git:turnChangeSets {sessionId}` → `{changeSets}` oldest first; params
  zod-validated in the handler file (`sessionId` string 1–512, strict) → `RpcUserError('…','INVALID_PARAMS')`;
  storage failure surfaces as an RPC error. Registry + `RPC_METHOD_ENTRIES` entries; manifest `gitChangeSet`,
  `requires: []`. `TurnChangeSetStore`, `TurnChangeSetRecorder`, `GitChangeSetRpcHandlers` registered as
  singletons; recorder resolved in `activateSessionLifecycleNotifier`. Electron `cacheExcludeKeyPrefixes` now
  includes `TURN_CHANGE_SETS_KEY_PREFIX` (exported from rpc-handlers). VS Code container smoke stubs added for
  the new dependencies. A14: host handler lists do not enumerate every lib-owned handler, so no entry added.
  Verified by the orchestrator: change-set handler spec 11/11, container smoke 33/33, typecheck of shared,
  rpc-handlers, ptah-electron, cli-engine green, degradation-audit green; rpc-handlers 3437 passed / 1 known
  unrelated failure (`harness-skill-selection`); ptah-electron shell-csp timeouts under load pass alone.
  Out of scope, stale: handler count "(19)" in `cli-engine/src/lib/container.ts:832-834` and the log list in
  `apps/ptah-electron/src/di/phase-4-handlers.ts:154-159`.

## Batch 28: VS Code `ptah.review.*` commands and HEAD content provider — COMPLETE

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 18, 25
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-extension-vscode`

### Task 28.1: Four commands, validation, fallbacks, provider, palette hiding — COMPLETE

- Files: CREATE D:/projects/ptah-extension/apps/ptah-extension-vscode/src/commands/review-commands.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/apps/ptah-extension-vscode/src/commands/ptah-git-head-content-provider.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/src/core/ptah-extension.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json
- Plan reference: implementation-plan.md:902-945
- Pattern to follow: `apps/ptah-extension-vscode/src/commands/license-commands.ts:210-227`; palette block `package.json:144-169`
- Quality requirements: `command:execute` allowlist unchanged (by diff); outside paths throw `Error('Path is outside the workspace.')`; ≤500 files; no new VSIX assets.
- Validation notes: V8 — register next to `licenseCommands.registerCommands(this.context)` at `ptah-extension.ts:78`. A3 — read `extHostApiCommands.ts` at `1.100.0`, record the signature.
- Implementation details: `ptah-git-head:/<rel>?root=<folderIndex>`; `vscode.changes` → per-file `vscode.diff` fallback; `git.openMergeEditor` → `vscode.open` fallback.
- Outcome: executor backend-developer; the six listed files. `openChanges [{workspaceRoot, files[1..500]}]`,
  `openDiff`/`openMerge [{workspaceRoot, path, origPath?, status?}]`, `openScm`. Root must match an open `file:`
  workspace folder after symlink resolution (case folded on win32 only); each path checked lexically
  (`isPathWithinRoots`) and again after symlink resolution (nearest existing parent for deleted files); refusal
  throws `Error('Path is outside the workspace.')`, no absolute path in messages. Provider serves `readHeadText`;
  absent/binary/too-large/LFS → one explanatory line; error → empty content + warning. `vscode.changes` →
  per-file `vscode.diff` (or `vscode.open` when one side is missing — `vscode.diff` needs two URIs).
  A3 (`extHostApiCommands.ts` @ 1.100.0, :452-488): `vscode.changes(title, [label: Uri, left: Uri|undefined|null,
  right: Uri|undefined|null][])`. Allowlist: `command-rpc.handlers.ts` diff empty; `ALLOWED_COMMAND_PREFIXES =
  ['ptah.']` already admits `ptah.review.*`. Accepted deviation: commands and provider constructed in
  `ptah-extension.ts` (container files not in the batch). Verified by the orchestrator: typecheck + lint green;
  the two new suites 31/31; full vscode test run 134/134 once Batch 27 fixed its container smoke stubs.
  Noted: `readHeadText` paths are repository-relative, so a workspace folder that is a repo subfolder resolves the
  HEAD side at the wrong path (same root assumption as `GitInfoService`).

## Batch 29: Change-set card component — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, style scope
- Tasks: 1 | Depends on: Batches 24, 25
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui`

### Task 29.1: `ChangeSetCardComponent` (presentational) — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/chat-ui/src/index.ts
- Plan reference: implementation-plan.md:860-863, 886
- Pattern to follow: design-spec.md §4.1, §5; `prototype/`
- Quality requirements: whole row is a button, no nested controls; keyboard reachable, visible focus; "counts unavailable" and "No longer changes HEAD" states.
- Validation notes: none.
- Implementation details: inputs `changeSet`, `host`, `reconciled`, `conflicted`; outputs `review`, `openFile`, `openScm`.
- Outcome: executor frontend-developer. Presentational card (no services/RPC); exports `ChangeSetCardComponent`,
  `ChangeSetCardHost`, helpers `formatFileCounts`/`changeSetAccent`. Each actionable row is one button with a
  visible inset focus ring; status letters via `ptah-file-status-badge`; counts unavailable → chip + `?` per row
  (never zeros); reconciled → plain "No longer changes HEAD" row; conflicted wins over reconciled and adds a
  "Conflicted" chip; truncated → "N more files not listed"; baselineMissing → muted caveat line; "Open Source
  Control" only on VS Code. Accepted deviations: no `opacity-60` on reconciled rows (AA), `reconciled`/`conflicted`
  default to empty sets, types live at `types/rpc/rpc-change-set.types.ts`. Verified by the orchestrator: chat-ui
  typecheck/test/lint green (no cache); webview contrast specs 70/70. Noted: the AA colour overrides exist only
  for the anubis themes.

## Batch 30: Change-set store, actions and push routing — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 27, 28, 29
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat ptah-extension-webview`

### Task 30.1: `ChangeSetStore`, `ChangeSetActionsService`, `MESSAGE_HANDLERS` entry — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/change-set/change-set.store.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/index.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts
- Plan reference: implementation-plan.md:864-871, 887-888
- Pattern to follow: `file-link-router.service.ts:94-137`; `vscode.service.ts:171`
- Quality requirements: one deduped `git:info` per session view (5 s freshness, 1 s debounce); no per-card timers; reconcile failure never shows zeros.
- Validation notes: Electron path calls `ReviewNavigationService` which does not exist until Batch 35 — until cutover the Electron action reveals the existing dock and opens the file through the existing `openInDock` path; the switch to `ReviewNavigationService` is Task 58.2.
- Implementation details: VS Code path `command:execute` with `ptah.review.*` and `args: [{ workspaceRoot, files | path }]`.
- Outcome: executor frontend-developer. `ChangeSetStore` (root signals store + `MESSAGE_HANDLERS`): loads
  `git:turnChangeSets` per active session (joined in-flight), merges pushes by turn (≤100/session, ≤8 sessions
  cached), reconciles with one `git:info` per session (1 s collapse, 5 s freshness; turnEnded and status-update
  force a re-read; no overlap; ≤1 timer per session, cleared on destroy). Missing from status → reconciled; `U` →
  conflicted. Any failure drops marks and never rewrites counts. API `changeSetsFor`, `marksFor`, `ensureLoaded`.
  `ChangeSetActionsService`: VS Code `command:execute` `ptah.review.*` (merge editor when recorded or current
  status is `U`); Electron reveals the dock in working-tree mode and opens files via the `openInDock` steps,
  git-ui imported dynamically; failures reject with user-facing errors. Accepted deviations: matching
  `git:status-update` used directly (no RPC); Electron review/SCM reveal without opening a file; `openInDock`
  steps duplicated (router method is private) until Task 58.2. Verified by the orchestrator: chat + webview
  typecheck/test/lint green; eager guard passes, `main.js` 364,855 B gz. Noted: jest worker-exit warning in the
  new specs; repo-subfolder path assumption also affects marks.

## Batch 31: Transcript insertion and Electron card e2e — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope; visual-reviewer against `prototype/` (dark + light)
- Tasks: 1 | Depends on: Batch 30
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat ptah-electron-e2e`

### Task 31.1: `@defer (when ...)` card after the turn's last assistant message — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html; MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts; CREATE D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts
- Plan reference: implementation-plan.md:872, 889
- Pattern to follow: transcript loop `chat-transcript.component.html:34-60`
- Quality requirements: card chunk stays lazy; axe clean dark + light.
- Validation notes: A7 — read `session-history-replayer.service.ts` (~191); fallback join "after the last assistant message before the next user message".
- Implementation details: e2e — agent turn edits two files → card; reopen session → card rendered.
- Outcome: executor frontend-developer. A7: replayed messages carry no turn id, so the join is by time on the
  transcript order key (`streamingState.startTime ?? timestamp`): last assistant message within
  [turnStartedAt, turnEndedAt] (binary search), fallback "last assistant message of the turn whose user message
  is the last at/before turnStartedAt", else no card. `transcript-change-set-anchors.ts` (+spec 7) owns the join
  and `transcriptOrderKey`; the transcript renders `@defer (when …)` cards per anchor, inline action errors with
  `role="alert"`, `ensureLoaded` for visible non-active tiles. Accepted deviations: new secondary entry
  `@ptah-extension/chat-ui/change-set-card` (+ tsconfig alias, card export removed from the chat-ui barrel)
  because the barrel is eager; test harness stubs; orchestrator added `ptah-change-set-card` to the eager guard's
  forbidden markers. e2e `change-set-card.spec.ts`: push → card in DOM order after the turn; reload + reopen →
  card from `git:turnChangeSets`; passed alone (55 s). Axe not run (no axe in the Electron harness; visual review
  covers dark/light). Verified by the orchestrator: chat, chat-ui, ptah-electron-e2e typecheck/test/lint green;
  eager guard passes (card in a 9 KB lazy chunk).

## Batch 32: VS Code e2e — card to native diff views — COMPLETE

- Recommended executor: senior-tester | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 31
- Verification: `npx nx run-many -t lint,typecheck -p ptah-extension-vscode-e2e` + the suite run command used by `apps/ptah-extension-vscode-e2e/runner.mjs`

### Task 32.1: Req 5.1-5.4 scenario + VSIX listing has no new assets — COMPLETE

- Files: CREATE a suite file under D:/projects/ptah-extension/apps/ptah-extension-vscode-e2e/src/suite/ (name per suite convention)
- Plan reference: implementation-plan.md:890, 939, 1462
- Pattern to follow: existing `apps/ptah-extension-vscode-e2e/src/suite/index.cjs`
- Quality requirements: "Review all" opens a multi-diff; outside path refused.
- Validation notes: none.
- Implementation details: as plan.
- Outcome: executor senior-tester. `src/suite/review-commands.cjs` (+1 line in `index.cjs` to load it), 7 cases:
  commands registered; openChanges → multi-diff with `ptah-git-head:` left sides; openDiff → HEAD text left,
  working tree right; outside relative/absolute/root paths refused with 'Path is outside the workspace.' and no
  editor opened; openMerge resolves (merge editor or plain-file fallback — the built-in git extension is active,
  so the fallback is not forced deterministically); openScm runs; dist tree has no codemirror/monaco/spot-editor/
  review-canvas/review-shell assets (proxy for the VSIX listing, packaging cannot run in the host). Full runner
  17/17 against the existing dist build. Verified by the orchestrator: lint green.

### P3 checkpoint

`bundle-measurements.md` rows for Batches 20, 21, 23 present; card visual review done.

### P3 phase-end review

- [x] Phase-end review checkpoint (Review cadence): one cross-side review lane on the P3 phase diff, the full e2e set, visual review of the change-set card against `prototype/` (dark + light); findings fixed in follow-up commits before the next phase starts.
- Outcome (2026-10-02): logic — Glm part 1 (`reviews/p3-phase-review-glm.md`, REVISE 7/10: F1-F9) on the
  subagent-authored batches; subagent review of lane-authored Batch 23 (`p3-phase-review-subagent-b23.md`, REVISE
  7/10); fixes `50b48eecc` (git-ui) and `0f3953a6f` (backend + SonarCloud). Round 1 by antigravity (Glm hit its
  weekly limit) — `p3-phase-review-antigravity-round1.md`: F1-F7, F9 FIXED, new B1-B5 on Batches 29-31 (REVISE
  7/10); fixes `86b5ee6dd`. Round 2 `p3-phase-review-antigravity-round2.md`: B1-B5 FIXED, APPROVE 9/10. F8
  (SHA-256 unborn HEAD) accepted as documented. Visual — `p3-visual-review.md` REVISE 6/10 (S1 focus ring, S2
  narrow tile, S3 badge contrast + 3 moderate) → fixed in `86b5ee6dd` → `p3-visual-review-round1.md` APPROVE
  8/10 (screenshots `screenshots/p3/`, `screenshots/p3/round1/`). Accepted minors: decorative light status-chip
  accents and the light "mixed"/success accents < 3:1. e2e: Electron `change-set-card.spec.ts` passed alone; VS
  Code runner 17/17; full e2e set runs in CI (local full Electron run conflicts with the running desktop app).
  SonarCloud: reliability regexes/sort fixed in `0f3953a6f`; S4036 PATH hotspot in the VS Code e2e suite fixed by
  running git from the built-in git extension's absolute path. P2 review fixes merged in `70df63cbe`.
  Carried to P4: real-git spec for the 2 MiB review-reader limit; diff-tabs spec gaps; Electron card review/SCM
  actions only reveal the dock until Task 58.2; repo-subfolder assumption remains for apply/stage/blob reads;
  rename+commit within one turn reports the old path as `M`; jest worker-exit warning in the change-set specs;
  Pierre `<style>` vs VS Code CSP gate before Batch 44 (still open).

---

# P4 — Review canvas, spot editor (built unmounted; see "Cutover moved after P5")

### P4 waves (branch `feat/task-2026-576-p4`, worktree `.claude-worktrees/task-576-p4`, PR stacked on P3)

| Wave | Batches | Notes |
|---|---|---|
| W1 | 33 ∥ 39 ∥ CSP gate | gate: independent lane decides Pierre `<style>` vs VS Code `style-src` before 44 |
| W2 | 34 ∥ 40 | |
| W3 | 35 ∥ 41 | |
| W4 | 36 ∥ 37 ∥ 44 | 44 after the gate decision |
| W5 | 38 ∥ 42 | |
| W6 | 43 | then the P4 phase-end review |

## Batch 33: Agent-feedback port token and confirm dialog — COMPLETE

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: P3 complete
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/git-ui`

### Task 33.1: `AGENT_FEEDBACK_SENDER` token — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/core/src/lib/tokens/agent-feedback-sender.token.ts; MODIFY D:/projects/ptah-extension/libs/frontend/core/src/index.ts
- Plan reference: implementation-plan.md:949-962
- Pattern to follow: `libs/frontend/core/src/lib/tokens/file-link-opener.token.ts:32-41`
- Quality requirements: `send(target, text): Promise<{ sent; error? }>`.
- Validation notes: git-ui never imports chat.
- Implementation details: one barrel line.

### Task 33.2: `GitConfirmDialogComponent` (native `<dialog>`, no CDK) — COMPLETE

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.component.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.a11y.spec.ts
- Plan reference: implementation-plan.md:1060-1078
- Pattern to follow: `diff-view.component.ts:482-567, 1159-1181, 1784-1830`; `diff-view/diff-view-dialog.a11y.spec.ts`
- Quality requirements: ports every case of the existing a11y spec.
- Validation notes: design-spec §2 CDK line superseded (recorded conflict).
- Implementation details: inputs/outputs per plan.
- Outcome: executor frontend-developer. `AGENT_FEEDBACK_SENDER` (core, no default provider):
  `send(target: {sessionId} | 'active', text) → Promise<{sent, error?}>`, failures resolve `sent:false`.
  `GitConfirmDialogComponent` (git-ui `lib/shared/`): native `<dialog role="alertdialog">`, inputs title/description/
  confirmLabel/cancelLabel/tone (danger → `btn-error err-solid-text`, warning → `btn-warning`), outputs
  confirmed/cancelled, `open(invoker)`; Cancel focused on open, Escape/`cancel` event cancel, Tab trapped, focus
  returns to invoker, backdrop click inert, destroy-while-open closes without emitting. a11y spec 17 tests (axe
  both tones). Accepted deviations: dialog not exported from git-ui `index.ts` (all users inside git-ui); behaviour
  tests live in the a11y spec. Verified: core + git-ui typecheck/lint green, git-ui 569/569 (the existing
  `diff-view-dialog.a11y.spec.ts` axe tests time out under load, pass alone), eager guard exit 0.

## Batch 34: Chat feedback sender — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 33
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat ptah-extension-webview`

### Task 34.1: `ChatAgentFeedbackSender` provided next to `FILE_LINK_OPENER` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/agent-feedback/chat-agent-feedback-sender.service.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/index.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts
- Plan reference: implementation-plan.md:953-965
- Pattern to follow: `app.config.ts:186-196`
- Quality requirements: `sent:false` keeps drafts.
- Validation notes: A4 — read `SendMessageOptions` and the tab-switch API; record.
- Implementation details: `ChatStore.sendOrQueueMessage` (`chat.store.ts:227-232`).

## Batch 35: `ReviewDiffService` and `ReviewNavigationService` — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batches 22, 34
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui ptah-extension-webview`

### Task 35.1: Services — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-diff.service.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-navigation.service.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1024-1029
- Pattern to follow: Task 19.1 refresh logic moved verbatim; `STALE_SNAPSHOT` rules `diff-tabs.service.ts:593-607`
- Quality requirements: cache keyed `(comparison, path, origPath)`; lazy `git:diffFile` for mounted files only.
- Validation notes: same spec cases as Task 19.1.
- Implementation details: as plan.

### Task 35.2: Push routing beside `DiffTabsService` (V6) — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/services.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts
- Plan reference: implementation-plan.md:1056 (adjusted by V6)
- Pattern to follow: Task 21.1
- Quality requirements: `verify-eager-bundle` still passes.
- Validation notes: V6 — add, do not swap.
- Implementation details: `MESSAGE_HANDLERS` lists both until Task 64.1.

## Batch 36: Draft comments and hunk toolbar — PENDING

- Recommended executor: CLI lanes x 3 (one per component pair) | Fallback: frontend-developer, sequential | Mode: parallel
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 3 | Depends on: Batch 35
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 36.1: `ReviewCommentDraftStore` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/review-comment-draft.store.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1030
- Pattern to follow: root signal services in `libs/frontend/git-ui/src/lib/services/`
- Quality requirements: keyed `ownerSessionId ?? workspaceRoot`; message format path, `Lstart-Lend`, fenced lines.
- Validation notes: drafts clear only on `sent:true`.
- Implementation details: in-memory Map.

### Task 36.2: `HunkToolbarComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1017-1023
- Pattern to follow: roving tabindex `diff-view.component.ts:249-345`
- Quality requirements: branch/historical actions `aria-disabled`; refused state chip.
- Validation notes: no action on a renumbered hunk.
- Implementation details: as plan.

### Task 36.3: `DraftCommentsBarComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/draft-comments-bar.component.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1030
- Pattern to follow: design-spec.md canvas footer
- Quality requirements: "Send to agent" through `AGENT_FEEDBACK_SENDER`.
- Validation notes: none.
- Implementation details: as plan.

## Batch 37: Changed-file tree, comparison bar, stash routing — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batches 24, 33, 35
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 37.1: `ChangedFileTreeComponent` and `ComparisonBarComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/changed-file-tree.component.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1000-1011
- Pattern to follow: `changed-file-tree.ts` (reuse), `RailResizeHandleComponent`, settings at `diff-view.component.ts:1444-1495`
- Quality requirements: discard confirms (Batch 33 dialog); stacks <520 px; roving tree keyboard.
- Validation notes: RC1 behaviours from Task 7.1 ported (await, error, refresh).
- Implementation details: viewed marks key `gitReview.viewed.v1`.

### Task 37.2: Stash file diff → `ReviewNavigationService.openStashFile` — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts
- Plan reference: implementation-plan.md:1080-1090
- Pattern to follow: `git-stash.service.ts:357-398`
- Quality requirements: routing switch happens only when the review shell is mounted — gate the new route behind the same availability check Task 58.1 flips, or defer this task's wiring to Task 58.1. Executor states which.
- Validation notes: V3 (old dock still mounted).
- Implementation details: as plan.

## Batch 38: File diff section and review canvas (A9 spike) — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 36, 37
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 38.1: `FileDiffSectionComponent`, `ReviewCanvasComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1012-1016, 1038-1045
- Pattern to follow: Batch 22 host
- Quality requirements: one `IntersectionObserver`, released on destroy; labelled rows never mount Pierre; per-file scroll preserved.
- Validation notes: A9 — spike on the 200-file / 10,000-line fixture; on failure switch to Pierre `CodeView` with overlays (pre-approved in the plan) and record.
- Implementation details: as plan.

## Batch 39: `file:viewContent` sha256/bom and save contract types — COMPLETE

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: P3 complete
- Concurrency-eligible with: Batches 33-38
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers`

### Task 39.1: Read path gains `sha256`, `bom`; save params/result types — COMPLETE

- Files: MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-misc.types.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.spec.ts
- Plan reference: implementation-plan.md:1107, 1115, 1137-1138
- Pattern to follow: `FileViewContentResult` `rpc-misc.types.ts:193-217`
- Quality requirements: sha256 of raw bytes.
- Validation notes: no registry change here (V5).
- Implementation details: as plan.
- Outcome: executor backend-developer. `file:viewContent` success adds `sha256` (lowercase hex of the raw bytes,
  BOM included) and `bom` (true for UTF-8 and UTF-16 BOMs). Types `FileSaveFailureReason` (plan's seven),
  `FileSaveContentParams {path, workspaceRoot?, content, expectedSha256, overwrite?}`, `FileSaveContentResult`.
  No registry change (V5). Accepted deviation: decoder uses `ignoreBOM: true` so a second BOM survives in `content`
  (round-trip safe). For Batch 40: map `resolveForView` refusals (`unsupported-path`, `no-base-root`,
  `root-not-open`, `unreadable`) and UTF-16/binary targets onto save reasons. Noted: three git-ui spec mocks build
  view results without `sha256`/`bom` (untyped) — update with the spot-editor batch. Verified by the orchestrator:
  shared + rpc-handlers typecheck/lint green, file-view spec 28/28; agent: shared 2257, rpc-handlers 3445 passed
  (1 known `harness-skill-selection` flake).

## Batch 40: `FileEditRpcHandlers` — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 39
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`

### Task 40.1: Contained atomic save with conflict detection — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-edit-rpc.handlers.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/file-edit-rpc.schema.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/index.ts
- Plan reference: implementation-plan.md:1110-1116, 1127
- Pattern to follow: `file-view-rpc.handlers.ts:13-22, 44-56, 61-185`
- Quality requirements: temp file in same dir + rename; fixed-sentence errors; refuse create.
- Validation notes: symlink escape, rename failure keeps original, BOM re-added.
- Implementation details: resolves through `FileLinkRootPolicy.resolveForView`.

## Batch 41: `file:saveContent` registration and `fileEditor` capability — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 40
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers ptah-electron ptah-extension-vscode @ptah-extension/cli-engine` (exception (a))

### Task 41.1: Registry, capability, manifest, Electron profile, host absent lists — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts; MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/rpc-host-profile.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts
- Plan reference: implementation-plan.md:1110, 1135-1140
- Pattern to follow: `fileViewer` capability `capabilities.ts:60`; manifest `:365-367`
- Quality requirements: manifest invariant green on every host.
- Validation notes: V4, V5, A13.
- Implementation details: `file:saveContent` joins VS Code and CLI expected-absent lists.

## Batch 42: Spot editor (CodeMirror 6) — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 33, 41
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 42.1: `SpotEditorComponent` + `codemirror-setup.ts` — PENDING

- Files: MODIFY D:/projects/ptah-extension/package.json (+ lockfile; CodeMirror packages, exact versions); CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/spot-editor/codemirror-setup.ts; CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts (+ .spec.ts)
- Plan reference: implementation-plan.md:1092-1131
- Pattern to follow: `file-view.component.ts:32, 102-192`
- Quality requirements: editor chunk lazy; chat links read-only by default; Markdown preview disabled >512 KB; UTF-16 read-only.
- Validation notes: A12 CRLF round-trip spec; conflict dialog Reload default / Overwrite.
- Implementation details: languages via `LanguageDescription.matchFilename`.

## Batch 43: Review shell (Changes tab + header) — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 38, 42
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 43.1: `ReviewShellComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/project.json (only if an implicit dependency must be declared)
- Plan reference: implementation-plan.md:967-994
- Pattern to follow: `git-dock.component.ts:44-294`; `NativeTabGroupComponent` `native-tab-group.component.ts:71, 136-151`
- Quality requirements: one `ResizeObserver`; each tab body lazy; RC3 stale state ported; spec ports `git-dock.component.spec.ts` + `git-dock.mount.spec.ts` cases.
- Validation notes: V3 — Commit, Task and History tabs are added by Batches 48, 50, 56; the shell is not mounted until Batch 58, so no tab ships empty to users.
- Implementation details: header re-hosts `GitDockHeaderComponent`; banner slot above tabs.

## Batch 44: Skills drawer on `TextDiffViewComponent` — PENDING

- Recommended executor: CLI lane | Fallback: frontend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 23
- Concurrency-eligible with: Batches 33-43
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/skill-synthesis-ui`

### Task 44.1: `LazyDiffViewComponent` imports `@ptah-extension/git-ui/diff-renderer` dynamically — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.ts; CREATE D:/projects/ptah-extension/libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.spec.ts
- Plan reference: implementation-plan.md:1153, 1164
- Pattern to follow: `lazy-diff-view.component.ts:1-19, 161-184`
- Quality requirements: no static import of git-ui (spec asserts); loading/error states kept.
- Validation notes: parity §11 last row.
- Implementation details: unified only.
- Gate (2026-10-02, `reviews/gate-p4-pierre-csp.md`, independent antigravity lane, verified by the orchestrator
  against `@pierre/diffs` dist): Pierre writes Shiki HTML with `style="…"` attributes via `innerHTML`
  (`FileDiff.js:1516-1577`) and creates `<style>` nodes (`utils/hostTheme.js:14`, `createUnsafeCSSStyleNode.js:4`);
  nonces cannot cover style attributes. DECISION option (c): VS Code `style-src ${cspSource} 'unsafe-inline'
  https://fonts.googleapis.com` with the nonce REMOVED from style-src (a nonce makes browsers ignore
  'unsafe-inline'); script-src keeps its nonce, no unsafe-inline/eval. Matches the Electron renderer CSP.

### P4 phase-end review

- [ ] Phase-end review checkpoint (Review cadence): one cross-side review lane on the P4 phase diff, the full e2e set (surfaces are unmounted; their visual review happens at Batches 58-61); findings fixed in follow-up commits before the next phase starts.

---

# P5 — Workflow surfaces (built unmounted until cutover)

## Batch 45: Commit streaming backend — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: P4 complete
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core`

### Task 45.1: `OperationRegistry`, commit `onOutput`/abort, `readStagedPatch`, shared types — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-operation.registry.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.spec.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/messages/message-constants.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/messages/payload-map.ts
- Plan reference: implementation-plan.md:1214-1220, 1246-1248
- Pattern to follow: Task 1.2 `signal`/`onOutput`
- Quality requirements: registry entry deleted on settle; 256 KiB tail for `hookOutput`; staged patch capped 48 KiB with a note.
- Validation notes: no registry (`rpc.types.ts`) change here (V5).
- Implementation details: `git:operationOutput` push type.

## Batch 46: Commit-message generator — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 45
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`

### Task 46.1: `CommitMessageGenerator` on the active provider (Gate 2 default a) — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/commit-message/commit-message-generator.service.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/commit-message/commit-message-prompt.ts; MODIFY D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/tokens.ts; MODIFY D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/di/register.ts; MODIFY D:/projects/ptah-extension/libs/backend/agent-sdk/src/index.ts
- Plan reference: implementation-plan.md:1219-1224, 1238-1242
- Pattern to follow: `sdk-internal-query.curator-llm.ts:53-141, 229-255, 417-443`
- Quality requirements: discriminated result, never `''`; 45 s abort; `USER_ACTION_QUERY_LANE`.
- Validation notes: `ProviderAuthError` rides active provider; `ProviderQuotaError` → `rate-limited`.
- Implementation details: as plan.

## Batch 47: `GitWorkflowRpcHandlers` — commit stream, cancel, generate — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 46
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers ptah-electron ptah-extension-vscode @ptah-extension/cli-engine`

### Task 47.1: Handler class, schema, registry, manifest — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts (+ .spec.ts); CREATE D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.schema.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts; MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/index.ts
- Plan reference: implementation-plan.md:1214-1218, 1225, 1243-1245
- Pattern to follow: `git-rpc.schema.ts`; Task 27.1
- Quality requirements: throttle ≤1 push/100 ms, ≤16 KiB per push; `git:commit` accepts `operationId` (existing handler forwards it — if that edit lands in `git-rpc.handlers.ts`, it replaces `handlers/index.ts` in the file count, reported).
- Validation notes: V5, A14.
- Implementation details: `git:cancelOperation`, `git:generateCommitMessage` (renderer timeout 75 s).

## Batch 48: Commit composer UI + shell Commit tab — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 43, 47
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 48.1: `CommitComposerComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/commit/commit-composer.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts (+ its spec)
- Plan reference: implementation-plan.md:1207-1213, 1229-1234
- Pattern to follow: Task 7.1 RC1 behaviour (parity rows `parity-inventory.md:64-65`)
- Quality requirements: log `role="log" aria-live="polite"`; Commit disabled without staged files or message; Cancel while running; generation failure keeps field editable.
- Validation notes: nothing commits without Commit; no provider call without a click.
- Implementation details: as plan.

## Batch 49: PR status reader and `git:prStatus` — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batch 47
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/rpc-handlers` (3 libs: registry must ship with the handler, V5 — exception (a))

### Task 49.1: `GitHubPrStatusReader` + facade delegate — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts
- Plan reference: implementation-plan.md:1261-1271, 1283-1286
- Pattern to follow: spawner injection `git-info.service.ts:356-371`
- Quality requirements: non-interactive env; 15 s timeout; 60 s cache per `(root, branch)`.
- Validation notes: A10 — defensive parse; each unavailable reason quiet.
- Implementation details: argv `gh pr view --json ... -- <branch>` after `assertSafeRef`.

### Task 49.2: `git:prStatus` in the workflow handler — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts (+ spec); MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts
- Plan reference: implementation-plan.md:1272
- Pattern to follow: Task 47.1
- Quality requirements: backend resolves the branch itself.
- Validation notes: V5.
- Implementation details: as plan.

## Batch 50: Worktree/PR task view UI + shell Task tab — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 49
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 50.1: `TaskWorktreeViewComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/task/task-worktree-view.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts (+ its spec)
- Plan reference: implementation-plan.md:1254-1260, 1279-1280
- Pattern to follow: `worktree-section.component.ts` behaviours (parity `parity-inventory.md:49-57, 85-92`)
- Quality requirements: row switch buttons with sibling Remove (no nested buttons); one component-owned timer, cleared on hide/destroy; "Open PR" only `https:`.
- Validation notes: spec ports every `worktree-section.component.spec.ts` case used as successor in parity.
- Implementation details: as plan.

## Batch 51: Conflict operation backend — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 49
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core`

### Task 51.1: Abort/continue (re-detected server-side) and `materializeConflictStages` — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.operation-actions.real-git.spec.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-misc.types.ts
- Plan reference: implementation-plan.md:1298-1307, 1316, 1321-1329
- Pattern to follow: Task 16.1 `readRepoOperation`
- Quality requirements: under write lock with hook timeout; `GIT_EDITOR=true` for continue; stage files removed when the operation ends.
- Validation notes: kind never taken from the client.
- Implementation details: as plan.

## Batch 52: Editor merge launcher — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 51
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/platform-electron`

### Task 52.1: `IEditorLauncher.openMergeTool?`, `mergeArgs`, Electron implementation, real spec — PENDING

- Files: MODIFY the `IEditorLauncher` file under D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/ (locate with grep); MODIFY D:/projects/ptah-extension/libs/backend/platform-core/src/utils/editor-launcher-detection.ts; MODIFY D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-editor-launcher.ts (+ spec); CREATE D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/editor-merge.real.spec.ts
- Plan reference: implementation-plan.md:1303-1313, 1325-1328
- Pattern to follow: `editor-launcher-detection.ts:218-228, 342-356, 550-568`
- Quality requirements: never `shell: true`; Windows `.cmd` shim through the existing path.
- Validation notes: A11 — only targets declaring `mergeArgs`.
- Implementation details: fake `code.cmd` shim records argv.

## Batch 53: Conflict and history RPCs — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batch 52
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode` (exception (a))

### Task 53.1: `git:operationAbort/Continue` and `editor:openMerge` — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts (+ spec); MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts (+ spec); MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts
- Plan reference: implementation-plan.md:1298-1307, 1323-1324
- Pattern to follow: `editor-rpc.handlers.ts:50-79`
- Quality requirements: sanitized errors.
- Validation notes: V4 — if `editor:openMerge` sits under `editorLauncher` and CLI/TUI lack it, add it to `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` expected-absent (6th file).
- Implementation details: as plan.

### Task 53.2: Checked by A11 evidence from Batch 52 — PENDING

- Depends on: Task 53.1
- File: none authored; the report quotes Batch 52's A11 result and confirms the handler only offers merge for `mergeArgs` targets
- Plan reference: implementation-plan.md:155
- Pattern to follow: n/a
- Quality requirements: n/a
- Validation notes: A11
- Implementation details: n/a

## Batch 54: Conflict banner UI + shell banner slot — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 50, 53
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 54.1: `ConflictBannerComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/conflict/conflict-banner.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts (+ its spec)
- Plan reference: implementation-plan.md:1292-1297, 1315
- Pattern to follow: design-spec §11
- Quality requirements: Abort confirms (Batch 33 dialog); Continue only when no conflicted paths; delete/modify, symlink, submodule → "Open folder".
- Validation notes: "Ask agent" via `AGENT_FEEDBACK_SENDER` (`'active'`).
- Implementation details: as plan.

## Batch 55: History reader and `git:log` — PENDING

- Recommended executor: backend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 2 | Depends on: Batch 53
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/rpc-handlers` (registry with handler, V5 — exception (a))

### Task 55.1: `GitHistoryReader` + facade delegate — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-history.reader.ts; CREATE D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-history.reader.real-git.spec.ts; MODIFY D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts; MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc/rpc-git.types.ts
- Plan reference: implementation-plan.md:1341-1357
- Pattern to follow: `--end-of-options` `git-review-reader.service.ts:291`
- Quality requirements: base resolution order; ≤200 commits.
- Validation notes: no own commits, detached HEAD, `origin/HEAD` absent.
- Implementation details: as plan.

### Task 55.2: `git:log` handler — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts (+ spec); MODIFY D:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts
- Plan reference: implementation-plan.md:1341, 1356-1357
- Pattern to follow: Task 49.2
- Quality requirements: n/a beyond plan.
- Validation notes: V5.
- Implementation details: as plan.

## Batch 56: History timeline UI + shell History tab — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batches 54, 55
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui`

### Task 56.1: `HistoryTimelineComponent` — PENDING

- Files: CREATE D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/history/history-timeline.component.ts (+ .spec.ts); MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts (+ its spec)
- Plan reference: implementation-plan.md:1335-1340, 1350
- Pattern to follow: stash popover behaviours (parity `parity-inventory.md:103-111`)
- Quality requirements: drop confirms; root commit "Initial commit — open in editor"; empty state copy.
- Validation notes: none.
- Implementation details: select → `ReviewNavigationService.openHistorical(sha)`.

## Batch 57: CI — editor merge spec in the OS matrix — PENDING

- Recommended executor: devops-engineer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 52
- Verification: workflow lint as in Batch 8

### Task 57.1: Add `editor-merge.real.spec.ts` run to `git-real-git` — PENDING

- File: MODIFY D:/projects/ptah-extension/.github/workflows/ci.yml
- Plan reference: implementation-plan.md:1313
- Pattern to follow: Task 8.1
- Quality requirements: runs on all three OSes.
- Validation notes: project name `@ptah-extension/platform-electron`.
- Implementation details: `--testPathPattern=editor-merge.real`.

### P5 phase-end review

- [ ] Phase-end review checkpoint (Review cadence): one cross-side review lane on the P5 phase diff, the full e2e set (surfaces are unmounted; their visual review happens at Batches 58-61); findings fixed in follow-up commits before the next phase starts.

---

# Cutover — mount, parity, deletion, Monaco removal (runs after P5; V3)

## Batch 58: Mount switch and file-link routing — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope; visual-reviewer on every new surface against `prototype/` (dark + light)
- Tasks: 2 | Depends on: Batches 44, 48, 50, 54, 56
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat ptah-extension-webview`

### Task 58.1: `electron-shell.component.ts` mounts `ReviewShellComponent` — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts
- Plan reference: implementation-plan.md:969-994
- Pattern to follow: `electron-shell.component.ts:366-392`
- Quality requirements: Retry on chunk failure (`dockLoadFailed`); arming identity assertions retargeted.
- Validation notes: V3; Task 37.2 routing activates here if it was deferred.
- Implementation details: `m.ReviewShellComponent`.

### Task 58.2: Links and card actions to `ReviewNavigationService` — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/file-link-router.service.ts (+ spec); MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts (+ spec)
- Plan reference: implementation-plan.md:870, 1122, 1141
- Pattern to follow: `file-link-router.service.ts:94-137`
- Quality requirements: dynamic import of git-ui only.
- Validation notes: Task 30.1 validation note.
- Implementation details: `openFile(path, line?)`, `openChangeSet(...)`.

## Batch 59: E2E successors I — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 58
- Verification: `npx nx run-many -t lint,typecheck -p ptah-electron-e2e` + `npx nx e2e ptah-electron-e2e --grep "git"` scoped to these specs (tail)

### Task 59.1: axe helper, dock/shell, hunk specs — PENDING

- Files (under D:/projects/ptah-extension/apps/ptah-electron-e2e/src/): CREATE `support/axe.ts`; MODIFY `specs/git/git-dock.spec.ts`, `specs/git/hunk-apply-real-rpc.spec.ts`, `specs/git/hunk-widget-mouse.spec.ts`, `specs/git/glyph-margin-visual.spec.ts`, `specs/git/hunk-revert-top-layer.spec.ts`
- Plan reference: implementation-plan.md:1043, 1058
- Pattern to follow: `apps/ptah-landing-page-e2e/src/support/axe.ts`
- Quality requirements: axe dark + light, no critical/serious.
- Validation notes: successor tests referenced by `parity-tests.md`.
- Implementation details: as plan.

## Batch 60: E2E successors II — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 59
- Verification: as Batch 59

### Task 60.1: state, controls, rail, perf, large canvas, comments — PENDING

- Files (under D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/): MODIFY `diff-view-state.spec.ts`, `git-review-controls.spec.ts`, `git-rail-collapse.spec.ts`, `perf-m1-diff-redisplay.spec.ts`; CREATE `review-canvas-large.spec.ts`, `review-comments.spec.ts`
- Plan reference: implementation-plan.md:1039, 1043-1044
- Pattern to follow: existing specs in the folder
- Quality requirements: ≥50 fps, no long task >200 ms on the 200-file/10,000-line fixture (recorded).
- Validation notes: A9 result confirmed.
- Implementation details: as plan.

## Batch 61: E2E successors III — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 60
- Verification: as Batch 59

### Task 61.1: file view, links, spot-editor save, commit composer, worktree view — PENDING

- Files (under D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/): MODIFY `file-view-tab.spec.ts`, `agent-file-links.spec.ts`; CREATE `spot-editor-save.spec.ts`, `commit-composer.spec.ts`, `task-worktree-view.spec.ts`
- Plan reference: implementation-plan.md:1128-1129, 1235, 1281
- Pattern to follow: existing specs in the folder
- Quality requirements: hook prints three lines over 2 s, all arrive before completion.
- Validation notes: none.
- Implementation details: as plan.

## Batch 62: Parity matrix — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent) — cross-check rows against `parity-inventory.md` and the OLD surface at 722d921ab
- Tasks: 1 | Depends on: Batch 61
- Verification: every `keep`/`move` row maps to a passing test (file:line); the 4 approved removals listed

### Task 62.1: `parity-tests.md` — PENDING

- File: CREATE D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/parity-tests.md
- Plan reference: implementation-plan.md:1178-1194
- Pattern to follow: `parity-inventory.md` section order
- Quality requirements: any row without a green test blocks Batches 63-66.
- Validation notes: R10.
- Implementation details: run `nx run-many -t test,lint,typecheck -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/skill-synthesis-ui ptah-extension-webview` and the Electron e2e `specs/git/*`; record results.

## Batch 63: WorkspaceCoordinator swap — PENDING

- Recommended executor: CLI lane | Fallback: frontend-developer | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 62
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`

### Task 63.1: Resolve `ReviewDiffService`/`GitReviewService` from the new surface — PENDING

- Files: MODIFY D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts (+ spec)
- Plan reference: implementation-plan.md:1190, 1198
- Pattern to follow: `workspace-coordinator.service.ts:117-129`
- Quality requirements: must land before Batch 64 deletes `DiffTabsService`.
- Validation notes: none.
- Implementation details: as plan.

## Batch 64: Old-surface deletion and barrel rewrite — PENDING

- Recommended executor: frontend-developer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 63
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/git-ui ptah-extension-webview @ptah-extension/chat`

### Task 64.1: Delete old git-ui files; rewrite barrel; drop `DiffTabsService` routing (V6) — PENDING

- Files: DELETE the files listed at implementation-plan.md:1183-1187 under D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/ (exception (b)); REWRITE D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts; MODIFY D:/projects/ptah-extension/libs/frontend/git-ui/src/services.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts
- Plan reference: implementation-plan.md:1178-1199
- Pattern to follow: CONVENTIONS.md §3
- Quality requirements: barrel ≤150 lines; doc comment "depends on core, shared, ui and markdown — never on chat"; keep `rail-resize-handle.*`, `git-dock-header.*`, `changed-file-tree.ts`.
- Validation notes: only the 4 approved removals lack successors.
- Implementation details: move still-used types out of `types/diff-tab.types.ts` first.

## Batch 65: Monaco dependency and provider removal — PENDING

- Recommended executor: devops-engineer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 64
- Verification: `npx nx run-many -t typecheck,test,lint,build -p ptah-extension-webview` + `verify-eager-bundle`

### Task 65.1: Remove Monaco packages, provider, asset glob; set `statsJson` (A8) — PENDING

- Files: MODIFY D:/projects/ptah-extension/package.json (+ lockfile); MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/src/app/app.config.ts; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/project.json; MODIFY D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore
- Plan reference: implementation-plan.md:1148-1150, 1155
- Pattern to follow: n/a
- Quality requirements: no `assets/monaco` in `dist/apps/ptah-extension-webview`.
- Validation notes: A8 — inspect `stats.json` for `outputs[].inputs`; record.
- Implementation details: remove `overrides.monaco-editor`.

## Batch 66: Packaging — PENDING

- Recommended executor: devops-engineer | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): CLI lane, logic scope
- Tasks: 1 | Depends on: Batch 65
- Verification: `npx nx run-many -t test -p ptah-electron` (packaged-deps spec) + VSIX package listing

### Task 66.1: Electron-only chunk list, VSIX filter, packaged-deps assertions — PENDING

- Files: MODIFY D:/projects/ptah-extension/apps/ptah-electron/src/config/packaged-deps.spec.ts; MODIFY D:/projects/ptah-extension/apps/ptah-electron/scripts/prune-dist-deps.js; MODIFY D:/projects/ptah-extension/apps/ptah-electron/scripts/copy-renderer.js (comment only); MODIFY D:/projects/ptah-extension/scripts/copy-webview.js; MODIFY D:/projects/ptah-extension/apps/ptah-extension-webview/scripts/assert-eager-bundle.mjs
- Plan reference: implementation-plan.md:1151-1158, 1162-1165
- Pattern to follow: `packaged-deps.spec.ts:131-132`
- Quality requirements: only chunks whose every input is Electron-only are dropped; Pierre chunks kept.
- Validation notes: R12.
- Implementation details: `electron-only-chunks.json`.

## Batch 67: Final bundle, TTI and VSIX evidence — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 66
- Verification: the rows below recorded

### Task 67.1: `bundle-measurements.md` end rows — PENDING

- File: MODIFY D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/bundle-measurements.md
- Plan reference: implementation-plan.md:1473-1479
- Pattern to follow: Batch 20 rows
- Quality requirements: `main.js` gz ≤ baseline; TTI second boot ≤ baseline; VSIX has no `@codemirror` chunk; skills diff drawer opens in VS Code (R12).
- Validation notes: R12.
- Implementation details: n/a

## Batch 68: Axe sweep on VS Code card and review surfaces — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane with image input | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): visual-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 67
- Verification: axe report dark + light for shell, canvas, spot editor, composer, task view, banner, history, card

### Task 68.1: Axe evidence — PENDING

- File: evidence under D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/screenshots/axe/
- Plan reference: implementation-plan.md:1437, 1471
- Pattern to follow: Batch 59 axe helper
- Quality requirements: no critical/serious.
- Validation notes: none.
- Implementation details: n/a

## Batch 69: Task-wide scoped verification — PENDING

- Recommended executor: senior-tester | Fallback: CLI lane | Mode: sequential
- Reviewer (phase-end scope, see Review cadence): code-logic-reviewer (subagent)
- Tasks: 1 | Depends on: Batch 68
- Verification: `npx nx run-many -t typecheck,test,lint -p <projects changed on the branch>` (list from `git diff --name-only main`), tailed

### Task 69.1: Final run and allowlist diff — PENDING

- File: none authored; evidence in the report
- Plan reference: implementation-plan.md:1586-1596
- Pattern to follow: n/a
- Quality requirements: `command:execute` allowlist unchanged (diff of `command-rpc.handlers.ts:29, 35-40`); manifest invariant green.
- Validation notes: all risks above have a recorded resolution.
- Implementation details: n/a

### Cutover phase-end review

- [ ] Phase-end review checkpoint (Review cadence): one cross-side review lane on the Cutover phase diff, the full e2e set, visual review of every mounted surface against `prototype/` (dark + light); findings fixed in follow-up commits before the next phase starts.
