# Delta 2: agent tiles, icon system and thread-switcher options

Task: TASK_2026_677_efcd. Prototype: `prototype/options-delta-2.html` (`assets/delta2.css`, `delta2.js`, `delta2-sprite.js`).
Screenshots (dark = anubis, light = anubis-light): `prototype/screenshots/delta2-tiles-{dark,light}.png`, `delta2-option-A-{dark,light}.png`,
`delta2-option-B-{dark,light}.png`, `delta2-option-C-{dark,light}.png`. Capture and checks: `node prototype/assets/capture-delta2.mjs shots|checks`.
Nothing here edits `design-spec.md`, `index.html` or `assets/app.*`; the spec edit happens after the user picks an option.

## 1. Recommendation

**Option B, the agent dock.** Reasons:

1. It answers both asks at once. The active agent is the one expanded pill (avatar + name + status word + duration, gold-bordered), so "who is active" is readable
   in one glance, and the other agents are visibly avatar buttons, with an explicit `8 agents ›` button that says "there is more, click".
2. It scales without labels. Avatars cost 38 px each, so all 8 mock agents fit at 760 px with no overflow, and at 400 px the dock shows the pinned four
   (Orchestrator, selected, needs-you, error) and moves the rest behind one button. Option A already needs `+4` at 760 px (labels and names cost ~100 px per tab).
3. It reuses the tile vocabulary of section 2 (same avatar, ring, glyph), so the AGENTS list in the inspector and the switcher read as one system.
4. The hover card carries what a flat strip cannot (kind, status, duration, current activity, "Click to view this thread"), and it also opens on keyboard focus.

Weak points to accept or fix: the hover card has no touch trigger (the `N agents ›` popover is the touch path); avatar-only chips rely on the status ring and glyph for
state (they carry accessible names with the status word). Option C is the best fallback if the user wants the most explicit "Viewing: X ▾" affordance; it is the
weakest at 400 px (live jumps collapse to a count). Option A is the most familiar but is the most clipped and gives running agents the least room.

## 2. Agent tile and icon system (applies to every option)

### 2.1 Avatar anatomy (one component, three sizes: 24, 28, 32 px)

- Circle tile `bg-surface-2` with a 1 px `--surface-border-strong` border; the glyph is `text-base-content`. The orchestrator tile uses a gold hairline border (`--sel`).
  A background command tile has a dashed border.
- Status ring, 4 px outside the tile, in the measured `--state-ink-*`:
  running = faint 28% track + a 30% arc rotating 1.1 s linear; needs you = solid 2 px ring + a 1.8 s halo; error = solid 2 px ring; done and stopped = no ring.
- Corner glyph badge (diameter 46% of the tile, at least 10 px): `surface-0` fill, 1.5 px ink border, lucide glyph in ink.
  running `LoaderCircle`, done `Check`, error `CircleAlert`, needs you `Hand`, stopped `CirclePause`.
  State is therefore never colour alone: ring + glyph + status word (WCAG 1.4.1).
- Reduced motion (`prefers-reduced-motion: reduce`): the arc stays as a static 30% arc, no halo, no rotation, transitions 0 ms.

### 2.2 CLI lane marks (`ptah-provider-mark`)

Read from `provider-mark.component.ts`, `brand-slugs.ts`, `provider-marks.data.ts`, `libs/shared/.../agent-process.types.ts`.

| CLI id | Mark | Source |
| --- | --- | --- |
| `codex`, `cursor`, `copilot`, `antigravity`, `opencode`, `grok` | real vendor mark | `PROVIDER_BRAND_SLUGS` (vendored art subset) |
| `claude` (display id) | Claude mark | only through the provider id `claude-cli` (`PROVIDER_BRAND_SLUGS['claude-cli']`); the key `claude` is not in the table |
| `pi`, `ptah-cli` | hand-authored stroke glyph | `PROVIDER_MARKS` |
| `gemini`, any other id | none | fallback below |

Fallback for a CLI without a mark: the existing `ptah-monogram-tile` idea (first letter, theme-tinted, glyph in `text-base-content`), shown as the "G" in the prototype.
Do not fall back to `ptah-provider-mark`'s default `Bot`: that would look like a sub-agent. Mapping lives in one table (`cliId -> providerId`), no per-id branches in the template.

**Finding for the architect:** today's `SYSTEM_CLI_TYPES` are `codex, copilot, cursor, antigravity, opencode, pi, grok` (+ `ptah-cli`). Claude and Gemini are not CLI lane
types in the product; the mock keeps them because the request lists them. Whatever ids exist at runtime follow this table.

Sizing: `ptah-provider-mark` has two fixed sizes (`sm` = 14 px mark, `md` = 24 px mark in a 32 px box). Use `sm` inside the 24 and 28 px avatars and `md` inside the 32 px avatar.
The mark is `aria-hidden`; the row or tab label carries the name (existing contract). No new component input is needed.

