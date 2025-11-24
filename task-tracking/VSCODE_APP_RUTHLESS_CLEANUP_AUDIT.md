# Ruthless App Cleanup Audit - Legacy EventBus Purge

## Executive Summary

**Context**: Phase 0 (TASK_2025_021) deleted EventBus infrastructure (~14,000 lines) but left legacy app code containing EventBus references and orchestration logic.

**Audit Scope**: ALL directories in `apps/ptah-extension-vscode/src/`

**Current State**: 14 TypeScript files, **4,222 lines total**

**Target State**: ~5-8 files, **~650-800 lines total**

**Audit Findings**:

| Category                    | Files       | Lines            | Action                         |
| --------------------------- | ----------- | ---------------- | ------------------------------ |
| 🔴 DELETE (EventBus legacy) | 2           | ~725             | Remove EventBus dependencies   |
| 🔴 DELETE (Obsolete)        | 1           | 11               | Remove re-export shim          |
| 🟡 MOVE to vscode-core      | 4           | ~1,575           | Webview infrastructure         |
| 🟢 KEEP (Proper app code)   | 7           | ~1,911           | DI wiring, lifecycle, commands |
| **Total Cleanup**           | **7 files** | **~2,311 lines** | **~55% reduction**             |

---

## 1. Adapters Directory (`src/adapters/`)

### Files Found: 1 file, 79 lines

| File                              | Lines | Contains EventBus? | Category | Action             |
| --------------------------------- | ----- | ------------------ | -------- | ------------------ |
| configuration-provider.adapter.ts | 79    | NO                 | 🟢 KEEP  | Legitimate adapter |

### Detailed Analysis

**configuration-provider.adapter.ts** (79 lines)

