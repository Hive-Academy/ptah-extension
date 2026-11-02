# Batch 8h-1: D6 ambient option handling

Implemented the final strip decision supplied in the task.

Changes (paths relative to the worktree):
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts:25`: strips MCP overrides, thinking and outputStyleName; preserves prior strips and supported typing.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts:50`: exposes sorted MCP map keys as mcpServerNames; classifier remains pure and excludes stripped values from supported options.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts:82`: retains unknown-option rejection; adds ambient stripping/names coverage at :96 and preserves non-coding profile rejection.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:150`: emits ambient diagnostics before rejection/preparation; retains Ptah MCP logging.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:203`: asserts successful profiling, sanitized prepare inputs, exactly three ambient logs and absence of secret values; temperature rejection remains at :194.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:148`: parameterizes existing renderer-shaped start/resume coverage with an ambient case. Uses the real MCP builder and real launchSdkSession through startSession, with one Smithery and one OAuth resolver entry, thinking and resolved outputStyleName. Asserts native start success, no rejected keys, expected strips, real profile acceptance and secret-free logs.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:525`: error fixtures now use temperature.

Exact structured info-log fields:
- `codex-user-mcp-not-attached`: `{ code: 'codex-user-mcp-not-attached', serverNames: mcpServerNames }`; names are sorted map keys; emitted once when nonempty.
- `codex-thinking-not-applied`: `{ code: 'codex-thinking-not-applied' }`; message explains native effort; emitted once for defined thinking.
- `codex-output-style-not-applied`: `{ code: 'codex-output-style-not-applied' }`; emitted once for defined outputStyleName.
- Existing `ptah-mcp-not-attached`: `{ code: 'ptah-mcp-not-attached' }`; unchanged, emitted when mcpServerRunning is true.

Secret handling: only Object.keys of the override map enter diagnostics. No server values, URLs, headers, tokens, thinking values or style names enter the new log arguments. Added serialized-log assertions cover fake URLs, Authorization, Bearer tokens, adaptive and Explanatory. Host-port coverage asserts stripped fields do not reach prepare.

Absolute paths of every modified/written file:
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8h-1-report.md

Verification: source reviewed only. No tests, lint, typecheck, build, diagnostics, package installation or git commands run. Team-leader verification remains required; added specs have not been executed. No other source files edited.
