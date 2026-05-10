# libs/frontend/core - Frontend Service Layer

[Back to Main](../../../CLAUDE.md)

## Purpose

The **core library** provides the foundational service layer for all frontend features in the Ptah Extension webview. It manages application state, VS Code communication, navigation, and cross-cutting concerns like logging and RPC.

## Key Responsibilities

- **Application State Management**: AppStateManager with signal-based reactive state
- **VS Code Integration**: VSCodeService for extension API communication
- **Navigation**: WebviewNavigationService for signal-based routing (NO Angular Router)
- **RPC Layer**: ClaudeRpcService for type-safe extension communication
- **Discovery Services**: AgentDiscoveryFacade, CommandDiscoveryFacade for autocomplete
- **Model & Autopilot State**: Centralized model selection and autopilot permission tracking
- **Dropdown Interaction**: DropdownInteractionService (legacy - being replaced by CDK Overlay)
- **Logging**: Structured logging with LogLevel configuration

## Architecture

```
libs/frontend/core/src/lib/services/
├── app-state.service.ts              # Global app state (view, loading, workspace)
├── webview-navigation.service.ts     # Signal-based navigation (NO router!)
├── vscode.service.ts                 # VS Code API wrapper (postMessage + getState/setState)
├── message-router.types.ts           # MessageHandler interface + MESSAGE_HANDLERS token
├── message-router.service.ts         # Centralized window.message dispatch via Map<type, handler[]>
├── logging.service.ts                # Structured logging
├── claude-rpc.service.ts             # Type-safe RPC calls to extension
├── rpc-call.util.ts                  # Function-based RPC client with ready-gate
├── model-state.service.ts            # Model selection state (TASK_2025_035)
├── autopilot-state.service.ts        # Autopilot permission tracking
├── agent-discovery.facade.ts         # Agent autocomplete suggestions
├── command-discovery.facade.ts       # Slash command autocomplete
└── idempotent-setters.ts             # setIfChanged signal helper (TASK_2026_115)
```

## Critical Design Decisions

### 1. Signal-Based Architecture (Angular 20+)

**All state is managed with signals, NOT RxJS BehaviorSubject.**

```typescript
// ✅ CORRECT: Signal-based reactive state
export class AppStateManager {
  private readonly _currentView = signal<ViewType>('chat');
  readonly currentView = this._currentView.asReadonly();

  readonly canSwitchViews = computed(() => !this._isLoading() && this._isConnected());
}
```

**Why?** Signals provide better performance, simpler mental model, and automatic change detection in Angular 20+ zoneless mode.

### 2. NO Angular Router (WebviewNavigationService)

**VS Code webviews block History API (pushState/replaceState), making Angular Router unusable.**

```typescript
// ✅ CORRECT: Signal-based component switching
export class WebviewNavigationService {
  async navigateToView(view: ViewType): Promise<boolean> {
    // Pure signal-based navigation - update component state directly
    this._navigationState.set({ currentView: view });
    this.appState.setCurrentView(view); // Triggers component switching
    return true;
  }
}

// ❌ WRONG: Angular Router (blocked in VS Code webview)
this.router.navigate(['/chat']); // SecurityError: History API blocked
```

**Navigation Flow**:

```
User clicks nav button
  → WebviewNavigationService.navigateToView('chat')
  → AppStateManager.setCurrentView('chat')
  → AppShellComponent @if (currentView() === 'chat') renders ChatViewComponent
```

### 3. VSCodeService + MessageRouterService: Handler-Pattern Message Routing

**VSCodeService wraps the outbound VS Code API (postMessage, getState/setState). It does NOT expose a `messages$` Observable.** Inbound messages are dispatched by `MessageRouterService` to handlers that opt in via the `MessageHandler` interface and the `MESSAGE_HANDLERS` multi-provider token.

