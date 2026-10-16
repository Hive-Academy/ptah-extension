# Batch 18 Report - TASK_2026_652_7284

## Changes

- Task 18.1: Changed `rejects invalid configUpdates without broadcasting` to assert `HarnessConfigUpdatesError`, and `rejects an unresolved session without saving or broadcasting` to assert `HarnessProposalNoSessionError`.
- Task 18.2: Added `reports when no workspace is available for a proposal`, `reports a file-system error code without exposing its path`, and `reports an invalid SDK session id without Zod issue details`. The last case uses a real Zod validation error.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\harness-namespace.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts`

## Verification

- Jest command: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts --coverage=false --maxWorkers=2`
- Jest result: `Test Suites: 2 passed, 2 total`; `Tests: 405 passed, 405 total`.
- Prettier write: both specs unchanged after formatting.
- Prettier check: `All matched files use Prettier code style!`
- Scoped TypeScript diagnostics: 0 errors, 0 warnings.
