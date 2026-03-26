# Implementation Plan - TASK_2025_221: Migrate to esbuild + ESM

## Executive Summary

Migrate the Ptah extension monorepo from **webpack + CommonJS** to **esbuild + ESM** to:

1. **Fix the VS Code Marketplace "suspicious content" rejection** -- webpack forcibly bundles the 12MB obfuscated `cli.js` from `@anthropic-ai/claude-agent-sdk` because it cannot properly externalize an ESM-only package in a CJS build.
2. **Enable native ESM output** -- VS Code 1.100+ natively supports ESM extensions, allowing proper `import()` for ESM-only packages without bundling hacks.
3. **Eliminate all ESM workaround hacks** -- the `new Function('specifier', 'return import(specifier)')` pattern in sdk-resolver.ts, the special SDK bundling exception in webpack, and the cli.js asset copy.
4. **Modernize the build pipeline** -- esbuild is 10-100x faster than webpack + ts-loader.

### Before/After Architecture

```
BEFORE:
  TypeScript  -->  ts-loader  -->  webpack  -->  main.js (CJS, commonjs2)
  - reflect-metadata bundled as entry[0]
  - @anthropic-ai/claude-agent-sdk BUNDLED (12MB, causes "suspicious content")
  - @github/copilot-sdk, @openai/codex-sdk use new Function() hack to bypass webpack
  - emitDecoratorMetadata: true (incompatible with esbuild)
  - 237-line webpack.config.js with complex externals function

AFTER:
  TypeScript  -->  esbuild  -->  main.mjs (ESM, format: esm)
  - import 'reflect-metadata' at top of entry point (kept as-is)
  - @anthropic-ai/claude-agent-sdk EXTERNALIZED (native ESM import)
  - @github/copilot-sdk, @openai/codex-sdk use standard import() (no hack needed)
  - emitDecoratorMetadata: false (all injections are explicit @inject(TOKEN))
  - ~50-line esbuild.config.mjs with simple external list
```

---

## Codebase Investigation Summary

### Libraries Discovered

All **11 backend libraries** already use `@nx/esbuild:esbuild` with `"format": ["cjs"]`:

| Library                | project.json executor | Current format | External deps                                                         |
| ---------------------- | --------------------- | -------------- | --------------------------------------------------------------------- |
| shared                 | @nx/esbuild:esbuild   | cjs            | (none)                                                                |
| platform-core          | @nx/esbuild:esbuild   | cjs            | tsyringe, reflect-metadata                                            |
| platform-vscode        | @nx/esbuild:esbuild   | cjs            | tsyringe, reflect-metadata, vscode                                    |
| platform-electron      | @nx/esbuild:esbuild   | cjs            | tsyringe, reflect-metadata, electron, chokidar, fast-glob             |
| vscode-core            | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, eventemitter3, rxjs                                 |
| workspace-intelligence | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, reflect-metadata                                    |
| agent-sdk              | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, eventemitter3, rxjs, @anthropic-ai/claude-agent-sdk |
| agent-generation       | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, eventemitter3, rxjs                                 |
| template-generation    | @nx/esbuild:esbuild   | cjs            | tsyringe, @langchain/core, zod, vscode                                |
| llm-abstraction        | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, @langchain/\*, zod                                  |
| vscode-lm-tools        | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, eventemitter3, rxjs, minimatch                      |
| rpc-handlers           | @nx/esbuild:esbuild   | cjs            | vscode, tsyringe, eventemitter3, rxjs                                 |

**Only 2 apps use webpack**: `ptah-extension-vscode` and `ptah-electron` (both via `@nx/webpack:webpack`).

### ESM-Incompatible Patterns Found

#### 1. `__dirname` usages (5 total in source)

| File                                                                         | Line | Usage                                                 | Migration                                                                           |
| ---------------------------------------------------------------------------- | ---- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `libs/backend/agent-generation/src/lib/services/template-storage.service.ts` | 71   | `join(__dirname, '..', '..', 'templates', 'agents')`  | Replace with `import.meta.dirname` (Node 21.2+) or `fileURLToPath(import.meta.url)` |
| `apps/ptah-electron/src/windows/main-window.ts`                              | 63   | `path.join(__dirname, 'assets', 'icons', 'icon.png')` | Replace with `import.meta.dirname`                                                  |
| `apps/ptah-electron/src/windows/main-window.ts`                              | 65   | `path.join(__dirname, 'preload.js')`                  | Replace with `import.meta.dirname`                                                  |
| `apps/ptah-electron/src/main.ts`                                             | 608  | `path.join(__dirname, 'renderer', 'index.html')`      | Replace with `import.meta.dirname`                                                  |
| `apps/ptah-electron/src/main.ts`                                             | 642  | `path.join(__dirname, 'renderer', 'index.html')`      | Replace with `import.meta.dirname`                                                  |

Note: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/code-execution.engine.ts` lines 71-86 are string literals used in the sandbox's restricted-globals list, not actual usages -- no change needed.

#### 2. Inline `require()` calls (6 in production source, excluding tests)

| File                                                                                  | Line      | require() target                                                  | Migration                                                                           |
| ------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts`           | 101-103   | `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript` | Use `createRequire(import.meta.url)` -- native bindings cannot use `import()`       |
| `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts` | 125       | `chokidar`                                                        | Replace with `await import('chokidar')`                                             |
| `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`              | 1034-1035 | `fs`, `path`                                                      | Replace with `import { existsSync } from 'fs'; import { join } from 'path';` at top |
| `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`              | 464       | `os`                                                              | Replace with `import { homedir } from 'os';` at top                                 |
| `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts`                 | 241       | `child_process`                                                   | Replace with `import { spawn } from 'child_process';` at top                        |
| `apps/ptah-extension-vscode/src/main.ts`                                              | 98        | `./services/webview-html-generator`                               | Replace with top-level static import or `await import()`                            |

#### 3. `new Function()` hack (1 file)

