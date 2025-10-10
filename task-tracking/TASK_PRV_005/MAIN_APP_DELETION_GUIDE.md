# Main App Deletion Guide - What Gets Removed

**Context**: Cleaning up `apps/ptah-extension-vscode/` after workspace-intelligence extraction  
**Date**: October 10, 2025

---

## 🗑️ Files That Will Be DELETED

### 1. **service-registry.ts** - Custom DI System ✅ ALREADY MARKED FOR DELETION

**File**: `apps/ptah-extension-vscode/src/core/service-registry.ts` (188 lines)

**Why Delete**:

- Custom DI system replaced by TSyringe (vscode-core library)
- Violates MONSTER plan (Week 2-3: "Delete custom DI")
- Hard to test, not type-safe

**What It Does Now**:

```typescript
export class ServiceRegistry {
  private services = {};

  async initialize() {
    this.services.workspaceManager = new WorkspaceManager();
    this.services.claudeCliService = new ClaudeCliService();
    // ... manual service instantiation
  }
}
```

**Replaced By**:

```typescript
// TSyringe DI Container from vscode-core
const container = DIContainer.setup(context);
registerWorkspaceIntelligenceServices(container);
registerClaudeDomainServices(container);

// Services auto-injected via @inject() decorators
```

**Status**: ⏸️ Keep for now until all services migrated, then DELETE

---

### 2. **workspace-manager.ts** - Monolithic Workspace Service 🔜 DELETE NEXT (Step 3.3)

**File**: `apps/ptah-extension-vscode/src/services/workspace-manager.ts` (460 lines)

**Why Delete**:

- Completely replaced by workspace-intelligence library (10 specialized services)
- Mixed VS Code APIs + business logic (violates separation of concerns)
- Not reusable, hard to test

**What It Does Now** (excerpt):

```typescript
export class WorkspaceManager {
  detectProjectType(path: string): string {
    // 100+ lines of project detection
    const files = fs.readdirSync(path); // Direct Node.js fs
    if (files.includes('package.json')) {
      // ... framework detection mixed in
    }
  }

  getCurrentWorkspaceInfo(): WorkspaceInfo {
    // 80+ lines of workspace analysis
  }

  // ... 300+ more lines of mixed logic
}
```

**Replaced By**:

```typescript
// workspace-intelligence library (clean separation)
@injectable()
export class WorkspaceAnalyzerService {
  constructor(@inject(TOKENS.PROJECT_DETECTOR_SERVICE) private projectDetector, @inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE) private frameworkDetector, @inject(TOKENS.WORKSPACE_INDEXER_SERVICE) private indexer) {}

  async analyzeWorkspace(): Promise<WorkspaceAnalysisResult> {
    // Composes specialized services
  }
}
```

**Current References**:

- ✅ `service-registry.ts` line 6, 24, 59, 174 (will be deleted with service-registry)
- ⚠️ Need to check `ptah-extension.ts` and other files

**Status**: 🔜 DELETE in Step 3.3 (1 hour away!)

---

### 3. **claude-cli.service.ts** - Claude Integration ⏸️ DELETE LATER (Week 5-6)

**File**: `apps/ptah-extension-vscode/src/services/claude-cli.service.ts` (~500+ lines)

**Why Delete**:

- Will move to `libs/backend/claude-domain/` library
- Mixed VS Code APIs, process management, streaming logic
- Should be in dedicated claude-domain library per MONSTER plan

**What It Does Now**:

- Claude CLI detection and verification
- Process spawning and management
- Message streaming and response handling
- Session management (mixed with claude-specific logic)

**Replaced By**:

```typescript
// libs/backend/claude-domain/src/cli/claude-cli-adapter.ts
@injectable()
export class ClaudeCliAdapter implements EnhancedAIProvider {
  // Implements provider interface
  // Uses workspace-intelligence for context
  // Uses vscode-core for VS Code APIs
}
```

**Status**: ⏸️ Keep for now, DELETE in Week 5-6 after claude-domain library created

