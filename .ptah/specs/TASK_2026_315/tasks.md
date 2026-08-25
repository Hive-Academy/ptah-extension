# Development Tasks - TASK_2026_315

**Total Tasks**: 13 findings across 7 batches | **Status**: 2/7 complete, 1 partial

| Batch           | State                                           | Commit      |
| --------------- | ----------------------------------------------- | ----------- |
| 1 (A1)          | COMPLETE — reviewed, approved, committed        | `abf030c47` |
| 2 (A3) task 2.1 | COMPLETE — reviewed, approved, committed        | `3cfba7b`   |
| 2 (A4) task 2.3 | COMPLETE — 2 review rounds, approved, committed | `c08f79a21` |
| 3 (A2)          | COMPLETE — 3 review rounds, approved, committed | `d73902f43` |
| 4 (B1+B2+C3)    | IN PROGRESS — **C6 removed, see below**         | —           |
| 5-7             | PENDING                                         | —           |
| C6              | SPUN OUT of Batch 4 — own task                  | —           |

**All four no-workspace findings (A1-A4) are landed.** The rest of the task is
group B (boot ordering) and group C (misreported outcomes and noise).

**User decisions taken mid-task** (do not re-litigate):

1. Scope: fix ALL thirteen findings, not just the four no-workspace ones.
2. No CLI agents — sub-agent developers only.
3. Task 2.3 adds an explicit `scope: 'all' | 'workspace'` parameter to
   `memory:stats` and `memory:searchSymbols`, rather than the cheaper
   frontend-only fix, so one field stops carrying three-to-four meanings.
4. The `purgeJunk` authorization fix ships with Task 2.3 rather than split out.
   **Task Type**: BUGFIX | **Research**: complete (`./context.md` IS the research output — do not redo it)
   **Executor policy**: sub-agent developers only. **No CLI agents.** (User decision.)

---

## How this plan was batched

Two constraints drove the shape, in this order:

1. **File-disjointness.** Two batches that edit the same file are never open at
   the same time. The dominant conflict is
   `apps\ptah-electron\src\activation\wire-runtime.ts`, which B1 (`:372-393`),
   C3 (`:422-449`) and C6 (`:197-214`) all touch, and
   `apps\ptah-electron\src\activation\post-window.ts`, which B2 (`:108`) and C3
   (`:113-117`) both touch. Those four findings are therefore ONE batch
   (Batch 4), not four. Everything else is genuinely single-owner.
2. **Severity.** A1 lands first (leaked listening socket + burned OAuth
   refresh). A3/A4 next. Group C noise last.

A2 is the only frontend work in the whole task and shares no file with any
backend batch. It is the one parallel-eligible batch — see "Parallelism" below.

### Parallelism

| Batches                | May run concurrently?                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Batch 3 (A2, frontend) | **YES** — concurrent with Batch 1 and/or Batch 2. Disjoint lib, disjoint files, different executor |
| All other pairs        | **NO** — run in listed order                                                                       |

Batch 4 and Batch 5 are the near-miss: Batch 4's B1 may touch
`skill-trigger.service.ts` and Batch 5 touches `skill-drain.service.ts`.
Different files in the same lib, but B1's chosen fix could reach into the drain
path. Serialize them; do not overlap.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS. No blockers. Every finding in
`context.md` was re-confirmed against source before batching; two findings came
back **cheaper** than the spec implies and one came back **different in kind**.

### Assumptions verified against source

| Assumption from context.md                                   | Verdict                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A1: `handleWorkspaceChanged` guards only on `initialized`    | CONFIRMED — `sdk-agent-adapter.ts:243-253`; the sibling at `wire-runtime.ts:351` does have the `if (active)` |
| A1: proxy start is sandwiched before `disposeForScope`       | CONFIRMED — `workspace-rpc.handlers.ts:268` then `:273`                                                      |
| A3: all cited line numbers (`:50`, `:129-143`, `:200-278`)   | CONFIRMED, exact                                                                                             |
| A4: `codeSymbols.count` shares the tri-state shape           | CONFIRMED — `code-symbol.store.ts:179`, same `workspaceRoot?: string \| null` signature                      |
| A2: `finally` sets `_loaded = true` on the error path        | CONFIRMED — `tasks-store.service.ts:2160-2165`                                                               |
| A2: frontend already knows whether a folder is open          | CONFIRMED — `AppStateManager.workspaceInfo` (`app-state.service.ts:309`). **Do not add a new signal**        |
| C2: cron cannot distinguish "did work" from "did nothing"    | CONFIRMED at the runner, but see the scope correction below                                                  |
| C1: Ptah hands a raw provider id to `generate_session_title` | **PARTLY WRONG — see scope correction**                                                                      |

### Scope corrections found during validation

1. **C2 needs no new enum member.** `JobRunStatus` already includes `'skipped'`
   (`cron-scheduler/src/lib/types.ts:24-26`) and `RunStore.markSkipped` is
   already implemented (`run.store.ts:135-147`), already used for two other
   cases (`job-runner.ts:150` concurrency, `:181` aborted). The real gap is
   narrower: `JobHandlerResult` has no "did nothing" channel, so
   `job-runner.ts:170` calls `markSucceeded` unconditionally. This is a handler-
   result plumbing change, not a schema migration. It does still cross five
   surfaces (see Batch 5 blast radius).
