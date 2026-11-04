# Live evidence - idle compaction for shown and background sessions

## Setup

- Code: worktree `fix/idle-compact-background` at `origin/main` 55b604b66 (contains PR #909).
- Electron dev: `npm run dev` (watch build) plus
  `PTAH_DEV_IDLE_CACHE_TTL_MS=60000 PTAH_DEV_IDLE_MIN_TOKENS=1000 node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9334`.
- Start log: `[WARN] [AgentSDK] Development overrides active: {"idleCacheTtlMs":60000,"idleMinTokens":1000}`.
- Fire time: 0.9 x 60 s = 54 s after the last 1h-cache request.
- Provider: Anthropic, auth `claudeCli` (Claude CLI v2.1.316), model `claude-opus-5-5`.
- Cache setting: `agentOrchestration.subagentPromptCacheTtl` = `auto` (no override). The reducer
  checks `not-1h` before `no-reading` and before arm, so every run below that reached
  `no-reading` or `armed` had a 1h-cache request (cache class `1h`).
- Workspace for tabs: `D:\projects\property-hub`. Other workspace for run C: `D:\website`.
- UI driven over CDP (Playwright `connectOverCDP`, port 9334). Logs:
  `%TEMP%\ptah-idle-863\electron-run4.log` (not committed, about 0.3 GB with debug lines).

## Environment problems fixed before the runs (not product changes)

1. Local `main` was 17 commits behind `origin/main` and had no PR #909 code. Branch moved to `origin/main`.
2. `dist/apps/ptah-electron/wasm` was missing in the watch build. The code symbol indexer failed in a
   loop (about 1,700 tree-sitter errors per 50,000 log lines) and loaded the CPU. Fixed with
   `node scripts/copy-wasm.js dist/apps/ptah-electron`.
3. With the high load, `claude --version` took 5-12 s and the 5 s health check failed
   ("Claude CLI is not installed"). After fix 2 and a restart, the check passed.

## Results

| Run | Session id | Shown at fire time | Lines seen (in order) | First skip or release reason |
|-----|-----------|--------------------|------------------------|------------------------------|
| A (turn 1) | 15c16890-ae59-492b-b5bf-dc915690cf4a | yes | `[ContextUsagePort] getContextUsage failed ... (Error); no reading this turn`, `transition reason=no-reading` | `no-reading` (5 s `getContextUsage` timeout under CPU load; not tab related) |
| A (turn 2) | 15c16890-ae59-492b-b5bf-dc915690cf4a | yes | `armed fireAt=1793752471210`, `firing`, PreCompact `trigger=manual preTokens=87750`, `transition reason=stale-turn` | none - fired; UI shows "Compacted while idle to save usage before the prompt cache expired" |
| B (first try) | 238d6a78-bd93-4153-a141-990410105820 | yes (switch came 46 s after fire, invalid as a background run) | `armed`, `firing`, PreCompact, `stale-turn` | none - fired |
| B2 (background tab, same workspace) | 2323f2fb-d4b2-49ea-8df3-9d42046bb392 | no - switched to tab A at 00:44:41Z, fire at 00:45:25.9Z | `armed fireAt=1793753125878`, `firing`, PreCompact `trigger=manual`, `chat:resume` (view reload), `stale-turn` | none - fired |
| C (background, other workspace) | 3afc88d7-cb2d-44f0-8023-6f9a79fad24d | no - `workspace:switch` to `D:\website` at 00:52:04Z, fire at 00:52:52.0Z | `armed fireAt=1793753571971`, `workspace:switch`, `firing`, PreCompact `trigger=manual`, `stale-turn` | none - fired |
| D (shown, `D:\website`, background subagent) | e58b2a37-ddf5-4aa4-8328-fd96c0fd590a | yes | subagent ended fast, `armed` again, `firing`, PreCompact `trigger=manual` | none - fired |
| E (background tab, property-hub, background subagent) | f63b4919-ded5-44ae-980f-128891f5146e | no - switched to tab A after the reply | `armed` (turn 1), `armed` again (turn 2, after the subagent result), `firing`, PreCompact `trigger=manual` | none - fired |

The only `released` / `Releasing idle query ownership {"reason":"abort"}` lines came at app
shutdown, for every session at once, after all the fires.

No `[IdleCompactionService] released` line and no `[SessionQueryExecutor] Releasing idle query
ownership` line appeared for any of these sessions before the fire.

## Field logs (packaged app, `%APPDATA%\Ptah\logs`, 2026-11-02 and 2026-11-03)

- The packaged build (MSIX, app.asar dated 2026-11-03 13:52) is older than PR #909: it has no
  `armed`/`firing`/`released` logs and no dev overrides. PR #909 changed only logs and dev overrides
  in the idle backend (`git diff 7531c509d^1 7531c509d -- libs/backend`), so the idle logic is the same.
- Idle `/compact` sends (coordinator origin, content length 8): 7 in two days.
- INFO-level idle skips: `below-min-tokens` 7x, `background-subagent` 2x (fire-time veto: the SDK
  turn phase was `awaiting-background`). DEBUG reasons (`no-reading`, `not-1h`, `stale-turn`,
  `activity-since-turn`) are not in the packaged logs.

## Conclusion of phase 2

- The stated cause ("fires only for the shown session") is **not reproduced** on the current code
  with a 60 s TTL: a background tab in the same workspace (B2) and a background session after a
  workspace switch (C) both armed and fired, and the PreCompact hook ran.
- The idle path has no shown-tab dependency in these runs.
- Open candidates for the field symptom, which a 60 s window can not show: events in the 54-minute
  window (stream end, `chat:resume`, model or settings change, app restart, subagent phase), the
  `background-subagent` veto, and `no-reading` from the 5 s `getContextUsage` timeout on large
  sessions. A CLI lane analyses the field logs for these (see `field-log-analysis.md`).

## Phase 3 - cause and fix

Cause (field logs, `field-log-analysis.md`): 2 misses where the parent turn ended with a background
subagent still running past the fire time. The fire gate returned `background-subagent` for turn phase
`awaiting-background`, the reducer dropped the attempt, and nothing armed it again. Not a shown-tab
dependency: the other 15 misses were explicit session ends (handoff / interrupt).

Fix: the fire gate admits `awaiting-background` (`isIdleFirePhase`). `beforeEnqueue` re-reads the phase
after the async message build and skips as `not-idle-at-send` if a parent turn started (grok review).

## Re-runs with the fix (`electron-run5.log`, TTL 60 s)

| Run | Session id | Situation | Lines seen (in order) | Result |
|-----|-----------|-----------|------------------------|--------|
| F | 8cc6cc6e-b965-458c-bb43-495042e63763 | background subagent, tab switched away | `armed`, `firing`, PreCompact `trigger=manual`, then `SubagentStop` of the subagent, `Compaction attempt completed` (12.8 s), `armed` again for the result turn | fired while the subagent ran (old code: `background-subagent` skip) |
| B3 | 45f4d380-6f5e-473f-a08e-bf7b37d69f03 | background tab | `getContextUsage failed ... no reading this turn`, `transition no-reading` | not armed: 5 s context-read timeout on the first turn, not tab related |
| B4 | 884d9b50-7c8f-469c-a3fb-f8430bf94cff | background tab, same workspace | `armed`, `firing`, PreCompact `trigger=manual`, `stale-turn` | fired |
| C2 | f79fb7ab-8233-4842-a03f-ec5e4f8df983 | switched to workspace `D:\website` | `armed`, `firing`, PreCompact `trigger=manual` | fired |
