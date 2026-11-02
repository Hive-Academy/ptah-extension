# Batch B8 — Landing Live Demo Media Capture (`scripts/landing/capture-live-demo-media.mjs`)

## Summary

Created `scripts/landing/capture-live-demo-media.mjs` and captured mobile fallback videos (`.webm`) and poster images (`.jpg`, 1440×900, quality 80) for all four PtahCode landing live-demo scenarios (`orchestration`, `tribunal-council`, `command-center`, `multi-agent`) using Chromium from the `playwright` package at `speed=2`.

Every scenario completed with `state.complete === true`, `0` misses, `0` console errors, `0` console warnings, `0` page errors, `0` CSP violations, `0` HTTP errors, and `0` external network requests. All `.webm` videos are under the 3 MB ceiling at full 1440×900 resolution, and all `.jpg` posters are under the 250 KB ceiling at 1440×900 (quality 80).

## Exact Commands Run

```bash
# 1. Build the demo bundle from the webview production dist
node scripts/landing/build-live-demo.mjs \
  --webview-dist dist/apps/ptah-extension-webview/browser \
  --out /tmp/ptah-b8/demo

# 2. Capture all 4 scenarios (videos + posters) into apps/ptah-landing-page/public/assets/live-demo
node scripts/landing/capture-live-demo-media.mjs \
  --root /tmp/ptah-b8 \
  --json /tmp/ptah-b8/capture-summary.json
```

## Produced Files, Sizes, and Durations

### Script and Notes

- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/scripts/landing/capture-live-demo-media.mjs`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/task-tracking/landing-live-demo/batch-b8-notes.md`

### Generated Media (`apps/ptah-landing-page/public/assets/live-demo/`)

| Scenario | File | Resolution | Quality | Size (Bytes) | Size (Human) | Target Ceiling | Replay Duration | Wall Time (`speed=2`) | Poster Captured At (`elapsed`) | Status |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `orchestration` | `orchestration.webm` | 1440×900 | — | 2,698,817 B | 2.57 MB | ≤ 3.00 MB | 47,000 ms (47.0 s) | 31,683 ms (31.7 s) | — | PASS |
| `orchestration` | `orchestration.jpg` | 1440×900 | 80 | 112,029 B | 109.4 KB | ≤ 250.0 KB | 47,000 ms (47.0 s) | — | 38,040 ms | PASS |
| `tribunal-council` | `tribunal-council.webm` | 1440×900 | — | 2,077,200 B | 1.98 MB | ≤ 3.00 MB | 33,150 ms (33.15 s) | 24,120 ms (24.1 s) | — | PASS |
| `tribunal-council` | `tribunal-council.jpg` | 1440×900 | 80 | 116,456 B | 113.7 KB | ≤ 250.0 KB | 33,150 ms (33.15 s) | — | 19,700 ms | PASS |
| `command-center` | `command-center.webm` | 1440×900 | — | 1,692,707 B | 1.61 MB | ≤ 3.00 MB | 31,000 ms (31.0 s) | 23,369 ms (23.4 s) | — | PASS |
| `command-center` | `command-center.jpg` | 1440×900 | 80 | 91,602 B | 89.5 KB | ≤ 250.0 KB | 31,000 ms (31.0 s) | — | 18,007 ms | PASS |
| `multi-agent` | `multi-agent.webm` | 1440×900 | — | 1,979,527 B | 1.89 MB | ≤ 3.00 MB | 35,650 ms (35.65 s) | 23,363 ms (23.4 s) | — | PASS |
| `multi-agent` | `multi-agent.jpg` | 1440×900 | 80 | 112,285 B | 109.7 KB | ≤ 250.0 KB | 35,650 ms (35.65 s) | — | 21,491 ms | PASS |

### Absolute Paths of Generated Media

- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/orchestration.webm`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/orchestration.jpg`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/tribunal-council.webm`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/tribunal-council.jpg`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/command-center.webm`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/command-center.jpg`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/multi-agent.webm`
- `/home/amun/ptah-extension/.claude-worktrees/feat-landing-live-demo-replay-e96db388896a/apps/ptah-landing-page/public/assets/live-demo/multi-agent.jpg`

## Visual Inspection of Posters

Each generated `.jpg` poster was inspected directly against the dark webview design reference:

- `orchestration.jpg`: Dark glass Electron layout (`acme-app` on `demo`), user prompt bubble at top, active orchestrator (`Working · 19s`, `6 tools`) with `ptah agent spawn` tool items and `visual-reviewer` background task, 7 agent pills in the header, and populated right inspector (`~ 9.6k` tokens, `~ $0.08` cost, `Sonnet 4.5` model, `2 running · 7` agents, 5-hour/weekly plan limits).
- `tribunal-council.jpg`: Dark glass chat view with `Orchestrator running` and three council member pills (`Architecture`, `Reliability`, `Product`), council task rows in the transcript, and right inspector showing `~ 9.6k` tokens, `~ $0.08` cost, `Sonnet 4.5`, and council member token counts.
- `command-center.jpg`: Electron Command Center graph with central `Ptah HEAD OF ENGINEERING` node (`Context 3.4%`), active `Copilot · running` and `Codex · running` nodes, top metrics bar (`Cost $0.08`, `Tokens 9.6k`, `Agents 2`), header voice/context chips (`Local · tiny.en / Demo voice`, `Context 3.4%`), and live streaming transcript on the right rail.
- `multi-agent.jpg`: Dark glass chat view with `Orchestrator running`, SDK helpers (`Accessibility`, `State review`) and CLI lanes (`Copilot`, `Codex`), active task rows, and right inspector showing per-agent tokens/cost (`~ 9.6k`, `~ $0.08`, `Sonnet 4.5`) and `2 · 2 runs` under Lanes.

## Problems Encountered & Resolution

1. **`command-center` initial `session:stats-live` race at `speed=2`**:
   - **Problem**: On the first capture run, `command-center` opened with `autoplay=1`. At `speed=2`, the first timeline event (`at: 500`, `session:stats-live` for `sessionId: 11111111-1111-4111-8111-111111111111`) fired 250 ms after `ready`, before the session card click in `[data-testid="recent-grid"] button` finished binding the Command Center tab to that `sessionId`. That caused a console warning (`[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event`) and left the context badge as `Context unknown`.
   - **Fix**: In `scripts/landing/capture-live-demo-media.mjs`, `command-center` loads with `autoplay=0`, clicks the first session button in `[data-testid="recent-grid"] button`, waits for `ptah-command-scene` to mount (confirming the tab is bound), and then calls `window.__ptahReplay.play()`. With this fix, `command-center` passes with `0` warnings/errors and renders `Context 3.4%` and `Cost $0.08 · Tokens 9.6k · Agents 2`.

## Decisions

- **Decision**: Load `command-center` with `autoplay=0` during media capture, select the release session from `[data-testid="recent-grid"] button`, wait for `ptah-command-scene`, and then invoke `window.__ptahReplay.play()`.
  - **Options**: (a) Load with `autoplay=1` and click `[data-testid="recent-grid"] button` concurrently; (b) Load with `autoplay=0`, select the session, wait for `ptah-command-scene`, then call `window.__ptahReplay.play()`.
  - **Evidence**: `command-center.json` emits its first `session:stats-live` event (carrying `contextTokens: 6800`) at `at: 500` ms (250 ms wall time at `speed=2`), and `AppStateManager.handleMessage` only auto-opens a session for `view === 'chat'`. Starting playback after `ptah-command-scene` mounts prevents `ChatStore.handleSessionStats` from dropping the initial `session:stats-live` push.
  - **Reversible**: Yes (confined to `scripts/landing/capture-live-demo-media.mjs`).
