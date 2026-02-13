# Plugin Integration Plan: Bundle ptah-claude-plugins into Ptah Extension

## Context

The Ptah VS Code extension (built on Claude Agent SDK) needs to bundle plugins from `ptah-claude-plugins` repo and load them into Claude sessions via the SDK's native `plugins` option. This enables:

- Premium users get project-type-specific skills automatically loaded
- No GitHub marketplace needed — plugins ship inside the extension
- Subscription-gated: only installed extension users get access
- Automatic framework detection selects the right plugin set

The Claude Agent SDK already supports `plugins?: SdkPluginConfig[]` in its `Options` interface (line 1588 of `claude-sdk.types.ts`), where `SdkPluginConfig = { type: 'local'; path: string }`. The extension just doesn't use it yet.

## Files to Modify

### Extension project (`D:\projects\ptah-extension`)

| File                                                                  | Action               | Purpose                                                             |
| --------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------- |
| `apps/ptah-extension-vscode/assets/plugins/`                          | **CREATE directory** | Bundle plugin directories here                                      |
| `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`     | **CREATE**           | Maps frameworks to plugin paths, resolves from extensionPath        |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`                     | **EDIT**             | Export PluginLoaderService                                          |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                         | **EDIT**             | Add `SDK_PLUGIN_LOADER` token                                       |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                       | **EDIT**             | Register PluginLoaderService singleton                              |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` | **EDIT**             | Add `plugins` to SdkQueryOptions, build plugin configs in `build()` |
| `apps/ptah-extension-vscode/project.json`                             | **EDIT**             | Add post-build-copy step for plugins directory                      |
| `apps/ptah-extension-vscode/.vscodeignore`                            | **EDIT**             | Ensure `assets/plugins/` is NOT excluded                            |
| `libs/backend/agent-sdk/src/index.ts`                                 | **EDIT**             | Export PluginLoaderService                                          |

### Plugins project (`D:\projects\ptah-claude-plugins`)

- Already fixed (manifests corrected — `repository` changed from object to string)
- Plugin files will be copied into the extension's assets

---

## Implementation Steps

### Step 1: Create the Plugin Assets Directory

Create the directory structure in the extension to hold bundled plugins:

```
apps/ptah-extension-vscode/assets/plugins/
├── hive-academy-core/
│   ├── .claude-plugin/plugin.json
│   ├── commands/
│   └── skills/
├── hive-academy-nx-saas/
│   ├── .claude-plugin/plugin.json
│   ├── commands/
│   └── skills/
├── hive-academy-angular/
│   ├── .claude-plugin/plugin.json
│   └── skills/
└── hive-academy-react/
    ├── .claude-plugin/plugin.json
    └── skills/
```

**Action**: Copy the 4 plugin directories from `D:\projects\ptah-claude-plugins\plugins\*` to `D:\projects\ptah-extension\apps\ptah-extension-vscode\assets\plugins\`.

> **Note**: The `neon-postgres copy` directory in hive-academy-nx-saas has a space in the name — rename it to `neon-postgres` during copy.

### Step 2: Update Build Pipeline to Include Plugins

**File**: `apps/ptah-extension-vscode/project.json`

The `post-build-copy` target already copies `apps/ptah-extension-vscode/src/assets` to `dist/apps/ptah-extension-vscode/`. However, the plugins are in `apps/ptah-extension-vscode/assets/` (not `src/assets`).

Add a new copy command to `post-build-copy.options.commands`:

```json
{
  "command": "powershell -Command \"Copy-Item -Path 'apps/ptah-extension-vscode/assets/plugins' -Destination 'dist/apps/ptah-extension-vscode/plugins/' -Recurse -Force\"",
  "forwardAllArgs": false
}
```

Also update `post-build-copy.outputs` array to include:

```json
"{workspaceRoot}/dist/apps/ptah-extension-vscode/plugins"
```

**File**: `apps/ptah-extension-vscode/.vscodeignore`

Ensure `plugins/` is NOT in the ignore list. The `.vscodeignore` currently excludes `src/` and `node_modules/` but should be fine since `plugins/` will be at the dist root.

### Step 3: Create PluginLoaderService

**File**: `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`

```typescript
/**
 * Plugin Loader Service - Resolves bundled plugin paths for SDK sessions
 *
 * Maps detected project frameworks to the appropriate bundled plugins.
 * Plugins are shipped inside the extension's assets directory and loaded
 * via the SDK's native `plugins` option as SdkPluginConfig[].
 *
 * Architecture: Stateless resolver - no caching needed since path resolution is cheap.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import * as path from 'path';
import * as fs from 'fs';
import { SdkPluginConfig } from '../types/sdk-types/claude-sdk.types';

/**
 * Framework-to-plugin mapping
 * Maps detected frameworks to their plugin directory names
 */