| File                                                                         | Line | Purpose                       | Migration                                                                    |
| ---------------------------------------------------------------------------- | ---- | ----------------------------- | ---------------------------------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` | 25   | Webpack-opaque dynamic import | Replace with standard `import()` -- esbuild doesn't transform dynamic import |

#### 4. `emitDecoratorMetadata: true` (3 tsconfig files)

| File                                           | Current value                                        |
| ---------------------------------------------- | ---------------------------------------------------- |
| `tsconfig.base.json`                           | `"emitDecoratorMetadata": true`                      |
| `apps/ptah-electron/tsconfig.app.json`         | `"emitDecoratorMetadata": true`                      |
| `apps/ptah-extension-vscode/tsconfig.app.json` | (inherits from tsconfig.base.json via tsconfig.json) |

#### 5. Implicit DI Injections (workspace-intelligence)

Services registered via `container.registerSingleton(TOKEN, Class)` where the class constructor has parameters **without** `@inject()` decorators. These rely on `emitDecoratorMetadata` for type-based resolution by tsyringe:

**workspace-intelligence services with implicit constructor injection** (identified by inspecting `@injectable()` classes with undecorated constructor params):

| Service                        | File                                                     | Implicit params (no @inject)                                                                                                                  |
| ------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceAnalyzerService`     | `composite/workspace-analyzer.service.ts:85-92`          | `fileSystemService`, `projectDetector`, `frameworkDetector`, `dependencyAnalyzer`, `workspaceService`, `contextService`, `indexer` (7 params) |
| `WorkspaceService`             | `workspace/workspace.service.ts:149-154`                 | `projectDetector`, `frameworkDetector`, `dependencyAnalyzer`, `monorepoDetector`, `fileSystem` (5 params)                                     |
| `ContextOrchestrationService`  | `context/context-orchestration.service.ts:219-220`       | `contextService` (1 param)                                                                                                                    |
| `WorkspaceIndexerService`      | `file-indexing/workspace-indexer.service.ts:68-73`       | `fileSystemService`, `patternMatcher`, `ignoreResolver`, `fileClassifier`, `tokenCounter` (5 params)                                          |
| `IgnorePatternResolverService` | `file-indexing/ignore-pattern-resolver.service.ts:91-93` | `fileSystem`, `patternMatcher` (2 params)                                                                                                     |
| `ProjectDetectorService`       | `project-analysis/project-detector.service.ts:33-34`     | `fileSystem` (1 param)                                                                                                                        |
| `FrameworkDetectorService`     | `project-analysis/framework-detector.service.ts:20`      | `fileSystem` (1 param)                                                                                                                        |
| `DependencyAnalyzerService`    | `project-analysis/dependency-analyzer.service.ts:38`     | `fileSystem` (1 param)                                                                                                                        |
| `ContextService`               | `context/context.service.ts:100-115`                     | Need to verify constructor                                                                                                                    |
| `MonorepoDetectorService`      | `project-analysis/monorepo-detector.service.ts`          | Need to verify constructor                                                                                                                    |

**Estimated total**: ~30 constructor parameters across ~10 services that need explicit `@inject(TOKEN)` decorators added.

#### 6. reflect-metadata Loading

Currently loaded in 4 places:

- `apps/ptah-extension-vscode/webpack.config.js` entry array (webpack bundles it first)
- `apps/ptah-extension-vscode/src/main.ts` line 2 (`import 'reflect-metadata'`)
- `apps/ptah-extension-vscode/src/di/container.ts` line 20 (`import 'reflect-metadata'`)
- `apps/ptah-electron/src/main.ts` line 2 (`import 'reflect-metadata'`)
- `apps/ptah-electron/src/di/container.ts` line 50 (`import 'reflect-metadata'`)

**Post-migration**: The webpack entry array trick is eliminated. Keep `import 'reflect-metadata'` at the top of `main.ts` (esbuild respects import order). The DI container imports are redundant but harmless.

#### 7. SDK Externalization Strategy

Current state:

- `sdk-module-loader.ts` does `await import('@anthropic-ai/claude-agent-sdk')` -- this works today because webpack BUNDLES the SDK (special exception in externals function)
- `sdk-resolver.ts` uses `new Function('specifier', 'return import(specifier)')` for copilot-sdk and codex-sdk to bypass webpack

Post-migration:

- All three SDKs can use standard `await import('...')` since esbuild does NOT rewrite dynamic imports for externalized packages
- The `new Function()` hack in `sdk-resolver.ts` becomes unnecessary and can be replaced with plain `import()`
- `@anthropic-ai/claude-agent-sdk` moves from BUNDLED to EXTERNALIZED (installed in `dist/node_modules/`)

---

## Phase Breakdown

### Phase 0: Fix Implicit DI Injections (Pre-requisite)

**Goal**: Add explicit `@inject(TOKEN)` decorators to all workspace-intelligence services that currently rely on `emitDecoratorMetadata` for implicit type-based injection.