```typescript
// VSCodeService — outbound only, plus signal-based config + MessageHandler for select system messages
@Injectable({ providedIn: 'root' })
export class VSCodeService implements MessageHandler {
  postMessage(message: unknown): void {
    /* … */
  }
  getState<T>(): T | undefined {
    /* … */
  }
  setState<T>(state: T): void {
    /* … */
  }

  // VSCodeService also implements MessageHandler for a small set of system-level
  // messages (config updates, theme changes, etc.) — not for general fan-out.
  readonly handledMessageTypes = [
    /* … */
  ] as const;
  handleMessage(message: { type: string; payload?: unknown }): void {
    /* … */
  }
}
```

**Inbound message routing** (the real pattern — see `message-router.types.ts` and `message-router.service.ts`):

```typescript
// 1. Implement MessageHandler in your service
@Injectable({ providedIn: 'root' })
export class MyFeatureService implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.MY_FEATURE_UPDATE] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    // Dispatched by MessageRouterService when a window.message event matches
  }
}

// 2. Register via the MESSAGE_HANDLERS multi-provider token
//    (typically in app.config.ts or the feature's provider barrel)
{ provide: MESSAGE_HANDLERS, useExisting: MyFeatureService, multi: true }
```

`MessageRouterService` collects every registered handler at bootstrap, builds a `Map<messageType, MessageHandler[]>` for O(1) dispatch, and listens to `window.addEventListener('message', …)` exactly once. Handlers fire only for the message types they declare in `handledMessageTypes`.

**CRITICAL**: `MessageRouterService` MUST be provided at root via `provideMessageRouter()`. Without it, no inbound messages reach any handler.

```typescript
// apps/ptah-extension-webview/src/app.config.ts (or main.ts)
bootstrapApplication(AppComponent, {
  providers: [
    provideVSCodeService(/* config */),
    provideMessageRouter(),
    // …feature handlers registered via MESSAGE_HANDLERS multi-provider
  ],
});
```

**Why this pattern (not RxJS)?** The handler-registration pattern was chosen over an Observable bus to avoid the lazy-setter routing pattern that previously caused circular DI crashes (NG0200). It also makes it explicit which service handles which message — searching for `MESSAGE_TYPES.X` finds every consumer, no Observable subscriptions to chase.

### 4. ClaudeRpcService: Type-Safe RPC

**ClaudeRpcService provides async RPC calls with timeout handling and error recovery.**

```typescript
export class ClaudeRpcService {
  async callExtension<TRequest, TResponse>(method: string, params: TRequest, options?: RpcCallOptions): Promise<RpcResult<TResponse>> {
    // Generates unique request ID, sends message, waits for response
    // Handles timeouts, retries, error mapping
  }
}

// Usage: Type-safe async calls
const result = await this.rpc.callExtension<LoadSessionRequest, Session>('load-session', { sessionId: 'abc123' }, { timeout: 5000, retries: 2 });

if (result.success) {
  console.log('Loaded session:', result.data);
} else {
  console.error('Failed to load session:', result.error);
}
```

### 5. Discovery Facades: Autocomplete Intelligence

**AgentDiscoveryFacade and CommandDiscoveryFacade provide fuzzy-searchable autocomplete suggestions.**

```typescript
export class AgentDiscoveryFacade {
  // Fuzzy search agents by name (for @agent autocomplete)
  searchAgents(query: string): AgentSuggestion[] {
    return this.agents.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()));
  }
}

export class CommandDiscoveryFacade {
  // Fuzzy search slash commands (for /command autocomplete)
  searchCommands(query: string): CommandSuggestion[] {
    return this.commands.filter((cmd) => cmd.name.toLowerCase().includes(query.toLowerCase()));
  }
}

// Usage: ChatInputComponent autocomplete
@Component({
  template: `
    <input (input)="onInput($event)" />
    @if (showAutocomplete()) {
      <div class="suggestions">
        @for (suggestion of suggestions(); track suggestion.name) {
          <div (click)="selectSuggestion(suggestion)">
            {{ suggestion.name }}
          </div>
        }
      </div>
    }
  `,
})
export class ChatInputComponent {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);
  private readonly commandDiscovery = inject(CommandDiscoveryFacade);

  readonly suggestions = signal<AgentSuggestion[] | CommandSuggestion[]>([]);

  onInput(event: Event): void {
    const input = (event.target as HTMLInputElement).value;

    if (input.startsWith('@')) {
      const query = input.slice(1);
      this.suggestions.set(this.agentDiscovery.searchAgents(query));
    } else if (input.startsWith('/')) {
      const query = input.slice(1);
      this.suggestions.set(this.commandDiscovery.searchCommands(query));
    }
  }
}
```

