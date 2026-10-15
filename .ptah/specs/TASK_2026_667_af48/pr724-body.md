## Summary

Session handoff as a skill (TASK_2026_655):
- Bundled `session-handoff` skill: the agent writes `HANDOFF.md`.
- New MCP tool `ptah_session_handoff` (always on): opens a normal top-level session in the same workspace and branch, with no worktree and no parent link, at the same autopilot / permission level as the source session. The new session can hand off again.
- Host: `SessionHandoffService` + chat-host start path. Error text, logs and Sentry carry only allowlisted error kinds, never the prompt.
- Webview: the handoff tab is adopted after its source tab. The "Wrap up & hand off" banner sends `/session-handoff`, also when the tab already has queued text. A failed start settles the tab as not live.
- The VS Code webview sender now returns the real `postMessage` result. Permission and ask-user prompts therefore reach their existing "not delivered" fallback at once when no webview is live.

Codex `code-logic-reviewer` lanes reviewed every batch: B1/B5, B2, then B2 fix + B3 + B4 with one fix round and one re-review. Reports are in `.ptah/specs/TASK_2026_655_handoff/`.

## Known open items (follow-ups)

- **Serious (r2 review, partial):** the failed-start `chat:error` has no acknowledgement. If the webview goes away between the announce and the error, the adopted tab can stay live-looking.
- ~~**Serious (r2 review, new):** closing a tab kept a held `/session-handoff` command.~~ **Fixed** in 92e32f0b7 + 551a84699: held commands are dropped on close, force close, `/clear` and workspace removal (codex re-review APPROVED 8/10). Moderate notes: parked tabs are not covered by a test, and a `/clear` RPC reply that overtakes the clear broadcast would report the handoff as queued.
- **Fixed (review comment):** handoff refusals use `safeErrorKind`, not the raw `fs` message (ad0d8a985).
- Branch merged with `main` (00d0a47c1); `content-manifest.json` regenerated.
- **Moderate (deferred):** `ptah.session.handoff` in the execute-code namespace does not apply the MCP schema's prompt/label bounds.
- **Deferred (shared):** `webview-manager.ts` and `chat-stream-broadcaster.service.ts` log raw errors for every session. This needs its own task.
- `ptah_session_send` still copies a raw thrown message into its log and reply.

## Test plan

- [x] `nx run-many -t typecheck,lint,test` for cli-agent-runtime, rpc-handlers, vscode-core, vscode-lm-tools, chat-state, chat (`--parallel=1`, `--maxWorkers=2`)
- [ ] Manual check A2 in Electron: queue text during a streaming turn, click "Wrap up & hand off", and confirm that `/session-handoff` runs as a command after the text
- [ ] Manual: hand off from a full-autopilot session, and confirm that the new tab starts at the same level

Note: this branch and `fix/child-session-permission` both edit `chat-session.service.ts`. The second PR to merge may need a rebase.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


<!-- This is an auto-generated comment: release notes by coderabbit.ai -->

## Summary by CodeRabbit

* **New Features**
  * Added a session handoff command that continues work in a new chat in the same workspace, with a handoff document and continuation prompt.
  * The session-budget action can now use the handoff command when available, with an inline wrap-up prompt as a fallback.
* **Improvements**
  * Slash commands sent while text is queued are held and sent after the text, or dropped if the queued work is canceled.
  * Failed session starts now settle the affected tab and clear its queued work.

<!-- end of auto-generated comment: release notes by coderabbit.ai -->