2. **C1 has no Ptah-side title generator to fix.** `generate_session_title` is
   an internal Claude Code CLI/SDK query; there is no producer anywhere in this
   repo. Ptah's only lever is the model the SDK sees — the
   `ANTHROPIC_DEFAULT_HAIKU_MODEL` / small-fast tier env injected by
   `workspace-provider-profile-resolver.ts:396-399`. Budget C1 as an
   env/tier-injection investigation with a confirm-the-symptom gate, not as a
   patch to a title generator.
3. **C4's staging verification already exists and looks correct.**
   `skills-sh-source-root.service.ts:133-140` refuses a stage with zero readable
   slugs. The half-tree on this machine may predate it or arrive via a
   non-staged path. Investigate before assuming a staging bug.
4. **B2 already has a queue for one message class.** `ipc-bridge.ts:115-120`
   routes batchable stream events through `enqueueStreamEvent`; only non-stream
   messages fall through to the drop at `:123`. The "add a queue" option is
   therefore cheaper than it looks — which does not make it the right answer.

### Risks

| Risk                                                                                     | Severity | Mitigation                                                                              |
| ---------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `wire-runtime.ts` edited by three findings                                               | HIGH     | Batch 4 owns all three. No other batch may open that file                               |
| A1's "obvious" fix (`if (!active) return`) may be the wrong answer                       | HIGH     | Task 1.1 is a **decision task** — see its Decision Required block                       |
| A3 writes into a user-owned `.mcp.json` with blocking `writeFileSync`                    | MED      | Task 2.1 must preserve read-merge-write; a hand-authored file must survive              |
| A4's tri-state (`undefined` = no filter, `null` = global) is deliberate elsewhere        | MED      | Task 2.2 must preserve it; follow the `purgeBySubjectPattern` refusal precedent         |
| C2 touches cron-scheduler + skill-synthesis + RPC + 3 UIs                                | MED      | Batch 5 is single-owner and sequential; enumerate every consumer before changing a type |
| B1's fix could reach into `skill-drain.service.ts`, which Batch 5 owns                   | MED      | Serialize Batch 4 → Batch 5. If Batch 4 does touch the drain, say so in its report      |
| Out-of-scope creep into `resolveRoot`, global namespaces, or harness-sync's refusal rule | MED      | Restated as a hard constraint in every batch; Batch 7 re-checks it                      |

### Edge cases that must be handled

- [ ] Last folder removed → **zero** folders open (not "switched to another") → Task 1.1
- [ ] Folder removed, then a different folder added → `.mcp.json` must register in the new one → Task 2.1
- [ ] `.mcp.json` that the user hand-authored with their own servers → Task 2.1
- [ ] `memory:stats` with `workspaceRoot: null` (global memories) must stay distinct from `undefined` → Task 2.2
- [ ] `tasks:board` rejected with `WORKSPACE_NOT_OPEN` → third UI state, not the error banner, not the create-CTA empty state → Task 3.1
- [ ] Window focus / `visibilitychange` while no folder is open → no refetch at all → Task 3.2
- [ ] Cron drain that skipped on exhausted budget → `cron:runs` must not say "succeeded" → Task 5.1

---

## Hard constraints for every batch

- **Windows absolute paths** for every Read/Write. Relative paths are broken in
  this workspace.
- `catch (error: unknown)`, narrow with `instanceof Error` before `.message`.
- Hexagonal rule: backend libs depend on `platform-core` ports, never on
  `platform-{vscode,electron,cli}`. **A1 touches `agent-sdk`, which must not
  learn about Electron.**
- Frontend must not import backend libs. `libs/shared` is the one bridge.
- No stubs, no `// TODO`, no placeholder returns. Real code only.
- **Developers do NOT create git commits.** Team-leader commits after the
  orchestrator returns an APPROVED `code-logic-reviewer` verdict.
- Do not bypass commit hooks. If one fails, stop and report.

### Out of scope — do not touch (from `context.md`)

- `resolveRoot` in `tasks-rpc.handlers.ts:1455-1469`. It is correct; that one
  check is deliberately the whole `tasks:*` namespace boundary.
- Gating `skillSynthesis:listCandidates`, `cron:list` or `gateway:*` on a
  workspace. They are global by design and are **not** defects.
- Harness-sync's refusal-on-unowned-path rule. C6 is about log volume only.
- The user's own thirteen blocked `.claude/skills/*` paths. Data condition on
  one machine, not a code defect.

---

## Batch 1: A1 — Last-folder removal starts an OAuth proxy — PENDING

**Findings**: A1 (severity: high)
**Recommended Executor**: `backend-developer`
**Fallback Executor**: `software-architect` (if the decision below turns out to need an architecture call)
**Execution Mode**: sequential
**Rationale**: Two tightly coupled files across two libs plus a lifecycle
ordering question. This is a judgement call about auth lifecycle, not
boilerplate — it needs one owner holding both halves at once.
**Dependencies**: none. Must land first.