### 6. Model & Autopilot State Services (TASK_2025_035)

**Centralized state services for model selection and autopilot permissions.**

```typescript
export class ModelStateService {
  private readonly _selectedModel = signal<ModelInfo | null>(null);
  readonly selectedModel = this._selectedModel.asReadonly();

  // Available models with metadata
  private readonly _availableModels = signal<ModelInfo[]>([]);
  readonly availableModels = this._availableModels.asReadonly();

  selectModel(model: ModelInfo): void {
    this._selectedModel.set(model);
    // Persist to VS Code settings
  }
}

export class AutopilotStateService {
  private readonly _currentLevel = signal<AutopilotLevel>('off');
  readonly currentLevel = this._currentLevel.asReadonly();

  setAutopilotLevel(level: AutopilotLevel): void {
    this._currentLevel.set(level);
    // Persist to VS Code settings
  }
}
```

---

## Key Services API Reference

### AppStateManager

**Purpose**: Global application state management with signals.

```typescript
@Injectable({ providedIn: 'root' })
export class AppStateManager {
  // Public readonly signals
  readonly currentView: Signal<ViewType>;
  readonly isLoading: Signal<boolean>;
  readonly statusMessage: Signal<string>;
  readonly workspaceInfo: Signal<WorkspaceInfo | null>;
  readonly isConnected: Signal<boolean>;

  // Computed signals
  readonly canSwitchViews: Signal<boolean>;
  readonly appTitle: Signal<string>;

  // State update methods
  setCurrentView(view: ViewType): void;
  setLoading(loading: boolean): void;
  setStatusMessage(message: string): void;
  setWorkspaceInfo(info: WorkspaceInfo | null): void;
  setConnected(connected: boolean): void;

  // Message handlers
  handleInitialData(data: { workspaceInfo?: WorkspaceInfo; currentView?: ViewType }): void;
  handleViewSwitch(view: ViewType): void;
  handleError(error: string): void;

  // State snapshot
  getStateSnapshot(): AppState;
}

// ViewType definition
export type ViewType = 'chat' | 'command-builder' | 'analytics' | 'context-tree' | 'settings';
```

**Usage Pattern**:

```typescript
@Component({
  template: `
    <div>Current View: {{ currentView() }}</div>
    <div>Loading: {{ isLoading() }}</div>
    <button (click)="switchView()" [disabled]="!canSwitchViews()">Switch View</button>
  `,
})
export class AppShellComponent {
  private readonly appState = inject(AppStateManager);

  readonly currentView = this.appState.currentView;
  readonly isLoading = this.appState.isLoading;
  readonly canSwitchViews = this.appState.canSwitchViews;

  switchView(): void {
    this.appState.setCurrentView('analytics');
  }
}
```

---

### WebviewNavigationService

**Purpose**: Signal-based navigation for VS Code webview (NO Angular Router).

```typescript
@Injectable({ providedIn: 'root' })
export class WebviewNavigationService {
  // Public readonly signals
  readonly navigationState: Signal<NavigationState>;
  readonly navigationHistory: Signal<ViewType[]>;
  readonly navigationErrors: Signal<string[]>;

  // Computed signals
  readonly currentView: Signal<ViewType>;
  readonly previousView: Signal<ViewType | null>;
  readonly isNavigating: Signal<boolean>;
  readonly canNavigate: Signal<boolean>;
  readonly navigationReliability: Signal<number>;

  // Navigation methods
  navigateToView(view: ViewType): Promise<boolean>;
  navigateBack(): Promise<boolean>;
  getCurrentView(): ViewType;
  canNavigateToView(view: ViewType): boolean;

  // Metrics & utilities
  getNavigationMetrics(): {
    totalNavigations: number;
    signalSuccessRate: number;
    overallReliability: number;
    averageNavigationTime: number;
  };
  clearNavigationHistory(): void;
}
```

