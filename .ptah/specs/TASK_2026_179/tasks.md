# Development Tasks — TASK_2026_179

**Total Tasks**: 23 | **Batches**: 6 | **Status**: 6/6 COMPLETE
**Phase 1 commit**: `b7b24500f` — 32 files
**Phase 2 commit**: `f80fa299c` — 44 files
**Gate**: 11 projects green, two consecutive clean runs, no flaky notice.
**Type**: REFACTORING (Partial depth)
**Source of truth**: `context.md` in this folder IS the implementation plan.
There is deliberately no `implementation-plan.md`. Do NOT re-derive the design.
Do NOT propose anything listed in the `## Rejected` section of `context.md`.
Do NOT re-verify the `## Verified code facts` — they are load-bearing.

---

## Shipping model — TWO independent commits

| Phase                                                         | Steps | Batches    | Commit                     |
| ------------------------------------------------------------- | ----- | ---------- | -------------------------- |
| Phase 1 — contract module, collider rename, data-plane README | 1–11  | 1, 2, 3, 4 | One commit, scope `vscode` |
| Phase 2 — callable write paths and adoption                   | 12–19 | 5, 6       | One commit, scope `vscode` |

**Batch boundaries never straddle the phase boundary.** Batches 1–4 are all
Phase 1; batches 5–6 are all Phase 2.

**Batches do NOT get individual commits.** Team-leader accumulates the batch
work and creates exactly one commit at each phase close-out (end of Batch 4,
end of Batch 6). Each batch header states a per-batch scope for traceability,
but the two real commits use the phase-level scope above.

**Allowed commitlint scopes** (there is no `shared` and no `task-specs` scope):
`webview, vscode, vscode-lm-tools, deps, release, ci, docs, hooks, scripts,
landing, license-server, electron, cli`.

---

## Verification gate

A phase is NOT committable until this command is green for the projects that
phase touched:

```
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers tasks-ui vscode-core platform-core platform-vscode platform-electron platform-cli skill-synthesis cli-engine
```

Run it and report actual output. Do not paraphrase a pass.

- **Phase 1 gate**: Task 4.3 (end of Batch 4). Blocks the Phase 1 commit.
- **Phase 2 gate**: Task 6.5 (end of Batch 6). Blocks the Phase 2 commit.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

The design is settled. Validation below covers only _implementation_ hazards
that fall out of the settled design — it does not reopen any decision.

### Assumptions carried forward (from `context.md`, not re-verified)

- `CARRIER_FILE = 'task.md'` is duplicated in three `task-specs` files.
- `ensureStarted` is today called only from `tasks-rpc.handlers.ts`.
- `IFileSystemProvider.createDirectory` is recursive; there is no `rename` and
  no exclusive write.
- `ALLOWED_METHOD_PREFIXES` already contains `tasks:` — step 18 needs no
  runtime-guard edit, only the compile-time `rpc-tasks.types.ts` half.
- The task-specs store selection is lazy with an in-memory fallback, so no
  SQLite column can gate anything.

### Risks identified

| #   | Risk                                                                                                                                                                                                                       | Severity | Mitigation                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | `createDirectoryExclusive` cannot be built on `vscode.workspace.fs.createDirectory` — it is recursive and does not reject EEXIST. A naive delegation silently produces a non-CAS that defeats the entire point of step 12. | HIGH     | Task 5.1: the VS Code adapter MUST use `node:fs/promises` `mkdir` **without** `recursive: true` (which throws `EEXIST`), or stat-then-create is explicitly NOT acceptable (TOCTOU). Shared contract test must assert the second call rejects with an EEXIST-typed error. |
| R2  | Step 9's CI ratchet will likely fail on pre-existing Phase-0 assets (agent templates, `orchestration/SKILL.md`) that name per-task `*.md` files outside `DOC_FILES`.                                                       | HIGH     | Task 4.2: author the allowlist from a real scan first. If an asset names a file outside `DOC_FILES`, fix the asset or widen `DOC_FILES` deliberately — do NOT weaken the guard to make it pass. Record which choice was made.                                            |
| R3  | Step 5 writes `.ptah/specs/README.md` from inside `ensureStarted`, and the same service watches that directory → self-triggered rebuild loop.                                                                              | HIGH     | Task 2.2 acceptance requires a unit test asserting exactly ONE rebuild across the README write (self-write suppression), not "no crash".                                                                                                                                 |
| R4  | Step 11 adds a second `ensureStarted` caller at host activation while `tasks-rpc.handlers.ts` still calls it on five paths — concurrent first-call race.                                                                   | MED      | Task 4.1 acceptance requires an idempotency test: two concurrent `ensureStarted` calls perform one rebuild and one README write.                                                                                                                                         |
| R5  | Step 4 extends the `updateStatus` error union with `TASK_CONFLICT`. Existing callers (`tasks-rpc.handlers.ts`) exhaustively switch on that union and will fail typecheck.                                                  | MED      | Task 2.1 must update `tasks-rpc.handlers.ts` in the same task and propagate the typed error over the existing RPC error channel. Do NOT add new UI for it — out of scope.                                                                                                |
| R6  | Step 13's "on EEXIST re-allocate, retry ≤5" can spin against a stale folder scan and either exhaust retries or skip ids.                                                                                                   | MED      | Task 5.2 acceptance requires a test that pre-creates 3 colliding directories and asserts the 4th allocation succeeds, plus a test that 5 collisions surface a typed exhaustion error (not a silent throw).                                                               |
| R7  | Step 14's journal lives at `.ptah/specs/.doctor-journal.json`, under the gitignored `.ptah/**`. If the journal write fails, `apply()` would mutate with no undo record.                                                    | MED      | Task 5.3 acceptance: `apply()` is fail-closed — journal write failure aborts before the first mutation. Journal records creations, renames AND deletions with bytes; `--undo` reverses all three.                                                                        |
| R8  | Step 6 changes a silent null-swallow into a `warn`. If the warn fires per-scan per-folder it becomes log spam on a workspace with 12 carrier-less folders.                                                                 | LOW      | Task 2.3: warn once per folder per harvest run, not per read attempt.                                                                                                                                                                                                    |
| R9  | Step 1 places the contract in `libs/shared`; a careless import of a backend symbol there breaks the frontend build.                                                                                                        | LOW      | Task 1.1: the contract module must be zero-dependency — no `node:` imports, no backend imports. `tasks-ui` importing it must typecheck.                                                                                                                                  |

