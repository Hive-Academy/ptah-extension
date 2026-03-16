# TASK_2025_200: Research — Electron Application Architecture for Ptah

## Task Type: FEATURE

## Complexity: Medium

## Workflow: Research (Researcher -> conditional Architect)

## User Request

Research creating a new Electron application that leverages the existing Nx monorepo, Angular frontend, and the newly created platform abstraction layer (TASK_2025_199) to build a standalone Ptah desktop app that runs without VS Code.

## Research Questions

1. **Nx + Electron Integration**:

   - What's the best approach for adding an Electron app to an Nx monorepo?
   - Are there Nx plugins for Electron (e.g., `nx-electron`, `@nickreese/nx-electron`)?
   - How to configure project.json for Electron build/serve/package targets?
   - How to share the existing Angular webview as the Electron renderer process?

2. **Angular in Electron**:

   - How to reuse the existing `ptah-extension-webview` Angular SPA as the Electron renderer?
   - What changes are needed (if any) to the Angular app for Electron compatibility?
   - How does the RPC/messaging layer change? (Currently uses VS Code postMessage, would need Electron IPC)
   - Can we use `contextBridge`/`preload` scripts with Angular's build system?

3. **Platform-Electron Implementation**:

   - What would `libs/backend/platform-electron` look like?
   - How to implement each platform interface for Electron:
     - `IFileSystemProvider` → Node.js `fs/promises`
     - `IStateStorage` → electron-store or JSON file
     - `ISecretStorage` → Electron's safeStorage or system keychain (keytar)
     - `IWorkspaceProvider` → file dialog + recent projects
     - `IUserInteraction` → Electron dialog API
     - `IOutputChannel` → Console/log file
     - `ICommandRegistry` → Electron menu/accelerators
     - `IEditorProvider` → N/A or Monaco editor integration
   - How does DI container setup differ from VS Code extension?

4. **Backend Service Integration**:

   - Can the same tsyringe DI container work in Electron's main process?
   - How to run `agent-sdk`, `workspace-intelligence`, `agent-generation` etc. in Electron main process?
   - How does the Claude Agent SDK work outside VS Code? (API key auth instead of OAuth?)
   - What about `llm-abstraction` — need non-VS Code LM providers?

5. **Build & Distribution**:

   - electron-builder vs electron-forge for packaging?
   - Auto-update strategy (electron-updater)?
   - Code signing for macOS/Windows?
   - How to handle native dependencies (if any)?
   - Bundle size considerations

6. **IPC Architecture**:
   - How to bridge Angular frontend (renderer) with backend services (main process)?
   - Can we create an IPC adapter that matches the existing RPC contract?
   - contextBridge + preload pattern for secure IPC?

## Expected Deliverables

- Research report with findings, recommendations, and trade-offs
- Recommended architecture diagram
- Dependency list (Electron version, plugins, tools)
- Risk assessment
- Prototype plan (if applicable)

## Context

- TASK_2025_199 created `platform-core` (interfaces) and `platform-vscode` (VS Code implementations)
- The Angular webview (`ptah-extension-webview`) is a standalone SPA that communicates via RPC
- Backend libraries now depend on `platform-core` interfaces, not VS Code APIs directly
- The project uses Nx 21/22, Angular 20, TypeScript 5.8, tsyringe DI
