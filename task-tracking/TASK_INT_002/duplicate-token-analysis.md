# Duplicate Token Analysis & Consolidation Plan

**Date**: January 15, 2025  
**Branch**: feature/TASK_INT_002-integration-analysis  
**Status**: 🔴 Critical - Multiple Duplicate Tokens Found

## Duplicate Tokens Identified

### 🔴 HIGH PRIORITY - Duplicates Across Libraries

| Token Name                          | Defined In                                                                                                                | Symbol.for() Value               | Count | Issue                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----- | ----------------------- |
| **EVENT_BUS**                       | vscode-core/di/tokens.ts<br>claude-domain/events/claude-domain.events.ts                                                  | `'EventBus'`                     | 2     | ⚠️ Different libraries  |
| **CONTEXT_ORCHESTRATION_SERVICE**   | vscode-core/di/tokens.ts<br>message-handler.service.ts                                                                    | `'ContextOrchestrationService'`  | 2     | ⚠️ Different scopes     |
| **SESSION_MANAGER**                 | vscode-core/di/tokens.ts<br>chat-orchestration.service.ts<br>command.service.ts                                           | `'SessionManager'`               | 3     | ⚠️ Multiple definitions |
| **CONTEXT_SERVICE**                 | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts<br>context-orchestration.service.ts<br>command.service.ts | `'ContextService'`               | 4     | 🔴 CRITICAL             |
| **FILE_SYSTEM_SERVICE**             | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'FileSystemService'`            | 2     | ⚠️ Library duplication  |
| **TOKEN_COUNTER_SERVICE**           | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'TokenCounterService'`          | 2     | ⚠️ Library duplication  |
| **PROJECT_DETECTOR_SERVICE**        | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'ProjectDetectorService'`       | 2     | ⚠️ Library duplication  |
| **FRAMEWORK_DETECTOR_SERVICE**      | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'FrameworkDetectorService'`     | 2     | ⚠️ Library duplication  |
| **DEPENDENCY_ANALYZER_SERVICE**     | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'DependencyAnalyzerService'`    | 2     | ⚠️ Library duplication  |
| **MONOREPO_DETECTOR_SERVICE**       | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'MonorepoDetectorService'`      | 2     | ⚠️ Library duplication  |
| **PATTERN_MATCHER_SERVICE**         | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'PatternMatcherService'`        | 2     | ⚠️ Library duplication  |
| **IGNORE_PATTERN_RESOLVER_SERVICE** | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'IgnorePatternResolverService'` | 2     | ⚠️ Library duplication  |
| **FILE_TYPE_CLASSIFIER_SERVICE**    | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'FileTypeClassifierService'`    | 2     | ⚠️ Library duplication  |
| **WORKSPACE_INDEXER_SERVICE**       | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'WorkspaceIndexerService'`      | 2     | ⚠️ Library duplication  |
| **FILE_INDEXER_SERVICE**            | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'FileIndexerService'`           | 2     | ⚠️ Library duplication  |
| **WORKSPACE_ANALYZER_SERVICE**      | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'WorkspaceAnalyzerService'`     | 2     | ⚠️ Library duplication  |
| **WORKSPACE_SERVICE**               | vscode-core/di/tokens.ts<br>workspace-intelligence/di/tokens.ts                                                           | `'WorkspaceService'`             | 2     | ⚠️ Library duplication  |

### 🟡 MEDIUM PRIORITY - Same Library Duplicates

| Token Name                   | Defined In                                     | Count | Issue                  |
| ---------------------------- | ---------------------------------------------- | ----- | ---------------------- |
| **CLAUDE_CLI_LAUNCHER**      | vscode-core/di/tokens.ts<br>command.service.ts | 2     | Both define same token |
| **STORAGE_SERVICE**          | session-manager.ts (only)                      | 1     | ✅ No duplicate        |
| **PROVIDER_MANAGER**         | provider-orchestration.service.ts (only)       | 1     | ✅ No duplicate        |
| **CONFIGURATION_PROVIDER**   | config-orchestration.service.ts (only)         | 1     | ✅ No duplicate        |
| **ANALYTICS_DATA_COLLECTOR** | analytics-orchestration.service.ts (only)      | 1     | ✅ No duplicate        |

---

## Root Cause Analysis

### Problem 1: vscode-core as "God Token Registry"

**Issue**: `vscode-core/src/di/tokens.ts` contains **51 token definitions** including tokens for:

