# PR #889 CodeRabbit fix report

| Comment id | Path:line | Verdict | Change or reason | Test added |
| --- | --- | --- | --- | --- |
| 4438569978 | `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts:138` | CONFIRMED | Restored singular grammar and spoken waiting/failed counts in the overflow trigger label. | `agent-dock-menu.component.spec.ts`: single waiting agent and updated mixed-status label; updated parent component label assertions. |
| 4438569992 | `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:94` | CONFIRMED | Adds a newly selected agent to frozen candidates before slot selection, retaining the five-chip cap. Pointer clicks still do not freeze the dock. | `dock-overflow.spec.ts`: hidden selection while focus is frozen at five and one slots. |
| 4438570004 | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:230` | CONFIRMED | Keeps Finished cards mounted but visually hidden while collapsed so `railState` continues to emit; only visible cards suppress request snackbars. | `canvas-rail.component.spec.ts`: collapsed Finished card emits state and its request remains available; updated collapse visibility assertion. |
| 4438570010 | `libs/frontend/chat-ui/src/lib/molecules/vitals/progress-ring.component.ts:130` | CONFIRMED | Separates the indeterminate pulse and checking subtext vertically. | `progress-ring.component.spec.ts`: checking text and indeterminate placement rules. |
| 4438570016 | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html:32` | CONFIRMED | Adds first-item focus, Arrow/Home/End navigation, and outside pointer/focus dismissal to the menu. | `inspector-session-actions.component.spec.ts`: keyboard navigation and both dismissal paths. |
| 4438570034 | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.html:65` | CONFIRMED | Cycles Tab and Shift+Tab within the rename form. | `inspector-session-actions.component.spec.ts`: both focus-wrap directions. |
| 4438570040 | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts:94` | CONFIRMED | Stops Escape propagation only when the open menu or rename dialog consumes it. | `inspector-session-actions.component.spec.ts`: open-menu, closed-trigger, and rename-dialog Escape. |
| 4438570051 | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts:122` | CONFIRMED | Focuses the rename input after Angular renders it via `afterNextRender`. | `inspector-session-actions.component.spec.ts`: input receives initial focus after render. |

## Verify result

`npm run verify -- -p @ptah-extension/canvas,@ptah-extension/chat,@ptah-extension/chat-ui` passed on the final run: exit code 0, all 9 Nx lint/test/typecheck tasks succeeded (3 cached). The first run failed only on outdated overflow-label assertions and a jsdom `PointerEvent` constructor; those test issues were corrected before the successful rerun.

The lane did not expose a skill-loading tool. No rendered app was available for a browser screenshot, and the lane forbids starting a serve target. The UI changes were checked through focused component tests and the scoped verification command.
