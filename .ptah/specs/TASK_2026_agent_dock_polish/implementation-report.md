# Agent dock polish implementation report

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:71` filters `done` and `stopped` agents out of the inline row while retaining the orchestrator and selected agent. `:102` applies that rule before the small-roster shortcut and keeps both pinned agents at zero measured width. `:89` supplies stable status ordering for the menu.
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:99` renders the status-ordered list; `:221` uses the same order for keyboard navigation.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:100` adds a low-opacity, theme-token left-to-right gradient behind chips. `:142` adds `pt-1` above the chat dock; `:145` retains `pb-0.5` and restores the original `shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]` class; `:225` renders the menu only when agents are hidden. The glass-on override still sets `box-shadow: none` under its original media conditions.
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.spec.ts:44` covers finished agents in small rosters, pinned agents at zero width, and stable menu status order.
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow-duration.spec.ts:21` keeps the capacity threshold fixtures active under the new finished-agent rule.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:241` updates menu visibility, small-roster finished-agent, padding, and menu keyboard expectations.
- Review follow-up: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:273` freezes visible chip keys during dock focus; `:403` and `:552` recover focus to a remaining tab when its chip disappears; `:397` closes a card whose chip is no longer visible. `:508` releases the frozen set when focus leaves the dock, so finished agents move into the menu then.
- Review follow-up: `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:47` removes the unreachable Users-icon branch; `:67` and `:149` show and announce the hidden-agent count. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:422` covers focus retention, reverse arrow navigation, focus recovery, card cleanup, and the trigger count.
- Round 2: `canvas-lane-tabs.component.ts` tracks pointer and keyboard input so a pointer click releases any chip freeze, while keyboard focus retains stable arrow navigation. Waiting and failed agents join the inline chips even during a freeze. Focus entering the menu trigger or a menu row clears the remembered chip, preventing later focus recovery from pulling focus back. The component spec covers pointer focus, keyboard focus, new attention states, and the menu focus transition.

## Decisions

| Decision | Options | Evidence |
| --- | --- | --- |
| Sort all menu entries by status while retaining dock order for ties | Keep kind sections; status sections; flat status list | Kind sections would put finished entries ahead of running entries across kinds. The flat list meets the requested global order and preserves the menu's radio-item keyboard model. |
| Filter finished agents before the small-roster shortcut | Filter after capacity planning; filter before planning | Filtering first sends terminal agents to the menu even at or below `DOCK_INLINE_MAX`. The orchestrator and selection remain pinned. |
| Put the gradient in component styles | Edit global `styles.css`; use the dock's component stylesheet | The dock root owns the effect. `oklch(var(--bc) / 0.07)` adapts to the theme; the gradient is a background layer behind text and remains visible when glass mode clears the dock's background color. The left edge fades to transparent by 80%. No hard-coded hex color was added. |

## Verification

- The Ptah skill inventory did not expose an invokable Angular skill. Read the workspace's `.claude/skills/angular-frontend-patterns/SKILL.md` directly before this edit.
- `npm run verify -- -p @ptah-extension/canvas`: first run had 2 of 3 targets pass; the test target failed because an existing menu keyboard fixture had no hidden agent after the new visibility rule. Updated the fixture to include a finished agent. Second run passed all 3 targets (lint, test, typecheck), exit code 0. After restoring the shadow class, reran the same command: 3 of 3 tasks succeeded (lint, test, typecheck), exit code 0.
- After the review fixes, `npm run verify -- -p @ptah-extension/canvas` passed all 3 targets (lint, test, typecheck), exit code 0. It waited 589 seconds for a verify slot held by other worktrees, then ran in 58.8 seconds. The new component specs cover all four findings.
- `ptah_get_diagnostics` scoped to the six changed TypeScript files: no errors in requested files. It also reported 10 errors in unchanged sibling files; those did not fail the prescribed canvas verify command.
- Browser preview from the in-workspace webview `index.html` with sample dock markup and the gradient/padding rule: screenshots inspected in light and dark sample themes. The gradient is strongest on the left and chip text remains readable. For the shadow fix, inspected a second sample screenshot and computed styles: glass off resolved to `rgba(0, 0, 0, 0.45) 0px 6px 8px -6px`; glass on resolved to `none`. The component's glass override block is unchanged from main. These were CSS previews, not the running Angular application.
- Inspected a browser preview of the updated `3 more` trigger next to dock chips. The text remained readable against the existing gradient and shadow. This used sample markup, not the running Angular application.
- Round 2: `npm run verify -- -p @ptah-extension/canvas` first ran lint and typecheck successfully, with one new test failing because its CLI fixture used a raw `waiting` status. The roster derives `waiting` from an open permission request; after correcting the fixture, the same command passed all 3 targets (lint, test, typecheck), exit code 0. The rerun waited 61 seconds for a memory slot and completed in 106.9 seconds after acquiring it.

## Not done

- No Electron runtime screenshot: the task disallows build, serve, and e2e targets. No requested file outside the canvas component and spec scope needed editing.