**Why first**: This is the blocker for disabling `emitDecoratorMetadata`, which is the blocker for esbuild (esbuild issue #257 -- won't support it).

**Dependencies**: None (pure code changes, no build changes)

#### Files to Modify

For each service listed in the investigation above, add `@inject(TOKEN)` to every undecorated constructor parameter. The TOKEN names are defined in `libs/backend/vscode-core/src/di/tokens.ts` and `libs/backend/platform-core/src/index.ts`.

The pattern to follow (from existing code that already has explicit injection):

```typescript
// BEFORE (implicit -- relies on emitDecoratorMetadata):
@injectable()
export class WorkspaceIndexerService {
  constructor(
    private readonly fileSystemService: FileSystemService, // NO @inject
    private readonly patternMatcher: PatternMatcherService, // NO @inject
    private readonly ignoreResolver: IgnorePatternResolverService, // NO @inject
    private readonly fileClassifier: FileTypeClassifierService, // NO @inject
    private readonly tokenCounter: TokenCounterService, // NO @inject
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) private readonly fsProvider: IFileSystemProvider, // HAS @inject
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspaceProvider: IWorkspaceProvider, // HAS @inject
  ) {}
}

// AFTER (explicit -- works without emitDecoratorMetadata):
@injectable()
export class WorkspaceIndexerService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystemService: FileSystemService,
    @inject(TOKENS.PATTERN_MATCHER_SERVICE) private readonly patternMatcher: PatternMatcherService,
    @inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE) private readonly ignoreResolver: IgnorePatternResolverService,
    @inject(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE) private readonly fileClassifier: FileTypeClassifierService,
    @inject(TOKENS.TOKEN_COUNTER_SERVICE) private readonly tokenCounter: TokenCounterService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) private readonly fsProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER) private readonly workspaceProvider: IWorkspaceProvider,
  ) {}
}
```

**Full list of files requiring changes** (developer must verify each constructor):

1. `libs/backend/workspace-intelligence/src/composite/workspace-analyzer.service.ts` -- 7 params
2. `libs/backend/workspace-intelligence/src/workspace/workspace.service.ts` -- 5 params
3. `libs/backend/workspace-intelligence/src/context/context-orchestration.service.ts` -- 1 param (`contextService`)
4. `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts` -- 5 params
5. `libs/backend/workspace-intelligence/src/file-indexing/ignore-pattern-resolver.service.ts` -- 2 params
6. `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts` -- 1 param
7. `libs/backend/workspace-intelligence/src/project-analysis/framework-detector.service.ts` -- 1 param
8. `libs/backend/workspace-intelligence/src/project-analysis/dependency-analyzer.service.ts` -- 1 param
9. `libs/backend/workspace-intelligence/src/context/context.service.ts` -- verify constructor
10. `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts` -- verify constructor
11. `libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts` -- verify constructor
12. `libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts` -- verify constructor
13. `libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts` -- verify constructor
14. `libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts` -- verify constructor
15. `libs/backend/workspace-intelligence/src/quality/services/*.ts` -- verify all quality service constructors

**Important**: Also scan ALL other backend libraries for any implicit injections. The context.md says "~10 services in workspace-intelligence" but we must verify no other libraries have this pattern. Grep for `@injectable()` classes where constructor has params without `@inject()`:

- `libs/backend/vscode-core/src/**` -- check all `@injectable()` classes
- `libs/backend/agent-sdk/src/**` -- check all `@injectable()` classes
- `libs/backend/agent-generation/src/**` -- check all `@injectable()` classes
- `libs/backend/template-generation/src/**` -- check all `@injectable()` classes
- `libs/backend/llm-abstraction/src/**` -- check all `@injectable()` classes
- `libs/backend/rpc-handlers/src/**` -- check all `@injectable()` classes
- `libs/backend/vscode-lm-tools/src/**` -- check all `@injectable()` classes
- `libs/backend/platform-core/src/**` -- check all `@injectable()` classes
- `libs/backend/platform-vscode/src/**` -- check all `@injectable()` classes
- `libs/backend/platform-electron/src/**` -- check all `@injectable()` classes

#### Verification

```bash
# 1. Build everything with emitDecoratorMetadata still ON (proves we didn't break anything):
nx run-many -t build

# 2. Run all backend tests:
nx run-many -t test -p workspace-intelligence vscode-core agent-sdk agent-generation

# 3. Manual verification: Start the extension in VS Code debug mode (F5)
# and verify that workspace analysis, project detection, etc. still work.
```

---

### Phase 1: Disable emitDecoratorMetadata

**Goal**: Turn off `emitDecoratorMetadata` globally. This validates that Phase 0 correctly added all explicit `@inject()` decorators.

**Dependencies**: Phase 0 complete

#### Files to Modify

**1. `tsconfig.base.json` (line 8)**

```jsonc
// BEFORE:
"emitDecoratorMetadata": true,

// AFTER:
"emitDecoratorMetadata": false,
```

**2. `apps/ptah-electron/tsconfig.app.json` (line 9)**

```jsonc
// BEFORE:
"emitDecoratorMetadata": true,

// AFTER:
// REMOVE this line entirely (inherits false from tsconfig.base.json)
```

#### Verification

```bash
# Full rebuild -- this will FAIL if any service still relies on metadata emission:
nx run-many -t build --skip-nx-cache

# Run tests:
nx run-many -t test --skip-nx-cache

# Type check:
nx run-many -t typecheck --skip-nx-cache

# Manual: Start extension in VS Code debug mode (F5) and test:
# - Open a workspace
# - Verify sidebar loads
# - Start a chat session
# - Run agent setup wizard
# - Verify project detection works
```

**What breaks if wrong**: Any service that still has implicit DI injection will get `undefined` for that parameter at runtime, causing null reference errors when the service is first used. The error typically manifests as "Cannot read property X of undefined" in the extension host output.

---

### Phase 2: Fix ESM-Incompatible Code Patterns

**Goal**: Fix all `__dirname`, inline `require()`, and `new Function()` patterns to be ESM-compatible, while still building as CJS (so the extension still works before the final ESM switch).

**Dependencies**: Phase 1 complete

**Strategy**: Use patterns that work in BOTH CJS and ESM:

- For `__dirname`: Use a polyfill pattern `const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url))` -- but since we're still CJS at this point, use conditional: `typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))`
- Actually, the simpler approach: fix these in Phase 5 when we flip to ESM. For now in Phase 2, focus only on `require()` calls that can be converted to standard imports, and the `new Function()` hack.

#### Files to Modify

**1. `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` (lines 1034-1035)**

```typescript
// BEFORE:
private detectPackageManager(workspacePath: string): string {
  const fs = require('fs');
  const path = require('path');

// AFTER:
// Add to file-level imports at top:
import { existsSync } from 'fs';
import { join } from 'path';
// Then in the method, replace fs.existsSync with existsSync, path.join with join
```

**2. `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` (line 464)**

```typescript
// BEFORE:
homeDir: require('os').homedir(),

// AFTER:
// Add to file-level imports:
import { homedir } from 'os';
// Then:
homeDir: homedir(),
```

**3. `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts` (line 241)**

```typescript
// BEFORE:
const { spawn } = require('child_process');

// AFTER:
// Add to file-level imports:
import { spawn } from 'child_process';
// Remove the inline require
```

**4. `apps/ptah-extension-vscode/src/main.ts` (line 98)**

```typescript
// BEFORE:
const { WebviewHtmlGenerator } = require('./services/webview-html-generator');

// AFTER:
// Add to file-level imports at top:
import { WebviewHtmlGenerator } from './services/webview-html-generator';
```

**5. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` (line 25)**

```typescript
// BEFORE:
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

// AFTER (once we move to esbuild, standard import() works without being rewritten):
// For now, keep the hack -- it will be removed in Phase 6 when webpack is gone.
// Mark with a TODO:
// TODO: TASK_2025_221 Phase 6 - Replace with standard import() after webpack removal
```

**6. `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts` (line 125)**

```typescript
// BEFORE:
const chokidar = require('chokidar');

// AFTER:
// chokidar is already in the externals list for platform-electron.
// For CJS compatibility, keep require() for now -- convert to import() in Phase 5.
// Mark with TODO:
// TODO: TASK_2025_221 Phase 5 - Replace with: const chokidar = await import('chokidar');
```

**7. `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts` (lines 101-103)**

```typescript
// BEFORE:
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;

// AFTER:
// tree-sitter uses native Node.js bindings (.node files) which CANNOT be loaded via
// ESM import(). We MUST use createRequire() -- this is the standard pattern for
// native addons in ESM.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
// NOTE: This change should happen in Phase 5 when we switch to ESM output.
// For now (still CJS), the existing require() works fine. Mark with TODO.
```

#### Verification

```bash
# Build:
nx run-many -t build --skip-nx-cache

# Test:
nx run-many -t test --skip-nx-cache

# Manual: F5 in VS Code, verify agent setup, chat, etc. still work
```

---

### Phase 3: Replace webpack with esbuild for ptah-extension-vscode

**Goal**: Replace the webpack build pipeline for the VS Code extension with esbuild, still outputting CJS format initially.

**Dependencies**: Phase 2 complete

#### Files to Create

**1. `apps/ptah-extension-vscode/esbuild.config.mjs`**

```javascript
import { build } from 'esbuild';
import { copy } from 'esbuild-plugin-copy'; // or use Nx assets

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['apps/ptah-extension-vscode/src/main.ts'],
  bundle: true,
  outfile: 'dist/apps/ptah-extension-vscode/main.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs', // Will change to 'esm' in Phase 5
  sourcemap: true,
  // Keep these as-is (not bundled):
  external: [
    'vscode',
    // All npm dependencies -- externalized, installed via npm in dist
    '@anthropic-ai/claude-agent-sdk',
    '@github/copilot-sdk',
    '@openai/codex-sdk',
    'reflect-metadata',
    'tsyringe',
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-typescript',
    'async-mutex',
    'cross-spawn',
    'eventemitter3',
    'gray-matter',
    'json2md',
    'jsonrepair',
    'minimatch',
    'picomatch',
    'rxjs',
    'uuid',
    'which',
    'zod',
    'tslib',
    'p-limit',
    'p-queue',
  ],
  // Bundle our workspace libraries:
  // @ptah-extension/* are resolved via tsconfig paths and bundled inline
  alias: {
    '@ptah-extension/platform-core': './libs/backend/platform-core/src',
    '@ptah-extension/platform-vscode': './libs/backend/platform-vscode/src',
    '@ptah-extension/shared': './libs/shared/src',
    '@ptah-extension/vscode-core': './libs/backend/vscode-core/src',
    '@ptah-extension/workspace-intelligence': './libs/backend/workspace-intelligence/src',
    '@ptah-extension/vscode-lm-tools': './libs/backend/vscode-lm-tools/src',
    '@ptah-extension/agent-sdk': './libs/backend/agent-sdk/src',
    '@ptah-extension/agent-generation': './libs/backend/agent-generation/src',
    '@ptah-extension/template-generation': './libs/backend/template-generation/src',
    '@ptah-extension/rpc-handlers': './libs/backend/rpc-handlers/src',
    '@ptah-extension/llm-abstraction': './libs/backend/llm-abstraction/src',
    '@ptah-extension/llm-abstraction/vscode-lm': './libs/backend/llm-abstraction/src/vscode-lm.ts',
    '@ptah-extension/llm-abstraction/anthropic': './libs/backend/llm-abstraction/src/anthropic.ts',
    '@ptah-extension/llm-abstraction/openrouter': './libs/backend/llm-abstraction/src/openrouter.ts',
  },
  // tree-sitter .node files need special handling:
  loader: { '.node': 'copy' },
  // tsconfig for path resolution and decorator support:
  tsconfig: 'apps/ptah-extension-vscode/tsconfig.app.json',
};

