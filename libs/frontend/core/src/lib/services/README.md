# Core Library - Services

**Library**: `@ptah-extension/core`  
**Purpose**: Core services shared across all feature libraries

---

## 📂 Service Organization

Core services provide foundational functionality used by multiple features.

### Folder Structure

```text
libs/frontend/core/src/lib/services/
├── app-state.service.ts           # Global application state (signals) ✅
├── vscode.service.ts              # VS Code API wrapper ✅
├── webview-navigation.service.ts  # Webview routing ✅
├── message-handler.service.ts     # Extension communication ✅
├── logging.service.ts             # Logging infrastructure ✅
├── provider.service.ts            # AI provider management ✅
├── analytics.service.ts           # Analytics tracking ✅
├── chat.service.ts                # Chat orchestration ✅
├── chat-state.service.ts          # Chat state management ✅
├── chat-validation.service.ts     # Message validation ✅
├── message-processing.service.ts  # Message transformation ✅
├── claude-message-transformer.service.ts  # Claude message parsing ✅
└── README.md (this file)

REMOVED/MOVED:
├── ❌ webview-config.service.ts    # Dead code (zero imports)
├── ❌ stream-handling.service.ts   # Dead code (zero imports)
├── ❌ view-manager.service.ts      # Redundant (merged into WebviewNavigationService)
├── 📦 chat-state-manager.service.ts → @ptah-extension/chat/services
├── 📦 file-picker.service.ts       → @ptah-extension/chat/services
```

---

## 🎯 Service Inventory

### State Management Services

1. **AppStateManager** ✅ (Already uses signals!)

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/app-state.service.ts`
   - **Purpose**: Global application state management
   - **Pattern**: Signal-based state with computed values
   - **Evidence**: Lines 21-32 show `signal()`, `computed()`, `asReadonly()` usage
   - **Migration**: Just move file (already modern!)
   - **LOC**: ~130

2. **WebviewConfigService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/webview-config.service.ts`
   - **Purpose**: Configuration state management
   - **Migration**: Convert BehaviorSubject → signal()
   - **Pattern**: `signal<Config>()` for config state

3. **ViewManagerService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/view-manager.service.ts`
   - **Purpose**: Current view state management
   - **Migration**: Convert to signal-based state
   - **Pattern**: `signal<ViewType>()` for active view

4. **WebviewNavigationService**
   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/webview-navigation.service.ts`
   - **Purpose**: Navigation state management
   - **Migration**: Convert to signal-based state
   - **Pattern**: `signal<NavigationState>()` for navigation history

### Communication Services

5. **VSCodeService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/vscode.service.ts`
   - **Purpose**: VS Code API wrapper, message passing
   - **Migration**: Convert connection state to signals
   - **Pattern**: `signal<boolean>()` for connection state

6. **MessageHandlerService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/message-handler.service.ts`
   - **Purpose**: Message queue and handling
   - **Migration**: Convert message queue to signal
   - **Pattern**: `signal<Message[]>()` for message queue

7. **LoggingService**
   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/logging.service.ts`
   - **Purpose**: Logging infrastructure
   - **Migration**: Convert log level to signal
   - **Pattern**: `signal<LogLevel>()` for current log level

### Domain Services

8. **ProviderService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/provider.service.ts`
   - **Purpose**: AI provider management
   - **Migration**: Convert provider state to signals
   - **Pattern**: `signal<AIProvider>()` for active provider, `signal<AIProvider[]>()` for available providers

9. **AnalyticsService**

   - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/analytics.service.ts`
   - **Purpose**: Analytics event tracking
   - **Migration**: Convert events queue to signal
   - **Pattern**: `signal<AnalyticsEvent[]>()` for events

10. **FilePickerService**

    - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/file-picker.service.ts`
    - **Purpose**: File selection
    - **Migration**: Convert selected files to signal
    - **Pattern**: `signal<FileInfo[]>()` for selected files

11. **ClaudeMessageTransformerService**
    - **Current Location**: `apps/ptah-extension-webview/src/app/core/services/claude-message-transformer.service.ts`
    - **Purpose**: Message transformation
    - **Migration**: Convert transform options to signal
    - **Pattern**: `signal<TransformOptions>()` for configuration

---

## 🚀 Modern Angular Patterns

### Signal-Based State Management

**Exemplar Service** (already modern):

