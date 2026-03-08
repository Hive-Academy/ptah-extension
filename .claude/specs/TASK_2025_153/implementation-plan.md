# Implementation Plan - TASK_2025_153: Plugin Configuration Feature

## Architecture Overview

Bundle 4 Hive Academy plugins into the extension and provide a premium-gated UI for users to configure which plugins load in chat sessions. Per-workspace persistence via VS Code workspaceState.

## 7 Phases

### Phase 1: Build Pipeline

- Copy 4 plugin directories from ptah-claude-plugins into assets/plugins/
- Update project.json post-build-copy for dist output
- Verify .vscodeignore doesn't exclude plugins

### Phase 2: Shared Types

- Add PluginInfo and PluginConfigState to rpc.types.ts
- Export from shared barrel

### Phase 3: Backend PluginLoaderService

- Create plugin-loader.service.ts with hardcoded metadata
- Register DI token + singleton
- Initialize from main.ts with extensionPath

### Phase 4: RPC Handlers

- Create plugin-rpc.handlers.ts (list-available, get-config, save-config)
- Register in container.ts and rpc-method-registration.service.ts

### Phase 5: SDK Query Wiring

- Thread pluginPaths through SdkQueryOptionsBuilder → SessionLifecycleManager → SdkAgentAdapter
- Load config at session start in chat-rpc.handlers.ts

### Phase 6: Frontend Components

- PluginStatusWidgetComponent (compact card)
- PluginBrowserModalComponent (full-screen selection)
- Integrate into ChatEmptyStateComponent

### Phase 7: Verification

- Build check, UI check, SDK integration check
