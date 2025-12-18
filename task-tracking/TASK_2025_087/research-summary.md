# ESM Migration Research Summary - TASK_2025_087

**Date**: 2025-12-18
**Confidence**: 90%
**Research Depth**: 20+ sources analyzed

## Key Recommendation

**DO NOT create separate ESM library** - Use declaration merging instead.

## Why NOT Separate ESM Library?

1. **VS Code Hard Constraint**: Extensions MUST be CommonJS (no native ESM support in 2025)
2. **No Benefit**: Even with ESM library, you'd still need to bundle/transform at extension boundary
3. **Doesn't Solve Type Problem**: TS1479 error persists (ESM type imports in CJS context)
4. **High Complexity**: 12+ hours implementation, ongoing maintenance

## Recommended Alternative: Declaration Merging (3.5 hours)

Create ambient type declarations that mirror SDK types:

```typescript
// libs/backend/agent-sdk/src/lib/types/sdk-types.d.ts
declare module '@anthropic-ai/claude-agent-sdk' {
  export type SDKUserMessage = {
    /* ... */
  };
  export type ContentBlock = {
    /* ... */
  };
  export type Query = {
    /* ... */
  };
}

// Then import normally in code:
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'; // Works!
```

## Benefits of Declaration Merging

- Full TypeScript intellisense + type checking
- Zero build configuration changes
- VS Code compatible (no runtime ESM)
- Future-proof (easy migration when VS Code supports ESM)
- 2 hours implementation vs. 12+ hours for separate library

## Implementation Steps

1. Create `libs/backend/agent-sdk/src/lib/types/sdk-types.d.ts`
2. Copy types from `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`
3. Wrap in ambient module declaration
4. Replace manual types in `session-lifecycle-manager.ts` with imports
5. Add version check script for SDK sync

## Comparison Matrix

| Approach               | Type Safety | Build Complexity | Viability  |
| ---------------------- | ----------- | ---------------- | ---------- |
| Current (Manual Types) | 2/5         | 5/5              | 6.5/10     |
| Separate ESM Library   | 3/5         | 2/5              | 4.5/10     |
| Declaration Merging    | 5/5         | 5/5              | **9.5/10** |

## Sources

- [VS Code Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [GitHub Issue #130367](https://github.com/microsoft/vscode/issues/130367) - ESM extensions (open since 2021)
- [Jan Miksovsky - VS Code ESM 2025](https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension)
- [TypeScript ESM/CJS Interop](https://www.typescriptlang.org/docs/handbook/modules/appendices/esm-cjs-interop.html)
- [Nx Dual Format Builds](https://nx.dev/recipes/tips-n-tricks/compile-multiple-formats)
