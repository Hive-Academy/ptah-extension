# Mock VS Code API System

## Overview

This mock system allows the Angular webview to run standalone in a browser for development, exactly mirroring the VS Code extension's message protocol.

## Architecture

### Two-Environment Design

```
┌─────────────────────────────────────────────────────────────┐
│                     Angular Webview                          │
├─────────────────────────────────────────────────────────────┤
│                     VSCodeService                            │
│              (No changes needed in components)               │
├──────────────────────────┬──────────────────────────────────┤
│   Production             │   Development                     │
│   (VS Code)              │   (Browser)                       │
├──────────────────────────┼──────────────────────────────────┤
│ window.vscode            │ MockVSCodeApiImpl                 │
│ (Real Extension)         │ (Simulated Extension)             │
└──────────────────────────┴──────────────────────────────────┘
```

### Key Components

1. **`environment.ts`**: Development config with `useMockApi: true`
2. **`environment.production.ts`**: Production config with `useMockApi: false`
3. **`mock-vscode-api.ts`**: Complete mock implementation
4. **`mock-data-generator.ts`**: Realistic test data
5. **`main.ts`**: Environment detection and initialization

## Features

### ✅ Exact Message Protocol Match

Every message type handled by the extension is implemented in the mock:

- **Chat**: `chat:sendMessage`, `chat:newSession`, `chat:switchSession`, etc.
- **Providers**: `providers:getAvailable`, `providers:switch`, etc.
- **Context**: `context:getFiles`, `context:includeFile`, etc.
- **Analytics**: `analytics:trackEvent`, `analytics:getData`
- **State**: `state:save`, `state:load`, `state:clear`

### ✅ Streaming Simulation

The mock simulates realistic AI streaming responses:

```typescript
// User sends message
vscode.postMessage({ type: 'chat:sendMessage', payload: { content: 'Hello' } });

// Mock responds with chunks over time
// Chunk 1 (150ms delay): 'This is '
// Chunk 2 (300ms delay): 'a streaming '
// Chunk 3 (450ms delay): 'response!'
// Final (550ms): messageComplete event
```

### ✅ State Management

The mock maintains full session state:

- Multiple sessions with conversation history
- Current session tracking
- Session switching and creation
- Message persistence within mock session

### ✅ Provider Management

Mock providers behave exactly like real ones:

- Multiple providers (`claude-cli`, `vscode-lm`)
- Provider switching
- Health status updates
- Availability notifications

## Usage

### Running in Browser

```bash
# Development mode (uses mock API)
npm run serve
# or
nx serve ptah-extension-webview

# Open browser to http://localhost:4200
```

### Running in VS Code

```bash
# Production build (uses real VS Code API)
npm run build:webview
# or
nx build ptah-extension-webview

# Press F5 in VS Code to test
```

### No Code Changes Needed

Your components work **identically** in both environments:

```typescript
@Component({
  selector: 'ptah-chat',
  template: `...`,
})
export class ChatComponent {
  private readonly vscode = inject(VSCodeService);

  sendMessage(content: string): void {
    // Works in BOTH browser and VS Code
    this.vscode.sendChatMessage(content);
  }

  ngOnInit(): void {
    // Works in BOTH browser and VS Code
    this.vscode
      .onMessageType('chat:messageChunk')
      .pipe(takeUntil(this.destroy$))
      .subscribe((chunk) => this.handleChunk(chunk));
  }
}
```

## Mock Data

### Sessions

The mock starts with 3 pre-populated sessions:

1. **Current Development Session**: 8 messages, active
2. **Feature Implementation Planning**: 15 messages, recent
3. **Bug Investigation**: 6 messages, older

### Messages

Each session has realistic conversation pairs:

- User questions about the codebase
- Assistant responses with code examples
- Proper timestamps and ordering
- Token usage tracking

### Providers

Two mock providers are available:

- **Claude CLI**: Default, available
- **VS Code LM**: Available, can be switched to

## Customization

### Adding Mock Responses

Edit `mock-data-generator.ts`:

```typescript
public static generateMockResponse(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase();

  if (lowerMessage.includes('your-keyword')) {
    return 'Your custom mock response here';
  }

  // ... existing responses
}
```