---

## 🔄 Files That Will Be MODIFIED (Not Deleted)

### 1. **main.ts** - Composition Root ✅ MODIFY (Step 3.2)

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Current State**:

```typescript
import { ServiceRegistry } from './core/service-registry';

export async function activate(context: vscode.ExtensionContext) {
  const serviceRegistry = new ServiceRegistry(context);
  const services = await serviceRegistry.initialize();

  const extension = new PtahExtension(context, services);
  await extension.activate();
}
```

**Will Change To**:

```typescript
import { DIContainer } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
// import { registerClaudeDomainServices } from '@ptah-extension/claude-domain'; // Week 5-6

export async function activate(context: vscode.ExtensionContext) {
  // Step 1: Setup infrastructure (vscode-core only)
  const container = DIContainer.setup(context);

  // Step 2: Register domain services
  registerWorkspaceIntelligenceServices(container);
  // registerClaudeDomainServices(container); // Week 5-6

  // Step 3: Resolve and start
  const extension = container.resolve<PtahExtension>(TOKENS.PTAH_EXTENSION);
  await extension.activate();
}
```

**Changes**:

- ❌ Remove: `ServiceRegistry` import and usage
- ✅ Add: `DIContainer.setup()` from vscode-core
- ✅ Add: `registerWorkspaceIntelligenceServices()` call
- ✅ Add: Service resolution via DI container

---

### 2. **ptah-extension.ts** - Main Extension Class 🔄 REFACTOR

**File**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

**Current State** (likely):

```typescript
export class PtahExtension {
  constructor(
    private context: vscode.ExtensionContext,
    private services: ServiceDependencies // From ServiceRegistry
  ) {}

  async activate() {
    // Uses this.services.workspaceManager
    // Uses this.services.claudeCliService
  }
}
```

**Will Change To**:

```typescript
@injectable()
export class PtahExtension {
  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private context: vscode.ExtensionContext,
    @inject(TOKENS.WORKSPACE_ANALYZER) private workspaceAnalyzer: WorkspaceAnalyzerService,
    @inject(TOKENS.CLAUDE_CLI_SERVICE) private claudeService: ClaudeCliService,
    @inject(TOKENS.SESSION_MANAGER) private sessionManager: SessionManager // ... other services via DI
  ) {}

  async activate() {
    // Services auto-injected!
    const workspaceInfo = await this.workspaceAnalyzer.analyzeWorkspace();
  }
}
```

**Changes**:

- ✅ Add: `@injectable()` decorator
- ❌ Remove: Manual service passing via constructor
- ✅ Add: `@inject(TOKENS.X)` for each dependency
- 🔄 Update: All `this.services.workspaceManager` → `this.workspaceAnalyzer`

---

## 📋 Complete Deletion Checklist

### Phase 1: Step 3.2 - Move Registration (CURRENT)

**Modify**:

- ✅ `apps/ptah-extension-vscode/src/main.ts`
  - Remove ServiceRegistry usage
  - Add DIContainer.setup() + registerWorkspaceIntelligenceServices()

**Don't Delete Yet**:

- ⏸️ `service-registry.ts` - Keep until all services migrated
- ⏸️ `workspace-manager.ts` - Keep until Step 3.3

---

### Phase 2: Step 3.3 - Delete workspace-manager.ts (NEXT)

**Delete**:

- ❌ `apps/ptah-extension-vscode/src/services/workspace-manager.ts` (460 lines)

**Create in workspace-intelligence**:

- ✅ `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts`

**Modify**:

- 🔄 `service-registry.ts` - Remove WorkspaceManager reference (lines 6, 24, 59, 174)
- 🔄 Any other files importing `WorkspaceManager`

**Search for references**:

```bash
grep -r "WorkspaceManager" apps/ptah-extension-vscode/src/
grep -r "workspace-manager" apps/ptah-extension-vscode/src/
```

---

### Phase 3: Week 5-6 - Delete Claude Service (FUTURE)

**Delete**:

- ❌ `apps/ptah-extension-vscode/src/services/claude-cli.service.ts`
- ❌ `apps/ptah-extension-vscode/src/services/claude-cli-detector.service.ts`

**Create in claude-domain**:

- ✅ `libs/backend/claude-domain/src/cli/claude-cli-adapter.ts`
- ✅ `libs/backend/claude-domain/src/cli/claude-cli-detector.ts`
- ✅ `libs/backend/claude-domain/src/di/register.ts`

**Modify**:

- 🔄 `service-registry.ts` - Remove ClaudeCliService (if still exists)
- 🔄 `main.ts` - Add `registerClaudeDomainServices(container)`

---

### Phase 4: Complete ServiceRegistry Deletion (FINAL)

**Delete**:

- ❌ `apps/ptah-extension-vscode/src/core/service-registry.ts` (188 lines)

**When**: After ALL services migrated to libraries

- ✅ workspace-intelligence services migrated
- ✅ claude-domain services migrated
- ✅ All remaining services use TSyringe DI

---

## 📊 Complete Files Summary Table (MONSTER Plan Compliant)

| File                              | Lines | Status      | Delete When          | Replaced By                      |
| --------------------------------- | ----- | ----------- | -------------------- | -------------------------------- |
| `service-registry.ts`             | 188   | ❌ DELETE   | After all migrations | TSyringe DI (vscode-core)        |
| `workspace-manager.ts`            | 460   | ❌ DELETE   | Step 3.3 (NEXT!)     | workspace-intelligence library   |
| `claude-cli.service.ts`           | ~500  | ❌ DELETE   | Week 5-6             | claude-domain library            |
| `claude-cli-detector.service.ts`  | ~100  | ❌ DELETE   | Week 5-6             | claude-domain library            |
| **`command-registry.ts`**         | ~150  | ❌ DELETE   | Week 3               | CommandManager (vscode-core)     |
| **`event-registry.ts`**           | ~100  | ❌ DELETE   | Week 2               | EventBus (vscode-core) ✅ EXISTS |
| **`webview-registry.ts`**         | ~120  | ❌ DELETE   | Week 3               | WebviewManager (vscode-core)     |
| **`session-manager.ts`**          | ~200  | ❌ DELETE   | Week 4-5             | ptah-session library             |
| **`context-manager.ts`**          | ~180  | ❌ DELETE   | Week 4-5             | ai-providers-core/context        |
| **`logger.ts`**                   | ~80   | ❌ DELETE   | Week 2               | vscode-core/logging              |
| **`error-handler.ts`**            | ~100  | ❌ DELETE   | Week 2               | vscode-core/error-handling       |
| **`ptah-config.service.ts`**      | ~150  | ❌ DELETE   | Week 2               | vscode-core/config               |
| **`command-handlers.ts`**         | ~200  | ❌ DELETE   | Week 3               | Use CommandManager directly      |
| **`angular-webview.provider.ts`** | ~300  | ❌ DELETE   | Week 3               | WebviewManager (vscode-core)     |
| **`analytics-data-collector.ts`** | ~150  | ❌ DELETE   | Week 7               | ptah-analytics library           |
| **`webview-diagnostic.ts`**       | ~80   | ❌ DELETE   | Week 3               | vscode-core dev tools            |
| **`webview-html-generator.ts`**   | ~120  | ❌ DELETE   | Week 3               | WebviewManager handles this      |
| **`ai-providers/` folder**        | ~400  | ❌ DELETE   | Week 4-6             | ai-providers-core library        |
| **`validation/` folder**          | ~100  | ❌ DELETE   | Week 2               | Zod validation in shared         |
| `main.ts`                         | ~50   | ✅ Modify   | Step 3.2 (now)       | Composition root ONLY            |
| `ptah-extension.ts`               | ~200  | ✅ Refactor | Step 3.3             | Orchestration ONLY               |
| `webview-message-handlers/`       | ~400  | ✅ KEEP     | N/A                  | App-specific UI layer            |

