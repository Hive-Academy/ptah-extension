# Design Spec - Inspector side dock + Plan Limits cards (TASK_2026_699_833e)

Design system applied: existing Ptah themes `anubis` (dark) and `anubis-light`
(`apps/ptah-extension-webview/tailwind.config.js`), surface tokens (`src/styles.css:148-165`), DaisyUI classes.
No new token, colour or font is introduced. Prototype: `prototype/index.html`.

## Revision 3 changes (Gate 1.7 round 2, codex review)

1. Hit area (Serious): the 12 px hit area no longer straddles the boundary, so it cannot catch the 8 px chat transcript
   scrollbar (`chat-transcript.component.css:36-44,75-78`, `scrollbar-gutter: stable both-edges`). The `.split-slot` stays a
   0 px flex item (`relative z-10`); the handle is now `absolute inset-y-0 left-0 w-3`, i.e. entirely inside the dock's
   leading edge: the 1 px `border-left` plus the first 11 px of the dock's own 16 px padding (inspector header is
   `pl-4`, every section is `p-4`: `session-inspector.component.html:12`, section `p-4` classes), so no dock content,
   control or scrollbar is covered. z-index only lifts it above the dock's background. The 4x32 grip is centred in the hit
   area (6 px into the dock); the decorative 1 px line sits at the dock edge; the width readout opens inside the dock.
   `dockMax = shellWidth - 624` is unchanged and exact (slot has no width).
2. Non-expandable cards (Moderate): only expandable plan-window kinds render the disclosure `button` with
   `aria-expanded`/`aria-controls` and a panel. `status` and `local-usage` kinds render a non-interactive card (`div`,
   same `p-2.5` face, no chevron, no panel, no hover/focus affordance). The prototype helper `card(..., kind)` and the click
   handler (`.card-btn[aria-controls]`) enforce this, and a "Local usage" card demonstrates it. Rule restated in section 3.

## Revision 2 changes (Gate 1.7 round 1, codex review)

1. Geometry (Serious): the handle is an **overlay with zero layout width**. A 0 px flex item (`.split-slot`,
   `relative z-10`) sits between the main column and the dock; the handle inside it was `absolute inset-y-0 -left-1.5 w-3` (superseded by revision 3: now `left-0 w-3`, dock side only). Main column + dock = shell width exactly, so
   `dockMax = shellWidth - 624`, the 336 px default at a 960 px shell and the 724 px chat column at 1124 px are exact.
   Verified in the prototype (1440: shell 1124, main 724, dock 400). (Superseded by revision 3: the hit area is dock-side only.)
2. Rest affordance (Moderate): visible 4x32 grip, `w-1 h-8 rounded-full bg-base-content/60`, no hover needed.
   Measured non-text contrast (WCAG 1.4.11, 3:1): 5.94 dark / 4.45 light vs base-100, 4.18 / 3.35 vs the dock
   border strip. Hover grip `bg-base-content/80` (9.75 / 8.70), dragging solid `bg-base-content` (14.86 / 15.91).
   The 1 px line stays `bg-base-content/15` (decorative; the dock `border-left` is the boundary).
3. Contrast table now measures the actual solid `base-content` focus outline (section 4).
4. Expanded plan-window detail moves inside its card (section 3): the card is a container `div`, the disclosure
   `button` and the detail panel are siblings inside it, divided by `border-t border-surface-border`. Nothing in
   `plan-limit-tile.component.ts` forces the panel outside the button (it is already a sibling `div`, lines 47-168),
   so only the wrapper moves; the panel stays outside the `<button>` (block content is invalid inside a button).

## Decisions

