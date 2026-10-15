# Design Spec: Clean session view and "This session" inspector (TASK_2026_677_efcd)

Status: Gate 1.7 revise round 1 (text of this spec; findings 1-8 of `design-spec-review.md` and findings 1-2 of `task-description-review.md`
are answered in place, see "Revision round 1" at the end). Visual source of truth: `prototype/index.html` (+ `prototype/screenshots/`).
Reference targets: `reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png`.
Design system applied: the app's own Anubis system (DaisyUI themes `anubis` dark and `anubis-light`, semantic surfaces, `text-state-*`
ink tokens, `--bcm` muted text, Inter / JetBrains Mono). No new colour, font or radius is introduced; two small token additions are
proposed in section 1.6 and are marked `[lane-proposed]`. Theme scope: contrast is measured for all 34 theme-picker themes (the two anubis themes with their own tokens, the 32 stock themes with a generated per-theme token block; section 8.2, D24). Intentional departures from the reference images are listed in section 2.2.

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
| CLI lane with vendored mark (intentional departure, see 2.2: the reference draws `>_` for every lane). Delta 2: shown inside the agent avatar, 4.7 | `ptah-provider-mark` through the single `cliId -> providerId` table of 4.7 (codex, copilot, cursor, antigravity, opencode, grok; `pi` and `ptah-cli` through their hand-authored `PROVIDER_MARKS` glyphs) | `sm` (14 px mark) in 24 / 28 px avatars, `md` in 32 px | base-content (mono paint) |
| CLI lane without mark (any unknown CLI id; Delta 2, 4.7) | monogram tile: first letter of the CLI name, theme-tinted, glyph in `text-base-content` (the `ptah-monogram-tile` idea); never the `Bot` default and no per-vendor special case | letter in the avatar | base-content |
| Background command | `layers` (`Layers`) | 14 | base-content |
| Tool: Read / Grep / Bash (work-log tool-call rows reuse today's components unchanged, D39; these glyphs are documentation of today, not a restyle) | `file-text` / `search` / `terminal` | 14 | muted |
| Tool done / running (same: today's components, D39) | `check` (12) / `loader-circle` (12, `animate-spin`) | 12 | `text-state-done` / `text-state-run` |
| Permission request | `shield-alert` (`ShieldAlert`) | 12 | `text-state-need` |
| Git ahead / behind (NOT SHIPPED: hidden until a per-session source exists, see 4.4 and 9.1) | `arrow-up`, `arrow-down` | 10 | muted |
| User turn: branch / rewind (B-14, B-15; same icons as today) | `git-branch` (`GitBranch`), `undo-2` (`Undo2`) | 14 | muted -> base-content on hover |
| User turn: attachments (B-19, B-20; same icons as today) | `paperclip` (`Paperclip`), `image` (`Image`), file-type icon from the existing `getFileIcon` | 12 | muted |
| Request panel: pending / success / error (4.5) | `loader-circle` (12, `animate-spin`), `check` (12), `triangle-alert` (14) | 12-14 | `text-state-run` / `text-state-done` / `text-state-err` |
| Todo done | `check` inside a 14 px filled box | 10, stroke 3.5 | `text-base-100` on `bg-state-done` |
| Git error | `triangle-alert` (`TriangleAlert`) | 14 | `text-state-err` |
| Empty agents | `bot` | 16 | muted |
| TASK section: task glyph, document, opens outside the chat (4.6, Delta 1) | `folder-kanban` (`FolderKanban`), `file-text` (`FileText`), `external-link` (`ExternalLink`) | 14 / 12 / 12 | muted (document links use `--ptah-link`) |

Lucide export verification (finding 8, DONE by the orchestrator 2026-10-15 against `D:\projects\ptah-extension\node_modules\lucide-angular` 1.0.0,
`icons/lucide-icons.d.ts`): `PanelLeft`, `PanelRight`, `GitBranch`, `ShieldAlert`, `LoaderCircle`, `TriangleAlert` are canonical exports. The designer
re-checked `Undo2`, `Paperclip`, `Image`, `Check` the same way (all present). A CLI id without a `ptah-provider-mark` slug renders the monogram tile of 4.7
(Delta 2; the earlier `Terminal` fallback is replaced).

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
| P1 | Codex (and every other vendored CLI) uses its provider mark | generic `>_` for every CLI lane | `ptah-provider-mark` with a monogram-tile fallback (D5, amended by D36; avatar in 4.7) | user rule "ptah-provider-mark CLI icons"; Delta 2 (decisions rows 30-31) |
| P2 | `Review` / `Answer` button on a waiting row | text-only `Needs permission: npx nx lint chat` line | outline button, 28 px high (4.2, 4.5) | the line must be actionable; routing in 4.5 |
| P3 | User-turn branch / rewind strip below the bubble (today's hover reveal, unchanged; the time and `You` stay visible at rest above the bubble, as today) | none | 3.10 | parity B-14, B-15, B-16 (Delta 1, items 2-3) |
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
| Tool call | Tool-call rows reuse today's existing tool-call components and styles unchanged (user decision, decisions.md row 32; D39); the work log only wraps them. Today's rendering, for reference only: `Read` + bold file name + muted full path + small `lines 14-25` chip; `Grep` + pattern + path + `content` mode chip. No restyle, no new row recipe, no new classes | the existing components' own classes; the `ol > li` wrapper adds no height or typography |
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
state ("Orchestrating"), and is bound to the same session needs-you aggregate as the header chip (section 9, G1) in EVERY state, including the historical reference
state of the prototype: when the aggregate has one or more open requests the verb is `Waiting for you` (not "any agent is waiting" from a separate source), and it returns to
`Orchestrating` when the aggregate reaches 0. The header `N needs you` chip and this verb can therefore never disagree. (Round 2, review finding 6.)

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
| Inspector (section 4) | INITIAL default: open and docked at >= 960 px shell width (the dock is closable) | INITIAL default: closed at every width (the `N needs you` header chip and the toggle dot stay). EXCEPTION in both modes: a tab with `TabState.workflow` set (D42) starts OPEN at docked widths |
| Vertical rhythm | user to assistant 20, assistant to user 28, answer paragraph gap 12 | 12 / 20 / 8; disclosure row 28 px tall |
| User turns, attachments, branch / rewind, compaction disclosure (3.10), banners C-1..C-17, compaction markers (the stats strip left the chat column in Delta 3: inspector SESSION, D3.3), composer, render window, older-history loading | as specified | identical |

Inspector open state (decision D23, round 2): the rows above (`full`: open and docked at >= 960 px; `compact`: closed) are INITIAL defaults only. A manual `Show` / `Hide` of the
inspector is kept per tab, in memory (not persisted), across switches between tabs, so returning to a tab restores whatever the user last chose there. Changing that tab's view
mode resets the choice to the new mode's default. In `full` mode the dock is closable (the `Close session details` control exists docked as well as in the overlay). A reload or
a new tab starts again from the mode default.

Workflow tabs (decisions.md row 36, D42, D43): a tab whose `TabState.workflow` is set (`harness-configure`, `harness-new-project`, `setup-*`) has the initial default OPEN in every mode, `compact` included, because its projected
`[inspectorSection]` (config preview, Apply; 4.8) is the primary work surface. The per-tab manual toggle still overrides it afterwards; a mode change resets that tab to the workflow default (open). Docked widths (>= 960 px) open
the inspector as the plain non-modal aside. At overlay widths (< 960 px, where the inspector is a modal sheet, 8.3) the workflow default does NOT auto-open the sheet: it stays closed, the toggle carries a 7 px dot (`--sel`
selected-indicator pair of 8.2, 2 px ring in `base-100`, decorative) and the `[sessionHeaderChip]` names the workflow, so the surface is discoverable without moving or trapping focus; the user opens it by the toggle and then 8.3 applies unchanged.
The architect exposes the rule as a per-tab initial-open input on the inspector (Delta 2 architect check 7).

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
| End `E` (settled turn) | `E = max` over the turn's assistant messages of `timestamp + duration` ONLY (decision D22, round 2); every term needs a finite `duration`, else `E` is not derivable. Nothing else enters `E`: no persisted CLI or lane completion time, and no agent runtime after the last assistant message. Frontend-only and identical after a reload |
| Settled label | derivable (`S`, `E` finite and `E - S >= 1000 ms`): `Worked for {m}m {ss}s` (`{s}s` under 1 min, `{h}h {mm}m` from 1 h). Otherwise the bare `Worked` (no number, never `0s`) |
| Live label (streaming, or any agent owned by the turn running) | `Working · {now - S}`, ticking each second (`tabular-nums`, `aria-hidden`). It needs only `S`, so it is also correct after a reload mid-turn. No finite `S`: `Working` with the pulse dot and no timer |
| Settle | when streaming ends and no owned agent runs, the label is recomputed from the durable fields above. No in-memory frozen value is kept, so the label is identical before and after a reload or tab switch (task-description criterion 8). If the live timer showed more than the durable value, the label drops to the durable value; if `E` is not derivable it becomes `Worked` |
| Zero-activity turn (no tool call, no agent) | no disclosure row at all (3.1 row 3), so no label |
| Still-running agents after the final message | the row stays `Working · {now - S}` (3.1 row 2). The settled label then measures the orchestrator's own timeline only: delegated runs that outlive the last assistant event are excluded by decision, and each chip shows its own `done · {duration}` instead. A CLI or lane completion time is never added to `E`, even if some record persists one |
| Interrupted or stopped turn | same rule (`E` = last assistant event); no new copy |
| Restored history | works when the loader maps message timestamps and durations `[verify]`; if a field is missing the label is `Worked` |
| Expanding or collapsing a turn | never changes the label |

### 3.10 User turn anatomy (parity B-14..B-20, B-16/B-17)

`<article aria-label="You">`: bubble per the reference (right-aligned, 12 px radius, `surface-2`), plus, all kept from today's bubble:

- Sender and time (B-16; Delta 1 item 2, user decision: NOT hover-gated, exactly as today): the `<time datetime>` (today's `formatTime` output, `title` = full date and time) with
  `You` (or the peer label) stays in the header line ABOVE the bubble, visible at rest in every state, unchanged from `message-bubble.component.html` (`chat-header`, `text-xs
  text-base-content-muted`, time `opacity-60`). It is NOT moved into the action strip below and is not part of any reveal. `text-[11px] text-base-content-muted tabular-nums` on
  surface-0 measures 6.06:1 dark / 6.03:1 light; if the implementation keeps today's `opacity-60` on the time, the opacity-reduced pair must be re-measured by the frontend developer
  (not asserted here). An inbound peer message shows its peer label in the same header line at rest together with today's "self-reported and unverified" warning (B-17), icon
  `triangle-alert` 12 and `text-state-need` (6.61 / 5.83 on surface-0).
- Attachments (B-19, B-20): inside the bubble under the text, `mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]`: `paperclip` 12 muted, the existing
  file badges (`badge badge-sm`, `bg-surface-3 text-base-content`, 12.52 / 13.35, `title` = full path, file-type icon from `getFileIcon`), then `image` 12 plus
  today's `imageCountLabel()` text.
- Compaction continuation (B-18): the existing disclosure ("Continued from previous conversation (compacted)") inside the bubble, same button recipe as 3.2
  at 12 px, `aria-expanded`, same copy as today (the prototype's `Continued from a compacted conversation` is illustrative; production keeps today's string), preceded by the
  retained compaction marker (C-8) as a `role="separator"` divider (prototype `.cs-divider`).
- Action strip (B-14, B-15; Delta 1 item 3): under the bubble, `flex items-center justify-end gap-0.5 mt-1`: two 28 px icon buttons (recipe of 3.6, 14 px
  icons; the time/sender are NOT in this strip, see B-16 above): `git-branch`, aria-label `Branch conversation from this message`, `title` `Branch conversation from here`; `undo-2`, aria-label `Rewind file changes
  to this message`, `title` `Rewind file changes to here`. Rewind keeps today's inactive behaviour: `disabled` + `aria-disabled`, `opacity-40`, aria-label
  `Rewind unavailable — session is not active`, `title` `Rewind is only available during an active conversation`.
  Reveal (user decision, Delta 1 item 3: today's behaviour, NOT changed): `opacity-0` at rest, `opacity-100` on hover of the message group and of the strip itself (today's
  `chat-footer ... opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity duration-200`, `message-bubble.component.html`). The earlier proposal to add a
  focus reveal (`:focus-within`) and an always-visible `(hover: none)` rule is WITHDRAWN: no focus-within rule, no `(hover: none)` override, no new transition timing. The buttons
  stay native, in the tab order and unchanged in behaviour; whatever today does for a keyboard user stays as is (a pre-existing gap, out of scope). They emit today's `branchRequested` / `rewindRequested`; the C-10 banners
  report their result unchanged. The strip is not a stagger item.

### 3.11 Activity panel (parity B-8, B-11, B-12; with the count meta of 3.2 for B-4; departure P4)

Opened by the `Show activity` button (3.6), below the action row: `<dl id aria-label="Turn activity">`, `mt-2 max-w-[600px] flex flex-wrap gap-x-5 gap-y-1.5 rounded-lg border
border-surface-border bg-surface-1 px-3 py-2.5 text-xs`; each item is `<dt>` label `text-[11px] text-base-content-muted` under `<dd>` value `font-medium tabular-nums` (DOM order
dt, dd; visual reverse via `flex-col-reverse`), items in this order and each present only when known (never `0` or a placeholder): `Duration` (the label value of 3.9),
`Tokens` (`18.2k in · 3.1k out`), `Cost` (`$0.42`), `Tool calls`, `Files changed`. Formatting reuses today's `ptah-token-badge` / `ptah-cost-badge` formatters (plain text).
Single-message turn (the transcript renders one assistant message per user prompt today): `Tokens`, `Cost`, `Tool calls` and `Files changed` are that message's values;
`Duration` stays the turn elapsed value of 3.9, and a separate `Message duration` item (that message's own `duration`, today's B-12 badge value and format) follows it
when known, because turn elapsed and message duration can differ (gate-1 r2 finding 1, decision row 20). Turn with MORE THAN ONE assistant
message (round 2, review finding 5): the panel keeps each message's own labelled metrics and shows the aggregate as a summary. Structure: the summary `<dl>` above comes first
and is labelled `All messages` (a `<dt>` heading line, `text-[11px] text-base-content-muted`); under it one `<section aria-label="Message {n} of {N}">` per assistant message
in transcript order, each a `<dl>` of the same item recipe holding that message's own `Duration` (its `duration`), `Tokens`, `Cost` (and `Tool calls` / `Files changed` when the
message owns them), with a `Message {n}` `<h4>` line (`text-[11px] font-medium`) and, when known, the message `<time>` (formatTime); the rows are separated by
`border-t border-surface-border pt-2 mt-2`. Items unknown for a message are omitted for that message only; the summary sums only the known values and states the number
of messages it covers when that differs from `N` (`Tokens · 2 of 3 messages`). So no per-message cost, token or duration datum is lost by the move behind `Show activity` (B-8/B-11/B-12 stay at message granularity). Architect check `[verify]`: the data shape (`tokenUsage`, `cost`,
`duration` on each assistant message, as read by today's badges) holds for every message of a turn after a reload, so the per-message rows can be built from persisted
fields. The panel is closed by default, available only on completed turns (the action row is hidden while open), and hidden entirely when every item is
unknown. Base-content on surface-1: 14.01 dark / 14.41 light; muted on surface-1: 5.71 / 5.46. Prototype: `.cs-activity` (`#act1`, `#act2`).

---

## 4. Inspector "This session"

`<aside id="inspector" aria-label="This session">` 336 px, column: header 48 px (`px-4 pr-3`, title 13/600 `<h2>`, close `x` button) then a scrolling body
with eight built-in `section`s in this order: Orchestrator card, SESSION (Delta 3, D3.3), AGENTS, PLAN LIMITS (Delta 3, D3.4), LANES (Delta 3, D3.5), TASK (new, 4.6, Delta 1 item 1), TODOS, GIT. TASK sits directly above TODOS. Between the Orchestrator card and AGENTS the inspector has ONE
extension slot, `[inspectorSection]` (4.8, decisions.md row 35), which renders nothing when no section is projected; the full order is therefore Orchestrator card, extension slot (workflow sessions only), SESSION, AGENTS, PLAN LIMITS, LANES, TASK, TODOS, GIT (Delta 3, D45).
Sections are separated by `border-b border-surface-border` (each `p-4`; AGENTS `pt-3.5 pb-1.5` with row-level horizontal padding).

### 4.1 Orchestrator card

- Row 1: 8 px status dot (`bg-state-run` + 3 px `ring` at 22% = the "orchestrator working" state; idle `bg-state-idle`, waiting `bg-state-need`
  with ring), "Orchestrator" 14/600 (gap 9 px).
- Row 2 (indent 17 px, `text-xs text-base-content-muted`, margin 2/12): `{state}` e.g. `waiting on 4 agents`. States: `working`,
  `waiting on N agents`, `needs you`, `idle`. DELTA 3 (D47): the model name is gone from this line (it was a second, read-only copy); the model shows only in the inspector SESSION Models row (D3.3).
- SUPERSEDED BY DELTA 3 (D46; kept for the record of the colour rule, now applied to the SESSION context ring, D3.3): the card no longer carries the context bar, the stats or the `Usage and limits` disclosure.
  Former text: Context: label row `text-[11px] text-base-content-muted` (`Context` left, `41% of 200k` right), then
  `<progress class="progress h-1 w-full text-secondary" max=100 value=41 aria-labelledby aria-valuetext="41% of the 200k token window">`.
  Fill colour: `text-secondary` (gold) < 80%, `text-state-need` 80-94%, `text-state-err` >= 95%. Track `--surface-border-strong`. Unknown context:
  `-` and empty bar with `aria-valuetext="Context usage unavailable"`. Bar width transition 400 ms `--ptah-ease-soft`.
- Stats: `grid grid-cols-3 gap-2 mt-3.5`; each is `<dt>` label 11 px muted under `<dd>` value 14/600 tabular (DOM order dt, dd; visual reverse via
  `flex-col-reverse`): `82.4k tokens`, `$1.84 cost`, `6 turns`.
- Usage and limits (parity C-2..C-5), SUPERSEDED BY DELTA 3 (D44, D46): the chat-view stats strip is removed from the chat column and the `Usage and limits` disclosure is deleted; compactions, session budget,
  plan limits and lanes are the always-visible SESSION, PLAN LIMITS and LANES sections (D3.3-D3.5), fed by the same sources (`resolvedCompactionCount()`, `resolvedStatsLimits()`, `resolvedSessionBudget()`).

### 4.2 AGENTS

Header: `AGENTS` label left, `4 active · 1 finished` right (`text-[11px] muted`, `aria-live="polite"` off; updated silently). Active = running, waiting
or queued rows; finished = done, failed or stopped rows (counted from the rows the aggregate of 9.1 returns, so header and list always agree). Order: needing
permission first, then running (newest first), then finished (most recent first). Finished rows stay (dimmed name colour is NOT used: contrast).

Row `li.agent` (hover `bg-base-content/5`, selected `aria-current="true"` = `bg-surface-2` + 2 px `bg-secondary` bar at left, `inset-y-2`, transition 120 ms):

```
(Delta 2, supersedes the earlier `[icon 14]` / `>_` / `◇` line anatomy; full tile in 4.7)
line 1: [avatar 32 + status ring + corner badge] [name 13/600 truncate] ........ [status word 12/500][ · 2m 13s muted tabular]
line 2: [kind badge] [activity text 12px muted, single line, truncate]     (e.g. "Edit canvas-lane-tabs.component.ts")
permission (only status waiting), under line 2:  [shield-alert 12] **Needs permission:** `command`   [Review]
```

- Row padding `py-[9px] px-4` (pad bottom 10), gap 8 px in line 1; Delta 2 (4.7) sets row padding 11 / 14 / 11 / 17 px and avatar-to-text gap 13 px. The permission line indent becomes `ml-[62px]` (17 px padding + 32 px avatar + 13 px gap; was `ml-[38px]`). The row's primary target is a full-width `<button class="agent__main">`
  (aria-label: `{name}, {kind}, {status} {duration}. {activity}`); it selects the agent and opens its lane in the main area.
- Kind badge: `badge badge-ghost` restyled `text-[10px] font-medium leading-none px-[5px] py-[3px] rounded border border-surface-border bg-surface-3
  text-base-content-muted h-auto` with copy `Sub-agent`, `CLI lane`, `Background` (never truncated; the name truncates first). Delta 2: the badge moves to line 2 in front of the activity text so long names such as `frontend-developer` keep their full width (4.7).
- Permission line (Delta 2: indent `ml-[62px]`, was `ml-[38px]`, 4.7): `flex items-start gap-1.5 ml-[62px] mr-4 mb-2.5 -mt-[5px] text-xs text-state-need`, "Needs permission:" 600, command in
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
- Delta 3 (D53, D3.6): the background-agent tray moved here. Under the header a summary line in the tray grammar (`1 background · 1 foreground · 2 running · 1 done`) and, on rows with an action, a 28 px `ellipsis` actions menu (`View transcript`, `Steer`, `Send to background`, `Stop`). Focus = the row button. Prototype `stats=full`.
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

| Kind | Source today | Identity `requestId` (the name `canvas-needs-you-queue.ts:57-110` already uses) | Row it appears on | Button |
| --- | --- | --- | --- | --- |
| Session permission | `chatStore.unmatchedPermissions()` (C-15), filtered by `targetsTab` (A-13) | `requestId` = `PermissionRequest.id` | Orchestrator card (its state reads `needs you`) | `Review` |
| CLI-lane permission | `MonitoredAgent.permissionQueue` (`agent-monitor.store.ts:394-442`) | `requestId` = the queue entry's `requestId` (the same request seen in both lists counts once, 9.1) | that lane's AGENTS row | `Review` |
| Sub-agent permission | session permission matched to the sub-agent by its tool-use id; unmatched falls back to the Orchestrator card | `requestId` = `PermissionRequest.id` | the sub-agent row, else Orchestrator | `Review` |
| AskUserQuestion | `resolvedQuestionRequests()` (C-16) | `requestId` = `AskUserQuestionRequest.id` | the owning lane row when it has a `laneKey`, else Orchestrator | `Answer` |

`Review` (any permission, any host) expands the request panel inline under the row: `region` with `aria-label="Permission request from {name}"`,
`mx-4 mt-2 rounded-md border border-surface-border bg-surface-1 p-3`, content: requester line (`{name} · {kind}`, `text-xs`), the full tool and command (`font-mono
text-[11px]`, wraps, never truncated), `Allow` and `Deny` buttons (`h-7 min-w-[56px] px-3 rounded-md border text-xs font-medium`; `Allow` `text-state-done`, `Deny`
`text-state-err`, each with a 55% own-ink border, both outline, no `btn-primary`; ink on surface-1 measured 5.30 / 4.64 dark and 5.17 / 5.55 light) and an `Open lane` text
link (`inline-flex h-6 items-center text-xs font-medium` in `--ptah-link`, today's `openRequest`, A-11; not offered where no lane surface exists, i.e. the Electron single chat view). Responses use today's handlers unchanged: session permissions
through `handlePermissionResponse` (C-15), lane permissions through `AgentPermissionResponder` / `PermissionHandlerService` exactly as the compact callout's `respond`
does (A-10). That path already works in the chat host, so the panel IS the Electron fallback until T1-07 mounts a native lane-permission surface; where a host also
mounts a native surface (C-15 badge, lane tile), a response given on either one resolves the request on both because they share the `requestId`.

`Answer` does not re-implement the question UI. It scrolls the existing question card (C-16) into view in the main thread and focuses its first option; a lane-owned
question does NOT open its lane first in any host (Delta 1 item 6, orchestrator decision: on `host=rail` opening the lane replaces the thread and would hide the very card the
user is answering; the card of the session is the target). At overlay width the sheet closes first and focus goes to the card (the one exception to the return-to-toggle rule, 8.3
path 7). The lane stays reachable through the row button and `Open lane` as before. Card missing (round 2, review finding 3): the request is NOT dropped and stays counted. If the C-16 card is not mounted when `Answer` runs (after the lane open, if any, and a 1 s wait),
the row shows a row-level error in the request region of that row: `triangle-alert` + `Could not find the question in the conversation` (`text-state-err`, `role="alert"`) + `Retry`
(same 24 px recipe as the send-failure `Retry`). Focus goes to that row's `Answer` button, or to the error region when the sheet was an overlay and is still open; never `body`. `Retry` runs `Answer` again
for the same `requestId`; success removes the error and moves focus to the card's first option. The rule is identical in every host and applies to Electron and to Rail / VS Code routing alike
(the card of that session is the target in both). The prototype models it with `?fail=card` (the card is absent from the thread). The "after the lane open, if any" wording of the card-missing rule above no longer applies: `Answer` never opens a lane first; the 1 s wait starts at the `Answer` activation.

`Open lane` and selecting an agent row (round 2, review finding 1) are one behaviour with one routing, in every host that has a lane surface: (1) activate that lane (today's `openLane`, A-9), so the
main area shows the lane's view (prototype: a mock lane view whose title is the heading `h2#laneTitle` with `tabindex="-1"` and the lane name; the header keeps the session `h1`, Delta 1 item 5); (2) close the inspector through the single close routine
`closeInsp(laneTitle)` when it is an overlay sheet (a docked inspector stays open); (3) move focus to the lane title heading (h2); (4) only then announce `Opened the {name} lane`. A host without a lane surface
(`host=electron`, the single chat view) does NOT render `Open lane`; there, selecting an agent row only sets `aria-current` and leaves the inline request panel as the working surface, and no "opened" announcement is made.

| Host (prototype `host=`) | `Review` (permission) | `Answer` (question) |
| --- | --- | --- |
| Electron single chat view (`host=electron`; no native lane-permission surface yet, T1-07) | inline request panel, the only surface: lane requests are answered in place with `Allow` / `Deny`; no `Open lane` link is offered because there is no lane surface to open | focus the C-16 card of that session |
| Electron Rail panes and VS Code webview (`host=rail`) | inline request panel plus the `Open lane` link; the C-15 badge and the lane tile stay visible and stay in sync through `requestId` | focus the C-16 card directly, including for a lane-owned question (the lane is NOT opened first: it would hide the card in the thread; Delta 1 item 6) |

Several requests: each row lists its pending requests oldest first, one panel open per row (opening another closes the first; focus moves to the opened panel's
region); rows with requests sort first (4.2); the header `N needs you` counts every unique request (9.1). More than one request on a row shows `+N more` (expanded:
`aria-expanded="true"`, the remaining requests listed with the same anatomy).

Prototype states (query string on `prototype/index.html`; screenshots are prefixed `dark-` / `light-`). These names are the acceptance vocabulary:

| Prototype state | What shows | Focus and announcement |
| --- | --- | --- |
| `ask=lane` | single lane permission row: `Needs permission: {command}` + `Review` | none |
| `ask=lane-open` | the `Review` panel open (idle) with `Allow`, `Deny`, `Open lane` | focus enters the panel region |
| `ask=question` | question row `Asked you: {first 60 chars}` + `Answer`, and the question card in the thread (also when the question is lane-owned: `host=rail` does not open the lane first) | `Answer` moves focus to the card's first option |
| `ask=question&fail=card` | the same row with the question card absent from the thread; `Answer` shows the row-level error and `Retry`; the request stays counted | focus on the row's `Answer` button (or the error region while the overlay is open); the live region announces `Could not find the question. It is still waiting.` |
| `open-lane` (`select` and `Open lane`, `host=rail`) | the mock lane view replaces the thread; at overlay width the sheet is closed | focus on the lane title heading (h2, `h2#laneTitle`, `tabindex="-1"`), then `Opened the {name} lane` |
| `ask=multi` | 5 simultaneous requests across rows, with `+N more` | none; `aria-expanded` on `+N more` |
| `requests-more-open` (`narrow-400-multi-more-open` at 400 px) | `+N more` expanded | focus stays on the `+N more` button |
| sending (transient, no screenshot) | after `Allow`, `Deny` or `Retry`: panel `aria-busy="true"`, both buttons `disabled`; a second activation for the same `requestId` is ignored | focus stays put |
| success (no screenshot: the request disappears) | the request is removed, the row status, the `N needs you` count and the header dot update | focus moves to the next pending request's button on this row or the next row, else to the lane row's main button; the single polite live region announces the outcome and the remaining count (`Allowed {command}. 2 requests need you.`) |
| `request-error-retry` (`fail=1`) | `triangle-alert` + `Could not send your response` (`text-state-err`, `role="alert"`) + `Retry` (`inline-flex h-6 min-w-[42px] items-center justify-center px-2 text-xs font-medium`, 24 px high); the request stays pending and counted; `Retry` re-sends the same decision for the same `requestId` | focus moves to the panel region (never `body`); the live region announces `Could not send your answer ... The request is still waiting.` |
| `request-closed-elsewhere` | the request was resolved elsewhere, timed out or its lane ended: `This request is no longer pending. It was answered elsewhere or the lane ended.` (`role="status"`) + `Close` button; no error; the count decrements | `Close` returns focus to the row's main button and announces `Closed.` |
| `request-electron-fallback` | `host=electron`: lane requests answered in place, no `Open lane` link | as success |
| `narrow-400-overlay-focus` | the inspector as an overlay sheet at a 400 px shell, opened by keyboard, focus on `Close session details`, background inert | per 8.3 |
| `parity=1` | retained surfaces visible: agent-origin strip, attachments, branch/rewind, activity panel, compaction divider, usage and limits, continuation | per section 12 |
| `body=partial` | unknown and partial inspector sections (9.1) | none |

Nothing here leaves a waiting request without a working action: the permission panel works in every host, and `Answer` reports its own failure with a retry.

---

### 4.6 TASK (new section, Delta 1 item 1; user scope add, decisions rows 21 and 22)

Shows the session's linked PRIMARY task and the documents in its task folder, so the user can jump from the conversation to the spec it is executing. It sits between AGENTS and
TODOS (TODOS, fed by `TodoWrite` through `parseTodoList`, is unchanged and stays below). Frontend only (decisions row 21); no new backend call or stored field.

Data (all existing, `[verify]` by the architect): the session-to-task link is the session organization record (`taskIds`, with per-link `role` `primary | related`, `rpc-session.types.ts`,
`session:linkTask`; a session has at most one primary); the task is read with `tasks:get` (`TasksGetResult.task: TaskSpecDetail | null`: `id`, `title`, `status`, `artifacts: string[]` =
the filenames present in the folder); the section refreshes on the `tasks:changed` push (`TasksChangedNotification`: `workspaceRoot`, `reason`, optional `folderNames`).

Anatomy (inspector body width 304 px inside `p-4`; same section-header recipe as TODOS; `<section aria-labelledby>` whose heading text is `TASK`):

```
TASK                                                                   (header: label only, 11 px/600 tracking as TODOS)
[folder-kanban 14]  TASK_2026_677_efcd                                  line 1: ID, font-mono text-[11px] text-base-content-muted, break-all (never truncated)
Clean session view and inspector                                         line 2: title 13/600 leading-[1.35], line-clamp-2, title attribute = full title
( In Progress )   Stage: Design                                          line 3: status pill + derived stage (text-xs muted)
-----------------------------------------------------------------
Documents                                                                line 4: label text-[11px] muted
[file-text] task.md                                       [external-link]  artifact rows (ul), h-6, link ink
[file-text] task-description.md                           [external-link]
...
+3 more documents                                                        text button, h-6
+2 related tasks                                                         text button, h-6
```

- Status pill: text is `TASK_STATUS_LABELS[status]` verbatim (`Backlog`, `In Progress`, `In Review`, `Blocked`, `Done`, `Cancelled`; `libs/frontend/tasks-ui/src/lib/task-presentation.ts:27`). Colour
  semantics follow the board's `TASK_STATUS_BADGE` mapping (info, warning, error, success, ghost, neutral) but are drawn with the project's measured status inks, not the daisyUI fill:
  `in_progress` `text-state-run`, `in_review` `text-state-need`, `blocked` `text-state-err`, `done` `text-state-done`, `backlog` and `cancelled` `text-base-content-muted`. Shape
  `inline-flex h-5 items-center rounded-full border border-current/55 px-2 text-[11px] font-medium`, transparent fill (rule R2: no tinted fills), never on surface-3 (rule R1). The word
  is always present, so colour is never the only signal. Measured pairs (section 8.2, no new pair is introduced): run / need / err / done ink on surface-0 5.04 / 6.61 / 4.92 / 5.62 dark and
  6.07 / 5.83 / 6.12 / 5.71 light; muted on surface-0 6.06 dark / 6.03 light; ID (muted) the same; artifact link ink `--ptah-link` on surface-0 8.81 dark / 6.28 light. Decision D29 records why
  the daisyUI `badge-*` fills are not reused as is.
- Stage (the user's "current phase, if derivable"): the task has no phase field, so the value is DERIVED from which documents exist, taking the furthest present step of the ladder
  Requirements (`task-description.md`) < Design (`design-spec.md`, `visual-design-specification.md`, `design-handoff.md`) < Plan (`implementation-plan.md`) < Build (`batches.md` or `tasks.md`) <
  Review (`code-style-review.md`, `code-logic-review.md`, `visual-review.md`) < Test (`test-report.md`). The row is omitted when none of these exist (a task with only `task.md` shows no Stage).
  `title` = `Derived from the documents in the task folder`. It is a hint, not a state machine; the architect owns where the ladder lives (a presentation helper next to `task-presentation.ts`).
- Documents (artifact links): a `<ul aria-label="Task documents">` of the files that EXIST in `task.artifacts`, plus `task.md` (the carrier), never a file that is absent. Order: `task.md`, then the
  recognised documents in the shared `DOC_FILES` order, then review and judge files, then `handoff-N.md` ascending by N, then any remaining `*.md` alphabetically. Each `<li>` holds one
  native `<button type="button">`: `flex h-6 w-full min-w-6 items-center gap-1.5 rounded-sm px-1.5 text-left font-mono text-xs` in `--ptah-link`, `hover:underline underline-offset-2`, leading
  `file-text` 12 muted, filename (truncates with `title` = filename), trailing `external-link` 12 muted (always visible; it says the file leaves the chat). aria-label `Open {filename}`.
  At most 6 rows at rest; more files sit behind a `+N more documents` text button (`inline-flex h-6 min-w-6 items-center px-1.5 text-xs font-medium text-base-content`, `aria-expanded`,
  aria-label `Show {N} more documents`), expanded in place.
- Open action (requirement; the architect verifies the exact path): a click opens the file the way the git sidebar opens files, that is through the same editor-open request the git UI uses
  for a workspace file (`editor:openFile` is the call the git-ui `open-in` code refers to, `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts`), with the absolute path
  `{workspaceRoot}/.ptah/specs/{folderName}/{file}` (`SPEC_ROOT` in `task-spec.contract.ts`). `tasks:getArtifact` is NOT the open path: it reads only the closed `DocFile` set and
  returns markdown text, so it cannot serve `handoff-N.md`, `task.md` or judge files. If a host has no editor-open request, the architect chooses and records the fallback; this spec does
  not invent one. Failure: a row-level message under the list, `role="alert"`, `triangle-alert` 14 + `Could not open {filename}` (`text-state-err`, `text-xs`) + `Retry` (24 px recipe of
  4.4), focus stays on the row button. No success toast.
- Several linked tasks: the lead is the `primary` link; with no primary, the first related link in stored order leads (`[verify]` order). The other linked tasks are `related` and sit behind a
  `+N related tasks` text button (24 px, `aria-expanded`, aria-label `Show {N} related tasks`). Expanded, each is a non-interactive `<li>` with ID (mono 11), title (13, truncate, `title`) and
  status pill; related tasks show no document links, and the row is deliberately NOT a button because no destination for it was decided. Reversible (D30).
- Live: the section re-reads `tasks:get` when `tasks:changed` arrives with `folderNames` containing the lead task's `folderName`, or with no `folderNames`, debounced 300 ms (`[verify]`).
  A refresh keeps the current content on screen (no skeleton, no `aria-busy`); status, title, stage and the file list update in place. No announcement (the live-region budget of 8.1 is
  unchanged: status changes in the inspector never announce). A task whose status changes while the section is visible simply shows the new pill; there is no animation beyond the
  120 ms colour transition, removed under `prefers-reduced-motion`. Architect `[verify]`: `TasksStoreService.handleMessage` only refreshes while the Tasks board surface is open
  (`surfaceOpen`, `tasks-store.service.ts:1121-1140`), so the inspector needs its own consumer of the `tasks:changed` message type (or a store hook that does not require the board),
  decided without importing the board.
- States (aggregate status per 9.1):
  - No linked task (decision D27): the section is NOT rendered. Not even a heading. While the session organization record has not resolved the section is also not rendered and nothing
    is announced.
  - Loading (link known, `tasks:get` pending): `aria-busy="true"` on the section, skeleton `h-3 w-40` (ID), `h-4 w-56` (title), `h-5 w-24` (pill), two `h-6` bars; no text.
  - Ready: as above.
  - Partial (`task` loaded but `artifacts` empty or absent): ID, title and status show; under Documents the muted line `No documents yet` (`text-xs`, `role="status"`).
  - Task not found (`tasks:get` returns `task: null`, e.g. the folder was deleted or excluded): ID row from the link, muted line `Task folder not found`; no Retry (it is not an error), no links.
  - Error (RPC failed): ID row from the link when known, then `triangle-alert` 14 + `Could not load the task` (`text-state-err`, `role="alert"`) + `Retry` (24 px, aria-label
    `Retry loading task`, `loader-circle` and `aria-busy` while retrying; the message stays until a read succeeds).
- Accessibility: a real list (`ul > li`) for documents and for related tasks; every control is a native `button` (so it gets the ring of 8.4, gold-strong in light); targets are >= 24 x 24
  (`h-6 min-w-6`, 2.5.8); the ID is selectable text; no hover-only information; the section adds no live region. Tab order inside the section: document buttons top to bottom, `+N more
  documents`, `+N related tasks`, `Retry loading task` / `Retry` when present.
- Icons (confirmed present in `lucide-angular` 1.0.0 `icons/lucide-icons.d.ts`, `aria-hidden="true"`): `FolderKanban` (`folder-kanban`) task glyph, `FileText` (`file-text`) document, `ExternalLink`
  (`external-link`) opens outside the chat, plus the existing `TriangleAlert` and `LoaderCircle`.
- Bundle (the inspector is a lazy `@defer` block): the TASK section may reuse only the presentation helpers and types of tasks-ui (`TASK_STATUS_LABELS`, the status to ink mapping,
  `WORKFLOW_ARTIFACTS` / `DOC_FILES` ordering, `TaskSpecDetail` as a type). It must NOT import the Tasks board, `TasksStoreService`, or any tasks-ui component into the chat or canvas
  graph. If the library barrel would drag those in, the architect exposes the presentation helpers through a narrower entry point; the choice is the architect's and is checked against the
  initial-bundle budget (the 629 follow-up deferred Rail details for the same reason).
- Prototype vocabulary (for the prototype designer; query string on `prototype/index.html`): `task=none` (section absent), `task=loading`, `task=ready`, `task=multi` (primary plus `+2 related
  tasks`, expanded variant), `task=partial`, `task=missing`, `task=error` (with Retry), `task=open-fail` (document open error), `task=live` (status changes from In Progress to In Review in place, no announcement).

### 4.7 Agent tile and icon system (Delta 2; user decisions rows 30-31; D34-D40)

One avatar component and one row recipe serve the AGENTS list here and the main-view agent dock (Delta 2 section, below). This sub-section replaces the `>_` / `◇` line anatomy of 4.2.
Source of the proposal: `design-delta-2-options.md` section 2; prototype `prototype/options-delta-2.html` (`assets/delta2.css`, `delta2.js`).

**Avatar anatomy** (circle, three sizes: 24, 28, 32 px; D40)

- Circle tile `bg-surface-2`, 1 px `--surface-border-strong` border, glyph `text-base-content`. A background command tile has a dashed border.
- Orchestrator tile: the same circle with a gold hairline border (`--sel`), which marks it as the orchestrator. Inside: the SESSION'S PROVIDER MARK when an authoritative session provider id exists, otherwise the neutral lucide `Workflow` glyph (see below, D37).
- Status ring, 4 px outside the tile, in the measured `--state-ink-*` tokens: running = faint 28% track plus a 30% arc rotating 1.1 s linear; `waiting` = solid 2 px ring plus a 1.8 s halo;
  `failed` = solid 2 px ring; done and stopped = no ring.
- Corner glyph badge (diameter 46% of the tile, at least 10 px): `surface-0` fill, 1.5 px ink border, lucide glyph in ink. Running `LoaderCircle`, done `Check`, `failed` `CircleAlert`,
  `waiting` `Hand`, stopped `CirclePause`. State is never colour alone: ring + glyph + status word (WCAG 1.4.1).
- Status words (revise round 1): the displayed agent status word is today's vocabulary of 3.5 everywhere (AGENTS tile, dock chip, hover card, `N agents ›` menu, tab `aria-label`): `running`, `waiting`, `done`, `failed`, `stopped`, `queued`.
  `error` is only the data-state synonym of the displayed `failed`. `needs you` is NOT an agent status word; it stays the request-urgency phrase only (the permission summary, the `N needs you` count, the overflow priority meaning, the pip and the
  button's accessible name). An agent whose status word is `waiting` has the `needs you` urgency.
- Reduced motion (`prefers-reduced-motion: reduce`): the arc stays as a static 30% arc, no halo, no rotation, transitions 0 ms.

**Orchestrator avatar (D37; PM-14, requirement 18.5).** A vendor mark is shown ONLY when an authoritative session provider id exists: the Claude mark for a session whose provider id is `claude-cli`
(`PROVIDER_BRAND_SLUGS['claude-cli']`), or the mark of another CLI provider when the session runs on one. When the frontend has no authoritative session provider id (today it has none, see architect check 1), the
EXPLICIT fallback is the neutral orchestrator glyph, lucide `Workflow` (same 58% glyph size as the other role icons, `text-base-content`, `aria-hidden`; the task description names no glyph, so `Workflow` is chosen here, see D37). It is never a guessed
vendor mark, never a Claude default, never a monogram and never the sub-agent `Bot`. The accessible name stays `Orchestrator`; the gold hairline border stays in both cases. The data need is the session's provider id; the field is NOT invented
here and is not inferred from the model-stat `ContextCapacity.providerId` (architect check 1). The prototype mock explicitly declares a Claude session (`sessionProvider: 'claude-cli'` in `prototype/assets/app.js`) and so shows the Claude mark; the unknown-provider state is
`prototype/index.html?prov=unknown` (neutral `Workflow` glyph).

**CLI lane marks (`ptah-provider-mark`; D36, D38).** One table `cliId -> providerId`, no per-id branches in the template. CLI lanes use today's types only; no new lane type is added.

| CLI id | Mark | Source |
| --- | --- | --- |
| `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `grok` | real vendor mark | `PROVIDER_BRAND_SLUGS` (vendored art subset) |
| `pi`, `ptah-cli` | hand-authored stroke glyph | `PROVIDER_MARKS` |
| Orchestrator, only when an authoritative session provider id is `claude-cli` | Claude mark | `PROVIDER_BRAND_SLUGS['claude-cli']` (the key `claude` is not in the table) |
| Orchestrator with no authoritative session provider id | neutral `Workflow` glyph (not a monogram, not a vendor mark) | PM-14, requirement 18.5; D37 |
| any other id | monogram tile: first letter, theme-tinted, glyph in `text-base-content` (the `ptah-monogram-tile` idea) | fallback rule; never the default `Bot` (it would read as a sub-agent) |

Examples in this spec use `antigravity` where a lane needs a name; the monogram appears only as the generic fallback for an unknown id. Sizing: `sm` (14 px mark) inside the 24 and 28 px avatars, `md`
(24 px mark in a 32 px box) inside the 32 px avatar; the mark is `aria-hidden` and the row or tab label carries the name; no new component input (D40).

**Sub-agent role icons** (lucide-angular; all names verified in `lucide-icons.d.ts` by the Delta 2 options doc). Lookup table keyed by agent type, default `Bot`:

| Agent type | Icon | Agent type | Icon |
| --- | --- | --- | --- |
| frontend-developer | `LayoutTemplate` | code-logic-reviewer | `SearchCheck` |
| backend-developer | `ServerCog` | code-style-reviewer | `ScanEye` |
| software-architect | `DraftingCompass` | researcher-expert | `Telescope` |
| team-leader | `Users` | devops-engineer | `Container` |
| project-manager | `ClipboardList` | technical-content-writer | `ScrollText` |
| ui-ux-designer | `Palette` | modernization-detector | `Sparkles` |
| senior-tester | `FlaskConical` | visual-reviewer | `Eye` |
| any other type | `Bot` | background command | `SquareTerminal` |

Also used: `ChevronDown`, `ChevronRight`, `MousePointerClick` (hover card hint), `Users` (roster icon on `N agents ›`). `Workflow` is used only as the neutral orchestrator glyph when the session provider is unknown (D37); it is not a fixed orchestrator icon.

**New AGENTS tile** (replaces the `>_` / `◇` row of 4.2)

```
+----------------------------------------------------+
| (A)  Antigravity                  waiting    0m 51s |   avatar 32, ring + hand badge
|      [CLI lane] Needs permission: rm -rf dist       |   line 2: kind badge + activity
|      (!) Needs permission: rm -rf dist    [Review]  |   permission line (unchanged text and button)
|----------------------------------------------------|
| (fe) frontend-developer          Running  2m 14s    |   spinning arc, 32 px
|      [Sub-agent] Edit canvas-lane-tabs.component.ts |
+----------------------------------------------------+
```

- The kind badge moves to line 2 so long names keep their full width. Row button label unchanged (`{name}, {kind}, {status} {duration}. {activity}`). Selected row keeps the 2 px gold bar.
- Row padding 11 / 14 / 11 / 17 px, gap 13 px. Permission line indent `ml-[62px]`; the `Review` / `Answer` button recipe (28 px high) and the sibling-not-nested rule (D15) are unchanged.
- Hide absent fields, never invent them (9): sub-agents have no start time today, so the duration is omitted for them.
- Contrast (D40): no new colour pair. Every pair is already measured in 8.2: state ink words and ring / badge ink on surface-0 / 1 / 2 (dark 4.60 to 6.61, light 4.73 to 6.12); muted text on
  surface-0 / 1 / 2 (5.39 to 6.06); kind badge text on surface-3 (5.11 / 5.06); selected indicator `--s` / `--ptah-gold` on surface-0 (dark 8.81, light 4.10, UI only); focus ring (`--s` dark,
  `--ptah-gold-strong` light) 5.26 to 8.81. Status words are never placed on surface-3 (R1). The 28% ring track is decorative; arc, glyph and word carry the state.

### 4.8 Extension slot (workflow sections; decisions.md row 35, D41)

The inspector has ONE content-projection slot, `[inspectorSection]`, rendered AFTER the Orchestrator card (4.1) and BEFORE AGENTS (4.2). Workflow sessions (`TabState.workflow` set, for example `harness-configure`) project add-on
sections into it (intake recap, config preview, Apply). Nothing else in the inspector is extensible.

- Empty slot: renders nothing, no wrapper box, no empty border, no spacing; a session without projected sections looks exactly as specified in 4.1 to 4.7.
- Anatomy of a projected section (the host of the add-on follows these rules; the inspector does not style the add-on's content beyond them): one `<section>` per add-on, `p-4 border-b border-surface-border`,
  labelled by its own heading with the section-label recipe of section 1 ("Section label"; `aria-labelledby`). Content width = 336 - 2 x 16 = 304 px; no horizontal scroll (long values wrap or truncate with a `title`).
- Targets and focus: every interactive element at least 24 x 24 px, 2 px focus ring in the existing focus token with 2 px offset (8.4). Tab order follows DOM order, so projected controls sit between the Orchestrator card and the first AGENTS row.
- Colour: only the existing token pairs measured in 8.2 (state inks on surface-0 / 1 / 2, muted text, kind badge, selected indicator, focus ring). No new pair, so no row is added to the 8.2 tables.
- Buttons: at most ONE primary button per projected section (for example `Apply`); secondary actions use the quiet button recipe. The header keeps "no primary buttons" (section 5).
- While the inspector is an overlay sheet, projected sections inherit the modal focus rules of 8.3 unchanged (the keyboard-order check lists the projected controls after `Close session details` and before the first AGENTS row).

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
   N > 0 the toggle carries a 7 px `bg-state-need` dot at top-right (2 px ring in `base-100`). On a workflow tab at an overlay width the closed toggle carries the same 7 px dot in `--sel` (D43).
   Delta 3 (D51, D3.7): while closed the toggle also draws a 28 px context ring (decorative); its dot precedence is pending request (need ink) > plan window or lane at limit (err ink) > near limit (need ink) > workflow `--sel` (D43); a visually hidden description (`aria-describedby`) says what is behind it (`Context 15%. Weekly plan limit is near. 2 need you.`; lane-only: `Context 15%. Codex CLI · software-architect · Near limit.`; revised r1: derived from the session limit summary of D3.7, which examines lane states as well as the window indicator). The accessible name does not change. New chip 5b between item 5 and the toggle: the conditional `Limit near` / `At limit` status chip of D3.7 (text, never colour alone). No stats strip is added.

Header extension slots (decisions.md row 35, D41): the header has two projected slots and no second header. Both render nothing when empty.

- `[sessionHeaderChip]`: after the spacer (3) and BEFORE the branch chip (4). It carries one workflow kind chip: the 22 px chip recipe of the branch chip (`h-[22px] px-2 rounded-md border border-surface-border text-[11px] text-base-content-muted`,
  non-interactive), lucide icon 12 + the kind label (for example `Configure`), `title` = the full workflow name. Chip colours are the branch chip's existing pairs (8.2).
- `[sessionHeaderAction]`: immediately BEFORE the inspector toggle (6), after the `N needs you` chip. At most TWO 28 px icon buttons, each with an `aria-label` that states the action (for example `Start over`) and the 2 px focus ring of 8.4;
  they are secondary controls, never primary buttons. Tab order follows DOM order: ... `N needs you` chip (not a stop), projected actions, inspector toggle.
- A workflow "panel toggle" is not needed: the inspector toggle (6) shows the workflow section (4.8).

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
| 2 | Inspector toggle | `Show session details` / `Hide session details` (aria-pressed, aria-controls) | description (Delta 3): context %, limit state, needs-you count |
| 3.. | Per turn, document order: disclosure button (aria-expanded), each chip, `Copy message`, `Show activity` | chip: `{name}, {kind}, {status}. Open lane` |
| next | Composer: `Attach files or add context`, `Approval mode: ...`, `Model and effort: ...`, `Dictate`, `Send message` (textarea is first, before the buttons) | as listed |
| last | Inspector (when open): `Close session details`, then, per row, the row button, `Review ...` / `Answer ...`, `+N more`, and (when a request panel is open) `Allow`, `Deny`, `Open lane`; then the TASK controls (each document button, `Show N more documents`, `Show N related tasks`, `Retry loading task`, `Retry` for a failed open; only when the section is rendered); then `Show N more todos`, `Review changes`, `Retry reading git status` | row: `{name}, {kind}, {status} {duration}. {activity}` |

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

Theme scope (review finding 2, decision D24, round 2): this surface is available in ALL 34 themes of the picker (`DAISYUI_THEMES`, `libs/frontend/core/src/lib/services/theme.service.ts:67-102`); it is not restricted to the two anubis themes.
Measured, not assumed: before this round the status inks of the 32 stock themes fell back to daisyUI `--in`, `--wa`, `--er`, `--su` and the accent (`--ptah-link`, focus ring) to `--s`; **23 of 32** stock themes had at least one
status text below 4.5:1 on surfaces 0-2 with that fallback (lowest 1.01:1, `acid` need). The fix is a project-token fallback, below.

Token source and fallback (every value traceable):

| Token | Anubis themes | The 32 stock themes |
| --- | --- | --- |
| `--state-ink-run / need / err / done` | defined in `tailwind.config.js` (`anubis` lines 111-115, `anubis-light` 185-189), unchanged | NEW, one `[data-theme='x'] { ... }` block per theme in `styles.css`, next to the existing 32 `--bcm` blocks (same pattern; `base-content-muted.spec.ts` reads those). Values are generated, see Method and the block below |
| `--state-ink-idle` | defined | unchanged: falls back to `oklch(var(--bc))` (`tailwind.config.js:36`), which is base-content and passes by definition |
| `--ptah-accent-ink` (NEW; accent text and the focus ring) | not used: `--ptah-link` keeps gold / gold-strong and the ring keeps `--s` / `--ptah-gold-strong` (8.4) | same block; `--ptah-link: var(--ptah-accent-ink)` and the ring override (`outline-color: var(--ptah-accent-ink)`, same selectors as the `anubis-light` rule at `styles.css:704-709`, scoped `:where([data-theme]:not([data-theme^='anubis']))`) |
| Checkbox outline alpha `--ptah-check-edge` (NEW) | 55% of base-content (measured 5.05 dark / 3.68 light, prototype unchanged) | 70% of base-content (the 55% value gave 2.54 on `aqua` and 2.70 on `valentine`; 70% is the smallest 5% step that reaches 3.1 on surfaces 0-2 for all 32) |
| Utility fallback (a future theme with no block) | n/a | the Tailwind colour entries keep `oklch(var(--in))` etc. as the last resort; the guard test below makes a missing block a failing test, not a silent regression |

Method (`prototype/assets/contrast-check.mjs`, run `node contrast-check.mjs themes`; `emit` prints the CSS block; `anubis` prints the original anubis audit). Theme colours are read at run time from the repo:
the name list from `theme.service.ts`, anubis from `tailwind.config.js`, the 32 stock themes from `node_modules/daisyui/src/theming/themes.js` (the file the plugin compiles), `--bcm` from `styles.css`. Defaults follow
`daisyui/src/theming/functions.js` exactly as `base-content-muted.spec.ts` does (missing `base-200` = `base-100` darkened 7%, `base-300` = 7% below `base-200` or 14% below `base-100`, missing `base-content` = 80% toward black or white, missing
`info/success/warning/error` = `72.06% 0.191 231.6`, `64.8% 0.150 160`, `84.71% 0.199 83.87`, `71.76% 0.221 22.18`). For each generated ink the script keeps the hue; if the daisyUI colour already clears the target on every surface it sits on, it is kept as is; otherwise OKLCH lightness is moved
away from the surfaces (up on dark themes, down on light) in 0.005 steps with chroma held as high as the sRGB gamut allows, then rounded to hex and re-measured. Targets: text 4.5 + 0.1 margin on surfaces 0-2 (status words are never placed on surface 3, rule R1),
accent text 4.5 + 0.1 and the focus ring on surfaces 0-3, checkbox outline 3 + 0.1 on surfaces 0-2. A flat `color-mix` toward base-content was tried and rejected: it also passes, but at the 2-4 percent weights the mid-tone themes need it rotates the hue (warning turned teal, error turned magenta). Of the generated inks 10 to 12 of 32 per slot
needed no change; the largest lightness shift of any slot is 0.425 OKLCH L (accent) and 0.41 (need).

Result: **34 of 34 themes pass; 0 fail.** Columns: lowest status-text contrast over run / need / err / done on surfaces 0-2 today (the daisyUI fallback; for anubis, its own tokens) and with the generated tokens; accent text and focus ring (lowest over surfaces 0-2 and 0-3) today -> with the token;
checkbox outline (lowest on surfaces 0-2); `--bcm` muted text (lowest on surfaces 0-3, already enforced at 4.5 by `base-content-muted.spec.ts`); verdict at text >= 4.5, UI >= 3.

| Theme | Mode | Tokens | Status text, today | Status text, with tokens | Accent text, today -> token | Focus ring, today -> token | Check outline | Muted text | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anubis | dark | own | 4.60 | 4.60 | 8.24 / 8.24 | 7.43 / 7.43 | 5.05 | 5.11 | PASS |
| anubis-light | light | own | 5.10 | 5.10 | 5.61 / 5.61 | 5.26 / 5.26 | 3.68 | 5.06 | PASS |
| light | light | generated | 1.49 | 4.61 | 3.03 / 5.11 | 2.76 / 4.65 | 5.24 | 5.09 | PASS |
| dark | dark | generated | 5.15 | 5.14 | 5.63 / 5.63 | 5.63 / 5.63 | 4.18 | 5.00 | PASS |
| cupcake | light | generated | 1.39 | 4.61 | 1.70 / 4.99 | 1.59 / 4.68 | 5.85 | 5.06 | PASS |
| bumblebee | light | generated | 1.35 | 4.61 | 1.62 / 5.66 | 1.34 / 4.69 | 6.08 | 5.17 | PASS |
| emerald | light | generated | 1.35 | 4.61 | 3.14 / 5.64 | 2.60 / 4.67 | 4.08 | 5.17 | PASS |
| corporate | light | generated | 1.35 | 4.61 | 2.59 / 5.57 | 2.15 / 4.62 | 5.76 | 5.16 | PASS |
| synthwave | dark | generated | 7.25 | 7.25 | 9.18 / 9.18 | 9.18 / 9.18 | 8.54 | 5.97 | PASS |
| retro | light | generated | 2.24 | 4.62 | 1.25 / 5.28 | 1.12 / 4.70 | 4.80 | 5.11 | PASS |
| cyberpunk | light | generated | 1.17 | 4.62 | 1.05 / 5.57 | 1.05 / 4.63 | 5.78 | 5.15 | PASS |
| valentine | light | generated | 1.98 | 4.62 | 1.80 / 5.57 | 1.49 / 4.63 | 3.74 | 5.16 | PASS |
| halloween | dark | generated | 3.12 | 4.68 | 2.00 / 4.68 | 2.00 / 4.68 | 5.70 | 5.00 | PASS |
| garden | light | generated | 1.10 | 4.61 | 4.51 / 5.59 | 3.75 / 4.65 | 5.90 | 5.16 | PASS |
| forest | dark | generated | 6.03 | 6.03 | 7.33 / 7.33 | 7.33 / 7.33 | 6.02 | 5.00 | PASS |
| aqua | dark | generated | 1.24 | 4.61 | 1.60 / 4.62 | 1.60 / 4.62 | 3.17 | 4.73 | PASS |
| lofi | light | generated | 1.13 | 4.60 | 15.67 / 15.67 | 14.19 / 14.19 | 8.09 | 7.45 | PASS |
| pastel | light | generated | 1.59 | 4.65 | 1.40 / 6.26 | 1.04 / 4.67 | 6.57 | 5.26 | PASS |
| fantasy | light | generated | 1.35 | 4.61 | 3.94 / 5.69 | 3.26 / 4.71 | 5.00 | 5.17 | PASS |
| wireframe | light | generated | 2.20 | 4.60 | 1.71 / 5.34 | 1.49 / 4.66 | 6.25 | 5.13 | PASS |
| black | dark | generated | 2.14 | 4.61 | 1.55 / 5.55 | 1.31 / 4.71 | 6.69 | 5.18 | PASS |
| luxury | dark | generated | 6.66 | 6.66 | 1.21 / 5.79 | 1.04 / 4.61 | 4.61 | 5.24 | PASS |
| dracula | dark | generated | 4.53 | 4.63 | 5.90 / 5.90 | 5.90 / 5.90 | 7.34 | 5.40 | PASS |
| cmyk | light | generated | 2.18 | 4.61 | 2.98 / 5.59 | 2.47 / 4.64 | 6.08 | 5.17 | PASS |
| autumn | light | generated | 1.91 | 4.63 | 2.89 / 5.57 | 2.40 / 4.62 | 5.84 | 5.17 | PASS |
| business | dark | generated | 2.71 | 4.65 | 4.90 / 4.90 | 4.90 / 4.90 | 5.73 | 5.00 | PASS |
| acid | light | generated | 1.01 | 4.63 | 2.18 / 5.60 | 1.81 / 4.64 | 6.00 | 5.17 | PASS |
| lemonade | light | generated | 1.18 | 4.61 | 1.54 / 5.56 | 1.28 / 4.61 | 6.02 | 5.17 | PASS |
| night | dark | generated | 6.44 | 6.44 | 5.98 / 5.98 | 5.98 / 5.98 | 5.94 | 5.00 | PASS |
| coffee | dark | generated | 7.99 | 7.99 | 1.54 / 4.70 | 1.54 / 4.70 | 4.13 | 5.00 | PASS |
| winter | light | generated | 1.29 | 4.62 | 8.18 / 8.18 | 7.35 / 7.35 | 3.71 | 5.09 | PASS |
| dim | dark | generated | 7.43 | 7.43 | 5.26 / 5.26 | 5.26 / 5.26 | 4.71 | 5.00 | PASS |
| nord | light | generated | 1.28 | 4.63 | 2.21 / 5.07 | 2.02 / 4.64 | 4.44 | 5.08 | PASS |
| sunset | dark | generated | 10.77 | 10.77 | 6.52 / 6.52 | 6.52 / 6.52 | 4.82 | 5.00 | PASS |

The `Done` glyph (base-100 on the done ink, UI >= 3) is 4.61:1 or higher in every theme (lowest: `aqua`).
Not measurable from repository data: none. All 34 themes resolve from the three sources above. Two stated approximations: (1) inputs are sRGB-clamped before OKLCH mixing, so a wide-gamut daisyUI colour (some stock `oklch()` values exceed sRGB) is measured as its clamped value;
the 0.1 margin covers the difference; (2) the surface-1 and surface-3 mixes use the same `color-mix(in oklch)` model as the anubis audit. A browser render of one dark and one light stock theme is still the visual reviewer's job; the numbers are not a substitute.
Colour remains never the only signal (every status is a word, permission and error lines carry icons, todos carry a prefix); the generated inks make the words readable, they do not replace the words.

Guard (acceptance, for the implementer): extend `state-ink-contrast.spec.ts` so `themes` is every `DAISYUI_THEMES` name, each must define `--state-ink-run/need/err/done` (own theme object or the generated block in `styles.css`), and the same pairs this audit measures (4.5 on surfaces 100/200 and the surface-1 mix; 3 for the ring and
check outline). That spec currently covers only the anubis pair at 3:1 and would not catch a regression in the other 32.

Generated block (paste into `styles.css` after the `--bcm` blocks; re-run `node contrast-check.mjs emit` if a theme changes):

```css
[data-theme='light'] { --state-ink-run: #0074a5; --state-ink-need: #8d6700; --state-ink-err: #d0273b; --state-ink-done: #007d50; --ptah-accent-ink: #be009c; }
[data-theme='dark'] { --state-ink-run: #00b5ff; --state-ink-need: #ffbe00; --state-ink-err: #ff5861; --state-ink-done: #00a96e; --ptah-accent-ink: #ff52d9; }
[data-theme='cupcake'] { --state-ink-run: #006f9e; --state-ink-need: #876300; --state-ink-err: #ca1f37; --state-ink-done: #00784c; --ptah-accent-ink: #944d69; }
[data-theme='bumblebee'] { --state-ink-run: #006e9c; --state-ink-need: #846000; --state-ink-err: #c91c35; --state-ink-done: #00764b; --ptah-accent-ink: #7f4f00; }
[data-theme='emerald'] { --state-ink-run: #006e9c; --state-ink-need: #846000; --state-ink-err: #c91c35; --state-ink-done: #00764b; --ptah-accent-ink: #0850cc; }
[data-theme='corporate'] { --state-ink-run: #006e9c; --state-ink-need: #846000; --state-ink-err: #c91c35; --state-ink-done: #00764b; --ptah-accent-ink: #465c79; }
[data-theme='synthwave'] { --state-ink-run: #53c0f3; --state-ink-need: #eace6c; --state-ink-err: #ec8c78; --state-ink-done: #71ead2; --ptah-accent-ink: #58c7f3; }
[data-theme='retro'] { --state-ink-run: #1451d8; --state-ink-need: #8e4b00; --state-ink-err: #bb0e16; --state-ink-done: #006b2c; --ptah-accent-ink: #395c49; }
[data-theme='cyberpunk'] { --state-ink-run: #00638e; --state-ink-need: #775700; --state-ink-err: #bc012b; --state-ink-done: #006b43; --ptah-accent-ink: #005a63; }
[data-theme='valentine'] { --state-ink-run: #124fd6; --state-ink-need: #8c4a00; --state-ink-err: #b4181a; --state-ink-done: #006b2c; --ptah-accent-ink: #5a3e9c; }
[data-theme='halloween'] { --state-ink-run: #4b85ff; --state-ink-need: #d97706; --state-ink-err: #f35248; --state-ink-done: #16a34a; --ptah-accent-ink: #b362ff; }
[data-theme='garden'] { --state-ink-run: #005f88; --state-ink-need: #725300; --state-ink-err: #b50029; --state-ink-done: #006741; --ptah-accent-ink: #7e3354; }
[data-theme='forest'] { --state-ink-run: #00b5ff; --state-ink-need: #ffbe00; --state-ink-err: #ff5861; --state-ink-done: #00a96e; --ptah-accent-ink: #1db88e; }
[data-theme='aqua'] { --state-ink-run: #c9dcff; --state-ink-need: #ffd3b2; --state-ink-err: #ffd1cb; --state-ink-done: #7af396; --ptah-accent-ink: #ebd1ff; }
[data-theme='lofi'] { --state-ink-run: #007984; --state-ink-need: #8b6700; --state-ink-err: #b34d41; --state-ink-done: #007d58; --ptah-accent-ink: #1a1919; }
[data-theme='pastel'] { --state-ink-run: #0078ab; --state-ink-need: #926b00; --state-ink-err: #d52d3f; --state-ink-done: #008253; --ptah-accent-ink: #785459; }
[data-theme='fantasy'] { --state-ink-run: #006e9c; --state-ink-need: #846000; --state-ink-err: #c91c35; --state-ink-done: #00764b; --ptah-accent-ink: #005c9b; }
[data-theme='wireframe'] { --state-ink-run: #0000ff; --state-ink-need: #6f6e1d; --state-ink-err: #d70000; --state-ink-done: #007d00; --ptah-accent-ink: #616161; }
[data-theme='black'] { --state-ink-run: #4078ff; --state-ink-need: #ffff00; --state-ink-err: #ff0000; --state-ink-done: #259321; --ptah-accent-ink: #8d8d8d; }
[data-theme='luxury'] { --state-ink-run: #66c6ff; --state-ink-need: #e2d562; --state-ink-err: #ff6f6f; --state-ink-done: #87d039; --ptah-accent-ink: #7c93ba; }
[data-theme='dracula'] { --state-ink-run: #8be9fd; --state-ink-need: #f1fa8c; --state-ink-err: #ff5958; --state-ink-done: #50fa7b; --ptah-accent-ink: #bd93f9; }
[data-theme='cmyk'] { --state-ink-run: #007186; --state-ink-need: #a44e00; --state-ink-err: #ca1814; --state-ink-done: #823290; --ptah-accent-ink: #b2005e; }
[data-theme='autumn'] { --state-ink-run: #006974; --state-ink-need: #924b00; --state-ink-err: #c00010; --state-ink-done: #196958; --ptah-accent-ink: #a21b25; }
[data-theme='business'] { --state-ink-run: #0091d5; --state-ink-need: #dbae59; --state-ink-err: #d96657; --state-ink-done: #6bb187; --ptah-accent-ink: #7c909a; }
[data-theme='acid'] { --state-ink-run: #0060c4; --state-ink-need: #716400; --state-ink-err: #cb0000; --state-ink-done: #00733b; --ptah-accent-ink: #943d00; }
[data-theme='lemonade'] { --state-ink-run: #456a78; --state-ink-need: #696546; --state-ink-err: #805c59; --state-ink-done: #4c6b58; --ptah-accent-ink: #5b5c00; }
[data-theme='night'] { --state-ink-run: #0ca5e9; --state-ink-need: #f4bf50; --state-ink-err: #fb7085; --state-ink-done: #2dd4bf; --ptah-accent-ink: #818cf8; }
[data-theme='coffee'] { --state-ink-run: #8dcac1; --state-ink-need: #ffd25f; --state-ink-err: #fc9581; --state-ink-done: #9db787; --ptah-accent-ink: #6f898a; }
[data-theme='winter'] { --state-ink-run: #1e7a8c; --state-ink-need: #806b52; --state-ink-err: #aa5658; --state-ink-done: #297b7d; --ptah-accent-ink: #463aa2; }
[data-theme='dim'] { --state-ink-run: #28ebff; --state-ink-need: #efd057; --state-ink-err: #ffae9b; --state-ink-done: #62efbd; --ptah-accent-ink: #ff7d5c; }
[data-theme='nord'] { --state-ink-run: #7f5c79; --state-ink-need: #806322; --state-ink-err: #a44953; --state-ink-done: #566e40; --ptah-accent-ink: #466481; }
[data-theme='sunset'] { --state-ink-run: #89e0eb; --state-ink-need: #f1c891; --state-ink-err: #ffbbbd; --state-ink-done: #addfad; --ptah-accent-ink: #fd6f9c; }
```

### 8.3 Overlay focus behaviour (shell width < 960 px: sheet at 640-959 px, full-width sheet below, including the 400 px sidebar; review finding 4)

Docked mode (>= 960 px) is a plain `<aside aria-label="This session">` with no trapping and no inert. The rules below apply only while the inspector is an overlay.

| Moment | Rule |
| --- | --- |
| Default | closed on load and on every session switch; the inspector never opens itself and never takes focus. This holds for workflow tabs too: their open-by-default (D42) applies only at docked widths; at overlay widths the sheet stays closed and the toggle shows the workflow dot (D43), so no auto-open can move or trap focus |
| Open (toggle by keyboard or pointer) | (1) remember the opener (`document.activeElement`, normally the header toggle); (2) set `inert` on the whole main region (header, thread, composer, in one wrapper) so nothing behind the sheet is focusable, clickable or read; (3) the sheet gets `role="dialog" aria-modal="true" aria-label="This session"` instead of the landmark role and the toggle gets `aria-pressed="true"`; (4) focus moves to `Close session details` immediately (it does not wait for the 220 ms slide); (5) the scrim is `aria-hidden` and pointer-only |
| While open | Tab and Shift+Tab cycle inside the sheet (a keydown handler wraps last to first and first to last; `inert` alone would still let focus reach browser UI); `Esc` closes the innermost layer first (an open request panel, then the sheet); a pointer click on the scrim closes |
| Resize across 960 px while open | to docked: remove `inert`, `role="dialog"` and `aria-modal`, keep focus where it is; to overlay (docked inspector open, shell becomes narrower than 960 px): the sheet is closed by `closeInsp()` (path 6) and does not reopen on its own; the width-band transition is detected, not every resize event |

Focus return, every close path (focus is always set programmatically, because a pointer click on the scrim or a removed element would otherwise drop it to `body`):

| # | Close path | Focus goes to |
| --- | --- | --- |
| 1 | `Esc` | the opener |
| 2 | `Close session details` button | the opener |
| 3 | scrim click (the scrim covers the whole shell except the sheet, including the header, so the inert toggle is never the click target) | the opener |
| 4 | select an agent row (4.5: activates the lane view; at overlay width the sheet closes through `closeInsp(laneTitle)`) | the opened lane's title heading (h2, `h2#laneTitle`, `tabindex="-1"`) |
| 5 | `Open lane` in a request panel (same routing as 4; not rendered where the host has no lane surface) | same as 4 |
| 6 | automatic close (session switch, tab closed, resize from docked to overlay) | the opener when it is still connected and visible, else the session title `<h1 tabindex="-1">` |
| 7 | `Answer` (4.5) | the first option of the question card in the thread; if the card is missing, the row's `Answer` button or the error region (4.5) |

Every path above is one function, `closeInsp(target)`: it removes `inert`, restores the dialog semantics, and sets focus to `target` (the opener by default). Paths 4-7 pass their own target. Session switch and resize-to-overlay
are triggered by the shell (a `ResizeObserver` that detects the 960 px band change; the session-switch handler) and call it with no target, which selects the fallback chain of path 6. Keyboard acceptance checks at a 400 px shell:
paths 1-5 and 7 by key, plus resize from a docked width to 400 px and a session switch while the sheet is open (focus lands on the opener or the session title in both).

Never `body`. `tabindex="-1"` focus targets carry the full ring utility set of 8.4. With `prefers-reduced-motion` the slide is instant; behaviour is otherwise identical.

Keyboard-order acceptance check (sheet open at a 400 px shell): `Close session details`, then each row button top to bottom with its `Review` / `Answer`, `+N more`,
`Allow`, `Deny`, `Open lane` when present, the TASK controls when present (4.6), `Show N more todos`, `Review changes`, `Retry reading git status` when present, then wrap to `Close`. None of the sidebar toggle,
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
| CLI lane id to mark | `ptah-provider-mark` (`PROVIDER_BRAND_SLUGS`) | one `cliId -> providerId` table (4.7, D36); an id with no vendored artwork shows the monogram tile; optional follow-up for new vendors through `scripts/brand-icons.manifest.json`. Delta 2 architect checks: 4.7 |
| Permission and question requests | session list (C-15), `MonitoredAgent.permissionQueue`, `resolvedQuestionRequests()` (C-16) | answered in place by the inspector's request panel using today's handlers (4.5); the Electron single chat view needs no new surface for this. A native lane-permission surface (T1-07) is optional afterwards |
| `Worked for` duration | message `timestamp` and `duration` | derived client-side by 3.9; `[verify]` that completed assistant messages carry a finite `duration` live and after restore, else the label is `Worked` |
| `N needs you` | the unique-request count of 9.1 | derived in one place |
| TASK section (Delta 1): linked task id and role | session organization record `taskIds` / link `role` (`rpc-session.types.ts`, `session:linkTask`) | `[verify]` how the webview reads the record for the active session and whether a change of links pushes; frontend only |
| TASK section: title, status, documents | `tasks:get` -> `TasksGetResult.task` (`id`, `title`, `status`, `artifacts: string[]`); labels from `TASK_STATUS_LABELS` | no `phase` field exists: Stage is derived from `artifacts` (4.6). `null` task = folder not found. No new RPC |
| TASK section: live refresh | `tasks:changed` push (`TasksChangedNotification`) | `TasksStoreService` ignores the push unless the board is open; the inspector needs its own consumer (4.6, architect) |
| TASK section: open a document | editor-open request used by the git sidebar (`editor:openFile`) on `{workspaceRoot}/.ptah/specs/{folderName}/{file}` | `[verify]` exact RPC, absolute-path rules and per-host availability; `tasks:getArtifact` is not the open path |

### 9.1 Inspector aggregate: one session-scoped contract (review finding 3)

Owner: ONE computed view model per session, built in the inspector host (canvas lib) from existing stores, keyed by tab id; the header chip, the toggle dot, the orchestrator
state, AGENTS, the live-line verb and the `N needs you` count all read it, and nothing else derives these numbers. No new backend call, no new persisted field.

Inputs (existing): `TabState` (`status`, `sessionStats`, `liveModelStats`, `agentOrigin`, `messages`, `streamingState`), `AgentMonitorStore` (`sessionSubagentsForSession`,
`agentsOwnedBySession`, `MonitoredAgent.permissionQueue`), `BackgroundAgentStore.agentsForSession`, `chatStore.unmatchedPermissions()`, `resolvedQuestionRequests()`,
`SessionGitStatsStore.stateFor(root)`, `parseTodoList` / `summarizeTodos`, and (Delta 1) the session organization record's `taskIds` plus `tasks:get` for the lead task (read through a task-detail reader that does not import the Tasks board, 4.6).

Each section returns `status: loading | ready | partial | unknown | error` plus its fields. Presentation per status (prototype `body=loading|partial|error|empty`):

| Section | Derived fields | loading | unknown | partial / error |
| --- | --- | --- | --- | --- |
| Orchestrator | state label (`working`, `waiting on N agents`, `needs you`, `idle`), model, context, tokens, cost, turns | skeleton card | each missing number shows `—`; context shows `—` with an empty bar and `aria-valuetext="Context usage unavailable"` | n/a |
| Agents | rows (4.2), `active` = running + waiting + queued, `finished` = done + failed + stopped | 3 skeleton rows, `aria-busy="true"` | no lanes: empty state, meta `none yet` | `partial` when a restored session lacks stored durations or activity lines: meta adds a `partial` marker (`title` `Restored session: some durations and activity are not stored`); each row hides the fields it lacks |
| Requests | unique requests, per-row queues, `N` | no chip and no dot until the stores have hydrated; never an "all clear" message while loading | n/a | request send failure: row-level error with `Retry` (4.5) |
| Todos | items, counts, active title | skeleton rows | `parseTodoList` failed and no counts: meta `unknown` and the note `Could not read the todo list for this session. It may be stored in an older format.` (`role="status"`) | counts only: `2 of 5` plus `Todo details unavailable` |
| Task (Delta 1, 4.6; between Agents and Todos) | lead task (primary, else first related), `id`, `title`, `status`, derived `stage`, `documents[]`, `related[]` | link known and `tasks:get` pending: skeleton, `aria-busy="true"`; link not yet resolved: section not rendered, nothing announced | no linked task: section not rendered (no heading, no row); `task: null`: `Task folder not found` (no Retry) | partial (no documents): `No documents yet`; error: `Could not load the task` + `Retry loading task` (`role="alert"`); document open failure: row-level `Could not open {file}` + `Retry`. A refresh from `tasks:changed` keeps content on screen and announces nothing |
| Git | branch, additions, deletions, partial flag | skeleton row | not a repo: `Not a git repository` | error: `Could not read git status` + `Retry reading git status`; ahead / behind never drawn |

De-duplication of "needs you": every request has one identity, `requestId`, the name the real queue already uses (`libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts:57-110`, `NeedsYouItem.requestId`): `PermissionRequest.id` and `AskUserQuestionRequest.id` for session items, the `requestId` field of each lane `permissionQueue` entry for lane items. The queue's own `key` (`perm:{id}`, `q:{id}`, `lane:{agentId}:{requestId}`) is source-scoped and is NOT the dedup key; the aggregate dedups on `requestId`. If a source lacks one, fall back to
`{source}:{ownerKey}:{kind}:{hash of tool name and input}` `[verify]`. The session permission list and each lane's `permissionQueue` are merged by `requestId`, so the same request seen in
both counts once; a lane that is waiting on a question counts through that question only; two distinct requests from one lane count twice. `N` = unique open `requestId`s + the number of lanes
whose status is `waiting` with no resolvable request (so a waiting lane is never silently dropped and never counted twice). Responses and `Closed` states (4.5) remove the key everywhere at once.

Acceptance gates (explicit dependencies, none hidden): G1 no backend change ships with this task. G2 the todo list and counts come from the same `parseTodoList` result; the count-only fallback is
reachable. G3 the `↑ ↓` pair stays hidden until `ahead` and `behind` exist on a per-session source (needs its own recorded decision). G4 the unique-request count is computed once (9.1) and the
header chip, toggle dot, orchestrator state and AGENTS order agree in the prototype states `ask=multi` and `ask=question`. G5 the `[verify]` items (request identity: `requestId` as in `canvas-needs-you-queue.ts:97-106` for lanes and `id` surfaced as `requestId` for session items; the aggregate adopts that name, not a new `id`/`requestId`, `MonitoredAgent` completion time,
`duration` on completed messages, restored-history timestamps, per-lane activity from `segments`) are checked by the architect before the plan is final.

---

## 10. Decisions

| # | Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Send button is a neutral inverse circle (`bg-base-content`), as in the reference, not `btn-primary` | (a) inverse neutral, (b) `btn-primary` (blue #2563eb dark / teal light) | Reference shows white circle. Primary blue would collide with the `running` state ink (#3b82f6) in the same composer; teal in light is a third accent. One prominent action per surface still holds (it is the only filled control) | yes, swap two classes |
| D2 | Status is a word in state ink, never a tinted or filled badge | tinted chip fills | Measured: run on 12% tint 4.12:1 (dark), need 4.43:1 (light), both below 4.5 | yes, but needs new tuned tokens |
| D3 | Status words and kind badges stay off `surface-3`; chips use `surface-1`, hover `surface-2` | any surface | dark run 4.25, err 4.15 on surface-3 | no (contrast) |
| D4 | Explicit radii (6 / 12 / 4 px), not `--rounded-btn` | theme radii | `anubis-light` sets `--rounded-btn: 2rem` (pill); the reference radius is 6 px in both themes | yes |
| D5 | CLI lane icon = `ptah-provider-mark`, falling back to lucide `terminal` (not `square-terminal`). AMENDED by Delta 2 (D36): the fallback is the monogram tile and the mark sits inside the agent avatar (4.7) | `square-terminal`, `terminal`, always generic | Reference shows `>_` for every lane; the repo's `ProviderMarkComponent` fallback glyph for CLI routes is `Terminal`; same fallback means no new mapping table | yes |
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
| D22 | Turn duration end `E` = max over the turn's assistant messages of `timestamp + duration` ONLY (3.9) | also add a persisted CLI / lane completion time; also add agent runtime after the last assistant message | orchestrator decision (task-description review finding 2): frontend-only, no dependence on `MonitoredAgent` persistence, identical after reload; delegated runs show their own `done · {duration}` on their chips | yes |
| D23 | Inspector `full` (open docked at >= 960 px) and `compact` (closed) are INITIAL defaults only; a manual Show / Hide is kept per tab in memory across tab switches; changing the view mode resets it to that mode's default; the `full` dock is closable (3.8, 4, 8.3) | mode always forces the state; persist the manual choice | orchestrator decision (task-description review finding 4): the user's last explicit choice must survive navigation, the mode stays a preference; in-memory because nothing in the task persists inspector state | yes |
| D24 | The surface is supported in ALL 34 picker themes through a generated per-theme token fallback (`--state-ink-*`, `--ptah-accent-ink`, `--ptah-check-edge`), not a scope restriction to the anubis themes (8.2) | restrict the surface to anubis; one `color-mix` formula for all themes | orchestrator decision (round 2, review finding 2) from evidence: 23 of 32 stock themes failed 4.5:1 for status text with the daisyUI fallback; a flat mix rotates hues; the measured per-theme block passes 34 of 34 (8.2) | yes |
| D25 | A turn with more than one assistant message lists each message's labelled tokens / cost / duration in the activity panel plus an aggregate summary (3.11) | aggregate only (a per-message loss); per-message always | review finding 5: B-8/B-11/B-12 are per-message data, the move behind `Show activity` must not lose granularity; data shape stays an architect `[verify]` | yes |
| D26 | One lane-open routing for `select` and `Open lane` through `closeInsp(laneTitle)`; a missing question card is a row-level error with `Retry` that keeps the request; resize docked-to-overlay and session switch close the sheet through the same routine; the live verb reads the needs-you aggregate in every state; the request identity is `requestId` (3.7, 4.5, 8.3, 9.1) | inert `Open lane`; throw on a missing card; leave the sheet open on resize; a separate `id` / `requestKey` name | review findings 1, 3, 4, 6 and the real queue (`canvas-needs-you-queue.ts:57-110`) | yes |
| D27 | No linked task: the TASK section is not rendered (no heading, no row); it also stays absent while the link is unresolved (4.6, 9.1) | a permanent quiet `No task linked` row; a section with an empty state like TODOS | TODOS is always shown because every orchestrated session produces a plan; a task link is optional metadata that most sessions never have, and the inspector has no link action (frontend-only scope), so a permanent row would be noise with no next step. Cost: the section pops in when a link appears (no animation beyond the 120 ms fade) | yes |
| D28 | Documents open in the editor through the git sidebar's editor-open request, not through `tasks:getArtifact` (4.6) | render the markdown in place with `tasks:getArtifact`; open through a new RPC | user decision (rows 21): "opened the same way the git sidebar opens files"; `getArtifact` serves only the closed `DocFile` set and returns text, so it cannot serve `task.md`, `handoff-N.md` or judge files. Exact RPC and host availability are an architect `[verify]` | yes |
| D29 | The status pill reuses `TASK_STATUS_LABELS` verbatim and the board's colour semantics, drawn as transparent outline pills in the measured `--state-ink-*` tokens, not as the daisyUI `badge-*` fills (4.6) | reuse `TASK_STATUS_BADGE` classes as is | rule R2 (tinted fills fail 4.5:1, section 8.2) and the 34-theme token fallback (D24) were measured; daisyUI auto-generated `badge-*` content colours were not, and are not defined in the prototype tokens. Visual consistency with the board stays at word and hue level. Reversible if the user prefers identical fills (then the architect must measure 34 themes) | yes |
| D30 | Related tasks are listed behind `+N related tasks` as non-interactive rows without documents; only the lead task offers document links (4.6) | related rows open that task; each related task shows its own documents | the user decision defines links for the session's primary task only; a destination for a related row would be an invented behaviour | yes |
| D31 | Stage is shown as `Stage`, derived from the documents present (no phase field exists); omitted when nothing can be derived (4.6) | label it `Phase`; show nothing; add a stored phase field | "current phase if derivable"; the task carrier has no phase field and no backend work is allowed (row 21); the label `Stage` and the `title` text state that it is derived, so it does not pose as workflow state | yes |
| D32 | Delta 1 item 6: `Answer` never opens a lane first; on `host=rail` a lane-owned question focuses the question card of the session directly (4.5) | open the lane, then focus the card | orchestrator decision: opening the lane replaces the thread and hides the card being answered | yes |
| D33 | Delta 1 items 2, 3, 5: B-16 stays visible at rest above the bubble as today; B-14 / B-15 keep today's hover reveal with no focus reveal and no `(hover: none)` rule; lane title is `h2#laneTitle` (3.10, 4.5, 8.3, 12) | hover-only time; added focus reveal; a lane `h1` | user decision (decisions row 23) for B-16 and B-14 / B-15; the header already holds the session `h1`, so a second `h1` would break the heading outline | yes |
| D34 | Delta 2: the main-view thread switcher is option B, the agent dock; it replaces the VISUALS of `canvas-lane-tabs.component.ts` and keeps its capabilities (tablist keyboard model, ownership filter, overflow) | A avatar tab strip; B agent dock; C split switcher | user decision (decisions.md row 30). B shows the active agent as one expanded pill, fits 8 agents at 760 px without overflow, gives the strongest clickability cue except C, and shares the tile vocabulary of 4.7 | yes |
| D35 | Hover / focus card on dock avatars: YES. Opens after 220 ms hover and on `:focus-visible`, stays open while the pointer is over it, Esc dismisses it (WCAG 1.4.13). Touch path = the `N agents ›` menu button | no card (title only); card on hover only | user decision (decisions.md row 31); the card carries kind, status, duration, current activity and "Click to view this thread" that a flat strip cannot | yes |
| D36 | Every example CLI lane is Antigravity (CLI id `antigravity`, real mark via `PROVIDER_BRAND_SLUGS`); the vendor-less "G" monogram example is removed; the generic monogram fallback for unknown CLI ids stays; one `cliId -> providerId` table. Amends D5 | keep a mock-only vendor example; keep the `Terminal` fallback | user decision (decisions.md row 31, item 3); `brand-slugs.ts` has a vendored `antigravity` mark | yes |
| D37 | The Orchestrator avatar shows the session's actual provider mark ONLY when an authoritative session provider id exists (Claude through provider id `claude-cli`; another CLI provider's mark when the session runs on one). When the frontend has no authoritative session provider id (the case today), the explicit fallback is the NEUTRAL orchestrator glyph, lucide `Workflow` (chosen here: the task description names no glyph, only "neutral orchestrator glyph"). No Claude fallback, no monogram, no `Bot`. The gold hairline border stays as the orchestrator marker in both cases. Needs the session provider id (architect check 1; field not invented, not inferred from `ContextCapacity.providerId`). Revise round 1 corrected the earlier Claude / monogram fallback | fixed `Workflow` glyph for all sessions; Claude mark as default; monogram for unknown | user decision (decisions.md row 31, item 4: the actual provider); PM-14 and requirement 18.5 (`task-description.md:64`, `:703-704`) select the neutral glyph when the provider is unknown; the inspected session types carry no provider (`design-spec-review-delta2.md` finding 1); a guessed Claude mark would misreport a non-Claude session | yes, once an authoritative provider field exists |
| D38 | No new CLI lane types: lanes use today's types (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`, `ptah-cli`) through one `cliId -> providerId` table | add further lane types (the options mock listed two that the product does not have) | user decision (decisions.md row 31, item 5); `SYSTEM_CLI_TYPES` | yes |
| D39 | Work-log tool-call / action rows reuse today's existing tool-call components and styles unchanged; the work log only wraps them (3.3). The `Worked for` disclosure and everything else stay as designed | restyle tool rows (icon 14 muted, name 500, args mono 11.5, min-h 26) | user decision (decisions.md row 32), from a screenshot of today: `Read` + bold file name + muted full path + `lines 14-25` chip; `Grep` + pattern + path + `content` chip | yes |
| D40 | Avatar system from the options doc is adopted as drawn: circle avatars at 24 / 28 / 32 px (D1), state = ring + corner glyph + word (D2), `sm` / `md` provider-mark sizes with no new input (D4), strict overflow priority with a pip (D5), no overlapping targets (D6), automatic activation for the tablist (D7), `SquareTerminal` for background commands (D8; its `Workflow` half is narrowed by D37 to the neutral unknown-provider glyph); contrast uses only pairs already measured in 8.2 | new colour pairs; an `avatar` size input; manual activation | `design-delta-2-options.md` section 4 (D1-D8); WCAG 1.4.1, 2.5.8; the current `canvas-lane-tabs` keydown model | yes |
| D41 | Extension slots: the inspector has ONE projected slot `[inspectorSection]` between the Orchestrator card and AGENTS (4.8); the header has `[sessionHeaderChip]` (before the branch chip, one 22 px workflow kind chip) and `[sessionHeaderAction]` (immediately before the inspector toggle, at most two 28 px icon buttons with aria-labels). Empty slots render nothing; no second header; no workflow panel toggle (4.8, 5) | a second workflow panel and toggle; a registry of new inspector sections; per-section slots | decisions.md row 35 (request from the TASK_2026_648 / 649 session, accepted by the orchestrator): workflow sessions need an add-on surface without a new shell; one slot keeps the inspector order stable; projected sections reuse the existing recipes and the 8.2 pairs | yes |
| D42 | Tabs with `TabState.workflow` set (`harness-configure`, `harness-new-project`, `setup-*`) have the inspector initial default OPEN in every mode, `compact` included, at docked widths; the per-tab manual toggle overrides it afterwards; a mode change resets to the workflow default (open); exposed to the architect as a per-tab initial-open input (3.8, Delta 2 architect check 7). Extends D23 | follow the mode default (closed in compact); persist the choice | decisions.md row 36: the projected config preview and Apply are the primary work surface of these tabs | yes |
| D43 | At overlay widths (< 960 px, modal sheet, 8.3) the workflow default does NOT auto-open the sheet: it stays closed, the toggle shows a 7 px `--sel` dot and the header kind chip names the workflow. Auto-open never moves or traps focus | auto-open the modal sheet and move focus to `Close session details`; auto-open as a non-modal sheet beside the thread | accessibility: 8.3 makes the sheet modal (`inert` main region, focus trap), so an unrequested auto-open would pull focus from the composer and break the existing "inspector never opens itself" rule; a non-modal sheet would cover the thread at 400 px. Closed + dot + chip keeps it discoverable; the user opens it by the toggle and 8.3 applies unchanged. The dot uses the `--sel` selected-indicator pair already measured in 8.2 (UI only, 3:1) | yes |
| D44 | Delta 3: the session stats strip, its expanded panel and the background-agent tray leave the chat column (chat-view mounts only); every value moves to the inspector. A MOVE, not a removal (parity C-2..C-6) | (a) keep a thin strip; (b) move to the inspector; (c) drop rarely used values | decisions.md row 50: user asked for the move and for "all details of the second screenshot" to be in the sidebar; removal is user-reserved | yes, re-mount the components (they stay in the codebase) |
| D45 | Inspector order: Orchestrator card, slot, SESSION, AGENTS, PLAN LIMITS, LANES, TASK, TODOS, GIT | stats after AGENTS; all usage sections together right after the card; stats first | SESSION takes the place of the card's old context + stats (continuity); AGENTS rows carry actionable `Review` / `Answer`; PLAN LIMITS and LANES are account-level reference and cross-reference each other | yes |
| D46 | The Orchestrator card shrinks to identity, state and request line; its context bar, 3 stats and `Usage and limits` disclosure are deleted | keep a short stat row in the card | the same numbers would be shown twice; SESSION is the one place | yes |
| D47 | Model name appears only in the inspector SESSION Models row; removed from the strip chip, strip MODELS pill and the Orchestrator card line (PM-18: "chat area" = the chat-view main column + the Orchestrator card; the agent monitor panel, lane headers and the Rail focus header keep their model labels); the composer model / effort selector stays as the control | keep it in the card; keep the strip chip | USER answer (AskUserQuestion, row 50): composer selector stays; every read-only label goes | yes |
| D48 | Context is a ring chart (44 px); budgets and plan windows are 4-6 px linear bars; no other charts | rings for every window | a window tile carries a long reset string and a variable label; a bar spans the full width and lets the text wrap beneath; the ring suits the one headline value | yes |
| D49 | Plan window colour and chip follow the engine window `tone` / `state`; the UI does not recompute near / at limit from a percentage. Only the context ring uses 80 / 95 % | recompute at 80 / 95 | `PlanWindowState` and `LaneLimitState` already encode thresholds (`stats-limit-view-model`); duplicating them would drift | yes |
| D50 | Lane tiles keep the dashed border, the `lane · not in totals` caption and the Subtotal tile, with cost shown as `cost unknown`, never `$0` | solid border; fold lanes into the totals | the strip's dashed LANES pill and the engine's unknown-is-not-zero rule; the user wanted all details kept | no (accounting semantics) |
| D51 | (revised r1) Closed inspector (overlay widths and `compact`): a conditional header limit chip with text (`Limit near` / `At limit`), the toggle's context ring, and an extended dot with precedence pending request > at limit > near limit > workflow, plus an `aria-describedby` description; no strip, no permanent header chip. The chip, the dot and the description are derived from ONE session-scoped limit summary that examines the session window indicator AND every lane's limit state (at before near; the full warning text goes to the chip `title`, the SESSION alert and the toggle description), so a lane-only limit is never silent | a permanent header context chip; a slim strip at overlay widths; dot only (colour alone fails PM-20); nothing; chip from `limits.indicator` alone (misses lane-only limits: `stats-limit-view-model.ts:55-64`, review finding 1) | the 400 px header has no room for a chip; the strip is what the user asked to remove; the toggle already carries the needs-you dot (D6, D43), and nothing opens itself (8.3); requirement 21.18 asks for a text warning for any near / at-limit state | yes |
| D52 | (revised r1) The limits alert (near / at limit) sits at the top of SESSION with a `Plan limits` link (or `Lanes` when the worst state is a lane's); it shows the same full warning string as the closed-state chip and description (the session limit summary, D3.7); the refresh-failed notice is the first line of PLAN LIMITS | alert inside PLAN LIMITS only; alert from `limits.indicator` alone | P4 variant A: alert "above the strip, never clipped"; PLAN LIMITS may be below the fold on a short window; open and closed states must say the same thing | yes |
| D53 | The tray moves into AGENTS: summary line plus a per-row `Actions for agent` menu (transcript, steer, background, stop); Focus is the row button; scope is this session only, no group for other sessions | a separate BACKGROUND section; an "other sessions" group; keep the tray at the bottom of the thread | the population is already in AGENTS (C-6); a second list would duplicate rows; the menu keeps every action; user answer (row 54): "we already show cli tools and subagents" | yes |
| D54 | Per-model breakdown renders as stacked rows (name + cost, then In / Out / Cache read / Cache creation) with a Total row, not a 6-column table, in the 304 px column | table with horizontal scroll | six columns do not fit 304 px; the data and `title`s are unchanged | yes |
| D55 | Provider coverage shows only the windows and lane states the frontend has: the session owner's windows in PLAN LIMITS; lane providers as state chip (+ windows when the model carries them); no window is invented | a fixed tile per provider with placeholders | task rule: frontend only, do not invent data; gaps stay visible as `No usage source` / `Unavailable` status tiles | yes |
| D56 | (revised r1) The sub-agent model label in the inline agent bubble footer (parity C-49, `inline-agent-bubble.component.ts:515-521`) MOVES out of the chat column to the inspector AGENTS entry of that agent only: visible `Sonnet 5 ·` token on the row's activity line, raw id in `title` and in the row's accessible description; hidden when unknown. NOT shown in the main-view dock hover / focus card (the first draft did; REJECTED by review, the composer selector is the only model control or label in the main column). Frontend-only source per kind: Claude sub-agent `SubagentRecord.usage?.model` (`agent-monitor.store.ts:141, 613`) copied by the tray mapper into one new optional row field; CLI lane agent `MonitoredAgent.model` (`:448`); background command or no record: nothing shown, no invented value (D3.6, D3.9 item 10). The SESSION Models list already counts every model used | keep the footer label (a sub-agent's model, not the session model); show it in the dock hover card (rejected, review r0); move it to AGENTS (chosen) | the user's rule is every read-only model label in the chat-view column goes and model information lives in the inspector (decisions.md row 50, the model answer); the Gate 1.7 ruling (row 57, review finding 2) rejects the dock-card placement; a sub-agent's model is real information, so it moves, it is not dropped; the tray row type has no model today (`background-agent-strip.component.ts:46-80`), so the mapper (`background-agent-tray.component.ts:246-277,294-331`) gains one optional field from the record it already holds. Reversible: restoring the footer is one line | yes |

## 11. Lane-introduced constraints

Delta 3 adds no `[lane-proposed]` token or colour pair: SESSION / PLAN LIMITS / LANES reuse `--surface-1`, `--surface-border(-strong)`, `--ptah-gold`, `--state-ink-*` and the measured pairs (D3.8); the user-approved moves are rows 50 (project rule). Lane-proposed layout choices (revisable, D45, D48, D51, D53): the inspector order, rings for Context only, the toggle ring + extended dot, the AGENTS actions menu.
Delta 2 adds no `[lane-proposed]` token, colour pair or rule: the avatar, dock and hover card are user-approved (decisions.md rows 30-31) and use measured tokens only (D40). Delta 1 adds no `[lane-proposed]` token or rule: the TASK section reuses measured tokens and rules R1 / R2 (4.6, D29); the user-approved scope add is recorded in decisions.md rows 21-23. Only items marked `[lane-proposed]` need Gate 1.7 acceptance: `--ptah-link` token (1.6), optional `surface-border-strong` Tailwind colour (1.6), rules R1 (status words never on surface-3)
and R2 (no tinted status fills) in 8.2, the stagger caps (D14). Added in revision round 2, all `[lane-proposed]`: the generated per-theme tokens `--state-ink-*` for the 32 stock themes, `--ptah-accent-ink` and `--ptah-check-edge` (8.2, D24), and the per-tab in-memory inspector open state (3.8, D23). Added in revision round 1, all `[lane-proposed]`: the density meaning of `compact` view mode (3.8, D16), the inline request panel
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
| B-14 | Branch conversation from a user message | keep (was remove-proposed) | icon button under the user bubble, same icon, label and event; today's hover reveal unchanged (no focus reveal added; Delta 1 item 3, user decision) | 3.10 |
| B-15 | Rewind file changes to a user message | keep (was remove-proposed) | same strip; disabled with today's title when the session is not active; same unchanged reveal | 3.10 |
| B-16 | User message time and sender | keep, unchanged | `<time>` and `You` (or peer label) stay in the header line above the bubble, visible at rest exactly as today; NOT hover-gated, NOT moved (Delta 1 item 2, user decision) | 3.10 |
| T-1 (new, Delta 1) | Inspector TASK section: linked primary task, status, artifacts | new capability (user scope add, decisions row 21) | inspector section between AGENTS and TODOS; no existing surface changes; TODOS unchanged | 4.6, 9.1 |
| B-17 | Inbound peer styling and "self-reported and unverified" warning | keep | always visible, `triangle-alert` in need ink | 3.10 |
| B-18 | Compaction continuation disclosure | keep | disclosure inside the user bubble after a compaction divider | 3.10 |
| B-19 | File attachment names | keep | badges inside the bubble under the text | 3.10 |
| B-20 | Image count label | keep | `image` icon and label inside the bubble | 3.10 |
| B-21 | Sub-agent tile in the transcript | move | the re-skinned `subagent-tile` is the agent chip | 3.5 |
| B-22 | Inline agent bubble outside the transcript | keep | unchanged (lanes, canvas tiles) | not touched |
| B-23 | Render window and streaming boundary | keep | clean turns inside the same transcript | 3 |
| B-24 | Load older history | keep | same control at the top of the thread | 3 |
| C-1 | Agent-started session banner, open parent | keep | strip under the header, restyled (prototype `.cs-origin`) | 2 |
| C-2 | Session stats strip (model, context, tokens, cost, time, agents, models) | MOVE (Delta 3, D44) | removed from the chat column; inspector SESSION tiles; model name only in the Models row (D47) | D3.3 |
| C-3 | Strip compaction count | MOVE | Context tile, `N compactions` | D3.3 |
| C-4 | Strip plan limits (Claude account windows, provider API badge, reset times, per-window expand, limits alert, refresh notice) and lane tiles + subtotal | MOVE | inspector PLAN LIMITS and LANES sections; alert at the top of SESSION | D3.4, D3.5 |
| C-5 | Strip session budget | MOVE | Tokens / Cost tile budget caption and bar | D3.3 |
| C-6 | Background-agent tray (focus, steer, stop, background, transcript) | MOVE (Delta 3, D53) | out of the chat column into AGENTS: summary line and per-row actions menu | D3.6 |
| C-7 | Compaction-in-progress notification | keep | unchanged | not touched |
| C-8 | Compaction marker | keep | unchanged, drawn as the divider before a continuation | 3.10 |
| C-9 | Fresh-chat empty state | keep | unchanged | not touched |
| C-10 | Branch / rewind error and info banners | keep | unchanged (B-14, B-15 stay) | not touched |
| C-11 | Resume interrupted sub-agents banner | keep | unchanged | not touched |
| C-12 | Session budget banner | keep | unchanged | not touched |
| C-13 | Auth-required banner | keep | unchanged | not touched |
| C-14 | Voice-provider error toast | keep | unchanged | not touched |
| C-15 | Session permission badge | keep | unchanged; the same requests also surface as inspector rows and in `N needs you`, resolved through the shared `requestId` | 4.5, 9.1 |
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
| B-14 branch conversation | icon button under the user bubble (3.10) | on hover, exactly as today (no focus reveal added; user decision, Delta 1 item 3) | same icon, label, event and banner |
| B-15 rewind | icon button next to branch (3.10) | on hover, exactly as today | same icon, label, disabled rule and event |

### 12.3 Proposed removals (user decision)

None. This design removes no capability; the PM's five proposed removals are all kept at the locations in 12.2, so no approval is needed to proceed. Visibility changes were decided by the user (decisions row 23, Delta 1): APPROVED, B-8 / B-11 / B-12 move from always-visible badges to one click behind `Show activity`; NOT approved and therefore
unchanged from today, B-16 time and `You` (visible at rest) and B-14 / B-15 reveal (today's hover reveal, no focus reveal added). The visibility-change list is now exactly B-8, B-11, B-12 (B-16, B-14 and B-15 are off it).
B-4 count meta, B-14 branch and B-15 rewind stay in the product until the user says otherwise.

## 13. Prototype index

`prototype/index.html?theme=dark|light&t1=collapsed|expanded&t2=ref|streaming|answered|done&insp=open|closed&body=full|empty|loading|error|partial&width=wide|sidebar&bare=1&sel=1&reduce=1&replay=0|1`
plus the round-1 parameters `ask=lane|lane-open|question|multi`, `host=electron|rail`, `fail=1`, `parity=1`. States named in this spec: `ask=lane`, `ask=lane-open`, `ask=question`,
`ask=multi`, `requests-more-open`, `request-error-retry`, `request-closed-elsewhere`, `request-electron-fallback`, `narrow-400-overlay-focus`, `parity=1`, `body=partial` (4.5). See
`prototype/README.md` and `prototype/ROUND-1-NOTES.md`. Delta 2 options page: `prototype/options-delta-2.html` (assets `delta2.css`, `delta2.js`, `delta2-sprite.js`; screenshots
`prototype/screenshots/delta2-*.png`; checks `node prototype/assets/capture-delta2.mjs shots|checks`); option B is the chosen one.
Delta 3 (session stats in the inspector): same `prototype/index.html`; extra parameter `stats=full|at|none|single|ctx` (partial, empty and loading follow `body=`) (SESSION / PLAN LIMITS / LANES data variants), screenshots `prototype/screenshots/delta3-*.png`,
notes `prototype/DELTA-3-NOTES.md`, contrast `node prototype/assets/contrast-delta3.mjs`, checks `node prototype/assets/capture.mjs checks` (extended with the Delta 3 checks).

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
| 8 Minor: icon availability | Lucide verification recorded: `PanelLeft`, `PanelRight`, `GitBranch`, `ShieldAlert`, `LoaderCircle`, `TriangleAlert` canonical in lucide-angular 1.0.0 (orchestrator); `Undo2`, `Paperclip`, `Image`, `Check` re-checked by the designer; provider-mark fallback restated (replaced by the monogram tile in Delta 2) | 1.5 |
| Gate 1 finding 1 (`task-description-review.md`): view-mode toggle has no defined result | `full` vs `compact` table: live log, `Worked for`, answer, chips, inspector default, rhythm, all other features identical; toggle behaviour, persistence, migration; D16 | 3.8, D16 |
| Gate 1 finding 2: duration persistence vs missing source | Start, end, settle, live, reload, zero-activity, running-agents, interrupted and restored-history rules from `message.timestamp` and `message.duration`; fallback label `Worked`; durable-only so the label is identical after reload; `[verify]` items; D17 | 3.9, 9, D17 |

## Revision round 2

Gate 1.7 revise round 2 of 2 (final), text of this spec. `design-spec-review-r1.md` (codex) findings, then two orchestrator decisions from the task-description review. The prototype designer implements the behaviour in
`index.html` / `app.js`; this spec states exactly what it must do. Contrast data: `node prototype/assets/contrast-check.mjs themes` (exit 0, 34 of 34 pass).

| Finding | What changed | Section |
| --- | --- | --- |
| 1 Serious: `select` and `Open lane` are inert | One routing for both: activate a concrete lane view, close the overlay through `closeInsp(laneTitle)`, focus the lane title, announce afterwards; hosts without a lane surface omit `Open lane` and use the inline panel; keyboard checks at 400 px for paths 1-5, 7, resize and session switch | 4.5, 8.3, D26 |
| 2 Serious: other themes have no contrast guarantee | Surface kept in ALL 34 themes: generated per-theme `--state-ink-*`, `--ptah-accent-ink` (link text and focus ring) and `--ptah-check-edge`; `contrast-check.mjs` measures every theme (23 of 32 stock themes failed the old fallback; 34 of 34 pass with the tokens); token source, method, full table, generated CSS block and a guard-test requirement recorded; no theme unmeasurable | 8.2, 11, D24 |
| 3 Moderate: missing question card throws | Absent-card state: request retained and counted, row-level error `Could not find the question in the conversation` + `Retry`, focus to the row's `Answer` (or the error region), same in Electron and Rail / VS Code; prototype state `ask=question&fail=card` | 4.5, D26 |
| 4 Moderate: resize closure and focus return | Docked-to-overlay width-band transition and session switch call the one `closeInsp()` with the fallback chain (opener, else session title); not every resize event | 8.3, D26 |
| 5 Moderate: multi-message activity granularity | More than one assistant message: each message's labelled tokens / cost / duration kept in the panel plus the aggregate as a summary (`All messages`); `[verify]` for the data shape stays an architect check | 3.11, D25 |
| 6 Minor: live line disagrees with the aggregate | The live verb is bound to the needs-you aggregate in every state (`Waiting for you` when N > 0), including the historical reference state | 3.7, D26 |
| Review note: request key | The aggregate adopts the real queue's `requestId` (`canvas-needs-you-queue.ts:57-110`); gate G5 and the identity column updated; the queue's source-scoped `key` is not the dedup key | 4.5, 9.1, D26 |
| Orchestrator decision 1 (task-description review finding 2): turn duration end | `E = max(timestamp + duration)` over assistant messages only; a persisted CLI / lane completion time is not included (sentence removed); agent runtime after the last assistant message excluded; frontend-only, identical after reload | 3.9, D22 |
| Orchestrator decision 2 (task-description review finding 4): inspector open state | `full` (open, docked at >= 960 px) and `compact` (closed) are initial defaults only; manual Show / Hide kept per tab in memory across tab switches; a view-mode change resets to that mode's default; the `full` dock is closable | 3.8, D23 |

Proposed removals (user decision): none.

## Delta 1 (user scope + decisions)

Source: decisions.md rows 21-23 (user, 2026-10-15) and one orchestrator decision (item 6). Text edits were made in place; this table maps each item to what changed and where. New decisions are D27-D33 in section 10.

| # | Item | Change | Section |
| --- | --- | --- | --- |
| 1 | NEW inspector section TASK (user scope add) | New section 4.6 between AGENTS and TODOS: lead task ID (mono), title, status pill (labels from `TASK_STATUS_LABELS`, measured ink tokens), derived Stage, list of existing documents that open in the editor like the git sidebar's files, `+N more documents`, `+N related tasks`. States: no link (section not rendered, D27), loading, partial, task not found, error with Retry, open failure, several tasks, live status change on `tasks:changed` without announcement. A11y: `ul > li`, native buttons, 24 px targets, focus ring 8.4, no new live region. Bundle: only tasks-ui presentation helpers and types; the board and `TasksStoreService` stay out of the chat graph. Inspector now has five sections. TODOS unchanged | 4 (intro), 4.6, 1.5 (icons), 8.1 (tab order), 8.3 (keyboard-order check), 9 (data table), 9.1 (inputs, aggregate row), 10 (D27-D31), 12.1 (new row T-1) |
| 2 | B-16 user-turn time and `You` | User did NOT approve hover-only: they stay in the header line above the bubble, visible at rest exactly as today. Removed from the action strip and from every visibility-change list | 3.10, 2.2 (P3), 12.1 (B-16), 12.3 |
| 3 | B-14 / B-15 Branch and Rewind | User did NOT approve the focus reveal: today's hover reveal (`opacity-0 group-hover:opacity-100 hover:opacity-100`) is kept; the proposed `:focus-within` reveal and the `(hover: none)` always-visible rule are withdrawn | 3.10, 2.2 (P3), 12.1 (B-14, B-15), 12.2, 12.3 |
| 4 | B-8 / B-11 / B-12 behind `Show activity` | User APPROVED: no change. The visibility-change list is now exactly B-8, B-11, B-12 | 3.11, 12.2, 12.3 |
| 5 | Lane title focus target | The lane title is `h2#laneTitle` (`tabindex="-1"`); the header keeps the session `h1`. Focus table wording is now "lane title heading (h2)" in the close-path table and the prototype state table | 4.5, 8.3 (path 4), 4.5 state table (`open-lane`) |
| 6 | `Answer` on `host=rail` | A lane-owned question focuses the question card directly; the lane is not opened first (it would hide the card in the thread). The card-missing rule drops its "after the lane open" wording | 4.5 (Answer paragraph, host table, `ask=question` row), D32 |

Parity effects: B-14, B-15 and B-16 decisions in 12.1 now read unchanged-behaviour; row T-1 is added as a new capability (user scope), nothing is removed. Proposed removals (user decision): none.

Open for the architect (`[verify]`, none blocks the design): the session organization read path for `taskIds` and whether link changes push; the exact editor-open RPC and its availability per host (Electron single view, Rail, VS Code); an inspector-side consumer of `tasks:changed` that does not need the board open; where the Stage ladder lives; the opacity-reduced contrast of the user-turn time if today's `opacity-60` is kept; the tasks-ui entry point that exposes presentation helpers without the board.

## Delta 2: agent tiles and thread switcher (option B)

Source: decisions.md rows 30-32 (user, 2026-10-15), `design-delta-2-options.md`, prototype `prototype/options-delta-2.html` (`assets/delta2.css`, `delta2.js`). The user picked option B, the agent
dock. The tile, avatar, marks and role icons are specified once in 4.7 and used here unchanged. New decisions are D34-D40 in section 10.

### Switcher: the agent dock

It replaces the visuals of `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`, the only main-view switch between the orchestrator, sub-agents and CLI lanes. The component keeps
its capabilities: the keyboard tablist model (roving tabindex, Left / Right with wrap, Home / End, automatic activation, D40), the ownership filter (only agents the session owns appear, architect check 4)
and overflow (now by priority, below).

```
+------------------------------------------------------------------+
| (O)(fe)(sa) | [(X) Codex        ] (!) (v) (A!) | (>_)   [ 8 agents > ] |
|             |   Running 1m 11s    gold pill                         |
|  hover or focus on (fe):                                           |
|    +-----------------------------+                                 |
|    | (fe) frontend-developer     |                                 |
|    | Running 2m 16s - Edit ...   |  [ Click to view this thread ]  |
+------------------------------------------------------------------+
 (O) = orchestrator avatar: session provider mark when the provider is known, neutral Workflow glyph otherwise (D37); (A!) = antigravity lane, status word waiting
```

- Order: Orchestrator and sub-agents, then CLI lanes, then background commands, separated by 1 px rules (`--surface-border-strong`); then the `N agents ›` button at the end.
- Active agent: one expanded gold-bordered pill, 38 px high, avatar + name + status word + duration. Every other agent is an avatar button (28 px avatar in a 38 px chip). The Orchestrator avatar shows the
  provider mark of D37 (or the neutral `Workflow` glyph when the provider is unknown) with the gold hairline border.
- `N agents ›` is a `menu` button (`aria-haspopup="menu"`, `aria-expanded`). Menu: `menuitemradio` rows grouped by kind with counts (avatar, name, status word, duration; selected row = gold bar),
  Up / Down / Home / End, Enter selects, Esc closes and returns focus to the button, Tab closes. With many agents (14) the list scrolls, 340 px max height. At 400 px the label becomes a count badge.
- The decorative "stack" of hidden-agent avatars lives INSIDE the `N agents ›` button (or a `Users` icon when nothing is hidden). No avatar overlaps any interactive target (D40).
- ARIA: `tablist` of avatar `tab`s; each tab has `aria-label` `{name}, {kind}, {status} {duration}` and `aria-describedby` pointing at the `role="tooltip"` card. The label is the accessible name, so the
  state is available to avatar-only chips.

### Hover and focus card (D35)

- Content: avatar (32), name, kind, status word, duration, current activity line, hint `Click to view this thread` with `MousePointerClick`.
- Opens after 220 ms of hover and on `:focus-visible`. It stays open while the pointer is over the avatar or the card (WCAG 1.4.13 hoverable and persistent). Esc dismisses it without moving focus.
- The card is informational (no controls inside), so there is no focus trap and no extra tab stop. Placement: below the avatar, clamped inside the shell container (derived from the options doc frame).
- Touch has no hover: the touch path is the `N agents ›` menu, which lists the same name, status and duration. The card is an enhancement, never the only way to read a state.

### Overflow, targets, focus, motion

- Overflow priority, strict order (D5 of the options doc, D40): Orchestrator, the selected agent, every `waiting` agent (the `needs you` priority), every `failed` agent, running agents, then the rest. The dock never shows a
  finished agent while hiding a running one. Hidden agents go to the `N agents ›` menu; a pip (decorative, ink `--state-ink-need` or `--state-ink-err`) sits on the button when a hidden agent is `waiting` or
  `failed`, and the button's accessible name adds that fact: `needs you` is the urgency phrase for a `waiting` agent, `failed` is the status word (for example `8 agents, 1 waiting, needs you` or `8 agents, 1 failed`).
  The menu rows, hover card, dock chip and AGENTS tile print the status word `waiting` or `failed`, never `Needs you` or `Error`.
- At 400 px the dock shows the pinned four (Orchestrator, selected, first `waiting`, first `failed`) and moves the rest behind the button; at 760 px all 8 mock agents fit with no overflow.
- No overlapping targets. Every interactive element is at least 24 x 24 px (chips are 38 px high, avatars 28 px); the audit is `capture-delta2.mjs checks`.
- Focus ring: 2 px focus-visible ring in the existing focus token (`--s` dark, `--ptah-gold-strong` light) with 2 px offset, as in 8.4.
- Reduced motion (`prefers-reduced-motion: reduce`): the running arc stays as a static 30% arc, no halo, no rotation, hover-card and menu transitions 0 ms; the 220 ms hover delay stays (a delay, not motion).
- Contrast: no new colour pair. Only pairs already measured in 8.2 are used (listed in 4.7); no row is added to the 8.2 tables.

### Architect checks (delta 2)

1. Session engine provider id for the orchestrator mark (D37): which AUTHORITATIVE field on the session or tab carries the provider id (for example `claude-cli`) and whether it is available in Electron, Rail and VS Code.
   The design needs a provider id; it does not name or add the field, and `ContextCapacity.providerId` (model-stat path) is not equated with the CLI engine without evidence. If no such field exists, document its absence and ship
   the NEUTRAL orchestrator glyph (lucide `Workflow`) as the explicit fallback (PM-14, requirement 18.5): never a Claude fallback, never a monogram, never `Bot`. A vendor mark appears only with an authoritative id.
2. `MonitoredAgent` fields for status, duration and activity: which fields feed the displayed status word (`running` / `waiting` / `done` / `failed` / `stopped` / `queued`, today's vocabulary of 3.5; `error` is the data-state synonym of `failed`; `needs you` is the request-urgency phrase for `waiting`, not a status word), the duration (9 already records that sub-agents have no start time,
   so the duration is omitted for them) and the activity line (`lastToolName` for sub-agents, last `segments` entry for CLI lanes). Hide absent fields.
3. Agent-type field for the role-icon map (4.7): which property carries the type string (`frontend-developer`, ...) for sub-agents; the map defaults to `Bot` for any other value.
4. How `canvas-lane-tabs` gets its agents today and the ownership filter: from its imports it reads `AgentMonitorStore` and `BackgroundAgentStore` (`@ptah-extension/chat-streaming`), filters with `ownedBySession`
   (`./lane-owner`) and keys tabs with `laneKey` (`@ptah-extension/chat`). Keep that source and filter, and feed the same list to the dock and to the AGENTS section of 4.2 so both agree.
   Also confirm that replacing the current scroll-edge and reveal-selected logic with priority overflow loses no behaviour.
5. The `cliId -> providerId` table (4.7, D36, D38): where it lives, and that `pi` and `ptah-cli` resolve through `PROVIDER_MARKS` while the others resolve through `PROVIDER_BRAND_SLUGS`.
6. Projection path for the extension slots (D41): session-embed -> `ChatViewComponent` -> inspector. The inspector is `@defer`-loaded; verify that `ng-content` re-projection into the deferred inspector works (content projected through two components into a deferred block). If it does not, use a registry token keyed by workflow kind that the inspector reads instead. The slot contract (position, empty-renders-nothing, anatomy of 4.8) is the same either way.
7. Per-tab initial-open input (D42, D43): expose the workflow default as an input of the inspector or its host (for example `initialOpen`) that the per-tab open-state map reads when a tab is first shown and after a view-mode change; at overlay widths the input is ignored (the sheet stays closed, the toggle dot shows).

### Delta 2 changes

| # | Item | Change | Section |
| --- | --- | --- | --- |
| 1 | Switcher = option B, the agent dock (decisions row 30) | New dock replaces the visuals of `canvas-lane-tabs.component.ts`; keeps the tablist keyboard model, ownership filter and overflow; overflow by strict priority with a pip on `N agents ›` | Delta 2 (this section), D34, D40 |
| 2 | Hover / focus card = yes (row 31) | 220 ms hover, opens on `:focus-visible`, persistent while hovered, Esc dismisses (WCAG 1.4.13); touch path = `N agents ›` menu | Delta 2 (this section), D35 |
| 3 | No Gemini anywhere (row 31) | Every Gemini example is now Antigravity (`antigravity`, real mark through `PROVIDER_BRAND_SLUGS`); the "G" monogram example is removed; the generic monogram fallback for unknown CLI ids stays; icon table rows, P1 departure, data row and D5 reworded | 1.5, 2.2 (P1), 4.7, 9, 10 (D5, D36) |
| 4 | Orchestrator avatar shows the session's actual provider mark (row 31) | A vendor mark ONLY with an authoritative session provider id (Claude for `claude-cli`, another CLI provider's mark when the session runs on one); neutral `Workflow` glyph as the explicit fallback when the id is unknown (no Claude default, no monogram, no `Bot`; PM-14, req 18.5); gold hairline border kept; session provider id named as architect check 1, field not invented | 4.7, Delta 2 (architect check 1), D37 |
| 5 | No new CLI lane types (row 31) | Lanes use today's types (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`, `ptah-cli`) through one `cliId -> providerId` table | 4.7, Delta 2 (architect check 5), D38 |
| 6 | AGENTS tile | The `>_` / `◇` row of 4.2 is replaced by the 32 px avatar tile (ring + corner glyph + status word), kind badge on line 2, row padding 11 / 14 / 11 / 17 px, gap 13 px, permission line indent `ml-[62px]` (was `ml-[38px]`); role-icon map for sub-agents | 4.2, 4.7 |
| 7 | Work-log tool-call rows keep today's rendering (row 32) | The restyle row (icon 14, Name 500, args mono 11.5, `min-h-[26px]`) is replaced by: tool-call rows reuse today's existing tool-call components and styles unchanged; the work log only wraps them. `Worked for` disclosure and everything else as designed. The tool glyph rows of 1.5 are marked as documentation of today | 3.3, 1.5, D39 |
| 8 | Contrast and accessibility | No new pair; only pairs measured in 8.2; 24 px minimum targets, no overlapping targets, 2 px focus ring, reduced-motion behaviour stated | 4.7, Delta 2 (this section), D40 |
| 9 | Delta 2 revise round 1, finding 1 (Serious): unknown session provider | Neutral lucide `Workflow` glyph is the explicit orchestrator fallback when no authoritative session provider id exists (no Claude fallback, no monogram, no `Bot`); a vendor mark only with an authoritative id; edited 4.7 (avatar, icon table), D37, architect check 1 and change-table row 4. The prototype declares a Claude session in the mock (`sessionProvider: 'claude-cli'`) and adds the unknown-provider state `?prov=unknown`; `capture.mjs checks` section M | 4.7, D37, Delta 2 (architect check 1, row 4) |
| 10 | Delta 2 revise round 1, finding 2 (Moderate): status words | Displayed agent status words are `running`, `waiting`, `done`, `failed`, `stopped`, `queued` (3.5) in the dock, hover card, `N agents ›` menu and AGENTS tile; `error` is only the data-state synonym of `failed`; `needs you` stays the request-urgency phrase (permission summary, `N needs you` count, overflow priority meaning, pip, button name), with `waiting` mapped to that priority. Prototype `N agents` button name now `one waiting, needs you` / `one failed`; check M asserts the vocabulary | 4.7, Delta 2 (overflow, architect check 2) |
| 11 | Extension slots (row 35) | Inspector gets ONE projected slot `[inspectorSection]` after the Orchestrator card and before AGENTS (renders nothing when empty); header gets `[sessionHeaderChip]` (before the branch chip) and `[sessionHeaderAction]` (before the inspector toggle, max two 28 px icon buttons); anatomy, targets, focus and colour rules in 4.8; architect check 6 (projection through the deferred inspector, else a registry token) | 4, 4.8, 5, D41, Delta 2 (architect check 6) |
| 12 | Workflow tab inspector initial-open (row 36) | `TabState.workflow` tabs start with the inspector OPEN in every mode (docked widths); per-tab toggle overrides; a mode change resets to open; at overlay widths the modal sheet stays closed with a `--sel` toggle dot and the header kind chip (no focus move or trap); per-tab initial-open input for the architect (check 7) | 3.8, 4, 5, 8.3, D42, D43, Delta 2 (architect check 7) |

Parity effects: no capability is removed. The switch between orchestrator, sub-agents and CLI lanes keeps working through the dock; tool-call rows are unchanged. Proposed removals (user decision): none.

## Delta 3 - session stats in the inspector

Source: decisions.md row 50 (user, 2026-10-15). Companion: `prototype/DELTA-3-NOTES.md` (item-by-item move list), `prototype/assets/contrast-delta3.mjs` (measured pairs), new decisions D44-D55 in section 10.
Prototype parameters: `stats=full|at|none|single|ctx` (default `full`; partial, empty and loading follow `body=`; the strip has no switch because it is gone). Screenshots: `prototype/screenshots/delta3-*.png`.

User intent, verbatim (lightly edited): "the session stats is not needed anymore [in the main chat area]; we could enhance our sidebar stats and show all important information. Model name is repeated
in 2 places; only put it in the right sidebar stats. Show the usage limit for our providers as tiles with small progress bars or circular charts. Make sure all details in the second screenshot are
moved to the right sidebar; it will look much better there and saves a lot of room in the main chat session area." User answer on the model (AskUserQuestion): the composer keeps its model / effort
selector as the control; every other read-only model label leaves the chat area; model information shows only in the inspector stats.

### D3.1 What moves (a MOVE, not a removal: parity C-2..C-6 keep)

| Today (main chat column, `chat-view.component.html`) | After Delta 3 |
| --- | --- |
| `ptah-session-stats-summary` collapsed strip (line 42): CONTEXT, TOKENS, COST, LANES, TIME, AGENTS, MODELS, compactions, limits alert | gone from the chat column. Values live in the inspector SESSION section (D3.3) and PLAN LIMITS / LANES sections (D3.4, D3.5) |
| the same component expanded: SESSION row, PLAN LIMITS (Claude account, windows), LANES tiles, Subtotal, per-model table, context progress strip | SESSION / PLAN LIMITS / LANES sections, always visible, no expand step for the headline values; per-window and per-lane detail keep their own disclosure |
| `ptah-background-agent-tray` (line 60): `1 foreground · 1 running`, Focus / Steer / Stop / Send to background / View transcript | AGENTS section: summary line and a per-row actions menu (D3.6) |
| read-only model labels: strip MODEL chip, strip MODELS, inspector Orchestrator card line `Opus 5.5 · idle` | inspector SESSION Models row only (D3.3). The composer model / effort selector (section 6) is the control and stays |

The components stay in the codebase for other hosts (harness-builder, canvas-lane-view); only their `chat-view` mount moves. The main column loses one strip row of about 34 px collapsed or about 330 px
expanded and the tray row of about 36 px, so the thread starts directly under the header at every width.

New inspector order (D45): Orchestrator card, `[inspectorSection]` slot, **SESSION**, AGENTS, **PLAN LIMITS**, **LANES**, TASK, TODOS, GIT. Rationale: the headline stats are glance data and sit where the
card's context bar and three stats sat; AGENTS keeps its place right after them (its rows carry the `Review` / `Answer` actions, so they stay near the top); plan limits and lanes are account-level and
follow, with lanes after plan limits because a lane tile cross-references a plan tile.

### D3.2 Orchestrator card after the move (4.1 amended in place)

Dot, `Orchestrator` 14/600 and the state line only. The state line drops the model: `{state}` (`waiting on 4 agents`, `working`, `needs you`, `idle · ready for the next turn`). The context bar,
the `tokens / cost / turns` stats and the `Usage and limits` disclosure leave the card (they are SESSION). The request line (`Review` / `Answer`, 4.5) stays under the state line. The card height drops
to about 56 px.

### D3.3 SESSION section (new, `section aria-labelledby="sessH"`, `p-4`)

Header: `SESSION` label (10.5/600 uppercase, section-label recipe of section 1.2) left; right meta `~ = estimate` (`text-[11px]` muted) only while any value is an in-turn estimate
(`isEstimate()`); otherwise empty. Below the header, in this order:

1. Limits alert (only when the session limit summary of D3.7 has `state` near or at; revised r1, was `limits.indicator` alone: P4 variant A, the retained `ptah-limits-alert`): one line, `AlertTriangle` 14 + the summary's full warning string (`Weekly plan limit is near`, or a lane-only `Codex CLI · software-architect · Near limit`), ink `--state-ink-need`
   (near) or `--state-ink-err` (at limit), plus a text button (`h-6 min-w-6`, 24 px) labelled `Plan limits` (summary `source` session) or `Lanes` (source lane) that moves focus to that section's heading. `role` none (static text; the toggle dot carries urgency when
   the inspector is closed). The refresh notice (`limits.refreshNotice`, `role="status"`, `border-l-2 border-info pl-2 text-[11px]`) is the first line of PLAN LIMITS.
2. Tile grid: `grid grid-cols-2 gap-2 mt-0` at the 304 px content width (148 px per column; at the 368 px sheet width 180 px). Tile recipe: `rounded-md border border-surface-border bg-surface-1 p-2.5`
   (radius 6 px, D4; surface-1 as for the chips, D3). Label `text-[11px] text-base-content-muted` above the value (DOM order label, value; no visual reversal needed).

```
+----------------------------------------------------------+
| (ring 44)  Context                          2 compactions |   Context tile, col-span-2
|  15.3%     15.3%  152.9k tokens                           |   ring arc = % used
+----------------------------+-----------------------------+
| Tokens                     | Cost                        |
| ~19.1M                     | ~$8.87                      |
| of 50.0M budget            | of $20.00 budget            |
| [=====-------------]       | [=====------------]         |
+----------------------------+-----------------------------+
| Time                       | Agents                      |
| 15m 59s                    | 4                           |
| 6 turns                    |                             |
+----------------------------+-----------------------------+
| Models   Opus 5.5, Sonnet 5                     2  v      |   disclosure (>= 2 models) or static (1 model)
+----------------------------------------------------------+
```

- Context tile (col-span-2, `flex items-center gap-3`): ring chart SVG 44 x 44, `r=18`, stroke 4, `stroke-linecap: round`, rotated -90 deg, track `--surface-border-strong`, arc `currentColor`.
  Arc ink: `--ptah-gold` (dark `#d4af37`, light `--ptah-gold`) below 80 %, `--state-ink-need` 80-94 %, `--state-ink-err` >= 95 % (requirement 7.4 / PM-21: 80 % and 95 %; this REPLACES the old strip's 70 % / 90 % `showContextWarning()` / `contextPercent >= 90` split, which is not carried over). Right of the ring: label `Context`, value `15.3%` 18/600 tabular (the `contextPercentLabel()` text), caption `152.9k tokens` 11 muted (the `(152.9k)` of today's panel). At the far end, when
  `compactionCount() > 0`: `2 compactions` (`text-[11px]` muted, singular `1 compaction`; static text, parity C-3; its old `title` text becomes part of the Context details, below). The ring is
  `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow=15 aria-labelledby=ctxL aria-valuetext="15.3% of the context window, 152.9k tokens used"`.
  **Unknown window rule (revised r1, finding 4; the exact rule, shared with requirement 21.5):** when `hasKnownContextWindow()` is false (third-party providers, no verified capacity; `session-stats-summary.component.ts:215-225`, `.html:338-350`) the tile matches today's strip: value = an em dash `—` (U+2014, the `contextPercentLabel()` fallback; NEVER a percent, never `0%`), NO ring, NO used-token count (today's `(152.9k)` is printed only with a known window, so the count is not shown and not claimed as parity), caption `Window unknown`. The Context details text is then the unknown sentence of `contextTooltip()`. `aria-valuetext` absent (no progressbar role). The toggle ring (D3.7) and the closed-state description follow the same rule: no ring, `Context unknown.`
  No `liveModelStats`: the tile reads `Context  —` with caption `No data yet`, no ring, no progressbar role (today's strip prints no Context item at all in this case; the tile is kept so the grid does not jump).
- Tokens tile: value `~19.1M` 15/600 tabular. The `~` is `aria-hidden="true"` and followed by `<span class="sr-only">estimated </span>` (existing pattern, `stats-tokens-estimate`). With a session token budget
  (`tokensBudgetSuffix()`): caption `of 50.0M budget` and a 4 px bar (`h-1 rounded-full`, track `--surface-border-strong`, fill gold, need ink at the budget's warn state, err ink over budget; semantics
  from `session-budget-format.ts`, no new threshold). Bar `role="progressbar"` with `aria-valuetext="38% of the 50.0M token budget"`. No budget: no caption, no bar.
- Cost tile: value `~$8.87` (`ptah-cost-badge` keeps the number format; `~` rule as above). With a cost budget (`costBudgetText()` / `costBudgetSuffix()`): caption `of $20.00 budget` + 4 px bar as above (`aria-valuetext="44% of the $20.00 cost budget"`).
  Without: caption `known subtotal $0.00` when `knownSubtotal()` exists (today's chip text), else none.
- Time tile: label `Time`, value `15m 59s`, caption `6 turns` (the turn count that 4.1 carried). Static (no details): the label already says what it is, so the old `title="Session duration"` is dropped, not moved. Hidden when `durationMs()` is 0 or absent (as today).
- Agents tile: label `Agents`, value `4`. Hidden when `agentCount()` is 0 (as today); the Time tile then spans two columns.
- **Tile details are keyboard-reachable disclosures (revised r1, finding 3).** Today the strip's detail text lived only in hover `title`s (`contextTooltip()`, `tokenTooltip()`, `costTooltip()`, `knownSubtotalTooltip`, `agentsTooltip`). No `title` carries them any more. Each tile that has details gets ONE `button` in its top-right corner (28 x 28, `lucide` `info` 14, muted ink, `aria-label="{Tile} details"`, `aria-expanded`, `aria-controls="sd-{tile}"`, the 2 px focus ring of 8.4). The tile content itself stays static text, so its ring / bar keeps `role="progressbar"` (a `button`'s children are presentational, so the whole tile must NOT be the button). Opening shows the details region `id="sd-{tile}"` (`role="region" aria-label="{Tile} details"`, `text-[11px] text-base-content-muted`, `whitespace-pre-line`, `mt-2 pt-2 border-t border-surface-border`) INSIDE the tile; an open tile takes `col-span-2` so the text has the full measure (the grid reflows; height transition 160 ms, instant under reduced motion); labels reserve 26 px on the right so the button never overlaps text (the Context tile's `2 compactions` also keeps a 26 px right margin). Closed by default; the open state lives in the existing per-session expansion store (`stats-tile-expansion.state.ts`, as the plan / lane tiles), so a snapshot push does not collapse it. A tile with no details to show has no button. Exact content, verbatim from the strip's own functions (the only new copy is the compactions joiner, marked *):
  - Context details (`contextTooltip()`), known window: `Context used (latest main request): 152,900 tokens` / `Context Window: 1,000,000 tokens` / `Usage: 15.3%` (three lines); then, when `compactionCount() > 0`, a fourth line `Number of context compactions during this session: 2`*. Unknown window: `Context unknown: the latest main request or its verified capacity is unavailable.` No live stats: tile static, no details.
  - Tokens details (`tokenTooltip()`), in this order: the estimate line while `isEstimate()` (`Live estimate while the turn runs; final figures replace it when it ends.`) and a blank line; `Input (uncached): 12,400` / `Output: 3,100` / `Cache Read: 9,800,000` / `Cache Creation: 410,000` / `Total: 19,100,000` (`Total: unavailable` when `tokenCount` is not a number; the single line `Token usage unavailable.` with no snapshot); when `coverage === 'partial'`, the partial-coverage line `Some usage could not be counted.`; with a TOKEN budget, a blank line and the budget line of `budgetTooltip()` (`Session budget: 38% used (19.1M of 50.0M). At 50% Ptah lowers auto-compact; at 80% you can ask the agent to wrap up and hand off.`).
  - Cost details (`costTooltip()`): the estimate line while `isEstimate()` and a blank line; with a COST budget (not a token budget) the budget line (`Session budget: 44% used ($8.87 of $20.00). At 50% Ptah lowers auto-compact; at 80% you can ask the agent to wrap up and hand off.`); when `knownSubtotal()` exists, `Only part of this session has a known price. This is the sum of the priced part, not the session total.` (`knownSubtotalTooltip`). When none of the three applies the Cost tile has no details button.
  - Agents details: `Unique subagents this session has run, over its whole lifetime.` (`agentsTooltip`; this is why the tile can read `4` while AGENTS lists fewer active rows).
  - Focus order inside SESSION (DOM order = visual order, no positive `tabindex`): `Plan limits` / `Lanes` link (when the alert shows) -> Context details -> Tokens details -> Cost details -> Agents details -> `Models` row. The Time tile has no stop. `Enter` / `Space` toggles; `Esc` on the focused details button closes an open region and keeps focus on the button. The region holds no interactive child, so it is reached only through its button; a screen reader hears `Tokens details, button, collapsed` and, after expanding, the region text (also reachable by reading the tile in browse mode). Nothing is hover-only.
- Models row (col-span-2, `min-h-[40px]`): see D47. With more than one model it is a `button` (`aria-expanded`, `aria-controls="modelsPanel"`, `chevron-right` 12 rotating 90 deg), label `Models`, value =
  the first two display names joined by comma, truncating, then the count `2`; `title="Show per-model breakdown"` / `"Hide per-model breakdown"` (today's strings). With one model it is a static row `Model` +
  the display name (`formatModelName`, full id in `title`), no chevron. With no model known the row is omitted.
- Per-model panel (`id="modelsPanel"`, replaces `ptah-session-model-breakdown` table at this width; the component keeps its table for other hosts): `role="list"` of rows, one per `modelUsageList` entry,
  `rounded-md border border-surface-border`, `p-2.5`, gap 6. Row line 1: name 13/600 (truncate) + cost right (`formatCost`, tabular). Line 2: a 4-column mini grid `In 12.4k`, `Out 3.1k`,
  `Cache read 9.8M`, `Cache creation 410k` (`text-[11px]`, label muted, value tabular; the headers of today's table: In = uncached input, Out = output, Cache Read, Cache Creation, with the same `title`s).
  Footer row `Total` with `formatCost(stats.totalCost)` (today's totals row). At the 368 px sheet width the mini grid is one line; at 304 px it wraps to 2 x 2.
- Partial states: `body=partial` shows `—` (em dash) for unknown values and omits ring / bars (never `0`); `body=loading` shows 4 skeleton tiles (`sk`); `body=empty` shows `0` tokens and `$0.00` with no ring (`Context  —`, caption `No data yet`).

### D3.4 PLAN LIMITS section (new, `section aria-labelledby="planH"`, `p-4`)

Data: `StatsLimitViewModel.planTiles` (`PlanLimitTileModel`: `kind` window | local-usage | evidence | cooldown | status; `label`, `value`, `resetLine`, `chip`, `tone`, `sourceChips`, `window`) and the
provenance caption (`planProvenance()`). The section is omitted when `planTiles` is empty and there is no refresh notice (as today's panel). The frontend only has the windows the session owner reports
(for the example: the Claude account's Weekly and 5-hour windows). Lane providers show their own limit state in LANES (D3.5). A provider with no reported window shows the status tile the model already
produces (`No usage source`, `Stale`, `Unavailable`); the UI never fabricates a window or a percentage.

- Header: `PLAN LIMITS` label; below it the provenance line (`flex items-center gap-1.5 text-[11px] text-base-content-muted mb-2`): `ptah-provider-mark` 14 (the owner's provider; neutral `Gauge` lucide icon when
  no authoritative provider id, D37), caption (lead truncates, the tail such as `721c` always stays: `captionLead` / `captionTail`), and the shared source chips (`Provider API`: 10 px, `rounded border
  border-surface-border bg-surface-3 px-1.5 py-0.5`, text muted; off surface-3 text rules of D3 do not apply to muted text, measured below).
- Window tile (`ptah-plan-limit-tile`, the whole tile is a disclosure `button`, `min-h-[56px]`, `w-full`, `text-left`, same tile recipe; `aria-expanded`, `aria-controls` panel id):
  line 1: label `Weekly` 12/600 + the state chip right-aligned (glyph decorative + word: `Near limit`, `At limit`, `Stale`; the word is the meaning, ink `--state-ink-need` / `--state-ink-err`), then `chevron-down` 12 (rotates);
  line 2: bar `h-1.5 rounded-full` (`role="progressbar"`, `aria-valuenow=85`, `aria-valuetext="Weekly: 85% used, resets Fri 16 Oct 16:00 GMT+3, in 23h 32m"`, `aria-label="Weekly plan usage"`) + `85% used` 12/600 tabular;
  line 3: reset line 11 muted wrapping: `resets Fri 16 Oct 16:00 GMT+3 · in 23h 32m` (`resets today 20:10 · in 3h 42m`): absolute and relative, exactly the strings of `resetLine`.
  Bar fill follows the engine's window `tone`, not a recomputed percentage: neutral = gold, warning = `--state-ink-need`, error = `--state-ink-err`. Border tint (redundant to the chip): warning/error 55 % ink.
  Bars are the right chart for windows (long reset text, 2-4 windows, label width varies); the ring is kept for the one headline value, Context (D48).
- Expansion (`hidden` while closed; same open-state store `StatsTileExpansionState`, keyed by session and tile id, so a snapshot push never closes it): the `PlanWindowDetailComponent` content restyled as a
  `dl`: `Used` (`usedText`), `Resets` (each `resetFacts` entry, passed and next kept apart), `Note` (aged / not-confirmed explanation), `Source` chips (`sourceChips`). Rows 11-12 px, `gap-y-1`.
- Non-window kinds (`local-usage`, `evidence`, `cooldown`, `status`): one-line tile `label · value · resetLine` (11-12 px), disclosure only when `detailLines` exist. No bar.
- Order: as `planTiles` (the view model's order: windows first). Tile gap 8.

### D3.5 LANES section (new, `section aria-labelledby="lanesH"`, `p-4`)

Data: `laneTiles` (`LaneUsageTileModel`), `subtotal` (`LaneSubtotalTileModel`), `lanesCount` (runs). Omitted when there is no lane tile and no subtotal.

- Header: `LANES` label; right meta `1 lane · 2 runs` (`lanesCount` is runs; the lane count is `laneTiles.length`; the strip's `LANES 2` pill keeps its `lanesAriaLabel()` text as the meta's `aria-label`).
  Below: the caption `lane · not in totals` (`LANE_CAPTION`, `text-[11px]` muted) with `Info` 12; this is the "not in totals" note.
- Lane tile (`ptah-lane-usage-tile`, disclosure button, tile recipe but `border-dashed border-surface-border-strong`: dashed = outside the session totals, the same cue as the strip's dashed LANES pill; the
  caption word carries the meaning):
  line 1: `ptah-provider-mark` 20 (lucide `terminal` fallback, D5) + `label` (`Codex CLI · software-architect`, 12/600, truncates with `title`) + `runChip` (`Completed` / `Running` / `Failed` word in state ink) + `chevron-down`;
  line 2: `tokensText` (`2.7M tokens`, 13/600 tabular) `tokensUnknownText` (`+1 unknown`, muted) · `costLine` (`cost unknown`, muted, never `$0`) · `2 runs` (muted);
  line 3: `limitChips` (`✓ Room` in done ink, `Near limit` need ink, `At limit` err ink; each followed by its source chip `Provider API`).
  Tile `tone` tints the dashed border for warning / error (redundant to the chip).
- Expansion: the lane subgroups (`LaneSubgroupModel`): heading, `ownerLabel` (`Same account` / `Different owner` / `Unknown owner`) + `ownerText`, `stateChip`, run rows (`label`, `model`, status, tokens, cost),
  `planTileChips` (a text button `Weekly` that opens and focuses that plan tile), `windows` rendered as the same bar row as D3.4 (only when the lane's owner differs or the window is not on a plan tile),
  evidence lines, cooldown line, notes (`info` tone = `border-l-2 border-info`, `neutral` = muted). A lane provider that reports state but no windows shows the state chip only: that is the gap, shown honestly.
- Subtotal tile (`ptah-lane-subtotal-tile`, not a button, no border; `border-t border-surface-border pt-2`): caption `Subtotal` muted, `tokensText` (`2.7M tokens known`) 13/600, `summary` 11 muted
  (`$0.00 known cost · 1 lane · 2 runs · 2 cost unknown`).

### D3.6 AGENTS absorbs the background-agent tray (4.2 amended in place)

The tray's population is already in AGENTS (parity C-6). What the tray had beyond the rows moves too, so nothing is lost:

- Summary line under the AGENTS header (`text-[11px]` muted, `px-4 mb-1.5`): the tray strip's own population grammar `{n} background · {n} foreground · {n} running · {n} done · {n} failed · {n} stopped`, a part omitted at 0
  (for example `1 foreground · 1 running`), from the same tray entries (parity C-40). The header meta stays `4 active · 1 finished`. The line is omitted when the tray would have been empty. The tray's up-to-5 status dots and its expand toggle have no
  counterpart: the AGENTS rows are always listed and each avatar carries its own status ring (4.7), so the same information is shown without a toggle (parity C-19, C-40).
- Row status line: the tray row's line `elapsed time and tokens` (C-41) maps onto AGENTS line 1 (status word + duration) and line 2 (activity); when the entry carries a token count it is appended to line 2 as `· 12.4k tokens` (muted, tabular, hidden when unknown). The row accessible name keeps the AGENTS form `{name}, {kind}, {status} {duration}. {activity}`.
- Per-row actions menu: rows whose entry has any action get a 28 x 28 `ellipsis` button (sibling of the row button, D15; `aria-haspopup="menu"`, `aria-expanded`, `aria-label="Actions for agent {name}"`) at the
  right end of line 1. The menu (`role="menu"`, `menuitem`s, Up / Down / Home / End, Esc closes and returns focus to the button) lists: `View transcript` (`canViewTranscript`), `Steer` (opens the retained
  `ptah-agent-steer-input` inline under the row, with the placeholder `Steer {name}...` and the pending state `pendingSteerId`), `Send to background` (`canBackground`), `Stop` (`stoppable`, err ink). Each item has a
  lucide icon (`eye`, `message-square-text`, `arrow-down-to-line`, `square`). `Focus` is the row button itself (it activates the agent lane view, 4.5), the same call the tray's `Focus` used (`tabManager.switchTab`).
- Sub-agent model (D56 revised r1, parity C-49): the inline bubble footer label leaves the thread, and it does NOT move to the main column in any form (no `Model {name}` line in the dock hover / focus card; the composer selector stays the only model control or label there). It is shown in the inspector AGENTS entry of THAT agent:
  - Visible: in the row's second line (the activity line), as a leading muted chip-less token `Sonnet 5 ·` (`text-[11px] text-base-content-muted`, display name from `resolveModelDisplayName(raw, modelState.availableModels())`, `libs/shared/src/lib/utils/pricing.utils.ts:648`, the same call the bubble used at `inline-agent-bubble.component.ts:889-904`), truncating after the activity text (the model never truncates away first: `shrink-0`). It is visible without hover or focus.
  - Raw id accessible: the token carries `title="{raw model id}"` (mouse) and the row's accessible description gets `Model {display name}, id {raw model id}` (keyboard / screen reader; the row `aria-describedby` points at a visually hidden span, so it does not rely on `title`). Row accessible NAME stays `{name}, {kind}, {status} {duration}. {activity}`.
  - Hidden when unknown: no model, no token, no invented value, no placeholder like `Model unknown`.
  - Frontend-only data path, by agent kind (checked against the code, no backend field): (1) Claude sub-agent, foreground or background with a matching record: `SubagentRecord.usage?.model` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:613` field, `SubagentUsageTotals.model` `:141`, "Latest model the subagent's messages named", filled per request at `:211`). In the tray mapper this is `rec` in `fromSubagent` and the `rec` argument of `fromBackground` (`libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts:246-277, 294-331`); the AGENTS row view model gains one optional `model?: string` and the mapper sets it to `rec?.usage?.model`. Today `BackgroundAgentStripEntry` has NO model field (`libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:46-80`) and the mapper copies none, so this one optional field is the only type change; the strip component and `canvas-lane-view` hosts ignore it. (2) The tool-call node of the same agent (`ExecutionNode.agentModel`, `libs/shared/src/lib/types/execution/node.ts:173`, set from the message-complete model by `agent-stats.service.ts:113`, which is what the bubble reads at `inline-agent-bubble.component.ts:893`) is the fallback ONLY where the AGENTS aggregate already holds that node (joined by `parentToolUseId` = tool-call id); if the aggregate does not walk the tree, do not add a tree walk for this label, show nothing. (3) CLI lane agent (Codex, Gemini, Copilot, Ptah CLI): `MonitoredAgent.model` (`agent-monitor.store.ts:448`, set from the spawn info at `:1235` and `:1270`), shown the same way. (4) Background command (shell) and any entry without a record: no model source exists, nothing shown. A background agent whose record has no usage yet shows no model until the first usage arrives (values update in place).
  - Agent monitor panel, lane headers and the Rail focus header keep their own labels (PM-18). The SESSION Models row still counts every model used.
- Scope (decisions.md row 54, USER answer, C-48b): the inspector AGENTS section and the agent dock already list THIS session's sub-agents, CLI lanes and background commands; the tray merges into AGENTS (the canvas-tile scope, `traySessionId`, with the tray's dedupe by `toolCallId`, background record wins). There is NO group for other sessions' agents. Every tray capability for this session has a place: population counts (summary line), status (row avatar ring + word), `Focus` (row button), `View transcript`, `Steer`, `Send to background`, `Stop` (row menu).

### D3.7 Reaching the stats when the inspector is closed (overlay widths and `compact` mode; D51)

Today the strip is always visible, and its limits alert shows at rest while a window is near or at its limit (C-33). The closed inspector must not hide the two things a user watches: the context level and a limit warning (PM-20, requirement 21.18). No strip returns. Four cues, each with text, never colour alone. All limit cues read ONE session-scoped aggregate, the **session limit summary** (revised r1, finding 1):

- Definition: a pure function of the existing `StatsLimitViewModel` (`stats-limit-view-model.ts:55-64`; no new backend field, no recomputation from percentages). Candidates are (a) `indicator` (the session owner's window; `state: at-limit | near-limit`, `text` as the engine words it, for example `Near · Weekly 94% used · resets Fri 09:00`) and (b) every `laneTiles[].subgroups[]` whose `state` (`LaneLimitState`) is `at-limit` or `near-limit`, worded `{laneTile.label} · {subgroup.stateChip.text}` (for example `Codex CLI · software-architect · Near limit`). `confirmed-room` and `unknown` lane states are NOT candidates (unknown is never a warning, and never room).
- Output: `state: none | near | at` = the WORST candidate state (at before near; none when there is no candidate), `text` = the winning candidate's full text (a tie keeps the session indicator first, then lane order), `extra` = the number of further near / at candidates, `source: session | lane`. Full warning string = `text`, plus ` (+{extra} more)` when `extra > 0`. It is the only string used for the chip `title`, the SESSION alert and the toggle description.
- Why it exists: today `indicator` is set from the session plan only (`stats-limit-view-model.ts:55-64`), lane tiles are built separately, so a near / at-limit lane with no session alert would have no text while the inspector is closed.

- Limit chip in the header (new, between the `N needs you` chip and the inspector toggle): non-interactive status hint, `role="status"`, the 22 px recipe of the `N needs you` chip (`h-[22px] px-2 rounded-md border text-[11px] font-medium`, transparent fill, 55 % ink border), `TriangleAlert` 12 + the word. Copy: `Limit near` (summary `state` near, ink `--state-ink-need`) or `At limit` (`state` at, ink `--state-ink-err`); `title` AND a visually hidden suffix inside the chip (`<span class="sr-only">: {full warning}</span>`) both carry the full warning string of the summary (`Weekly plan limit is near` / `Codex CLI · software-architect · At limit (+1 more)`), so a lane-only limit has a text warning too. Shown only while the inspector is CLOSED and the summary `state` is not `none` (open: the SESSION alert, D3.3, says the same). At 400 px it sits next to the `N needs you` chip and the title truncates first (the title is `min-w-0 truncate`); below 440 px the chip drops its glyph but keeps the word. Pairs: need and err ink on surface-0 (4.5:1 text, measured below).
- Dot on the toggle (extends D6 / D43): 7 px, `--state-ink-need` or `--state-ink-err`, 2 px `base-100` ring, decorative; the chips and the description say what it means. PRECEDENCE when several apply (one dot, highest wins): (1) a pending request (`N needs you`, need ink; the existing rule), (2) summary `state` at: a plan window OR a lane `at limit` (err ink), (3) summary `state` near (need ink), (4) the workflow dot (`--sel`, D43). So the pending-request dot still beats the workflow dot, and the limit warning sits between them.
- Context ring on the toggle: a 28 px ring (`r=12`, stroke 2, same colour rule as the SESSION ring: gold < 80 %, need 80-94 %, err >= 95 %; requirement 7.4 / PM-21) around the `panel-right` icon while the inspector is closed and the context window is known. Decorative (`aria-hidden`); its value is in the description. Unknown window: no ring. Open: no ring.
- Description: the accessible name stays `Show session details`; a visually hidden description (`aria-describedby`) adds what is behind it, in this order, each part present only when true: `Context {n}%.` (known window; unknown window: `Context unknown.`; no live stats: omitted), the full warning string of the summary (`Weekly plan limit is near.` or, lane-only, `Codex CLI · software-architect · Near limit.`), `{n} need you.`. Example: `Context 15%. Weekly plan limit is near. 2 need you.` Lane-only example: `Context 15%. Codex CLI · software-architect · Near limit.` Touch has no hover, so the visible chips and the description are the cues; the user opens the sheet for details (one tap, 8.3 unchanged).

Against 2 (shell), 3.8 and 8.3: no new surface, no layout shift beyond one 22 px chip that exists only in a warning state, the default stays closed, nothing opens itself, focus rules untouched. A header chip was rejected as a permanent context chip (no room at 400 px) but accepted as a conditional warning chip.

### D3.8 Accessibility, targets, motion, contrast

- Headings: each new section has an `h3.sec-label` named by `aria-labelledby`. Tab order inside the inspector (8.1 amended): `Close session details`, [slot], SESSION (`Plan limits` / `Lanes` link when the alert shows, Context, Tokens, Cost and Agents details buttons when they have details, `Models`; the Time tile is static),
  AGENTS (row button, `Actions for agent`, request buttons), PLAN LIMITS tiles, LANES tiles and their expansion controls, TASK, TODOS, GIT. Every bar is `role="progressbar"` with `aria-valuenow` and a text `aria-valuetext`;
  every state has a word (`Near limit`, `At limit`, `Room`, `Completed`); `~` has an sr-only `estimated`.
- Targets: plan / lane tiles that are buttons are >= 52 px high, the four SESSION details buttons are 28 x 28 (`info`), `Models` 40 px, `Actions for agent` 28 x 28, `Plan limits` link and see-plan-tile chips `h-6 min-w-6` (24 px), menu items 32 px. The 2 px focus ring of 8.4
  applies to every new control. No overlapping targets.
- Motion: bar and ring arc width / dasharray transition 400 ms `--ptah-ease-soft` (as 4.1); expansion height uses the existing 160 ms disclosure transition; the staggered entry of 7.1 counts SESSION, PLAN LIMITS and LANES as
  rows (cap of 6 rows unchanged); `prefers-reduced-motion`: instant. Tiles do not re-animate on a snapshot push (values update in place).
- Contrast, measured with `prototype/assets/contrast-delta3.mjs` (WCAG 2.x, text >= 4.5:1, graphics >= 3:1; the project states no other standard; anubis / anubis-light; tile surface-1, section surface-0):

| Pair | anubis | anubis-light | Criterion |
| --- | --- | --- | --- |
| value text on tile surface-1 | 14.01 | 14.41 | text |
| muted label / caption / reset line on surface-1 | 5.71 | 5.46 | text |
| muted section meta on surface-0 | 6.06 | 6.03 | text |
| state word Near limit (need ink) on surface-1 | 6.23 | 5.28 | text |
| state word At limit / failed (err ink) on surface-1 | 4.64 | 5.55 | text |
| state word Room / Completed (done ink) on surface-1 | 5.30 | 5.17 | text |
| state word Running (run ink) on surface-1 | 4.75 | 5.49 | text |
| alert text and header limit chip word (need ink) on surface-0 | 6.61 | 5.83 | text |
| header limit chip word `At limit` (err ink) on surface-0 | 4.92 | 6.12 | text |
| bar / ring fill gold, need, err vs surface-1 | 8.31 / 6.23 / 4.64 | 3.71 / 5.28 / 5.55 | graphic 3:1 |
| toggle ring arc gold, need, err vs surface-0 | 8.81 / 6.61 / 4.92 | 4.10 / 5.83 / 6.12 | graphic 3:1 |
| toggle dot err ink vs surface-0 | 4.92 | 6.12 | graphic 3:1 |

  The track (`--surface-border-strong`, 1.6-1.8:1) and the dashed lane border are decorative: the percentage, state word and `aria-valuetext` carry the value (same ruling as the 4.1 context bar). No pair is new
  in kind: gold, `--state-ink-*` and muted ink were already measured in 8.2; only the surface-1 tile background is new for the graphics and it is included above. The 32-theme fallback (D24) supplies
  `--state-ink-*` for the other themes; the gold fill falls back to `--ptah-accent-ink`.

### D3.9 Data sources and architect checks (delta 3)

No new backend call and no new persisted field. Every value is already resolved in `ChatViewComponent`: `resolvedSessionStats()`, `resolvedLiveModelStats()`, `resolvedCompactionCount()`, `resolvedStatsLimits()`,
`resolvedSessionId()`, `resolvedSessionBudget()` (the six inputs the removed mount passed to `ptah-session-stats-summary`) and the tray entries of `BackgroundAgentTrayComponent`.

1. Build the SESSION / PLAN LIMITS / LANES sections from those six inputs. Prefer reusing the existing child components (`ptah-plan-limit-tile`, `ptah-lane-usage-tile`, `ptah-lane-subtotal-tile`, `ptah-limits-alert`,
   `ptah-cost-badge`, `ptah-token-badge`, `ptah-agent-steer-input`) with a re-skin through their host classes; the layout of the SESSION tiles and the context ring are new template code. Where a child's template
   cannot be restyled to D3.4 / D3.5 (it renders its own bar and chip classes), extract a presentational variant, do not fork the view model.
2. The component `ptah-session-stats-summary` and its `session-stats-summary` helper functions (`session-stats-format`, `session-budget-format`) stay; only `chat-view.component.html` loses the mount (lines 35-51
   region and the tray block 53-64). `showBackgroundStrip()` and `traySessionId()` stay for the canvas tile host if it still mounts the tray.
3. Window thresholds: use the engine's window `tone` / `state` (`PlanWindowState`); do not recompute near / at limit from a percentage in the template. The 80 / 95 split applies to the context ring only.
4. Model display name: `formatModelName()` of the strip, fed by `primaryModelName()` / `modelRows()`; the single-model case no longer prints a chip in the chat column.
5. The inspector toggle (ring, dot, chip, description) reads the same session-scoped aggregate (9.1) plus `resolvedLiveModelStats()` and the **session limit summary** of D3.7 (revised r1, finding 1): a pure function of the whole `StatsLimitViewModel` (`indicator` AND `laneTiles[].subgroups[].state`, `stats-limit-view-model.ts:55-64`), not of `resolvedStatsLimits().indicator` alone, so a lane-only near / at limit warns with text while the inspector is closed. The aggregate must expose
   `contextPercent | null` (null = unknown window), `limitState: none | near | at` (the worst of the session window and every lane, at before near), `limitText` (the full warning string, with ` (+n more)`), `limitSource: session | lane` and a one-line description string, so the toggle, the header chip and the SESSION alert never derive them separately. Dot precedence stays pending request > at limit > near limit > workflow.
6. Cross-host: `harness-builder` and `canvas-lane-view` keep the strip unchanged; verify nothing in `chat-view` still imports the strip or the tray after the move (barrel exports unchanged).
7. Embed (`ptah-session-embed`, row 42): the stats sections render inside the inspector, so the embed gets them for free; the `[sessionAddon]` slot is not used.
8. Tray scope (D3.6, row 54): confirm `BackgroundAgentStore.agentsForSession()` plus `AgentMonitorStore` give the inspector the same entries the tray shows for one session (the `traySessionId` scope, with the `toolCallId` dedupe), including `origin`, `stoppable`, `canBackground`,
   `canViewTranscript` and `taskId`; the AGENTS aggregate (9.1) must carry these action flags.
9. `Usage and limits` disclosure in the old Orchestrator card (4.1, parity=1) is deleted, not hidden: its three rows (compactions, budget, 5-hour / weekly) are now SESSION and PLAN LIMITS.
10. Sub-agent model in AGENTS (D56 revised r1): add one optional `model?: string` to the AGENTS row view model, filled by the tray mapper from `rec?.usage?.model` (Claude sub-agent), `MonitoredAgent.model` (CLI lane agent), else absent. No node walk, no new RPC, no persisted field; sources and lines in D3.6. Verify there is no `Model` text left in the chat main column apart from the composer selector.
11. Tile details (finding 3): the Context / Tokens / Cost / Agents tiles each get one corner `info` disclosure button (`aria-expanded`, `aria-controls`) with per-session expansion state (`stats-tile-expansion.state.ts`); the detail strings are the existing `contextTooltip()`, `tokenTooltip()`, `costTooltip()`, `knownSubtotalTooltip`, `agentsTooltip` (promote the two `protected` ones to the template as visible text); no `title` attribute carries them.

### Delta 3 changes (in-place updates elsewhere in this file)

Section 3.8 table (`stats strip` row), 4 intro (order), 4.1 (model line, context, stats, `Usage and limits`), 4.2 (tray), 5 items 5b and 6 (limit chip, toggle ring and dot), the dock hover card of Delta 2 (NO model line: the r0 `Model {name}` line is withdrawn, D56 revised r1; the sub-agent model is in the AGENTS row), 8.1 (tab order), 10 (D44-D55), 12.1 (C-2..C-6 rows), 13 (index).

### Delta 3 revise round 1 (Gate 1.7, `design-spec-review-delta3.md`)

| # | Finding | Resolution | Where |
| --- | --- | --- | --- |
| 1 | Serious: lane-only limits silent when the inspector is closed | One session-scoped limit summary (window indicator AND every lane; at before near; full warning text) feeds the header chip, toggle description and SESSION alert (`Plan limits` or `Lanes` link); dot precedence unchanged. Prototype `stats=lane`, check K' | D3.3 item 1, D3.7, D3.9, D51, D52 |
| 2 | Serious: D56 put a model label back in the main column | Dock hover card model line removed; sub-agent model shown in that agent's inspector AGENTS entry (visible token, raw id in title and accessible description), frontend-only source per kind, hidden when unknown | D3.6, D3.9 item 10, D56 |
| 3 | Serious: moved details hover-only | Each detail tile has a 28 px `info` disclosure button (`aria-expanded`, `aria-controls`), exact content and focus order specified, no `title` carries details; Time tile static | D3.3 |
| 4 | Moderate: unknown context inconsistent | Unknown window = em dash, no ring, no used-token count, caption `Window unknown`; no live stats = `—` / `No data yet`; matches today's strip, no measured percent implied | D3.3 |
| 5 | Moderate: C-48b stale in other documents | Settled by decisions.md row 54; the documents `task-description.md` and `parity-inventory.md` are owned by the PM and not edited here (flagged to the orchestrator) | none here |
| 6 | Minor: states not drawn | Prototype adds `stats=lane`, `unk`, `more` (status, evidence, cooldown tiles, cost-budget bar) and the AGENTS model; capture.mjs section K' asserts them | prototype, `DELTA-3-NOTES.md` |
