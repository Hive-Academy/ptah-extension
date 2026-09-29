# Prototype — TASK_2026_576_e16a: Advanced Git Review UI

**Round 1 revision** (design-spec-review.md, reviewer: antigravity CLI, verdict REVISE):
fixed findings 1-8 — see the changelog in the round-1 response for the finding→fix
mapping. Summary: the conflict banner is rebuilt as a bordered card (finding 1, WCAG AA
in `anubis-light`); the review canvas's file-tree/diff split now reflows by its own
`ResizeObserver`-measured width instead of a viewport media query (finding 2); dialogs
trap focus, close on Escape and return focus to their trigger (finding 3); a stray
`text-base-content/70` token citation was removed (finding 4); diff addition/deletion
text and several other solid-fill badge/button pairs got per-theme corrected colors
verified with the CSS Color 4 OKLCH formula (findings 5, 6); the review canvas gained
line-number gutters, illustrative syntax tokens, word-level highlights, a sticky
per-file header and Pierre-slot-aligned hunk controls (finding 7, aligned to
research-report.md's confirmed `@pierre/diffs` choice); and the overview now shows the
dock at a realistic size inside a mock Electron window instead of a small centered card
(finding 8).

## How to Open

Open `index.html` directly in any web browser:

```bash
# Via browser or system launcher
file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype/index.html
```

Automated browser captures used a local static server because the browser tool accepts
only HTTP/HTTPS:

```bash
npx http-server D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/prototype -p 4599
# Open http://localhost:4599/index.html (localhost access was enabled for this capture)
```

## Deviations

- **Local styling**: `assets/app.css`, generated from the project's own Tailwind 3 +
  daisyUI 4 configuration and theme values
  (`apps/ptah-extension-webview/tailwind.config.js`), copied into
  `assets/tailwind.prototype.config.js` with `content` pointed at this prototype's own
  HTML (`**/*.html`) instead of the webview's source tree, per PROTOTYPING.md. Generated
  with:
  ```bash
  npx tailwindcss -c assets/tailwind.prototype.config.js -i assets/input.css -o assets/app.css --minify
  ```
  Both daisyUI themes (`anubis` dark, `anubis-light` light) are the exact color/radius
  values from the real config — not approximations. Regenerate after any class change
  in the HTML files.
- **CDN fallback**: none. All styling is the locally generated `assets/app.css`; no
  network dependency at view time.
- **Icons**: the real app uses `lucide-angular` SVG icons (`h-3 w-3` / `w-2.5 h-2.5`).
  This static prototype substitutes Unicode glyphs/emoji (⎇ ⚠ ✎ ↗ ⟳ etc.) in their
  place, since `lucide-angular` is an Angular component library, not a CDN-loadable
  static asset. Icon _placement, sizing intent and semantics_ match the spec; the exact
  glyphs are a frontend-implementation detail (`lucide-angular` icon names are named
  inline as component references in `design-spec.md` where relevant, e.g. `FileDiff`).
- **Diff renderer**: the review canvas shows static diff markup (line-number gutter
  `<div>`s, hand-applied `.tok-kw`/`.tok-str`/`.tok-fn` token classes, `.word-add`/
  `.word-del` spans), not a live `@pierre/diffs` instance — `@pierre/diffs` is the
  **confirmed** renderer (`research-report.md`, ~189 KB gz for a realistic first diff in
  the real Nx build), but wiring its actual `CodeView`/Shiki output is implementation
  work, not a design-spec artifact. The illustrative markup demonstrates the _density,
  hierarchy and hunk-control placement_ the real Shiki-highlighted output must match. The
  hunk toolbar sits in-flow directly above its hunk's lines (not `position: absolute`),
  modeling Pierre's own per-hunk light-DOM slot projection
  (`getHunkSeparatorSlotName`/`getAnnotationSlotName`, per `research-report.md` and
  `design-spec.md` §0) rather than a coordinate-tracking overlay.
- **Color-contrast overrides**: `.err-solid-text`, `.ok-solid-text`, `.diff-add-text`,
  `.diff-del-text` (`assets/input.css`) are per-theme text-color substitutes for four
  stock daisyUI same-hue `*-content`-on-`*` pairings that measure below WCAG AA at the
  sizes this spec uses them at (verified with the CSS Color 4 OKLCH→sRGB formula —
  see `design-spec.md` §0 "Verified overrides" for every measured ratio). They are not
  new design-system colors; they are the same measure-and-gate method the project
  already used to produce `--bcm`, applied to three more pairings found broken this
  round. A fifth known-broken class of pairing (the "A"/"M"/"R" single-letter status
  badges' `success-content`/`info-content`/`secondary-content` on their solid fills) was
  found but intentionally **not** fixed this round — see `design-spec.md` §13a "Known
  token-pair follow-up" for the ratios and why.
- **Responsive layout**: `data-responsive-grid` (`assets/app.js`, `initResponsiveGrids`)
  drives the file-tree/diff and mini-summary grids with a `ResizeObserver` on the
  element's own rendered width, not a CSS viewport media query — round 1 finding 2 found
  that a `min-[521px]:` breakpoint stayed "wide" even when the dock was docked narrow
  inside a wide browser window. The real Angular implementation should bind to the same
  width source `rail-resize-handle.component.ts` already tracks
  (`ElectronLayoutService`) or a `ResizeObserver` directive on the dock's own host
  element — not a global media query (`design-spec.md` §6.1a).
- **Data**: all file names, hashes, PR numbers and commit messages are illustrative
  placeholders, not read from a real repository (zero backend, per PROTOTYPING.md).

## Screens & States

8 HTML files: one overview + one per surface named in the brief.

| File                    | Requirement(s)                                                                | States demonstrated                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`            | IA (§3 of design-spec.md): the four-tab review shell, header, conflict banner | Changes/Commit/Task/History tab switch; conflict banner on/off; embedded-width and narrow reflow                                                                                                                                                                        |
| `change-set-card.html`  | Req 4 (transcript card), Req 5 (VS Code native path)                          | Populated; counts unavailable (4.4); reconciled file (4.3); VS Code variant with Conflicted row and Open Source Control                                                                                                                                                 |
| `review-canvas.html`    | Req 6 (review canvas)                                                         | Populated (staged/unstaged tree, hunk toolbar, stale/refused hunk with `animate-glow-urgent`, binary/LFS/conflicted/too-large rows, draft-comment bar); loading (off-screen skeleton placeholders, Req 6.2); error (diff read failure + Retry); reject-hunk alertdialog |
| `spot-editor.html`      | Req 7 (spot editor)                                                           | Editing; read-only (chat-link default); disk-conflict alertdialog (Reload/Overwrite); blocked-path alert                                                                                                                                                                |
| `commit-composer.html`  | Req 9 (commit composer)                                                       | Ready to commit; nothing staged (disabled Commit); committing (streamed hook log); hook failure (message kept, Req 9.4); success (hash + subject, field cleared)                                                                                                        |
| `task-worktree.html`    | Req 10 (task/worktree view)                                                   | PR/CI available; no worktrees besides main; loading; `gh` unavailable (quiet degraded line, Req 10.4)                                                                                                                                                                   |
| `conflict-banner.html`  | Req 11 (conflict banner)                                                      | Unresolved rebase conflict; all-resolved (Continue appears); delete/modify conflict (no merge tool, Req 11.6); cherry-pick single file; abort alertdialog                                                                                                               |
| `history-timeline.html` | Req 12 (history timeline + stash)                                             | Commits + stashes populated; no commits of its own (Req 12.3)                                                                                                                                                                                                           |

- **Themes demonstrated**: Dark (`anubis`, default), Light (`anubis-light`) — both are
  the project's real compiled daisyUI themes, toggled with the `data-theme` attribute.
- **Viewports demonstrated**: Narrow (~400px actual browser viewport), Wide (1440px
  desktop), Embedded/sidebar width (container toggle, ~400px max-width, separate from
  the narrow-viewport check). `review-canvas.html` and `index.html` demonstrate the
  round-1 fix at all three: `screenshots/dark-review-canvas-sidebar.png` and
  `light-review-canvas-sidebar.png` are the direct before/after evidence for finding 2
  (compare against the round-0 screenshot of the same name, which showed the Reject
  button clipped off-screen).

## Interactive Features

- Theme switcher (`Toggle theme`) on every page, dark ⇄ light.
- Embedded-width toggle (`Toggle embedded width`) on every page, wide ⇄ ~400px sidebar
  container.
- State dropdown on most pages (populated / empty / loading / error / feature-specific
  states named in the table above).
- Tab switching on `index.html` (Changes/Commit/Task/History), with roving
  `aria-selected` and panel visibility.
- Conflict-banner demo toggle on `index.html`.
- Collapsible sections (changed-file tree groups, stash list) via chevron buttons.
- Popovers (branch details, stash list, comparison picker) open/close on trigger click
  and outside click.
- Draft-comment flow on `review-canvas.html`: "Comment on this line" adds a draft,
  updates the count, and "Send to agent" clears the batch (Req 6.7 draft-batch
  decision).
- Alertdialogs (reject hunk, disk conflict, abort operation, drop stash, remove
  worktree) open on their trigger and close on Cancel/confirm, **and** (round 1, finding 3) close on Escape, trap Tab/Shift+Tab focus inside while open, and return focus to
  the element that opened them — verified with a scripted check
  (`document.activeElement` before open → "Cancel" default focus → Escape → focus
  returns to the trigger).
- Container-driven reflow (round 1, finding 2): the review canvas's file-tree/diff split
  and the overview's mini-summary grid use a live `ResizeObserver` on their own element,
  so dragging/resizing the browser window is not required to see the narrow layout —
  toggling "Toggle embedded width" (which changes the container's CSS `max-width`) is
  enough to trigger the stacked layout, independent of the outer window size.

## Project rules applied

- `[project-rule]` Status is a badge/hint, never a button. Source:
  `ui-ux-designer/SKILL.md` Prototyping Rules; applied to every status badge (file
  status, PR state, locked/prunable, "counts unavailable", "No longer changes HEAD").
- `[project-rule]` One primary action per surface. Source: same, "One primary action per
  surface"; applied per surface (`Review`/`Review all` on the card, `Commit` in the
  composer, `Ask agent to resolve` while a conflict is open — see design-spec.md §11 for
  why it supersedes other primary actions during a conflict, `Send to agent` in the
  draft bar, `+ Add` demoted to outline since Task tab has no single primary action
  otherwise — task-worktree.html therefore carries no `btn-primary`, which is
  intentional: it is a status/detail view, not an action surface).
- `[project-rule]` Reuse project tokens and components (daisyUI `btn`/`badge`/`alert`,
  `role="tablist"`/`role="tab"` pattern from `NativeTabGroupComponent`, popover panel
  chrome from `NativePopoverComponent`, `alertdialog` focus-on-safe-choice pattern from
  `diff-view.component.ts`). Source: `design-spec.md` §2 token table, each row cited to
  its component/file.
- `[project-rule]` Never ban an existing component wholesale. Source: `PROTOTYPING.md`
  rule 2; no component is banned in this spec — badges, tooltips (via `title`) and
  primary buttons are used throughout.

## Lane-introduced constraints

None. No CLI lane authored any part of this design; all design decisions and their
rationale are in `design-spec.md`, authored directly by this role.

| Constraint | Tag | Rationale |
| ---------- | --- | --------- |
| —          | —   | none      |

## Parity Mapping

Cross-referenced against `../parity-inventory.md` (full detail in `design-spec.md` §13).
Every `keep`/`move` row has a named home; only the four Gate-1-approved
`remove-proposed` rows (multi-tab file views, `getOriginalContent` wrapper,
`refreshTags` wrapper, `MonacoLoaderService`/`monaco-theme.ts`) have no prototype
surface, as approved.

| Capability from parity-inventory.md                         | Prototype Location                                                      | Visual Treatment                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tab strip of open diffs (§1)                                | `review-canvas.html` changed-file tree + continuous diff                | Left tree list, right scrolling diff, no tabs                                               |
| Rail resize/collapse (§1)                                   | `index.html` header (☰ toggle), `review-canvas.html` tree column       | Icon button + resizable column (interaction noted, not pixel-drag-simulated in static HTML) |
| Branch button + popover (§2)                                | `index.html` header `⎇ feat/task-576-review-ui`                         | Popover panel with branch/upstream/last-commit/remote                                       |
| Stash button + popover (§2, §5)                             | `index.html` header stash icon; `history-timeline.html` Stashes section | Popover list; full section with Apply/Pop/Drop                                              |
| Fetch/Pull/Push (§2)                                        | `index.html` header right-aligned icons                                 | Icon buttons with ↑/↓ counts                                                                |
| Staged/Changes sections, stage/unstage/discard (§3)         | `review-canvas.html` changed-file tree                                  | Collapsible groups, per-row status badge + counts                                           |
| "Git status unavailable" (§3)                               | `change-set-card.html` counts-unavailable state; design-spec.md §4.1    | Badge + "?" counts, last-good list kept                                                     |
| Worktree section: list/add/remove/switch (§4)               | `task-worktree.html` Worktrees panel                                    | Row-as-switch, trailing remove icon (nested-button defect fixed)                            |
| Stash apply/pop/drop/diff (§5)                              | `history-timeline.html`                                                 | Inline buttons + drop confirmation dialog                                                   |
| Branch picker: search/recent/local/remote/create (§6)       | `index.html` branch popover (detail: `task-worktree.html` branch panel) | Popover + inline branch panel                                                               |
| Diff view, hunk toolbar, layout toggle, freshness chip (§7) | `review-canvas.html`                                                    | Split/Unified toggle, Hunk i-of-n, Accept/Reject, stale banner                              |
| Revert confirmation, stale-snapshot protection (§7)         | `review-canvas.html` reject-hunk alertdialog; stale-hunk banner         | Modal alertdialog focus-on-Cancel; `animate-glow-urgent` badge                              |
| File view / read-only Monaco (§8)                           | `spot-editor.html` read-only state                                      | "Read only" badge, Edit button to flip mode                                                 |
| Markdown preview toggle (§8)                                | `spot-editor.html`                                                      | Source/Preview `btn-group`                                                                  |
| Blocked state + Open-in (§8)                                | `spot-editor.html` blocked state                                        | `alert alert-warning` + Open-in                                                             |
| Branch review mode, totals, filter, viewed (§9)             | `review-canvas.html` comparison bar                                     | Comparison popover with base/head selects, filter input                                     |
| Open-in button + caret menu (§10)                           | Every file/workspace row across all pages                               | `Open-in ▾` buttons                                                                         |
| PR number/state/CI (new, Req 10)                            | `task-worktree.html`                                                    | PR panel with badge state, CI counts, Open PR                                               |
| Conflict banner triad + Continue (Req 11)                   | `conflict-banner.html`, `index.html`                                    | Ask agent / Open in editor / Abort, Continue when resolved                                  |
| History timeline (Req 12)                                   | `history-timeline.html`                                                 | Commit list, click opens read-only comparison (interaction described in design-spec.md §12) |
