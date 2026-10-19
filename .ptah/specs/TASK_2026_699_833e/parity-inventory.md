# Parity Inventory - TASK_2026_699_833e

Revision: 2 (PLAN LIMITS rows split out and restyled as cards, requirement 7)

Surface replaced/rebuilt: "This session" inspector as hosted by the full main chat panel —
`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:283-317` (`.cs-inspector`),
`libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts`,
`libs/frontend/chat/src/lib/services/session-inspector/inspector-open-state.service.ts`,
`libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.{ts,html}`.

Paths below are relative to `libs/frontend/`. "No spec today" means the capability has no test and
the new test listed must be written.

No RPC is called by the shell, open-state or host code; the sections read frontend stores that
already own their backend calls (listed in the RPC column).

## Open / close

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Header icon toggle opens/closes (`aria-pressed`, `aria-controls="inspector"`, label Show/Hide session details) | chat/.../molecules/session-header/session-header.component.ts:171-200; chat-view.component.html:32-45 | none (emits `inspectorToggled` → `shell.toggle()`) | keep | unchanged; kept in sync with the new tab | chat-view.component.spec.ts (extend: header + tab show same state) |
| Toggle label Show/Hide session details | inspector-shell.controller.ts:32-33,157-159 | none | keep | unchanged | new inspector-shell.controller.spec.ts |
| Closed-state dot `need`/`sel` + `limitAwareDot` (`err`) | inspector-shell.controller.ts:148-154; chat-view.component.ts:1143-1149 | `SessionInspectorStore.needsYouCount`; stats `limitSummary` | keep | header unchanged; mirrored as tab `badgeType` | new controller spec + chat-view spec |
| Context ring and limit cue on closed toggle, `aria-describedby` toggle description | session-header.component.ts:169-198,249-255; chat-view.component.ts:1151-1168 | session stats source | keep | unchanged | existing session-header behaviour; chat-view spec |
| Close button "Close session details" (`data-inspector-close`) | session-inspector.component.html:15-24 | none | keep | unchanged | chat-view spec (close returns focus) |
| Docked default-open rule: `initialOpen ?? mode === 'full'`; workflow tabs open by default | inspector-open-state.service.ts:35-43; inspector-shell.controller.ts:116-137 | `TabManagerService` | keep | unchanged | new controller spec |
| Per-tab, per-view-mode docked choice, in memory, forgotten on tab close | inspector-open-state.service.ts:17-60 | `TabManagerService.onTabClosed` | keep | unchanged (persisting it is out of scope) | new inspector-open-state.service.spec.ts |
| Compact mode removes the open inspector; full mode restores it | chat-view.component.ts:1102-1105 | none | keep | unchanged | chat-view.component.spec.ts:2470 |
| Forced card does not toggle | chat-view.component.ts:1102-1105 | none | keep | unchanged | chat-view.component.spec.ts:2494 |
| No inspector, header or shell attach in tiles / `'bare'` embeds | chat-view.component.ts:1093-1105,1375 | `SESSION_EMBED_CHROME` | keep | unchanged; also no tab/handle | chat-view spec (extend: no tab in tile/bare) |
| Lane open from an agent row closes a sheet, keeps a dock open | chat-view.component.ts:1005-1009 | `_cardActions.openLane` | keep | unchanged | chat-view spec (new case) |
| Sheet closes on tab or session switch | inspector-shell.controller.ts:161-169,256-264; chat-view.component.ts:984-991 | none | keep | unchanged | new controller spec |
| (new) Vertical `ptah-sidebar-tab` opener | — | none | — (added) | chat-view.component.html right edge | chat-view spec (new) |

