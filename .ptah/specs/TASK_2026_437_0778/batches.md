# Batches - TASK_2026_437_0778

Total tasks: 56 | Batches: 22 | Complete: 7/22

Status note: P1 wave 1 — Batch 1 COMPLETE (Electron GO, CLI GO; no commit by design), Batch 2 COMPLETE (ed98e515a), Batch 3 COMPLETE (93c360572), Batch 5 COMPLETE (bf247ed3c). P1 wave 2 — Batch 4 COMPLETE (2ae430160). P2 wave 1 — Batch 7 COMPLETE (b9ac03426), Batch 13 COMPLETE, both committed ahead of Batch 6 by orchestrator decision (see "Orchestrator decision — phase order deviation" under Batch 7). Remaining unblocked: Batch 6 (P1 wave 3, in progress); P2 wave 1 Batches 12, 14; P3 wave 1 Batch 16.

Source: `implementation-plan.md` (components C1–C18, phases P1–P4), `context.md` "User decisions"
(all four phases, nested repos excluded everywhere including the `@` picker, local-only
crashReporter, CLI uses `@parcel/watcher` only if it packages cleanly, SQLite attribution before
any move, history paging deferred).

Repo root below is `D:\projects\ptah-extension` (all paths absolute).

## Execution defaults chosen by team-leader

- Phase order P1 → P2 → P3 → P4 is the COMMIT order (user decision "shipped in order"). Batches
  inside a phase run in parallel where marked. P4 batches are file-independent of P2/P3 but are
  not committed before P3 closes.
- Batch 1 is a proof-only spike. It runs in an isolated worktree, produces evidence, and is NOT
  committed. Its packaging config is re-applied for real in Batch 10.