```typescript
// apps/ptah-extension-webview/src/app/core/services/app-state.service.ts (lines 21-32)
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppStateManager {
  // Private writable signal
  private readonly _currentView = signal<ViewType>('chat');
  private readonly _isLoading = signal<boolean>(false);
  private readonly _statusMessage = signal<string>('');

  // Public readonly signals
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly statusMessage = this._statusMessage.asReadonly();

  // Computed values
  readonly isActive = computed(() => !this._isLoading());

  // State mutations
  setCurrentView(view: ViewType): void {
    this._currentView.set(view);
  }

  setLoading(loading: boolean, message?: string): void {
    this._isLoading.set(loading);
    if (message) this._statusMessage.set(message);
  }
}
```

**Target pattern for all services**:

1. Private writable signals (`_state = signal<T>()`)
2. Public readonly signals (`.asReadonly()`)
3. Computed values (`computed(() => ...)`)
4. State mutation methods (update via `.set()` or `.update()`)

### Migration Pattern: BehaviorSubject → Signal

**Before (Legacy)**:

```typescript
private currentProvider$ = new BehaviorSubject<AIProvider | null>(null);
readonly provider$ = this.currentProvider$.asObservable();

setProvider(provider: AIProvider): void {
  this.currentProvider$.next(provider);
}
```

**After (Modern)**:

```typescript
private readonly _currentProvider = signal<AIProvider | null>(null);
readonly currentProvider = this._currentProvider.asReadonly();

setProvider(provider: AIProvider): void {
  this._currentProvider.set(provider);
}
```

### Migration Pattern: combineLatest → computed

**Before (Legacy)**:

```typescript
readonly viewState$ = combineLatest([this.currentView$, this.isLoading$]).pipe(
  map(([view, loading]) => ({ view, loading }))
);
```

**After (Modern)**:

```typescript
readonly viewState = computed(() => ({
  view: this.currentView(),
  loading: this.isLoading(),
}));
```

### Migration Pattern: .subscribe() → effect()

**Before (Legacy)**:

```typescript
constructor() {
  this.currentView$.subscribe(view => {
    console.log('View changed:', view);
  });
}
```

**After (Modern)**:

```typescript
constructor() {
  effect(() => {
    console.log('View changed:', this.currentView());
  });
}
```

---

## 📝 Naming Conventions

### Service Class Names

- **Format**: `PascalCase` with `Service` or `Manager` suffix
- **Examples**: `AppStateManager`, `VSCodeService`, `ProviderService`

### File Naming

- **Service**: `{name}.service.ts`
- **Tests**: `{name}.service.spec.ts`

### Signal Naming

- **Private writable**: `_stateName` (underscore prefix)
- **Public readonly**: `stateName` (no prefix)
- **Computed**: `derivedValue` (descriptive name)

---

## 🧪 Testing Strategy

### Unit Tests

Each service should have comprehensive unit tests:

```typescript
describe('AppStateManager', () => {
  let service: AppStateManager;

  beforeEach(() => {
    service = TestBed.inject(AppStateManager);
  });

  it('should update currentView signal', () => {
    service.setCurrentView('analytics');
    expect(service.currentView()).toBe('analytics');
  });

  it('should compute isActive correctly', () => {
    service.setLoading(false);
    expect(service.isActive()).toBe(true);

    service.setLoading(true);
    expect(service.isActive()).toBe(false);
  });

  it('should handle concurrent state updates', () => {
    service.setLoading(true, 'Loading...');
    expect(service.isLoading()).toBe(true);
    expect(service.statusMessage()).toBe('Loading...');
  });
});
```

### Coverage Requirements

- **Lines**: ≥80%
- **Branches**: ≥80%
- **Functions**: ≥80%
- **Statements**: ≥80%

---

## 🔄 Migration Checklist

When migrating a service:

- [ ] Copy service file to core library
- [ ] Convert `BehaviorSubject<T>` → `signal<T>()`
- [ ] Convert `Observable<T>` → `Signal<T>.asReadonly()`
- [ ] Convert `combineLatest()` → `computed()`
- [ ] Convert `.subscribe()` → `effect()` (where appropriate)
- [ ] Update all `.next()` → `.set()` or `.update()`
- [ ] Ensure `@Injectable({ providedIn: 'root' })`
- [ ] Migrate service tests
- [ ] Export from `libs/frontend/core/src/index.ts`
- [ ] Update consuming components to use signal-based APIs
- [ ] Verify `nx build frontend-core` succeeds
- [ ] Verify all tests pass with ≥80% coverage

---

## 📚 Related Documentation

- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`
- **Shared Types**: `libs/shared/src/lib/types/`

---

## 🎯 Current Status

**Services in this library**: 0 (pending extraction)

**Expected services after migration**: 11

**Modern pattern exemplar**: `AppStateManager` (already signal-based ✅)

---

**Last Updated**: October 12, 2025  
**Services**: 11 total (1 already modern, 10 need migration)  
**Migration Status**: 🔄 Pending extraction from monolithic app