## Presentation modes and width

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Band detection via ResizeObserver on `.cs-shell`: docked >= 960, sheet 640-959, full-sheet < 640; zero width keeps last band; no ResizeObserver → docked | inspector-shell.controller.ts:22-25,46-50,194-214,312-316 | ResizeObserver | keep | unchanged thresholds | new controller spec |
| Docked presentation: `<aside aria-label="This session">`, fixed 336 px, border-left, in flow | session-inspector.component.html:5-9; chat-view.component.css:17-26 | none | keep (width becomes variable) | same element; width from the new clamped/persisted state | chat-view spec + visual review 1440 |
| Sheet presentation: `role="dialog" aria-modal="true"`, absolute right, `min(336px,100%)`, z-30, raised shadow | session-inspector.component.html:1-4; chat-view.component.css:28-35 | none | keep | unchanged | new controller spec + visual review 760 |
| Full-width sheet below 640 px | chat-view.component.css:37-40; chat-view.component.html:299 | none | keep | unchanged | new controller spec + visual review 760 |
| Embedded presentation (Rail board) | canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:203,259 | none | keep (out of scope) | unchanged | canvas-rail-board.component.spec.ts |
| Rail board compact sheet | canvas-rail-board.component.ts:268 | none | keep (out of scope) | unchanged | canvas-rail-board.component.spec.ts:1516 |
| Scrim under the sheet, click closes, `aria-hidden` | chat-view.component.html:286-293; chat-view.component.css:43-48 | none | keep | unchanged | chat-view spec |
| Main column `inert` while modal | chat-view.component.html:4-7; inspector-shell.controller.ts:139-145 | none | keep | unchanged (tab must also be unreachable) | new controller spec + chat-view spec |
| Band change docked→sheet closes sheet, keeps docked choice, moves focus only if lost | inspector-shell.controller.ts:318-330 | none | keep | unchanged | new controller spec |
| Band change sheet(open)→docked keeps it open by writing the docked choice | inspector-shell.controller.ts:331-338 | none | keep | unchanged; docked at stored/default width | new controller spec |
| Entrance animation `csInspectorIn` 220 ms; disabled under reduced motion | chat-view.component.css:24,50-59,197-200 | none | keep | unchanged; also suppressed while dragging | visual review |
| Lazy `@defer (on immediate)` load with same-size placeholder | chat-view.component.html:294-316 | none | keep | placeholder uses the same variable width | chat-view spec |
| Existing width / persistence logic for the inspector | none — fixed 336 px CSS, nothing persisted | — | — (added) | new clamped, persisted width state | new specs per AC 3.1-3.6 |

## Focus and keyboard

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Opening the sheet focuses the close button, including late mount from the deferred chunk (`closeReady`) | inspector-shell.controller.ts:227-235,266-274,340-349; session-inspector.component.ts (effect on `closeButton`) | none | keep | unchanged | new controller spec |
| Tab/Shift+Tab trapped in the sheet; Escape closes unless `defaultPrevented` | inspector-shell.controller.ts:276-310 | none | keep | unchanged | canvas-rail-board.component.spec.ts:1516 (Rail); new controller spec (chat-view) |
| Close restores focus: target → remembered opener → header toggle → session title, never `body` | inspector-shell.controller.ts:237-254,351-376; chat-view.component.ts:996-1000 | none | keep (extend opener to the tab) | unchanged routine; opener = whichever control opened it | chat-view spec (new: tab opener) |
| Answer button focuses the question card | chat-view.component.ts:1016; chat-view.component.html:308 | none | keep | unchanged | chat-view.component.spec.ts:630-670 |
| Polite live region for request outcomes | session-inspector.component.html:79 | none | keep | unchanged | inspector-agents-section.component.spec.ts |