await build(config);
```

**IMPORTANT NOTE**: The above is a reference pattern. The actual implementation should use `@nx/esbuild:esbuild` executor in `project.json` instead of a standalone esbuild config file, since all other backend libraries already use this pattern. The aliases are handled via tsconfig paths that esbuild resolves.

#### Files to Modify

**1. `apps/ptah-extension-vscode/project.json`** -- Replace webpack targets with esbuild

```jsonc
// BEFORE:
{
  "build-webpack": {
    "executor": "@nx/webpack:webpack",
    "options": {
      "target": "node",
      "compiler": "tsc",
      "webpackConfig": "apps/ptah-extension-vscode/webpack.config.js",
      ...
    }
  }
}

// AFTER:
{
  "build-esbuild": {
    "executor": "@nx/esbuild:esbuild",
    "outputs": ["{options.outputPath}"],
    "defaultConfiguration": "production",
    "dependsOn": ["^build"],
    "options": {
      "outputPath": "dist/apps/ptah-extension-vscode",
      "main": "apps/ptah-extension-vscode/src/main.ts",
      "tsConfig": "apps/ptah-extension-vscode/tsconfig.app.json",
      "format": ["cjs"],
      "platform": "node",
      "target": "node20",
      "bundle": true,
      "thirdParty": false,
      "external": [
        "vscode",
        "@anthropic-ai/claude-agent-sdk",
        "@github/copilot-sdk",
        "@openai/codex-sdk",
        "reflect-metadata",
        "tsyringe",
        "tree-sitter",
        "tree-sitter-javascript",
        "tree-sitter-typescript",
        "async-mutex",
        "cross-spawn",
        "eventemitter3",
        "gray-matter",
        "json2md",
        "jsonrepair",
        "minimatch",
        "picomatch",
        "rxjs",
        "uuid",
        "which",
        "zod",
        "tslib",
        "chokidar",
        "fast-glob",
        "p-limit",
        "p-queue"
      ],
      "assets": [
        {
          "glob": "**/*",
          "input": "apps/ptah-extension-vscode/src/assets",
          "output": "assets"
        },
        {
          "glob": "**/*",
          "input": "apps/ptah-extension-vscode/assets/plugins",
          "output": "assets/plugins"
        },
        {
          "glob": "**/*",
          "input": "libs/backend/agent-generation/templates",
          "output": "templates"
        },
        {
          "glob": "package.json",
          "input": "apps/ptah-extension-vscode",
          "output": "."
        }
      ]
    },
    "configurations": {
      "development": {
        "sourcemap": true,
        "minify": false
      },
      "production": {
        "sourcemap": false,
        "minify": true
      }
    }
  },
  "build": {
    "executor": "nx:noop",
    "dependsOn": ["build-esbuild", "post-build-copy"]
  }
}
```

**Key changes in the target**:

- Executor: `@nx/webpack:webpack` --> `@nx/esbuild:esbuild`
- No more `webpackConfig` -- esbuild config is inline in project.json
- `external` list explicitly names every npm package that should NOT be bundled
- `thirdParty: false` -- don't bundle node_modules
- Remove the `cli.js` asset copy (the SDK will be in node_modules, not bundled)
- `bundle: true` -- bundle our workspace libraries into a single output file

**2. `apps/ptah-extension-vscode/tsconfig.app.json`** -- May need adjustment

```jsonc
// Verify module/moduleResolution settings work with esbuild:
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "types": ["node", "vscode"],
    "module": "node16",
    "moduleResolution": "node16",
  },
  "include": ["src/**/*.ts"],
}
// This should work as-is for CJS output. Will change in Phase 5 for ESM.
```

**3. Remove or rename `apps/ptah-extension-vscode/webpack.config.js`** -- delete after esbuild works

#### Verification

```bash
# Build with new esbuild pipeline:
nx build ptah-extension-vscode --skip-nx-cache

