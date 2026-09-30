# Ptah UI motion kit: component specification

Status: implemented. Sources in `src/`, built by `build.mjs`. Target: HyperFrames (GSAP 3.14.2, one paused timeline per component), 1920x1080, 30 fps.
Purpose: ten mountable components that recreate the real Ptah chat UI at video scale, so marketing videos animate authentic product UI instead of generic cards or tiny screen recordings.

Source path prefixes used for `file:line` citations:

| Prefix | Path |
| ------ | ---- |
| `CU`   | `libs/frontend/chat-ui/src/lib` |
| `CH`   | `libs/frontend/chat/src/lib/components` |
| `CV`   | `libs/frontend/canvas/src/lib` |
| `WV`   | `apps/ptah-extension-webview` |
| `BE`   | `libs/backend` |
| `REF`  | `tools/hyperframes/kits/ptah-ui/reference` |

Rule for conflicts: the real source wins over screenshots. Every conflict found is listed in section 1.6 so nobody "fixes" the kit back to the screenshot.

---

## 1. Design tokens for video

The theme is daisyUI 4 `anubis` (dark), the project's only theme for this kit. There is no light variant and no theme variable.

### 1.1 Palette (design values, straight from source)

Source of truth: `WV/tailwind.config.js:70-126` (mirrored in `REF/anubis-app.css:10-37`). HyperFrames renders in Chromium, so `oklch()` and `color-mix(in oklab|oklch, ...)` are usable as written; do not pre-convert.

