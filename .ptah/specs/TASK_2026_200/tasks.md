# Development Tasks — TASK_2026_200

**Total Tasks**: 22 | **Batches**: 5 | **Status**: 5/5 complete — task at `in_review`, NOT `done` (see closing summary)

**Source of plan**: `context.md` §4 + §7.3 and `research-report.md` §6. There is no
`implementation-plan.md` for this task and none is required.

**Ordering rationale**: Batch 1 fixes and proves the _confirmed, deterministic,
single-window Electron repro_ (`research-report.md` §4.A) — the defect the user
actually reported. Every later batch depends on the file index being
re-buildable, so nothing else can be verified first. Batches 2→4 then thread
explicit scoping outward (contract → backend handlers → frontend call sites),
and Batch 5 closes the remaining acceptance criteria as tests.

**CLI delegation is disabled for this task.** Every batch runs on a sub-agent.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS — no blockers. Five findings change the
shape of the work; all have mitigation tasks below. No settled decision is
reopened.

### Assumptions verified against source

| #   | Assumption                                                                | Result                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `coreDeps` is built before the session-aware proxy and never receives one | ✅ Confirmed — `ptah-api-builder.service.ts:417-429`; `coreDeps` is passed to `workspace` (`:466`) and `search` (`:468`) only                                                                                                                      |
| 2   | `ensureReady()` pins the root for the process lifetime                    | ✅ Confirmed — `workspace-file-index.service.ts:170-179`, guarded on `this.started` which is set once at `:185` and never reset                                                                                                                    |
| 3   | `workspace:switch` never re-indexes                                       | ✅ Confirmed — `workspace-rpc.handlers.ts:284-304` calls `switchWorkspace()` + `setActiveFolder()` only; no `fileIndex` reference                                                                                                                  |
| 4   | Picker RPC params carry no root                                           | ✅ Confirmed — `rpc-misc.types.ts:14-27` (`ContextGetAllFilesParams`, `ContextGetFileSuggestionsParams`), `:52-58` (`AutocompleteAgentsParams`)                                                                                                    |
| 5   | `WorkspaceAnalyzerService` caches one unkeyed snapshot                    | ✅ Confirmed — `workspace-analyzer.service.ts:115-132`; `getProjectInfo()` (`:151`) and `analyzeWorkspaceStructure()` (`:177`) take no root                                                                                                        |
| 6   | Frontend has a per-workspace root available at the picker call site       | ✅ Confirmed — `VSCodeService.config().workspaceRoot` (`vscode.service.ts:11,155-163`, updated on switch) and `TabManagerService.activeWorkspacePath` (`tab-manager.service.ts:573`). **Closes open question 2 of research-report.md §8.**         |
| 7   | `FilePickerService` cache is unkeyed and not reset on switch              | ✅ Confirmed — `file-picker.service.ts:60,63`; `workspace-coordinator.service.ts:92-120` has no `FilePickerService` reference. Its own comment at `:138-140` states _"these RPCs carry no workspace parameter"_ — the gap is acknowledged in-code. |

### Risks identified

