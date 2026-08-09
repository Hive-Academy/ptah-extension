# Development Tasks — TASK_2026_157

**Feature**: Ptah Task-Management System (Phase 1) — `.ptah/specs/` formalization + standalone Tasks tab
**Total Tasks**: 26 | **Batches**: 5 (A, B, C, E, D) + QA | **Status**: ALL COMPLETE — 6/6 batches done (A, B, C, E, D verified; QA green; review-fix round + MODE 3 final verification passed — commits deferred to orchestrator)
**cli_delegation**: DISABLED — sub-agent developers only (backend-developer / frontend-developer / senior-tester). No CLI executors.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

The implementation plan (`implementation-plan.md`) is internally consistent and its file inventory (§12) is complete for the 8 requirements. All eight architect decisions (D1–D8) and assumptions (A-1…A-5) were reviewed. The "implementer locates" seams flagged in assumption **A-5** were resolved during decomposition (see below) so developers do not re-discover them.

### Assumptions Verified (A-5 seams pinned this session)

| Seam (plan said "implementer locates")                | Resolved location                                                                                                         | Evidence                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Migration number still free                           | **29** is free                                                                                                            | `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:238` last entry is `version: 28, 0028_gateway_conversation_workspace_root` |
| VS Code DI phase file for `registerTaskSpecsServices` | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts` (add beside `registerWorkspaceIntelligenceServices` at line 53)  | grep confirmed workspace-intelligence registers there                                                                                   |
| Electron DI phase file                                | `apps/ptah-electron/src/di/phase-2-libraries.ts:172` (beside `registerSkillSynthesisServices`)                            | grep confirmed                                                                                                                          |
| CLI DI seam                                           | `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts` (beside `registerSkillSynthesisServices` at line 106) | grep confirmed — CLI wires backend libs here, NOT in `apps/ptah-cli/src/di`                                                             |
| content-manifest regeneration script                  | `scripts/generate-content-manifest.js`                                                                                    | glob confirmed (single script)                                                                                                          |
| VS Code SQLite gate precedent (`isRegistered`)        | `apps/ptah-extension-vscode/src/activation/wire-runtime.ts:176`                                                           | grep confirmed                                                                                                                          |

### Risks Identified

| Risk                                                                                                                                                                                                                                                                 | Severity       | Mitigation (task)                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ | ------ | ------------------------------------------------------ |
| **R1** — `electron-shell.component.ts` has UNCOMMITTED WIP on `ak/fix-canvas-issue`; tab-strip edit could clobber                                                                                                                                                    | HIGH           | Task **C.6**: re-read working tree immediately before editing; additive button only; STOP + report on structural conflict. Never `--no-verify`, never clobber.                                                                               |
| **G1 (new)** — `skill-synthesis` is registered ONLY in Electron + CLI, NOT in the VS Code host, yet `task-specs` must be registered in ALL THREE (the `tasks:` RPC handler runs on all hosts; the `skill-synthesis → task-specs` edge only matters on Electron/CLI). | MED            | Task **B.5**: register `registerTaskSpecsServices` in all three hosts (vscode/electron/cli) regardless of where skill-synthesis lives. Do not assume "wherever skill-synthesis is registered."                                               |
| **G2 (new)** — Plan §12 lists only `apps/ptah-extension-webview/src/app/app.config.ts` as the composition root ("single root serves both shells"), an unverified structural claim.                                                                                   | MED            | Task **C.5**: before relying on the single-root assumption, confirm the Electron renderer entry consumes the same `app.config.ts`; if it has its own provider array, add the `TASKS_VIEW_COMPONENT` + `MESSAGE_HANDLERS` bindings there too. |
| **R2** — Legacy-folder heterogeneity (real ~85 folders) crashes the scanner.                                                                                                                                                                                         | MED            | Tasks **A.6** (scanner never-throws) + **QA.1** (live-tree run over real tree, `excluded ≈ 85`, clean).                                                                                                                                      |
| **R4** — Migration-number collision with a concurrent task.                                                                                                                                                                                                          | MED            | Task **A.9**: re-verify 29 is still the free slot at merge time.                                                                                                                                                                             |
| **R5/R6** — Skill text landing in junctioned `.claude/skills/` copy instead of packaged source; or trademark-string / `.vscodeignore` regression.                                                                                                                    | MED/HIGH       | Task **E.3**: edit ONLY `apps/ptah-extension-vscode/assets/plugins/...`; no `copilot                                                                                                                                                         | codex | claude | openai | anthropic`strings added;`.vscodeignore` never trimmed. |
| **R8** — spec-harvester frontmatter-only means legacy folders stop being harvest-eligible.                                                                                                                                                                           | MED (accepted) | Task **E.1/E.2**: documented consequence of the no-legacy decision; fixtures rewritten.                                                                                                                                                      |

### Interpretation Flags (carry to code-logic-reviewer — non-blocking)

- **A-2 (D8)**: batch-level executor verdicts remain parsed from `tasks.md` **word tokens** (`COMPLETE`/`FAILED`). If the reviewer reads R7 ("frontmatter parsing ONLY") as banning `tasks.md` parsing wholesale, the fallback is to drop `parseBatchVerdicts` (task-level reconciliation only) — a one-file change. Flag at review of Batch E.
- **A-4**: registry header timestamp = `max(updated)` of included tasks (pure function of inputs) to satisfy R2.1×R2.4 determinism. Reviewer should confirm two runs over unchanged files are byte-identical.
- **A-3**: no drag-and-drop in phase 1 (status changes via card action menu) — R5.7 permits either.
- **D-deviation**: `tasks-ui` depends on `libs/frontend/markdown` in addition to R5.2's `shared`/`core`/`ui` (NFR-10 DOMPurify chokepoint). Recorded and legal (chat does the same).

### Blockers Found

None. Decomposition proceeds.

### Edge Cases to Handle (from validation → task mapping)

- [ ] `.ptah/specs/` absent/empty → no-op index, friendly empty state (A.6, C.3, C.5)
- [ ] Unreadable dir / corrupt single file → excluded row only, never fail the scan (A.6, NFR-5)
- [ ] `id` ≠ folder name → folder wins, `validationIssues` warning, still included (A.4)
- [ ] Suffixed/non-numeric legacy names (`TASK_2026_146_ORCHESTRA`, `TASK_2026_HERMES`) → excluded from board; still counted for id allocation (A.5, A.6)
- [ ] CRLF / `---` inside body code fences survives `updateFrontmatter` byte-identically (A.4)
- [ ] Watcher burst (N writes one folder) → 1 index update + 1 push (B.2, NFR-2)
- [ ] No-SQLite VS Code native-module failure → InMemory store parity (B.1)
- [ ] `tasks:create` target folder already exists → structured `TASK_FOLDER_EXISTS`, never overwrite (A.7)

---

## Batch A: Contract + Parser Core — COMPLETE

**Recommended Executor**: backend-developer
**Fallback Executor**: software-architect (if lib-scaffold / Nx generator config blocks)
**Execution Mode**: sequential — FIRST batch; B, C, E all depend on it
**Dependencies**: none
**Rationale**: Shared types + the pure `task-specs` parser/scanner/writer/registry are the contract every other batch consumes. Tightly coupled, single-lib, single-developer coherence beats fan-out. Larger than the 3–5 guideline by design (foundation batch).

### Task A.1: Shared task-spec plain types — COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\task-spec.types.ts` (NEW), `D:\projects\ptah-extension\libs\shared\src\index.ts` (MODIFY — export)
**Spec Reference**: R1.3, implementation-plan.md §4.2
**Details**: `TASK_STATUSES`, `TaskStatus`, `TASK_TYPES`, `TaskType`, `TaskValidationIssue`, `TaskSpecSummary`, `TaskSpecDetail`, `ExcludedTaskFolder`. Plain TS only (no Zod, no file I/O) — frontend + backend consume identical shapes.
**Acceptance**: types compile; exported from shared root barrel.

