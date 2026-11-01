# Visual Review - TASK_2026_859_b561

Verdict: DEFERRED. The coordinator stopped the screenshot work because a review fix round is changing the MCP detail panel (new required-input fields, redacted preview, new coded errors). No AFTER screenshots were taken, and no Electron instance was started.

## How Electron was launched before (method to reuse)

Source: `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/.ptah/specs/TASK_2026_853_897f/visual-review-phase-d.md` (finding 8). Its screenshots are in the sibling `evidence/` folder, for example `pd-mcp-install-workspace-dark.png`. The "before" evidence for the MCP failure is described in finding 8 only. I found no saved screenshot of the "Could not auto-detect configuration" state.

1. Build the worktree under the lock: `node scripts/verify.mjs --exec --task electron-screenshot-build -- npx nx run ptah-electron:build`. It took about 6 minutes in the earlier run.
2. Copy the renderer: `node apps/ptah-electron/scripts/copy-renderer.js`. The `build` target does not do this.
3. Launch `dist/apps/ptah-electron/main.mjs` with the electron binary from `node_modules/.bin/electron`. Use a remote-debugging port (the earlier scripts connect to 9355). Put `--user-data-dir`, HOME, XDG_* and PTAH_DB_PATH under a temp directory such as `/tmp/tpd-d-run`. Use a temp git repo as the workspace so the real `~/.ptah` is untouched.
4. Drive the app over CDP with `playwright-core`. The helper is `/tmp/tpd-d-scripts/lib.cjs`, which calls `chromium.connectOverCDP('http://localhost:9355')`.
5. Reach the panel by clicking the "MCP Servers" text. The script `/tmp/tpd-d-scripts/m1.cjs` does this, and then opens the directory list and an entry's install panel.
6. The earlier reviewer also used a fetch shim (`/tmp/tpd-d-scripts/patch-fetch.cjs`) to adapt the registry response. It should not be needed after this fix, because the point is to see the real registry data render.

## Launch problems

- `dist/apps/ptah-electron` did not exist in this worktree, so a build was required.
- I started the build under the lock. It waited about 453 s for memory because another verify run (in worktree `onboarding-analysis-sharing`) held a slot and free memory was under 8 GB. The lock was acquired at 17:49:34Z.
- I then received the stop message and killed the build. No build output was produced, so the Electron app was never launched. Log: `/tmp/mra-build.log`.
- No Electron processes for this worktree are running.

## Screenshots

None taken. The `screenshots/` folder was created under the task folder and is empty. Nothing is marked "pre-fix-round, superseded" because nothing was captured.

## To resume after the fix round

1. Build and copy the renderer as above. Wait for the lock.
2. Capture each of these in dark and light theme: the popular list, a search for "github" and one for "filesystem", and the detail panels for an npm server (npx preview), a remote streamable-http server, a server with required env vars or secret headers (secret marker, no values, redacted preview), and an unsupported entry (coded message).
3. Do not click the final Install button.
