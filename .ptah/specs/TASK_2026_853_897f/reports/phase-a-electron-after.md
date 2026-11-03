# Phase A Electron AFTER capture

| File | Result |
| --- | --- |
| evidence/phase-a-after-dark.png | PASS (ptah-glass, 1200x900 viewport, whole card visible) |
| evidence/phase-a-after-light.png | PASS (ptah-glass-light, 1200x774; card bottom border within a few px of the viewport edge, full card in phase-a-after-light-card.png) |

Extra: evidence/phase-a-after-dark-card.png and phase-a-after-light-card.png (element-only shots).

## Observed
- Real Electron app from dist/apps/ptah-electron/main.mjs, isolated temp dir /tmp/ptah-tpd-phaseA-run (kept), CDP via playwright-core, scripts in /tmp/ptah-tpd-scripts. "Update available" dismissed with Later. Nothing signed in.
- Settings > Advanced shows the card "Claude Code tools & skills": info note, "Currently hidden: about 4,000 tokens", 6 built-in tools table and 7 terminal-only skills table with On radio-style checkboxes, token-cost pills, description, "Skills that need it" / "Needs tool" columns. 13 toggles, no skeleton rows left, no error banner.
- No overflow: card scrollWidth/clientWidth 1030/1030, scrollHeight/clientHeight 661/661. No clipping or truncation.
- Contrast: text readable in both themes (light: heading/cell oklch(0.236 ...) on pale glass; muted text oklch(0.466 ...)). Measured colours only, no numeric ratio computed; visual check looks fine.
- Toggle test: Workflow tool off -> on; savings label 4,000 -> 2,000; persisted after navigating Providers -> Advanced; restored to off (confirmed unchecked at the end). A "Saved Workflow tool. Undo" toast appears bottom-right after a toggle; it overlapped the "Needs tool" column in my first light capture, so I retook the light shot after it expired.
- Console (CDP, page console + pageerror during the whole flow): no errors or warnings, nothing mentioning agent:getClaudeBuiltins / agent:setClaudeBuiltin.

## Defects
None blocking. Minor: the toggle toast sits over the lower-right table cells until it times out (about 5 s); transient, not part of the card.

## Closure
Instance sent SIGTERM; temp dir retained.
