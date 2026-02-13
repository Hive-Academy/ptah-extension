# Development Tasks - TASK_2025_153: Plugin Configuration Feature

**Total Tasks**: 18 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- SDK `Options.plugins?: SdkPluginConfig[]` exists in `claude-sdk.types.ts` line 1589: VERIFIED
- `SdkPluginConfig = { type: 'local', path: string }` exists in `claude-sdk.types.ts` line 115-120: VERIFIED
- `SdkQueryOptions` interface (line 164-192 of `sdk-query-options-builder.ts`) needs `plugins` field added: VERIFIED
- `ExecuteQueryConfig` interface (line 80-113 of `session-lifecycle-manager.ts`) needs `pluginPaths` field added: VERIFIED
- `QueryOptionsInput` interface (line 120-158 of `sdk-query-options-builder.ts`) needs `pluginPaths` field added: VERIFIED
- `SdkAgentAdapter.startChatSession()` and `resumeSession()` accept config extension: VERIFIED
- `.vscodeignore` does NOT exclude `assets/plugins/`: VERIFIED
- `ptah-claude-plugins/plugins/` has all 4 directories: VERIFIED
- `neon-postgres copy` directory exists and needs rename: VERIFIED
- RPC type-safe pattern: `RpcMethodRegistry` + `RPC_METHOD_NAMES` array must both be updated: VERIFIED
- RPC handlers register pattern: `container.ts` + `rpc-method-registration.service.ts` + `handlers/index.ts`: VERIFIED
- DI token pattern: `SDK_TOKENS` + `register.ts` + `helpers/index.ts` + `src/index.ts`: VERIFIED
- `ChatRpcHandlers` already injects `LicenseService` for premium gating: VERIFIED
- Frontend `ChatEmptyStateComponent` uses `VSCodeService` for RPC: VERIFIED

### Identified Risks

| Risk                                                                                                                                                                                         | Severity | Mitigation                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `SdkQueryOptions` is cast to `Options` at line 518 of `session-lifecycle-manager.ts`. Adding `plugins` to `SdkQueryOptions` must match `Options.plugins` type exactly (`SdkPluginConfig[]`). | MED      | Task 3.1 must use `SdkPluginConfig` type from `claude-sdk.types.ts`, not a custom type.        |
| Plugin paths are resolved at session start only. If user changes config mid-session, the change only applies to NEW sessions.                                                                | LOW      | Document in UI that changes apply to new sessions. This matches existing `isPremium` behavior. |
| The `neon-postgres copy` folder has a space in its name. Copy scripts must handle this.                                                                                                      | LOW      | Task 1.1 uses explicit rename during copy.                                                     |

### Edge Cases to Handle

- [x] User has no workspace open (workspaceState unavailable) -> Return empty config, default to no plugins
- [x] Plugin directory missing at runtime (extension packaged without assets) -> graceful fallback, empty array
- [x] Non-premium user tries to configure plugins -> UI hidden, backend returns empty paths regardless

---

## Batch 1: Build Pipeline + Shared Types (Phase 1 + 2) IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Copy plugin directories into extension assets IMPLEMENTED

**Action**: Manual file copy (not code generation)
**Source**: `D:\projects\ptah-claude-plugins\plugins\*`
**Destination**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\`

**Implementation Details**:

- Copy all 4 plugin directories:
  - `hive-academy-core` (7 skills, 5 commands)
  - `hive-academy-nx-saas` (4 skills, 1 command)
  - `hive-academy-angular` (3 skills, 0 commands)
  - `hive-academy-react` (3 skills, 0 commands)
- CRITICAL: In `hive-academy-nx-saas/skills/`, rename `neon-postgres copy` to `neon-postgres` (remove the ` copy` suffix with the space)
- The directory structure under each plugin follows: `plugin.json`, `skills/`, `commands/` (some plugins have no commands/)
- Verify each plugin has a `plugin.json` file at its root

**Quality Requirements**:

- All 4 directories must exist at destination
- No spaces in directory names (fix `neon-postgres copy`)
- Preserve all file contents exactly

---

### Task 1.2: Update project.json post-build-copy for plugins IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json`
**Spec Reference**: implementation-plan.md Phase 1.2
**Pattern to Follow**: Existing post-build-copy commands (lines 48-68)