# Verify output exists and is a valid single file:
ls -la dist/apps/ptah-extension-vscode/main.js

# Verify output size is reasonable (should be significantly smaller without bundled SDK):
wc -c dist/apps/ptah-extension-vscode/main.js
# Expected: ~1-3MB instead of ~15MB with bundled SDK

# Package (installs npm deps in dist, creates .vsix):
nx package ptah-extension-vscode

# Verify .vsix doesn't contain the 12MB cli.js:
# Unzip the .vsix and check there's no cli.js in the root

# Manual: F5 in VS Code, verify all features work
```

**What breaks if wrong**:

- If an external package is missing from the `external` list, esbuild will try to bundle it and may fail or produce a broken bundle.
- If a workspace library is accidentally externalized, it won't be found at runtime.
- If `tree-sitter` native bindings aren't handled correctly, AST parsing will fail (but it's externalized, so it should work via node_modules).

---

### Phase 4: Replace webpack with esbuild for ptah-electron

**Goal**: Same as Phase 3 but for the Electron app.

**Dependencies**: Phase 3 complete (proves the pattern works)

#### Files to Modify

**1. `apps/ptah-electron/project.json`** -- Replace `build-main` target

```jsonc
// BEFORE:
"build-main": {
  "executor": "@nx/webpack:webpack",
  "options": {
    "webpackConfig": "apps/ptah-electron/webpack.config.js",
    ...
  }
}

// AFTER:
"build-main": {
  "executor": "@nx/esbuild:esbuild",
  "outputs": ["{options.outputPath}"],
  "options": {
    "outputPath": "dist/apps/ptah-electron",
    "main": "apps/ptah-electron/src/main.ts",
    "tsConfig": "apps/ptah-electron/tsconfig.app.json",
    "format": ["cjs"],
    "platform": "node",
    "target": "node20",
    "bundle": true,
    "thirdParty": false,
    "external": [
      "electron",
      "@anthropic-ai/claude-agent-sdk",
      "@github/copilot-sdk",
      "@openai/codex-sdk",
      "reflect-metadata",
      "tsyringe",
      "tree-sitter",
      "tree-sitter-javascript",
      "tree-sitter-typescript",
      "async-mutex",
      "cross-spawn",
      "eventemitter3",
      "gray-matter",
      "json2md",
      "jsonrepair",
      "minimatch",
      "picomatch",
      "rxjs",
      "uuid",
      "which",
      "zod",
      "tslib",
      "chokidar",
      "fast-glob",
      "electron-updater",
      "p-limit",
      "p-queue"
    ],
    "assets": [
      {
        "glob": "**/*",
        "input": "apps/ptah-electron/src/assets",
        "output": "assets"
      },
      {
        "glob": "**/*",
        "input": "apps/ptah-extension-vscode/assets/plugins",
        "output": "assets/plugins"
      },
      {
        "glob": "**/*",
        "input": "libs/backend/agent-generation/templates",
        "output": "templates"
      },
      {
        "glob": "package.json",
        "input": "apps/ptah-electron",
        "output": "."
      },
      {
        "glob": "electron-builder.yml",
        "input": "apps/ptah-electron",
        "output": "."
      }
    ]
  },
  "configurations": {
    "production": {
      "sourcemap": false,
      "minify": true
    },
    "development": {
      "sourcemap": true,
      "minify": false
    }
  }
}
```

**Special Electron considerations**:

- The `vscode` module shim (`apps/ptah-electron/src/shims/vscode-shim.ts`) is resolved via tsconfig alias, not webpack alias. Esbuild uses tsconfig paths, so this should work. Verify that tsconfig.app.json has the correct path alias for `vscode`.
- The `@ptah-extension/vscode-lm-tools` shim needs similar handling. Add tsconfig path alias if not present.

**2. `apps/ptah-electron/tsconfig.app.json`** -- Add path aliases for shims

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "ES2022",
    "outDir": "../../dist/out-tsc",
    "types": ["node", "electron"],
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "paths": {
      "vscode": ["apps/ptah-electron/src/shims/vscode-shim.ts"],
      "@ptah-extension/vscode-lm-tools": ["apps/ptah-electron/src/shims/vscode-lm-tools-shim.ts"],
    },
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/preload.ts", "**/*.spec.ts"],
}
```

**3. Also handle `build-preload`** -- This currently also uses webpack. Check if it needs migration too.

Read `apps/ptah-electron/webpack.preload.config.js` to determine if it can be replaced with esbuild. The preload script is typically simpler and may be straightforward.

**4. Remove `apps/ptah-electron/webpack.config.js`** and `webpack.preload.config.js` after verification.

#### Verification

```bash
# Build Electron:
nx build ptah-electron --skip-nx-cache

# Launch:
npm run electron:serve

# Verify chat, workspace analysis, etc. work in standalone Electron window

# Package:
npm run electron:package
# Verify installer works
```

---

### Phase 5: Switch to ESM Output

**Goal**: Change the output format from CJS to ESM for both the VS Code extension and Electron app. Fix all remaining `__dirname` and `require()` patterns.

**Dependencies**: Phase 4 complete

#### Files to Modify

**1. `apps/ptah-extension-vscode/project.json`** -- Change format to ESM

```jsonc
// Change in build-esbuild options:
"format": ["esm"],
"outputFileName": "main.mjs",
```

Wait -- VS Code ESM extensions need specific handling. Let's verify the correct approach:

- VS Code 1.100+ supports `"main": "./main.mjs"` in package.json (ESM entry).
- The extension manifest `package.json` needs `"type": "module"` OR the entry file needs `.mjs` extension.
- Safest approach: use `.mjs` extension so no package.json `"type"` change is needed for the extension manifest.

Actually, VS Code ESM extensions work by setting `"main": "./main.mjs"` in the extension `package.json`. The `.mjs` extension signals ESM to Node.js. We do NOT need `"type": "module"` in the extension's package.json (which would affect all `.js` files).

```jsonc
// In build-esbuild target:
"options": {
  "format": ["esm"],
  // The output file name:
  // Option A: Keep main.js but add "type": "module" to package.json
  // Option B: Use main.mjs (no package.json change needed)
  // Go with Option B for safety:
}
```

Esbuild with `@nx/esbuild` names the output based on the input filename. We may need to configure the output filename explicitly. Check if `@nx/esbuild` supports `outputFileName` option. If not, we may need a post-build rename step or use a custom esbuild config.

**2. `apps/ptah-extension-vscode/package.json`** (extension manifest)

```jsonc
// BEFORE:
"main": "./main.js",
"engines": {
  "vscode": "^1.74.0"
}

// AFTER:
"main": "./main.mjs",
"engines": {
  "vscode": "^1.100.0"
}
```

