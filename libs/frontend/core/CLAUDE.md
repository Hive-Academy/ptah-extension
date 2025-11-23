# libs/frontend/core - Webview Service Layer

## Purpose

The **frontend core library** provides the foundational service layer for the Ptah Angular webview. It implements signal-based state management, VS Code integration, and reactive patterns for all frontend features.

## Key Responsibilities

- **VS Code Integration**: Type-safe webview ↔ extension messaging
- **State Management**: Signal-based reactive state (AppStateManager)
- **Chat Services**: Message handling, streaming, session management
- **File Operations**: Workspace file discovery and context inclusion
- **Provider Management**: AI provider switching and health monitoring
- **Analytics**: Performance metrics and event tracking
- **Navigation**: Signal-based navigation (no Angular Router)
- **Logging**: Structured logging with context filtering

## Architecture

```
Foundation Layer (0 Dependencies)
├── VSCodeService (message passing)
└── LoggingService (structured logging)
    ↓
State Layer
├── AppStateManager (global app state)
├── WebviewConfigService (configuration sync)
├── WebviewNavigationService (signal navigation)
└── ViewManagerService (view orchestration)
    ↓
Feature Services
├── ChatService (main orchestrator)
├── ChatStateService (signal-based storage)
├── ChatValidationService (message validation)
├── ClaudeMessageTransformerService (format conversion)
├── FilePickerService (file discovery)
├── ProviderService (provider management)
└── AnalyticsService (metrics tracking)
```

## Directory Structure

```
libs/frontend/core/src/lib/
├── services/
│   ├── vscode.service.ts                        # VS Code integration
│   ├── logging.service.ts                       # Structured logging
│   ├── app-state.service.ts                     # Global state
│   ├── webview-config.service.ts                # Configuration
│   ├── webview-navigation.service.ts            # Signal navigation
│   ├── view-manager.service.ts                  # View orchestration
│   ├── chat.service.ts                          # Chat orchestrator
│   ├── chat-state.service.ts                    # Chat state storage
│   ├── chat-state-manager.service.ts            # Chat UI state
│   ├── chat-validation.service.ts               # Message validation
│   ├── claude-message-transformer.service.ts    # Message transformation
│   ├── message-processing.service.ts            # Message conversion
│   ├── stream-handling.service.ts               # Streaming state
│   ├── file-picker.service.ts                   # File operations
│   ├── provider.service.ts                      # Provider management
│   ├── analytics.service.ts                     # Metrics collection
│   └── message-handler.service.ts               # Message routing
└── models/
    └── performance.models.ts                    # Performance types
```

## Core Exports

### VS Code Integration

```typescript
import { VSCodeService, provideVSCodeService } from '@ptah-extension/core';

// In app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideVSCodeService(), // Eager initialization
    // ...
  ],
};

// In components
export class MyComponent {
  private readonly vscode = inject(VSCodeService);

  sendMessage() {
    this.vscode.postStrictMessage('chat:sendMessage', {
      content: 'Hello',
      correlationId: CorrelationId.create(),
    });
  }

  ngOnInit() {
    // Send messages to extension (Phase 2: RPC for receiving messages)
    this.vscode.postStrictMessage('chat:loadSession', {
      sessionId: SessionId.create(),
    });
  }
}
```

### Global State Management

```typescript
import { AppStateManager } from '@ptah-extension/core';

export class AppComponent {
  private readonly appState = inject(AppStateManager);

  // Read signals
  readonly currentView = this.appState.currentView; // Signal<ViewType>
  readonly isLoading = this.appState.isLoading; // Signal<boolean>
  readonly workspaceInfo = this.appState.workspaceInfo; // Signal<WorkspaceInfo | null>

  // Computed
  readonly canSwitchViews = computed(() => !this.isLoading() && this.appState.isConnected());

  // Update state
  switchView(view: ViewType) {
    this.appState.setCurrentView(view);
  }
}
```

### Chat Service

```typescript
import { ChatService } from '@ptah-extension/core';

export class ChatComponent {
  private readonly chat = inject(ChatService);

  // Signal-based reactive state
  readonly messages = this.chat.messages; // Signal<StrictChatMessage[]>
  readonly claudeMessages = this.chat.claudeMessages; // Signal<ProcessedClaudeMessage[]>
  readonly currentSession = this.chat.currentSession; // Signal<StrictChatSession | null>
  readonly isStreaming = this.chat.isStreaming; // Signal<boolean>

  // Computed
  readonly hasMessages = computed(() => this.messages().length > 0);

  // Actions
  async sendMessage(content: string, files?: string[]) {
    await this.chat.sendMessage(content, files);
  }

  async createSession(name?: string) {
    await this.chat.createNewSession(name);
  }

  async switchSession(sessionId: SessionId) {
    await this.chat.switchToSession(sessionId);
  }
}
```

### File Picker

```typescript
import { FilePickerService } from '@ptah-extension/core';

export class FileInputComponent {
  private readonly filePicker = inject(FilePickerService);

  // Signals
  readonly includedFiles = this.filePicker.includedFiles; // Signal<ChatFile[]>
  readonly excludedFiles = this.filePicker.excludedFiles; // Signal<string[]>
  readonly optimizationSuggestions = this.filePicker.optimizationSuggestions; // Signal<OptimizationSuggestion[]>

  // Actions
  async includeFile(path: string) {
    await this.filePicker.includeFile(path);
  }

  async searchFiles(query: string) {
    const results = await this.filePicker.searchFiles({
      query,
      maxResults: 10,
      includeImages: true,
    });
    return results;
  }
}
```

