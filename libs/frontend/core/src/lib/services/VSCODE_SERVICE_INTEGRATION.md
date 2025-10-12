# VSCodeService Integration Guide

## Overview

`VSCodeService` is the bridge between the Angular webview application and the VS Code extension host. It provides type-safe message passing, reactive state management, and proper lifecycle integration with Angular.

## Architecture

### How VS Code Webview Communication Works

```text
┌─────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                               │
│  - AngularWebviewProvider                                       │
│  - WebviewHtmlGenerator                                         │
│  - Event bus for backend services                               │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ Injects globals BEFORE Angular bootstrap
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  HTML Bootstrap Script (webview-html-generator.ts)              │
│  - Calls acquireVsCodeApi() → window.vscode                     │
│  - Injects window.ptahConfig (theme, workspace, URIs)           │
│  - Sets up message listeners                                    │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   │ Angular application starts
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│  Angular Application (apps/ptah-extension-webview)              │
│  - VSCodeService reads from window.vscode (already acquired)    │
│  - Initializes with window.ptahConfig                           │
│  - Sets up reactive message streams                             │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. **Extension Host Acquires VS Code API**

**Why**: `acquireVsCodeApi()` can only be called **once** per webview lifetime.

**Implementation**:

- Extension host calls it in the bootstrap script (before Angular loads)
- Stores result in `window.vscode`
- Angular service references the already-acquired API

**Code** (in `webview-html-generator.ts`):

```typescript
const vscode = acquireVsCodeApi();
window.vscode = vscode;
window.ptahConfig = { /* config */ };
```

### 2. **Signal-Based Reactive State**

**Why**: Modern Angular 20+ patterns for reactive state management.

**Implementation**:

- `_config` signal for webview configuration (theme, workspace, URIs)
- `_isConnected` signal for connection state
- Computed signals for derived state (`isDevelopmentMode`, `currentTheme`)

**Benefits**:

- Automatic change detection with OnPush components
- No manual subscriptions needed in components
- Type-safe reactive state

### 3. **APP_INITIALIZER Integration**

**Why**: Ensures VSCodeService is initialized before application starts.

**Implementation**:

```typescript
export function provideVSCodeService() {
  return [
    VSCodeService,
    {
      provide: 'APP_INITIALIZER',
      useFactory: initializeVSCodeService,
      deps: [VSCodeService],
      multi: true,
    },
  ];
}
```

**Benefits**:

- Eager service instantiation (not lazy)
- Config loaded before any component renders
- Theme listener active from app start

## Integration Steps

### Step 1: Add to Application Config

**File**: `apps/ptah-extension-webview/src/app/app.config.ts`

```typescript
import { ApplicationConfig } from '@angular/core';
import { provideVSCodeService } from '@ptah-extension/frontend/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideVSCodeService(), // Add this
    // ... other providers
  ]
};
```

### Step 2: Use in Components

**Example**: Chat component using VSCodeService

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { VSCodeService } from '@ptah-extension/frontend/core';

@Component({
  selector: 'app-chat',
  standalone: true,
  // ...
})
export class ChatComponent implements OnInit {
  private readonly vscode = inject(VSCodeService);

  // Reactive state via signals
  readonly isConnected = this.vscode.isConnected;
  readonly currentTheme = this.vscode.currentTheme;
  readonly isDevelopment = this.vscode.isDevelopmentMode;

  ngOnInit() {
    // Subscribe to specific message types (type-safe)
    this.vscode.onMessageType('chat:messageChunk')
      .subscribe(payload => this.handleMessageChunk(payload));

    // Send messages to extension (type-safe)
    this.vscode.sendChatMessage('Hello, Claude!');
  }

  private handleMessageChunk(payload: ChatMessageChunkPayload) {
    // Payload is fully typed from MessagePayloadMap
    console.log('Received chunk:', payload.content);
  }
}
```

### Step 3: Template Usage

**Example**: Conditionally render based on connection state

```html
<div class="chat-container" [attr.data-theme]="vscode.currentTheme()">
  @if (vscode.isConnected()) {
    <!-- Production mode UI -->
    <app-chat-messages />
  } @else {
    <!-- Development mode UI -->
    <div class="dev-mode-banner">
      Running in Development Mode
    </div>
  }
</div>
```

## Message Handling

### Sending Messages (Type-Safe)

```typescript
// All message types are strictly typed via MessagePayloadMap
this.vscode.postStrictMessage('chat:sendMessage', {
  content: 'Hello',
  files: ['file1.ts'],
  correlationId: crypto.randomUUID() as CorrelationId,
});

// Helper methods for common operations
this.vscode.sendChatMessage('Hello'); // Convenience wrapper
this.vscode.createNewChatSession('My Session');
this.vscode.switchProvider('claude-cli');
```

### Receiving Messages (Type-Safe)

