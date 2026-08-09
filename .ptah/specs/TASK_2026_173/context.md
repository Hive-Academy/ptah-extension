# TASK_2026_173 — Context

## Meta

| Field              | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Task ID            | TASK_2026_173                                                      |
| Type               | FEATURE (correctness + performance + new diff interaction surface) |
| Complexity         | Complex (>8h)                                                      |
| Workflow           | Full — PM → Architect → Team-Leader → QA                           |
| CLI delegation     | disabled (user decision, Checkpoint 0.1)                           |
| Branch at creation | ak/license-server-validation-pipe                                  |
| Created            | 2026-08-03                                                         |

## User Intent

> "evaluate our editor panel please like from different point of view specially performance and showing git diffs respectively"
> …followed by `/orchestrate a task for this please`

The user asked for an evaluation of `libs/frontend/editor`, weighted toward **performance** and **git diff display**. The evaluation below was produced by reading the lib end-to-end (~7.5k LOC) plus the backend git path. The user then selected **full scope including hunk-level stage/revert** at Checkpoint 0.

## Scope Decision (Checkpoint 0)

**Selected: all 15 findings, including hunk-level stage/revert (#14).**

Options presented and NOT chosen: correctness-only (1–4); correctness+perf (1–8); full-minus-hunk-staging (1–13).

Implication the architect must plan around: #14 is a feature project in its own right — new RPC surface (`git:applyPatch` or equivalent), a new Monaco interaction model, and a writable diff. It should be sequenced **last**, after the correctness defects it depends on are fixed, because staging a hunk against a stale diff snapshot (#1) or against the wrong base revision (#2) would corrupt the user's index.

## Findings — Evidence

Grouped as delivered. File:line refs are against the tree at task creation.

### A. Git diff correctness (highest severity — silently wrong output)

**A1. Diff tabs are frozen snapshots.**
`openDiff` early-returns the cached tab when one exists (`libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts:29-36`); nothing ever refetches it. After commit / stage / discard the open diff still shows pre-operation state, and re-clicking the file in Source Control just re-activates the stale tab.
The refresh path that should cover this is misfiring: `editor:reread-open-tabs` iterates every open tab and calls `handleFileContentChanged(tab.filePath)` (`editor-workspace.ts:348-353`). For a diff tab that path is `diff:libs/frontend/foo.ts` — not a real file — so it issues an `editor:openFile` RPC that always fails (`editor-file-ops.ts:274-280`). Cost: one wasted round-trip per open diff tab per git op, and zero refresh.

**A2. Staged diffs show the wrong comparison.**
Both the _Staged Changes_ and _Changes_ rows emit identical `diffRequested` events (`source-control-panel.component.ts:110` and `:158`), and `openDiff` always runs `git show HEAD:<path>` against the working tree. For a partially-staged file the staged row therefore shows HEAD↔worktree instead of HEAD↔index — it includes changes deliberately left unstaged. The tab key is `diff:${relativePath}` for both rows, so they collide on one tab.

**A3. `git:showFile` swallows failures into empty content.**
Any non-zero exit or throw returns `{ content: '' }` (`libs/backend/vscode-core/src/services/git-info.service.ts:416-429`) while the RPC still reports success. The UI reads empty-original as new-file (`diff-view.component.ts:100-102`) and renders **"(new file)"** with the whole file as an addition. A git failure is indistinguishable from a genuinely new file.

**A4. Deleted files cannot be diffed.**
`openDiff` hard-requires `editor:openFile` on the worktree path to succeed (`editor-diff-split.ts:54-62`). For a `D`-status file that fails → error toast, no diff. Correct rendering is HEAD↔empty.

### B. Performance

**B1. The diff editor is destroyed on every tab switch.**
`DiffViewComponent` sits under `@if (editorService.activeDiffTab())` (`editor-panel.component.ts:254`), so switching diff → file tears down the whole Monaco diff editor. Returning costs a fresh `createDiffEditor` + two `createModel` + full diff compute + tokenize.
This is exactly the teardown `CodeEditorComponent` was rewritten to eliminate — see its docblock (`code-editor.component.ts:25-50`) and the always-mounted-host comment (`editor-panel.component.ts:240-252`). **The proven fix already exists in this lib; port it.**

**B2. `updateModels` disposes and recreates both models** rather than calling `setValue` (`diff-view.component.ts:214-229`), re-tokenizing from scratch on every content change. It also reaches for `window.monaco` directly instead of the handle `MonacoLoaderService` resolved.

**B3. `hasChangedChildren` is O(directories × changed files).**
Every directory node linear-scans all `fileStatusMap` keys (`file-tree-node.component.ts:284-304`), recomputed on every `git:status-update`. A rebase in this monorepo (hundreds of changed files × hundreds of expanded dirs) is six figures of string comparison per push. Fix: derive a `Set` of changed directory prefixes once in `GitStatusService` beside `fileStatusMap`; per-node lookup becomes O(1).

**B4. Watcher exclusion list is narrower than the tree builder's.**
The watcher skips only `node_modules`, `dist`, `.git` (`apps/ptah-electron/src/services/git-watcher.service.ts:385-393`); the tree builder additionally skips `.cache` etc. via `HIDDEN_SKIP` (`apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:70`). In this repo `.nx/cache` and `.angular/cache` churn continuously during builds → a `git status --porcelain=v2` shell-out every 2s (`WORKSPACE_DEBOUNCE_MS`) plus `file:tree-changed` → full depth-6 tree refetch and `mergeLoadedSubtrees` walk.

**B5. Drag handlers defeat their own zone optimization** — `runOutsideAngular` wrapping an `ngZone.run()` on every `mousemove` (`editor-panel.component.ts:837-849`, `885-902`, `930-940`). Coalesce with `requestAnimationFrame` and write the signal directly.

**B6. No virtualization in the file tree.** Expanding a large directory renders every node. Not urgent at current scale; note as a known cliff.

### C. Architecture consistency

**C1. Three parallel inbound-message paths.**
`GitStatusService` (`git-status.service.ts:217-225`) and `EditorWorkspaceHelper` (`editor-workspace.ts:328-357`) attach raw `window.addEventListener('message')` listeners, while this lib's own `CLAUDE.md` guideline #1 mandates `MESSAGE_HANDLERS`. `EditorService` follows the rule for one message type (`EDITOR_TAB_CONTENT_REVERTED`) and the helper it owns breaks it for three others.

**C2. Split-pane saves can clobber.**
`openFileInSplit` copies tab content at open time; split edits write only `splitFileContent` (`editor-diff-split.ts:139-141`), never back into `openTabs`. Open the same file in both panes, edit both, save both → last writer wins silently. The independent Monaco models are deliberate (`code-editor.component.ts:202-208`); the save path is what turns that into data loss.

### D. UX / accessibility

**D1. Nested `<button>` elements** — tab close inside the tab button (`editor-panel.component.ts:229` inside `:206`); stage-all / unstage-all inside the section-header button (`source-control-panel.component.ts:93` inside `:78`). Invalid HTML, broken keyboard/AT semantics, and the reason `stopPropagation` is needed throughout.

**D2. Hunk-level stage / revert — THE FEATURE.**
The diff is read-only with no hunk actions: `readOnly: true`, `renderMarginRevertIcon: false` (`diff-view.component.ts:158,161`). This is the largest functional gap against VS Code's SCM view. **In scope per user decision.** Depends on A1 and A2 being fixed first.

**D3. `renderSideBySide: true` is hardcoded** — no unified/inline toggle, cramped in a pane sharing width with a 256–480px sidebar.

## Constraints

- **Verification status**: all findings are read from source, none measured at runtime. The architect should plan a measurement step for B1/B3/B4 so improvements are provable rather than asserted.
- **RPC dual-registration rule** applies to any new namespace (e.g. hunk apply): BOTH `libs/shared/.../rpc.types.ts` AND `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. Missing the runtime guard = silent crash.
- **Three runtimes**: VS Code, Electron, CLI. `git-watcher.service.ts` is Electron-only; any new git RPC needs a `platform-core` port, not a branch inside an adapter.
- **A1/A2 are coupled**: both change `openDiff`'s tab-key scheme (a diff tab must key on `{path, side}` and carry a git revision). Plan them as one unit of work, not two.
- **D2 must land last** — staging a hunk against a stale snapshot (A1) or the wrong base (A2) would corrupt the user's git index.
- Electron test baseline before this task: **143 passed / 4 skipped**. Do not regress.
- Angular rules: OnPush mandatory, signals + `inject()`, no `[innerHTML]` on AI markdown.

## Related Prior Work

- Model/view-state caching + always-mounted editor host in `CodeEditorComponent` (TASK_2026_154 Serious #2) — the reference implementation B1 should copy.
- `GitStatusService.CACHE_TTL_MS` (5s) and its documented trade-off with the single-workspace Electron watcher — read before touching git fetch scheduling.
