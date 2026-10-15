# Design Spec: Clean session view and "This session" inspector (TASK_2026_677_efcd)

Status: Gate 1.7 revise round 1 (text of this spec; findings 1-8 of `design-spec-review.md` and findings 1-2 of `task-description-review.md`
are answered in place, see "Revision round 1" at the end). Visual source of truth: `prototype/index.html` (+ `prototype/screenshots/`).
Reference targets: `reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png`.
Design system applied: the app's own Anubis system (DaisyUI themes `anubis` dark and `anubis-light`, semantic surfaces, `text-state-*`
ink tokens, `--bcm` muted text, Inter / JetBrains Mono). No new colour, font or radius is introduced; two small token additions are
proposed in section 1.6 and are marked `[lane-proposed]`. Theme scope: contrast is measured for `anubis` and `anubis-light` only; every other
theme-picker theme is a T4 follow-up (section 8.2). Intentional departures from the reference images are listed in section 2.2.

How to read values: every value names its source. `T:` = Tailwind utility or colour already in
`apps/ptah-extension-webview/tailwind.config.js`; `S:` = custom property in `apps/ptah-extension-webview/src/styles.css`;
`C:` = `libs/frontend/chat/src/lib/components/templates/chat-view.component.css`; `ref` = measured from the reference PNGs.
Pixel numbers are CSS px at 1x (inspector measured 337 px wide in the reference, specified as 336).

---

## 1. Token map

### 1.1 Colour (all via tokens; no raw hex in components)

| Role | Token / utility | Dark (anubis) | Light (anubis-light) |
| --- | --- | --- | --- |
| App canvas, header, inspector | `bg-base-100` / `--surface-0` (S) | #131317 | cream 97.8% |
| Composer card, chips | `--surface-1` (S) -> `bg-surface-1` (T) | b2 88% over b1 | same rule |
| User bubble, selected row, hover chip | `--surface-2` (S) -> `bg-surface-2` | #1a1a20 | b2 |
| Inline code fill, kind badge fill | `--surface-3` (S) -> `bg-surface-3` | b3 86% over b2 | same rule |
| Hairline | `--surface-border` (S) -> `border-surface-border` (T) | 14% base-content | same |
| Stronger hairline (log rail, hover chip border, bar track) | `--surface-border-strong` (S) | 22% | same |
| Inner top highlight | `--surface-highlight` (S) | 13% | 10% |
| Body text | `text-base-content` | #e8e6e1 | purple-grey 23.6% |
| Secondary text | `text-base-content-muted` (T, `--bcm`) | 6.06:1 on s0 | 6.03:1 on s0 |
| running | `text-state-run` (T, `--state-ink-run`) | #3b82f6 | #2a56c6 |
| waiting / needs permission / warning | `text-state-need` | #f97316 | #8f5200 |
| failed | `text-state-err` | #ef4444 | #b4232a |
| done | `text-state-done` | #16a34a | #13713a |
| stopped / idle / queued | `text-state-idle` | #9ca3af | #6b6570 |
| Brand gold (context fill, selected-row bar, focus ring) | `--ptah-gold` (S) | #d4af37 | oklch(58% .132 75) |
| Gold as TEXT (links) | `--ptah-link` `[lane-proposed]` | = `--ptah-gold` | = `--ptah-gold-strong` |
| Diff add / delete text | `.diff-add-text` / `.diff-del-text` (S, scoped anubis) | #4ade80 / #f87171 (prototype) | #13713a / #b4232a |

The prototype `tokens.css` copies the real DaisyUI variables (`--b1 --b2 --b3 --bc --bcm --s --p --in --su --wa --er`, state inks,
`--rounded-*`) so every `oklch(var(--b1))` resolves as in the app. Developers use the Tailwind names above, not the CSS in the prototype.

### 1.2 Type

| Use | Size / line / weight | Family | Tailwind |
| --- | --- | --- | --- |
| Answer, bubble, composer input, todo text, log text | 13 / 1.6 (answer) or 1.55 (bubble) / 400 | Inter (T `font-sans`) | `text-[13px] leading-[1.6]` |
| Header title, inspector title, row name | 13 / 1.5 / 600 | Inter | `text-[13px] font-semibold` |
| Orchestrator name, stat value | 14 / 1.2 / 600, tabular | Inter | `text-sm font-semibold tabular-nums` |
| Chip name, chip status, tool name, model selector, approval | 12 / 1.5 / 500 (name, status) 400 (secondary) | Inter | `text-xs font-medium` |
| Section label (AGENTS, TODOS, GIT) | 10.5 / 1.5 / 600, +0.08em, uppercase | Inter | `text-[10.5px] font-semibold uppercase tracking-[0.08em] text-base-content-muted` |
| Section meta, stat label, context row, kind badge text | 11 (badge 10, 500) | Inter | `text-[11px]` / `text-[10px] font-medium` |
| Inline code in prose | 11.5 | JetBrains Mono (`font-mono`) | `font-mono text-[11.5px]` |
| Branch name, tool args | 11-12 / 400-500 | JetBrains Mono | `font-mono text-[11.5px]` |

Timers and counts use `tabular-nums` so the live clock does not jitter.

### 1.3 Spacing, radii, elevation

- Scale: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28 px (all Tailwind steps; `7px` only for the chip icon gap `gap-[7px]`).
- Radii (explicit, see Decision D4; never `rounded-btn`, which is 2 rem in anubis-light): user bubble and composer 12 px
  (`rounded-xl`, equals `--rounded-box` in dark), chip 6 px (`rounded-md`), icon button 6 px, kind badge and code 4 px (`rounded`),
  context bar 2 px, checkbox 3 px, pills (dots, send) `rounded-full`.
- Elevation: composer `--elev-shadow` + `inset 0 1px 0 var(--surface-highlight)` (S `.surface-2` recipe). Overlay inspector uses
  `--elev-shadow-raised`. No other shadows.

### 1.4 Component reuse (re-skin, do not reinvent)

| New element | Existing component to re-skin | Notes |
| --- | --- | --- |
| Inspector container | `ptah-canvas-session-details` (`libs/frontend/canvas/.../canvas-session-details.component.ts`) | keep its stores (`SessionGitStatsStore`, `TabManagerService`); replace the `<dl>` list with the 4 sections below |
| Orchestrator stats (tokens / cost / turns) | `session-stats-summary.component.ts` (chat-ui) | reuse formatting, new 3-column grid |
| Agent chip and agent row | `subagent-tile.component.ts` (chat) + status mapping in section 3.5 | the existing tile already uses lucide `Bot`, `Check`, `CircleX`, `LoaderCircle`, `ShieldAlert` |
| CLI mark | `ptah-provider-mark` with `size="sm"` (`libs/frontend/ui/.../provider-mark.component.ts`) | 16 px box / 14 px glyph, `aria-hidden` |
| Progress | daisyUI `progress` | `progress h-1 w-full text-secondary` |
| Badge | daisyUI `badge badge-ghost badge-sm` | restyled by utilities in 4.3 (kind badge) |
| Buttons | daisyUI `btn btn-ghost btn-xs btn-square` | with `rounded-md` override |

### 1.5 Icons: every glyph (lucide-angular, imported as `LucideAngularModule` icons; `aria-hidden="true"`)

| Place | Lucide name (export) | Size | Colour |
| --- | --- | --- | --- |
| Sidebar toggle | `panel-left` (`PanelLeft`) | 16 | muted -> base-content on hover |
| Inspector toggle | `panel-right` (`PanelRight`) | 16 | same |
| Inspector close | `x` (`X`) | 16 | same |
| Header and composer branch, Git row | `git-branch` (`GitBranch`) | 12 (header), 14 (composer, git) | muted |
| Composer workspace | `folder` (`Folder`) | 14 | muted |
| Composer add | `plus` (`Plus`) | 16 | muted |
| Approval mode | `shield` (`Shield`) | 14 | `text-state-need` |
| Model selector | `chevron-down` (`ChevronDown`) | 12 | muted |
| Mic | `mic` (`Mic`) | 16 | muted |
| Send | `arrow-up` (`ArrowUp`) | 16 | `text-base-100` on `bg-base-content` |
| Disclosure | `chevron-right` (`ChevronRight`), rotated 90 deg when open | 16 | muted |
| Copy / activity actions | `copy` (`Copy`), `activity` (`Activity`) | 14 | muted |
| Sub-agent (chip, row, log) | `bot` (`Bot`) | 14 | base-content |
| CLI lane with vendored mark (intentional departure, see 2.2: the reference draws `>_` for every lane) | `ptah-provider-mark` (claude, codex, antigravity, opencode, grok, copilot, cursor) | 14 glyph in 16 box | base-content (mono paint) |
| CLI lane without mark (Gemini today) | `terminal` (`Terminal`), same as the provider-mark fallback | 14 | base-content |
| Background command | `layers` (`Layers`) | 14 | base-content |
| Tool: Read / Grep / Bash | `file-text` / `search` / `terminal` | 14 | muted |
| Tool done / running | `check` (12) / `loader-circle` (12, `animate-spin`) | 12 | `text-state-done` / `text-state-run` |
| Permission request | `shield-alert` (`ShieldAlert`) | 12 | `text-state-need` |
| Git ahead / behind (NOT SHIPPED: hidden until a per-session source exists, see 4.4 and 9.1) | `arrow-up`, `arrow-down` | 10 | muted |
| User turn: branch / rewind (B-14, B-15; same icons as today) | `git-branch` (`GitBranch`), `undo-2` (`Undo2`) | 14 | muted -> base-content on hover |
| User turn: attachments (B-19, B-20; same icons as today) | `paperclip` (`Paperclip`), `image` (`Image`), file-type icon from the existing `getFileIcon` | 12 | muted |
| Request panel: pending / success / error (4.5) | `loader-circle` (12, `animate-spin`), `check` (12), `triangle-alert` (14) | 12-14 | `text-state-run` / `text-state-done` / `text-state-err` |
| Todo done | `check` inside a 14 px filled box | 10, stroke 3.5 | `text-base-100` on `bg-state-done` |
| Git error | `triangle-alert` (`TriangleAlert`) | 14 | `text-state-err` |
| Empty agents | `bot` | 16 | muted |

Lucide export verification (finding 8, DONE by the orchestrator 2026-10-15 against `D:\projects\ptah-extension\node_modules\lucide-angular` 1.0.0,
`icons/lucide-icons.d.ts`): `PanelLeft`, `PanelRight`, `GitBranch`, `ShieldAlert`, `LoaderCircle`, `TriangleAlert` are canonical exports. The designer
re-checked `Undo2`, `Paperclip`, `Image`, `Check` the same way (all present). Gemini has no `ptah-provider-mark` slug (`brand-slugs.ts:74-94`), so it
renders the `Terminal` fallback.

`square-terminal` is not used (Decision D5). The prototype sprite (`assets/sprite.js`) is generated from lucide-angular 1.0.0 icon data
and `PROVIDER_BRAND_ART`; the real artwork is therefore what ships.

### 1.6 Token additions (`[lane-proposed]`)

1. `--ptah-link` (see 1.1). Needed because brand gold as text on anubis-light measures 4.10:1 (fails 4.5) while `--ptah-gold-strong`
   measures 6.28:1. Define in `styles.css`: `:root { --ptah-link: var(--ptah-gold); } [data-theme-mode='light'] { --ptah-link: var(--ptah-gold-strong); }`.
   Reversible: replace with `text-secondary` plus per-theme override.
2. Optional `surface-border-strong` entry in the Tailwind `colors` block (`'var(--surface-border-strong)'`). Without it use
   `border-[var(--surface-border-strong)]`.

---

## 2. Shell and layout

