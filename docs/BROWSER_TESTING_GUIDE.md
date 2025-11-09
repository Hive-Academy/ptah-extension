# Browser Testing Guide

## Quick Start

### Run Webview in Browser

```bash
npm run serve:webview
```

Then open: **http://localhost:4200**

✅ **That's it!** The mock API is automatically initialized.

## What You Get

### Full Webview Experience

- ✅ Complete UI rendered in browser
- ✅ All components functional
- ✅ Real-time message handling
- ✅ Streaming AI responses simulated
- ✅ Session management working
- ✅ Provider switching functional

### Developer Benefits

- ⚡ **Hot Reload**: Changes reflect instantly
- 🔍 **DevTools**: Full browser debugging
- 🚀 **Fast Iteration**: No extension rebuild needed
- 🧪 **Easy Testing**: Isolated UI testing

## How It Works

### Environment Detection

```typescript
// Automatically detects environment
if (environment.useMockApi && !window.vscode) {
  // Initialize mock VS Code API
  window.vscode = createMockVSCodeApi();
}
```

### No Code Changes

Your components work **identically** in both environments:

```typescript
// This code works in BOTH browser and VS Code
this.vscode.sendChatMessage('Hello');
this.vscode.onMessageType('chat:messageChunk').subscribe(...);
```

### Exact Protocol Match

The mock API handles **all** the same messages as the real extension:

| Message Category | Examples                                                    |
| ---------------- | ----------------------------------------------------------- |
| **Chat**         | `chat:sendMessage`, `chat:newSession`, `chat:switchSession` |
| **Providers**    | `providers:getAvailable`, `providers:switch`                |
| **Context**      | `context:getFiles`, `context:includeFile`                   |
| **Analytics**    | `analytics:trackEvent`, `analytics:getData`                 |
| **State**        | `state:save`, `state:load`                                  |

## Development Workflow

### Typical Session

1. **Start Server**

   ```bash
   npm run serve:webview
   ```

2. **Open Browser**

   - Navigate to http://localhost:4200
   - See mock console messages

3. **Develop**

   - Edit components in `apps/ptah-extension-webview/src`
   - Changes hot-reload automatically
   - Test UI interactions

4. **Test in VS Code**
   ```bash
   npm run build:all
   # Press F5 in VS Code
   ```

### Testing Specific Features

#### Test Chat Streaming

1. Open http://localhost:4200
2. Type a message in chat
3. Watch streaming response chunks arrive
4. Check console for mock logs

#### Test Session Management

1. Click "New Session" button
2. Switch between sessions
3. Rename a session
4. Delete a session
5. Verify state persists during session

#### Test Provider Switching

1. Navigate to Settings view
2. Click provider dropdown
3. Select different provider
4. Verify UI updates

## Mock Data

### Pre-populated Sessions

The mock starts with 3 sessions:

1. **Current Development Session**: 8 messages
2. **Feature Implementation Planning**: 15 messages
3. **Bug Investigation**: 6 messages

### Realistic Conversations

Each session has authentic developer conversations:

- Code questions and answers
- TypeScript examples
- Architecture discussions
- Debugging help

### Provider Options

- **Claude CLI** (default)
- **VS Code LM**

## Customization

### Change Response Delay

Edit `apps/ptah-extension-webview/src/environments/environment.ts`:

```typescript
export const environment = {
  mockDelay: 150, // milliseconds
};
```

- `0`: Instant responses
- `150`: Default (realistic)
- `500`: Slower network simulation

### Add Custom Responses

Edit `apps/ptah-extension-webview/src/mock/mock-data-generator.ts`:

```typescript
public static generateMockResponse(userMessage: string): string {
  if (userMessage.includes('your-keyword')) {
    return 'Your custom response';
  }
  // ... existing logic
}
```

### Add New Mock Sessions

Edit `apps/ptah-extension-webview/src/mock/mock-data-generator.ts`:

```typescript
public getMockSessions(): StrictChatSession[] {
  return [
    // ... existing sessions
    {
      id: 'session-custom' as SessionId,
      name: 'Your Custom Session',
      messages: [...],
      // ... other properties
    },
  ];
}
```

## Debugging

### View Mock Logs

Check browser console for:

```plaintext
🎭 MOCK ENVIRONMENT INITIALIZATION
[Mock VSCode API] Initialized with: { sessions: 3, providers: 2 }
[Mock VSCode API] Received message: chat:sendMessage
[Mock VSCode API] Sending to webview: chat:messageChunk
```

### Enable/Disable Logging

Edit `environment.ts`:

```typescript
export const environment = {
  enableLogging: true, // false to disable
};
```

### Test Error Scenarios

Temporarily modify mock to return errors:

```typescript
// In mock-vscode-api.ts
case 'chat:sendMessage':
  respondWith('error', {
    code: 'MOCK_ERROR',
    message: 'Simulated error for testing',
  });
  break;
```

## Production Build

### Mock Automatically Excluded

When building for production (VS Code), the mock is **tree-shaken out**:

```bash
npm run build:webview
# Mock code NOT included in bundle
```

### Environment File Replacement

```json
{
  "fileReplacements": [
    {
      "replace": "environment.ts",
      "with": "environment.production.ts"
    }
  ]
}
```

Production `environment.production.ts`:

```typescript
export const environment = {
  useMockApi: false, // ← Mock disabled
};
```

## Common Issues

### Port Already in Use

```bash
# Kill process on port 4200
npx kill-port 4200

# Or use different port
nx serve ptah-extension-webview --port 4300
```

### Mock Not Loading

**Symptoms**: No mock console messages

**Fix**:

1. Verify `environment.ts` has `useMockApi: true`
2. Check console for errors
3. Ensure running `nx serve` (not production build)

### Messages Not Working

**Symptoms**: Buttons don't work, no responses

**Fix**:

1. Check browser console for errors
2. Verify message type exists in `MessagePayloadMap`
3. Add handler in `mock-vscode-api.ts` if missing

## Best Practices

### ✅ Do

- Use mock for rapid UI development
- Test all UI interactions in browser first
- Add custom mock responses for your use cases
- Keep mock protocol in sync with extension

### ❌ Don't

- Don't commit changes to `environment.production.ts`
- Don't test extension-specific logic in browser
- Don't rely on mock for production testing
- Don't modify mock without updating extension

## Scripts Reference

| Script                      | Purpose               | Environment           |
| --------------------------- | --------------------- | --------------------- |
| `npm run serve:webview`     | Run in browser        | Development (mock)    |
| `npm run build:webview`     | Build for VS Code     | Production (real API) |
| `npm run dev:webview`       | Watch mode build      | Production (real API) |
| `npm run build:webview:dev` | Build with dev config | Development (mock)    |

## Related Documentation

- [Mock System README](../apps/ptah-extension-webview/src/mock/README.md)
- [AGENTS.md](../AGENTS.md)
- [VSCodeService](../libs/frontend/core/src/lib/services/vscode.service.ts)

---

**🎉 Happy Testing!**

The mock system allows you to develop and test the UI with the same confidence as running in VS Code, but with 10x faster iteration speed.
