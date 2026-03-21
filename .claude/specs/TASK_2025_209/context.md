# TASK_2025_209: Platform Unification — Remove vscode.lm, Unify RPC Handlers

## User Intent

Complete platform unification so VS Code extension and Electron app share identical LLM paths. Remove `ptah.ai` namespace (replaced by CLI tools), eliminate vscode.lm dependency, unify duplicate Electron RPC handlers.

## Task Type

REFACTORING

## Strategy

Partial: Architect -> Team-Leader -> Developers -> QA

## Three Workstreams

### WS1: Remove `ptah.ai` namespace

- Delete `buildAINamespace()` and all related functions from `system-namespace.builders.ts`
- Remove all vscode.lm usage from that file
- Update system prompt that references ptah.ai methods

### WS2: Replace remaining vscode.lm usage

- `VsCodeLmProvider` -> use Anthropic SDK / Agent SDK internal query
- `VsCodeModelDiscovery` -> use provider registry
- `LlmRpcHandlers` -> use provider registry, not vscode.lm.selectChatModels
- Agent generation `vscode-lm.service.ts` -> use shared LLM path
- Copilot SDK adapter -> `import type * as vscode`, platform auth abstraction

### WS3: Unify Electron RPC handlers

- REMOVE: ElectronSessionExtendedRpcHandlers, ElectronLayoutRpcHandlers
- MOVE TO SHARED: ElectronChatExtendedRpcHandlers, ElectronAgentRpcHandlers
- UNIFY: ElectronLlmRpcHandlers (merge into shared after vscode.lm removal)
- KEEP: ElectronWorkspaceRpcHandlers, ElectronFileRpcHandlers, ElectronCommandRpcHandlers, ElectronEditorRpcHandlers, ElectronAuthExtendedRpcHandlers, ElectronConfigExtendedRpcHandlers

## Goal

ONE unified LLM path. No vscode.lm. Identical experience in both platforms.
