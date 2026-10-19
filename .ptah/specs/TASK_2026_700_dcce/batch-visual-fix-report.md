# Voice page visual correction

| Item | Result | File:line | Test |
| --- | --- | --- | --- |
| Page height | Layout fills its container with a flexible stage row; 600/570/500px minima remain. | `libs/frontend/command-center/src/lib/components/command-center-page.component.css:2` | `command-center-page.component.spec.ts:558` |
| Dock support row | Session live status and full Tribunal guidance sit below the controls in a compact, full-width row. Breakpoint and recovery rows were adjusted. | `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts:32`; `command-dock.component.ts:25` | `command-session-controls.component.spec.ts:26`; `command-dock.component.spec.ts:22` |
| Mute and Stop | Both use outlined buttons with a disabled border. Actions and disabled conditions remain unchanged. | `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts:53` | `command-voice-hud.component.spec.ts` |
| Delegated work rail | The rail, region, and work-list host form a flex column that stretches the card to the rail bottom, with scrolling inside the list. Below 720px the card keeps natural height. | `libs/frontend/command-center/src/lib/components/command-center-page.component.css:6` | `command-center-page.component.spec.ts:530` |

## Checks

1. `nx typecheck command-center`: passed.
2. `nx lint command-center`: passed, 0 errors and 0 warnings. The first attempt exited without diagnostics; a retry passed.
3. `nx test command-center`: 47 suites, 539 tests passed. Jest reported a worker exit warning after the pass.
4. `no-alpha-base-content.spec.ts`: 11 tests passed.

The Electron viewport was not remeasured in this lane, as directed; the orchestrator will measure the final heights.
