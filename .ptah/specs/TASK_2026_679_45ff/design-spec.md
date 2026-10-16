# Design Spec: "Previous sessions" button and modal (TASK_2026_679_45ff)

Status: **Gate 1.7 APPROVED by the user 2026-10-16 (decisions.md D11), with amendment D12:** the active /
highlighted row background and its left accent cover the WHOLE row, including the organization chips line under the
title and meta line (sections 3.6, 3.7). The prototype is not updated for D12; D12 wins where they differ. Visual source of truth: `prototype/index.html` (+ `prototype/screenshots/`, 71 PNG, dark and light).
Inputs read: `task-description.md` (incl. section 10, D9), `parity-inventory.md`, `decisions.md` D1-D9, the clean-session-view spec
`../TASK_2026_677_efcd/design-spec.md` (token map, breakpoints, a11y, motion) and its prototype tokens, and the code named in the brief.
Design system applied: the app's own Anubis system (DaisyUI themes `anubis` dark and `anubis-light`, semantic surfaces `surface-0..3`,
`text-base-content-muted`, `--ptah-link`, focus ring, Inter). No new colour, font, radius or token is introduced (section 7). The two themes
named by the task are measured; the 32 stock themes inherit the same token roles (section 5.3).

Rule tags: `[user-requested]` (the /orchestrate request, decisions.md D1-D9, or a task-description criterion that quotes them),
`[project-rule: <source>]`, `[designer-proposed]`. A rule with several sources carries each. `D9` marks the Rail scope add (section 8).

How to read values: every value names its source: `T:` Tailwind utility (tailwind 3.4, default `screens`, so `sm:` = 640 px), `S:` custom
property or rule in `apps/ptah-extension-webview/src/styles.css`, `DZ:` DaisyUI 4.12 (`node_modules/daisyui/dist/full.css`), `C:` the existing
component named. Pixel values are CSS px at 1x.

---

## 0. The design in one screen

- Entry: a secondary "Previous sessions" button directly under the Rail footer "New session" (expanded: text + clock icon; collapsed: icon only),
  and next to the navbar `New` in VS Code single layout (section 2).
- Modal: a centred dialog 720 px wide on desktop, a full-screen sheet below 640 px (this covers the 400 px VS Code sidebar). A fixed header
  (title, close, search, Filters, sort, group, Date range) over one scrolling list. Same list, rows, chips, markers and actions as the old
  sidebar, re-laid for width (sections 3 and 4).
- Behaviour: Esc closes the innermost layer only, Tab is trapped, the opener gets focus back, selecting a row opens the session and closes the
  modal, the query survives close and reopen (section 4).
- D9: the Rail card "Session actions" menu gains Rename (small popover) and Organize (the same editor) (section 8).
- Prototype findings the architect must act on are collected in section 11.

## 1. Which existing overlay pattern the modal follows `[designer-proposed]`

Three overlay patterns exist in `libs/frontend`:

| Pattern | Where | Used for |
| --- | --- | --- |
| A. `<dialog class="modal modal-open" aria-modal="true">` + `.modal-box` + `<form method="dialog" class="modal-backdrop">` | `session-organization-editor.component.ts:107-115, 473-476`; `confirmation-dialog.component.ts` (`<dialog class="modal" [class.modal-open]>`) | centred dialogs |
| B. `ptah-native-popover` (Floating UI, transparent backdrop `z-40`, panel `z-50`, Escape on the host, stores and restores focus) | `native-popover.component.ts:74-122, 290-312`; Filters popover; New session popover | anchored popovers |
| C. Native `showModal()` | none in the app code read for this task | - |

Decision: the modal is pattern A (the same family as the organization editor and the confirm dialog it must host and sit under), with three
deliberate differences, each measured:

1. The panel is NOT `.modal-box`. `DZ: .modal-box` always carries a `transform` (`scale(1)` when open, verified in `full.css`), and a transformed
   ancestor becomes the containing block and clip box for the Filters popover (pattern B, positioned by Floating UI). The panel is a plain
   `div` with `overflow: hidden` and no `transform`, `filter`, `contain` or `will-change` at rest. The entrance animation (section 6) uses
   `animation-fill-mode: backwards`, so no transform remains after it ends. `[designer-proposed]`
2. A real focus trap and `inert` background are added. Patterns A today only move focus in and restore it (`session-organization-editor.component.ts:544-575`);
   neither traps. `[user-requested]` (Req 2.2) `[project-rule: 677 design-spec 8.3 inert + wrap handler]`
3. The modal sits at `z-index: 990`, below the nested dialogs (`DZ: .modal { z-index: 999 }`), so the organization editor and the confirm dialog (rendered
   earlier in `app-shell.component.html`, lines 1-26, but at 999) always stack above it whatever the DOM order. `[designer-proposed]`

Rejected: native `<dialog>.showModal()`. The top layer would place the modal above the editor, the confirm dialog and the Filters popover, none of
which use the top layer, so they would be hidden behind it. `[designer-proposed]`

## 2. Entry button (D5)

### 2.1 Rail footer, expanded (Electron, VS Code grid) `[user-requested]` D5

Source: `canvas-rail.component.ts:231-251` (footer `h-[84px] shrink-0 px-2 py-2`, New session `btn btn-primary btn-sm h-[30px] w-full`).

```
footer  h-[120px] shrink-0 px-2 py-2            (84 px today; +36 px)
  div.flex.flex-col.gap-1.5
    button New session            (unchanged)                         30 px
    button Previous sessions      NEW                                 30 px   <- directly below, 6 px gap, nothing between
  p#rail-new-session-reason  mt-1 text-xs text-base-content-muted     only when New is disabled; moved below BOTH buttons
```

Height arithmetic `[designer-proposed]`: 8 (py-2) + 30 + 6 + 30 + 4 (mt-1) + 32 (two `text-xs` lines of 16) + 8 = 118, +2 slack = 120. The footer stays
fixed height (as today) so the scroll list above never jumps when the running cap toggles. Expanded Rail widths 304 / 288 / 272 px (`canvas-rail.component.ts:98-101`) all
leave at least 256 px inside the footer, so the label never wraps.

New button classes `[designer-proposed]`:

```
btn btn-ghost btn-sm h-[30px] min-h-[30px] w-full gap-1.5 border border-[color:var(--surface-border-strong)] font-medium
hover:bg-surface-2 [&[aria-expanded=true]]:bg-surface-3
```
Label `Previous sessions` (14 px, 500). Icon lucide `History` (`history`), `w-3.5 h-3.5`, `aria-hidden="true"`, before the label.

Why this style: one primary action per surface (ui-ux-designer skill); `New session` stays the only filled button. Ghost + the 22% hairline
(`S: --surface-border-strong`) reads as a button without competing. The hairline is decorative: the label identifies the control (text 14.9:1 dark,
15.9:1 light on `surface-0`, section 5); the hairline measures 1.83 / 1.59 and is not relied on. `[designer-proposed]`

