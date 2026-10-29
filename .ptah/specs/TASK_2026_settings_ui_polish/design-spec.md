# Settings UI polish - design spec (presentation only)

Worktree: `.claude-worktrees/settings-ui-polish`, branch `refactor/settings-ui-polish`, from origin/main `ba0f98271`.
Host in scope: Electron only (CLAUDE.md). Design system applied: the existing Ptah/daisyUI v4 tokens in
`apps/ptah-extension-webview/src/styles.css` (`surface-1/2/3`, `base-*`, `base-content-muted`, glass roles `data-glass-surface`).
No new token, class family, color or font is introduced. `[project-rule]` = rule already enforced in the repo; everything else here is `[lane-proposed]`.

## 0. Scope guard (all sections)

- Allowed: template markup/classes, component `styles`, additive optional presentational inputs on leaf components (flagged in section 9).
- Not allowed: RPC, `ProvidersSettingsStateService`, stores, save/undo logic, tab ids (`claude-auth`, `orchestration`, `pro-features`, `tools`), outputs/handlers.
- Keep every `data-testid`, `aria-label`, `aria-labelledby` id, `data-focus` and `data-read-*` attribute. Where an element is removed, section 3 says where its testid goes.
- Fold gates in `settings-visual.e2e.spec.ts` (FOLD_BUDGET, Electron: tabs, map, heading bottoms at or under 660 px at 1024x768; card height at most 80 px; no overflow at 800 px) stay the pass line.

## 1. Evidence: what the "before" shots show

Shots: `screenshots/before/{providers,context}-{light,dark,glass}-{1024x768,1440x1000}.png` plus `-full.png` (viewport grown to the scroll height). Captured in the webview harness with the Electron host (see section 10 for the capture method and the deviation).

Findings, by concern:

1. Main agent is one of three equal "work nodes" in a Routing map. Its only action is `Reassign`, a 11 px underlined text link at the node bottom. Two scope badges push provider and model down. It does not read as the primary item.
2. Connections has three entry points that all open the catalog modal: header `Connect provider` (`connect-provider`), grid tile `+ Connect another provider` (`connect-another-provider`), hint strip `Browse catalog ->` (`data-focus="more-providers"`). Cards show `Used by N` only (no names), in 10 px mono.
3. CLI matrix uses `table-xs`, `px-1` cells, `text-[11px]` header, `btn-xs h-6` actions, `text-[9px]` badges. In narrow Electron mode rows get 2 px vertical padding, so rows read as cramped lines. At 1024 px with the Workspaces panel open the container is about 640 px wide and the Status and Provider columns are hidden.
4. Glass: sections built with `ptah-surface-section` (class `surface-1/2`) and the routing nodes (`bg-base-100`) have NO `data-glass-surface`. In glass they are opaque flat plates, unlike sibling Settings cards (`license-status-card`, `web-search-config`, `mcp-port-config`, `output-style-config`, `agent-behaviour-section`) that use `data-glass-surface="content"`. `glass-panel` / `glass-panel-divine` (styles.css:482) are legacy utilities used for the VS Code sidebar; do not use them in Settings.
5. Size: Settings has `btn-xs` x148, `text-[10px]` x16, `text-[11px]` x40, `text-[9px]` in the matrix; command-center (PR #840) uses `btn-sm` x16 / `btn-xs` x1, `text-xs`/`text-sm` for body, `text-[11px]` x9 only for micro-labels, no `text-[10px]` beyond one. The Settings page is the outlier.

## 2. Type and control scale (applies to every file below) `[lane-proposed]`

Sourced from command-center and canvas usage, and from the existing Settings sibling cards.

| Role | Classes | Replaces |
| --- | --- | --- |
| Page title (h1 "Settings") | `text-lg font-semibold tracking-tight text-base-content` | `text-base font-bold` |
| Section title (h2: routing map, Connections, matrix, background roles) | `text-sm font-semibold text-base-content` with icon `h-4 w-4 text-primary`; no `uppercase tracking-wider` | `text-xs font-bold uppercase tracking-wider` |
| Card title (h3: Session budget, Lane guards, groups) | `text-sm font-semibold text-base-content`; no uppercase | `font-bold uppercase tracking-wide` |
| Field label / row name | `text-sm font-medium text-base-content` | `text-xs font-bold`, `text-xs font-semibold` |
| Body / values | `text-sm text-base-content` (mono values: `font-mono text-xs`) | mixed `text-xs` |
| Helper / caption / hint | `text-xs text-base-content-muted` | `text-[11px]`, `text-[10px]` |
| Table header | `text-xs font-semibold uppercase tracking-wide text-base-content-muted` | `text-[11px] uppercase` |
| Badge | `badge badge-sm text-xs` | `badge-xs text-[9px]`, `text-[10px]` |
| Primary / secondary action | `btn btn-sm` (32 px) plus `btn-primary` / `btn-outline` / `btn-ghost` | `btn-xs h-6 min-h-6`, `btn-sm min-h-9` |
| Icon-only action | `btn btn-ghost btn-sm btn-square` (icon `h-4 w-4`) | `btn-xs btn-square h-5/h-6` |
| Inline row action ("Retry", "Tiers", "Test") | `btn btn-ghost btn-sm px-2 text-xs font-medium underline underline-offset-2` | `btn-xs h-6 text-[11px]` |
| Text input / select | `input input-bordered input-sm` / `select select-bordered select-sm` (h-8; drop `h-9 min-h-9`, `select-xs min-h-7`) | `h-9`, `select-xs` |
| Checkbox in matrix | `checkbox checkbox-primary checkbox-sm` (20 px; replaces the 18 px `input.cli-check` size rule) | 18 px custom |

Rules: no font size below 12 px in Settings (`text-xs` is the floor). `text-[11px]` and `text-[10px]` and `text-[9px]` are removed everywhere in `libs/frontend/chat/src/lib/settings/**` (the existing matrix spec already asserts `not.toContain('text-[10px]')`). Touch targets are at least 32 px (`btn-sm`); 24 px (`min-h-6`) is gone. Remove the redundant `min-h-9/min-h-7/min-h-6/h-6` overrides; keep the `focus-visible:outline ...` ring string (`FOCUS`/`focusRing`) unchanged `[project-rule]`.

Shell (`settings.component.html`):
- Tab buttons: `text-[13px] leading-5` -> `text-sm leading-5`; `py-2` -> `py-2.5`; keep every class used as a hook (`tab-active`, `surface-2/3`, `settings-tab`, `!border-primary`).
- Back button: `btn btn-xs btn-ghost p-1` -> `btn btn-sm btn-ghost btn-square`; icon `w-4 h-4` stays.
- Workspace/App line: `text-xs` stays.
- Security line (`custom-provider-security-copy`, `builtin-provider-security-copy`): `text-[11px]` -> `text-xs`; keep `truncate`, keep the `title` attribute, keep the dot. Place it inside the page rhythm: wrapper `mb-2` -> `mb-3`.
- Vertical rhythm of the page: shell `space-y-3` -> `space-y-4`; each tab body `gap-4` / `space-y-4` (already) so the gap between sections is 16 px everywhere.

## 3. Providers tab

### 3.1 Target layout (top to bottom, Electron)

```
[Settings h1 ........................ Workspace: x . App: y]
[ Providers | Context Management | Advanced | Search & Voice ]
. Runs 100% locally ... (text-xs, one line)
+-- surface section (glass: content) -------------------------------+
| Routing map (h2)  hint ...................... [ Operational ]      |
| +-- MAIN AGENT hero, full width, left accent --------------------+ |
| | * Main agent  [Active] [App override] [Workspace override]      | |
| | Provider: Claude (Subscription)  Model: Default (...)  Effort   |  [ Reassign ] primary btn-sm
| +----------------------------------------------------------------+ |
| +-- Background roles (tile) ---+ +-- CLI agents & matrix (tile) --+ |
| ------------------------------------------------------------------ |
| Connections (h2)  5 configured . 10 in catalog   [filter] [+ Connect provider]
| caption: 10 catalog providers ready to add: Claude API, OpenRouter... (text-xs, one line, no button)
| list: 1 column at 1024, 2 columns at 1440 (rows 64 px)             |
+--------------------------------------------------------------------+
+-- CLI Agents & Custom Instances matrix (glass: content) -----------+
+-- Background model roles <details> (glass: content) ---------------+
```

The outer card stays ONE `ptah-surface-section` with `data-testid="providers-routing-connections-card"` (tests query inside it). The two regions are separated by a divider, not by a second card.

### 3.2 `providers-settings.component.ts`

- Outer wrapper `div.py-3.space-y-4`: unchanged. `font-sans text-sm text-base-content` unchanged.
- `ptah-surface-section tone="subtle" padding="md"`: keep inputs; glass role comes from the component (section 5). Inner gap: the component's `gap-3` -> use `gap-5` for this card via host class `class="gap-5"` is NOT possible (it is a computed class); instead keep `gap-3` and add `mt-1`/`pt-4` on the Connections `<section>` (below).
- Main-agent region `div.space-y-2[data-testid=main-agent-region]`: unchanged.
- Placeholder (`routing-map-placeholder`): `min-h-[178px]` -> `min-h-[168px]`, `rounded-xl border border-base-300 bg-base-200/40` stays; add `data-glass-surface="tile"`.
- Read-error blocks (`readError`, `retryControl` constants at the file bottom, line ~968): `retryControl` from `btn btn-outline btn-xs min-h-6 ...` -> `btn btn-outline btn-sm border-base-content-muted text-base-content` + focus ring. `readError` text stays `text-sm`.
- Clear-override review panel (`section[aria-label="Review clear override"]`): `rounded-md border border-base-content-muted p-3 space-y-3` -> `rounded-lg border border-base-content-muted p-4 space-y-3`, add `data-glass-surface="tile"`; its buttons use `CONTROL` (see below).
- `CONTROL` constant (line 80): `btn btn-outline btn-sm min-h-9 min-w-6 ...` -> `btn btn-outline btn-sm ...` (drop `min-h-9 min-w-6`).
- Connections `<section>` (wrapper of the header and grid): add `class="border-t border-base-content/10 pt-4"`; existing `space-y-3` stays.
- Connections header row: keep `flex flex-wrap items-center justify-between gap-2`.
  - `h2#providers-connections-heading`: `text-sm font-semibold scroll-mt-4` -> `text-base font-semibold scroll-mt-4` (primary section of the page).
  - `connections-count` pill: `rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[11px] text-base-content` -> `badge badge-sm border-base-300 bg-base-200 text-xs text-base-content`.
  - Filter `input[data-testid=connections-filter]`: `input-sm h-9 min-h-9 w-44 ... text-xs` -> `input input-bordered input-sm w-52 border-base-content-muted bg-base-100 text-sm text-base-content` + focus ring.
  - `button[data-testid=connect-provider]`: `btn btn-primary btn-sm min-h-9 gap-1` -> `btn btn-primary btn-sm gap-1.5`; plus icon svg `h-3.5 w-3.5` -> `h-4 w-4`. This is the ONE connect entry point. Move `data-focus="more-providers"` onto this button (see 3.4).
- Empty/filter-empty paragraphs: `text-sm text-base-content-muted`; "Clear filter" `btn btn-ghost btn-xs min-h-6 ... underline` -> `btn btn-ghost btn-sm px-2 text-base-content underline`.
- Connections grid `div[data-testid=connections-grid]`: `grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3` -> `grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-2`. Result: 1 column when the page is about 640 px (1024 px window with the Workspaces panel open), 2 columns at 1440. Rows read as a list; no empty half row.
- Remove tile `button[data-testid=connect-another-provider]` (the `+ Connect another provider` tile). Redundant with the header button.
- Catalog hint `div[data-testid=catalog-hint]`: becomes a passive caption directly under the header row, no border, no fill:
  `<p class="flex min-w-0 text-xs text-base-content-muted" data-testid="catalog-hint">` with the existing `<span class="font-semibold text-base-content">{{lead}}</span>` and `p[data-testid=catalog-hint-text].min-w-0.flex-1.truncate` (keep the `truncate` class and the `title`). Remove the `Browse catalog ->` button. Keep the same `catalogHint()` text so the unit assertions on `textContent` of the hint still pass.
- Kimi login block (`providers-kimi-login`): `btn btn-outline btn-sm` stays.
- `p[role=status]` / `p[role=alert]` in the external-auth block: add `text-sm`.

### 3.3 `routing-map.component.ts` and `routing-map-node.component.ts`

`routing-map.component.ts`
- Outer `section[data-testid=routing-map]`: `rounded-xl border border-base-300 bg-base-200/40 p-3` -> `p-0 border-0 bg-transparent` (the surface-section card already frames it) with `space-y-3`; this removes the card-inside-card double border. Keep `aria-labelledby="routing-map-heading"` and the testid.
- Header: `h2#routing-map-heading`: `text-xs font-semibold uppercase tracking-wider text-base-content-muted` -> `text-sm font-semibold text-base-content`; icon `h-3.5 w-3.5` -> `h-4 w-4`. Hint span `text-[11px]` -> `text-xs`; add `hidden sm:inline`. Status pill (`routing-map-status`): `px-2 py-0.5 text-[11px]` -> `px-2.5 py-0.5 text-xs`.
- Grid CSS in `styles`: replace the three rules with
  - base: `.routing-map-nodes { display:grid; grid-template-columns: minmax(0,1fr); gap: 0.75rem; }`
  - `@container (min-width: 32rem)`: `grid-template-columns: repeat(2, minmax(0,1fr));`
  - always: `.routing-map-nodes > :nth-child(1) { grid-column: 1 / -1; }` (hero spans the row; the 48rem three-column rule and the `:nth-child(3)` full-width rule are deleted).
- Main-agent node markup: add the presentational input `variant="hero"` (new optional input, default `'default'`, on the node component) and keep every existing binding. Provider row:
  - label `span` `text-[11px] font-semibold uppercase tracking-wider text-base-content-muted` -> `text-xs font-medium text-base-content-muted` (copy "Provider:" and "Model:" unchanged);
  - provider value `text-sm font-semibold` -> `text-base font-semibold`; model value `font-mono text-xs font-medium` -> `font-mono text-sm font-medium`.
- Background roles list: `li` rows `text-sm`; right-hand value `font-mono text-[11px]` -> `font-mono text-xs`; `Default` `text-[11px]` -> `text-xs`.
- CLI agents preview: "Execution priority:" `text-sm text-base-content-muted`; order line `text-[11px]` -> `text-xs`; the separator arrows stay.

`routing-map-node.component.ts`
- New input `variant = input<'default' | 'hero'>('default')`. Pure class switch; no output or behaviour change.
- Node root div: `rounded-lg border border-base-300 bg-base-100 px-3.5 py-2.5 min-h-[88px]` -> default: `rounded-lg border border-base-300 bg-base-100 px-4 py-3 min-h-[96px]` + attribute `data-glass-surface="tile"`.
  Hero adds: `border-primary/40 border-l-4 border-l-primary px-4 py-3.5` and switches the inner flow to `flex-row flex-wrap items-center gap-x-6 gap-y-2` (default stays `flex-col justify-between gap-2`). Keep `has-[[role=dialog]]:z-30`, `hover:border-primary`, `focus-within:border-primary`.
- Title `h3[data-testid=routing-node-title]`: `text-xs font-bold uppercase leading-4 tracking-wide` -> `text-sm font-semibold leading-5` (hero: `text-base`). Title text stays "Main agent" (the DOM text is not uppercase-transformed in tests: keep copy as is).
- Status pill `routing-node-status`: `rounded bg-base-200 px-1.5 py-0.5 text-[11px]` -> `badge badge-sm bg-base-200 border-base-300 text-xs font-medium text-base-content`.
- Error Retry button: `btn btn-ghost btn-xs min-h-6 ... underline` -> `btn btn-ghost btn-sm px-2 text-base-content underline`.
- Footer row (`routing-node-footer` + action): `text-[11px] border-t border-base-content/10 pt-1` -> `text-xs border-t border-base-content/10 pt-2`. Hero: no border-top, footer text sits under the value grid, the action moves to the right column (`ml-auto`).
- Action button `[data-testid=routing-node-action]`: keep the `after:absolute after:inset-0 ...` stretch (whole node stays one target). Classes:
  - hero (Main agent): `btn btn-primary btn-sm gap-1.5 shrink-0` + the focus ring; label `Reassign`; icon `ChevronDown h-4 w-4` (not muted). `aria-label` unchanged. This is the easy-to-find Reassign: a filled primary button on the right edge of the hero.
  - default (Background roles "Inspect", CLI agents "Manage matrix"): `btn btn-ghost btn-sm gap-1 px-2 -mr-2 font-medium text-base-content` with chevron `h-4 w-4 text-base-content-muted`. The underline text link is removed.
  The hero button cannot be hidden by the badges: badge `[&_button]:relative [&_button]:z-10` rule is unchanged.
- Popover anchor div (`absolute bottom-0 left-0 h-0 w-0`) unchanged. Popover placement (bottom-start of the node) therefore opens under the hero's left edge.

### 3.4 `main-agent-reassign-popover.component.ts` and scope badges

- Presentation only: replace `btn-xs` (x11) with `btn-sm`, `text-[11px]` (x3) with `text-xs`, keep widths and handlers. Popover title `text-sm font-semibold`. Keep `role="dialog"`, `data-*`, labels.
- `main-agent-scope-badges.component.ts`: no `btn-xs`; set the badge buttons to `badge badge-sm text-xs` height at least 24 px (`min-h-6`) so they stay clickable; no text smaller than `text-xs`.
- Deep link `more-providers`: `focusTarget='more-providers'` resolves `[data-focus="more-providers"]`. The attribute moves from the removed `Browse catalog` button to `button[data-testid=connect-provider]`. The focus plus catalog-open behaviour (spec line 795) keeps working; only the unit assertion `textContent toContain 'Browse catalog'` must change to `'Connect provider'`.

### 3.5 `provider-connection-card.component.ts` (the connection list row)

`ptah-native-card density="compact"` stays (its root already has `data-testid="provider-connection-card"` on the element, `data-state`, `aria-label`). Add `data-glass-surface="tile"` on the `ptah-native-card` host. Target height 64 px, at most 80 px.

Row layout (two lines, left/right):
```
[avatar 32]  Name  (text-sm semibold)                 [* Status label]  [action btn-sm]  [modality badge]
             subtitle . Used for: Main agent, Memory curator (text-xs muted, truncate)
```
- Root wrapper `flex flex-col gap-0.5` -> `flex items-center gap-3 min-h-[40px]`.
- Avatar (`avatarClass()`): size from `h-7 w-7`-class to `h-8 w-8 text-xs` (edit the string returned by `connectionAvatarTone` only if it sets size; otherwise wrap with `shrink-0`).
- Name `p[data-testid=provider-name]`: `text-xs font-semibold leading-tight` -> `text-sm font-semibold leading-snug truncate`.
- Subtitle `p[data-testid=card-subtitle]`: `text-[10px] leading-tight` -> `text-xs leading-snug`.
- Modality badge `[data-testid=auth-modality]`: `badge-sm badge-outline ... text-[10px]` -> `badge badge-sm badge-outline text-xs`.
- Status line `[data-testid=status-badge]`: container `text-[11px]` -> `text-xs`; dot stays `h-1.5 w-1.5` -> `h-2 w-2`; `status-copy` text-base-content.
- Inline action (`inlineActionClass`): `btn btn-link btn-xs h-6 min-h-6 !px-0 text-[11px] ... underline` -> `btn btn-ghost btn-sm px-2 text-xs font-medium text-base-content underline underline-offset-2` + focus ring. The unit spec asserts `btn-xs` (line 164): update to `btn-sm`.
- "Used by N": keep `span[data-testid=used-by-count]` with the same text, restyle `font-mono text-[10px]` -> `text-xs text-base-content-muted` (no mono). Add a sibling `span[data-testid=used-for].min-w-0.truncate.text-xs.text-base-content-muted` showing the consumer labels. Data: `usage().byProvider[connection.id]` (already computed in the page) mapped to `.label`; new OPTIONAL input `usedByLabels: readonly string[]` on the card (default `[]`, flagged in section 9). When empty the span is not rendered, "Used by 0" stays.
- Connected-accounts badge: `badge badge-ghost badge-sm` -> keep, add `text-xs`.
- Spine/tone from `NativeCardComponent` unchanged (active card keeps its primary spine).

## 4. CLI Agents matrix (`ptah-ai/cli-orchestration-matrix.component.ts`, and its host `providers/agents-routing-settings.component.ts`)

Goals: row height 52 to 60 px, cell padding 12 px (wide) / 8 px (narrow), header 40 px, readable at 1024 (container about 640 with the Workspaces panel open, about 976 with it closed) and 1440 (about 1000).

- `ptah-surface-section` (`settings-cli-matrix`): unchanged inputs; glass role from the component (section 5).
- Section header (`div[section-header]`): `h2#cli-matrix-heading` -> `text-sm font-semibold normal-case`, icon `h-4 w-4 text-primary`; hint span `text-xs text-base-content-muted` (stays `cli-wide-only`); `Add Ptah CLI Instance` button: `btn btn-primary btn-xs ml-auto h-6 min-h-6 gap-1 text-[11px]` -> `btn btn-primary btn-sm ml-auto gap-1.5`, icon `h-4 w-4`. testid `cli-matrix-add` stays.
- Table wrapper `div.surface-2.overflow-x-auto.rounded-lg` -> `div.overflow-x-auto.rounded-lg.border.border-base-300` + `data-glass-surface="tile"`; remove the `surface-2` class from the wrapper (glass renders a tile; solid themes keep a visible fill through `bg-base-100`: add `bg-base-100`).
- Table: `table table-xs w-full ... [&_td]:px-1 [&_th]:px-1` -> `table table-sm w-full scroll-mt-4`. Cell padding is set in component styles (below) so that the wide/narrow rules are explicit.
- Header row `tr.cli-head`: `text-[11px] uppercase tracking-wide text-base-content-muted` -> `text-xs font-semibold uppercase tracking-wide text-base-content-muted`; add `bg-base-200/60`.
- Columns (`<th>` classes; widths apply in wide mode): On `w-12`; Agent / Instance `min-w-[11rem]`; Status `w-28`; Provider `w-40`; Model `min-w-[9rem]`; Effort `w-24`; Permissions & Safety `min-w-[8rem]`; Actions `w-28 text-right`. Column header text unchanged.
- Group header row (`tr.bg-base-300` / the "Uninstalled CLI agents (2)" toggle): button `btn btn-ghost btn-xs h-6 min-h-6 gap-1 px-1 text-xs font-bold uppercase tracking-wider` -> `btn btn-ghost btn-sm gap-1.5 px-2 text-xs font-semibold`; `py-0.5` -> `py-1`.
- Body rows `tr.cli-row`: keep classes `surface-2` / `surface-3` (matrix spec asserts them, lines 400-408) and every `data-*`. Row separation in component `styles`:
  ```css
  .cli-row > td { padding-block: 0.625rem; padding-inline: 0.75rem; vertical-align: middle; }
  .cli-head > th { padding-block: 0.625rem; padding-inline: 0.75rem; }
  .cli-row { border-bottom: 1px solid oklch(var(--bc) / 0.1); }
  :host-context(:root[data-glass='on']) .cli-row { background: transparent; box-shadow: none; }
  :host-context(:root[data-glass='on']) .cli-row.surface-3 { background: oklch(var(--bc) / 0.1); }
  .cli-row:hover { background: oklch(var(--bc) / 0.05); }
  ```
  (`--bc` is the daisyUI base-content channel already used by the glass layer, styles.css:2602.)
- Narrow mode `@container (max-width: 47.99rem)`: replace the `padding-block: 0.125rem` rule with `padding-block: 0.5rem; padding-inline: 0.5rem;` (rows about 52 px, was about 36 px). The Status/Provider columns stay folded under the agent name (`cli-narrow-inline`). The wrapper keeps `overflow-x-auto`; add table `min-w-[36rem]` in narrow mode as the safety net when Model, Effort and Permissions cannot fit: a horizontal scroll with all columns beats clipped text. Verify at 1024 with the panel open; if the table still scrolls there, hide the Permissions text behind its existing info icon via the existing `cli-col-narrow-hidden` pattern (no new data).
- Cell contents:
  - agent name line `font-bold` -> `text-sm font-semibold`; version `text-xs text-base-content-muted`;
  - status/provider badges `badge-xs h-auto ... py-0.5` -> `badge badge-sm text-xs`; instance sub-badges `text-[9px]` (x3) -> `text-xs`;
  - model/effort cell link (`CELL` const): keep `font-mono text-xs`, make it `text-sm`; `px-1` -> `px-1.5 py-1`; `max-w-[13rem]` stays;
  - `ACTION` const: `btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[11px]` -> `btn btn-ghost btn-sm px-2 text-xs font-medium text-base-content underline underline-offset-2`;
  - `MENU_ITEM` const: `btn-xs h-7 min-h-7` -> `btn btn-ghost btn-sm w-full justify-start px-2 text-sm font-medium`;
  - icon-only buttons (lines 632, 675, 773, 938): `btn btn-ghost btn-xs btn-square h-5/h-6 min-h-5/6 w-5/6` -> `btn btn-ghost btn-sm btn-square` (icons `h-4 w-4`);
  - line 968 `btn btn-outline btn-xs h-6 ... text-[11px]` -> `btn btn-outline btn-sm gap-1.5 text-xs`;
  - checkbox: replace `input.cli-check` 1.125rem rule with `checkbox-sm` and drop the `background-position: -1px 0` shim (re-check the tick is centered after the change; keep the shim if daisy's 20 px tick is off by 1 px).
- `ptah-agent-orchestration-config` strip (Max Concurrent, Order chips, Re-detect): `text-xs` labels stay; label `text-xs font-semibold` -> `text-sm font-medium`; chips `text-xs`; buttons `btn-xs` (x2) -> `btn-sm`; the `text-[11px]` caption -> `text-xs`. Number input `input-sm`.

### Background Model Roles (`agents-routing-settings.component.ts`)
- Summary row: title `text-xs font-bold uppercase tracking-wider` -> `text-sm font-semibold`; badge `badge-xs` -> `badge badge-sm text-xs`; helper `text-xs` stays; chevron `h-3.5 w-3.5` -> `h-4 w-4`; `[class]` summary padding `py-0` -> `py-1`.
- `CONTROL` const (line 34): drop `min-h-9 min-w-6`.
- `ptah-surface-section` glass role comes from the component. Read-error block: `rounded-md border ... p-3` -> `rounded-lg ... p-4` and `data-glass-surface="tile"`.
- Placeholder `min-h-[22rem]` stays; add `data-glass-surface="tile"`.
- `provider-consumer-assignments.component.ts`: `btn-xs` x3 -> `btn-sm`, `text-[11px]` -> `text-xs`, `text-[9px]` -> `text-xs`.

## 5. Glass, Light and Dark theme usage `[lane-proposed]`

Themes: stored/set via `ThemeService.setTheme(name)` which writes `data-theme` on `<html>`; glass themes also set `data-glass="on"` and `data-glass-mode="light|dark"` (`theme.service.ts:260-273`). Names used: Light = `light`, Dark = `dark`, Glass = `ptah-glass` (dark) / `ptah-glass-light`. Boot hint: `localStorage['ptah-theme-v2']`. Glass-only CSS is gated on `:root[data-glass='on']`; no `data-glass-surface` means no glass, so `surface-*` cards stay flat opaque plates in glass.

Role mapping (roles that already exist, `glass-roles.spec.ts` approves exactly `chrome, bar, overlay, content, tile, plate`):

| Element | Solid themes (kept) | Glass role to add |
| --- | --- | --- |
| Settings section cards (every `ptah-surface-section`) | `surface-1` (tone subtle) / `surface-2`, `rounded-xl`, `p-4` | `data-glass-surface="content"` on the component's `<section>` in `libs/frontend/ui/src/lib/surfaces/surface-section.component.ts` (stable fill, no blur, same as the sibling Settings cards) |
| Nested tiles: routing nodes, connection rows, matrix wrapper, read-error/clear-review panels, placeholders | `bg-base-100 border border-base-300` | `data-glass-surface="tile"` |
| Text-dense label backing (caption strips) | none | not needed; captions sit on the content scrim |
| Modals/drawers/popovers (catalog, setup wizard, add-instance, Reassign popover) | existing | already `overlay` (native modal/popover); do not add roles |
| Page canvas (`div.h-full.overflow-y-auto.bg-surface-0` in `settings.component.html`) | `bg-surface-0` | none; already cleared by the glass rules for shell planes |

Implementation for the shared component: in `SurfaceSectionComponent` add `data-glass-surface="content"` to the `<section>` element. In solid themes the attribute has no CSS effect, so Light and Dark are unchanged. All 8 consumers are inside `libs/frontend/chat/src/lib/settings` (providers x2, ptah-ai x4, advanced x1, settings x1); the only other file is the component's own spec. Border: keep the class border from `surface-1`; glass role paints its own edge, and the `:root[data-glass='on'] [data-glass-surface='content']` rule wins by specificity.

Do not: use `glass-panel` / `glass-panel-divine`; nest `content` inside `content`; set `backdrop-filter` or a fill in Settings CSS; use `bg-base-*` with opacity for a glass surface (use the role). `data-glass-surface` on `<tr>` is not allowed (position/isolation breaks table layout), hence the `:host-context(:root[data-glass='on'])` row rule in section 4.

Aligned with the app: command-center uses `tile` for nested blocks and `content` for reading planes; canvas/shell use `chrome` for panes. Settings is a reading page, so `content` + `tile` is the matching pair.

### Contrast (WCAG 2.1 AA, normal text 4.5:1; Settings has no stricter project standard)
Measured on the "before" build at 1440x1000 with the Electron shell by sampling computed text color against the screenshot pixel beside the text (temp spec `_tmp-settings-contrast.e2e.spec.ts`). These pairs are unchanged by this spec (same tokens: `base-content`, `base-content-muted`); the spec only enlarges the text:

| Pair | Light | Dark | Glass (`ptah-glass`) |
| --- | --- | --- | --- |
| Connections heading, `base-content` | 13.35:1 | 14.35:1 | 14.23:1 |
| Routing hint, muted | 5.65:1 | 6.26:1 | 11.84:1 |
| Card subtitle, muted | 5.65:1 | 5.65:1 | 10.59:1 |
| "Used by N", muted | 5.65:1 | 6.26:1 | 11.84:1 |
| Catalog hint, muted | 5.60:1 | 6.07:1 | 12.42:1 |
| Matrix header, muted | 5.60:1 | 6.26:1 | 11.70:1 |

All at least 4.5:1. Glass samples are the scrim pixel at the sampled point; the glass layer's own floors are pinned by `glass-scrim.spec.ts` (text scrim 0.50 light / 0.62 dark, tint floors 0.50 / 0.70) and ink by `state-ink-contrast.spec.ts`. Moving cards from opaque `surface-1` to `content`/`tile` in glass lowers fill opacity, so re-measure the same six pairs on the "after" shots (the temp contrast spec can be reused). `badge-outline` with `border-base-content-muted` and the `border-primary/40` hero accent are decorative (not text; WCAG 1.4.11 applies only if the border is the only cue: the hero is also labeled by its title).
Context tab pairs were not sampleable in dark/glass in this run (page scrolled out of the sampled region); the same tokens apply and must be re-checked in the "after" pass.

## 6. Context Management tab

Files: `ptah-ai/orchestration-settings.component.ts` (composition), `subagent-cache-ttl-setting.component.ts`, `session-budget-settings.component.ts`, `lane-guards-settings.component.ts`, `advanced/advanced-settings-group.component.ts`.

- Composition: `flex flex-col gap-4` stays. Placeholders (`min-h-[2.75rem]`, `rounded-xl border border-base-300 bg-base-200/40`): add `data-glass-surface="tile"`.
- All four cards are `ptah-surface-section tone="subtle" padding="md"` -> glass `content` via section 5. Add a section divider rhythm: header block `mb-3 border-b border-base-content/10 pb-2`.
- Card title: `h3` (session budget, lane guards, group titles): `font-bold uppercase tracking-wide` -> `text-sm font-semibold` (sentence case in CSS: just remove `uppercase tracking-wide`; text content unchanged so no copy test breaks).
- Header helper `p.mt-0.5.text-[11px]` -> `p.mt-0.5.text-xs`.
- Field labels (the bold xs labels above each input): -> `text-sm font-medium text-base-content`. Field helper/range text `text-[11px]` (x4-6 per card) -> `text-xs text-base-content-muted`. Grid: `grid auto-rows-fr gap-4 md:grid-cols-3` (session budget, line 224) -> `grid gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-3` (drop `auto-rows-fr`; with 3 fixed columns at a 640 px container the inputs were about 195 px wide; 2 columns at that width, 3 from `xl`). Apply the same grid classes in lane-guards and `advanced-settings-group` where they use `md:grid-cols-3`.
- Inputs: keep `input input-bordered input-sm join-item h-8 min-h-8 ... text-xs tabular-nums` -> `text-sm tabular-nums`. Unit addon (`btn btn-sm join-item h-8 min-h-8 ... text-[11px] font-normal`) -> `btn btn-sm join-item cursor-default whitespace-nowrap border-base-content/10 px-3 text-xs font-normal text-base-content-muted`. `select select-bordered select-sm h-8 min-h-8 w-full text-xs` -> `select select-bordered select-sm w-full text-sm`.
- TTL card (`subagent-cache-ttl-setting`): `select select-bordered select-xs min-h-7 w-full sm:w-72` -> `select select-bordered select-sm w-full sm:w-80 text-sm`; Reset/Apply button `btn btn-outline btn-xs min-h-7` -> `btn btn-outline btn-sm`. Render the row as label left, control right, `min-h-12`.
- "Reset"/"Restore default" buttons in session budget, lane guards, groups (`btn btn-outline btn-xs min-h-7 ...`) -> `btn btn-ghost btn-sm text-base-content underline`.
- Toggle: `toggle toggle-sm toggle-primary` stays (24 px wide track, acceptable); the toggle label text `text-xs` -> `text-sm`.
- Width: at 1440 the form uses the full 2xl shell. Cap the form width for readability on this tab only by adding `max-w-5xl` to the `div.flex.flex-col.gap-4` in `orchestration-settings.component.ts` (cards then align to the left; alternative: keep full width. Decision: add `max-w-5xl`, reversible).

## 7. Remaining Settings files touched only by the scale rule (section 2)

`provider-catalog-modal.component.ts`: `btn-xs` x5 -> `btn-sm`; `text-[10px]` x4 (row detail, custom-endpoint hint) -> `text-xs`; row hover/padding `p-2` -> `p-2.5`; provider name `font-bold` -> `text-sm font-semibold`. The modal root stays `overlay`.
`claude-lane-account-cell.component.ts`, `agent-orchestration-config.component.ts`, `setting-scope-row.component.ts`: same mechanical `btn-xs`->`btn-sm`, `text-[11px]`->`text-xs`.
Out of scope (not on the two tabs in this task): Advanced tab, Search & Voice tab, add-cli-instance modal, setup wizard, drawers (they will inherit nothing; the global scale rule can follow in a later task).

## 8. Which existing buttons become redundant

| Element | testid / hook | Action | How tests stay green |
| --- | --- | --- | --- |
| Grid tile `+ Connect another provider` | `connect-another-provider` | removed from the template | update `providers-settings.component.spec.ts` lines ~802-806 and ~961-965 to drop the tile from the opener list; reachability table only checks `catalog-hint` text |
| Hint strip button `Browse catalog ->` | no testid; `data-focus="more-providers"` | removed; `data-focus` moves to `connect-provider` | spec line 795-798 asserts the button text `Browse catalog`: change to `Connect provider`; focus + open behaviour preserved |
| Hint strip box | `catalog-hint`, `catalog-hint-text` | stays as a passive caption (same testids, same text, `truncate` kept) | spec lines 751-754 and 805, 832 pass unchanged |
| Routing node action underline link | `routing-node-action` | restyled (hero: primary button), same element | `[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]` (providers-settings.component.ts:1210) still resolves |
| Header `Connect provider` | `connect-provider` | stays: the single entry | unchanged |
| Empty state text | none | unchanged | unchanged |

## 9. Likely test and gate updates (not made here)

Unit specs (jest, `libs/frontend/chat`):
- `providers/providers-settings.component.spec.ts`: remove the tile from the opener loop (~802-806, ~965); `Browse catalog` -> `Connect provider` for the more-providers focus test (~795-798); `btn-xs` expectations (~961-962) -> `btn-sm`; column-count expectations if any.
- `providers/provider-connection-card.component.spec.ts`: `btn-xs` (line 164) -> `btn-sm`; add a case for `usedByLabels`.
- `providers/routing-map*.spec.ts`, `routing-map-node.component.spec.ts`: new `variant`, grid class changes, uppercase/`text-[11px]` string asserts if present.
- `ptah-ai/cli-orchestration-matrix.component.spec.ts`: row `surface-2` asserts still pass (kept); `table-xs` / `btn-xs` / `text-[11px]` class asserts, if any, change; the existing `not.toContain('text-[10px]')` guard (line 1226) stays and should be extended to `text-[9px]`/`text-[11px]`.
- `libs/frontend/ui/.../surface-section.component.spec.ts`: add the `data-glass-surface="content"` assertion.
- `apps/ptah-extension-webview/src/app/glass-roles.spec.ts`: roles remain within the approved set; the template scan should be re-run (no new role).
- `settings.component.spec.ts`: tab button class asserts, if any, for `text-[13px]`.

Webview e2e harness (`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings`):
- `settings-visual.e2e.spec.ts` `FOLD_BUDGET.electron`: `columnsAt1024: 2` becomes `1` (list rows); `maxBottom` 660 regions `tabs/map/heading` should now be easier (map shrinks: hero 96 px + two nodes in one row, versus hero + 2 rows before); the check `await expect(cards.nth(4)).toBeVisible()` stays; `heights <= 80` per card must be verified (target 64). `vscode` budget: untouched in intent (VS Code is out of scope per CLAUDE.md) but it shares components: run its fold test and leave it passing; if the 3-column VS Code requirement fails with `minmax(22rem,1fr)`, ask to relax it rather than fork the template.
- `settings-reachability.table.ts` / `settings-providers.e2e.spec.ts`: scenarios that click `connect-another-provider` or `Browse catalog`, and `catalog-hint` containText (line ~1372, still valid); routing map scenarios that read `routing-node-*` positions; matrix scenarios in `settings-cli-matrix.entries.ts` and `settings-routing-map.entries.ts` (row heights, popover anchor positions after row growth).
- `settings-orchestration.e2e.spec.ts` and `assertOrchestrationFold`: the Context tab becomes taller per section (label/helper sizes); re-measure its fold budget.
- Baseline captures `current-*`/`baseline-*` under `TASK_2026_555/screenshots` are intentionally not overwritten; new shots go to this task's `screenshots/after/`.

## 10. Capture method and deviations (for the "after" pass)

- Build under the verify lock succeeded: `nx build-dev ptah-electron` (55 s), `nx copy-renderer-dev ptah-electron` (167 s; includes the webview dev build).
- DEVIATION: the screenshots come from the webview-e2e-harness (Chromium + the real built Angular app + the existing live-shaped RPC fixtures, Electron host emulation, Workspaces panel open), not from the Playwright-Electron `ui` fixture. Reason: the `ui` fixture needs hand-written mocks for about 30 provider/agent/config RPC methods; the harness already carries them (`settings.fixtures.ts`, `settings-live-shape.fixtures.ts`: 5 connections, main agent on Claude (Subscription), 2 background roles overridden, 6 CLI agents) and is what the repo's own settings fold gates use. Same renderer, same CSS.
- Temp specs (DELETE BEFORE COMMIT):
  - `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/_tmp-settings-shots.e2e.spec.ts` (shots; `SETTINGS_SHOT_DIR=after` writes to `screenshots/after`)
  - `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/_tmp-settings-contrast.e2e.spec.ts` (contrast log lines `CONTRAST ...`)
  - Run: from `libs/frontend/webview-e2e-harness`: `node ../../../scripts/verify.mjs --exec --task settings-after-shots -- npx playwright test -c playwright.config.ts _tmp-settings-shots --workers=1` (needs `nx copy-renderer-dev ptah-electron` rebuilt first, since the harness serves `dist/apps/ptah-extension-webview/browser`).

## Decisions

1. Capture host: webview harness instead of the Electron `ui` fixture. Options: (a) `ui.mockRpc` for about 30 methods, (b) harness fixtures. Evidence: harness fixtures exist and are used by the repo's fold gates; same renderer. Reversible: yes.
2. One outer card for routing + connections, split by a divider (not two cards). Evidence: `providers-routing-connections-card` testid wraps both and tests query inside it. Reversible: yes.
3. Connections use 22 rem minmax list rows (1 column at 1024, 2 at 1440), not a card grid. Evidence: at the narrow Electron page width 2 columns of 15 rem leave 10 px mono text and no room for "used for". Reversible: yes.
4. Glass role added once inside `SurfaceSectionComponent`. Evidence: all 8 consumers are Settings sections; sibling Settings cards already use `content`. Alternative (per-consumer attribute) rejected as repetition. Reversible: yes.
5. Context tab width cap `max-w-5xl`. Reversible: yes (delete one class).
6. Interactive prototype under `prototype/` was not produced: the task brief asked for the spec and "before" screenshots only. Gate 1.7: use the "after" shots plus the visual reviewer instead; say so if a clickable prototype is required.

## Lane-introduced constraints

- Settings text floor 12 px (`text-xs`); touch target floor 32 px (`btn-sm`).
- Settings section cards use glass role `content`, nested blocks `tile`.
- Connections show consumer names ("Used for ...") when known.
- Single Connect-provider entry point.

## Risks that could drift into non-presentation work (flagged, not proposed)

1. `usedByLabels` input on the connection card: derived from the already computed `usage().byProvider`; no service change, but it is a new template binding in `providers-settings.component.ts` (needs a small `computed` map in the component class). If that is seen as logic, fall back to showing only "Used by N" and put names in the `title` tooltip.
2. `variant` input on `RoutingMapNodeComponent`: new optional input (presentational). The `main-agent` node is declared in `RoutingMapComponent`'s template, so no state change.
3. `SurfaceSectionComponent` is in `libs/ui` (shared lib): impacts typecheck/tests of every host that includes it; today only Settings uses it.
4. The `data-focus="more-providers"` move changes which element the deep link focuses (the Connect provider button) - a behavior-visible change of focus target, though a template-only edit.
5. The matrix at 1024 px with the Workspaces panel open may still need horizontal scroll or hiding Permissions text; the second fix is a data-visibility decision, not a style one: confirm with the user before using it.
6. `table-sm` and 8 px narrow padding make the matrix about 100 px taller; if a fold gate covers matrix rows, update it.