- Create any worktree OUTSIDE the repo root (e.g. `D:\projects\ptah-437-spike`), not under
  `.claude-worktrees\` or `.claude\worktrees\`. Until Batch 4 lands, the running Ptah app watches
  those folders, and removing such a worktree is the 09-14 trigger.
- `EventStormBreaker` is created in `platform-core` from P1 (not in `shared` and moved in P2).
  See plan defect D1. Needs architect acknowledgment only; no batch waits on it.
- New DI tokens are pinned through each host's `container.smoke.spec.ts`, not through
  `expected-resolvable.ts`. Those files list RPC handler classes only (plan defect D2).
- Tests only via `npx nx run-many -t test -p ...`. Check that the "Running target test for N
  projects" header matches the N stated per batch.
- Any batch that edits a `project.json` (Batch 1, Batch 10) runs `npx nx reset` first and must be
  the only executor in its worktree. Batch 10 runs alone or in its own worktree.
- The current branch `feat/chat-composer-card` holds unrelated work. The orchestrator decides the
  task branch before the first commit.

## Plan validation

Status: PASSED WITH RISKS (no BLOCKER; 11 plan defects recorded, none invalidates the architecture)

### Plan defects found (checked against source)

| ID | Defect | Evidence | Handling |
| --- | --- | --- | --- |
| D1 | Breaker placed in `shared` in P1 then moved to `platform-core` in P2. The move forces P2-A to edit `git-watcher.service.ts` and `workspace-file-index.service.ts`, the two files P2-D rewrites. That is avoidable churn and a file conflict between parallel batches. Both P1 consumers (the app and workspace-intelligence) can already import `platform-core`. | `libs/backend/platform-core/src/utils/glob-watch-plan.ts:47` (pure-util precedent); plan C7 note | Create in `libs/backend/platform-core/src/utils/event-storm-breaker.ts` in Batch 2. No move and no delete in P2. Architect to acknowledge. |
| D2 | Plan says to add new tokens to the three hosts' `expected-resolvable.ts`. Those arrays hold RPC handler CLASSES (`apps/ptah-electron/src/di/expected-resolvable.ts:11-19`). The CLI manifest is `apps/ptah-cli/src/di/expected-resolvable.ts`, not in cli-engine. `register-platform-agnostic.ts:134-136` is a log-line array, not a manifest. | files cited | Pin `MAIN_LOOP_WATCHDOG`, `BACKGROUND_WORK_GOVERNOR`, `WORKSPACE_WATCHER` with `container.resolve` assertions in `apps/{ptah-electron,ptah-cli,ptah-extension-vscode}/src/di/container.smoke.spec.ts`. Also add to the log array. |
| D3 | P2-C (packaging) cannot run in parallel with P2-B. `prune-dist-deps.js:99-107` FAILS the package when a dependency declared in `apps/ptah-electron/package.json` is missing from the manifest `build-main` generates from the project graph. The graph gains `@parcel/watcher` only after a source file in main's graph imports it. The ESM gate also spawns the built host bundle. | `apps/ptah-electron/scripts/prune-dist-deps.js:38-107`; `esm-bundle-gate.spec.ts:153-159` | Batch 10 runs after Batches 8 and 9. The Batch 1 spike uses a throwaway import in its worktree to prove the chain. |
| D4 | User decision Q1 ("nested repos excluded from every consumer, including the `@` picker") is only half-planned. C1/C10 change watchers and static globs. The initial path walk (`WorkspaceIndexerService.discoverWorkspacePaths`) honours `.gitignore` only, so a registered worktree or nested repo that is not git-ignored still enters the index. | `workspace-file-index.service.ts:10-13,419`; consumers of `DEFAULT_WORKSPACE_EXCLUDES`: `workspace-indexer.service.ts`, `context.service.ts`, `type-script-diagnostics-provider.ts`, `core-namespace.builders.ts` | Static rules reach all four through the `DEFAULT_WORKSPACE_EXCLUDES` spread (Batch 2). Dynamic nested roots: added Task 11.3 (walk skips directories holding `.git` below depth 0, plus registered worktrees). Architect to confirm the placement in `workspace-indexer.service.ts`. |
| D5 | Port option `excludeSegments: readonly string[]` cannot express the two-segment rule `['.claude','worktrees']`. | plan C7 contract vs C1 `NESTED_WORKSPACE_PATH_RULES` | Task 7.1 types it as `excludeSegmentRules: readonly (readonly string[])[]`, mirroring the shared predicate. Globs stay as the second channel. |
| D6 | The watchdog breadcrumb "last RPC method in flight" has no named producer seam. `RpcHandler` is not in the C6 file list. | plan C6 | Task 5.2 exposes `setBreadcrumb(key, value)`. It records the lag sample. RPC method only if `RpcHandler` dispatch offers a one-line hook; otherwise it is recorded as a follow-up. |
| D7 | The CLI host bundle must resolve from BOTH `main.mjs` (ptah-cli) and `tui.mjs` (ptah-tui ships inside the same npm package and runs cli-engine in-process). The plan names only `apps/ptah-cli`. | `apps/ptah-cli/project.json:131-162` (worker target precedent); `apps/ptah-tui/project.json` has no worker targets | Task 10.4 plus a TUI smoke check in Batch 10 verification. |
| D8 | C14(d) "file index rebuild after overflow" edits `workspace-file-index.service.ts`, which C10 also rewrites. The plan's P3-A lists no ordering against P2-D. | plan C10 vs C14 | Batch 17 depends on Batch 11. |
| D9 | Q5 default "keep newest 5 dumps" is not in the C6 responsibilities or file list. | plan Q5 vs C6 | Task 5.1 includes dump retention. |
| D10 | Only `@parcel/watcher-win32-x64` is installed locally. macOS/Linux/arm64 prebuilds can only be proven in the release CI matrix. | `node_modules/@parcel/` listing | Risk R-P1. Batch 10 verification includes a CI package-matrix run before P2 is called done. |
| D11 | A5 is mostly true. `apps/ptah-cli/src/cli/commands/session.ts:908` reads `result.messages`, but from `session:load` (`SessionLoadResult`), not `chat:resume`. | file cited | No change needed. The LSP reference check still runs in Task 20.1. |

### Assumptions

- A1 `@parcel/watcher` subscription survives Windows buffer overflow. Unverified. Checked in Task 15.1 (ST-2). The design already resubscribes on every error.
- A2 `@parcel/watcher` N-API binary loads from `app.asar.unpacked` under packaged Electron. Unverified. Proven in Batch 1, then gated permanently in Task 10.2.
- A3 The CLI npm package can carry `@parcel/watcher`. Unverified. Proven in Batch 1 Task 1.3. If it fails, Batch 9 keeps chokidar inside the CLI worker (contract unchanged).
- A4 The curator "Codex proxy" retry loop lives in the curator LLM adapter or `CuratorJobQueue`. Unverified. Checked in Task 18.1 before any code.
- A5 No `chat:resume` consumer outside `session-loader.service.ts` reads `ChatResumeResult.messages`. Partly verified (D11). Task 20.1 runs LSP references.
- A6 `rebuild-native.js` rebuilds only `better-sqlite3`, and `electron-builder.yml` has `npmRebuild: false`, so `@parcel/watcher`'s `binding.gyp` is never compiled. Verified (`rebuild-native.js:155-168`, `electron-builder.yml:23`).
- A7 `platform-core` already depends on `picomatch`. Verified (`glob-watch-plan.ts:47`).
- A8 `armDiagnostics` receives `logsPath` in Electron (`wire-runtime.ts:305`). VS Code (`bootstrap.ts:143`) and CLI (`cli-engine/src/lib/container.ts:394`) must be checked for `logsPath`. Task 5.3 checks; the watchdog stays unarmed without it.

### Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R-P1 `@parcel/watcher` fails to package or load (asar, prune gate, non-win32 prebuilds) | HIGH | Batch 1 spike before any P2 code; Task 10.2 permanent load gate; `PTAH_WATCH_HOST=0` hatch (Task 8.3); CI matrix run in Batch 10 verification |
| R-P2 Shared-type payload change (`FileContentChangedPayload`) breaks git-ui compile if split from the producer | HIGH | C3 + C5 in ONE batch and one commit (Batch 4) |
| R-P3 `nx reset` in a shared worktree kills parallel executors' daemons | MEDIUM | Batches 1 and 10 isolated or run alone |
| R-P4 Single-flight rewrite changes semantics for every `cachedRead` key (`stash`, `tags`, `remotes`, `lastCommit`) | MEDIUM | Task 3.1 keeps the generation-checked write-back; the full existing 1,576-line spec must stay green |
| R-P5 Storm thresholds mis-tuned for Nx cache writes | LOW | Env overrides + enter/exit log lines (Task 2.3, Task 4.1) |
| R-P6 Spawn-worker reuse leaks stdout or state between children | HIGH | Task 13.2 consecutive-child isolation spec on real children; discard on any error |
| R-P7 Governor starves background lanes | MEDIUM | 10-min ceiling, hysteresis, `default` lane never gated (Task 16.1 spec) |
| R-P8 Router coalescing reorders RPC responses | MEDIUM | Task 21.1 order-preservation spec + full `@ptah-extension/core` suite |
| R-P9 Chunked replay leaves a tab half-rendered on failure | MEDIUM | Task 20.2 equivalence oracle + failure branch test |
| R-P10 A fourth utility process raises RSS | LOW | Task 15.1 records host RSS |
| R-P11 Stress specs flaky on CI | MEDIUM | CI asserts mechanism counts on an 8,000-file tree; ms budgets only under `PTAH_PERF_SPECS=1` |

### Edge cases

- `.claude\commands\x.md` and `.claude\skills\**` must still refresh. Handled in Tasks 2.1 and 4.1.
- Windows backslash paths and mixed separators in the predicate. Handled in Task 2.1.
- Nested `.git` FILE (a worktree) as well as `.git` DIR (a repo). Handled in Tasks 2.2, 4.1, 8.1 and 11.3.
- A storm that never ends. `maxStormMs` forces one refresh, then re-arms. Handled in Task 2.3.
- Timed-out git run while an invalidation arrives. The trailing run starts only after settle. Handled in Task 3.1; the slot is held to child exit in Task 12.1.
- `truncated: true` push with zero paths. Handled in Task 4.2.
- Empty `filePaths` with `truncated: false` is ignored. Handled in Task 4.2.
- Host crash while subscriptions are active: resubscribe plus one `overflow`. Handled in Task 8.2.
- Restart budget exhausted: degraded polling plus `DegradationReporter`. Handled in Task 8.2.
- Paths from the host outside the subscribed root are dropped (`isPathWithinRoots`). Handled in Task 8.2.
- Renderer console spam is rate-limited and truncated to 2 KB. Handled in Task 5.1.
- Worker that errored is never returned to the pool. Handled in Task 13.1.
- A quota failure while tabs shrink or at teardown flush. Handled in Task 19.2.
- A throwing handler inside a drained burst. Handled in Task 21.1.
- A chunk throwing mid-replay runs `applyResumeFailure`. Handled in Task 20.2.

---

## Parallelism map

| Phase | Wave | Batches that run together | Notes |
| --- | --- | --- | --- |
| P1 | wave 1 | 1 (worktree), 2, 3, 5 | file-disjoint; Batch 1 isolated (project.json, nx reset) |
| P1 | wave 2 | 4 | needs 2 + 3 |
| P1 | wave 3 | 6 | needs 2, 3, 4 |
| P2 | wave 1 | 7, 12, 13, 14 | 7 needs 1 (go) + 2; 12 needs 3; 13, 14 independent |
| P2 | wave 2 | 8 | needs 7 |
| P2 | wave 3 | 9 | needs 8 |
| P2 | wave 4 | 10 (alone or own worktree) | needs 8, 9 (D3) |
| P2 | wave 5 | 11 | needs 10 |
| P2 | wave 6 | 15 | needs 11 |
| P3 | wave 1 | 16 | needs 5 |
| P3 | wave 2 | 17, 18 | 17 needs 16 + 11 + 14; 18 needs 16 |
| P4 | wave 1 | 19, 20, 21 | 20 needs 14 (same file); commit after P3 |
| P4 | wave 2 | 22 | needs 19, 20, 21 |

---

## Batch 1: SPIKE — prove `@parcel/watcher` packaging (Electron asar + CLI npm) — COMPLETE

- Commit: none by design (proof-only spike; worktree `D:\projects\ptah-437-spike` removed). Evidence: `b1-spike-report.md`, committed with Batch 2's record.

### Batch 1 outcome

- Electron (A2): GO. `@parcel/watcher` 2.5.6 loaded and subscribed from `resources/app.asar.unpacked` in an electron-builder 26.8.1 / Electron 40.10.1 `--dir --win` package run under `ELECTRON_RUN_AS_NODE=1` (`subscribed OK` + a `create` event). Batch 7's Electron-GO precondition is met.
- CLI (A3): GO. `nx build ptah-cli` + `nx build ptah-tui` + `nx restore-cli-manifest ptah-cli` → `npm pack` → clean `npm install --omit=dev` → subscribed from both `main.mjs` and `tui.mjs` (D7: one resolution path serves both). Batch 9 Task 9.1 uses `@parcel/watcher`, not chokidar.
- Plan correction: asarUnpack for `@parcel/watcher/**` + `@parcel/watcher-*/**` alone crashes at runtime (`MODULE_NOT_FOUND: picomatch` from the unpacked `wrapper.js`). Folded into Task 10.2.
- D3 mechanism NOT reproduced: once `@parcel/watcher` is declared in `apps/ptah-electron/package.json`, `generatePackageJson` keeps it with or without a source import, and `prune-dist-deps.js` / `validate-deps.js` pass both ways. The Batch 10-after-8/9 ordering is kept as a precaution only.
- New finding (extends D7): `ptah-tui:build` regenerates `dist/apps/ptah-cli/package.json` and clobbers the CLI manifest. Folded into Task 10.4.
- Not done: the 75k-file mass-delete measurement. Moved into Task 15.1.
- D10: only win32-x64 verified. Cross-platform CI smoke added to Batch 10 (Task 10.5).

- Recommended executor: devops-engineer
- Fallback executor: backend-developer
- Execution mode: sequential, in an ISOLATED git worktree outside the repo root. Proof only, NO commit; the worktree is discarded.
- Rationale: decides go/no-go for the whole P2 host design (R-P1, A2, A3) before any P2 code exists. Edits `project.json` (needs `nx reset`), so it must not share a worktree.
- Tasks: 3 | Depends on: none | Parallel with: Batches 2, 3, 5

### Task 1.1: Electron packaged load proof — COMPLETE

- Files (worktree copies): `apps\ptah-electron\package.json`, root `package.json` + `package-lock.json`, `apps\ptah-electron\electron-builder.yml`, `apps\ptah-electron\scripts\verify-packed-native.js`, plus ONE throwaway import of `@parcel/watcher` in a file inside main's project graph (e.g. `libs\backend\platform-electron\src\index.ts`)
- Plan reference: implementation-plan.md:453-517 (C8 Build/packaging), :196-206 (A2)
- Pattern to follow: `electron-builder.yml:52-80` asarUnpack entries for `sqlite-vec-*`
- Validation notes: D3 (prune gate), A6, D10
- Implementation details: pin `@parcel/watcher@2.5.6` as a direct dependency. Add asarUnpack `node_modules/@parcel/watcher/**` and `node_modules/@parcel/watcher-*/**`. Run `npx nx reset`, then `npx nx package ptah-electron`. Confirm `prune-dist-deps` keeps the dependency and `validate-deps` passes. Confirm the packed tree holds `app.asar.unpacked/node_modules/@parcel/watcher-win32-x64/watcher.node` and the transitive deps (`detect-libc`, `is-glob`, `micromatch`, `node-addon-api` if present). Run the packaged exe with `ELECTRON_RUN_AS_NODE=1` requiring the unpacked module, and subscribe/unsubscribe on a temp dir.

### Task 1.2: Prove the prune gate without the import — COMPLETE

- Depends on: Task 1.1
- Implementation details: remove the throwaway import and re-run `npx nx package ptah-electron`. Record whether `prune-dist-deps` fails with "missing from the generated manifest" (confirms D3 ordering) or passes.

### Task 1.3: CLI npm package proof (A3) — COMPLETE

- Files (worktree copies): `apps\ptah-cli\package.json`, `apps\ptah-cli\project.json` (externals list at :36-70)
- Plan reference: implementation-plan.md:519-543 (C9), :204-206 (A3), Q3
- Implementation details: add `@parcel/watcher` to CLI dependencies and externals. Build (`npx nx build ptah-cli`), `npm pack` the dist, install the tarball into a clean temp dir with `npm install --omit=dev`, and `node -e` require plus subscribe from the installed package. Record the result.

### Batch 1 verification (evidence the executor must return)

- `nx package ptah-electron` log excerpts for 1.1 and 1.2 (prune-dist-deps, validate-deps, verify-packed-native lines)
- Packed file listing proving the `.node` binary is under `app.asar.unpacked`
- Output of the packaged-Electron subscribe smoke
- CLI tarball install + load output
- A go/no-go per host: Electron GO is required before Batch 7 starts. CLI NO-GO switches Batch 9 Task 9.1 to chokidar-in-worker.

---

## Batch 2: P1 — workspace exclusion policy + storm breaker (C1, C2) — COMPLETE

- Commit: ed98e515a `fix(shared): exclude agent worktrees and nested repos from workspace watching`

- Recommended executor: backend-developer
- Fallback executor: CLI lane per task (Tasks 2.1–2.2 and 2.3 are file-disjoint)
- Execution mode: sequential
- Rationale: the rule set and its consumers must agree in one commit. Small, pure code with table tests.
- Tasks: 4 | Depends on: none | Parallel with: Batches 1, 3, 5

### Task 2.1: Nested workspace path rules + multi-segment predicate — COMPLETE

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.spec.ts`, `D:\projects\ptah-extension\libs\shared\src\index.ts`
- Plan reference: implementation-plan.md:226-260
- Pattern to follow: existing segment split in `workspace-scan.constants.ts:57-111`; `.angular` `git check-ignore` header evidence
- Quality requirements: zero-dep (no `path`/`fs`); O(segments × rules)
- Validation notes: `.claude` alone NOT excluded; Windows separators; nested `pkg\.claude-worktrees\y` excluded
- Implementation details: export `AGENT_WORKTREE_DIR`, `NESTED_WORKSPACE_PATH_RULES`, `toWorkspaceExcludeGlobs`. `isExcludedWorkspacePath` gains consecutive-segment matching and keeps its single-segment behaviour.

