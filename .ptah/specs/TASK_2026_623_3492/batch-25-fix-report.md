# Frontend implementation — `TASK_2026_623_3492`, batch 25 fix (decision #109)

**Tasks completed**: Task 25.2 fix for decision #109. Batch 25 deviation 2 was not accepted because a failed dock chunk
left Electron with no agent monitor.

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
  - The dock's `@defer` `@error` block keeps the `role="alert"` line "Display panel failed to load".
  - While `panelOpen()`, the block also renders the eager `ptah-agent-monitor-panel`. It uses the VS Code branch
    bindings: `[embeddedAgents]="sessionAgents()"`, `[embeddedOpen]="panelOpen()"`,
    `[sessionId]="resolvedSessionId()"`, `[isOverlay]="isOverlay()"` and `(closed)="closeAgentPanel()"`. It is not
    in `docked` mode.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts
  - Imports `DeferBlockState`.
  - `mount()` takes an optional `deferBehavior`. The default stays `Playthrough`, so the existing cases are unchanged.
  - The ChatView override now also imports `StubAgentMonitorPanelComponent`, so the fallback's bindings can be read.
  - Adds `describe('dock chunk failure (decision #109)')` with two cases.

`chat-view.component.ts` was not touched: every binding the template needs already exists, and
`AgentMonitorPanelComponent` is already in ChatView's eager `imports` (line 215).

## Why this is a real fallback and cannot mount twice

- `@error` and the main `@defer` content are exclusive states of one defer block. When the dock renders, the
  `@error` content (alert and fallback monitor) does not exist. When `@error` renders, `ptah-display-dock` was never
  created.
- The fallback is the same component, with the same bindings, as the monitor that was mounted eagerly before this task:
  - Open and close: `embeddedOpen`, the toggle and `closeAgentPanel`.
  - Overlay: `isOverlay`. The toggle still hides while the overlay is open, and the monitor's own close button and
    Escape emit `closed`.
  - Separator: the dock separator stays in place while `panelOpen() && !isOverlay()`. It writes
    `PanelResizeService.customWidth`, and the non-docked monitor reads that value for its width
    (`agent-monitor-panel.component.ts:222-223`).
  - Permission queues stay reachable.
- Because `AgentMonitorPanelComponent` is a static import of ChatView, an `@error` block dependency does not depend on
  the failed lazy chunk.

## New spec cases (`chat-view.dock.spec.ts`)

1. **Falls back to the eager agent monitor beside the alert, and the toggle closes it.**
   - Setup: Electron, `DeferBlockBehavior.Manual`, host 1280 px. A running agent auto-opens the panel through the
     store. The dock defer block is rendered in `DeferBlockState.Error`.
   - The case asserts:
     - the alert has `role="alert"` and the text "Display panel failed to load";
     - there is no `ptah-display-dock`;
     - there is exactly one `ptah-agent-monitor-panel`;
     - the monitor's bindings are `docked=false`, `embeddedOpen=true`, `embeddedAgents=[agent-running]`,
       `sessionId='session-1'` and `isOverlay=false`.
   - Then it clicks the toggle and asserts: the store tab is closed, the alert is gone, the monitor is gone, and there
     is still no dock.
2. **The fallback monitor's `closed` output closes the panel.** This covers the monitor's own close and Escape path.
   It asserts that the store tab is closed and the monitor is gone.

## Decisions #81 and #94

- No change to `display-dock.state.ts` or any transcript file.
- Only the two files above changed in this fix.

**Stack observed**: Angular standalone components with signal inputs and outputs, and `@defer` control flow
(`chat-view.component.html`). Styling is Tailwind/daisyUI utility classes. Tests use Jest and Angular TestBed with
`DeferBlockBehavior` (`chat-view.dock.spec.ts`).

**Design fidelity**: No new markup or styling. The fallback reuses the monitor exactly as the VS Code branch mounts it.

**States covered**:

- Error state: the alert plus the working Agents monitor.
- Closed state: nothing rendered.
- Keyboard and overlay behaviour come from the existing monitor (close button, Escape) and the existing toggle and
  separator.

**Verification** (run through bash, with the `--moduleNameMapper` command-line override, no config change):

| Check | Command | Result |
|---|---|---|
| Batch 25 Jest set and agent-monitor-panel spec | `npx jest -c libs/frontend/chat/jest.config.ts …/organisms/display-dock …/templates/chat-view.dock.spec.ts …/templates/chat-view.component.spec.ts …/templates/chat-view.keepalive.spec.ts …/organisms/agent-monitor-panel --coverage=false --maxWorkers=2` | 6 suites passed, 145 tests passed. The first verification had 143; the 2 extra are the new cases. |
| ptah-ui Jest spec | `npx jest -c libs/frontend/chat/jest.config.ts execution-node.ptah-ui.spec.ts --coverage=false --maxWorkers=2` | 1 suite, 27 tests passed |
| Typecheck | `npx nx typecheck @ptah-extension/chat --parallel=1` | Passed. It exited 0 inside the `&&` chain, and the chain went on to lint. |
| Lint | `npx nx lint @ptah-extension/chat --parallel=1` | "Successfully ran target lint". 34 problems: 0 errors, 34 warnings, which is the baseline. `chat-view.dock.spec.ts` has no warnings. |

Lint ran twice. The first `| tail -n 8` cut off the problem count, so it ran once more filtered with `grep` for the
summary line. The Nx Cloud 401 notice ("organization disabled") appears on every run, does not affect the outcome, and
the tasks ran locally.

**Plan deviations**: None. The fix follows the #109 text.

**Out-of-scope observations**: None new.
