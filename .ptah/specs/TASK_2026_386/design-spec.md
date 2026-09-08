# Design Spec — TASK_2026_386: Change-set review, git dock, task↔worktree

Design system: existing `anubis` / `anubis-light` daisyUI themes
(`apps/ptah-extension-webview/tailwind.config.js:70-190`). No new tokens are
introduced. Every value below cites its source. Contrast reference: WCAG 2.1 AA
(4.5:1 body text, 3:1 large text/UI components) — the project's own standard,
enforced today by `base-content-muted.spec.ts` against `--bcm`.

Scope boundary: this spec covers the **Electron shell**. VS Code webview
degradations are called out per surface (§5).

---

## 0. Token legend (used throughout, nothing invented)

| Token                                                                                                                       | Source                                                           | Use                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `text-base-content`                                                                                                         | daisyUI base                                                     | primary text                                                                                                                 |
| `text-base-content-muted`                                                                                                   | `tailwind.config.js:31`, resolves `oklch(var(--bcm, var(--bc)))` | secondary text tier — **the only muted-text class used below**; never `text-base-content/NN`                                 |
| `bg-base-100` / `bg-base-200` / `bg-base-300`                                                                               | daisyUI base                                                     | surface stack (100=canvas, 200=chrome/header, 300=recessed/well)                                                             |
| `border-base-content/10`                                                                                                    | existing repo convention (`electron-shell.component.ts:90,263`)  | hairline dividers — the one alpha-modified class the codebase already standardizes on for borders (not text)                 |
| `text-success` / `text-error` / `text-warning` / `text-info`                                                                | daisyUI semantic                                                 | `+`/`-`/conflict/untracked — matches `source-control-file.component.ts:210-225` and `diff-display.component.ts` oklch tokens |
| `badge-success` / `badge-error` / `badge-outline` / `badge-ghost`                                                           | daisyUI                                                          | count pills                                                                                                                  |
| `btn-xs` / `btn-ghost` / `btn-primary` / `btn-outline`                                                                      | daisyUI                                                          | actions, per `task-card.component.ts` and `source-control-panel.component.ts`                                                |
| `text-[10px] uppercase tracking-wider opacity-70`                                                                           | `source-control-panel.component.ts:93-95`                        | section header convention — reused verbatim for new section headers                                                          |
| `--rounded-box` / `--rounded-btn` / `--rounded-badge`                                                                       | `tailwind.config.js:118-120`                                     | corner radii, unchanged                                                                                                      |
| `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]` | `source-control-file.component.ts:54-56`                         | the repo's one focus-ring recipe — reused verbatim on every new interactive element                                          |

Row/section spacing follows existing measures: `px-2 py-1` header bars, `px-2 py-0.5` file rows, `gap-1.5` icon/label pairs, `gap-1` compact clusters — all lifted from `source-control-panel.component.ts` / `source-control-file.component.ts`.

---

## 1. Change-set card (transcript)

### 1.1 Where it mounts

New organism `ChangeSetCardComponent`, rendered inside
`ChatTranscriptComponent`'s `@for` (`chat-transcript.component.ts:359-374`,
`allMessages`) as a sibling of `<ptah-message-bubble>` for any finalized
assistant message whose turn touched ≥1 file. Source of the touched-path set is
`extractMessageSummary` (`message-summary.utils.ts:91-113`) — today it only
returns a `filesChanged` **count**; the card needs the actual per-file stat
list, so `walkNode` must also collect `{path, additions, deletions}` per tool
call (Edit/Write/MultiEdit inputs already carry the path;
counts come from `session:rewindFiles`'s per-message `insertions`/`deletions`
map, keyed by the same `userMessageId` the message's user turn carries —
`session-rpc.handlers.ts:1109-1115`).

### 1.2 Header (always visible)