- Its own services (EventBus, Logger, ErrorHandler) ✅ OK
- Claude domain services (CLAUDE_CLI_DETECTOR, SESSION_MANAGER, etc.) ❌ WRONG
- Workspace intelligence services (ALL 13 services) ❌ WRONG
- Orchestration services (CHAT_ORCHESTRATION_SERVICE, etc.) ❌ WRONG

**Why This Is Wrong**:

1. **Violates Library Boundaries**: vscode-core shouldn't know about claude-domain or workspace-intelligence
2. **Circular Dependencies**: Libraries can't import from vscode-core if vscode-core defines their tokens
3. **Maintenance Nightmare**: Every new service requires updating vscode-core
4. **No Single Source of Truth**: Same token defined in multiple places

### Problem 2: Service-Level Token Definitions

**Issue**: Individual service files define their own tokens:

- `claude-domain/src/events/claude-domain.events.ts` defines `EVENT_BUS`
- `chat-orchestration.service.ts` defines `SESSION_MANAGER` and `CLAUDE_CLI_SERVICE`
- `command.service.ts` defines `CONTEXT_SERVICE`, `SESSION_MANAGER`, `CLAUDE_CLI_LAUNCHER`

**Why This Happens**:

- Services need tokens for `@inject()` decorators
- Can't import from vscode-core (would create circular dependency)
- Define locally as "workaround"

### Problem 3: Library-Level Token Duplication

**Issue**: Both `vscode-core` and `workspace-intelligence` define identical tokens:

- `FILE_SYSTEM_SERVICE`
- `TOKEN_COUNTER_SERVICE`
- `PROJECT_DETECTOR_SERVICE`
- ... (13 total duplicates)

**Why This Happens**:

- workspace-intelligence needs tokens internally for `@inject()`
- vscode-core needs same tokens for passing to `registerWorkspaceIntelligenceServices()`
- Both define independently → duplication

---

## Correct Architecture Pattern

### Principle: **Each Library Owns Its Tokens**

```
┌─────────────────────────────────────────────┐
│ Library: workspace-intelligence            │
│                                             │
│  src/di/tokens.ts                          │
│  └─ export const FILE_SYSTEM_SERVICE       │
│  └─ export const TOKEN_COUNTER_SERVICE     │
│  └─ ... (all workspace-intelligence tokens)│
│                                             │
│  src/di/register.ts                        │
│  └─ export interface LibraryTokens         │
│  └─ registerServices(container, tokens)    │
└─────────────────────────────────────────────┘
                  │
                  │ exports tokens
                  ▼
┌─────────────────────────────────────────────┐
│ Main App: ptah-extension-vscode/src/main.ts│
│                                             │
│  import { TOKENS } from vscode-core         │
│  import {                                   │
│    FILE_SYSTEM_SERVICE as WI_FILE_SYSTEM,  │
│    TOKEN_COUNTER_SERVICE as WI_TOKEN_COUNT │
│  } from workspace-intelligence              │
│                                             │
│  const tokens = {                           │
│    FILE_SYSTEM_SERVICE: TOKENS.FILE_SYSTEM │
│  }                                          │
│  registerWorkspaceIntelligence(tokens)      │
└─────────────────────────────────────────────┘
```

**Key Points**:

1. ✅ Library defines its own tokens in `src/di/tokens.ts`
2. ✅ Library exports tokens via `src/index.ts`
3. ✅ Main app imports library tokens
4. ✅ Main app maps vscode-core TOKENS to library tokens
5. ✅ No duplication - single source of truth per library

---

## Consolidation Strategy

### Phase 1: Remove vscode-core Token Pollution

**Files to Modify**:

- `libs/backend/vscode-core/src/di/tokens.ts`

**Actions**:

1. **KEEP** (vscode-core owns these):

   - EXTENSION_CONTEXT
   - WEBVIEW_PROVIDER
   - COMMAND_REGISTRY
   - EVENT_BUS
   - MESSAGE_ROUTER
   - OUTPUT_MANAGER
   - STATUS_BAR_MANAGER
   - FILE_SYSTEM_MANAGER
   - LOGGER
   - ERROR_HANDLER
   - CONFIG_MANAGER
   - MESSAGE_VALIDATOR
   - CONTEXT_MANAGER (ContextManager from ai-providers-core)

