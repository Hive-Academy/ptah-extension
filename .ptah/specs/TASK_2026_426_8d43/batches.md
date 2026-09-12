# Batches - TASK_2026_426_8d43

Total tasks: 17 | Batches: 5 | Complete: 5/5 — **TASK COMPLETE**

## Commits — all five batches COMPLETE

| Batch | Name                       | Commit      |
| ----- | -------------------------- | ----------- |
| 1     | Backend write path         | `5d94abb87` |
| 2     | Deep-link origin           | `da107e522` |
| 3     | Skills-UI primitives       | `13e105ce3` |
| 4     | Skills-UI integration      | `3415055ae` |
| 5     | Cross-cutting proofs       | `17113b35f` |
| —     | Review fixes (post-batch)  | `e28ab0c8c` |
| —     | API and dead-code cleanup  | `02e392e28` |

See the **Completion summary** at the end of this file.

Verified by the team-leader on the files themselves, not on the reports:

- `saveCloneBody` writes `currentContentHash` and nothing else. `sourceHash`,
  `diverged`, `pendingSourceHash` and `lastEnhancedAt` are carried through by
  spread and never assigned, in both `saveDirCloneBody` and `saveFileCloneBody`.
  A clone with no sidecar gets none minted (`if (existing)` guards the write).
  An absent target returns `{ written: false, reason: 'clone-missing' }` and
  creates nothing.
- The Zod gate is the first statement of the handler, before any `join`, and
  reuses `SlugSchema` / `SkillCloneKindSchema` — no second slug rule was
  authored.
- The snapshot precedes the overwrite unconditionally, and uses the existing
  `snapshotDirToHistory` / `snapshotFileToHistory`, so both layouts are the ones
  `listHistory` already reads.
- `eligibleForBulkRebase` compares `c.orphaned !== true`, so `orphaned:
  undefined` is INCLUDED.
- `CloneBulkRebaseService` is a sequential `for` loop, each iteration wrapped in
  `rebaseOne`'s own try/catch, and `running` clears in a `finally`.
- `harness-target-row.component.ts` renders the original inert `<p>` in the
  `@else` branch when `canOpenDivergedClones()` is false.
- The deep-link flag is a standalone private signal
  (`app-state.service.ts:280`), outside `ViewSlice`, and appears nowhere in
  `switchWorkspace`.

Gates re-run by the team-leader with the lanes idle:

- `typecheck` — 6 projects, `Successfully ran target typecheck for 6 projects`
- `lint` — 6 projects, 0 errors (warnings pre-existing)
- `test` — `@ptah-extension/agent-generation` ALONE: 31 suites / 970 tests
  passed. The other five by `run-many`: shared 56/1375, rpc-handlers 94/2741
  (+31 skipped, includes the Concern-1 gate `rpc-allowlist.spec.ts`), core
  28/666, marketplace 12/241, skill-synthesis-ui 26/380 — all green.
- `ptah-extension-vscode:test` — 5 suites / 39 tests passed (the fifth site).

### Correction to Concern 1 — there are FIVE registration sites, not four

My MODE 1 validation concluded there were exactly four. It was wrong. A fifth
site exists and goes red on a partial registration:

`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` holds an exhaustive,
sorted `VSCODE_EXPECTED_ABSENT_METHODS` list and asserts it EXACTLY. Any new
Electron-only `skillSynthesis:*` method must be added there in sorted position
or `ptah-extension-vscode:test` fails. Batch 1 added
`'skillSynthesis:saveCloneBody'` at `:149`. `expected-absent.ts` itself is
untouched, so `SkillsSynthesisRpcHandlers` stays absent as required.

**Binding on batches 4 and 5: any further new `skillSynthesis:*` method needs
this fifth site too.**

### Deviation — the body editor's cancel output is `cancelled`, not `cancel`

`@angular-eslint/no-output-native` is an ERROR in `skill-synthesis-ui` and
rejects an output shadowing a standard DOM event. `CloneBodyEditorComponent`
therefore exposes `cancelled = output<void>()`. Behaviour is unchanged: it still
carries no payload.

**Batch 4 binds `(cancelled)`, never `(cancel)`.** The drawer already wires it
internally at `clone-detail-drawer.component.ts:288`, so batch 4 binds only
`[canEditBody]`, `[bodySaving]` and `(bodySaved)` on the drawer.

### Pre-existing flakiness — not this task's, do not fix here

`user-layer-activation-sequence.spec.ts` and several `user-layer-mirror.service.spec.ts`
cases time out at Jest's 5000 ms default when `agent-generation` runs
concurrently with other projects. A control run on a clean `main` checkout with
the same `run-many` set failed 12 distinct tests — MORE than the worktree. The
load sensitivity is pre-existing and unrelated to this task. **Run
`@ptah-extension/agent-generation:test` alone.** Noted for
`future-enhancements.md`; out of scope here.

### Batch 4 is UNBLOCKED

All three wave-1 batches are verified and committed. Batch 4's three ordering
dependencies are satisfied: batch 1's `SkillSynthesisSaveCloneBodyParams/Result`,
batch 2's `openSkillsDivergedClones()` / `consumeSkillsDivergedRequest()`, and
batch 3's `eligibleForBulkRebase` / `CloneBulkRebaseService` /
`CloneBodySaveRequest` — all exported from
`libs/frontend/skill-synthesis-ui/src/index.ts`, which batch 4 must NOT edit.

Worktree root (all paths absolute, all work inside it):
`D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4`

---

## Plan validation

Status: **PASSED WITH RISKS**

The plan is unusually well-evidenced and I found no BLOCKER. Both claims I was
asked to verify hardest are **confirmed**, and one of them has a consequence the
plan states only in passing that I am promoting to a binding batch rule. Four
underspecified points are recorded below and assigned to the task that must
settle them.

### Concern 1 — VERIFIED, and it makes batch 1 indivisible

> **SUPERSEDED IN PART — see "Correction to Concern 1" above.** The count below
> is wrong: there are FIVE registration sites, the fifth being
> `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`. The indivisibility
> conclusion stands.

The plan's "FOUR registration sites" claim is correct, and so is its corollary
that a partial registration fails CI rather than failing at runtime. Measured:

