# Batch 7 Report - TASK_2026_540_0940

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\canvas-orchestra.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\chat-code-edit.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\apps\ptah-electron-e2e\src\showcase\dashboard-tour.scene.ts`
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-540-global-config-menu\.ptah\specs\TASK_2026_540_0940\batch-7-report.md`

## Tasks 7.1-7.3

Paths below are relative to the worktree root. Line numbers refer to the edited files.

| Task | File:line | Old selector -> new selector |
| --- | --- | --- |
| 7.1 | `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:44` | tab `name: 'Canvas'` -> `name: 'Chat'` |
| 7.1 | `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:45` | button `name: 'Canvas'` -> `name: 'Chat'` |
| 7.2 | `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts:179` | tab `name: 'Canvas'` -> `name: 'Chat'` |
| 7.2 | `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts:180` | button `name: 'Canvas'` -> `name: 'Chat'` |
| 7.2 | `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts:181` | `[title="Orchestra Canvas"]` -> `[title="Chat"]` |
| 7.3 | `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:53` | tab `name: 'Dashboard'` -> `name: 'Analytics'` |
| 7.3 | `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:54` | button `name: 'Dashboard'` -> `name: 'Analytics'` |
| 7.3 | `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:55` | `[aria-label="Dashboard"]` -> `[aria-label="Analytics"]` |
| 7.3 | `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:56` | `[title="Dashboard"]` -> `[title="Analytics"]` |

Updated only the tab description in `chat-code-edit.scene.ts:15-16`: the global Chat tab hosts Orchestra Canvas. No `[title="Orchestra Canvas"]` selector existed in `canvas-orchestra.scene.ts`. Existing Canvas layout fallbacks, narration, JSON scripts, and on-screen headings remain unchanged. No files belonging to Batch 6 were edited. No git command was run.

Confirmed Electron titles in `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:130`, `:142`, `:153`, and `:164`, and the Chat reference selector in `apps/ptah-electron-e2e/src/support/ui-driver.ts:325-326`.

## Residual sweep

The "parallel lane" hits below were recorded before Batch 6 landed. The orchestrator reports that its re-run after both batches found no removed/renamed tab selectors left.

Searched all readable files under `apps/ptah-electron-e2e/src` and `libs/frontend/webview-e2e-harness/src`. Checked Canvas/Dashboard name selectors, Orchestra Canvas/Session Analytics title selectors, removed Thoth/Setup/Settings/Marketplace tab selectors, and old Tasks/Tribunal titles. The removed-tab expression also handles multiline calls. The two specified canvas headings were inspected separately.

| File:line | Hit | Classification |
| --- | --- | --- |
| `apps/ptah-electron-e2e/src/showcase/cron-tour.scene.ts:64` | `getByRole('tab', { name: 'Thoth' })` | parallel lane |
| `apps/ptah-electron-e2e/src/showcase/gateway-tour.scene.ts:86` | `getByRole('tab', { name: 'Thoth' })` | parallel lane |
| `apps/ptah-electron-e2e/src/showcase/marketplace-tour.scene.ts:97` | `getByRole('tab', { name: 'Marketplace' })` | parallel lane |
| `apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts:85` | `getByRole('tab', { name: 'Settings' })` | parallel lane |
| `apps/ptah-electron-e2e/src/showcase/setup-wizard-tour.scene.ts:49` | `getByRole('tab', { name: 'Setup' })` | parallel lane |
| `apps/ptah-electron-e2e/src/showcase/landing-page-tour.scene.ts:242` | `titleLoc(page, skills, 'Orchestra Canvas')` | expected heading |
| `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:199` | `name: 'Orchestra Canvas'` | expected heading |

No remaining `name: 'Canvas'`, `name: 'Dashboard'`, `title="Orchestra Canvas"`, or `title="Session Analytics"` matches. No hits in the webview harness. No unexpected hits.

The old titles were read from the unchanged VS Code template `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:428` (`Tribunal — multi-vendor panel`) and `:440` (`Tasks — .ptah/specs board`). Neither old-title selector was found; any such hit would be unexpected. Parallel-lane results are a historical snapshot taken while Batch 6 was in progress.

## Verification

Command: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e`

Result: **PASS**, exit code 0. Both scoped targets passed. No failures to attribute to Batch 7 or the parallel lane. No rerun was needed.

Tailed output (terminal symbols normalized):

```text
NX   Running targets typecheck, lint for project ptah-electron-e2e:
- ptah-electron-e2e

nx run ptah-electron-e2e:lint — passed
nx run ptah-electron-e2e:typecheck — passed

NX   Successfully ran targets typecheck, lint for project ptah-electron-e2e
Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.
View logs and investigate cache misses at https://nx.app/runs/qntqYQ5ur2
Run duration:      10.0s
Cache:             0/2 hit (0%)
Critical path:     10.0s (1 task)
Recoverable time:  <1ms
VERIFICATION_EXIT_CODE=0
```

Electron capture and Playwright runtime execution were not part of the requested verification. Branch guard git checks and reviewer gates in batches.md are assigned to the team leader; no git commands were run.

## Open issues

none

## Revision 1

- Updated only the comment at `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:41-42`: the global Chat tab opens the canvas grid; the remaining candidates are fallbacks. No executable code changed.
- Added the Residual sweep note identifying the parallel-lane hits as predating Batch 6 and recording the orchestrator's clean re-run after both batches.
- Edited only `canvas-orchestra.scene.ts` and this report. No git commands were run.

Verification command (run once): `npx nx run-many -t lint -p ptah-electron-e2e`

Result: **PASS**, exit code 0. No failures or outstanding revision issues.

Tailed output (terminal symbols normalized):

```text
NX   Running target lint for project ptah-electron-e2e:
- ptah-electron-e2e
nx run ptah-electron-e2e:lint — passed
NX   Successfully ran target lint for project ptah-electron-e2e
Output of 1 successful task was not shown. Run with --verbose or --output-style=static to see it.
View logs and investigate cache misses at https://nx.app/runs/CE0GRQnVme
Run duration:      19.3s
Cache:             0/1 hit (0%)
Critical path:     19.3s (1 task)
Recoverable time:  <1ms
VERIFICATION_EXIT_CODE=0
```