- **EventBus References**: NO
- **What it does**: Bridges ConfigManager (vscode-core) to IConfigurationProvider interface (claude-domain)
- **Used by**: Registered in DI container (line 116-121), consumed by ContextOrchestrationService
- **Belongs in**: app (this is app's cross-library bridging responsibility)
- **Reason**: Adapter pattern is appropriate here - app layer bridges between libraries
- **Action Plan**:
  - ✅ **KEEP**: This is legitimate app code
  - Purpose: Enable claude-domain to access configuration without depending on vscode-core
  - Pattern: Adapter pattern for cross-library dependency injection
  - Location: Correct (adapters should be in app layer)

---

## 2. Config Directory (`src/config/`)

### Files Found: 1 file, 614 lines

| File                   | Lines | Contains EventBus? | Category | Action                |
| ---------------------- | ----- | ------------------ | -------- | --------------------- |
| ptah-config.service.ts | 614   | NO                 | 🟡 MOVE  | Config infrastructure |

### Detailed Analysis

**ptah-config.service.ts** (614 lines)

- **EventBus References**: NO
- **What it does**: Configuration management with type-safe interface, VS Code settings integration, change listeners
- **Used by**: Not directly used in app - ConfigManager (vscode-core) provides same functionality
- **Belongs in**: vscode-core (infrastructure concern)
- **Reason**: Duplicate of ConfigManager functionality - vscode-core already has Zod-based config
- **Action Plan**:
  - 🔴 **DELETE** (Not move): ConfigManager in vscode-core already provides this
  - Evidence: ConfigurationProviderAdapter uses ConfigManager, not PtahConfigService
  - Lines 116-121 in container.ts: ConfigurationProvider uses ConfigManager
  - No imports of PtahConfigService found in codebase
  - **Impact**: Remove 614 lines of duplicate code

---

## 3. Core Directory (`src/core/`)

### Files Found: 2 files, 459 lines

| File              | Lines | Contains EventBus?  | Category  | Action              |
| ----------------- | ----- | ------------------- | --------- | ------------------- |
| logger.ts         | 11    | NO                  | 🔴 DELETE | Re-export shim      |
| ptah-extension.ts | 448   | YES (comments only) | 🟢 KEEP   | Extension lifecycle |

### Detailed Analysis

**logger.ts** (11 lines)

- **EventBus References**: NO
- **What it does**: Re-exports Logger from vscode-core for backward compatibility
- **Used by**: Has TODO comment "Update all imports to use @ptah-extension/vscode-core directly"
- **Belongs in**: DELETE (shim no longer needed)
- **Reason**: Direct imports from vscode-core should be used
- **Action Plan**:
  - 🔴 **DELETE**: Remove re-export shim
  - Search for imports: `grep -r "from '../core/logger'" apps/ptah-extension-vscode/src`
  - Update any imports to use `@ptah-extension/vscode-core` directly
  - **Impact**: Remove 11 lines, simplify imports

**ptah-extension.ts** (448 lines)

- **EventBus References**: YES (in comments only - lines 204, 237, 336)
- **What it does**: Main extension class - DI wiring, lifecycle management, component registration
- **Used by**: main.ts (extension activation)
- **Belongs in**: app (this IS the app's core responsibility)
- **Reason**: Extension lifecycle coordination is app layer's job
- **Action Plan**:
  - 🟢 **KEEP**: Legitimate app code
  - **Clean up EventBus comments**: Update comments to reflect RPC architecture
  - Lines 204, 237, 336: Remove references to EventBus (deleted in Phase 0)
  - Update registerEvents() method (line 336-344): Remove placeholder comment
  - **Impact**: Keep file, clean up 3 comment lines

---

## 4. DI Directory (`src/di/`)

### Files Found: 1 file, 344 lines

| File         | Lines | Contains EventBus?   | Category | Action    |
| ------------ | ----- | -------------------- | -------- | --------- |
| container.ts | 344   | YES (comment line 9) | 🟢 KEEP  | DI wiring |

### Detailed Analysis

**container.ts** (344 lines)

- **EventBus References**: YES (comment only - line 9: "prevents EventBus overwrite bug")
- **What it does**: Centralized DI container setup - registers ALL services from all libraries
- **Used by**: main.ts (line 25)
- **Belongs in**: app (DI wiring is app's responsibility)
- **Reason**: App layer coordinates service registration order
- **Action Plan**:
  - 🟢 **KEEP**: This is app's core responsibility
  - **Clean up comment**: Update line 9 - EventBus was deleted in Phase 0
  - Change: "prevents EventBus overwrite bug" → "prevents service re-registration issues"
  - **Impact**: Keep file, clean up 1 comment line

---

## 5. Handlers Directory (`src/handlers/`)

### Files Found: 1 file, 145 lines

| File                | Lines | Contains EventBus? | Category | Action            |
| ------------------- | ----- | ------------------ | -------- | ----------------- |
| command-handlers.ts | 145   | NO                 | 🟢 KEEP  | Command delegates |

### Detailed Analysis

**command-handlers.ts** (145 lines)

- **EventBus References**: NO
- **What it does**: Implements all VS Code commands - thin delegates to services
- **Used by**: PtahExtension.registerCommands() (line 252-300 in ptah-extension.ts)
- **Belongs in**: app (command registration is app's responsibility)
- **Reason**: VS Code command handlers belong in app layer
- **Action Plan**:
  - 🟢 **KEEP**: Legitimate command handlers
  - **Opportunity**: Most commands show deprecation warnings (lines 33-125)
  - Consider removing deprecated commands after RPC migration completes
  - **Impact**: Keep as-is for now (deprecation cleanup is separate task)

---

## 6. Main Entry (`src/main.ts`)

### Files Found: 1 file, 291 lines

| File    | Lines | Contains EventBus? | Category | Action               |
| ------- | ----- | ------------------ | -------- | -------------------- |
| main.ts | 291   | NO                 | 🟢 KEEP  | Extension activation |

### Detailed Analysis

**main.ts** (291 lines)

- **EventBus References**: NO
- **What it does**: Extension activation/deactivation - RPC registration, DI setup, lifecycle
- **Used by**: VS Code extension host (entry point)
- **Belongs in**: app (extension activation is app's responsibility)
- **Reason**: Entry point for VS Code extension
- **Action Plan**:
  - 🟢 **KEEP**: Extension entry point
  - Well-structured RPC registration (lines 46-178)
  - Proper activation sequence (lines 20-266)
  - **Impact**: Keep as-is

---

## 7. Providers Directory (`src/providers/`)

### Files Found: 1 file, 463 lines

| File                        | Lines | Contains EventBus? | Category  | Action             |
| --------------------------- | ----- | ------------------ | --------- | ------------------ |
| angular-webview.provider.ts | 463   | YES (legacy)       | 🔴 DELETE | EventBus-dependent |

### Detailed Analysis

**angular-webview.provider.ts** (463 lines)

- **EventBus References**: YES (lines 6, 28, 35, 208-259)
- **What it does**: Webview lifecycle + EventBus message publishing
- **Used by**: Registered in DI (line 299), used by PtahExtension
- **Belongs in**: vscode-core (webview infrastructure)
- **Reason**: Phase 0 deleted EventBus - this file's EventBus code is dead
- **Action Plan**:
  - 🔴 **DELETE EventBus code**: Remove lines 6, 253-259 (eventBus.publish)
  - 🟡 **MOVE to vscode-core**: After EventBus removal, move webview logic
  - **EventBus Usage**:
    - Line 6: `import { EventBus } from '@ptah-extension/vscode-core'`
    - Line 253-259: `this.eventBus.publish(message.type, message.payload, 'webview')`
  - **Problem**: EventBus was deleted in Phase 0 - this code cannot work
  - **Solution Path**:
    1. Remove EventBus dependency (import + publish calls)
    2. Convert to RPC-based messaging (WebviewManager.postMessage)
    3. Move to vscode-core library (webview infrastructure belongs there)
  - **Impact**: Refactor + move 463 lines

---

## 8. Services Directory (`src/services/`)

### Files Found: 6 files, 1,587 lines

| File                              | Lines | Contains EventBus? | Category  | Action                 |
| --------------------------------- | ----- | ------------------ | --------- | ---------------------- |
| command-builder.service.ts        | 402   | NO                 | 🟢 KEEP   | Command templates      |
| context-message-bridge.service.ts | 164   | YES (legacy)       | 🔴 DELETE | EventBus bridge        |
| webview-diagnostic.ts             | 245   | NO                 | 🟢 KEEP   | Diagnostic tool        |
| webview-event-queue.ts            | 226   | NO                 | 🟡 MOVE   | Webview infrastructure |
| webview-html-generator.ts         | 522   | NO                 | 🟡 MOVE   | Webview infrastructure |
| webview-initial-data-builder.ts   | 281   | NO                 | 🟡 MOVE   | Webview infrastructure |

### Detailed Analysis

**command-builder.service.ts** (402 lines)

- **EventBus References**: NO
- **What it does**: Command template management (code review, tests, explain, optimize, etc.)
- **Used by**: Registered in DI (line 295), used by CommandHandlers
- **Belongs in**: app (command templates are app-specific)
- **Reason**: Business logic for command templates
- **Action Plan**:
  - 🟢 **KEEP**: Legitimate app service
  - Provides 6 built-in templates (review, tests, explain, optimize, find-bugs, documentation)
  - **Impact**: Keep as-is

**context-message-bridge.service.ts** (164 lines)

- **EventBus References**: YES (lines 4, 14, 22, 38, 59, 110)
- **What it does**: Subscribes to EventBus messages, converts filePath → vscode.Uri, delegates to ContextOrchestrationService
- **Used by**: Initialized in main.ts (lines 34-44)
- **Belongs in**: DELETE (EventBus was purged)
- **Reason**: Entire purpose is EventBus message bridging - obsolete after Phase 0
- **Action Plan**:
  - 🔴 **DELETE**: EventBus no longer exists
  - **EventBus Usage**:
    - Line 38: `@inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus`
    - Line 59: `this.eventBus.subscribe(CONTEXT_MESSAGE_TYPES.INCLUDE_FILE).subscribe`
    - Line 110: `this.eventBus.subscribe(CONTEXT_MESSAGE_TYPES.EXCLUDE_FILE).subscribe`
  - **Problem**: EventBus was deleted in Phase 0 - cannot function
  - **Replacement**: RPC methods for context operations (already in main.ts)
  - **Impact**: Delete 164 lines, remove main.ts lines 34-44

**webview-diagnostic.ts** (245 lines)

- **EventBus References**: NO
- **What it does**: Diagnostic tool for debugging webview issues
- **Used by**: CommandHandlers.runDiagnostic() (line 131-143)
- **Belongs in**: app (debugging tool)
- **Reason**: Development/debugging utility
- **Action Plan**:
  - 🟢 **KEEP**: Useful debugging tool
  - Static utility class for webview diagnostics
  - **Impact**: Keep as-is

**webview-event-queue.ts** (226 lines)

- **EventBus References**: NO
- **What it does**: Queue events before webview ready (prevents dropped messages)
- **Used by**: AngularWebviewProvider (injected via DI, line 59)
- **Belongs in**: vscode-core (webview infrastructure)
- **Reason**: Generic webview infrastructure - not app-specific
- **Action Plan**:
  - 🟡 **MOVE to vscode-core**: Reusable webview infrastructure
  - Well-designed service (SOLID compliant)
  - Should be in vscode-core's webview utilities
  - **Impact**: Move 226 lines to vscode-core

**webview-html-generator.ts** (522 lines)

- **EventBus References**: NO
- **What it does**: Generate HTML for Angular webviews - CSP, asset URIs, theme integration
- **Used by**: AngularWebviewProvider (created in constructor, line 65)
- **Belongs in**: vscode-core (webview infrastructure)
- **Reason**: Generic HTML generation for webviews
- **Action Plan**:
  - 🟡 **MOVE to vscode-core**: Reusable webview infrastructure
  - Implements Angular + VS Code integration patterns
  - Should be in vscode-core's webview utilities
  - **Impact**: Move 522 lines to vscode-core

**webview-initial-data-builder.ts** (281 lines)

- **EventBus References**: NO
- **What it does**: Build type-safe initialData payload for webview
- **Used by**: AngularWebviewProvider (injected via DI, line 61)
- **Belongs in**: vscode-core (webview infrastructure)
- **Reason**: Generic initial data building for webviews
- **Action Plan**:
  - 🟡 **MOVE to vscode-core**: Reusable webview infrastructure
  - Type-safe initial data construction
  - Should be in vscode-core's webview utilities
  - **Impact**: Move 281 lines to vscode-core

---

## Migration Plan Summary

### Phase A: DELETE EventBus Legacy (PRIORITY 1)

**Files with EventBus code** (Total: 2 files, ~725 lines):

| File                              | Lines | EventBus Usage                              | Action                                    |
| --------------------------------- | ----- | ------------------------------------------- | ----------------------------------------- |
| angular-webview.provider.ts       | 463   | Import + publish() calls (lines 6, 253-259) | REFACTOR: Remove EventBus, convert to RPC |
| context-message-bridge.service.ts | 164   | Entire purpose is EventBus bridging         | DELETE (obsolete)                         |

**Cleanup Steps**:

1. **Delete context-message-bridge.service.ts** (164 lines)

   - Remove file: `src/services/context-message-bridge.service.ts`
   - Remove DI registration: `container.ts` line 304
   - Remove initialization: `main.ts` lines 34-44 (10 lines)
   - **Impact**: -174 lines total

2. **Refactor angular-webview.provider.ts** (463 lines)
   - Remove EventBus import (line 6)
   - Remove eventBus constructor parameter
   - Remove eventBus.publish() calls (lines 253-259)
   - Convert to RPC-based messaging via WebviewManager
   - **Impact**: -7 lines (EventBus code), refactor message routing

**Total Phase A Impact**: -181 lines of dead EventBus code

---

### Phase B: DELETE Obsolete Code (PRIORITY 2)

**Files that are unused/duplicate** (Total: 2 files, 625 lines):

| File                   | Lines | Reason                     | Action |
| ---------------------- | ----- | -------------------------- | ------ |
| logger.ts              | 11    | Re-export shim             | DELETE |
| ptah-config.service.ts | 614   | Duplicate of ConfigManager | DELETE |

**Cleanup Steps**:

1. **Delete logger.ts** (11 lines)

   - Search for imports: `grep -r "from '../core/logger'"` (likely none)
   - Delete file: `src/core/logger.ts`
   - **Impact**: -11 lines

2. **Delete ptah-config.service.ts** (614 lines)
   - Verify no imports: `grep -r "PtahConfigService"` (none found)
   - Delete file: `src/config/ptah-config.service.ts`
   - Delete directory if empty: `src/config/`
   - **Impact**: -614 lines

**Total Phase B Impact**: -625 lines of duplicate/obsolete code

---

### Phase C: MOVE to vscode-core (PRIORITY 3)

**VS Code infrastructure services** (Total: 4 files, ~1,492 lines):

| File                            | Lines | Target               | Reason                                     |
| ------------------------------- | ----- | -------------------- | ------------------------------------------ |
| webview-event-queue.ts          | 226   | vscode-core/webview/ | Generic webview queueing                   |
| webview-html-generator.ts       | 522   | vscode-core/webview/ | Generic HTML generation                    |
| webview-initial-data-builder.ts | 281   | vscode-core/webview/ | Generic data building                      |
| angular-webview.provider.ts     | 463   | vscode-core/webview/ | Webview lifecycle (after EventBus removal) |

**Migration Steps**:

1. **Create vscode-core webview utilities directory**

   ```bash
   mkdir -p libs/backend/vscode-core/src/lib/webview
   ```

2. **Move files sequentially**:

   - Move `webview-event-queue.ts` → `vscode-core/src/lib/webview/webview-event-queue.ts`
   - Move `webview-html-generator.ts` → `vscode-core/src/lib/webview/webview-html-generator.ts`
   - Move `webview-initial-data-builder.ts` → `vscode-core/src/lib/webview/webview-initial-data-builder.ts`
   - Move `angular-webview.provider.ts` → `vscode-core/src/lib/webview/angular-webview.provider.ts`

3. **Update imports in container.ts**:

   ```typescript
   // FROM:
   import { WebviewEventQueue } from '../services/webview-event-queue';

   // TO:
   import { WebviewEventQueue } from '@ptah-extension/vscode-core';
   ```

4. **Update vscode-core exports**:
   - Add exports to `vscode-core/src/index.ts`
   - Update TOKENS if needed

**Total Phase C Impact**: Move 1,492 lines to vscode-core (app stays ~650 lines)

---

### Phase D: KEEP in App (Expected: ~5 files, ~1,911 lines)

**Legitimate app code** (Total: 7 files before cleanup, 5 files after):

| File                                       | Lines | Reason to Keep                    |
| ------------------------------------------ | ----- | --------------------------------- |
| di/container.ts                            | 344   | DI wiring (app's responsibility)  |
| core/ptah-extension.ts                     | 448   | Extension lifecycle coordination  |
| main.ts                                    | 291   | Extension activation/deactivation |
| handlers/command-handlers.ts               | 145   | VS Code command delegates         |
| adapters/configuration-provider.adapter.ts | 79    | Cross-library bridging            |
| services/command-builder.service.ts        | 402   | Command template management       |
| services/webview-diagnostic.ts             | 245   | Debugging tool                    |

**Cleanup Tasks**:

1. **Update comments** (remove EventBus references):

   - `di/container.ts` line 9: Update "EventBus overwrite bug" → "service re-registration"
   - `core/ptah-extension.ts` lines 204, 237, 336: Remove EventBus mentions

2. **Consider deprecation cleanup** (future task):
   - `handlers/command-handlers.ts` lines 33-125: Remove deprecated commands after RPC migration

**Total Phase D**: Keep 1,954 lines (after comment cleanup: ~1,950 lines)

---

### Expected Final Structure

```
apps/ptah-extension-vscode/src/
├── di/
│   └── container.ts              # DI wiring ONLY (~344 lines)
├── handlers/
│   └── command-handlers.ts       # Thin delegates ONLY (~145 lines)
├── adapters/
│   └── configuration-provider.adapter.ts # Cross-library bridge (~79 lines)
├── services/
│   ├── command-builder.service.ts # Command templates (~402 lines)
│   └── webview-diagnostic.ts      # Debug tool (~245 lines)
├── core/
│   └── ptah-extension.ts         # Extension lifecycle (~448 lines)
└── main.ts                        # Extension activation (~291 lines)
```

**Total Expected Lines**: ~1,954 lines (down from 4,222 lines)

---

## Lines of Code Impact

### Before Cleanup

- Total app files: 14
- Total app lines: **4,222**
- Business logic in app: ~10% (command templates)
- Infrastructure in app: ~35% (webview utilities)
- Dead code: ~20% (EventBus references, duplicates)
- Legitimate app code: ~45% (DI, lifecycle, commands)

### After Cleanup

- Total app files: 7
- Total app lines: **~1,954**
- Business logic in app: ~20% (command templates)
- Infrastructure in app: 0% (moved to vscode-core)
- Dead code: 0% (deleted)
- Legitimate app code: ~80% (DI, lifecycle, commands)

### Reduction

- **Files deleted**: 2 (logger.ts, context-message-bridge.service.ts, ptah-config.service.ts = 3 total)
- **Files moved**: 4 (webview utilities → vscode-core)
- **Lines deleted**: ~806 lines (EventBus code + duplicates + obsolete)
- **Lines moved**: ~1,492 lines (to vscode-core)
- **Net reduction in app**: **2,268 lines (53.7%)**

---

## Risk Assessment

**Per File Risk Scoring**:

| File                              | Risk      | Reason                                 | Mitigation                  |
| --------------------------------- | --------- | -------------------------------------- | --------------------------- |
| context-message-bridge.service.ts | 🟢 LOW    | Initialized but EventBus doesn't exist | Safe to delete              |
| ptah-config.service.ts            | 🟢 LOW    | No imports found                       | Safe to delete              |
| logger.ts                         | 🟢 LOW    | Re-export shim                         | Update imports first        |
| angular-webview.provider.ts       | 🟡 MEDIUM | Used by DI, needs refactor             | Test after EventBus removal |
| webview-event-queue.ts            | 🟡 MEDIUM | Used by provider                       | Test after move             |
| webview-html-generator.ts         | 🟡 MEDIUM | Used by provider                       | Test after move             |
| webview-initial-data-builder.ts   | 🟡 MEDIUM | Used by provider                       | Test after move             |

---

## Validation Checklist

Before deleting/moving any file:

- [ ] **Search for imports**: `grep -r "from.*[filename]" apps/ptah-extension-vscode/src`
- [ ] **Check DI registrations**: Search `container.ts` for service name
- [ ] **Check command references**: Search `command-handlers.ts` for usage
- [ ] **Check provider references**: Search `ptah-extension.ts` for usage
- [ ] **Run build after each change**: `npm run build` (or `npx nx build ptah-extension-vscode`)
- [ ] **Test extension**: Press F5 in VS Code to launch Extension Development Host
- [ ] **Verify webview loads**: Check chat sidebar appears
- [ ] **Verify RPC works**: Test session operations in webview

---

## Detailed Execution Plan (Per Phase)

### Phase A Execution: DELETE EventBus Legacy

#### Step A.1: Delete context-message-bridge.service.ts

```bash
# 1. Verify no usage
grep -r "ContextMessageBridgeService" apps/ptah-extension-vscode/src
# Expected: Only in container.ts and main.ts

# 2. Remove from main.ts
# Edit main.ts lines 34-44 (remove initialization block)

# 3. Remove from container.ts
# Edit container.ts line 304 (remove DI registration)

# 4. Delete file
rm apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts

# 5. Verify build
npx nx build ptah-extension-vscode
```

**Git Commit**:

```bash
git add apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts
git add apps/ptah-extension-vscode/src/di/container.ts
git add apps/ptah-extension-vscode/src/main.ts
git commit -m "chore(vscode): delete obsolete context-message-bridge service

- Remove EventBus-dependent bridge service (EventBus deleted in Phase 0)
- Remove DI registration and initialization
- Impact: -174 lines of dead code

Related: TASK_2025_021 Phase 0"
```

#### Step A.2: Refactor angular-webview.provider.ts (Remove EventBus)

```typescript
// BEFORE (lines 5-8):
import {
  TOKENS,
  type Logger,
  EventBus,        // DELETE
  WebviewManager,
} from '@ptah-extension/vscode-core';

// AFTER:
import {
  TOKENS,
  type Logger,
  WebviewManager,
} from '@ptah-extension/vscode-core';

// BEFORE (constructor):
constructor(
  // ...
  @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,  // DELETE
  // ...
) {}

// AFTER (constructor):
constructor(
  // ...
  // eventBus removed
  // ...
) {}

// BEFORE (handleWebviewMessage, lines 250-259):
if (!isSystemMessage) {
  this.logger.info(`Publishing message to EventBus: ${message.type}`);

  // DELETE THIS BLOCK
  this.eventBus.publish(
    message.type as keyof MessagePayloadMap,
    message.payload,
    'webview'
  );

  this.logger.info(`Message ${message.type} published to EventBus`);
}

// AFTER:
// Remove entire block - RPC handles messaging now
// Update handleWebviewMessage to log and ignore non-system messages
```

**Git Commit**:

```bash
git add apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts
git commit -m "refactor(vscode): remove eventbus dependencies from webview provider

- Remove EventBus import and injection
- Remove eventBus.publish() calls
- Update comments to reflect RPC architecture
- EventBus was deleted in Phase 0, code was non-functional

Related: TASK_2025_021 Phase 0"
```

---

### Phase B Execution: DELETE Obsolete Code

#### Step B.1: Delete logger.ts

```bash
# 1. Search for imports
grep -r "from '../core/logger'" apps/ptah-extension-vscode/src
grep -r "from './logger'" apps/ptah-extension-vscode/src
# Expected: None (all code uses vscode-core directly)

# 2. Delete file
rm apps/ptah-extension-vscode/src/core/logger.ts

# 3. Verify build
npx nx build ptah-extension-vscode
```

**Git Commit**:

```bash
git add apps/ptah-extension-vscode/src/core/logger.ts
git commit -m "chore(vscode): remove logger re-export shim

- Delete logger.ts re-export (backward compatibility shim)
- All code already imports from @ptah-extension/vscode-core
- Impact: -11 lines"
```

#### Step B.2: Delete ptah-config.service.ts

```bash
# 1. Verify no usage
grep -r "PtahConfigService" apps/ptah-extension-vscode/src
# Expected: Only in ptah-config.service.ts itself

# 2. Delete file
rm apps/ptah-extension-vscode/src/config/ptah-config.service.ts

# 3. Delete empty directory
rmdir apps/ptah-extension-vscode/src/config

# 4. Verify build
npx nx build ptah-extension-vscode
```

**Git Commit**:

```bash
git add apps/ptah-extension-vscode/src/config/
git commit -m "chore(vscode): remove duplicate ptah-config service

- Delete PtahConfigService (duplicate of ConfigManager)
- ConfigManager from vscode-core provides same functionality
- ConfigurationProviderAdapter uses ConfigManager, not PtahConfigService
- Impact: -614 lines of duplicate code"
```

---

### Phase C Execution: MOVE to vscode-core

**NOTE**: This phase requires careful coordination with vscode-core library. Each file should be moved, tested, and committed individually.

#### Step C.1: Move webview-event-queue.ts

```bash
# 1. Create target directory
mkdir -p libs/backend/vscode-core/src/lib/webview

# 2. Move file
mv apps/ptah-extension-vscode/src/services/webview-event-queue.ts \
   libs/backend/vscode-core/src/lib/webview/webview-event-queue.ts

# 3. Update vscode-core exports
# Edit libs/backend/vscode-core/src/index.ts
# Add: export { WebviewEventQueue } from './lib/webview/webview-event-queue';

# 4. Update imports in app
# Edit apps/ptah-extension-vscode/src/di/container.ts
# Change: import { WebviewEventQueue } from '../services/webview-event-queue';
# To: import { WebviewEventQueue } from '@ptah-extension/vscode-core';

# 5. Verify build
npx nx build vscode-core
npx nx build ptah-extension-vscode
```

**Git Commit**:

```bash
git add libs/backend/vscode-core/src/lib/webview/webview-event-queue.ts
git add libs/backend/vscode-core/src/index.ts
git add apps/ptah-extension-vscode/src/di/container.ts
git commit -m "refactor(vscode): move webview-event-queue to vscode-core

- Move webview-event-queue.ts from app to vscode-core library
- Generic webview infrastructure belongs in vscode-core
- Update imports and exports
- Impact: -226 lines from app"
```

#### Step C.2: Move webview-html-generator.ts

```bash
# 1. Move file
mv apps/ptah-extension-vscode/src/services/webview-html-generator.ts \
   libs/backend/vscode-core/src/lib/webview/webview-html-generator.ts

# 2. Update vscode-core exports
# Edit libs/backend/vscode-core/src/index.ts
# Add: export { WebviewHtmlGenerator } from './lib/webview/webview-html-generator';

# 3. Update imports in app (angular-webview.provider.ts)
# Change: import { WebviewHtmlGenerator } from '../services/webview-html-generator';
# To: import { WebviewHtmlGenerator } from '@ptah-extension/vscode-core';

# 4. Verify build
npx nx build vscode-core
npx nx build ptah-extension-vscode
```

**Git Commit**:

```bash
git add libs/backend/vscode-core/src/lib/webview/webview-html-generator.ts
git add libs/backend/vscode-core/src/index.ts
git add apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts
git commit -m "refactor(vscode): move webview-html-generator to vscode-core

- Move webview-html-generator.ts from app to vscode-core library
- Generic HTML generation for webviews belongs in vscode-core
- Update imports and exports
- Impact: -522 lines from app"
```

#### Step C.3: Move webview-initial-data-builder.ts

```bash
# Similar pattern as C.1 and C.2
# Move → Update exports → Update imports → Build → Commit
```

#### Step C.4: Move angular-webview.provider.ts

```bash
# Similar pattern as C.1-C.3
# Move → Update exports → Update imports → Build → Commit
```

---

### Phase D Execution: Final Cleanup (Comments)

#### Step D.1: Clean up EventBus comments

```bash
# Edit di/container.ts line 9
# Edit core/ptah-extension.ts lines 204, 237, 336
# Remove all "EventBus" mentions in comments
```

**Git Commit**:

```bash
git add apps/ptah-extension-vscode/src/di/container.ts
git add apps/ptah-extension-vscode/src/core/ptah-extension.ts
git commit -m "docs(vscode): remove obsolete eventbus comments

- Update comments to remove EventBus references (deleted in Phase 0)
- Clarify RPC-based architecture in comments
- No functional changes"
```

---

## Success Criteria

After all phases complete:

1. **Build passes**: `npx nx build ptah-extension-vscode` succeeds
2. **Extension loads**: F5 launches Extension Development Host without errors
3. **Webview renders**: Chat sidebar displays Angular app
4. **RPC works**: Session operations function (list, create, switch)
5. **Line count reduced**: From 4,222 → ~1,954 lines (53.7% reduction)
6. **File count reduced**: From 14 → 7 files (50% reduction)
7. **No EventBus references**: `grep -r "EventBus\|eventBus" apps/ptah-extension-vscode/src` returns only comments
8. **Architecture correct**: App contains only DI wiring, lifecycle, and command delegates

---

## Conclusion

The app currently contains **4,222 lines** of code with significant legacy EventBus infrastructure and misplaced webview utilities.

After ruthless cleanup:

- **~806 lines deleted** (EventBus legacy + duplicates + obsolete)
- **~1,492 lines moved** to vscode-core (webview infrastructure)
- **~1,954 lines remaining** (pure orchestration shell)

**The app will become what it should be**: A thin wiring layer with zero business logic, zero infrastructure code, and zero dead EventBus references.

**Estimated Effort**: 4-6 hours (1-2 hours per phase)

**Risk Level**: 🟡 MEDIUM (requires careful testing after each phase)

**Recommendation**: Execute phases sequentially with git commits after each step. Test thoroughly between phases.
