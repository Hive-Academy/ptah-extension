---
trigger: glob
globs: libs/frontend/**/*.ts
---

# core - Frontend Services & State

**Active**: Working in `libs/frontend/core/**/*.ts`

## Purpose

Foundation for ALL frontend features. Provides signal-based state management (AppState Manager), VS Code RPC communication (VSCodeService), chat state (ChatService), and shared business logic.

## Responsibilities

✅ **State Management**: AppStateManager (navigation, global UI state)
✅ **VS Code Communication**: VSCodeService (RPC messaging)
✅ **Chat State**: ChatService (messages, streaming, sessions)
✅ **Provider State**: ProviderService (AI provider selection)
✅ **Settings**: SettingsService (user preferences)

❌ **NOT**: UI components (→ chat/ui/dashboard), backend logic (→ backend libs)

## Services

```
libs/frontend/core/src/lib/services/
├── app-state-manager.service.ts    # Navigation & global state
├── vscode.service.ts               # RPC communication
├── chat.service.ts                 # Chat state (messages, streaming)
├── provider.service.ts             # AI provider state
├── settings.service.ts             # User settings
└── file-picker.service.ts          # File/folder selection
```

## AppStateManager (Navigation)

### Signal-Based Navigation (NO Angular Router)

```typescript
import { AppStateManagerService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-root',
  template: `
    @switch (appState().currentView) { @case ('chat') {
    <ptah-chat-container />
    } @case ('dashboard') {
    <ptah-dashboard />
    } @case ('setup') {
    <ptah-setup-wizard />
    } }
  `,
})
export class AppComponent {
  protected readonly appState = inject(AppStateManagerService).appState;
}
```

### API

```typescript
export class AppStateManagerService {
  // Private state
  private readonly _appState = signal<AppState>({
    currentView: 'chat',
    sidebarOpen: true,
    theme: 'dark',
  });

  // Public readonly
  readonly appState = this._appState.asReadonly();

  // Navigation
  navigateTo(view: ViewType): void {
    this._appState.update((state) => ({
      ...state,
      currentView: view,
    }));
  }

  // UI state
  toggleSidebar(): void {
    this._appState.update((state) => ({
      ...state,
      sidebarOpen: !state.sidebarOpen,
    }));
  }
}
```

## VSCodeService (RPC Communication)

### Posting Messages to Extension

```typescript
import { VSCodeService } from '@ptah-extension/core';

export class ChatComponent {
  private readonly vscode = inject(VSCodeService);

  sendMessage(message: string): void {
    this.vscode.postMessage<ChatStartMessage>({
      type: ' chat:start',
      payload: {
        message,
        model: this.selectedModel(),
        files: this.attachedFiles(),
      },
    });
  }
}
```

### Receiving Messages from Extension

```typescript
ngOnInit(): void {
  // Type-safe message handlers
  this.vscode.onMessage<ChatStreamingMessage>(
    'chat:streaming',
    (msg) => {
      this.chatService.appendToken(msg.payload.token);
    }
  );

  this.vscode.onMessage<ChatCompleteMessage>(
    'chat:complete',
    (msg) => {
      this.chatService.finalizeMessage(msg.payload.messageId);
    }
  );

  this.vscode.onMessage<ChatErrorMessage>(
    'chat:error',
    (msg) => {
      this.handleError(msg.payload.error);
    }
  );
}
```

### API

```typescript
export class VSCodeService {
  // Post message to extension
  postMessage<T extends RpcMessage>(message: T): void {
    this.vscodeApi.postMessage(message);
  }

  // Listen for specific message type
  onMessage<T extends RpcMessage>(type: T['type'], handler: (message: T) => void): void {
    window.addEventListener('message', (event) => {
      if (event.data.type === type) {
        handler(event.data as T);
      }
    });
  }

  // Request-response pattern
  async request<TReq, TRes>(message: TReq, responseType: string, timeout = 5000): Promise<TRes> {
    const requestId = uuid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject('Timeout'), timeout);

      this.onMessage(responseType, (res: any) => {
        if (res.requestId === requestId) {
          clearTimeout(timer);
          resolve(res);
        }
      });

      this.postMessage({ ...message, requestId });
    });
  }
}
```

## ChatService (Chat State)

### Managing Messages & Streaming

