# Visual Review - Batch 31 (rotation variant of session-budget-banner)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED (one Serious item to file as follow-up, see S1) |
| Visual breaking | 0 |
| Serious | 1 (light-theme focus ring on the primary button) |
| Moderate | 1 |
| Viewports tested | 1920x1080, 360x760 (iframe) |
| Screenshots taken | 7 (6 kept) |

## Environment

- Real app, not a mock: `nx run ptah-extension-webview:build:development` (fresh build of the working tree, exit 0), served from `dist/apps/ptah-extension-webview/browser` by a throwaway static Node server on :4399 with a stub `window.vscode` and `window.ptahConfig` injected into index.html (server killed afterwards).
- State injected through Angular dev APIs (`ng.getComponent(ptah-chat-view)._tabManager.updateTabInternal`) with a `SessionBudgetState`, with and without `rotation`. The webview-e2e-harness scenarios use mock HTML, so they cannot render the real banner; no e2e run was made and no baseline PNG was touched (`git status` shows none modified).
- 360 px was rendered in a 360x760 same-origin iframe, because the browser tool has no viewport resize. Audit selection, not a support contract.
- Themes: `anubis` (dark) and `anubis-light`, switched by `data-theme`.

## BEFORE baseline used

The tighten render on the current code. `git diff 492b0762c` of the banner file shows that the tighten block (the `OK` and `Restore auto-compact` buttons, `border-info` class and tighten title and body) is unchanged. The changes are the added `rotation` branch, the `border-info` condition, the preview guard, and the `rotate` output, keep set and effect.

- `screenshots/batch-31/before-tighten-dark-1920.jpg`
- `screenshots/batch-31/before-tighten-light-1920.jpg`

## AFTER

- `after-rotation-dark-1920.jpg`, `after-rotation-light-1920.jpg`
- `after-handoff-hides-rotation-dark-1920.jpg`: stage `handoff` with `rotation` present shows "Time to hand off this session"; rotation is hidden.
- `after-rotation-dark-360.jpg`

## Findings

### Serious

#### S1. Primary "Rotate session" focus ring is nearly invisible in the light theme

- File: `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:76` (`btn btn-xs btn-primary`)
- Viewports: all, light theme `anubis-light`
- Evidence: DaisyUI `.btn:focus-visible` is `outline 2px solid`, offset 2px, and the outline colour is the button's own `oklch(0.85 0.138 181)` teal. Measured against the banner background, the ring contrast is 1.27:1, below the 3:1 non-text criterion (WCAG 1.4.11 and 2.4.11). In dark it is 4.4:1 (pass). "Keep this session" (ghost) is 14.4:1 in both themes.
- Caveat: a real Tab key press could not be sent. The ring was measured from the computed `outline-color` and the `.btn:focus-visible` rule, and `:focus-visible` itself was not confirmed visually.
- Impact: a keyboard user in the light theme cannot see when "Rotate session" has focus.
- Note: the existing handoff and limit `btn-primary` buttons in the same banner share this behaviour, so it comes from the theme and is not new to this batch. It is still visible in the new variant.
- Fix: a shared rule such as `.btn-primary:focus-visible { outline-color: <contrasting token> }` for the light theme. This is not a blocker for the batch.

### Moderate

#### M1. Rotation suppresses the tighten buttons

- File: `session-budget-banner.component.ts:216-233`; the report already records this.
- When `rotation` is present and the stage is `tighten`, only "Rotate session" and "Keep this session" appear. "OK" and "Restore auto-compact" are unreachable until Keep is clicked or rotation clears. Verified: after Keep, the tighten banner returns. The user can still reach everything; it only adds a click. Ask the product owner whether this is intended.

## Checks

| Check | Result |
| --- | --- |
| `role="status"` | Present on rotation (`limit` keeps `role="alert"`, verified). |
| Priority | `handoff` hides rotation (screenshot); `limit` hides rotation (title "This session reached its budget", `role=alert`); `tighten` plus rotation shows rotation. |
| Keep behaviour | Hides rotation and the tighten banner shows. Rotation cleared, then a new crossing, shows rotation again. |
| Keyboard order (DOM) | Rotate session, then Keep this session, then composer textarea. Logical. |
| Button contrast (text) | Rotate 6.81:1 (light); Keep 14.44:1 (both). The dark Rotate text value came back identical to light, probably read mid-transition; the screenshot shows white on blue, which is clearly sufficient. |
| Body text | 5.48:1 (12px, muted). Title 14.44:1. Banner border 2.59:1 (decorative, text carries the meaning). |
| Target size | 90x24 and 103x24 CSS px; meets WCAG 2.2 AA 24x24 (no spacing needed). Below the 44px vendor guidance, same as the other stages. |
| Layout shift | The composer top is 935.5 px in tighten and 935.5 px in rotation (banner 78 px in both), so there is no shift when moving tighten to rotation. The banner naturally pushes the composer when it first appears, as with the existing stages. |
| Overflow at 360 px | `documentElement.scrollWidth` 360 (no horizontal scroll). The banner is 296 px wide, the body wraps to 5 lines and both buttons fit on one row (right edge 236). Height 142 px, about 19% of a 760 px viewport. |
| Dark and light parity | Both fine; borders use `border-info`. |

## Prototype fidelity

No `prototype/` folder was checked. The before and after comparison above is the fidelity check. Result: no regressions to the tighten, handoff or limit rendering; the only visual change is the new variant.

## Not covered

- A real Tab key press (the tool sends no key events). Rotate and Rotate click paths (RPC and composer prefill) were not exercised in the browser; they are backend and handler behaviour, covered by the unit specs in the batch report.
- 360 px in light, and tablet widths.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM
- Key concern: the light-theme focus ring on "Rotate session" (S1, 1.27:1) is a theme-wide DaisyUI issue and not a rotation defect. The tighten-suppression behaviour (M1) needs a product decision.