### Edge cases to handle

- [ ] `tasks.md` legacy fallback must be PERMANENT, never deprecation-warned → Task 2.3, Task 3.1
- [ ] A `TASK_*` folder with no carrier yields a null spec → must `warn`, not silently drop → Task 2.3
- [ ] `TASK_2026_176` declares `id: TASK_2026_178` → mismatched `id:` is a WARNING, never auto-normalized → Task 5.4
- [ ] Folders carrying `test-report.md` or `*-review.md` adopt as `done`, not `backlog` → Task 5.3
- [ ] Adoption ALWAYS tags `status_inferred` → Task 5.3
- [ ] `adoptFolder` must abort on an existing carrier and NEVER fall through to `allocateTaskId` → Task 5.2
- [ ] Exclusions drawer lists every excluded folder BY NAME with a typed reason, not a count → Task 3.2
- [ ] MCP `tasks` namespace goes in the always-on core set, NOT `disabledMcpNamespaces` → Task 6.2
- [ ] No `ptah_task_set_section` — prose stays in `context.md` → Task 6.2

### Blockers found

None. Decomposition proceeds.

---

# PHASE 1 — steps 1–11 (one commit, scope `vscode`)

## Batch 1: Shared task-spec contract module ✅ IMPLEMENTED (awaiting phase commit)

**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer (re-invoke with reviewer issues)
**Execution Mode**: sequential
**Per-batch scope**: `vscode`
**Rationale**: Three tasks in a strict dependency chain (define → export →
consume). Step 1 is a hard prerequisite for steps 2, 3, 4, 7 and 9, so nothing
else in the task can start until this batch lands. Not parallel-eligible: task
1.2 edits the barrel that task 1.1 creates, and task 1.3 imports both.
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Create the shared task-spec contract module ⏸️ PENDING

**Implements**: context.md step 1
**Status**: PENDING
**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\task-spec.contract.ts` (NEW)

**Requirements**:

- Export `SPEC_ROOT`, `CARRIER_FILE`, `SPEC_CONTRACT_VERSION`.
- Export `DOC_FILES` as a CLOSED set: `context.md`, `task-description.md`,
  `implementation-plan.md`, `batches.md`, `test-report.md`,
  `code-style-review.md`, `code-logic-review.md`, `visual-review.md`,
  `visual-design-specification.md`, `research-report.md`,
  `future-enhancements.md`. `tasks.md` is included and marked **legacy**.
- Export `renderTaskMd`, `renderSpecsReadme`, `CARRIER_BANNER`.
- Lives in `libs/shared` specifically because `libs/frontend/tasks-ui` must
  consume it and cannot import a backend lib.

**Validation Notes**: R9 — module must be zero-dependency. No `node:*` imports,
no backend imports, no Angular imports. TypeScript 5.9 strict.

**Acceptance criterion**: `npx nx typecheck shared` is green AND
`grep -n "from 'node:" libs/shared/src/lib/types/task-spec.contract.ts` returns
no matches AND `DOC_FILES` is typed as a readonly tuple/const so
`typeof DOC_FILES[number]` is a literal union.

---

### Task 1.2: Re-export the contract from the shared barrel ⏸️ PENDING

**Implements**: context.md step 2
**Status**: PENDING
**Dependencies**: Task 1.1
**Files**:

- `D:\projects\ptah-extension\libs\shared\src\index.ts`

**Acceptance criterion**: a scratch import of `CARRIER_FILE`, `DOC_FILES`,
`renderTaskMd`, `renderSpecsReadme` and `CARRIER_BANNER` from the shared package
entry point typechecks from both a backend lib and `tasks-ui`.

---

### Task 1.3: Delete the three duplicated `CARRIER_FILE` consts ⏸️ PENDING

**Implements**: context.md step 3
**Status**: PENDING
**Dependencies**: Task 1.2
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-scanner.service.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.ts`

**Requirements**: remove each local `const CARRIER_FILE = 'task.md'` and import
from shared instead. Behaviour must be byte-identical.

**Acceptance criterion**:
`grep -rn "CARRIER_FILE\s*=" libs/backend/task-specs/src` returns zero local
assignments, AND `npx nx test task-specs` is green with no test edits.

---

**Batch 1 Verification**:

- `npx nx run-many -t typecheck,test,lint -p shared task-specs` green
- No local `CARRIER_FILE` literal remains in `task-specs`
- Contract module has no runtime dependencies