## Sections inside the inspector (reflow only, except PLAN LIMITS: restyled as cards)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Header "This session" | session-inspector.component.html:12-13 | none | keep | unchanged | visual review |
| Orchestrator card | session-inspector.component.html:30-37; inspector-orchestrator-card.component.ts | `SessionInspectorStore` | keep | unchanged | visual review |
| `[inspectorSection]` add-on slot | session-inspector.component.html:39 | `SESSION_WORKFLOW_ADDONS` | keep | unchanged | visual review |
| SESSION stats | session-inspector.component.html:41-49; chat-ui/.../inspector-session-stats.component.ts | session stats source | keep | unchanged | inspector-session-stats.component.spec.ts |
| AGENTS rows, actions menu, request panel | session-inspector.component.html:51-61; inspector-agents-section / inspector-agent-actions-menu / inspector-request-panel | `SessionAgentTrayService`, `ModelStateService`, `AgentPermissionResponder`, `PermissionHandlerService`, `AgentMonitorStore` | keep | unchanged | inspector-agents-section.component.spec.ts |
| PLAN LIMITS section (heading, refresh notice, shared caption + source chips, tile grid) | session-inspector.component.html:63-70; chat-ui/.../inspector-stats/inspector-limits-lanes.component.ts:20-46 | stats `limits` | keep, restyled | same component; grid holds cards | visual review (AC 6.2) |
| LANES section (lane tiles, subtotal, caption) | inspector-limits-lanes.component.ts:48-60+ | stats `limits` | keep | unchanged | visual review |
| TASK | session-inspector.component.html:72; inspector-task-section.component.ts; session-task-reader.ts | `ChatStore`, `TasksChangedFeed`, `FILE_LINK_OPENER` | keep | unchanged | session-task-reader.spec.ts |
| TODOS | session-inspector.component.html:74; inspector-todos-section.component.ts | `TabManagerService` | keep | unchanged | visual review |
| GIT | session-inspector.component.html:76; inspector-git-section.component.ts | `SessionGitStatsStore`, `ChangeSetActionsService` | keep | unchanged | visual review |
| Row entrance stagger (`st-r`, `--i`) | session-inspector.component.html:30-76 | none | keep | unchanged | visual review |

### PLAN LIMITS window tile (`ptah-plan-limit-tile`, `variant="inspector"`)

Paths relative to `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/`.

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Inspector face: bordered `bg-surface-1` row, tone accent (`planRowClass`) | plan-limit-tile.component.ts:189-191 | none | keep, restyled | card container, same tone accent | plan-limit-tile.component.spec.ts (new: inspector card) |
| Label (truncate, `title`) | plan-limit-tile.component.ts:58-62 | none | keep, restyled | card header row, left | spec (new: header row) |
| State chip with glyph ("? Usage unknown", "50% used"), glyph `aria-hidden` | plan-limit-tile.component.ts:107-117 | none | keep, restyled | card header row, right | plan-limit-tile.component.spec.ts:91,214 |
| Expand chevron up/down, `aria-hidden` | plan-limit-tile.component.ts:146-152 | none | keep, restyled | card header row, right of chip | plan-limit-tile.component.spec.ts:214 |
| Status text `value · resetLine`, `title` = detail lines (`plan-limit-status`) | plan-limit-tile.component.ts:63-69,195-197 | none | keep, restyled | own full-width row | plan-limit-tile.component.spec.ts:163 + new full-row case |
| Progress bar (`role="progressbar"`, aria value/label, severity fill, never for unknown) | plan-limit-tile.component.ts:70-87,203-215 | none | keep, restyled | own full-width row with value | plan-limit-tile.component.spec.ts:107,127,261 |
| Value text (`plan-limit-tile-value`) | plan-limit-tile.component.ts:88-105 | none | keep, restyled | center row | plan-limit-tile.component.spec.ts:91 |
| Reset line under the bar (`pl-[4.5rem]` indent) | plan-limit-tile.component.ts:119-124 | none | keep, restyled | center row, no label indent | spec (new) |
| Own caption (truncated closed, `title`) and own source chips ("Live event", "Provider API"); omitted when section header shows them | plan-limit-tile.component.ts:125-145,198-201 | none | keep, restyled | inside card under center row | plan-limit-tile.component.spec.ts:144,189 |
| Disclosure: whole face is a button, `aria-expanded`/`aria-controls`, disabled for `status`/`local-usage`, `toggled` output, host-owned open state | plan-limit-tile.component.ts:47-56,192-194; inspector-limits-lanes.component.ts:41-43 | `StatsTileExpansionState` | keep | unchanged | plan-limit-tile.component.spec.ts:70,84,225 |
| Detail panel (`plan-window-detail`, detail lines), `hidden` while closed | plan-limit-tile.component.ts:154-168 | none | keep | unchanged content, inside card | plan-limit-tile.component.spec.ts:237,246,318 |
| `data-tile-id`, `data-testid` hooks | plan-limit-tile.component.ts:43,54 | none | keep | unchanged | webview-e2e-harness plan-limits-visual.e2e.spec.ts:156-167 |
| `strip` variant in the session stats card | session-stats-summary.component.html:442-448 | none | keep | unchanged (not restyled) | session-stats-summary.component.spec.ts:900; plan-limit-tile spec (strip case) |

## Proposed Removals

- None.
