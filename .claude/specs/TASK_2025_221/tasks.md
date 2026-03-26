# Development Tasks - TASK_2025_221: Migrate to esbuild + ESM

**Total Tasks**: 33 | **Batches**: 7 | **Status**: 7/7 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- All 11 backend libraries already use `@nx/esbuild:esbuild` -- confirmed in project.json files
- `emitDecoratorMetadata: true` is set in `tsconfig.base.json` line 8 -- confirmed
- Only VS Code extension + Electron app use webpack -- confirmed via project.json executor checks
- Quality services, AgentDiscoveryService, CommandDiscoveryService already have explicit `@inject()` -- confirmed by reading constructors
- ContextService already has explicit `@inject()` on all params -- confirmed (uses `@inject(LOGGER)`, `@inject(CONFIG_MANAGER)`, etc.)

### Risks Identified

| Risk                                                                                           | Severity | Mitigation                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__dirname` polyfill may resolve wrong path in bundled context for template-storage.service.ts | MEDIUM   | Developer must verify template path resolution from dist output directory. The DI container injects `templatesPath`, but default fallback uses `__dirname` relative path. |
| Electron preload script may be incompatible with ESM                                           | MEDIUM   | Electron preload runs in renderer sandbox -- may need to stay CJS. Developer must investigate `webpack.preload.config.js` and decide approach.                            |
| `@nx/esbuild:esbuild` may not support `outputFileName` for `.mjs` extension                    | MEDIUM   | Developer should verify NX esbuild executor options. May need post-build rename step.                                                                                     |
| tree-sitter native bindings with `createRequire()` in ESM bundle                               | LOW      | Standard pattern for native addons in ESM. tree-sitter is externalized so `createRequire` will find it in `node_modules`.                                                 |
| VS Code marketplace "suspicious content" may have other triggers beyond cli.js                 | LOW      | Test with `vsce ls` and local install before attempting publish.                                                                                                          |

### Edge Cases to Handle

- [ ] `FileRelevanceScorerService` has no constructor at all (pure computation) -- no change needed, but verify `@injectable()` still works without constructor
- [ ] `ContextSizeOptimizerService` has implicit params (`relevanceScorer`, `tokenCounter`) but also has `@inject` on others -- mixed pattern needs careful handling
- [ ] Electron `build-preload` target also uses webpack -- must be migrated or kept as CJS
- [ ] The `post-build-copy` target uses inline `require('fs')` in Node.js scripts -- these are Nx command scripts, NOT extension code, so they stay as-is
- [ ] `sdk-resolver.ts` `new Function()` hack must remain during CJS phase (Batches 1-4), only removed in Batch 5 when ESM output is active

---

## Batch 1: Fix Implicit DI Injections + Disable emitDecoratorMetadata (Phases 0-1)

**Status**: COMPLETE
**Commit**: 77f99dd2
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: None

### Task 1.1: Add explicit @inject() decorators to workspace-intelligence base and project-analysis services

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\ignore-pattern-resolver.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\project-detector.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\framework-detector.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\dependency-analyzer.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\project-analysis\monorepo-detector.service.ts`

**Spec Reference**: implementation-plan.md:143-217
**Pattern to Follow**: Any service that already has `@inject(TOKENS.LOGGER)` or `@inject(PLATFORM_TOKENS.*)` -- e.g., `context.service.ts:123-129`

**Quality Requirements**:

- Every undecorated constructor param MUST get an `@inject(TOKEN)` decorator
- Token names MUST match the registration in `libs/backend/workspace-intelligence/src/di/register.ts`
- Import `inject` from `tsyringe` and `TOKENS` from `@ptah-extension/vscode-core` (add to existing imports if not present)

**Implementation Details**:

1. **IgnorePatternResolverService** (lines 91-93): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService` and `@inject(TOKENS.PATTERN_MATCHER_SERVICE)` to `patternMatcher: PatternMatcherService`

2. **ProjectDetectorService** (lines 33-34): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService` (the `workspaceProvider` param already has `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)`)

3. **FrameworkDetectorService** (line 20): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService`

4. **DependencyAnalyzerService** (line 38): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService`

5. **MonorepoDetectorService** (lines 31-32): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService` (the `workspaceProvider` param already has `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)`)

---

### Task 1.2: Add explicit @inject() decorators to workspace-intelligence indexing, analysis, and context services

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\file-indexing\workspace-indexer.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\composite\workspace-analyzer.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\workspace\workspace.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context\context-orchestration.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-size-optimizer.service.ts`