---

## Batch 2: Backend data-plane hardening ✅ IMPLEMENTED (awaiting phase commit)

**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential
**Per-batch scope**: `vscode`
**Rationale**: Tasks 2.1 and 2.2 both live in
`libs/backend/task-specs/src/lib/` and task 2.1 moves `renderTaskMd` out of the
file task 2.2 also edits — file-collision, so parallel is disallowed by the
stated ordering constraint. Tasks 2.3 and 2.4 are in different libs but are
kept in the same sequential batch because they consume the contract shape task
2.1 finalises. Single backend-developer, four related edits, one mental model.
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Carrier rendering + `TASK_CONFLICT` on `updateStatus` ⏸️ PENDING

**Implements**: context.md step 4
**Status**: PENDING
**Dependencies**: Task 1.3
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.ts`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.handlers.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`

**Requirements**:

- Move `renderTaskMd` out of `task-writer.service.ts` into the shared contract
  module (created in Task 1.1); the writer imports it.
- Carrier body becomes: banner + one-line summary + an explicit pointer to
  `./context.md`. No prose in the carrier, ever.
- `updateStatus` gains a pre-write re-read and returns a typed `TASK_CONFLICT`
  error instead of clobbering.
- Extend the error union at `task-writer.service.ts:38-45` with `TASK_CONFLICT`.

**Validation Notes**: R5 — extending the union breaks exhaustive switches in
`tasks-rpc.handlers.ts`. Fix them in this same task and propagate the typed
error over the existing RPC error channel. Do NOT add new UI.

**Acceptance criterion**: a unit test where the on-disk carrier changes between
read and write returns `TASK_CONFLICT` and leaves the file byte-identical to the
external write; `npx nx run-many -t typecheck -p task-specs rpc-handlers` green.

---

### Task 2.2: `ensureStarted` writes `.ptah/specs/README.md` + self-write suppression ⏸️ PENDING

**Implements**: context.md step 5
**Status**: PENDING
**Dependencies**: Task 2.1
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.spec.ts`

**Requirements**:

- In `ensureStarted`, after `state.started = true` and after the initial
  rebuild, write `.ptah/specs/README.md` using `renderSpecsReadme` — but only
  when the rendered hash differs from the on-disk hash.
- Add self-write suppression so the README write does not re-trigger the
  watcher. This also kills the existing double rebuild.
- NO automatic migration inside `ensureStarted` (explicitly rejected).

**Validation Notes**: R3 — the README lands in the directory this service
watches. Suppression is the whole point, not a nicety.

**Acceptance criterion**: a unit test asserts exactly ONE rebuild across an
`ensureStarted` that writes the README, and ZERO writes on a second
`ensureStarted` when the hash already matches.

---

### Task 2.3: `batches.md` fallback + loud null-spec warn ⏸️ PENDING

**Implements**: context.md step 6
**Status**: PENDING
**Dependencies**: Task 1.2
**Files**:

- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-extractor.ts`
- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\spec-harvester.service.ts`

**Requirements**:

- `spec-extractor.ts` reads `batches.md` with a **PERMANENT** fallback to
  `tasks.md`. Never deprecation-warn the fallback.
- Add an explicit `warn` when a `TASK_*` folder yields a null spec. Today
  `spec-extractor.ts:125` returns null, `spec-harvester.service.ts:241` drops
  nulls, and `harvest()` logs only when `harvested > 0` — a missed carrier is a
  SILENT empty harvest.

**Validation Notes**: R8 — warn once per folder per harvest run, not per read
attempt. This workspace has 12 carrier-less folders.

**Acceptance criterion**: a test with a folder containing only `tasks.md`
extracts successfully; a test with a `TASK_*` folder and no carrier produces
exactly one `warn` naming that folder, and `npx nx test skill-synthesis` green.

---

### Task 2.4: Fix the dead `task-tracking/` root in the orchestration namespace ⏸️ PENDING

**Implements**: context.md step 8
**Status**: PENDING
**Dependencies**: Task 1.2
**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\orchestration-namespace.builder.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\orchestration-namespace.builder.spec.ts`

**Requirements**:

- Line 184: joins a dead `task-tracking/` root → change to `.ptah/specs/`.
- Line 189: hardcodes `['tasks.md']` → change to `['batches.md', 'tasks.md']`.

**Acceptance criterion**:
`grep -rn "task-tracking" libs/backend/vscode-lm-tools/src` returns no matches,
and a test asserts the builder resolves a spec folder under `.ptah/specs/` and
finds `batches.md` when present, `tasks.md` when only the legacy name exists.

---

**Batch 2 Verification**:

- `npx nx run-many -t typecheck,test,lint -p task-specs rpc-handlers skill-synthesis vscode-lm-tools` green
- `TASK_CONFLICT` proven by test, not by inspection
- Exactly one rebuild across the README write

---

## Batch 3: Tasks board contract adoption ✅ IMPLEMENTED (awaiting phase commit)

**Recommended Executor**: frontend-developer
**Fallback Executor**: frontend-developer
**Execution Mode**: sequential
**Per-batch scope**: `webview`
**Rationale**: Both tasks are in `libs/frontend/tasks-ui`. Backend and frontend
are never mixed in one batch, so these are split out from Batches 2 and 4 even
though they are only two tasks. Sequential because 3.2's drawer copy consumes
the `DOC_FILES`-derived list 3.1 produces. Depends only on Batch 1 — could run
concurrently with Batch 2 if the orchestrator wants overlap, but must land
before Batch 4 (the ratchet scans `tasks-ui`).
**Tasks**: 2 | **Dependencies**: Batch 1 (Task 1.2). Must complete BEFORE Batch 4.