**Implementation Details**:

- Add a new command to the `post-build-copy` target's `commands` array
- The command copies `assets/plugins/` to `dist/apps/ptah-extension-vscode/assets/plugins/`
- Use PowerShell Copy-Item consistent with existing commands:
  ```json
  {
    "command": "powershell -Command \"Copy-Item -Path 'apps/ptah-extension-vscode/assets/plugins' -Destination 'dist/apps/ptah-extension-vscode/assets/plugins/' -Recurse -Force\"",
    "forwardAllArgs": false
  }
  ```
- Add to `outputs` array: `"{workspaceRoot}/dist/apps/ptah-extension-vscode/assets/plugins"`

**Quality Requirements**:

- Command is appended AFTER the existing 5 commands
- Output path added to outputs array
- `parallel: false` preserved

---

### Task 1.3: Add PluginInfo and PluginConfigState types to rpc.types.ts IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Pattern to Follow**: Existing RPC type definitions (e.g., `PluginInfo` similar to `SdkModelInfo` at line 370)

**Implementation Details**:

- Add a new section after the Quality Dashboard RPC Types section (after line 1049):

  ```typescript
  // ============================================================
  // Plugin Configuration RPC Types (TASK_2025_153)
  // ============================================================

  /** Plugin metadata for UI display */
  export interface PluginInfo {
    /** Unique plugin identifier (directory name, e.g., 'hive-academy-core') */
    id: string;
    /** Human-readable plugin name */
    name: string;
    /** Plugin description */
    description: string;
    /** Plugin category for grouping in UI */
    category: 'core-tools' | 'backend-tools' | 'frontend-tools';
    /** Number of skills in this plugin */
    skillCount: number;
    /** Number of commands in this plugin */
    commandCount: number;
    /** Whether this plugin is recommended as default */
    isDefault: boolean;
    /** Search keywords for filtering */
    keywords: string[];
  }

  /** Per-workspace plugin configuration state */
  export interface PluginConfigState {
    /** Array of enabled plugin IDs */
    enabledPluginIds: string[];
    /** ISO timestamp of last configuration change */
    lastUpdated?: string;
  }
  ```

- Add 3 RPC method entries to the `RpcMethodRegistry` interface (after line 1304):
  ```typescript
  // ---- Plugin Methods (TASK_2025_153) ----
  'plugins:list-available': {
    params: Record<string, never>;
    result: { plugins: PluginInfo[] };
  };
  'plugins:get-config': {
    params: Record<string, never>;
    result: PluginConfigState;
  };
  'plugins:save-config': {
    params: { enabledPluginIds: string[] };
    result: { success: boolean; error?: string };
  };
  ```
- Add the 3 method names to `RPC_METHOD_NAMES` array (after line 1410):
  ```typescript
  // Plugin Methods (TASK_2025_153)
  'plugins:list-available',
  'plugins:get-config',
  'plugins:save-config',
  ```

**Quality Requirements**:

- Types follow same JSDoc comment style as existing types
- RpcMethodRegistry entries use proper param/result structure
- RPC_METHOD_NAMES array must include all 3 new methods
- No TypeScript errors

---

### Task 1.4: Verify shared barrel exports include new types IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\shared\src\index.ts`

**Implementation Details**:

- The shared barrel at `libs/shared/src/index.ts` already re-exports everything from `rpc.types.ts` via `export * from './lib/types/rpc.types'` (line 13)
- Since `PluginInfo` and `PluginConfigState` are added to `rpc.types.ts`, they are automatically exported
- NO CHANGES NEEDED to `index.ts` - just verify the existing wildcard export covers it

**Quality Requirements**:

- Confirm `PluginInfo` and `PluginConfigState` are accessible via `@ptah-extension/shared`

---

**Batch 1 Verification**:

- All plugin directories exist at `apps/ptah-extension-vscode/assets/plugins/`
- `project.json` updated with plugins copy command
- `rpc.types.ts` has new types and registry entries
- Build passes: `npx nx build shared`
- code-logic-reviewer approved

---

