# Task 8g-1b report

Handling: mapped to native Codex developerPrompt, not ignored. The hint is appended only for a true fence with the default or explicit coding profile. False/undefined fences and non-coding profiles add no hint. No fallback/debug-ignore path is needed because the native carrier exists.

Files written:

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts`: Added the one-line PTAH_UI_HINT export beside the prompt-harness exports.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts`: Classifies ptahUiFence and mcpToolProfile as supported inputs; ptahUiFence no longer triggers CodexChatOptionError.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`: Imports PTAH_UI_HINT from the agent-sdk barrel and appends it to the native developerPrompt when ptahUiFence is true and (mcpToolProfile ?? coding) is coding, preserving any existing developerPrompt.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts`: Covers accepted true/false fence values, coding/apps profiles, undefined values, and removes obsolete rejection expectations.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts`: Replaces fence rejection with native developerPrompt mapping assertions; covers default/explicit coding, false/undefined fences, apps exclusion and retained prompt/style fields. Mock exposes the actual UI hint constant.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts`: Mirrors the default Electron renderer start payload (prompt, tabId, name, workspacePath, ptahCliId, ptahUiFence true and model options). Exercises real session assembly including MCP running true, workflows disabled false and absent optional overrides. Asserts no classifier rejections and native developerPrompt contains PTAH_UI_HINT for start and resume.
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-1b-report.md`: This required lane report.

Verification: none run, as explicitly required. Tests were updated but not executed; team-leader verification under the lock remains pending. No frontend or Electron files changed by this lane. No install, build, git commit/push/stash/checkout performed.

## Follow-up

Corrected the D5 tool-profile policy: only defined `mcpToolProfile: 'coding'` is supported; every other defined value is rejected with `CodexChatOptionError` naming `mcpToolProfile`. Undefined remains omitted. The supported-options type explicitly retains the conditional key. `ptahUiFence` remains unconditionally accepted and its native developerPrompt mapping is unchanged. This supersedes the earlier report's statement that non-coding profiles start without a hint.

Files written in this follow-up:
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts ? conditional coding-only support and retained key type.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts ? coding acceptance and rejection of apps/other defined values while retaining the fence.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts ? apps now expects the coded mcpToolProfile error before provider resolution.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-1b-report.md ? appended this follow-up.

All other existing edits preserved. No verification run, as instructed; team-leader verification remains pending.
Follow-up ENOENT fix: updated D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts to create a real temporary workspace with mkdtemp in beforeAll and remove it with recursive force rm in afterAll; default start/resume use it for workspace folders, cwd, session-folder resolution and native profile paths, preserving zero-rejection and PTAH_UI_HINT assertions; production code unchanged and no verification run.