```typescript
// Subscribe to specific message type
this.vscode.onMessageType('chat:messageChunk').subscribe(payload => {
  // payload is ChatMessageChunkPayload (fully typed)
  console.log(payload.content, payload.isComplete);
});

// Subscribe to all messages
this.vscode.onMessage().subscribe(message => {
  // message is StrictMessage with discriminated union type
  if (message.type === 'chat:messageChunk') {
    // TypeScript narrows payload type automatically
    console.log(message.payload.content);
  }
});
```

## Development vs Production

### Development Mode (No VS Code API)

When running `npm run dev:webview`:

- `window.vscode` is undefined
- `isConnected()` returns false
- `isDevelopmentMode()` returns true
- Messages are logged to console instead of sent

### Production Mode (VS Code Webview)

When running in VS Code (`F5` Extension Development Host):

- `window.vscode` is the acquired VS Code API
- `isConnected()` returns true
- `isDevelopmentMode()` returns false
- Messages are sent to extension host

## Configuration

### Webview Configuration Interface

```typescript
export interface WebviewConfig {
  isVSCode: boolean;           // True when running in VS Code
  theme: 'light' | 'dark' | 'high-contrast'; // Current theme
  workspaceRoot: string;       // Workspace folder path
  workspaceName: string;       // Workspace name
  extensionUri: string;        // Extension URI for resources
  baseUri: string;             // Base URI for webview assets
  iconUri: string;             // Ptah icon URI
}
```

### Accessing Configuration

```typescript
// Via signal (reactive)
const theme = this.vscode.currentTheme(); // Computed signal
const config = this.vscode.config();      // Full config signal

// Via method (snapshot)
const theme = this.vscode.config().theme;
const iconUri = this.vscode.getPtahIconUri();
```

## Theme Handling

### Automatic Theme Updates

The service automatically listens for `themeChanged` messages from the extension:

```typescript
// In setupThemeListener()
this.onMessageType('themeChanged').subscribe(payload => {
  this._config.update(current => ({
    ...current,
    theme: payload.theme,
  }));
});
```

### Using Theme in Components

```typescript
@Component({
  template: `
    <div [attr.data-theme]="theme()">
      <!-- Theme-aware UI -->
    </div>
  `
})
export class MyComponent {
  private readonly vscode = inject(VSCodeService);

  // Reactive theme signal
  readonly theme = this.vscode.currentTheme;
}
```

## Best Practices

### ✅ DO

- Use `provideVSCodeService()` in app.config.ts
- Use `inject()` pattern in components
- Subscribe to specific message types with `onMessageType()`
- Use signals for reactive state (`isConnected()`, `currentTheme()`)
- Use helper methods for common operations (`sendChatMessage()`, etc.)

### ❌ DON'T

- Don't call `acquireVsCodeApi()` yourself (extension host does this)
- Don't access `window.vscode` directly (use VSCodeService)
- Don't manually manage subscriptions (use async pipe or takeUntilDestroyed)
- Don't use `any` types for message payloads (use MessagePayloadMap)
- Don't create multiple instances of VSCodeService (it's providedIn: 'root')

## Troubleshooting

### Issue: "Cannot read property 'postMessage' of undefined"

**Cause**: VS Code API not available (development mode)

**Solution**: Check `isConnected()` before sending messages:

```typescript
if (this.vscode.isConnected()) {
  this.vscode.sendChatMessage('Hello');
} else {
  console.log('[Dev Mode] Would send message');
}
```

### Issue: "acquireVsCodeApi can only be called once"

**Cause**: Trying to call `acquireVsCodeApi()` after extension host already called it

**Solution**: Use `window.vscode` (already acquired) instead of calling `acquireVsCodeApi()` again

### Issue: Messages not received in webview

**Cause**: Message listener not set up before messages sent

**Solution**: Use `APP_INITIALIZER` via `provideVSCodeService()` to ensure setup happens early

## Migration from Old Implementation

### Old (❌ Problematic)

```typescript
const vscode = acquireVsCodeApi(); // Can only call once!
window.initialConfig = { ... };    // Wrong property name
```

### New (✅ Correct)

```typescript
// Extension host does this in bootstrap script:
const vscode = acquireVsCodeApi();
window.vscode = vscode;
window.ptahConfig = { ... };

// Angular service uses it:
this.vscode = window.vscode; // Reference already-acquired API
this._config.set(window.ptahConfig);
```

## Related Files

- **VSCodeService**: `libs/frontend/core/src/lib/services/vscode.service.ts`
- **Message Types**: `libs/shared/src/lib/types/message.types.ts`
- **Backend Provider**: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
- **HTML Generator**: `apps/ptah-extension-vscode/src/services/webview-html-generator.ts`

## Summary

The VSCodeService provides a clean, type-safe, Angular-idiomatic way to communicate with the VS Code extension host. By using signals, APP_INITIALIZER, and the inject pattern, it integrates seamlessly with modern Angular 20+ applications while properly handling the unique constraints of VS Code webview environments.