**Files touched**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (`:186`, `:243-284`)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts` (`:258-288`)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (exists — extend)

**Read-only context**:

- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\active-provider-resolver.ts` (`:25`)
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts` (`:351` — the sibling subscriber that gets this right)

### Task 1.1: Decide and implement the no-workspace guard in `handleWorkspaceChanged` — PENDING

**File**: `libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`

**The defect**: `handleWorkspaceChanged` (`:243`) guards only on
`this.initialized`. With zero folders open, `resolveActiveAuth()` falls through
to the global default (`openai-codex` in the captured log), which differs from
the workspace-scoped provider that was active (`ollama-cloud`). The differing
pair defeats the early-return at `:257-263`, a full reconfigure runs, an OAuth
token refresh is burned, and a Codex translation proxy binds on 127.0.0.1 that
nothing can ever use.

> **DECISION REQUIRED — do not take the first thing that compiles.**
> `context.md` explicitly flags this: a bare `if (!active) return;` is **not**
> obviously the whole fix. The live alternative is that closing the last folder
> should **tear the previous auth down** rather than freeze it — leaving
> `lastConfiguredAuth` pointing at a provider whose workspace no longer exists
> has its own failure mode when a folder is added back.
> Weigh at minimum: (a) what the next `configureAuthentication` sees after a
> folder is re-added; (b) whether `cliDetector`/`modelService` caches should be
> cleared on the way to zero folders; (c) whether the sibling at
> `wire-runtime.ts:351` and this one should end up with the same rule.
> **Write the reasoning — including the option you rejected and why — into a
> code comment at the guard.** A comment that only restates what the code does
> is a failed deliverable.

**Acceptance criteria**:

- Removing the last workspace folder starts **no** proxy and triggers **no**
  OAuth refresh.
- A genuine workspace _switch_ (folder A → folder B, both with different
  providers) still reconfigures exactly as it does today. Do not regress it.
- No import of Electron or any `platform-{vscode,electron,cli}` adapter into
  `agent-sdk`. Ports only.
- The chosen option and the rejected one are recorded in a code comment.

### Task 1.2: Close the proxy-start-before-dispose window in `workspace:removeFolder` — PENDING

**File**: `libs\backend\rpc-handlers\src\lib\handlers\workspace-rpc.handlers.ts` (`:258-288`)
**Dependencies**: Task 1.1

**The defect**: `:268` fires `workspaceLifecycle.removeFolder(path)`, which
emits the event synchronously, and only at `:273` does
`providerProxyPool.disposeForScope(params.path)` run. The adapter's new proxy
is started between those two lines and is registered under the **global** scope,
not `params.path`, so the dispose cannot reach it. It outlives the workspace for
the rest of the session.

**Acceptance criteria**:

- No proxy created during a `workspace:removeFolder` call survives that call.
- If Task 1.1's guard fully closes this window, say so explicitly in the report
  and justify why no ordering change is needed here — do not silently skip the
  file.
- `disposeForScope` still never throws (it swallows per-entry errors today).

### Task 1.3 (TEST DELIVERABLE): Regression test for the leaked proxy — PENDING

**File**: `libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (extend)

**This is a named deliverable, not a general instruction.** A1 is a
silent-wrong-behaviour defect: nothing failed, nothing threw, a socket just
stayed open. A test is the only thing that stops it recurring.

**Required**: a test that **fails on the current code and passes after the
fix** — drive `onDidChangeWorkspaceFolders` with **zero** remaining folders and
a global default provider that differs from `lastConfiguredAuth`, then assert
`configureAuthentication` was **not** called. Add the companion positive test
(one folder → a different folder, different providers) asserting it **is**
still called, so the guard cannot be widened into a regression later.

**Batch 1 verification**:

- `npx nx test agent-sdk` and `npx nx test rpc-handlers` pass
- `npx nx lint agent-sdk rpc-handlers` clean
- Task 1.3's test demonstrably fails when the guard is reverted
- `code-logic-reviewer` approved

---

## Batch 2: A3 + A4 — Backend scoping bugs (wrong path, missing predicate) — PENDING

**Findings**: A3 (medium), A4 (low-medium)
**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: Two independent single-file-family fixes in different libs, same
theme ("the scope used was not the scope meant"), same executor type, neither
large enough to justify its own batch. File-disjoint from each other and from
Batch 1.
**Dependencies**: Batch 1 complete