```typescript
import { ChatService } from '@ptah-extension/core';

export class ChatService {
  // Messages
  private readonly _messages = signal<ChatMessage[]>([]);
  readonly messages = this._messages.asReadonly();

  // Streaming
  private readonly _streamingText = signal('');
  private readonly _isStreaming = signal(false);
  readonly streamingText = this._streamingText.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();

  // Sessions
  private readonly _sessions = signal<SessionData[]>([]);
  private readonly _currentSessionId = signal<SessionId | null>(null);
  readonly sessions = this._sessions.asReadonly();
  readonly currentSessionId = this._currentSessionId.asReadonly();

  // Computed
  readonly currentSession = computed(() => {
    const id = this._currentSessionId();
    return this._sessions().find((s) => s.id === id) ?? null;
  });

  // Actions
  addMessage(msg: ChatMessage): void {
    this._messages.update((msgs) => [...msgs, msg]);
  }

  startStream(sessionId: SessionId): void {
    this._isStreaming.set(true);
    this._streamingText.set('');
    this._currentSessionId.set(sessionId);
  }

  appendToken(token: string): void {
    this._streamingText.update((text) => text + token);
  }

  stopStream(): void {
    this._isStreaming.set(false);
    // Finalize message
    this.addMessage({
      id: uuid() as MessageId,
      sessionId: this._currentSessionId()!,
      role: 'assistant',
      content: this._streamingText(),
      timestamp: Date.now(),
    });
    this._streamingText.set('');
  }

  createSession(name?: string): void {
    const session: SessionData = {
      id: uuid() as SessionId,
      name: name ?? `Session ${this._sessions().length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    };
    this._sessions.update((sessions) => [...sessions, session]);
    this._currentSessionId.set(session.id);
  }

  switchSession(sessionId: SessionId): void {
    this._currentSessionId.set(sessionId);
    // Load messages for this session
    this.loadSessionMessages(sessionId);
  }

  deleteSession(sessionId: SessionId): void {
    this._sessions.update((sessions) => sessions.filter((s) => s.id !== sessionId));

    if (this._currentSessionId() === sessionId) {
      const remaining = this._sessions();
      this._currentSessionId.set(remaining.length > 0 ? remaining[0].id : null);
    }
  }
}
```

## ProviderService (AI Provider State)

```typescript
export class ProviderService {
  private readonly _providers = signal<AIProvider[]>([]);
  private readonly _selectedProvider = signal<string>('claude');
  private readonly _selectedModel = signal<string>('claude-3.5-sonnet');

  readonly providers = this._providers.asReadonly();
  readonly selectedProvider = this._selectedProvider.asReadonly();
  readonly selectedModel = this._selectedModel.asReadonly();

  // Computed
  readonly currentProvider = computed(() => {
    const id = this._selectedProvider();
    return this._providers().find((p) => p.id === id) ?? null;
  });

  readonly availableModels = computed(() => {
    return this.currentProvider()?.models ?? [];
  });

  selectProvider(providerId: string): void {
    this._selectedProvider.set(providerId);
    // Set first model as default
    const models = this.availableModels();
    if (models.length > 0) {
      this._selectedModel.set(models[0].id);
    }
  }

  selectModel(modelId: string): void {
    this._selectedModel.set(modelId);
  }
}
```

## SettingsService (User Preferences)

```typescript
export class SettingsService {
  private readonly _settings = signal<Settings>({
    theme: 'dark',
    fontSize: 14,
    autoSave: true,
    showLineNumbers: true,
  });

  readonly settings = this._settings.asReadonly();

  updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this._settings.update((settings) => ({
      ...settings,
      [key]: value,
    }));

    // Persist to VS Code
    this.vscode.postMessage({
      type: 'settings:update',
      payload: { key, value },
    });
  }
}
```

## Testing

### Service Testing with Signals

```typescript
import { TestBed } from '@angular/core/testing';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ChatService],
    });
    service = TestBed.inject(ChatService);
  });

  it('should add message to signal', () => {
    const msg: ChatMessage = {
      id: '1' as MessageId,
      sessionId: 'sess-1' as SessionId,
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    service.addMessage(msg);

    expect(service.messages()).toContain(msg);
    expect(service.messages().length).toBe(1);
  });

  it('should handle streaming', () => {
    const sessionId = 'sess-1' as SessionId;

    service.startStream(sessionId);
    expect(service.isStreaming()).toBe(true);
    expect(service.streamingText()).toBe('');

    service.appendToken('Hello');
    service.appendToken(' world');
    expect(service.streamingText()).toBe('Hello world');

    service.stopStream();
    expect(service.isStreaming()).toBe(false);
    expect(service.messages().length).toBe(1);
  });
});
```

## Rules

1. **ALL state: signals** - No RxJS BehaviorSubject
2. **Readonly exposure** - Private writable, public readonly
3. **Computed for derived state** - Don't duplicate state
4. **VS Code communication: VSCodeService** - Type-safe RPC
5. **NO Angular Router** - Signal-based navigation via AppStateManager

## Commands

```bash
nx test core
nx build core
nx typecheck core
```