```
cs-shell  (flex, h-full, container-type:inline-size)
 |- cs-main (flex-1 min-w-0, column)
 |    |- header          48 px (47 + 1 px rule)   [px-4]
 |    |- scroll area     flex-1, overflow-y:auto, scrollbar-gutter:stable both-edges (2.2)
 |    |     `- thread     max-w-[758px] mx-auto px-6 pt-6 pb-6   => 710 px content column (ref 711)
 |    `- composer wrap   px-6 pt-2 pb-[18px]; composer max-w-[758px] mx-auto (ref 758)
 `- inspector           w-[336px] shrink-0 border-l border-surface-border bg-base-100
```

- Prose measure: `.cs-answer max-w-[600px]` (ref wraps at about 592 px). User bubble `max-w-[min(80%,569px)]`, right-aligned (ref 569 px).
- Vertical rhythm in the thread: user to assistant 20 px, assistant to user 28 px, answer paragraph gap 12 px, answer to chips 12 px, chips to
  actions 8 px, actions or chips to live line 14 px. Disclosure row 30 px tall.
- Header region, inspector header: 48 px each so the two rules align across the shell (ref: 47 px).

### 2.1 Breakpoints (container width of the shell, not the window; the product also runs in a 400 px VS Code sidebar and in Rail panes)

| Shell width | Inspector | Other changes |
| --- | --- | --- |
| >= 960 px | docked, 336 px, pushes the thread | none |
| 640-959 px | overlay sheet, `absolute right-0 inset-y-0 w-[min(336px,100%)]`, `--elev-shadow-raised`, scrim `bg-black/30` (click or Esc closes, focus returns to the toggle) | none |
| 440-639 px | full-width sheet | thread `px-3`; branch chip in header hidden; composer workspace label hidden (icon only); model selector hides effort; bubble `max-w-[92%]` |
| < 440 px | full-width sheet | chips 32 px tall (touch); agent activity indent 22 px |

Implementation: native `@container` rules in the component CSS files (Chromium 105+, so fine for VS Code and Electron; no Tailwind plugin is
installed, so do not use `@sm:` variants). Alternative that already exists: the `railWidthBand` signal pattern in
`libs/frontend/canvas/src/lib/canvas-board-mode.ts`. Prototype screenshots: `dark-narrow-400-inspector-sheet.png`,
`light-narrow-400-streaming.png`, `dark-sidebar-400-container.png`.

### 2.2 Fidelity to the reference and intentional departures (finding 6)

Reference geometry (`reference/02-session-shell-with-inspector.png`, 1594 x 839, `ref`): main column centre x = 628.5 (main pane 0-1257 with a 337 px
inspector); thread content x 273-984 (711 px); user bubble x 415-984 (569 px); composer card x 250-1007 (758 px) and y 671-805 (134 px tall one-line
state; top strip 671-708, placeholder text centre y 731, bottom bar centre y 782); header 47 px + 1 px rule.

Reconciliation of the six-pixel offset the review measured (prototype column at x 267 / bubble at x 409 versus ref 273 / 415, same screenshot width):

| Cause | Rule (binding on the implementation and the prototype) |
| --- | --- |
| `scrollbar-gutter: stable` on the thread scroller reserves the gutter on ONE edge only, so a classic scrollbar moves the thread centre left of the composer centre (the composer is outside the scroller) | Thread scroller uses `scrollbar-gutter: stable both-edges` (symmetric reserve), so thread and composer share one centre. Acceptance: at a 1594 px wide shell with the 336 px inspector, thread content left edge and user-bubble left edge are within 1 px of ref (273 and 415), and thread centre equals composer centre within 1 px |
| Composer field and bar heights were guessed | Composer field `min-h-[60px]`, bottom bar `pb-2` (8 px), top strip `h-[38px]` => one-line composer card is 134 px (+-1 px) tall; wrapper bottom padding `pb-[18px]` (ref: card bottom 805 sits 18 px above the 823 px line where the reference's own bottom frame begins) |
| Header | 47 px + 1 px rule = `h-12`, unchanged |

Intentional departures (each is a product requirement, not drift):

| # | Departure | Reference shows | This spec | Reason |
| --- | --- | --- | --- | --- |
| P1 | Codex (and every other vendored CLI) uses its provider mark | generic `>_` for every CLI lane | `ptah-provider-mark` with `Terminal` fallback (Decision D5) | user rule "ptah-provider-mark CLI icons"; Gemini keeps `>_` exactly as in the reference |
| P2 | `Review` / `Answer` button on a waiting row | text-only `Needs permission: npx nx lint chat` line | outline button, 28 px high (4.2, 4.5) | the line must be actionable; routing in 4.5 |
| P3 | User-turn branch / rewind strip and timestamp (hover or focus reveal) | none | 3.10 | parity B-14, B-15, B-16 |
| P4 | `6 tools · 3 files` meta at the right end of the disclosure row, and the activity panel behind `Show activity` | bare `Worked for 4m 12s ›`; the activity button shows nothing | 3.2, 3.11 | parity B-4, B-8, B-11, B-12 |
| P5 | No `Prototype · example data` chip, no host chrome strip (avatar, Chat, Share) | present in the screenshot | absent | these belong to the mock-up, not to the product |

---

## 3. The clean turn

A turn is `<article aria-label="Assistant">` with, in order: disclosure row, work log (collapsible), answer, agent chip row, action row, live line.
Each child is optional. User turns are `<article aria-label="You">` with the bubble and, kept from today's bubble, attachments, the compaction
disclosure, the peer warning and a hover/focus action strip (branch, rewind, time), see 3.10. Two presentation modes (`full`, `compact`) share this
anatomy, see 3.8. The duration shown in the disclosure follows the derivation in 3.9.

### 3.1 Turn state machine

| Phase | Work log | Disclosure row | Answer | Chips | Actions | Live line |
| --- | --- | --- | --- | --- | --- | --- |
| streaming (no final text yet) | expanded, pinned to bottom, last text line has a blinking caret, running tool rows spin | `Working · 1m 32s` + pulse dot, expanded | hidden | hidden (the log shows the agents) | hidden | `Orchestrating · 2m 07s` |
| answered, work still running | collapses (260 ms) | `Working · 2m 07s` + dot, collapsed | fades in (240 ms rise 6 px) | shown, live statuses | hidden | `Orchestrating · 2m 07s` |
| answered, orchestrator replied without tool calls (reference turn 2) | none | none (row omitted) | shown | shown | hidden | shown |
| done | collapsed | `Worked for 4m 12s` (no dot) | shown | shown (final statuses) | shown | hidden |

Rules: the log opens automatically only while streaming and collapses itself on the final message. A turn the user opened by hand stays open
(per-turn flag, not reset by the auto-collapse). Expanding a done turn never changes its duration label. The disclosure row is hidden when
the log is empty.

### 3.2 Disclosure row `cs-worked`

`<button type="button" aria-expanded aria-controls="<log id>">` full column width, `h-[30px] flex items-center gap-1 px-0.5 text-[13px]
text-base-content-muted hover:text-base-content border-b border-surface-border rounded-t`. Chevron `chevron-right` 16 px, `transition-transform
duration-200 ease-[var(--ptah-ease-soft)]`, `rotate-90` when open. Label: `Worked for {m}m {ss}s` (under one minute `Worked for {s}s`; from one hour `Worked for 1h 04m`), or the bare `Worked` when 3.9 cannot derive a duration.
While the turn is open: `Working · {m}m {ss}s` with a 6 px `bg-state-run` dot before the label (`aria-hidden`; the label itself is the accessible name).
Count meta (B-4, kept): a third child in the same button, `ml-auto text-[11px] text-base-content-muted tabular-nums`, e.g. `6 tools · 3 files` (today's
`messageSummary().toolCount` / `.filesChanged`; each part omitted when unknown or 0, the whole span omitted when both are, so the reference's bare `Worked for 4m 12s ›`
is the look when a turn has neither). The meta is part of the button's accessible name (`Worked for 4m 12s, 6 tools, 3 files`). Cost, tokens and duration of today's
collapsed header and per-message badges (B-8, B-11, B-12) live in the activity panel of 3.11. Prototype: `.cs-worked .meta`.

### 3.3 Work log `cs-log`

`<ol aria-label="Work log">`, `ml-1.5 pl-3.5 border-l border-[var(--surface-border-strong)] flex flex-col gap-0.5`, top margin 14 px.
Collapse animation: wrapper `grid grid-rows-[0fr] transition-[grid-template-rows] duration-[260ms] ease-[var(--ptah-ease-soft)]`
-> `grid-rows-[1fr]` open; inner `overflow-hidden min-h-0`; closed wrapper gets `invisible` after the transition (visibility with 260 ms delay) so
collapsed content is not focusable or read.

| Row | Anatomy | Classes |
| --- | --- | --- |
| Streamed text | paragraph, muted | `text-[13px] leading-[1.6] text-base-content-muted py-1 max-w-[600px]` |
| Tool call | icon 14 muted, **Name** 500 base-content, args mono 11.5 muted truncated, trailing status (check / spinner) | `min-h-[26px] flex items-center gap-2 text-xs`; args `font-mono text-[11.5px] truncate min-w-0` |
| Agent activity | `bot` icon or provider mark, agent name 500, activity text muted, trailing `done · 2m 41s` or spinner | same row, indent 0 |
| Streaming caret | 7 x 14 px `bg-base-content`, `animation: blink 1s steps(1) infinite`; removed on completion | |

### 3.4 Final answer `cs-answer`

`max-w-[600px] pt-4 text-[13px] leading-[1.6]`; `pt-0` when there is no log. Paragraphs `mb-3` (last 0). Inline code:
`font-mono text-[11.5px] px-1.5 py-px rounded bg-surface-3 border border-surface-border whitespace-nowrap` (base-content on surface-3 =
12.52:1 dark, 13.35:1 light). Block code, lists and headings keep the app's existing prose component styles.

### 3.5 Agent chip `chip` and status vocabulary

`<button type="button" class="inline-flex h-[30px] max-w-full items-center gap-[7px] rounded-md border border-surface-border bg-surface-1
px-2.5 text-xs shadow-[inset_0_1px_0_var(--surface-highlight)] transition-colors hover:bg-surface-2 hover:border-[var(--surface-border-strong)]">`
containing: icon (14), `<span class="font-medium truncate">{name}</span>`, `<span class="font-medium text-state-*">{status word}</span>`.
Chips wrap (`flex flex-wrap gap-2`), 12 px above. Click opens the agent's lane (existing behaviour of `subagent-tile`), and the matching inspector
row gets `aria-current`. Status is a word in state ink, never a background fill (Decision D2).

| Word | Source status | Ink | Icon in inspector line 2 |
| --- | --- | --- | --- |
| `running` | running / streaming | `text-state-run` | none |
| `waiting` | blocked on permission or user question | `text-state-need` | `shield-alert` + "Needs permission: ..." |
| `done` | completed | `text-state-done` | none |
| `failed` | error | `text-state-err` | none (activity line shows the error summary) |
| `stopped` | stopped / cancelled | `text-state-idle` | none |
| `queued` | not started (background cap, see `RUNNING_CAP_MESSAGE`) | `text-state-idle` | none |

