# Design Spec: Clean session view and "This session" inspector (TASK_2026_677_efcd)

Status: ready for Gate 1.7. Visual source of truth: `prototype/index.html` (+ `prototype/screenshots/`).
Reference targets: `reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png`.
Design system applied: the app's own Anubis system (DaisyUI themes `anubis` dark and `anubis-light`, semantic surfaces, `text-state-*`
ink tokens, `--bcm` muted text, Inter / JetBrains Mono). No new colour, font or radius is introduced; two small token additions are
proposed in section 1.6 and are marked `[lane-proposed]`.

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
| CLI lane with vendored mark | `ptah-provider-mark` (claude, codex, antigravity, opencode, grok, copilot, cursor) | 14 glyph in 16 box | base-content (mono paint) |
| CLI lane without mark (Gemini today) | `terminal` (`Terminal`), same as the provider-mark fallback | 14 | base-content |
| Background command | `layers` (`Layers`) | 14 | base-content |
| Tool: Read / Grep / Bash | `file-text` / `search` / `terminal` | 14 | muted |
| Tool done / running | `check` (12) / `loader-circle` (12, `animate-spin`) | 12 | `text-state-done` / `text-state-run` |
| Permission request | `shield-alert` (`ShieldAlert`) | 12 | `text-state-need` |
| Git ahead / behind | `arrow-up`, `arrow-down` | 10 | muted |
| Todo done | `check` inside a 14 px filled box | 10, stroke 3.5 | `text-base-100` on `bg-state-done` |
| Git error | `triangle-alert` (`TriangleAlert`) | 14 | `text-state-err` |
| Empty agents | `bot` | 16 | muted |

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
 |    |- scroll area     flex-1, overflow-y:auto, scrollbar-gutter:stable
 |    |     `- thread     max-w-[758px] mx-auto px-6 pt-6 pb-6   => 710 px content column (ref 711)
 |    `- composer wrap   px-6 pt-2 pb-5; composer max-w-[758px] mx-auto (ref 758)
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

---

## 3. The clean turn