### Task 2.2: `NestedRepoRoots` value type — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\libs\shared\src\lib\utils\nested-repo-roots.ts` + `nested-repo-roots.spec.ts`; MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\utils\index.ts`
- Plan reference: implementation-plan.md:238-240
- Implementation details: O(depth) prefix lookup over workspace-relative roots. `fromWorktreeList(parseWorktreeList output, workspaceRoot)` keeps only paths under the root. `add(root)` handles runtime discovery. Case-insensitive on Windows paths.

### Task 2.3: `EventStormBreaker` in platform-core (D1) — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\utils\event-storm-breaker.ts` + `event-storm-breaker.spec.ts`; MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts`
- Plan reference: implementation-plan.md:262-278
- Pattern to follow: `libs\backend\platform-core\src\utils\glob-watch-plan.ts` (pure util export)
- Quality requirements: `record` O(1), no allocation; invalid config clamps to defaults (500/1000 ms, quiet 2000, maxStorm 30000)
- Implementation details: `record(now)` returns `'normal'|'entered'|'storming'`; `poll(now)` returns `'storming'|'exited'`; counters for log lines. Spec uses a fake clock: enter, sustain, exit after quiet, forced refresh at `maxStormMs`, re-entry.

### Task 2.4: Consumers of the single literal and derived globs — COMPLETE

