# Code Logic Review (follow-ups) - TASK_2026_623_3492

Score 6/10, NEEDS_REVISION. 0 blocking, 1 serious, 4 moderate, 3 minor. Read-only static review; no checks were run.

## Serious

### S1. Pruning effect treats a workspace switch as tab closure
- chat-view.component.ts:1236-1244 diffs `_tabManager.tabs()`. `tabs` is only the ACTIVE workspace's list (tab-manager.service.ts:225, 393). `switchWorkspace` replaces it wholesale (tab-manager.service.ts:784). Every tab of the workspace you left is therefore "removed", and `dock.forgetTab` runs for tabs that still exist (they stay reachable through `findTabByIdAcrossWorkspaces`, chat-view.component.ts:302).
- Impact: open/pinned/width, surfaces, summaries and `seen` fences are lost. `seen` is the D12 guard against re-auto-opening, so on switching back the dock re-opens displays the user had dismissed and widths reset. Silent state loss on a likely path (multi-workspace).
- Fix: only forget an id when `findTabByIdAcrossWorkspaces(id) === null`, checked inside the effect, or diff against the union of all workspaces' ids.

## Moderate

### M1. Nested container named `dp` re-scopes the 360/700 px grid rules
- surface-layout.component.ts:64 makes each card/section/accordion body the nearest `dp` container. The `@container dp` rules in SURFACE_CONTAINER_GRID_STYLES (:47-57) for a `grid` inside a body now measure the body, not the renderer root, and the body is narrower by the card padding (p-4, px-3). A nested stat grid reaches the 3-column 700 px rule later or never, and the 360 px auto-fit starts later than the same grid at root level. The root `dp-grid--stats` still keys off the root only for root-level grids.
- The body adds a third threshold (16rem, :66) on top of 360/700.
- Fix: give the body its own container name (e.g. `dp-body`) with its own rules, or document the narrower scope as intended and test a nested grid in a card.

### M2. Inline-size containment can collapse a card in shrink-to-fit parents
- `container-type: inline-size` (surface-layout.component.ts:64) zeroes the body's intrinsic inline size. In a horizontal stack (`flex flex-row flex-wrap`, :275) or any auto-width parent, a card whose content is only children sizes to its padding plus title and not to its children. A card with no title can be about 32px wide.
- Grid tracks (`minmax(0,1fr)`) and `flex-col` stretch are fine. A collapsed accordion (0fr, inert) is safe, since only height collapses.
- Fix: give the card a `min-width` or `flex: 1 1 16rem`, or avoid containment on the body.

### M3. Collapsible body layout semantics are fixed in container mode
- The body previously used `containerClass()` (still used by viewport mode, :185). Container mode now uses a hard-coded 0.75rem gap (:64). For `section`/`accordion` nodes `containerClass()` resolved to `flex flex-col gap-3` (gap/columns apply only to stack/grid, :272-278), so there is no visible regression today. Any future `gap`/`columns` on those kinds would be silently ignored in container mode. Viewport mode is unchanged (the `@else` branches at :183, :210 keep the old markup).

### M4. `forgetTab` cannot stop late writers
- display-dock.state.ts:136-140 removes the entry, but the display sync can still publish or `markSeen` for a closing/streaming tab afterwards, and the first write re-creates the entry, so the leak persists for that tab and a stale tab id can re-auto-open a surface. The prune effect runs after the tab is removed, with no ordering against in-flight publishes.
- Fix: have the sync skip unknown tabs, or tombstone the id.

## Minor

### m1. Pruning effect details (checked, mostly fine)
- VIEW_PANEL_KEY ('') is never a tab id (chat-view.component.ts:195, 442) so it is never in `openTabIds` or pruned; correct.
- Canvas tiles each provide their own store but diff the same global `tabs()`, so a tile forgets only tabs closed in that tab list; ids it never held are no-ops (`tabs.delete` guard at display-dock.state.ts:139 avoids a needless write). Aside from S1 this is right.
- First run: `openTabIds` starts empty, so the first run only records a baseline. Reused tab ids start fresh, which is desirable.
- `untracked` around `forgetTab` (chat-view.component.ts:1241) keeps the dock's map signal from becoming a dependency. Writing a signal inside an effect needs `allowSignalWrites` on Angular below 19; I did not confirm the version.

### m2. code-output label uses a process-global counter
- code-output.component.ts:27, 201-205: `"<tool> output <N>"` where N is a module-level counter that never resets, counts every instance, and changes when a component is re-created (virtual scroll, tab switches). Labels are unique but the number is arbitrary to a screen-reader user ("Bash output 37"). Prefer an index within the message/turn, or a short command/path hint.

### m3. Inline-code stripping and plural/singular
- message-summary.utils.ts:67: the regex strips single-backtick pairs. `[^`]+` crosses newlines, so stray backticks on different lines fuse and strip the text between them (preview only). The lookbehind is unsupported before Safari 16.4; Electron and the VS Code webview are Chromium, so no issue. It runs after fence removal.
- message-bubble.component.html:65-70: singular/plural ternaries are correct for 1; 0 is hidden by the `> 0` guards.

### m4. turn-summary-chip region label
- turn-summary-chip.component.ts:179, 341-343: `aria-label="<ariaLabel> details"` replaces `aria-labelledby` on the toggle. This avoids duplicating the summary landmark's name and is acceptable. The incomplete case reads "... (incomplete) details", which is awkward but harmless. The region is `inert` while collapsed.

## Avatar at 8rem
- surface-layout.component.ts:64-67, 143: avatars are compact tracks (about 128 px, two per row above about 17rem). The name/subtitle may wrap or truncate beside the initials disc (dashboard-avatar.component.ts:86-98); I could not confirm without rendering. Visual reviewer should check.

## Five logic questions
1. Silent failure: S1 (dock state dropped with no signal), M4.
2. Unexpected user action: switching workspace and back (S1).
3. Wrong output from data: stray backticks fusing lines in the preview (m3).
4. Dependency failure: late sync publishes after forgetTab (M4).
5. Missing: no spec for a workspace switch; chat-view.dock.spec only covers removal within one tab list.

## Verdict
NEEDS_REVISION, confidence MEDIUM (no rendering, nothing executed). Layout and a11y changes are mostly sound. The pruning effect has a real state-loss defect (S1), and the nested `dp` container changes nested-grid breakpoint behaviour (M1).
