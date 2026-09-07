# Design Handoff — TASK_2026_386

Companion to `design-spec.md`. Component inventory, reuse map, and open
questions for the owner.

---

## 1. Component inventory

### 1.1 New components

| Component                   | Selector                                                                                                                                            | Lib                                                                          | Layer                                                                          | Key inputs                                                                                    | Key outputs                                                                                                             | data-testid roots                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ChangeSetCardComponent`    | `ptah-change-set-card`                                                                                                                              | `chat` (organism — injects RPC, not presentational)                          | organism                                                                       | `turnId: string`, `files: readonly ChangeSetFileStat[]`, `isLoading: boolean`                 | `openDiff: OpenDiffRequest`, `openInEditor: {path, line?}`, `revertFile: string`, `revertAll: void`, `openInDock: void` | `change-set-card`, `change-set-card-row`, `change-set-card-overflow` |
| `ChangeSetFileRowComponent` | `ptah-change-set-file-row`                                                                                                                          | `chat` (or `git-ui` if shared with git dock rows — see Q3)                   | molecule                                                                       | `stat: ChangeSetFileStat`, `expanded: boolean`                                                | `toggleExpand`, `openDiff`, `openInEditor`, `revert`                                                                    | `change-set-row-{path}`                                              |
| `GitDockComponent`          | `ptah-git-dock`                                                                                                                                     | new `libs/frontend/git-ui` (carved by TASK_2026_385)                         | template                                                                       | none (root-mounted like `EditorPanelComponent` was)                                           | none (drives its own child components)                                                                                  | `git-dock`                                                           |
| `GitDockHeaderComponent`    | `ptah-git-dock-header`                                                                                                                              | `git-ui`                                                                     | organism                                                                       | `branch: GitBranchInfo`, `worktree: string \| null`                                           | `openInRequested`                                                                                                       | `git-dock-header`                                                    |
| `TaskChangeSetTabComponent` | `ptah-task-change-set-tab`                                                                                                                          | `git-ui`                                                                     | organism                                                                       | `files: GitFileStatus[]`, `canMerge: boolean`, `canCreatePr: boolean`, `ghAvailable: boolean` | `merge`, `createPr`, `stageAll`                                                                                         | `task-changeset-tab`                                                 |
| `SpotEditorComponent`       | `ptah-spot-editor`                                                                                                                                  | `git-ui`                                                                     | organism                                                                       | `path: string`, `content: string`                                                             | `saved: string`, `closed: void`                                                                                         | `spot-editor`                                                        |
| `OpenInButtonComponent`     | `ptah-open-in-button`                                                                                                                               | `git-ui` (shared — imported by `chat` for §1.2/1.3 and by `git-ui` for §2.2) | molecule (presentational — detection state is input, not injected)             | `targets: EditorTarget[]`, `remembered: string \| null`, `mode: 'full' \| 'icon-only'`        | `open: {target: string, path?: string, line?: number}`                                                                  | `open-in-button`                                                     |
| `WorktreeChipComponent`     | `ptah-worktree-chip`                                                                                                                                | `tasks-ui`                                                                   | atom (or inline in `task-card.component.ts` if under ~20 lines — see spec 3.1) | `worktree: string`, `branch: string`, `ahead: number`, `behind: number`                       | none                                                                                                                    | `task-card-worktree`                                                 |
| `ChangeCountChipComponent`  | inline in `task-card.component.ts` template (too small to be its own file per the file-size guideline's "no ~150-line split just to satisfy a cap") | `tasks-ui`                                                                   | —                                                                              | `insertions: number`, `deletions: number`, `fileCount: number`                                | none                                                                                                                    | `task-card-changes`                                                  |

### 1.2 Existing components — reused as-is

| Component                     | File                                                                                 | Reused for                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SourceControlPanelComponent` | `libs/frontend/editor/src/lib/source-control/source-control-panel.component.ts`      | Git dock "Working tree" tab (§2.3), moves to `git-ui` per TASK_2026_385 phase 2, no template changes                                                                                                                                                                                       |
| `SourceControlFileComponent`  | `libs/frontend/editor/src/lib/source-control/source-control-file.component.ts:1-247` | File rows in both dock tabs; `diffRequest` computed (`:165-172`) extends to a third `comparison` variant for the Task tab                                                                                                                                                                  |
| `WorktreeSectionComponent`    | referenced at `source-control-panel.component.ts:22,227`                             | Worktree section below Working-tree tab, unchanged                                                                                                                                                                                                                                         |
| `DiffViewComponent`           | `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts`                      | Diff surface in the dock — **internals swap Monaco→CodeMirror 6 per context.md scope B, but the 4 inputs (`diffTab`, `openDiffKeys`, `showHeader`, `applyHunks`) and `retryRequested` output (`:696-730`) stay identical** so this spec's dock wiring does not change when that swap lands |
| `DiffDisplayComponent`        | `libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts`   | Visual seed only — its oklch token mapping (`:74-98`) is copied into `ChangeSetFileRowComponent`'s expanded-diff styling; the component itself is not reused (it's a single-diff Prism renderer, the change-set row needs multi-hunk CodeMirror)                                           |
| `TaskCardComponent`           | `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`             | Extended in place — new chips in the meta row (`:280-362` region), new action row after the existing footer (`:403-452`)                                                                                                                                                                   |

### 1.3 Backend surface this spec assumes (owned by architect/backend, not this handoff)