```
┌───────────────────────────────────────────────────────────┐
│ 🗂  4 files changed   +128  -42        [Open in ▾] [⋯]     │
└───────────────────────────────────────────────────────────┘
```

- Container: `rounded-[--rounded-box] border border-base-content/10 bg-base-200 mt-1.5` — mirrors `diff-display.component.ts:50` (`bg-base-300/50 rounded`) but one step up in surface (card, not inline diff) so it reads as a distinct block in the transcript, not a tool-output fragment.
- Icon: `lucide` `Files` (or `GitCommit`), `w-3.5 h-3.5 text-base-content-muted`.
- Label: `text-xs font-medium text-base-content` — "N files changed".
- Stat pills: `+128` in `text-success text-xs font-mono`, `-42` in `text-error text-xs font-mono` — exact oklch pairing already defined in `diff-display.component.ts:74-92` (`.token.inserted` / `.token.deleted`), applied here as plain text rather than Prism tokens since this is a real stat, not a diff line.
- Right cluster: the **Open in** split button (§4) sized `btn-xs`, plus a `⋯` overflow (`MoreVertical`, matches `task-card.component.ts:206`) opening: **Revert all files in this turn** (destructive, confirms via the same daisyui `<dialog>` pattern `diff-view.component.ts` uses for its revert confirm), **Open change set in git dock**.
- Header row height: `h-7`, `px-2`, matching `source-control-panel.component.ts:92-95` header bar metrics.

### 1.3 Per-file rows (collapsed by default)

