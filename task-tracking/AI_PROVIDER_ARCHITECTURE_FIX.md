# AI Provider Architecture Fix

**Date**: January 15, 2025  
**Problem**: Recurring dependency injection errors due to token conflicts  
**Root Cause**: Architectural boundary violation between infrastructure and domain layers

## ✅ **Solution Implemented**

### **Before (❌ Broken Architecture)**

```typescript
// vscode-core (infrastructure) defining domain tokens
export const AI_PROVIDER_MANAGER = Symbol.for('AIProviderManager');

// claude-domain (domain) defining duplicate tokens
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');

// main.ts manually registering + hacky workaround
container.registerSingleton(TOKENS.AI_PROVIDER_MANAGER, ProviderManager);
const { PROVIDER_MANAGER } = require('@ptah-extension/claude-domain'); // ❌ Inconsistent import
container.register(PROVIDER_MANAGER, {
  useFactory: () => container.resolve(TOKENS.AI_PROVIDER_MANAGER), // ❌ Hacky bridge
});
```

### **After (✅ Clean Architecture)**

```typescript
// vscode-core: No domain tokens (pure infrastructure)

// claude-domain: Single source of truth for tokens
export const PROVIDER_MANAGER = Symbol.for('ProviderManager');

// ai-providers-core: Bootstrap function following standard pattern
export function registerAIProviderServices(container, tokens) {
  container.registerSingleton(tokens.PROVIDER_MANAGER, ProviderManager);
}

// main.ts: Clean bootstrap pattern
const aiProviderTokens: AIProviderTokens = {
  PROVIDER_MANAGER: CLAUDE_PROVIDER_MANAGER, // Clean ES6 import
};
registerAIProviderServices(DIContainer.getContainer(), aiProviderTokens);
```

## 🏗️ **Architecture Benefits**

1. **Clean Library Boundaries**: Infrastructure ≠ Domain
2. **Single Source of Truth**: claude-domain owns its tokens
3. **Consistent Patterns**: All libraries use bootstrap functions
4. **No Token Conflicts**: Each service registered once under correct token
5. **Maintainable**: No more hacky workarounds or manual registration

## 📊 **Files Modified**

### Created

- `libs/backend/ai-providers-core/src/di/register.ts` - Bootstrap function

### Modified

- `libs/backend/ai-providers-core/src/index.ts` - Export bootstrap
- `libs/backend/vscode-core/src/di/tokens.ts` - Remove domain tokens
- `apps/ptah-extension-vscode/src/main.ts` - Use bootstrap pattern

### Result

- ✅ Build passes
- ✅ Proper architecture boundaries
- ✅ No token conflicts
- ✅ Consistent with other libraries (workspace-intelligence pattern)

**This fix should eliminate the recurring "Cannot inject dependency" errors permanently.**
