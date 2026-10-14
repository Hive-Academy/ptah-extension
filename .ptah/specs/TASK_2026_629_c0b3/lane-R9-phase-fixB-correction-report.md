# Lane R9 phase fix B: post-cap correction report (decision row 109)

Writer: Claude. Scope: finding 1 in `codex-review-R9-phase-fixB.md`, "## New findings" (Serious). I started from the uncommitted fix A and fix B changes and reverted none of them. I did not touch `libs/frontend/canvas/*` or `libs/frontend/tribunal-panel/*`.

## Changes

| Finding | Fix | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- | --- |
| 1 (Serious): under `HIDE_AGENT_SIDEBAR` the dock label reads "Agents (0)", but the dock still mounts `AgentMonitorPanelComponent`. The monitor reads workflow and session `SubagentRecord`s from `AgentMonitorStore` itself and renders panelist tiles. | New `hideAgents = input(false)` on `DisplayDockComponent`. When it is true, the Agents tabpanel renders only an empty state ("No agents in this session", `data-testid="display-dock-agents-hidden"`) and never mounts the monitor, so the store's subagent selectors are never read. The tablist, both tabpanels, the label and the Displays tab are unchanged. | `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:203-220` (template), `:240-245` (input) | `display-dock.component.spec.ts:374` "shows no workflow or session subagent tiles and keeps the displays": the real dock with the real monitor import, and the store returns one workflow and one session subagent for `session-1`. With `hideAgents` true: tab "Agents (0)", no monitor instance, `workflowSubagentsForSession` and `sessionSubagentsForSession` never called, the Agents tabpanel is visible with the empty state, no "Panelist" or "Panel run" text and no count badge. Displays: the dock is open, "Displays (1)", and the panel has 1 surface. | pass |
| 1: token absent, no behaviour change | Default `false`: the same monitor mounts with the same bindings as before | same | `display-dock.component.spec.ts:394` "without the input, the same subagents still show (unchanged)": with the same store, `totalCount()` is 2, there is 1 workflow group and 1 session tile, no empty state, badge "2", and the display surface is still there | pass |
| 1: ChatView passes the token down explicitly | `[hideAgents]="hideAgentSidebar"` on `<ptah-display-dock>` | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:299` | `chat-view.dock.spec.ts:506` (the existing decision 77 case, extended at `:537-546`): with the token, the dock's `hideAgents()` is true, no `ptah-agent-monitor-panel` is inside the dock and the hidden empty state shows. The case's existing display-surface assertions (open, update in place, one dock, "Agents (0)") still pass. `chat-view.dock.spec.ts:549` "without HIDE_AGENT_SIDEBAR the dock mounts its monitor with the agents": `hideAgents()` is false, there is no hidden empty state, "Agents (1)" shows, and the monitor gets the running agent. | pass |
| 1 (same hole, other path): if the dock chunk fails to load, the `@error` fallback mounts the monitor, which would show the same store subagents under the token | The fallback monitor is wrapped in `@if (!hideAgentSidebar)`. The "Display panel failed to load" alert still shows. | `chat-view.component.html:314-324` | `chat-view.dock.spec.ts:892` "HIDE_AGENT_SIDEBAR: the alert shows and no fallback monitor mounts": the alert text shows and no `ptah-agent-monitor-panel` is rendered. The existing failure cases (`:828`, `:870`) still pass without the token. | pass |

## Tests

All runs went through the machine-wide lock, from W, one at a time.

- `node .ptah/tmp/check-run.mjs phaseB-corr-5 -- npx nx test @ptah-extension/chat --testFile=display-dock.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       24 passed, 24 total`
- `node .ptah/tmp/check-run.mjs phaseB-corr-6 -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       28 passed, 28 total`
- `node .ptah/tmp/check-run.mjs phaseB-corr-7 -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       9 passed, 9 total`
- `ptah_get_diagnostics`, scoped to the dock component, the dock spec and `chat-view.dock.spec.ts`: no diagnostics in the requested files. It reported pre-existing sibling-file spec errors, so this is not a project-wide clean result.

Superseded runs (first approach, see Decision 1):

- `phaseB-corr-1`: dock 24/24.
- `phaseB-corr-2`: chat dock 27/27.
- `phaseB-corr-3`: `agent-monitor-panel.component.spec.ts` 30/30.
- `phaseB-corr-4`: keepalive 6 failed, 3 passed. The cause was NG0303: "Can't bind to 'hideAgents'" on the keepalive spec's own monitor stub.

I did not run typecheck or lint, as the brief scoped them out.

## Decisions

1. **I chose not to mount the monitor rather than add a monitor input.** First I implemented the reviewer's suggested chain: ChatView, then the dock, then a `hideAgents` input on `AgentMonitorPanelComponent` that empties `effectiveAgents`, `effectiveWorkflowSubagents`, `effectiveSessionSubagents` and `sessionSubagents`. It passed the dock, chat dock and monitor specs. It failed `chat-view.keepalive.spec.ts`, because that spec's `ptah-agent-monitor-panel` stub has no `hideAgents` input (NG0303). Fixing it needs an edit to a file outside my scope. Every other host's monitor stub would also need the input.

   The brief allows the "do not mount" variant when it is smaller. Here it is smaller:
   - the monitor is unchanged; I reverted my edits and `git diff` on it is empty;
   - no stub anywhere needs a new input;
   - with nothing mounted, no store read can leak a tile, which is a stronger guarantee than emptying four selectors.

   The explicit `hideAgents` input still flows from ChatView into the dock, as the reviewer asked.
2. **The dock's tab behaviour is unchanged.** Both tabs, both always-present tabpanels, roving tabindex, the arrow, Home and End keys, the labels and pin and close are untouched. Only the content inside the Agents tabpanel differs. The empty state copies the monitor's docked empty-state text and classes ("No agents in this session", `text-sm text-base-content-muted`, centred, `h-32`). The tabpanel is therefore never blank, and it reads the same as a session with no agents.
3. **The dock label still counts `agents()`.** ChatView's `sessionAgents` is already `[]` under the token (fix B), so the label reads "Agents (0)" and the running suffix is absent. I did not add a second gate in the dock. ChatView is the only host of the dock, and the single source for the count stays where fix B put it.
4. **The `@error` fallback is gated too.** This edit goes slightly beyond "binding only" in the HTML: I wrapped the fallback monitor in an `@if`. Without it, a dock chunk failure in the conductor would mount the store-reading monitor and reopen the same hole. The edit is one control-flow line around existing markup and has its own spec case.
5. **There is no behaviour change for other hosts.** The input defaults to `false`. Only the conductor provides `HIDE_AGENT_SIDEBAR` (decision 108, grep). The token-absent cases and the keepalive Rail cases pass unchanged.
6. **The hidden case uses the real monitor import.** The dock spec mounts the real `AgentMonitorPanelComponent`, with only the display panel stubbed. With the token the case checks that the monitor is absent and that neither store selector is called. With the input absent, the same store data renders 2 agents. The case can therefore not pass vacuously.

## Changed files (this correction)

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\organisms\display-dock\display-dock.component.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts

I changed neither `chat-view.component.ts` nor `agent-monitor-panel.component.ts` in this correction. The `chat-view.component.ts` diff in the tree is fix B's.