**Total Lines to DELETE Eventually**: ~3,500+ lines (not 1,248!)  
**What STAYS**: ~650 lines (main.ts + ptah-extension.ts + webview-message-handlers)  
**Next Immediate Deletion**: 460 lines (workspace-manager.ts in Step 3.3)

---

## ❌ MORE FILES TO DELETE (Following MONSTER Plan)

### 4. **command-registry.ts** - Custom Command System ❌ DELETE

**File**: `apps/ptah-extension-vscode/src/registries/command-registry.ts`

**Why Delete**:

- MONSTER Plan Week 3: CommandManager in vscode-core library
- Custom implementation replaced by `CommandManager` from `@ptah-extension/vscode-core`

**Replaced By**:

```typescript
// libs/backend/vscode-core/src/api-wrappers/command-manager.ts (from MONSTER plan)
@injectable()
export class CommandManager {
  registerCommand<T>(definition: CommandDefinition<T>): void;
  registerCommands(commands: CommandDefinition[]): void;
}
```

---

### 5. **event-registry.ts** - Custom Event System ❌ DELETE

**File**: `apps/ptah-extension-vscode/src/registries/event-registry.ts`

**Why Delete**:

- MONSTER Plan Week 2: EventBus already exists in vscode-core ✅
- Custom implementation replaced by RxJS-based `EventBus`

**Replaced By**:

```typescript
// libs/backend/vscode-core/src/messaging/event-bus.ts (ALREADY EXISTS!)
@injectable()
export class EventBus {
  publish<T>(type: T, payload: MessagePayloadMap[T]): void;
  subscribe<T>(messageType: T): Observable<TypedEvent<T>>;
}
```

---

### 6. **webview-registry.ts** - Custom Webview System ❌ DELETE

**File**: `apps/ptah-extension-vscode/src/registries/webview-registry.ts`

**Why Delete**:

- MONSTER Plan Week 3: WebviewManager in vscode-core library
- Custom implementation replaced by `WebviewManager` from `@ptah-extension/vscode-core`

**Replaced By**:

```typescript
// libs/backend/vscode-core/src/api-wrappers/webview-manager.ts (from MONSTER plan)
@injectable()
export class WebviewManager {
  createWebviewPanel<T>(viewType: string, title: string, initialData?: T): vscode.WebviewPanel;
}
```

---

### 7. **session-manager.ts** - Session Logic ❌ DELETE (Move to Library)

**File**: `apps/ptah-extension-vscode/src/services/session-manager.ts`

**Why Delete**:

- MONSTER Plan has dedicated `ptah-session` library
- Mixed backend/frontend session logic should be in library

**Move To**:

```typescript
// libs/backend/ptah-session/src/backend/session-manager.ts
@injectable()
export class SessionManager {
  // Session creation, lifecycle, persistence
}
```

---

### 8. **context-manager.ts** - Context Window Logic ❌ DELETE (Move to Library)

**File**: `apps/ptah-extension-vscode/src/services/context-manager.ts`

**Why Delete**:

- MONSTER Plan: Context management in `ai-providers-core/context/`
- AI context window logic belongs with provider system

**Move To**:

```typescript
// libs/backend/ai-providers-core/src/context/context-manager.ts
@injectable()
export class ContextManager {
  // Context window optimization, token counting
}
```

---

## 🎯 What ACTUALLY STAYS in Main App (Minimal!)

### ONLY These Files Stay:

```
apps/ptah-extension-vscode/src/
├── main.ts                          ✅ ONLY composition root!
├── core/
│   └── ptah-extension.ts            ✅ ONLY orchestration!
└── services/
    └── webview-message-handlers/    ✅ ONLY app-specific UI handlers
```

**That's it!** Everything else goes to libraries per MONSTER plan.

---

## ✅ Immediate Next Steps

### 1. Finish Step 3.2 (2 hours)

- ✅ Create `registerWorkspaceIntelligenceServices()` function
- ✅ Update `main.ts` to use DI container
- ✅ Validate (build + F5)