**Files touched**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.ts` (`:50`, `:129-143`, `:200-278`)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-mcp-server.service.spec.ts` (exists — extend, do not create a new file)
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.ts` (`:614-642`)
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\code-symbol.store.ts` (`:179`)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts` (`:265-282`)
- `D:\projects\ptah-extension\libs\backend\memory-curator\src\lib\memory.store.spec.ts`, `code-symbol.store.spec.ts`, and `libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts` (all exist — extend)

### Task 2.1: Make `.mcp.json` register/unregister path-symmetric — PENDING

**File**: `libs\backend\vscode-lm-tools\...\http-mcp-server.service.ts`

**The defect, both halves**:

- `ensureRegisteredForSubagents` (`:129`) is one-shot behind the
  `registeredInMcpJson` boolean (`:50`). After a workspace switch the flag is
  already `true`, so the **second** workspace never gets an entry — and subagents
  spawned there cannot discover the Ptah MCP server, which is the entire stated
  purpose of the mechanism (`:192-199`).
- `unregisterFromMcpJson` (`:237`) resolves its target through
  `getMcpJsonPath()` (`:274`) — the **current** workspace root, not the path it
  actually wrote. So `property-hub/.mcp.json` keeps a `ptah` entry pointing at a
  dead port 51820 forever.

**Fix shape** (from `context.md`): store the written path next to the flag,
unregister from **that** path, and re-register on workspace change.

**Acceptance criteria**:

- Unregister targets the exact path that was written, even after the workspace
  root has changed or gone to zero folders.
- Switching workspaces registers in the new root and unregisters from the old.
- **The read-merge-write at `:218` is preserved.** A hand-authored `.mcp.json`
  with the user's own servers must survive both register and unregister with
  only the `ptah` key touched. This writes into a user-owned file with a
  blocking `fs.writeFileSync` — clobbering it has no undo.
- No workspace open at shutdown must still unregister cleanly.

### Task 2.2 (TEST DELIVERABLE): Regression test for the orphaned `.mcp.json` entry — PENDING

**File**: `libs\backend\vscode-lm-tools\...\http-mcp-server.service.spec.ts` (extend)

**This is a named deliverable.** A3 is a silent-wrong-behaviour defect — it
leaves a dead-port entry in a user's own repository indefinitely and nothing
reports it.

**Required**: a test that **fails before and passes after** — register against
root A, change the workspace root to B, stop the server, assert **A's**
`.mcp.json` no longer contains the `ptah` key. Add a second test asserting a
pre-existing unrelated server key in that file is untouched.

### Task 2.3: Refuse or scope `undefined` workspaceRoot in memory counts — PENDING

**Files**: `memory.store.ts` (`:614-642`), `code-symbol.store.ts` (`:179`),
`memory-rpc.handlers.ts` (`:265-282`)

**The defect**: `memory.store.ts:616-618` builds
`const whereSql = workspaceRoot !== undefined ? 'WHERE workspace_root IS ?' : '';`
— `undefined` drops the predicate **entirely**, so the count spans every
workspace in `~/.ptah/state/ptah-dev.sqlite`. `memory-rpc.handlers.ts:270`
passes `params?.workspaceRoot ?? undefined` straight through, so the
no-workspace call lands in exactly that branch. `codeSymbols.count(workspaceRoot)`
at `:273` has the identical shape.

> **The tri-state is deliberate and must survive.** `null` means
> "global/unscoped memories" (`WHERE workspace_root IS NULL`) and is a genuinely
> different query from `undefined` meaning "no filter". Do not collapse them.
> `memory:purgeBySubjectPattern` (`memory-rpc.handlers.ts:341-346`) already
> refuses `undefined` explicitly — **that refusal is the precedent to follow.**

**Acceptance criteria**:

- A `memory:stats` call with no workspace no longer returns a cross-workspace
  union.
- `workspaceRoot: null` still returns exactly the global/unscoped memories.
- The same treatment is applied to `codeSymbols.count`. Also **check** whether
  `codeSymbols.search` (`memory-rpc.handlers.ts:302`) and `purgeJunk` (`:401`)
  share the leak; fix them if they do, and state in the report if they do not.
- Out of scope reminder: `skillSynthesis:listCandidates`, `cron:list` and
  `gateway:*` are global by design. Do not "fix" them.

**Batch 2 verification**:

- `npx nx test vscode-lm-tools memory-curator rpc-handlers` pass
- Task 2.2's test fails when the fix is reverted
- `code-logic-reviewer` approved

---

## Batch 3: A2 — Tasks board refetches forever against no workspace — PENDING

**Findings**: A2 (medium)
**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer` (re-spawn)
**Execution Mode**: sequential _within the batch_
**PARALLEL-ELIGIBLE**: **YES — may run concurrently with Batch 1 and/or Batch 2.**
The only frontend work in this task. Zero file overlap with any backend batch,
different lib, different executor type.
**Dependencies**: none

**Files touched**:

- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts` (`:2136-2166`, `:2195-2223`)
- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts` (`:382-410` empty state, `:441-470` filtered-empty state)
- `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.spec.ts` (exists — extend)

**Read-only context**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\app-state.service.ts` (`:309` — `workspaceInfo`; **this is the existing source of truth, do not add a new signal**)
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\workspace-coordinator.token.ts`

### Task 3.1: Add a no-workspace state to `TasksStore` and stop the refetch loop — PENDING

**File**: `libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts`

**The defect**: the backend is correct — `tasks-rpc.handlers.ts:1455-1469`
throws a typed `RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN')`
and **that stays exactly as it is** (out of scope). The gap is entirely
frontend. `TasksStore` has no "is a folder open" gate.
`setupVisibilityReconcile` (`:2195`) refetches on every `focus` and
`visibilitychange` behind `_loaded() && !_loading()` — but `fetchBoard`'s
`finally` (`:2160-2165`) sets `_loaded = true` **even on the error path**, so
the guard never latches and each window focus buys another rejection. Nine of
them in the captured log.

**Acceptance criteria**:

- With no folder open, `tasks:board` is called **at most once**, and focus /
  `visibilitychange` do not call it again.
- The `WORKSPACE_NOT_OPEN` error code is recognised specifically — a generic
  network failure must still surface as an error, not as a no-workspace state.
- Workspace state is read from the existing `AppStateManager.workspaceInfo` (or
  the `WorkspaceCoordinator` token). **No new workspace signal.**