const FRAMEWORK_PLUGIN_MAP: Record<string, string[]> = {
  // Frontend frameworks
  angular: ['hive-academy-core', 'hive-academy-angular'],
  react: ['hive-academy-core', 'hive-academy-react'],
  nextjs: ['hive-academy-core', 'hive-academy-react'],
  vue: ['hive-academy-core'],
  nuxt: ['hive-academy-core'],

  // Backend frameworks
  express: ['hive-academy-core', 'hive-academy-nx-saas'],
  nestjs: ['hive-academy-core', 'hive-academy-nx-saas'],
  django: ['hive-academy-core'],
  laravel: ['hive-academy-core'],
  rails: ['hive-academy-core'],

  // Fallback
  general: ['hive-academy-core'],
};

@injectable()
export class PluginLoaderService {
  /** Absolute path to bundled plugins directory */
  private pluginsBasePath: string | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Initialize with the extension's installation path
   * Must be called during extension activation with context.extensionPath
   *
   * @param extensionPath - vscode.ExtensionContext.extensionPath
   */
  initialize(extensionPath: string): void {
    this.pluginsBasePath = path.join(extensionPath, 'plugins');
    this.logger.info('[PluginLoader] Initialized', {
      pluginsBasePath: this.pluginsBasePath,
    });
  }

  /**
   * Resolve plugin configs for a detected framework
   *
   * @param framework - Detected framework name (from FrameworkDetectorService)
   * @returns SdkPluginConfig[] for SDK query options
   */
  resolvePlugins(framework?: string): SdkPluginConfig[] {
    if (!this.pluginsBasePath) {
      this.logger.warn('[PluginLoader] Not initialized - no plugins loaded');
      return [];
    }

    const key = framework?.toLowerCase() || 'general';
    const pluginNames = FRAMEWORK_PLUGIN_MAP[key] || FRAMEWORK_PLUGIN_MAP['general'];

    const configs: SdkPluginConfig[] = [];

    for (const name of pluginNames) {
      const pluginPath = path.join(this.pluginsBasePath, name);

      // Verify plugin directory exists at runtime
      if (fs.existsSync(pluginPath)) {
        configs.push({ type: 'local', path: pluginPath });
      } else {
        this.logger.warn(`[PluginLoader] Plugin not found: ${pluginPath}`);
      }
    }

    this.logger.info('[PluginLoader] Resolved plugins', {
      framework: key,
      pluginCount: configs.length,
      plugins: configs.map((c) => path.basename(c.path)),
    });

    return configs;
  }

  /**
   * Get all available plugin names (for diagnostics/UI)
   */
  getAvailablePlugins(): string[] {
    if (!this.pluginsBasePath || !fs.existsSync(this.pluginsBasePath)) {
      return [];
    }

    return fs.readdirSync(this.pluginsBasePath).filter((entry) => {
      const fullPath = path.join(this.pluginsBasePath!, entry);
      return fs.statSync(fullPath).isDirectory();
    });
  }
}
```

### Step 4: Register in DI

**File**: `libs/backend/agent-sdk/src/lib/di/tokens.ts`

Add to `SDK_TOKENS`:

```typescript
// Plugin loader service - resolves bundled plugins for SDK sessions
SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader'),
```

**File**: `libs/backend/agent-sdk/src/lib/di/register.ts`

Add import:

```typescript
import { PluginLoaderService } from '../helpers';
```

Add registration (before the Main Adapter section):

```typescript
// Plugin loader - resolves bundled plugin paths per framework
container.register(SDK_TOKENS.SDK_PLUGIN_LOADER, { useClass: PluginLoaderService }, { lifecycle: Lifecycle.Singleton });
```

### Step 5: Export from Barrel Files

**File**: `libs/backend/agent-sdk/src/lib/helpers/index.ts`

Add export:

```typescript
export { PluginLoaderService } from './plugin-loader.service';
```

**File**: `libs/backend/agent-sdk/src/index.ts`

Add to exports:

```typescript
export { PluginLoaderService } from './lib/helpers';
```

### Step 6: Update SdkQueryOptionsBuilder

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**6a. Add to `QueryOptionsInput` interface:**

```typescript
/**
 * Detected framework for plugin selection
 * Passed from workspace intelligence to select appropriate bundled plugins
 */
framework?: string;
```

**6b. Add to `SdkQueryOptions` interface:**

```typescript
/** Bundled plugins to load for this session */
plugins?: SdkPluginConfig[];
```

**6c. Inject PluginLoaderService in constructor:**

```typescript
import { PluginLoaderService } from './plugin-loader.service';

// Add to constructor parameters:
@inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
private readonly pluginLoader: PluginLoaderService,
```

**6d. Update `build()` method** to include plugins in the returned options:

```typescript
// After building MCP servers, before return:
const plugins = isPremium ? this.pluginLoader.resolvePlugins(input.framework) : [];