| Token | Value | Role in the UI |
| ----- | ----- | -------------- |
| base-100 | `#131317` | app background, recessed wells |
| base-200 | `#1a1a20` | cards, composer card (at 60%), tool rows (at 60%) |
| base-300 | `#242430` | chat bubbles, tile header, borders |
| base-content | `#e8e6e1` | primary text |
| base-content-muted | `oklch(63.048152% 0.00745 23.427972)` (about `#8e8887`) | secondary text, labels, chevrons |
| primary | `#2563eb` (focus `#1d4ed8`, content `#f8f7f4`) | send button, focused tile ring, Autopilot icon |
| secondary | `#d4af37` (Pharaoh's gold; content `#131317`) | thinking brain icon, Grep icon, peer-message border |
| accent | `#fbbf24` (content `#131317`) | Edit and Monitor icon |
| neutral | `#1e1e26` (content `#d1d5db`) | neutral count badge |
| info | `#3b82f6` | running state, AskUserQuestion, accepted |
| success | `#16a34a` | completed, cost badge, connected dot |
| warning | `#f97316` (true orange, not gold) | MCP needs attention, interrupted, Compactions |
| error | `#dc2626` | failed, stop button |
| ptah-gold | `#d4af37`; strong `#f5d97d`; soft `rgba(212,175,55,.12)` | Ptah MCP tool rows and badges (`WV/src/styles.css:41-43`) |
| stat-cyan | Tailwind cyan-600 `#0891b2` tint, cyan-400 `#22d3ee` value | MAIN CONTEXT stat (`CU/molecules/session/session-stats-summary.component.ts:82-88`) |
| stat-purple | Tailwind purple-600 `#9333ea` tint, purple-400 `#c084fc` value | MODEL and MODELS stat (`...session-stats-summary.component.ts:69-75,163-181`) |

Text ladder: only two tiers exist, base-content and base-content-muted. No `/40 /50 /60` alpha text (the repo removed them, `WV/tailwind.config.js:14-25`).

### 1.2 Radii, borders, elevation (at kit scale, factor 2, see 1.4)

| Token | App | Kit |
| ----- | --- | --- |
| rounded-box | 0.75rem (`tailwind.config.js:118`) | 24px: modals, dialogs |
| rounded-btn | 0.375rem (`:119`) | 12px: buttons |
| rounded-badge | 0.25rem (`:120`) | 8px: badges, `rounded`, inline code (4px x2) |
| rounded-lg | 0.5rem | 16px: tile, subagent bubble, lane tabs (`CV/canvas-tile.component.ts:116`; `CH/organisms/execution/inline-agent-bubble.component.ts:85`) |
| rounded-2xl | 1rem | 32px: composer card (`CH/molecules/chat-input/chat-input.component.ts:626-628`) |
| rounded-full | 9999px | avatars, chips, send/stop buttons |
| border 1px | 1px | 2px; `border-l-2` becomes 4px; `ring-2` becomes 4px |
| shadow-card | (daisy) | `0 12px 36px rgba(0,0,0,.45)` kit value; the repo defines no numbers I could cite |

### 1.3 Fonts

`WV/tailwind.config.js:33-37`: sans = Inter, system-ui, -apple-system, sans-serif; mono = JetBrains Mono, Fira Code, Menlo, monospace; display = Cinzel (brand only, not used in chat UI; the kit does not use it).

Kit stack: `--font-body: Inter, system-ui, -apple-system, "Segoe UI", sans-serif`; `--font-mono: "JetBrains Mono", "Fira Code", Menlo, monospace`. Numerals in stat badges use `font-variant-numeric: tabular-nums` (`tabular-nums` in the source).

### 1.4 Video scale rule

The app is built for a 300-600px sidebar and dense tiles; its text is 9-14px. The kit therefore does not scale uniformly.

- Geometry (spacing, radii, borders, icons, avatars): app px x 2. Tailwind `px-2` (8) becomes 16; `w-3.5` icon (14) becomes 28; `w-6` avatar (24) becomes 48.
- Type: a role table with a hard floor. Smallest readable text is 26px at 1920x1080. App text that was 9-14px lands on 26-34px (2.3x-2.9x), so the type/chrome ratio is slightly larger than in the app. Hierarchy that the app gets from size alone (9px vs 11px) is kept here by weight, uppercase tracking, mono, and the two-tier color ladder.
- Design box: every component is authored at a design width `DW` (table in each component). Inside `#root` use `--u: min(100cqw / DW, 100cqh / DH)` and write every length as `calc(N * var(--u))`. At a 1920x1080 mount of a component's recommended size, `u = 1` and the floor holds. Mounting a component smaller than its recommended size breaks the 26px floor; to show more detail use camera scale >= 1, never a smaller mount. `#root` is the only `container-type: size` element.

Type roles (px at `u = 1`). App column is the real value, cited.

| Role | Kit px | Weight | App value and source |
| ---- | ------ | ------ | -------------------- |
| `micro` | 26 | 500-600 | 9-10px: badge text, "click to expand", "Message agent", token/cost/duration chips, stat labels (uppercase, tracking .04em) (`inline-agent-bubble.component.ts:149,355`; `thinking-block.component.ts:62`; `session-stats-summary.component.ts:72`) |
| `small` | 28 | 400-500 | 10-12px (`text-xs`): tool row mono description, stat values, composer chips, status-line chips, lane tab names, chat header "Claude 5:23 PM" (`tool-call-header.component.ts:97`; `chat-input.component.ts:412`; `message-bubble.component.html:23`) |
| `ui` | 30 | 500 | 12px medium: tile title (`canvas-tile.component.ts:126-130`) |
| `body` | 32 | 400 (strong 700) | 14px `prose-sm`: chat prose, thinking text, lane text (`message-bubble.component.html:117`) |
| `lead` | 34 | 400 / 600 | 14px `text-sm`: composer input (`chat-input.component.ts:211`); "Agents" panel heading semibold (`agent-monitor-panel.component.ts:213`) |
| `h2` | 36 | 700 | prose `h2` = 1.1em (`CH/organisms/message-bubble.component.css:164-167`): "Report Delivered" |

Line heights: body 1.6 (composer 1.625 via `leading-relaxed`), micro/small 1.3, h2 1.3 (`message-bubble.component.css:150-153`). Inline code: 0.85em mono, padding 1px 6px x2, radius 8, 2px border base-content/8%, bg base-100/60% (`message-bubble.component.css:107-115`; the gold tint seen in screenshots is not in that rule, see Open questions).

### 1.5 Contrast (measured)

Criterion: WCAG 2.2 AA. Kit text is always >= 26px, which is "large text" (3:1 threshold); I also report the 4.5:1 normal-text result because the repo's own rule for muted text is 4.5:1 (`WV/tailwind.config.js:14-25`, `base-content-muted.spec.ts`). Ratios computed from the literal token values with WCAG relative luminance; alpha tints composited over base-200.

| Pair | Ratio | Verdict |
| ---- | ----- | ------- |
| base-content on base-100 / base-300 | 14.86 / 12.29 | pass |
| muted on base-100 / 200 / 300 | 5.31 / 4.97 / 4.40 | pass large and normal on 100/200; 300 passes large only |
| gold `#d4af37` on base-100 / base-200 | 8.81 / 8.24 | pass |
| gold on gold-soft 12% over base-200 | 6.61 | pass |
| info on base-100 / base-200 | 5.04 / 4.71 | pass |
| warning on base-100 / base-200 | 6.61 / 6.18 | pass |
| success on base-100 | 5.62 | pass |
| error on base-100 | 3.84 | large only |
| cyan-400 on cyan tint; purple-400 on purple tint (over base-200) | 8.01; 5.83 | pass |
| success on success/10 (stat cost) | 4.64 | pass |
| info on info/10 (stat agents) | 4.21 | large only |
| primary-content on primary (send button) | 4.82 | pass |
| **base-content `#e8e6e1` on success fill `#16a34a`** (filled `badge-success` text) | **2.64** | **fails even large** |
| **base-content on info fill `#3b82f6`** (filled `badge-info`) | **2.95** | **fails large (3:1)** |
| base-content on error fill `#dc2626` | 3.87 | large only |
| base-100 `#131317` on success fill / info fill | 5.62 / 5.04 | pass |

Kit deviation (deliberate, contrast): filled `badge-success` and `badge-info` use `#131317` text, not the theme `*-content` token. Source uses the content token (`CU/atoms/cost-badge.component.ts:32`). The dark text on green that appears in the reference screenshots is consistent with this. Error fills keep `error-content` (passes large).

### 1.6 Source vs screenshot conflicts (source wins)

1. Tool-name badge color is **status**, not tool identity: `badge-success` complete, `badge-info` streaming, `badge-error` error, `badge-ghost` pending (`CU/molecules/tool-execution/tool-call-header.component.ts:405-412`). Tool identity is the **icon** color (`CU/atoms/tool-icon.component.ts:94-127`): Read info, Write success, Bash warning, Grep secondary (gold), Edit accent, Glob info, Workflow primary, Task* secondary, Monitor accent, SendMessage info, ScheduleWakeup warning, anything else (including PowerShell) muted with the Terminal icon. Screenshots show all-green badges because every visible tool was complete.
2. Thinking block: source is a bordered card with a Brain icon in a 24px round well, icon `text-secondary` gold (`CU/molecules/thinking-block.component.ts:28,44-60`). Screenshots show a flatter row with a grey circled glyph. Kit follows source, with a `flat` variant (no card border) so it can also match the dense transcript look.
3. "Report Delivered" is not a dedicated card component. It is markdown returned by `ptah_agent_report`, rendered as tool Output inside the expanded tool row: `formatAgentReport` (`BE/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1951-1971`).
4. `<agent-lane-completed ...>` is a model-facing push envelope, not a UI toast (`BE/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:344-396`). No frontend surface for it exists in `libs/frontend`. The `lane-completion-toast` is therefore a kit-invented visualization (see component 9 and Open questions).
5. Lane tabs: source is `rounded-lg` bordered chips (`CH/organisms/agent-monitor-panel.component.ts:378-392`); screenshots read as pills at low resolution. Kit follows source.
6. The model chip text "Default (recommended)" and the lane follow-up placeholder "Send a follow-up... resumes the session" appear in screenshots; I did not find the strings in frontend source (the model names come from runtime model data). Treated as screenshot-sourced content, exposed as variables.

---

## 2. Kit-wide component contract

Follows `REF/contract-example-notification-stack.html`.

- Shape: `<html data-composition-id="ptah-ui-<name>" data-composition-duration data-composition-variables='[...]'>`, `<template>` holding `#root`; `#root` is `position:absolute; inset:0; overflow:hidden; container-type:size; isolation:isolate; pointer-events:none`; no `data-width`/`data-height`; background `var(--bg, transparent)`; styled through `#root` only.
- One paused GSAP timeline registered under the literal id key `window.__timelines["ptah-ui-<name>"]`. Every change is a `fromTo` with explicit endpoints at absolute times; consecutive tweens on the same property never overlap; `immediateRender:false` on anything that starts after another tween on the same target. No CSS transitions or animations, no `Date.now`, no `Math.random`, no `repeat:-1` (spinners and pulses are finite tweens sized to the state's duration). Transform distances are px derived from the measured root height; layout stays in container units. No `var()` color strings are tweened; color changes are opacity cross-fades between two stacked layers.
- Envelope: IN (fixed, on cues), HOLD (elastic, still), OUT (0 unless `exit` is set). Cues are seconds relative to mount start.
- Shared variables (every component has these; component-specific variables are listed per component):

| id | type | default | meaning |
| -- | ---- | ------- | ------- |
| `cues` | string | `""` | comma list of beat times in seconds from mount start. Blank or invalid entries fall back to the component's default rhythm; values are forced non-decreasing and clamped so all beats land before HOLD |
| `exit` | enum none/fade/up | `none` | `none` = hold ends the film; frame roots own transitions |
| `focus` | string | `""` | name of a component part to highlight (enum per component). Empty = no focus beat |
| `focusAt` | number | `-1` | focus cue in seconds; `-1` = default (last beat + 0.5s) |
| `dimOthers` | number | `0.38` | opacity of non-focus parts during focus (0.38 is the floor that keeps the text legible: muted on dimmed stays above 3:1) |
| `vignette` | boolean | `false` | draws the kit's single allowed background element (see 3.4); default off so mounts stay transparent |

- Shared partials (badges, status glyphs, tool row, status line) are written once in the kit source and inlined into each composition at build; mounted components cannot import each other (Open question 2).
- Files: `tools/hyperframes/kits/ptah-ui/src/<name>.html` (source), built to `components/<name>.html` by `build.mjs`; gallery at `gallery/index.html`.

---

## 3. Motion language

### 3.1 Eases and durations (whitelist)

| Name | GSAP | Duration | Used for |
| ---- | ---- | -------- | -------- |
| settle | `power3.out` | 0.45s | rows, bubbles, cards entering (matches the example's ENTER 0.55/SHIFT 0.45) |
| expand | `power3.out` | 0.55s | height/expand (app uses a 320ms `cubic-bezier(.22,.61,.36,1)` grid-rows collapse, `inline-agent-bubble.component.ts:549-553`; video is slower so it reads) |
| spring | `back.out(1.6)` | 0.32s | badge/chip/check pop, scale .6 to 1 |
| fill | `expo.out` | 0.6s | context bar, progress fills (app: `0.6s cubic-bezier(.22,1,.36,1)`, `session-stats-summary.component.ts:613-618`) |
| press | `power2.inOut` | 0.14s down, 0.22s up | button press states, scale 1 to .94 to 1 |
| focus | `expo.out` | 0.5s | focus ring and dimming |
| exit | `power2.in` | 0.45s | OUT |
| linear | `none` | n/a | text streaming, spinner rotation, counters |
| steps | `steps(1)` toggles | 0.5s | caret blink (app: `1s step-end infinite`, `CU/atoms/typing-cursor.component.ts`) |

Forbidden: `elastic`, `bounce`, `sine` loops, any repeating ambient motion, overshoot above 1.6.

### 3.2 How things enter (not generic fades)

- Rows and bubbles: slide-settle from 16 design px below with opacity 0 to 1 (`settle`). The prototype toast used a 12px `slideUp` at 0.2s (`REF/anubis-app.css:354-359`); 16px at 0.45s is the video-scaled equivalent.
- Siblings in a list: stagger 0.09s (about 1/5 of a beat at 128 BPM); newest settles into place, earlier items do not move unless content above grows.
- Badges, chips, check/cross glyphs: `spring` scale from .6 (transform-origin center), opacity 0 to 1 over the first 40% of the tween.
- Text: streams. Assistant and lane text reveal word by word at a steady rate (`streamRate` words/s, default 7); composer text types character by character (`typeRate` chars/s, default 16). The full text is laid out first with every word/char at opacity 0, so the container never reflows. Reveal uses `tl.set` per unit at `t0 + i / rate` (linear, seek-safe).
- Numbers count up with `linear`/`power2.out` through a proxy object and an `onUpdate` that formats from progress (stateless, seek-safe).
- Expand/collapse: height tween from 0 to a pre-measured px, chevron rotation -90deg to 0 in the same 0.55s, content fades in during the last 60%.
- Buttons: a cursor-less press is shown as scale and a 15% brighter fill (`filter: brightness(1.15)`, numeric). No fake mouse pointer in v1 (Open question 6).

### 3.3 Focus treatment for camera push-ins

The host scene pushes the camera (scale >= 1) onto a component; the component also runs a focus beat so the eye lands on the right part even without a camera move.

1. Every focusable part carries `data-ptah-part="<name>"`.
2. At `focusAt`, all other parts tween opacity to `dimOthers` (0.38, `focus` ease), and the focused part gains: a gold ring layer (`border: 4px solid #d4af37`, radius = part radius + 8px, inset -10px, opacity 0 to 1), a soft outer glow layer (`box-shadow: 0 0 48px rgba(212,175,55,.28)`, opacity 0 to 1), and `scale 1 to 1.03`.
3. The ring is a separate absolutely-positioned element so only opacity and transform are tweened.
4. Gold is the kit's focus color and is a video choice: the product's own focus ring is blue primary (`CV/canvas-tile.component.ts:118-123`). Do not use blue for the focus beat, so it never reads as product state.
5. Focus holds until the end of the mount (no un-focus unless `exit` is used).

### 3.4 Background rule

Default is transparent so the host chooses. The gallery and standalone previews use flat base-100 `#131317`. At most one extra element is allowed, chosen per scene, and it is static:
either (a) a vignette: `radial-gradient(ellipse 80% 70% at 50% 42%, transparent 55%, rgba(0,0,0,.45) 100%)` or (b) a perspective grid: 1px lines `rgba(212,175,55,.06)` on a fixed 3D plane, no scroll. A slow camera move over a static element is allowed; the element itself never animates. Forbidden: drifting color blobs, animated gradients, particles, grain, bokeh, glow orbs.

---

## 4. Components

Conventions in each entry: names in `code` are anatomy parts and `data-ptah-part` values. "Beats" are default cue slots (cue index N = Nth value of `cues`, fallback shown). B = one beat at the gallery tempo = 0.46875s (128 BPM); beat offsets are given in B.

### 4.1 `session-shell`

Purpose: the window/tile frame every other component sits inside. Gives the stat header and footer, so a scene reads instantly as Ptah.
Mirrors: `CV/canvas-tile.component.ts:114-134` (tile, header, focus ring), `CU/molecules/session/session-stats-summary.component.ts:58-200` (compact stats row), `:606-618` (context bar), `CH/molecules/chat-input/chat-input.component.ts:395-425` (status line).
Design box: DW 1800 x DH 1000. Recommended mount 1800x1000 centered in 1920x1080.

Anatomy:
- `tile`: border 2px base-300 (focused: border + ring primary 4px), radius 16, bg base-100, overflow hidden. `focused` = `border-primary ring-2 ring-primary` (`canvas-tile.component.ts:118-123`).
- `header`: bg base-300, h 64, px 16, radius 16 16 0 0; title `ui` 30/500 base-content truncating; right side: optional `Hand off` (micro 26/500 muted; the control is `ptah-send-to-messaging` in the tile header, `canvas-tile.component.ts:134-137`; its detached trigger shows "Hand off", `CH/molecules/send-to-messaging/send-to-messaging.component.ts:106`), then `...` and close icons (28px, muted).
- `stats`: one rounded row, bg base-200/50, border 2px base-content/10, radius 8, px 16, py 8, gap 16 (`session-stats-summary.component.ts:62`). Badges (radius 8, px 12, py 4, border 2px, label `micro` uppercase muted + value `small`):
  - `stat-model` (only when 1 model): "MODEL" + name, purple tint, purple-400 value, semibold.
  - `stat-context` "MAIN CONTEXT" + `18.1%`: cyan tint and cyan-400 value (`:82-88`).
  - `stat-tokens` "TOKENS" + `13.5M`: base-content/5 bg, /10 border, tabular.
  - `stat-cost` "COST" + cost badge (filled success, `badge-sm`; dark text per 1.5).
  - `stat-time` "TIME" + `51m 28s`: neutral.
  - `stat-agents` "AGENTS" + `4`: info tint, info value.
  - `stat-compactions` (optional) warning tint.
  - `stat-models` "MODELS" + `2 v`: purple tint, chevron glyph; only when models > 1 (`:160-183`).
- `context-bar`: track h 8 (4px x2) radius 4 `oklch(.3 0 0 / .4)`; fill `oklch(.72 .15 200 / .5)`; warning >= threshold `oklch(.795 .184 86.047 / .7-.9)`, critical `oklch(.637 .237 25.331 / .7-.95)` (`:606-636`; the app pulses these, the kit holds them static).
- `background-strip` (optional, `strip` variable): "1 background . 1 done" line, small muted, with status dot (screenshot only).
- `body`: empty region; sibling components mount here (Open question 1). Body rectangle is fixed: x 0, y 228, w 1800, h 640 at design scale.
- `footer`: the shared status line: chips h 48 radius full px 12, `small` 28, no border, gap 8. `autopilot` = primary-colored icon (`CU/molecules/chat-input/autopilot-popover.component.ts:40`) + "Full Auto (YOLO)" (`libs/shared/src/lib/types/model-autopilot.types.ts:33`); `mcp` = 12px dot x2 + "MCP" + tabular "7/12", dot warning + text warning when something needs attention, else dot success + muted text (`mcp-status-chip.component.ts:295-304`); `peer` = message-square icon + "Peer" (`peer-session-send.component.ts:41-53`); right-aligned `auth` "Claude CLI" `small` muted (`chat-input.component.ts:412`).

States: `focused` (primary ring) / unfocused; `stats` complete or partially revealed; `mcp` attention vs ok; `context` normal / warning / critical.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `title` | string | `continue editor upgrades` |
| `contextPct` | number | `18.1` |
| `tokens` | string | `13.5M` |
| `cost` | string | `$7.64` |
| `time` | string | `51m 28s` |
| `agents` | number | `4` |
| `models` | number | `2` |
| `modelName` | string | `Opus 5.5` (shown as `stat-model` when `models` = 1) |
| `handoff` | boolean | `true` |
| `strip` | string | `""` (e.g. `1 background . 1 done`) |
| `autopilot` | string | `Full Auto (YOLO)` |
| `mcp` | string | `7/12` |
| `mcpAttention` | boolean | `true` |
| `peer` | boolean | `true` |
| `auth` | string | `Claude CLI` |
| `footer` | boolean | `true` (set false when `composer` already renders its status line) |
| `focused` | boolean | `false` |
| `countUp` | boolean | `true` |

Beats (default, from mount start): c0 0.00 `tile` slide-settles 16px + header title; c1 0.30 `stat-*` badges spring in, 0.09s stagger, values count up over 0.9s (tokens, cost, time) with `fill` ease; c2 0.90 `context-bar` fill from 0 to `contextPct`; c3 1.20 `footer` chips settle left to right, `mcp` dot springs; c4 1.80 optional `focused` ring fades in (primary). Focus parts: `stats`, `context-bar`, `footer`, `header`.

### 4.2 `chat-message`

Purpose: user and assistant messages, with streaming assistant prose.
Mirrors: `CH/organisms/message-bubble.component.html:3-35` (assistant: avatar, header, bubble), `:147-160` footer chips, `:185-215` (user), `:211-215` (peer-injected variant); `message-bubble.component.css:100-115` (strong, inline code).
Design box: DW 1400 x DH 380 (assistant), 240 (user). Recommended mount 1400x380.

Anatomy:
- `avatar`: 48px circle with Ptah icon, only assistant (`:8-11`); streaming adds a soft ring (static 4px gold-at-30%).
- `header`: "Claude" or "You" + `time` at 60% opacity, `small` muted (`:23-31`, `:187-199`).
- `bubble`: bg base-300, radius 16, padding 24/32, `shadow-card`. Assistant is min-width 95% of the column (`:35`); user is right-aligned, max-width 85% (`:211`). `peer` variant: bg base-200 plus `border-left 8px` secondary gold and a users icon before the label (`:211-215,190-199`).
- `prose`: `body` 32 base-content, strong 700, inline code pills (1.4 type rule), line-height 1.6.
- `caret`: 3px x 1.05em base-content bar, steps blink while streaming (`typing-cursor.component.ts`).
- `footer`: `tokens` chip (`badge-outline badge-sm`, "2.2k tokens"), `cost` chip (filled success, "$7.59"), `duration` chip (`badge-ghost badge-sm`, "1m 27s") (`CU/atoms/token-badge.component.ts:31`, `cost-badge.component.ts:32`, `duration-badge.component.ts:18`).
- `summary` (optional, `collapsed` true): one collapsed row: chevron, first-line preview (`small` muted truncate), "3 tools" `badge-ghost badge-xs` (`message-bubble.component.html:44-70`).

States: `streaming` (caret on, footer hidden; source hides stats until finalized, `inline-agent-bubble` and bubble footers are `!isStreaming()` gated) then `final` (caret off, footer pops).

Variables:

| id | type | default |
| -- | ---- | ------- |
| `role` | enum assistant/user/peer | `assistant` |
| `text` | string | `The spec is sound. I now spot-check key contracts: the shared constants and the CI job.` (supports `**bold**`, `` `code` ``) |
| `author` | string | `""` (empty = "Claude" / "You" by role; peer uses the session name) |
| `time` | string | `5:23 PM` |
| `streamRate` | number | `7` (words/s; `0` = no streaming) |
| `tokens` | string | `2.2k tokens` |
| `cost` | string | `$7.59` |
| `duration` | string | `1m 27s` |
| `footer` | boolean | `true` |
| `collapsed` | boolean | `false` |

Beats: c0 0.00 avatar spring + header + bubble slide-settle (bubble at full final size); c1 0.45 text streams (duration = words / `streamRate`; caret blinks throughout); c2 = end of stream + 0.15 caret removed, `footer` chips spring in with 0.09s stagger (tokens, cost, duration). User role: c0 bubble settles from the right (16px), no streaming (whole text present; optional `streamRate` > 0 types by word). Focus parts: `bubble`, `footer`, `prose`.

### 4.3 `tool-call-row`

Purpose: the tool execution row, the most recognizable Ptah element. Shows a tool running and completing.
Mirrors: `CH/molecules/tool-execution/tool-call-item.component.ts:122-130` (container), `CU/molecules/tool-execution/tool-call-header.component.ts:59-145` (row), `:405-412` (badge state), `:327-360` (streaming text), `CU/atoms/tool-icon.component.ts:94-127` (icon color).
Design box: DW 1400 x DH 72 collapsed. Expanded adds 360 (see below). Recommended mount 1400x72 (or 1400x440 expanded).

Anatomy (row h 64, px 16, gap 12):
- `container`: bg base-200/60, border 2px base-300/60, radius 8, margin-y 4. Ptah MCP tools: border `color-mix(in oklch, #d4af37 40%, transparent)` (`tool-call-item.component.ts:125-128`, `WV/src/styles.css:1495-1497`).
- `chevron`: 24px, muted, -90deg collapsed / 0 expanded (`:65-70`).
- `icon`: 28px lucide by tool, colored per 1.6 item 1 (Read/Glob info, Write success, Bash warning, Grep gold, Edit accent, other muted).
- `badge`: mono `micro` 26/500, h 36, px 12, radius 8, fill by status (pending ghost, running info, done success, failed error). For `ptah` tool: two gold badges: `Ptah Superpower` (600, border gold 40%) then the tool name with `_` replaced by space, e.g. `ptah agent report` (500, border gold 30%), both gold-soft bg, gold text (`tool-call-header.component.ts:74-86,392-401`, `WV/src/styles.css:1499-1510`).
- `label`: mono 26 muted, truncated; file tools show `.../dir/file` (`shortenPath`, `:364-372`); hidden while running.
- `live`: shown only while running: spinner (info, 24px) + pulsing muted mono text such as `Reading .../a.ts...`, `Writing ...`, `Editing ...`, `Executing Bash...` (`:128-140`, `:327-345`).
- `status`: complete check (success, only when output exists, `:117-121`) / failed X (error) / none while pending.
- `duration`: `badge-ghost badge-sm` right (`:143`).
- Expanded body (optional, `expanded`): top border 2px base-300/30, padding 16; `Input` toggle (`micro` 600 muted, triangle) and `Output` label (`micro` 600 muted) above a code/markdown well (bg base-100/70, radius 16, mono 26) (`tool-input-display.component.ts:44-55`, `tool-output-display.component.ts:47-49`).

States: pending (ghost badge, no glyph) then running (info badge, spinner, live text) then done (success badge, check spring) or failed (error badge, X, optional error line). Pending to running to done takes `runFor` seconds.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `tool` | string | `Bash` (any tool name; `mcp__ptah__...` switches to the gold two-badge variant) |
| `label` | string | `Show git operation constants and the CI job` |
| `liveText` | string | `Executing Bash...` |
| `outcome` | enum done/failed | `done` |
| `duration` | string | `""` (chip hidden when empty) |
| `runFor` | number | `1.2` (seconds in running state) |
| `expanded` | boolean | `false` |
| `output` | string | `""` (mono text shown in expanded body) |

Beats: c0 0.00 container slide-settle; chevron, icon, badge spring in 0.09s stagger; c1 0.45 pending to running: badge fill cross-fade to info, spinner starts (linear rotation, 1 turn/s over `runFor`), `label` swaps to `live`; c2 = c1 + `runFor` running to done: spinner out, badge fill cross-fades to success, `status` check springs, `label` returns, `duration` chip pops; c3 (only if `expanded`) c2 + 0.5 chevron rotates, body expands 0.55s, output appears line by line 0.06s each. Failure path: same as c2 with error badge and X. Focus parts: `badge`, `status`, `label`, `container`.

### 4.4 `thinking-block`

Purpose: the collapsed "Extended Thinking . click to expand" row that interleaves agent work, with an optional expand.
Mirrors: `CU/molecules/thinking-block.component.ts:28` (card), `:30-64` (header), `:66-78` (expanded body).
Design box: DW 1400 x DH 104 collapsed; 420 expanded. Recommended mount 1400x104.

Anatomy:
- `card`: border 2px base-300, bg base-200/50, radius 16, margin-y 24, soft shadow; `flat` variant drops border and bg.
- `header`: px 32, py 20, gap 20: `chevron` 28 muted; `brain` 48px round well bg base-300 with a 28px Brain icon in secondary gold; label `Extended Thinking` `small` 28 weight 600 tracking .03em muted (`:57`); `hint` "click to expand" `micro` 26 muted right-aligned, collapsed only (`:62-64`).
- `divider`: 2px base-300 (only expanded).
- `text`: `body` 32 muted, prose, line-height 1.6, padding 0 32 32.

States: collapsed / expanded; when `expandAt` is set the `hint` fades out and text streams.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `text` | string | `The spec is sound. Checking the shared constants first, then the CI job for the git operations...` |
| `expand` | boolean | `false` |
| `flat` | boolean | `false` |
| `streamRate` | number | `9` (words/s while expanded) |

Beats: c0 0.00 card slide-settle, brain spring; c1 0.45 `hint` pulses once (opacity .5 to 1, finite); c2 (if `expand`) 1.40 chevron rotates -90 to 0, card height expands (`expand` ease), `hint` out, divider draws left to right (scaleX 0 to 1, 0.3s), text streams. Focus parts: `brain`, `header`, `text`.

### 4.5 `agent-report-card`

Purpose: a lane calls `ptah_agent_report` and the row expands to the "Report Delivered" result. Shows work reaching the parent session.
Mirrors: `tool-call-header.component.ts:74-86` (two gold badges), `tool-call-item.component.ts:125-128` (gold container border), `tool-output-display.component.ts:47-49` (Output), `BE/vscode-lm-tools/.../mcp-response-formatter.ts:1951-1971` (the exact result text).
Design box: DW 1400 x DH 88 collapsed; 440 expanded. Recommended mount 1400x440.

Anatomy: a `tool-call-row` (4.3, gold variant) with `Ptah Superpower` and `ptah agent report` badges and a truncated mono description `mcp__p...` (screenshot shows `mcp__p_`, treat as variable `description`), plus expanded body:
- `input-toggle`: triangle + "Input" (`micro` 600 muted).
- `output-label`: "Output".
- `heading`: `h2` 36/700, text `Report Delivered` (or `Report NOT Delivered`), bottom border 2px gold at 12%-ish (source h2 border uses `--s` at 12%, `message-bubble.component.css:164-167`; the tool output well itself is the code-output markdown surface).
- `kv`: two lines, label bold + value, exactly as emitted: `Delivered: Yes` and `Parent Session: <id>` (plus `Reason: ...` when `delivered` is false; no color coding exists in source).
- `result`: optional follow-up assistant text below, streaming `WROTE: <path> ...` (mono path, see `chat-message`).

States: running (spinner, from 4.3) then delivered (check) with body expanded.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `description` | string | `mcp__ptah__ptah_agent_report` |
| `delivered` | boolean | `true` |
| `reason` | string | `""` (shown only when `delivered` is false) |
| `parentSession` | string | `903993f2-02b7-42c5-b517-a1cbf2e5d103` (real-looking UUID; replace in marketing) |
| `result` | string | `WROTE: D:/projects/ptah-extension/.ptah/specs/TASK_2026_576_e16a/reviews/p1-approval.md - Verdict: APPROVED` |
| `runFor` | number | `0.9` |

Beats: c0 0.00 row settles (gold border draws in via opacity layer), badges spring (Superpower first, then tool name, 0.09s apart); c1 0.45 spinner runs `runFor`, then check springs (c1b); c2 1.40 chevron rotates and body expands; c3 1.90 `Input`/`Output` labels settle, `heading` springs with a gold underline sweep (scaleX 0 to 1, 0.35s); c4 2.30 `Delivered: Yes` line settles, c5 2.55 `Parent Session` line settles (0.25s stagger); c6 3.00 `result` streams. Focus parts: `heading`, `kv`, `badge-superpower`, `result`.

### 4.6 `subagent-bubble`

Purpose: an inline subagent card inside the main chat, with live status, stats and "Message agent".
Mirrors: `CH/organisms/execution/inline-agent-bubble.component.ts:85-104` (container, states), `:117-123` (avatar), `:136-184` (header badges), `:194-262` (status row), `:343-355` ("Message agent"), `:508-526` (stats footer), `:832-852` (color), `CU/utils/agent-color.utils.ts:26-52` (color).
Design box: DW 1400 x DH 250 (running with status row), 330 with message input open. Recommended mount 1400x330.

Anatomy:
- `container`: margin-y 24, `border-left 4px` in the agent color, radius 16, bg base-200/50; background agents: dashed border, bg info/5, ring info/20; streaming: static glow `0 0 12px 2px info/20` and border info/40 (`:541-545`).
- `header`: px 24, py 16, gap 16: `chevron` 28 muted; `avatar` 48 circle in agent color with white bold `micro` initial (`agentType[0]` uppercased, `:119-123,:856`); `name` 600 `small` 28 muted (e.g. `spec-fixer-memory-skills`); `task` `micro` muted truncated; right `badge-status`: Background (info, spinner when streaming, outline when finished), Streaming (info + spinner), Resumed (success), Interrupted (warning), or `3 tools` (ghost) (`:144-184`; all `badge-xs` with 9px text become `micro`).
- `status-row` (border-top 2px base-300/30, bg base-100/40, px 24, py 8): status badge `running` (info + pulsing dot), `completed` (success + check), `failed` (error), `stopped` (warning), `pending`; italic muted `last: Grep` progress line; send-to-background moon icon button and stop button; `message-agent` button: ghost xs, chevron + "Message agent" `micro` muted (`:343-355`).
- `message-input` (when open): textarea + send button (primary xs) (`:378-405`).
- `description`: collapsed body text `small` muted, 2-line clamp (`:423-431`).
- `stats` footer (when finished): bg = agent color at 10%, top border 2px white/5: model badge filled with agent color ("Opus 5.5", `micro`, white/80), token chip, cost chip (success), duration chip (`:508-526`).

Agent color: computed exactly as the app does. Built-ins (oklch l c h): Explore .6 .18 145; Plan .55 .2 300; general-purpose .55 .2 265; claude-code-guide .6 .18 210; statusline-setup .55 .05 250; any other name: hash `h = charCode + ((h << 5) - h)` over the string, hue `abs(h % 360)`, color `oklch(.55 .15 hue)` (`agent-color.utils.ts:26-52`). `colorOverride` lets authors pin a value.

States: running (streaming glow + Streaming badge or Background badge), running with status row, message-agent open (input expanded, send press), completed (stats footer), interrupted, resumed.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `agentType` | string | `backend-developer` |
| `name` | string | `""` (empty = `agentType`) |
| `task` | string | `Fix review on 579` |
| `background` | boolean | `false` |
| `state` | enum running/completed/interrupted/resumed | `running` |
| `progress` | string | `last: Grep` |
| `model` | string | `Opus 5.5` |
| `tokens` | string | `127 tokens` |
| `cost` | string | `$0.81` |
| `duration` | string | `13.2s` |
| `showMessage` | boolean | `true` (animates the Message agent press and open input) |
| `message` | string | `Also check the curator fallback path.` |
| `typeRate` | number | `16` |
| `colorOverride` | string | `""` (CSS color) |

Beats: c0 0.00 container slide-settle, avatar spring, name/task settle; c1 0.40 `badge-status` springs, status row settles; c2 0.80 `progress` line swaps once (cross-fade) for liveliness; c3 1.40 `message-agent` press (scale .94, brighten) then chevron flips and `message-input` expands (`expand` ease); c4 1.95 message types; c5 2.80 send button press, input collapses, a one-line "Message sent" note (`text-success/80` italic, `:409`) settles; c6 (state completed) status swaps to completed, stats footer slides in (`expand`). Focus parts: `avatar`, `badge-status`, `message-agent`, `stats`.

### 4.7 `agents-panel`

Purpose: the Agents panel: header with count, lane tabs with status dots, and lane columns streaming tool rows.
Mirrors: `CH/organisms/agent-monitor-panel.component.ts:210-216` (header: "Agents" + `badge-sm badge-neutral` count), `:378-420` (tabs and status dots), `CH/organisms/agent-monitor/agent-lane-grid.component.ts:44-95` (lane column header and body), `tool-call-row` (lane rows).
Design box: DW 1500 x DH 900. Recommended mount 1500x900.

Anatomy:
- `header`: px 20, py 12, bottom border 2px base-content/10: "Agents" `lead` 34/600 + count badge (`badge-sm badge-neutral`, 40px tall); right: icon buttons (trash, layout, close), 28px muted.
- `tabs`: row, gap 12, px 20, py 12. Each `tab`: radius 16, border 2px, px 20, py 12, gap 12: status dot 16px, name `small` 28/500. Selected: border primary, bg primary/10, shadow-sm. Unselected: border base-300, bg base-100 (`:378-392`). Dot colors: running info + pulse, completed success, failed/timeout error, stopped warning (`:395-407`). Permission count: `badge-xs badge-warning` pulse.
- `lane` columns (2 shown side by side in the default, each flex 1): `lane-header` (px 16, py 12, bottom border 2px base-content/10): dot, name `small` 28/500, close icon (`agent-lane-grid.component.ts:56-95`); `lane-body`: stack of `tool-call-row` (4.3, compact) interleaved with `thinking-block` rows (flat) and assistant text `body` 32, e.g. "The spec is sound. I now spot-check key contracts: ...".
- `followup`: bottom input, placeholder text is screenshot-sourced ("Send a follow-up - resumes the session"), send icon muted (screenshot only).

States: each lane `running` / `completed` / `failed` (dot + tab + header agree); lane rows pending to running to done; a lane can finish during the beat (dot flips, tab springs a check).

Variables:

| id | type | default |
| -- | ---- | ------- |
| `count` | number | `2` |
| `lane1Name` | string | `Glm` |
| `lane1Status` | enum running/completed/failed | `completed` |
| `lane2Name` | string | `Antigravity` |
| `lane2Status` | enum running/completed/failed | `failed` |
| `lane1Rows` | string | `Read\|.../git/run-stage-failure.spec.ts;Thinking;Bash\|Show git operation constants;Thinking;Write\|.../reviews/p1-approval.md` (semicolon rows, pipe = `tool\|label`, `Thinking` = thinking row) |
| `lane1Text` | string | `All checks pass. I write the deliverable now.` |
| `lane2Rows` | string | `view_file\|view_file;write_to_file\|write_to_file;call_mcp_tool\|call_mcp_tool` |
| `selected` | number | `1` |
| `rowGap` | number | `0.45` (seconds between rows, floor 0.3) |

Beats: c0 0.00 panel slide-settle, header; c1 0.30 tabs spring with 0.12s stagger, dots start (running dots pulse via finite tween); c2 0.80 lane columns settle; c3 1.10 rows enter in order each `rowGap` apart (each row runs the 4.3 pending to running to done in 0.6s); c4 = after last row `lane1Text` streams; c5 lane status flip (dot cross-fade to final color, tab check spring). Focus parts: `tabs`, `lane-1`, `lane-2`, `header`.

### 4.8 `composer`

Purpose: the prompt input. Types a prompt, presses send.
Mirrors: `CH/molecules/chat-input/chat-input.component.ts:626-639` (card classes), `:206-216` (textarea), `:328-343` (mic), `:360-375` (stop), `:376-392` (send), `:395-425` (status line); `effort-selector.component.ts:126-141` (effort bars); `model-selector.component.ts:51-87` (model chip).
Design box: DW 1500 x DH 320 (card 232 + status 64 + gap). Recommended mount 1500x320.

Anatomy:
- `card`: radius 32, border 2px, bg base-200/60; border by mode: default base-content/10, autopilot `primary/40`, plan `info/50` (`:626-638`); focus-within border base-content/25.
- `input`: padding 24 28 4, `lead` 34, line-height 1.625, min-height 80, 2 rows; placeholder `Ask a question or describe a task...` muted (`:215`); text base-content; `caret` 3px bar, steps blink.
- `toolbar` (px 16, pb 16, pt 8): left: `attach` "+" icon button 48px; `model` chip h 56, px 16, radius full, icon + `Default (recommended)` (`small` 28 muted, max 12rem x2 = 384px, truncate) + chevron 24; `effort` chip: 4 signal bars (2px x2 wide, height (4 + i*2.5) x2, active bars use the effort color, inactive base-content/20) + label `Medium` (`effort-selector.component.ts:126-141`). Right: `mic` icon 28 muted; `stop` (round 64px, bg error/15, error icon) only while streaming (`:367`); `send` round 64px (`h-8 w-8` x2) primary bg, send icon 32px (`:380`).
- `status-line`: same shared partial as `session-shell` footer (autopilot, MCP, Peer, auth). `statusLine` variable.

States: empty (placeholder) / typing (caret, send enabled on first char) / sending (send press, text clears, button swaps to stop for `busyFor` seconds) / idle. Send is disabled (40% opacity) until text exists (`[disabled]="!canSend()"`, `:381`).

Variables:

| id | type | default |
| -- | ---- | ------- |
| `prompt` | string | `read the review comments and fix them` |
| `typeRate` | number | `16` |
| `model` | string | `Default (recommended)` |
| `effort` | enum Low/Medium/High/X-High/Max/Default | `Medium` |
| `mode` | enum none/autopilot/plan | `none` |
| `statusLine` | boolean | `true` |
| `autopilot`, `mcp`, `mcpAttention`, `peer`, `auth` | as `session-shell` | same defaults |
| `send` | boolean | `true` (animate send press) |
| `busyFor` | number | `1.2` (stop button shows after send; 0 = skip) |

Beats: c0 0.00 card slide-settle, chips spring (0.09s stagger, toolbar left to right); c1 0.50 caret starts blinking, first character disables-to-enables the send button (opacity .4 to 1 over 0.2s); c2 0.60 typing at `typeRate`; c3 = end of typing + 0.35 `send` press (scale .94, brighten, then a 12px x2 ring pulse in primary that fades, 0.4s); c4 c3 + 0.25 prompt text slides up 24px and fades (sent), input returns to placeholder; `stop` springs in for `busyFor`. Focus parts: `input`, `send`, `model`, `effort`, `status-line`.

### 4.9 `lane-completion-toast`

Purpose: visualize the `<agent-lane-completed ... verdict="...">` push as a product-style toast so the marketing story "your lane reports back with a verified verdict" has a face.
Reality check: the real push is a model-facing envelope, not UI (`lane-completion-notifier.service.ts:344-396`; attributes `agent-id`, `agent`, `cli`, `status`, `verdict`; verdicts from `libs/shared/src/lib/types/agent-process.types.ts:443-444`: `delivered`, `no-deliverable`, `unverified`, `failed`). This component is a kit-invented surface built from real fields and real strings. Do not caption it as an existing Ptah toast without confirming (Open question 4).
Visual base: `REF/anubis-app.css:334-359` (toast container, `toast-msg`: bg base-300, border, radius 8 x2, shadow, slide-up); app surfaces use base-300 cards, so the toast is a base-300 card with a verdict chip.
Design box: DW 900 x DH 230. Recommended mount 900x230 anchored bottom-right by the host.

Anatomy:
- `card`: bg base-300, border 2px base-content/15, radius 16, shadow-card, padding 28, left accent bar 8px in verdict color.
- `icon`: 48px circle; glyph per verdict.
- `title`: `Lane Glm finished: completed` in `ui` 30/600 (source sentence: `Lane <agent> finished: <status> (exit code N) after <duration>.`, `:355-360`).
- `chip-verdict`: pill with verdict text, mono `micro` 26/600: `delivered` (success fill, dark text), `no-deliverable` (warning fill `#131317` text), `unverified` (ghost/neutral), `failed` (error fill).
- `task`: `small` 28 muted, `Task: <headline>` truncated.
- `deliverable`: mono `small`: `<path> - 4120 bytes` (or `MISSING`/`EMPTY`, `:371-384`).
- `next`: `micro` muted, real next-action text, truncated to one line (e.g. "Next: read the deliverable files and verify the work yourself", `:404-408`).

States: one per verdict; `delivered` default.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `agent` | string | `Glm` |
| `cli` | string | `glm` |
| `status` | string | `completed` |
| `exitCode` | number | `0` (`-1` hides) |
| `duration` | string | `7m 32s` |
| `task` | string | `Review batch 5 code logic` |
| `verdict` | enum delivered/no-deliverable/unverified/failed | `delivered` |
| `deliverable` | string | `.../reviews/batch-5-code-logic-review.md` |
| `bytes` | string | `4120 bytes` |
| `stack` | number | `1` (1-3 toasts; extras are the same component stacked by the host) |

Beats: c0 0.00 card slides in from the right edge 48px + settle, accent bar scaleY 0 to 1 (0.3s); c1 0.30 `icon` spring, `chip-verdict` spring; c2 0.55 title, task, deliverable lines settle 0.09s apart; c3 1.60 `next` line settles; c4 (focus) verdict chip gets the gold focus ring. Exit `up`: 0.45s fade and 12px rise. Focus parts: `chip-verdict`, `deliverable`, `title`.

### 4.10 `peer-send`

Purpose: the "Peer" footer action sends a message to another session; result is "Accepted", never "received".
Mirrors: `CH/molecules/peer-session-send/peer-session-send.component.ts:41-53` (trigger), `peer-session-send-dialog.component.ts:44-56` (title "Message Peer Session"), `:60-200` (picker, target details, message, cost notice, outcome), `:203-208` (acceptance caveat), `BE/agent-sdk/src/lib/peer-sessions/peer-message.composer.ts:77-82` (caveat text).
Design box: DW 1300 x DH 640. Recommended mount 1300x640.

Anatomy:
- `trigger`: the status-line chip: message-square icon 28 + "Peer" `small` 28 muted, h 48, radius full.
- `dialog`: modal, bg base-100, border 2px base-300, radius 24, shadow-card; title `Message Peer Session` 700 at 36; close `x`.
- `picker`: label `Target Peer Session` (`small` 28 semibold muted); a select row with the session name (e.g. `review memory work`).
- `target`: `Workspace: <label>` muted + reachability badge (`reachable` success / `unreachable` error), bg base-200/50 radius 8 (`:108-122`).
- `message`: label `Message`; textarea (radius 12, border base-300, `lead` 34) with placeholder "Type a message or instruction for the peer session..."; typed text.
- `notice`: border warning/30, bg warning/10, title "Notice before sending" (600); two bullets: "Consumes a turn: Sending this message consumes a turn in this session." and "Model-mediated: The model executes the send and may rephrase or decline outright." (`:131-144`).
- `actions`: Cancel (ghost) and Send (primary) buttons.
- `outcome`: panel border info/40, bg info/10, radius 8: label `Status:`, badge `Accepted` (filled info, dark text per 1.5) and `Target: <name>`; below a 2px top rule, mono `small` muted caveat, in full: "Accepted means the request was handed to this session for relay. Ptah cannot observe whether the other session received it: the send is performed by the model calling the CLI's own peer-messaging tool, and that tool reports only that the message reached the peer's inbox. Confirm arrival by reading the other session, never from this result." Buttons become `Send another` / `Done` (`:208-228`).
- `refused` variant (`outcome=refused`): badge error, red-tinted panel, `Reason:` line.

Copy rule (do not break): the UI and any caption must say "accepted"; never "delivered", "received", or "acknowledged" (`peer-session-send-dialog.component.ts:19-23`).

States: trigger (idle) then dialog open then typed then sending (spinner in Send) then accepted (outcome panel) or refused.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `target` | string | `review memory work` |
| `workspace` | string | `ptah-extension` |
| `message` | string | `Batch 5 review is approved. Start the P2 worktree now.` |
| `outcome` | enum accepted/refused | `accepted` |
| `reason` | string | `""` (refused only) |
| `typeRate` | number | `18` |
| `showCaveat` | boolean | `true` |
| `sendingFor` | number | `0.9` |

Beats: c0 0.00 `trigger` chip spring; c1 0.50 trigger press then `dialog` scale .96 to 1 with 24px rise (`settle`); c2 1.00 picker + target + notice settle (0.09s stagger); c3 1.45 message types at `typeRate`; c4 = end + 0.3 Send press, spinner for `sendingFor`; c5 = c4 + `sendingFor` `outcome` panel expands (`expand`), `Accepted` badge springs; c6 + 0.45 caveat text streams by line (0.12s per line). Focus parts: `outcome`, `trigger`, `notice`, `message`.

---

## 5. Gallery plan (`ptah-ui-gallery`, 45.0 s)

Format: 1920x1080, 30 fps. Tempo 128 BPM (inside the 125-134 range): 1 beat = 0.46875s, 1 bar = 1.875s, 24 bars = 45.000s exactly. At 30 fps a beat is 14.06 frames, so cue times snap to the nearest frame (max error 1/60s); beat math is done in seconds and rounded once.

Structure: a frame root owns the flat base-100 background and one static vignette (3.4a); components are mounted as sub-compositions and cut on downbeats (hard cut, no cross-fade; OUT = none). Each component gets 2 bars (3.75s) and plays once: IN on beats 1-4 of bar A, key beat on beat 3 of bar A (+0.9375s), resolve/focus on bar B downbeat (+1.875s), hold still to the cut.

| Bars | Time (s) | Scene | Cues passed (s, from mount start) | Focus / camera |
| ---- | -------- | ----- | --------------------------------- | -------------- |
| 1 | 0.000-1.875 | Title card "Ptah UI" (frame text, gold `#d4af37` on base-100, `h2` scale) | n/a | static, no camera |
| 2-3 | 1.875-5.625 | `session-shell` | `0, 0.469, 0.938, 1.406, 1.875` | push-in 1.0 to 1.08 on `stats`, focus `stats` at 1.875 |
| 4-5 | 5.625-9.375 | `chat-message` (assistant, 7 words/s) | `0, 0.469, 1.875` | focus `bubble` at 1.875 |
| 6-7 | 9.375-13.125 | `tool-call-row` (Bash, runFor 0.938) | `0, 0.469, 1.406, 1.875` | focus `badge` at 1.875 |
| 8-9 | 13.125-16.875 | `thinking-block` (expand true) | `0, 0.469, 0.938` | focus `brain` at 1.875 |
| 10-11 | 16.875-20.625 | `agent-report-card` | `0, 0.469, 1.406, 1.875, 2.344, 2.813, 3.281` | push-in on `heading`, focus `kv` at 2.813 |
| 12-13 | 20.625-24.375 | `subagent-bubble` (running, background) | `0, 0.469, 0.938, 1.406, 1.875, 2.813` | focus `message-agent` at 1.406 |
| 14-15 | 24.375-28.125 | `agents-panel` | `0, 0.469, 0.938, 1.406` (rows every 1 beat) | focus `lane-1` at 2.813 |
| 16-17 | 28.125-31.875 | `composer` (typeRate 16) | `0, 0.469, 0.938, 2.344, 2.813` | focus `send` at 2.813 |
| 18-19 | 31.875-35.625 | `lane-completion-toast` (delivered) | `0, 0.469, 0.938, 1.875` | focus `chip-verdict` at 1.875 |
| 20-21 | 35.625-39.375 | `peer-send` (accepted) | `0, 0.469, 0.938, 1.406, 2.344, 3.281` | focus `outcome` at 2.813 |
| 22-23 | 39.375-43.125 | Ensemble: `session-shell` (body) holding `chat-message` + `tool-call-row` + `agent-report-card` on a 2400x1080 stage beside `agents-panel`; camera pans across at u >= 1 with `expo` ease, 1 bar per move; every component uses `cues` compressed to 1 beat | per-part | gold focus ring hops part to part on beats 1, 3, 5, 7 |
| 24 | 43.125-45.000 | Outro: `lane-completion-toast` and `peer-send` trigger chip final frame, then hold still | n/a | none |

Acceptance for the gallery: every component animates exactly once; smallest text in every frame is 26px at 1920x1080 (mounts at recommended size, camera scale >= 1); all beats land on the 0.46875s grid; the last 0.9s hold still; two renders of the same frame are byte-identical (determinism).

---

## 6. Open questions

1. **Nesting.** Can a HyperFrames component mount other components inside its own DOM (shell body, ensemble stage)? If not, the shell only draws chrome and exposes the fixed body rectangle (4.1), and the host positions sibling mounts. Needs one test against the current HyperFrames mount contract.
2. **Shared markup.** Tool row, badges and status line appear in five components. Is there a build-time include for compositions, or should each file carry an inlined copy kept in sync by a generator script?
3. **Fonts.** Inter and JetBrains Mono must resolve in the render environment. Are they installed or should the kit ship `@font-face` files (size and license check)? Fallback is Segoe UI and Consolas on Windows, which changes text widths.
4. **Lane-completion toast.** The real push is a model-facing envelope with no UI surface. May marketing present it as a Ptah UI toast, or should it be captioned as "what your orchestrator receives"? If neither, drop component 9 or redraw it as the assistant's resulting sentence in `chat-message`.
5. **Inline code color.** Screenshots show amber/gold inline code text; the repo rule I found (`message-bubble.component.css:107-115`) sets background, border, padding and radius but no color. Which global rule sets the color (assumed `--ptah-gold`)?
6. **Cursor.** Should button presses be accompanied by a synthetic mouse pointer (the screenshots show one)? Default is no pointer (press = scale and brighten only).
7. **Frame rate.** 30 fps leaves the 128 BPM beat at 14.06 frames. Is 60 fps acceptable for the gallery (beat = 28.125 frames) or should the soundtrack be 125 BPM (beat = 14.4 frames) or 120 BPM (15 frames) for an exact grid?
8. **Window chrome.** The screenshots show the Electron title bar and top nav (Chat / Apps / Tasks / Tribunal / Analytics). I did not read that source. Include a `frame = window` variant of `session-shell` (needs a read of `CH/templates/electron-shell.component.ts`), or keep tile-only?

---

### 4.11 `app-window`

(Component 11 of section 4, appended after sections 5-6 so the existing sections stay unchanged.)

Purpose: the wrapping Ptah desktop app frame, so a video can show several live sessions inside the real app (`REF/app-window-multi-session.png`). Components cannot nest, so the window draws only the chrome and EMPTY slot placeholders; hosts mount `ptah-ui-session-shell` instances on top of the slots at the rectangles below.
Mirrors: `CH/templates/electron-shell.component.ts:100-118` (navbar `h-10 px-3 bg-base-200 border-b border-base-content/10`, logo `w-5 h-5` + "Ptah" `text-sm font-semibold text-base-content-muted`), `:124-182` (tabs-lifted: Chat LayoutGrid, Apps AppWindow, Tasks ClipboardList, Tribunal Scale, Analytics BarChart3, icons `w-3.5`), `:187-215` (global actions: config menu, theme toggle, notification center), `:233-240` (Workspaces rail), `CH/templates/app-shell.component.html:350` (Sessions rail), `CU/atoms/sidebar-tab.component.ts:30-75` (rail `w-6`/`w-8`, `writing-mode: vertical-rl`, left rails `rotate(180deg)`, `tracking-widest uppercase`), `CV/orchestra-canvas.component.ts:86` (dock row `px-3 py-1.5 border-b bg-base-200/50`), `:129-135` (New Session `btn-xs btn-primary`, Plus `w-3.5`, `text-xs font-medium`), `CV/canvas-layout-controls.component.ts:67` (Layout button `btn-xs btn-ghost border-base-content/10 bg-base-100/90`), `CV/canvas-workspace-grid.component.ts:197` (grid margin 8 = 16 app gutter, 32 kit), `CV/canvas-tile.component.ts:114-134` (tile border base-300, radius, focused `border-primary ring-2 ring-primary`), `libs/frontend/notification-center/src/lib/notification-center.component.ts:252` ("9+" cap).
Design box: DW 1920 x DH 1080 (full frame, u = 1 at 1920x1080). Recommended mount 1920x1080 at 0,0.

Anatomy (design px, `titleBar` false; `titleBar` true pushes everything below it down by `TB` = 56):
- `titlebar` (optional): y 0 h 56, bg `#0e0e12`, 2px bottom rule base-content/6; 28px logo, menus File Edit View Window Help (26 muted), centered caption "Ptah - Coding Orchestra", window controls minus / square / x (80 wide each). Electron's native frame, not in the Angular source; drawn for OS-context shots only.
- `top` bar: y TB, h 80, bg base-200, 2px bottom rule base-content/10. `brand` at x 24: logo 40 (variable `logo`) + "Ptah" 30/600 muted.
- `nav` (focus part): tablist centered on x 960, top 10, h 70; tabs px 28, gap 12, icon 28 + label 30/500 muted; the active tab has label base-content and a lifted box behind it (bg base-100, 2px border base-content/16 without bottom edge, radius 12 12 0 0, bottom -2 so it cuts the bar rule).
- `actions`: right 20; three 56 square icon buttons (sliders, palette, bell, 32 icons, muted); bell carries the `notifications` badge (error fill, base-content 26/700, pill h 34, min-w 36; hidden when empty).
- `rails` (focus part = the left pair): Workspaces x 0 and Sessions x 48, each w 48 (`w-6` x2), bg base-100, 2px right rule base-content/10, from y TB+80 to 1080; label 26/600 uppercase, tracking .1em, muted, vertical, rotated 180 (reads bottom-to-top). The Agents rail (x 1872, w 48, 2px left rule) reads top-to-bottom.
- `toolbar` (focus part, the canvas dock): x 96 to 1872, y TB+80, h 72, bg base-200/50, 2px bottom rule; right-aligned, gap 16, px 24: `Layout` (ghost: bg base-100/90, 2px border base-content/10, radius 12, h 48, px 18, layout-grid 28 + 28/500 base-content) and `New Session` (primary `#2563eb`, text `#f8f7f4`, same metrics, plus icon).
- `slot-N` (focus parts `slot-0`..`slot-3`): placeholders bg base-100, 2px base-300 border, radius 16, empty. Every slot is 9:5 (the session-shell design aspect 1800:1000), so a session-shell mounted at the slot rectangle fills it edge to edge. Slots top-align at body top + 16 and centre horizontally on the content column (x 96-1872, centre 984); gaps 32 (30 between the stacked right slots of `1+2`).
- `fring`: product focus ring on `focusedSlot`: 6px primary band at inset -4, radius 20. Its outer 4px stays visible around a session-shell mounted on top (the shell covers the inner 2px, exactly like the tile's `border-primary` + `ring-2`). Blue = product state; the kit focus beat stays gold (3.3).
- `nring`: New Session highlight on the new slot: 4px dashed primary/85 at inset -4, fill primary/8.

Slot rectangles (x, y, w, h in design px; equal to frame px at a 1920x1080 mount):

| layout | slot | `titleBar` false | `titleBar` true |
| ------ | ---- | ---------------- | --------------- |
| `1` | 0 | 183, 168, 1602, 890 | 228, 224, 1512, 840 |
| `2` | 0 | 113, 168, 855, 475 | 113, 224, 855, 475 |
| `2` | 1 | 1000, 168, 855, 475 | 1000, 224, 855, 475 |
| `1+2` | 0 | 117, 168, 1152, 640 | 117, 224, 1152, 640 |
| `1+2` | 1 | 1301, 168, 549, 305 | 1301, 224, 549, 305 |
| `1+2` | 2 | 1301, 503, 549, 305 | 1301, 559, 549, 305 |
| `2+2` | 0 | 194, 168, 774, 430 | 248, 224, 720, 400 |
| `2+2` | 1 | 1000, 168, 774, 430 | 1000, 224, 720, 400 |
| `2+2` | 2 | 194, 630, 774, 430 | 248, 656, 720, 400 |
| `2+2` | 3 | 1000, 630, 774, 430 | 1000, 656, 720, 400 |

Scale note: a session-shell in a 2+2 slot renders at u = 0.43, below the 26 px floor (1.4). That is inherent to showing four live sessions in one frame (the reference screenshot has the same density); push the camera onto one slot (scale >= 2.3) when its text must be read.

States: `activeTab` (which tab is lifted); `focusedSlot` ring on/off; `newSessionPress` (last slot held back, then springs in with the highlight); `titleBar` on/off; `notifications` badge shown/hidden.

Variables:

| id | type | default |
| -- | ---- | ------- |
| `layout` | enum `1` / `2` / `1+2` / `2+2` | `2+2` |
| `activeTab` | enum Chat/Apps/Tasks/Tribunal/Analytics | `Chat` |
| `notifications` | string | `9+` (empty hides the badge) |
| `focusedSlot` | number | `-1` (none; 0-based slot index) |
| `titleBar` | boolean | `false` |
| `newSessionPress` | number | `-1` (seconds; none) |
| `logo` | string | `assets/brand/ptah-icon.png` (host-relative) |

Beats: c0 0.00 frame fades in 0.3s, title bar and top bar settle 16px from above, logo and action icons spring (0.09s stagger), badge springs at +0.55; c1 0.30 nav tabs spring with 0.09s stagger, then the active tab box slides 48px in from the left (`settle` ease 0.45s); c2 0.85 rails fade in (0.09s stagger); c3 1.10 dock row fades, Layout then New Session spring; c4 1.45 slots draw in (scale .96 to 1, opacity, `power3.out` 0.45s) 0.09s stagger; c5 = c4 + n x 0.09 + 0.35 `focusedSlot` ring fades in (`focus` ease 0.5s); `newSessionPress` t (clamped to >= c3 + 0.5): New Session `press`, at t + 0.2 the last slot springs in (scale .9 to 1, `back.out(1.6)`) with the highlight, which fades at t + 1.2. Suggested session-shell mount starts: c4 + 0.35 + i x 0.15. Focus parts: `nav`, `toolbar`, `rails`, `slot-0`..`slot-3` (dimming affects the window only, not the mounted shells).