| # | Decision | Options | Evidence | Reversible |
|---|----------|---------|----------|-----------|
| D1 | Tab label "Session" | "Inspector", "This session" | Rail tabs are one word ("Git", "Workspaces"); panel title stays "This session" | yes |
| D2 | Tab sits inside the chat-view host, outside `.cs-shell`, right of the dock; Git tab stays further right | inside shell | Band detection observes `.cs-shell`; an outside tab keeps the band stable when the dock opens and keeps the tab visible in sheet band (AC 1.3) | yes |
| D3 | Use `ptah-split-handle` visuals/semantics in both hosts; add an `inverted` input (dock is the pane AFTER the handle) | `ptah-electron-resize-handle` | Electron handle computes `innerWidth - clientX`, wrong with Git tab/dock to the right; split-handle already has keyboard, aria, Esc restore, dblclick reset | yes |
| D4 | Handle focus-visible = solid 2px `base-content` outline | split-handle `focus-visible:bg-primary/20` | Measured: primary on base-100 is 1.40:1 in light; solid base-content 15.91:1 light, 14.86:1 dark (section 4). Same rationale as `ROW_FACE` comment in `stats-tile.styles.ts` | yes |
| D7 | Handle overlays the pane boundary (zero layout width) | in-flow 6 px separator with clamp reduced by 6 | Keeps `dockMax = shellWidth - 624` exact and the 336 default at 960; no clamp arithmetic to get wrong | yes |
| D5 | Default widths 336 / 400 / 448 by shell width | single wide default | AC 4.3: Electron 1440 with Workspaces open gives a 1124 px shell (1440 - 32 - 220 - 32 - 32), so the large breakpoint must be <= 1124; 1100 chosen | yes |
| D6 | Value text stays in the card centre row; the header chip keeps the state text | drop one | Parity rows: chip (spec:91,214) and value (`plan-limit-tile-value`) both kept | yes |

## 1. Session tab (`ptah-sidebar-tab`, `sidebar-tab.component.ts`)

Used as `<ptah-sidebar-tab label="Session" side="right" [isOpen]="shell.open()" [badgeType]="..." (toggled)="shell.toggle()" />`, same as Git (`electron-shell.component.ts:380`).

| Aspect | Value | Source |
|---|---|---|
| Position | Last flex child of chat-view host, after `.cs-shell`; full host height; chat row order: main column, handle, dock, Session tab, then shell's Git tab | D2 |
| Size | `w-8` (32 px), `size="default"` | sidebar-tab.component.ts |
| Closed | `bg-base-200/60`, label `text-base-content-muted`, 10 px `font-semibold uppercase tracking-widest`, `writing-mode: vertical-rl` (right side: top-to-bottom), `border-l border-base-content/10` | same |
| Closed hover | `hover:bg-base-300/80`, label `group-hover:text-base-content` | same |
| Open | label `text-primary`; 2 px `bg-primary` line on the left (dock-facing) edge; `aria-expanded=true` | same |
| Focus | button default focus ring (existing atom behaviour) | existing |
| Badge dot | `badgeType`: `need` -> `warning`, `sel` -> `info`, limit `err` -> `warning`; `animate-pulse` | parity "closed-state dot" |
| Sheet band open | tab `inert` and dimmed by the modal state; visible in sheet band closed | AC 1.3, 1.4 |
| Hidden when | tiles / `'bare'` embeds, compact mode, forced card | parity |

Inherited, not changed: `text-primary` and the 2 px `bg-primary` line are weak in the light theme (1.40:1 label,
1.31:1 line, measured below); the same atom has this on Workspaces and Git. State is also carried by
`aria-expanded`, the title "Hide/Show Session" and the dock itself. Flag for a follow-up on the shared atom.

## 2. Dock, handle, widths

Dock element (`.cs-inspector`, `chat-view.component.css:17-26`): unchanged except width.
`width: <clamped>px`, `border-left: 1px solid var(--surface-border)`, `background: oklch(var(--b1))`,
`height: 100%`, `flex-shrink: 0`, `csInspectorIn` 220 ms `var(--ptah-ease-soft)`; animation off while dragging and under reduced motion.

### Handle (`ptah-split-handle` + `RESIZE_HANDLE_STYLES`)