- When a folder is opened, the board loads without requiring a manual refresh.
- No import of any backend lib. `libs/shared` is the one bridge.

### Task 3.2: Render the no-workspace state as a distinct third case — PENDING

**File**: `libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts`
**Dependencies**: Task 3.1

**The defect**: today the user sees the error banner set at
`tasks-store.service.ts:2158` where a "no workspace open" state belongs.

The component already has two empty variants: the create-CTA empty state at
`:382-410` ("No tasks on the board") and the filtered-empty state at
`:441-470`. The no-workspace case is a **third**, distinct one and must read
differently — **there is nothing to create without a folder**, so it must not
show the create CTA. **The filtered-empty block at `:441-470` is the shape to
copy** — it already demonstrates a non-CTA empty variant with a `data-testid`.

**Acceptance criteria**:

- Three distinct states are reachable and visually distinguishable:
  not-loaded / empty-with-CTA / no-workspace.
- The no-workspace state offers no "create task" affordance.
- `ChangeDetectionStrategy.OnPush`, signals + `inject()`, per house style.
- A `data-testid` on the new block, matching the convention at `:441-470`.

**Batch 3 verification**:

- `npx nx test tasks-ui` and `npx nx lint tasks-ui` pass
- A store test covers: no workspace → one call, N focus events → still one call
- `code-logic-reviewer` approved

---

## Batch 4: B1 + B2 + C3 + C6 — Electron boot ordering and activation noise — PENDING