```
┌───────────────────────────────────────────────────────────┐
│ ▸ 📝 apps/ptah-electron/src/main.ts        +12 -3  [↗][⟲] │
│ ▸ ✚ libs/…/git-dock.component.ts          +64 -0  [↗][⟲] │
│ ▾ 📝 libs/…/task-card.component.ts         +8  -2  [↗][⟲] │
│    ┌─────────────────────────────────────────────────┐    │
│    │  (inline CodeMirror diff, unified mode, 1 hunk)  │    │
│    └─────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

- Row: `flex items-center gap-1.5 px-2 py-0.5 text-xs hover:bg-base-content/10` — identical recipe to `source-control-file.component.ts:46-50`.
- Disclosure chevron: `ChevronRight` / `ChevronDown`, `w-3 h-3`, same as `source-control-panel.component.ts:108-111`. Row is a `<button>` (not the whole row a button — the open-diff button and the two trailing icon actions are **siblings**, exactly the D1 fix already applied in `source-control-file.component.ts:40-45`; do not regress that pattern here).
- Status icon + color: reuse `statusIcon()` / `statusColor()` mapping 1:1 from `source-control-file.component.ts:193-225` (M→`FileEdit`/warning, A→`FilePlus`/success, D→`FileMinus`/error, ??→`FileQuestion`/info).
- Stat pair: `+12` / `-3`, `text-[10px] font-mono`, success/error colors, right-aligned before the action icons — narrower than the header's stats (`text-[10px]` vs `text-xs`) since this is a repeated list, matching the size step already used between `source-control-panel.component.ts` section counts and `source-control-file.component.ts` status badge (`text-[10px]`).
- Actions (opacity-0 → opacity-100 on row hover/focus-within, same as `source-control-file.component.ts:83-84`):
  - `↗` **Open in external editor** at that file/line — `ExternalLink` icon, calls the shared Open-in launcher (§4) pre-scoped to one file.
  - `⟲` **Revert this file** — `Undo2` icon, calls `session:rewindFiles` scoped to the file (or `git:discard` if the file is already committed past the turn — the exact source RPC is an open question, §handoff Q1).
- Expanding a row mounts the CodeMirror diff **inline**, unified mode only (side-by-side is the git dock's job — inline keeps the transcript narrow-width safe), height-capped `max-h-64 overflow-y-auto` (same cap as `diff-display.component.ts:50`).

### 1.4 Compact "many files" state

Trigger: turn touched more than 6 files (six chosen to match `task-card.component.ts`'s `MAX_VISIBLE_LABELS`-style capping philosophy — enough to scan, never enough to dominate the transcript).

```
┌───────────────────────────────────────────────────────────┐
│ 🗂  23 files changed   +892  -410       [Open in ▾] [⋯]    │
│ ─────────────────────────────────────────────────────────  │
│  apps/ptah-electron/…            +12 -3                    │
│  libs/…/git-dock.component.ts    +64 -0                    │
│  libs/…/diff-view.component.ts   +140 -88                  │
│  libs/…/task-card.component.ts   +8  -2                    │
│  libs/…/source-control-file…     +6  -1                    │
│                     + 18 more files — Open in git dock →    │
└───────────────────────────────────────────────────────────┘
```

- Shows the top 5 by (additions+deletions) descending — largest changes first, since that is what a reviewer scans for.
- No disclosure chevrons in this mode — rows are **not** expandable inline (that would make an already-large card enormous). Clicking any row or the "+N more" footer routes to the git dock, pre-filtered to this turn's change set (`base=<turn-start-sha>`, `head='worktree'` once `git:changedFiles` ships — see context.md scope A).
- Footer row: `text-[10px] text-base-content-muted text-center py-1 hover:text-primary cursor-pointer`, plain text arrow `→`, no icon — deliberately quieter than the header actions so it reads as "more of the same list", not a new primary action.

### 1.5 States

- **Loading** (turn still streaming, files known but diffs not yet fetchable): header renders with a `loading loading-spinner loading-xs` in place of the stat pills; rows render with status icon + name only, no stats, no actions.
- **Empty** (turn touched files but `git:diffFile` reports the file no longer differs from base — e.g. reverted mid-turn): card does not render at all. A card with zero real diffs is worse than no card.
- **Error** (`git:diffFile` failed for one row): that row's diff area renders the sanitized error message from `git-read-error-messages.ts` (`research-report.md:50`) in `text-error text-[10px]`, with a retry icon wired to the existing `retryRequested` output `diff-view.component.ts:730`.

### 1.6 Keyboard / a11y

- Card is `role="group"` with `aria-label="N files changed, +A -D"`.
- File-row list is `role="list"` / row `role="listitem"`, mirroring the a11y contract already proven in `source-control-panel.component.ts:130,149` (including the load-bearing `role="listitem"` on the empty-state div — same rule applies to the "+N more" footer row here: it is a sibling `listitem`, not an orphan `div`).
- Every icon-only action has `aria-label` + `title`, per `source-control-file.component.ts:95,109,124`.
- Disclosure chevron carries `aria-expanded` / `aria-controls`, per `source-control-panel.component.ts:103-104`.
- Tab order: header actions → each visible row's open-diff button → each row's trailing actions. No roving tabindex needed (transcript cards are not a 100+ item grid like the task board) — plain DOM order is suf2ficient here.

---

## 2. Git dock (replaces the editor slot)

### 2.1 Mount point

Same slot as today's lazy `EditorPanelComponent` in
`electron-shell.component.ts:252-274` — same resize handle, same
`layout.editorPanelWidth()` / `editorPanelVisible()` signals, same
`min-w-[300px]` floor, same lazy `import()` swap (now importing the new
`git-ui` lib's `GitDockComponent` instead of `@ptah-extension/editor`'s
`EditorPanelComponent`). The vertical tab at `electron-shell.component.ts:277-282`
is relabeled **"Git"** (was "Editor").

### 2.2 Header

```
Wide (≥560px)                          Narrow (300–559px)
┌──────────────────────────────────┐   ┌──────────────────────┐
│ ⎇ feature/386-git-dock  ↑2 ↓0     │   │ ⎇ feature/386-… ↑2↓0 │
│ worktree: task-386          [Open▾]│   │ [Open▾]              │
├──────────────────────────────────┤   ├──────────────────────┤
│ Task ▸  Main change set           │   │ Task ▸ Main          │
└──────────────────────────────────┘   └──────────────────────┘
```

- Row 1: `flex items-center h-7 px-2 gap-1.5 bg-base-200 border-b border-base-content/10` — same recipe as the global navbar row (`electron-shell.component.ts:89-90`) one level down in the hierarchy.
  - Branch icon `GitBranch` `w-3.5 h-3.5 text-base-content-muted`.
  - Branch name `text-xs font-mono text-base-content truncate`.
  - Ahead/behind: `↑{ahead} ↓{behind}` in `text-[10px] font-mono text-base-content-muted`, from `GitBranchInfo.ahead/behind` (`rpc-git.types.ts:29-32`) — already on the wire, no new RPC.
  - Below 560px the ahead/behind pair moves to its own line under the branch name (still same row's flex-wrap, not a second bar) to keep the branch name from truncating too aggressively.
- Row 2: worktree name, `text-[10px] text-base-content-muted truncate`, prefixed `worktree:` — sourced from the task's bound worktree (§3) or `(none — main working tree)` when unbound.
- Row 3: a `tabs tabs-boxed tabs-xs` two-tab switch — **Task** (this task's branch vs `main`, the default) / **Working tree** (index vs worktree, today's source-control view) — daisyUI `tabs` component already used at `electron-shell.component.ts:113` (`tabs-lifted` variant there; `tabs-boxed` here signals a sub-navigation one level down, matching daisyUI's own size convention for nested tab bars).
- Open-in split button (§4) sits top-right of row 1, `btn-xs`.

### 2.3 Body — Working tree tab (today's `SourceControlPanelComponent`, unchanged)

Reused verbatim: commit composer (`source-control-panel.component.ts:53-75`), Staged/Changes disclosure sections with stage-all/unstage-all (`:77-224`), file rows with stage/unstage/discard (`source-control-file.component.ts`), worktree section below (`:227`, `WorktreeSectionComponent`). No visual changes — the git dock is a **new host**, not a redesign of this panel.

### 2.4 Body — Task tab (new)

```
┌──────────────────────────────────────────────────┐
│  BRANCH vs MAIN (7)                    [Stage all]│
│  ▸ ✚ apps/…/electron-shell.component.ts   +18 -4  │
│  ▸ 📝 libs/…/git-dock.component.ts        +240 -0 │
│  …                                                 │
├──────────────────────────────────────────────────┤
│  ┌ Commit message ─────────────────────────────┐  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
│  [        Commit (7)        ]                     │
│  [ Merge into main ]   [ Create pull request ]     │
└──────────────────────────────────────────────────┘
```

- File list: identical row recipe to §2.3 (same component, `SourceControlFileComponent`, reused with `comparison: 'branch-vs-main'` — a third `GitDiffComparison` variant the backend RPC must add alongside `'staged'`/`'worktree'`, per context.md scope A).
- "Stage all" here means _stage the whole branch diff into the index for commit on top of it_ — same `stageAll()` call as §2.3, scoped to this diff's file set.
- Commit composer: same component instance as §2.3 — one commit box, not two. Switching tabs does not create a second commit affordance; only the file list above it changes.
- **Merge into main**: `btn btn-outline btn-sm w-full` (sized up from `btn-xs` — this is a consequential, infrequent action, matching daisyUI's own size-signals-frequency convention already implicit in the codebase: frequent row actions are `btn-xs`, the card-level Start action is also `btn-xs` today but is the ONE action on its row — merge/PR share a row and need the visual weight of `btn-sm` to read as deliberate, not a stray extra file-row button). Confirms via a `<dialog>` (same pattern as diff-view's revert confirm) before running.
- **Create pull request**: `btn btn-primary btn-sm w-full` alongside Merge, in a `flex gap-1` pair. Disabled (`btn-disabled`, `title="gh CLI not found"`) when `gh` is absent per context.md scope C — never hidden, so the user learns why rather than wondering where it went.

### 2.5 Spot editor mode

Triggered by clicking a file row's name (not its stage/diff icon) or a transcript file-path link (`file-path-link.component.ts:91`, rewired per research-report.md §Phase 3a). Replaces the dock body with:

```
┌──────────────────────────────────────────────────┐
│ ← Back    apps/…/git-dock.component.ts    [Save] │
├──────────────────────────────────────────────────┤
│  1  import { Component } from '@angular/core';    │
│  2                                                 │
│  3  @Component({                                   │
│  …  (CodeMirror 6, single file, no tabs, no split)│
└──────────────────────────────────────────────────┘
```

- Header: `←` back arrow (`ChevronLeft`, returns to whichever tab was open), filename `text-xs font-mono truncate flex-1`, `[Save]` `btn btn-primary btn-xs` (disabled until dirty).
- Body: CodeMirror 6 basic setup, line numbers on, no minimap, no split, no tab strip — explicitly NOT a second editor surface, just the one spot-edit affordance context.md scope B calls for. Font: `font-mono` (`tailwind.config.js:35`, `JetBrains Mono`/`Fira Code`).
- Unsaved-changes guard: leaving via `←` with dirty content shows the same `<dialog>` confirm pattern as merge/revert.

### 2.6 States

- **Empty** (no changes, no worktree bound): `flex flex-col items-center justify-center h-full gap-2 text-base-content-muted text-xs`, icon `GitBranch` `w-8 h-8 opacity-40`, text "No changes in this workspace."
- **Loading** (first status fetch): `loading loading-spinner loading-md` centered, matching `electron-shell.component.ts:270` (today's editor-panel loading state) — same visual language carried forward.
- **Non-git workspace**: same empty-state layout, icon swapped to `AlertTriangle text-warning`, text "This workspace is not a git repository." — no Task tab, no commit composer, no Open-in disabled (Open-in still works, it does not require git).
- **Error** (status fetch failed): icon `CircleX text-error`, text from the sanitized git error table, `[Retry]` `btn btn-ghost btn-xs` underneath.

---

## 3. Task card additions (tasks-ui)

Extends the existing meta row and adds a new actions row to
`task-card.component.ts`. No existing row is removed or restructured —
additive only, per the file's own "replace, do not accumulate" posture inverted
for read-only additions (nothing here is a duplicate of an existing control).

### 3.1 Worktree/branch chip (meta row, alongside existing badges)

```
[FEATURE] [M] [👤 codex] [⎇ task-386 ↑2] [🔗 3] [1/3]
```

- New chip after the existing `depends_on` chip (`task-card.component.ts:303-311`), same recipe: `badge badge-xs badge-ghost gap-0.5`, icon `GitBranch w-2.5 h-2.5`.
- Content: `{branch} ↑{ahead}` (behind omitted at this size — ahead is the number a task owner cares about: "how much have I built"). `title` carries the full sentence: `"Worktree {worktree}, branch {branch}, {ahead} ahead / {behind} behind main"`.
- Absent entirely when the task has no worktree binding — same absent-not-placeholder rule the file already documents for `parentCrumb` (`task-card.component.ts:497-505`) and the guideline in `tasks-ui/CLAUDE.md` ("an absent field is absent, never an em dash placeholder").

### 3.2 Change count chip

```
[⎇ task-386 ↑2]  [+128 -42]
```

- Immediately follows the worktree chip. `badge badge-xs badge-ghost gap-0.5`, content `+128` `text-success`, `-42` `text-error` inline (same stat-pill treatment as §1.2). `title="128 insertions, 42 deletions across N files"`.
- Absent when the worktree exists but has zero diff against main (a fresh worktree) — not a `+0 -0` chip, which would be noise on every idle task.

### 3.3 Actions

Added to the existing startable-footer (`task-card.component.ts:403-441`) as a
second row **below** the Isolate/Start row, and to the non-startable footer
(`:442-452`) as the only row, so a `done`/`in_review` task still exposes Merge/PR
without exposing Start:

```
Startable task:                       Non-startable task:
┌───────────────────────────────┐    ┌───────────────────────────────┐
│ Isolate ○           [▶ Start] │    │ ✓ Done                        │
│ [+ Worktree] [Open change set]│    │ [Open change set] [⇄ Merge]   │
└───────────────────────────────┘    │              [Create PR]      │
                                       └───────────────────────────────┘
```

- `[+ Worktree]` — **Create worktree**, `btn btn-ghost btn-xs gap-1`, icon `GitBranchPlus`. Present only when the task has no binding yet. Calls the existing `git:worktree` CRUD RPC + writes `worktree`/`branch` into the task carrier frontmatter (context.md scope C).
- `[Open change set]` — `btn btn-ghost btn-xs gap-1`, icon `Eye`/`GitCompare`. Present only when a binding exists. Opens the git dock's Task tab (§2.4) scoped to this task's worktree.
- `[⇄ Merge]` / `[Create PR]` — `btn btn-ghost btn-xs gap-1` each, same icon/sizing family as Open change set (all three are peers on this row, unlike Merge/PR's `btn-sm` weight inside the dock itself — a task card is already a dense 16rem surface per `tasks-ui/CLAUDE.md`'s own column-width constraint, so these stay at the row's shared `btn-xs`). Disabled with `title` reasons when: no binding (Merge/PR), or `gh` absent (PR only).
- All four actions `stopPropagation()` before their handler, same discipline as every existing action on this card (`task-card.component.ts:204,219,335` etc.) — none may open the detail panel or toggle selection.

### 3.4 States

- **No binding**: only `[+ Worktree]` shows; no chips in §3.1/3.2.
- **Binding, clean**: worktree chip shows, no change-count chip, `[Open change set]` present, Merge/PR disabled with `title="No changes to merge"`.
- **Binding, dirty**: both chips show, all three actions enabled (PR still gated on `gh`).
- **Merge/PR in flight**: reuse the card's existing `pending()` spinner treatment (`task-card.component.ts:149-156`) — the whole card, not just the action row, since a merge is a task-level write exactly like a bulk status change.

---

## 4. "Open in" split button (shared component)

One component, `OpenInButtonComponent`, consumed by the change-set card header
(§1.2), each change-set file row (§1.3, icon-only variant), the git dock header
(§2.2), and — out of this task's file-level scope but noted for consistency —
any future workspace-header mount.

### 4.1 Anatomy

```
Remembered choice (VS Code last used):
┌─────────────────────┬───┐
│  Open in VS Code     │ ▾ │
└─────────────────────┴───┘

Many detected, none remembered:
┌─────────────────────┬───┐
│  Open in…            │ ▾ │
└─────────────────────┴───┘
                      ┌──────────────┐
                      │ VS Code       │
                      │ Cursor        │
                      │ Zed           │
                      └──────────────┘
```

- `join join-horizontal` (daisyUI `join` utility, no custom CSS) with two elements: primary button (`btn btn-ghost btn-xs join-item gap-1`, icon `ExternalLink`) + a caret-only button (`btn btn-ghost btn-xs join-item px-1`, icon `ChevronDown`) opening a `dropdown dropdown-end` menu (`menu menu-xs`, same recipe as `task-card.component.ts:208-225`'s status dropdown).
- Icon-only variant (per-file row, §1.3): drop the text label, keep `aria-label="Open in {target}"`, primary button becomes `w-5 h-5 p-0` to match the row's other icon actions (`source-control-file.component.ts:90,102,117`).

### 4.2 Detection states

| State                     | Primary button                                                                  | Caret                    | Behavior                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **None detected**         | `Open in…`, `btn-disabled`, `title="No supported editor found on this machine"` | absent (nothing to list) | Whole control renders but does nothing — never hidden, so a user who just installed Cursor and hasn't restarted sees an explanation, not a missing feature.                                                                       |
| **One detected**          | `Open in {Name}`                                                                | absent                   | Single click opens directly; no dropdown to open for a set of size 1.                                                                                                                                                             |
| **Many, none remembered** | `Open in…`                                                                      | present                  | Click on primary opens the dropdown (same target as the caret) rather than guessing; the first list click sets it as remembered for next time.                                                                                    |
| **Many, remembered**      | `Open in {Remembered}`                                                          | present                  | Click on primary opens directly in the remembered target. Caret still opens the full list to switch. The list highlights the remembered entry (`menu-active` class, same as `task-card.component.ts:218`'s active status option). |

- Detected list order: PATH-lookup order per `detect()` (context.md scope D) — not alphabetical, not "remembered first" (remembered stays a highlight, not a reorder, so the list position a user learned does not move under them).
- Persistence: last choice keyed globally in settings (not per-file, not per-task) — matches context.md scope D ("Remembers the last choice in settings").

### 4.3 A11y

- Caret button: `aria-haspopup="menu"`, `aria-expanded`, `aria-label="More editors"`.
- Menu items: `role="menuitem"`, one per detected `EditorTarget`, icon (vendor logo where available, else `Code2` generic) + name.
- Disabled primary (none-detected state): `aria-disabled="true"` with the same `title`, not a silently inert button — screen readers must hear why nothing happens.

---

## 5. VS Code webview degradation

- **Change-set card (§1)**: renders identically — it depends only on the transcript, `session:rewindFiles`, and `git:diffFile`, all host-agnostic RPCs already served on both hosts.
- **Git dock (§2)**: the dock's _mount point_ (`electron-shell.component.ts`'s editor slot) does not exist in the VS Code webview — `AppShellComponent` is the whole surface there. The dock becomes a **panel view** reachable the same way `SourceControlPanelComponent` is reachable today in the VS Code host (research-report.md §2, "hosted by `sidebar.component.ts`") — same components, hosted in VS Code's native sidebar rather than the Electron dock chrome. No Task-tab-vs-Working-tree-tab bar is needed there if VS Code's own Source Control view already gives branch/ahead-behind chrome; confirm during implementation rather than duplicating VS Code's own git UI.
- **Spot editor (§2.5)**: degrades to VS Code's own `showTextDocument` (`IEditorLauncher.openFile` on the VS Code adapter, context.md scope D) rather than mounting CodeMirror — VS Code already has a superior native editor, so the spot editor is Electron-only.
- **Open in (§4)**: on VS Code, "Open in VS Code" is nonsensical (you're already there) — the VS Code adapter's target list excludes VS Code itself and offers only the other detected editors (Cursor/Zed/Antigravity), per context.md scope D ("`platform-vscode` uses `vscode.window.showTextDocument` for VS Code itself, spawner for the others" — i.e. no "open in VS Code" entry appears when already inside VS Code).
- **Task card additions (§3)**: identical on both hosts — `tasks-ui` has no host branching today and none is introduced.

---

## 6. Cross-surface consistency checks

- Stat-pill colors (`+`/`-` success/error) are the **same three places**: change-set card header (§1.2), change-set file rows (§1.3), task card change chip (§3.2), git dock Task-tab file rows (§2.4 via `SourceControlFileComponent`). One visual language for "how much changed," never a fourth variant.
- Disclosure chevron behavior (▸/▾, `aria-expanded`) is identical between the change-set card (§1.3) and the existing Staged/Changes sections (`source-control-panel.component.ts`) — a user who learns one already knows the other.
- The Open-in split button (§4) is the ONE component in all four mount points — no per-surface reimplementation, no "simplified" inline version anywhere.