- `git:changedFiles` (new RPC, context.md scope A) — feeds §1 (turn-scoped) and §2.4 (task-scoped).
- `GitDiffComparison` gains a third variant for branch-vs-main (§2.4) — exact shape is the architect's call, not specified here.
- `ChangeSetFileStat` (new shared type, not yet in `libs/shared`) — `{path: string, status: GitFileStatus['status'], additions: number, deletions: number, origPath?: string}`. Needs a real definition site in `libs/shared/src/lib/types/rpc/rpc-git.types.ts`.
- `IEditorLauncher` port + `EditorTarget[]` (context.md scope D) — `OpenInButtonComponent`'s `targets` input shape.
- Task carrier frontmatter gains `worktree` / `branch` fields (context.md scope C) — read by `WorktreeChipComponent`.

---

## 2. Inputs / outputs summary (quick reference)

```
ChangeSetCardComponent
  in  turnId: string
  in  files: readonly ChangeSetFileStat[]
  in  isLoading: boolean
  out openDiff: OpenDiffRequest
  out openInEditor: { path: string; line?: number }
  out revertFile: string
  out revertAll: void
  out openInDock: void

OpenInButtonComponent
  in  targets: EditorTarget[]
  in  remembered: string | null
  in  mode: 'full' | 'icon-only'
  in  path?: string          // pre-scopes a single-file open
  in  line?: number
  out open: { target: string; path?: string; line?: number }

GitDockHeaderComponent
  in  branch: GitBranchInfo
  in  worktree: string | null
  in  activeTab: 'task' | 'workingTree'
  out tabChange: 'task' | 'workingTree'
  out openInRequested: string   // target id, delegates to OpenInButtonComponent internally

TaskChangeSetTabComponent
  in  files: GitFileStatus[]
  in  canMerge: boolean
  in  canCreatePr: boolean
  in  ghAvailable: boolean
  out merge: void
  out createPr: void
  out stageAll: void

SpotEditorComponent
  in  path: string
  in  content: string
  out saved: string   // new content, caller performs the write RPC
  out closed: void
```

---

## 3. Open questions for the owner (max 5)

1. **Revert source for a single change-set file row (§1.3).** `session:rewindFiles` reverts by message id / anchor, which is turn-scoped and correct for "undo everything this turn did to this file." But if the user has since staged or the file diverged from the turn's edit, is a per-file revert still `rewindFiles` scoped to one path, or should it fall back to `git:discard`? The spec assumes `rewindFiles` scoped to a path filter; confirm the RPC actually supports that filter or whether a fallback path is needed.
2. **Terminal (context.md open decision E) is unresolved and out of this spec's 3 surfaces.** If kept, does it live as a fourth git-dock tab, a bottom drawer under the dock, or its own vertical-tab slot beside "Git"? This spec deliberately does not place it anywhere so as not to presuppose the decision.
3. **Should `ChangeSetFileRowComponent` (transcript) and `SourceControlFileComponent` (dock) converge into one shared row component in `git-ui`, or stay separate?** They render near-identical status icon/stat/action recipes but serve different action sets (revert-this-turn vs stage/unstage/discard). This spec keeps them as two components sharing a visual recipe rather than one component with a mode flag, to avoid a shared component whose prop surface grows with every future divergence — but a shared row is a reasonable alternative if the architect prefers.
4. **Merge conflict UI is unspecified.** §2.4's "Merge into main" assumes a clean fast-forward or auto-merge. What does the dock show on a real conflict — inline conflict markers in the spot editor, a blocking modal, or a punt to the external editor? Not designed here; needs a decision before implementation reaches that branch.
5. **Six-file threshold for the "many files" compact state (§1.4) is a judgment call**, not sourced from an existing convention (no other surface in the repo caps a list at exactly 6). Fine to ship as proposed, but flagging since it's an invented number rather than a reused one.

---

## 4. Contrast pairs measured

| Pair                                                                        | Ratio                                                                                                                                                                                                                                                                              | Criterion                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `text-base-content-muted` (`--bcm`) on `bg-base-200`/`bg-base-300` (anubis) | ≥5.29:1 (pinned by `base-content-muted.spec.ts`, computed against `base-100`; `base-200`/`base-300` are lighter than `base-100` in this dark theme, so the ratio only improves)                                                                                                    | WCAG AA 4.5:1 (body text)                   |
| `text-base-content-muted` on `bg-base-200`/`bg-base-300` (anubis-light)     | ≥5.01:1 (same spec, computed against `base-100`; `base-200 < base-300` are darker than `base-100` here, ratio still improves)                                                                                                                                                      | WCAG AA 4.5:1                               |
| `text-success` / `text-error` (stat pills) on `bg-base-200`                 | Inherits the existing daisyUI semantic-color contrast already relied on by `source-control-file.component.ts:210-225` and `diff-display.component.ts` — not re-measured here since no new color value is introduced, only a new placement (plain stat text instead of Prism token) |
| Focus ring `oklch(var(--s))` on `bg-base-100`/`bg-base-200`/`bg-base-300`   | Inherits the existing recipe from `source-control-file.component.ts:54-56`, already in production use across the retained source-control surface                                                                                                                                   | WCAG 2.1 SC 1.4.11 (non-text contrast, 3:1) |

No new color values are introduced anywhere in this spec — every color reference above resolves to an existing daisyUI semantic token or `--bcm`, both already audited by the repo's own tests. The one net-new visual pairing (stat pills as plain colored text rather than Prism-highlighted diff tokens) uses the same oklch values already measured for the token/prefix classes in `diff-display.component.ts:74-92`, so no new pair needed independent measurement.
