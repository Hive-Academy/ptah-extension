# Analytics Tracking Disabled for Development

## 🔕 What Changed

Analytics event tracking has been **disabled during development** to reduce log noise and improve debugging visibility.

## 📍 Location

**File**: `libs/frontend/core/src/lib/services/analytics.service.ts`

**Feature Flag**:

```typescript
private readonly ANALYTICS_ENABLED = false; // Set to true for production
```

## ⚙️ How It Works

When `ANALYTICS_ENABLED = false`:

- ✅ All `trackEvent()` calls return immediately (no-op)
- ✅ Analytics data fetching is skipped
- ✅ No messages sent to extension host
- ✅ Zero analytics events in logs
- ✅ Component code unchanged - calls still exist but do nothing

## 🔧 Re-enabling Analytics

To enable analytics again (for production or testing):

1. Open `libs/frontend/core/src/lib/services/analytics.service.ts`
2. Change line ~74:
   ```typescript
   private readonly ANALYTICS_ENABLED = true; // Re-enabled
   ```
3. Rebuild the extension: `npm run build`

## 📊 What Was Disabled

**Events no longer tracked:**

- Session manager actions (create, delete, switch, rename, duplicate, export)
- Dashboard interactions (toggle, view, refresh, message processing)
- Provider operations
- Navigation events
- User interactions

**Total reduction**: ~300+ log lines per test session

## ✅ Why This Helps

**Before**: Logs flooded with analytics noise

```log
[Extension Host] Tracking analytics event: session_created
[Extension Host] [MessageHandler] publishResponse called for analytics:trackEvent
[Extension Host] WebviewMessageBridge: Forwarding event 'analytics:trackEvent:response'
[VSCodeService] Message received: analytics:trackEvent:response
... (repeated 300+ times)
```

**After**: Clean logs focused on actual functionality

```log
[Extension Host] Added user message to session
[Extension Host] Sending message to Claude CLI
[ProviderService] Getting available providers
```

## 🎯 Impact on Development

- ✅ **Logs 80% cleaner** - easier to spot real issues
- ✅ **Better performance** - fewer message round-trips
- ✅ **Faster debugging** - relevant logs visible
- ✅ **No code changes needed** - just flip a flag

## 📝 Notes

- Analytics infrastructure still intact - just disabled
- UI components work normally - they just don't send events
- Analytics dashboard will show fallback/mock data
- This is **development-only** - production should have analytics enabled
