# PR #580 live lane-console review scene

Authored for TASK_2026_534 in `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`. Static verification passed. Electron was **not launched**, the scene was **not run**, and no recording or rendered video is claimed.

## Files changed

- `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts` — new six-beat review, caption-only Director pacing, real mouse drags, screenshots, bounded waits, optional-action warnings. Canvas helper patterns are copied locally; the original scene is unchanged.
- `apps/ptah-electron-e2e/src/showcase/_harness/showcase-launcher.ts` — when `PTAH_SHOWCASE_WORKSPACE` is set, append `path.resolve(workspace)` immediately after the Electron entry argument. Unset behavior is unchanged. Prettier also reformatted one existing type assertion.
- `apps/ptah-electron-e2e/project.json` — new `showcase:lane-review` target copies the existing showcase dependencies and commands, with `lane-console-review.scene.ts` added only to its Playwright command. Existing `showcase` is unchanged.
- `.ptah/specs/TASK_2026_534_lane_console/lane-review-scene-report.md` — this report.

No other files were written. No commits, pushes, stashes, or history-changing git operations were performed.

## Beats

1. Navigate to Canvas, close only tiles whose header is exactly `lane-review`, create that tile, restore full view if needed, and request full width for the wide-layout review.
2. Submit `PTAH_LANE_REVIEW_PROMPT` or the default prompt: discover installed lanes, spawn two different background CLI lanes in parallel for read-only source-file and package-script summaries, request incremental findings, wait for both, and recap. The default explicitly prohibits modifying files or executing package scripts.
3. Wait up to three minutes for the tile's agent indicator, switch to compact view immediately, hold 20 seconds, drag recap wider/narrower, double-click reset, and expand/collapse one wire row. The row is retained by its `aria-controls` identity so live arrivals do not change the collapse target.
4. Open the tile's Agents sidebar tab. Drag the chat-view divider left toward a 900px panel, bounded by the tile's 75% limit. Wait up to 30 seconds for the second visible lane. Hold 20 seconds, drag/reset the first lane divider, toggle one agent, hold, and restore side-by-side view. Warn if two running columns are not observed.
5. Close Agents to reveal the compact card, choose the menu's narrowest width (`one third`), warn if the compact body is still wider than 600 CSS pixels, hold four seconds, save an extra stacked-layout screenshot, then restore full width.
6. Restore full view, call `director.waitForAgentTurn(tile)`, then finish with a caption and five-second hold. **Necessary ordering adjustment:** the Director waits on `chat-stop-btn`, but compact mode unmounts `ptah-chat-input`. Waiting in compact mode would falsely report completion. The full-view switch therefore precedes the wait. Its existing cap is 20 seconds to observe a start plus six minutes for completion, below the requested example eight-minute cap. Timeout logs a warning and continues.

Every beat has a warning boundary and attempts an end-of-beat screenshot via `testInfo.outputPath('beat-N.png')`. Optional interactions have independent warning boundaries. Drags use real `page.mouse.move/down/move/up` events with 12 moves at 90ms intervals and a `finally` release. The test timeout is 20 minutes; ordinary locator actions default to eight seconds. There is no `director.say()` or narration script.

## Selector evidence

All application selectors were checked against Angular source under `libs/frontend`. Paths below are relative to the worktree. `getByRole` entries show the role and exact accessible name. Shared primitives are cited alongside their concrete use sites where necessary. `:visible`, `.first()`, `.last()`, and `.nth(1)` are Playwright filters on the documented elements.