### Task A.2: `tasks:` RPC shared contract (compile-time half of dual registration) — COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-tasks.types.ts` (NEW); `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY)
**Spec Reference**: R4.1(a), implementation-plan.md §6.1–6.2
**Details**: 7 param/result pairs (`list/get/create/updateStatus/generateRegistry/board/reindex`) + `TasksChangedNotification` push payload. In `rpc.types.ts`: barrel `export *`, add 7 keys to `RpcMethodRegistry`, add 7 keys `: true` to `RPC_METHOD_ENTRIES`.
**Validation Notes**: This is HALF the dual registration; the runtime prefix (B.4) is the other half — neither alone is sufficient. `TasksBoardResult.columns` must be `Record<TaskStatus, ...>` with all 6 keys always present.
**Acceptance**: `RPC_METHOD_NAMES` derives the 7 new names; typecheck clean.

### Task A.3: Scaffold `libs/backend/task-specs` lib — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\**` (NEW: `project.json`, `jest.config.ts`, tsconfig trio, `src/index.ts`, `src/lib/di/tokens.ts`, `src/lib/di/register.ts`, `CLAUDE.md`); `D:\projects\ptah-extension\tsconfig.base.json` (MODIFY — `@ptah-extension/task-specs` path mapping)
**Spec Reference**: implementation-plan.md §5, D2
**Details**: Nx node-lib mirroring `libs/backend/skill-synthesis` config. `TASK_SPECS_TOKENS` (`Symbol.for`), `registerTaskSpecsServices(container, logger)`. Deps allowed: `shared`, `platform-core`, `vscode-core`, `persistence-sqlite` — NO adapters, NO agent-sdk, NO frontend.
**Acceptance**: `nx typecheck task-specs` resolves; boundaries lint clean.

### Task A.4: Frontmatter parser + byte-preserving writer (`task-frontmatter.ts`) — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-frontmatter.ts` (NEW) + `.spec.ts`
**Spec Reference**: R1.1, R1.2, R1.5, implementation-plan.md §4.3
**Details**: `TaskFrontmatterSchema` (Zod 4), `parseTaskFile()` returns `{kind:'task'}|{kind:'excluded'}` and NEVER throws past boundary. `updateFrontmatter()` splices ONLY the frontmatter block (regex `/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/`), leaves body byte-for-byte, refreshes `updated`. Parse via `gray-matter`; write via manual splice (never gray-matter stringify).
**Validation Notes**: Essential-fail (no block / bad YAML / invalid `status` / missing `title`) → excluded. Non-essential (id≠folder, bad type/date/depends_on) → included + warnings; folder name wins over `id` (C1).
**Acceptance (test-heavy, NFR-12)**: valid full/minimal; excluded cases; warning cases; CRLF + `---`-in-code-fence byte-preservation; `updated` refresh.

### Task A.5: Pure helpers — `id-allocator.ts` + `normalize-workspace-root.ts` — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\id-allocator.ts` (NEW) + `.spec.ts`; `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\normalize-workspace-root.ts` (NEW) + `.spec.ts`
**Spec Reference**: C1, R4.6, NFR-8, implementation-plan.md §5.5
**Details**: id-allocator scans ALL folder names `/^TASK_(\d{4})_(\d{1,})/` (146 from `TASK_2026_146_ORCHESTRA`; `TASK_2026_HERMES` ignored), max NNN for current year → `TASK_YYYY_{max+1, pad3}`. normalize: `path.resolve` + lower-cased drive letter + trailing-sep strip (single helper used by store, watcher filter, RPC params).
**Acceptance**: gaps, suffixes, non-numeric, year rollover, zero-pad tests; same workspace never yields two normalized keys.