**Spec Reference**: implementation-plan.md:143-217
**Pattern to Follow**: `context.service.ts:123-129` for fully-decorated constructor

**Quality Requirements**:

- Same as Task 1.1
- Verify each TOKEN name matches the `container.registerSingleton(TOKENS.X, Class)` call in `register.ts`

**Implementation Details**:

1. **WorkspaceIndexerService** (lines 68-73): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystemService`, `@inject(TOKENS.PATTERN_MATCHER_SERVICE)` to `patternMatcher`, `@inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)` to `ignoreResolver`, `@inject(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE)` to `fileClassifier`, `@inject(TOKENS.TOKEN_COUNTER_SERVICE)` to `tokenCounter` (the `fsProvider` and `workspaceProvider` params already have `@inject`)

2. **WorkspaceAnalyzerService** (lines 85-92): Add `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystemService`, `@inject(TOKENS.PROJECT_DETECTOR_SERVICE)` to `projectDetector`, `@inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)` to `frameworkDetector`, `@inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)` to `dependencyAnalyzer`, `@inject(TOKENS.WORKSPACE_SERVICE)` to `workspaceService`, `@inject(TOKENS.CONTEXT_SERVICE)` to `contextService`, `@inject(TOKENS.WORKSPACE_INDEXER_SERVICE)` to `indexer` (the `treeSitterParser`, `astAnalyzer`, `logger`, `workspaceProvider` params already have `@inject`)

3. **WorkspaceService** (lines 149-154): Add `@inject(TOKENS.PROJECT_DETECTOR_SERVICE)` to `projectDetector`, `@inject(TOKENS.FRAMEWORK_DETECTOR_SERVICE)` to `frameworkDetector`, `@inject(TOKENS.DEPENDENCY_ANALYZER_SERVICE)` to `dependencyAnalyzer`, `@inject(TOKENS.MONOREPO_DETECTOR_SERVICE)` to `monorepoDetector`, `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem` (the `workspaceProvider` param already has `@inject`)

4. **ContextOrchestrationService** (lines 219-220): Add `@inject(TOKENS.CONTEXT_SERVICE)` to `contextService` (the `dependencyGraph` and `contextSizeOptimizer` params already have `@inject`)

5. **ContextSizeOptimizerService** (lines 161-162): Add `@inject(TOKENS.FILE_RELEVANCE_SCORER)` to `relevanceScorer`, `@inject(TOKENS.TOKEN_COUNTER_SERVICE)` to `tokenCounter` (the `enrichmentService` and `logger` params already have `@inject`)

---

### Task 1.3: Add explicit @inject() decorators to workspace-intelligence AST and enrichment services

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\ast-analysis.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\context-analysis\context-enrichment.service.ts`

**Spec Reference**: implementation-plan.md:143-217
**Pattern to Follow**: Same as Task 1.1

**Quality Requirements**:

- Same as Task 1.1

**Implementation Details**:

1. **AstAnalysisService** (lines 71-73): Add `@inject(TOKENS.TREE_SITTER_PARSER_SERVICE)` to `parserService: TreeSitterParserService` (the `logger` param already has `@inject`)

2. **DependencyGraphService** (lines 86-88): Add `@inject(TOKENS.AST_ANALYSIS_SERVICE)` to `astAnalysis: AstAnalysisService`, `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService` (the `logger` param already has `@inject`)

3. **ContextEnrichmentService** (lines 54-57): Add `@inject(TOKENS.AST_ANALYSIS_SERVICE)` to `astAnalysis: AstAnalysisService`, `@inject(TOKENS.TOKEN_COUNTER_SERVICE)` to `tokenCounter: TokenCounterService`, `@inject(TOKENS.FILE_SYSTEM_SERVICE)` to `fileSystem: FileSystemService` (the `logger` and `workspaceProvider` params already have `@inject`)

---

### Task 1.4: Scan ALL other backend libraries for implicit DI injections

**Status**: COMPLETE
**Files**: All `@injectable()` classes across:

- `D:\projects\ptah-extension\libs\backend\vscode-core\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\template-generation\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\platform-core\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\platform-vscode\src\**\*.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\**\*.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\**\*.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\**\*.ts`

**Spec Reference**: implementation-plan.md:205-217

**Quality Requirements**:

- Grep for all `@injectable()` classes
- For each, check if constructor has params WITHOUT `@inject()`
- If found, add the appropriate `@inject(TOKEN)` decorator
- Report which files were clean and which needed fixes

**Implementation Details**:

- Search pattern: Find `@injectable()` class declarations, then check each constructor parameter for missing `@inject()` decorator
- The plan estimates "~10 services in workspace-intelligence" but we must verify EVERY library
- Most libraries outside workspace-intelligence likely already have explicit injection (465+ existing `@inject()` decorators across the codebase)

---

### Task 1.5: Disable emitDecoratorMetadata in tsconfig files

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\tsconfig.base.json`
- `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.app.json`

**Spec Reference**: implementation-plan.md:233-282
**Dependencies**: Tasks 1.1, 1.2, 1.3, 1.4 must be complete first

**Quality Requirements**:

- Change `"emitDecoratorMetadata": true` to `"emitDecoratorMetadata": false` in `tsconfig.base.json` (line 8)
- REMOVE the `"emitDecoratorMetadata": true` line from `apps/ptah-electron/tsconfig.app.json` entirely (it will inherit `false` from base)
- Keep `"experimentalDecorators": true` -- this is still needed for tsyringe `@inject()` and `@injectable()` decorators

**Verification**:

```bash
npx nx run-many -t build --skip-nx-cache
npx nx run-many -t typecheck --skip-nx-cache
```

---

**Batch 1 Verification**:

- All workspace-intelligence services have explicit `@inject(TOKEN)` on every constructor param
- All other backend libraries verified -- no remaining implicit injections
- `emitDecoratorMetadata: false` in tsconfig.base.json
- `emitDecoratorMetadata` removed from electron tsconfig.app.json
- Build passes: `npx nx run-many -t build --skip-nx-cache`
- Typecheck passes: `npx nx run-many -t typecheck --skip-nx-cache`

---

## Batch 2: Fix ESM-Incompatible Code Patterns (Phase 2)

**Status**: COMPLETE
**Commit**: dd1ad72d
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1 complete

### Task 2.1: Convert inline require() calls to top-level imports in orchestrator.service.ts, agent-session-watcher.service.ts, and claude-cli-path-resolver.ts

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\detector\claude-cli-path-resolver.ts`

**Spec Reference**: implementation-plan.md:297-335

**Quality Requirements**:

- Replace inline `require()` with top-level `import` statements
- Ensure the imported symbols are used correctly at their call sites
- No functional behavior change -- same modules, same APIs

**Implementation Details**:

1. **orchestrator.service.ts** (lines 1034-1035):
   - Add `import { existsSync } from 'fs';` and `import { join } from 'path';` at top of file
   - In `detectPackageManager()` method, replace `const fs = require('fs');` and `const path = require('path');` with usage of the top-level imports
   - Replace `fs.existsSync(...)` with `existsSync(...)` and `path.join(...)` with `join(...)`

2. **agent-session-watcher.service.ts** (line 464):
   - Add `import { homedir } from 'os';` at top of file
   - Replace `require('os').homedir()` with `homedir()`

3. **claude-cli-path-resolver.ts** (line 241):
   - Add `import { spawn } from 'child_process';` at top of file (if not already imported)
   - Remove inline `const { spawn } = require('child_process');`

---

### Task 2.2: Convert inline require() in main.ts to top-level import

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`

**Spec Reference**: implementation-plan.md:337-346

**Quality Requirements**:

- Replace `const { WebviewHtmlGenerator } = require('./services/webview-html-generator');` with static import
- Ensure the import resolves correctly (relative path from main.ts)

**Implementation Details**:

- Add `import { WebviewHtmlGenerator } from './services/webview-html-generator';` at top of file
- Remove the inline `require()` call (around line 98)
- If the `require()` was inside a function/conditional for lazy loading, the static import moves it to module load time -- this is acceptable since esbuild bundles everything anyway

---

### Task 2.3: Add TODO markers for changes deferred to later batches

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts`
- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-file-system-provider.ts`
- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter-parser.service.ts`

**Spec Reference**: implementation-plan.md:348-394

**Quality Requirements**:

- Do NOT change `sdk-resolver.ts` `new Function()` hack yet -- add a TODO comment only
- Do NOT change `electron-file-system-provider.ts` chokidar `require()` yet -- add a TODO comment only
- Do NOT change `tree-sitter-parser.service.ts` `require()` calls yet -- add a TODO comment only
- All three will be converted in Batch 5 when ESM output is active

**Implementation Details**:

- Add `// TODO: TASK_2025_221 Batch 5 - Replace with standard import() after ESM switch` above the `new Function()` in sdk-resolver.ts
- Add `// TODO: TASK_2025_221 Batch 5 - Replace with createRequire(import.meta.url) after ESM switch` above the `require('chokidar')` in electron-file-system-provider.ts
- Add `// TODO: TASK_2025_221 Batch 5 - Replace with createRequire(import.meta.url) after ESM switch` above the tree-sitter `require()` calls