Order in the Rail Tab sequence: card list, `New session`, `Previous sessions`. `[user-requested]` (under New session)

### 2.2 Rail footer, collapsed (56 px; manual or auto-collapse) `[project-rule: task-description Req 1.4]`

```
footer  h-[82px] shrink-0 px-2 py-2                         8 + 30 + 6 + 30 + 8
  New session shows "+"                                     (unchanged)
  Previous sessions  icon only, 40 x 30, same classes, no <span> label
     aria-label="Previous sessions"  title="Previous sessions"   (the visible label is dropped, the accessible name is not)
```
In the collapsed Rail the disabled-reason `<p>` becomes `sr-only` (still the target of `aria-describedby`), and `New session` gains `title="{reason}"`.
Today the reason is rendered inside a 40 px column where it cannot fit; with a second button it would overflow the 82 px footer. `[designer-proposed]`
The name and tooltip use the project's Rail convention for collapsed controls (`title` + `aria-label`, e.g. `Collapse rail`, `canvas-rail.component.ts:128-130`). `[project-rule: canvas-rail.component.ts]`

### 2.3 VS Code navbar, single layout `[user-requested]` D5

Source: `app-shell.component.html:711-775` (Session group: `ptah-native-popover` > `btn btn-gold btn-xs gap-1` + `icon-btn-label`). Navbar is `bg-surface-1`, one row `min-h-[40px]`, `gap-2` between groups.

Insert immediately after the `</ptah-native-popover>` of `New`, inside the same Session group, no divider:

```
@if (!isElectron && layoutMode() === 'single')
button  type="button"  class="btn btn-ghost btn-xs gap-1 font-medium text-base-content-muted hover:text-base-content [&[aria-expanded=true]]:bg-surface-3 [&[aria-expanded=true]]:text-base-content"
        aria-haspopup="dialog" [attr.aria-expanded] aria-label="Previous sessions" title="Previous sessions"
  lucide History w-3.5 h-3.5 (aria-hidden)  +  span.icon-btn-label.text-xs  "Previous sessions"
```
- Label visibility reuses `.icon-btn-label` (`S: 1792-1808`: hidden below a 700 px container, shown at >= 700), exactly like `New`. At the 400 px sidebar both buttons are icon-only; at >= 700 px the label reads `Previous sessions`. `[project-rule: styles.css .icon-btn-label]`
- Secondary: muted ink (not gold) so the gold `New` stays the one accent. Muted ink is 6.06 / 6.03 on `surface-0`, 5.7 / 5.5 on `surface-1` (navbar), 5.66 / 5.39 on `surface-2`; hover ink 13.9 / 14.2 on `surface-2` (section 5). `[designer-proposed]`
- In VS Code grid layout the navbar `New` stays (F-1) but the navbar does NOT get the button; the Rail footer carries it (section 2.1/2.2). One home per layout, so the opener is never ambiguous. `[user-requested]` D5 (Rail for grid, navbar for single)

### 2.4 States and semantics (all three placements)

| State | Rule |
| --- | --- |
| Default | as above |
| Hover | `bg-surface-2` (Rail), muted -> base-content ink (navbar), 120 ms `--ptah-ease-soft` `[designer-proposed]` |
| Focus-visible | the app ring (`S 684-709`: 2 px, dark `--s` gold, light `--ptah-gold-strong`, offset 2). Rail footer buttons are not in a scroll container, so the standard outer ring is not clipped. Measured 8.81 / 6.28 on `surface-0` `[project-rule: 677 design-spec 8.4]` |
| Modal open | `aria-expanded="true"` and `surface-3` fill. The button sits behind the scrim and is inert (section 4.1). `aria-controls` points at the dialog id only while it is open `[designer-proposed]` |
| Disabled | There is none. The button stays enabled when `New session` is `aria-disabled` (running cap, tile bound), while the host is booting (the modal shows skeleton rows), and with zero sessions (the modal shows the empty state). `[project-rule: task-description Req 1.5]` |
| Accessible name | exactly `Previous sessions`. `aria-haspopup="dialog"`. Activation by click, Enter or Space opens the modal `[user-requested]` (Req 1.6, 1.7) |
| Tooltip | `title="Previous sessions"` on every placement (needed when the label is hidden: collapsed Rail, navbar below 700 px) |

Not added: the canvas dock New session and the empty-board New session get no companion (task-description Decisions). `[project-rule: task-description Scope]`

## 3. The modal

### 3.1 Structure and layering `[designer-proposed]` (pattern in section 1)

```
<dialog class="modal modal-open psm" aria-modal="true" aria-labelledby="psm-title" style z-index 990 (< 999) data-testid="previous-sessions-modal">
  <div class="psm-scrim" aria-hidden="true"/>                     scrim; pointer only
  <div class="psm-panel" role="dialog" ...>                       the panel (no transform at rest)
     <header class="psm-head">                                    fixed; bg-surface-1; border-b border-surface-border
        title bar 48 px:  [History icon] <h2 id="psm-title">Previous sessions</h2>  ......  [Close]
        tools:            search / Filters / Sort / Group row, then the Date range row (+ date inputs)
     </header>
     <div class="psm-body" data-testid="previous-sessions-list">  the ONE scroll region
        group headers (sticky), rows, states, Load More
     </div>
     [Filters popover: ptah-native-popover, inside the panel]
  </div>
</dialog>
Siblings rendered at the app-shell root, ABOVE the modal (z 999): ptah-session-organization-editor, ptah-confirmation-dialog (already there).
```
The `<dialog>` element carries `aria-modal` like the existing dialogs (`session-organization-editor.component.ts:109-110`); the panel carries `role="dialog"` and the label. Exactly one of the two exposes the name to avoid a double announcement: the **panel** is the dialog (`role="dialog" aria-modal="true" aria-labelledby="psm-title"`), the outer `<dialog>` wrapper is `role="presentation"`. `[project-rule: task-description Req 2.1]`

### 3.2 Sizing `[user-requested]` (widths 1440 / 760 / 400; behaviour of the rest `[designer-proposed]`)