### Task 3.1: Derive `WORKFLOW_ARTIFACTS` from shared `DOC_FILES` ⏸️ PENDING

**Implements**: context.md step 7
**Status**: PENDING
**Dependencies**: Task 1.2
**Files**:

- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\task-presentation.ts`

**Requirements**:

- `task-presentation.ts:34-45` currently holds `WORKFLOW_ARTIFACTS`, a second
  divergent doc-file list. Derive it from shared `DOC_FILES` instead.
- Accept BOTH `batches.md` and `tasks.md`.
- `tasks-ui` imports from `libs/shared` only — never a backend lib.

**Acceptance criterion**: no hand-written per-task `*.md` filename literal
remains in `task-presentation.ts` (all names flow from `DOC_FILES`), both
`batches.md` and `tasks.md` render, and `npx nx typecheck tasks-ui` is green.

---

### Task 3.2: Exclusions drawer listing excluded folders by name ⏸️ PENDING

**Implements**: context.md step 10
**Status**: PENDING
**Dependencies**: Task 3.1
**Files**:

- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts`
- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.spec.ts`

**Requirements**:

- Replace the excluded-folder count with a drawer listing EVERY excluded folder
  BY NAME alongside its typed reason.
- Angular: signals + `inject()`, `ChangeDetectionStrategy.OnPush` mandatory.
- No `[innerHTML]` on any of this content.

**Validation Notes**: this drawer is the user-visible half of the fix. A count
is exactly the failure mode being removed — a user with 12 invisible folders
must be able to read all 12 names and why each was skipped.

**Acceptance criterion**: a component test feeding 12 excluded folders renders
12 named rows each with a non-empty typed reason string; asserting on a count
badge alone fails the task.

---

**Batch 3 Verification**:

- `npx nx run-many -t typecheck,test,lint -p tasks-ui` green
- `tasks-ui` imports no backend lib
- Drawer shows names + reasons, not a count

---

## Batch 4: Host activation, CI ratchet, Phase 1 gate ✅ IMPLEMENTED (gate green, ratchet proven to bite; awaiting commit)

**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential
**Per-batch scope**: `vscode`
**Rationale**: Step 11 is only three small file-disjoint edits — it does not
earn a batch of its own, so it folds in here as the Phase 1 close-out. Step 9's
ratchet must run LAST in Phase 1 because it fails on `task-tracking/` (fixed in
Task 2.4), on doc-file literals in `tasks-ui` (fixed in Task 3.1), and it
round-trips `renderTaskMd` (moved in Task 2.1). Sequential: the gate run in 4.3
must observe 4.1 and 4.2 already landed.
**Tasks**: 3 | **Dependencies**: Batches 1, 2, 3 (ALL of Phase 1's other work)

### Task 4.0: Carry excluded folder ROWS to the board payload ⏸️ PENDING

**Implements**: context.md step 10 (backend half — discovered during Batch 3)
**Status**: PENDING
**Dependencies**: Batch 2 complete (it owns `rpc-tasks.types.ts` and
`tasks-rpc.handlers.ts`; do not start until it has landed)
**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-tasks.types.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.store.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-index.service.ts`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.handlers.ts`

**Why this exists**: Batch 3 built the exclusions drawer, but `TasksBoardResult`
carries `excludedCount` ONLY. `TaskScannerService.scan()` already returns
`{ tasks, excluded }` with full `ExcludedTaskFolder[]` — the rows are DISCARDED
at the store boundary, which persists `excluded_count` and nothing else. Without
this task, step 10's drawer renders its honest fallback ("this host reported N
skipped folder(s) but did not name them") and the user-visible half of the fix
ships INERT. Step 10 explicitly requires names and typed reasons, "not a count",
so this is in scope, not an addition.

**Requirements**:

- `TasksBoardResult` gains `excluded: ExcludedTaskFolder[]`. `ExcludedTaskFolder`
  already exists at `libs/shared/src/lib/types/task-spec.types.ts:81` — reuse it,
  do NOT define a second union.
- `TaskIndexStore` persists the excluded ROWS, not just the count. Both store
  implementations must agree: the SQLite store AND `InMemoryTaskIndexStore` (the
  lazy fallback at `di/register.ts:57-65`).
- `tasks:board` returns the rows.
- Frontend needs NO further change — `readExcludedFolders()` in
  `tasks-store.service.ts` is a defensive narrower that picks the field up as
  soon as it exists.

**Acceptance criterion**: a handler test asserts `tasks:board` returns one row
per excluded folder with its name and typed reason, for BOTH store
implementations; and the 12 carrier-less folders in this workspace surface by
name rather than as a count.

---

### Task 4.1: Call `ensureStarted(activeWorkspaceRoot)` at host activation ⏸️ PENDING

**Implements**: context.md step 11
**Status**: PENDING
**Dependencies**: Task 2.2
**Files** (file-disjoint, three separate hosts):

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-2-libraries.ts`
- `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\thoth\register-thoth-libraries.ts`

**Requirements**:

- Today `ensureStarted` is called ONLY from `tasks-rpc.handlers.ts` (lines
  122/141/158/184/235). Nothing calls it at host activation.