2. **REMOVE** (claude-domain owns these):

   - CLAUDE_CLI_DETECTOR
   - CLAUDE_CLI_LAUNCHER
   - CLAUDE_SESSION_MANAGER (rename to just SESSION_MANAGER in claude-domain)
   - CLAUDE_PERMISSION_SERVICE
   - CLAUDE_PROCESS_MANAGER
   - CLAUDE_DOMAIN_EVENT_PUBLISHER
   - CHAT_ORCHESTRATION_SERVICE
   - PROVIDER_ORCHESTRATION_SERVICE
   - ANALYTICS_ORCHESTRATION_SERVICE
   - CONFIG_ORCHESTRATION_SERVICE
   - MESSAGE_HANDLER_SERVICE
   - SESSION_MANAGER

3. **REMOVE** (workspace-intelligence owns these):

   - TOKEN_COUNTER_SERVICE
   - FILE_SYSTEM_SERVICE
   - CONTEXT_SERVICE
   - PROJECT_DETECTOR_SERVICE
   - FRAMEWORK_DETECTOR_SERVICE
   - DEPENDENCY_ANALYZER_SERVICE
   - MONOREPO_DETECTOR_SERVICE
   - PATTERN_MATCHER_SERVICE
   - IGNORE_PATTERN_RESOLVER_SERVICE
   - FILE_TYPE_CLASSIFIER_SERVICE
   - WORKSPACE_INDEXER_SERVICE
   - FILE_INDEXER_SERVICE
   - WORKSPACE_ANALYZER_SERVICE
   - WORKSPACE_SERVICE
   - CONTEXT_ORCHESTRATION_SERVICE
   - FILE_RELEVANCE_SCORER
   - CONTEXT_SIZE_OPTIMIZER
   - SEMANTIC_CONTEXT_EXTRACTOR

4. **REMOVE** (ai-providers-core owns these):
   - AI_PROVIDER_FACTORY
   - AI_PROVIDER_MANAGER
   - PROVIDER_STRATEGY

### Phase 2: Consolidate Library-Internal Tokens

**claude-domain** tokens to consolidate:

```typescript
// libs/backend/claude-domain/src/di/tokens.ts (CREATE THIS FILE)

// Infrastructure tokens (used across multiple services)
export const EVENT_BUS = Symbol.for('EventBus');
export const STORAGE_SERVICE = Symbol.for('StorageService');
export const CONTEXT_ORCHESTRATION_SERVICE = Symbol.for('ContextOrchestrationService');

// Core domain service tokens
export const SESSION_MANAGER = Symbol.for('SessionManager');
export const CLAUDE_CLI_DETECTOR = Symbol.for('ClaudeCliDetector');
export const CLAUDE_CLI_SERVICE = Symbol.for('ClaudeCliService');
export const CLAUDE_CLI_LAUNCHER = Symbol.for('ClaudeCliLauncher');
export const PERMISSION_SERVICE = Symbol.for('PermissionService');
export const PROCESS_MANAGER = Symbol.for('ProcessManager');
export const EVENT_PUBLISHER = Symbol.for('ClaudeDomainEventPublisher');

// Orchestration service tokens (for external access)
export const CHAT_ORCHESTRATION_SERVICE = Symbol.for('ChatOrchestrationService');
export const PROVIDER_ORCHESTRATION_SERVICE = Symbol.for('ProviderOrchestrationService');
export const ANALYTICS_ORCHESTRATION_SERVICE = Symbol.for('AnalyticsOrchestrationService');
export const CONFIG_ORCHESTRATION_SERVICE = Symbol.for('ConfigOrchestrationService');
export const MESSAGE_HANDLER_SERVICE = Symbol.for('MessageHandlerService');

// Domain-specific orchestration dependencies
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');
export const CONFIGURATION_PROVIDER = Symbol.for('ConfigurationProvider');
export const ANALYTICS_DATA_COLLECTOR = Symbol.for('AnalyticsDataCollector');
export const CONTEXT_SERVICE = Symbol.for('ContextService');
```

**Update all files to import from `di/tokens.ts`**:

- ✅ claude-domain.events.ts → import EVENT_BUS
- ✅ session-manager.ts → import EVENT_BUS, STORAGE_SERVICE
- ✅ message-handler.service.ts → import EVENT_BUS, CONTEXT_ORCHESTRATION_SERVICE
- chat-orchestration.service.ts → import SESSION_MANAGER, CLAUDE_CLI_SERVICE
- command.service.ts → import CONTEXT_SERVICE, SESSION_MANAGER, CLAUDE_CLI_LAUNCHER
- cli/claude-cli.service.ts → import CLI\_\* tokens (or use main tokens)

### Phase 3: Update Main App Token Mapping

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Current** (❌ WRONG):