Bumping the VS Code engine to `^1.100.0` is required because ESM extension support was added in VS Code 1.100 (April 2025). Latest stable VS Code is 1.112+.

**3. Fix `__dirname` usages -- NOW is the time**

Since we're switching to ESM, `__dirname` is no longer available. Replace with `import.meta.dirname` (available in Node.js 21.2+ which VS Code 1.100+ includes).

**`libs/backend/agent-generation/src/lib/services/template-storage.service.ts` (line 71)**:

```typescript
// BEFORE:
this.templatesPath = templatesPath || join(__dirname, '..', '..', 'templates', 'agents');

// AFTER:
// Add at top of file:
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Keep the existing line unchanged. The polyfill provides __dirname.
// OR use import.meta.dirname directly:
this.templatesPath = templatesPath || join(import.meta.dirname, '..', '..', 'templates', 'agents');
```

**IMPORTANT**: Since this file is a library that gets bundled into the extension, `import.meta.url` will reflect the bundled file path, not the source file path. This is actually correct -- at runtime, the templates directory is relative to the bundled output. But verify the relative path (`../../templates/agents`) still resolves correctly from the esbuild output location.

Actually, this is a deeper issue. When esbuild bundles this library code into `dist/apps/ptah-extension-vscode/main.mjs`, `import.meta.dirname` will be `dist/apps/ptah-extension-vscode/`. The templates are copied to `dist/apps/ptah-extension-vscode/templates/` by the assets config. So the path should be `join(import.meta.dirname, 'templates', 'agents')` -- the `../../` relative path is WRONG for the bundled context.

**Better approach**: The `__dirname` in the bundled CJS also resolved to the dist directory (webpack output), and the `../../templates/agents` path was calculated relative to that. We need to verify what `__dirname` resolved to in the webpack bundle vs what `import.meta.dirname` resolves to in the esbuild bundle. Both should resolve to the same output directory.

For esbuild with `bundle: true`, `import.meta.dirname` in the output points to the output directory. So if `dist/apps/ptah-extension-vscode/templates/agents/` exists (from asset copy), then `join(import.meta.dirname, 'templates', 'agents')` would work. But the original code used `join(__dirname, '..', '..', 'templates', 'agents')` which traverses UP 2 directories. In the webpack bundle, `__dirname` was the output dir too, so `../../templates/agents` would go to `dist/templates/agents` which doesn't exist...

Actually, in webpack with `libraryTarget: commonjs2`, `__dirname` resolves to the directory of the output bundle file. The template-storage.service was originally a separate file in `libs/backend/agent-generation/src/lib/services/` and would have been at `dist/libs/backend/agent-generation/src/lib/services/` conceptually, with `../../templates/agents` resolving to `dist/libs/backend/agent-generation/templates/agents/`. But webpack bundles everything into `main.js`, so `__dirname` in the webpack bundle resolves to `dist/apps/ptah-extension-vscode/`. The `../../templates/agents` would go to `dist/templates/agents/` which doesn't exist.

This means the current code likely uses the **injected** `templatesPath` parameter (from DI container) rather than the default `__dirname` path. Let me verify by checking the DI registration.

Regardless, for ESM: provide a polyfill `const __dirname = dirname(fileURLToPath(import.meta.url))` at the top of the file so the existing logic works identically to how it does today. The DI container likely passes the correct path.

**Electron `__dirname` usages** -- these are in the Electron main process which is NOT a library:

```typescript
// apps/ptah-electron/src/windows/main-window.ts (lines 63, 65)
// apps/ptah-electron/src/main.ts (lines 608, 642)

// For all Electron files, add polyfill at file top:
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
```

**4. Fix `tree-sitter` require() calls**

```typescript
// libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts (lines 101-103)
// BEFORE:
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;

// AFTER:
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
```

**5. Fix chokidar require in platform-electron**

```typescript
// libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts (line 125)
// BEFORE:
const chokidar = require('chokidar');

// AFTER (dynamic import since it's async-capable):
// Actually, this is in a synchronous method createFileWatcher() that returns IFileWatcher.
// We can't use await import() in a sync method. Options:
// a) Use createRequire() like tree-sitter
// b) Restructure to async
// Go with createRequire():
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// ... later in method:
const chokidar = require('chokidar');
```

**6. Fix sdk-resolver.ts**

```typescript
// libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts (line 25)
// BEFORE:
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

// AFTER (esbuild doesn't rewrite dynamic import for external packages):
// Simply use import() directly. The function wrapper is no longer needed.
// Replace all usages of dynamicImport() with import():
async function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier);
}
// Or even simpler -- just use import() directly at each call site.
```

**7. Update all backend library `project.json` files** -- Change format from cjs to esm

For all 11 backend libraries, change `"format": ["cjs"]` to `"format": ["esm"]` in their project.json build targets:

- `libs/shared/project.json`
- `libs/backend/platform-core/project.json`
- `libs/backend/platform-vscode/project.json`
- `libs/backend/platform-electron/project.json`
- `libs/backend/vscode-core/project.json`
- `libs/backend/workspace-intelligence/project.json`
- `libs/backend/agent-sdk/project.json`
- `libs/backend/agent-generation/project.json`
- `libs/backend/template-generation/project.json`
- `libs/backend/llm-abstraction/project.json`
- `libs/backend/vscode-lm-tools/project.json`
- `libs/backend/rpc-handlers/project.json`

**Wait** -- these libraries are bundled INTO the app by the app's esbuild config. The library build targets produce intermediate outputs used only for standalone testing and Nx caching. The library format doesn't directly affect the final bundle format. However, switching them to ESM ensures consistency and catches any CJS-only patterns in library code during library-level builds.

Actually, reconsider: since the apps bundle the libraries directly from source (via tsconfig paths), the library build outputs are only used for standalone tests and type checking. Changing library format to ESM is optional but recommended for consistency.

**8. Update `tsconfig.base.json`** for ESM

```jsonc
// BEFORE:
"module": "esnext",
"moduleResolution": "node16",

// AFTER:
"module": "node16",
"moduleResolution": "node16",
```

The `"module": "esnext"` with `"moduleResolution": "node16"` is actually fine for ESM. No change needed here.

**9. Update `apps/ptah-extension-vscode/tsconfig.app.json`** for ESM

```jsonc
// BEFORE:
{
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
  },
}

// This is actually already correct for ESM with Node16 module resolution.
// No change needed.
```

#### Verification

