# TASK_2026_173 — Amendments

**Status**: BINDING. Approved by the user at Checkpoint 2 (2026-08-03), covering both `task-description.md` and `implementation-plan.md` in one approval.

Where this file conflicts with `task-description.md`, **this file wins**. `implementation-plan.md` was written against the provisional requirements and already reflects these amendments; no rework of the plan is needed.

Origin: the five `## Requirements Concerns` raised by the software-architect. Concerns 1, 2 and 3 were independently verified against the working tree by the orchestrator before approval; the verification evidence is recorded inline below.

---

## A-1 — NFR-5: no `platform-core` git port (supersedes NFR-5's git clause and D2 AC13)

**Struck:**

> New git capability SHALL be expressed as a port in `platform-core` with adapter implementations, not as a branch inside an existing adapter.

**Replaced with:**

> New git capability SHALL be added to `GitInfoService` (`libs/backend/vscode-core/src/services/git-info.service.ts`) and surfaced through `GitRpcHandlers`, which are already three-runtime. It SHALL NOT be added to `git-watcher.service.ts` or to any host-specific handler.

**Why.** The original clause was written by the orchestrator in `context.md` and conflated two different things: the git _watcher_ (`apps/ptah-electron/src/services/git-watcher.service.ts`) genuinely is Electron-only, but the git _RPC surface_ is not. Verified:

- `GitInfoService` lives in `vscode-core`, not in a `platform-*` adapter.
- Its manifest entry is `{ key: 'git', methods: GitRpcHandlers.METHODS, requires: [], handler: GitRpcHandlers }` (`manifest.ts:154-158`) — `requires: []` means ungated, so it registers on all three hosts.
- Registered in VS Code (`phase-3-handlers.ts:56`), Electron (`phase-4-handlers.ts:102`) and CLI (`cli-engine/container.ts:274`).

A port would produce three identical copies of `cross-spawn`-based git code with no per-runtime variation to justify them. The one place a genuine port _is_ required — worktree file reads — already has one (`IFileSystemProvider.readFileBytes`).

## A-2 — NFR-4 / D2 AC12: name the gate that can actually fail

`ALLOWED_METHOD_PREFIXES` already contains `'git:'` — verified at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:67`. No new `git:*` method can reach the silent-crash mode NFR-4 describes.

The gates that can actually fail for this task, both loud:

1. `RPC_METHOD_PRESENCE` in `libs/shared/.../rpc.types.ts` — **compile error** if a method is missing.
2. `GitRpcHandlers.METHODS`, asserted by `rpc-allowlist.spec.ts:43` to partition `RPC_METHOD_NAMES` exactly — **test failure** if a method is missing.

The end-to-end Electron exercise stays a DoD item as good practice. It SHALL NOT be described as the only thing preventing a silent crash: that framing sends reviewers hunting for a missing prefix that cannot be missing, and away from the manifest tuple that genuinely can be.

## A-3 — R-2 downgraded to Low/Low; A2 AC5 reworded

`EditorService._workspaceEditorState` is an in-memory `Map` (`editor.service.ts:43-46`). A repository-wide search finds no backend writer of editor `openTabs` — `layout-rpc.handlers.ts` persists pane widths only. Verified independently: no `openTabs` reference exists anywhere under `libs/backend/` or `apps/`.

Diff tabs therefore do not survive a process restart. There is no stored old-format entry to encounter on upgrade, no migration to write, and no first-run purge contingency to hold in reserve.

- **R-2**: High/Medium (6) → **Low/Low**. Its verification budget is reallocated to R-3 (newly-visible git failures), whose triage matrix is real work.
- **A2 AC5**: strike "persisted and the workspace is reopened". Replace with: _"a workspace switch away and back within the same session restores the same comparison."_ That path exists (`editor-workspace.ts:74-86`) and the design covers it.

## A-4 — SEQ-3 §4 reversed: C1 runs FIRST

**Struck:** "C1 touches the same message plumbing A1 relies on; if it is done before A1 it will conflict, so it follows A."

**Replaced with:** C1 SHALL be delivered as the first implementation batch, ahead of the A-group.

**Why.** The conflict runs the other way. A1's fix needs a _new_ `git:status-update` subscriber inside the editor lib. With C1 unlanded, A1 must either add a fourth raw `window.addEventListener` — violating the lib's own guideline #1, which C1 exists to enforce — or thread the trigger through `EditorWorkspaceHelper`'s raw handler, which C1 then rewrites. Running C1 first means A1 writes its trigger into the final architecture exactly once.

C1 is small and mechanical: four `MESSAGE_TYPES` entries, two services converted, one provider line. Cost is one small batch of delay to the P0 fixes; benefit is removing rework from the largest and riskiest batch in the task.

**This violates neither SEQ-1 nor SEQ-2.** Both remain fully in force.

## A-5 — A4 AC1 wording

Under the A2 comparison model a worktree deletion opens the `worktree` comparison, whose original side is the **index**, not HEAD. The two coincide only when nothing is staged.

- **A4 AC1**: "the HEAD content on the original side" → _"the pre-deletion content (index) on the original side"_.
- **A4 AC2**: unchanged — the staged comparison's original genuinely is HEAD.

---

## Consequential amendment — A-group merged into one batch

`implementation-plan.md` §0 recommends delivering **A1 + A2 + A3 + A4 as a single unit** rather than the four sequential steps SEQ-3 prescribes, because all four fall out of one change: replacing the string-keyed frozen-snapshot mechanism with the `git:diffFile` RPC plus a structured diff-tab record.

This is **stricter** than SEQ-1, not a relaxation of it. SEQ-1 required A1 and A2 to be indivisible; this makes A1–A4 indivisible. The SEQ-1 verification criterion still holds and is strengthened: the diff of the delivered change SHALL show the tab-key scheme changed exactly once.

**SEQ-2 is untouched and remains absolute.** No part of the D2 write path merges until batch 2 is independently verified against the A-group acceptance criteria.

---

## Three findings added to scope (from `implementation-plan.md` §1)

Discovered during architectural investigation; not present in `context.md`. All three are prerequisites, not optional extras.

| ID     | Finding                                                                                                                                                                                                                                                                                       | Consequence                                                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **N1** | The diff view sits in an `@if`/`@else if`/`@else` chain whose final `@else` **is** `<ptah-code-editor>` (`editor-panel.component.ts:254`, `:264`, `:275-287`). Activating a diff tab destroys the code editor, discarding the Monaco model and view-state cache for **every open workspace**. | B1's blast radius is double what B1 states. This is the TASK_2026_154 teardown silently reintroduced by template structure. Folded into batch 3. |
| **N2** | `execGit` decodes stdout chunk-by-chunk via `Buffer.toString()` (`exec-git.ts:62-64`), corrupting multi-byte UTF-8 at chunk boundaries, and never closes stdin (`:43`).                                                                                                                       | `git apply -` cannot be invoked at all today. **N2 is a hard prerequisite for both A3 and D2** and lands in batch 2.                             |
| **N3** | The `porcelain=v2` type-2 (rename/copy) parser discards the original path (`git-info.service.ts:988-1010`); `GitFileStatus` has no `origPath` field (`rpc-git.types.ts:6-15`).                                                                                                                | A2 AC6 (staged rename diffs against the correct pre-rename source) is unimplementable without extending `GitFileStatus`. Folded into batch 2.    |