```typescript
import { TOKENS } from '@ptah-extension/vscode-core';

const workspaceTokens: WorkspaceIntelligenceTokens = {
  TOKEN_COUNTER_SERVICE: TOKENS.TOKEN_COUNTER_SERVICE, // Duplicate!
  FILE_SYSTEM_SERVICE: TOKENS.FILE_SYSTEM_SERVICE, // Duplicate!
  // ...
};
```

**After** (✅ CORRECT):

```typescript
import { TOKENS } from '@ptah-extension/vscode-core';
import * as WI_TOKENS from '@ptah-extension/workspace-intelligence/di/tokens';
import * as CLAUDE_TOKENS from '@ptah-extension/claude-domain/di/tokens';

const workspaceTokens: WorkspaceIntelligenceTokens = {
  // Use vscode-core infrastructure tokens
  LOGGER: TOKENS.LOGGER,
  CONFIG_MANAGER: TOKENS.CONFIG_MANAGER,

  // Use workspace-intelligence's own tokens
  TOKEN_COUNTER_SERVICE: WI_TOKENS.TOKEN_COUNTER_SERVICE,
  FILE_SYSTEM_SERVICE: WI_TOKENS.FILE_SYSTEM_SERVICE,
  // ...
};

const claudeTokens: ClaudeDomainTokens = {
  // Use claude-domain's own tokens
  CHAT_ORCHESTRATION_SERVICE: CLAUDE_TOKENS.CHAT_ORCHESTRATION_SERVICE,
  PROVIDER_ORCHESTRATION_SERVICE: CLAUDE_TOKENS.PROVIDER_ORCHESTRATION_SERVICE,
  // ...
};
```

---

## Implementation Plan

### Step 1: Create Centralized Token Files (30 min)

1. Create `libs/backend/claude-domain/src/di/tokens.ts`
2. Create `libs/backend/workspace-intelligence/src/di/tokens.ts` (if not exists)
3. Create `libs/backend/ai-providers-core/src/di/tokens.ts` (if not exists)

### Step 2: Consolidate claude-domain Tokens (1 hour)

1. Move all token definitions to `claude-domain/src/di/tokens.ts`
2. Update imports in:
   - claude-domain.events.ts
   - session-manager.ts
   - message-handler.service.ts
   - chat-orchestration.service.ts
   - command.service.ts
   - cli/claude-cli.service.ts
   - provider-orchestration.service.ts
   - analytics-orchestration.service.ts
   - config-orchestration.service.ts
3. Export tokens from `claude-domain/src/index.ts`

### Step 3: Clean Up vscode-core/di/tokens.ts (30 min)

1. Remove all claude-domain tokens
2. Remove all workspace-intelligence tokens
3. Remove all ai-providers-core tokens
4. Keep only vscode-core infrastructure tokens
5. Add comments explaining ownership

### Step 4: Update Main App (30 min)

1. Import tokens from respective libraries
2. Update `workspaceTokens` mapping
3. Update `claudeTokens` mapping
4. Update `aiProvidersTokens` mapping (if needed)

### Step 5: Verification (30 min)

1. Run `npm run typecheck:all`
2. Run `npm run build:extension`
3. Test extension activation
4. Verify no DI resolution errors

---

## Success Criteria

- [ ] **Zero duplicate token definitions** across libraries
- [ ] **Each library owns its tokens** in `src/di/tokens.ts`
- [ ] **vscode-core only contains infrastructure tokens**
- [ ] **All services resolve correctly** via DI
- [ ] **Extension activates without errors**
- [ ] **Clear token ownership documentation**

---

## Estimated Time

- **Phase 1**: 30 min (create token files)
- **Phase 2**: 1 hour (consolidate claude-domain)
- **Phase 3**: 30 min (clean vscode-core)
- **Phase 4**: 30 min (update main app)
- **Phase 5**: 30 min (verification)

**Total**: ~3 hours

---

## Risk Assessment

| Risk                           | Likelihood | Impact | Mitigation                              |
| ------------------------------ | ---------- | ------ | --------------------------------------- |
| Breaking existing imports      | High       | High   | Do in feature branch, test thoroughly   |
| Circular dependencies          | Medium     | High   | Follow library boundary rules strictly  |
| Main app token mapping errors  | Medium     | High   | Type-check will catch at compile time   |
| Runtime DI resolution failures | Low        | High   | Test extension activation before commit |

---

## Next Steps

1. **Create this task as TASK_INT_003** or continue in TASK_INT_002
2. **Follow implementation plan step-by-step**
3. **Test after each phase**
4. **Document final token ownership in DEPENDENCY_INJECTION_PATTERNS.md**
5. **Update copilot-instructions.md with token import patterns**