| Viewport (window or webview width) | Presentation | Panel (Tailwind) | Result at the named widths |
| --- | --- | --- | --- |
| >= 640 px (`sm:`) | centred dialog, scrim | `sm:w-[min(720px,calc(100vw-48px))] sm:h-[min(720px,calc(100dvh-64px))] sm:rounded-xl border border-[color:var(--surface-border-strong)] shadow `--elev-shadow-raised` | 1440 wide: 720 x 720 (window 820 high). 760 wide: 712 x min(720, H-64), e.g. 712 x 696 at H 760 |
| < 640 px | full-screen sheet, no visible scrim | `w-screen h-dvh rounded-none border-0` | 400 wide (VS Code sidebar, or an Electron window narrowed to 400): 400 x full height |

- The height is fixed, not content-fit, so the panel never jumps while filtering; empty and no-match states centre inside it. Short windows shrink it (`100dvh - 64px`).
- 640 px is the same band edge as the inspector sheet of the clean view (677 design-spec 2.1: overlay sheet from 640, full-width below), so both overlays change presentation at the same width. `[project-rule: 677 design-spec 2.1]`
- Implementation uses viewport media queries (`sm:`), not container queries: the panel must not be a containment context (section 1, difference 1). The prototype uses container queries on its framed window only to simulate the three widths. `[designer-proposed]`
- Safe area: the sheet pads `env(safe-area-inset-*)`; not needed in either host today, noted for completeness. `[designer-proposed]`
- Max height and scroll: the header never scrolls; `psm-body` is the only scroller: `flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-2 pt-1 [scrollbar-gutter:stable]`. The page behind does not scroll (inert, and `overscroll-contain`). `[user-requested]` (Req 6.4)
- Scrollbar: thin and always visible (the old "visible only on aside hover" rule has no meaning in a modal, A-9): `[scrollbar-width:thin] [scrollbar-color:oklch(var(--bc)/0.28)_transparent]`. `[designer-proposed]`

### 3.3 Header

| Element | Spec |
| --- | --- |
| Surface | `bg-surface-1`, `border-b border-surface-border`, `px-4 pb-3`; the search field and selects sit on `surface-0` (same relationship as the old sidebar: panel `surface-1`, fields `surface-0`) `[project-rule: app-shell.component.html:99-124]` |
| Title bar | 48 px (equals the clean view header height, 677 design-spec 2) `[project-rule: 677 design-spec 2]`. `History` icon 16 px muted, then `<h2 id="psm-title" class="text-sm font-semibold">Previous sessions</h2>`. No count (new information, not asked) |
| Close | `btn btn-ghost btn-sm btn-square` 32 x 32, lucide `X` 16 px, `aria-label="Close previous sessions"`, muted ink, base-content on hover `[user-requested]` (Req 2.6 asks for a visible close control) |
| Replaces | the Ptah icon header of the aside (A-8, removed, D6) |

### 3.4 Query controls

Both host variants share one container `role="search" aria-label="Filter sessions"`; left edge = header padding (16 px). Row order and widths:

**Organization variant (Electron, CLI)** `[user-requested]` (parity B-3..B-15 unchanged behaviour; layout `[designer-proposed]`)

| Viewport | Row 1 | Row 2 |
| --- | --- | --- |
| >= 640 (panel >= 592) | search `flex-1 min-w-[200px]` + `Filters` (auto width, `h-8 px-2`) + Sort select 128 px + Group select 128 px, one line, `gap-2` | `Date range` toggle left, `Clear` right |
| < 640 (400 sheet) | search, full width | `Filters` + Sort (`flex-1`) + Group (`flex-1`) in one line (about 142 px each at 376 inner) |
| < 640 | row 3 | `Date range` toggle left, `Clear` right |

- Search: the existing `ptah-session-filter-bar` field (`h-8`, `rounded-lg`, `bg-surface-0 border-surface-border`, search icon 12 px, clear X appears with text, 250 ms debounce unchanged). Placeholder ink changes from the DaisyUI default (50% base-content, 4.48:1 dark and 3.28:1 light, fails 4.5) to `placeholder:text-base-content-muted` (6.06 / 6.03). `[designer-proposed]` `[project-rule: 677 design-spec 8.2 text >= 4.5:1]`
- Filters popover: unchanged component (`w-60`, Status, Priority, Task id, Pinned only, Has pull request, Clear filters, badge with the active count). Its content gets `max-h-[min(34rem,70dvh)] overflow-y-auto` so a short window can never push `Clear filters` out of reach (prototype: 1440 x 820 shows it fully; the 34 rem cap scrolls inside only on short windows). It opens under the trigger (`bottom-start`) and is positioned by Floating UI against the viewport, so it stays inside the 400 sheet (measured: left/right/bottom inside the panel in the prototype `checks`). `[designer-proposed]` `[user-requested]` (Req 3.5 no clipping at 400)
- Sort and Group: unchanged selects (`h-8`, `text-xs`, FOCUS_RING utilities).
- `Date range`: unchanged behaviour (toggle with chevron, From / To, client-side, inclusive days, all hosts). It stays an inline panel under row 2/3, now laid out as two equal columns (`grid grid-cols-2 gap-2`; labels above, `h-8` inputs) so it costs one row instead of four. Native date pickers are OS-owned; Escape closes the picker first (browser), then the next Escape reaches the modal. `[user-requested]` (parity B-14) `[designer-proposed]` (two columns)
- `Clear`: shown only when a filter is active, `btn btn-ghost btn-xs`, muted ink -> base-content on hover (the old hover-to-error colour is dropped: it is not destructive). Clears search, filters and date range, closes the date panel, keeps sort and grouping. `[user-requested]` (B-15; Req 3.4)

**Plain variant (VS Code, `organizationAvailable() === false`)** `[user-requested]` (Req 3.2)

Row 1: local search (`Search sessions...`, clear X, `data-testid="session-search-local"`), full width. Row 2: `Date range` + `Clear`. No Filters, Sort or Group. Rows get no phase marker column, no chips and no Organize (section 3.6).

Layout change needed in the existing bar (class and wrapper changes only, no logic): the bar's three stacked rows become one wrapping toolbar at >= 640. If the architect prefers to leave the bar's markup untouched, the accepted fallback is the old stacked layout (search / Filters / selects 50-50 / Date range) at every width; it is functionally identical and only wastes about 72 px of height at 640+. `[designer-proposed]`

### 3.5 List region and group headers

- One `<ul class="flex flex-col gap-0.5">` per group; ungrouped lists render the rows directly (as today: `app-shell.component.html:395-433`).
- Group header (`h3`, `list aria-labelledby` unchanged, C-11): `sticky -top-1 z-[2] bg-surface-0 px-2.5 pt-2.5 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-base-content-muted`, label truncates, count `tabular-nums font-normal`. Sticky because the list is now much longer than a 272 px sidebar page; the opaque `surface-0` keeps rows from showing through. `[designer-proposed]` (stickiness) `[project-rule: app-shell.component.html:404-413]` (type)
- By-parent nesting: no headers; children indent 12 / 24 / 36 px (`ml-3 / ml-6 / ml-9`), `data-depth`, sr-only `Child session:` prefix. `[user-requested]` (C-10)

### 3.6 Row anatomy `[user-requested]` (content parity C-1..C-9) `[designer-proposed]` (layout)

Organization host, 52 px tall without chips, 72 px with chips (16 px chip row + 8 padding):

```
li.group.relative            [ml-3/6/9 by depth]
  button.row  grid grid-cols-[16px_minmax(0,1fr)] gap-x-2  w-full min-h-[52px] px-2.5 py-2 text-left rounded-md hover:bg-surface-2   (has chips: pb-1, min-h 0)
     [live-phase marker, col 1, 16 x 18]   ptah-session-live-phase-indicator (unchanged component; host invisible when idle but keeps the 16 px column)
     col 2:
       line 1  flex h-[18px] min-w-0 items-center gap-1.5
               title  truncate text-[13px] font-medium leading-[18px]   (full name in title="")      [current: font-semibold]
               ptah-workflow-badge  (shrink-0, inline after the title; today it sits on its own line)
       line 2  flex items-center gap-1.5 whitespace-nowrap overflow-hidden pr-[92px] text-[11px] leading-4 text-base-content-muted
               {relative time}  {N msgs}(N>0)  {transcript expired}(italic, title = retention hint)   [sr-only "Open in a tab" when open-tab]
  div.actions  absolute right-2 top-6 flex gap-0.5 (section 3.9)
  div.chips    pl-[34px] pr-2.5 pb-2   ptah-session-organization-chips (unchanged; chips are h-4, 10 px)