---

### Task 2.4: Verify build and tests pass after require-to-import changes

**Status**: COMPLETE
**Dependencies**: Tasks 2.1, 2.2, 2.3

**Quality Requirements**:

- Run full build and confirm no regressions
- These are pure refactoring changes -- same behavior, different import syntax

**Verification**:

```bash
npx nx run-many -t build --skip-nx-cache
npx nx run-many -t test --skip-nx-cache
```

---

**Batch 2 Verification**:

- No inline `require()` calls remain for `fs`, `path`, `os`, `child_process`, or local modules
- TODO markers placed for sdk-resolver.ts, electron-file-system-provider.ts, tree-sitter-parser.service.ts
- Build passes: `npx nx run-many -t build --skip-nx-cache`
- Tests pass: `npx nx run-many -t test --skip-nx-cache`

---

## Batch 3: Replace webpack with esbuild for ptah-extension-vscode (Phase 3)

**Status**: COMPLETE
**Commit**: f52345f5
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2 complete

### Task 3.1: Replace webpack executor with esbuild in ptah-extension-vscode project.json

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json`

**Spec Reference**: implementation-plan.md:410-599

**Quality Requirements**:

- Replace `build-webpack` target with `build-esbuild` target using `@nx/esbuild:esbuild` executor
- Update `build` target to depend on `build-esbuild` instead of `build-webpack`
- Update `post-build-copy` target to depend on `build-esbuild` instead of `build-webpack`
- Keep `format: ["cjs"]` for now (ESM switch happens in Batch 5)
- REMOVE the `cli.js` asset copy entry (SDK will be externalized, not bundled)
- Include ALL npm packages in the `external` list (see plan for complete list)
- Set `bundle: true`, `thirdParty: false`, `platform: "node"`, `target: "node20"`
- Keep all existing asset entries EXCEPT the cli.js one
- Add `sourcemap: true` for development, `minify: true` for production

**Implementation Details**:

Replace the `build-webpack` target entirely with:

```json
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
      { "glob": "**/*", "input": "apps/ptah-extension-vscode/src/assets", "output": "assets" },
      { "glob": "**/*", "input": "apps/ptah-extension-vscode/assets/plugins", "output": "assets/plugins" },
      { "glob": "**/*", "input": "libs/backend/agent-generation/templates", "output": "templates" },
      { "glob": "package.json", "input": "apps/ptah-extension-vscode", "output": "." }
    ]
  },
  "configurations": {
    "development": { "sourcemap": true, "minify": false },
    "production": { "sourcemap": false, "minify": true }
  }
}
```

Update references in `build` and `post-build-copy` targets to use `build-esbuild`.

---

### Task 3.2: Verify esbuild resolves tsconfig path aliases correctly

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\tsconfig.app.json`

**Spec Reference**: implementation-plan.md:601-616

**Quality Requirements**:

- Verify that `tsconfig.app.json` has correct `module` and `moduleResolution` settings
- The `@nx/esbuild:esbuild` executor reads tsconfig paths for alias resolution
- All `@ptah-extension/*` aliases in `tsconfig.base.json` should be resolved by esbuild via tsconfig inheritance
- No standalone esbuild config file needed -- Nx inline config handles everything

**Implementation Details**:

- Check that `tsconfig.app.json` extends `./tsconfig.json` which extends `../../tsconfig.base.json`
- Verify the path aliases in `tsconfig.base.json` (lines 19-61) cover all workspace libraries
- No changes expected unless tsconfig is misconfigured

---

### Task 3.3: Build the VS Code extension with esbuild and verify output

**Status**: COMPLETE
**Dependencies**: Tasks 3.1, 3.2

**Quality Requirements**:

- Build must succeed: `npx nx build ptah-extension-vscode --skip-nx-cache`
- Output file `dist/apps/ptah-extension-vscode/main.js` must exist
- Output should be significantly smaller than the webpack output (no bundled SDK)
- No `cli.js` in the dist output directory
- Assets (templates, plugins, package.json) must be copied correctly

**Verification**:

```bash
npx nx build ptah-extension-vscode --skip-nx-cache
ls -la dist/apps/ptah-extension-vscode/main.js
ls dist/apps/ptah-extension-vscode/templates/
ls dist/apps/ptah-extension-vscode/assets/
```

---

### Task 3.4: Verify extension packaging works with esbuild output

