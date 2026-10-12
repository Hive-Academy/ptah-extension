# Prototype - TASK_2026_623_3492 display panel (revision 3)

Static interactive prototype, no build step. Open `index.html` in a browser with internet access (Tailwind Play CDN,
DaisyUI 4.12.23 CDN, Inter and JetBrains Mono from Google Fonts). Themes `anubis` and `anubis-light` copy the literal
values from `apps/ptah-extension-webview/tailwind.config.js`. Cross-reference: `../parity-inventory.md`,
`../design-spec.md`.

Query params: `screen`, `theme` (dark|light), `w` (300|360|960|1024|all), `state` (collapsed|expanded|closed), `shot=1`
(hides the harness), `check=1` (appends the width-overflow assertion result), `contrast=1` (appends measured contrast ratios), `selftest=1` (dock tab/panel switching result).
The harness bar has the same controls. Interactive behaviour implemented: toggles (click, Enter, Space, Escape collapses and returns
focus), tablist roving tabindex with arrows/Home/End that also show the controlled tabpanel and hide the others (`selftest=1` asserts it), separator arrows/Home/End/Enter/double-click with `aria-valuetext`,
"Show full output" / "Show all lines" expanders.

## Screens

| `screen` | Shows | Widths |
| --- | --- | --- |
| `chat` | Turn summary chip, display chips (live and "updated later") (R6, R2) | chat-narrow 360, chat-wide 1024 |
| `previews` | Bash, Read, Write, Edit previews with copy, full-output expand, open-file, language label, replacements count, highlighted Write preview (R7) | 360, 1024 |
| `summary` | Host-built Turn summary, six stat cards; Files and Tests details with full parity fields (R6) | panel-narrow 300, panel-wide 960 |
| `states` | R6.3 states: conflict, baseline missing, truncated, null counts, binary, reconciled, action error, counts unavailable, cost unavailable, incomplete, running | 300, 960 |
| `agents` | Worked `$agents` display, R5 fields only, usage bar = share of turn tokens (R5) | 300, 960 |
| `atoms` | row/col/grid/card/section/accordion, stat, trend pill, sparkline, progress, badge, avatar, note (R3, R4); accordion closed by default | 300, 960 |
| `dock` | Dock coexistence: Displays tab, Agents tab, overlay sheet below 600 px, new-display pulse, resize separator (R1) | 1280 and 720 windows |
| `empty` | Dock empty state (R1.13) | 440 and 300 |

## Screenshots (`screenshots/`, 52 files, headless Chrome, cropped to content)

Pattern `<screen>-<breakpoint>-<state>-<theme>.png`, each in `dark` and `light`:

- `chat-narrow-360-{collapsed,expanded}`, `chat-wide-1024-{collapsed,expanded}`
- `previews-narrow-360-{collapsed,expanded}`, `previews-wide-1024-{collapsed,expanded}` (all four tool types in each)
- `summary-panel-narrow-300-{collapsed,expanded}`, `summary-panel-wide-960-{collapsed,expanded}`
- `states-panel-narrow-300-{collapsed,expanded}`, `states-panel-wide-960-{collapsed,expanded}`
- `agents-panel-narrow-300-{collapsed,expanded}`, `agents-panel-wide-960-{collapsed,expanded}`
- `atoms-panel-narrow-300-{collapsed,expanded}`, `atoms-panel-wide-960-{collapsed,expanded}` (collapsed = default, accordion closed)
- `dock-{dark,light}.png`, `empty-{dark,light}.png`

Example: `previews-narrow-360-expanded-dark.png`.

## Verification done

- Width check (`check=1`): all 48 combinations of screen (chat, previews, summary, states, agents, atoms) x width x state x theme report
  no root or descendant overflow.
- Contrast (`contrast=1`): all text pairs >= 4.5:1 and informational non-text >= 3:1 in both themes, including syntax colours on the
  code well (design-spec.md section 9).
- Not verifiable in a static page: `PanelResizeService` clamps, auto-open and replay rules (R1.7 to R1.9), real Angular focus
  management. These stay implementation and visual-review assertions (design-spec.md section 8, assertions 1 to 13).

## Lane-introduced constraints

- `[lane-proposed]` One dock with `Displays | Agents` tabs and a single resizer instead of two side-by-side panels.
- `[lane-proposed]` Derived `--dp-*` status colour tokens (text/fill/tint) instead of raw DaisyUI `text-success` etc.
- `[lane-proposed]` Stat grid: 128 px minimum column; 3 columns and split expanded stat at container >= 700 px.
- `[lane-proposed]` Renderer classes are namespaced `dp-` (DaisyUI CDN already defines `.stat` and `.hero`).
- `[lane-proposed]` Agent usage bar means share of the turn's total tokens, drawn in a neutral fill.
- `[lane-proposed]` Tab semantics (automatic activation, wrapping arrows, Home/End) and separator keys (arrows 16 px, Home/End, Enter or double-click resets to 400 px; max is 75% of the host, 960 at 1280 px).

## Open questions for the user (Gate 1.7)

1. Sparkline highlight: gold (`secondary`, recommended) or theme primary?
2. Warm hero gradient on the host Turn summary: keep (recommended) or flat?