```
- Chip row left edge = 10 (row padding) + 16 (marker) + 8 (gap) = 34 px, so chips share the title's left edge. The chips sit beside the row button, not inside it, as today (a `ul` is not phrasing content; the comment at `app-shell.component.html:343-352` still applies). `[project-rule: app-shell.component.html]`
- `pr-[92px]` on line 2 reserves the action cluster (3 x 24 + 2 x 2 = 76, +16 slack) so meta text never sits under the buttons; the action cluster aligns to line 2 (centre y = 36 px: `top-6` = 24 px for a 24 px button), so the title keeps the full width. `[designer-proposed]`
- Plain host: grid has one column (`grid-cols-1 gap-x-0`), no marker, no chips line, no Organize, `pr-[92px]` on line 2 is `pr-[56px]` (two actions). 
- Type: row title 13 / 500 (677 `Header title, row name` is 13 / 600; the old row was `font-medium`); meta 11 px (677 `Section meta`); chips 10 px unchanged. `[project-rule: 677 design-spec 1.2]`
- Unread marker: not designed. The parity audit found no unread concept in today's row (C-12) and no data to bind it to; the dot the user saw is the live-phase marker (C-7). It is listed under Decisions, section 10. `[project-rule: parity-inventory C-12]`

### 3.7 Row markers and states

| State | Treatment | Contrast (section 5) |
| --- | --- | --- |
| Default | transparent | title 14.9 / 15.9 |
| Hover | `bg-surface-2` | title 13.9 / 14.2; meta 5.66 / 5.39 |
| Keyboard focus | app ring, `outline-offset: -2px` (inset: the scroll container would clip an outer ring) `[project-rule: 677 design-spec 8.4 inspector rows]` | 7.4-8.8 / 5.3-6.3 |
| Current session (`aria-current="true"`) | `bg-surface-3` + 2 px inset left bar `var(--ptah-link)` + title `font-semibold` | bar 7.43 / 5.26 on `surface-3` |
| Open in a tab, not current | no fill; 2 px inset bar `color-mix(in srgb, var(--ptah-link) 70%, transparent)`; sr-only text `Open in a tab` after the time | bar 4.86 / 3.31 on `surface-0` (3:1 met; 50% and 60% were measured and fail in light: 2.25 and 2.72) |
| Running | marker: 10 px dot, `bg-info`, ring `border-base-content/70`, `motion-safe:animate-pulse`; `aria-label="Live: Running"` | ring 7.69 / 6.18 |
| Waiting on background work | marker: moon 12 px, muted ink; `aria-label="Live: Waiting on background work"` | 6.06 / 6.03 |
| Last run failed | marker: circle-alert 12 px, `text-error`; `aria-label="Live: Last run failed"` | 4.92 / 6.12 |
| Transcript expired | title `text-base-content-muted` (replaces `opacity-50`: 4.48 / 3.28, fails), `transcript expired` italic with tooltip | 6.06 / 6.03 |
| Renaming | the row is replaced by the edit row (3.10) | |

Colour is never the only signal: current = bar + fill + weight + `aria-current`; open tab = bar + sr-only text; live phase = shape (dot, moon, alert) + `aria-label` + `title`. `[project-rule: 677 design-spec 8.1]`

Replaces the old `text-primary` title for active and open-tab rows. `text-primary` measures 3.02:1 (dark, on `surface-3`) and 1.18:1 (light) against the 4.5:1 text rule, so the old accent could not carry over; the accent moves to the bar. `[designer-proposed]` (changes an existing, visible behaviour; reversible, section 10 D-10)

CSS: delete `.sidebar-item-active`, `.sidebar-item-open-tab` and `.sidebar-scroll` plus the `aside:not(:hover)` rule (`S 2268-2335`, A-9) and add `.session-row-current`, `.session-row-open-tab` (one rule each, both themes, tokens only). `[project-rule: task-description Req 7.3]`

### 3.9 Row actions: Organize, Rename, Delete `[user-requested]` (D-2..D-4, D-10, D-11)

- Cluster `absolute right-2 top-6 flex gap-0.5`; buttons `btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 rounded text-base-content-muted hover:text-base-content hover:bg-surface-3` (Delete hover: `hover:text-state-err hover:bg-error/10`). 24 x 24 targets (WCAG 2.2 SC 2.5.8). Icons lucide `Tag`, `Pencil`, `Trash2`, 14 px. Names unchanged: `Organize session: {name}` (`aria-haspopup="dialog"`, organization hosts with an organization record only), `Rename session: {name}`, `Delete session: {name}`. `data-testid="session-organize"` unchanged.
- Reveal: `opacity-0` until row hover or focus-within, 120 ms `--ptah-ease-soft`; they stay focusable while transparent (Tab reaches Organize, Rename, Delete after the row button). `@media (hover: none)` makes them always visible, because a touch user has no hover. `[project-rule: D-10, D-11]` `[designer-proposed]` (touch)
- Tab order inside the modal: Close, search, Filters, Sort, Group, Date range, Clear, then per row: row button, Organize, Rename, Delete; then Load More. No arrow-key list navigation (out of scope, D-11). `[project-rule: task-description Scope]`

### 3.10 Inline rename `[user-requested]` (D-2)

Replaces the row (same `li`): `flex items-center gap-2 min-h-[52px] bg-surface-2 rounded-md py-1.5 pr-2.5 pl-[34px]` (plain host `pl-2.5`), input `input input-xs input-bordered flex-1 h-7 text-[13px] rounded-md bg-surface-0 border-[color:var(--surface-border-strong)]`, `maxlength=200`, `aria-label="Edit session name"`, `aria-describedby` a hint `Enter to save · Esc to cancel` (11 px muted; shown visibly from 640 px up, sr-only below). Focus moves to the input with the text selected. Enter or blur saves; Escape cancels; empty or unchanged does nothing; double-fire guarded: all as today. `[project-rule: app-shell.component.ts:882-935]` The hint is `[designer-proposed]`.
The modal stays open on save and on cancel. Focus after Enter or Escape: the row's `Rename session` button. After a blur (the user clicked elsewhere) focus is not moved. `[designer-proposed]`

### 3.11 List states `[user-requested]` (E-1..E-4)

| State | Spec |
| --- | --- |
| Booting | 5 skeleton rows (`ptah-skeleton-block rows=5`, title `w-32`, subtitle `w-20`), list `aria-busy="true"`, container `role="status" aria-label="Loading sessions"`. Never "No sessions yet" while booting |
| Empty | centred in the list region: lucide `MessageSquare` 32 px `text-base-content/20` (decorative), `No sessions yet` 14 px muted, `Create one to get started` 12 px muted. No CTA (a New button here would duplicate New session) |
| No match | lucide `Search` 32 px decorative, `No matching sessions`, `Try adjusting your search or filters`, then `Clear filters` as `btn btn-ghost btn-sm border border-[color:var(--surface-border-strong)] text-base-content font-medium` (replaces `text-primary/60`: 2.03 dark, 1.26 light). Clears filters only (not sort/group), as today (E-3) |
| Load More | full-width `btn btn-ghost btn-sm h-8 text-xs text-base-content-muted hover:text-base-content hover:bg-surface-2` with chevron-down, `Load More (remaining)`; with client filters `Load more to expand search`; hidden when client filters leave zero rows. Loading: spinner + `Loading...`, `disabled`, `aria-busy`, focus stays on it. When the last page is loaded and the button disappears, focus moves to the first newly loaded row. A polite `role="status"` line announces `Loaded N more sessions. R remaining.` `[designer-proposed]` |
| List load error | no UI, as today (E-5) `[project-rule: parity-inventory E-5]` |
| Result count | the same sr-only status announces `N sessions` after a query change settles (after the 250 ms debounce and the response) `[designer-proposed]` |

### 3.12 Nested layers over the modal `[user-requested]` (D-3, D-4, D-9)

| Layer | Component | Stacking and look |
| --- | --- | --- |
| Filters popover | `ptah-native-popover` inside the panel | z-50 inside the modal's context; transparent backdrop covers the panel |
| Organization editor | unchanged `ptah-session-organization-editor` (`modal modal-open`, `modal-box max-w-md`) | z 999 > modal 990; its own scrim darkens the modal; the modal gets `inert` while it is open |
| Delete confirm | unchanged `ptah-confirmation-dialog` (`Delete Session`, error style) | z 999 > 990; same |
Both nested dialogs keep their text, order and controls. The editor stays 448 px (`max-w-md`) and is `91.67%` wide below it, so at 400 px it is 367 px wide with the modal sheet behind it. `[project-rule: DZ .modal-box]`

## 4. Behaviour `[user-requested]` unless tagged

### 4.1 Open, trap, inert

1. Open from `Previous sessions` (click, Enter, Space). The component stores `document.activeElement` as the opener, renders the modal at the app-shell root, sets `inert` on the shell row (Rail, canvas, navbar, chat) and `aria-expanded="true"` on all triggers. `[user-requested]` (Req 2.1) `[project-rule: 677 design-spec 8.3]`
2. Initial focus: the search field (organization: the bar's search, plain: the local search). Caret at the end, no select-all, so a surviving query can be extended. `[user-requested]` (focus into the modal) `[designer-proposed]` (search, caret)
3. Tab and Shift+Tab wrap inside the panel (a keydown handler; `inert` alone would still let focus reach browser UI). While a nested dialog is open the trap root is that dialog and the panel is `inert`. `[project-rule: 677 design-spec 8.3]`
4. Scroll position: the list opens at the top on every open (A-11 requires only query state). `[project-rule: parity-inventory A-11]`

### 4.2 Escape closes only the innermost layer `[user-requested]` (Req 2.3, 2.4)

Order, top first: Delete confirm, Organization editor, Filters popover, inline rename, then the modal.
- Confirm and editor are siblings of the modal, so their Escape never reaches the modal's handler. The editor already closes on Escape (`onEscape`). The confirm dialog has NO Escape handler today (`confirmation-dialog.component.ts` template: no `keydown`); it needs `(keydown.escape)` -> cancel, otherwise focus inside it and Escape would fall to the page. Required change, section 11. `[designer-proposed]`
- The Filters popover host already handles Escape with `stopPropagation` (`native-popover.component.ts:296-302`).
- Inline rename: the input's Escape cancels and must `stopPropagation` so the modal root does not also close. `[designer-proposed]`
- The Date range panel is an inline disclosure, not a layer: Escape in its inputs closes the modal. Escape in the search field never clears text first (it is `type="text"`). Escape during IME composition is ignored. `[designer-proposed]`

### 4.3 Focus return

| Close path | Focus goes to |
| --- | --- |
| Escape, Close button, backdrop click | the opener |
| Select a row (open session) | the opener (as the task states: `[user-requested]` Req 2.5, 5.1) |
| Opener gone (layout changed while open, trigger re-rendered) | the first visible `Previous sessions` trigger, else the shell's focusable main region; never `body` `[designer-proposed]` |
| Filters popover closes (Esc, backdrop, trigger) | the `Filters` button (the popover component restores it) |
| Rename ends by Enter or Escape | that row's `Rename session` button |
| Delete confirm: Cancel / Esc / backdrop | that row's `Delete session` button |
| Delete confirm: Delete | the next row's row button, else the previous, else the search field |
| Organization editor closes | that row's `Organize session` button; if the row no longer exists (filtered out after a status change) the search field |
Nested-dialog return rules `[project-rule: D-9, Req 2.8]`; the rest `[designer-proposed]`.

### 4.4 Backdrop, select, persistence

- Backdrop click closes only when `pointerdown` and `click` both land on the scrim (a text selection dragged out of the panel must not close it); focus returns as above. At < 640 px there is no scrim (the sheet fills the viewport). `[user-requested]` (Req 2.7) `[designer-proposed]` (pointerdown rule)
- Select a row: request the session (grid: open or focus its tile; single: switch tab; the existing `requestCanvasSession` / `switchSession` paths), then close the modal. Rename, delete and organize leave it open. `[user-requested]` (Req 5)
- Query state (search text, filters, sort, grouping, date range, loaded pages) lives in the store and shell, not in the modal component, so it survives close and reopen with no new `session:list` request. `[user-requested]` (A-11, Req 2.9) Verified in the prototype `checks` (search text survives).

## 5. Theme and contrast `[project-rule: 677 design-spec 8.2: WCAG 2.x, text >= 4.5:1, UI components and focus indicators >= 3:1]`

Method: `prototype/assets/contrast-check.mjs` (same maths as the 677 audit; run `node contrast-check.mjs`, output in `prototype/assets/contrast-output.txt`). Values: dark `anubis` / light `anubis-light`. Surfaces: `surface-0` panel and rows, `surface-1` header, `surface-2` hover, `surface-3` current row and popover panel.

### 5.1 Pairs this design introduces or changes (measured)

| Pair | Need | Dark | Light |
| --- | --- | --- | --- |
| Row title, base-content on surface-0 / 2 / 3 | 4.5 | 14.86 / 13.89 / 12.52 | 15.91 / 14.21 / 13.35 |
| Row meta, time, group header, hint, muted on surface-0 / 2 / 3 | 4.5 | 6.06 / 5.66 / 5.11 | 6.03 / 5.39 / 5.06 |
| Header title and Date range hover, base-content on surface-1 | 4.5 | 14.01 | 14.41 |
| Header Date range label and Clear, muted on surface-1 | 4.5 | 5.71 | 5.46 |
| Search placeholder, proposed muted on surface-0 | 4.5 | 6.06 | 6.03 |
| Expired-transcript title, proposed muted on surface-0 | 4.5 | 6.06 | 6.03 |
| Active / open title, proposed base-content on surface-3 | 4.5 | 12.52 | 13.35 |
| No-match `Clear filters`, proposed base-content on surface-0 | 4.5 | 14.86 | 15.91 |
| Current-row bar, `--ptah-link` on surface-3 | 3 | 7.43 | 5.26 |
| Open-tab bar, link at 70% on surface-0 / surface-2 | 3 | 4.86 / 4.68 | 3.31 / 3.11 |
| Running ring, base-content/70 on surface-0 | 3 | 7.69 | 6.18 |
| Waiting moon, muted on surface-0 | 3 | 6.06 | 6.03 |
| Failed alert, state-err on surface-0 | 3 | 4.92 | 6.12 |
| Previous sessions label, base-content on surface-0 / 2 / 3 (default / hover / open) | 4.5 | 14.86 / 13.89 / 12.52 | 15.91 / 14.21 / 13.35 |
| Previous sessions icon-only (collapsed Rail) on surface-0 | 3 | 14.86 | 15.91 |
| Navbar Previous, muted on surface-0; hover base-content on surface-2 | 4.5 | 6.06; 13.89 | 6.03; 14.21 |
| Focus ring on surface-0 / 1 / 2 / 3 (dark `--s`, light gold-strong) | 3 | 8.81 / 8.31 / 8.24 / 7.43 | 6.28 / 5.68 / 5.61 / 5.26 |
| Rail card actions trigger, muted on surface-1 / 2 | 3 | 5.71 / 5.66 | 5.46 / 5.39 |
| Rail menu label, base-content on surface-3 | 4.5 | 12.52 | 13.35 |
| Rail menu disabled label and reason, muted on surface-3 | 4.5 | 5.11 | 5.06 |
| Rename popover title, muted on surface-2; input text on surface-0 | 4.5 | 5.66; 14.86 | 5.39; 15.91 |
| Existing `New session` btn-primary (reference, unchanged) | 4.5 | 4.82 | 6.84 |

### 5.2 Existing rules this design replaces, and why (measured failures)

| Old rule | Dark | Light | Replaced by |
| --- | --- | --- | --- |
| DaisyUI placeholder (50% base-content) | 4.48 | 3.28 | muted ink |
| `opacity-50` expired title | 4.48 | 3.28 | muted ink |
| `text-primary` active / open title | 3.02 | 1.18 | base-content + bar |
| `text-primary/60` Clear filters | 2.03 | 1.26 | base-content on a hairline button |
| `opacity-60` on a disabled Rail menu item (existing `Move up/down`, kept as is) | 5.43 | 4.18 | the two new items use muted ink; inactive controls are exempt from SC 1.4.3, so the old items are left alone |
Open-tab bar at 50% and 60% alpha fails in light (2.25, 2.72); 70% is the minimum round value that passes in both.

### 5.3 Informational (not required, recorded)

Hairlines: `surface-border-strong` on `surface-0` 1.83 / 1.59 (Previous sessions button), rename input border on `surface-2` 1.87 / 1.57. Both controls are identified by text or an `aria-label` plus the focus ring, so a 3:1 border is not relied on. `current fill` vs `surface-0` is 1.19:1: the fill is a secondary cue, the bar and `aria-current` carry the state.
Stock themes: every pair above is a role pair (`base-content`, `base-content-muted`, `--ptah-link`, focus ring on a surface). The 677 audit measured those roles for all 34 themes, including the generated per-theme `--ptah-accent-ink`; this design adds no new role, so it inherits that coverage. The new open-tab alpha composite was measured only for the two Anubis themes; the visual reviewer should spot-check one light stock theme. `[designer-proposed]`

## 6. Motion and reduced motion `[project-rule: 677 design-spec 7]`

Easing `--ptah-ease-soft`. Only `opacity` and `transform` animate.

| Interaction | Spec |
| --- | --- |
| Open, dialog (>= 640) | scrim fades 160 ms; panel `opacity 0 -> 1` + `translateY(8px) -> 0`, 180 ms, `fill-mode: backwards` (no transform left afterwards) |
| Open, sheet (< 640) | `opacity` + `translateY(16px) -> 0`, 200 ms |
| Close | instant (no exit animation: the layer must not stay interactive while fading, and focus return happens in the same frame) `[designer-proposed]` |
| Row hover, action reveal | 120 ms background / opacity |
| Date chevron | 200 ms rotate |
| Running marker | `motion-safe:animate-pulse` (existing); skeleton pulse 2 s; Load More spinner 900 ms |
Reduced motion: `styles.css` already zeroes durations; the modal also sets `animation: none` on the panel, scrims, marker pulse, skeleton and spinner, so content appears instantly (no animation delay is used, so nothing can stay invisible). Verified in the prototype `checks`: zero running animations under `reduce=1`. `[project-rule: 677 design-spec 7.3]`

## 7. Tokens and re-skin map

No new token. Used: `surface-0..3`, `--surface-border`, `--surface-border-strong`, `--elev-shadow-raised`, `text-base-content`, `text-base-content-muted`, `--ptah-link` (exists: `S:` `--ptah-link` for dark gold / light gold-strong), `--ptah-ease-soft`, the focus ring (`S 684-709`), `text-state-err`, `bg-info`. Radii are explicit (`rounded-xl` panel 12, `rounded-md` row 6, `rounded-lg` fields 8): never `rounded-btn`, which is 2 rem in `anubis-light` `[project-rule: 677 design-spec D4]`.

| Delete | Add |
| --- | --- |
| `<aside>` session sidebar, `Sessions` tab, resize handle, width state (A-1..A-8) | `PreviousSessionsModalComponent`, the two entry buttons |
| `.sidebar-item-active`, `.sidebar-item-open-tab`, `.sidebar-scroll` and the `aside:not(:hover)` rule | `.session-row-current`, `.session-row-open-tab` |
| the Ptah icon header | modal title bar |
Icons (lucide-angular, `aria-hidden="true"`): `History` (entry + title), `X`, `Search`, `Funnel` (the existing Filters icon), `CalendarDays`, `ChevronDown`, `Tag`, `Pencil`, `Trash2`, `MessageSquare`, `Moon`, `CircleAlert`, `Pin`, `GitPullRequest`, `Bot`, `EllipsisVertical` only if the Rail trigger glyph `⋮` is ever replaced (not in this task).

## 8. Organize and Rename for live sessions in the canvas Rail `[user-requested]` D9

Source: `canvas-rail-card.component.ts:180-240` (trigger `⋮` `rail-actions-trigger` 24 x 24 expanded, 24 x 56 collapsed; menu in `ptah-native-popover` `placement="right-start"` with a transparent backdrop; items `Open beside`, `Move up`, `Move down`; `closeMenu()` restores focus to the trigger).

### 8.1 Menu `[user-requested]` D9

```
role="menu" aria-label="Session actions"   w-60 flex flex-col gap-0.5     (unchanged container)
  Open beside                               (unchanged)
  Rename            NEW  role=menuitem  aria-haspopup="dialog"   data-action="rename"
  Organize          NEW  role=menuitem  aria-haspopup="dialog"   data-action="organize"   (only when organizationAvailable())
  ---------------- separator (role="separator", my-0.5 h-px bg-surface-border)
  Move up           (unchanged)
  Move down         (unchanged)