Kinds: Sub-agent = `bot`; CLI lane = `ptah-provider-mark` (`providerId` = the lane's CLI id) with `terminal` fallback; Background = `layers`.
Accessible name: `{name}, {kind}, {status}. Open lane` (prototype uses this exact pattern).

### 3.6 Action row

`flex gap-0.5 mt-2 -ml-1.5`; two 28 px icon buttons (`copy` -> aria-label `Copy message`; `activity` -> `Show activity`). Always visible on every
completed assistant turn (matches the reference); hidden during streaming and while the turn is open. Button recipe: `inline-grid h-7 w-7
place-items-center rounded-md text-base-content-muted hover:bg-base-content/[.08] hover:text-base-content`.
`Show activity` toggles this turn's activity panel (3.11): `aria-expanded` and `aria-controls` on the button, the panel opens below the row, focus stays on the button.
The old compact card's "Show output / expand to full view" (A-16) is replaced by the disclosure row itself (opening the work log) and by this panel. The row stays exactly
these two buttons.

### 3.7 Live line

`flex items-center gap-2 mt-3.5 text-xs` with `role="status" aria-live="polite"`: 8 px `bg-state-run` dot with a pulsing 2 px ring
(`::after inset -4 px`, 1.6 s `--ptah-ease-soft`, scale .6 -> 1.25, opacity .55 -> 0), `Orchestrating` (base-content), `·`, timer (muted,
tabular). Timer is `aria-hidden`; screen readers hear only the static label (no per-second announcements). Verb comes from the orchestrator
state ("Orchestrating", "Waiting for you" when any agent is waiting).

### 3.8 View mode `full` | `compact` (what the retained toggle changes; PM-1, parity A-1..A-6)

Principle: one transcript, one set of components, one data set. `TabState.viewMode` (`'full' | 'compact'`, persisted, A-1/A-2) is a density and
disclosure preference. It never hides a capability and never swaps the transcript for a card: the chat-host `ptah-compact-session-card` (A-6) is retired
(its content lives in the clean turn and the inspector). Rail board cards keep the compact rail card unchanged (A-5, `SESSION_FORCED_CARD`).

| Element | `full` (default) | `compact` |
| --- | --- | --- |
| Live work log while streaming | auto-expanded, pinned to bottom (3.1) | stays collapsed; the disclosure row reads `Working · {t}` followed by a muted one-line current-step peek (text of the newest log row, truncated, `aria-hidden`, updated without announcing). The user can still open the log by hand |
| Completed turn | log collapsed, `Worked for` row (3.2/3.9), answer, chips, action row | identical |
| Final answer | full text | identical (never truncated or summarised) |
| Agent chips, action row, live line | as 3.5-3.7 | identical |
| Inspector (section 4) | opens docked at >= 960 px shell width | closed at every width until the toggle opens it (the `N needs you` header chip and the toggle dot stay) |
| Vertical rhythm | user to assistant 20, assistant to user 28, answer paragraph gap 12 | 12 / 20 / 8; disclosure row 28 px tall |
| User turns, attachments, branch / rewind, compaction disclosure (3.10), banners C-1..C-17, stats strip, compaction markers, composer, render window, older-history loading | as specified | identical |

The toggle: the existing controls in the tab item (A-3) and the Rail focus header (A-4) are unchanged (`aria-pressed` reflects the mode). Switching is
instant in place: same DOM and scroll anchor (the topmost visible turn stays put), no stagger replay, no remount. The choice survives a reload (A-2).
Migration: a tab saved as `compact` by the old build now shows the transcript in compact density instead of the card; this is intended and needs no data
migration. Decision D16 (section 10); removing the toggle remains user-reserved.

### 3.9 Turn duration `Worked for {m}m {ss}s` (derivation; frontend-only, no backend, no new stored field)

Facts: no live turn start time exists today (decisions.md row 9). Existing durable fields: `message.timestamp` (user and assistant messages; the user
bubble already renders it through `formatTime`, B-16) and `message.duration` (read by the old duration badges, B-9/B-12). A turn is a user message plus every
assistant message up to the next user message.

| Quantity | Rule |
| --- | --- |
| Start `S` | `timestamp` of the turn's first user message, excluding a compaction-continuation message (B-18) and excluding messages without a finite timestamp. Inbound peer messages count (they start work) |
| End `E` (settled turn) | the maximum over the turn's assistant messages of `timestamp + duration`; every term needs a finite `duration`, else `E` is not derivable |
| Settled label | derivable (`S`, `E` finite and `E - S >= 1000 ms`): `Worked for {m}m {ss}s` (`{s}s` under 1 min, `{h}h {mm}m` from 1 h). Otherwise the bare `Worked` (no number, never `0s`) |
| Live label (streaming, or any agent owned by the turn running) | `Working · {now - S}`, ticking each second (`tabular-nums`, `aria-hidden`). It needs only `S`, so it is also correct after a reload mid-turn. No finite `S`: `Working` with the pulse dot and no timer |
| Settle | when streaming ends and no owned agent runs, the label is recomputed from the durable fields above. No in-memory frozen value is kept, so the label is identical before and after a reload or tab switch (task-description criterion 8). If the live timer showed more than the durable value, the label drops to the durable value; if `E` is not derivable it becomes `Worked` |
| Zero-activity turn (no tool call, no agent) | no disclosure row at all (3.1 row 3), so no label |
| Still-running agents after the final message | the row stays `Working · {now - S}` (3.1 row 2). The settled label then measures the orchestrator's own timeline only: delegated runs that outlive the last assistant event are not added, and each chip shows its own `done · {duration}` instead. Architect check `[verify]`: extend `E` with a CLI lane completion time only if `MonitoredAgent` persists one across reload; sub-agent records have no times and are not added |
| Interrupted or stopped turn | same rule (`E` = last assistant event); no new copy |
| Restored history | works when the loader maps message timestamps and durations `[verify]`; if a field is missing the label is `Worked` |
| Expanding or collapsing a turn | never changes the label |

### 3.10 User turn anatomy (parity B-14..B-20, B-16/B-17)

`<article aria-label="You">`: bubble per the reference (right-aligned, 12 px radius, `surface-2`), plus, all kept from today's bubble:

- Sender and time (B-16): a `<time datetime>` (formatTime output, `title` = full date and time) with `You` or the peer label, rendered in the action strip below
  (`text-[11px] text-base-content-muted tabular-nums`, 6.06:1 dark / 6.03:1 light on surface-0). An inbound peer message shows its peer label above the
  bubble at rest (always visible, never hover-gated) together with today's "self-reported and unverified" warning (B-17), icon `triangle-alert` 12 and
  `text-state-need` (6.61 / 5.83 on surface-0).
- Attachments (B-19, B-20): inside the bubble under the text, `mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]`: `paperclip` 12 muted, the existing
  file badges (`badge badge-sm`, `bg-surface-3 text-base-content`, 12.52 / 13.35, `title` = full path, file-type icon from `getFileIcon`), then `image` 12 plus
  today's `imageCountLabel()` text.
- Compaction continuation (B-18): the existing disclosure ("Continued from previous conversation (compacted)") inside the bubble, same button recipe as 3.2
  at 12 px, `aria-expanded`, same copy as today (the prototype's `Continued from a compacted conversation` is illustrative; production keeps today's string), preceded by the
  retained compaction marker (C-8) as a `role="separator"` divider (prototype `.cs-divider`).
- Action strip (B-14, B-15): under the bubble, `flex items-center justify-end gap-0.5 mt-1`: time/sender, then two 28 px icon buttons (recipe of 3.6, 14 px
  icons): `git-branch`, aria-label `Branch conversation from this message`, `title` `Branch conversation from here`; `undo-2`, aria-label `Rewind file changes
  to this message`, `title` `Rewind file changes to here`. Rewind keeps today's inactive behaviour: `disabled` + `aria-disabled`, `opacity-40`, aria-label
  `Rewind unavailable — session is not active`, `title` `Rewind is only available during an active conversation`.
  Reveal: `opacity-0` at rest, `opacity-100` on `article:hover` and `article:focus-within`, always visible under `(hover: none)`; 120 ms
  `--ptah-ease-soft`. The buttons stay in the tab order (focus reveals them). They emit today's `branchRequested` / `rewindRequested`; the C-10 banners
  report their result unchanged. The strip is not a stagger item.

### 3.11 Activity panel (parity B-8, B-11, B-12; with the count meta of 3.2 for B-4; departure P4)

Opened by the `Show activity` button (3.6), below the action row: `<dl id aria-label="Turn activity">`, `mt-2 max-w-[600px] flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border
border-surface-border bg-surface-1 px-3 py-2.5 text-xs`; each item is `<dt>` label `text-[11px] text-base-content-muted` under `<dd>` value `font-medium tabular-nums` (DOM order
dt, dd; visual reverse via `flex-col-reverse`), items in this order and each present only when known (never `0` or a placeholder): `Duration` (the label value of 3.9),
`Tokens` (`18.2k in · 3.1k out`), `Cost` (`$0.42`), `Tool calls`, `Files changed`. Formatting reuses today's `ptah-token-badge` / `ptah-cost-badge` formatters (plain text).
Values are summed over the turn's assistant messages; the transcript renders one assistant message per user prompt today, so for a turn with several messages the per-message
split is not shown `[verify]`. The panel is closed by default, available only on completed turns (the action row is hidden while open), and hidden entirely when every item is
unknown. Base-content on surface-1: 14.01 dark / 14.41 light; muted on surface-1: 5.71 / 5.46. Prototype: `.cs-activity` (`#act1`, `#act2`).

---

## 4. Inspector "This session"

`<aside id="inspector" aria-label="This session">` 336 px, column: header 48 px (`px-4 pr-3`, title 13/600 `<h2>`, close `x` button) then a scrolling body
with four `section`s separated by `border-b border-surface-border` (each `p-4`; AGENTS `pt-3.5 pb-1.5` with row-level horizontal padding).

### 4.1 Orchestrator card

- Row 1: 8 px status dot (`bg-state-run` + 3 px `ring` at 22% = the "orchestrator working" state; idle `bg-state-idle`, waiting `bg-state-need`
  with ring), "Orchestrator" 14/600 (gap 9 px).
- Row 2 (indent 17 px, `text-xs text-base-content-muted`, margin 2/12): `{model} · {state}` e.g. `Opus 5.5 · waiting on 4 agents`. States: `working`,
  `waiting on N agents`, `needs you`, `idle`.
- Context: label row `text-[11px] text-base-content-muted` (`Context` left, `41% of 200k` right), then
  `<progress class="progress h-1 w-full text-secondary" max=100 value=41 aria-labelledby aria-valuetext="41% of the 200k token window">`.
  Fill colour: `text-secondary` (gold) < 80%, `text-state-need` 80-94%, `text-state-err` >= 95%. Track `--surface-border-strong`. Unknown context:
  `-` and empty bar with `aria-valuetext="Context usage unavailable"`. Bar width transition 400 ms `--ptah-ease-soft`.
- Stats: `grid grid-cols-3 gap-2 mt-3.5`; each is `<dt>` label 11 px muted under `<dd>` value 14/600 tabular (DOM order dt, dd; visual reverse via
  `flex-col-reverse`): `82.4k tokens`, `$1.84 cost`, `6 turns`.
- Usage and limits (parity C-2..C-5): the chat-view stats strip stays unchanged in the main view; the Orchestrator card also carries a `Usage and limits` disclosure button (`aria-expanded`,
  `chevron-right` 12, text `text-xs text-base-content-muted`) that reveals compactions, plan limits and the session budget from the same sources (`resolvedCompactionCount()`,
  `resolvedStatsLimits()`, `resolvedSessionBudget()`). Prototype `parity=1`: `[data-act="usage"]`.

### 4.2 AGENTS

Header: `AGENTS` label left, `4 active · 1 finished` right (`text-[11px] muted`, `aria-live="polite"` off; updated silently). Active = running, waiting
or queued rows; finished = done, failed or stopped rows (counted from the rows the aggregate of 9.1 returns, so header and list always agree). Order: needing
permission first, then running (newest first), then finished (most recent first). Finished rows stay (dimmed name colour is NOT used: contrast).

Row `li.agent` (hover `bg-base-content/5`, selected `aria-current="true"` = `bg-surface-2` + 2 px `bg-secondary` bar at left, `inset-y-2`, transition 120 ms):

```
line 1: [icon 14] [name 13/600 truncate, flex 0 1 auto] [kind badge] ........ [status word 12/500][ · 2m 13s muted tabular]
line 2: activity text 12px muted, ml-6 (24 px), single line, truncate     (e.g. "Read session-context.token.ts")
permission (only status waiting), under line 2:  [shield-alert 12] **Needs permission:** `command`   [Review]
```

- Row padding `py-[9px] px-4` (pad bottom 10), gap 8 px in line 1. The row's primary target is a full-width `<button class="agent__main">`
  (aria-label: `{name}, {kind}, {status} {duration}. {activity}`); it selects the agent and opens its lane in the main area.
- Kind badge: `badge badge-ghost` restyled `text-[10px] font-medium leading-none px-[5px] py-[3px] rounded border border-surface-border bg-surface-3
  text-base-content-muted h-auto` with copy `Sub-agent`, `CLI lane`, `Background` (never truncated; the name truncates first).
- Permission line: `flex items-start gap-1.5 ml-[38px] mr-4 mb-2.5 -mt-[5px] text-xs text-state-need`, "Needs permission:" 600, command in
  `font-mono text-[11px]`, wraps (`break-anywhere`, never ellipsized so the user sees the whole command), and a `Review` button
  `h-7 min-w-[56px] px-2.5 self-start rounded-md border text-[11px] font-medium text-state-need` (28 px high, at least 56 x 28, so it meets the 24 x 24 minimum
  with room to spare; was `h-[22px]`) with 55% need-ink border (`border-state-need/55` via
  `border-[color-mix(in_srgb,var(--state-ink-need)_55%,transparent)]`). The button is a sibling of the row button (no nested buttons);
  aria-label `Review permission request from {name}: {command}`. It expands the request panel and follows the routing of 4.5 (T1-02, T1-07). It is a
  secondary (outline) action; the surface has no `btn-primary`. Intentional departure P2 (2.2): the reference shows the line without a button. The wrapped
  command keeps its full width (`min-w-0 flex-1`); the button never shrinks it below one line.
- A user question (T1-02, prototype `ask=question`) uses the same line: `shield-alert`, "Asked you:" + first 60 chars of the question, and an `Answer` button
  with the same recipe (aria-label `Answer question from {name}: {first 60 chars}`). Route in 4.5.
- Several requests on one row (prototype `ask=multi`): the line shows the OLDEST pending request of that row (FIFO by request time); a `+{N} more` text
  button (`inline-flex h-6 min-w-6 items-center px-1.5 text-[11px] font-medium text-state-need underline-offset-2 hover:underline`, 24 px high, aria-label
  `Show {N} more requests from {name}`, `aria-expanded`) expands the remaining requests as further lines of the same anatomy, each with its own button. Never
  more than one request panel is open per row.
- Status word and duration right-aligned; duration ticks every second only for running rows.
- Empty state: 32 px `bg-surface-2` rounded-lg tile with `bot`, "No agents yet" 13/600, "Sub-agents, CLI lanes and background commands appear here while the
  orchestrator delegates." 12 px muted centred, `py-[18px] px-4`. Header meta reads `none yet`.
- Loading: 3 skeleton rows (two bars each, `sk` shimmer 1.4 s; reduced motion: static). `aria-busy="true"` on the section.

### 4.3 TODOS

Header `TODOS` + `2 of 5` (tabular). Items `flex items-start gap-[9px] py-1 text-[13px] leading-[1.4]`:
- done: 14 px box `bg-state-done border-state-done` with 10 px `check` (stroke 3.5, `text-base-100`), text `line-through text-base-content-muted`,
  sr-only prefix `Done: `.
- in progress: 14 px box, 1.5 px `border-state-run`, 6 px centred `bg-state-run` dot, text weight 500, sr-only `In progress: `. More than one in progress is allowed.
- pending: 14 px box, 1.5 px border `base-content` at 55% (dark 5.17:1, light 3.81:1, both >= 3:1), sr-only `Pending: `.
- Long text wraps (no truncation). Empty: "No todos for this session. The orchestrator lists its plan here." (the section is always shown so the
  layout is stable).
- More than 8 items: show the first 8 (in-progress first), then a `+N more` text button (`inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium
  text-base-content underline-offset-2 hover:underline`, 24 px high, aria-label `Show {N} more todos`, `aria-expanded`).
- Source and states (detail in 9.1): per-item rows come from `parseTodoList` (`compact-session-metrics.ts:105`) over the session's latest `TodoWrite` result; the
  header count and the `2 of 5` meta come from the same parsed list. If the list cannot be parsed but `summarizeTodos` has counts, show the count-only fallback
  (`2 of 5` meta, one muted line `Todo details unavailable` with the active title when known, no per-item rows). While the session is still restoring: skeleton rows
  with `aria-busy="true"`. No `TodoWrite` yet: the empty state above.

### 4.4 GIT

Header `GIT` + `Review changes` link right (`inline-flex h-6 items-center text-xs font-medium` in `--ptah-link`, underline on hover, 24 px high, opens the existing review
surface). Row `flex items-center gap-2 text-xs`: `git-branch` 14, branch name `font-mono text-xs font-medium truncate`, right-aligned `+400` (`.diff-add-text`)
`−3` (`.diff-del-text`) mono 12/500 (use U+2212, not a hyphen). `partial` stats add `+` after the numbers (existing `partial()` behaviour) with the existing title text.
Ahead / behind (`↑2 ↓0`, lucide `arrow-up` / `arrow-down` 10 px, mono 11 px muted, title `2 commits ahead, 0 behind`) is NOT part of this release: the `↑ ↓` pair
is hidden entirely (no placeholder, no `0`) until `SessionGitStatsStore` or another per-session source exposes `ahead` and `behind` (9.1, decisions.md row 9: `GitStatusService`
is workspace-wide). The pair in the prototype and screenshots is a forward-looking illustration, not an acceptance item.
States: not a repo -> `git-branch` + "Not a git repository" (no link); loading -> skeleton row; error -> `triangle-alert` +
"Could not read git status" in `text-state-err` + `Retry` text button (`role="alert"`; `inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium`, 24 px high,
aria-label `Retry reading git status`, shows `loader-circle` and `aria-busy` while retrying, error text stays until a read succeeds).

### 4.5 Requests: routing of `Review` and `Answer` (review finding 2; T1-02, T1-07; parity A-10..A-13, C-15, C-16)

Request kinds, identity and where they appear (field names are `[verify]` for the architect):

| Kind | Source today | Identity `requestKey` | Row it appears on | Button |
| --- | --- | --- | --- | --- |
| Session permission | `chatStore.unmatchedPermissions()` (C-15), filtered by `targetsTab` (A-13) | the request's `id` | Orchestrator card (its state reads `needs you`) | `Review` |
| CLI-lane permission | `MonitoredAgent.permissionQueue` (`agent-monitor.store.ts:394-442`) | the request's `id` (the same request seen in both lists counts once, 9.1) | that lane's AGENTS row | `Review` |
| Sub-agent permission | session permission matched to the sub-agent by its tool-use id; unmatched falls back to the Orchestrator card | the request's `id` | the sub-agent row, else Orchestrator | `Review` |
| AskUserQuestion | `resolvedQuestionRequests()` (C-16) | `AskUserQuestionRequest.id` | the owning lane row when it has a `laneKey`, else Orchestrator | `Answer` |

`Review` (any permission, any host) expands the request panel inline under the row: `region` with `aria-label="Permission request from {name}"`,
`mx-4 mt-2 rounded-md border border-surface-border bg-surface-1 p-3`, content: requester line (`{name} · {kind}`, `text-xs`), the full tool and command (`font-mono
text-[11px]`, wraps, never truncated), `Allow` and `Deny` buttons (`h-7 min-w-[56px] px-3 rounded-md border text-xs font-medium`; `Allow` `text-state-done`, `Deny`
`text-state-err`, each with a 55% own-ink border, both outline, no `btn-primary`; ink on surface-1 measured 5.30 / 4.64 dark and 5.17 / 5.55 light) and an `Open lane` text
link (`inline-flex h-6 items-center text-xs font-medium` in `--ptah-link`, today's `openRequest`, A-11; not offered where no lane surface exists, i.e. the Electron single chat view). Responses use today's handlers unchanged: session permissions
through `handlePermissionResponse` (C-15), lane permissions through `AgentPermissionResponder` / `PermissionHandlerService` exactly as the compact callout's `respond`
does (A-10). That path already works in the chat host, so the panel IS the Electron fallback until T1-07 mounts a native lane-permission surface; where a host also
mounts a native surface (C-15 badge, lane tile), a response given on either one resolves the request on both because they share the `requestKey`.

`Answer` does not re-implement the question UI. It scrolls the existing question card (C-16) into view in the main thread and focuses its first option; a lane-owned
question first opens that lane (A-9 `openLane`). At overlay width the sheet closes first and focus goes to the card (the one exception to the return-to-toggle rule, 8.3
path 7). If the card is not mounted within 1 s the line shows the error state below.

| Host (prototype `host=`) | `Review` (permission) | `Answer` (question) |
| --- | --- | --- |
| Electron single chat view (`host=electron`; no native lane-permission surface yet, T1-07) | inline request panel, the only surface: lane requests are answered in place with `Allow` / `Deny`; no `Open lane` link is offered because there is no lane surface to open | focus the C-16 card of that session |
| Electron Rail panes and VS Code webview (`host=rail`) | inline request panel plus the `Open lane` link; the C-15 badge and the lane tile stay visible and stay in sync through `requestKey` | focus the C-16 card (open the lane first for a lane-owned question) |

Several requests: each row lists its pending requests oldest first, one panel open per row (opening another closes the first; focus moves to the opened panel's
region); rows with requests sort first (4.2); the header `N needs you` counts every unique request (9.1). More than one request on a row shows `+N more` (expanded:
`aria-expanded="true"`, the remaining requests listed with the same anatomy).

Prototype states (query string on `prototype/index.html`; screenshots are prefixed `dark-` / `light-`). These names are the acceptance vocabulary:

| Prototype state | What shows | Focus and announcement |
| --- | --- | --- |
| `ask=lane` | single lane permission row: `Needs permission: {command}` + `Review` | none |
| `ask=lane-open` | the `Review` panel open (idle) with `Allow`, `Deny`, `Open lane` | focus enters the panel region |
| `ask=question` | question row `Asked you: {first 60 chars}` + `Answer`, and the question card in the thread | `Answer` moves focus to the card's first option |
| `ask=multi` | 5 simultaneous requests across rows, with `+N more` | none; `aria-expanded` on `+N more` |
| `requests-more-open` (`narrow-400-multi-more-open` at 400 px) | `+N more` expanded | focus stays on the `+N more` button |
| sending (transient, no screenshot) | after `Allow`, `Deny` or `Retry`: panel `aria-busy="true"`, both buttons `disabled`; a second activation for the same `requestKey` is ignored | focus stays put |
| success (no screenshot: the request disappears) | the request is removed, the row status, the `N needs you` count and the header dot update | focus moves to the next pending request's button on this row or the next row, else to the lane row's main button; the single polite live region announces the outcome and the remaining count (`Allowed {command}. 2 requests need you.`) |
| `request-error-retry` (`fail=1`) | `triangle-alert` + `Could not send your response` (`text-state-err`, `role="alert"`) + `Retry` (`inline-flex h-6 min-w-[42px] items-center justify-center px-2 text-xs font-medium`, 24 px high); the request stays pending and counted; `Retry` re-sends the same decision for the same `requestKey` | focus moves to the panel region (never `body`); the live region announces `Could not send your answer ... The request is still waiting.` |
| `request-closed-elsewhere` | the request was resolved elsewhere, timed out or its lane ended: `This request is no longer pending. It was answered elsewhere or the lane ended.` (`role="status"`) + `Close` button; no error; the count decrements | `Close` returns focus to the row's main button and announces `Closed.` |
| `request-electron-fallback` | `host=electron`: lane requests answered in place, no `Open lane` link | as success |
| `narrow-400-overlay-focus` | the inspector as an overlay sheet at a 400 px shell, opened by keyboard, focus on `Close session details`, background inert | per 8.3 |
| `parity=1` | retained surfaces visible: agent-origin strip, attachments, branch/rewind, activity panel, compaction divider, usage and limits, continuation | per section 12 |
| `body=partial` | unknown and partial inspector sections (9.1) | none |

Nothing here leaves a waiting request without a working action: the permission panel works in every host, and `Answer` reports its own failure with a retry.

---

## 5. Header

`<header>` `h-12 flex items-center gap-2.5 px-4 border-b border-surface-border bg-base-100`, order and tab order:

1. Sidebar toggle (`panel-left`, 28 px icon button, aria-label `Toggle sidebar`).
2. Title `<h1> text-[13px] font-semibold truncate` (session name; never wraps).
3. spacer.
4. Branch chip (non-interactive hint): `h-[22px] px-2 rounded-md border border-surface-border font-mono text-[11px] text-base-content-muted`, `git-branch` 12 + name
   (max 200 px, truncates), `title` = full branch. Hidden below 640 px shell width.
5. `N needs you` chip (non-interactive status, `role="status"`): `h-[22px] px-2 rounded-md border text-[11px] font-medium text-state-need` with 55% need border, transparent fill.
   Shown only when N > 0 (N = unique pending requests of this session as defined once in 9.1; the same request seen in the session permission list and a lane queue counts once); `title="Open This session to answer"`. Copy: `1 needs you`, `2 need you`.
6. Inspector toggle (`panel-right`, aria-pressed, aria-controls `inspector`, aria-label `Show session details` / `Hide session details`). When the inspector is closed and
   N > 0 the toggle carries a 7 px `bg-state-need` dot at top-right (2 px ring in `base-100`).

No "Prototype" chip in the product. The header does not contain primary buttons.

---

## 6. Composer

Card `max-w-[758px] mx-auto rounded-xl border border-surface-border bg-surface-1 shadow-[inset_0_1px_0_var(--surface-highlight),var(--elev-shadow)]`, focus-within border
`--surface-border-strong` (no extra glow).

1. Top strip `h-[38px] flex items-center gap-3.5 px-3 border-b border-surface-border text-xs text-base-content-muted`: workspace chip (`folder` 14 + name, `title` full path)
   and branch chip (`git-branch` 14 + mono 11.5 name). Both non-interactive hints in this release (no tab stops).
2. Field `px-3.5 pt-3 pb-1 min-h-[60px]` (was 52; 2.2): `<textarea>` 13 px, placeholder `Ask the orchestrator to plan, build or review...` in muted (5.7:1), visually hidden `<label>`
   "Message the orchestrator", auto-grows to 8 lines then scrolls.
3. Bar `flex items-center gap-1 px-2 pb-2 pr-2.5` (was pb-2.5; 2.2): `+` icon button (aria-label `Attach files or add context`) -> approval chip -> spacer -> model selector -> mic -> send.
   - Approval chip `h-7 px-2 rounded-md text-xs font-medium text-state-need`, `shield` 14 + `Auto-edit` (other modes keep the chip with their name and ink: `Plan` idle,
     `Ask` idle, `Auto-edit` need ink, `Bypass` err ink; ink always from `text-state-*`), hover `bg-state-need/10`, `aria-haspopup="menu"`, aria-label `Approval mode: Auto-edit`.
   - Model selector `h-7 px-2 rounded-md text-xs text-base-content-muted` `Opus 5.5 · High` + `chevron-down` 12, `aria-haspopup="listbox"`, aria-label `Model and effort: Opus 5.5, High`;
     below 640 px the effort is dropped from the label.
   - Mic icon button (aria-label `Dictate`).
   - Send: 28 px circle `rounded-full bg-base-content text-base-100`, `arrow-up` 16, hover `scale-105`, active `scale-95`, disabled `opacity-40 cursor-not-allowed`
     (aria-label `Send message`; while the turn streams it becomes the existing Stop control with `square` icon, same slot and size). See Decision D1.

---

## 7. Motion

All easings are the existing `--ptah-ease-soft` (cubic-bezier(.22,.61,.36,1)) and `--ptah-ease-gentle-in` (cubic-bezier(.4,0,.2,1)) from `chat-view.component.css`.
Only `opacity` and `transform` animate (no layout shift), except the log collapse (grid-template-rows) and the context bar width.

### 7.1 Session switch stagger

Trigger: the active session id changes (tab switch, Rail card focus). Toggle one class (`is-entering`) on the shell root for 1000 ms; items carry `style="--i:n"`.
Re-triggering (fast switching) restarts the sequence: remove the class, force reflow, add again. Items already in view animate; content below the fold does not wait.

| Order | Element | `--i` | Delay | Duration | Motion |
| --- | --- | --- | --- | --- | --- |
| 1 | Header and composer | -- | 0 (header) / 120 ms (composer) | 200 ms | opacity 0 -> 1 only (they never move) |
| 2 | Turn blocks: user bubble, disclosure row, answer, chip row, action row (each is one item, in DOM order) | 1..8 | `min(i, 8) * 45 ms` (max 360 ms) | 260 ms | opacity 0 -> 1, translateY(6 px) -> 0, `--ptah-ease-soft`, `animation-fill-mode: backwards` |
| 3 | Inspector header, Orchestrator card, AGENTS section, each agent row, TODOS, GIT | 0..9 | `80 ms + min(i, 6) * 36 ms` (max 296 ms) | 260 ms | opacity 0 -> 1, translateX(8 px) -> 0, `--ptah-ease-soft` |

Total worst case: 360 + 260 = 620 ms. Turns beyond the eighth share the last delay (no cascade on long threads). Streaming or live turns animate their
blocks, then the live pulse starts. The inspector opening (toggle) uses a single 220 ms slide-in (translateX 8 px -> 0, opacity), no per-row stagger.
Prototype verification: computed delays 45/90/135/180... and duration 260 ms measured via `getAnimations()`.

### 7.2 Other transitions

| Interaction | Spec |
| --- | --- |
| Log collapse / expand | 260 ms `grid-template-rows` 0fr <-> 1fr, `--ptah-ease-soft`; chevron 200 ms rotate |
| Answer arrival | `fade-enter`-style: 240 ms, opacity + translateY 6 px, `--ptah-ease-soft` |
| Hover (chip, row, icon button) | 120 ms background and border colour, `--ptah-ease-soft` |
| Live pulse | 1.6 s infinite ring on the 8 px dot |
| Tool spinner | `animate-spin` 900 ms linear |
| Context bar | 400 ms width |
| Press | send scale .96, 120 ms |

### 7.3 Reduced motion

`styles.css` already zeroes animation and transition durations (0.01 ms) under `prefers-reduced-motion: reduce`, but it does NOT zero `animation-delay`. With
`fill-mode: backwards` and delays up to 360 ms, staggered items would stay invisible during their delay. Therefore the stagger rules add:
`@media (prefers-reduced-motion: reduce) { .is-entering .st, .is-entering .st-r, .is-entering .st-f { animation: none !important; animation-delay: 0ms !important; } }`
and the live pulse, spinner and caret stop (`animation: none`; the pulse ring stays as a static 35% ring, the spinner icon is static, the caret is hidden).
Content appears instantly. Verified in the prototype: with the reduce toggle there are 0 running animations and minimum opacity 1.

---

## 8. Accessibility

### 8.1 Landmarks, names, keyboard order

| Tab order | Control | Accessible name |
| --- | --- | --- |
| 1 | Sidebar toggle | `Toggle sidebar` |
| 2 | Inspector toggle | `Show session details` / `Hide session details` (aria-pressed, aria-controls) |
| 3.. | Per turn, document order: disclosure button (aria-expanded), each chip, `Copy message`, `Show activity` | chip: `{name}, {kind}, {status}. Open lane` |
| next | Composer: `Attach files or add context`, `Approval mode: ...`, `Model and effort: ...`, `Dictate`, `Send message` (textarea is first, before the buttons) | as listed |
| last | Inspector (when open): `Close session details`, then, per row, the row button, `Review ...` / `Answer ...`, `+N more`, and (when a request panel is open) `Allow`, `Deny`, `Open lane`; then `Show N more todos`, `Review changes`, `Retry reading git status` | row: `{name}, {kind}, {status} {duration}. {activity}` |

DOM order is main region then inspector, so a keyboard user reaches the composer before the inspector. `F6` is not introduced. Overlay-mode focus behaviour is specified in 8.3.

- Landmarks: session `<section aria-label="Session: {title}">`, `<aside aria-label="This session">`, composer `<form aria-label="Message composer">`.
- Live regions: live line `role="status" aria-live="polite"` (static label only, timer `aria-hidden`); `N needs you` chip `role="status"`; git error `role="alert"`, request errors `role="alert"`, and one visually hidden polite announcer for request outcomes (4.5). No other live regions
  (agent statuses do not announce each change; the "needs you" chip carries the urgent one).
- Colour is never the only signal: every status is a word; todo state has a sr-only prefix; the permission row has an icon and the words "Needs permission".
- Focus ring: see the audit in 8.4 (the light ring is gold-strong, native controls only).
- Targets (WCAG 2.2 SC 2.5.8, 24 x 24 px minimum; the spacing exception is not relied on). Interactive controls and their minimum size: icon buttons 28 x 28; chips
  30 px high (32 below 440 px); agent row button >= 52 px high, full width; `Review` and `Answer` >= 56 x 28; `Allow` and `Deny` >= 56 x 28; `Retry` of a request >= 42 x 24;
  text buttons and links (`+N more`, `Show N more todos`, `Retry reading git status`, `Review changes`, `Open lane`) >= 24 x 24 (`h-6 min-w-6`); the sheet scrim is
  pointer-only. Non-interactive status hints (`N needs you` chip, header branch chip, composer workspace and branch chips) are 22 px and are not targets.
- Truncation: names truncate with an ellipsis and carry a `title` with the full name; commands are never truncated.

### 8.2 Contrast (WCAG 2.x, text >= 4.5:1, UI >= 3:1) - measured, `prototype/assets/contrast-check.mjs`

Method: sRGB relative luminance; OKLCH -> sRGB through OKLab; `color-mix(in oklch ...)` surfaces interpolated as the browser does; translucent borders composited in sRGB.
Source values are the real theme values (tailwind.config.js, styles.css). Rerun with `node contrast-check.mjs`.

| Pair | Dark | Light | Verdict |
| --- | --- | --- | --- |
| base-content on surface-0 / 1 / 2 / 3 | 14.86 / 14.01 / 13.89 / 12.52 | 15.91 / 14.41 / 14.21 / 13.35 | pass |
| base-content-muted on surface-0 / 1 / 2 / 3 | 6.06 / 5.71 / 5.66 / 5.11 | 6.03 / 5.46 / 5.39 / 5.06 | pass (kind badge text sits on surface-3: 5.11 / 5.06) |
| state-run text on surface-0 / 1 / 2 | 5.04 / 4.75 / 4.71 | 6.07 / 5.49 / 5.42 | pass |
| state-need text on surface-0 / 1 / 2 | 6.61 / 6.23 / 6.18 | 5.83 / 5.28 / 5.21 | pass |
| state-err text on surface-0 / 1 / 2 | 4.92 / 4.64 / 4.60 | 6.12 / 5.55 / 5.47 | pass |
| state-done text on surface-0 / 1 / 2 | 5.62 / 5.30 / 5.25 | 5.71 / 5.17 / 5.10 | pass |
| state-idle text on surface-0 / 1 / 2 | 7.30 / 6.88 / 6.82 | 5.29 / 4.79 / 4.73 | pass |
| Status words on surface-3 | run 4.25, err 4.15 | idle 4.44 | FAIL, so status words are never placed on surface-3 (chips use surface-1, hover surface-2). Rule R1 |
| Status word on a 12% tinted fill | run 4.12 | need 4.43 | FAIL, so no tinted status fills. Rule R2 (Decision D2) |
| `--ptah-link` (Review changes) on surface-0 | 8.81 (gold) | 6.28 (gold-strong; plain gold would be 4.10, FAIL) | pass with the token |
| Send glyph (base-100 on base-content) | 14.86 | 15.91 | pass |
| Done checkbox: fill vs surface-0 | 5.62 | 5.71 | pass (UI) |
| Done check glyph (base-100 on state-done) | 5.62 | 5.71 | pass (UI) |
| Pending checkbox outline (55% base-content) vs surface-0 | 5.17 | 3.81 | pass (UI >= 3) |
| In-progress ring / run dot vs surface-0 | 5.04 | 6.07 | pass (UI) |
| Context fill gold vs surface-0 | 8.81 | 4.10 | pass (UI >= 3); percent is also printed as text |
| Context fill warn / crit vs surface-0 | need 6.61 / err 4.92 | need 5.83 / err 6.12 | pass (UI) |
| Focus ring (real token: `--s` dark, `--ptah-gold-strong` light, 8.4) vs surface-0 / 1 / 2 / 3 | 8.81 / 8.31 / 8.24 / 7.43 | 6.28 / 5.68 / 5.61 / 5.26 | pass (UI >= 3) |
| Request panel buttons: `Allow` (done ink) / `Deny` (err ink) on surface-1 | 5.30 / 4.64 | 5.17 / 5.55 | pass |
| Diff add / delete text on surface-0 | 10.63 / 6.70 | 5.71 / 6.12 | pass |
| Hairlines (14% base-content) | 1.45 | 1.32 | decorative dividers only; no information depends on them (cards also differ by surface step); not a 1.4.11 target |
| Context bar track (22%) | 1.83 | 1.59 | decorative; `Context 41% of 200k` text and `aria-valuetext` carry the value |

Criteria applied: WCAG 2.2 SC 1.4.3 (text 4.5:1), 1.4.11 (UI components and meaningful graphics 3:1), 2.4.7 and 2.4.11 (focus visible), 2.5.8 (target size 24 px).
The project states no stricter standard; `base-content-muted.spec.ts` already enforces 4.5:1 for `--bcm` on surfaces 1-3 across all 34 themes.

Theme scope (finding 7): every number in this section is measured for `anubis` (dark) and `anubis-light` ONLY, and this spec claims nothing wider. Other theme-picker
themes inherit `--state-ink-*` only when they define it; otherwise the `text-state-*` utilities fall back to the daisyUI semantic colours (`--in`, `--wa`, `--er`, `--su`),
which are not contrast-tuned for text. Follow-up T4 (not this task): run `contrast-check.mjs` for at least one dark and one light third-party theme, record the pairs in a table,
and either define `--state-ink-*` for the failing themes or change the utility fallback. Until then the design is safe by construction on any theme in one respect only:
colour is never the only signal (every status is a word, icons accompany permission and error lines, todo state has a prefix), and `--bcm` text is already enforced everywhere.

### 8.3 Overlay focus behaviour (shell width < 960 px: sheet at 640-959 px, full-width sheet below, including the 400 px sidebar; review finding 4)

Docked mode (>= 960 px) is a plain `<aside aria-label="This session">` with no trapping and no inert. The rules below apply only while the inspector is an overlay.

| Moment | Rule |
| --- | --- |
| Default | closed on load and on every session switch; the inspector never opens itself and never takes focus |
| Open (toggle by keyboard or pointer) | (1) remember the opener (`document.activeElement`, normally the header toggle); (2) set `inert` on the whole main region (header, thread, composer, in one wrapper) so nothing behind the sheet is focusable, clickable or read; (3) the sheet gets `role="dialog" aria-modal="true" aria-label="This session"` instead of the landmark role and the toggle gets `aria-pressed="true"`; (4) focus moves to `Close session details` immediately (it does not wait for the 220 ms slide); (5) the scrim is `aria-hidden` and pointer-only |
| While open | Tab and Shift+Tab cycle inside the sheet (a keydown handler wraps last to first and first to last; `inert` alone would still let focus reach browser UI); `Esc` closes the innermost layer first (an open request panel, then the sheet); a pointer click on the scrim closes |
| Resize across 960 px while open | to docked: remove `inert`, `role="dialog"` and `aria-modal`, keep focus where it is; to overlay: the sheet closes (path 6) |

Focus return, every close path (focus is always set programmatically, because a pointer click on the scrim or a removed element would otherwise drop it to `body`):

| # | Close path | Focus goes to |
| --- | --- | --- |
| 1 | `Esc` | the opener |
| 2 | `Close session details` button | the opener |
| 3 | scrim click (the scrim covers the whole shell except the sheet, including the header, so the inert toggle is never the click target) | the opener |
| 4 | select an agent row (opens that lane in the main area; at overlay width the sheet closes) | the opened lane's title `<h1 tabindex="-1">` |
| 5 | `Open lane` in a request panel | same as 4 |
| 6 | automatic close (session switch, tab closed, resize to overlay) | the opener when it is still connected and visible, else the session title `<h1 tabindex="-1">` |
| 7 | `Answer` (4.5) | the first option of the question card in the thread |

Never `body`. `tabindex="-1"` focus targets carry the full ring utility set of 8.4. With `prefers-reduced-motion` the slide is instant; behaviour is otherwise identical.

Keyboard-order acceptance check (sheet open at a 400 px shell): `Close session details`, then each row button top to bottom with its `Review` / `Answer`, `+N more`,
`Allow`, `Deny`, `Open lane` when present, `Show N more todos`, `Review changes`, `Retry reading git status` when present, then wrap to `Close`. None of the sidebar toggle,
inspector toggle, chips, transcript controls or composer may receive focus while the sheet is open. Tab from the last control wraps; Shift+Tab from `Close` reaches the last
control. Prototype state `narrow-400-overlay-focus` demonstrates entry, inert, wrap, and return on paths 1, 2, 3 and 7 (its `capture.mjs checks` run); paths 4-6 (row select, `Open lane`, automatic close) are implementation acceptance items.

### 8.4 Focus ring audit (review findings 5 and 7)

- Rule today: `styles.css:684-693` gives ONLY `button`, `input`, `select`, `textarea` and `a` the ring `outline: 2px solid oklch(var(--s))`, `outline-offset: 2px` (dark: gold).
  `styles.css:695-709` switches the colour to `--ptah-gold-strong` in `anubis-light` for those same five elements (`:where([data-theme='anubis-light'])`) and for elements that
  carry the arbitrary utility `focus-visible:outline-[oklch(var(--s))]`. Plain gold on the light cream panels measures 2.94-3.41:1 (comment at `styles.css:696-698`), under the 3:1 minimum.
- Consequence for this spec: every control in the new UI is a native `button`, `a`, `input`, `select` or `textarea` (so it gets the ring, in gold-strong in light); no `div[tabindex]`,
  no `role="button"` on a non-button, no `summary` as a control (they would get no ring at all). Programmatic focus targets (the `h1` title, regions, any `tabindex="-1"` element) carry the
  full utility set `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]`, so they ring in dark and, through the second
  light selector, in gold-strong in light. (The utility sets only the colour; the width and offset must be added.)
- Measured with the real token (`prototype/assets/contrast-check.mjs`, re-run 2026-10-15; the audit row now uses `--s` in dark and `--ptah-gold-strong` in light, which answers the
  review's note about its earlier row): dark 8.81 / 8.31 / 8.24 / 7.43 on surface 0 / 1 / 2 / 3; light 6.28 / 5.68 / 5.61 / 5.26. For reference, plain light gold as a ring on surface-1 is 3.71
  (not used; the real panels measure lower). `styles.css:698-699` states 6.31:1 on base-100 and 5.24:1 on base-300 for gold-strong, consistent with these rows (surface-0 here is a
  slightly different cream).
- Geometry: chips, icon buttons, composer buttons and header controls use the 2 px offset ring over the enclosing surface (surface-0 or 1). Inspector rows use `outline-offset: -2px`
  so the scroll container does not clip the ring; the ring then sits on the row's own surface (surface-0, or surface-2 when selected), both measured above.

---

## 9. Data and backend sources (flag for the architect)

| Element | Source today | Gap and decision |
| --- | --- | --- |
| Tokens, cost, turns, model | `tab.sessionStats`, `tab.liveModelStats` (used by `canvas-session-details`) | none |
| Context % and window | `liveModelStats.{contextKnown, contextWindow, contextPercent}` (handoff-1 section 4) | none; if `contextWindow` is unknown show `41%` without `of 200k` |
| Branch (header, composer, git) | `tab.agentOrigin.branch`, else workspace-wide `GitStatusService.branch` (then `title` = `Workspace branch`) | none |
| Workspace name | `ElectronLayoutService.activeWorkspace` / tab workspace path | none |
| Additions / deletions / partial | `SessionGitStatsStore.stateFor(root)` | none |
| Ahead / behind counts | NOT available: `SessionGitStatsStore` has additions, deletions, partial only; `GitStatusService` is workspace-wide (decisions.md row 9) | NOT shipped: hidden until a per-session source exists. A backend / git-service addition (`git rev-list --left-right --count @{u}...HEAD`) needs its own recorded decision |
| Todo items with status | `parseTodoList` (`compact-session-metrics.ts:105`) returns items; `summarizeTodos` (`:67`) returns counts and the active title | frontend-only: the inspector uses `parseTodoList` and derives the counts from the same list; count-only fallback when parsing fails (4.3). No backend work |
| Agent rows (kind, status, start, activity) | `buildLaneSummary` (`compact-lane-rows.ts:52`) over `sessionSubagentsForSession()`, `agentsOwnedBySession()`, `BackgroundAgentStore.agentsForSession()` | sub-agents: `lastToolName` only and no start time, so no live duration (row shows status only); CLI lanes: derive the activity line from the last `segments` entry; background: live shells are not exposed (only `pendingBackgroundTasks` after a turn), so no numeric progress (`212 of 340`) is drawn; hide absent fields, never invent them |
| CLI lane id to mark | `ptah-provider-mark` (`PROVIDER_BRAND_SLUGS`) | Gemini has no vendored artwork (falls back to `terminal`); optional follow-up through `scripts/brand-icons.manifest.json` |
| Permission and question requests | session list (C-15), `MonitoredAgent.permissionQueue`, `resolvedQuestionRequests()` (C-16) | answered in place by the inspector's request panel using today's handlers (4.5); the Electron single chat view needs no new surface for this. A native lane-permission surface (T1-07) is optional afterwards |
| `Worked for` duration | message `timestamp` and `duration` | derived client-side by 3.9; `[verify]` that completed assistant messages carry a finite `duration` live and after restore, else the label is `Worked` |
| `N needs you` | the unique-request count of 9.1 | derived in one place |

### 9.1 Inspector aggregate: one session-scoped contract (review finding 3)

Owner: ONE computed view model per session, built in the inspector host (canvas lib) from existing stores, keyed by tab id; the header chip, the toggle dot, the orchestrator
state, AGENTS, the live-line verb and the `N needs you` count all read it, and nothing else derives these numbers. No new backend call, no new persisted field.

Inputs (existing): `TabState` (`status`, `sessionStats`, `liveModelStats`, `agentOrigin`, `messages`, `streamingState`), `AgentMonitorStore` (`sessionSubagentsForSession`,
`agentsOwnedBySession`, `MonitoredAgent.permissionQueue`), `BackgroundAgentStore.agentsForSession`, `chatStore.unmatchedPermissions()`, `resolvedQuestionRequests()`,
`SessionGitStatsStore.stateFor(root)`, `parseTodoList` / `summarizeTodos`.

Each section returns `status: loading | ready | partial | unknown | error` plus its fields. Presentation per status (prototype `body=loading|partial|error|empty`):

| Section | Derived fields | loading | unknown | partial / error |
| --- | --- | --- | --- | --- |
| Orchestrator | state label (`working`, `waiting on N agents`, `needs you`, `idle`), model, context, tokens, cost, turns | skeleton card | each missing number shows `—`; context shows `—` with an empty bar and `aria-valuetext="Context usage unavailable"` | n/a |
| Agents | rows (4.2), `active` = running + waiting + queued, `finished` = done + failed + stopped | 3 skeleton rows, `aria-busy="true"` | no lanes: empty state, meta `none yet` | `partial` when a restored session lacks stored durations or activity lines: meta adds a `partial` marker (`title` `Restored session: some durations and activity are not stored`); each row hides the fields it lacks |
| Requests | unique requests, per-row queues, `N` | no chip and no dot until the stores have hydrated; never an "all clear" message while loading | n/a | request send failure: row-level error with `Retry` (4.5) |
| Todos | items, counts, active title | skeleton rows | `parseTodoList` failed and no counts: meta `unknown` and the note `Could not read the todo list for this session. It may be stored in an older format.` (`role="status"`) | counts only: `2 of 5` plus `Todo details unavailable` |
| Git | branch, additions, deletions, partial flag | skeleton row | not a repo: `Not a git repository` | error: `Could not read git status` + `Retry reading git status`; ahead / behind never drawn |

De-duplication of "needs you": every request has one identity, `requestKey` = the request `id` (`PermissionRequest.id`, `AskUserQuestionRequest.id`; if a source lacks an id, fall back to
`{source}:{ownerKey}:{kind}:{hash of tool name and input}`) `[verify]`. The session permission list and each lane's `permissionQueue` are merged by `requestKey`, so the same request seen in
both counts once; a lane that is waiting on a question counts through that question only; two distinct requests from one lane count twice. `N` = unique open `requestKey`s + the number of lanes
whose status is `waiting` with no resolvable request (so a waiting lane is never silently dropped and never counted twice). Responses and `Closed` states (4.5) remove the key everywhere at once.

Acceptance gates (explicit dependencies, none hidden): G1 no backend change ships with this task. G2 the todo list and counts come from the same `parseTodoList` result; the count-only fallback is
reachable. G3 the `↑ ↓` pair stays hidden until `ahead` and `behind` exist on a per-session source (needs its own recorded decision). G4 the unique-request count is computed once (9.1) and the
header chip, toggle dot, orchestrator state and AGENTS order agree in the prototype states `ask=multi` and `ask=question`. G5 the `[verify]` items (request `id` fields, `MonitoredAgent` completion time,
`duration` on completed messages, restored-history timestamps, per-lane activity from `segments`) are checked by the architect before the plan is final.

---

## 10. Decisions

| # | Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Send button is a neutral inverse circle (`bg-base-content`), as in the reference, not `btn-primary` | (a) inverse neutral, (b) `btn-primary` (blue #2563eb dark / teal light) | Reference shows white circle. Primary blue would collide with the `running` state ink (#3b82f6) in the same composer; teal in light is a third accent. One prominent action per surface still holds (it is the only filled control) | yes, swap two classes |
| D2 | Status is a word in state ink, never a tinted or filled badge | tinted chip fills | Measured: run on 12% tint 4.12:1 (dark), need 4.43:1 (light), both below 4.5 | yes, but needs new tuned tokens |
| D3 | Status words and kind badges stay off `surface-3`; chips use `surface-1`, hover `surface-2` | any surface | dark run 4.25, err 4.15 on surface-3 | no (contrast) |
| D4 | Explicit radii (6 / 12 / 4 px), not `--rounded-btn` | theme radii | `anubis-light` sets `--rounded-btn: 2rem` (pill); the reference radius is 6 px in both themes | yes |
| D5 | CLI lane icon = `ptah-provider-mark`, falling back to lucide `terminal` (not `square-terminal`) | `square-terminal`, `terminal`, always generic | Reference shows `>_` for every lane; the repo's `ProviderMarkComponent` fallback glyph for CLI routes is `Terminal`; same fallback means no new mapping table | yes |
| D6 | `N needs you` is a status chip, not a button; the action lives on the inspector row (`Review`) and the toggle shows a dot when closed | clickable chip | Skill rule: status is a hint, not a button; avoids two paths to one action | yes |
| D7 | Gold as text uses new `--ptah-link` | raw `text-secondary` | gold text = 4.10:1 on anubis-light | yes |
| D8 | Composer workspace and branch chips are hints, not controls, in this release | pickers | The reference shows no affordance (no chevron); workspace and branch are fixed per session | yes, add chevron + menu later |
| D9 | Inspector docks at >= 960 px shell width, otherwise overlays; breakpoints are container-based | viewport media queries | the product runs embedded (400 px sidebar, Rail panes); viewport queries cannot see that | yes |
| D10 | Open-turn disclosure reads `Working · t` and is omitted when the log is empty | always show `Worked for`; always omit until done | Reference turn 2 has no row and a live line; streaming needs a handle to collapse | yes |
| D11 | The action row is always visible on completed turns | hover reveal | reference shows it at rest | yes |
| D12 | Permission command wraps instead of truncating | ellipsis | the user must read what they approve; truncation measured at "npx nx li..." | yes |
| D13 | Prototype CSS is hand-written with the app's tokens; spec lists the utility strings | run Tailwind CLI | task rules forbid builds and installs; no `node_modules` in the worktree | n/a |
| D14 | Stagger caps (8 turn items, 6 inspector rows) | unlimited cascade | long threads would otherwise delay content past 600 ms | yes |
| D15 | Row primary button and permission `Review` are siblings | nested buttons | invalid HTML, broken a11y | no |
| D16 | `compact` view mode is a density and disclosure preference over the same clean-turn transcript, not a card (3.8) | (a) keep a chat-host card as `compact`; (b) density variant; (c) remove the toggle | PM-1 keeps the toggle and retires the chat-host card (A-6); (b) needs no new surface and loses no capability; (c) is a user-reserved removal | yes |
| D17 | Turn duration uses only durable message fields; no in-memory frozen value (3.9) | live-frozen value; durable-only | task-description criterion 8 needs the label to be identical after reload; handoff-1 / decisions row 9: no live turn start time | yes |
| D18 | `Review` on a permission expands an inline request panel in the inspector; `Answer` focuses the existing question card (4.5) | open a native lane surface; modal; inline | the chat host already answers lane requests in place (A-10); Electron has no lane surface (T1-07); the question UI already exists (C-16) | yes |
| D19 | The five PM `remove-proposed` rows (B-4, B-8, B-11, B-14, B-15) are kept at a new location, so the design proposes no removal (12.2, 12.3) | drop them for a cleaner turn | PM-5 default is keep or move; removal is user-reserved; each has a place that leaves the reference look intact | yes |
| D20 | Ahead / behind hidden until a per-session source exists (4.4, 9.1) | draw `↑0 ↓0`; add a backend call | decisions.md row 9: `GitStatusService` is workspace-wide; a placeholder would read as real data | yes |
| D21 | Thread scroller uses `scrollbar-gutter: stable both-edges` (2.2) | `stable`; overlay scrollbar | the one-edge gutter shifted the thread 6 px left of the composer centre | yes |

## 11. Lane-introduced constraints

Only items marked `[lane-proposed]` need Gate 1.7 acceptance: `--ptah-link` token (1.6), optional `surface-border-strong` Tailwind colour (1.6), rules R1 (status words never on surface-3)
and R2 (no tinted status fills) in 8.2, the stagger caps (D14). Added in revision round 1, all `[lane-proposed]`: the density meaning of `compact` view mode (3.8, D16), the inline request panel
and its routing (4.5, D18), the symmetric scrollbar gutter and composer geometry (2.2, D21), the overlay focus contract (8.3), the ring-utility rule for programmatic focus targets (8.4). No existing
project component is banned; every kept capability of section 12 keeps its component (`ptah-token-badge`, `ptah-cost-badge`, `ptah-copy-button`, tray, banners).

## 12. Parity: surface by surface (finding 1; row IDs of `parity-inventory.md`)

`parity-inventory.md` (project-manager lane) is the authority for the rows and their evidence; this table gives the NEW location and interaction of each row in this design. Decision words
follow the inventory (`keep` = unchanged; `move` = same capability, new place). Five rows the inventory marks `remove-proposed` (B-4, B-8, B-11, B-14, B-15) are kept at a new place in this
design (12.2), so the inventory's decision cells for them change to `move` (B-4, B-8, B-11) and `keep` (B-14, B-15). Nothing is removed by this design (12.3). Prototype: `?parity=1` shows
the retained surfaces.

### 12.1 Table

| ID | Capability | Decision | New location and interaction | Spec |
| --- | --- | --- | --- | --- |
| A-1 | Per-tab `viewMode` `full` / `compact` | keep | same API; `full` = reference density, `compact` = tighter density with collapsed live log | 3.8 |
| A-2 | View mode survives reload | keep | unchanged | 3.8 |
| A-3 | Toggle in the tab item | keep | unchanged | 3.8 |
| A-4 | Toggle in the Rail focus header | keep | unchanged | 3.8 |
| A-5 | Rail board card stays the compact rail card | keep | unchanged, out of scope | 3.8 |
| A-6 | Chat-host compact card replaces the transcript | move | retired; the clean turn is the transcript, the inspector holds the aggregates | 3, 3.8, 4 |
| A-7 | Live and finalized session summary text | move | work log while streaming; final answer when done | 3.1, 3.3, 3.4 |
| A-8 | Lane rows with status | move | agent chip row in the turn; AGENTS rows in the inspector | 3.5, 4.2 |
| A-9 | Open a lane from a lane row | move | chip click, row button, `Open lane` link in a request panel | 3.5, 4.2, 4.5 |
| A-10 | Permission callout with inline Allow / Deny | move | `Review` expands the request panel with `Allow` / `Deny` (same handlers) | 4.5 |
| A-11 | Open the request source | move | `Open lane` link in the request panel (not offered in the Electron single chat view) | 4.5 |
| A-12 | Answer a question from the callout | move | `Answer` focuses the C-16 question card | 4.5 |
| A-13 | Requests filtered to this tab | move | `targetsTab` filter feeds the session aggregate | 9.1 |
| A-14 | Elapsed time of the running session | move | live line timer and `Working · t` label (3.9 derivation) | 3.7, 3.9 |
| A-15 | Branch, context %, todos, git +/- | move | inspector Orchestrator card, TODOS, GIT; header and composer branch hints | 4.1, 4.3, 4.4, 5, 6 |
| A-16 | `Show output` / expand to full view | move | disclosure row opens the log; `Show activity` opens the activity panel | 3.2, 3.6, 3.11 |
| B-1 | Auto-collapse of older messages | move | per-turn auto-collapse of the work log on the final message | 3.1 |
| B-2 | Collapse button with chevron and `aria-expanded` | move | disclosure row `Worked for` | 3.2 |
| B-3 | Message title and collapsed description | move | final answer always visible under the row | 3.4 |
| B-4 | Collapsed tool and file counts | move (was remove-proposed) | `6 tools · 3 files` meta at the right end of the disclosure row, in the accessible name | 3.2 |
| B-5 | Execution tree (text, thinking, tool cards, SDK cards, `ptah-ui`, inline permission card, agents) | keep | the expanded work log renders the same tree | 3.3 |
| B-6 | Mermaid fallback of message text | keep | answer and log render it as today | 3.3, 3.4 |
| B-7 | Typing cursor while streaming | move | blinking caret on the last log line | 3.3 |
| B-8 | Collapsed-state cost badge | move (was remove-proposed) | `Cost` in the activity panel behind `Show activity` | 3.11 |
| B-9 | Collapsed-state duration badge | move | the `Worked for` label; `Duration` in the activity panel | 3.2, 3.9, 3.11 |
| B-10 | Copy message | keep | `Copy message` icon button, visible at rest | 3.6 |
| B-11 | Per-message token and cost badges | move (was remove-proposed) | `Tokens` and `Cost` in the activity panel (per turn; one assistant message per turn today) | 3.11 |
| B-12 | Per-message duration badge | move | the label and `Duration` in the activity panel | 3.9, 3.11 |
| B-13 | Streaming quotes while waiting | keep | inside the open work log, muted, while streaming with no output yet; the architect places it, never in the answer area | 3.1 |
| B-14 | Branch conversation from a user message | keep (was remove-proposed) | hover / focus-reveal icon button under the user bubble, same icon, label and event | 3.10 |
| B-15 | Rewind file changes to a user message | keep (was remove-proposed) | same strip; disabled with today's title when the session is not active | 3.10 |
| B-16 | User message time and sender | keep | `<time>` and `You` or peer label in the strip; peer label visible at rest | 3.10 |
| B-17 | Inbound peer styling and "self-reported and unverified" warning | keep | always visible, `triangle-alert` in need ink | 3.10 |
| B-18 | Compaction continuation disclosure | keep | disclosure inside the user bubble after a compaction divider | 3.10 |
| B-19 | File attachment names | keep | badges inside the bubble under the text | 3.10 |
| B-20 | Image count label | keep | `image` icon and label inside the bubble | 3.10 |
| B-21 | Sub-agent tile in the transcript | move | the re-skinned `subagent-tile` is the agent chip | 3.5 |
| B-22 | Inline agent bubble outside the transcript | keep | unchanged (lanes, canvas tiles) | not touched |
| B-23 | Render window and streaming boundary | keep | clean turns inside the same transcript | 3 |
| B-24 | Load older history | keep | same control at the top of the thread | 3 |
| C-1 | Agent-started session banner, open parent | keep | strip under the header, restyled (prototype `.cs-origin`) | 2 |
| C-2 | Session stats strip | keep | unchanged in the chat view; core values also in the Orchestrator card | 4.1 |
| C-3 | Strip compaction count | keep | unchanged; also in `Usage and limits` | 4.1 |
| C-4 | Strip plan limits | keep | unchanged; also in `Usage and limits` | 4.1 |
| C-5 | Strip session budget | keep | unchanged; also in `Usage and limits` | 4.1 |
| C-6 | Background-agent tray (focus, steer, stop, background) | keep | unchanged; background commands also listed in AGENTS | 4.2 |
| C-7 | Compaction-in-progress notification | keep | unchanged | not touched |
| C-8 | Compaction marker | keep | unchanged, drawn as the divider before a continuation | 3.10 |
| C-9 | Fresh-chat empty state | keep | unchanged | not touched |
| C-10 | Branch / rewind error and info banners | keep | unchanged (B-14, B-15 stay) | not touched |
| C-11 | Resume interrupted sub-agents banner | keep | unchanged | not touched |
| C-12 | Session budget banner | keep | unchanged | not touched |
| C-13 | Auth-required banner | keep | unchanged | not touched |
| C-14 | Voice-provider error toast | keep | unchanged | not touched |
| C-15 | Session permission badge | keep | unchanged; the same requests also surface as inspector rows and in `N needs you`, resolved through the shared `requestKey` | 4.5, 9.1 |
| C-16 | AskUserQuestion cards | keep | unchanged; `Answer` in the inspector focuses the card | 4.5 |
| C-17 | Queued content indicator | keep | unchanged | not touched |
| C-18 | Composer controls | keep | re-skinned composer with workspace / branch hints and approval and model chips | 6 |
| D-1 | Landmark and heading | move | `<aside aria-label="This session">` with `<h2>` | 4 |
| D-2 | Context % with bar and unavailable state | move | Orchestrator card context bar; unavailable state kept | 4.1, 9.1 |
| D-3 | Tokens (unknown `—`) | move | Orchestrator stats | 4.1 |
| D-4 | Cost (unknown `—`) | move | Orchestrator stats | 4.1 |
| D-5 | Turns (unknown `—`) | move | Orchestrator stats | 4.1 |
| D-6 | Todo count, active item, tooltip | move | TODOS via `parseTodoList`, count-only fallback, `title` text carried over | 4.3, 9.1 |
| D-7 | Branch with full-name tooltip | move | GIT row and header chip, `title` = full branch | 4.4, 5 |
| D-8 | Changes +/- with partial marker and tooltip | move | GIT row; `partial` `+` and `title` carried over | 4.4 |
| D-9 | Git tracking lifecycle per root and tab | keep | unchanged | 4.4 |
| D-10 | `@defer` lazy load of the details aside | keep | the inspector body stays a deferred block (bundle budget) | 4 |
| D-11 | "Open details" button and 288 px aside in the Rail board | keep | unchanged at >= 400 px; this spec's 336 px inspector is the chat-view host; overlay below | 2.1 |

### 12.2 The five rows the inventory proposed to remove: kept

| Row | Where it lives in this design | Visible at rest | Why it is not a removal |
| --- | --- | --- | --- |
| B-4 tool and file counts | right-end meta of the disclosure row (3.2), part of the accessible name | yes when the turn has tools or files | same data, same source (`messageSummary()`) |
| B-8 collapsed cost badge | `Cost` in the activity panel (3.11) | one click (`Show activity`) | cost is shown, per turn, with the same formatter |
| B-11 per-message tokens and cost | `Tokens` and `Cost` in the activity panel (3.11) | one click | same values; a turn is one assistant message today; several messages are summed `[verify]` |
| B-14 branch conversation | icon button under the user bubble (3.10) | on hover or focus (today's behaviour is hover reveal; focus is added) | same icon, label, event and banner |
| B-15 rewind | icon button next to branch (3.10) | on hover or focus | same icon, label, disabled rule and event |

### 12.3 Proposed removals (user decision)

None. This design removes no capability; the PM's five proposed removals are all kept at the locations in 12.2, so no approval is needed to proceed. The user can still veto the
visibility changes or choose to remove any of the following, which stay in the product until the user says so (default keep): B-4 count meta, B-8 / B-11 / B-12 activity panel
contents, B-14 branch, B-15 rewind. The only change in how often a capability is seen: B-8, B-11 and B-12 move from always-visible badges to one click behind `Show activity`.

## 13. Prototype index

`prototype/index.html?theme=dark|light&t1=collapsed|expanded&t2=ref|streaming|answered|done&insp=open|closed&body=full|empty|loading|error|partial&width=wide|sidebar&bare=1&sel=1&reduce=1&replay=0|1`
plus the round-1 parameters `ask=lane|lane-open|question|multi`, `host=electron|rail`, `fail=1`, `parity=1`. States named in this spec: `ask=lane`, `ask=lane-open`, `ask=question`,
`ask=multi`, `requests-more-open`, `request-error-retry`, `request-closed-elsewhere`, `request-electron-fallback`, `narrow-400-overlay-focus`, `parity=1`, `body=partial` (4.5). See
`prototype/README.md` and `prototype/ROUND-1-NOTES.md`.

## Revision round 1

Gate 1.7 revise round 1 of 2, text of this spec. `design-spec-review.md` (codex) findings, then the two Gate 1 findings on `task-description.md` that depend on this spec.

| Codex finding | What changed | Section |
| --- | --- | --- |
| 1 Blocking: replacement parity and removals unresolved | Old section 12 replaced by a surface-by-surface table over the PM's row IDs (A-1..D-11); user turn anatomy (attachments, compaction, peer, branch / rewind, time) and the activity panel specified; the five proposed removals are each kept with a location; "Proposed removals (user decision)" lists none and names the candidates the user may veto; D19; the PM aligns the inventory decision cells for B-4, B-8, B-11, B-14, B-15 | 3.2, 3.6, 3.10, 3.11, 12, D19 |
| 2 Serious: permission and question actions have no destination | Routing per request type and host, request identity, several requests (`+N more`), pending, success, error with Retry, closed, Electron fallback (inline panel, no Open-lane link), prototype state names from `ROUND-1-NOTES.md`; Allow / Deny, Review, Answer, Retry sizes | 4.2, 4.5, 9, D18 |
| 3 Serious: inspector data contract overstates availability | One session-scoped aggregate (owner, inputs, derived fields, per-section loading / unknown / partial / error); unique-request de-duplication and the `N` formula; ahead / behind hidden (not shipped); per-item todos through `parseTodoList` with count-only fallback; acceptance gates G1-G5; data table corrected (context window exists, `Worked for` rule) | 4.3, 4.4, 5, 9, 9.1, D20 |
| 4 Serious: overlay keyboard behaviour | Overlay focus contract: default closed, opener recorded, main region `inert`, `role="dialog" aria-modal`, focus to Close, Tab wrap, Esc innermost first, seven close paths with focus return, resize rule, keyboard-order check, 400 px sheet; prototype `narrow-400-overlay-focus` | 8.1, 8.3 |
| 5 Moderate: 24 px targets | Review and Answer 28 px high (>= 56 x 28), Allow / Deny >= 56 x 28, Retry >= 42 x 24, `+N more`, `Show N more todos`, `Review changes`, `Open lane` >= 24 x 24; full target list; non-interactive 22 px chips named | 4.2, 4.3, 4.4, 4.5, 8.1 |
| 6 Moderate: one-to-one fidelity | Reference geometry table, cause and rule for the 6 px offset (`scrollbar-gutter: stable both-edges`), composer field 60 px, bar `pb-2`, wrapper `pb-[18px]`; prototype now measures 273.5 / 415.5 / 48 / 249.5 x 758; departures P1 (Codex mark), P2 (Review button), P3-P5 labelled (`data-departure="codex-brand-mark"`, `"review-button"`) | 2, 2.2, 6 |
| 7 Moderate: contrast audit partly unverified, rule too broad | Focus ring audited with the real token on four surfaces (dark 7.43-8.81, light gold-strong 5.26-6.28; plain light gold 3.71 not used); `styles.css:684-709` read: ring and light override apply to five native elements only, so every control is native and programmatic targets carry the full utility set; Allow / Deny pairs measured; theme scope stated (anubis and anubis-light only; others T4; colour never the only signal) | 8.2, 8.4 |
| 8 Minor: icon availability | Lucide verification recorded: `PanelLeft`, `PanelRight`, `GitBranch`, `ShieldAlert`, `LoaderCircle`, `TriangleAlert` canonical in lucide-angular 1.0.0 (orchestrator); `Undo2`, `Paperclip`, `Image`, `Check` re-checked by the designer; Gemini fallback restated | 1.5 |
| Gate 1 finding 1 (`task-description-review.md`): view-mode toggle has no defined result | `full` vs `compact` table: live log, `Worked for`, answer, chips, inspector default, rhythm, all other features identical; toggle behaviour, persistence, migration; D16 | 3.8, D16 |
| Gate 1 finding 2: duration persistence vs missing source | Start, end, settle, live, reload, zero-activity, running-agents, interrupted and restored-history rules from `message.timestamp` and `message.duration`; fallback label `Worked`; durable-only so the label is identical after reload; `[verify]` items; D17 | 3.9, 9, D17 |