**Status**: COMPLETE
**Dependencies**: Task 3.3

**Quality Requirements**:

- Package command succeeds: `npx nx package ptah-extension-vscode`
- `.vsix` file is created in `dist/apps/ptah-extension-vscode/`
- `.vsix` size should be noticeably smaller (no bundled 12MB cli.js)

**Verification**:

```bash
npx nx package ptah-extension-vscode
ls -la dist/apps/ptah-extension-vscode/*.vsix
```

---

### Task 3.5: Investigate and handle any esbuild-specific build issues

**Status**: COMPLETE
**Dependencies**: Task 3.3

**Quality Requirements**:

- If esbuild build fails, diagnose the issue (missing external, unresolved path, unsupported syntax)
- If any npm package needs to be added to the `external` list, add it
- If any workspace library alias is not resolving, fix the tsconfig path
- Document any workarounds needed

**Implementation Details**:

- This is a contingency task -- may result in no changes if build succeeds on first try
- Common issues: missing packages in external list, tree-sitter .node file handling, decorator metadata issues
- If `@nx/esbuild:esbuild` doesn't support the `esbuildOptions` inline config for decorators, check if `"experimentalDecorators": true` in tsconfig is sufficient

---

**Batch 3 Verification**:

- VS Code extension builds with esbuild: `npx nx build ptah-extension-vscode --skip-nx-cache`
- Output file exists and is reasonable size (1-3MB instead of 15MB)
- No cli.js in dist output
- Extension packages successfully: `npx nx package ptah-extension-vscode`
- All asset files present in dist

---

## Batch 4: Replace webpack with esbuild for ptah-electron (Phase 4)

**Status**: COMPLETE
**Commit**: e1fb8063
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3 complete

### Task 4.1: Replace webpack executor with esbuild in ptah-electron project.json (build-main target)

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\project.json`

**Spec Reference**: implementation-plan.md:649-751

**Quality Requirements**:

- Replace `build-main` target executor from `@nx/webpack:webpack` to `@nx/esbuild:esbuild`
- Use same external list as VS Code extension, plus `electron` and `electron-updater`
- Remove `vscode` from external (Electron uses vscode-shim via tsconfig alias)
- Keep `format: ["cjs"]` for now
- Keep all existing asset entries

**Implementation Details**:

Replace `build-main` target with esbuild equivalent:

```json
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
      { "glob": "**/*", "input": "apps/ptah-electron/src/assets", "output": "assets" },
      { "glob": "**/*", "input": "apps/ptah-extension-vscode/assets/plugins", "output": "assets/plugins" },
      { "glob": "**/*", "input": "libs/backend/agent-generation/templates", "output": "templates" },
      { "glob": "package.json", "input": "apps/ptah-electron", "output": "." },
      { "glob": "electron-builder.yml", "input": "apps/ptah-electron", "output": "." }
    ]
  },
  "configurations": {
    "production": { "sourcemap": false, "minify": true },
    "development": { "sourcemap": true, "minify": false }
  }
}
```

---

### Task 4.2: Migrate build-preload target from webpack to esbuild

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\project.json`
- `D:\projects\ptah-extension\apps\ptah-electron\webpack.preload.config.js` (read for reference)
- `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.preload.json` (read for reference)

**Spec Reference**: implementation-plan.md:781-784

**Quality Requirements**:

- Read the existing `webpack.preload.config.js` to understand what it does
- The preload script is typically small and simple (Electron IPC bridge)
- Replace with esbuild target OR keep as simple tsc compilation if no bundling needed
- Preload scripts may need to stay CJS (Electron sandbox requirement) -- investigate

**Implementation Details**:

- Read `apps/ptah-electron/src/preload.ts` to understand its dependencies
- Read `apps/ptah-electron/webpack.preload.config.js` to understand the current build
- If preload is simple (just Electron contextBridge + ipcRenderer), a basic esbuild config with `format: ["cjs"]` is fine
- If preload has no npm dependencies, consider using plain `tsc` instead of bundling
- Update the `build-preload` target in project.json accordingly

---

