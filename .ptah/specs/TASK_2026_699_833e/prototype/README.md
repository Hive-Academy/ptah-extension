# Prototype - Inspector side dock + Plan Limits cards (TASK_2026_699_833e)

Open `index.html` directly (no build). Hash options: `#theme=dark|light`, `#view=1440|760`,
`#tab=open|closed`, `#expand=0|1`, `#focus=handle` (shows the keyboard-focus state), `#shot=1` (hides toolbar).
Working behaviours: tab toggle, header toggle, scrim/close, drag (pointer), keyboard (Left/Right 16 px,
Shift 48 px, Home/End), Escape during drag restores, double-click resets, clamp to min/max, card expand.

## Screenshots (captured with ptah_browser_* against the static HTML, headless; Electron was not launched)

- `screenshots/dark-1440.png`, `screenshots/light-1440.png` - docked, 1124 px shell, 400 px dock, Session tab active; handle hit area at x 976-988 (dock side only), "Local usage" non-interactive card shown.
- `screenshots/dark-760.png`, `screenshots/light-760.png` - 664 px shell, modal sheet 336 px over scrim, tab inert.

Each shows the three card variants: 5-hour (unknown usage), Weekly (50% used), Weekly Sonnet (82% used, expanded).
Revision 2: handle is a zero-width overlay (main 724 / dock 400 / shell 1124 measured in the page), rest grip visible, expanded detail inside its card. Screenshots re-captured.
Not captured: handle hover/active/focus stills (reproduce with `#focus=handle` or by dragging).

## Lane-introduced constraints

All of these are `[lane-proposed]` and need Gate 1.7 acceptance:

- [lane-proposed] Minimum dock width 300, maximum 560, chat column floor 624.
- [lane-proposed] Default width tiers 336 / 400 / 448 at shell widths < 1100 / 1100-1499 / >= 1500.
- [lane-proposed] Tab label "Session"; tab sits outside `.cs-shell`, right of the dock, left of the Git tab.
- [lane-proposed] Handle is a zero-width slot whose 12 px hit area sits entirely on the dock side (`absolute inset-y-0 left-0 w-3`, over the dock border and its 16 px padding; never over the chat pane or its scrollbar), a visible rest grip `base-content/60` (4x32) and a solid 2 px `base-content` focus outline (git dock handle has neither).
- [lane-proposed] Only expandable plan-window cards render the disclosure button/chevron/panel; `status` and `local-usage` cards are non-interactive (no button, chevron, aria-expanded or panel).
- [lane-proposed] Expanded Plan Limits detail renders inside its card, divided by `border-surface-border`.
- [lane-proposed] Plan card progress bar is 8 px (`h-2`), up from 6 px (`h-1.5`).

Project rules kept as `[project-rule]`: bands 960/640 (`INSPECTOR_DOCKED_MIN_WIDTH`, `INSPECTOR_SHEET_MIN_WIDTH`),
sheet `min(336px,100%)`, semantic colour only on borders/fills never text (`stats-tile.styles.ts` header comment),
`csInspectorIn` 220 ms, parity-inventory.md all rows kept.

## Prototype fidelity note

The prototype hand-writes the CSS that the named Tailwind/DaisyUI classes produce; font is a system stack, not the app font.
