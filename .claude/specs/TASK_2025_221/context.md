# Task Context - TASK_2025_221

## User Request

Migrate the entire Ptah extension monorepo from webpack+CommonJS to esbuild+ESM. Fix the VS Code Marketplace "suspicious content" publishing error. Also run full Nx migrations and npm package updates.

## Task Type

REFACTORING

## Complexity Assessment

Complex (>8h) - monorepo-wide migration affecting all apps and libraries

## Strategy Selected

Partial: Architect -> Team-Leader -> Developers -> QA

## Conversation Summary

### Problem

- VS Code Marketplace rejects extension v0.1.3 with "Extension validation error: Your extension has suspicious content"
- Root cause: webpack forcibly bundles `@anthropic-ai/claude-agent-sdk` (ESM-only), including its 12MB obfuscated `cli.js`
- The webpack `externals` config has a special case that bundles the Claude SDK while Copilot/Codex SDKs use a `new Function('specifier', 'return import(specifier)')` hack to bypass webpack
- Current architecture: webpack + ts-loader + CommonJS output (`libraryTarget: 'commonjs2'`)

### Research Findings

- VS Code 1.100+ (April 2025) supports ESM extensions natively; latest is 1.112
- esbuild does NOT support `emitDecoratorMetadata` (issue #257, won't fix)
- However, the codebase is **95% esbuild-compatible already** -- 465+ `@inject(TOKEN)` explicit decorators
- Only ~10 services in `workspace-intelligence` use implicit type-based injection (need ~30 params fixed)
- 4 `__dirname` usages and 4 inline `require()` calls need ESM migration
- tree-sitter native bindings use `require()` -- need investigation
- No `@singleton()` decorators, no `delay()` for circular deps, no child containers

### Migration Path

1. Fix ~30 implicit tsyringe injections in workspace-intelligence (add explicit `@inject(TOKEN)`)
2. Disable `emitDecoratorMetadata` in tsconfig
3. Switch extension app bundler from webpack+ts-loader to esbuild
4. Switch output format to ESM
5. Bump vscode engine to `^1.100.0`, add `"type": "module"`
6. Fix `__dirname` usages and inline `require()` calls
7. Remove all ESM workarounds (webpack-opaque dynamic imports, SDK bundling exception, cli.js copy)
8. Run full Nx migration and npm package updates
9. Verify extension builds, packages, publishes without "suspicious content" error
10. Run quality gates

### Key Constraints

- tsyringe stays (no DI framework migration needed)
- reflect-metadata still required (but no metadata emission needed)
- tree-sitter native bindings may need special handling
- Electron app also uses webpack -- needs parallel migration
- 10 backend libraries already use `@nx/esbuild` with CJS format
- Frontend libraries use Angular CLI (unaffected)

### Codebase Stats

- 173 `@injectable()` decorators
- 465+ `@inject()` decorators
- 247 `container.register()` calls
- 8 DI registration files
- 10 backend libraries + 2 apps need bundler changes
- Current Nx version: 21.4.1 (with @nx/webpack 22.1.3, @nx/esbuild 22.1.3)

## Related Tasks

- TASK_2025_197: Remove copilot-sdk/codex-sdk from bundle (prior ESM workaround)
- TASK_2025_194: SDK cli.js CI path fix (prior related fix)
- TASK_2025_220: Nx Build Pipeline Refactoring (related, overlapping concerns)

## Created

2026-03-25