```
Order groups the verbs: navigate, edit, arrange. Items reuse the existing classes (`btn btn-ghost btn-sm justify-start font-normal`; disabled draft variant uses the two-line `h-auto min-h-8 flex-col items-start justify-center py-1 text-left font-normal`). Text only, like the existing items (no icons). Arrow, Home, End navigation (`onMenuKeydown`) now covers the new items; Escape and backdrop close the menu and return focus to the trigger (existing). `Organize` is absent, not disabled, when organization is unavailable (VS Code), exactly like the modal row. `[user-requested]` D9
No Delete in the Rail. `[user-requested]` D9

### 8.2 Rename is a small popover, not inline on the card title `[designer-proposed]`

Why: (1) the card title lives inside `ptah-compact-session-card`, which is the card's select `<button>`; an `<input>` cannot sit inside a button (invalid nesting) and that card component is shared with other surfaces; (2) the collapsed 56 px Rail shows no title at all (`1`, a state dot), so an inline edit has nowhere to happen, and one mechanism for both forms is simpler and testable; (3) card height is fixed (`COMPACT_RAIL_CARD_HEIGHT`, 56 collapsed) and used for list layout, an inline field would change it; (4) the Rail already has this pattern: the `New session` named popover (`ptah-native-popover`, input + Cancel / Create, `app-shell.component.html:711-775`). Rename mirrors it.

Spec (mirrors the New session popover): `ptah-native-popover`, `placement="right-start"`, `hasBackdrop`, anchored to the same `Session actions` trigger. Panel `p-4 w-72 bg-base-200 border border-base-content/10 rounded-xl shadow-lg`; `h3` `Rename session` `text-sm font-semibold text-base-content-muted mb-3`; `input input-sm input-bordered w-full mb-3` (`maxlength="200"`, `aria-label="Session name"`, prefilled with the current title and selected); `Cancel` (`btn btn-sm btn-ghost flex-1`) and `Save` (`btn btn-sm btn-primary flex-1`). Rules identical to the modal row: trimmed, at most 200 characters, empty or unchanged closes without a call, `session:rename`, the open tab name and the card title update, a failed call keeps the title and is logged. Enter saves, Escape or a backdrop click cancels, the popover has no blur-save (it has explicit buttons). `[user-requested]` D9 (rules) `[designer-proposed]` (surface, no blur-save)

Sequencing: the menu item closes the menu first (`closeMenu()` returns focus to the trigger), then opens the popover; the popover component stores that trigger as its return target. 

### 8.3 Organize `[user-requested]` D9

Closes the menu (focus to the trigger), then asks the shell to set `organizingSession` to that session, so the same `ptah-session-organization-editor` opens as from a modal row (z 999, own scrim). The editor records `document.activeElement` on open, which is the trigger. The Rail (canvas lib) cannot import the shell: it emits `organizeRequested(tabId)` (like `openBesideRequested`), and the shell resolves the session. Architect detail. When the modal is open the Rail is inert, so both entry points never coexist.

### 8.4 Focus return `[user-requested]` D9 (task-description 10.3)

Rename closes by Save, Cancel, Escape or backdrop: focus to the card's `Session actions` trigger. Organize editor closes: focus to the same trigger. If the trigger is gone (the Rail re-rendered, or the card was removed): the card's select button (`.rc-select`, or the collapsed `.rail-collapsed` button); never `body`.

### 8.5 Draft or unsaved tile `[designer-proposed]` (task-description 10.4 asks the design to choose)

Decision: show `Rename` and (on organization hosts) `Organize` as disabled with a reason, not hidden. Reasons: the menu already uses disabled-with-reason (`Open beside`, `Move up/down`), a hidden item makes the menu change shape between cards, and a user who is looking for Rename on a new tile learns why it is missing. Disabled = `aria-disabled="true"`, focusable, click ignored, label and reason in muted ink (5.11 / 5.06) with `aria-describedby` pointing at the reason `Send a first message to save this session.` Detection: the tile has no persisted session id. Unlike the old items, the new disabled items do not use `opacity-60` (4.18:1 in light) so the reason stays readable.

### 8.6 Expanded and collapsed Rail

- Expanded: trigger unchanged (top-right of the card, 6 px inside). Menu and Rename popover open to the right of the Rail over the canvas (`right-start`).
- Collapsed (56 px, includes the 400 px window where the Rail auto-collapses): the trigger is the 24 x 56 cell next to the 32 x 56 select button; the same menu and popover open to its right. At 400 px the popover spans 60-348 px, inside the window (measured in the prototype). The Rename input shows the current title, which the collapsed card cannot.
- Sync: the Rail card, open tab and modal rows read the same store, so a rename or organize in either place shows in the other. `[user-requested]` D9 (10.6)

### 8.7 States table

| State | Rail menu | Result |
| --- | --- | --- |
| Persisted session, organization host | Rename, Organize enabled | as above |
| Persisted, VS Code | Rename enabled, no Organize | |
| Draft / unsaved tile | both disabled with reason (Organize absent on VS Code) | |
| Running session | enabled (renaming a running session is allowed, as in the modal) | |
| `session:rename` fails | title unchanged, logged | same as the modal row |

## 9. Parity cross-reference (`parity-inventory.md`)

| Rows | Where designed |
| --- | --- |
| A-1 | 2 (entry), 4.1 |
| A-2..A-8 | removed (D6); 3.1 (modal replaces), 7 (delete list) |
| A-9, A-10 | 3.2 (scroller), 3.3-3.4 (alignment on the 16 px header edge, rows at 10 px) |
| A-11 | 4.4 |
| A-12 | removed (D6); the Rail card chips keep board sessions' status |
| B-1..B-15 | 3.4 |
| B-16 | 4.4 |
| C-1..C-11 | 3.5-3.7 |
| C-12 | not designed, 10 D-11 |
| D-1 | 4.4 |
| D-2 | 3.10 |
| D-3 | 3.9, 3.12, 4.3 |
| D-4..D-9 | 3.9, 3.12, 4.3 (editor unchanged) |
| D-10, D-11 | 3.9 |
| E-1..E-6 | 3.11 |
| F-1 | 2.3 |
| F-3 | 2.1, 2.2 |
| F-2, F-4 | unchanged, no companion |
| task-description 10 (D9) | 8 |

## 10. Decisions

Format: decision, options considered, evidence, reversible.

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-1 | Modal follows pattern A with three differences (no `.modal-box`, real trap, z 990) | A as is; native `showModal()`; a new overlay | `session-organization-editor.component.ts:107-115`; `full.css` `.modal-box` transform, `.modal` z 999; popover z 40/50 | yes |
| D-2 | Reason text sits under BOTH footer buttons; footer 120 / 82 px | reason between the buttons (breaks "directly under"); auto-height footer (list jumps) | task-description Req 1.1; `canvas-rail.component.ts:231-251` | yes |
| D-3 | Collapsed Rail: reason becomes sr-only + `title` on New | keep visible (overflows 40 px) | 56 px Rail, 40 px footer | yes |
| D-4 | Navbar button in single layout only; grid layout uses the Rail | both in grid | D5; F-1; one opener per layout | yes |
| D-5 | Secondary style = ghost + hairline, label `Previous sessions`, `History` icon | outline button; text link; gold | skill rule one primary per surface; `New` is primary / gold | yes |
| D-6 | 720 px dialog >= 640 px, full-screen sheet below | 560 / 640 / 800; side drawer | 677 breakpoint 640; chips line fits; 400 px sidebar needs a sheet | yes |
| D-7 | Fixed panel height | content-fit | no jump while filtering | yes |
| D-8 | Single wrapping toolbar >= 640 (fallback: stacked as today) | stacked only | search 200 + Filters + 2 x 128 fits 560 px | yes |
| D-9 | Time stays on the meta line, actions at line 2 right, workflow badge inline after the title | time on the right; actions replace time | keeps the title full-width and time always visible | yes |
| D-10 | Active / open title accent `text-primary` replaced by bar + fill + weight | keep `text-primary` | measured 3.02 / 1.18 vs 4.5; a visible behaviour change, called out for the user | yes |
| D-11 | No unread marker | invent one | parity C-12: nothing exists to bind it to; the dot in the user's screenshot is the live-phase marker | yes (needs a data source first) |
| D-12 | Expired title, placeholder, No-match button re-inked (measured) | keep | section 5.2 | yes |
| D-13 | Sticky group headers | non-sticky | long list | yes |
| D-14 | Initial focus on search, caret at end | first row; select-all | task-description Req 2.1 only says "a control inside"; query survives | yes |
| D-15 | Focus returns to the opener after selecting a row (as written) | focus the opened session | task-description Req 2.5 | yes (follow-up) |
| D-16 | Backdrop closes only on pointerdown+click on the scrim | click only | text-drag safety | yes |
| D-17 | No exit animation | 120 ms fade | focus return and inert in the same frame | yes |
| D-18 | Row actions always visible on `hover: none` | hidden | no hover on touch | yes |
| D-19 | Load More focus and live status; result count status | silent | focus loss when the button unmounts | yes |
| D-20 | `ConfirmationDialog` gets Escape -> cancel | leave as is | template has no key handler | yes |
| D-21 | List opens at the top on each open | restore scroll | A-11 only needs query | yes |
| D-22 | Date range stays inline, two columns | popover | parity B-14, fewer layers | yes |
| D-23 | Rail Rename = popover mirroring New session; draft = disabled with reason; menu order; no blur-save | inline on the title; hidden for drafts | section 8.2, 8.5 | yes |
| D-24 | Prototype fonts: system fallback offline (Inter if installed) | embed a font | no network at file:// | n/a |

## Clarifications Needed

None. Every open point was settled above with evidence. Two are user-visible changes the user may want to veto at Gate 1.7: D-10 (active titles no longer primary-coloured) and the Rail footer growing by 36 px (D-2).

## 11. Notes for the architect (what the design needs outside the new component)

1. `ptah-session-filter-bar`: wrapper and class changes for the single-row toolbar and the muted placeholder (3.4). Fallback layout needs none.
2. `ConfirmationDialogComponent`: `(keydown.escape)` -> cancel (4.2).
3. Z-order: modal wrapper `z-[990]`; nested editor and confirm stay at the DaisyUI default 999; the panel must have no `transform`, `filter`, `contain` or `will-change` at rest, or the Filters popover is clipped (section 1). The visual review must open Filters at 400 px and on a short window.
4. `inert` on the shell row while open; `inert` on the panel while a nested dialog is open; a keydown wrap handler (4.1). The Rail (canvas lib) needs an output or a small service for `Previous sessions` and for `organizeRequested` (8.3).
5. Query state outside the modal lifetime (4.4).
6. Rail footer: height 120 / 82, button markup 2.1-2.2, `sr-only` reason when collapsed.
7. Icons come from `lucide-angular`; the prototype sprite is generated from the installed package (`prototype/assets/gen-sprite.mjs`).

## 12. Project rules applied

- WCAG 2.x contrast and the app focus ring (677 design-spec 8.2, 8.4); sheet / inert / wrap-handler pattern (677 8.3); breakpoint 640 (677 2.1); motion and reduced motion (677 7).
- No element carries both `class=""` and `[class]=""` (`@angular-eslint/template/no-duplicate-attributes`); use `[class.x]` toggles or `ngClass` with no static class on the same element. `[project-rule: task-description NFR]`
- Angular 22 standalone, OnPush, signals, `input()` / `output()`; DaisyUI + Tailwind tokens; lucide-angular. `[project-rule: task-description NFR]`
- Never `rounded-btn` for custom shapes; explicit radii. `[project-rule: 677 D4]`

## 13. Lane-introduced constraints

The `[designer-proposed]` rules that change something that exists today (everything else is new surface): Rail footer height 84 -> 120 / 82 and the reason moved below both buttons (2.1); collapsed-Rail reason `sr-only` (2.2); active / open title accent replaced (3.7); placeholder, expired title and No-match button re-inked (5.2); sticky group headers (3.5); Date range as two columns (3.4); action reveal always on for touch (3.9); Escape on the confirm dialog (4.2); Rail Rename as a popover and drafts disabled with a reason (8.2, 8.5). Each is reversible and each must be accepted at Gate 1.7.