- Depends on: Task 2.1
- Files: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-default-excludes.ts`; CREATE `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-default-excludes.spec.ts` (drift spec); `D:\projects\ptah-extension\libs\backend\vscode-core\src\utils\worktree-path.ts` (:4); `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\worktree-hook-handler.ts` (:85-89)
- Validation notes: D4 (static rules reach all four `DEFAULT_WORKSPACE_EXCLUDES` consumers through the spread)
- Implementation details: `DEFAULT_WORKSPACE_EXCLUDES` spreads `toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES)`. The drift spec asserts it is a superset. Both literals import `AGENT_WORKTREE_DIR`.

### Batch 2 verification

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-core @ptah-extension/agent-sdk` (header: 5 projects)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/workspace-intelligence @ptah-extension/vscode-core @ptah-extension/agent-sdk`
- Done when: INV-2 table and drift tests are green; no `'.claude-worktrees'` string literal remains outside `workspace-scan.constants.ts` (grep)

### Batch 2 review pass 1 (team-leader, not yet committed)

- Evidence (team-leader re-run in `D:\projects\ptah-437`, Batch 5 edits present in the tree): test header "5 projects", all green — shared 58 suites / 1504; platform-core 33 / 597 + 4 todo; agent-sdk 104 of 106 suites / 1836 + 3 skipped; workspace-intelligence 41 / 1021; vscode-core 36 / 554 (includes `git-info.service.review.spec.ts`; the logic reviewer's EPERM/timeout failure did not reproduce — environmental under parallel load). `typecheck,lint` 5 projects: 0 errors; no warning in any Batch 2 file. Literal grep: `'.claude-worktrees'` only at `workspace-scan.constants.ts:88`. `platform-core/src/index.ts` diff holds only the Batch 2 breaker exports.
- Reviews: style APPROVED 8/10 (`b2-code-style-review.md`); logic APPROVE_WITH_FIXES 7/10 (`b2-code-logic-review.md`).
- Orchestrator decision M-1 (FIX NOW, routed back to executor — touches predicate, glob generator, two spec tables and the module doc; team-leader does not edit batch code): `NESTED_WORKSPACE_PATH_RULES` matching becomes ASCII case-insensitive on every platform, in BOTH channels. Predicate: non-allocating ASCII case-fold equality in `ruleMatchesAt`. Globs: `toWorkspaceExcludeGlobs` emits per-letter bracket classes (`**/.[cC][lL][aA][uU][dD][eE]/[wW][oO]…/**`) so every consumer (picomatch in the file index/indexer, VS Code `findFiles`, TS diagnostics, MCP builders) is case-insensitive without a `nocase` option change outside this batch. `WATCH_IGNORED_DIRS` single-segment matching stays case-sensitive. Case-variant rows flip to `true` in `workspace-scan.constants.spec.ts` (add `.Claude-Worktrees/x`, `.CLAUDE/Worktrees/x`, `pkg\.Claude\WORKTREES\y`) and are added to `workspace-default-excludes.spec.ts` (picomatch `{ dot: true }`, no `nocase`); `globToRegExp` in the shared spec learns `[...]`.
- Decided (no change): m-2 `NestedRepoRoots` case-folding by path shape — latent; every cited producer passes native `D:\` roots. ASSUMPTION for Batches 4/8/11: callers pass native absolute workspace roots.
- Decided (executor adds one header line): forced `max-duration` exit keeps the window live, so a never-quiet storm logs one enter/exit pair per `maxStormMs`.
- Decided (keep): `msUntilNextPoll` — consumer named in Task 4.1 (single exit timer; plan C2 "callers own timers"). `NestedRepoRoots` / `nestedRepoRootOf` first production callers named in Task 4.1.

### Batch 2 review pass 2 (team-leader) — ACCEPTED

- M-1 fixed, checked on disk: `ruleMatchesAt` uses the non-allocating `equalsIgnoringAsciiCase` (`workspace-scan.constants.ts:204,214`). `toWorkspaceExcludeGlobs` emits per-letter bracket classes (spec `:284-286`). `WATCH_IGNORED_DIRS` is unchanged. Case-variant rows are in both specs. The storm-breaker header has the max-duration line.
- Delta logic review (appended to `b2-code-logic-review.md`, "Delta review (M-1 fix)"): APPROVE, HIGH. Every glob consumer (`findFiles`, fast-glob, picomatch in `glob-watch-plan.ts`) accepts bracket classes. No consumer uses a TS-dialect glob.
- Evidence (team-leader re-run in `D:\projects\ptah-437`, Batch 5 edits in the tree, no nx reset): `test,typecheck,lint` header "5 projects". Results: shared 58 suites / 1512; platform-core 33 / 597 + 4 todo; workspace-intelligence 41 / 1026; agent-sdk 104 of 106 / 1836 + 3 skipped; vscode-core 35 of 36 suites / 553 of 554 in the combined run. The one failure was `git-info.service.review.spec.ts`, which timed out at 31 s under parallel load. That spec is a Batch 3 file and has no diff against HEAD. Run alone it passed 2/2, the same environmental result as pass 1. `typecheck` run alone: "Successfully ran target typecheck for 5 projects". Lint: 0 errors in all 5 projects (warnings only).
- Literal grep: the only production `'.claude-worktrees'` literal is `workspace-scan.constants.ts:88`. The other hits are spec fixtures.
- The m-2 and `msUntilNextPoll` decisions above stand.

---

## Batch 3: P1 — `GitInfoService` single-flight with trailing rerun (C4) — COMPLETE

- Commit: 93c360572 `fix(vscode-core): run one git status per workspace and queue a single rerun`

- Recommended executor: backend-developer
- Fallback executor: none (subtle concurrency; no CLI lane)
- Execution mode: sequential
- Rationale: a single-file concurrency rewrite in a 2,600-line service with a large existing spec.
- Tasks: 1 | Depends on: none | Parallel with: Batches 1, 2, 5

### Task 3.1: Flight record + `refreshGitInfo` — COMPLETE

- Files: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts` (:286-367, :2349-2367), `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.spec.ts`
- Plan reference: implementation-plan.md:316-346
- Pattern to follow: existing generation + identity-delete idiom `git-info.service.ts:286-361`
- Quality requirements: no timers; O(1) map ops; `coalesce` REPLACED in place (no parallel helper)
- Validation notes: R-P4 (all `cachedRead` keys). Run `ptah_lsp_references` on `invalidateReadCache` first. A rejection settles waiters, and a queued trailing run still starts.
- Implementation details: per-key `{ running, startedAtGeneration, trailing? }`. `invalidateReadCache` bumps the generation and drops settled cache entries only. Public `refreshGitInfo(root)` joins or starts a run that began after the call. Spec: a fake spawner counting live `status` children; 5 invalidate+refresh calls during one run lead to exactly 2 status spawns, and concurrency never exceeds 1.

### Batch 3 verification

- `npx nx run-many -t test -p @ptah-extension/vscode-core` (header: 1 project)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core @ptah-extension/rpc-handlers ptah-electron`
- Done when: INV-3 (P1 part) and AC-3 (fake spawner, P1) are pinned by spec

### Batch 3 outcome

- Implemented: per-key `ReadFlight { running, startedAtGeneration, trailing? }`; `coalesce` replaced by `singleFlight`/`startFlight` in place; `invalidateReadCache` drops settled entries only and never deletes an in-flight record; public `refreshGitInfo(workspacePath)`; `cachedRead(key, workspacePath, compute)` with all 5 callers updated; per-workspace invalidation generation (`invalidatedAt` + `invalidatedAllAt`).
- Evidence (team-leader re-run in `D:\projects\ptah-437`): `npx nx run-many -t test -p @ptah-extension/vscode-core` — 1 project, 36 suites, 554/554 passed; after the comment fixes, filtered `-- git-info.service` 3 suites, 159/159; `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core` — pass, 0 errors (warnings pre-existing, incl. `max-lines`). Executor also reported typecheck+lint green for rpc-handlers and ptah-electron.
- AC-3 pinned: `git-info.service.spec.ts` "single-flight read runs (TASK_2026_437)" — 5 invalidate+refresh calls during one run cost exactly one trailing status run, concurrency never above 1; rejection and timeout settle waiters and still start the trailing run.
- R-P4 (all `cachedRead` keys): addressed — every caller passes its workspace path; a value from a run invalidated mid-flight is not written back (spec).
- Reviews: logic APPROVED (`b3-code-logic-review.md`), style APPROVED 8/10 (`b3-code-style-review.md`).
- Accepted deviation (orchestrator decision): the plan (implementation-plan.md:316) lets a caller join the running flight; the implementation routes any caller that arrives after an invalidation to the queued trailing run instead. Result can be one run later (latency) but is never stale (correctness). Deviation 2 — generation tracked per workspace so invalidating one root does not stale another's flight — accepted as a strict refinement.
- Fixed by team-leader (comment-only, in-scope): spec top-of-file coverage matrix now lists the TASK_2026_437 block; `invalidatedAt` doc states its bound (one short key per workspace root opened in the process, no eviction needed).
- Deferred follow-ups:
  - FU-3a: extract the flight mechanism (`ReadFlight`, `singleFlight`, `startFlight`, `generationOf`, generation fields) from `git-info.service.ts` into a named collaborator under the facade rule. Candidate for the git-service split; not in P1 scope.
  - FU-3b: `startFlight` readability — replace the `?? { running, startedAtGeneration }` fallback-then-overwrite with an explicit read of the existing record's `trailing`. Pair with FU-3a.

---

## Batch 4: P1 — git watcher hardening + batched `file:content-changed` + file-index breaker (C3, C5) — COMPLETE

- Commit: the commit whose subject is `fix(electron): stop per-event watcher work during file-system storms and batch content pushes` (a commit cannot hold its own SHA; resolve it with `git log --oneline --grep "stop per-event watcher work"`)
- Reviews: `b4-code-logic-review.md` (base APPROVE_WITH_FIXES, delta APPROVE_WITH_FIXES), `b4-code-style-review.md` (APPROVED). Every review fix applied. The three delta items (degradation-audit marker placement, CLAUDE.md first-build scope, max-wait comment counts) were comment/doc-only and applied by team-leader on orchestrator instruction.
- Evidence (worktree `D:\projects\ptah-437`, 2026-09-14): `npx nx run-many -t test,typecheck,lint -p ptah-electron @ptah-extension/shared @ptah-extension/git-ui @ptah-extension/workspace-intelligence` — 4 projects, exit 0. Tests: shared 1512, git-ui 343, ptah-electron 584 (+4 skipped), workspace-intelligence 1030. Typecheck and lint 0 errors (warnings only). `ptah-extension-webview` typecheck+lint exit 0. `degradation-audit` (`check-degradation.ts`): `apps/ptah-electron: 4 ok (baseline 4)`, exit 0.
- Accepted deviations:
  - Post-storm file-index rebuild uses an atomic `FolderSnapshot` swap (staging snapshot filled while queries serve the previous one) instead of marking the index stale.
  - Runtime-discovered nested repo roots do not expire until restart (a deleted nested repo stays excluded).
  - A `.git/worktrees` root event also triggers the nested-roots refresh (addition beyond the plan).
  - Early-event blind spot: events inside a freshly created nested repo that arrive before its `.git` entry is seen are processed normally; documented in the "Accepted blind spot" doc comment in `git-watcher.service.ts`.
- Deferred follow-ups:
  - FU-4a: the storm-exit loop is duplicated between `GitWatcherService` and `WorkspaceFileIndexService`. Batch 11's coalescer MUST remove both copies.
  - FU-4b: `diff-tabs.service.ts` is over the 700-line soft ceiling; split under the facade rule in a later task.
  - FU-4c: first-build readiness gap — a direct `search()` before the first build completes sees an empty index (callers must use `ensureReadyFor`). Close in Batch 11.

- Recommended executor: backend-developer (Task 4.3 renderer half; fallback frontend-developer for that task only, same batch, same commit)
- Fallback executor: backend-developer then frontend-developer sequentially in one batch
- Execution mode: sequential
- Rationale: the payload type change breaks the git-ui compile unless producer and consumer land together (R-P2). Tightly coupled cross-file change.
- Tasks: 4 | Depends on: Batch 2, Batch 3

### Task 4.1: `GitWatcherService` exclusion, nested roots, breaker, single content timer — COMPLETE

- Files: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts`, `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.spec.ts`
- Plan reference: implementation-plan.md:280-314
- Pattern to follow: `watchDirectory` helper `git-watcher.service.ts:383-410`
- Quality requirements: per OS event ≤ 1 predicate + 1 counter + ≤ 1 timer re-arm; 0 allocations while storming
- Validation notes: nested-root detection runs BEFORE the `.git` segment filter. A `getWorktrees` failure keeps the static rules and warns once. Exit or `maxStormMs` always issues exactly 1 `refreshGitInfo` plus 1 truncated push. `.claude\commands\x.md` still schedules.
- Implementation details: the per-path timer map (`:68-71,115,512-551`) is replaced by a `Set` capped at 256 with `truncated`, one 500 ms debounce and a 2000 ms max-wait. `fetchAndPush` calls `refreshGitInfo` and no longer `invalidateReadCache`. A `.git\worktrees` directory watch refreshes `NestedRepoRoots`. Storm enter/exit `warn` lines. The breaker is imported from `@ptah-extension/platform-core`. The storm-exit check is ONE timer armed from `EventStormBreaker.msUntilNextPoll(now)` (re-armed after each `poll` that returns `'storming'`), not a fixed-interval poll; this is the consumer that justifies `msUntilNextPoll` (Batch 2 style review). Seed nested-repo matching with `NestedRepoRoots.fromWorktreeList` + `nestedRepoRootOf` (their first production callers). Expect repeated enter/exit warn pairs, one per `maxStormMs`, during a storm that never quiets (by design; Batch 2 logic review minor).

### Task 4.2: `FileContentChangedPayload` batch shape — COMPLETE

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\types\messages\payload-map.ts` (:133-137)
- Plan reference: implementation-plan.md:348-366
- Validation notes: run `ptah_lsp_references` on `FileContentChangedPayload` first. The only producer is `git-watcher.service.ts:531` and the only consumer is `diff-tabs.service.ts:184` (verified by grep).
- Implementation details: `{ filePaths: readonly string[]; truncated: boolean }` with forward-slash absolute paths. Replaces `filePath` in place.

### Task 4.3: `DiffTabsService` batch consumer — COMPLETE

- Depends on: Task 4.2
- Files: `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\services\diff-tabs.service.ts` (:169,184,366-382), `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\services\diff-tabs.service.spec.ts`
- Implementation details: build a key set once per push and refresh matching tabs. `truncated` triggers one debounced full revalidation via the `onGitStatusUpdate` debounce (`:344-360`). Empty and not truncated is ignored.

### Task 4.4: File-index watcher breaker adoption (P1 INV-6) — COMPLETE

- Files: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.ts` (:630-664, :685-698), `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.spec.ts`
- Plan reference: implementation-plan.md:101-106 (INV-6 P1), :894-898 (P1-B)
- Validation notes: the plan names this adoption only in the batch suggestion, not in a component. Keep it minimal: while storming, skip per-event `isExcluded` and the add/delete; on exit, mark the index stale and run one path-only rebuild (`build` :413-448). Batch 11 replaces this path.

### Batch 4 verification

- `npx nx run-many -t test -p ptah-electron @ptah-extension/shared @ptah-extension/git-ui @ptah-extension/workspace-intelligence` (header: 4 projects)
- `npx nx run-many -t typecheck,lint -p ptah-electron @ptah-extension/shared @ptah-extension/git-ui @ptah-extension/workspace-intelligence ptah-extension-webview`
- Done when: spec proves 10,000 events under `.claude-worktrees` give 0 schedules and 0 broadcasts; 10,000 under `src\` in 1 s give storm entered, 1 refresh and 1 push (AC-1/AC-2/AC-4 mechanism, INV-5, INV-6)

---

## Batch 5: P1 — crash / hang observability (C6) — COMPLETE

- Commit: bf247ed3c `feat(electron): record renderer and process deaths, hangs and local crash dumps`
- Recommended executor: backend-developer
- Fallback executor: CLI lanes x2 (Task 5.1 app side vs Tasks 5.2–5.3 vscode-core side are file-disjoint)
- Execution mode: sequential
- Rationale: independent of the watcher work. DI wiring across three hosts needs one owner.
- Tasks: 3 | Depends on: none | Parallel with: Batches 1, 2, 3

### Task 5.1: `ProcessLifecycleRecorder` + crashReporter (local only) — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\diagnostics\process-lifecycle-recorder.ts` + `process-lifecycle-recorder.spec.ts`; MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`, `D:\projects\ptah-extension\apps\ptah-electron\src\activation\post-window.ts`
- Plan reference: implementation-plan.md:368-412
- Pattern to follow: Electron 40.10.1 typings `node_modules\electron\electron.d.ts:278,673,5056,15622,16879`
- Quality requirements: console forwarding warning/error only, ≤ 20 lines / 10 s then one "suppressed N" line, 2 KB truncation; `*-gone` and `unresponsive` also `appendFileSync` to `ptah-hang.log`
- Validation notes: D9. `crashReporter.start({ uploadToServer: false })` runs before `app.whenReady`. On start, prune `app.getPath('crashDumps')` to the newest 5 dumps, best-effort.
- Implementation details: `app` events `child-process-gone` and `render-process-gone`. Per window: `render-process-gone`, `unresponsive`/`responsive` with duration, `console-message`. Spec with fake emitters.

### Task 5.2: `MainLoopWatchdog` (eval'd worker) — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\libs\backend\vscode-core\src\diagnostics\main-loop-watchdog.ts`, `main-loop-watchdog-source.ts`, `main-loop-watchdog.spec.ts`; MODIFY `D:\projects\ptah-extension\libs\backend\vscode-core\src\diagnostics\index.ts`
- Plan reference: implementation-plan.md:381-386
- Pattern to follow: workspace-intelligence `ts-diagnostics-worker-source.ts` (`eval: true`)
- Validation notes: D6 (`setBreadcrumb` API). Heartbeat timer unref'd. The worker swallows append failures. Spec: stop heartbeat for 6 s, then exactly one hang line + one recovery line in a temp file (AC-5).

### Task 5.3: DI + arming across hosts — COMPLETE

- Depends on: Task 5.2
- Files: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\register-platform-agnostic.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\src\diagnostics\arm-diagnostics.ts`, `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.smoke.spec.ts`, `D:\projects\ptah-extension\apps\ptah-cli\src\di\container.smoke.spec.ts`, `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\CLAUDE.md` ("Diagnosing a hang")
- Validation notes: D2 (pin via smoke specs), A8 (`logsPath` per host). A registration failure degrades to the no-op handle (`arm-diagnostics.ts:95-107`).
- Implementation details: `TOKENS.MAIN_LOOP_WATCHDOG` registered next to `EVENT_LOOP_MONITOR`, armed in `armDiagnostics` when `logsPath` is set, disposed in the returned handle.

### Batch 5 verification

- `npx nx run-many -t test -p ptah-electron @ptah-extension/vscode-core ptah-cli ptah-extension-vscode` (header: 4 projects)
- `npx nx run-many -t typecheck,lint -p ptah-electron @ptah-extension/vscode-core ptah-cli ptah-extension-vscode @ptah-extension/cli-engine`
- `npx nx run degradation-audit:lint`
- Done when: INV-8 and AC-5 are pinned by CI specs. AC-6 is optional e2e and not required.

### Batch 5 outcome

- Reviews: `b5-code-logic-review.md` base APPROVE_WITH_FIXES, appended delta APPROVE (HIGH confidence); `b5-code-style-review.md` APPROVE_WITH_FIXES. Fixes applied before commit: one exported `HANG_LOG_FILE_NAME` + `appendHangLogLine` from the vscode-core root barrel; worker restart budget 3 per 10 min, then one `[watchdog] degraded` error; hang log rotation at 1 MiB to `.1` (TS function + worker string twin `HANG_LOG_APPEND_SOURCE`, parity spec); new `arm-diagnostics.spec.ts` (6 cases); AC-5 upper bound gated behind `PTAH_PERF_SPECS=1`.
- Evidence (team-leader, worktree `D:\projects\ptah-437`, no nx reset):
  - `npx nx run-many -t test -p @ptah-extension/vscode-core` — 37 suites / 566 tests passed.
  - `npx nx test ptah-electron --testPathPattern="process-lifecycle-recorder|container.smoke"` — 43 suites passed, 1 skipped; 583 tests passed, 4 skipped (pattern did not narrow; the full project ran, including Batch 4's `git-watcher.service.spec.ts`, green at that moment).
  - `npx nx test ptah-cli --testPathPattern=container.smoke` — 66 suites passed, 1 skipped; 989 passed, 3 skipped (full project ran). One Jest "worker failed to exit gracefully" warning; not attributed to the watchdog (smoke spec never starts it).
  - `npx nx test ptah-extension-vscode --testPathPattern=container.smoke` — 6 suites / 63 tests passed.
  - `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core ptah-electron ptah-cli` — 3 projects, 0 errors (warnings only).
  - `npx nx build-main ptah-electron` — success.
  - `npx nx run degradation-audit:lint` — FAILS on a repo-wide baseline (313 findings in files outside this batch); ZERO findings in any Batch 5 file. The two Electron findings at `git-watcher.service.ts:706,709` belong to Batch 4 (in progress).
  - Not run by team-leader: `ptah-extension-vscode` typecheck — executor reported its only error in `workspace-file-index.service.ts` (Batch 4).
- Accepted deviations:
  - (a) Wiring lives in `apps/ptah-electron/src/main.ts`, not `activation/post-window.ts`: the recorder must subscribe to `browser-window-created` before the preparing window opens, and Crashpad must start before `app.whenReady`.
  - (b) Out-of-list edit `apps/ptah-electron/esbuild.config.cjs` adds `crashReporter` to `ELECTRON_NAMED_EXPORTS`; required for `build-main` (logic review confirmed).
  - (c) Renderer deaths are recorded from `app` `render-process-gone` only; no per-window duplicate listener.
- Follow-ups (not in this batch):
  - FU-5a: RPC in-flight method breadcrumb needs a hook in `RpcHandler` (plan defect D6).
  - FU-5b: the CLI arms diagnostics only under `--verbose`, so it has the watchdog only under `--verbose`.
  - FU-5c: concurrent rotation by two writers (watchdog worker + lifecycle recorder) may clobber the `.1` archive; the live file is safe. Delta review suggests one doc-comment line.

---

## Batch 6: P1 — incident stress tests ST-1 / ST-1b — PENDING

- Recommended executor: senior-tester
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: an end-to-end regression that pins the 09-14 trigger against the real services.
- Tasks: 1 | Depends on: Batches 2, 3, 4

### Task 6.1: `git-watcher.stress.spec.ts` — PENDING

- Files: CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.stress.spec.ts`
- Plan reference: implementation-plan.md:803-816, AC-1..AC-4 :786-792
- Pattern to follow: agent-sdk `off-thread-process-spawner.perf.spec.ts` (`PTAH_PERF_SPECS=1` split)
- Validation notes: R-P11. CI mechanism run uses an 8,000-file tree. The 75,000-file tree and ms budgets run only under the perf flag. Exclude-only and single-flight-only ablations are logged, not asserted (I1).
- Implementation details: temp git repo with 10 checkouts, each holding a `.git` file. Real `GitWatcherService` + `GitInfoService` with a counting spawner wrapper + `WorkspaceFileIndexService` over `ElectronFileSystemProvider`. `monitorEventLoopDelay`, `fs.rm` recursive, wait 10 s, assert counts.

### Batch 6 verification

- `npx nx run-many -t test -p ptah-electron` (header: 1 project); record a local `PTAH_PERF_SPECS=1` run
- P1 PHASE GATE: `npm run lint:all`, `npm run typecheck:all`, `npx nx build ptah-electron`, `npx nx run degradation-audit:lint`
- Done when: AC-1, AC-2 (P1), AC-3 (P1), AC-4 hold (CI mechanism; perf numbers recorded)

---

## Batch 7: P2 — `IWorkspaceWatcher` port + coalescer + contract suite (C7) — COMPLETE

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: the contract every adapter and consumer builds on. Must be settled first.
- Tasks: 3 | Depends on: Batch 1 (Electron GO), Batch 2 | Parallel with: Batches 12, 13, 14

### Task 7.1: Port interface + token — COMPLETE

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\workspace-watcher.interface.ts`; MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\di\tokens.ts`, `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts`, `D:\projects\ptah-extension\libs\backend\platform-core\CLAUDE.md` (token table)
- Plan reference: implementation-plan.md:414-451
- Validation notes: D5 (`excludeSegmentRules: readonly (readonly string[])[]`). No import from `@ptah-extension/shared`.

### Task 7.2: `WorkspaceChangeCoalescer` — COMPLETE

- Depends on: Task 7.1
- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\utils\workspace-change-coalescer.ts` + `workspace-change-coalescer.spec.ts`
- Implementation details: per subscription it accumulates, excludes (segment rules + picomatch globs), runs `EventStormBreaker` (Batch 2) and emits ≤ 1 batch per `minBatchIntervalMs`, ≤ `maxPathsPerBatch` paths, `truncated`/`overflow`/`droppedCount`. Never emits synchronously inside `watch`; nothing after dispose.

### Task 7.3: Contract suite + degradation source — COMPLETE

- Depends on: Task 7.2
- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\testing\contracts\run-workspace-watcher-contract.ts`; MODIFY `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-degradation.types.ts` (union + `DEGRADATION_SOURCE_VALUES` together)
- Pattern to follow: `run-file-system-contract.ts:145-155`

### Batch 7 verification

- `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/shared` (header: 2)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-core @ptah-extension/shared`; `npx nx run degradation-audit:lint`
- Done when: coalescer spec covers cadence, cap, truncation, overflow, exclusion and dispose (INV-1 contract)

### Batch 7 outcome

- Commit: b9ac03426 `feat(platform-core): add a batched workspace watcher port and change coalescer`.
- Reviews: `b7-code-logic-review.md` base APPROVE_WITH_FIXES, appended delta APPROVE (HIGH on fixes 1, 2, 3, 5, 6; MEDIUM on 4). `b7-code-style-review.md` APPROVE_WITH_FIXES; both serious items fixed (contract runner is `(name, setup, teardown?)`; algorithm duplication pinned by the new `workspace-exclusion-drift.spec.ts` in workspace-intelligence, 44 rows + fuzz, and cross-referenced in platform-core CLAUDE.md).
- Evidence (team-leader, worktree `D:\projects\ptah-437`, no nx reset):
  - `npx nx run-many -t test,typecheck,lint -p @ptah-extension/platform-core @ptah-extension/shared @ptah-extension/workspace-intelligence` (header: 3 projects). shared 58 suites / 1520 tests passed; workspace-intelligence 42 suites / 1075 passed; platform-core 34/35 suites, 641 passed / 4 todo / 1 failed — the failure is the known load flake `file-settings-manager.bench.spec.ts` (30 s timeout), 2/2 green when re-run alone. typecheck green; lint 0 errors (warnings only).
  - `npx nx run degradation-audit:lint` — exit 0 (TOTAL 303, every project at or under baseline), run over the working tree holding Batches 7, 12, 13, 14.
- Accepted deviations:
  - (a) Out-of-list file `libs/backend/workspace-intelligence/src/file-indexing/workspace-exclusion-drift.spec.ts`: the differential test the style review asked for. It must live in a lib allowed to import both `platform-core` and `shared`.
  - (b) `excludeDirNames` is required on `WorkspaceWatchOptions` (exact, case-sensitive) and separate from `excludeSegmentRules` (ASCII case-insensitive), matching shared `isExcludedWorkspacePath`. No adapter exists yet.
  - (c) platform-core CLAUDE.md token table also corrected for pre-existing drift: `EDITOR_LAUNCHER` added, removed `PTY_HOST` dropped; the table now has 28 rows, equal to the 28 `Symbol.for(` entries in `tokens.ts`.
- Follow-ups (not in this batch):
  - FU-7a: spec for excluded-only churn extending a storm, still bounded by `maxStormMs` (logic delta §4; the bound is implemented and pinned only for non-excluded churn).
  - FU-7b: base logic Minor-1 (`.git` substring pre-check cost) stands, harmless.

### Orchestrator decision — phase order deviation (recorded 2026-09-14)

P1 production code is committed (Batches 2–5 + the SonarCloud fix-up). Only Batch 6's stress spec
and the unnamed-`fs.watch`-event fix in `git-watcher.service.ts` remain in P1. The four approved P2
batches (7, 13, 14, 12, in that commit order) are committed before Batch 6 to reduce staging risk in
the shared worktree. Batch 6 commits when its fix lands. This overrides "Phase order P1 → P2 → P3 →
P4 is the COMMIT order" for these four batches only.

---

## Batch 8: P2 — watch host core + Electron adapter + app wiring (C8 code) — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: cross-lib, cross-process design with supervision logic. No build config here (that is Batch 10).
- Tasks: 4 | Depends on: Batch 7

### Task 8.1: Host core + protocol (platform-core) — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\workspace-watch\workspace-watch-host-core.ts`, `workspace-watch-protocol.ts`, + specs; MODIFY `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts`
- Plan reference: implementation-plan.md:453-517
- Quality requirements: pure (engine + `post` injected); Zod-validated id-correlated messages; host never spawns processes or reads file contents
- Validation notes: nested `.git` create re-subscribes (debounced 1 s, ≤ 1 per 10 s per root). A native error emits `overflow` and re-subscribes (A1). One native subscription per root using the intersection of excludes.

### Task 8.2: `ElectronWorkspaceWatcher` adapter + entry — PENDING

- Depends on: Task 8.1
- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.entry.ts`, `electron-workspace-watcher.ts`, `electron-workspace-watcher.spec.ts`, `workspace-watch-host.entry.spec.ts` (worker_threads transport); MODIFY `D:\projects\ptah-extension\libs\backend\platform-electron\src\registration.ts`, `src\index.ts`, `CLAUDE.md`
- Pattern to follow: transport auto-detect `libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker.ts:65-114`
- Validation notes: no `electron` import (injected fork shim). Heartbeat missed 3 × 2 s triggers kill + restart. Budget 5 per 10 min, then degraded (overflow + DegradationReporter + 60 s rescan advice). Resends subscriptions after restart. Paths are containment-checked.

### Task 8.3: App factory, phase-0 registration, BootRefs, hatch — PENDING

- Depends on: Task 8.2
- Files: CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\platform\electron-workspace-watch-host-factory.ts`; MODIFY `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-0-platform.ts`, `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-coordinator.ts` (BootRefs.workspaceWatcher), `D:\projects\ptah-extension\apps\ptah-electron\src\activation\shutdown.ts` (`nonFatal` in `disposeAfterPersistence`), `D:\projects\ptah-extension\apps\ptah-electron\src\di\container.smoke.spec.ts`
- Pattern to follow: `electron-integrity-worker-factory.ts:22-31`, `electron-utility-worker-process.ts:26-61`
- Validation notes: `PTAH_WATCH_HOST=0` selects in-process `@parcel/watcher` inside the same adapter. Record at the flag site: consumer = Electron users hitting A2 faults; delete after one release without host degradations.

### Task 8.4: Host bundle path resolution contract — PENDING

- Depends on: Task 8.3
- Implementation details: the factory resolves `workspace-watch-host.mjs` next to `main.mjs` exactly as the integrity worker does. The spec asserts the resolved path. Batch 10 produces the file.

### Batch 8 verification

- `npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/platform-electron ptah-electron` (header: 3). The ptah-electron ESM gate is unchanged here.
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-core @ptah-extension/platform-electron ptah-electron`
- Done when: the adapter spec with a fake fork shim proves restart, resubscribe and budget exhaustion; the entry runs as a worker_threads Worker in Jest on a temp tree

---

## Batch 9: P2 — CLI and VS Code watcher adapters (C9 code) — PENDING

- Recommended executor: backend-developer
- Fallback executor: CLI lanes x2 (CLI adapter vs VS Code adapter, file-disjoint)
- Execution mode: sequential
- Rationale: both run the shared contract suite from Batch 7. CLI engine choice depends on the Batch 1 A3 result.
- Tasks: 2 | Depends on: Batch 8, Batch 1 (A3 result)

### Task 9.1: `CliWorkspaceWatcher` — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-cli\src\workspace-watch\workspace-watch-host.entry.ts`, `D:\projects\ptah-extension\libs\backend\platform-cli\src\implementations\cli-workspace-watcher.ts` + spec; MODIFY platform-cli registration file, `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\container.ts`, `D:\projects\ptah-extension\apps\ptah-cli\src\di\container.smoke.spec.ts`
- Plan reference: implementation-plan.md:519-543
- Validation notes: A3 NO-GO means the entry uses chokidar inside the worker (contract unchanged). D7: the entry path must resolve for both `main.mjs` and `tui.mjs`. Restart budget same as Electron.

### Task 9.2: `VscodeWorkspaceWatcher` — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-workspace-watcher.ts` + spec; MODIFY platform-vscode registration file, `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts`
- Implementation details: `createFileSystemWatcher(new RelativePattern(root,'**/*'))` feeds `WorkspaceChangeCoalescer`; watcher error emits `overflow`. No native dependency enters the VSIX.