- Add the activation call in all three hosts. Without it the README never lands,
  and the README is the ONLY channel that reaches a user whose `.claude/` clone
  is diverged.
- Existing RPC-side calls stay — do not remove them.

**Validation Notes**: R4 — two callers now race on first invocation. Activation
must not block host startup on a slow scan; failure must not abort activation.

**Acceptance criterion**: a test asserts two concurrent `ensureStarted` calls
produce exactly one rebuild and one README write; and a thrown error inside
`ensureStarted` does not propagate out of host activation in any of the three
hosts.

---

### Task 4.2: `contract.guard.spec.ts` CI ratchet ⏸️ PENDING

**Implements**: context.md step 9
**Status**: PENDING
**Dependencies**: Task 2.4, Task 3.1, Task 4.1
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\contract.guard.spec.ts` (NEW)

**Requirements** — the ratchet must:

1. Flag per-task filename string literals that appear outside an explicit
   allowlist.
2. Fail if any agent template (under
   `libs/backend/agent-generation/templates/agents/`) or orchestration skill
   asset (under
   `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/`)
   names a per-task `*.md` outside `DOC_FILES`.
3. Fail on `TASK_2025_`, `.ptah/tasks/`, or `task-tracking/` appearing in any
   `.ts` file or skill asset.
4. Round-trip `renderTaskMd` → `parseTaskFile` for EVERY status × type pair.

**Validation Notes**: R2 — this will probably fail on the first run against
Phase-0 assets. When it does: fix the asset, or widen `DOC_FILES` on purpose and
say so. Never soften a rule to get green. Record the decision in the batch
report.

**Acceptance criterion**: `npx nx test task-specs` green with the ratchet
active; then temporarily inserting the string `task-tracking/` into any `.ts`
under `libs/backend/task-specs/src` makes it FAIL (prove the guard bites, then
revert).

---

### Task 4.3: Phase 1 verification gate ⏸️ PENDING

**Implements**: context.md `## Verification` (Phase 1 close-out)
**Status**: PENDING
**Dependencies**: Task 4.2
**Files**: none (verification only)

**Requirements**: run the full gate and report ACTUAL output:

```
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers tasks-ui vscode-core platform-core platform-vscode platform-electron platform-cli skill-synthesis cli-engine
```

**Acceptance criterion**: the command exits 0 and the batch report pastes the
real summary lines. Phase 1 is NOT committable until this is green. Do not
paraphrase, do not report a pass from a partial run.

---

**Batch 4 Verification**:

- Full gate command green (Task 4.3)
- Ratchet proven to bite (Task 4.2 acceptance)
- `ensureStarted` wired in all three hosts
- **→ Phase 1 commit here.** Scope `vscode`. One commit for steps 1–11.

---

# PHASE 2 — steps 12–19 (one commit, scope `vscode`)

Phase 2 ships ONLY after the Phase 1 commit exists and is green on its own.

## Batch 5: Exclusive-create CAS, adoption writer, doctor ✅ IMPLEMENTED (gate green ×2; awaiting phase commit)

**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential
**Per-batch scope**: `vscode`
**Rationale**: Step 12 (the port + all three adapters + mock + shared contract
test) is a HARD prerequisite for step 13 — nothing here is parallel-eligible.
Tasks 5.2 and 5.3 both live in `libs/backend/task-specs/src/lib/` and 5.3's
doctor consumes 5.2's `adoptFolder`. Deep hexagonal work with a real
concurrency-correctness requirement — sub-agent developer, not fan-out.
**Tasks**: 4 | **Dependencies**: Phase 1 committed

### Task 5.0: Fix the `platform-core` Jest teardown leak ⏸️ PENDING

**Implements**: not in context.md — user-approved scope addition, discovered
during the Phase 1 gate
**Status**: PENDING
**Files**: whichever `platform-core` spec/helper leaks; discover it

**Why this exists**: the Phase 1 gate failed on its FIRST run with only
`@ptah-extension/platform-core:test` failing. In isolation that project exits 0
(27 suites, 321 passed, 4 todo). Under parallel `run-many` Jest reported
`A worker process has failed to exit gracefully and has been force exited`, and
Nx tagged the task flaky. A re-run went green. The leak is PRE-EXISTING and
unrelated to TASK_2026_179 — but Task 5.1 adds `createDirectoryExclusive` tests
to this exact project, so the flake gets more likely to bite precisely where
Phase 2's correctness evidence lives. The user approved folding the fix in.

**Requirements**: find the leaked handle or timer with
`npx nx test platform-core --skip-nx-cache -- --detectOpenHandles`. Fix the
teardown at its source — an unclosed watcher, an un-`unref`'d timer, a promise
left pending. Do NOT paper over it with `forceExit`, a longer timeout, or
`--runInBand`.

**Acceptance criterion**: `--detectOpenHandles` reports no open handle, and the
full 11-project gate passes twice consecutively WITHOUT a flaky-task notice.

---

### Task 5.1: `createDirectoryExclusive` on the port and all three adapters ⏸️ PENDING