- `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts:42` calls
  `assertManifestInvariants(RPC_METHOD_NAMES)`.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:402-407` throws
  `RPC manifest is missing an owner for N method(s)` for any name present in
  `RPC_METHOD_NAMES` that no manifest entry claims.
- `manifest.ts:394-400` throws the mirror error — `claims N method(s) absent from
  RPC_METHOD_NAMES` — for a `METHODS` entry with no registry entry.
- The `skillSynthesis` manifest entry's `methods` IS
  `SkillsSynthesisRpcHandlers.METHODS`.

**Consequence, binding:** adding `'skillSynthesis:saveCloneBody'` to
`rpc.types.ts` WITHOUT adding it to `SkillsSynthesisRpcHandlers.METHODS` turns
`rpc-allowlist.spec.ts` red — and it goes red in `@ptah-extension/rpc-handlers`,
a different project from the one that was edited. The reverse ordering is red
too. Therefore **components 1, 2, 3 and 4 are one indivisible batch**. A
"shared types first, handler second" split would leave the tree failing between
the two commits. This is why batch 1 spans three projects.

Also verified and requiring **no** change: `ALLOWED_METHOD_PREFIXES` already
carries `'skillSynthesis:'` at
`libs/backend/vscode-core/src/messaging/rpc-handler.ts:81`. Do not edit that
file. (The root `CLAUDE.md` cites `:46` for this array; the plan already flags
the discrepancy. It is a doc inaccuracy outside this task's file set — leave it.)

### Concern 2 — VERIFIED: component 9 is NOT file-disjoint and must be split

Measured: `skill-synthesis-tab.component.ts:580` renders `<ptah-skill-clones-view />`
with **no bindings at all**. The plan's own preferred mechanism — "ONE flag
consumed in the tab, passed down as an `input()` on the clones view" — therefore
requires editing the tab template (component 9) *and* adding an `input()` to
`skill-clones-view.component.ts` (component 7). Those two files cannot be held
by two concurrent executors.

**Resolution:** component 9 is split at the lib boundary.

- **9a** (`libs/frontend/core` + `libs/frontend/marketplace`) is genuinely
  file-disjoint from everything else and becomes its own parallel batch 2.
- **9b** (`skill-synthesis-tab.component.ts` + the clones-view `input()`) is
  inseparable from component 7 and is folded into batch 4.

This costs nothing: 9a produces `openSkillsDivergedClones()` /
`consumeSkillsDivergedRequest()` on `AppStateManager`, which is exactly what 9b
consumes, so the split follows the real dependency.

### Concern 3 — the plan contradicts itself on who injects `AppStateManager`

Component 7 says the clones view injects `AppStateManager`. Data-flow C and the
"Executor's choice of mechanism" note say the **tab** consumes the flag and
passes it down, and explicitly warn that a read-and-clear consumed twice is a
race between two effects. These disagree.

**Decision recorded (not escalated — the plan names the correct answer itself):**
the **tab** injects `AppStateManager` and consumes the flag exactly once; the
clones view receives a plain `input()` and does not inject `AppStateManager` for
this purpose. Assigned to Task 4.3. Two consumers of a read-and-clear is the
defect the plan warns about; do not implement the component-7 wording.

### Concern 4 — `CloneBodySaveRequest` has no declared home

Component 8 lists it as an index.ts export but never names the file that
declares it. **Decision recorded:** declare it in
`clone-detail-drawer.component.ts`, beside the drawer's existing output types,
so the index export sits beside the existing drawer exports as component 8 asks.
Assigned to Task 3.4.

### Concern 5 — a spec file in the verification seam is missing from the CREATE list

Component 8's verification seam requires "a drawer spec asserting the markdown
block is absent in edit mode and the Edit affordance is absent when
`canEditBody()` is false". Measured: **`clone-detail-drawer.component.spec.ts`
does not exist** in
`libs/frontend/skill-synthesis-ui/src/lib/components/clones/`. The plan's
CREATE list omits it. It is added to Task 3.4 as a CREATE.

Everything else in the plan's file list was confirmed present on disk:
`clone-action-gating.spec.ts`, `skill-clones-view.component.spec.ts`,
`skill-synthesis-tab.component.spec.ts`, `harness-health-badge.component.spec.ts`,
`app-state.service.spec.ts`, `skills-synthesis-rpc.handlers.spec.ts`,
`skills-synthesis-rpc.schema.spec.ts`, `user-layer-mirror.service.spec.ts`.
`harness-target-row.component.ts` has **no** co-located spec — its new button is
covered through the badge spec, as the plan intends.

### Assumptions

- **The four registration sites are exactly four, and `ALLOWED_METHOD_PREFIXES`
  needs no edit.** — VERIFIED above against `manifest.ts`, `rpc-allowlist.spec.ts`
  and `rpc-handler.ts:81`. No further check needed.
- **Every project alias in the verification commands resolves.** — VERIFIED:
  `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`,
  `@ptah-extension/agent-generation`, `@ptah-extension/core`,
  `@ptah-extension/marketplace`, `@ptah-extension/skill-synthesis-ui` are the
  `name` fields in their `project.json`, and each carries `test`, `lint` and
  `typecheck` targets.
- **No `project.json` is edited by any batch, so no `npx nx reset` is needed.** —
  UNVERIFIED only in the sense that an executor could add one. Batches 1-3 run
  concurrently in a shared worktree; a reset would kill the other lanes' daemons
  mid-run. **No executor may run `npx nx reset` in this task.** Checked at
  batch verification by `git diff --name-only` showing no `project.json`.
- **A 1 MiB body cap is generous.** — UNVERIFIED. Largest shipped skill body
  measured in `context.md` is ~16 KB. Verification step on Task 1.2.

### Risks

| Risk                                                                              | Severity | Mitigation                                                                                                 |
| --------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| A save writes `sourceHash` and arms the fast-forward branch, eating the user's edit | HIGH     | Task 1.4 — the sidecar table in plan component 4 is binding; Task 1.5 spec asserts the four fields unchanged; Task 5.1 proves it end to end |
| Split RPC registration leaves the tree red between commits                        | HIGH     | Components 1-4 are one batch (Concern 1); batch 1 is not accepted until `rpc-allowlist.spec.ts` is green     |
| Bulk rebase discards real user work with no diff preview                          | HIGH     | Task 4.2 confirmation names the count and renders `BULK_REBASE_EXPLANATION`; the per-clone snapshot is the existing `rebaseClone` behaviour, unchanged |
| A crafted slug escapes `~/.ptah/user` before the path guard runs                  | HIGH     | Task 1.2 Zod gate before any `join`; Task 1.3 rejects an unknown clone; `assertUnderUserLayer` stays the second gate |
| Two executors hold `skill-clones-view.component.ts` or `src/index.ts`             | MEDIUM   | Concern 2 split: `index.ts` is owned by batch 3 ALONE; `skill-clones-view.component.ts` by batch 4 ALONE      |
| The deep-link flag is consumed twice and races                                    | MEDIUM   | Concern 3 decision on Task 4.3 — one consumption, in the tab                                                 |
| Batch aborts on first failure, losing partial progress                            | MEDIUM   | Task 3.2 per-iteration try/catch; Task 5.2 proves every member is attempted                                  |
| The new intent leaks into `ViewSlice` and re-fires on every later visit           | MEDIUM   | Task 2.1 keeps it outside the slice; `app-state.service.spec.ts:484-581` must stay green                     |
| Concurrent nx runs in one worktree contend on the daemon/cache                    | LOW      | Each lane scopes `run-many` to its own projects; nobody runs `nx reset`                                      |

### Edge cases

- `orphaned: undefined` must be INCLUDED (the `=== true` trap) — Task 3.1
- `authored` / `synth` clones excluded from the batch — Task 3.1
- Empty filtered set renders an empty state, not a blank region — Task 4.2 (R2.3)
- Clone with NO sidecar: body write succeeds, sidecar is NOT created — Task 1.4
- Registry row present but file absent on disk → `written: false`, nothing created — Task 1.4
- Empty body (`''`) rejected by the schema, not silently written — Task 1.2
- VS Code host: inert `<p>`, not a button — Task 2.2; no edit affordance — Task 4.4
- Save while a boot reconcile holds the slug lock: queues, never half-writes — Task 1.4
- File-clone snapshot layout (`.history/<slug>/<ts>/`) must match `listHistory` — Task 1.4

---

## Execution order and parallelism — read this before spawning

| Wave | Batches       | Mode                                   |
| ---- | ------------- | -------------------------------------- |
| 1    | **1, 2, 3**   | all three CONCURRENTLY — file-disjoint |
| 2    | **4**         | alone, after 1, 2 AND 3 are committed  |
| 3    | **5**         | alone, after 4 is committed            |

**Can run in parallel:** batches 1, 2, 3. They touch three disjoint project
sets — `{shared, rpc-handlers, agent-generation}`, `{core, marketplace}`,
`{skill-synthesis-ui}` — and no file appears in two of them. Three lanes fits
the 3-concurrent cap exactly.

**Cannot run in parallel:**

- Batch 4 needs batch 1's shared types (its `SkillSynthesisRpcService`
  wrapper references `SkillSynthesisSaveCloneBodyParams/Result`), batch 2's
  `AppStateManager.consumeSkillsDivergedRequest()`, and batch 3's
  `eligibleForBulkRebase` / `CloneBulkRebaseService` / `CloneBodySaveRequest`.
  It also re-enters `skill-synthesis-ui`, which batch 3 owns. **Batch 4 starts
  only after all three wave-1 batches are committed.**
- Batch 5 edits specs that batches 1 and 3 created. It runs last, alone.

**Rules every lane obeys:**

- Never run `npx nx reset` — it is process-wide and would kill the other lanes.
- Never run `nx test projA projB`. Use `npx nx run-many -t test -p <names>` and
  **read the `Running target test for N projects` header, confirming N equals the
  number of names given.** A misspelled alias is silently dropped and the target
  reports success having run nothing.
- Do not edit any `project.json`.
- Do not edit `libs/backend/vscode-core/src/messaging/rpc-handler.ts`.
- Executors do not edit this file and do not create git commits.

---

## Batch 1: Backend write path — the new RPC end to end — COMPLETE (commit 5d94abb87)

- Recommended executor: **backend-developer** (sub-agent)
- Fallback executor: CLI agent lane — codex
- Execution mode: **sequential** (single executor, tasks in order)
- Rationale: five tightly coupled files across three projects that must land as
  one green unit (Concern 1). The whole risk of the task is concentrated in one
  decision — which sidecar fields a save may write — and that is shared-context
  backend reasoning, not boilerplate. Not CLI-lane shaped.
- Tasks: 5 | Depends on: none
- Projects: `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`,
  `@ptah-extension/agent-generation`
- Acceptance criteria satisfied: **R3.2** (write lands under `~/.ptah/user`),
  **R3.5**, **R3.6**, **R3.7**, **R3.8** (backend half), plus NFR Security,
  NFR Data safety, NFR Concurrency, NFR Compatibility.

### Task 1.1: Declare the `skillSynthesis:saveCloneBody` wire contract — COMPLETE

- Files:
  - `.../libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`
  - `.../libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md component 1 (lines 185-232)