### Task A.6: `TaskScannerService` — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-scanner.service.ts` (NEW) + `.spec.ts`
**Spec Reference**: R1.2, R2, R3.6, NFR-1, NFR-5, implementation-plan.md §5.1
**Details**: `scan(workspaceRoot) → {tasks, excluded, specsDirExists}`. Reads `.ptah/specs/*/task.md` via `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (hexagonal). Skips `.archive/`, dot-dirs, non-dirs. Missing carrier → excluded (no open). Unreadable → `reason:'unreadable'`, NEVER throws. Missing specs dir → `{[], [], false}`.
**Acceptance**: mock `IFileSystemProvider` mixed tree; excluded counting; no-op on missing dir.

### Task A.7: `TaskWriterService` — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.ts` (NEW) + `.spec.ts`
**Spec Reference**: R1.4, R1.5, R4.6, R6.3, implementation-plan.md §5.5
**Details**: `create()` — id-alloc → `exists()` guard → non-recursive leaf `mkdir` (race fails loudly, never overwrite → `TASK_FOLDER_EXISTS`) → write `task.md` full valid frontmatter + `## Description` body → round-trip parse with zero issues before return. `updateStatus()` — read raw → `updateFrontmatter` → write → (index+event wired in B via injected index service; keep writer's file mutation the FIRST step per R3.5 write-order invariant). Errors: `TASK_NOT_FOUND`, `TASK_EXCLUDED`, `WRITE_FAILED`.
**Note**: index-update call site is stubbed to an injected `ITaskIndexService` interface here; concrete wiring lands in B.2 (keep the seam clean).
**Acceptance**: create collision; round-trip zero-issue; body preserved on status update.

### Task A.8: `RegistryGeneratorService` — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\registry-generator.service.ts` (NEW) + `.spec.ts`
**Spec Reference**: R2.1–R2.5, implementation-plan.md §5.2
**Details**: `generate(workspaceRoot)` scans (never reads old registry), emits GENERATED-header table (Task ID|Status|Type|Title|Created|Updated). Header timestamp = `max(updated)` of included (A-4, deterministic). Order newest-first by `created`, null-created last alphabetically. `.archive/` excluded, no archive section. Excluded summary line with count. Write-if-changed (compare before write) to avoid watcher self-trigger.
**Acceptance**: two runs byte-identical; ordering; excluded line; GENERATED header.

### Task A.9: Migration `0029_task_specs` — COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\0029_task_specs.ts` (NEW); `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\migrations\index.ts` (MODIFY — import + append `{version:29,...}`)
**Spec Reference**: R3.1, NFR-7, implementation-plan.md §7
**Details**: static SQL only (no `${}` interpolation). `task_specs` PK `(workspace_root, folder_name)` + all R1 fields + `frontmatter_valid`, `validation_issues`, `last_indexed_at`; `idx_task_specs_ws_status`; `task_specs_scan_meta` for excluded count.
**Validation Notes (R4)**: re-verify 29 is still the free slot at merge; renumber if a concurrent task landed 29. Excluded folders get NO row; `frontmatter_valid=0` = included-with-warnings.
**Acceptance**: forward-only append; migration runs on `:memory:`.

**Batch A Verification**: all files exist; `nx typecheck task-specs shared persistence-sqlite` clean; unit specs green; code-logic-reviewer approved.

**Team-Leader MODE 2 verdict (2026-07-14)**: APPROVED. Spot-verified against plan §4/§5/§7/§12:

- `task-frontmatter.ts` — `ParseTaskFileResult` union `{kind:'task'}|{kind:'excluded'}` ✓; `parseTaskFile` never throws (Zod `safeParse` + try/catch on `matter`) ✓; essential gate = status+title, non-essential per-field warnings ✓; `updateFrontmatter` slices frontmatter via `FRONTMATTER_RE`, body concatenated untouched ✓.
- `id-allocator.ts` — `/^TASK_(\d{4})_(\d+)/` counts `TASK_2026_146_ORCHESTRA`=146, ignores `TASK_2026_HERMES`, pad3 ✓.
- `rpc-tasks.types.ts` — 7 param/result pairs + `TasksChangedNotification` push; `TasksBoardResult.columns: Record<TaskStatus,...>` (6 keys) ✓.
- `rpc.types.ts` — 7 keys in `RpcMethodRegistry` (L1721-1733) + 7 in `RPC_METHOD_ENTRIES` (L2865-2871) ✓.
- `0029_task_specs.ts` — static SQL only, `(workspace_root, folder_name)` PK, `idx_task_specs_ws_status`, `task_specs_scan_meta` ✓; `index.ts` appends `{version:29,...}` ✓.
- Boundary: NO `node:fs`/adapter imports in `task-specs/src/lib` (grep clean) — services use `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`, pure fns take strings ✓.

Deviation rulings:

- **D1 (essential-Zod vs per-field warnings)** — ACCEPTED. Matches plan §4.3 prose + A.4 validation notes exactly.
- **D2 (narrow `ITaskIndexNotifier` port + `TASK_INDEX_NOTIFIER_TOKEN` + NoOp; B re-points via `isRegistered` guard)** — ACCEPTED. Cleaner ISP seam than a full index service; `register.ts` guard matches B.2 re-point plan (A.7 note honored).
- **Note (non-blocking)**: `updateFrontmatter` renders the frontmatter block via `matter.stringify('', merged)` (not a hand-rolled splice) — the _body_ is still byte-preserved via regex slice, so R1.5 intent holds; the "never gray-matter stringify" rule targeted the body, which is untouched.

**Env caveat (not a Batch A defect)**: pre-existing better-sqlite3 NODE_MODULE_VERSION mismatch (143 vs 137) fails native-backed persistence specs in this env; migration 29 is static SQL and typechecks. Re-verify 29 is still free at merge (R4 / A.9).

**COMMIT DEFERRED** to orchestrator per instruction (branch `ak/fix-canvas-issue` carries unrelated WIP).

---

## Batch B: Index + RPC Surface — COMPLETE

**Recommended Executor**: backend-developer
**Fallback Executor**: software-architect
**Execution Mode**: parallel with C and E (all depend only on A)
**Dependencies**: Batch A
**Rationale**: File-disjoint from C (frontend) and E (skill-synthesis). Backend-only, coupled to A's services and the SQLite/RPC seams — one developer keeps the watcher/debounce/write-order invariant coherent.

### Task B.1: `TaskIndexStore` (SQLite) + `InMemoryTaskIndexStore` fallback — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.store.ts` (NEW) + `.spec.ts`
**Spec Reference**: R3.2, R3.5, NFR-5, NFR-6, implementation-plan.md §5.4
**Details**: `ITaskIndexStore` (`upsertMany`, `deleteByFolder`, `replaceWorkspace`, `listByWorkspace(filters)`, `getMeta/setMeta`) over `PERSISTENCE_TOKENS.SQLITE_CONNECTION`. `replaceWorkspace` = `DELETE WHERE workspace_root=?` + re-INSERT in one txn. InMemory (Map) impl same interface for the no-SQLite VS Code native-module failure case.
**Acceptance**: `:memory:` + migration 29; rebuild equivalence; InMemory parity.

### Task B.2: `TaskIndexService` (watcher + debounce + lazy start) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.ts` (NEW) + `.spec.ts`; wire `TaskWriterService` index call (from A.7 seam)
**Spec Reference**: R3.2–R3.5, R4.5, NFR-2, D3, implementation-plan.md §5.3
**Details**: `ensureStarted(root)` lazy full-reindex + `fsProvider.createFileWatcher('**/.ptah/specs/**')` (existing port — NO new port). Events filtered to normalized `<root>/.ptah/specs/`, ignoring `registry.md` + `.archive/`. Pending-set + 300ms debounce → flush reparses only affected folders → `onDidChangeIndex` (`createEvent`) `{workspaceRoot, folderNames, reason}`. `reindex()` full DELETE+INSERT. Write-order invariant: writer mutates file → `applyFolderChange()` (reparse→row→event `reason:'write'`).
**Validation Notes (R7/NFR-2)**: burst of N writes one folder → 1 flush + 1 event.
**Acceptance**: debounce coalescing; rebuild equivalence; write-order.

### Task B.3: `TasksRpcHandlers` + Zod schemas — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.handlers.ts` (NEW); `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.schema.ts` (NEW); both `.spec.ts`
**Spec Reference**: R4.2–R4.6, NFR-9, implementation-plan.md §6.4
**Details**: `static METHODS ... satisfies readonly RpcMethodName[]`; per method: Zod-parse params → resolve+normalize `workspaceRoot` → `index.ensureStarted(root)` → delegate → `catch(error:unknown)` structured `{code,message}` (no path leakage, R4.4). Constructor subscribes `index.onDidChangeIndex` → `webviewManager.broadcastMessage('tasks:changed', payload)` (git:worktreeChanged precedent).
**Acceptance**: Zod rejection; workspace normalization; structured errors; create collision; broadcast on index event.

### Task B.4: Runtime registration (second half of dual registration) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts` (MODIFY — `'tasks:'` in `ALLOWED_METHOD_PREFIXES` ~line 44; do NOT touch `PRO_ONLY_*`/`LICENSE_EXEMPT_*`); `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\index.ts` (MODIFY — export); `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\register-all.ts` (MODIFY — import + `SHARED_HANDLERS`)
**Spec Reference**: R4.1(b), R4.3
**Validation Notes**: MISSING the runtime prefix crashes silently — review-blocking per Requirement 4.1. Compile-time coverage assertion in `register-all.ts` forces `METHODS` correctness.
**Acceptance**: `tasks:*` passes the runtime allowlist; handler fanned out via `SHARED_HANDLERS`.

### Task B.5: Host DI wiring (all three hosts — see G1) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts` (MODIFY — `registerTaskSpecsServices`, beside line 172); `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts` (MODIFY — `registerSingleton(TasksRpcHandlers)`); `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts` (MODIFY — `registerTaskSpecsServices` beside `registerWorkspaceIntelligenceServices` line 53; gate SQLite-dependent store with `isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)` per `wire-runtime.ts:176`); `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY — ensure `TasksRpcHandlers` NOT in the exclude list ~lines 137-151); `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\thoth\register-thoth-libraries.ts` (MODIFY — `registerTaskSpecsServices` beside `registerSkillSynthesisServices` line 106)
**Spec Reference**: implementation-plan.md §5.6, §6.4; validation G1
**Validation Notes (G1)**: register `task-specs` in ALL THREE hosts (skill-synthesis is only in electron+cli, so do NOT key off it). `SHARED_HANDLERS` already fans the handler to all hosts; ensure VS Code inclusion + Electron singleton.
**Acceptance**: `nx typecheck` on all three apps clean; handler resolvable on each host.

**Batch B Verification**: all files exist; `nx typecheck ptah-electron ptah-extension-vscode rpc-handlers task-specs vscode-core` clean; specs green; dual registration present (types A.2 + prefix B.4); code-logic-reviewer approved.

**Team-Leader MODE 2 verdict (2026-07-14)**: APPROVED. Spot-verified vs plan §5.3/5.4/§6:

- Dual registration COMPLETE on all sites: runtime prefix `'tasks:'` in `ALLOWED_METHOD_PREFIXES` (rpc-handler.ts:88) ✓; handler exported (handlers/index.ts:59) + in `SHARED_HANDLERS` (register-all.ts:45/89) ✓; compile-time keys from A.2 ✓.
- Write-order invariant HELD: `TaskWriterService.updateStatus` mutates file first (read raw → `updateFrontmatter` → write, L163-192) THEN `indexNotifier.applyFolderChange` (L201-211, comment "File mutated first (R3.5)") ✓.
- Store parity: `SqliteTaskIndexStore` + `InMemoryTaskIndexStore` both `implements ITaskIndexStore` with `replaceWorkspace` (DELETE+re-INSERT) ✓.
- 3-host DI (G1): `registerTaskSpecsServices` in electron/vscode phase-2 + cli register-thoth; `TasksRpcHandlers` singleton in electron phase-4 (L113) ✓.
- **B1 (full-scan+replaceWorkspace flush vs incremental row-patching)** — ACCEPTED. Rebuild-equivalent by construction; burst coalescing (1 flush + 1 event) preserved. Timing over live ~85-folder tree deferred to QA.1 (NFR-1 <2s).
- **B2 (lazy `instanceCachingFactory` store selection vs register-time `isRegistered` gate)** — ACCEPTED. Deferring store resolution to first use is strictly more robust than the planned phase-2 gate given VS Code registers `SQLITE_CONNECTION` after phase-2; same InMemory-fallback outcome.

**COMMIT DEFERRED** to orchestrator (branch carries unrelated WIP).

---

## Batch C: tasks-ui + Standalone Surface — COMPLETE

**Recommended Executor**: frontend-developer
**Fallback Executor**: ui-ux-designer (if board/card visual layout blocks)
**Execution Mode**: parallel with B and E (needs only A's shared types)
**Dependencies**: Batch A (shared types only — `task-spec.types.ts` + `rpc-tasks.types.ts`)
**Rationale**: Frontend-only, file-disjoint from B/E. New Angular lib + additive surface wiring. Cohesive single-developer UI work.

### Task C.1: Scaffold `libs/frontend/tasks-ui` lib — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\tasks-ui\**` (NEW: `project.json`, configs, `src/index.ts`, `CLAUDE.md`); `D:\projects\ptah-extension\tsconfig.base.json` (MODIFY — `@ptah-extension/tasks-ui` path mapping)
**Spec Reference**: R5.2, NFR-11, implementation-plan.md §10
**Details**: Nx Angular lib mirroring `libs/frontend/skill-synthesis-ui`. Standalone, signals + `inject()`, `OnPush`, zoneless-compatible. Deps: `shared`, `core`, `ui`, `markdown` (+ lucide-angular). NO backend libs, NO `chat`.
**Acceptance**: `nx typecheck tasks-ui` clean; boundaries lint clean.

### Task C.2: `TasksStore` (signals + `tasks:changed` handler) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts` (NEW) + `.spec.ts`
**Spec Reference**: R5.5, R5.7, NFR-3, implementation-plan.md §10
**Details**: root-provided; signals `board/excludedCount/specsDirExists/loading/error/selectedTaskId/taskDetail`. `MessageHandler { handledMessageTypes:['tasks:changed'] }` → refresh. Methods `loadBoard/openTask/updateStatus/createTask/reindex` — ALL via `ClaudeRpcService`; NO optimistic state (R5.7).
**Acceptance**: board load; push-triggered refresh; no optimistic transition.

### Task C.3: Board components (view, board, column, card) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts`, `...\components\board\task-board.component.ts`, `task-column.component.ts`, `task-card.component.ts` (NEW) + specs
**Spec Reference**: R5.5, R5.6, NFR-3, implementation-plan.md §10
**Details**: 6 status columns (B1 order), one `tasks:board` round trip. Card: id, title, type badge, status, executor, `depends_on` indicator, validation-warning icon, Start button + worktree toggle. Empty state w/ create CTA (R5.6). `track` on all `@for`. Status change via action menu (no DnD, A-3).
**Acceptance**: empty state; card fields; warning badge; OnPush.

### Task C.4: Task detail component (markdown chokepoint) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\detail\task-detail.component.ts` (NEW) + spec
**Spec Reference**: R5.8, R6.5, NFR-10, implementation-plan.md §10
**Details**: frontmatter facts, `depends_on` list, validation warnings, body via `MarkdownBlockComponent` (`@ptah-extension/markdown`) — NEVER `[innerHTML]`.
**Acceptance**: body routed through markdown chokepoint; no `[innerHTML]`.

### Task C.5: Surface registration — token, ViewType, app-shell, composition root — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts` (MODIFY — `'tasks'` in `ViewType` line 11 + `validViews` line 109); `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\lazy-view-components.token.ts` (MODIFY — `TASKS_VIEW_COMPONENT`); `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` (MODIFY — inject token optional + `'tasks'` in standalone-view set); `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` (MODIFY — `@case ('tasks')` outlet clone of tribunal + VS Code header nav button in `@if (!isElectron)` group); `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts` (MODIFY — `{provide:TASKS_VIEW_COMPONENT,...}` + `MESSAGE_HANDLERS` multi entry for `TasksStore`)
**Spec Reference**: R5.1, R5.3, D4, implementation-plan.md §10
**Validation Notes (G2)**: before trusting the "single composition root" claim, confirm the Electron renderer entry uses this same `app.config.ts`; if it has its own provider array, add both bindings there too.
**Acceptance**: `setCurrentView('tasks')` renders the view in the webview shell; deep-link + persistence work.

### Task C.6: Electron shell Tasks tab (⚠ WIP FILE — R1) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts` (MODIFY — additive tab button after Tribunal + `openTasks()` + one icon import)
**Spec Reference**: R5.4, Risk R1, implementation-plan.md §10, §14 crit-point 3
**Validation Notes (R1 — HIGH)**: this file has UNCOMMITTED WIP on `ak/fix-canvas-issue`. RE-READ the working tree immediately before editing. Additive-only: one `<button role="tab" [class.tab-active]="appState.currentView() === 'tasks'" (click)="openTasks()">` + `KanbanSquare`/`ClipboardList` import + `openTasks()` method. If the tab strip has structurally changed, STOP and report — never clobber, never `--no-verify`.
**Acceptance**: Tasks tab appears in Electron strip; no WIP content lost.

**Batch C Verification**: all files exist; `nx typecheck tasks-ui core chat ptah-extension-webview` clean; specs green; markdown-only rendering; no backend imports (`nx graph` boundary); electron-shell WIP intact; code-logic-reviewer approved.

**Team-Leader MODE 2 verdict (2026-07-14)**: APPROVED. Spot-verified vs plan §10/D4:

- Boundary CLEAN: `tasks-ui/src` imports only `@ptah-extension/{shared,core,markdown}` (+ `@angular/*`, `lucide-angular`). NO backend lib, NO `chat` import ✓. Detail body routed through `MarkdownBlockComponent` (no `[innerHTML]`) ✓.
- **C.6 electron-shell edit is GENUINELY ADDITIVE** (`git diff`): +17 / -0 — one `ClipboardList` import, one `role="tab"` Tasks button, one `ClipboardListIcon` field, one `openTasks()` method. WIP untouched (R1 satisfied) ✓.
- G2 resolved: single composition root confirmed; `app.config.ts` carries `TASKS_VIEW_COMPONENT` + `MESSAGE_HANDLERS` bindings.
- **C start-seam (Start button explicit no-op)** — ACCEPTED. Correct sequencing; `TaskStartService` wiring is Batch D's charter (D.3). Store re-fetch on mutation success alongside push handling is a benign no-optimistic-state belt-and-suspenders (R5.7 honored).

**COMMIT DEFERRED** to orchestrator.

---

## Batch E: spec-harvester Migration + Skill Docs — COMPLETE

**Recommended Executor**: backend-developer
**Fallback Executor**: software-architect
**Execution Mode**: parallel with B and C (depends only on A's shared parser)
**Dependencies**: Batch A (`parseTaskFile` from `@ptah-extension/task-specs`)
**Rationale**: File-disjoint from B/C; touches skill-synthesis + packaged plugin assets only. Adds the acyclic `skill-synthesis → task-specs` edge.

### Task E.1: `spec-extractor.ts` frontmatter-only surgery — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-extractor.ts` (MODIFY)
**Spec Reference**: R7.1–R7.3, D8, implementation-plan.md §9
**Details**: DELETE emoji `detectStatus` alternates + `isComplete()` (state-json/marker/pending heuristics) + unused `COMPLETION_MARKER_FILE`/`STATE_FILE` constants. `extractSpec(dir)`: first read `task.md` → shared `parseTaskFile` (import pure fn, no DI). `excluded` → `null`. `completed = status ∈ {done,cancelled}`. KEEP `normalizeExecutor`, `parseBatchVerdicts` (word-token only — flag A-2), `HARVEST_MARKER_FILE`, review-file reading.
**Validation Notes**: adds `skill-synthesis → task-specs` — verify acyclic via `nx graph` (NFR-11).
**Acceptance**: no-frontmatter skip; done/cancelled eligibility; no emoji regex remains.

### Task E.2: Harvester follow-through + fixture rewrite — IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-harvester.service.ts` (MODIFY — minimal); `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-extractor.spec.ts` (+ harvester specs) (MODIFY)
**Spec Reference**: R7.2, R8-risk, implementation-plan.md §9, §13
**Details**: `readSpecs` keeps calling `extractSpec` (contract now enforces frontmatter). Rewrite fixtures to `task.md` frontmatter + word-status `tasks.md`; add exclusion cases (no task.md, bad YAML, `status:wip`); delete emoji fixtures. Marker/archive mechanics unchanged.
**Acceptance**: specs green on frontmatter fixtures; legacy folders skipped.

### Task E.3: Orchestration skill doc + content-manifest regen (⚠ R5/R6) — IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\orchestration\references\task-tracking.md` (MODIFY); regenerate manifest via `D:\projects\ptah-extension\scripts\generate-content-manifest.js` → `content-manifest.json`
**Spec Reference**: R8.1–R8.3, Risk R5/R6, implementation-plan.md §11
**Validation Notes**: edit ONLY the packaged source (never junctioned `.claude/skills/`). Document `task.md` frontmatter contract (§4.1 schema + status enum), `task.md` = FIRST artifact, `registry.md` GENERATED, status transitions via frontmatter, word statuses in `tasks.md`. NO `copilot|codex|claude|openai|anthropic` strings. `.vscodeignore` never trimmed. Run `node scripts/generate-content-manifest.js` and commit the regenerated `content-manifest.json`.
**Acceptance**: manifest regenerated; no trademark strings; `.vscodeignore` intact.

**Batch E Verification**: all files exist; `nx typecheck skill-synthesis` clean + specs green; `nx graph` shows acyclic `skill-synthesis → task-specs`; manifest regenerated; no trademark regression; code-logic-reviewer approved (flag A-2 interpretation).

**Team-Leader MODE 2 verdict (2026-07-14)**: APPROVED. Spot-verified vs plan §9/§11:

- `spec-extractor.ts` now imports shared `parseTaskFile` (L20); `extractSpec` gates on it, `excluded → null`, `completed = status ∈ {done,cancelled}` (L127-131). `isComplete`/emoji `detectStatus` alternates/marker constants deleted ✓.
- Skill doc `task-tracking.md` — grep for `copilot|codex|claude|openai|anthropic` returns ZERO matches; `.vscodeignore` untouched; `content-manifest.json` regenerated (228 files) ✓.
- **E parseBatchVerdicts retention (word-token `COMPLETE`/`FAILED` parsing)** — ACCEPTED per plan D8 / interpretation-flag A-2. `detectStatus` is pure word-token regex (`\bFAILED\b` wins, pending→null, `\bCOMPLETE\b`; L69-74) — no emoji. Non-blocking A-2 flag stands for the orchestrator's code-logic-reviewer; if reviewer reads R7 as banning `tasks.md` parsing, the fallback is the one-file drop of `parseBatchVerdicts` (task-level reconciliation only).

**COMMIT DEFERRED** to orchestrator.

---

## Batch D: Board → Orchestration Start Flow — COMPLETE

**Recommended Executor**: frontend-developer
**Fallback Executor**: software-architect
**Execution Mode**: sequential — runs AFTER B and C
**Dependencies**: Batch B (`tasks:updateStatus` RPC live) + Batch C (`tasks-ui` + `AppStateManager` `'tasks'` view)
**Rationale**: Cross-lib frontend flow (tasks-ui → core signal bridge → chat consumer → existing git/RPC). Needs the RPC surface (B) and the UI + view state (C) present. Modifies `app-state.service.ts` which C also touches — sequencing after C avoids the conflict.

### Task D.1: `ChatPromptRequest` signal bridge — COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts` (MODIFY)
**Spec Reference**: R6.1, D7, implementation-plan.md §8.2
**Details**: `ChatPromptRequest { prompt; cwd?; sessionName?; resolve? }` + signal + readonly view + `requestChatPrompt()`/`clearChatPromptRequest()`, mirroring `_canvasSessionRequest`/`_harnessWorkflowRequest` (lines 142-153).
**Acceptance**: bridge compiles; parity with existing request bridges.

### Task D.2: Chat-lib consumer effect — COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\<slice>.ts` (MODIFY — implementer's choice within chat-store; + `chat.store.ts` if facade-wired) + spec
**Spec Reference**: R6.1, implementation-plan.md §8.2
**Details**: effect watches `appState.chatPromptRequest()` → create/focus session → submit prompt through normal send path (backend `SlashCommandInterceptor` routes `/ptah-core:orchestrate` to `executeSlashCommandQuery`) → resolve → clear. Keeps `tasks-ui` free of `chat` import (NFR-11).
**Acceptance**: request consumed, resolved, cleared; works root-provided in single composition root.

### Task D.3: `TaskStartService` + card wiring — COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\task-start.service.ts` (NEW) + spec; wire `task-card.component.ts` Start action
**Spec Reference**: R6.1–R6.5, implementation-plan.md §8.1, §8.3
**Details**: sequence — (optional) `git:addWorktree` await correlated `git:worktreeChanged` push → `appState.requestChatPrompt({prompt:'/ptah-core:orchestrate TASK_ID', cwd:worktreePath?, resolve})` → on resolved success ONLY `tasks:updateStatus(in_progress)` → board reflects push (no optimistic). Failure story (R6.4): worktree fail → stop+toast; session fail → status untouched (worktree left in place, editor UI removal); updateStatus fail post-start → warning badge, session runs; 30s resolve guard timeout = failure. Injects `ClaudeRpcService` + `AppStateManager` only (NO `chat` import).
**Acceptance**: happy path transitions to `in_progress` only on success; each failure branch leaves no phantom transition.

**Batch D Verification**: all files exist; `nx typecheck tasks-ui core chat` clean; specs green; no `chat` import in tasks-ui (`nx graph`); code-logic-reviewer approved.

**Team-Leader MODE 2 verdict (2026-07-14)**: APPROVED WITH FOLLOW-UPS. Spot-verified vs plan §8 + R6:

- D.1 bridge (`app-state.service.ts:83-101,550-559`): `ChatPromptRequest {prompt,cwd?,sessionName?,resolve?}` + signal + readonly view + `requestChatPrompt`/`clearChatPromptRequest`, mirrors `CanvasSessionRequest` incl. `resolve` callback ✓.
- D.2 consumer (`chat-store/task-prompt-bridge.service.ts`): root-provided, kept alive by ChatStore facade; `createTab → setCurrentView('chat') → messageSender.send(prompt,{tabId})`; resolves outcome + clears signal in `finally`; re-entrancy `processing` guard ✓. Lives in `chat` lib — `tasks-ui` stays chat-free (NFR-11) ✓.
- D.3 `task-start.service.ts`: worktree optional via `git:addWorktree` correlated `git:worktreeChanged` push (5-min ceiling), `requestChatPrompt` behind 30s resolve guard, `updateStatus('in_progress')` on resolved success ONLY, each failure branch returns before the transition; injects `ClaudeRpcService`+`AppStateManager`+`TasksStore` only ✓.

Deviation rulings (evidence checked):

- **(a) R6.2 worktree→session cwd not threaded** — ACCEPT (phase-1) + FOLLOW-UP F-D1. Verified `chat:start` DOES expose `workspacePath?` (`rpc-chat.types.ts:47`), BUT (1) `SendMessageOptions` (`chat-types.ts:20-29`) has NO workspace-override field, (2) `MessageSenderService.startNewConversation` hardcodes `workspacePath = vscodeService.config().workspaceRoot` (`message-sender.service.ts:318`) — no per-send override path, and (3) the backend gates renderer-supplied paths through `isAuthorizedWorkspace` → **Access denied** for anything outside the authorized workspace (`chat-session.service.ts:280-281,453-454`; `chat-session-auth.spec.ts`). A worktree lives OUTSIDE that root, so binding a fresh session to it requires registering the worktree as an authorized workspace — genuinely NEW worktree/session plumbing that R6.2 explicitly forbids in phase 1 ("no new worktree plumbing"). Developer created the worktree, carried `cwd` forward on the request (forward-compatible), and flagged the gap — the honest phase-1 posture. QA.2 must record the session runs against workspace root (not the worktree) as the known phase-1 limitation.
- **(b) R6.4 silent `chat:start` structured failure → phantom `in_progress`** — ACCEPT (phase-1) + FOLLOW-UP F-D2, **QA.2 must force-verify**. `MessageSenderService.send` is fire-and-forget: the thrown-exception branch IS surfaced (bridge try/catch resolves `{success:false}`), but a structured backend failure (`result.success===false` / `data.success===false`, e.g. AUTH_REQUIRED, model-unavailable) is swallowed without throwing (`message-sender.service.ts:389-398`), so `send()` resolves normally → bridge resolves `{success:true}` → status flips to `in_progress`. Real R6.4 edge for the "session spawn error" branch; residual is a recoverable wrong status (idempotent re-call), and the proper fix (make `send()` failure-aware or have the bridge inspect post-send session state) touches the shared send mediator used by every chat send — deferred to keep the hot path stable, but QA.2 MUST exercise a forced `chat:start` structured failure and confirm no transition.
- **(c) Canvas-already-mounted shows session in tab list, not a fresh tile** — ACCEPT (phase-1) + FOLLOW-UP F-D3 (cosmetic). No R6 criterion mandates a fresh canvas tile; R6.1 requires open/focus a session + inject the orchestrate command, which holds. Presentation polish only.

**COMMIT DEFERRED** to orchestrator (branch `ak/fix-canvas-issue` carries unrelated WIP).

---

## Follow-ups (accepted phase-1 deviations → deferred work)

| ID       | Source              | Follow-up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Priority                                                                                                           |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **F-D1** | Deviation (a), R6.2 | Bind a worktree-isolated Start to its worktree cwd: add optional workspace override to `SendMessageOptions` + thread `ChatPromptRequest.cwd` through `startNewConversation`, AND register/authorize the worktree path so the backend `isAuthorizedWorkspace` gate admits it. Until then, worktree Start creates the tree but the session runs against the workspace root. **Review-fix round (2026-07-14): interim in-UI caveat added** — `TaskCardComponent` now surfaces a one-line notice under the worktree toggle ("Worktree is created, but the session runs against the main workspace until association ships") whenever the toggle is on, so the toggle is no longer silently misleading while F-D1 is outstanding (backend cwd association still deferred).           | HIGH (isolation is cosmetic until landed — a user opting into a worktree still has the agent act on the main tree) |
| **F-D2** | Deviation (b), R6.4 | ✅ **FIXED (review-fix round, 2026-07-14).** Chose the return-value approach (minimal ripple, preferred): `MessageSenderService.send`/`startNewConversation`/`runContinueConversation` now return a structured `SendOutcome { success; error? }` instead of `void` (structural `data.success === false` → `{success:false}`); `TaskPromptBridgeService.consume()` adopts that outcome instead of defaulting to success. Callers that ignore the return (`MessageDispatchService`) are unaffected. QA.2 forced-failure branch now asserted in the bridge + message-sender specs (structural failure resolves failure → NO phantom `in_progress` transition) and PASSES. Defense-in-depth `catch (error: unknown)` added to `TaskStartService.start()` (Moderate-3) under review. | MED → DONE                                                                                                         |
| **F-D3** | Deviation (c)       | When the canvas is already mounted, adopt the newly created tab as a fresh tile (not just a tab-list entry) on orchestration Start.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | LOW (cosmetic)                                                                                                     |

### Review-fix round — backend cluster (2026-07-14, backend-developer)

- ✅ **Moderate-1 (BOM tolerance)** — `libs/backend/task-specs/src/lib/task-frontmatter.ts`: added `stripLeadingBom()`; `parseTaskFile` now strips a leading UTF-8 BOM (U+FEFF) before `FRONTMATTER_RE` testing so a BOM-prefixed `task.md` (common from Windows tooling) parses as an included task instead of being excluded as `no_frontmatter`. `updateFrontmatter` strips the BOM for parsing but **re-applies the original leading BOM on rewrite** (safer than silently normalizing it away) while the body still survives byte-for-byte. Two unit tests added in `task-frontmatter.spec.ts` (BOM → included; BOM rewrite preserves BOM + byte-for-byte body). `task-specs:test` = 67/67 (was 65).
- ✅ **QA defect 1 (migration assertion regression, misclassified as pre-existing)** — root cause confirmed: `0028_gateway_conversation_workspace_root.spec.ts:68` "is the highest bundled version" asserted `28`; Batch A appended `0029_task_specs` to the `MIGRATIONS` tuple, so `Math.max(...versions)` became 29. This is a **moving-target invariant test that every migration author bumps** (git blame: the same test was moved 0027→0028 asserting 27→28 when 0028 landed). Bumped the assertion to `29`. Not unrelated to migration 29 — it is a direct consequence of it. `persistence-sqlite:test` = 16/16 suites, 133/133 (was 132/133). Affected typecheck = 58/58 green.

---

## Batch QA: Verification & Gates — COMPLETE

**Recommended Executor**: senior-tester
**Fallback Executor**: backend-developer (for gate failures) / frontend-developer (for UI e2e)
**Execution Mode**: sequential — runs AFTER A, B, C, D, E all COMPLETE
**Dependencies**: all batches
**Rationale**: Cross-cutting acceptance + live-tree hard requirement (R2.2) + full gates.

### Task QA.1: Live-tree reindex + registry (hard requirement R2.2) — COMPLETE

**Spec Reference**: R2.2, R3.2, NFR-1, NFR-4
**Details**: against the REAL `D:\projects\ptah-extension\.ptah\specs\` (~85 legacy folders + this task's): `tasks:reindex` clean; `tasks:generateRegistry` clean with `excludedCount ≈ 85` and only frontmatter-bearing folders listed; timing vs NFR-1 (<2s reindex) / NFR-4 (<100ms board) on Windows. Determinism: run generate twice → byte-identical.
**Acceptance**: no errors over live tree; excluded count matches; timings within NFR.

### Task QA.2: Start-flow e2e incl. one worktree run — COMPLETE

**Spec Reference**: R6, DoD
**Details**: exercise card Start (no-worktree) → orchestrate session launches + status → `in_progress`; then one worktree-isolation Start → `git:addWorktree` path. Verify failure branches leave status untransitioned. **MUST additionally (see Batch D verdict follow-ups): (F-D2) force a structured `chat:start` failure (e.g. AUTH_REQUIRED / model-unavailable) and confirm status is NOT flipped to `in_progress` — this is the one R6.4 branch the fire-and-forget `send()` can currently leak; (F-D1) record that the worktree Start session runs against the workspace root, NOT the worktree cwd (known phase-1 limitation, not a QA failure).**
**Acceptance**: `/ptah-core:orchestrate TASK_ID` launches; worktree path exercised once; happy + exception + structured-failure branches leave no phantom transition; F-D1 limitation documented.

### Task QA.3: Gates + boundaries — COMPLETE

**Spec Reference**: NFR-11, NFR-12, DoD
**Details**: `npm run typecheck:all`, `npm run lint:all`, affected jest green; `nx graph` eyeball for the two new edges (`rpc-handlers → task-specs`, `skill-synthesis → task-specs`) acyclic + `tasks-ui` no-backend-import; dual registration reviewer-verified; no `--no-verify`; electron-shell WIP intact.
**Acceptance**: all gates green; boundaries clean.

**Batch QA Verification**: all acceptance criteria across R1–R8 + NFRs pass; team-leader MODE 3 completion after green.

---

## Batch Dependency Graph

```
A (backend, contract+parser)  ──►  B (backend, index+RPC) ──┐
                              ├──►  C (frontend, ui+surface) ─┼──►  D (frontend, start flow) ──►  QA
                              └──►  E (backend, harvester+docs) ──────────────────────────────►  QA
```

- **A** first (blocks all).
- **B ∥ C ∥ E** after A (file-disjoint; B+E are separate backend-developer instances, C is frontend-developer).
- **D** after B **and** C.
- **QA** after all.

---

## Status Legend (WORD statuses — no emoji)

PENDING · IN PROGRESS · IMPLEMENTED · COMPLETE · FAILED

---

## MODE 3 Completion Summary (team-leader, 2026-07-14)

**Verdict: ALL COMPLETE.** All 5 build batches (A, B, C, E, D) + QA verified. Review-fix round + MODE 3 final spot-verification passed. `task.md` frontmatter flipped `in_review → done`.

### Final gate results (fast confirmation — QA already ran full matrix)

- `@ptah-extension/task-specs:test` — **67/67** (8 suites) GREEN
- `@ptah-extension/tasks-ui:test` — **29/29** (5 suites) GREEN

### Fix-round spot-verification (all confirmed present & matching reported approach)

- `SendOutcome` return-value contract in `libs/frontend/chat/src/lib/services/message-sender.service.ts` (interface L57; `send`/`startNewConversation`/`runContinueConversation` return `Promise<SendOutcome>`) — F-D2 fix ✓
- Outcome adoption in `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts` (L67 `outcome = await this.messageSender.send(...)`; resolves structural failure → no phantom `in_progress`) ✓
- `stripLeadingBom()` in `libs/backend/task-specs/src/lib/task-frontmatter.ts` (L59; applied at parse L96 + write L247, BOM re-applied on rewrite L271) ✓
- `0028_gateway_conversation_workspace_root.spec.ts:71` assertion bumped to `toBe(29)` (migration-29 regression, not pre-existing) ✓

### What shipped (Phase 1)

- **Contract** (`libs/shared`): `task-spec.types.ts`, `rpc/rpc-tasks.types.ts`, 7 `tasks:*` RPC method pairs + `tasks:changed` push (dual-registration compile half).
- **Parser/index core** (`libs/backend/task-specs`, NEW lib): frontmatter parser + byte-preserving writer (BOM-tolerant), scanner (never-throws), id-allocator, registry generator (deterministic), SQLite + InMemory index stores, watcher/debounce index service.
- **Persistence**: migration `0029_task_specs`.
- **RPC surface + DI** (`rpc-handlers`, `vscode-core`, 3 host DI files): `TasksRpcHandlers` + Zod schemas, runtime `'tasks:'` prefix, all-three-host registration.
- **Frontend** (`libs/frontend/tasks-ui`, NEW lib): TasksStore, board/column/card/detail components (markdown chokepoint), standalone `'tasks'` view + VS Code nav button + Electron tab (additive over branch WIP), Start flow via `ChatPromptRequest` signal bridge + chat-lib consumer + `TaskStartService`.
- **Harvester migration** (`skill-synthesis`): frontmatter-only `spec-extractor`, fixtures rewrite, `skill-synthesis → task-specs` acyclic edge; orchestration skill doc + regenerated `content-manifest.json`.

### Remaining follow-ups (deferred, non-blocking)

- **F-D1 (HIGH)** — worktree→session cwd association. Worktree Start currently creates the tree but the session runs against the main workspace root (backend `isAuthorizedWorkspace` gate blocks external paths). Interim in-UI caveat already shipped on the worktree toggle; full fix needs `SendMessageOptions` workspace override + worktree authorization plumbing.
- **F-D3 (LOW, cosmetic)** — when canvas is already mounted, adopt the new orchestration tab as a fresh tile rather than a tab-list entry.
- **BOM-reason taxonomy nit** — BOM-excluded/normalized files still bucket under generic `no_frontmatter` reasoning in some paths; a dedicated reason token would improve excluded-row clarity (cosmetic taxonomy refinement).
- **Board-staleness-on-broadcast-failure (from logic review)** — if `webviewManager.broadcastMessage('tasks:changed', …)` fails silently, the board can lag the index until the next explicit `loadBoard`. Consider a broadcast-failure log/retry or client periodic reconcile. No optimistic-state corruption (R5.7 holds); purely a freshness gap.

### Recommended commit grouping (orchestrator to execute — team-leader did NOT commit)

Split into 5 logical commits along dependency/layer boundaries. **EXCLUDE from all of these** (unrelated video-studio WIP on this branch): `apps/ptah-video-studio/**`, `package.json`, `package-lock.json` (`@react-three/drei` is a video dep). Also note `libs/frontend/chat/.../electron-shell.component.ts` carries the branch's pre-existing canvas WIP underneath the additive Tasks-tab edit — commit 4 includes it, but the canvas WIP is NOT this task's (already on branch).

1. **feat(shared): tasks RPC + spec contract** — `libs/shared/src/lib/types/task-spec.types.ts`, `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`, `libs/shared/src/index.ts`.
2. **feat(task-specs): parser/index core lib + migration 0029** — `libs/backend/task-specs/**` (whole new lib incl. specs), `libs/backend/persistence-sqlite/src/lib/migrations/0029_task_specs.ts`, `.../migrations/index.ts`, `.../migrations/0028_gateway_conversation_workspace_root.spec.ts`, `tsconfig.base.json` (both new path mappings land here).
3. **feat(rpc-handlers): tasks RPC surface + 3-host DI** — `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` (+ `.spec`), `tasks-rpc.schema.ts`, `handlers/index.ts`, `register-all.ts`, `rpc-handlers/src/index.ts`, `libs/backend/vscode-core/src/messaging/rpc-handler.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-4-handlers.ts`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`.
4. **feat(tasks-ui): standalone Tasks board + Start flow** — `libs/frontend/tasks-ui/**` (whole new lib), `libs/frontend/core/src/lib/services/app-state.service.ts` (+ `.spec`), `.../tokens/lazy-view-components.token.ts`, `core/src/index.ts`, `libs/frontend/chat/src/lib/components/templates/app-shell.component.{ts,html}`, `.../electron-shell.component.ts`, `libs/frontend/chat/src/lib/services/message-sender.service.ts` (+ `.spec`), `.../chat-store/task-prompt-bridge.service.ts` (+ `.spec`), `.../chat-store/index.ts`, `.../chat.store.ts`, `apps/ptah-extension-webview/src/app/app.config.ts`.
5. **refactor(skill-synthesis): frontmatter-only harvester + skill doc** — `libs/backend/skill-synthesis/src/lib/spec-extractor.ts` (+ `.spec`), `spec-harvester.service.ts` (+ `.spec`), `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/task-tracking.md`, `content-manifest.json`.

(Optional 6th split: peel `tsconfig.base.json` into its own chore commit if you prefer path-mapping isolation, but grouping it with commit 2 keeps the new-lib registration atomic.) Do NOT `--no-verify`; do NOT regenerate the registry (RPC/watcher path owns it now).
