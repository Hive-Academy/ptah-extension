# Decisions - TASK_2026_863_26b1

| # | Decision | Evidence | Source |
|---|----------|----------|--------|
| 1 | BUGFIX, Partial depth, full auto, lanes enabled, approval `lane-review`. | User request "full auto mode"; ptah_agent_list shows codex, antigravity, opencode, grok, Glm spawnable. | user + evidence |
| 2 | Base the branch on `origin/main` (55b604b66), not local `main` (089d6f63c). | Local `main` is 17 commits behind `origin/main` and does not contain PR #909 (7531c509d) or `dev-overrides.ts`. The branch had no commits, so `git reset --hard origin/main` lost no work. | evidence |
| 3 | Discard the `task-tracking/landing-live-demo/handoff.md` working-tree change before the reset. Copy kept at `%TEMP%\ptah-idle-863\HANDOFF.md.worktree-copy`. | `HANDOFF.md` and `handoff.md` collide on a case-insensitive file system; `origin/main` deletes both. Not user work (new worktree). | evidence |
| 4 | Write the dev logs to `%TEMP%\ptah-idle-863\`, not to the task folder. | With the log inside the worktree, Nx graph computation failed three times (`@nx/eslint/plugin` worker exit 1). With the log outside and `NX_PLUGIN_NO_TIMEOUTS=true`, the graph step passed. | evidence |
| 5 | Start Electron with `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9334` in addition to `npm run dev`. | `serve:watch` only runs the watch builds and does not start Electron (`apps/ptah-electron/project.json`). | evidence |
| 6 | Ran `node scripts/copy-wasm.js dist/apps/ptah-electron` in the dev build | The watch build had no wasm folder; the indexer error loop loaded the CPU and broke the 5 s CLI health check |
| 7 | No code change yet | Runs A-E (shown, background tab, other workspace, background subagent) all fired; field-log misses are explicit session ends (handoff/interrupt) and 2 `background-subagent` vetoes, none tab-related |