**Navigation Pattern**:

```typescript
@Component({
  template: `
    <nav>
      <button (click)="goToChat()" [disabled]="!canNavigate()">Chat</button>
      <button (click)="goToAnalytics()" [disabled]="!canNavigate()">Analytics</button>
      <button (click)="goBack()" [disabled]="!previousView()">Back</button>
    </nav>
  `,
})
export class NavigationComponent {
  private readonly navigation = inject(WebviewNavigationService);

  readonly canNavigate = this.navigation.canNavigate;
  readonly previousView = this.navigation.previousView;

  async goToChat(): Promise<void> {
    const success = await this.navigation.navigateToView('chat');
    if (!success) console.error('Navigation failed');
  }

  async goToAnalytics(): Promise<void> {
    await this.navigation.navigateToView('analytics');
  }

  async goBack(): Promise<void> {
    await this.navigation.navigateBack();
  }
}
```

---

### VSCodeService

**Purpose**: VS Code API wrapper — outbound `postMessage`, state persistence, and signal-based config.

```typescript
@Injectable({ providedIn: 'root' })
export class VSCodeService implements MessageHandler {
  // Outbound
  postMessage(message: unknown): void;
  setState<T>(state: T): void;
  getState<T>(): T | undefined;

  // Signal-based config (workspaceRoot, theme, isElectron, etc.)
  readonly config: Signal<WebviewConfig>;

  // VSCodeService is itself a MessageHandler for select system messages.
  // For feature messages, register your own MessageHandler — DO NOT subscribe here.
  readonly handledMessageTypes: readonly string[];
  handleMessage(message: { type: string; payload?: unknown }): void;
}

export function provideVSCodeService(config?: Partial<WebviewConfig>): Provider[];
```

**Outbound usage** (sending to extension):

```typescript
this.vscode.postMessage({
  type: 'command-execute',
  payload: { command: 'save' },
});
```

**Inbound usage** (receiving from extension): use the `MessageHandler` pattern via `MessageRouterService` — see §3 above. Do NOT subscribe to a `messages$` Observable; it doesn't exist.

### MessageRouterService

**Purpose**: Centralized dispatch for inbound `window.message` events to registered `MessageHandler` instances.

```typescript
@Injectable()
export class MessageRouterService {
  // Collects MessageHandler[] via inject(MESSAGE_HANDLERS) at construction;
  // builds Map<messageType, MessageHandler[]> and starts the window.message listener.
}

export interface MessageHandler {
  readonly handledMessageTypes: readonly string[];
  handleMessage(message: { type: string; payload?: unknown }): void;
}

export const MESSAGE_HANDLERS: InjectionToken<MessageHandler[]>;

export function provideMessageRouter(): Provider[];
```

**Registration pattern**:

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationService implements MessageHandler {
  private readonly message = signal<string>('');
  readonly current = this.message.asReadonly();

  readonly handledMessageTypes = ['notification'] as const;

  handleMessage(msg: { type: string; payload?: unknown }): void {
    const payload = msg.payload as { text: string };
    this.message.set(payload.text);
  }
}

// Register the handler in providers
{ provide: MESSAGE_HANDLERS, useExisting: NotificationService, multi: true }
```

---

### ClaudeRpcService

**Purpose**: Type-safe async RPC calls to extension.

```typescript
@Injectable({ providedIn: 'root' })
export class ClaudeRpcService {
  callExtension<TRequest, TResponse>(method: string, params: TRequest, options?: RpcCallOptions): Promise<RpcResult<TResponse>>;
}

export type RpcResult<T> = { success: true; data: T } | { success: false; error: string; code?: string };