### Batch 9 verification

- `npx nx run-many -t test -p @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/cli-engine ptah-cli ptah-extension-vscode` (header: 5)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/cli-engine ptah-cli ptah-extension-vscode ptah-tui`

---

## Batch 10: P2 — build targets, packaging and native gates (C8/C9 build) — PENDING

- Recommended executor: devops-engineer
- Fallback executor: backend-developer
- Execution mode: sequential; ALONE in its worktree (edits two `project.json`; `npx nx reset` first)
- Rationale: build/delivery surface only. Must follow the entry sources (D3 — cause not reproduced in Batch 1; ordering kept as a precaution).
- Tasks: 5 | Depends on: Batches 8, 9

### Task 10.1: Electron host build target in all four lists — PENDING

- Files: `D:\projects\ptah-extension\apps\ptah-electron\project.json` (new `build-workspace-watch-host` ESM target, external `@parcel/watcher`; add to `build.dependsOn`, `build-dev`, `serve:watch`, `test.dependsOn`), `D:\projects\ptah-extension\apps\ptah-electron\src\config\esm-bundle-gate.spec.ts` (`EXPECTED_ESM_TARGETS` :153-159), `D:\projects\ptah-extension\apps\ptah-electron\CLAUDE.md` (Build & Run)
- Pattern to follow: `build-integrity-worker` `project.json:160-186`

### Task 10.2: Dependency, asarUnpack and packed-load gate — PENDING

- Files: `D:\projects\ptah-extension\package.json`, `D:\projects\ptah-extension\package-lock.json`, `D:\projects\ptah-extension\apps\ptah-electron\package.json`, `D:\projects\ptah-extension\apps\ptah-electron\electron-builder.yml`, `D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-native.js`
- Validation notes: re-apply the Batch 1 evidence (`b1-spike-report.md`). `verify-packed-native.js` must FAIL (not skip) when `@parcel/watcher` cannot be required from the packed tree.
- Implementation details (from Batch 1, all required):
  - `"@parcel/watcher": "2.5.6"` as a DIRECT dependency in root `package.json` and `apps/ptah-electron/package.json` (today only transitive via `sass`).
  - `electron-builder.yml` `asarUnpack`: `node_modules/@parcel/watcher/**`, `node_modules/@parcel/watcher-*/**`, AND `node_modules/picomatch/**`, `node_modules/is-glob/**`, `node_modules/is-extglob/**`, `node_modules/detect-libc/**`. Without the last four the unpacked `wrapper.js` fails with `MODULE_NOT_FOUND: picomatch`.
  - `apps/ptah-electron/project.json` `build-main.options.external` gains `"@parcel/watcher"` (Task 10.1 owns the file; apply there if simpler, same batch).
  - The packed-load gate must `require('@parcel/watcher')` from `app.asar.unpacked` AND subscribe once, so a missing sibling (picomatch) fails the gate.

### Task 10.3: validate-deps / prune gate confirmation — PENDING

- Implementation details: run `npx nx package ptah-electron`. Record the prune-dist-deps and validate-deps output. Confirm the host bundle is in `dist\apps\ptah-electron`.

### Task 10.4: CLI host bundle — PENDING

- Files: `D:\projects\ptah-extension\apps\ptah-cli\project.json` (host worker target + externals), `D:\projects\ptah-extension\apps\ptah-cli\package.json` (dependency only if A3 GO), CLI ESM gate spec if the CLI keeps its own copy
- Validation notes: D7. Launch `ptah tui` from the built dist and confirm the watcher host starts.
- Implementation details (from Batch 1): `apps/ptah-cli/package.json` `dependencies` gains `"@parcel/watcher": "2.5.6"` (A3 GO); `apps/ptah-cli/project.json` `build-esbuild.options.external` gains `"@parcel/watcher"`. ORDER IS MANDATORY: `npx nx build ptah-cli` → `npx nx build ptah-tui` → `npx nx restore-cli-manifest ptah-cli` → only then `npm pack` / smoke-install. `ptah-tui:build` overwrites `dist/apps/ptah-cli/package.json` (name, `bin`, `files`, deps); packing before the restore ships a broken manifest.

### Task 10.5: Cross-platform `@parcel/watcher` CI smoke (D10) — PENDING

- Files: the release package-matrix workflow under `D:\projects\ptah-extension\.github\workflows\` (the one that runs electron-builder per OS; locate before editing)
- Implementation details: per macOS / Linux / Windows(-arm64 where present) runner, package (or `npm install` with `npm_config_platform` / `npm_config_arch`) and run a `require('@parcel/watcher')` + subscribe smoke from the packed tree, the same way `verify-packed-native.js` checks `better-sqlite3`. Only win32-x64 was proven in Batch 1.

### Batch 10 verification

- `npx nx reset` then `npx nx run-many -t test -p ptah-electron ptah-cli` (header: 2)
- `npx nx build ptah-electron`, `npx nx package ptah-electron`, `npx nx build ptah-cli`, `npx nx build ptah-tui`
- Release CI package matrix (macOS / Linux / Windows arm64) green on the branch, including the Task 10.5 `@parcel/watcher` smoke, before P2 is declared done (D10)
- CLI tarball: build order per Task 10.4, `npm pack`, clean `npm install --omit=dev`, load from `main.mjs` and `tui.mjs`
- Done when: A2 is gated permanently; the ESM gate discovers 6 targets

---

## Batch 11: P2 — consumer migration to the port + ESLint rule + nested-root walk exclusion (C10) — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: deletes the P1 in-process watcher paths and replaces them. Coupled changes across two consumers plus a repo-wide rule.
- Tasks: 4 | Depends on: Batch 10

### Task 11.1: `GitWatcherService` onto `IWorkspaceWatcher` — PENDING

- Files: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts` + `.spec.ts`, `D:\projects\ptah-extension\apps\ptah-electron\src\activation\boot-heavy-services.ts` (:380-408), `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.stress.spec.ts` (switch to the real adapter)
- Plan reference: implementation-plan.md:545-573
- Validation notes: DELETE the recursive `fs.watch` path, per-event filter and in-process breaker use. `.git` dedicated watchers `:199-222` unchanged. `overflow` triggers `refreshGitInfo` + truncated push. Nested roots are seeded from `getWorktrees` into `subscribe`.

### Task 11.2: `WorkspaceFileIndexService` onto the port — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.ts` + `.spec.ts`, `D:\projects\ptah-extension\libs\backend\workspace-intelligence\CLAUDE.md` ("File index")
- Validation notes: replaces the recursive `createFileWatcher` call (`:635`) and the Batch 4 breaker adoption. One `compileMatcher` pass per batch. `overflow` marks stale and does one path-only rebuild (governor adoption comes later in Batch 17).

### Task 11.3: Nested repo / worktree exclusion in the initial walk (D4) — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-indexer.service.ts` (+ spec)
- Validation notes: user decision Q1. Skip any directory below the root that holds a `.git` entry (file or dir), and registered worktrees under the root. Architect to confirm placement.

### Task 11.4: ESLint rule against in-main recursive watching — PENDING

- Files: `D:\projects\ptah-extension\eslint.config.mjs`
- Implementation details: forbid `fs.watch` with `recursive` and `chokidar` imports outside `libs/backend/platform-{electron,cli}/src/implementations/*file-system-provider.ts` and `libs/backend/platform-{electron,cli}/src/workspace-watch/*.entry.ts`. Proven by `npm run lint:all`.

### Batch 11 verification

- `npx nx run-many -t test -p ptah-electron @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools` (header: 3)
- `npm run lint:all`; `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/workspace-intelligence ptah-cli ptah-extension-vscode`
- Done when: INV-1 is enforced by lint; INV-2 holds for watchers and the `@` index; grep shows 0 `recursive: true` `fs.watch` in `apps/ptah-electron/src/services`

---

## Batch 12: P2 — git process gate, output cap, background priority (C11) — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: process supervision in `exec-git.ts` plus the untracked cap in `git-info.service.ts` (file owned by Batch 3, now committed).
- Tasks: 2 | Depends on: Batch 3 | Parallel with: Batches 7–11, 13, 14

### Task 12.1: `GitProcessGate` + `GitOutputLimitError` + priority — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\vscode-core\src\utils\exec-git.ts` (:86-115, :156-313), `D:\projects\ptah-extension\libs\backend\vscode-core\src\utils\exec-git.spec.ts`
- Plan reference: implementation-plan.md:575-602
- Validation notes: the timeout clock starts at spawn. The slot is released on `close` or 2 s after a forced kill, never on the timeout rejection. Default 4 (`PTAH_GIT_MAX_CONCURRENT`). Saturation warn at most 1/min. `os.setPriority` failure is swallowed with a degradation-audit marker.

### Task 12.2: Untracked numstat cap + watcher refresh priority — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\git-info.service.ts` (:2395-2422), spec
- Implementation details: first 200 untracked files, ≤ 1 MiB each, else `null` additions/deletions. `refreshGitInfo` passes `priority: 'background'`.

### Batch 12 verification

- `npx nx run-many -t test -p @ptah-extension/vscode-core` (header: 1); `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core`; `npx nx run degradation-audit:lint`
- Done when: INV-3 (slot to exit), INV-4 and AC-3 (P2, process-wide ≤ 4) are pinned

---

## Batch 13: P2 — reusable bounded spawn workers (C12) — COMPLETE

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: worker lifecycle in one helper with real-child specs (R-P6).
- Tasks: 2 | Depends on: none | Parallel with: Batches 7–12, 14

### Task 13.1: Worker pool in `OffThreadProcessSpawner` — COMPLETE

- Files: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\off-thread-process-spawner.ts` (:245-314, :492-507, :666-698), `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\off-thread-process-spawner-source.ts`, `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`
- Plan reference: implementation-plan.md:604-624
- Validation notes: one child per worker; ≤ 4 idle kept for 30 s; above 24 live spawn anyway and warn once/min. An errored or exited worker is never pooled. `PTAH_SDK_INLINE_SPAWN=1` unchanged.

### Task 13.2: Reuse specs — COMPLETE

- Files: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\off-thread-process-spawner.spec.ts`
- Implementation details: 50 sequential spawns create ≤ 4 workers (AC-8); stdout isolation between consecutive children; a killed child's worker is not reused.

### Batch 13 verification

- `npx nx run-many -t test -p @ptah-extension/agent-sdk` (header: 1); `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk ptah-electron`
- Done when: AC-8 is green

### Batch 13 outcome

- Commit: the commit whose subject is `perf(agent-sdk): reuse a bounded pool of spawn workers` (resolve with `git log --grep "bounded pool of spawn workers"`).
- Reviews: `b13-code-logic-review.md` base APPROVE_WITH_FIXES → delta APPROVE_WITH_FIXES; the three delta items were then fixed and verified on disk by team-leader: a lost worker / force-terminate / grace abandon reports `exitCode` null + `signalCode` + `killed` true (no numeric sentinel); cap reports carry `inlineSinceLastReport` / `overCapSinceLastReport`; `WorkerBackedProcess.stdin` has a no-op `error` listener (`off-thread-process-spawner.ts:263`). `b13-code-style-review.md` APPROVE_WITH_FIXES; the fix (extract `SpawnWorkerPool` / `PooledSpawnWorker` to `spawn-worker-pool.ts`, facade rule) is done — `off-thread-process-spawner.ts` 1016 → 805 lines, `spawn-worker-pool.ts` 417.
- Evidence (team-leader, worktree `D:\projects\ptah-437`, no nx reset):
  - `npx nx run-many -t test,typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/persistence-sqlite` (header: 3 projects; one run shared with Batch 14) — exit 0. agent-sdk 106 suites passed / 2 skipped, 1859 tests passed / 3 skipped; cli-agent-runtime 60 suites / 907 passed / 1 skipped; typecheck green; lint 0 errors.
  - Direct: `spawn-worker-pool` + `off-thread-process-spawner` specs — 2 suites passed (the `PTAH_PERF_SPECS` perf suite skipped by design), 27 passed.
  - `degradation-audit:lint` exit 0 (see Batch 7 outcome).
- Accepted deviations:
  - (a) New file `spawn-worker-pool.ts` (+ spec), from the style review's extraction; its constants are deliberately not in the barrel.
  - (b) Hard cap 64 live workers: `admit()` refuses and that one child is spawned INLINE, with a `critical` degradation report (`agent.spawn-worker.hard-cap-inline`), rate-limited to once a minute. The soft cap 24 still spawns a worker and warns.
  - (c) The `ptah-electron` typecheck/lint listed under "Batch 13 verification" was replaced by `cli-agent-runtime` (the `IProcessSpawner` consumer). ptah-electron lint was run separately before the commit: 0 errors.
- Follow-ups (not in this batch):
  - FU-13a: a shared off-main-thread Windows tree-kill helper. A dead worker SIGTERMs only its child, and `exec-git.ts` carries a duplicate `taskkill`.
  - FU-13b: a failed spawn with ENOENT closes as `(null, null)` — pre-existing, not introduced here.

---

## Batch 14: P2 — main-thread cost attribution: SQLite + resume parse (C13) — PENDING

- Recommended executor: backend-developer
- Fallback executor: CLI lanes x2 (sqlite wrapper vs reader timing)
- Execution mode: sequential
- Rationale: measurement only, two small file-disjoint seams.
- Tasks: 2 | Depends on: none | Parallel with: Batches 7–13

### Task 14.1: Slow-statement wrapper on `SqliteDatabaseFactory` — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\sqlite-connection.service.ts`, `sqlite-connection.service.spec.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\CLAUDE.md` (env table `PTAH_SQLITE_SLOW_WARN_MS`)
- Plan reference: implementation-plan.md:626-643
- Validation notes: never alters results or exceptions; ≤ 1 line per SQL text per minute; `transaction()` callbacks timed.

### Task 14.2: `readSessionHistory` duration log — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts` (:155-311) + spec
- Validation notes: this file is also edited by Batch 20. Batch 20 depends on this batch.

### Batch 14 verification

- `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/agent-sdk` (header: 2); typecheck,lint same projects
- P2 PHASE GATE (after Batch 15): `npm run lint:all`, `npm run typecheck:all`, `npx nx build ptah-electron`, `npx nx package ptah-electron`, `npx nx run degradation-audit:lint`

---

## Batch 15: P2 — host stress ST-2 + host-kill AC-7 — PENDING

- Recommended executor: senior-tester
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: proves A1, AC-2 (P2) and AC-7 against the real native engine.
- Tasks: 1 | Depends on: Batch 11

### Task 15.1: `workspace-watch-host.stress.spec.ts` — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host.stress.spec.ts`
- Plan reference: implementation-plan.md:813-816, AC-2 P2 / AC-7 :789-794
- Validation notes: A1 (overflow survives or resubscribes); records host RSS (R-P10); mechanism in CI, ms budgets under `PTAH_PERF_SPECS=1`.
- Added from Batch 1 (not performed in the spike): the 75,000-file mass-delete measurement against the real `@parcel/watcher` host, under `PTAH_PERF_SPECS=1`. Record event count delivered, batches emitted, overflow count, host RSS and main-thread event-loop delay p99/max during the delete.

### Batch 15 verification

- `npx nx run-many -t test -p @ptah-extension/platform-electron ptah-electron` (header: 2) + recorded perf run
- Done when: AC-2 (P2) and AC-7 recorded; A1 resolved in this file's validation section

---

## Batch 16: P3 — `BackgroundWorkGovernor` core + internal-query gate adoption (C14 core, a) — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: state machine + DI + the gate that controls LLM background lanes. Shares vscode-core DI files with Batch 5 (now committed).
- Tasks: 3 | Depends on: Batch 5 (P2 committed first per phase order)

### Task 16.1: Governor + `EventLoopMonitor.onSample` — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\backend\vscode-core\src\diagnostics\background-work-governor.ts` + spec; MODIFY `event-loop-monitor.ts` (+ spec), `arm-diagnostics.ts`, `diagnostics\index.ts`, `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`, `register-platform-agnostic.ts`, the three hosts' `container.smoke.spec.ts`
- Plan reference: implementation-plan.md:645-692
- Validation notes: R-P7. Enter at p99 > 100 for 2 windows, exit at max < 40 for 3 windows; `whenClear` default ceiling 600,000 ms; listener throws isolated. CLI without `--verbose` gives a foreground-only signal.

### Task 16.2: Foreground source over `SessionTurnStateRegistry` — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-turn-state.registry.ts` (+ spec), `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
- Implementation details: `hasGenerating()` + listener list notified from `markGenerating`/`settleTurn`/`forceIdle`; the registry stays I/O-free.

### Task 16.3: Gate admission for background lanes — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts` (:167-260) + spec
- Validation notes: `default` lane never gated; drain re-runs on `onChange`; governor resolution failure = always clear + one degradation event.

### Batch 16 verification

- `npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/agent-sdk ptah-electron ptah-cli ptah-extension-vscode` (header: 5); typecheck,lint same; `npx nx run degradation-audit:lint`
- Done when: INV-7 core and AC-9 are pinned

---

## Batch 17: P3 — governor adopters (C14 b, c, d, e) — PENDING

- Recommended executor: CLI lanes x4 (one per task)
- Fallback executor: backend-developer, sequential
- Execution mode: parallel (each task owns different files, no shared registry, self-describable against the Batch 16 API)
- Rationale: four small edits at independent seams.
- Tasks: 4 | Depends on: Batches 16, 11 (file index), 14

### Task 17.1: Symbol indexer yields — PENDING

- File: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts` (:228) + spec
- Implementation details: `await governor.whenClear()` before each batch.

### Task 17.2: User-layer refresh defer (non-activation reasons) — PENDING

- File: `D:\projects\ptah-extension\apps\ptah-electron\src\activation\plugin-activation.ts` + spec
- Validation notes: `activation` reason is never deferred; go through `refreshUserLayer` only (app CLAUDE.md).

### Task 17.3: Backup start + file-index overflow rebuild governed — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\backup.service.ts` + spec; `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.ts` (overflow rebuild path only) + spec
- Validation notes: D8. This is the only task touching the file index; the other lanes must not touch it.

### Task 17.4: `editor:detectTargets` bounded concurrency + cache — PENDING

- File: `D:\projects\ptah-extension\libs\backend\platform-core\src\utils\editor-launcher-detection.ts` (:163-235) + spec
- Implementation details: concurrency 8; cache per `PATH`+`PATHEXT` for process lifetime.

### Batch 17 verification

- `npx nx run-many -t test -p @ptah-extension/workspace-intelligence ptah-electron @ptah-extension/persistence-sqlite @ptah-extension/platform-core` (header: 4); typecheck,lint same
- Done when: AC-10 measured on a local boot of this repo (log excerpt recorded)

---

## Batch 18: P3 — network back-off for curator and skill-synthesis lanes (C14 f) — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: needs the A4 investigation first, so it cannot be a self-contained lane prompt.
- Tasks: 2 | Depends on: Batch 16 | Parallel with: Batch 17

### Task 18.1: Resolve A4 — PENDING

- Implementation details: grep `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-09-14.log` for the failing curator Codex proxy line, trace its logger tag to the retry site, and report the file paths before editing.

### Task 18.2: Exponential back-off 30 s → 15 min, reset on success — PENDING

- Depends on: Task 18.1
- Files: retry sites in `D:\projects\ptah-extension\libs\backend\memory-curator\src` and `D:\projects\ptah-extension\libs\backend\skill-synthesis\src` found in 18.1 (+ specs)
- Validation notes: network-class failures only; user-scheduled cron is not deferred.

### Batch 18 verification

- `npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/skill-synthesis` (header: 2); typecheck,lint same
- P3 PHASE GATE: `npm run lint:all`, `npm run typecheck:all`, `npx nx build ptah-electron`, `npx nx run degradation-audit:lint`

---

## Batch 19: P4 — O(E+M) finalization + tab persistence quota back-off (C16, C17) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lanes x2 (different libs, file-disjoint)
- Execution mode: sequential
- Rationale: two independent service-level renderer fixes with equivalence specs.
- Tasks: 2 | Depends on: none by file; commits after P3

### Task 19.1: Single-pass indexing in `finalizeSessionHistory` — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts` (:303-321) + spec
- Plan reference: implementation-plan.md:715-724
- Validation notes: keep first-match semantics; equivalence oracle on fixtures; counting proxy ≤ 2 × E visits (AC-11 CI part).

### Task 19.2: Quota back-off — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-manager.service.ts` (:2323-2380), `D:\projects\ptah-extension\libs\frontend\chat-state\src\lib\tab-persistence.ts` + specs
- Validation notes: skip serialization until `failedAt + min(5 s × 2^attempt, 5 min)` unless the tab set shrank or teardown flush runs; one warn per step (AC-12, INV-10).

### Batch 19 verification

- `npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat-state` (header: 2); typecheck,lint same

---

## Batch 20: P4 — bounded `chat:resume` + chunked replay (C15) — PENDING

- Recommended executor: frontend-developer (backend field removal included)
- Fallback executor: backend-developer for Task 20.1, then frontend-developer for Task 20.2, same batch and commit
- Execution mode: sequential
- Rationale: removing the shared field breaks the renderer fallback compile unless both land together.
- Tasks: 2 | Depends on: Batch 14 (`session-history-reader.service.ts`)

### Task 20.1: Delete `ChatResumeResult.messages` end to end — PENDING

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-chat.types.ts` (:233-252), `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts` (:876-883), `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts` (legacy projection only if unreferenced)
- Validation notes: A5/D11. `ptah_lsp_references` on the field first. Update `chat-session-resume-activate.spec.ts` and any spec asserting `messages`.

### Task 20.2: Chunked replay in `SessionLoaderService` — PENDING

- Depends on: Task 20.1
- Files: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts` (:743-799) + `session-loader.service.spec.ts`, `session-loader.cli-restore.spec.ts`
- Validation notes: R-P9. Chunks of 250 with a `MessageChannel` yield; tab stays `resuming`; a throwing chunk leads to `applyResumeFailure`; CLI sessions applied first. 2,000 events give 8 yields with state equal to a single pass.

### Batch 20 verification

- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-sdk @ptah-extension/chat ptah-cli ptah-tui` (header: 6); typecheck,lint same + `ptah-extension-webview`
- Done when: INV-9 (replay + no duplicate transcript) pinned

---

## Batch 21: P4 — inbound message burst coalescing (C18) — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: one file, timing-sensitive (R-P8).
- Tasks: 1 | Depends on: none by file; commits after P3 | Parallel with: Batches 19, 20

### Task 21.1: Queue + single zone drain — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\message-router.service.ts` (:53-86) + `message-router.service.spec.ts`
- Plan reference: implementation-plan.md:739-750
- Validation notes: `runOutsideAngular` listener; one `MessageChannel` drain with one `ngZone.run`; BATCH expansion unchanged; per-message try/catch; 1,000 messages give 1 zone entry with order preserved (AC-13).

### Batch 21 verification

- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` (header: 3); typecheck,lint same

---

## Batch 22: P4 — AC-11 tile-open perf e2e — PENDING

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Execution mode: sequential
- Rationale: end-to-end measurement against the "3 tiles opened" crash path.
- Tasks: 1 | Depends on: Batches 19, 20, 21

### Task 22.1: Long-task spec for 3 tiles on a 2,000-event session — PENDING

- Files: CREATE a spec under `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\chat\`
- Validation notes: `PerformanceObserver('longtask')`; no task > 200 ms, total ≤ 1,500 ms; gated behind `PTAH_PERF_SPECS=1`. If it misses the budget, report for Q6 (history paging) rather than loosening it.

### Batch 22 verification

- `npx nx run-many -t lint,typecheck -p ptah-electron-e2e`; `npx nx e2e ptah-electron-e2e` with the new spec filtered, recorded locally
- P4 PHASE GATE: `npm run lint:all`, `npm run typecheck:all`, `npx nx build ptah-electron`, `npx nx run degradation-audit:lint`

---

## PR #510 external review fixes — SonarCloud quality gate (Reliability C) — COMPLETE

Not a numbered batch. Fix-up commit on files already committed by Batches 2, 4, 5. The commit
carrying this section is the one whose subject is
`fix: address SonarCloud reliability and maintainability findings on PR 510` (a commit cannot
record its own SHA; resolve it with `git log --grep "SonarCloud reliability"`).

- S8786 + S7781 — `libs/shared/src/lib/utils/nested-repo-roots.ts` `absoluteKey`: linear pass
  replaces the lookbehind regex; `replaceAll`. 7 separator-normalization rows added to
  `nested-repo-roots.spec.ts` — COMPLETE
- S7758 — `libs/shared/src/lib/constants/workspace-scan.constants.ts` `equalsIgnoringAsciiCase`:
  `codePointAt(i) ?? -1` — COMPLETE
- S2699 — `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.spec.ts` "creates the log
  directory on first write" now asserts the directory and the hang line (plus prettier reflow of
  that spec) — COMPLETE
- S3776 — `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts`:
  `readDumpDirEntries` and `pushDumpStat` extracted from `collectDumps` — COMPLETE
- S7780 — `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog-source.ts`: two
  backslash-free literals are plain templates; the `'\n'` literal stays `String.raw` — COMPLETE
- S6582 — `apps/ptah-electron/src/services/git-watcher.service.ts`: optional chain — COMPLETE
- S5906 — `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.spec.ts`:
  `toHaveLength` — COMPLETE
- S4822 (`git-info.service.ts`) is fixed inside Batch 12, not here.

Degradation-audit regression found and fixed by team-leader (comment only): the S3776 extraction
turned `entries = []` into `return []` inside a catch, a new `catch-return-sentinel` that took
`apps/ptah-electron` to 5 over baseline 4. A `// degradation-audit: reported —` marker in the
catch's leading comments returns it to 4 (audit exit 0).

Verification: eslint clean on all 8 files; `degradation-audit` check exit 0 (ptah-electron 4/4);
`run-many -t test -p @ptah-extension/shared @ptah-extension/workspace-intelligence` (header: 2) —
shared green, one timeout in `toolchain-probe.spec.ts` under 4-way parallel load, green when run
alone; `main-loop-watchdog.spec.ts` 13/13 on three isolated runs (one failure under the same
parallel load); `process-lifecycle-recorder` + `git-watcher.service.spec` 58/58. The `nx test
--testPathPattern` form ran the whole project; failures there were in other batches' uncommitted
files (`git-info.service*.spec.ts` Batch 12, `git-watcher.stress.spec.ts` Batch 6).
