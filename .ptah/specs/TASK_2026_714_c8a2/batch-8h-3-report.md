# Batch 8h-3: visible Codex runtime notices

Changes (relative to the worktree):
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts:89,147`: replaced publishModelSubstitution with publishRuntimeNotices and retained a WeakSet once-per-execution guard. Builds one assistant CHAT_CHUNK message (start/text_delta/complete), joining applicable model, MCP and style lines with newlines. Claude and executions without applicable lines publish nothing.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1006,1758`: start/resume call the publisher for every successful Codex execution, without requiring a model substitution; existing try/catch-and-warn retained.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:404`: same publisher/call-condition update for successful slash relaunch; existing try/catch-and-warn retained.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.spec.ts:223,258,286,297,338`: exact old model text, sorted MCP names without secret payloads, output style, both ambient lines, combined model/ambient message, Claude silence, empty inputs and repeated/concurrent publication coverage.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:149,216,295,323`: real profile preparation/publication in renderer-shaped and ambient start/resume cases. Start succeeds with Smithery/OAuth inputs, zero rejected keys and exactly one text delta containing both ambient lines. Resume succeeds with exactly one style text delta. Non-ambient cases publish nothing. All broadcasts are CHAT_CHUNK; serialized broadcasts and all mocked logger levels exclude URLs, Authorization, Bearer and fake token values.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:96`: renamed publisher mocks/assertions elsewhere in the spec.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts:51`: rename-only update of existing publisher mocks/assertions; no other additional specs modified.

Exact notice text templates (joined with a newline when multiple apply):
- `Model notice: requested "${requested}"; using "${used}".` (unchanged)
- `Codex chat: MCP servers not attached: ${names.join(', ')}`
- `Codex chat: output style '${config.outputStyleName}' is not applied`

MCP diagnostics use sorted Object.keys only; no URLs, headers, tokens or override values are copied. Style names appear only in the requested user-visible notice; the accepted strip logging is untouched. No CHAT_ERROR or failure-state event is introduced.

Read-confirmed follow-up behavior: chat-session.service.ts:1623 returns from resume preflight for a live stream; the ordinary send at :1154 neither prepares nor publishes, so notices do not repeat per turn.
Resume scope note: the real resume config assembles outputStyleName but no mcpServersOverride. Its spec therefore expects the style notice only, accurately reflecting prepared inputs. Start exercises both resolver entries. No resume config-builder changes were made because only call-site changes were authorized.

Absolute paths of every file modified/written in this batch:
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8h-3-report.md

Source review only; no verification, tests, lint, typecheck, build, diagnostics, installation or git commands run. Specs remain unexecuted pending team-leader verification. Accepted classifier/logging and non-coding mcpToolProfile rejection tests remain untouched, as do the concurrent lane's files.