| #   | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `normalizeWorkspaceRoot()` lives in `@ptah-extension/task-specs`, which depends on `persistence-sqlite` (+ `better-sqlite3`). `workspace-intelligence` and `vscode-lm-tools` do **not** depend on `task-specs`. Importing it to satisfy criterion 13 adds a heavy new dep edge to two core libs.                                                                                                                                                                                                                                                                              | HIGH     | **Task 1.1** — promote the 8-line pure helper to `platform-core` (already a dependency of every affected lib, zero new edges) and have `task-specs` re-export it so its public API is unchanged. One definition, criterion 13 intent preserved.                                                                                                                                                                                           |
| R2  | `setupWatcher()` (`workspace-file-index.service.ts:218-232`) assigns `this.watcher` without disposing the previous one. Making the index re-buildable turns this into a file-watcher handle leak on every workspace switch.                                                                                                                                                                                                                                                                                                                                                   | HIGH     | **Task 1.2** — dispose the prior watcher before re-arming.                                                                                                                                                                                                                                                                                                                                                                                |
| R3  | `start()`'s idempotency guard (`:158`) is a raw string compare on `this.workspaceRoot`. `D:\proj` vs `D:\proj\` vs `d:\proj` each force a full re-index.                                                                                                                                                                                                                                                                                                                                                                                                                      | MEDIUM   | **Task 1.2** — compare normalized keys (uses R1's helper).                                                                                                                                                                                                                                                                                                                                                                                |
| R4  | **The brief's "both registration sites" instruction is partly a no-op here, and the real risk is elsewhere.** `context:`, `autocomplete:` and `workspace:` are _already_ in `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:48-49,44`), and no _new method name_ is introduced — so `RpcMethodName` and `RPC_HANDLER_MANIFEST` need no change either. Meanwhile `ContextRpcHandlers` has **no `context-rpc.schema.ts` at all** (`context-rpc.handlers.ts` imports no Zod), violating the lib's own "Zod schemas mandatory" rule. Adding an unvalidated param is the actual hazard. | HIGH     | **Task 2.2** — explicit verify-and-record step for both registration sites; **Task 2.3** — create the missing Zod schema file and validate the new param there.                                                                                                                                                                                                                                                                           |
| R5  | **Scoping conflict between criteria.** Criterion 4 (`ptah_search_files` returns the calling session's root only) and criterion 3 (two concurrent sessions on different roots) both run through `WorkspaceFileIndexService`, which §7.2 explicitly decides will **not** be a concurrent multi-root index. Under two concurrent sessions on different roots the index can only be built for one.                                                                                                                                                                                | HIGH     | **Task 2.3 / 3.4** — when a requested root does not match the built root, the index must **rebuild for it or return an explicit error — never silently serve the other root's files.** Silent-wrong-answer is the entire defect class of this task; a loud mismatch is an acceptable outcome under §7.2, a quiet one is not. Criterion 3 remains fully satisfied for `ptah_workspace_analyze` via the root-keyed analyzer map (Task 3.2). |

### Edge cases to handle

- [ ] No workspace open at all → existing `"No workspace folder open"` error preserved, no `$HOME` fallback (`ptah-api-builder.service.ts:753-758`) → Task 3.2, criterion 5
- [ ] VS Code has no `workspace:switch` at all (`workspace-rpc.handlers.ts:13-31`) → Batch 1's fix is inert there; VS Code correctness comes only from Batch 2's explicit param → noted in Task 2.3
- [ ] Switch fired while a build for the previous root is still in flight (rapid A→B→A) → Task 1.2 must supersede, not interleave
- [ ] `workspaceRoot` param absent (older webview, or MCP caller with no session) → fall back to current behaviour, never throw → Tasks 2.3, 2.4
- [ ] Watcher-unavailable hosts already degrade to a static snapshot (`:233-239`) — re-index must keep that degradation, not start throwing → Task 1.2

---

## Batch 1: Re-indexable workspace file index (the confirmed Electron repro) ✅ COMPLETE

**Commit**: `9d838ba5a` (round 3; rejected twice before — see the verification record below)

**Goal**: After `workspace:switch` from A to B, the `@` picker serves B's files
with no reload or restart. This is `research-report.md` §4.A — deterministic,
single window, zero concurrency — and is the single most likely explanation for
the user's report.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-invoke with reviewer issues)
**Execution Mode**: sequential — 1.2 and 1.3 both hinge on 1.1's helper location, and 1.3 wires the API 1.2 defines.
**Tasks**: 4 | **Dependencies**: None
**Satisfies acceptance criteria**: 8, 12, 13 (and establishes the helper criterion 13 requires everywhere else)
**File-overlap flag**: Task 1.1 edits `libs/backend/platform-core` and `libs/backend/task-specs`, which no other batch touches. `workspace-file-index.service.ts` is read by Batch 2 but **written only here**.

---

### Task 1.1: Promote `normalizeWorkspaceRoot` to `platform-core` ✅ COMPLETE

**Files**:

- CREATE `D:\projects\ptah-extension\libs\backend\platform-core\src\lib\utils\normalize-workspace-root.ts`
- EDIT `D:\projects\ptah-extension\libs\backend\platform-core\src\index.ts` (export it)
- EDIT `D:\projects\ptah-extension\libs\backend\task-specs\src\lib\normalize-workspace-root.ts` (re-export/delegate — do NOT keep a second implementation)

**Spec reference**: context.md §5 criterion 13; risk R1 above.
**Pattern to follow**: the existing implementation at `task-specs/src/lib/normalize-workspace-root.ts:14` — copy it verbatim, including the three documented steps (`path.resolve` → strip trailing separator → lower-case the Windows drive letter).

**Quality requirements**:

- `task-specs`' public API (`normalizeWorkspaceRoot` exported from its barrel) must remain unchanged — its existing consumers and specs must not need edits.
- Exactly one implementation body in the repo afterwards.
- No new dependency edges: `platform-core` imports only `path`.

**Validation notes**: This exists solely to let `workspace-intelligence` and
`vscode-lm-tools` satisfy criterion 13 without depending on `task-specs` →
`persistence-sqlite` → `better-sqlite3` (R1). If the reviewer finds `platform-core`
is an unacceptable home, the fallback is a local copy in `workspace-intelligence`
— but a second implementation must then be explicitly justified, since criterion
13 exists precisely because divergent normalization already shipped once.

---

### Task 1.2: Make `WorkspaceFileIndexService` re-buildable for a new root ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.ts`
**Dependencies**: Task 1.1
**Spec reference**: context.md §7.3 item 2; research-report.md §4.A, §5 row 1.

**Quality requirements**:

- `start(root)` becomes genuinely re-entrant for a _different_ root: compare `normalizeWorkspaceRoot(root)` against the normalized stored root (fixes R3), and when it differs, tear down and rebuild rather than returning the in-flight promise for the old root.
- `ensureReady()` (`:170-179`) must stop short-circuiting on `started` alone. It must re-resolve `workspaceProvider.getWorkspaceRoot()` and rebuild if the normalized current root differs from the built root. **This line is the bug** — `started` is set once at `:185` and never cleared.
- Add a public way for a caller to request a specific root (e.g. `ensureReadyFor(root: string)`), because Batch 2 needs to ask the index for a root the process-global provider may not currently report. Batch 2's contract with this service is decided here — name it and document it in the file header.
- **Dispose the previous `IFileWatcher` before `setupWatcher()` re-assigns `this.watcher`** (R2). Today `:220` overwrites the field, leaking a handle per switch.
- Supersede, don't interleave: a rebuild started for B while A's build is in flight must not let A's `addFileEntry` calls land in B's maps. `build()` clears `files`/`directories` at `:198-199` — that clear is now racy and must be made safe (generation token or awaited teardown).
- Keep the existing graceful degradations: watcher-unavailable warning path (`:233-239`) and the failure reset at `:189-194` must both still work.
- `catch (error: unknown)`.

**Validation notes**: `start()` at `:157-164` is _already_ partially re-entrant
(`this.startPromise && this.workspaceRoot === workspaceRoot`) — the fix here is
smaller than "rewrite the service". Do not over-build: §7.2 rules a concurrent
multi-root index **out of scope**. Single active root with a correct rebuild is
the target. A root-keyed map is permitted but not required; if you choose the
single-root rebuild, say so in the file header so Batch 2 threads roots against
the right model.

---

### Task 1.3: Re-index from the `workspace:switch` handler ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts` (`registerSwitch`, `:284-304`)
**Reference only (do not edit)**: `D:\projects\ptah-extension\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.ts:378-391` — the one-shot boot call whose shape you are mirroring.
**Dependencies**: Task 1.2

**Quality requirements**:

- After `this.workspaceLifecycle.setActiveFolder(params.path)` (`:304`), trigger a re-index for the new root using the API Task 1.2 defined.
- **Fire-and-forget, off the switch critical path** — follow the exact precedent already documented in this method's own comment block at `:306-314` for deferred session import. `workspace:switch` must keep responding immediately; indexing a large repo must never block the RPC.
- Resolve the index service through DI (optional injection preferred), and degrade silently on hosts that do not register it — the CLI host has no picker surface (`research-report.md` §3, §4.D) and must not break.
- Log the re-index start/finish; a failure must not fail the switch RPC.

**Validation notes**: VS Code does not serve `workspace:switch` at all
(`workspace-rpc.handlers.ts:13-31`) — this task is Electron-only by construction.
That is expected, not a gap; VS Code correctness is Batch 2's job.

---

### Task 1.4: Unit tests for the re-index path (criterion 12 + 13) ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-file-index.service.spec.ts` (create or extend)
**Dependencies**: Tasks 1.1, 1.2

**Quality requirements** — each test must fail against the pre-fix code:

1. **Criterion 12**: index started for root A, then asked for root B, serves B's files with no process restart and without A's entries surviving.
2. **Criterion 13**: `D:\proj`, `D:\proj\` and `d:\proj` collapse to one key — no redundant rebuild.
3. **R2**: the previous watcher is disposed exactly once when the index rebuilds.
4. **R3/edge case**: a rebuild requested mid-build for the prior root does not produce a mixed index.
5. `ensureReady()` after a provider root change picks up the new root (the `started` short-circuit is gone).

**Validation notes**: This test sits in Batch 1, not Batch 5, because the brief
requires the dominant repro to be _verifiable_ first. Batch 5 covers the
remaining criteria.

---

**Batch 1 verification**:

- `npx nx test workspace-intelligence` passes, new specs included
- `npx nx typecheck platform-core task-specs workspace-intelligence rpc-handlers`
- `nx graph` shows **no** new edge from `workspace-intelligence` or `vscode-lm-tools` to `task-specs`
- `code-logic-reviewer` approved
- Manual: Electron, open A, switch to B, open `@` → B's files

---

### Batch 1 verification record — round 1 (team-leader, MODE 2): ❌ REJECTED, NOT COMMITTED

**Passed**: helper promoted with exactly one implementation body; `task-specs`
now a pure re-export and its public API unchanged; no new dep edge from
`workspace-intelligence` or `vscode-lm-tools` to `task-specs` (the only
`workspace-intelligence` hit is a comment). `ROOT MODEL` header block present at
`workspace-file-index.service.ts:24-66` and it does state the single-active-root
contract plus `ensureReadyFor(root)` / `indexedRoot` — Batch 2 can build on it.
R2 (watcher disposed before re-arm) and R3 (normalized-key idempotency) are both
implemented and covered by non-vacuous tests. Task 1.3 is correctly
fire-and-forget behind an `isRegistered` guard. `npx nx run-many -t typecheck -p
platform-core task-specs workspace-intelligence rpc-handlers` green; lint 0
errors on Batch 1 files; `workspace-intelligence` 718/718 and `rpc-handlers`
1741/1741 excluding the two independently-confirmed pre-existing failures below.

**Blocking issue — supersede-not-interleave is incomplete**
(`workspace-file-index.service.ts:315-324`):

`build()` assigns the shared `this.ignoreFiles` field from an `await` and only
checks the generation token on the line AFTER the assignment. A superseded build
for root A therefore resumes and overwrites the ignore rules already installed
by the live build for root B. The maps are protected; this field is not.

Proven with a scratch spec (A's `parseWorkspaceIgnoreFiles` gated open, B built
to completion, then A released): `indexedRoot` stays B while `ignoreFiles`
becomes `A-RULES`. Consequence — for the remaining lifetime of B's index, every
watcher `onCreate`/`onChange` runs `isExcluded()` against workspace A's ignore
rules, so files created in B are wrongly dropped from (or wrongly admitted to)
the `@` picker. That is the same cross-root-contamination defect class this task
exists to kill, just on the incremental-update path instead of the initial
build, and it is the exact "rapid A→B→A" edge case listed above.

**Required fix**: parse into a local, then apply only if still current — e.g.
`const parsed = await ...; if (generation !== this.generation) return;
this.ignoreFiles = parsed;` — with the same guard on the `catch` branch's
`this.ignoreFiles = []`. Add a regression test alongside the existing
"supersedes an in-flight build instead of interleaving it" case that gates the
_ignore parse_ rather than the stream; the current `streamGate` harness does not
reach this path.

**Pre-existing failures — independently verified, NOT this batch's**:

- `workspace-intelligence/src/services/file-system.service.spec.ts` — compile error from committed `f80fa299c` adding `createDirectoryExclusive` to `IFileSystemProvider`; the spec is unmodified in the working tree. Confirmed.
- `platform-core/src/file-settings-manager.bench.spec.ts` — passes 2/2 in isolation; timing flake under parallel load. Confirmed.
- `rpc-handlers/.../chat-session-resume-activate.spec.ts` — fails on `result.success`. The developer's "another agent's uncommitted work" framing is now **stale**: that work landed as `5cff0927a` and both the spec and `chat-session.service.ts` are clean in the working tree, so this fails at HEAD. Still not Batch 1's — zero symbol or import linkage to `workspace-rpc.handlers` or the file index. **Should be routed to its own task.**

### Batch 1 verification record — round 2 (team-leader, MODE 2): ❌ REJECTED, NOT COMMITTED

**Round 1's issue is genuinely fixed.** `build()` now parses into a local and
publishes behind the generation check, with the `catch` fallback covered by the
same guard (`workspace-file-index.service.ts:314-337`). Re-ran the full
checklist, not just the delta: `workspace-intelligence` **719/719** (was 718,
+1 as claimed), `rpc-handlers` **1741 passed**, typecheck green on all four
projects, lint 0 errors on Batch 1 files, no new dep edge to `task-specs`, both
scratch/baseline files confirmed gone from the working tree. The two
pre-existing failures are unchanged and remain independently confirmed.

**Blocking issue — the no-third-field audit was optimistic; there IS a third
path** (`workspace-file-index.service.ts:385-392` vs `407-423`):

The audit states watcher writes are safe because the callbacks are
"generation-gated". They are gated — but the gate sits on the wrong side of an
`await`. The wrapper checks `generation !== this.generation` at `:386` / `:390`
and then calls `onCreate` / `onChange`, which capture `root` at `:408` / `:416`,
`await this.isExcluded(...)` at `:411` / `:421`, and only then call
`addFileEntry(absPath, root)` at `:412` / `:422`. Nothing re-checks the
generation across that await. `isExcluded` awaits `ignoreResolver.isIgnored`
whenever the workspace has any ignore file — i.e. the normal case — so the
window is wide, not a bare microtask.

Same off-by-one-await shape as round 1, on a third piece of shared state
(`files` / `directories` via `addFileEntry`) rather than `ignoreFiles`.

Proven with a scratch spec: index A, fire a create for `late-from-a.ts` and park
its exclusion check, switch to B and let B build to completion, then release.
Result — `indexedRoot` is B, but `getAll()` returns
`["base.ts", "late-from-a.ts"]`, i.e. an **A-rooted file is listed in the `@`
picker while B is the active workspace**. That is the user-reported defect
verbatim, arriving through the watcher path instead of the build path.

This is introduced by this batch, not pre-existing: before rebuilds were
possible there was only ever one root, so a late-resuming watcher callback could
only ever write into its own root's maps.

**Required fix**: pass the captured `generation` into `onCreate` / `onChange`
(the wrapper already has it in scope) and re-check it immediately after the
`await this.isExcluded(...)`, before `addFileEntry`. Add a regression test on
the watcher path — the new `ignoreGate` harness gates the ignore _parse_ during
`build()` and does not reach `isExcluded()`, so it does not cover this.

**Note on the audit method**: the round-2 enumeration was correct about _which_
fields are written and _where_, and correct that `addFileEntry` is reachable only
from the stream loop and the watcher callbacks. What it missed is that
reachability behind a gate is not the same as being guarded _at the write_. The
question to ask of each write is not "is there a generation check upstream?" but
"is there an `await` between the nearest check and this write?".

---

### Batch 1 verification record — round 3 (team-leader, MODE 2): ✅ APPROVED AND COMMITTED — `9d838ba5a`

Round 2's issue is fixed. `generation` is threaded into `onCreate` / `onChange`
and re-checked immediately before `addFileEntry` (`:426`, `:437`), which also
covers the `root` captured pre-await — `workspaceRoot` is only ever written
alongside a generation bump (`:254` in `ensureReadyFor`, `:598` in `dispose()`),
so an unchanged generation guarantees an unchanged root. The comment at
`:383-386` records that the upstream gate is necessary but not sufficient, so it
should survive future simplification.

**Third audit re-walked independently — the "no third instance" claim holds.**
Checked every instance write against "is there an `await` between the nearest
generation check and this write?":

| Write                                                         | Nearest check         | Await between?                                                                 |
| ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `:253-256` `started`/`workspaceRoot`/`rootKey`/`startPromise` | `++generation` `:251` | no — sync                                                                      |
| `:292` `started = true`                                       | `:290`                | no                                                                             |
| `:303` `startPromise = undefined`                             | `:300`                | no                                                                             |
| `:312-313` `files`/`directories` clear                        | `++generation` `:251` | no — `ensureReadyFor`→`doStart`→`build` runs sync to the first await at `:326` |
| `:337` `ignoreFiles`                                          | `:336`                | no (round 1 fix)                                                               |
| `:347` `addFileEntry` (stream loop)                           | `:346`                | no — guard and call are adjacent in the loop body                              |
| `:362` `watcher = undefined`                                  | caller-side           | no — `disposeWatcher` is sync                                                  |
| `:382` `watcher = watcher`                                    | `:290`                | no — `setupWatcher` is sync `: void`                                           |
| `:427` `addFileEntry` (onCreate)                              | `:426`                | no (round 2 fix)                                                               |
| `:438` `addFileEntry` (onChange)                              | `:437`                | no (round 2 fix)                                                               |
| `:442` `files.delete`                                         | `:396`                | no — `onDelete` is sync `: void`                                               |
| `:594-599` `dispose()`                                        | `++generation` `:592` | no — fully sync                                                                |

Reads-across-await also confirmed: `isExcluded` (`:491-514`) writes nothing, and
its two `this.ignoreFiles` reads (`:498`, `:502`) both evaluate before the await
at `:500` as argument evaluation. `addFileEntry` / `addAncestorDirectories` are
sync `: void`, so the write side is atomic once entered. `ensureReady`'s await at
`:275` sits inside the `!root` branch that returns, so `:278` is reached with no
intervening await. No third instance found.

**Non-vacuity of the new test verified independently, not taken on report.**
Removed only the two re-checks (asserted exactly 2 sites matched), re-ran the
spec: exactly 1 of 22 failed, with
`[{fileName: "late-from-a.ts", path: "\\workspace\\late-from-a.ts", ...}]`
leaking into B's index — matching the reported baseline. Service restored and
the suite re-run green afterwards.

**Full checklist re-run (not the delta)**: `workspace-intelligence` **720/720**
(+1 as claimed), `workspace-file-index` 22/22, `rpc-handlers` **1741 passed**
with `workspace-rpc.handlers` 14/14, typecheck green on all four projects, lint
**0 errors** across all four, no new dep edge to `task-specs`, scratch and
baseline files confirmed absent. Unchanged pre-existing failures:
`file-system.service.spec.ts` (compile error from committed `f80fa299c`) and
`chat-session-resume-activate.spec.ts` (fails at HEAD, zero linkage to Batch 1,
still needs its own task).

**Commit hygiene note.** The first commit attempt (`013328dd4`, discarded) swept
in three `TASK_2026_173` files. Cause: `git commit` without a pathspec commits
the whole index, and the concurrent session staged its files between my `git add`
and the commit. Recovered with `reset --soft`, unstaged the three (content intact
in the working tree — nothing of theirs was lost or committed), and re-committed
with an explicit pathspec. **Use `git commit -F msg -- <paths>` for the remaining
batches** — with another session active on this branch, staging is shared mutable
state and a pathspec-less commit is a race.

---

### Decision — third `normalizeWorkspaceRoot` copy in `cron-scheduler`: FOLLOW-UP, not a Batch 1 blocker

`libs/backend/cron-scheduler/src/lib/normalize-workspace-root.ts` remains a third
implementation body. Leaving it in Batch 1 is **accepted**: deduping it adds a
`platform-core` edge to `cron-scheduler`, that lib documents the duplication as
deliberate, and re-litigating it here would widen a batch whose scope is the
Electron repro. Net 3 copies → 2 is real progress.

It is **not** dropped. Criterion 13 exists because divergent normalization has
already shipped once, and two bodies can still diverge. Recorded as a follow-up
for the orchestrator to schedule after Batch 5 — either dedupe against
`platform-core` or add a spec asserting the two implementations agree on the
`D:\proj` / `D:\proj\` / `d:\proj` / `D:/proj` matrix.

---

## Batch 2: Explicit workspace scoping on the picker RPC contracts ✅ COMPLETE

**Commit**: `db9807897` (approved first round)

**Goal**: `context:getAllFiles`, `context:getFileSuggestions`, `autocomplete:agents`
and `autocomplete:commands` accept an explicit workspace-scoping parameter and
answer for that root, independent of the process-global `IWorkspaceProvider`.
This is the only mechanism that can fix VS Code's session/window divergence
(`research-report.md` §4.C), where no switch event exists to hook.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential — the shared contract (2.1) must land before any handler compiles against it.
**Tasks**: 5 | **Dependencies**: Batch 1 (the index must be able to answer for a requested root)
**Satisfies acceptance criteria**: 9, 10, 13 (and unblocks 4 via R5's loud-mismatch rule)
**File-overlap flag**: Task 2.1 edits `libs/shared/.../rpc-misc.types.ts`, which **Batch 4 reads** but does not write. `context.service.ts` / `context-orchestration.service.ts` are written here only.

---

### Task 2.1: Add the scoping param to the shared RPC param types ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-misc.types.ts`
**Spec reference**: context.md §7.3 item 1; research-report.md §2 hop 4.

**Quality requirements**:

- Add an **optional** `workspaceRoot?: string` to `ContextGetAllFilesParams` (`:14-19`), `ContextGetFileSuggestionsParams` (`:21-27`), `AutocompleteAgentsParams` (`:52-58`) and `AutocompleteCommandsParams` (`:60+`).
- Optional, not required — an older webview build and any MCP-side caller must keep working (edge case above).
- Follow the existing `tasks:*` / `cron:*` precedent for how a workspace root is named and documented on the wire; do not invent a third convention.
- TSDoc on each field must state that omitting it means "the process-global active folder", so the fallback is contractual rather than accidental.

---

### Task 2.2: Verify and record both RPC registration sites ✅ COMPLETE

**Files (verify, edit only if the verification fails)**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — the `RpcMethodName` union
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts:40-80` — `ALLOWED_METHOD_PREFIXES`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — `RPC_HANDLER_MANIFEST`

**⚠️ RPC DUAL-REGISTRATION RULE — BOTH SITES OR THE METHOD SILENTLY FAILS AT RUNTIME.**
A namespace present in `rpc.types.ts` but missing from `ALLOWED_METHOD_PREFIXES`
is rejected by the transport with no compile-time signal. This is a known
historical bug source in this repo.

**Quality requirements**:

- Confirm and record in the commit message that `context:` (`rpc-handler.ts:48`), `autocomplete:` (`:49`) and `workspace:` (`:44`) are already present, and that **no new method name** is introduced by this task — so `RpcMethodName` and the manifest's `METHODS` tuples need no change.
- If Batch 2 ends up introducing any _new_ method name (it should not), both sites plus the owning handler's `static readonly METHODS` tuple must be updated in the same change.
- Run `nx test rpc-handlers` — `rpc-allowlist.spec.ts` asserts the manifest partitions `RPC_METHOD_NAMES` exactly and is the automated guard for this rule.

**Validation notes (R4)**: The brief flagged this as a change-both-sites task.
Verified: for a _param-only_ change it is a no-op, and the real gap is Task 2.3's
missing Zod schema. Do the verification anyway and record the result — do not
skip it on my word.

---

### Task 2.3: Thread the root through the `context:*` handlers ✅ COMPLETE

**Files**:

- CREATE `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\context-rpc.schema.ts`
- EDIT `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\context-rpc.handlers.ts` (`:56-118`)
- EDIT `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context\context-orchestration.service.ts` (`:375-377`)
- EDIT `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context\context.service.ts` (`:435-447`)

**Dependencies**: Tasks 1.2, 2.1

**Quality requirements**:

- **`ContextRpcHandlers` currently has no Zod schema file at all** (R4) — it imports none, in violation of the lib's mandatory-schema rule. Create `context-rpc.schema.ts` and validate both methods' params there, including the new `workspaceRoot`.
- Normalize the incoming root with `normalizeWorkspaceRoot()` from Task 1.1 before any comparison or cache lookup (criterion 13).
- Thread the root down: handler → `ContextOrchestrationService.getAllFiles/getFileSuggestions` → `ContextService.getAllFiles` → the index API Task 1.2 defined.
- **R5 — the load-bearing rule for this task**: when a `workspaceRoot` is supplied and does not match the root the index is built for, the service must **rebuild for the requested root, or return an explicit error**. It must **never** return the other root's files. Silent-wrong-answer is the defect this whole task exists to kill.
- Omitted `workspaceRoot` → today's behaviour exactly (process-global active folder). No throw.
- `ContextOrchestrationService` is one DI singleton shared with the MCP surface (`register.ts:136-139`, injected at both `context-rpc.handlers.ts:35` and `ptah-api-builder.service.ts:281,419`) — your signature change lands on both callers. Keep the new argument optional so `coreDeps` consumers still compile, and confirm Batch 3's callers pass it.
- Never expose a raw `error.message` from the handler; the existing wrap-and-rethrow pattern at `:76-80` is the precedent.

---

### Task 2.4: Thread the root through the `autocomplete:*` handlers ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\autocomplete-rpc.handlers.ts` (+ its schema file; create if absent)
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts` (`discoverAgents` `:122`, `initializeWatchers` `:193`)
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts` (`discoverCommands` `:199`, `initializeWatchers` `:272`)

**Dependencies**: Task 2.1

**Quality requirements**:

- `discoverAgents(root?)` / `discoverCommands(root?)` take an optional explicit root; when supplied it wins over `workspaceProvider.getWorkspaceRoot()`.
- These two already read the root fresh per call (research-report.md §5 rows 4-5) so they track the active folder live — **do not add a cache here**. The only defect is the missing explicit override.
- `initializeWatchers` keeps watching the process-global root; it is a background refresh path with no caller to scope it to. Do not thread a root into it — say so in a code comment so a future reader does not "fix" it.
- Zod-validate the new param.

---

### Task 2.5: Handler + service unit tests for criteria 9 and 10 ✅ COMPLETE

**Files**: specs alongside `context-rpc.handlers.ts`, `autocomplete-rpc.handlers.ts`, and `context.service.ts`
**Dependencies**: Tasks 2.3, 2.4

**Quality requirements**:

- Criterion 9: `context:getAllFiles` / `getFileSuggestions` with `workspaceRoot: B` return B's files while the stub provider reports A.
- Criterion 10: `autocomplete:agents` / `autocomplete:commands` with an explicit root resolve that root, not the provider's.
- Omitted param → identical results to the pre-change behaviour (regression guard for the optional-param contract).
- **R5**: requested root ≠ built root produces a rebuild or an explicit error — assert it never returns the other root's paths.
- Zod rejection: a malformed `workspaceRoot` is rejected at the boundary.

---

**Batch 2 verification**:

- `npx nx test rpc-handlers workspace-intelligence shared`
- `rpc-allowlist.spec.ts` green (dual-registration guard)
- `code-logic-reviewer` approved
- Both registration sites verified and the result recorded in the commit message

---

### Batch 2 verification record (team-leader, MODE 2): ✅ APPROVED AND COMMITTED — `db9807897`

Approved first round. All claimed counts reproduced exactly: `shared` 690/690,
`workspace-intelligence` **747** (Batch 1 baseline 720, +27), `rpc-handlers`
**1781** (baseline 1741, +40), `rpc-allowlist` 5/5, typecheck green on 5
projects, lint **0 errors**. Same two pre-existing failures, unchanged.
`grep -rn "BASELINE-NEUTRALIZED" libs/` returns nothing and no backup files
survive.

**R5 guard adjudicated — the reasoning is sound and the implementation matches
it.** The async/sync split is the right shape: `ensureIndexFor` awaits and
therefore cannot be the last word, so the check has to be a separate synchronous
`assertIndexServes` run in the same synchronous block as the read. Verified every
read site rather than the enumerated ones — `grep`ed all four `this.fileIndex.*`
reads: `:503` (guard `:502`), `:536` (guard `:535`), `:589` (guard `:588`), and
`:607` inside the **private, synchronous** `searchDirectories`, reached only from
`:590` inside the `:588` block. `getFileSuggestions`' short-query path awaits
`getAllFiles` but reads nothing afterwards, and `getAllFiles` re-asserts in its
own atomic block. `searchImageFiles` passes no root, so the guard early-returns
and pre-existing behaviour is preserved. Also confirmed `context.service.ts` is
the **only** reader of the index anywhere in the backend, so there is no
unenumerated read path. No await sits between any guard and its read.

**Both plan corrections confirmed against source:**

1. `context-rpc.schema.ts` / `autocomplete-rpc.schema.ts` did already exist as
   `export {}` stubs (committed `2b537f44c`). R4's substance held — no Zod
   anywhere. The rewritten locking specs are **stronger, not loosened**: they
   assert verbatim pass-through, unknown-key stripping, no injected defaults,
   `undefined`/`null` tolerated as empty, and `''` rejected because it would
   `path.resolve` to the process CWD.
2. The `searchAgents`/`searchCommands` unkeyed-cache finding is real and is the
   highest-value correction in the batch. research-report.md §5's "do not add a
   cache here" applies to `discoverAgents`/`discoverCommands`, **not** to the
   search entry points the handlers actually call. Verified the fix directly:
   `cache`/`cacheRootKey` are published as adjacent synchronous writes
   (`agent-discovery:179-181`, `command-discovery:253-254`), the hit path reads
   the field in the same synchronous block as its key check
   (`:211`/`:214`, `:283`/`:285`), and the miss path uses the awaited call's own
   return value (`:228`, `:296`) rather than re-reading the field. Cannot
   degenerate: `cacheRootKey` is only ever a string, so the initial
   `undefined === undefined` case is unreachable while `cache.length > 0`.

**Non-vacuity spot-checked independently rather than accepted on report.**
Neutralized the cache-key check alone (2 sites → 0): 3 tests fail. Neutralized
`assertIndexServes` to a no-op: 5 of 18 `context.service` tests fail. Both files
restored from backup and the full suite re-run at 747 afterwards.

**Judgement call 1 — `searchFiles` / `SearchFilesRequest` extended: ACCEPTED.**
Beyond a literal reading of Task 2.3, but required by the plan's own structure.
Task 3.4 says `buildSearchNamespace` "passes the same root into
`ContextOrchestrationService` using the optional argument Task 2.3 added" and
names that as what makes criterion 4 reachable — and `ptah_search_files` reaches
`searchFiles`, not `getAllFiles`. The file-overlap flag reserves
`context-orchestration.service.ts` to Batch 2. Omitting it would have forced
Batch 3 to write a file the plan assigned to Batch 2. Implemented as one shared
`WorkspaceScopedContextRequest` base rather than a third convention.

**Judgement call 2 — `searchAgents` returning builtins with no workspace open:
ACCEPTED as a fix, not an unrequested change.** `discoverAgents` deliberately
builds and returns builtins in the no-root branch (`:160-162`) but does not cache
them; the old code read only the field and dropped them. Surfacing them is an
unavoidable consequence of the required fix (reading the awaited return instead
of the shared field) — preserving `[]` would mean adding code to discard a value
`discoverAgents` intends to provide. Covered by a named test. The asymmetry with
`searchCommands` (still `[]`, because `discoverCommands` returns
`success: false` with no root) is pre-existing in those two methods and is not
introduced here.

Bug-for-bug parity on failed discovery (empty list, not `success:false`) and
leaving `initializeWatchers` on the process-global root are both correct per
Task 2.4 and are documented in-code.

**Commit hygiene**: used `git commit -F <msgfile> -- <paths>` per the Batch 1
finding. Two mechanical notes for later batches — a **new** file must be
`git add`ed before a pathspec commit will accept it (`did not match any file(s)
known to git`), and commitlint's `scope-enum` has no `rpc` scope; use
`rpc-handlers`.

---

## Batch 3: MCP surface — `coreDeps` wiring and root-keyed workspace analysis ✅ COMPLETE

**Commit**: `674a3624c` (approved first round)

**Goal**: Close context.md §1–§6 — `ptah_workspace_analyze` answers for the
calling session's root, agrees with `ptah_ast_analyze`, and stops serving one
global cached snapshot.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential — 3.4 consumes the signatures 3.2/3.3 introduce.
**Tasks**: 5 | **Dependencies**: Batch 1 (Task 1.1's helper); coordinates with Task 2.3 on `ContextOrchestrationService`'s signature
**Satisfies acceptance criteria**: 1, 2, 3, 4, 5, 13
**File-overlap flag**: ⚠️ `context-orchestration.service.ts` is **written in Batch 2** and **called from `coreDeps` here**. Batch 3 must run after Batch 2 and consume, not re-shape, that signature.

---

### Task 3.1: Reorder `build()` so every dependency bag carries the session-aware provider ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (`:415-462`)
**Spec reference**: context.md §2, §4 item 1.

**Quality requirements**:

- Move the `buildSessionAwareWorkspaceProvider(...)` construction (`:426-429`) **above** `coreDeps` (`:417-420`) and add `workspaceProvider: sessionAwareWorkspaceProvider` to `coreDeps`.
- This is the ordering hazard that caused the entire defect — leave a comment at the construction site stating that the proxy must be built before any dependency bag.
- Do **not** register the proxy globally against `PLATFORM_TOKENS.WORKSPACE_PROVIDER`. Explicitly rejected in context.md §4 and research-report.md §6 — the same singletons serve non-MCP callers with no session id.
- Leave the precedence chain (`resolveSessionWorkspaceRoot`, `:768`) untouched — it is correct and already tested.

---

### Task 3.2: Root-parameterize and root-key `WorkspaceAnalyzerService` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.ts` (`:115-179`)
**Dependencies**: Tasks 1.1, 3.1
**Spec reference**: context.md §2.1, §4 items 2-3.

**Quality requirements**:

- `getCurrentWorkspaceInfo(root?: string)` (`:130`), `analyzeWorkspaceStructure(root?: string)` (`:177`), `getProjectInfo(root?: string)` (`:151`) — all optional, all defaulting to today's behaviour.
- Replace the single `workspaceInfo` field with `Map<string, WorkspaceInfo>` keyed on `normalizeWorkspaceRoot(root)` (criterion 13). This is what makes criterion 3 (two concurrent sessions, distinct roots, no folder-change event between) achievable.
- `onDidChangeWorkspaceFolders` (`:116-120`) must invalidate **per key**, not wipe the map, and must not re-introduce a single-snapshot field.
- **Criterion 5**: preserve the existing `throw new Error('No workspace folder open')` at `:155` and the equivalent at `ptah-api-builder.service.ts:753-758`. No `$HOME` fallback, no empty-result substitution. Add a test for it in Batch 5.
- Bounded map: a long-lived process switching roots repeatedly must not grow the cache without limit — evict on folder-removal, or cap it.
- `catch (error: unknown)`.

---

### Task 3.3: Thread the root into `WorkspaceService` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\workspace\workspace.service.ts` (root read at `:201`)
**Dependencies**: Task 3.2

**Quality requirements**:

- `analyzeWorkspaceStructure` / `getProjectInfo` accept the optional root the analyzer now passes through; when absent, read `this.workspaceProvider.getWorkspaceRoot()` exactly as today.
- This is the hop where the raw provider actually leaks (context.md §2, chain step 3) — the explicit argument must win over the field, unconditionally.

---

### Task 3.4: Pass the resolved root from the core namespace builders ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\core-namespace.builders.ts` (`:41-57`)
**Dependencies**: Tasks 3.1, 3.2, 3.3, 2.3

**Quality requirements**:

- `buildWorkspaceNamespace` passes `deps.workspaceProvider.getWorkspaceRoot()` into `getCurrentWorkspaceInfo`, `analyzeWorkspaceStructure`, `getProjectInfo`, and into `getInfo` / `getProjectType` / `getFrameworks` (`:49-57`).
- `buildSearchNamespace` (`ptah-api-builder.service.ts:468`) passes the same root into `ContextOrchestrationService` using the optional argument Task 2.3 added — this is what makes criterion 4 reachable, subject to R5's loud-mismatch rule.
- Resolve the root **once per call**, not once at build time — the proxy is session-aware and its answer changes per caller.

---

### Task 3.5: Audit and document the remaining raw-provider sites ✅ COMPLETE

**Files (audit; edit only where the audit says the site leaks a real result)**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-indexer.service.ts:329`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-enrichment.service.ts:383`

**Dependencies**: Task 3.4
**Spec reference**: context.md §4 item 4; research-report.md §5 rows 2-3.

**Quality requirements**:

- `workspace-indexer.service.ts:329` (`getDefaultWorkspaceFolder`) — research-report.md §5 found it is a **dead fallback** on the one traced path (`build()` always passes an explicit root at `workspace-file-index.service.ts:211-215`), but other callers were not exhaustively enumerated (research-report.md §8, open question 4). Enumerate them. If every caller passes an explicit folder, delete the fallback or make it throw rather than leaving a silent wrong-root path in place.
- `context-enrichment.service.ts:383` (`toRelativePath`) — audited as **display-string only, low severity**. Do **not** rewrite it in this task. Add a code comment recording the audit verdict and the task id so the next reader does not re-litigate it.
- Record both verdicts in the commit message.

---

**Batch 3 verification**:

- `npx nx test vscode-lm-tools workspace-intelligence`
- `npx nx typecheck vscode-lm-tools workspace-intelligence rpc-handlers`
- `code-logic-reviewer` approved
- Manual: window on A, session on B → `ptah_workspace_analyze` and `ptah_ast_analyze` both report B (criteria 1, 2)

---

### Batch 3 verification record (team-leader, MODE 2): ✅ APPROVED AND COMMITTED — `674a3624c`

Approved first round. Counts reproduced exactly: `vscode-lm-tools` 754,
`workspace-intelligence` 767 (+20), `agent-generation` 557, `rpc-handlers` 1781
unchanged. Lint **0 errors** and **no warnings in any touched file**
(`workspace-intelligence` holds at 11, identical to the Batch 2 baseline;
`vscode-lm-tools` 17, none in the three touched files; the two in
`context-enrichment.service.ts` predate the comment-only change). One small
correction to the report: typecheck ran on **3** projects, not 4 —
`agent-generation` declares only `build` and `test` targets, so it has no
typecheck or lint target. Substance unaffected.

### ⚠️ `research-report.md` §5 was wrong for the SECOND time — Batch 5 must not trust it

§5 called `getDefaultWorkspaceFolder` a **dead fallback**. It is not. That
finding traced only `WorkspaceFileIndexService.build()`; enumerating every caller
of `indexWorkspace` / `indexWorkspaceStream` / `getFileCount` turns up three live
MCP tools that reached it with no explicit folder —
`analysis-namespace.builders.ts:90` (`ptah_context_optimize`), `:215`
(`ptah_relevance_score_file`), `:244` (`ptah_relevance_rank_files`) — each
holding an unused session-aware provider while indexing the IDE's folder. This
task's exact defect class, one namespace over.

This is the second §5 error in this task. The first was Batch 2's: §5's "reads
the root fresh per call, do not add a cache here" was true of
`discoverAgents`/`discoverCommands` but false of the `searchAgents`/
`searchCommands` entry points the handlers actually call, which served an unkeyed
process-global cache. **Both errors share a cause: §5 characterised a function by
one traced path instead of enumerating its callers.** Batch 5 should treat every
remaining §5 claim as unverified and re-enumerate before relying on it.

**I re-ran the deletion-safety enumeration independently**, because a deletion is
only as safe as its enumeration and this same function's enumeration was already
wrong once. Every caller of the three methods, including specs, apps and e2e
(excluding stale `dist/` bundles): `workspace-file-index.service.ts:338`,
`code-quality-assessment.service.ts:275`, `code-symbol-indexer.service.ts:175`,
`electron-ide-capabilities.ts:395` and the three fixed analysis sites — **all**
pass an explicit `workspaceFolder`. `code-namespace.builder.ts:185`,
`boot-thoth-runtime.ts:325` and `wire-runtime.ts:192` call
`CodeSymbolIndexerService.indexWorkspace(root, …)`, a different service with a
positional root. Cross-checked against every `WORKSPACE_INDEXER_SERVICE`
injection site; `workspace-analyzer.service.ts:161` injects it but never calls
it. Deletion is safe. `getFileCount` still returns 0 rather than throwing.

**Fence verified empirically, not just by reading.** The replaced per-key epoch
counter was resettable: compute at epoch 0 → invalidate (→1) → invalidate again
(key deleted → back to 0) → parked computation compares `0 === 0` and publishes
stale. I hand-traced the fence against that interleaving and then **wrote the
double-invalidate scenario as a scratch spec and ran it — it passes**, confirming
identity cannot be reset. Guard and write are adjacent and synchronous at both
publish sites (`workspace-analyzer:427-428`, `workspace.service` `analyzeRoot`),
`invalidateRoot`/`invalidateAnalysis` are fully synchronous, and each `.finally`
clears its in-flight entry only when the handle is still its own — the same
identity check Batch 4 used for `_pendingFetch`.

**Fence coverage is genuinely thin, and here is the precise gap.** The committed
fence test invalidates **once**. The buggy epoch implementation would have passed
that test too (epoch 0 vs 1), so nothing in the suite distinguishes the fence
from the counter it replaced. Not a blocker — the implementation is correct and I
verified it — but a plausible future "simplification" back to a counter would go
uncaught. **Batch 5 action item**: add the double-invalidate regression to
`workspace-analyzer.root-scope.spec.ts` (park a compute for B, fire the folder
change twice, release, assert B is re-analyzed rather than served from cache),
and the equivalent for `WorkspaceService`.

**Scope rulings:**

1. **`analysis-namespace.builders.ts` — ACCEPTED.** Outside 3.5's literal file list, but 3.5 authorises editing where the audit finds a real leak, and this is where it found one. Fixing the audit's finding in the same change is the point of the task; recording a live leak and leaving it would have been the wrong outcome.
2. **`agent-generation/enhanced-prompts.service.ts` — ACCEPTED, and the "no other sync caller" claim is verified structurally rather than by inspection.** The collaborator interface now declares `Promise<…>` (`:123`), so any sync property access on the unawaited result is a type error — and typecheck is green. That is a stronger guarantee than enumeration, because it is exactly the structural-interface blindness that hid the original.
3. **`WorkspaceService` root-keyed analysis cache — ACCEPTED.** Not in the task text, but `analyze()` issues three overlapping requests over roughly two full tree traversals each, so root-keying without caching would triple the cost of the fix. It uses the identical fence discipline, which I checked at its own publish site rather than assuming parity.

**Criterion 6 is NOT closed by this batch** and is not claimed to be — the
structural test is Batch 5 Task 5.1. Two sites still receive the raw provider and
I checked both: `WebSearchService` (`ptah-api-builder:633`) uses it **only** for
`getConfiguration`, never `getWorkspaceRoot`, and the `memory` namespace goes
through `resolveSessionWorkspaceRoot()`. Neither is a root leak — **but a naive
Task 5.1 test asserting "every bag holds the session-aware instance" will flag
`webSearch` as a false positive.** Task 5.1 should assert on root _resolution_,
not provider identity.

**Still outstanding**: the manual Electron check (window on A, session on B →
`ptah_workspace_analyze` and `ptah_ast_analyze` both report B) — no GUI in these
sessions.

**Commit hygiene**: the Batch 4 pre-commit-hook artifact recurred, on four files.
Checked rather than trusted: `npx prettier --check` reports the **committed**
versions already conform, and the staged delta is the _inverse_ of prettier — a
stray blank line added to `workspace-indexer.service.ts` and an 84-character line
in a spec that exceeds the 80-character print width. Committing it would have
left the repo prettier-dirty. Discarded; `git diff HEAD` across all Batch 3 paths
is empty and both suites re-run green afterwards. **This artifact is now
reproducible on every pathspec commit — always `prettier --check` the committed
files before accepting the hook's staged delta.**

---

## Batch 4: Frontend — picker cache invalidation and scoped call sites ✅ COMPLETE

**Commit**: `d99b45e3a` (approved first round)

**Goal**: A `@` picker opened within the 5-minute TTL after a workspace switch
never shows pre-switch files, and every picker call carries the active root.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential — 4.2 calls the API 4.1 adds.
**Tasks**: 4 | **Dependencies**: Batch 2 (the params must exist on the wire)
**Satisfies acceptance criteria**: 11, and the call-site halves of 9 and 10
**File-overlap flag**: none — no backend file is touched. Reads `rpc-misc.types.ts` (written in Batch 2).

---

### Task 4.1: Give `FilePickerService` a workspace-invalidation entry point ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\file-picker.service.ts` (`:60,63`)
**Spec reference**: research-report.md §4.B; context.md §7.3 item 3.

**Quality requirements**:

- Public `switchWorkspace(path: string)` (matching the `WorkspaceAwareService` shape at `workspace-coordinator.service.ts:20-23`) that clears `_workspaceFiles`, resets `_lastUpdate` so the TTL cannot serve stale data, and clears `_remoteResults` / `_fetchError`.
- Cancel or invalidate in-flight work: `_pendingFetch` and the `_remoteSearchTimer` / `_remoteSearchAbortId` guards (`:65-69`) must not let a pre-switch response repopulate the cache after the clear. The existing monotonic-abort-id pattern is the precedent — extend it, do not bypass it.
- Signals + `inject()`; no `BehaviorSubject`. `ChangeDetectionStrategy.OnPush` is unaffected (service, not component).

---

### Task 4.2: Wire `FilePickerService` into `WorkspaceCoordinatorService.switchWorkspace()` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts` (`:92-120`)
**Dependencies**: Task 4.1

**Quality requirements**:

- Call `filePicker.switchWorkspace(newPath)` alongside the existing `tabManager` / `sessionLoader` fan-out at `:94-95`. `FilePickerService` is in the same lib — a direct `inject()` is correct; it does **not** need the lazy `Injector` treatment the editor trio gets (that indirection exists only to avoid a static import of the lazy-loaded editor chunk, `:69-90`).
- Synchronous, before the awaited editor-service resolution — the picker must be clean the instant the switch is dispatched, not after a dynamic import settles.
- Respect the `switchGeneration` stale-response guard (`:63`, `:93`) — a superseded switch must not clobber a newer one's picker state.
- Update the class TSDoc (`:26-35`), which enumerates the coordinated services.

---

### Task 4.3: Pass the active workspace root at the picker call sites ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\file-picker.service.ts` (`:174-177`, `:398-401`)
**Dependencies**: Tasks 2.1, 4.1

**Quality requirements**:

- Include `workspaceRoot` in the `context:getAllFiles` (`:174-177`) and `context:getFileSuggestions` (`:398-401`) param objects.
- **Source of the value** (research-report.md §8 open question 2 — resolved during validation): `VSCodeService.config().workspaceRoot` (`libs/frontend/core/.../vscode.service.ts:11`), which is already updated on switch at `:155-163`. `TabManagerService.activeWorkspacePath` (`tab-manager.service.ts:573`) is the per-tab alternative — prefer it if the picker is genuinely per-tab-scoped, and state which you chose and why in the commit message.
- Empty / unset root → omit the field entirely rather than sending `''`. The backend contract treats absent as "process-global active folder"; `''` is not that.

---

### Task 4.4: Pass the root at the `/` picker call sites ✅ COMPLETE

**Files**: ~~the `autocomplete:agents` / `autocomplete:commands` callers under `libs\frontend\chat\src\lib\`~~ — **CORRECTED**: the callers are `AgentDiscoveryFacade` and `CommandDiscoveryFacade` in `libs\frontend\core\src\lib\services\`. `slash-trigger.directive` only opens the dropdown; it issues no RPC. This is why the shared helper lives in `core` — `chat` depends on `core`, not the reverse.
**Dependencies**: Tasks 2.1, 4.3

**Quality requirements**: same root source and same omit-when-empty rule as Task 4.3. Keep the two picker paths consistent — one helper, not two conventions.

---

**Batch 4 verification**:

- `npx nx test chat` (and `chat-state` if touched)
- `npx nx lint chat`
- `code-logic-reviewer` approved
- Manual: Electron, switch A→B, open `@` within 5 minutes → B's files only (criterion 11)

---

### Batch 4 verification record (team-leader, MODE 2): ✅ APPROVED AND COMMITTED — `d99b45e3a`

Approved first round. Counts reproduced exactly: `chat` 737 passed / 2 skipped of
739, `core` 500/500, `chat-state` 241/241 (untouched control), typecheck green on
6 projects, lint **0 errors**. No `BASELINE-NEUTRALIZED` markers and no
`.bak`/`.orig` in the tree.

**Scope expansion accepted.** The batch is larger than Task 4.4 describes: it also
fixes `AgentDiscoveryFacade` / `CommandDiscoveryFacade` cache invalidation, which
`tasks.md` never called for. Correct call — the user's report was "file pickers"
plural, and criterion 11 is not met if the `/` picker still serves the previous
workspace. Shipping the `@` half alone would have been visibly partial.

**The core finding verified in source, and it is worse than the `@` half.** Both
facades check `_isCached`/`_isLoading` above the `await` and write
`_agents`/`_isCached` below it with no re-check — so a bare `clearCache()` is
undone by the next response to land. `_lastUpdate` is a 5-minute TTL that
self-heals; **`_isCached` is a plain boolean with no TTL**, so a stale response
setting it after the clear pins the previous workspace's agents for the rest of
the process lifetime and nothing ever refetches. Confirmed the fix: generation
captured before the RPC (`agent:58`), re-checked immediately before the writes
(`:72` → `:77-90`), and on the `catch` (`:101`) and `finally` (`:109`) alike.
Command facade mirrors it. `clearCache()` bumps first, then clears.

**The second-order `_isLoading` wedge is real and is closed.** With the `finally`
guarded, a fetch in flight at clear time no longer clears the flag, so a stuck
`true` would make every later `fetchAgents()` early-return forever — a dead
picker traded for a stale one. `clearCache()` resets it (`agent:156`,
`command:181`). Traced the interleaving by hand: A in flight → `clearCache()`
bumps and clears the flag → B starts and captures the new generation → A settles
and correctly declines to touch either the writes or B's loading flag → B settles
and clears it. Correct.

**File-picker half confirmed.** `_doFetchWorkspaceFiles` had no guard at all and
republished the old list **with a fresh `_lastUpdate`**, arming the TTL against
the wrong root. Guards now sit at `:231` (before the `:265-266` writes), `:288`
(catch) and `:294` (finally), each in the same synchronous block as its write.
`fetchWorkspaceFiles`' `finally` nulls `_pendingFetch` only when the handle is
still its own (`:210`), so it cannot drop a newer fetch's.

**Non-vacuity verified independently, not accepted on report.** Neutralized only
the facades' six generation guards with `clearCache()` fully intact → **6
failures** (3 per facade), which is the specific proof that a one-line clear was
insufficient. Separately deleted only the `_isLoading.set(false)` line from
`clearCache()`, guards intact → **4 failures** (2 per facade), proving the wedge
is covered rather than merely asserted. Both restored and re-run green.

**Design decisions adjudicated:**

1. **Invalidation inside `clearCache()`, not a `switchWorkspace()` alias — ACCEPTED.** Checked all four existing callers (`chat-input:1312`, `chat-empty-state:403`, `marketplace-hub:93`, `plugins-surface:76`). All are post-mutation "drop and refetch" refreshes, so the added generation bump strictly improves them — a pre-install response re-pinning `_isCached` is the same bug. None is broken by it.
2. **`VSCodeService.config().workspaceRoot` over `TabManagerService.activeWorkspacePath` — ACCEPTED, and the decisive claim is verified.** `ElectronLayoutService.coordinateWorkspaceSwitch` calls `coordinator.switchWorkspace()` at `:459` and `vscodeService.updateWorkspaceRoot()` at `:469` — so reading at switch time would capture the **old** root. Reading at RPC-call time is required, not incidental. The VS Code argument also holds: `_activeWorkspacePath` is only written by `switchWorkspace`, which VS Code never fires.
3. **Task 4.4's stated file location was wrong — CONFIRMED and corrected above.** The `autocomplete:*` callers are the two facades in `libs/frontend/core`; `slash-trigger.directive` issues no RPC.
4. **`_includedFiles` not cleared — ACCEPTED.** These are user-attached files on a message still being composed, they are visible in the composer (`fileCount`, `totalSize`), and they have their own explicit clear. Silently discarding composed attachments is worse than leaving removable ones. Not a silent-wrong-answer, so out of criterion 11's scope.

All four RPC call sites go through the single `pickerWorkspaceScope` helper
(`file-picker:229,522`, `agent:66`, `command:74`), which returns `{}` for
`null`/`undefined`/blank/whitespace so the key is genuinely absent rather than
present-and-`undefined` — `''` can never reach the Batch 2 Zod boundary that
rejects it.

**Still outstanding**: the manual Electron check (switch A→B, open `@` and `/`
within 5 minutes) — no GUI in these sessions. Criterion 11 is covered by unit
tests only until someone runs it.

**Commit hygiene note.** The pre-commit hook left a staged reformat of
`workspace-coordinator.service.spec.ts` that the pathspec commit did not capture.
Investigated rather than committing it blindly: `npx prettier --write` on the
repo's own config reports the committed version **unchanged**, so that delta came
from some other formatter and committing it would have introduced formatting
prettier disagrees with. Discarded. Verified afterwards that `git diff HEAD` over
all Batch 4 paths is empty — the remaining ` M` flags in `git status` are CRLF
churn, not content. `libs/frontend/editor/**` (concurrent session) and
`libs/backend/**` (Batch 3, in flight) were left untouched.

---

## Batch 5: Acceptance-criteria test hardening ✅ COMPLETE

**Commit**: `b7050df14` (approved first round)

**Goal**: Close every acceptance criterion not already covered by Tasks 1.4 and
2.5, including the two explicitly-mandated unit tests (6, 7) and the structural
regression guard.

**Recommended Executor**: `senior-tester`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Tasks**: 4 | **Dependencies**: Batches 1–4 all complete
**Satisfies acceptance criteria**: 1, 2, 3, 4, 5, 6, 7, 11 (12 and 13 already covered by Task 1.4; 9 and 10 by Task 2.5)
**File-overlap flag**: spec files only — no production file written in this batch.

---

### Task 5.1: Structural guard — every namespace bag carries the session-aware provider (criterion 6) ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts` (create or extend)

**Quality requirements**:

- **Structural, not per-tool.** Assert that _every_ dependency bag constructed in `PtahAPIBuilder.build()` carries the session-aware provider — so adding a 22nd namespace without one fails the test. A test that names today's bags one by one does not satisfy this criterion and will be rejected.
- Suggested shape: spy/wrap the provider so the session-aware instance is identifiable, invoke `build()`, and assert over the collected bags rather than a hardcoded list. If the current structure makes that impossible, say so and propose the minimal production-side seam — do not silently downgrade to an enumeration.
- Must fail against the pre-Batch-3 code (where `coreDeps` had no provider).

---

### Task 5.2: `WorkspaceAnalyzerService` root-keyed cache (criterion 7) ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.spec.ts`

**Quality requirements**:

- Two distinct roots return distinct `WorkspaceInfo` **with no folder-change event between the calls** — this is the exact wording of criterion 7 and the exact thing the pre-fix single field could not do.
- Per-key invalidation on `onDidChangeWorkspaceFolders`: changing A does not evict B.
- Normalization (criterion 13): `D:\proj` and `d:\proj\` hit one entry.
- Cache eviction/bound behaves as Task 3.2 implemented it.

---

### Task 5.3: Session/root divergence across the MCP surface (criteria 1–5) ✅ COMPLETE

**Files**: specs under `libs/backend/vscode-lm-tools/src/lib/code-execution/`

**Quality requirements**:

- Criterion 1: IDE on A, session on B → `ptah_workspace_analyze` returns B.
- Criterion 2: `ptah_workspace_analyze` and `ptah_ast_analyze` agree on the root for the same session.
- Criterion 3: two concurrent sessions on different roots each get their own result — the second call does not receive the first's cached snapshot.
- Criterion 4: `ptah_search_files` returns paths under the calling session's root only. **Encode R5 here**: if the index cannot serve the requested root, assert an explicit error or a rebuild — assert that it never returns the other root's paths. Add a code comment citing context.md §7.2 so the concurrency limitation is documented at the assertion, not just in the spec doc.
- Criterion 5: no session and no workspace → the existing `"No workspace folder open"` error, **not** a `$HOME` fallback and not an empty success.

---

### Task 5.4: Frontend switch-invalidation spec (criterion 11) ✅ COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\file-picker.service.spec.ts`

**Quality requirements**:

- `switchWorkspace()` invokes the picker invalidation, ordered with the existing `tabManager` / `sessionLoader` calls.
- A picker opened immediately after a switch, inside the 5-minute TTL, refetches instead of serving the cached list.
- An in-flight pre-switch response landing _after_ the switch does not repopulate the cache (Task 4.1's abort guard).
- Call sites include `workspaceRoot` in the RPC params; empty root omits the field rather than sending `''`.

---

**Batch 5 verification**:

- `npm run test` green across the affected projects
- Every acceptance criterion 1–13 maps to at least one named test; list the mapping in the commit message
- `code-logic-reviewer` approved

---

## Acceptance-criteria coverage map

| Criterion | Covered by                                                    |
| --------- | ------------------------------------------------------------- |
| 1         | Tasks 3.1–3.4, test 5.3                                       |
| 2         | Tasks 3.1, 3.4, test 5.3                                      |
| 3         | Task 3.2 (root-keyed map), tests 5.2, 5.3                     |
| 4         | Tasks 2.3, 3.4 (+ R5 loud-mismatch rule), test 5.3            |
| 5         | Task 3.2, test 5.3                                            |
| 6         | Task 3.1, **structural** test 5.1                             |
| 7         | Task 3.2, test 5.2                                            |
| 8         | Tasks 1.2, 1.3, manual verification in Batch 1                |
| 9         | Tasks 2.1, 2.3, 4.3; tests 2.5, 5.4                           |
| 10        | Tasks 2.1, 2.4, 4.4; test 2.5                                 |
| 11        | Tasks 4.1, 4.2; test 5.4                                      |
| 12        | Tasks 1.2, test 1.4                                           |
| 13        | Task 1.1 (helper), applied in 1.2 / 2.3 / 3.2; tests 1.4, 5.2 |

---

## Out of scope — do not implement

- Concurrent multi-root file indexing (context.md §7.2 — user-decided).
- Global registration of the session-aware proxy against `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (context.md §4 "Alternative considered"; research-report.md §6 rejected).
- Reusing `buildSessionAwareWorkspaceProvider` for the webview RPC handlers — the `RpcMessage` envelope (`rpc-handler.ts:166`) has no session id to resolve against (research-report.md §6 rejected).
- "Re-index on switch" as the _complete_ fix — it is Task 1.3 only, and does nothing for VS Code (no switch event) or the frontend cache.
- Rewriting `context-enrichment.service.ts:383` — audited as display-string only (Task 3.5 records the verdict).

---

---

# CLOSING SUMMARY — TASK_2026_200 (team-leader, MODE 3)

**Task status set to `in_review`, deliberately NOT `done`.** Every acceptance
criterion is closed in code and unit tests, but criteria 8 and 11 — the two that
encode the symptom the user actually reported — have never been observed working
in a running application. No session in this task had a GUI. Closing `done`
without anyone having watched the `@` picker serve workspace B after a switch
would be asserting the one thing nobody checked.

## The five commits

| Commit      | Files | Surface                                                                          |
| ----------- | ----- | -------------------------------------------------------------------------------- |
| `9d838ba5a` | 7     | Batch 1 — re-indexable `WorkspaceFileIndexService` + `workspace:switch` re-index |
| `db9807897` | 16    | Batch 2 — explicit `workspaceRoot` on the four picker RPCs                       |
| `674a3624c` | 12    | Batch 3 — MCP surface: `coreDeps` wiring, root-keyed analysis                    |
| `d99b45e3a` | 11    | Batch 4 — frontend picker cache invalidation and scoped call sites               |
| `b7050df14` | 3     | Batch 5 — acceptance-criteria test hardening (spec-only)                         |

Batch 1 was rejected twice before passing; Batches 2–5 passed first round. All on
`ak/license-server-validation-pipe`, none pushed.

## Final suite counts

`vscode-lm-tools` 763 · `workspace-intelligence` 768 · `rpc-handlers` 1781 ·
`agent-generation` 557 · `chat` 737 · `core` 500 · `shared` 690 · `chat-state` 241. Typecheck and lint green (0 errors) across every touched project.

## What was actually wrong, per surface

- **`@` picker (Electron)** — `ensureReady()` short-circuited on a `started` flag set once and never cleared, and `workspace:switch` never touched the index. The picker served the boot workspace for the whole process lifetime.
- **Picker RPCs (VS Code)** — no workspace parameter existed on the wire at all, so a window whose chat tab was bound elsewhere had no mechanism to disambiguate. VS Code has no `workspace:switch` event, so Batch 1's fix could not reach it.
- **MCP tools** — `coreDeps` was built three lines before the session-aware proxy, so `workspace` and `search` got the raw provider; and `WorkspaceAnalyzerService` held one unkeyed snapshot.
- **`/` picker (frontend)** — both discovery facades cached per process with no root key and no TTL.

## Corrections to the original analysis — all four found during review, not planning

1. **`research-report.md` §5 was wrong twice.** It called `getDefaultWorkspaceFolder` a _dead fallback_; it was live in three MCP tools (`ptah_context_optimize`, `ptah_relevance_score_file`, `ptah_relevance_rank_files`), each holding an unused session-aware provider. And its "reads the root fresh per call, do not add a cache here" was true of `discoverAgents`/`discoverCommands` but false of the `searchAgents`/`searchCommands` entry points the handlers actually call. **Both errors share one cause: characterising a function from a single traced path instead of enumerating its callers.**
2. **`searchAgents`/`searchCommands` served an unkeyed process-global cache**, so an explicit root would have been accepted and then silently ignored after the first call — criterion 10 was unreachable as originally planned.
3. **The discovery facades' `_isCached` has no TTL.** `FilePickerService._lastUpdate` self-heals after five minutes; `_isCached` does not, so a stale response landing after a clear pinned the previous workspace's agents for the rest of the process lifetime.
4. **Task 4.4's stated file location was wrong** — the `autocomplete:*` callers are the two facades in `libs/frontend/core`, not under `libs/frontend/chat`.

## The recurring defect shape

The same bug appeared **five** times across four surfaces: a guard placed on the
wrong side of an `await`. `ignoreFiles` in `build()`; `addFileEntry` in the
watcher handlers; both discovery facades; the epoch counter's resettable token.
Batch 1 was rejected twice for exactly this. The rule that finally held —
recorded here because it is the reusable lesson — is **not** "is there a check
upstream?" but **"is there an `await` between the nearest check and this
write?"** Reachability behind a gate is not the same as being guarded at the
write.

## Criterion → test mapping (independently verified in MODE 3)

All thirteen map to tests that assert what the criterion states. Three carry
nuances that a reader should not have to rediscover:

- **Criterion 4** — the safety property (never the other root's files) holds end to end, but at the MCP tool boundary `findFiles`' pre-existing catch-all degrades `WorkspaceRootMismatchError` to `[]`. The agent cannot distinguish "no matches" from "wrong root". Loud in the service layer, quiet at the tool.
- **Criterion 5** — the contractual `throw new Error('No workspace folder open')` is preserved (`workspace-analyzer.service.ts:239`) and there is no `$HOME` fallback, which is what the criterion set out to protect. But `ptah.workspace.analyze()` swallows it via a `.catch(() => undefined)` that predates this task (`2b537f44c`), so the tool returns an empty result rather than the error.
- **Criterion 6** — genuinely structural, asserting on root _resolution_ rather than provider identity, with the root-capable site count pinned at 16 so a bag that loses its capability fails rather than passing quietly. **Conditional**: builder names are discovered by regex over the barrel's source text, matching only `export { … } from`. All 16 blocks use that form today, but `export *`, a default export or a bare top-level `export function` would be missed _silently_. `jest.requireActual` is genuinely blocked — `wasm-bundle-dir.ts`'s `import.meta.url` cannot be parsed by this lib's CommonJS ts-jest transform, and the file says so itself.

## Outstanding — none of these are done

1. **MANUAL ELECTRON CHECK — the only real gap.** Open workspace A, switch to B, then open the `@` picker and the `/` picker within five minutes. Both must show B. This is criteria 8 and 11 and it is the user's original report. **Not performed.** Until it is, the fix is verified only at the unit level.
2. **`chat-session-resume-activate.spec.ts` has been failing since Batch 1** and needs its own task. Confirmed unrelated: neither it nor `chat-session.service.ts` appears in any of the five commits. It fails at HEAD from `5cff0927a`.
3. **`file-system.service.spec.ts` fails to compile** from committed `f80fa299c` (`createDirectoryExclusive` added to `IFileSystemProvider`, mock not updated). Also unrelated — the file appears in none of the five commits — but note the whole suite does not run, so it covers nothing right now.
4. **Third `normalizeWorkspaceRoot` copy in `cron-scheduler`.** Net 3 → 2. Either dedupe against `platform-core` or add a spec asserting the two implementations agree on the `D:\proj` / `D:\proj\` / `d:\proj` / `D:/proj` matrix.
5. **`EXTENSION_LANGUAGE_MAP` on `workspace-intelligence`'s eager barrel.** Moving it to a `/constants` subpath would stop `ast-namespace.builder.ts` dragging in the tree-sitter/WASM chain to read a lookup table, and would remove criterion 6's regex concession entirely.
6. **Harden criterion 6's discovery** — assert the barrel contains no `export *`, default export or bare `export function`, converting a silent miss into a loud failure. Three lines.

## Note for whoever picks this up

`research-report.md` §5 was wrong twice in ways that changed the work. Treat its
remaining claims as unverified and re-enumerate callers before relying on any of
them.

---

## Manual verification — the outstanding gap, now closed (2026-08-11)

The one item MODE 3 refused to mark `done` on: criteria 8 and 11 encode the
symptom the user actually reported, and no agent session in this task had a GUI,
so neither had ever been observed in a running application.

**Verified by the user directly in Electron.** Reported working. That closes the
last gap, and the carrier moves `in_review` → `done`.

Everything else in the MODE 3 record stands unchanged, including the three
weaknesses stated there — they are known and accepted, not resolved:

- **Criterion 5** is the softest. The contractual throw and the absence of a
  `$HOME` fallback are both intact, but `ptah.workspace.analyze()` swallows the
  error via a `.catch(() => undefined)` predating this task, so the tool returns
  an empty result rather than the error the criterion's wording implies.
- **Criterion 4** holds on safety — never the other root's files — but degrades
  from loud to quiet at the MCP boundary: the agent cannot distinguish "no
  matches" from "wrong root".
- **Criterion 6** is conditional on the namespace barrel's export convention. A
  `export *`, a default export, or a bare `export function` would be missed
  silently by the source-text discovery.

### Follow-ups, still open

1. `chat-session-resume-activate.spec.ts` — fails at HEAD, unrelated to this
   task, has been riding along since Batch 1. Needs its own task.
2. `file-system.service.spec.ts` — fails to **compile** (its `mockFsProvider`
   lacks `createDirectoryExclusive`, added in `f80fa299c`), so that suite
   currently covers nothing at all.
3. Third `normalizeWorkspaceRoot` copy in `cron-scheduler` — dedupe, or add a
   cross-implementation agreement spec.
4. Move `EXTENSION_LANGUAGE_MAP` off `workspace-intelligence`'s eager barrel so
   `ast-namespace.builder.ts` does not drag in tree-sitter/WASM to read a lookup
   table — this is what forced Task 5.1's source-text workaround.
5. Criterion-6 discovery hardening (the three export forms above).

### Related

`TASK_2026_224` — filed and closed from this task's own tooling pain: unstaged
edits reaching commits. Cause was `git commit -- <paths>` committing working-tree
content and bypassing the index, not the formatter and not lint-staged.
