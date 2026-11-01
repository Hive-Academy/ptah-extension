# Glass polish: six opaque/touching surfaces (ptah-glass, ptah-glass-light)

Scope: Electron, glass on only. All paths relative to the worktree. All CSS goes in
`apps/ptah-extension-webview/src/styles.css`. Line numbers are from the current worktree.

## 0. Surface-role inventory (styles.css)

| Role / selector | Paints | Defined | Glass off |
| --- | --- | --- | --- |
| `chrome` | `::after` fill (`--glass-fill` + `--glass-under`), grain, 0px blur, rim, pane shadow | 2945-2967 | role CSS is scoped to `:root[data-glass='on']`: no-op |
| `bar` | chrome with denser `--glass-under-bar` (app header, toolbars) | 2983-2989 | no-op |
| `overlay` / `.modal-box` / `.dropdown-content` | `::after` fill `--glass-fill-overlay` (0.9), 6px blur | 2968-2980 | no-op (daisyUI look) |
| `plate` | `--glass-plate` (b1/0.5), fill only. Local text scrim on a chrome pane | 2992-2997 | no-op |
| `content` | `--glass-scrim-text` (b1/0.5 light, 0.62 dark), rim, shadow, no blur. Reading plane | 3000-3005 | no-op |
| `tile` | `--glass-fill-tile` (b1/0.5) plus hairline, no blur. Nested block | 3007-3016 | no-op |
| `.collapse`, `.stats` | `--glass-fill-tile` | 3230 | no-op |
| `.bg-base-200` / `.bg-base-300` utilities | remapped to `--glass-fill-tile` / `--glass-hover` | 3485-3486 | untouched |
| Cleared page roots | `background-color: transparent` for `.electron-shell-root`, `ptah-root > main`, `ptah-orchestra-canvas > .bg-base-100`, `ptah-app-shell > .bg-surface-0`, `ptah-marketplace-shell > .bg-surface-0`, `ptah-thoth-shell > .bg-surface-0` | 3477-3484 | no-op (selector starts with `:root[data-glass='on']`) |

Gap that causes issues 2, 3, 4 and 6: the shared structural classes `.surface-1`, `.surface-2`
and `.surface-3` (styles.css 379-395, `@layer components`) have no glass rule. They paint
`var(--surface-1)` / `var(--surface-2)`, which are opaque (`--surface-1` is a mix of b2/b1 at line 150;
`--surface-2` is `oklch(var(--b2))` at line 151). Several routed pages also keep an opaque root
(`bg-base-100`, `bg-surface-0`) that is not in the cleared-roots list. The correct reference surfaces
are cleared roots (Marketplace main: `ptah-marketplace-shell > .bg-surface-0`, line 3482) and elements
carrying a role attribute.

Every rule below starts with `:root[data-glass='on']`, so non-glass themes are unchanged. Put them in
the unlayered block that starts at 3469 (after line 3486), because `.surface-*` is in `@layer components`
and unlayered CSS wins.

## 1. Voice "Command Center": card touches the header

- Root cause: `libs/frontend/command-center/src/lib/components/command-center-start.component.ts:32-35`.
  The `<section data-glass-surface="content">` has inner padding `py-8` but no outer margin. Its parent
  `ptah-command-center-page` is a flex column (`command-center-page.component.ts:66-68`), and its
  header `command-center-header.component.ts:10` ends flush. With glass off the section paints nothing,
  so the inner `py-8` reads as a gap. With glass on the content fill starts at the section edge.
- Reference for rhythm: `command-center-page.component.css:2` (`.layout { padding: 16px }`, the stage
  below the header in the live view).
- Decision: top and bottom margin, not vertical centering. The page host is
  `overflow-y-auto` and the recent-sessions list grows (`recent-grid`). A centered card would jump as the
  list grows, and in a short window it would clip its top or force the pane to scroll with the header
  hidden. A fixed margin keeps one stable top edge and scrolls normally.
- Change: add a `styles` entry to `command-center-start.component.ts` (the component has none):
  ```css
  :host-context([data-glass='on']) section[data-glass-surface='content'] {
    margin-block: 1rem; /* 16px, same as the live view's .layout padding */
  }
  ```
  (`:host-context([data-glass='on'])` is the pattern at `electron-shell.component.ts:158` and
  `settings.component.ts:132`.) Do not change the `py-8` or the max width.
- Glass off: unchanged. The rule is scoped to glass, and there the section is transparent.
- Readability: unchanged. It is already a `content` plane (0.62 dark).
- Optional, narrow panes only: below 72rem the card is full width and touches the pane edges. A
  horizontal gap there is a separate question (see Open questions).

## 2. Tasks page: WORKSPACES sidebar and board are opaque

Two painters.

a) Board: `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:119` root
   `<div class="flex flex-col h-full w-full bg-base-100">`. `.bg-base-100` is not remapped by glass
   (only 200/300 are, 3485-3486) and `ptah-tasks-view` is not in the cleared-roots list.