- Pattern to follow: `SkillSynthesisKeepCloneParams/Result`
  (`rpc-skill-clone.types.ts:169-177`); registry entry `rpc.types.ts:1738`;
  `RPC_METHOD_ENTRIES` entry `rpc.types.ts:3590`
- Quality requirements: type declarations only; `libs/shared` imports no other
  `@ptah-extension/*` lib
- Validation notes: **three** edits in `rpc.types.ts` — the type import block
  (`:395-420`), the `RpcMethodRegistry` entry (beside `:1738`), and the
  `RPC_METHOD_ENTRIES` literal (beside `:3590`). Missing the third leaves the
  method out of `RPC_METHOD_NAMES` and Task 1.3's `METHODS` tuple then fails
  `manifest.ts:396`.
- Implementation details: `SkillSynthesisSaveCloneBodyParams { kind, slug, body }`
  and `...Result { kind, slug, historyTs }`, exactly as the plan's code block.

### Task 1.2: `SkillSaveCloneBodyParamsSchema` — the first gate — COMPLETE

- Depends on: Task 1.1
- Files:
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts`
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts`
- Plan reference: implementation-plan.md component 2 (lines 234-271)
- Pattern to follow: `SkillRebaseCloneParamsSchema` (`:393-396`)
- Quality requirements: security — this is the boundary the NFR names; it runs
  before any `join`
- Validation notes: **reuse `SlugSchema` (`:326-334`) and `SkillCloneKindSchema`
  (`:324`). Do not author a second slug rule** — they already reject `..`, `/`,
  `\`, empty and >128 chars, which is all of R3.5. `body: z.string().min(1).max(1_048_576)`;
  `.min(1)` is deliberate. **Verification step for the cap assumption:** confirm
  no shipped clone body exceeds 1 MiB before landing (largest measured ~16 KB).
- Implementation details: spec asserts each of `slug: '../x'`, `slug: 'a/b'`,
  `slug: 'a\\b'`, `kind: 'plugin'`, `body: 42`, `body: ''` fails the parse.

### Task 1.3: `registerSaveCloneBody` handler + `METHODS` tuple — COMPLETE

- Depends on: Tasks 1.1, 1.2, 1.4
- Files:
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
  - `.../libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md component 3 (lines 273-310)
- Pattern to follow: `registerRebaseClone` (`:1229-1270`)
- Quality requirements: never return a raw filesystem error string; `parseParams`
  / `requireDesktop` / `toUserError` / `report` reused verbatim
- Validation notes: **the `METHODS` tuple at `:236-279` MUST gain the new name in
  this same task** — see Concern 1. **No new constructor parameter**; `registry`
  and `mirror` are already injected (`:298-301`). Log one `info` with
  `{ kind, slug, historyTs }` on success.
- Implementation details: implement every row of the plan's failure table —
  schema reject, no registry row, `written: false` → `INVALID_PARAMS`,
  `assertUnderUserLayer` throw → generic catch + `report`, non-desktop →
  `PERSISTENCE_UNAVAILABLE`. Call it from `register()` (`:344-391`).

### Task 1.4: `UserLayerMirrorService.saveCloneBody` — the write — COMPLETE

- Depends on: none (can be written first; Task 1.3 calls it)
- File: `.../libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`
- Plan reference: implementation-plan.md component 4 (lines 312-409), including
  the **sidecar state machine table** and the nine ordered steps
- Pattern to follow: `rebaseClone` (`:473-482`), `keepClone` (`:484-493`) —
  lock, then dispatch dir vs file
- Quality requirements: data safety — **step 5, the snapshot, is not optional.**
  A destructive write with no preceding snapshot is a defect.
- Validation notes: **THE BINDING RULE — `sourceHash` is NEVER written by a save.**
  Writing it makes `liveCloneHash === sidecar.sourceHash` true, arms the
  fast-forward branch (`:1138`, `:1200`) and lets the next upstream move silently
  eat the edit. `diverged`, `pendingSourceHash`, `lastEnhancedAt`, `clonedAt`,
  `pluginId`, `version`, `historyDir`, `orphaned` are all untouched.
  `currentContentHash` is the ONLY field written. **If no sidecar exists, do not
  create one** — its absence means "user-authored, hands off". **No SQLite
  registry write.** No `mkdir`, no create on a missing clone.
- Implementation details: result-shaped, never throwing, matching `RebaseResult`'s
  `failed?`/`reason?` idiom (`:149-156`). `snapshotDirToHistory` for `skill`,
  `snapshotFileToHistory` for `agent`/`command` — **the two layouts differ and
  must match `listHistory` (`:580-617`)** or the snapshot never appears in the
  drawer. Resolve the identical paths `readCloneBody` reads
  (`skills-synthesis-rpc.handlers.ts:1967-1970`).

### Task 1.5: Mirror service spec — the five proofs — COMPLETE

- Depends on: Task 1.4
- File: `.../libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts`
- Plan reference: implementation-plan.md component 4 verification seam (lines 400-407)
- Pattern to follow: the existing temp-`~/.ptah/user` fixtures in
  `user-layer-reconcile.spec.ts` / `user-layer-rebase-origins.spec.ts`
- Validation notes: assert (a) the body lands on disk; (b) `listHistory` returns
  one more entry; (c) `sourceHash`, `diverged`, `pendingSourceHash` and
  `lastEnhancedAt` are byte-identical before and after while
  `currentContentHash` changed; (d) a missing clone returns `written: false` and
  creates no file; (e) a clone with no sidecar is written without one being
  created. The full save-then-reconcile proof (R3.8) belongs to Task 5.1.

### Batch 1 verification

- Every listed file exists and contains real implementations, not stubs
- `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation`
- `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation`
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation`
  — **confirm the header reads `Running target test for 3 projects`**
- `rpc-allowlist.spec.ts` is green (this is the Concern-1 gate)
- The VS Code host's `expected-absent` spec still passes —
  `SkillsSynthesisRpcHandlers` stays absent
- `git diff --name-only` shows no `project.json` and no `rpc-handler.ts`
- Reviewer: **code-logic-reviewer** — the sidecar table is a correctness contract
  and the batch is the task's only new trust boundary

---

## Batch 2: Deep-link origin — `AppStateManager` intent + harness control — COMPLETE (commit da107e522)

- Recommended executor: **CLI agent lane — codex** (one lane, tasks in order)
- Fallback executor: frontend-developer (sub-agent)
- Execution mode: **sequential** (2 tasks, 2.2 depends on 2.1)
- Rationale: file-disjoint from every other batch, small, and fully specified by
  plan component 9 steps 1-2 including the exact `<p>`→`<button>` replacement and
  the `!isElectron()` branch. This is the CLI-lane shape the plan's own heuristic
  names. Two tasks, so one lane rather than two.
- Tasks: 2 | Depends on: none
- Projects: `@ptah-extension/core`, `@ptah-extension/marketplace`
- Acceptance criteria satisfied: **R2.4**, **R2.5** (origin half), **R2.6**

### Task 2.1: One-shot navigation intent on `AppStateManager` — COMPLETE

- Files:
  - `.../libs/frontend/core/src/lib/services/app-state.service.ts`
  - `.../libs/frontend/core/src/lib/services/app-state.service.spec.ts`
- Plan reference: implementation-plan.md component 9 contract (lines 662-674)
- Pattern to follow: `setThothActiveTab` (`:589-594`), `setCurrentView('thoth')`
- Quality requirements: the intent is **deliberately NOT part of `ViewSlice`**
- Validation notes: `ViewSlice` (`:169-176`) holds RETAINED per-workspace
  pointers migrated by `switchWorkspace`. Putting the flag there re-applies the
  filter on every later visit to the Skills tab. **`app-state.service.spec.ts:484-581`
  (the per-workspace pointer block) must stay green — it is the proof the intent
  did not leak into the slice.**
- Implementation details: `openSkillsDivergedClones()` sets `currentView` to
  `'thoth'`, sets the Thoth active tab to `'skills'`, raises the flag.
  `consumeSkillsDivergedRequest(): boolean` is read-and-clear. Spec asserts both
  pointers are set, the flag is raised, and a **second** `consume` returns false.

### Task 2.2: Harness local-edit report becomes an activatable control — COMPLETE

- Depends on: Task 2.1
- Files:
  - `.../libs/frontend/marketplace/src/lib/harness/harness-target-row.component.ts`
  - `.../libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
  - `.../libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
- Plan reference: implementation-plan.md component 9 wiring steps 1-2 (lines 676-689)
- Pattern to follow: the row's existing `input()`-in / `output()`-out purity;
  the badge's single instantiation at `harness-health-badge.component.ts:157`
- Quality requirements: accessibility — a real `<button>`, keyboard-reachable,
  with an accessible name stating where it leads (R2.4)
- Validation notes: **REPLACE the inert `<p data-testid="harness-target-overwritten">`
  (`harness-target-row.component.ts:124-134`), do not add a button beside it.**
  Keep the same `data-testid` and the same copy. The row stays dumb — one new
  `openDivergedClones = output<void>()`, **no injected service**; update its
  doc comment at `:16-35`, which currently says it "emits nothing". The badge is
  the container: it injects `AppStateManager` and `VSCodeService` beside its
  existing `HarnessHealthStore` (`:202`) and binds the output.
  **R2.6: when `!isElectron()`, render the original inert `<p>`** — the
  destination is pinned absent in the VS Code host
  (`expected-absent.ts:39`, `:54`). `harness-target-row.component.ts` has no
  co-located spec; cover both host branches through the badge spec.
- Implementation details: badge spec asserts the control is a button in Electron,
  inert text in VS Code, and that activating it calls `openSkillsDivergedClones`
  **exactly once**.

### Batch 2 verification

- Every listed file exists and contains real implementations
- `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/marketplace`
- `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/marketplace`
- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/marketplace`
  — **confirm the header reads `Running target test for 2 projects`**