### 2.3 Sub-agent role icons (lucide-angular, all names verified in `lucide-icons.d.ts`)

| Agent type | Icon | Agent type | Icon |
| --- | --- | --- | --- |
| frontend-developer | `LayoutTemplate` | code-logic-reviewer | `SearchCheck` |
| backend-developer | `ServerCog` | code-style-reviewer | `ScanEye` |
| software-architect | `DraftingCompass` | researcher-expert | `Telescope` |
| team-leader | `Users` | devops-engineer | `Container` |
| project-manager | `ClipboardList` | technical-content-writer | `ScrollText` |
| ui-ux-designer | `Palette` | modernization-detector | `Sparkles` |
| senior-tester | `FlaskConical` | visual-reviewer | `Eye` |
| any other type | `Bot` | orchestrator / background command | `Workflow` / `SquareTerminal` |

Also used: `ChevronDown`, `ChevronRight`, `MousePointerClick` (hover card hint), `Users` (roster icon). The map is a lookup table keyed by agent type with `Bot` as the default.

### 2.4 New AGENTS tile (replaces the `>_` / `◇` row of design-spec 4.2)

```
+----------------------------------------------------+
| (G)  Gemini                       Needs you  0m 51s |   avatar 32, ring + hand badge
| (o)  [CLI lane] Needs permission: rm -rf dist       |   line 2: kind badge + activity
|      (!) Needs permission: rm -rf dist    [Review]  |   (permission line, unchanged)
|----------------------------------------------------|
| (fe) frontend-developer          Running  2m 14s    |   spinning arc, 32 px
|      [Sub-agent] Edit canvas-lane-tabs.component.ts |
+----------------------------------------------------+
```

Change against 4.2: the kind badge moves to line 2 so long names (`frontend-developer`) keep their full width; the row button label is unchanged
(`{name}, {kind}, {status} {duration}. {activity}`); selected row keeps the 2 px gold bar. Row padding 11 / 14 / 11 / 17 px, gap 13 px.

### 2.5 Contrast

No new colour pair. Every pair is one already measured in design-spec 8.2 (WCAG 2.x, text >= 4.5:1, UI >= 3:1): state ink words and ring/badge ink on surface-0 / 1 / 2
(dark 4.60 to 6.61, light 4.73 to 6.12); muted text on surface-0 / 1 / 2 (5.39 to 6.06); kind badge text on surface-3 (5.11 / 5.06); the selected indicator
`--s` / `--ptah-gold` on surface-0 (dark 8.81, light 4.10, UI only); the focus ring (`--s` dark, `--ptah-gold-strong` light) 5.26 to 8.81. Status words are never placed on
surface-3. The ring track at 28% is decorative (the arc, glyph and word carry the state).

## 3. The three switcher options

Shared behaviour in all three: 24 px minimum targets (audit: no interactive element below 24 x 24, `capture-delta2.mjs checks`); 2 px focus-visible ring in the
focus token with 2 px offset; overflow keeps the Orchestrator, the selected agent, every needs-you and every error agent visible first, then running ones,
then the rest (strict priority order, so the strip never shows a finished agent while hiding a running one); a pip on the overflow button when a hidden agent needs you or failed;
the pane below shows the selected agent's thread (stubbed in the prototype).

### Option A: Avatar tab strip

```
+------------------------------------------------------------------+
| (O) Orchestrator | CLI 4 | (X) Codex  Running 1m 10s | (!) Cursor | (G!) Gemini | [ +4 ] |
|                  |       | =====(gold underline)=====|            |             |        |
+------------------------------------------------------------------+
 groups: SUB 2 | CLI 4 | BG 1 (full labels >= 900 px, none < 560 px);
 hidden agents go to the +N menu (grouped, with status; pip if one needs you)
```