b) Workspace sidebar: `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts:44`
   root `<div class="flex flex-col h-full bg-surface-1 border-r border-surface-border">`. The host
   `ptah-workspace-sidebar` is a `chrome` pane (`electron-shell.component.ts:440-444`), but this inner
   div paints an opaque `--surface-1` on top of the pane. Nested folder list (line 57) already uses
   `data-glass-surface="plate"`, so text readability is already handled.

- Change: add two selectors to the cleared-roots list at styles.css 3477-3484:
  ```css
  ptah-tasks-view > .bg-base-100,
  ptah-workspace-sidebar > .bg-surface-1
  ```
  No template change. The sidebar keeps its `border-r` and plate. The tasks header's `border-b
  border-base-300` is already softened by `:root[data-glass='on'] .border-base-300` (3075).
- Where else the sidebar appears: only `electron-shell.component.ts:440` (Electron) and an e2e fixture
  (`webview-e2e-harness/.../settings.fixtures.ts`). The fix covers every use. The Tasks empty state
  ("No tasks on the board", `tasks-view.component.ts:472`) sits bare on the pane. Add
  `data-glass-surface="plate"` to that block's wrapper if the scene is busy behind it (see Open questions).
  The kanban columns and cards use `.surface-*` and are covered by section 7.
- Glass off: unchanged (selectors only match under `:root[data-glass='on']`).
- Do not change the `ptah-sidebar-tab` strip: it is a separate `chrome` pane and already shows the scene.

## 3. Thoth panel: left nav and content opaque

- Root `div.bg-surface-0` at `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:96`
  is already cleared (3483). The remaining painters are:
  - Left nav: `<aside class="surface-1 ...">` at `thoth-shell.component.ts:97-100`. `.surface-1` paints opaque.
  - Content cards: `memory-curator-tab.component.ts:97` (`surface-1` header card), the stats tiles in
    `memory-stats-strip.component.ts` (5 uses), `memory-entry-list.component.ts:29,57`
    (`surface-2` list), plus the same classes in cron-scheduler-tab, messaging-gateway-tab and others.
- Reference: Marketplace overview cards (`10.png`), which render as translucent tiles over the scene.
- Change: the global `.surface-1` / `.surface-2` rule in section 7. No Thoth template edits.
- Readability: the memory list is dense text. Section 7 uses `--glass-scrim-text` (0.62 dark / 0.5 light),
  the `content` reading-plane token, not the lighter tile fill, so it stays on a text scrim.
- Glass off: unchanged.

## 4. Dashboard: page and cards opaque

- Page root: `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:1`
  `<div class="min-h-full space-y-5 bg-surface-0 p-4" data-testid="dashboard-grid">`. Not in the
  cleared-roots list. Host is `ptah-dashboard-grid` (`dashboard-grid.component.ts:19`).
- Cards: `provider-account-card.component.ts:83` (`surface-1`, "Provider accounts & plan limits"),
  `:104` (`surface-2`), `builders-card.component.html:3` (`surface-2`, "open source"),
  `analytics-card` (usage section), `skill-selection-card.component.ts` (3 uses).
- Change: add `ptah-dashboard-grid > .bg-surface-0` to the cleared-roots list (styles.css 3477-3484),
  plus the section 7 rule for the cards. Bare `bg-base-200/40` KPI tiles in
  `usage-kpi-strip.component.ts:19-44` and `usage-cost-quality.component.ts:24` already get alpha
  fills and need no change.
- Glass off: unchanged.

## 5. Settings, Providers tab only: opaque grey

Not fully explained by static read; do not treat the fix below as proven.

- Evidence: the page plane clears in glass (`settings.component.ts:132`
  `:host-context([data-glass='on']) .settings-page { background-color: transparent }`). I found no opaque
  full-page painter in `providers-settings.component.ts`, `main-agent-section.component.ts`,
  `agents-routing-settings.component.ts` or `cli-orchestration-matrix.component.ts`
  (`grep` for `bg-base-*`, `bg-surface-*`, `surface-[0-3]`, `fixed inset-0`, `background` in those
  files: only chips/inputs/cells). `ptah-native-card` (connection cards) is `bg-base-200/40`
  (`native-card.component.ts:192`), so it is translucent.
- What differs from the working tabs: the Advanced tab wraps its blocks in role surfaces
  (`pro-features/claude-builtins-config.component.ts:80` `data-glass-surface="content"`, plus
  `.settings-plate`). The Providers tab has none: the "Main agent + Connections" card is a plain
  `<div class="space-y-8" data-testid="providers-main-connections-card">`
  (`providers-settings.component.ts:123`) and the CLI matrix table wrapper
  `<div class="overflow-x-auto rounded-lg border border-base-content/10">`
  (`cli-orchestration-matrix.component.ts:205`) has no fill, although its comment on lines 202-203 says
  "A glass tile in glass themes". The only role it uses is `tile` on the clear-override confirm
  (`providers-settings.component.ts:173`).
- Change (apply the Advanced pattern):
  1. `providers-settings.component.ts:123`: add `data-glass-surface="content"` to the card div, and add
     `:host-context([data-glass='on']) [data-testid='providers-main-connections-card'] { padding: 1.25rem; }`
     to the component styles (glass-scoped, so no new padding class when glass is off). This puts
     "Main agent" + "Connections" on one reading plane.
  2. `cli-orchestration-matrix.component.ts:205`: add `data-glass-surface="tile"` to the table wrapper
     (restores the intent in the comment). The existing `.cli-row` glass rule (line 812) keeps rows transparent
     over the tile.
- Verify before shipping (the cause may be a runtime painter I could not see): in Electron devtools, run
  `document.elementsFromPoint(300, 300)` on the Providers tab and note the first opaque ancestor;
  if it is not one of the blocks above, treat that element as the real fix target and report it.
- Glass off: `data-glass-surface` attributes are inert; the added padding rule is glass-scoped.

## 6. Marketplace: left sidebar only

- Root cause: `libs/frontend/marketplace/src/lib/shell/marketplace-nav.component.ts:227`
  `<nav class="surface-1 mp-nav h-full ... rounded-none border-y-0 border-l-0">`. The main content works
  because `ptah-marketplace-shell > .bg-surface-0` is cleared (3482). The nav's `.surface-1` is not.
  The shell header (`marketplace-shell.component.html:7`, `class="surface-1 ..."`) is the same class and is
  fixed by the same rule.
- Reference (correct): Marketplace overview cards and the cleared shell root (styles.css 3482).
- Change: the section 7 rule. No marketplace edits. The nav's `border-r` stays (the rule keeps the
  existing border and only changes fill).
- Readability: nav labels are 13px text on `--glass-scrim-text`; same plane as the content cards.
- Glass off: unchanged.

## 7. The shared rule (fixes 3, 4, 6, tasks cards, memory list)

Add to the unlayered block after styles.css:3486:

```css
/* .surface-1 / .surface-2 are in-page structural blocks (cards, sidebars, list planes). In glass they
   become the reading plane. Floating surfaces use .surface-3 / role attributes and are excluded. */