### Provider Service

```typescript
import { ProviderService } from '@ptah-extension/core';

export class ProviderComponent {
  private readonly providerService = inject(ProviderService);

  // Signals
  readonly availableProviders = this.providerService.availableProviders;  // Signal<ProviderInfo[]>
  readonly currentProvider = this.providerService.currentProvider;        // Signal<ProviderInfo | null>
  readonly providerHealth = this.providerService.providerHealth;          // Signal<Map<string, ProviderHealth>>

  // Computed
  readonly isCurrentProviderHealthy = computed(() =>
    this.currentProvider()?.health.status === 'available'
  );

  // Actions
  async switchProvider(providerId: ProviderId) {
    await this.providerService.switchProvider(providerId);
  }

  // Observable streams
  providerService.onProviderSwitch().subscribe(event => {
    console.log('Provider switched:', event);
  });
}
```

### Navigation Service

```typescript
import { WebviewNavigationService } from '@ptah-extension/core';

export class NavigationComponent {
  private readonly navigation = inject(WebviewNavigationService);

  // Signals
  readonly currentView = this.navigation.currentView; // Signal<ViewType>
  readonly previousView = this.navigation.previousView; // Signal<ViewType | null>
  readonly canNavigate = this.navigation.canNavigate; // Signal<boolean>

  // Navigate
  async navigateToChat() {
    await this.navigation.navigateToView('chat');
  }

  async goBack() {
    await this.navigation.navigateBack();
  }
}
```

## Dependencies

**Internal**:

- `@ptah-extension/shared`: Type contracts (StrictMessage, SessionId, etc.)

**External**:

- `@angular/core` (~20.1.0): Signals, DI, components
- `@angular/core/rxjs-interop`: toObservable() for signal ↔ Observable
- `rxjs` (~7.8.0): Message streams, operators (minimal use)

## Signal Patterns

### Writable Signals (Internal State)

```typescript
private readonly _messages = signal<readonly StrictChatMessage[]>([]);
readonly messages = this._messages.asReadonly();  // Public readonly
```

### Computed Signals (Derived State)

```typescript
readonly messageCount = computed(() => ({
  total: this.messages().length,
  user: this.messages().filter(m => m.type === 'user').length,
  assistant: this.messages().filter(m => m.type === 'assistant').length
}));
```

### Effect-Based Synchronization

```typescript
constructor() {
  effect(() => {
    const sessionId = this.currentSession()?.id;
    if (sessionId) {
      this.fetchMessages(sessionId);
    }
  });
}
```

### RxJS ↔ Signal Bridge

```typescript
// Convert signal to observable for RxJS operators
toObservable(this.config)
  .pipe(
    filter((config) => config !== null),
    debounceTime(300)
  )
  .subscribe((config) => {
    // Handle config changes
  });
```

## Message Validation

```typescript
import { ChatValidationService } from '@ptah-extension/core';

export class MyService {
  private readonly validator = inject(ChatValidationService);

  validateMessage(content: string): boolean {
    return this.validator.validateMessageContent(content);
  }

  sanitizeContent(content: string): string {
    return this.validator.sanitizeContent(content);
  }
}
```

## Testing

```bash
nx test core              # Run unit tests
nx run core:typecheck     # TypeScript validation
nx run core:lint          # ESLint
```

**Framework**: Jest + jest-preset-angular
**Coverage Target**: 80% minimum

## Type Exports

```typescript
// From ClaudeMessageTransformerService
export type { ProcessedClaudeMessage, ClaudeContent, ExtractedFileInfo, ToolUsageSummary };

// From FilePickerService
export type { ChatFile, FileSuggestion };

// From ProviderService
export type { ProviderInfo, ProviderHealth, ProviderError };

// From AnalyticsService
export type { AnalyticsData, PerformanceData, ActivityItem };
```

## VS Code Constraints

**No Angular Router**: VS Code webviews block History API

- **Solution**: Pure signal-based navigation via WebviewNavigationService
- **Pattern**: Direct component switching via @switch in templates

**Zoneless Change Detection**: Optimal performance

- **Implementation**: `provideZonelessChangeDetection()` in app.config
- **Benefit**: ~30% reduction in change detection overhead

## Service Lifecycle

All services use Angular DI:

```typescript
@Injectable({ providedIn: 'root' }) // Singleton
export class MyService {
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Automatic cleanup via DestroyRef
    this.subscription.pipe(takeUntilDestroyed(this.destroyRef));
  }
}
```

## Critical Design Decisions

1. **Signal-First**: All state uses signals (not RxJS BehaviorSubject)
2. **Message Streams Only**: RxJS only for VS Code message streams
3. **No Router**: Pure signal navigation for VS Code compatibility
4. **Layered Services**: Clear dependency direction (Foundation → State → Features)
5. **Type Safety**: Zero `any` types, comprehensive type guards

## Integration Points

**Consumed By**:

- All frontend feature libraries (chat, session, providers, etc.)
- Main webview app

**Depends On**:

- `@ptah-extension/shared` (types only)

## File Paths Reference

- **VS Code**: `services/vscode.service.ts`
- **State**: `services/app-state.service.ts`, `services/webview-config.service.ts`
- **Navigation**: `services/webview-navigation.service.ts`, `services/view-manager.service.ts`
- **Chat**: `services/chat*.ts` (7 files)
- **File Operations**: `services/file-picker.service.ts`
- **Provider**: `services/provider.service.ts`
- **Analytics**: `services/analytics.service.ts`
- **Entry Point**: `src/index.ts`