export interface RpcCallOptions {
  timeout?: number;
  retries?: number;
  priority?: 'high' | 'normal' | 'low';
}
```

**Usage Pattern**:

```typescript
@Component({
  template: `
    <button (click)="loadSession()" [disabled]="loading()">Load Session</button>
    @if (error()) {
      <div class="error">{{ error() }}</div>
    }
  `,
})
export class SessionLoaderComponent {
  private readonly rpc = inject(ClaudeRpcService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async loadSession(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const result = await this.rpc.callExtension<LoadSessionRequest, Session>('load-session', { sessionId: 'abc123' }, { timeout: 5000 });

    this.loading.set(false);

    if (result.success) {
      console.log('Loaded:', result.data);
    } else {
      this.error.set(result.error);
    }
  }
}
```

---

### AgentDiscoveryFacade

**Purpose**: Agent autocomplete suggestions (for @agent syntax).

```typescript
@Injectable({ providedIn: 'root' })
export class AgentDiscoveryFacade {
  searchAgents(query: string): AgentSuggestion[];
  getAgentByName(name: string): AgentSuggestion | null;
  getAllAgents(): AgentSuggestion[];
}

export interface AgentSuggestion {
  name: string;
  description: string;
  icon: string;
  category: 'specialist' | 'coordinator' | 'tester' | 'reviewer';
}
```

---

### CommandDiscoveryFacade

**Purpose**: Slash command autocomplete suggestions (for /command syntax).

```typescript
@Injectable({ providedIn: 'root' })
export class CommandDiscoveryFacade {
  searchCommands(query: string): CommandSuggestion[];
  getCommandByName(name: string): CommandSuggestion | null;
  getAllCommands(): CommandSuggestion[];
}

export interface CommandSuggestion {
  name: string;
  description: string;
  usage: string;
  category: 'workflow' | 'utility' | 'navigation';
}
```

---

### DropdownInteractionService (DEPRECATED)

**Status**: Being replaced by `@ptah-extension/ui` CDK Overlay components.

**Reason**: DropdownInteractionService uses capture-phase document listeners as a workaround for dropdown keyboard navigation. The root cause is structural (dropdown rendered inside textarea DOM tree). CDK Overlay solves this by rendering dropdowns in portals at body level.

**Migration**: Use `DropdownComponent`, `PopoverComponent`, and `OptionComponent` from `@ptah-extension/ui` instead.

See `libs/frontend/ui/CLAUDE.md` for migration guide.

---

## Boundaries

**Belongs Here**:

- Application-level state management (view, loading, connection)
- VS Code API integration and message passing
- Signal-based navigation logic (NO router!)
- Cross-cutting concerns (logging, RPC)
- Discovery facades for autocomplete

**Does NOT Belong**:

- Feature-specific state (belongs in feature libraries: `chat`, `dashboard`, etc.)
- UI components (belongs in `chat`, `ui`, etc.)
- Business logic (belongs in backend libraries: `claude-domain`, `ai-providers-core`)
- HTTP calls (VS Code webview uses message passing, not HTTP)

---

## Dependencies

**Internal Libraries**:

- `@ptah-extension/shared` - Type contracts (ViewType, WorkspaceInfo, WebviewMessage)

**External Dependencies**:

- `@angular/core` (^20.1.2) - Signal-based reactivity, inject(), DestroyRef
- `rxjs` (^7.8.1) - Available for narrow interop scenarios (e.g. `toObservable()` for signal→stream bridging in `git-branches.service.ts`). NOT used for general state — signals are the primitive. NOT used for inbound message routing — that's `MessageHandler` + `MessageRouterService`.

---

## Import Path

```typescript
// Core services
import { AppStateManager, ViewType } from '@ptah-extension/core';
import { WebviewNavigationService } from '@ptah-extension/core';
import { VSCodeService, provideVSCodeService } from '@ptah-extension/core';
import { ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import { LogLevel, LoggingService } from '@ptah-extension/core';

// Discovery facades
import { AgentDiscoveryFacade, AgentSuggestion } from '@ptah-extension/core';
import { CommandDiscoveryFacade, CommandSuggestion } from '@ptah-extension/core';

// Model & Autopilot state
import { ModelStateService } from '@ptah-extension/core';
import { AutopilotStateService } from '@ptah-extension/core';
```

---

## Commands

```bash
# Test
nx test core

# Typecheck
nx typecheck core

# Lint
nx lint core

# Build to ESM
nx build core
```

---

## Testing

**Framework**: Jest with ts-jest transformer
**Coverage Thresholds** (enforced floor, ratcheted via TASK_2026_116 on 2026-05-11):

- statements: 85%, branches: 75%, functions: 75%, lines: 85%
- These are minimums, not targets. Do not lower them without a follow-up task.
- `dropdown-interaction.service.ts` is excluded via `coveragePathIgnorePatterns` in
  `jest.config.ts` — it is deprecated (CDK Overlay replacement) and has no test value.

**Test Patterns**:

```typescript
// Testing signal-based services
describe('AppStateManager', () => {
  let service: AppStateManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AppStateManager],
    });
    service = TestBed.inject(AppStateManager);
  });

  it('should update currentView signal', () => {
    service.setCurrentView('analytics');
    expect(service.currentView()).toBe('analytics');
  });

  it('should compute canSwitchViews', () => {
    service.setLoading(true);
    expect(service.canSwitchViews()).toBe(false);

    service.setLoading(false);
    service.setConnected(true);
    expect(service.canSwitchViews()).toBe(true);
  });
});
```

---

## Guidelines

1. **Signal-First Architecture**: All state MUST use Angular signals, NOT RxJS BehaviorSubject
2. **inject() Over Constructor**: Use inject() for all dependency injection (Angular 20+)
3. **NO Angular Router**: WebviewNavigationService provides signal-based navigation
4. **VSCodeService Singleton**: Provided at root via provideVSCodeService() factory
5. **Type-Safe Messages**: All VS Code messages MUST use typed interfaces from `@ptah-extension/shared`
6. **Automatic Cleanup**: Use DestroyRef + takeUntilDestroyed() for subscriptions
7. **Computed Signals**: Prefer computed() over manual signal updates
8. **Readonly Signals**: Expose private signals via .asReadonly()
9. **No HTTP**: VS Code webviews use message passing, NOT HttpClient
10. **Structured Logging**: Use LoggingService with appropriate LogLevel

---

## Migration Notes

### Angular 19 → 20 Signal Migration

**Before (Angular 19 - BehaviorSubject)**:

```typescript
export class AppStateManager {
  private currentView$ = new BehaviorSubject<ViewType>('chat');
  readonly currentView = this.currentView$.asObservable();