### Task 4.3: Verify Electron vscode-shim and vscode-lm-tools-shim resolve correctly

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\tsconfig.app.json`

**Spec Reference**: implementation-plan.md:753-778

**Quality Requirements**:

- Verify that `tsconfig.app.json` has path aliases for `vscode` pointing to the vscode-shim
- Verify `@ptah-extension/vscode-lm-tools` shim alias if present
- Esbuild uses tsconfig paths for alias resolution -- verify this works

**Implementation Details**:

- Read `apps/ptah-electron/tsconfig.app.json` to check current path aliases
- The `vscode` import in Electron code resolves to `apps/ptah-electron/src/shims/vscode-shim.ts`
- If path alias is in tsconfig, esbuild will resolve it automatically
- If not, add the necessary path aliases

---

### Task 4.4: Build Electron app with esbuild and verify output

**Status**: COMPLETE
**Dependencies**: Tasks 4.1, 4.2, 4.3

**Quality Requirements**:

- Build must succeed: `npx nx build ptah-electron --skip-nx-cache`
- Both `main.js` and `preload.js` must exist in dist output
- Assets, templates, package.json, electron-builder.yml must be copied

**Verification**:

```bash
npx nx build ptah-electron --skip-nx-cache
ls -la dist/apps/ptah-electron/main.js
ls -la dist/apps/ptah-electron/preload.js
ls dist/apps/ptah-electron/templates/
ls dist/apps/ptah-electron/assets/
```

---

### Task 4.5: Handle any Electron-specific esbuild issues

**Status**: COMPLETE
**Dependencies**: Task 4.4

**Quality Requirements**:

- Same as Task 3.5 but for Electron context
- Electron has additional concerns: native modules, preload script sandboxing, IPC
- If electron-updater or other Electron-specific packages cause issues, add them to externals

---

**Batch 4 Verification**:

- Electron main process builds with esbuild
- Preload script builds correctly
- All assets and configs copied to dist
- Build passes: `npx nx build ptah-electron --skip-nx-cache`

---

## Batch 5: Switch to ESM Output + Fix \_\_dirname + createRequire (Phase 5)

**Status**: COMPLETE
**Commit**: 68fb0481
**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 4 complete

### Task 5.1: Switch VS Code extension output to ESM format

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`

**Spec Reference**: implementation-plan.md:805-857

**Quality Requirements**:

- Change `"format": ["cjs"]` to `"format": ["esm"]` in the build-esbuild target
- Determine how to get `.mjs` output filename (check if `@nx/esbuild` supports `outputFileName` or if post-build rename needed)
- Update extension manifest `package.json`: change `"main": "./main.js"` to `"main": "./main.mjs"` (or `"main": "./main.js"` with `"type": "module"`)
- Bump VS Code engine: `"vscode": "^1.100.0"`

**Implementation Details**:

- Option A (preferred): Output as `main.mjs` -- signals ESM to Node.js without `"type": "module"`
- Option B: Output as `main.js` with `"type": "module"` in package.json
- If `@nx/esbuild` doesn't support output filename control, add a post-build rename command to the Nx target pipeline
- The engine bump to `^1.100.0` is required -- ESM extension support was added in VS Code 1.100

---

### Task 5.2: Fix \_\_dirname usages with ESM polyfill

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\template-storage.service.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\windows\main-window.ts`
- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`

**Spec Reference**: implementation-plan.md:860-904

**Quality Requirements**:

- Add `import { dirname } from 'path'; import { fileURLToPath } from 'url'; const __dirname = dirname(fileURLToPath(import.meta.url));` polyfill at top of each file
- This polyfill provides `__dirname` in ESM context, matching CJS behavior
- For template-storage.service.ts: verify the relative path `../../templates/agents` still resolves correctly from the esbuild bundle output directory
- For Electron files: these are the app entry point, so `import.meta.url` resolves to the bundled file in dist

**Validation Notes**:

- RISK: The template-storage.service.ts is a LIBRARY file bundled into the app. `import.meta.dirname` in the bundle will point to the dist output directory. The `../../templates/agents` relative path was computed from the original source location. In the bundle, templates are at `dist/apps/ptah-extension-vscode/templates/agents/`. Developer must verify the path math works from the bundled output location.
- If the default path doesn't work, the DI-injected `templatesPath` parameter should override it -- verify this is the case.

---

