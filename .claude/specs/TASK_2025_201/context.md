# TASK_2025_201: Electron App — Complete Missing RPC Methods and DI Gaps

## Task Type: BUGFIX

## Complexity: Medium

## Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)

## User Request

The Electron app (TASK_2025_200) builds and launches but is partially non-functional because ~19 RPC methods the Angular frontend calls are not registered in the Electron RPC handlers, and 2 DI tokens are missing. Fix all gaps so the Electron app has full feature parity with the VS Code extension.

## Issues to Fix

### 1. Missing RPC Methods (~19 methods)

The Angular frontend (`libs/frontend/core/src/lib/services/claude-rpc.service.ts`) calls these RPC methods that are NOT registered in the Electron app:

**Chat Continuation (CRITICAL — breaks core UX):**

- `chat:continue` — Continue an existing chat session with a new message
- `chat:resume` — Resume a previously stopped session
- `chat:running-agents` — Query currently running agent sessions
- `chat:abort` — May be registered but needs verification
- `agent:stop` — Stop a running agent

**Configuration (breaks settings panel):**

- `config:autopilot-get` — Get autopilot enabled state
- `config:autopilot-toggle` — Toggle autopilot mode
- `config:models-list` — List available AI models
- `config:model-switch` — Switch active model
- `command:execute` — Execute a registered command

**Setup Wizard (breaks wizard entirely):**

- `setup-wizard:launch` — Launch the setup wizard
- `wizard:cancel` — Cancel wizard
- `wizard:cancel-analysis` — Cancel ongoing analysis
- `wizard:deep-analyze` — Run deep workspace analysis
- `wizard:list-analyses` — List saved analyses
- `wizard:load-analysis` — Load a saved analysis
- `wizard:recommend-agents` — Get agent recommendations
- `wizard:retry-item` — Retry a failed analysis item
- `wizard:submit-selection` — Submit agent selection

**Quality:**

- `quality:export` — Export quality data

### 2. Missing DI Registrations (2 tokens)

These tokens are resolved in `rpc-method-registration.service.ts` but never registered in `container.ts`:

- `TOKENS.AGENT_DISCOVERY_SERVICE` — Used by `autocomplete:agents` RPC handler
- `TOKENS.COMMAND_DISCOVERY_SERVICE` — Used by `autocomplete:commands` RPC handler

These services come from `workspace-intelligence` and should be registered during the workspace-intelligence phase of the DI container setup.

### 3. Angular Build Path Verification

The `copy-renderer` target in `apps/ptah-electron/project.json` copies from `dist/apps/ptah-extension-webview/browser/`. Need to verify this matches the actual Angular CLI output path. If Angular 20 outputs to `dist/apps/ptah-extension-webview/browser/` (the default for @angular/build), the path is correct. If not, update the copy command.

### 4. End-to-End Smoke Test

After fixing all gaps, verify the following user flows work:

1. Launch Electron app → Angular UI loads
2. Set API key → stored in safeStorage
3. Start new chat → message sent to Claude → response streams back
4. Continue chat → send follow-up message → response streams back
5. Stop/abort chat → agent stops
6. List sessions → previous sessions appear
7. Resume session → load and continue
8. Change model → model switch reflected
9. Open folder → file tree loads in Monaco editor panel
10. Open file → content shows in Monaco editor
11. Save file (Ctrl+S) → file persisted

## Technical Context

- **Branch**: `feature/platform-abstraction-layer`
- **Electron app**: `apps/ptah-electron/`
- **RPC handler files**:
  - `apps/ptah-electron/src/services/rpc/rpc-handler-setup.ts` (core methods)
  - `apps/ptah-electron/src/services/rpc/rpc-method-registration.service.ts` (extended methods)
- **DI container**: `apps/ptah-electron/src/di/container.ts`
- **VS Code RPC reference**: `apps/ptah-extension-vscode/src/services/rpc/handlers/*.ts` (all handler classes)
- **Frontend RPC calls**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`

## Key Constraint

The VS Code RPC handler classes in `apps/ptah-extension-vscode/src/services/rpc/handlers/` are app-level code that cannot be imported cross-app. The Electron app must either:

1. Register inline RPC methods (current pattern in `rpc-method-registration.service.ts`)
2. Or extract shared handler logic into a library (larger refactor, not recommended for this task)

## Dependencies

- TASK_2025_199 (Platform Abstraction Layer) — COMPLETE
- TASK_2025_200 (Electron Application) — COMPLETE