  setCurrentView(view: ViewType): void {
    this.currentView$.next(view);
  }
}

// Component usage
@Component({
  template: `<div>{{ currentView$ | async }}</div>`,
})
export class MyComponent {
  readonly currentView$ = this.appState.currentView;
}
```

**After (Angular 20 - Signals)**:

```typescript
export class AppStateManager {
  private readonly _currentView = signal<ViewType>('chat');
  readonly currentView = this._currentView.asReadonly();

  setCurrentView(view: ViewType): void {
    this._currentView.set(view);
  }
}

// Component usage (NO async pipe!)
@Component({
  template: `<div>{{ currentView() }}</div>`,
})
export class MyComponent {
  readonly currentView = this.appState.currentView;
}
```

**Benefits**:

- 30% faster change detection (zoneless mode compatible)
- No async pipe needed
- Simpler mental model
- Better TypeScript inference

---

## File Paths Reference

- **Core Services**: `src/lib/services/`
  - `app-state.service.ts` - Global app state
  - `webview-navigation.service.ts` - Signal-based navigation
  - `vscode.service.ts` - VS Code API wrapper
  - `claude-rpc.service.ts` - Type-safe RPC
  - `logging.service.ts` - Structured logging
  - `model-state.service.ts` - Model selection state
  - `autopilot-state.service.ts` - Autopilot permission state
  - `agent-discovery.facade.ts` - Agent autocomplete
  - `command-discovery.facade.ts` - Command autocomplete
  - `dropdown-interaction.service.ts` - [DEPRECATED] Use CDK Overlay
- **Entry Point**: `src/index.ts`
- **Test Files**: `src/lib/services/*.spec.ts`