| Selector / observed attribute                                                                           | Source file:line                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| button `Toggle canvas grid / single chat`                                                               | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:463`                                                                                                                              |
| `[data-testid="canvas-grid"]`                                                                           | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:81`                                                                                                                                             |
| `[title="Add new session tile"]`                                                                        | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:130`                                                                                                                                            |
| button `Create new session`                                                                             | `libs/frontend/canvas/src/lib/canvas-empty-state.component.ts:45`                                                                                                                                           |
| `input[placeholder*="session name" i]:visible`                                                          | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:149`, alternate empty-state form at `:221`                                                                                                      |
| button `Create`                                                                                         | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:173`, alternate form at `:245`                                                                                                                  |
| `[data-testid="canvas-tile"]`                                                                           | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:115`                                                                                                                                       |
| `.tile-header span` filtered by exact text `lane-review`                                                | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:126`, label interpolation at `:129`                                                                                                                  |
| `[title="Close tile"]`                                                                                  | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:312`                                                                                                                                                 |
| `[data-testid="tile-layout-trigger"]`                                                                   | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:157`                                                                                                                                                 |
| menu `Layout for lane-review`                                                                           | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:165` (role), `:167` (name from tile label)                                                                                                           |
| menuitemradio `Set tile width to one third` / `Set tile width to full`                                  | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:54`, `:61` (labels), `:191`, `:199` (role/name bindings)                                                                                             |
| `button[title="Switch to compact view"]` / `button[title="Switch to full view"]`                        | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:77`, `:80`, `:81` (labels), `:299` (title binding)                                                                                                   |
| `ptah-chat-input textarea[role="combobox"]`; final `ptah-chat-input` readiness check                    | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:107` (host), `:224` (combobox); mount in `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:216` |
| `[data-testid="chat-send-btn"]`                                                                         | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:386`                                                                                                                    |
| `[data-testid="chat-stop-btn"]` (Director's internal turn wait)                                         | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:372`                                                                                                                    |
| `ptah-tile-agent-indicator button`, read `title` for running status                                     | `libs/frontend/canvas/src/lib/tile-agent-indicator.component.ts:23`, `:28`, `:38`; status text at `:93`                                                                                                     |
| `ptah-split-handle[data-testid="cs-split-handle"] [role="separator"]`                                   | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:522`; inner separator in `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:36`                  |
| Handle `aria-orientation` used to choose x/y drag axis                                                  | `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:38`                                                                                                                                          |
| `.cs-row-line[role="button"]` and dynamic `[aria-controls="<mark-id>-detail"]`                          | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:617`, `:619`, `:626`                                                                                         |
| `.cs-body-host`                                                                                         | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:421`                                                                                                         |
| button `Toggle Agents panel`; title `Show Agents`                                                       | `libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:45`, `:55`, `:56`; Agents label in `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:226`                             |
| `ptah-agent-monitor-panel`                                                                              | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:251`; selector in `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:146`                          |
| `ptah-agent-monitor-panel aside`                                                                        | `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:190`                                                                                                                      |
| `div[role="separator"][title="Drag to resize · double-click to reset"]:has(+ ptah-agent-monitor-panel)` | `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:235`, `:238`, `:240`, `:251`. Adjacent sibling scope excludes every internal split handle.                                        |
| `ptah-agent-lane-grid`                                                                                  | `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:477`; selector in `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:30`         |
| Grid `section[data-lane-id]`                                                                            | `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:47`, `:52`                                                                                                      |
| Grid `[title="running"]`                                                                                | `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:67` binds agent status                                                                                          |
| Grid `ptah-split-handle [role="separator"]`                                                             | `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:105`; primitive role in `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:36`                      |
| Panel `button[title="Show one agent"]` / `button[title="Show agents side by side"]`                     | `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:219`                                                                                                                      |
| Panel `button[title="Close panel"]`                                                                     | `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:250`                                                                                                                      |

## Run the recording

Quit the currently running Ptah Electron app first to release its single-instance lock. Keep the normal authenticated profile, local backend, and at least two configured CLI lanes available. These commands are for the user to run; they were not executed during verification.

```powershell
Set-Location 'D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66'
$env:PTAH_SHOWCASE_WORKSPACE = 'D:\projects\property-hub'
$env:PTAH_SHOWCASE_SILENT_CAPTIONS = '0'
npx nx run-many --projects=ptah-electron-e2e --targets='showcase:lane-review' --skip-nx-cache
```

`run-many` explicitly names the one project and the target containing a colon. The Playwright command inside that target runs only `lane-console-review.scene.ts`. Set `$env:PTAH_LANE_REVIEW_PROMPT` before the command to override the read-only tasks. Normal provider billing applies to these real runs.

## Output locations

- Raw review video: `dist/apps/ptah-electron-e2e/recordings/lane-console-review/raw.webm`.
- Timeline and camera metadata: `beats.json` and `shots.json` in that same directory, written by the unchanged fixtures.
- Screenshots: `dist/apps/ptah-electron-e2e/showcase-results/<Playwright-generated-test-directory>/beat-1.png` through `beat-6.png`, plus `beat-5-stacked.png` when that action succeeds.

The copied target includes the existing `transcode.mjs` command as requested. **Existing limitation:** that script scans only top-level `.webm` files (`apps/ptah-electron-e2e/scripts/transcode.mjs:42`), while the fixture writes recordings into per-scene subdirectories. It therefore does not produce this scene's MP4. Changing that script is outside the permitted scope.

For a plain review MP4 retaining the captured captions, run the following after a successful recording. This avoids introducing marketing intros/outros and uses the installed `ffmpeg-static` binary:

```powershell
$laneRecording = Join-Path (Get-Location) 'dist/apps/ptah-electron-e2e/recordings/lane-console-review'
$laneOutput = Join-Path $laneRecording 'out'
New-Item -ItemType Directory -Force -Path $laneOutput | Out-Null
$laneFfmpeg = node -p "require('ffmpeg-static')"
& $laneFfmpeg -n -i (Join-Path $laneRecording 'raw.webm') -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart (Join-Path $laneOutput 'lane-console-review.mp4')
```

That command writes `dist/apps/ptah-electron-e2e/recordings/lane-console-review/out/lane-console-review.mp4`; `-n` preserves an existing MP4 rather than overwriting it. No MP4 was generated here.

## Static verification

| Check                                                                                                          | Result                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx playwright test --config=apps/ptah-electron-e2e/showcase.config.ts --list 2>&1 \| Select-Object -Last 10` | PASS, exit 0. New scene listed at line 179: `PR #580 — live resizable lane console review (TASK_2026_534)`. Total: 14 tests in 14 files. Collection only, no fixture launch.                                 |
| `npx tsc --noEmit -p apps/ptah-electron-e2e/tsconfig.spec.json 2>&1 \| Select-Object -Last 24`                 | PASS, exit 0, no diagnostics. This is the config used by the project's typecheck target and includes `src/**/*.ts`; the base `tsconfig.json` has empty files/include and would not actually check the scene. |
| Scoped `ptah_get_diagnostics` for both changed TypeScript files                                                | PASS: TypeScript compiler provider, 0 errors and 0 warnings after final source edits.                                                                                                                        |
| `npx prettier --write` on the changed files                                                                    | Completed for scene, launcher, project JSON, and report.                                                                                                                                                     |
| Angular selector audit                                                                                         | Verified with targeted source reads and `rg`; evidence above. No speculative older Canvas fallback selectors retained.                                                                                       |
| Live Electron / visual review / capture / MP4                                                                  | Deliberately not run, as requested.                                                                                                                                                                          |

## Risks and limitations

- Provider latency and task length control whether both lanes are still streaming during both 20-second holds. The scene observes real agent arrival and warns when running status is absent; it cannot guarantee overlapping output or manufacture live activity. A successful Playwright result with warnings is not proof of a successful visual review. Inspect the footage and warnings; choose longer read-only tasks through the prompt override if needed.
- Agent spawning depends on the active session's model/tools and at least two authenticated installed CLI lanes. Permission requests are not auto-approved. Missing auth, permissions, lanes, or providers can lead to timeout warnings or failure to submit the prompt.
- Display scaling and available CSS width determine whether the panel can reach 600px and whether one-third width reaches the compact stacked threshold. The full-width setup helps; small displays or locked layout can still prevent those shots. No application state or CSS is forced through script evaluation.
- The copied target's existing cleanup command deletes the entire recordings directory before capture (`apps/ptah-electron-e2e/scripts/clean-recordings.mjs:24`), including earlier scenes. Preserve prior recordings before running it. This command was not executed here.
- Named review tiles are closed/recreated; other tiles are left alone. The review tile, view mode, and panel width can persist in the authenticated profile. Future recording opens the explicitly selected `D:\projects\property-hub` workspace.
- Navigation assumes the existing chat/Canvas shell is reachable, as in the source scene. Restoring the app into a standalone screen or setup wizard may require manual navigation before the recording.
- No application correctness or visual acceptance claim is made from static checks. The earlier lane reports' application test findings were read but not re-tested by this scene-authoring task.