**Findings**: B1 (medium), B2 (low), C3, C6
**Recommended Executor**: `backend-developer`
**Fallback Executor**: `software-architect` (B1's ordering may be an architecture call)
**Execution Mode**: sequential
**Rationale**: **These four are one batch purely because of file conflict.**
`wire-runtime.ts` is edited by B1 (`:372-393`), C3 (`:422-449`) and C6
(`:197-214`); `post-window.ts` is edited by B2 (`:108`) and C3 (`:113-117`);
`main.ts` is read-only context for both B1 and B2. Splitting them means a
three-way merge inside one ~450-line region. One owner, one pass.
**Dependencies**: Batch 1, Batch 2 complete

**Files touched**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\wire-runtime.ts` (`:197-214`, `:372-393`, `:422-449`)
- `D:\projects\ptah-extension\apps\ptah-electron\src\activation\post-window.ts` (`:108-117`)
- `D:\projects\ptah-extension\apps\ptah-electron\src\ipc\ipc-bridge.ts` (`:114-130`)
- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts` (`:680`, `:724-765`)
- `D:\projects\ptah-extension\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.blocked-logging.spec.ts` (`:394-401` — exists, extend)
- Possibly `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts` (`:775-807`) — **if you touch this, flag it in your report; Batch 5 owns the neighbouring `skill-drain.service.ts`**

**Read-only context**:

- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` (`:68`, `:127`, `:145` — the `bootstrap → wireRuntime → registerPostWindow` order)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-runner.service.ts` (`:425` — the `MCP disabled` warn)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\activation\wire-runtime.ts` (`:77` — the VS Code twin of C6)

### Task 4.1: B1 — boot curator LLM query runs before MCP is up — PENDING

**The defect**: `wire-runtime.ts:373` **awaits** `bootHeavyServices(...)`;
`bringUpSubsystems` only runs at `:378-384`. So the boot-triggered synthesis
query (`skill-trigger.service.ts:802`, `source: 'boot'`) is issued before the
MCP server exists, gets `mcpServerRunning: false`, and runs **tool-less**. The
identical query after bring-up correctly gets `mcpServerRunning: true,
mcpPort: 51820`.

**Two separable problems, and `context.md` says so explicitly**: (a) the
ordering — a boot-triggered query should either wait for MCP or declare it does
not need it; and (b) **boot alone spends tokens with no user action**.

**Acceptance criteria**:

- A boot-triggered synthesis query either runs after MCP is up, or explicitly
  declares (in code, not in a commit message) that it does not need MCP.
- Address (b) as well as (a), or state in the report why (b) is deliberate.
- The one-shot workspace-change re-entry at `:353` must not double-fire.

### Task 4.2: B2 — two renderer messages dropped before the window exists — PENDING

**File**: `apps\ptah-electron\src\ipc\ipc-bridge.ts` (`:114-130`)

`ipc-bridge.ts:123` warns `Cannot send to renderer: no window available` twice
at boot. Everything in `wireRuntime` runs with `getMainWindow()` returning null
(`main.ts:127` before `:145`).

> **DECISION REQUIRED.** `context.md`: "Determine what the two events were and
> whether either matters — if neither does, the fix may be to stop emitting
> them that early rather than to add a queue."
> **Step one is identification, not implementation.** Instrument or trace the
> two events first. The likely candidates given the boot order are a
> skill-synthesis queue push and a harness `healthChanged` push, but confirm —
> do not assume. Note `:115-120`: batchable stream events **already** go
> through `enqueueStreamEvent`, so a queue exists for one class of message. That
> makes "add a queue" cheap, which is not the same as making it right — a
> queued boot event replayed into a fresh renderer can be worse than a dropped
> one.
> **Record which two events they were, and the reasoning for queue-vs-suppress,
> in a code comment.**

**Acceptance criteria**:

- The two events are named in the report.
- No `Cannot send to renderer` warning at a clean boot.
- If suppressing: nothing downstream silently loses state it depended on.
- If queueing: replay cannot deliver a stale event to a renderer that has since
  reloaded.

### Task 4.3: C3 — worker heap 23 percent over its stated budget, no action — PENDING

**File**: `apps\ptah-electron\src\activation\wire-runtime.ts` (`:422-449`)

`log:905`: `Worker heap after warmup: 246.0 MB (budget: 200 MB)`. Logged and
ignored. **The 200 is an inline magic number appearing twice** — in the
comparison at `:432` and again in the message at `:433-435`. There is no named
constant.

> **DECISION REQUIRED.** `context.md`: "Either the budget is wrong and should be
> raised deliberately, or exceeding it should do something. Decide which."
> Pick one and **write the reasoning into a code comment next to the constant** —
> specifically, what number was measured, and what the budget is _for_. A
> budget nothing acts on is a comment pretending to be a check.

**Acceptance criteria**:

- The threshold is a single named constant, not two literals.
- Either the number changed with a recorded justification, or exceeding it now
  has a consequence beyond a log line.

### Task 4.4: C6 — harness reconcile re-emits an identical thirteen-path warning — REMOVED FROM THIS BATCH

> **Spun out by user decision.** A concurrent session in this same checkout is
> editing `libs/backend/harness-sync/**` — roughly 20 files including
> `harness-reconciler.service.ts` and most of its spec suite, which is exactly
> what this task targets. Two sessions editing one reconciler would mean merge
> pain and a plausible lost edit, so C6 becomes its own task to run once
> harness-sync settles.
>
> Batch 4 existed as one batch ONLY because of file conflict (B1/C3/C6 all
> touch `wire-runtime.ts`; B2/C3 both touch `post-window.ts`). C6 was the one
> member reaching outside those two files, so removing it costs the batch
> nothing structurally.
>
> The specification below is preserved verbatim for whoever picks C6 up. Note
> especially that the refusal behaviour is CORRECT and must not change — this
> finding is about log volume only.

**Files**: `wire-runtime.ts` (`:197-214`), `harness-reconciler.service.ts` (`:724-765`)

Two full six-target passes back to back — `reason: activation` (`:212-214`,
`downloadPending: true`) and `reason: content-download-complete`
(`:197-201`) — both reporting the identical `blocked: 13` list and both
`found: 106/119`.

> **The refusal behaviour is CORRECT and must not change.** Ptah will not touch
> a file it cannot prove it wrote, and the second pass is a legitimate re-run
> after content download. **This finding is about log volume only.** The only
> question is whether the second pass needs to re-emit the full thirteen-path
> payload when nothing changed between the two.

**Acceptance criteria**:

- The refusal rule, the `full`-only guard at `:725`, and `blockedReason()`
  (`:775`) are unchanged in behaviour.
- A second pass with an identical blocked set does not re-emit the full payload.
- A second pass with a **changed** blocked set still reports in full.
- `harness-reconciler.blocked-logging.spec.ts` still passes; extend it to pin
  the identical-set suppression.
- Do not touch the VS Code twin unless the shared code forces it; if you do,
  say so.

**Batch 4 verification**:

- `npx nx build ptah-electron` and `npx nx test harness-sync` pass
- A clean `npm run electron:serve` boot shows no `Cannot send to renderer`, one
  blocked-payload emission, and MCP up before any boot synthesis query
- `code-logic-reviewer` approved

---

## Batch 5: C2 — Cron reports success for drains that did nothing — PENDING

**Findings**: C2
**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-spawn)
**Execution Mode**: sequential
**Rationale**: Widest blast radius in the task — two backend libs, one RPC
namespace, and three consuming surfaces. Needs one owner who enumerates every
consumer before changing a shape. Serialized after Batch 4 because B1 may have
touched the neighbouring `skill-trigger.service.ts` in the same lib.
**Dependencies**: Batch 4 complete

**Files touched**:

- `D:\projects\ptah-extension\libs\backend\cron-scheduler\src\lib\job-runner.ts` (`:170-177`, `:207`)
- `D:\projects\ptah-extension\libs\backend\cron-scheduler\src\lib\types.ts` (`:24-26` — read; `JobRunStatus` already has `'skipped'`)
- `D:\projects\ptah-extension\libs\backend\cron-scheduler\src\lib\run.store.ts` (`:107-119`, `:135-147`)
- `D:\projects\ptah-extension\libs\backend\skill-synthesis\src\lib\queue\skill-drain.service.ts` (`:183` reason union, `:640` budget gate, `:1046` log)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\cron-rpc.handlers.ts` (`:151`, `:273`)
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (`:1829`, `:3591`) — only if the wire shape changes
- `D:\projects\ptah-extension\libs\backend\cron-scheduler\src\lib\job-runner.spec.ts` — **new file**

**Consumers that must be checked, and updated only if the shape changes**:

- `D:\projects\ptah-extension\libs\frontend\cron-scheduler-ui\src\lib\components\cron-job-detail-drawer.component.ts` — the only surface rendering run outcomes. See `libs\frontend\cron-scheduler-ui\CLAUDE.md:27,:50`: **never fabricate a per-card status**
- `D:\projects\ptah-extension\apps\ptah-tui\src\components\thoth\SchedulesPanel.tsx` (`:149`)
- `D:\projects\ptah-extension\apps\ptah-cli\src\cli\commands\cron.ts` (`:345`)

### Task 5.1: Give a skipped drain its own run outcome — PENDING

**The defect**: four pairs in the log — `drain skipped:
{"reason":"daily-token-budget-exhausted"}` immediately followed by
`cron-scheduler run succeeded`. Roughly once a minute. `cron:runs` history is
therefore misleading exactly when a user goes looking for why synthesis stopped.

**Validated scope correction — this is cheaper than `context.md` implies.**
`JobRunStatus` **already** includes `'skipped'` (`types.ts:24-26`) and
`RunStore.markSkipped` is **already** implemented (`run.store.ts:135-147`) and
already used for two other cases (`job-runner.ts:150` concurrency, `:181`
aborted). The gap is that `JobHandlerResult` has no "did nothing" channel, so
`job-runner.ts:170` calls `markSucceeded` unconditionally. **Do not add a new
enum member.** Plumb the signal from the drain's existing reason union
(`skill-drain.service.ts:183`) out through the handler result.

**Acceptance criteria**:

- A budget-exhausted drain records as `skipped` with its reason preserved, not
  as `succeeded`.
- A drain that did real work still records as `succeeded`.
- A genuine failure still records as `failed`.
- The existing `skipped` paths at `:150` and `:181` are unchanged.
- Every one of the three consuming surfaces above renders the outcome correctly.
  The drawer must **not** fabricate a status — read its CLAUDE.md rule first.
- `cron:runs` history distinguishes the three outcomes for a user debugging why
  synthesis stopped. That is the whole point of the fix.

### Task 5.2 (TEST DELIVERABLE): Regression test for the misreported drain — PENDING

**File**: `libs\backend\cron-scheduler\src\lib\job-runner.spec.ts` (**new**)

**This is a named deliverable.** C2 is a silent-wrong-behaviour defect: the
system reported success four times for work it did not do.

**Required**: a test that **fails before and passes after** — a job handler
returning a "did nothing / budget exhausted" result must produce a `skipped` run
record, not `succeeded`. Add the companion test that a handler doing real work
still produces `succeeded`, so the change cannot swing the other way.
`run.store.spec.ts` and `cron-scheduler.spec.ts` must still pass untouched.

**Batch 5 verification**:

- `npx nx test cron-scheduler skill-synthesis rpc-handlers cron-scheduler-ui` pass
- `npx nx typecheck ptah-tui ptah-cli` clean (both read run outcomes)
- Task 5.2's test fails when the fix is reverted
- `code-logic-reviewer` approved

---

## Batch 6: C1 + C4 + C5 + C7 — Diagnostics, noise and one investigation — PENDING

**Findings**: C1, C4, C5, C7
**Recommended Executor**: `backend-developer`
**Fallback Executor**: `researcher-expert` (only if C1's investigation stalls)
**Execution Mode**: sequential
**Rationale**: Four small, mutually file-disjoint items in four different libs.
Lowest severity, so last. Grouped because none justifies its own batch and none
can collide with another.
**Dependencies**: Batch 5 complete

### Task 6.1: C1 — `unrecognized_model` on session-title generation — PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\workspace-provider-profile-resolver.ts` (`:396-399`, `:453`, `:466` — `ANTHROPIC_DEFAULT_HAIKU_MODEL`)
- `D:\projects\ptah-extension\libs\backend\auth-providers\src\lib\auth\model-resolver.ts` (`:38-48`, `:122`)
- Read-only: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-model-service.ts` (`:721-729`), `libs\backend\agent-sdk\src\lib\auth-env.port.ts` (`:24-55`)

**Validated scope correction — this is not the fix `context.md` implies.**
There is **no `generate_session_title` producer anywhere in this repo**.
`query_source: "generate_session_title"` is an internal Claude Code CLI/SDK
query. The tier mapping itself is _correct_ — `sdk-model-service.ts:725` resolves
`haiku` → `deepseek-v4-flash:0731-cloud` exactly as designed. **Ptah's only
lever is the model the SDK sees**: the small-fast tier env injected by
`workspace-provider-profile-resolver.ts:396-399`. Budget this as an
env/tier-injection change, not a patch to a title generator.

> **DECISION REQUIRED — and the first step is not a code change.**
> `context.md`: "Titles are presumably not being generated. **Confirm the
> user-visible symptom before choosing a fix.**" Do that first. If titles
> generate fine and this is stderr noise, the correct outcome may be to change
> nothing and say so — with the evidence. If titles are genuinely broken, then
> decide what the small-fast tier should resolve to for a non-Anthropic provider
> and record the reasoning in a code comment.

**Acceptance criteria**:

- The user-visible symptom is stated as an observation, not an inference.
- Either a justified env/tier change, or a written finding that no code change
  is warranted. Both are acceptable outcomes; a guess is not.
- Do not change `ModelResolver`'s tier substitution — it is behaving correctly.

### Task 6.2: C4 — repeated ENOENT for a broken skills.sh install — PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.ts` (`:890-901`)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\skills-sh\skills-sh-source-root.service.ts` (`:100-170`)

Log 793/844/1012 — once per `plugins:list-available`. The `readFileSync` catch
at `:893-899` logs and `continue`s with no per-root memo, so it re-fires on
every list call.

**Two questions, per `context.md`**: why did the install leave a half-tree, and
should a permanently-broken root be reported once rather than on every call.

**Validated note**: the staging verification **already exists** —
`skills-sh-source-root.service.ts:133-140` refuses a stage with zero readable
slugs, and moves only after verifying. The half-tree on this machine may predate
that guard or have arrived via a non-staged path. **Investigate before assuming
a staging bug.** Check `readMetadata` / `listSkillSlugs` semantics.

**Acceptance criteria**:

- A permanently-broken root is reported once, not once per list call.
- A root that becomes readable later is still picked up.
- If the staging guard has a real hole, fix it; if it does not, say so with
  evidence rather than editing it defensively.
- Out of scope: resolving the user's own broken install on this machine.

### Task 6.3: C5 — AgentDiscovery ENOENT bypasses the logger — PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\agent-discovery.service.ts` (`:303-311`, `console.debug` at `:306-309`)
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\autocomplete\command-discovery.service.ts` (`:574` — **same smell, same lib; fix both**)

A raw `console` write with no `[DEBUG]`/`[INFO]` prefix, unlike every other line
in the log, fired once per `autocomplete:agents`. A missing `~/.claude/agents`
is the **normal** case for a user who has never made a user-level agent.

**Acceptance criteria**:

- Both sites route through the injected logger, not `console`.
- A missing directory is not a per-call emission.
- A directory that exists but is genuinely unreadable (EACCES, not ENOENT) is
  still surfaced — do not swallow a real permission problem along with the
  expected miss.

### Task 6.4: C7 — sqlite-vec primary resolver fails noisily on every boot — PENDING

**Files**:

- `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\sqlite-connection.service.ts` (`:668-689` strategy list, `:695-731` attempt loop, `:733-749+` the multi-line failure block, `:724-729` errorChain)
- `D:\projects\ptah-extension\libs\backend\persistence-sqlite\src\lib\vec-load-diagnostic.ts` (`VecLoadReason` `:1-7`, `VecLoadAttemptError` `:9-13`)

Overall `ok: true` — the `require-resolve-platform-pkg` fallback loads
`vec0.dll` fine. But the **primary** resolver's failure prints a full multi-line
diagnostic naming two paths that do not exist under Electron. **Expected-path
failures should not look like errors.**

**Acceptance criteria**:

- An expected primary-resolver miss followed by a successful fallback logs at
  debug volume, not as an error block.
- A load that fails **all** strategies still prints the full diagnostic chain —
  that is the case the block was written for and it must survive intact.
- The existing `attemptedFallbacks` reporting on the success path is preserved.

**Batch 6 verification**:

- `npx nx test auth-providers agent-sdk rpc-handlers workspace-intelligence persistence-sqlite` pass
- A clean Electron boot shows no multi-line sqlite-vec error block and no raw
  `[AgentDiscovery]` console line
- `code-logic-reviewer` approved

---

## Batch 7: Cross-cutting regression sweep — PENDING

**Recommended Executor**: `senior-tester`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Thirteen fixes across nine libs and one app, landing in six
batches, three of them with named fail-before/pass-after tests. A single sweep
at the end is the only place the _interaction_ between them gets exercised —
particularly the boot path, which Batches 4, 5 and 6 all touched.
**Dependencies**: Batches 1-6 complete

### Task 7.1: Verify the three named regression tests actually latch — PENDING

For each of Task 1.3 (A1), Task 2.2 (A3) and Task 5.2 (C2): revert the fix
locally, confirm the test **fails**, restore, confirm it **passes**. Report the
three results explicitly. A test that passes with the fix reverted is not a
regression test and must be sent back.

### Task 7.2: Replay the log scenario end to end — PENDING

Reproduce the captured timeline against the fixed build:

1. Boot with a workspace restored from persisted state
2. `workspace:removeFolder` → **zero** folders open
3. `workspace:addFolder` + `workspace:switch` to a second folder
4. `workspace:removeFolder` → **zero** folders open again

**Assert**: no proxy started and no OAuth refresh on either removal (A1); at
most one `tasks:board` call while no folder is open, and the no-workspace UI
state rendered rather than the error banner (A2); `.mcp.json` registered in the
second folder and absent from the first (A3); `memory:stats` with no workspace
not returning a cross-workspace union (A4); MCP up before any boot synthesis
query (B1); no `Cannot send to renderer` warning (B2); one blocked-payload
emission, not two (C6); no raw `[AgentDiscovery]` console line (C5); no
multi-line sqlite-vec error block (C7).

### Task 7.3: Confirm nothing out of scope moved — PENDING

Re-read the "Out of scope" list above against the full diff. Specifically
confirm: `resolveRoot` (`tasks-rpc.handlers.ts:1455-1469`) is untouched;
`skillSynthesis:listCandidates`, `cron:list` and `gateway:*` are still ungated;
harness-sync's refusal-on-unowned-path rule is unchanged in behaviour. Report
any drift as a finding, not as a fix.

**Batch 7 verification**:

- `npm run typecheck:all` and `npm run lint:all` clean
- Full `npm run test` green
- `test-report.md` written to the task folder
