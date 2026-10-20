# Visual Review (removals + merged layout) - TASK_2026_685_64f4

Verdict: NEEDS_REVISION (score 6/10). No visual-breaking issue. One serious defect: the chat column edges are not shared (user request item 4).

Environment: Electron dev app running from the worktree (commit 0364cd6d9), reached through CDP at 127.0.0.1:9370. I did not build or restart anything. Workspace qa3elhamor, session tile 10. Viewport emulation was done with `page.setViewportSize` (1440x900 and 760x900). Light theme was forced by setting `data-theme="anubis-light"` on `<html>` (dark = `anubis`). The theme toggle UI was not used, so a few chrome colours in the light shots (top tabs, rail tiles) may not match a real theme switch. I judge no theme contrast from them.

Screenshots are in `.ptah/specs/TASK_2026_685_64f4/screenshots/removals/`.

## Shots

| #   | Shot                                                                          | Status       | File / reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Background-agent strip action menu, dark + light, 1440                        | NOT captured | The strip row menu (`agent-strip-menu-trigger`) renders only when a row has an action (steerable, canBackground or stoppable). I had one allowed chat. Its sub-agent finished in 7s ("sleep 120" was blocked by the Bash tool), so every row was "done" and there was no menu trigger (`[data-test="agent-strip-menu-trigger"]:visible` count = 0). Sessions 9 and 10 only had completed agents. Static check: `grep -i "view transcript"` over `libs/frontend` finds only a stale JSDoc line (D3). The template offers only Steer, Send to background and Stop (`background-agent-strip.component.ts:323-361`). |
| 2   | Session inspector agent actions menu, dark + light, 1440                      | NOT captured | Same cause. The inspector AGENTS row for the finished sub-agent shows no `Actions for ...` button (count 0). The menu items come from `menuItemsFor` (`inspector-agent-actions-menu.component.ts:32-45`), which has only steer, background and stop. No transcript item exists in source.                                                                                                                                                                                                                                                                                                                        |
| 3a  | Canvas sub-agent lane (store-backed `ptah-subagent-lane`), dark + light, 1440 | Captured     | `canvas-subagent-lane-dark-1440.png`, `canvas-subagent-lane-light-1440.png`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3b  | Canvas orchestrator lane, dark + light, 1440                                  | Captured     | `canvas-orchestrator-lane-dark-1440.png`, `canvas-orchestrator-lane-light-1440.png`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | Centered chat column, dark + light at 1440 and 760                            | Captured     | `centered-column-{dark,light}-{1440,760}.png`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Shot 3 measurements (1440x900, same in dark and light):

- Sub-agent lane: `ptah-canvas-lane-view` spans y=168 to 900, x=88 to 1088. This equals its parent, so it fills the panel height. The host has the single `overflow-auto`. The only other overflow-auto element is the inner `ptah-markdown-root` (66/66, no scroll). That is one effective scroller, PASS. The content was short, so I did not see the scroller overflow.
- Orchestrator lane: lane y=168 to 900. The transcript scroller (`.chat-scroll-container`, 542px client / 1208px scroll height) is the only scrolling element. The transcript keeps the full height, PASS.

## Width measurements (item 4)

x values in CSS px. The scroller is `.chat-scroll-container`. Margins are measured to the scroller edges. Equal means left and right margins are within 2px.

| Viewport | Element                              | left x | right x | left margin | right margin | Equal (2px)                    |
| -------- | ------------------------------------ | ------ | ------- | ----------- | ------------ | ------------------------------ |
| 1440     | scroller                             | 88     | 1088    |             |              |                                |
| 1440     | `.chat-scroll-content`               | 209    | 967     | 121         | 121          | yes                            |
| 1440     | user bubble `.chat-bubble`           | 327.7  | 955     | 239.7       | 133          | NO (right-aligned, 627px wide) |
| 1440     | assistant "Worked" header row        | 222    | 959     | 134         | 129          | NO (5px off)                   |
| 1440     | composer `form.chat-composer-column` | 209    | 967     | 121         | 121          | yes                            |
| 760      | scroller                             | 88     | 684     |             |              |                                |
| 760      | `.chat-scroll-content`               | 110    | 662     | 22          | 22           | yes                            |
| 760      | user bubble                          | 171.2  | 650     | 83.2        | 34           | NO (right-aligned, 479px wide) |
| 760      | assistant "Worked" header row        | 118    | 654     | 30          | 30           | yes                            |
| 760      | composer                             | 100    | 672     | 12          | 12           | yes                            |

Dark and light gave identical numbers.

Result: FAIL for "same width". Each element is centered on its own, except the user bubble. The widths differ:

- 1440: composer 758px, Worked row 737px, bubble 627px.
- 760: composer 572px, Worked row 536px, bubble 479px.

At 1440 the Worked row sits 13px in from the content's left edge and 8px from its right edge. The composer is 21px wider than the Worked row at 1440 and 36px wider at 760. The bubble is capped at about 85% of the turn width (`max-w-[85%]`) and hugs the right edge.

## Defects

- D1 (Serious): the user bubble, the assistant turn header row and the composer do not share one width or the same left/right edges. See the table above. Evidence: `centered-column-dark-760.png` (the composer visibly overhangs the Worked row and the bubble is offset right) and `centered-column-dark-1440.png`.
- D2 (Moderate): at 1440 the Worked header row is off-center by 5px (left inset 13, right inset 8). Its inset is symmetric (8/8) at 760. Evidence: `centered-column-dark-1440.png`.
- D3 (Minor): the doc comment at `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:139` still says the menu has "view transcript / steer /...". Code only, no UI impact.
- D4 (Moderate, pre-existing behaviour, not confirmed as a regression): in an old session turn, clicking the sub-agent card's open arrow shows the tooltip "This agent is not available yet." (`canvas-detail-transcript.component.ts:92`). The earlier run's agent has no lane. Opening the same sub-agent from the strip popover works (shot 3a). I took no screenshot of the tooltip.

## Not verified

- Shots 1 and 2 are the main gap. They need a run with a live (running) background sub-agent. A re-run with one more chat that keeps a sub-agent running, for example a Task that spawns an agent doing a Read-heavy job or a background Bash, would let me capture both.
- Scroller behaviour of the sub-agent lane with overflowing content was not exercised.