**Implements**: context.md step 12
**Status**: PENDING
**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\file-system-provider.interface.ts`
- `D:\projects\ptah-extension\libs\backend\platform-core\src\testing\mocks\file-system-provider.mock.ts`
- `D:\projects\ptah-extension\libs\backend\platform-core\src\testing\contracts\run-file-system-contract.ts`
- `D:\projects\ptah-extension\libs\backend\platform-vscode\src\implementations\vscode-file-system-provider.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-file-system-provider.ts`
- `D:\projects\ptah-extension\libs\backend\platform-cli\src\implementations\cli-file-system-provider.ts`

**Requirements**:

- Add EXACTLY ONE method: `createDirectoryExclusive(path)` — non-recursive
  mkdir that rejects on EEXIST.
- Implement in platform-vscode, platform-electron, platform-cli, plus the mock
  and the shared contract test.
- Do NOT add `rename`. Do NOT add `writeFileExclusive`. Both are explicitly
  rejected — `vscode.workspace.fs.writeFile` takes no options, so exclusive
  write degrades to the same TOCTOU it was bought to close. Only
  `createDirectoryExclusive` is a real CAS.

**Validation Notes**: R1 (HIGH) — the existing `createDirectory` is recursive
and will NOT reject EEXIST. The VS Code adapter must not delegate to
`vscode.workspace.fs.createDirectory`; use `node:fs/promises` `mkdir` WITHOUT
`recursive: true`, which throws `EEXIST`. Stat-then-create is explicitly NOT
acceptable — it reintroduces the TOCTOU this method exists to close.

**Acceptance criterion**: the shared file-system contract test gains a case
where the SAME path is created twice; the first call resolves and the second
REJECTS with an EEXIST-typed error — and that case passes for all three real
adapters plus the mock. `npx nx run-many -t test -p platform-core
platform-vscode platform-electron platform-cli` green.

---

### Task 5.2: `create` via CAS + a distinct `adoptFolder` ⏸️ PENDING

**Implements**: context.md step 13
**Status**: PENDING
**Dependencies**: Task 5.1 (HARD prerequisite)
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.service.spec.ts`

**Requirements**:

- `create` becomes: allocate id → `createDirectoryExclusive` → on EEXIST
  re-allocate and retry, bounded at ≤5 → write carrier.
- Add a DISTINCT `adoptFolder(folderName)` that ABORTS on an existing carrier
  and NEVER falls through to `allocateTaskId`.
- Folder name stays the canonical id.

**Validation Notes**: R6 — bound the retry and surface exhaustion as a typed
error, never a bare throw. Ids may skip; that is acceptable, silent overwrite is
not.

**Acceptance criterion**: a test that pre-creates 3 colliding directories has
the 4th allocation succeed; a test with 5 consecutive collisions returns a typed
exhaustion error; a test calling `adoptFolder` on a folder that already has
`task.md` aborts WITHOUT calling `allocateTaskId` (assert the allocator spy is
never invoked).

---

### Task 5.3: `task-doctor.service.ts` with `plan()` / `apply()` / `--undo` ⏸️ PENDING

**Implements**: context.md step 14
**Status**: PENDING
**Dependencies**: Task 5.2
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-doctor.service.ts` (NEW)
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-doctor.service.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\di\register.ts`

**Requirements**:

- `plan()` computes, `apply()` mutates. No automatic mutation of task files,
  ever — and never from inside `ensureStarted`.
- Adoption infers status from artifacts and ALWAYS tags `status_inferred`.
  Folders carrying `test-report.md` or `*-review.md` adopt as `done`, not
  `backlog`.
- Write `.ptah/specs/.doctor-journal.json` BEFORE the first mutation, recording
  creations, renames AND deletions with bytes. `--undo` reverses all three.
- Migration gating uses the file stamp `.ptah/specs/.ptah-spec-contract.json`,
  fail-closed if unreadable. NOT a SQLite column — the store selection at
  `di/register.ts:57-65` is lazy with an `InMemoryTaskIndexStore` fallback, so a
  SQLite column cannot gate anything. No SQLite migration 0030.
- A mismatched `id:` is a WARNING. Never auto-normalize. Never backfill banner
  or version into existing carriers.

**Validation Notes**: R7 — `.ptah/**` is gitignored, so the journal IS the undo.
`apply()` must be fail-closed: if the journal write fails, abort before the
first mutation.

**Acceptance criterion**: a test where the journal write is stubbed to throw
asserts ZERO filesystem mutations occurred; a test adopting a folder containing
`test-report.md` yields `status: done` plus a `status_inferred` tag; a test
running `apply()` then `--undo` restores the tree byte-for-byte including a
deleted file's bytes; a test with an unreadable
`.ptah-spec-contract.json` refuses to run (fail-closed).

---

### Task 5.4: `dangling_depends_on` validation issue ⏸️ PENDING

**Implements**: context.md step 15
**Status**: PENDING
**Dependencies**: Task 5.3
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-frontmatter.ts`
- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-frontmatter.spec.ts`

**Requirements**: add `dangling_depends_on` as a validation issue — a
`depends_on` entry pointing at a task folder that does not exist. Zod 4 at the
boundary.

**Validation Notes**: `TASK_2026_176` declares `id: TASK_2026_178`. LEAVE IT.
Normalizing would erase the only record of a declared id that the folder-scan
allocator would then re-issue. A mismatched `id:` stays a warning.

**Acceptance criterion**: a carrier with `depends_on: [TASK_2099_999]` produces
exactly one `dangling_depends_on` issue; a carrier with a valid `depends_on`
produces none; the existing mismatched-`id:` warning still fires and still does
not mutate anything.

---

**Batch 5 Verification**:

- Double-create rejects on all three adapters and the mock
- `adoptFolder` never reaches `allocateTaskId`
- Journal-failure test proves zero mutations
- `npx nx run-many -t typecheck,test,lint -p platform-core platform-vscode platform-electron platform-cli task-specs` green