## Batch 2: Backend Service + RPC Handlers (Phase 3 + 4) IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1

### Task 2.1: Create PluginLoaderService IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\plugin-loader.service.ts`
**Spec Reference**: implementation-plan.md Phase 3.1
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts` (simple service with hardcoded config + workspace state persistence)

**Implementation Details**:

- Imports: `injectable`, `inject` from `tsyringe`; `Logger`, `TOKENS` from `@ptah-extension/vscode-core`; `PluginInfo`, `PluginConfigState` from `@ptah-extension/shared`
- Class: `PluginLoaderService` with `@injectable()` decorator
- Constructor: inject `TOKENS.LOGGER` for Logger
- Private field: `extensionPath: string | null = null` (set via `initialize()`)
- Private field: `workspaceState: vscode.Memento | null = null` (set via `initialize()`)
- WorkspaceState key: `'ptah.plugins.config'`

**Methods**:

1. `initialize(extensionPath: string, workspaceState: vscode.Memento): void` - stores extensionPath and workspaceState
2. `getAvailablePlugins(): PluginInfo[]` - returns hardcoded metadata array for 4 plugins:
   - `hive-academy-core`: name="Hive Academy Core", description="Core development tools including orchestration, code review, testing, and documentation agents", category='core-tools', skillCount=7, commandCount=5, isDefault=true, keywords=['orchestrate', 'review', 'test', 'document', 'core']
   - `hive-academy-nx-saas`: name="Hive Academy Nx SaaS", description="Backend tools for Nx monorepo, NestJS, Prisma, and Neon PostgreSQL workflows", category='backend-tools', skillCount=4, commandCount=1, isDefault=false, keywords=['nx', 'nestjs', 'prisma', 'neon', 'backend', 'saas']
   - `hive-academy-angular`: name="Hive Academy Angular", description="Frontend tools for Angular development with GSAP animations and 3D scene creation", category='frontend-tools', skillCount=3, commandCount=0, isDefault=false, keywords=['angular', 'gsap', 'animation', '3d', 'frontend']
   - `hive-academy-react`: name="Hive Academy React", description="Frontend tools for React development with modern patterns", category='frontend-tools', skillCount=3, commandCount=0, isDefault=false, keywords=['react', 'frontend', 'hooks', 'components']
3. `getWorkspacePluginConfig(): PluginConfigState` - reads from workspaceState, returns `{ enabledPluginIds: [], lastUpdated: undefined }` if not set
4. `async saveWorkspacePluginConfig(config: PluginConfigState): Promise<void>` - writes config with `lastUpdated = new Date().toISOString()` to workspaceState
5. `resolvePluginPaths(enabledPluginIds: string[]): string[]` - maps plugin IDs to absolute paths: `path.join(extensionPath, 'assets', 'plugins', pluginId)`. Filters out IDs not in the known plugin list. Returns empty array if extensionPath is null.

**Quality Requirements**:

- All methods have JSDoc comments
- `resolvePluginPaths` validates plugin IDs against known set (no arbitrary path construction)
- Graceful fallback when `extensionPath` is null (returns empty arrays)
- Graceful fallback when `workspaceState` is null (returns default empty config)

---

### Task 2.2: Register PluginLoaderService in DI IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts`

**Pattern to Follow**: `SDK_COMPACTION_CONFIG_PROVIDER` registration pattern

**Implementation Details**:

**tokens.ts** - Add after `SDK_INTERNAL_QUERY_SERVICE` (line 83):

```typescript
// Plugin Loader Service (TASK_2025_153)
// Manages plugin metadata and per-workspace plugin configuration
SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader'),
```

**register.ts** - Add after `InternalQueryService` registration (after line 295), before the Main Adapter section:

```typescript
// ============================================================
// Plugin Loader Service (TASK_2025_153)
// Manages plugin discovery and per-workspace configuration
// ============================================================
container.register(SDK_TOKENS.SDK_PLUGIN_LOADER, { useClass: PluginLoaderService }, { lifecycle: Lifecycle.Singleton });
```

Also add import: `import { PluginLoaderService } from '../helpers/plugin-loader.service';`

**helpers/index.ts** - Add export at end:

```typescript
// Plugin loader (TASK_2025_153)
export { PluginLoaderService } from './plugin-loader.service';
```

**src/index.ts** - Add export after the Enhanced Prompts section (after line 149):

```typescript
// Plugin Loader Service (TASK_2025_153)
export { PluginLoaderService } from './lib/helpers';
```

And re-export the token:
(Already exported via `export { SDK_TOKENS } from './lib/di/tokens'` on line 55)

**Quality Requirements**:

- Token name follows `Symbol.for('SdkPluginLoader')` convention (globally unique)
- Registered as Singleton (consistent with other services)
- Exported through all barrel files
- Type `SdkDIToken` auto-updated since it derives from `keyof typeof SDK_TOKENS`

---

### Task 2.3: Initialize PluginLoaderService from main.ts IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Pattern to Follow**: How `registerAgentGenerationServices` passes `context.extensionPath` (in container.ts line 323)

**Implementation Details**:

- After the SDK adapter is initialized (after `sdkAdapter.initialize()` call), resolve `PluginLoaderService` from container and call `initialize()`:

```typescript
// TASK_2025_153: Initialize plugin loader with extension path
const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
pluginLoader.initialize(context.extensionPath, context.workspaceState);
```

- Import `PluginLoaderService` and `SDK_TOKENS` at top of file
- This must happen AFTER `DIContainer.setup(context)` and AFTER SDK adapter init

**Quality Requirements**:

- Plugin loader initialized before any RPC handlers can be called
- Extension path is from `context.extensionPath` (VS Code provides this)
- workspaceState is from `context.workspaceState` (VS Code Memento)

---

### Task 2.4: Create PluginRpcHandlers IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\plugin-rpc.handlers.ts`
**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts` (simple handler with DI injection)

**Implementation Details**:

- Class: `PluginRpcHandlers` with `@injectable()` decorator
- Constructor injects:
  - `TOKENS.LOGGER` -> Logger
  - `TOKENS.RPC_HANDLER` -> RpcHandler
  - `SDK_TOKENS.SDK_PLUGIN_LOADER` -> PluginLoaderService
- `register()` method registers 3 RPC methods:

1. `'plugins:list-available'` -> calls `pluginLoader.getAvailablePlugins()`, returns `{ plugins: PluginInfo[] }`
2. `'plugins:get-config'` -> calls `pluginLoader.getWorkspacePluginConfig()`, returns `PluginConfigState`
3. `'plugins:save-config'` -> takes `{ enabledPluginIds: string[] }`, calls `pluginLoader.saveWorkspacePluginConfig({ enabledPluginIds, lastUpdated: new Date().toISOString() })`, returns `{ success: true }`
   - Wrap in try/catch, return `{ success: false, error: message }` on failure

**Quality Requirements**:

- All 3 methods match the types in `RpcMethodRegistry`
- Proper error handling in save-config
- Debug logging for each RPC call

---

### Task 2.5: Register PluginRpcHandlers in container and RPC registration IMPLEMENTED

**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\index.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`

**Pattern to Follow**: `QualityRpcHandlers` registration pattern (simplest - uses `registerSingleton`)

**Implementation Details**:

**handlers/index.ts** - Add export:

```typescript
export { PluginRpcHandlers } from './plugin-rpc.handlers'; // TASK_2025_153
```

**container.ts**:

1. Add import of `PluginRpcHandlers` to the RPC handlers import block (line 56 area)
2. Add `container.registerSingleton(PluginRpcHandlers);` in Phase 1.6 (after `QualityRpcHandlers` at line 247)
3. Add `c.resolve(PluginRpcHandlers)` to `RpcMethodRegistrationService` factory (add as new constructor parameter after `WizardGenerationRpcHandlers` at line 289)

**rpc-method-registration.service.ts**:

1. Add import: `import { PluginRpcHandlers } from './handlers/plugin-rpc.handlers';`
2. Add constructor parameter: `private readonly pluginHandlers: PluginRpcHandlers`
3. In `registerAllMethods()` or equivalent, call `this.pluginHandlers.register()`

**Quality Requirements**:

- PluginRpcHandlers registered AFTER agent-sdk services (it depends on SDK_PLUGIN_LOADER)
- Constructor parameter order matches `container.ts` factory resolution order
- All 3 new RPC methods appear in `verifyRpcRegistration()` check

---

**Batch 2 Verification**:

- PluginLoaderService exists with all 5 methods
- DI token registered and service injectable
- Plugin loader initialized from main.ts
- 3 RPC methods registered and callable
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 3: SDK Query Wiring (Phase 5) IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2

### Task 3.1: Add pluginPaths to SdkQueryOptionsBuilder IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
**Pattern to Follow**: How `isPremium` is threaded through the builder (lines 144, 255-258, 310)

**Implementation Details**:

1. Add to `QueryOptionsInput` interface (after `enhancedPromptsContent` at line 157):

   ```typescript
   /**
    * Plugin paths to load for this session (TASK_2025_153)
    * Absolute paths to plugin directories resolved by PluginLoaderService.
    * Only populated for premium users with configured plugins.
    */
   pluginPaths?: string[];
   ```

2. Add `plugins` field to `SdkQueryOptions` interface (after `hooks` at line 186):

   ```typescript
   /** Plugins to load for this session (TASK_2025_153) */
   plugins?: import('../types/sdk-types/claude-sdk.types').SdkPluginConfig[];
   ```

3. In `build()` method, destructure `pluginPaths` from input (add to destructuring at line 258)

4. Add `buildPlugins()` private method:

   ```typescript
   /**
    * Build SDK plugin configuration from resolved paths
    * Converts absolute directory paths to SdkPluginConfig format
    *
    * @param pluginPaths - Absolute paths to plugin directories (from PluginLoaderService)
    * @returns Array of SdkPluginConfig for SDK, or undefined if no plugins
    */
   private buildPlugins(pluginPaths?: string[]): SdkPluginConfig[] | undefined {
     if (!pluginPaths || pluginPaths.length === 0) {
       return undefined;
     }
     return pluginPaths.map(p => ({ type: 'local' as const, path: p }));
   }
   ```

5. In the return object of `build()` (around line 313), add `plugins` to options:

   ```typescript
   plugins: this.buildPlugins(pluginPaths),
   ```

6. Add to logging (around line 310):
   ```typescript
   pluginCount: pluginPaths?.length ?? 0,
   ```

**Validation Notes**:

- CRITICAL: `SdkPluginConfig` must be imported from `../types/sdk-types/claude-sdk.types` to match the SDK's `Options.plugins` type exactly
- The `SdkQueryOptions` is cast to `Options` at line 518 of `session-lifecycle-manager.ts`, so the `plugins` field must type-match

**Quality Requirements**:

- Uses `SdkPluginConfig` type (not a custom type)
- `buildPlugins` returns `undefined` (not empty array) when no plugins - this avoids sending empty array to SDK
- Import statement for `SdkPluginConfig` is type-only

---

### Task 3.2: Thread pluginPaths through SessionLifecycleManager IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
**Pattern to Follow**: How `enhancedPromptsContent` is threaded (lines 107-113, 447-449, 505)

**Implementation Details**:

1. Add to `ExecuteQueryConfig` interface (after `enhancedPromptsContent` at line 113):

   ```typescript
   /**
    * Plugin paths to load for this session (TASK_2025_153)
    * Absolute paths to plugin directories resolved by PluginLoaderService.
    * Passed through to SdkQueryOptionsBuilder.
    */
   pluginPaths?: string[];
   ```

2. In `executeQuery()` method, destructure `pluginPaths` (add to destructuring around line 448)

3. Pass `pluginPaths` to `this.queryOptionsBuilder.build()` call (around line 505):
   ```typescript
   pluginPaths,
   ```

**Quality Requirements**:

- Field name is `pluginPaths` (consistent with QueryOptionsInput)
- Destructured alongside `enhancedPromptsContent` for consistency

---

### Task 3.3: Thread pluginPaths through SdkAgentAdapter IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
**Pattern to Follow**: How `enhancedPromptsContent` is threaded in `startChatSession` (line 349-351) and `resumeSession` (line 448-451)

**Implementation Details**:

1. Add `pluginPaths` to the `startChatSession` config type (after `enhancedPromptsContent` around line 355):

   ```typescript
   /**
    * Plugin directory paths for this session (TASK_2025_153)
    * Resolved by PluginLoaderService for premium users.
    */
   pluginPaths?: string[];
   ```

2. Destructure `pluginPaths` in `startChatSession` (around line 367):

   ```typescript
   const { tabId, isPremium = false, mcpServerRunning = true, enhancedPromptsContent, pluginPaths } = config;
   ```

3. Pass `pluginPaths` to `sessionLifecycle.executeQuery()` in `startChatSession` (around line 389):

   ```typescript
   pluginPaths,
   ```

4. Add `pluginPaths` to the `resumeSession` config type (after `enhancedPromptsContent` around line 453):

   ```typescript
   /**
    * Plugin directory paths for this session (TASK_2025_153)
    * Resolved by PluginLoaderService for premium users.
    */
   pluginPaths?: string[];
   ```

5. Extract `pluginPaths` in `resumeSession` (around line 479):

   ```typescript
   const pluginPaths = config?.pluginPaths;
   ```

6. Pass `pluginPaths` to `sessionLifecycle.executeQuery()` in `resumeSession` (around line 499):
   ```typescript
   pluginPaths,
   ```

**Quality Requirements**:

- Both `startChatSession` and `resumeSession` pass pluginPaths through
- Same optional pattern as `enhancedPromptsContent`

---

### Task 3.4: Wire plugin loading in ChatRpcHandlers IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Pattern to Follow**: How `enhancedPromptsContent` is resolved and passed (lines 110-133, 177-178, 215-216)

**Implementation Details**:

1. Add import for `PluginLoaderService` and `SDK_TOKENS`:

   ```typescript
   import { PluginLoaderService } from '@ptah-extension/agent-sdk';
   // SDK_TOKENS already imported
   ```

2. Add DI injection in constructor (after `enhancedPromptsService` around line 71):

   ```typescript
   @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
   private readonly pluginLoader: PluginLoaderService
   ```

3. Add private helper method:

   ```typescript
   /**
    * Resolve plugin paths for premium users (TASK_2025_153)
    *
    * Reads workspace plugin configuration and resolves to absolute paths.
    * Only returns paths for premium users. Non-premium users get no plugins.
    *
    * @param isPremium - Whether the user has premium features
    * @returns Resolved plugin directory paths, or undefined if none
    */
   private resolvePluginPaths(isPremium: boolean): string[] | undefined {
     if (!isPremium) {
       return undefined;
     }

     try {
       const config = this.pluginLoader.getWorkspacePluginConfig();
       if (!config.enabledPluginIds || config.enabledPluginIds.length === 0) {
         return undefined;
       }
       const paths = this.pluginLoader.resolvePluginPaths(config.enabledPluginIds);
       if (paths.length === 0) {
         return undefined;
       }
       this.logger.debug('Resolved plugin paths for session', {
         enabledCount: config.enabledPluginIds.length,
         resolvedCount: paths.length,
       });
       return paths;
     } catch (error) {
       this.logger.debug('Failed to resolve plugin paths', {
         error: error instanceof Error ? error.message : String(error),
       });
       return undefined;
     }
   }
   ```

4. In `registerChatStart()`, after resolving `enhancedPromptsContent` (around line 178), add:

   ```typescript
   // TASK_2025_153: Resolve plugin paths for premium users
   const pluginPaths = this.resolvePluginPaths(isPremium);
   ```

5. Pass `pluginPaths` to `sdkAdapter.startChatSession()` (around line 216):

   ```typescript
   pluginPaths, // TASK_2025_153: Plugin directory paths for SDK
   ```

6. In `registerChatContinue()`, inside the `!isSessionActive` block, after resolving `enhancedPromptsContent` (around line 274), add:

   ```typescript
   const pluginPaths = this.resolvePluginPaths(isPremium);
   ```

7. Pass `pluginPaths` to `sdkAdapter.resumeSession()` (around line 295):
   ```typescript
   pluginPaths,
   ```

**Quality Requirements**:

- Plugin paths only resolved for premium users (premium gate)
- Graceful fallback on any error (returns undefined)
- Same error handling pattern as `resolveEnhancedPromptsContent`
- Logging at debug level (not info - this runs every session start)

---

**Batch 3 Verification**:

- `pluginPaths` flows: ChatRpcHandlers -> SdkAgentAdapter -> SessionLifecycleManager -> SdkQueryOptionsBuilder -> SDK Options
- Premium gating enforced at ChatRpcHandlers level
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 4: Frontend Components (Phase 6) IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2 (RPC handlers must exist)

### Task 4.1: Create PluginStatusWidgetComponent IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\plugin-status-widget.component.ts`
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-status-widget.component.ts`

**Implementation Details**:

- Angular standalone component with `ChangeDetectionStrategy.OnPush`
- Selector: `ptah-plugin-status-widget`
- Imports: `LucideAngularModule`, `Puzzle` icon from lucide-angular
- Inject `ClaudeRpcService` from `@ptah-extension/core` for RPC calls
- Signal-based state:
  - `pluginCount = signal(0)` - number of enabled plugins
  - `totalAvailable = signal(0)` - total available plugins
  - `isLoading = signal(true)`
- Output: `configureClicked = output<void>()`
- On init, call `rpcService.callExtension('plugins:get-config')` and `rpcService.callExtension('plugins:list-available')` to populate counts
- Template: Compact card (DaisyUI `bg-base-200/50 border border-base-300`) showing:
  - Puzzle icon + "Plugins" label
  - Badge: `pluginCount()/totalAvailable()` or "Not configured" if 0
  - "Configure" button (btn-xs btn-ghost btn-secondary) that emits `configureClicked`
- Minimal styles, use DaisyUI + Tailwind only

**Quality Requirements**:

- Fully signal-based (no BehaviorSubject)
- OnPush change detection
- Graceful loading state
- Error handling on RPC calls (silent fail, show default)

---

### Task 4.2: Create PluginBrowserModalComponent IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\plugin-browser-modal.component.ts`
**Pattern to Follow**: DaisyUI modal pattern (`dialog` element with `.modal` class), similar to confirmation-dialog.component.ts

**Implementation Details**:

- Angular standalone component with `ChangeDetectionStrategy.OnPush`
- Selector: `ptah-plugin-browser-modal`
- Imports: `LucideAngularModule`, icons: `Puzzle`, `Check`, `X`, `Search`
- Inject `ClaudeRpcService` from `@ptah-extension/core`
- Input: `isOpen = input(false)` - controls modal visibility
- Outputs: `closed = output<void>()`, `saved = output<string[]>()` (emits enabled IDs)
- Signals:
  - `availablePlugins = signal<PluginInfo[]>([])` - loaded from RPC
  - `selectedIds = signal<Set<string>>(new Set())` - checkbox state
  - `searchQuery = signal('')` - filter text
  - `isLoading = signal(true)`
  - `isSaving = signal(false)`
- Computed:
  - `filteredPlugins` - filters `availablePlugins` by `searchQuery` (match name, description, keywords)
  - `groupedPlugins` - groups filtered by category for display sections
- On open (effect watching `isOpen`): load plugins via `plugins:list-available` and current config via `plugins:get-config`, pre-select enabled ones
- Template:
  - DaisyUI `dialog.modal` with `modal-box` (max-w-2xl)
  - Header: "Plugin Browser" title + close X button
  - Search input (DaisyUI `input input-bordered input-sm`)
  - 3 category sections (Core Tools, Backend Tools, Frontend Tools), each with:
    - Category header with icon
    - Plugin cards: checkbox + name + description + skill/command counts as badges
    - `isDefault` plugins show a "Recommended" badge
  - Footer: Cancel button + Save button (btn-primary, disabled if saving)
- Save action: calls `plugins:save-config` RPC, emits `saved` with selected IDs, then emits `closed`

**Quality Requirements**:

- Full-screen responsive modal (DaisyUI pattern)
- Checkbox state managed via `Set<string>` signal (immutable updates with new Set)
- Search filtering is reactive (computed signal)
- Category grouping for organized display
- Loading spinner while fetching
- Save button disabled during save
- All DaisyUI + Tailwind, no custom CSS except minimal host styles

