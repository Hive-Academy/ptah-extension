## Summary

Adds a side display panel to the Electron chat that the coding agent opens and updates through `ptah-ui display` fences (TASK_2026_623_3492). Electron only; the VS Code webview keeps its current chat behaviour.

- **Contract `/4` and grammar:** `dashboard-catalog/4` with nested layout containers (`row col grid card section accordion`), stat trend pill and sparkline, avatar; `display [id]` fences; `/3` and the 610 corpus unchanged.
- **Host sources:** new `$agents` (status, tokens, cost, context) and `$limits` (read-only `agent:getLanePlanLimits` RPC, Electron only, no refresh, no spawn, privacy sentinels).
- **Display panel and dock:** lazy `@ptah-extension/chat-ui/display-panel` entry; per-tab Displays/Agents dock beside the chat (overlay below 600 px), auto-open once per turn without focus steal, pin, resize, 8-surface cap with eviction.
- **Turn summary:** host-built summary chip in chat and expandable stat cards in the panel replace the Electron change-set card and tests row (parity verified).
- **Previews (both webviews):** full Bash command with copy, file header with language and open action, diff counts and labelled snippet gutter, Write preview, wrapping code output.
- **Agent guidance:** `PTAH_UI_HINT` 87 tokens (limit 100), `ptah-surface-authoring` skill updated, content manifest regenerated.
- **Eager-closure gate:** forbids panel/dock inputs in the initial chunk; allow-lists the reviewed transcript files and two tool-preview helpers.

Follow-up items are filed as `TASK_2026_630_2250` (in this PR).

## Test plan

- [x] 40 batches, each with scoped Jest, lint and typecheck for the changed projects; one code-logic review per phase (Phases 1-7 accepted), style reviews where new entries/exports were added.
- [x] `tools/list` byte-identical vs merge base on both hosts; hint 87 tokens.
- [x] One production webview build: eager-closure gate PASS (781 eager inputs).
- [x] Electron visual review: collapsed tool rows 31.6 px (limit 36), previews at 360/1024 dark and light, no overflow in 299 code-output blocks, axe zero serious/critical from this change; fix round 33F (dock tabpanel visibility, chip word wrap) re-checked PASS WITH NOTES.
- [x] CI on `b57766c74`: all 20 checks pass (test shards 1-4, electron-e2e shards 1-4, webview-e2e, CLI E2E, git-real-git x3, checks, SonarCloud).
- [x] Populated display surfaces with a live provider (Claude CLI), re-checked on a fresh build of `abb512aec`: PASS, 0 breaking/serious/moderate. Trend pill and avatar text ≥ 5.08:1 in anubis, anubis-light and retro (was 3.14:1 retro); a passing `npm test` shows "1 test passed" on the recap and turn summary; collapsed headers show no `ptah-ui` fence text; applied chip reads "In display"; resize handle is a native `<button role="separator">` (arrows, Home/End, Enter reset); panel at 300/960 px matches the prototype family with no overflow; 0 console errors. Minor notes moved to TASK_2026_630 item 1.
- [x] Gate 3 fixes (`abb512aec`): scoped Jest (message-summary 13, turn-tests 28, display-chip 28, surface-renderer 57), typecheck chat/chat-ui/shared, lint chat/chat-ui, all pass.
- [x] Full `nx test` per project, `--parallel=1`, `--maxWorkers=2`: ptah-extension-vscode 171, agent-sdk 3333 (3 skipped), cli-agent-runtime 2209 (1 skipped), cli-engine 230, rpc-handlers 4378 (7 skipped), vscode-lm-tools 2976, chat 3503 (2 skipped), chat-ui 1070, declarative-dashboard 306, shared 3383, all pass. ptah-electron 1163 pass, 8 fail locally in `shell-csp.spec.ts` and `better-sqlite3-packaging.spec.ts` only because the worktree has no `node_modules/electron` (ENOENT); both specs are unchanged by this PR and pass in CI.
- [ ] VS Code webview previews checked visually (covered by host-branch specs only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