### 2. Execute Step 3.3 (1 hour)

- ❌ **DELETE** `workspace-manager.ts` (460 lines)
- ✅ Create `WorkspaceAnalyzerService` composite
- 🔄 Update all references
- 🔄 Refactor `ptah-extension.ts` to use DI

### 3. Cleanup service-registry.ts references

- Remove `WorkspaceManager` from service-registry.ts
- Continue migrating other services

---

## 🚀 The REAL Vision: Ultra-Clean Main App (MONSTER Plan)

**After MONSTER refactor complete, main app will ONLY be**:

```typescript
// apps/ptah-extension-vscode/src/main.ts (30 lines!)
import { DIContainer } from '@ptah-extension/vscode-core';
import { registerWorkspaceIntelligenceServices } from '@ptah-extension/workspace-intelligence';
import { registerClaudeDomainServices } from '@ptah-extension/claude-domain';
import { registerAIProvidersServices } from '@ptah-extension/ai-providers-core';
import { registerSessionServices } from '@ptah-extension/ptah-session';
import { TOKENS } from '@ptah-extension/vscode-core';

export async function activate(context: vscode.ExtensionContext) {
  // Setup infrastructure
  const container = DIContainer.setup(context);

  // Register all domain services
  registerWorkspaceIntelligenceServices(container);
  registerClaudeDomainServices(container);
  registerAIProvidersServices(container);
  registerSessionServices(container);

  // Resolve and start
  const extension = container.resolve<PtahExtension>(TOKENS.PTAH_EXTENSION);
  await extension.activate();
}

export function deactivate() {
  DIContainer.dispose();
}
```

```typescript
// apps/ptah-extension-vscode/src/core/ptah-extension.ts (100 lines!)
@injectable()
export class PtahExtension {
  constructor(@inject(TOKENS.COMMAND_MANAGER) private commands: CommandManager, @inject(TOKENS.WEBVIEW_MANAGER) private webviews: WebviewManager, @inject(TOKENS.EVENT_BUS) private eventBus: EventBus, @inject(TOKENS.WORKSPACE_ANALYZER) private workspaceAnalyzer: WorkspaceAnalyzerService, @inject(TOKENS.CLAUDE_CLI_ADAPTER) private claude: ClaudeCliAdapter, @inject(TOKENS.SESSION_MANAGER) private sessions: SessionManager, @inject(TOKENS.PROVIDER_MANAGER) private providers: ProviderManager) {}

  async activate() {
    // Orchestration only - all logic in libraries!
    this.setupCommands();
    this.setupWebviews();
    this.setupEventHandlers();
  }

  private setupCommands() {
    // Use CommandManager from vscode-core
  }

  private setupWebviews() {
    // Use WebviewManager from vscode-core
  }

  private setupEventHandlers() {
    // Use EventBus from vscode-core
  }
}
```

```typescript
// apps/ptah-extension-vscode/src/services/webview-message-handlers/
// Chat message handler, context handler, etc. - ONLY UI-specific logic
```

**That's the entire main app!**

**All Business Logic Lives In**:

```
libs/backend/
├── vscode-core/           # Infrastructure (EventBus ✅, CommandManager, WebviewManager, Logger, Config)
├── workspace-intelligence/ # Workspace analysis (10 services ✅)
├── claude-domain/         # Claude CLI integration
├── ai-providers-core/     # Multi-provider system + ContextManager
└── ptah-session/          # Session management

libs/frontend/
├── chat/                  # Chat UI components
├── session/               # Session UI components
├── analytics/             # Analytics UI components
└── shared-ui/             # Shared Angular components
```

---

**Net Result**:

- **Main App**: ~650 lines (composition root + UI handlers)
- **All Libraries**: ~15,000+ lines of tested, reusable business logic
- **Deletions from main app**: ~3,500 lines moved to libraries

**Philosophy**: Main app is just the **thin glue layer** that composes libraries together!

---

**Current Status**: Ready to delete 460 lines in Step 3.3! 🎉