- ARIA / keys: `tablist` of `tab`s, roving tabindex, Left / Right wrap, Home / End, automatic activation (same as today's component). `+N` is a `menu` button
  (`menuitemradio` rows grouped by kind with counts, Up / Down / Home / End, Enter, Esc returns focus to the button, Tab closes).
- Active: bg `surface-0`, 3 px gold underline, name + status word + duration. Others: avatar + name. Hover: tint + underlined name. 400 px: only the selected tab shows its name.
- Clickability cue: hover state, group labels with counts, and `All N` / `+N` menu. No explicit sentence. Weakest of the three on discoverability.
- Frames: 760 px (+4 hidden with 8 agents), 14 agents (+10), 400 px (+3), 400 px reduced motion with the menu open.

### Option B: Agent dock (recommended)

```
+------------------------------------------------------------------+
| (O)(fe)(sa) | [(X) Codex        ] (!) (v) (G!) | (>_)   [ 8 agents > ] |
|             |   Running 1m 11s    gold pill                         |
|  hover on (fe):                                                    |
|    +-----------------------------+                                 |
|    | (fe) frontend-developer     |                                 |
|    | Running 2m 16s - Edit ...   |  [ Click to view this thread ]  |
+------------------------------------------------------------------+
```

- ARIA / keys: `tablist` of avatar `tab`s (same roving model as A); each has `aria-label` "{name}, {kind}, {status} {duration}" and `aria-describedby` to a
  `role="tooltip"` card. The card opens after 220 ms hover and on `:focus-visible`, stays open while the pointer is over it (WCAG 1.4.13), Esc dismisses it.
  `N agents ›` is a `menu` button with the same grouped list as A (14 agents: scrolls, 340 px max).
- No overlapping targets: the "stacked avatars" live inside the `N agents ›` button as a decorative pile (the hidden agents, or a `Users` icon when nothing is hidden).
- Active: gold-bordered pill, 38 px high. Chips are 38 px; avatars 28 px; group dividers are 1 px rules.
- Clickability cue: avatar buttons with hover fill and card, plus the explicit `N agents ›` button. At 400 px the label becomes a count badge.

### Option C: Split switcher

```
+------------------------------------------------------------------+
| [(O) Orchestrator] | Viewing [ (X) Codex  Running 1m 11s  (8) v ] |
|                    |                    LIVE (fe)(X)(G!) +1       |
|  open:  ORCHESTRATOR 1 / SUB-AGENTS 2 / CLI LANES 4 / BACKGROUND 1  |
|         rows: avatar, name, status word, duration; selected = bar   |
+------------------------------------------------------------------+
 400 px: [(O)] [ (X) Codex  (8) v ]  [ 4 live ]
```

- ARIA / keys: Orchestrator is a toggle button (`aria-pressed`). The combobox is the APG select-only pattern: `role="combobox"`, `aria-haspopup="listbox"`,
  `aria-expanded`, `aria-activedescendant`; Down / Up / Enter / Space open, then Up / Down / Home / End move, type-ahead by name, Enter selects, Esc closes
  (focus stays on the trigger). Live avatars are `aria-pressed` toggle buttons labelled "Jump to {name}, {status} {duration}".
- Active: the trigger takes the gold border and shows the selected agent; when the Orchestrator is selected it reads "Delegated agents, 7 running, 1 needs you".
  The count badge (8) and the chevron say "pick another".
- Clickability cue: the strongest of the three (an explicit "Viewing" label, a count and a chevron). Cost: switching to a non-live agent is two steps; at 400 px the
  live avatars collapse to "4 live" (opens the same listbox).

### Comparison

| | A tab strip | B dock | C split |
| --- | --- | --- | --- |
| Active agent obvious | yes (underline + name) | yes (expanded pill) | yes (trigger) |
| Clickability cue | weak | strong | strongest |
| 8 agents at 760 px | overflow (+4) | all visible | all reachable, live visible |
| 14 agents | +10 menu | popover | listbox |
| 400 px | 5 tabs, names hidden except selected | 4 chips + count | 3 controls |
| Taps to reach any agent | 1 (visible) or 2 | 1 (visible) or 2 | 2, or 1 (live) |
| Rich hover info | title only | card | none |
| New build cost | tablist + overflow menu | tablist + tooltip + popover | combobox + listbox |

## 4. Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | All avatars are circles; kind is told by the glyph, group label and kind badge | circle for sub-agents and rounded square for CLI lanes | a spinning arc only reads well on a circle; the badge rows already name the kind | yes |
| D2 | State = ring + corner glyph + word, never colour alone | colour dot only (today) | WCAG 1.4.1; today's dot is `bg-current` on a 6 px circle | yes |
| D3 | CLI marks resolve through one `cliId -> providerId` table; Claude goes through `claude-cli`; missing marks use a monogram tile | `Bot` fallback | `brand-slugs.ts` keys, `SYSTEM_CLI_TYPES` | yes |
| D4 | Use the existing `sm` / `md` provider-mark sizes; no new input | add an `avatar` size | provider-mark component contract (fixed sizes, aria-hidden) | yes |
| D5 | Overflow order is strict priority (orchestrator, selected, needs you, error, running, rest) with a pip on `+N` | greedy fill, left to right | a hidden needs-you agent is a blocked agent | yes |
| D6 | B never overlaps targets; the "stack" is decorative inside one button | overlapping avatars | WCAG 2.5.8 target spacing | yes |
| D7 | Automatic activation for tablists (A, B) | manual activation | same as the current `canvas-lane-tabs` keydown model; switching a thread is cheap | yes |
| D8 | Orchestrator icon `Workflow`, background command `SquareTerminal` | `Crown`, `Terminal` | the existing sprite already uses `square-terminal` for command rows | yes |

## 5. What the user decides

Pick A, B or C (recommended: B). The two to name explicitly in the prompt: whether Claude and Gemini should exist as lane types (finding in 2.2), and whether
the hover card (B only) is wanted given it has no touch trigger.
