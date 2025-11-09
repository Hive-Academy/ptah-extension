# Browser Testing - Quick Reference

## 🚀 Quick Start

```bash
npm run serve:webview
```

Open: **<http://localhost:4200>**

## 📋 What Works

✅ Full Angular webview UI  
✅ Chat with streaming responses  
✅ Session management  
✅ Provider switching  
✅ All navigation  
✅ Hot reload enabled

## 🎯 Two Guarantees

1. **Mock API is exactly like VS Code events** ✅

   - Same message types
   - Same payloads
   - Same timing patterns

2. **Angular app works seamlessly in both environments** ✅
   - Browser (development)
   - VS Code (production)
   - Zero code changes needed

## 🔧 Key Files

| File                        | Purpose                      |
| --------------------------- | ---------------------------- |
| `environment.ts`            | Dev config (mock enabled)    |
| `environment.production.ts` | Prod config (real API)       |
| `mock-vscode-api.ts`        | Complete mock implementation |
| `mock-data-generator.ts`    | Test data and responses      |

## 📚 Documentation

- [Full Mock System Docs](../apps/ptah-extension-webview/src/mock/README.md)
- [Browser Testing Guide](./BROWSER_TESTING_GUIDE.md)
- [Implementation Summary](./MOCK_IMPLEMENTATION_SUMMARY.md)

## 🎨 Customization

### Change Response Speed

```typescript
// environment.ts
mockDelay: 150; // milliseconds
```

### Add Custom Response

```typescript
// mock-data-generator.ts
if (userMessage.includes('keyword')) {
  return 'Custom response';
}
```

## ✅ Verified Features

- [x] Message protocol exact match
- [x] Streaming AI responses
- [x] Session state management
- [x] Provider management
- [x] Auto environment detection
- [x] Production build excludes mock
- [x] Components unchanged

## 🎉 Done

Run `npm run serve:webview` and start developing!