A turn is `<article aria-label="Assistant">` with, in order: disclosure row, work log (collapsible), answer, agent chip row, action row, live line.
Each child is optional. User turns are `<article aria-label="You">` with the bubble only.

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
duration-200 ease-[var(--ptah-ease-soft)]`, `rotate-90` when open. Label: `Worked for {m}m {ss}s` (seconds omitted over 1 h: `1h 04m`). While open
turn: `Working · {m}m {ss}s` with a 6 px `bg-state-run` dot before the label (`aria-hidden`; the label itself is the accessible name).

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

### 3.7 Live line

`flex items-center gap-2 mt-3.5 text-xs` with `role="status" aria-live="polite"`: 8 px `bg-state-run` dot with a pulsing 2 px ring
(`::after inset -4 px`, 1.6 s `--ptah-ease-soft`, scale .6 -> 1.25, opacity .55 -> 0), `Orchestrating` (base-content), `·`, timer (muted,
tabular). Timer is `aria-hidden`; screen readers hear only the static label (no per-second announcements). Verb comes from the orchestrator
state ("Orchestrating", "Waiting for you" when any agent is waiting).

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

### 4.2 AGENTS

Header: `AGENTS` label left, `4 active · 1 finished` right (`text-[11px] muted`, `aria-live="polite"` off; updated silently). Order: needing
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
  `h-[22px] px-2 rounded-[5px] border text-[11px] font-medium text-state-need` with 55% need-ink border (`border-state-need/55` via
  `border-[color-mix(in_srgb,var(--state-ink-need)_55%,transparent)]`). The button is a sibling of the row button (no nested buttons);
  aria-label `Review permission request from {name}: {command}`. It opens the existing permission surface (see 8, T1-02, T1-07). It is a
  secondary (outline) action; the surface has no `btn-primary`.
- A user question (T1-02) uses the same line: `shield-alert`, "Asked you:" + first 60 chars, `Answer`.
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
- More than 8 items: show the first 8 (in-progress first), then a `+N more` text button.

### 4.4 GIT

Header `GIT` + `Review changes` link right (`text-xs font-medium` in `--ptah-link`, underline on hover, opens the existing review surface). Row
`flex items-center gap-2 text-xs`: `git-branch` 14, branch name `font-mono text-xs font-medium truncate`, ahead/behind `↑2 ↓0` as lucide `arrow-up` /
`arrow-down` 10 px + mono 11 px muted (title `2 commits ahead, 0 behind`), right-aligned `+400` (`.diff-add-text`) `−3` (`.diff-del-text`) mono 12/500
(use U+2212, not a hyphen). `partial` stats add `+` after the numbers (existing `partial()` behaviour) with the existing title text.
States: not a repo -> `git-branch` + "Not a git repository" (no link); loading -> skeleton row; error -> `triangle-alert` +
"Could not read git status" in `text-state-err` + `Retry` text button (`role="alert"`).

---

## 5. Header

`<header>` `h-12 flex items-center gap-2.5 px-4 border-b border-surface-border bg-base-100`, order and tab order:

1. Sidebar toggle (`panel-left`, 28 px icon button, aria-label `Toggle sidebar`).
2. Title `<h1> text-[13px] font-semibold truncate` (session name; never wraps).
3. spacer.
4. Branch chip (non-interactive hint): `h-[22px] px-2 rounded-md border border-surface-border font-mono text-[11px] text-base-content-muted`, `git-branch` 12 + name
   (max 200 px, truncates), `title` = full branch. Hidden below 640 px shell width.
5. `N needs you` chip (non-interactive status, `role="status"`): `h-[22px] px-2 rounded-md border text-[11px] font-medium text-state-need` with 55% need border, transparent fill.
   Shown only when N > 0 (N = agents waiting + pending permission/questions); `title="Open This session to answer"`. Copy: `1 needs you`, `2 need you`.
6. Inspector toggle (`panel-right`, aria-pressed, aria-controls `inspector`, aria-label `Show session details` / `Hide session details`). When the inspector is closed and
   N > 0 the toggle carries a 7 px `bg-state-need` dot at top-right (2 px ring in `base-100`).

No "Prototype" chip in the product. The header does not contain primary buttons.

---

## 6. Composer

Card `max-w-[758px] mx-auto rounded-xl border border-surface-border bg-surface-1 shadow-[inset_0_1px_0_var(--surface-highlight),var(--elev-shadow)]`, focus-within border
`--surface-border-strong` (no extra glow).

1. Top strip `h-[38px] flex items-center gap-3.5 px-3 border-b border-surface-border text-xs text-base-content-muted`: workspace chip (`folder` 14 + name, `title` full path)
   and branch chip (`git-branch` 14 + mono 11.5 name). Both non-interactive hints in this release (no tab stops).
2. Field `px-3.5 pt-3 pb-1 min-h-[52px]`: `<textarea>` 13 px, placeholder `Ask the orchestrator to plan, build or review...` in muted (5.7:1), visually hidden `<label>`
   "Message the orchestrator", auto-grows to 8 lines then scrolls.
3. Bar `flex items-center gap-1 px-2 pb-2.5 pr-2.5`: `+` icon button (aria-label `Attach files or add context`) -> approval chip -> spacer -> model selector -> mic -> send.
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
| last | Inspector (when open): `Close session details`, then each agent row button, `Review permission request ...`, `Review changes`, `Retry` | row: `{name}, {kind}, {status} {duration}. {activity}` |

DOM order is main region then inspector, so a keyboard user reaches the composer before the inspector. `F6` is not introduced. In overlay mode: focus moves to the inspector close
button on open, `Esc` closes and returns focus to the toggle, and the thread is `inert` behind the scrim.

- Landmarks: session `<section aria-label="Session: {title}">`, `<aside aria-label="This session">`, composer `<form aria-label="Message composer">`.
- Live regions: live line `role="status" aria-live="polite"` (static label only, timer `aria-hidden`); `N needs you` chip `role="status"`; git error `role="alert"`. No other live regions
  (agent statuses do not announce each change; the "needs you" chip carries the urgent one).
- Colour is never the only signal: every status is a word; todo state has a sr-only prefix; the permission row has an icon and the words "Needs permission".
- Focus ring: the existing global rule (`outline 2px solid oklch(var(--s))`, offset 2 px; light uses `--ptah-gold-strong`). In the inspector rows use `outline-offset: -2px`
  so the ring is not clipped by the scroll container. Measured >= 6.28:1 (light) and 8.81:1 (dark) against surface-0.
- Targets: icon buttons 28 px (>= 24 px WCAG 2.2 AA minimum), chips 30 px (32 px below 440 px), rows >= 52 px.
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
| Focus ring vs surface-0 | 8.81 | 6.28 (gold-strong) | pass (UI) |
| Diff add / delete text on surface-0 | 10.63 / 6.70 | 5.71 / 6.12 | pass |
| Hairlines (14% base-content) | 1.45 | 1.32 | decorative dividers only; no information depends on them (cards also differ by surface step); not a 1.4.11 target |
| Context bar track (22%) | 1.83 | 1.59 | decorative; `Context 41% of 200k` text and `aria-valuetext` carry the value |

Criteria applied: WCAG 2.2 SC 1.4.3 (text 4.5:1), 1.4.11 (UI components and meaningful graphics 3:1), 2.4.7 and 2.4.11 (focus visible), 2.5.8 (target size 24 px).
The project states no stricter standard; `base-content-muted.spec.ts` already enforces 4.5:1 for `--bcm` on surfaces 1-3 across all 34 themes. Other theme-picker themes inherit
`--state-ink-*` only when defined; the `text-state-*` utilities fall back to the daisyUI semantic colours (`--in`, `--wa`, `--er`, `--su`), which are not contrast-tuned for text:
the visual reviewer must spot-check one third-party light theme (follow-up T1 acceptance, not in this spec).

---

## 9. Data and backend sources (flag for the architect)

| Element | Source today | Gap |
| --- | --- | --- |
| Tokens, cost, turns, model | `tab.sessionStats`, `tab.liveModelStats` (used by `canvas-session-details`) | none |
| Context % | `liveModelStats.contextPercent` + `contextKnown` | window size label (`of 200k`) needs the context window size from the model info; verify `liveModelStats` exposes it, else show `41%` only |
| Branch (header, composer, git) | `tab.agentOrigin.branch` | none |
| Workspace name | `tab` workspace path | none |
| Additions / deletions / partial | `SessionGitStatsStore` | none |
| **Ahead / behind counts** | not present (`SessionGitStatsStore` only has additions, deletions, partial) | **needs a backend data source**: `git rev-list --left-right --count @{u}...HEAD` through the same git service the store uses, as an optional `ahead`, `behind` pair; hide the `↑ ↓` pair when unknown |
| Todo list with item status | `summarizeTodos` returns done, total, active (counts + active title) | **needs per-item list** (title, status) from the `TodoWrite` tool results in `tab.messages` / streaming state; same parser, richer return type |
| Agent list (sub-agent, CLI lane, background) with kind, status, start time, current activity | agent stores (`$agents`, lane prefixes `sub:`, `cli:`, `bg:` per T1-03) | verify a `currentActivity` string exists per lane (last tool label); if absent derive from the latest tool-use event; flag if the CLI lane protocol does not emit it |
| CLI lane id -> mark | `ptah-provider-mark` (`PROVIDER_BRAND_SLUGS`) | Gemini has no vendored artwork (falls back to `terminal`). Optional follow-up: vendor a Gemini mark through `scripts/brand-icons.manifest.json` |
| Permission / question requests per lane | permission store; Electron single chat view has no surface (T1-07) | **needs wiring** so `Review` opens a surface in Electron; the design only specifies the row and the button |
| "Worked for" duration | message timestamps (turn start to final text completion) | client-derived; for restored sessions use stored message times, else omit the disclosure label duration (`Worked`) |
| `N needs you` | count of waiting lanes + pending questions | derived from the same lists |

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

## 11. Lane-introduced constraints

Only items marked `[lane-proposed]` need Gate 1.7 acceptance: `--ptah-link` token (1.6), optional `surface-border-strong` Tailwind colour (1.6), rules R1 (status words never on surface-3)
and R2 (no tinted status fills) in 8.2, the stagger caps (D14). No existing project component is banned.

## 12. Parity cross-reference

`parity-inventory.md` for the replaced compact view and the details aside is owned by the project-manager lane and did not exist when this spec was written. Replaced surfaces:
compact turn view and `ptah-canvas-session-details` body (re-skinned in place; stores unchanged). Every datum the current details aside shows (context %, tokens, cost, turns,
todos count and active title, branch, +/- changes with partial marker, `title` tooltips) is kept: tokens, cost, turns, context, todos (richer), branch, changes. The tooltip text of
`todoTitle()` and `gitTitle()` carries over as `title`. Items traced: T1-01..T1-06 (tiles, stats header, right sidebar, stagger), T1-02 and T1-07 (permission rows; backend wiring flagged in 9).

## 13. Prototype index

`prototype/index.html?theme=dark|light&t1=collapsed|expanded&t2=ref|streaming|answered|done&insp=open|closed&body=full|empty|loading|error&width=wide|sidebar&bare=1&sel=1&reduce=1&replay=0|1`.
See `prototype/README.md`.