// Add to the returned options object:
return {
  prompt: userMessageStream,
  options: {
    // ... existing options ...
    plugins: plugins.length > 0 ? plugins : undefined,
  },
};
```

### Step 7: Wire Framework Detection Through Session Flow

**7a. File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

Add `framework?: string` to `ExecuteQueryConfig` interface:

```typescript
export interface ExecuteQueryConfig {
  // ... existing fields ...
  /** Detected project framework for plugin selection */
  framework?: string;
}
```

Pass it through in `executeQuery()` to queryOptionsBuilder.build():

```typescript
const queryOptions = await this.queryOptionsBuilder.build({
  // ...existing params...
  framework: config.framework,
});
```

**7b. File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

Add `framework?: string` to the `startChatSession` config type parameter and pass through to `sessionLifecycle.executeQuery()`:

```typescript
async startChatSession(config: AISessionConfig & {
  // ... existing fields ...
  framework?: string;
}): Promise<AsyncIterable<FlatStreamEventUnion>> {
  // ...
  const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQuery({
    // ... existing params ...
    framework: config.framework,
  });
}
```

**7c. File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

In the `chat:start` RPC handler, detect framework and pass it to `startChatSession`:

```typescript
// Detect framework for plugin loading (use existing FrameworkDetectorService)
const framework = await frameworkDetector.detect(workspacePath);

await sdkAdapter.startChatSession({
  // ...existing params...
  framework: framework || undefined,
});
```

> **Note**: Check if `FrameworkDetectorService` is already injected in the RPC handlers. If not, inject it via DI token `TOKENS.FRAMEWORK_DETECTOR` (or however it's registered in workspace-intelligence).

### Step 8: Initialize PluginLoaderService During Activation

**File**: `apps/ptah-extension-vscode/src/main.ts`

After SDK initialization (around Step 7-8 in the existing activation flow), add:

```typescript
// Initialize plugin loader with extension path for bundled plugin resolution
const pluginLoader = container.resolve<PluginLoaderService>(SDK_TOKENS.SDK_PLUGIN_LOADER);
pluginLoader.initialize(context.extensionPath);
```

---

## Data Flow Summary

```
Extension Activation
  └─> PluginLoaderService.initialize(context.extensionPath)
        └─> Sets pluginsBasePath = "{extensionPath}/plugins"

User Starts Chat Session
  └─> chat:start RPC handler
        ├─> FrameworkDetectorService.detect(workspacePath) → "react"
        └─> SdkAgentAdapter.startChatSession({ ..., framework: "react" })
              └─> SessionLifecycleManager.executeQuery({ ..., framework: "react" })
                    └─> SdkQueryOptionsBuilder.build({ ..., framework: "react" })
                          ├─> PluginLoaderService.resolvePlugins("react")
                          │     └─> Returns: [
                          │          { type: 'local', path: '.../plugins/hive-academy-core' },
                          │          { type: 'local', path: '.../plugins/hive-academy-react' }
                          │        ]
                          └─> SDK query({ options: { plugins: [...] } })
                                └─> Claude loads skills from bundled plugins
```

---

## Verification Plan

1. **Build test**: Run `npx nx build ptah-extension-vscode` and verify `dist/apps/ptah-extension-vscode/plugins/` contains all 4 plugin directories with their `.claude-plugin/plugin.json` files and skills.

2. **Runtime test**: Start the extension in debug mode, open a React project. Check the SDK logger output for:

   - `[PluginLoader] Initialized` with correct path
   - `[PluginLoader] Resolved plugins` showing `['hive-academy-core', 'hive-academy-react']`

3. **SDK Init message test**: In the chat session init system message (`SDKSystemMessage`), verify the `plugins` field lists the loaded plugins.

4. **Skill invocation test**: In a chat session, verify skills like `/hive-academy-react:react-best-practices` are available.

5. **Plugin validate test**: Run `claude plugin validate` on each bundled plugin directory to confirm manifests are valid.

---

## Key Design Decisions

- **Premium-gated**: Only premium users get plugins loaded (consistent with MCP server gating pattern)
- **Framework-aware**: Uses existing `FrameworkDetectorService` to select relevant plugins
- **Core always included**: `hive-academy-core` is loaded for all frameworks (orchestration, DDD, etc.)
- **Graceful degradation**: Missing plugin directories are logged as warnings, not errors
- **No DI for extensionPath**: PluginLoaderService gets extensionPath via `initialize()` call since `ExtensionContext` is only available at activation time
- **Stateless resolution**: No caching needed — path resolution is a simple `fs.existsSync` check

## Key Files Reference

| File                                                                                     | Purpose                             |
| ---------------------------------------------------------------------------------------- | ----------------------------------- |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:1588`                | SDK `Options.plugins` field         |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:115`                 | `SdkPluginConfig` type definition   |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`                    | Where SDK options are assembled     |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`                    | Query execution orchestration       |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                                    | Main SDK adapter (chat entry point) |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                                            | DI token registry                   |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                                          | DI service registration             |
| `apps/ptah-extension-vscode/src/main.ts`                                                 | Extension activation flow           |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`              | Chat session RPC handlers           |
| `apps/ptah-extension-vscode/project.json`                                                | Nx build pipeline config            |
| `libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts` | Framework detection                 |