```bash
# Build:
nx build ptah-extension-vscode --skip-nx-cache

# Verify output is ESM:
head -5 dist/apps/ptah-extension-vscode/main.mjs
# Should see import statements, not require()

# Verify the SDK is NOT bundled:
grep -c 'claude-agent-sdk' dist/apps/ptah-extension-vscode/main.mjs
# Should be minimal references (just the import statement)

# Package:
nx package ptah-extension-vscode

# Verify .vsix file size (should be MUCH smaller without bundled SDK):
ls -la dist/apps/ptah-extension-vscode/*.vsix
```

---

### Phase 6: Remove All ESM Workarounds and Hacks

**Goal**: Clean up all remnants of the webpack + CJS era.

**Dependencies**: Phase 5 complete

#### Files to Delete

1. `apps/ptah-extension-vscode/webpack.config.js` (237 lines)
2. `apps/ptah-electron/webpack.config.js` (200 lines)
3. `apps/ptah-electron/webpack.preload.config.js` (if it exists)

#### Files to Modify

**1. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts`**

Remove all comments about webpack-opaque imports. Simplify the dynamic import:

```typescript
// BEFORE (lines 11-27):
/**
 * Webpack-opaque dynamic import function.
 * Using `new Function` prevents webpack from intercepting and transforming
 * the import() call into its own module resolution (__webpack_require__).
 * At runtime, this executes a real Node.js dynamic import().
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

// AFTER:
// Dynamic import -- works natively with esbuild (not rewritten for external packages)
async function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier);
}
```

Also update all JSDoc comments in this file that reference webpack.

**2. `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts`**

Update comment about SDK being bundled:

```typescript
// BEFORE (line 55-56):
// Dynamic import the ESM SDK module
// Note: SDK is bundled (not externalized) for proper ESM/CommonJS interop

// AFTER:
// Dynamic import the ESM SDK module (externalized, resolved from node_modules)
```

**3. `apps/ptah-extension-vscode/project.json`**

Remove the old `build-webpack` target if it still exists. Remove the `cli.js` asset copy:

```jsonc
// REMOVE this asset entry (no longer needed -- SDK is in node_modules):
{
  "glob": "cli.js",
  "input": "node_modules/@anthropic-ai/claude-agent-sdk",
  "output": ".",
}
```

**4. `package.json` (root)** -- Remove webpack-related dev dependencies

```jsonc
// Remove these devDependencies:
// "webpack-cli": "^5.1.4"  -- no longer used
// "@nx/webpack": "22.1.3"  -- no longer used (if no other project uses it)
// Note: Keep if the landing page or license server still uses webpack.
// Check first!
```

Check which projects still use `@nx/webpack`:

- `ptah-landing-page` -- uses Angular CLI, not webpack directly
- `ptah-license-server` -- uses NestJS, check project.json

If no project uses `@nx/webpack`, remove it from devDependencies.

**5. Remove references to webpack in CLAUDE.md files**

Update `apps/ptah-extension-vscode/CLAUDE.md` and `apps/ptah-electron/CLAUDE.md` to reference esbuild instead of webpack.

#### Verification

```bash
# Full clean rebuild:
nx reset && rm -rf dist
nx run-many -t build --skip-nx-cache

# Verify no webpack references in dist:
grep -r 'webpack' dist/apps/ptah-extension-vscode/ || echo "No webpack references"

# Run all tests:
nx run-many -t test --skip-nx-cache

# Manual: F5 in VS Code, full feature test
```

---

### Phase 7: Update Extension Manifest and Packaging

**Goal**: Update the extension manifest for ESM, bump VS Code engine requirement, and verify marketplace compatibility.

**Dependencies**: Phase 6 complete

#### Files to Modify

**1. `apps/ptah-extension-vscode/package.json`** (extension manifest)

```jsonc
// Key changes (some already done in Phase 5):
{
  "main": "./main.mjs",
  "engines": {
    "vscode": "^1.100.0",
  },
  "version": "0.2.0", // Major version bump for ESM migration
}
```

**2. `apps/ptah-extension-vscode/.vscodeignore`**

Review and update. The current `.vscodeignore` filters `.ts` files and `webpack.config.js` -- update references:

```
# Remove this line (no longer exists):
webpack.config.js

# Add esbuild config if it exists as a file:
esbuild.config.mjs
```

**3. `apps/ptah-extension-vscode/project.json` -- `package` target**

Verify the `vsce package` command works with ESM extensions:

```jsonc
"package": {
  "executor": "nx:run-commands",
  "dependsOn": ["pre-package"],
  "options": {
    "command": "cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation"
  }
}
```

The `@vscode/vsce` tool version `^3.7.1` should support ESM extensions. Verify.

**4. Verify `node_modules` installation in dist**

The `pre-package` target runs `npm install --omit=dev` in the dist directory. Verify that:

- `@anthropic-ai/claude-agent-sdk` is properly installed (it's in the extension's package.json dependencies)
- The 12MB `cli.js` is NOT included in the `.vsix` (handled by `.vscodeignore`)
- The SDK's ESM entry point resolves correctly from the `.mjs` main file

Add to `.vscodeignore` if not already present:

```
# Exclude Claude Agent SDK cli.js from VSIX (not needed, it's an SDK implementation detail)
**/node_modules/@anthropic-ai/claude-agent-sdk/cli.js
```

#### Verification

```bash
# Full build + package:
nx build ptah-extension-vscode
nx package ptah-extension-vscode

