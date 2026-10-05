# TASK_2026_612 AFTER evidence

Source: base 77f99a687 + UNCOMMITTED working-tree fix on fix/task-2026-612-child-session-visibility,
built and run ONLY from `D:/projects/ptah-extension/.claude-worktrees/task-612-child-session-visibility`.

## Code state shown (important)
- Build (`nx build-dev` + `copy-renderer-dev`, NX_DAEMON=false, --skip-nx-cache) ran ~17:55-18:01 (+03:00, 2026-10-04);
  main.mjs written 17:58:57, renderer copied by ~18:01. Capture run 18:09:37-18:10:09.
- `git diff --stat` was taken at 18:09 (right after build, before capture): `_diffstat-at-capture.txt`
  (12 files, 782 insertions, 120 deletions; includes chat-history-read.service.ts and
  task-prompt-bridge.service.* which are not in the earlier status). Other lanes were editing the
  worktree during the build, so the diff at 18:09 may be newer than the bundle: I could not
  verify per-file that the bundle contains the 18:09 state. Backend files do not affect the
  renderer shots (RPC is mocked).

## Method
Identical to before (real Electron dev build + Playwright + UiDriver.mockRpc, 1600x950,
data-theme anubis / anubis-light, same canvas flow and same `agentSession:opened` push).
Harness copy: `harness/` (copied into apps/ptah-electron-e2e for the run, removed afterwards).

## Mock differences vs before
1. `session:list`: child 4bb0a19d-7f5b-43ca-b10e-12c147d3e4cb now returns `hasTranscript: true`
   (BEFORE: false). Reason: the fixed backend returns true for a child whose transcript exists
   under its worktree dir; that backend behaviour is covered by Jest tests in rpc-handlers
   and is NOT exercised here (RPC is mocked). So the sidebar shot shows the frontend rendering
   of the fixed backend's output, not the backend fix itself.
2. Harness wait changed from "transcript expired is visible" to "child row is visible", and
   facts.json gained `transcriptExpiredLabelCount` and `tabsStorageKeys`.
3. Canvas scenario mocks are UNCHANGED: same chat:agent-sessions (empty), same push payload.
   The frontend fix alone creates the tile.

## Active workspace
Yes. Fixture mocks `workspace:getInfo` activeFolder `C:\ptah-e2e-ws`; the persisted tab key is
`ptah.tabs.ws.C_3A_5Cptah-e2e-ws.electron-main` (facts.json tabsStorageKeys), the workspace
`ptah-e2e-ws` is selected in the rail, and the child tab was adopted into that active
partition, as the fix requires.

## Before/after comparison
| Before | After | What changed |
|---|---|---|
| before/sidebar-child-dark.png | after/sidebar-child-dark.png | Child row no longer greyed (name opacity 0.5 -> 1, `opacity-50` class gone), "transcript expired" label gone. Normal session row ("Refactor session...") identical. (dark shot not visually opened by me; light pair and facts were. Same code path.) |
| before/sidebar-child-light.png | after/sidebar-child-light.png | Same, verified visually: child row now full-contrast, single-line "2m ago 14 msgs". |
| before/canvas-after-adopt-dark.png | after/canvas-after-adopt-dark.png | Before: one tile (parent). After: two tiles, parent plus "TASK 531 canvas gating" child tile with "Started by ..." banner and the prompt. Active tab unchanged (parent stays first/active; child appended, not focused). Parent tile content (Ptah welcome, Skills Not Configured, setup card) the same, just narrower because the row is shared. Parent tab label differs only by session timestamp. |
| before/canvas-after-adopt-light.png | after/canvas-after-adopt-light.png | Same as dark (light shot captured by the same run; not individually opened). |
| before/facts.json | after/facts.json | canvasTilesBefore 1 -> 1; canvasTilesAfter 1 -> 2; childTabAdoptedInTabManager true in both; nameOpacity "0.5" -> "1"; transcriptExpiredLabelCount 0 (before: label present). |

## Could not capture / caveats
- Backend fix not exercised end to end (mocked); hasTranscript true is an assumption backed by Jest only.
- Child tile shows a loading skeleton / "cost unavailable" because no real session backs it.
- "Active tile unchanged" is judged from the screenshot (parent stays first and the active
  one) and not from a dedicated active-tab fact.
- `Agent` badge from the task text does not exist in the sidebar template (same as before).
- Light theme via data-theme directly, as in before.
