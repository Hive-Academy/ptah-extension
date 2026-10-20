# Chat start screen · visual specification

Task: `TASK_2026_702_594d`. Applies to the zero-tile Chat board in Electron and VS Code. The single-chat empty state reuses the checklist only when its existing `showProjectSetup` input is true. This specification is paired with [the interactive prototype](prototype/start-screen.html), whose query switcher exposes every illustrated state. Gate 1.7 user approval is still required before implementation.

## Sources and design system

- Product theme: `apps/ptah-extension-webview/tailwind.config.js`, DaisyUI themes `anubis` and `anubis-light`. Use `bg-base-100`, `bg-base-200`, `bg-base-300`, `text-base-content`, `text-base-content-muted`, `btn-primary`, `btn-ghost`, `btn-outline`, `text-secondary`; do not use alpha on base-content text.
- Card treatment: `apps/ptah-extension-webview/src/styles.css:385-405`, `.surface-3` (`--surface-3`, `--surface-border-strong`, `--surface-highlight`, `--elev-shadow-raised`). The prototype reproduces those formulas in inline CSS.
- Layout choice: hybrid spotlight plus small repeated cards, from `.claude/skills/ui-ux-designer/LAYOUT-PATTERNS.md`. The action is the spotlight; three uniform recent sessions are the repeated units.
- Existing chrome and flows: `parity-inventory.md` and the current Electron screenshot. Tabs, rail, and Previous sessions remain. User decisions #9 and #10 remove the canvas dock and move its warnings onto the board.
- Aurora source: [Omnedia CSS](https://github.com/omnedia/ngx-aurora/blob/master/src/lib/ngx-aurora.component.scss), [template](https://github.com/omnedia/ngx-aurora/blob/master/src/lib/ngx-aurora.component.html), and [MIT license](https://github.com/omnedia/ngx-aurora/blob/master/LICENSE). The source uses repeating CSS gradients, blur, a radial mask, and a 60-second background-position animation. The local adaptation uses the project theme gold and warm light palette. Decision #12 supersedes #6.

## Layout and exact values

At 1440 × 900, keep the current 51px tab band, 32px workspace strip, and roughly 274px sessions rail; remove the 38px canvas dock so the workspace begins directly beneath the tabs. The board remains the only scrolling region (`overflow:auto`), with content centered at `max-width:780px`, `padding:58px 24px 70px`. The hero is `min-height:251px`: 45px emblem; 29px display heading; 13px supporting copy; 153px minimum primary button, 11px × 20px padding. Beneath it, center a `max-width:588px` content stack. The checklist has 21px horizontal inset, 18px top inset, 61px minimum rows, and 12px radius. The recent row uses three equal columns with 9px gap; each card is at least 84px high. Before ready, a quiet Setup tools row follows the checklist: 16px top gap, 11px label, and two outlined 11px text buttons with 7px by 10px padding. When ready, the same `.surface-3` card compresses to a one-line strip with 13px by 16px inset, a Ready label, and three compact actions; Recent sessions follows it. These dimensions are the directly inspectable prototype values, following the project's token colors and the skill's hybrid hierarchy.

At ≤1000px, rail width becomes 220px and board top padding 40px. At ≤850px, rail width is 190px, content inset 20px/top 25px, hero minimum 238px, heading 25px, and recent cards stack. At 800px the board shows the entire checklist and both rail footer actions without horizontal clipping. Below the visible window height, scroll the board, preserving the rail footer. The populated warning fixture places the notice at the full 780px board-content width above a neutral placeholder grid. The placeholder shows only the bounds of the existing tile area: 2 columns, 12px gap and 205px minimum height; at 850px and below the bounds stack. Existing session viewport chrome and data remain authoritative; the fixture specifies only the notice placement. Tab overflow in the 800px capture is existing chrome behavior and is outside this design.

The dock is absent in every board state. Its creation guards apply to the hero trigger on an empty board and to the rail footer trigger when tiles exist. The rail footer New session remains visible, with outline/secondary styling. The board New session is the sole filled primary action. The shared name popover anchors 10px below the invoking centre hero or sidebar footer button, clamped to the viewport and flipped above near the bottom; dismissal restores focus to that trigger. The prototype implements its anchor geometry; production keeps the existing shared creation path.

### Theme values

| Role | Dark `anubis` | Light `anubis-light` | Source |
| --- | --- | --- | --- |
| Canvas `--b1` | `#131317` | `oklch(97.788% 0.004 56.375)` | `tailwind.config.js`, `base-100` |
| Tab band `--b2` | `#1a1a20` | `oklch(93.982% 0.007 61.449)` | `base-200` |
| Card foundation `--b3` | `#242430` | `oklch(91.586% 0.006 53.44)` | `base-300` |
| Body `--bc` | `#e8e6e1` | `oklch(23.574% 0.066 313.189)` | `base-content` |
| Muted text `--bcm` | `oklch(66.509856% 0.007403 31.090978)` | `oklch(48.955188% 0.044796 348.478612)` | `--bcm` / `text-base-content-muted` |
| Primary button | `#2563eb` with `#f8f7f4` text | `oklch(85% 0.138 181.071)` with `oklch(36% 0.078 188.216)` text | `tailwind.config.js`: `anubis.primary` / `primary-content` and `anubis-light.primary` / `primary-content`; DaisyUI `btn-primary` |
| Gold decoration | `#d4af37` | `oklch(58% 0.132 75)` | `secondary` |
| Small gold text | `#d4af37` | `oklch(50% 0.12 72)` | `secondary` / `secondary-focus` |

The light New session fill is the theme's mint `anubis-light.primary`, not the gold `secondary` accent. The prototype `.primary { background:var(--p); color:var(--pc) }` matches DaisyUI `btn-primary` and measures 6.81:1 for its label.

Use `fontFamily.sans` for interface text and `fontFamily.display` for the hero heading (`Inter` and `Cinzel` with project fallbacks). The prototype is standalone, so installed system fallbacks apply when those fonts are unavailable. Its existing Ptah logo is embedded as a compact 128px WebP for the 64px display size. All interface icons use Lucide-style 24px SVG strokes at 1.8px; no emoji icon chips.

## Components and states

1. **Empty-board hero.** Emblem, “A fresh space to work,” one sentence, and New session. The button invokes `newSessionRequested` → existing `openNewSessionPopover()`. Keep pointer, Enter, Space, Escape, optional name, empty-name default, tile insertion, focus, rail reset, and final guard recheck. At running cap or tile limit, leave both hero and rail controls focusable with `aria-disabled`, a visible reason, and `aria-describedby`. Tile-limit reason takes precedence in rail; blocked Create reports through the inline board notice with `role=status` for the create-limit header message; layout-write failure and newer-version notices use `role=alert`.
2. **Board notice.** Place one slim, local, dismissible notice in normal document flow before the hero in the board content. It pushes the hero downward when shown and is never fixed, absolute, sticky, or presented as a snackbar: `max-width:588px` on an empty board and full board-content width (`780px` maximum) above populated tiles, `min-height:48px`, `padding:10px 12px`, 8px radius, `background:var(--surface-3)`, `border:1px solid var(--need)`, `box-shadow:none`, `color:var(--bc)`. Use an alert icon and labelled Dismiss notice button. It displays one active warning at a time with its exact source text: layout write failure, newer-version read-only layout, or `headerMessage` for create-limit feedback. Dismissal is local to the current condition; the notice may recur on a later board entry or source condition refresh while still true. The notice belongs to the board content outside the zero-tile hero condition, so it persists above session tiles on a populated board. The prototype exposes `?state=layout-warning&warning=save|newer|header` for the empty board and `?state=layout-warning-tiles&warning=save|newer|header` for three populated-board fixture tiles; the warning selector works in both. No second toast or dock status line accompanies these warnings.
3. **Aurora.** A decorative CSS gradient layer sits behind the visible empty-board hero, with `pointer-events:none` and `aria-hidden=true`. The theme wash remains behind it. The gradient is absent when board tiles are shown. It never intercepts controls.
4. **Get ready.** One `.surface-3` card with title, a brief project understanding sentence, and `N of 2 ready`. Only Skills and Agents contribute to the count. Skills is confirmed ready only after `PluginCatalogService.isLoaded()` and `hasEnabledPlugins()`; loading stays unknown. "Open Library" uses `AppStateManager.openMarketplace({page:'skills',source:'ptah-plugins'})`. Agents uses real `setup-status:get-status` with configured, update, loading, no-workspace, failure/retry states; a confirmed “update available” agent counts as ready while its action reads Update, while loading/unknown for either counted signal suppresses the numeric count and announces “Checking readiness”; Configure/Update invokes `setup-wizard:launch`. Project scan is an action row with `Run setup`, not a readiness state: do not give it a checkmark, status, or count contribution. Run setup invokes the existing setup path. When Skills and Agents are both confirmed ready, collapse this same card to a one-line **Ready** strip. The strip keeps Run setup, Generate agents, and Project guidance visible; it does not disappear. The `all-ready` prototype illustrates this two-signal condition with three visual-fixture recent sessions.
5. **Recent sessions.** Render zero to three confirmed persisted sessions from `ChatStore.sessions`, in descending `lastActivityAt` order, scoped to the active workspace. Each accessible card opens through existing session history/open behavior. Hide the section while loading or empty. No dialog query mutation and no fixture data in production. Prototype sample names are visual fixtures only. The Sessions rail lists tiles currently open on this board, not the persisted history collection. Thus the zero-tile board rail says "Board sessions" and "No sessions on this board" even when Recent sessions contains three historical cards. Previous sessions still opens the full history dialog.
6. **Setup tools.** Before both counted items are ready, show **Generate agents** and **Project guidance** as outlined secondary actions immediately below the card; Run setup remains the Project scan action row inside it. Once ready, all three actions move into the compact Ready strip. In single-chat, show the same actions wherever the shared card appears. Generate agents and Project guidance use `GenerationWorkflowLauncherService.open` with `workflow:'setup-agent-generation'` and `workflow:'setup-project-prompt'`, respectively, plus the existing active-workspace selection and `origin:'independent-start'`. Disable both while `launching()`; expose failed launch feedback through `role=alert`, matching the current widget. These actions do not change the `N of 2 ready` count.
7. **Single-chat empty state.** In `chat-empty-state.component.ts`, keep the existing sequence: Ptah icon (64px at normal width, 48px at narrow width), `h1` “Ptah” (24px / 18px), tagline (14px / 12px), shared card and Setup tools, prompt suggestions, then decorative footer. The card appears only when `showProjectSetup` is true, and uses the same readiness derivation, count, rows, actions, and Ready strip as the board. At normal width the scroll panel centers a `max-width:512px` column with 24px side padding and 20px vertical gaps; card width fills this column. Prompt suggestions remain below the card and retain their existing component behavior; the prototype shows three illustrative prompts. No board New session hero, recent cards, or sessions rail is added here. The same Aurora treatment appears behind the single-chat brand area at reduced opacity; it stays decorative and never obscures text or controls.

The narrow treatment uses `container-type:inline-size` on the single-chat scroll panel, not a viewport media query. At container width `<=360px` (including the 280px VS Code sidebar), use 12px outer inset, a 48px icon, 16px vertical gaps and a card with 12px side/14px top inset. The count pill wraps beneath the title and introduction. Each checklist row becomes two tracks: 20px icon and flexible label/status, then a full-width 11px action button on the next line. Setup tools use a full-width vertical stack. The Ready strip places its label above three full-width actions, one action per line at 280px. The panel scrolls vertically; no horizontal overflow or clipped action is allowed. The prompt suggestions follow the entire card and remain operable. `dark-single-chat.png`, `dark-single-chat-280.png`, `dark-single-chat-ready-280.png`, and `light-single-chat.png` illustrate the shared card before and after readiness at both widths.

### Aurora treatment and lifecycle

Port the CSS construction in Omnedia `ngx-aurora.component.scss` locally: two layered `repeating-linear-gradient(100deg, ...)` backgrounds, `background-size:300%,200%` on the blurred light layer, `200%,100%` on its `::after`, a radial mask, and a `60s linear infinite` `background-position` animation from `50%` to `350%`. Adapt its color stops to `secondary` gold (`#d4af37` dark; `oklch(58% 0.132 75)` light) and neighboring warm hues. In production, derive the Aurora stops from DaisyUI `secondary` and `base-100` with `color-mix`; the hex stops in the prototype are tuning values. Board layer height is 570px and opacity .24 dark / .33 light. The single-chat layer is 300px high, .14 opacity and centered behind the logo, including the 280px panel. The `--hero-wash` theme background remains visible when animation is paused. Keep all text opaque `--bc` or `--bcm`; the gradient is decorative and is capped by measured 4.5:1 minimum contrast over its full text boxes.

Use `animation-play-state:paused` when the tab is hidden, the surface is hidden, or its intersection observer reports it offscreen; resume only when visible. `prefers-reduced-motion:reduce` removes the animation while retaining the still gradient. Treat the explicit reduced-motion fixture the same way. This follows the source component's offscreen pause behavior. The production implementation should use current Angular standalone component patterns and live theme tokens; the standalone prototype contains only CSS and small visibility wiring.

The implementer checks CPU usage once in Electron and may replace the `background-position` animation with a transform-based shift if repaint cost warrants it. The prototype's `.62` disabled and `.55` native-disabled opacity rules are prototype-only and must never become `text-base-content/NN` alpha classes in production.

Ship the full upstream MIT notice as a plain-text `.txt` third-party notice, following `libs/frontend/ui/src/lib/native/brand-mark/brand-icons-notices.txt` and the packaging check in decision #7. The entry is **Omnedia ngx-aurora â€” MIT â€” Copyright (c) 2024 Omnedia**, points to `https://github.com/omnedia/ngx-aurora`, and includes the complete license text. The prototype copy is [`prototype/aurora-notices.txt`](prototype/aurora-notices.txt); production places the notice in its package assets.

## Keyboard and assistive technology

The board `<main>` comes before the rail `<aside>` in DOM order, while CSS positions the rail to the left. Within main, the focus sequence is board New session, Skills action, Agents action, Project scan Run setup, Setup tools, recent cards, and then rail New session / Previous sessions. A shown warning and its Dismiss control precede the hero because the notice is earlier in document flow. Global tabs remain the host’s preceding navigation. The hero uses `h1`; Get ready and Recent sessions use `h2`, and the single-chat Ptah title is `h1` with its suggestion heading `h2`. The ready count has `aria-live=polite`; unknown/loading is announced as “Checking readiness” without a misleading number. Layout-write and newer-version notices use `role=alert`, while the create-limit `headerMessage` and creation reason use `role=status`. Decorative Aurora and footer are `aria-hidden=true`. The popover has a labelled dialog, focuses its optional-name input, and returns focus to the invoking button on Cancel/Escape; production retains the existing creation flow. Reduced motion keeps a still Aurora gradient. Keep visible focus indicators and accessible names on every action. In single-chat, focus follows card actions, setup tools, then prompt suggestions. WCAG 2.2 AA normal-text contrast is >=4.5:1 in both themes.

## Contrast

WCAG 2.2 AA normal text criterion: ≥4.5:1. Measured by `prototype/check-contrast.js` in Chromium using actual resolved colors and the relative-luminance equation. The card is the rendered `--surface-3` color. No base-content alpha is used.

| Foreground / background (Aurora rows: worst of 3 phases at 0, 20, 40s) | Dark | Light |
| --- | ---: | ---: |
| Body / base-100 | 14.86:1 | 15.92:1 |
| Muted / base-100 | 6.05:1 | 6.04:1 |
| Body / surface-3 | 12.46:1 | 13.33:1 |
| Hero title / darkest contrast pixel in its box over Aurora gradient | 11.15:1 | 14.84:1 |
| Hero supporting text / darkest contrast pixel in its box | 11.96:1 | 15.25:1 |
| Running-cap reason / darkest contrast pixel in its box | 12.39:1 | n/a |
| Single-chat title over Aurora gradient | 6.46:1 (280px) | 5.52:1 (280px) |
| Single-chat tagline over Aurora gradient | 4.92:1 (280px) | 5.83:1 (280px) |
| Single-chat `.row-state` / surface-3 | 9.76:1 (280px) | 11.62:1 (280px) |
| Muted / surface-3 | 5.07:1 | 5.06:1 |
| Board notice text / surface-3 | 12.46:1 | 13.33:1 |
| Primary-content / primary button | 4.82:1 | 6.81:1 |
| Small gold text / surface-3 | 7.39:1 | 4.83:1 |

Hero title, supporting text and disabled-action reason use `text-base-content` in both themes because the gradient alters their background. `prototype/check-contrast.js` measures each complete text box with its text temporarily hidden over the rendered background in Chromium. The listed Aurora values are the worst of 3 phases in the 60-second cycle (0, 20, and 40 seconds). The original light `secondary` on `surface-3` measured 3.45:1; small light-theme gold text uses the existing `secondary-focus` value. Decorative gold icons may use `secondary`.

## Icon map

All icons are Lucide line icons, 24px viewBox, 1.8px stroke, and `currentColor`. Use 16px display size unless noted.

| Surface | Lucide icon | Size / role |
| --- | --- | --- |
| Chat tab | `LayoutGrid` | 14px navigation |
| Hero emblem | `Sparkles` | 25px decorative, hidden from assistive tech |
| Hero and rail creation | `Plus` | 14–16px; action text supplies accessible name |
| Skills | `BookOpen` | 14px readiness row |
| Agents | `Bot` | 14px readiness row |
| Project scan action | `ScanLine` | 14px; action marker only, never a ready check |
| Verified row | `Check` | 14px state symbol; keep visible “Ready” text |
| Previous sessions | `History` | 14px rail action |
| Board notice and dismissal | `TriangleAlert`, `X` | 16px notice icon, 14px dismiss control |
| Other existing tabs | `Mic`, `LayoutGrid`, `SquareCheck`, `Scale`, `ChartNoAxesColumn`, `Wrench` | 14px, existing labels retained |
| Top utility controls | `CodeXml`, `Printer`, `Settings`, `CircleMinus`, `Bell` | 15px, existing positions retained |

## Parity map

Each row follows `parity-inventory.md` in order. ?Removed? rows follow user decisions #9 and #10; functional replacements are stated explicitly.

| Existing capability | New design location / behavior |
| --- | --- |
| Zero-tile board title and explanation | Centre hero only when active board has zero tiles |
| Board scrolling | `.board { overflow:auto }` |
| Board shared create request | Hero New session emits existing shared request |
| Focusable running-cap guard | Hero `aria-disabled`, visible reason, `aria-describedby`, guarded activation |
| Dock New Session guard | Dock trigger removed; hero trigger when empty and rail footer trigger with tiles carry accessible title, caps and disabled reason |
| Anchored optional-name popover | Shared popover anchors to invoking hero or rail button; optional name, Enter, Escape, Cancel, backdrop, close and focus return retained |
| Default name, cap recheck, add/focus/reset | Existing shared Create handler and final guard recheck |
| Blocked create status | Inline dismissible board notice with `role=status` and exact `headerMessage` text |
| Rail footer action, expanded/collapsed | Persistent secondary rail footer, accessible collapsed label |
| Rail tile-limit precedence, cap reason | Rail `aria-disabled`, visible/screen-reader reason; tile-limit takes precedence |
| Rail ?No sessions yet? | ?No sessions on this board? describes only active board tiles, in expanded and collapsed accessible text; persisted history appears under Recent sessions |
| Previous sessions dialog and focus marker | Existing rail footer trigger, state and focus restoration |
| Skills warning only after catalog load | Skills row loading/unknown/needs/ready; no premature warning |
| Marketplace Skills route | Skills Open Library -> existing Marketplace Skills route |
| Intelligent Project Setup explanation | Get ready intro, Project scan action row, and setup wizard |
| Auto-detect, VS Code AI, MCP Server badges | Preserve these capabilities in the existing setup wizard reached through Run setup; do not replace them with an unsupported checklist status |
| Agent status, Configure/Update/retry/no-workspace | Agents row state and action variants using existing signals |
| Wizard launch | Agents Configure/Update and Project scan Run setup use existing `setup-wizard:launch` path |
| Generate agents, failure feedback | Visible secondary Generate agents action under checklist before ready and in Ready strip after; existing workflow, launching and failure feedback |
| Project guidance, failure feedback | Visible secondary Project guidance action under checklist before ready and in Ready strip after; existing workflow, launching and failure feedback |
| Shared card on single-chat with `showProjectSetup` | Same Get ready checklist under the existing condition |
| Single-chat logo/title/tagline/suggestions | Existing single-chat frame and suggestions |
| Single-chat hieroglyphic footer | Existing single-chat footer |
| Dock vertical footprint | Remove dock; workspace/session viewport gains 38px |
| Back-office ticker and Thoth click target | Remove canvas ticker and target by user decision; Thoth remains reachable from its own page |
| Needs-you chip mount and placeholder | Remove from canvas after TASK_2026_593_7c2e bell replacement merges; no prototype chip |
| Needs-you chip permission/session popover | TASK_2026_593_7c2e bell supplies attention and lane-permission actions before chip deletion |
| Needs-you queue implementation/spec files | Delete in implementation's final phase after replacement bell merges; no prototype queue |
| Layout write failure warning | Inline dismissible board notice above the hero or populated board tiles: Board layout could not be saved. Changes stay for this session. |
| Newer-version read-only warning | Same notice above the hero or populated board tiles: This board layout was saved by a newer Ptah version. Changes here are not saved. |
| `headerMessage` create-limit warning | Same notice above the hero or populated board tiles, with exact emitted header message and status semantics |

## Deviations from the current screenshot

- Replace three competing filled New session actions with one filled board action and one outlined rail action; remove the entire dock.
- Replace the orange Skills warning and gold glass setup card with one raised `surface-3` card counting Skills and Agents. Project scan is an uncounted Run setup row. Once both are ready, the card becomes a compact Ready strip with Run setup, Generate agents, and Project guidance.
- Add calm, warm gold Aurora gradients behind the board hero and single-chat brand, with a still reduced-motion state.
- Add compact recent-session cards only when confirmed records exist.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the existing anubis themes and raised surface | Re-theme; use current tokens | `tailwind.config.js`, `styles.css`, current screenshot | Yes |
| Hybrid centered hero and checklist | Multiple primary cards; current stacked cards | One dominant create task, two counted readiness rows and one setup action row; layout skill | Yes |
| Keep project scan as an uncounted action | Count scan as ready; show it as Run setup | Orchestrator requirement round 2; no independent scan completion field | Yes |
| Use existing `secondary-focus` for light gold text | Raw `secondary` text | Measured 3.45:1 vs 4.83:1 on card | Yes |
| Adapt upstream Aurora CSS with MIT notice | Add dependency; port local CSS | User decision #12 and verified upstream CSS/template/license | Yes |
| Keep generation actions reachable in both card forms | Place only inside expanded card; remove when ready | Current `setup-status-widget.component.ts:129-147,255-281` exposes both workflows when agents are configured | Yes |
| Collapse card when both counted signals are ready | Hide card entirely; wait for scan completion | Orchestrator requirement round 2; Skills and Agents provide the two real statuses | Yes |
| Separate board tiles from persisted recent history | Show recent history in rail; show only board tiles in rail | `ChatStore.sessions` supplies recent history; the rail is the board tile list. Orchestrator round 3 exposed contradictory empty copy. | Yes |
| Use low-opacity warm gradient bands | Stronger bands | Theme contrast measurements and user request for a calm treatment | Yes |
| Use theme gold and warm neighboring stops | Cooler source colors | Theme tokens and source gradient construction | Yes |
| Remove the canvas dock and move warnings to the board | Retain dock; remove dock and keep warnings local | User decision #9 and #10 in `decisions.md`; ticker and chip removed, three exact warning texts retained | Yes |

## Lane-introduced constraints

none. All implementation behavior constraints above come from the accepted task, parity inventory, existing project sources, or measured accessibility criterion.
