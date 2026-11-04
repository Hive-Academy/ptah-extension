# Tasks UI — Phase 1 visual specification

## Design principles

Tasks is an index of real `.ptah/specs/TASK_*/` folders. Use chat and Settings surface, button, text and focus grammar. Keep machine-owned `task.md` carrier metadata apart from authored `context.md` and workflow prose. Status and file presence are labels, never disguised actions. `New Task` is the board primary action; `Open in editor` is the reader primary action. Electron width and theme changes must retain every capability.

## Token map

| Element | Exact production class or variable | Definition |
| --- | --- | --- |
| Canvas | `bg-surface-0 text-base-content font-sans` | `apps/ptah-extension-webview/tailwind.config.js:37,44`; `src/styles.css:159` |
| Header, toolbar, panels | `bg-surface-1 border-surface-border` | `tailwind.config.js:38,41`; `styles.css:160,163`; chat `app-shell.component.html:117` |
| Cards, menu, reader | `bg-surface-2 border border-surface-border rounded-box` | `tailwind.config.js:39,41,146,220`; `styles.css:161,163` |
| Hover/selected row | `hover:bg-surface-3` / `bg-surface-3` | `tailwind.config.js:40`; `styles.css:162` |
| Heading/body/secondary | `text-base-content` / `text-base-content-muted` | `tailwind.config.js:31,112,117,190,195` |
| Primary/secondary actions | `btn btn-primary btn-sm` / `btn btn-ghost btn-sm` | primary colors: `tailwind.config.js:89-91,161-167`; ghost action: `cli-matrix-styles.ts:16` |
| Focus | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content` | `cli-matrix-styles.ts:11-16` |
| Status | `text-state-idle/run/need/err/done` plus text label | `tailwind.config.js:32-36,118-122,196-200` |
| Link | `color:var(--ptah-link); text-decoration:underline` | color: `styles.css:137-146`; underline: this specification |
| Elevation | `shadow-[var(--elev-shadow)]`; menu `shadow-[var(--elev-shadow-raised)]` | `styles.css:166-173` |
| Radius | `rounded-box`, `rounded-btn`, `rounded-badge` | `tailwind.config.js:146-148,220-222` |
| Type/space | `font-sans font-mono`; reader `prose prose-sm dark:prose-invert max-w-none`; metadata `text-sm`; `p-4 px-4 py-3 gap-3 gap-4` | `tailwind.config.js:43-46`; `markdown-block.component.ts:53-58`; Tailwind scale |

Use semantic theme variables in production for every installed theme. The static prototype copies only the real anubis and anubis-light values. Do not use faded `base-content` opacity for secondary text: `--bcm` is measured per theme (`tailwind.config.js:14-31`).

## Layout

**Board at 1280px:** title/action header, wrapping filter and saved-view row, five populated/status lanes at 220px with 12px gutters plus a 58px terminal Cancelled rail with its count. All six status names/counts fit within the 1280px board content padding; the terminal rail expands to a normal lane if it gains tasks. Selection bar docks at the content bottom only when active. At widths below 1100px lanes return to 242px and scroll within the board. This is a responsive presentation choice, not removal of a status.

**Board at 760px:** header actions and filters wrap. Lanes stay 242px with a visible horizontal scrollbar; list mode gives a compact stacked-row alternative. No horizontal page scroll.

**Detail at 1280px:** breadcrumb/path header, then 248px file rail, flexible markdown reader (`minmax(0,1fr)`), 268px metadata/activity rail, 16px gutters. Phase 2 placeholder is below Activity.

**Detail at 760px:** header wraps. File section, full-width reader, Metadata/Relations, Activity, then run placeholder stack vertically. The file section is a 290px maximum-height internal scroller so the reader begins near the fold; its entries remain reachable by mouse and keyboard. Code and tables scroll inside their blocks.

## Component specs

| Component | Structure and states | Exact tokens |
| --- | --- | --- |
| Header | Tasks heading and counts; board/list `aria-pressed` switch; Commands, maintenance menu, New Task. | `bg-surface-1 border-b border-surface-border px-4 py-3`, title `text-xl font-semibold`, switch/Commands `btn btn-ghost btn-sm`, New `btn btn-primary btn-sm` |
| Filter bar | Saved views, search, status/type/label/estimate facets, label any/all, chips, sort. Stays visible in filtered-empty. All controls use the same 32px compact height. | `bg-surface-1 border-b border-surface-border p-3`, `input input-bordered input-sm text-sm`, `select select-bordered select-sm text-sm`, `btn btn-ghost btn-sm`, `badge badge-ghost` |
| Saved views menu | Apply, create, update, rename, reorder, delete, skipped notice; confirmation where needed. | `bg-surface-2 border border-surface-border rounded-box shadow-[var(--elev-shadow-raised)]`, `btn btn-ghost btn-sm` |
| Lane/card | Lane label/count; card checkbox, title as the keyboard-open target, mono folder ID, type, stage, labels, estimate, relation/session hints, status menu and Start. Card footer has one line for stage and `8 files`; no nested Open button. Selected card uses `ring-2 ring-primary outline outline-2 outline-offset-2 outline-base-content` so the light-theme selection remains visible. Checkbox and title button are siblings, not nested interactive descendants of a button. | lane `bg-surface-1 border border-surface-border rounded-box p-3`; card `bg-surface-2 border border-surface-border rounded-box p-3 shadow-[var(--elev-shadow)] hover:bg-surface-3` |
| Grouped list | Accessible column headers wide; at 760px each row stacks title/folder and labelled facts. Selection/range selection and status actions remain. | `bg-surface-1 border-b border-surface-border px-4 py-3`, selected `bg-surface-3` |
| Bulk region | Count, select all matching, status/label menus, clear; confirm, progress/cancel, summary/retry. | `bg-surface-2 border border-surface-border rounded-box p-3 shadow-[var(--elev-shadow-raised)]`, `btn btn-ghost btn-sm`, confirm `btn btn-primary btn-sm` |
| Command palette | Search input, grouped task/view/status/filter results, shortcut hints, keyboard active row, empty result. Escape restores focus. | dialog `bg-surface-2 border border-surface-border rounded-box shadow-[var(--elev-shadow-raised)]`, row active `bg-surface-3` |
| New Task dialog | Title, type, status, description, inline validation, Cancel/Create. | same dialog tokens, `input input-bordered`, `btn btn-primary` |
| Detail header | Back, breadcrumb `.ptah / specs / TASK_*`, full selectable path, title, status/type/stage, Start and status menu. | `bg-surface-1 border-b border-surface-border p-4`; path `font-mono text-xs`; title `text-xl font-semibold` |
| Metadata/relations | ID, status, type, stage, executor, estimate, labels, parent, dependencies, duplicates, related graph; edit controls. Carrier description/body in distinct Overview subsection. | `bg-surface-2 border border-surface-border rounded-box p-4`, label `text-base-content-muted`, value `text-base-content` |
| Activity/Start picker | Linked sessions, progress, PR links; agent/CLI and optional isolation. Codex choice: `Run through codex v0.155.1.` once. When no parseable version exists, keep the current `Run through the codex CLI lane.` fallback (`task-agent-discovery.service.ts:74-76`). Start remains chat prefill. | same panel tokens, `btn btn-ghost btn-sm`, mono version |
| Maintenance | Reindex, Generate registry, Tidy finished preview/confirm, excluded folders. | `btn btn-ghost btn-sm`, menu `bg-surface-2 border-surface-border` |
| States | No workspace: explain `.ptah/specs`/open folder. No tasks: New Task. Filtered-empty: clear filters. Loading: labelled skeleton/`aria-busy`. Error: reason/Retry. Validation and excluded folders: expandable reasons. | `bg-surface-1 text-base-content`; hints `text-base-content-muted`; error `text-error` |

## Spec-folder file list spec

Group **On disk** apart from **Expected workflow files**. Actual entries show icon, exact name, file/directory type, Present and an Open in editor action on selection and in the reader header. Expected missing files show Missing and no open action. The sample contains `task.md`, `context.md`, `task-description.md`, `task-description-review.md`, `decisions.md`, `parity-inventory.md`, `design-spec.md`, `prototype/`; `implementation-plan.md`, `visual-review.md` and legacy `tasks.md` may be missing. Include other actual plans/reviews by name. `tasks.md` is marked Legacy when present. `prototype/` is a directory with expandable listing or Open folder; never render it as markdown. Explicit states: Present, Missing, Unreadable, Binary, Rejected. For unreadable/binary/rejected, show cause and only a safe permitted editor action. Inline reader allowlist: direct child files with lowercase `.md` extension only; maximum 1 MiB UTF-8 content. Reject absolute paths, `..`, separators in file names, symlink/junction escape, disallowed extensions and oversized/binary content before rendering. The backend must resolve under the active workspace's selected task folder. `task.md` reader labels the machine-owned carrier; its facts appear in Metadata.

## Markdown reader spec

Use shared `ptah-markdown-block` with `[variant]="'auto'"` (`libs/frontend/markdown/src/lib/markdown-block.component.ts:27-58`) and existing marked/DOMPurify provider. Retain its existing `prose-sm` scale; a 16px custom prose variant would require an explicit shared-component change and is outside this revamp. Never bind unsanitized HTML. Header shows filename, document kind/state and Open in editor. Reader headings, paragraphs and lists follow the shared prose spacing; tables have internal overflow, fenced code uses `font-mono bg-surface-3` with internal overflow, safe-scheme links use underlined `--ptah-link`, inline code uses `bg-surface-3 rounded px-1`, and blockquotes use `border-l-2 border-surface-border`. Loading keeps the header and shows skeleton lines. Empty says “This file has no readable body.” Missing, unreadable, binary and rejected show specific reasons. Latest file selection wins over stale asynchronous responses.

## Phase 2 run-panel placeholder

Wide: right rail below Activity. Narrow: after Activity. `bg-surface-1 border border-dashed border-surface-border rounded-box p-4`. Label `Planned for Phase 2 · TASK_2026_358`; copy “Launch, watch and resume a Ptah-owned multi-stage run here.” No buttons, fake progress or simulated state. Future selection contract: selected task ID and workspace root enter panel; validated host-neutral RPC will supply run/stage data. Phase 1 Start remains a separate chat-prefill action.

## Accessibility

Use the focus class above on every card title, filter, file row, button, link and menu item. Checkbox and title action are sibling controls. Board arrows, range selection, palette arrows/Enter/Escape and focus restoration remain. Dialogs trap focus. Status, stage, file state and CLI label always have text; color only supplements. Board/list switch uses `aria-pressed`; file tree uses labelled disclosure; bulk progress is polite live text, failures assertive alerts. Semantic heading order starts at `h1`; reader uses shared `prose-sm`. Focus outline must not be clipped at 760px. Production `text-base-content-muted` meets the theme contrast ladder; avoid alpha text classes. Keyboard targets at least 32px, primary actions 36px.

Contrast criterion: WCAG AA 4.5:1 for normal text, 3:1 for nontext indicators. The values below were measured in Chromium from the prototype's copied anubis/anubis-light theme values and semantic surface formulas (sRGB canvas conversion, rounded to 0.01). Production must retain semantic tokens across all installed themes.

| Pair | Anubis dark | Anubis light | Use |
| --- | ---: | ---: | --- |
| `--ptah-link` on surface-2 / surface-3 | 8.24 / 7.39 | 5.64 / 5.29 | Text link, passes 4.5 |
| `base-content-muted` on surface-2 / surface-3 | 5.65 / 5.07 | 5.39 / 5.06 | Secondary text, passes 4.5 |
| state run / need / done / err / idle on surface-2 | 4.71 / 6.18 / 5.25 / 4.60 / 6.82 | 5.42 / 5.21 / 5.09 / 5.47 / 4.73 | Dots and supplementary labels, all pass 4.5 on resting cards |
| primary-content on primary | 4.82 | 6.81 | Button text, passes 4.5 |
| primary ring on surface-2 | 3.35 | 1.25 | Light ring alone fails 3:1; pair with base-content outer outline |
| base-content outline on surface-2 | 13.89 | 14.21 | Selected/focused card edge, passes 3 |

On surface-3 hover, state ink is used for dots only, with adjacent `text-base-content` status labels; this preserves the 3:1 nontext criterion even where dark run/error ink is below 4.5:1 as text.

## Parity mapping

| Capability from parity inventory | New location |
| --- | --- |
| Board/list remembered mode; columns/counts/cards/grouped list | Header switch; board/list content |
| Board keyboard navigation/focus/Escape; selection/range/select all matching | Board/list roving focus and checkboxes; bulk bar |
| Search/facets/label mode/chips/sort | Filter bar |
| Saved views create/apply/update/rename/reorder/delete/skipped notice | Saved views menu |
| Palette shortcut and task/view/status/filter actions | Commands and command palette |
| New task title/type/status/description | New Task dialog |
| Single status change and refresh | Card/list/detail status menu; store refresh |
| Labels/estimate/parent; dependencies/duplicates/related graph | Detail Metadata and Relations |
| Bulk status/label, confirmation, progress, cancel, summary, retry | Bulk region |
| Carrier facts/description/warnings/body; stages/presence | Detail Overview, Metadata, stage badge, Files |
| Inline read/loading/last-selection guard; editor open; sanitized markdown | File list and reader |
| Chat-prefill Start, agent target, isolation; CLI choices/version | Card/detail Start picker with normalized version |
| Linked sessions/progress/PR | Detail Activity |
| Reindex/registry; finished sweep preview/confirm | Board maintenance menu/dialog |
| Excluded/validation/no-workspace/empty/filtered-empty | Board status rail and state panels |
| Disk-change push/workspace refresh/cache | Existing data store; status rail says `Updated just now` after a successful refresh and `Refreshing…` while an update is pending |

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse anubis semantic surfaces and both themes. | New Tasks palette. | Renderer theme config; chat shell line 117. | Yes |
| Separate actual files from expected missing files. | Mix or omit missing. | Folder fidelity and presence requirement. | Yes |
| Keep 240px lanes scrollable at 760px, with list alternative. | Compress cards into clipped grid. | Six statuses and board/list parity. | Yes |
| Reserve a visibly inactive detail run panel. | Fake launch control. | `decisions.md:D4`; Phase 1 scope. | Yes |

## Lane-introduced constraints

- [lane-proposed] Compact controls have 32px minimum height and primary actions 36px.
- [lane-proposed] Five 220px lanes plus a 58px terminal rail at 1280px; 242px scrolling lanes below 1100px; detail rails 248px/268px with 16px gutters.
- [lane-proposed] Reader allowlist is direct-child lowercase `.md` UTF-8 files up to 1 MiB. This bounds the proposed extra-file read API and must be validated at the backend.
- [lane-proposed] Avoid alpha text classes for secondary information; use the theme's `base-content-muted` tier.
- [lane-proposed] The standalone prototype has a labelled theme-preview strip only to capture both themes. Electron owns the theme and global branding; the strip does not ship.
- [project-rule] Structural `surface-*` tokens: `apps/ptah-extension-webview/tailwind.config.js:37-41`, `src/styles.css:157-168`; chat usage: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:117`.
- [project-rule] Focus class: `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-styles.ts:11-12`.
- [project-rule] Shared marked/DOMPurify path, `variant='auto'`, no unsanitized HTML: `libs/frontend/markdown/src/lib/markdown-block.component.ts:18-21,27-58`, and `task-description.md` NFR. Its `prose-sm` scale is retained.
- [project-rule] Versionless CLI fallback: `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:74-76`.

## Revision log

| Finding | Fix |
| --- | --- |
| 1 | Added prototype README and moved screenshots into `prototype/screenshots/`. |
| 2 | Added Lane-introduced constraints in this spec and the README. |
| 3 | Replaced invented `border-surface-border-strong` with defined `border-surface-border`; prototype uses the same surface border formula. |
| 4 | At 1280px, five 220px lanes plus a 58px Cancelled rail fit; narrower widths retain scrollable lanes. |
| 5 | Card footer is a single line; removed nested Open action and made the title a sibling button of the checkbox. |
| 6 | Removed Ptah wordmark and task-owned theme chrome; theme preview is labelled as prototype-only. |
| 7 | Filter controls use `input-sm`/`select-sm`, 32px height and `text-sm`. |
| 8 | Added per-theme `color-scheme` for native scrollbars. |
| 9 | Copied real light `--rounded-btn:2rem` and `--rounded-badge:1rem` values. |
| 10 | Corrected primary action and link citations; underline is a spec rule. |
| 11 | Added measured contrast pairs below and a base-content outline to the light selection ring. |
| 12 | Selected card now uses a primary ring, with a base-content outline for contrast. |

## Proposed Removals

None.
