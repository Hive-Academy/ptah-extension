# TASK_2025_226: Decouple vscode-lm-tools MCP Server from VS Code

## User Request

The vscode-lm-tools library (MCP server + code execution tools) is a PREMIUM feature that is currently completely stubbed in Electron via `vscode-lm-tools-shim.ts` (exports `PTAH_SYSTEM_PROMPT = ''`). This is unacceptable — the MCP server and its tools should work in both VS Code and Electron.

The majority of what vscode-lm-tools does should NOT depend on VS Code APIs. It needs to be decoupled from the vscode module and made platform-agnostic using the existing platform abstraction layer (IWorkspaceProvider, IFileSystemProvider, IStateStorage, etc. from TASK_2025_199).

## Critical Importance

- MCP server is a PREMIUM feature — must work for paying users on both platforms
- Currently entirely stubbed/dead in Electron (`PTAH_SYSTEM_PROMPT = ''`)
- The shim means NO MCP tools work in Electron at all
- Code execution, workspace analysis, file operations — all blocked

## Strategy

- **Type**: REFACTORING
- **Workflow**: Full (Architect with deep research required)
- **Key Constraint**: Must work in both VS Code extension AND Electron standalone app
- **Architecture Pattern**: Follow platform abstraction (TASK_2025_199)

## Context

- Platform abstraction layer: TASK_2025_199
- Electron app: TASK_2025_200
- Platform unification: TASK_2025_209
- Current shim: `apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts` (just `export const PTAH_SYSTEM_PROMPT = ''`)
- The library is at: `libs/backend/vscode-lm-tools/`
- Has its own CLAUDE.md: `libs/backend/vscode-lm-tools/CLAUDE.md`

## Key Questions for Architect

1. Which parts of vscode-lm-tools actually need VS Code APIs vs which are pure logic?
2. What's the minimal set of platform abstractions needed?
3. Can the MCP server run standalone (it's HTTP-based)?
4. What about the Ptah API namespaces (workspace, search, symbols, diagnostics, git, ai, files, commands) — which need VS Code vs which are already abstracted?
5. How does the code execution tool work — does it need VS Code?
