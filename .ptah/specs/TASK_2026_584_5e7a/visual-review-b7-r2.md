VERDICT: APPROVED

# Visual Review B7 - Round 2 (TASK_2026_584)

Score 9/10. All five checks pass in dark (`anubis`) and light (`anubis-light`). No new defect. One minor observation.

## Environment

- Rebuilt only the webview bundle from task-584 (`nx build ptah-extension-webview --configuration=development --output-path=D:/tmp/vr584/after`, exit 0). Source and git state untouched; no worktree created.
- Same harness as r1 (`visual-b7/r1/harness/lib.mjs`), VS Code-style host, 1400x700, tabs seeded in persisted state (child tab with `agentOrigin`, once inactive, once active, once with the parent gone). Screenshots: `visual-b7/r2/`. The driver for this round was D:/tmp/vr584/r2.mjs (not copied into the repo).

## Results

| Check                                       | Dark                                                                                                                                                                                                                                                                          | Light                                                                      | Evidence                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Hit area >= 24x24                           | 24 x 24 (icon 12 x 12)                                                                                                                                                                                                                                                        | 24 x 24                                                                    | `metrics-*` (button bounding box)                                        |
| Icon contrast >= 3:1, child tab inactive    | 13.74                                                                                                                                                                                                                                                                         | 15.01                                                                      | `s1-tabbar-*-child-inactive-1400.png`                                    |
| Icon contrast >= 3:1, child tab active      | 14.46                                                                                                                                                                                                                                                                         | 15.15                                                                      | `s1-tabbar-*-child-active-1400.png`                                      |
| Tab height unchanged                        | 34px for every tab, same as a plain (no badge) child tab at base state                                                                                                                                                                                                        | same                                                                       | measured height of each `ptah-tab-item` root, with and without the badge |
| Focus ring visible (real Tab key)           | gold 2px solid, 2px offset                                                                                                                                                                                                                                                    | same, 3.88:1 against the tab bar (dark ring 8.57:1 in r1, unchanged class) | `s3-focus-dark-1400.png`, `s3-focus-light-1400.png`                      |
| Tooltip on hover                            | shown, `role="tooltip"`, `aria-describedby` matches id, closes on leave                                                                                                                                                                                                       | same                                                                       | `s2-tooltip-hover-*-1400.png`                                            |
| Tooltip on keyboard focus, closes on Escape | shown with the ring, Escape removes it                                                                                                                                                                                                                                        | same                                                                       | `s3-focus-*-1400.png`                                                    |
| Tooltip removed when its tab closes         | tooltip count 1 before closing the child tab, 0 after; badge count 0                                                                                                                                                                                                          | same                                                                       | `s4-after-tab-closed-*-1400.png`                                         |
| Parent-gone dimmed state                    | opacity 0.6, `cursor: default`, `aria-disabled="true"`, label "Started by an agent session (parent tab closed)"; icon contrast after dimming 5.88:1; tooltip "Started by an agent session (parent tab closed) / feat/agent-auth-tests / ...\.worktrees\feat-agent-auth-tests" | same, 4.37:1 after dimming                                                 | `s5-parent-gone-*-1400.png`, `s5-parent-gone-tooltip-*-1400.png`         |

Parent-present `aria-label` is "Started by Parent: refactor auth". Contrast was measured canvas-composited against the tab backgrounds (no gradient in the background chain); the dimmed figures blend the icon at 0.6 opacity over that background.

## Observation (minor, not a defect)

The child tab's title is still ellipsised ("Agent: add auth ...") because the tab keeps its 200px cap: the plain tab was 188.8px wide with the full title, and the 24px badge now pushes it to the cap. The full title stays in the tab's `title` attribute, and the loss is 1-2 words, much smaller than in r1. No change required.

## Verdict

APPROVED, confidence HIGH for the rendered tab bar. Batch 9 smoke under a real host remains the only unverified item.
