# TASK_2025_224: Fix Platform Abstraction Gaps

## User Request

Fix three platform abstraction violations where backend services directly import VS Code APIs instead of using the platform-agnostic abstractions (IWorkspaceProvider, platform tokens, etc.):

1. **AgentProcessManagerService** — Directly calls `vscode.workspace.workspaceFolders` and `vscode.workspace.getConfiguration()` instead of injecting `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (IWorkspaceProvider)

2. **CopilotAuthService** — Hardcodes `vscode.authentication.getSession()` instead of having a platform-agnostic auth flow. The Copilot SDK auth is independent of VS Code — it uses standard GitHub OAuth (device code flow) and works with other providers like OpenCode. Needs a proper auth abstraction (device code flow, token file reading from `~/.config/github-copilot/`).

3. **TokenCounterService** — Calls `vscode.lm.selectChatModels()` with no platform-agnostic alternative. Needs an abstraction that works without VS Code's Language Model API.

## Strategy

- **Type**: REFACTORING
- **Workflow**: Partial (Architect -> Team-Leader -> Developers -> QA)
- **Key Constraint**: Must work in both VS Code extension AND Electron standalone app
- **Architecture Pattern**: Follow existing platform abstraction (IWorkspaceProvider, IFileSystemProvider, IStateStorage pattern from TASK_2025_199)

## Context

- Platform abstraction layer was built in TASK_2025_199
- Electron app was built in TASK_2025_200
- Platform unification done in TASK_2025_209
- These 3 services were missed during the abstraction pass
- The workspace provider bus architecture is already in place (ElectronWorkspaceProvider)
- Copilot SDK has its own auth independent of VS Code (proven by OpenCode)

## Key Files

- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`
- `libs/backend/workspace-intelligence/src/services/token-counter.service.ts`
- `libs/backend/platform-core/src/interfaces/` (existing abstractions)
- `libs/backend/platform-core/src/tokens.ts` (PLATFORM_TOKENS)
- `apps/ptah-electron/src/di/container.ts` (Electron DI)