# Check .vsix size:
ls -la dist/apps/ptah-extension-vscode/*.vsix
# Should be significantly smaller

# Verify no "suspicious content":
# Try publishing to marketplace (or use --dry-run if available):
cd dist/apps/ptah-extension-vscode && npx @vscode/vsce ls
# Check for any warnings about obfuscated or suspicious content

# Try installing the .vsix locally:
code --install-extension dist/apps/ptah-extension-vscode/*.vsix
# Verify extension activates and works
```

---

### Phase 8: Quality Gates and CI Verification

**Goal**: Run all quality gates, update CI workflows if needed, verify everything works end-to-end.

**Dependencies**: Phase 7 complete

#### Verification Commands

```bash
# 1. Type checking:
npm run typecheck:all

# 2. Linting:
npm run lint:all

# 3. Tests:
npm run test:all

# 4. Full build:
npm run build:all

# 5. Extension packaging:
nx package ptah-extension-vscode

# 6. Electron packaging:
npm run electron:package

# 7. Manual testing matrix:
# - Start VS Code extension (F5)
# - Open a workspace
# - Verify sidebar loads
# - Start a chat session with Claude
# - Run agent setup wizard
# - Verify workspace analysis
# - Test agent orchestration (Gemini, Copilot, Codex CLI agents)
# - Test MCP server (execute_code)
# - Test session analytics dashboard
# - Start Electron app
# - Verify same feature set works
```

#### CI Workflow Changes

Check these CI files for webpack references:

```bash
# Check CI workflows:
grep -r 'webpack' .github/workflows/ || echo "No webpack references in CI"
```

Update any CI workflows that reference webpack builds.

---

## Risk Assessment

### High Risk

| Risk                                                            | Impact                                    | Mitigation                                              |
| --------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Missing `@inject()` decorator causes runtime DI failure         | Extension crashes on activation           | Phase 0 verification: build + test + manual F5 testing  |
| tree-sitter native bindings fail in ESM                         | AST parsing breaks, setup wizard degrades | Use `createRequire()` pattern, test extensively         |
| VS Code marketplace still rejects .vsix                         | Can't publish                             | Test with `vsce ls` and local install before publishing |
| `@anthropic-ai/claude-agent-sdk` doesn't work when externalized | Chat completely broken                    | Test SDK import in ESM context separately               |

### Medium Risk

| Risk                                                        | Impact                               | Mitigation                                             |
| ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `__dirname` polyfill resolves wrong path in bundled context | Template loading fails               | Test template-storage.service.ts specifically          |
| Electron preload script incompatible with ESM               | Electron IPC broken                  | Electron preload may need to stay CJS                  |
| npm dependencies not all ESM-compatible                     | Runtime errors for specific features | Externalize + test each dependency                     |
| esbuild doesn't handle some TypeScript patterns             | Build failure                        | esbuild is already used for all libraries, risk is low |

### Low Risk

| Risk                       | Impact          | Mitigation                                              |
| -------------------------- | --------------- | ------------------------------------------------------- |
| Build speed regression     | Slower dev loop | esbuild is 10-100x faster than webpack -- very unlikely |
| CI pipeline changes needed | Blocked publish | Check CI early, changes are typically minor             |

---

## Rollback Plan

### Per-Phase Rollback

Each phase is independently revertible via git:

- **Phase 0**: `git revert` the inject decorator commits. No build changes.
- **Phase 1**: Set `emitDecoratorMetadata: true` back in tsconfig files.
- **Phase 2**: `git revert` the require-to-import changes.
- **Phase 3**: Revert project.json to webpack target, restore webpack.config.js from git.
- **Phase 4**: Same as Phase 3 for Electron.
- **Phase 5**: Change format back to CJS, revert \_\_dirname changes, revert package.json main field.
- **Phase 6**: Restore webpack configs from git.
- **Phase 7**: Revert package.json engine bump.

### Full Rollback

```bash
# If everything goes wrong, reset to the commit before migration started:
git log --oneline  # Find the pre-migration commit
git reset --soft <pre-migration-commit>  # Keep changes in working tree for reference
```

### Branch Strategy

All work should be done on the `feature/esm-esbuild-migration` branch. Each phase should be a separate commit (or group of commits) so individual phases can be reverted independently.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in TypeScript backend code and build configuration
- No UI/frontend component changes
- Deep understanding of Node.js module systems (CJS vs ESM) required
- DI container and tsyringe expertise needed
- Build tooling (esbuild, Nx) knowledge required

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 12-16 hours across all phases

**Breakdown**:

- Phase 0 (Fix DI injections): 2-3 hours (many files, careful verification)
- Phase 1 (Disable metadata): 0.5 hours (simple config change + verification)
- Phase 2 (Fix code patterns): 1-2 hours
- Phase 3 (esbuild for vscode): 3-4 hours (most complex -- new build config)
- Phase 4 (esbuild for electron): 2-3 hours (replicate Phase 3 pattern)
- Phase 5 (ESM output): 2-3 hours (format switch + \_\_dirname fixes)
- Phase 6 (Cleanup): 1 hour
- Phase 7 (Manifest + packaging): 1-2 hours
- Phase 8 (Quality gates): 1-2 hours

### Files Affected Summary

**CREATE**:

- `apps/ptah-extension-vscode/esbuild.config.mjs` (if standalone config needed; may not be needed with Nx inline config)

**MODIFY** (high-touch):

- `apps/ptah-extension-vscode/project.json` -- webpack --> esbuild
- `apps/ptah-electron/project.json` -- webpack --> esbuild
- `apps/ptah-extension-vscode/package.json` -- engine bump, main field
- `apps/ptah-extension-vscode/tsconfig.app.json` -- ESM settings
- `apps/ptah-electron/tsconfig.app.json` -- ESM settings, remove emitDecoratorMetadata
- `tsconfig.base.json` -- emitDecoratorMetadata: false
- ~15 workspace-intelligence service files -- add @inject() decorators
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` -- remove new Function() hack
- `libs/backend/workspace-intelligence/src/ast/tree-sitter-parser.service.ts` -- createRequire()
- `libs/backend/agent-generation/src/lib/services/template-storage.service.ts` -- \_\_dirname fix
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` -- require() to import
- `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` -- require() to import
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts` -- require() to import
- `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts` -- update comments
- `libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts` -- createRequire()
- `apps/ptah-extension-vscode/src/main.ts` -- require() to import
- `apps/ptah-electron/src/main.ts` -- \_\_dirname fix
- `apps/ptah-electron/src/windows/main-window.ts` -- \_\_dirname fix
- `apps/ptah-extension-vscode/.vscodeignore` -- exclude cli.js
- All 11 backend library `project.json` files -- format: cjs -> esm (optional)

**DELETE**:

- `apps/ptah-extension-vscode/webpack.config.js`
- `apps/ptah-electron/webpack.config.js`
- `apps/ptah-electron/webpack.preload.config.js` (if it exists)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All `@inject()` tokens exist**: Every TOKEN used in the new decorators must be defined in `libs/backend/vscode-core/src/di/tokens.ts` or `libs/backend/platform-core/src/index.ts`
2. **Token-to-service registration matches**: Every `@inject(TOKEN_X)` must have a corresponding `container.registerSingleton(TOKEN_X, ServiceClass)` in the DI register files
3. **esbuild external list is complete**: Every npm package imported anywhere in the bundled code must be either bundled (our workspace libs) or externalized (in the external list)
4. **tree-sitter native bindings load correctly**: Test AST parsing after ESM switch
5. **SDK dynamic import works**: Test chat session creation after externalization
6. **Electron vscode shim resolves**: Verify tsconfig paths work for the shim in esbuild context
7. **Template path resolution works**: Verify template-storage.service.ts finds templates after \_\_dirname change
8. **VSIX size is reasonable**: Should be under 5MB without bundled SDK (vs 15MB+ before)
9. **No "suspicious content" error**: Verify with `vsce ls` before attempting marketplace publish