### Adjusting Delays

Edit `environment.ts`:

```typescript
export const environment = {
  mockDelay: 150, // Change to 0 for instant responses, 500 for slower
};
```

### Adding New Message Types

1. Add handler in `mock-vscode-api.ts`:

```typescript
case 'your:newMessageType': {
  const { data } = payload as MessagePayloadMap['your:newMessageType'];

  // Process and respond
  respondWith('your:newMessageType:response', {
    success: true,
    result: data,
  });
  break;
}
```

2. No changes needed anywhere else!

## Debugging

### Logging

All mock activity is logged to console:

```
[Mock VSCode API] Initialized with: { sessions: 3, providers: 2 }
[Mock VSCode API] Received message: chat:sendMessage { content: "Hello" }
[Mock VSCode API] Sending to webview: chat:messageChunk { ... }
```

### Disable Logging

Edit `environment.ts`:

```typescript
export const environment = {
  enableLogging: false,
};
```

## Testing Scenarios

### Test Streaming Responses

1. Open browser to `http://localhost:4200`
2. Send a message in chat
3. Watch chunks arrive in real-time

### Test Provider Switching

1. Navigate to Settings
2. Click on provider switcher
3. Select different provider
4. Verify UI updates

### Test Session Management

1. Create new session
2. Switch between sessions
3. Rename a session
4. Delete a session

### Test Error Handling

Edit mock to return errors:

```typescript
case 'chat:sendMessage':
  respondWith('error', {
    code: 'MOCK_ERROR',
    message: 'Simulated error for testing',
  });
  break;
```

## Production Build

The mock is **automatically excluded** from production builds:

```typescript
// main.ts - mock is only imported if needed
if (environment.useMockApi && !window.vscode) {
  const { createMockVSCodeApi } = await import('./mock/mock-vscode-api');
  // ^^ Dynamic import - not included in production bundle
}
```

Production bundle contains:

- ✅ Real VSCodeService
- ✅ Angular components
- ❌ Mock API (excluded via tree-shaking)
- ❌ Mock data (excluded via tree-shaking)

## Benefits

### For Development

- ⚡ **Fast Iteration**: No need to rebuild extension
- 🔍 **Browser DevTools**: Full access to debugging tools
- 🔄 **Hot Reload**: Changes reflect instantly
- 🧪 **Easy Testing**: Test UI without extension complexity

### For Quality

- ✅ **Type Safety**: All mocks use exact same types as extension
- ✅ **Protocol Match**: Message handling identical to extension
- ✅ **Realistic**: Delays, streaming, state management all simulated
- ✅ **No Divergence**: Single source of truth for message types

### For Team

- 👥 **Frontend Focus**: Frontend devs can work without extension knowledge
- 📱 **Quick Demos**: Show UI to stakeholders in browser
- 🐛 **Isolated Debugging**: Test UI issues without extension variables
- 📚 **Documentation**: Mock serves as living documentation of protocol

## Troubleshooting

### Mock Not Loading

Check console for:

```
🎭 MOCK ENVIRONMENT INITIALIZATION
```

If missing, verify:

- Running with `nx serve` (not production build)
- `environment.ts` has `useMockApi: true`
- No errors in console

### Messages Not Working

1. Check `MessagePayloadMap` includes your message type
2. Verify handler exists in `mock-vscode-api.ts`
3. Check console for mock logs

### Streaming Not Working

Verify `environment.mockDelay` is greater than 0:

```typescript
export const environment = {
  mockDelay: 150, // Should be > 0
};
```

## Future Enhancements

Potential improvements:

- [ ] WebSocket-based mock for more realistic network simulation
- [ ] Mock persistence using localStorage
- [ ] Configurable mock data via UI
- [ ] Record/replay mode for capturing real extension traffic
- [ ] Storybook integration for component-level mocking

## Related Documentation

- [AGENTS.md](../../../../AGENTS.md) - Project architecture
- [VSCodeService](../libs/frontend/core/src/lib/services/vscode.service.ts) - Real service
- [Message Types](../../../../libs/shared/src/lib/types/message.types.ts) - Type definitions