---

### Task 4.3: Integrate into ChatEmptyStateComponent IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-empty-state.component.ts`
**Pattern to Follow**: How `SetupStatusWidgetComponent` is integrated (import at line 4, template at line 127)

**Implementation Details**:

1. Add imports to component:

   ```typescript
   import { PluginStatusWidgetComponent } from './plugin-status-widget.component';
   import { PluginBrowserModalComponent } from './plugin-browser-modal.component';
   ```

2. Add to `imports` array in `@Component` decorator (after `LucideAngularModule`):

   ```typescript
   PluginStatusWidgetComponent, PluginBrowserModalComponent;
   ```

3. Add signal to class:

   ```typescript
   /** Whether the plugin browser modal is open */
   protected readonly isPluginBrowserOpen = signal(false);
   ```

   Add `signal` to Angular imports.

4. Add methods to class:

   ```typescript
   protected openPluginBrowser(): void {
     this.isPluginBrowserOpen.set(true);
   }

   protected closePluginBrowser(): void {
     this.isPluginBrowserOpen.set(false);
   }

   protected onPluginsSaved(enabledIds: string[]): void {
     this.isPluginBrowserOpen.set(false);
     // Plugin config saved via RPC in the modal - no additional action needed
   }
   ```

5. Add plugin section in template - AFTER the Smart Setup CTA card closing div (after line 130, before Capabilities Section), add:

   ```html
   <!-- Plugin Configuration Card (TASK_2025_153) -->
   <div class="w-full max-w-md mb-5">
     <ptah-plugin-status-widget (configureClicked)="openPluginBrowser()" />
   </div>
   ```

6. Add modal at the END of the template (before the closing `</div>` of the root flex container, after the decorative footer):
   ```html
   <!-- Plugin Browser Modal (TASK_2025_153) -->
   <ptah-plugin-browser-modal [isOpen]="isPluginBrowserOpen()" (closed)="closePluginBrowser()" (saved)="onPluginsSaved($event)" />
   ```

**Quality Requirements**:

- Plugin section appears between Setup CTA and Capabilities section
- Modal renders at bottom of template (overlay, not in flow)
- No premium gating in frontend (backend handles it) -- actually the widget should be visible to all users, but the modal's save will only have effect for premium users
- Signal-based open/close state

---

### Task 4.4: Export new components from chat library barrel IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts`
**Pattern to Follow**: Check how existing molecule components are exported

**Implementation Details**:

- Need to locate the components barrel file and add exports:
  ```typescript
  export { PluginStatusWidgetComponent } from './molecules/plugin-status-widget.component';
  export { PluginBrowserModalComponent } from './molecules/plugin-browser-modal.component';
  ```
- Also ensure `D:\projects\ptah-extension\libs\frontend\chat\src\index.ts` re-exports via `export * from './lib/components'`

**Quality Requirements**:

- Both components accessible via `@ptah-extension/chat`
- No circular dependency issues

---

### Task 4.5: Import PluginInfo type in frontend components IMPLEMENTED

**File**: Multiple frontend component files from Tasks 4.1 and 4.2

**Implementation Details**:

- `PluginInfo` and `PluginConfigState` types are in `@ptah-extension/shared`
- Frontend components should import: `import type { PluginInfo, PluginConfigState } from '@ptah-extension/shared';`
- The `ClaudeRpcService` from `@ptah-extension/core` provides type-safe RPC calls using `RpcMethodRegistry`
- RPC calls use: `this.rpcService.callExtension<RpcMethodParams<'plugins:list-available'>, RpcMethodResult<'plugins:list-available'>>('plugins:list-available', {})`
  OR the simpler pattern if the service supports it: `this.rpcService.call('plugins:list-available')`

**Quality Requirements**:

- Type imports only (not runtime imports from shared in frontend)
- RPC calls are type-safe against the registry

---

**Batch 4 Verification**:

- PluginStatusWidgetComponent renders in empty state
- PluginBrowserModalComponent opens and shows 4 plugins
- Save persists config via RPC
- Build passes: `npx nx build ptah-extension-webview`
- code-logic-reviewer approved