:root[data-glass='on'] :is(.surface-1, .surface-2):not([data-glass-surface], [role='menu'], .dropdown-content, .modal-box, .navbar) {
  background-color: var(--glass-scrim-text);
  border-color: var(--glass-frame, var(--glass-line));
  box-shadow: var(--glass-raise, inset 0 1px 0 var(--glass-glint));
}
```

- Cleared-roots additions (same block, edit list at 3477-3484):
  `ptah-tasks-view > .bg-base-100`, `ptah-workspace-sidebar > .bg-surface-1`,
  `ptah-dashboard-grid > .bg-surface-0`.
- Why this selector set is safe: all `.surface-1/.surface-2` uses in `libs/frontend` are in-page blocks
  (ui `surface-card/section/tile/stat-card`, memory, cron, gateway, dashboard, tasks, marketplace). Popups use
  `.surface-3` (git-ui, notification-center, native-popover) and are untouched. `.navbar` is excluded because
  it has its own rule (2346). The existing inspector-dock rule (3617) stays more specific for its own scope.
- `border-color` uses `--glass-line` so light/dark hairlines match the other tiles (3009).
- Glass off: selector requires `:root[data-glass='on']`; non-glass themes keep `var(--surface-*)`.

## Combined file list

| File | Change | Overlap with Codex lane |
| --- | --- | --- |
| `apps/ptah-extension-webview/src/styles.css` | cleared-roots list (3477-3484) + new `.surface-*` rule after 3486 | Same file as the scene work, but those blocks are ~2840-2910. No overlap in lines. Rebase risk only. |
| `libs/frontend/command-center/src/lib/components/command-center-start.component.ts` | add `styles` (glass margin) | none |
| `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | `data-glass-surface="content"` at 123 + glass padding style | none |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` | `data-glass-surface="tile"` at 205 | none |
| `libs/frontend/tasks-ui/.../tasks-view.component.ts` | optional plate on empty state (~472) | none |

Not touched: `theme.service.ts`, `index.html`, `theme-toggle.component.ts`, scene `::before` blocks.
Existing specs worth a look after the edit: `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts` (modified in the
working tree; check it does not enumerate the cleared-roots list) and `no-alpha-base-content.spec.ts`
(lists `tasks-view.component.ts`, so do not add alpha base-content utilities there).

## Decisions

- Command Center: margin, not centering (scrolling page, growing list). Reversible.
- Shared `.surface-1/.surface-2` glass rule instead of per-component edits: one place, and these classes
  are in-page blocks only. Reversible by deleting the rule.
- Reading plane token for those blocks is `--glass-scrim-text` (denser than `--glass-fill-tile`) because most
  carry dense text.

## Open questions

1. Settings Providers (section 5): the painter of the full-pane grey is not identified by static reading.
   Run the devtools `elementsFromPoint` check; a runtime-only element (an open popover backdrop or a
   deferred block) may be the cause.
2. Tasks empty state and the Marketplace-style bare headers: add a `plate` for contrast, or accept the bare
   text on the pane as Marketplace main does? Recommended: add the plate to the empty state only.
3. Command Center on panes narrower than 72rem: add a 1rem side gap (`width: min(100% - 2rem, 72rem)`)? Not
   in the screenshot; left out.
