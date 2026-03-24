# TASK_2025_199: Platform Abstraction Layer for Multi-Runtime Support

## Task Type: REFACTORING

## Complexity: Complex

## Workflow: Full (PM -> Architect -> Team-Leader -> Developers -> QA)

## User Request

Build a platform abstraction layer to decouple all backend libraries from direct VS Code API dependencies, enabling true standalone Electron app and CLI app support.

## Goal

Create interface abstractions and refactor existing backend libraries so that the core business logic has ZERO direct `import * as vscode from 'vscode'` statements. Instead, all platform-specific functionality flows through injectable interfaces with platform-specific implementations.

## Key Deliverables

1. **`libs/backend/platform-core`** — Platform-agnostic interfaces library

   - `IStateStorage` — Key-value persistence (replaces `ExtensionContext.workspaceState`/`globalState`)
   - `IWorkspaceProvider` — Workspace folder discovery, configuration
   - `IFileSystemProvider` — File read/write/watch/search operations
   - `IUserInteraction` — Error messages, quick picks, input boxes, progress
   - `IOutputChannel` — Logging output channels
   - `ICommandRegistry` — Command registration and execution
   - `ISecretStorage` — Secure credential storage
   - Platform detection utilities

2. **`libs/backend/platform-vscode`** — VS Code implementations

   - Implements all interfaces from platform-core using VS Code APIs
   - Drop-in replacement — existing behavior preserved exactly
   - Registered via DI tokens in extension activation

3. **Backend Library Refactoring** — Remove direct vscode imports from:

   - `agent-sdk` (15+ files with vscode imports → use IStateStorage, IWorkspaceProvider)
   - `workspace-intelligence` (38+ files → use IFileSystemProvider, IWorkspaceProvider)
   - `agent-generation` (10+ files → use IUserInteraction, IWorkspaceProvider)
   - `template-generation` (2 files → use IWorkspaceProvider)
   - `llm-abstraction` (6 files → keep vscode.lm as platform-specific provider)
   - `vscode-lm-tools` (8+ files → use IStateStorage, IUserInteraction)

4. **`vscode-core` Refactoring** — Delegate to platform-vscode where overlapping

## Key Constraints

- Zero breaking changes to existing VS Code extension functionality
- All existing tests must continue passing
- DI token-based injection pattern (tsyringe) must be preserved
- `llm-abstraction` can keep VS Code LM API dependency (it's a VS Code-specific provider)
- `vscode-core` remains VS Code-specific but delegates to platform-vscode for shared concerns

## Current VS Code Coupling Analysis

| Library                | Files w/ vscode | Primary APIs Used          | Decoupling Priority     |
| ---------------------- | --------------- | -------------------------- | ----------------------- |
| vscode-core            | 30+             | All major APIs             | LOW (stays VS Code)     |
| agent-sdk              | 15+             | Memento, config            | HIGH                    |
| workspace-intelligence | 38+             | findFiles, workspace.fs    | HIGH                    |
| agent-generation       | 10+             | window, workspace          | MEDIUM                  |
| template-generation    | 2               | workspace.workspaceFolders | LOW (easy)              |
| llm-abstraction        | 6               | vscode.lm API              | SKIP (VS Code specific) |
| vscode-lm-tools        | 8+              | ExtensionContext, window   | MEDIUM                  |

## Future Enablement

This abstraction layer enables:

- `platform-electron` — Electron app implementations
- `platform-cli` — Node.js CLI implementations
- `platform-web` — Browser-based implementations
- True standalone Ptah apps without VS Code running