### Task 5.3: Fix tree-sitter require() with createRequire for ESM

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\workspace-intelligence\src\ast\tree-sitter-parser.service.ts`

**Spec Reference**: implementation-plan.md:906-921

**Quality Requirements**:

- Add `import { createRequire } from 'module';` at file top
- Add `const require = createRequire(import.meta.url);` before the tree-sitter require() calls
- Keep the existing `require('tree-sitter')`, `require('tree-sitter-javascript')`, `require('tree-sitter-typescript')` calls as-is
- The `createRequire()` creates a CJS-compatible require function that can load native .node addons
- Remove the TODO comment added in Batch 2

---

### Task 5.4: Fix chokidar require() and sdk-resolver new Function() hack

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\platform-electron\src\implementations\electron-file-system-provider.ts`
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts`

**Spec Reference**: implementation-plan.md:923-958

**Quality Requirements**:

1. **electron-file-system-provider.ts**:
   - Add `import { createRequire } from 'module';` and `const require = createRequire(import.meta.url);` at file top
   - Keep the existing `require('chokidar')` call (it's in a sync context, can't use `await import()`)
   - Remove the TODO comment added in Batch 2

2. **sdk-resolver.ts**:
   - Replace the `new Function('specifier', 'return import(specifier)')` with a plain `async function dynamicImport(specifier: string): Promise<unknown> { return import(specifier); }`
   - OR simply replace all `dynamicImport(...)` calls with direct `import(...)` at each call site
   - Remove all JSDoc comments referencing webpack-opaque imports
   - Remove the TODO comment added in Batch 2

---

### Task 5.5: Switch Electron app output to ESM format (if applicable)

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-electron\project.json`

**Spec Reference**: implementation-plan.md:805-810

**Quality Requirements**:

- Change `"format": ["cjs"]` to `"format": ["esm"]` for the `build-main` target
- Electron preload script MUST stay CJS (Electron sandbox requirement)
- Verify Electron main process supports ESM (Electron 28+ supports it)
- If Electron ESM causes issues, this task can be deferred -- the main goal is the VS Code extension

**Implementation Details**:

- The Electron `build-preload` target MUST keep `format: ["cjs"]` -- preload scripts run in a restricted context
- Only the main process (`build-main`) switches to ESM
- May need to update Electron package.json if it has a `"main"` field

---

### Task 5.6: Verify ESM build output and extension activation

**Status**: COMPLETE
**Dependencies**: Tasks 5.1-5.5

**Quality Requirements**:

- VS Code extension builds with ESM output
- Output file has `import` statements (not `require()`) at the top
- Extension packages into .vsix
- SDK is NOT bundled into the output
- .vsix size is significantly smaller

**Verification**:

```bash
npx nx build ptah-extension-vscode --skip-nx-cache
# Check output is ESM:
head -5 dist/apps/ptah-extension-vscode/main.mjs
# Verify SDK not bundled:
wc -c dist/apps/ptah-extension-vscode/main.mjs
# Package:
npx nx package ptah-extension-vscode
ls -la dist/apps/ptah-extension-vscode/*.vsix
```

---

**Batch 5 Verification**:

- VS Code extension outputs ESM (`.mjs` or `.js` with `"type": "module"`)
- All `__dirname` usages replaced with polyfill
- tree-sitter uses `createRequire()` for native bindings
- sdk-resolver.ts uses standard `import()` (no `new Function()` hack)
- chokidar uses `createRequire()` in Electron
- Extension packages and .vsix is smaller
- Electron builds (either ESM or CJS -- depends on investigation)

---

## Batch 6: Remove webpack configs + ESM hacks + update manifest + packaging (Phases 6-7)

**Status**: COMPLETE
**Commit**: 25e72caf
**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 5 complete

### Task 6.1: Delete webpack configuration files

**Status**: COMPLETE
**Files to DELETE**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\webpack.config.js`
- `D:\projects\ptah-extension\apps\ptah-electron\webpack.config.js`
- `D:\projects\ptah-extension\apps\ptah-electron\webpack.preload.config.js` (if it exists and was replaced)

**Spec Reference**: implementation-plan.md:1039-1044

**Quality Requirements**:

- Only delete webpack configs AFTER esbuild is verified working in Batches 3-5
- These files are no longer referenced by any project.json target

---

### Task 6.2: Clean up webpack-era comments and SDK bundling references

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-module-loader.ts`

**Spec Reference**: implementation-plan.md:1072-1083

**Quality Requirements**:

- Update comment on line 55-56: Change "Note: SDK is bundled (not externalized)" to "SDK is externalized, resolved from node_modules"
- Remove any other comments referencing webpack bundling behavior
- No functional code changes

---

### Task 6.3: Update .vscodeignore to exclude cli.js and reference esbuild

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\.vscodeignore`

**Spec Reference**: implementation-plan.md:1157-1196

**Quality Requirements**:

- Remove `webpack.config.js` from .vscodeignore (file no longer exists)
- Add `esbuild.config.mjs` if a standalone esbuild config was created
- Add exclusion for cli.js from node_modules: `**/node_modules/@anthropic-ai/claude-agent-sdk/cli.js`
- This ensures the .vsix does not contain the 12MB obfuscated cli.js

---

### Task 6.4: Update extension manifest for ESM and packaging

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`