- `app-state.service.spec.ts:484-581` still green (no `ViewSlice` leak)
- No file under `libs/frontend/skill-synthesis-ui/` was touched
- Reviewer: **code-style-reviewer** — the risk here is a dumb component
  acquiring an injection and an intent leaking into a retained slice; both are
  structural

---

## Batch 3: Skills-UI primitives — gating, batch runner, body editor — COMPLETE (commit 13e105ce3)

- Recommended executor: **frontend-developer** (sub-agent)
- Fallback executor: CLI agent lane — antigravity
- Execution mode: **sequential** (4 tasks; 3.2 and 3.3 both consume 3.1)
- Rationale: three of the four tasks are new files, but the drawer edit-mode
  switch carries real design judgement — focus moves into the textarea on entry
  and back to the Edit button on cancel, and the read-only `ptah-markdown-block`
  render must be replaced rather than hidden. That, plus shared context across
  four files in one lib, is sub-agent shaped rather than CLI-lane shaped.
- Tasks: 4 | Depends on: none
- Project: `@ptah-extension/skill-synthesis-ui`
- **This batch OWNS `libs/frontend/skill-synthesis-ui/src/index.ts`.** No other
  batch may edit it.
- Acceptance criteria satisfied: **R1.4** (service half), **R1.6**, **R3.1**,
  **R3.3**, **R3.9** (predicate half)

### Task 3.1: Bulk eligibility + editor predicate in `clone-action-gating` — COMPLETE

- Files:
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.spec.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/index.ts` (export beside `:17-28`)
- Plan reference: implementation-plan.md component 5 (lines 411-460)
- Pattern to follow: `hasUpstreamSource` (`:86-88`), `cloneActionModel` (`:148-221`)
- Quality requirements: maintainability — **no eligibility rule may be spelled a
  second time in a template or a component**
- Validation notes: **`orphaned` is compared `=== true`, never a truthiness flip**
  — `CloneSummary.orphaned` is optional and its contract note at
  `rpc-skill-clone.types.ts:44-47` requires it (R1.6). `hasUpstreamSource`
  excludes `authored`/`synth`; without it the batch fires doomed calls the
  backend answers `Cannot resolve upstream source`. `BULK_REBASE_EXPLANATION`
  composes the existing `REBASE_EXPLANATION` (`:69-71`) — **do not author a
  second wording.**
- Implementation details: `eligibleForBulkRebase(clones, kind)`,
  `canEditCloneBody(clone, body)` (`body !== null`), `BULK_REBASE_EXPLANATION`.
  Spec covers: orphaned excluded, authored excluded, synth excluded,
  non-diverged excluded, other kinds excluded, **`orphaned: undefined` INCLUDED**.

### Task 3.2: `CloneBulkRebaseService` — the batch runner — COMPLETE

- Depends on: Task 3.1
- Files (both CREATE):
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.spec.ts`
- Plan reference: implementation-plan.md component 6 (lines 462-509)
- Pattern to follow: `SkillSynthesisRpcService.rebaseClone`
  (`skill-synthesis-rpc.service.ts:480-493`); the soft-failure read at
  `skill-clones-view.component.ts:501-508`
- Quality requirements: **sequential by design** — `Promise.all` is explicitly
  rejected; `withSlugLock` serialises only per slug, so parallel rebases run
  N full tree hashes at once for no upside
- Validation notes: **R1.4 in full — each iteration is individually try/caught.**
  A thrown transport error and a `failed: true` result both become
  `{ ok: false, reason }` with the slug named, and the loop continues. The batch
  never aborts early. `running` is cleared in a `finally` so an unexpected throw
  cannot leave the UI permanently disabled. It does NOT decide eligibility, does
  NOT render, does NOT refresh the list.
- Implementation details: `@Injectable()` **provided by the view, not root** —
  its state is one surface's. Signals `running`, `progress` (`{done,total}`),
  `outcomes`; `run(clones)`, `reset()`. Spec: stub RPC where clone 2 of 3 throws
  and clone 3 returns `failed: true`; assert all three attempted, three outcomes,
  both failures name their slugs, `running` ends `false`.

### Task 3.3: `CloneBodyEditorComponent` — COMPLETE

- Depends on: Task 3.1
- Files (both CREATE):
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-body-editor.component.spec.ts`
- Plan reference: implementation-plan.md component 8 (lines 587-643)
- Pattern to follow: the lib's standalone / `OnPush` / `input()` / `output()`
  conventions
- Quality requirements: accessibility — visible label or `aria-label` naming the
  clone; Save/Cancel are real buttons in DOM order
- Validation notes: **never `[innerHTML]`.** The editor is a `<textarea>`; the
  preview stays `ptah-markdown-block` (`libs/frontend/markdown`). While
  `saving()` is true, Save and Cancel are disabled so a double-submit cannot race
  the slug lock. A failed save leaves edit mode with the draft intact.
- Implementation details: selector `ptah-clone-body-editor`;
  `value = input.required<string>()`, `saving = input<boolean>(false)`,
  `save = output<string>()`, `cancel = output<void>()`. `@angular/forms` for the
  textarea binding. Spec: seeds from `value`, emits edited text on save, emits
  **nothing** on cancel (R3.3 — no output means no write can occur), disables
  both while `saving`.

### Task 3.4: Drawer edit mode + `CloneBodySaveRequest` — COMPLETE

- Depends on: Tasks 3.1, 3.3
- Files:
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.ts`
  - **CREATE** `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-detail-drawer.component.spec.ts`
  - MODIFY `.../libs/frontend/skill-synthesis-ui/src/index.ts` (export beside `:11-15`)
- Plan reference: implementation-plan.md component 8 drawer additions (lines 605-638)
- Pattern to follow: the drawer's existing inputs `:365-378` and outputs `:380-386`
- Quality requirements: **the drawer stays strictly presentational** — `input()`
  in, `output()` out, no injected service. The RPC call stays in the smart view.
- Validation notes: **Concern 4 decision — declare `CloneBodySaveRequest`
  (`{ clone, body }`) in this file**, beside the drawer's existing output types,
  so the index export sits beside the existing drawer exports as the plan asks.
  **Concern 5 — `clone-detail-drawer.component.spec.ts` does not exist today;
  create it.** The Body section is `:237-261` and the read-only render is
  `<ptah-markdown-block [content]="text" />` at `:251`; activating Edit
  **replaces** that render, it does not hide it beside a second one. The drawer
  is 437 lines — a mode switch plus four members keeps it well under 700 because
  the editor is a separate file.
- Implementation details: add `canEditBody = input<boolean>(false)`,
  `bodySaving = input<boolean>(false)`, `bodySaved = output<CloneBodySaveRequest>()`.
  Focus moves into the textarea on entering edit mode and back to the Edit button
  on cancel. Spec asserts the markdown block is absent in edit mode and the Edit
  affordance is absent when `canEditBody()` is false.

### Batch 3 verification

