# TASK_2025_140: Implementation Tasks -- ALL COMPLETE

## Batch 1: Migrate SDK_TOKENS to Symbol.for() & Fix Hardcoded Injections -- COMPLETE

**Developer**: backend-developer
**Status**: COMPLETE
**Tasks**: 4/4 complete | **Dependencies**: None
**Commit**: a46e8ef

### Task 1.1: Convert SDK_TOKENS to Symbol.for() - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
**Dependencies**: None

Convert all string literal and plain Symbol tokens to `Symbol.for()`:

```typescript
// Convert every entry from:
SDK_AGENT_ADAPTER: 'SdkAgentAdapter',
// To:
SDK_AGENT_ADAPTER: Symbol.for('SdkAgentAdapter'),
```

**Full token list to convert** (all entries in `SDK_TOKENS`):

- `SDK_AGENT_ADAPTER` — string → Symbol.for
- `SDK_SESSION_METADATA_STORE` — string → Symbol.for
- `SDK_SESSION_IMPORTER` — string → Symbol.for
- `SDK_PERMISSION_HANDLER` — string → Symbol.for
- `SDK_AUTH_MANAGER` — string → Symbol.for
- `SDK_CONFIG_WATCHER` — string → Symbol.for
- `SDK_CLI_DETECTOR` — string → Symbol.for
- `SDK_CLI_PATH_RESOLVER` — string → Symbol.for
- `SDK_IMAGE_CONVERTER` — string → Symbol.for
- `SDK_SESSION_LIFECYCLE_MANAGER` — string → Symbol.for
- `SDK_SESSION_HISTORY_READER` — string → Symbol.for
- `SDK_ATTACHMENT_PROCESSOR` — `Symbol()` → `Symbol.for()`
- `SDK_ENHANCED_PROMPTS_SERVICE` — string → Symbol.for
- `SDK_PROMPT_DESIGNER_AGENT` — string → Symbol.for
- `SDK_PROMPT_CACHE_SERVICE` — string → Symbol.for
- `SDK_JSONL_READER` — string → Symbol.for
- `SDK_AGENT_CORRELATION` — string → Symbol.for
- `SDK_HISTORY_EVENT_FACTORY` — string → Symbol.for
- `SDK_SESSION_REPLAY` — string → Symbol.for
- `SDK_MESSAGE_FACTORY` — string → Symbol.for
- `SDK_QUERY_OPTIONS_BUILDER` — string → Symbol.for
- (any others present in the file)

**Important**: Remove the comment about "string tokens to avoid Symbol conflicts" — that rationale is incorrect and led to bugs.

**Verification**:

- [ ] Zero string literals in SDK_TOKENS object
- [ ] Zero plain `Symbol()` (non-.for) in SDK_TOKENS object
- [ ] `as const` assertion still works with Symbol.for values
- [ ] Typecheck passes: `nx run agent-sdk:typecheck`

---

### Task 1.2: Verify Token Description Uniqueness - COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts`
  **Dependencies**: Task 1.1

Extract all `Symbol.for('...')` descriptions from all 3 files. Check for collisions where the same description string maps to different tokens used for different services.

**Known potential collision to check**:

- `TOKENS.SDK_AGENT_ADAPTER` in vscode-core = `Symbol.for('SdkAgentAdapter')`
- `SDK_TOKENS.SDK_AGENT_ADAPTER` in agent-sdk = `Symbol.for('SdkAgentAdapter')` (after migration)
- These are **intentionally the same** — they should resolve to the same service. This is correct.

**Action**: If any unintentional collisions exist, rename the description to be unique (e.g., prefix with library name).

**Verification**:

- [ ] All `Symbol.for()` descriptions are globally unique or intentionally shared
- [ ] Document any intentionally shared tokens

---

### Task 1.3: Replace Hardcoded String Injections - COMPLETE

**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\auth-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\config-rpc.handlers.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
  **Dependencies**: Task 1.1

Replace each hardcoded string with proper token import:

```typescript
// BEFORE
import { TOKENS } from '@ptah-extension/vscode-core';
// ...
@inject('SdkAgentAdapter')

// AFTER
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
// ...
@inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
```

Also fix `container.ts`:

```typescript
// BEFORE
c.resolve('SdkAgentAdapter');

// AFTER
c.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
```

**Verification**:

- [ ] `grep -rn "@inject('" apps/ libs/` returns zero results (no string-based injections)
- [ ] `grep -rn "resolve('" apps/ libs/` returns zero results (no string-based resolutions)
- [ ] All imports added correctly

---

### Task 1.4: Remove Bridge Registrations - COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
**Dependencies**: Tasks 1.1, 1.3

Remove the bridge factory registrations that map `TOKENS.SDK_*` to `SDK_TOKENS.SDK_*`:

```typescript
// DELETE these bridge registrations (they're now unnecessary because
// TOKENS.SDK_AGENT_ADAPTER === SDK_TOKENS.SDK_AGENT_ADAPTER
// both are Symbol.for('SdkAgentAdapter'))

container.register(TOKENS.SDK_AGENT_ADAPTER, {
  useFactory: () => {
    const { SDK_TOKENS } = require('@ptah-extension/agent-sdk');
    return container.resolve(SDK_TOKENS.SDK_AGENT_ADAPTER);
  },
});
// ... and any other bridge registrations
```

**Important**: Verify that `TOKENS.SDK_AGENT_ADAPTER` description string matches `SDK_TOKENS.SDK_AGENT_ADAPTER` description string exactly. If they both use `Symbol.for('SdkAgentAdapter')`, they are the same symbol and no bridge is needed.

**Also check**: Are there duplicate registrations where the same `Symbol.for()` is registered twice (once in the library's register function and once via bridge)? If so, keep only the library's registration.

**Verification**:

- [ ] No `useFactory` bridge patterns remain for SDK tokens
- [ ] Extension activates without DI errors
- [ ] All SDK services resolve correctly

---

## Batch 2: Codebase-Wide Audit & Cleanup -- COMPLETE

**Developer**: backend-developer
**Status**: COMPLETE
**Tasks**: 3/3 complete | **Dependencies**: Batch 1
**Commit**: b301184

### Task 2.1: Audit All @inject() Decorators - COMPLETE

**Scope**: Entire codebase (`apps/` and `libs/`)
**Dependencies**: Batch 1

Run a comprehensive audit:

```bash
# Find all @inject patterns
grep -rn "@inject(" apps/ libs/ --include="*.ts"

# Verify each one:
# 1. Uses TOKENS.*, SDK_TOKENS.*, or AGENT_GENERATION_TOKENS.* (not strings)
# 2. The token is registered in the corresponding register.ts
# 3. The registration and injection use the same token constant
```

**Exceptions** (acceptable patterns):

- `context.service.ts` using local `Symbol.for('Logger')` to avoid circular dependency — document but don't change
- `SessionMetadataStore` having dead `@inject` decorators (class is registered via `registerInstance()`) — document in code comment

**Verification**:

- [ ] Every `@inject()` uses a token constant, not a string or local variable
- [ ] Every injected token has a matching registration
- [ ] Exceptions are documented with comments explaining why

---

### Task 2.2: Fix Stale Test References - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\container.spec.ts`
**Dependencies**: None (can run in parallel with 2.1)

Fix references to deleted tokens:

- `TOKENS.EVENT_BUS` — removed, update or delete affected tests
- Any other stale token references discovered during audit

**Verification**:

- [ ] `nx test vscode-core` passes
- [ ] No references to deleted tokens

---

### Task 2.3: Add DI Token Convention Documentation - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\di\tokens.ts`
**Dependencies**: None (can run in parallel)

Add a header comment documenting the token convention:

```typescript
/**
 * DI Token Registry - Single Source of Truth
 *
 * CONVENTION: All DI tokens MUST use Symbol.for('DescriptiveName')
 *
 * Why Symbol.for():
 * - Symbol.for() creates globally shared symbols (same description = same symbol)
 * - String tokens ('Name') !== Symbol.for('Name') — causes silent DI failures
 * - Plain Symbol('Name') !== Symbol('Name') — creates unique symbols per call
 * - Symbol.for('Name') === Symbol.for('Name') — always matches, even across modules
 *
 * Rules:
 * 1. Always use Symbol.for() for token values
 * 2. Never use string literals as DI tokens
 * 3. Never use plain Symbol() (without .for)
 * 4. Always inject via token constants (TOKENS.X, SDK_TOKENS.X), never hardcoded strings
 * 5. Each Symbol.for() description must be globally unique across all token files
 *    (unless intentionally shared for cross-library resolution)
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts (this file) — core infrastructure tokens
 * - agent-sdk/src/lib/di/tokens.ts — SDK-specific tokens
 * - agent-generation/src/lib/di/tokens.ts — agent generation tokens
 */
```

**Verification**:

- [ ] Convention documented in all 3 token files
- [ ] Matches actual implementation after Task 1.1

---

## Integration Testing Checklist

- [ ] Extension activates without DI errors
- [ ] All RPC handlers resolve correctly (chat, auth, config, enhanced-prompts)
- [ ] SDK agent adapter creates sessions successfully
- [ ] Agent generation wizard runs end-to-end
- [ ] Enhanced prompts generation works
- [ ] `nx run-many --target=typecheck` passes for all projects
- [ ] `nx run-many --target=test` passes for all projects

---

## Git Commit Strategy

- **Batch 1**: `refactor(di): migrate SDK_TOKENS to Symbol.for and eliminate string tokens (TASK_2025_140)`
- **Batch 2**: `chore(di): audit token usage, fix stale tests, add convention docs (TASK_2025_140)`