---

## Batch 6: Callable surfaces, loss-interleaving test, Phase 2 gate ✅ COMPLETE — closed 2026-08-09

> **Closing note.** 6.1/6.2/6.3 had shipped long before their markers said so;
> 6.4's spec file had shipped too and only its acceptance proof was missing. The
> genuinely-unrun items were 6.4's reproduce-then-pass proof and 6.5's gate. Both
> are now run, with real numbers recorded under each task. The D1–D6 defect batch
> from `context.md` shipped alongside them — five of the six were real and are
> fixed; D6 was misdiagnosed (the renderer was never the writer of the dark
> carriers) and the real fix landed in the hand-authoring template instead. See
> the `RESOLVED` blocks in `context.md`.
>
> **On the stale markers themselves**: three task headers here claimed `PENDING`
> for work with commits on disk, and nothing in the system could see the
> difference. That is D1 one layer up. What was built in response is a doctor
> warning, `status_contradicted_by_artifacts`, which fires when a carrier
> declares `backlog` next to a review or a test report. What was NOT built, and
> why, is recorded in `context.md` — a batch-marker-vs-git checker over free-form
> markdown would be a high-false-positive diagnostic and would be ignored.

**Recommended Executor**: backend-developer
**Fallback Executor**: backend-developer
**Execution Mode**: sequential
**Per-batch scope**: `cli` (CLI surface) — but the Phase 2 commit uses scope
`vscode`, since the dominant diff across Phase 2 is `platform-*`, `task-specs`
and `rpc-handlers`.
**Rationale**: Four surfaces over the SAME underlying doctor/writer API built in
Batch 5 — CLI, MCP, RPC, then the regression test that proves the whole thing.
Kept in one batch rather than split three ways to avoid over-fragmentation; kept
sequential because all four consume the Batch 5 service signatures and a
signature adjustment in 6.1 propagates to 6.2 and 6.3.
**Tasks**: 5 | **Dependencies**: Batch 5

### Task 6.1: `ptah spec` CLI command family ✅ COMPLETE — verified on disk 2026-08-09: `router.ts:776` registers `spec new|status|show|list|check|doctor`; implemented in `apps/ptah-cli/src/cli/commands/ptah-spec.ts` with `--plan|--fix|--undo`

**Implements**: context.md step 16
**Status**: COMPLETE
**Dependencies**: Task 5.4
**Files**:

- `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\spec.ts` (NEW)
- `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\spec.spec.ts` (NEW)
- `D:\projects\ptah-extension\apps\ptah-cli\src\cli\router.ts`

**Requirements**: `spec new|status|show|list|check|doctor`, with `--json` on ALL
six. `doctor` exposes `--plan`, `--fix` and `--undo` mapping onto
`TaskDoctorService`.

**Acceptance criterion**: each of the six subcommands with `--json` emits a
single parseable JSON document on stdout and nothing else; `spec doctor --plan`
on a fixture with a carrier-less folder lists that folder without mutating it
(assert the fixture tree is unchanged after the call).

---

### Task 6.2: MCP `tasks` namespace in the always-on core set ✅ COMPLETE — verified on disk 2026-08-09: `namespace-builders/tasks-namespace.builder.ts`, with `protocol-dispatcher.spec.ts:264` proving it survives an explicit `'tasks'` entry in `disabledMcpNamespaces`

**Implements**: context.md step 17
**Status**: COMPLETE
**Dependencies**: Task 6.1
**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts`

**Requirements**:

- Add `ptah_task_create`, `ptah_task_update`, `ptah_task_get`, `ptah_task_list`,
  `ptah_task_check`.
- The namespace goes in the ALWAYS-ON core set — NOT in
  `disabledMcpNamespaces`.
- There is NO `ptah_task_set_section`. Prose stays in `context.md` and no
  machine writes it.
- Zod 4 on every tool-arg boundary.

**Acceptance criterion**: a test asserts all five tool names appear in the
default (no-config) tool list, that the namespace is absent from
`disabledMcpNamespaces`, and that no tool named `*set_section*` exists.

---

### Task 6.3: RPC `tasks:adopt` and `tasks:doctorPlan` ✅ COMPLETE — verified on disk 2026-08-09: `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` (+ `.schema.ts`, `.spec.ts`)

**Implements**: context.md step 18
**Status**: COMPLETE
**Dependencies**: Task 6.2
**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-tasks.types.ts`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\tasks-rpc.handlers.ts`

**Requirements**:

- Add both methods to the compile-time contract in `rpc-tasks.types.ts` and
  implement the handlers.
- The runtime half needs NO edit: `ALLOWED_METHOD_PREFIXES` at
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts:84` already contains
  `tasks:`. Verify, do not re-add.
- `tasks:doctorPlan` is read-only — it must never mutate.

**Acceptance criterion**: both methods typecheck against the shared contract, a
handler test asserts `tasks:doctorPlan` performs zero writes, and a test asserts
`tasks:adopt` on a folder with an existing carrier returns a typed error rather
than allocating a new id.

---

### Task 6.4: Loss-interleaving integration test ✅ COMPLETE — the spec file shipped with Batch 5/6 work and was extended by TASK_2026_181; the outstanding half was its acceptance criterion (the reproduce-then-pass proof), run 2026-08-09

**Implements**: context.md step 19
**Status**: COMPLETE
**Dependencies**: Task 6.3
**Files**:

- `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\task-writer.conflict.integration.spec.ts` (NEW)

**Requirements**: reproduce the exact loss interleaving that started this task:

1. Read the carrier.
2. RPC `updateStatus`.
3. A whole-file EXTERNAL write from the pre-update snapshot.
4. Assert either `TASK_CONFLICT` is raised OR the status survives.

Note `updateFrontmatter` re-dumps through `matter.stringify` — it is
body-preserving but NOT frontmatter-byte-preserving, so assert on parsed status,
not on bytes, for the frontmatter block.

**Acceptance criterion**: the test FAILS when Task 2.1's pre-write re-read is
reverted (prove it reproduces the original bug), and PASSES on the current tree.
State both results in the batch report.

**Result — both halves, 2026-08-09.** The file was already on disk at
`task-writer.conflict.integration.spec.ts` (529 lines: the single-task
interleaving, a same-length `backlog`→`blocked` case that size/mtime could not
see, an uncontended control, plus a five-task bulk block added by
TASK_2026_181). The one thing never done was the negative proof, so that is what
was run:

- **Guard reverted** (`if (current !== raw)` → `if (false && current !== raw)`
  at `task-writer.service.ts:666`):
  `Test Suites: 3 failed, 11 passed` · `Tests: 9 failed, 23 skipped, 364 passed`.
  Six of the nine are this file — all three single-task interleaving tests and
  three of the bulk tests. The suite reproduces the original bug.
- **Guard restored**: `Test Suites: 14 passed` ·
  `Tests: 373 passed, 23 skipped, 396 total`.

---

### Task 6.5: Phase 2 verification gate ✅ COMPLETE — run 2026-08-09

**Implements**: context.md `## Verification` (Phase 2 close-out)
**Status**: COMPLETE
**Dependencies**: Task 6.4
**Files**: none (verification only)

**Requirements**: run and report ACTUAL output:

```
npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers tasks-ui vscode-core platform-core platform-vscode platform-electron platform-cli skill-synthesis cli-engine
```

**Acceptance criterion**: exits 0, real summary pasted into the batch report.
Phase 2 is NOT committable until this is green.

**Result — 2026-08-09, `EXIT=0`.** 33 tasks (11 projects × typecheck/test/lint),
`Successfully ran targets typecheck, test, lint for 11 projects`. 4758 tests
passed, 0 failed:

| Project           | Suites               | Tests                   |
| ----------------- | -------------------- | ----------------------- |
| shared            | 28 passed            | 628 passed              |
| task-specs        | 14 passed            | 373 passed, 23 skipped  |
| rpc-handlers      | 72 passed            | 1620 passed, 31 skipped |
| tasks-ui          | 17 passed            | 470 passed              |
| vscode-core       | 20 passed            | 314 passed              |
| platform-core     | 28 passed            | 339 passed, 4 todo      |
| platform-vscode   | 14 passed            | 144 passed, 3 todo      |
| platform-electron | 15 passed            | 241 passed, 3 todo      |
| platform-cli      | 12 passed            | 197 passed, 3 todo      |
| skill-synthesis   | 23 passed, 6 skipped | 306 passed, 74 skipped  |
| cli-engine        | 12 passed            | 126 passed              |

Baseline before any edit in this session, for comparison: `nx test task-specs`
= 357 passed / 23 skipped / 380 total. The +16 are this session's regression
tests (4 hostile-description round-trips, 1 parser-determinism, 11 doctor).

**Two process notes, recorded because they cost time and will recur:**

1. `npx nx reset` FAILS on this machine — `EPERM` on
   `.nx/workspace-data/<uuid>.db`, held by a live process, and stopping the
   daemon does not release it. What worked: `npx nx daemon --stop`, then delete
   every file in `.nx/workspace-data` EXCEPT the locked `.db` (that clears
   `project-graph.json`, `file-map.json` and the eslint hash cache — the things
   that produce a false green), then run with `--skip-nx-cache`.
2. An 11-project run at default parallelism produced FOUR spurious failures on
   this machine: `platform-core`'s 1000-write performance benchmark timed out at
   30 s under contention, and `cli-engine` reported 7 failures. Both are green
   in isolation (`platform-core` 339/339, `cli-engine` 126/126) and green again
   in the final `--parallel=3` run. Do not chase these; reduce parallelism.

---

**Batch 6 Verification**:

- Full gate command green (Task 6.5)
- Loss interleaving proven to reproduce-then-pass (Task 6.4)
- MCP `tasks` namespace on by default, no `set_section` tool
- **→ Phase 2 commit here.** Scope `vscode`. One commit for steps 12–19.

---

## Out of scope — do NOT propose (from `context.md` `## Rejected`)

- `context.md` as the carrier; merging `context.md` into `task.md` at all.
- Renaming the carrier to `spec.md` or anything else.
- `IFileSystemProvider.rename` or `writeFileExclusive`.
- sha256 compare-and-swap; mtime+size change detection.
- A cross-process lockfile.
- Automatic migration inside `ensureStarted`.
- Auto-normalizing a mismatched `id:`; backfilling banner/version into existing
  carriers.
- SQLite migration 0030.
- Deriving the next id from `registry.md` — permanently.

## Executor policy

CLI delegation is DISABLED for this task (recorded in `context.md`). Every batch
uses `backend-developer` or `frontend-developer` sub-agents only. No
`ptah_agent_spawn`.