- All four created files exist with real implementations, not stubs
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis-ui`
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis-ui`
- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui`
  — **confirm the header reads `Running target test for 1 project`**
- `skill-clones-state.service.spec.ts:96` (`divergedCount` semantics) still green
  — `SkillClonesStateService.divergedCount` is **left alone** by this task
- `skill-clones-view.component.ts` and `skill-synthesis-tab.component.ts` are
  **untouched** by this batch (`git diff --name-only` confirms)
- Reviewer: **code-logic-reviewer** — R1.4's continue-past-failure and R1.6's
  `=== true` are both behavioural contracts a style pass would not catch

---

## Batch 4: Skills-UI integration — filter, count, bulk control, save, deep-link arrival — COMPLETE (commit 3415055ae)

- Recommended executor: **frontend-developer** (sub-agent)
- Fallback executor: CLI agent lane — claude cli (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`)
- Execution mode: **sequential**
- Rationale: this is the batch that needs design judgement mid-flight — the
  585-line view gains new state, a second dialog, an in-flight lock and a
  deep-link input, and the plan pre-authorises a facade-rule extraction if it
  crosses 700 lines. It also holds both contended files, so it cannot be
  parallelised even in principle.
- Tasks: 4 | **Depends on: Batches 1, 2 AND 3 — all three must be committed**
- Project: `@ptah-extension/skill-synthesis-ui`
- **This batch OWNS `skill-clones-view.component.ts` and
  `skill-synthesis-tab.component.ts`.** It must NOT edit `src/index.ts` (batch 3
  owns it); if a new export is genuinely needed, say so rather than editing it.
- Acceptance criteria satisfied: **R1.1, R1.2, R1.3, R1.5, R1.7, R2.1, R2.2,
  R2.3, R2.5** (arrival half), **R3.1/R3.3/R3.4** (wiring), **R3.9**

### Task 4.1: RPC facade + state-service `saveCloneBody` — COMPLETE

- Files:
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts`
- Plan reference: implementation-plan.md component 7 files (lines 584-585)
- Pattern to follow: the `keepClone` wrapper (`skill-synthesis-rpc.service.ts:496-509`)
- Quality requirements: the frontend imports no backend lib; types come from
  `@ptah-extension/shared`
- Validation notes: **needs batch 1's `SkillSynthesisSaveCloneBodyParams/Result`**
  — this is the ordering constraint that forces batch 4 after batch 1. Use
  `PROMOTE_MS` as the timeout, matching its sibling. `SkillClonesStateService.divergedCount`
  is **left alone** — changing its semantics breaks a passing spec for no gain.
- Implementation details: `saveCloneBody` on the facade; a state-service method
  that delegates and reloads `detail`.

### Task 4.2: View — diverged filter, count, bulk control, in-flight lock — COMPLETE

- Depends on: Task 4.1
- Files:
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
- Plan reference: implementation-plan.md component 7 (lines 511-585), including
  open question 1 (CURRENT KIND ONLY)
- Pattern to follow: the existing confirmation dialog `:248-295` — same
  construction, same `role="dialog" aria-modal="true"`, same keyboard-reachable
  Cancel; `busySlug` `:318`, `showToast` `:577-580`, `toMessage` `:582-584`
- Quality requirements: accessibility — the filter is a real button or checkbox
  with `aria-pressed`; the bulk control's accessible name names the count.
  Maintainability — the file is 585 lines against a 700-line WARN; **if it
  crosses, apply the facade rule: extract `BulkRebaseConfirmComponent` as a
  nameable collaborator keeping `ptah-skill-clones-view`'s selector and
  behaviour. Never a `helpers`/`utils` file.**
- Validation notes: **R1.1 — at zero eligible, render the control DISABLED with a
  stated reason, not silently absent.** **R1.3 — nothing is written before the
  confirm click**; the confirmation names `bulkEligible().length` and renders
  `BULK_REBASE_EXPLANATION`. **R1.5 — call `state.refreshClones()` exactly ONCE
  after the batch settles**; count and list are `computed` and update with no
  reload. **R1.7 — `[disabled]="actionsLocked()"` on the bulk button, the refresh
  button, the confirm button, and `[busy]` on every card and the drawer.**
  **R2.3 — an emptied filter renders the `clones-empty` branch (`:181-191`) with
  distinct copy, never a blank region.** **Open question 1: the bulk action acts
  on the CURRENT KIND ONLY**, and the count readout must append the inert
  `(M in other kinds)` residual — it offers no action and starts no write.
  Provide `CloneBulkRebaseService` **on the component**, not in root.
- Implementation details: `divergedOnly = signal(false)`, `bulkEligible`,
  `divergedInOtherKinds`, `bulkConfirmOpen`, `actionsLocked`; `visibleClones`
  gains `&& (!this.divergedOnly() || c.diverged)`. Batch outcomes render as one
  summary toast naming the failed slugs. Spec covers every bullet of the plan's
  verification seam (lines 575-580).

### Task 4.3: Deep-link arrival — tab consumes the flag, view receives an input — COMPLETE

- Depends on: Task 4.2
- Files:
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` (the receiving `input()`)
- Plan reference: implementation-plan.md component 9 wiring steps 3-4 (lines 690-695)
  and data flow C (lines 774-782)
- Pattern to follow: `_subView` `:878`, `setSubView` `:915`, `SkillSubView`
  union `:52-57`
- Quality requirements: one consumption only
- Validation notes: **Concern 3 decision — the TAB injects `AppStateManager` and
  calls `consumeSkillsDivergedRequest()` in a single `effect()`; the clones view
  does NOT consume it and does NOT inject `AppStateManager` for this purpose.**
  Component 7's wording says the view injects it; that wording is superseded —
  a read-and-clear consumed twice is a race between two effects, as the plan
  itself warns. **`skill-synthesis-tab.component.ts:580` currently renders
  `<ptah-skill-clones-view />` with no bindings** — add the binding there.
  **Needs batch 2's `AppStateManager` methods** — this is the second ordering
  constraint on batch 4.
- Implementation details: on a raised flag, `setSubView('clones')` and pass the
  filter down as an `input()` the view applies to `divergedOnly` (R2.5). Tab spec
  asserts a raised flag lands on the `clones` sub-view with the filter applied.

### Task 4.4: Drawer wiring, save orchestration, and the CLAUDE.md correction — COMPLETE (with one outstanding doc item — see the Batch 4 outcome)

- Depends on: Tasks 4.1, 4.2
- Files:
  - `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  - `.../libs/frontend/skill-synthesis-ui/CLAUDE.md`
- Plan reference: implementation-plan.md component 7 R3.2/R3.4 (lines 551-555)
  and the files-affected note (lines 915-919)
- Pattern to follow: the post-apply refresh already at `:459-466`
- Validation notes: **R3.4 — on a successful save call `state.loadDetail(slug, kind)`
  and `state.refreshClones()`; `historyCount` rises because the mirror
  snapshotted.** **R3.9/R2.6 — feed `canEditBody` from `canEditCloneBody()`; the
  whole view is already behind the Electron placeholder (`:97-107`), so the
  affordance cannot render in VS Code.** A save failure reuses `showToast` with
  `toMessage(err)` — the message is already sanitised server-side by `toUserError`.
  **CLAUDE.md: DELETE the Guidelines bullet at `libs/frontend/skill-synthesis-ui/CLAUDE.md:89`
  — "Do not Electron-gate this tab — skills work on VS Code too."** It
  contradicts the file's own "Runtime: ELECTRON-ONLY" section at `:29` and
  contradicts `expected-absent.ts:39`. A reader following it would build the VS
  Code parity this task explicitly rejected. Delete the bullet; do not edit the
  `:29` section.
- Implementation details: `onSaveBody(req)` → `state.saveCloneBody(...)`; bind
  `bodySaving` from the in-flight signal.

### Batch 4 verification

- Every listed file exists and contains real implementations
- `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui`
- `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui`
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui`
  — **confirm the header reads `Running target test for 6 projects`**
- `libs/frontend/skill-synthesis-ui/src/index.ts` is **not** in
  `git diff --name-only` for this batch
- `skill-clones-state.service.spec.ts:96` still green
- `skill-clones-view.component.ts` line count reported; if over 700, the facade
  extraction was applied with a nameable collaborator
- Reviewers: **code-logic-reviewer** (R1.5's single refresh, R1.7's lock, R2.5's
  one-shot consumption) **and code-style-reviewer** (the 700-line ceiling and
  the facade rule if it triggered)

### Batch 4 outcome — verified on the diff, not on the report

Every check below was made by reading the diff and the files, not by trusting
`batch-4-report.md`.