| State | Visual | Source |
|---|---|---|
| Geometry | `.split-slot` 0 px flex item between main column and dock; handle `absolute inset-y-0 left-0 w-3` (12 px hit area entirely inside the dock's leading edge over its border and 16 px padding; never overlaps the chat pane or its scrollbar; adds no layout width) | D7 |
| Rest | 12 px hit area transparent; 1 px line `bg-base-content/15` (decorative); **4x32 grip `bg-base-content/60` rounded-full, always visible** (5.94 dark / 4.45 light vs base-100; 4.18 / 3.35 vs dock border) | split-handle classes; grip raised from `/0.15` in resize-handle.styles.ts for this host |
| Hover | line `bg-primary/60`; grip `bg-base-content/80`; `cursor-col-resize`; 150 ms | `group-hover:bg-primary/60`; styles.ts:`.resize-handle:hover::after` |
| Active/dragging | hit area `bg-primary/20`, line `bg-primary`; grip solid `bg-base-content`; body cursor `col-resize`, `user-select:none`; width readout pill (`bg-base-300`, `text-base-content`, 11 px, tabular-nums) at top of handle | `group-active:bg-primary`; new readout |
| Focus-visible | solid 2 px `base-content` outline (offset -1 px), `bg-base-content/8` fill, readout visible | D4 (new) |
| A11y | `role=separator`, `aria-orientation=vertical`, label "Resize session details", `aria-valuenow/min/max` = dock width / min / effective max | AC 2.1 |
| Keyboard | Left grows dock (it sits right of the handle), Right shrinks, 16 px step, Shift 48 px, Home = min, End = effective max; Esc during drag restores; double-click resets to default | split-handle `KEYBOARD_STEP`; D3 `inverted` |

### Widths (named constants next to `INSPECTOR_DOCKED_MIN_WIDTH`)

| Constant | Value |
|---|---|
| `INSPECTOR_MIN_WIDTH` | 300 (matches Git dock `min-w-[300px]`) |
| `INSPECTOR_MAX_WIDTH` | 560 |
| `INSPECTOR_MAIN_MIN_WIDTH` | 624 (960 - 336); handle is a zero-width slot with a dock-side overlay hit area, so it consumes none of it |
| effective max | `max(300, min(560, shellWidth - 624))` |
| `INSPECTOR_LARGE_SHELL_MIN_WIDTH` | 1100 (D5) |
| defaults | shell < 1100: 336; 1100-1499: 400; >= 1500: 448 |

Stored width is applied clamped, never overwritten by clamping (AC 3.3). Docked shell range 960-1100: dock 336 (max 336 at 960).
At 1440 Electron (Workspaces open): shell 1124, dock 400, chat column 724. Stored width is one shared value per install (Git dock pattern: `ElectronLayoutService`; the webview needs an equivalent store).

### Narrow widths (unchanged)

- 640-959 shell: modal sheet `absolute right-0`, `width: min(336px,100%)`, `z-30`, `box-shadow: var(--elev-shadow-raised)`, scrim `rgb(0 0 0 / .3)` `z-20`, main column `inert`, tab `inert`. No handle in sheet or full bands.
- < 640: `.cs-inspector--full` width 100%, no border.
- Sheet to docked: opens docked at stored/default width.

## 3. PLAN LIMITS card (`variant="inspector"`)

Section frame unchanged: `p-4 border-t border-surface-border`, heading `sec-label text-[10.5px] font-semibold uppercase`, refresh notice, shared caption + source chips row, list `grid gap-2`.

Card = container `div` (`relative overflow-hidden`, border/accent/surface below) holding the existing disclosure `<button>` (header + centre + footer; `aria-expanded`, `aria-controls`, rendered only for expandable plan-window kinds) and, as a sibling, the detail panel. **Rule:** `status` and `local-usage` kinds are non-interactive: a plain `div` card with the same face, no button, chevron, `aria-expanded`/`aria-controls` or panel. The button is `block w-full text-left p-2.5 border-0 bg-transparent`; hover `hover:bg-base-content/5` and the focus ring (`outline-2 -outline-offset-2`, inset so `overflow-hidden` does not clip it) apply to the button face only.

| Part | Classes / values | Source |
|---|---|---|
| Card container | `block w-full relative overflow-hidden rounded-md border border-surface-border bg-surface-1 border-l-2` + tone accent (`border-error` / `border-warning` / `border-info` / `border-transparent`) via `ROW_ACCENT`; drop `min-h-[56px]` and `pr-5` | plan-limit-tile.component.ts:189; `planRowClass` |
| Hover / focus (on the button) | `hover:bg-base-content/5`; `focus-visible:outline-2 -outline-offset-2` solid `base-content` | `ROW_FACE` |
| Row 1 header | `flex items-center gap-2 min-w-0`: label `min-w-0 flex-1 truncate text-xs text-base-content` (+ `title`); state chip `chipClass(tone) shrink-0` ("? Usage unknown" neutral, "50% used", warning at 82%), glyph `aria-hidden`; chevron `size-3 shrink-0 text-base-content-muted` in flow (no longer `absolute top-1.5 right-1`), ChevronDown closed / ChevronUp open | existing classes |
| Row 2 centre (own full-width row, `mt-2`) | Unknown / status: `block text-[11px] leading-snug text-base-content-muted`, wraps freely (`break-words`), text `value · resetLine`, `title` = detail lines. Known: `flex items-center gap-2`: bar + value | parity rows |
| Bar | `h-2 flex-1 rounded-full bg-base-content/10`, fill `usageBarFillClass` (`bg-success` < 75, `bg-warning` >= 75, `bg-error` error tone); `role=progressbar` + aria value/label/valuetext kept; never rendered when unknown | stats-tile.styles.ts |
| Value | `shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums` right of bar | existing |
| Reset line (known) | own line under the bar, `mt-1 text-[11px] leading-tight text-base-content-muted`, no `pl-[4.5rem]` indent | existing minus indent |
| Row 3 footer | `mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-base-content-muted`: caption (truncate closed, wraps open) + source chips (`sourceChipClass`: "Live event", "Provider API"; unofficial dashed italic). Omitted when the section header already shows the same caption/chips (current `captionShared`/`sharedSources` logic) | existing logic; no `pl-[4.5rem]` indent |
| Expanded panel | **inside the card**, sibling of the button (not inside it), below the footer row: `border-t border-surface-border px-2.5 pt-2 pb-2.5 text-xs`, no own box/background (replaces the `ROW_PANEL` box, which would double-frame inside a card), `hidden` while closed, `plan-window-detail` + detail lines | existing; see Revision 2 item 4 |
| Hooks | `data-tile-id`, `data-testid` (`plan-limit-tile`, `-status`, `-progress`, `-progress-fill`, `-tile-value`, `-chip`, `-caption`, `-panel`) unchanged | e2e spec |

Variants shown in the prototype: unknown (status text only, no bar), known 50% (neutral, success fill),
known 82% + expanded (warning accent, warning fill, footer chips, detail panel). The `strip` variant is untouched.

## 4. Contrast (measured; criterion WCAG 2.x AA: 4.5:1 text, 3:1 non-text; script `oklch -> sRGB`, surface-1 = 88% b2 / 12% b1 per styles.css:150)

| Pair | Dark | Light | Result |
|---|---|---|---|
| base-content on surface-1 | 14.01 | 14.41 | pass |
| base-content-muted on surface-1 | 5.71 | 5.46 | pass |
| base-content-muted on base-100 (dock bg) | 6.06 | 6.03 | pass |
| base-content on warning/15, success/15, error/15, info/15 chip fills | 11.31-12.59 | 11.64-12.71 | pass |
| Handle focus outline, solid `base-content` (2 px) vs base-100 / vs its own `bc/8` focus fill / vs surface-1 | 14.86 / 12.42 / 14.01 | 15.91 / 13.57 / 14.41 | pass (non-text) |
| Handle rest grip `bc/60` vs base-100 / vs dock border strip | 5.94 / 4.18 | 4.45 / 3.35 | pass 3:1 (non-text, 1.4.11) |
| Handle hover grip `bc/80` / drag grip solid vs base-100 | 9.75 / 14.86 | 8.70 / 15.91 | pass |
| Old rest grip `bc/15` (rejected) | 1.46 | 1.36 | fail |
| Bar fill vs track / surface-1: success | 4.12 / 5.30 | 1.75 / 2.14 | light fails 3:1; exempt because value text "50%" and chip "50% used" carry the data (also accepted in design §8 of `stats-tile.styles.ts`) |
| warning fill / error fill vs surface-1 | 6.23 / 3.62 | 2.22 / 3.23 | warning light same exemption |
| Warning / info chip border vs surface-1 | 6.23 / 4.75 | 2.22 / 2.35 | light below 3:1; text label carries meaning (existing `chipClass`) |
| Tab label `text-primary` open / active line | 3.59 / 3.45 | 1.40 / 1.31 | inherited atom weakness, state also in `aria-expanded` and title (section 1) |

Semantic colours are used only as borders, fills and accents, never text colour (project rule).

## 5. Parity

Every row of `parity-inventory.md` is kept; no capability removed. New: tab, handle, width state, card layout.
Tab and handle are absent in sheet/full bands (handle) and in tile/bare/compact/forced-card (both).

## Open items for the architect

- VS Code webview needs a persisted width store equivalent to `ElectronLayoutService` (`setEditorPanelWidth` pattern) and an `inverted` input on `ptah-split-handle`.
- Decide whether the chat host owns the width state or the shell controller does.