**Spec Reference**: implementation-plan.md:1136-1155

**Quality Requirements**:

- Verify `"main"` field points to correct ESM output file (set in Task 5.1)
- Verify `"engines.vscode"` is `"^1.100.0"` (set in Task 5.1)
- Consider bumping version to `0.2.0` to mark the ESM migration
- Verify the `package` target in project.json still works with `@vscode/vsce`

---

### Task 6.5: Check if @nx/webpack can be removed from devDependencies

**Status**: COMPLETE (kept -- still in use by ptah-license-server)
**Files**:

- `D:\projects\ptah-extension\package.json` (root)

**Spec Reference**: implementation-plan.md:1098-1112

**Quality Requirements**:

- Search all project.json files for any remaining `@nx/webpack:webpack` executor usage
- If NO project uses webpack anymore, remove `@nx/webpack` and `webpack-cli` from root package.json devDependencies
- If the landing page or license server still uses webpack, keep it
- Run `npm install` after changes to update lockfile

**Implementation Details**:

```bash
# Check for remaining webpack usage:
grep -r "@nx/webpack" --include="project.json" .
```

---

**Batch 6 Verification**:

- Webpack config files deleted
- No webpack references in active project.json targets
- .vscodeignore excludes cli.js from node_modules
- Extension manifest updated for ESM
- Full clean build: `npx nx run-many -t build --skip-nx-cache`
- Package: `npx nx package ptah-extension-vscode`
- .vsix size is reasonable (no 12MB cli.js)

---

## Batch 7: Quality Gates + CI Verification (Phase 8)

**Status**: COMPLETE
**Commit 1**: 4b071b64 (fix: add missing runtime deps and unify SDK resolution pattern)
**Commit 2**: 02ebb54c (fix: remove competitor branding from extension metadata)
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 6 complete

### Task 7.1: Run all quality gates

**Status**: COMPLETE

**Quality Requirements**:

- All quality gates must pass:

```bash
npm run typecheck:all
npm run lint:all
npm run build:all
```

- Fix any linting issues introduced by the migration
- Fix any type errors introduced by ESM module resolution changes

---

### Task 7.2: Check CI workflows for webpack references

**Status**: COMPLETE
**Files**:

- `D:\projects\ptah-extension\.github\workflows\*.yml` (all workflow files)

**Spec Reference**: implementation-plan.md:1264-1271

**Quality Requirements**:

- Search all CI workflows for `webpack` references
- Update any workflow that explicitly references webpack builds
- Ensure the build/package/publish workflows work with esbuild output

**Implementation Details**:

```bash
grep -r "webpack" .github/workflows/ || echo "No webpack references in CI"
```

---

### Task 7.3: Verify extension packaging produces publishable .vsix

**Status**: COMPLETE
**Dependencies**: Tasks 7.1, 7.2

**Quality Requirements**:

- Full end-to-end: build -> package -> verify
- .vsix must not trigger "suspicious content" warning
- Test with `vsce ls` to check for warnings
- Verify .vsix can be installed locally: `code --install-extension *.vsix`

**Verification**:

```bash
# Full build:
npm run build:all
# Package:
npx nx package ptah-extension-vscode
# List contents:
cd dist/apps/ptah-extension-vscode && npx @vscode/vsce ls
# Check .vsix size:
ls -la dist/apps/ptah-extension-vscode/*.vsix
```

---

**Batch 7 Verification**:

- All quality gates pass (typecheck, lint, build)
- No webpack references in CI workflows (or updated if found)
- .vsix packages without "suspicious content" warning
- .vsix can be installed locally in VS Code
- Extension activates and basic features work

---

## Status Summary

| Batch | Name                                                   | Tasks | Status   |
| ----- | ------------------------------------------------------ | ----- | -------- |
| 1     | Fix DI Injections + Disable emitDecoratorMetadata      | 5     | COMPLETE |
| 2     | Fix ESM-Incompatible Code Patterns                     | 4     | COMPLETE |
| 3     | Replace webpack with esbuild (VS Code extension)       | 5     | COMPLETE |
| 4     | Replace webpack with esbuild (Electron)                | 5     | COMPLETE |
| 5     | Switch to ESM Output + Fix \_\_dirname + createRequire | 6     | COMPLETE |
| 6     | Remove webpack + Clean up + Update manifest            | 5     | COMPLETE |
| 7     | Quality Gates + CI Verification                        | 3     | COMPLETE |