- **Concern 3 holds — exactly ONE consumer of the read-and-clear.**
  `consumeSkillsDivergedRequest()` appears in exactly one production statement,
  `skill-synthesis-tab.component.ts:731`, inside one `effect()` in the tab's
  constructor. The clones view injects only `SkillClonesStateService`,
  `SkillSynthesisRpcService`, `VSCodeService` and `CloneBulkRebaseService`; it
  mentions `AppStateManager` only in a comment explaining why it does NOT inject
  it, and receives `divergedFilterRequested = input<boolean>(false)` instead.
  `skill-synthesis-tab.component.ts:581` now binds it, where it previously
  rendered `<ptah-skill-clones-view />` with nothing. Pinned by a tab spec that
  mounts twice and asserts the SECOND mount lands on Recommended.
- **The body editor binding is `(cancelled)`**, at
  `clone-detail-drawer.component.ts:291` (batch 3's file, correctly left alone).
  Batch 4 binds only `[canEditBody]`, `[bodySaving]` and `(bodySaved)` on the
  drawer. No `(cancel)` binding exists anywhere in the lib.
- **R1.1** — the bulk control is rendered unconditionally and
  `[disabled]="eligibleCount() === 0 || locked()"`, with the reason in
  `clones-bulk-disabled-reason` wired by `aria-describedby`. Not absent. Pinned.
- **R1.3** — `bulkRebaseRequested` only sets `bulkConfirmOpen`; the first
  `rebaseClone` call is reachable only from `onConfirmBulkRebase()`. The dialog
  names `bulkEligible().length` and renders `BULK_REBASE_EXPLANATION` verbatim.
  Pinned by a spec that clicks the control, asserts `rebaseClone` was never
  called, then cancels and asserts it again.
- **R1.5** — `state.refreshClones()` appears exactly once in
  `onConfirmBulkRebase()`, after `await this.bulk.run(targets)`. Pinned by call
  count (1 from `ngOnInit` + 1 = 2).
- **R1.7** — `actionsLocked()` is `bulk.running() || busySlug() !== null ||
  bodySaving()` and gates the bulk button, `clones-refresh`, the reconcile
  confirm, the bulk confirm and the drawer's `[busy]`; every card takes
  `busySlug() === c.slug || bulk.running()`. `bodySaving` in that disjunction is
  the executor's addition beyond the plan and is correct — a body save takes the
  same slug lock. Pinned by a spec holding a rebase promise open.
- **R2.3** — `emptyCopy` switches to `DIVERGED_EMPTY_COPY` while the filter is
  on, and the toolbar renders ABOVE the empty branch so the filter stays
  reachable. Pinned.
- **`(M in other kinds)`** — `CloneBulkToolbarComponent.countLabel` appends it
  from `divergedInOtherKinds().length`. It is a `<span>` with no handler and no
  control: inert by construction. Pinned.
- **No eligibility rule is re-spelled.** The view imports
  `eligibleForBulkRebase` and `canEditCloneBody` from `clone-action-gating.ts`;
  both new components receive already-derived counts and booleans and decide
  nothing. `orphaned !== true` and `hasUpstreamSource` exist in exactly one
  place (`clone-action-gating.ts:129-135`).
- **`src/index.ts` is NOT in `git diff --name-only`** — batch 3's ownership held.
  No `project.json`, no `rpc-handler.ts`, and no `npx nx reset` was run.

#### The 700-line ceiling and the second facade extraction — accepted

`skill-clones-view.component.ts` is **747 raw lines**, but ESLint's `max-lines`
counts neither blank lines nor comments: its count is **591**, and
`npx eslint` on the file reports **0 problems**. The ceiling was therefore not
crossed — *because* the extraction happened. Inlining the two collaborators back
would add roughly 190 counted lines and put it near 780, over the warn
threshold. The extraction was needed.

Both names pass the nameability test and neither is a `helpers` / `utils` /
`common` / `misc` fragment:

- `BulkRebaseConfirmComponent` (90 lines) — the plan pre-authorised this one by
  name. It carries its own accessible-dialog contract (`role="dialog"`,
  `aria-modal`, reachable Cancel) and its own inputs and outputs.
- `CloneBulkToolbarComponent` (124 lines) — the executor's own addition. It owns
  one statable concern: turning counts into English. It is the ONLY place a
  count becomes a sentence, which is exactly why the `(M in other kinds)`
  residual and the R1.1 disabled reason cannot drift apart from the count they
  describe.

Both are under the ~150-line guardrail, which is the one guardrail this split
brushes against. Judged acceptable rather than fragment sprawl: the view kept
its selector, its state and every behaviour; its constructor gained one
injection, not eight; and the count is TWO collaborators, inside the "prefer
2-3 over 6 fragments" guidance. **Flagged for code-style-reviewer** as the
single judgement call in this batch rather than settled unilaterally.

#### Gates re-run by the team-leader with the worktree idle

- `typecheck`, all 6 projects — header `Running target typecheck for 6
  projects`, result **`Successfully ran target typecheck for 6 projects`**.
- `lint`, all 6 projects — **`Successfully ran target lint for 6 projects`**,
  **0 errors** in every project. Warnings only, all pre-existing (`max-lines` on
  `rpc.types.ts` and `skill-synthesis-tab.component.ts`, unused
  eslint-disable directives, non-null assertions). `npx eslint` scoped to the
  three view files: 0 problems.
- `test`, **5 projects** — header `Running target test for 5 projects`, result
  **`Successfully ran target test for 5 projects`**: shared 56/1375,
  rpc-handlers 94/2741 (+31 skipped), core 28/666, marketplace 12/241,
  **skill-synthesis-ui 26 suites / 397 tests**. `skill-clones-state.service.spec.ts`
  (the `divergedCount` pin) is inside that green.

**`@ptah-extension/agent-generation:test` was DELIBERATELY NOT RUN as a gate for
this batch, and this is a stated skip, not an omission.** Its `user-layer-*`
suites run real temporary filesystems against Jest's 5000 ms default and fail
non-deterministically under load. The condition is pre-existing on `main`: a
control run on a clean `main` checkout with the same `run-many` set failed 12
distinct tests — MORE than this worktree. `git diff --name-only` for batch 4
lists seven paths, **all** under `libs/frontend/skill-synthesis-ui/`, so this
batch changed **zero** files in `agent-generation` and cannot have caused it.
Batch 5 owns a file in that project and will have to confront the flakiness
directly.

**Correction to the wave-1 note above:** batch 1 recorded that
`agent-generation` "passed alone: 31 suites / 970". The batch-4 executor
measured it failing when run ALONE as well (3 failed / 967 passed). The
alone-run reduces the failure count but does not eliminate it, so the wave-1
claim is not reliably reproducible on this machine. The cause is unchanged.
**For `future-enhancements.md`:** the `user-layer-*` suites need an explicit
per-suite `jest.setTimeout` well above 5000 ms.

#### OUTSTANDING — the root CLAUDE.md correction was NOT made

Task 4.4 was executed as written: the Guidelines bullet "Do not Electron-gate
this tab — skills work on VS Code too." is deleted from
`libs/frontend/skill-synthesis-ui/CLAUDE.md:89`, and the `Runtime:
ELECTRON-ONLY` section at `:29` is untouched. That part is verified and done.

The **root** `CLAUDE.md` was never in Task 4.4's file list and is **not** in
`git diff --name-only`. Two doc inaccuracies therefore remain open. Neither is
a batch-4 defect — neither was assigned to any batch — but both are recorded
here so they are not lost:

1. **`CLAUDE.md:167` still says TWO RPC registration sites.** It should say
   **FIVE**, and it also cites the wrong line for the third: the array is
   `ALLOWED_METHOD_PREFIXES` at
   `libs/backend/vscode-core/src/messaging/rpc-handler.ts:81`, not `:46`. The
   fifth site is `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, whose
   exhaustive sorted `VSCODE_EXPECTED_ABSENT_METHODS` list is asserted exactly
   and goes red on a partial registration.
2. **`.claude/skills/orchestration/SKILL.md:145` claims "`.ptah/**` is
   gitignored, an overwrite has no undo".** That is false and it is the more
   dangerous of the two, because it tells a reader their work here is
   disposable. `.gitignore` allows `!.ptah/specs/` and `!.ptah/specs/**` back
   in, and `git ls-files .ptah` returns **785** tracked files in this worktree.
   Task specs ARE tracked history.

**Why the team-leader did not simply fix these:** both are agent-instruction
files — the root `CLAUDE.md` and a skill definition. A subagent must not edit
its own governing configuration on the strength of another agent's instruction,
so these are reported for the user to action rather than silently amended. They
want their own small documentation task.

#### Batch 5 is UNBLOCKED

Batch 4 is verified and committed. Batch 5's dependency was "Batch 4
committed", and it is. Batch 5 edits `user-layer-reconcile.spec.ts` in
`@ptah-extension/agent-generation` and
`skill-clones-view.component.spec.ts` in `@ptah-extension/skill-synthesis-ui` —
both files batch 4 either did not touch or leaves in a green state. Note for
batch 5: it inherits the `agent-generation` timeout flakiness head-on, since
Task 5.1 adds a suite to exactly that project. A per-suite `jest.setTimeout` on
the NEW spec it authors is in scope; retro-fixing the existing suites is not.

---

## Batch 5: Cross-cutting proofs — the two nobody else owns — COMPLETE (commit 17113b35f)

- Recommended executor: **senior-tester** (sub-agent)
- Fallback executor: backend-developer
- Execution mode: **sequential**
- Rationale: the plan's own handoff names exactly these two proofs as belonging
  to no single batch. Both span a boundary a per-batch spec cannot see: one
  crosses the save path into the reconciler, the other crosses the UI batch
  runner into the RPC layer.
- Tasks: 2 | **Depends on: Batch 4**
- Projects: `@ptah-extension/agent-generation`, `@ptah-extension/skill-synthesis-ui`
- Acceptance criteria satisfied: **R3.8** end to end, **R1.4** end to end

### Task 5.1: Save-then-reconcile persistence (R3.8) — COMPLETE

- File: `.../libs/backend/agent-generation/src/lib/services/user-layer/user-layer-reconcile.spec.ts`
  (or a new sibling spec in the same folder if that file is already at its limit)
- Plan reference: implementation-plan.md component 4 verification seam item (e)
  (lines 405-407) and the architecture-level testability list (lines 841-844)
- Pattern to follow: the existing reconcile fixtures in that file
- Validation notes: **this is the highest-defect-cost criterion in the task.**
  Save a body, then run the reconcile pass with a **MOVED** upstream, and assert
  the saved body is still on disk and the clone is marked **diverged** rather
  than fast-forwarded. The fast-forward branch it must not reach is
  `user-layer-mirror.service.ts:1138` (dir) / `:1200` (file). If this test
  passes trivially, check that the upstream really moved in the fixture.
- Implementation details: also assert the `.history` snapshot from the save is
  still present and `listHistory` returns it.

### Task 5.2: Partial-batch outcome, end to end (R1.4) — COMPLETE

- File: `.../libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts`
- Plan reference: implementation-plan.md component 7 verification seam (lines 575-580)
- Validation notes: a mid-batch failure still reaches the last clone, the failed
  slug is named in the summary toast, exactly `N` `rebaseClone` calls are made
  for `N` eligible clones, and `state.refreshClones()` is called **exactly once**.
  Task 3.2 proves this at the service level; this proves it reaches the user.
- Implementation details: if the batch-4 spec already covers a case here, extend
  rather than duplicate it.

### Batch 5 verification

- Both proofs exist as named, running tests — not skipped, not `it.todo`
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui`
  — **confirm the header reads `Running target test for 6 projects`**
- No production file was modified by this batch (`git diff --name-only` shows
  only `*.spec.ts`); if a proof cannot pass without a production change, that is
  a finding to report, not a change to make here
- Reviewer: **code-logic-reviewer** — a test that passes for the wrong reason is
  the failure mode this batch exists to avoid

---

## Acceptance-criteria coverage map

| Criterion | Batch | Criterion | Batch | Criterion | Batch    |
| --------- | ----- | --------- | ----- | --------- | -------- |
| R1.1      | 4     | R2.1      | 4     | R3.1      | 3, 4     |
| R1.2      | 4     | R2.2      | 4     | R3.2      | 1, 4     |
| R1.3      | 4     | R2.3      | 4     | R3.3      | 3, 4     |
| R1.4      | 3, 5  | R2.4      | 2     | R3.4      | 4        |
| R1.5      | 4     | R2.5      | 2, 4  | R3.5      | 1        |
| R1.6      | 3     | R2.6      | 2, 4  | R3.6      | 1        |
| R1.7      | 4     |           |       | R3.7      | 1        |
|           |       |           |       | R3.8      | 1, 5     |
|           |       |           |       | R3.9      | 3, 4     |

All 22 criteria are claimed by at least one batch.

---

## Completion summary — TASK COMPLETE

Five batches, plus two post-review commits. Every commit below resolves in
`git log` on `skills-tab-clone-management`.

| # | Commit      | What it carries                                                    |
| - | ----------- | ------------------------------------------------------------------ |
| 1 | `5d94abb87` | Batch 1 — the `skillSynthesis:saveCloneBody` write path end to end |
| 2 | `da107e522` | Batch 2 — the deep-link origin on the harness health row           |
| 3 | `13e105ce3` | Batch 3 — gating, batch runner, body editor                        |
| 4 | `3415055ae` | Batch 4 — filter, count, bulk control, save, deep-link arrival     |
| 5 | `17113b35f` | Batch 5 — the save-then-reconcile and partial-batch proofs         |
| 6 | `e28ab0c8c` | Review fixes — the cross-clone detail bug and two moderate findings |
| 7 | `02e392e28` | API and dead-code cleanup                                          |

### Final gates — every one re-run with `--skip-nx-cache`, worktree idle

The style reviewer was once served a stale cached lint result for
`skill-synthesis-ui`, so nothing below is a cached green.

- `typecheck`, 6 projects — `Successfully ran target typecheck for 6 projects`.
- `lint`, 6 projects — `Successfully ran target lint for 6 projects`, **0
  errors** in every project. Warnings only, all pre-existing in kind
  (`max-lines`, unused type imports, non-null assertions in specs).
- `test`, 5 projects (`shared`, `rpc-handlers`, `core`, `marketplace`,
  `skill-synthesis-ui`) — header `Running target test for 5 projects`, result
  `Successfully ran target test for 5 projects`: 56/1375, 94/2741 (+31
  skipped), 28/666, 12/241, and **skill-synthesis-ui 26 suites / 417 tests**
  (397 at batch 4, so +20 from batch 5 and the fixes).
- `test`, `@ptah-extension/agent-generation` **ALONE, twice** — **32 suites /
  977 tests passed on both runs.** 31 suites / 970 tests before this task, so
  the new `user-layer-save-reconcile.spec.ts` contributes the extra suite and
  its 7 cases, and they passed twice. **The known `agent-generation` timeouts
  did not reproduce on either alone-run.** The new suite carries its own
  `jest.setTimeout(30_000)` rather than inheriting Jest's 5000 ms default, which
  is why it is not exposed to the load sensitivity the sibling suites are.

### Verification of the final pass, on the diff rather than the reports

- **The cross-clone body write is fixed at the root.**
  `SkillClonesStateService.loadDetail` derives `key = ${kind}/${slug}`, and a
  key change clears `detail` **before** the await; every branch of the
  try/catch/finally returns early unless `detailKey === key`, so a late reply
  cannot overwrite the winner and cannot clear the winner's spinner.
  `clearDetail` resets the key and forces `detailLoading` false, which is
  required precisely because an orphaned reply's `finally` no longer will.
  Pinned by three tests that hold replies open with explicit resolvers: switch
  clears, late reply is ignored, same-entry reload does not blank.
- **`user-layer-save-reconcile.spec.ts` exercises the real control flow.** It
  constructs the real `UserLayerMirrorService` against a real temp filesystem
  with `homedir()` redirected into it, calls the real `saveCloneBody`,
  `reconcile` and `listHistory`, and asserts the reconciler's own branch
  counters (`fastForwarded: 0`, `noop: 0`, `diverged: 1`) rather than only file
  content. Its `moveUpstream` helper recomputes the live source hash and the
  test **asserts the upstream really moved** — a fixture that failed to move it
  fails the test instead of passing trivially, which is the stub failure mode
  this batch existed to avoid. The two `KNOWN LIMITATION` cases pin the
  OPPOSITE outcome (`pass2.fastForwarded === 1`, body back to `# v2 upstream`)
  and the file header states in a boxed warning that they are **not** a green
  tick for R3.8. A reader cannot mistake the suite for proof that editing a
  sidecar-less clone is safe.
- **The removed exports are genuinely unreferenced outside the lib.** A
  workspace-wide search for `CloneBulkRebaseService`, `BulkRebaseOutcome`,
  `BulkRebaseProgress` and `CloneBodyEditorComponent` returns hits only under
  `libs/frontend/skill-synthesis-ui/`, all via relative imports.
  **`providers: [CloneBulkRebaseService]` survives at
  `skill-clones-view.component.ts:116`** with the injection at `:346` — the
  barrel export was removed, the provider was not.
- **The REFUSED third moderate finding stands.** An orphaned clone remains
  editable, and `canEditCloneBody`'s doc now carries the evidence: `orphaned`
  means rebase has no target, not that the file is unwritable, and the
  `CloneSummary` contract calls such an entry user-owned. The ignored `clone`
  parameter now carries the null-selection condition the view used to re-spell.

### Acceptance criteria

Met unless stated. "Verified at batch N" means verified by the team-leader on
the files, with the evidence recorded in this file above.

| Criterion | Verdict | Evidence |
| --------- | ------- | -------- |
| R1.1 bulk control present, or disabled with a reason | MET | Batch 4 — rendered unconditionally, `[disabled]` with `clones-bulk-disabled-reason` via `aria-describedby` |
| R1.2 reuses the existing per-clone rebase path | MET | Batch 3 — `CloneBulkRebaseService` calls `rpc.rebaseClone` once per clone; no second implementation |
| R1.3 confirmation names the count before any write | MET | Batch 4 — first `rebaseClone` reachable only from `onConfirmBulkRebase()`; pinned by a spec that clicks and asserts zero calls |
| R1.4 batch continues past a failure, names the slug | MET | Batch 3 at the service level; batch 5 end to end, including a failure on the FIRST entry |
| R1.5 count drops with no manual reload | MET | Batch 4 — `refreshClones()` exactly once after the batch; count and list are `computed` |
| R1.6 orphaned excluded from the batch | MET | Batch 3 — `orphaned !== true`, so `undefined` is included; spelled once |
| R1.7 conflicting controls disabled in flight | MET | Batch 4 — `actionsLocked()`; batch 5 adds the lock-release proof after a throw |
| R2.1 diverged count for the current kind | MET | Batch 4 — `CloneBulkToolbarComponent.countLabel` |
| R2.2 filter shows only diverged, clears back | MET | Batch 4 — `visibleClones` gains `!divergedOnly() \|\| c.diverged` |
| R2.3 emptied filter renders an empty state | MET | Batch 4 — `DIVERGED_EMPTY_COPY`, toolbar above the empty branch |
| R2.4 the local-edit report is an activatable control | MET | Batch 2 — the inert `<p>` REPLACED by a real `<button>` with an accessible name |
| R2.5 arrives on Skills with the filter applied | MET | Batches 2 and 4 — one consumption of the read-and-clear, in the tab |
| R2.6 VS Code offers no unreachable destination | MET | Batch 2 — the `@else` inert `<p>`; batch 4 — the whole view is behind the Electron placeholder |
| R3.1 edit affordance replaces the read-only render | MET | Batch 3 — the markdown block is absent in edit mode, pinned |
| R3.2 one new RPC writes under `~/.ptah/user` | MET | Batch 1 |
| R3.3 cancel writes nothing | MET | Batch 3 — `cancelled` carries no payload, so no write can occur |
| R3.4 re-read after save, `historyCount` up by one | MET | Batch 4 for the re-read; batch 5 proves `listHistory` contains the save's own `historyTs` for all three kinds |
| R3.5 validation rejects bad slug, kind, body | MET | Batch 1 — Zod gate is the handler's first statement, reusing `SlugSchema` |
| R3.6 out-of-layer path refused as an error | MET | Batch 1 — `assertUnderUserLayer` stays the second gate |
| R3.7 unknown clone rejected, nothing created | MET | Batch 1; re-proven in batch 5 — `written: false, reason: 'clone-missing'` and the directory does not exist afterwards |
| R3.8 saved body survives the next reconcile | **MET, CONDITIONALLY — see the limitation below** | Batch 5 proves it for skill, command and agent clones that HAVE a sidecar, with the upstream provably moved. It does NOT hold for a sidecar-less clone, and that is measured, not assumed |
| R3.9 no edit affordance on VS Code | MET | Batches 3 and 4 |

Nothing was verified by reading a report alone.

### The known limitation of this feature — user-visible, not a defect here

**A saved body survives the next reconcile only when the clone HAS an origin
sidecar.** For a sidecar-less clone (the marker for hand-authored, hands-off
content), `reconcileMissingSidecar` / `reconcileMissingFileSidecar` mint a
sidecar whose `sourceHash` is the hash of the user's own just-saved body; the
pass after the mint therefore reads the clone as unmodified and fast-forwards
over it. The body survives pass 1 and is lost on pass 2. That is a pre-existing
reconciler rule, not something this task introduced, and it is pinned by the two
`KNOWN LIMITATION` cases so a future change cannot alter it silently. Deciding
what the product should do about it — refuse the editor there, or mint a sidecar
that records divergence — is its own task.

### Deferred, with the reason

- **Style findings, all judged real and none blocking.** User-facing copy has
  four homes in this lib and should have one. The string builders belong in
  `clone-action-gating.ts` beside the rules they describe. The inline reconcile
  modal should reuse `BulkRebaseConfirmComponent`, which is the stronger of the
  two dialogs. `skill-synthesis-tab.component.ts` counts 1175 lines against the
  700 warn — it was 1230 on `main` before this task, so this work reduced it.
  Deferred because each is a move of working code across files in a lib that
  just landed five batches, and none changes behaviour.
- **Two documentation defects, DECLINED and awaiting the user's decision.** Both
  are agent-instruction files, which a subagent must not edit on another agent's
  instruction:
  1. Root `CLAUDE.md:167` says there are **two** RPC registration sites. There
     are **five** — the fifth is
     `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`, whose exhaustive
     sorted `VSCODE_EXPECTED_ABSENT_METHODS` is asserted exactly and goes red on
     a partial registration. It also cites `rpc-handler.ts:46` for
     `ALLOWED_METHOD_PREFIXES`, which is at `:81`.
  2. `.claude/skills/orchestration/SKILL.md:145` claims `.ptah/**` is gitignored
     and an overwrite has no undo. False, and the more dangerous of the two:
     `.gitignore` allows `!.ptah/specs/` back in and `git ls-files .ptah`
     returns 785 tracked files. Task specs ARE tracked history.
- **Pre-existing and out of scope.** `@ptah-extension/agent-generation`'s
  temp-filesystem `user-layer-*` suites time out at Jest's 5000 ms default under
  load; a control run on clean `main` with the same parallel command failed 12
  tests, more than this worktree. They need explicit per-suite timeouts, as the
  new spec has. Separately, `reapDeletedUpstream` runs OUTSIDE `withSlugLock`,
  unlike every reconcile branch — worth a look, untouched here.

### Risk resolution

| Validation risk | Resolution |
| --------------- | ---------- |
| A save writes `sourceHash` and arms the fast-forward, eating the edit | ADDRESSED — `currentContentHash` is the only field written; batch 5 compares the four frozen fields as one JSON string before and after, and proves the reconciler takes the diverged branch |
| Split RPC registration leaves the tree red between commits | ADDRESSED — components 1-4 landed as one commit; `rpc-allowlist.spec.ts` green, and the fifth site was found and fed |
| Bulk rebase discards real user work with no diff preview | ADDRESSED — confirmation names the count and renders `BULK_REBASE_EXPLANATION`; the per-clone snapshot is the existing `rebaseClone` behaviour |
| A crafted slug escapes `~/.ptah/user` | ADDRESSED — Zod gate before any `join`, `assertUnderUserLayer` second |
| Two executors hold a contended file | ADDRESSED — `src/index.ts` stayed out of batch 4's diff; the ownership split held |
| The deep-link flag is consumed twice and races | ADDRESSED — exactly one production call site, in the tab |
| Batch aborts on first failure | ADDRESSED — per-iteration try/catch, `running` cleared in `finally`; proven at both levels |
| The intent leaks into `ViewSlice` | ADDRESSED — standalone private signal, absent from `switchWorkspace` |
| Concurrent nx runs contend on the daemon | ADDRESSED — no `nx reset` was run by any executor; no `project.json` was touched |

### Next action: QA

Recommended: **visual review** of the Skills tab in Electron. Everything a
reviewer can reach by reading is now covered — logic and style reviews both ran,
their serious and moderate findings are fixed, and the behavioural contracts are
pinned by tests at both the service and the view level. What no test in this
task exercised is the rendered surface: a new toolbar, a second modal dialog, an
in-place editor with two new inline messages (the empty-body reason and the
changed-underneath alert), and a disabled-with-reason control. Focus, contrast
and the `role="alert"` / `role="status"` announcements are exactly what a
browser-driven pass sees and a unit test does not.

Other options: tester (the acceptance criteria are already pinned, so this would
mostly re-run what batch 5 landed), style review of the four deferred findings
as its own task, or skip.
