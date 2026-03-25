# Research Report: VS Code Extension ESM Support (March 2026)

## Executive Summary

**Key Finding**: VS Code officially added ESM extension support in **version 1.100 (April 2025)** for the Node.js extension host. Extensions can now use `"type": "module"` in package.json and native `import`/`export` statements. However, this feature has significant caveats that make adoption non-trivial for complex extensions like Ptah, particularly around tsyringe/reflect-metadata compatibility, bundler configuration, and the web worker extension host limitation.

**Recommendation**: Do NOT migrate Ptah to ESM extensions at this time. Continue bundling to CommonJS with webpack/esbuild. The benefits of native ESM (tree-shaking at the extension host level) are already achieved by bundling, and the risks from tsyringe/decorator-metadata incompatibility are severe.

**Confidence Level**: HIGH (based on 15+ primary sources including official VS Code release notes, Microsoft's sample extension, community adoption reports, and GitHub issue tracking)

---

## 1. VS Code ESM Support Status

### When Was It Introduced?

ESM extension support was introduced in **VS Code 1.100 (April 2025)**. The official release notes state:

> "The NodeJS extension host now supports extensions that use JavaScript-modules (ESM). All it needs is the `"type": "module"` entry in your extension's package.json file. With that, the JavaScript code can use `import` and `export` statements, including the special module `import('vscode')`."

### Stability Classification

- **Node.js Extension Host**: STABLE (supported since v1.100, April 2025)
- **Web Worker Extension Host**: NOT SUPPORTED (explicitly stated as having "technical challenges that need to be overcome first")
- **Real-world adoption**: Microsoft migrated their own "GitHub Issue Notebooks" extension to ESM as of v1.101 (May 2025), confirming production readiness for the Node.js host

### Timeline of Key Events

| Date     | Version | Event                                                            |
| -------- | ------- | ---------------------------------------------------------------- |
| Sep 2024 | 1.94    | VS Code core itself migrated to ESM (massive startup perf gains) |
| Apr 2025 | 1.100   | ESM extension support added for Node.js extension host           |
| May 2025 | 1.101   | First Microsoft-internal ESM extension (GitHub Issue Notebooks)  |
| Dec 2025 | 1.108   | ESM ASAR restore support added                                   |
| Mar 2026 | 1.112   | Current latest stable release; no further ESM changes noted      |

### Known Limitations

1. **Web Worker Extension Host**: ESM extensions do NOT work in the web worker extension host. Extensions targeting VS Code for Web (vscode.dev) must remain CommonJS or use dual builds.
2. **Node.js `require(esm)` Interception Bug** (Issue #285297, Dec 2025): When using `require(esm)` (Node.js's built-in ability to require ES modules), the mechanism VS Code uses to intercept the `vscode` module breaks. This affects testing frameworks like Mocha that use `require(esm)` internally.
3. **Testing Challenges**: `@vscode/test-cli` users are affected by the interception bug above. The workaround is to use `createRequire(import.meta.url)` to explicitly require the vscode module.

---

## 2. VS Code API Version Compatibility

### Current Extension Configuration (Ptah)

```json
{
  "engines": { "vscode": "^1.74.0" },
  "main": "./main.js"
}
```

### Required Minimum for ESM

```json
{
  "engines": { "vscode": "^1.100.0" },
  "type": "module",
  "main": "./extension.js"
}
```

The minimum VS Code version for ESM extensions is **1.100.0**. This is a significant jump from Ptah's current `^1.74.0` target.

### Impact Assessment

- **VS Code 1.74.0** was released in November 2022
- **VS Code 1.100.0** was released in April 2025
- Bumping to `^1.100.0` would drop support for users running VS Code versions older than April 2025
- As of March 2026, the latest stable VS Code is **1.112**. Most active VS Code users auto-update, so the practical impact of requiring 1.100+ is likely minimal

### Official Sample Extension Configuration

From [jrieken/vscode-esm-sample-extension](https://github.com/jrieken/vscode-esm-sample-extension):

```json
{
  "name": "dummy-esm2",
  "version": "0.0.1",
  "engines": { "vscode": "^1.100.0" },
  "type": "module",
  "main": "./extension.js",
  "activationEvents": [],
  "devDependencies": {
    "@types/vscode": "^1.98.0",
    "@types/node": "16.x"
  }
}
```

And the entry point:

```javascript
import { commands, window } from 'vscode';

export function activate(context) {
  let disposable = commands.registerCommand('dummy-esm2.helloWorld', function () {
    window.showInformationMessage('Hello World from dummy-esm2!');
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}
```

Note: In ESM mode, `vscode` can be imported directly with standard `import` syntax -- no special `import()` dynamic import required for the top-level module.

---

## 3. Extension Manifest Changes Required

### package.json Changes

| Field            | CommonJS (Current)                 | ESM (New)                              |
| ---------------- | ---------------------------------- | -------------------------------------- |
| `type`           | not set (defaults to `"commonjs"`) | `"module"`                             |
| `main`           | `"./main.js"`                      | `"./extension.js"` (or any `.js` file) |
| `engines.vscode` | `"^1.74.0"`                        | `"^1.100.0"` minimum                   |

### Alternative: .mjs Extension

Instead of setting `"type": "module"`, you can use `.mjs` file extensions for your entry point:

```json
{
  "main": "./extension.mjs"
}
```

This avoids changing the module resolution for the entire package, which can be useful for gradual migration.

### Hybrid Approach (Pre-1.100 Workaround)

For extensions that need to support both older VS Code versions and ES module dependencies, Jan Miksovsky documented a CJS wrapper approach:

1. Keep `"type": "commonjs"` in package.json
2. Create a thin `extension.cjs` entry point that uses `dynamic import()` to load `extension.mjs`
3. Pass the `vscode` reference via `globalThis` since the vscode module is only available to CJS modules in older VS Code versions
4. When ready to require 1.100+, delete the wrapper and switch to pure ESM

---

## 4. Known Caveats and Breaking Changes

### 4.1 `require()` Behavior

**In pure ESM mode (`"type": "module"`):**

- Top-level `require()` is NOT available
- You must use `import` statements or `dynamic import()` for all module loading
- To use `require()` for specific cases, you must create it explicitly:

```javascript
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const someModule = require('some-cjs-only-package');
```

**Critical caveat (Issue #285297):** Using `createRequire` to require the `vscode` module may not work correctly due to a Node.js module interception bug. The VS Code team is tracking this.

### 4.2 `__dirname` and `__filename`

These CommonJS globals do NOT exist in ESM. Replacements:

**Modern approach (Node.js 20.11+, which VS Code 1.100+ ships with):**

```javascript
// Direct replacements (no imports needed)
import.meta.dirname; // equivalent to __dirname
import.meta.filename; // equivalent to __filename
```

**Universal approach:**

```javascript
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

**Impact on Ptah:** The current `main.ts` uses `__dirname` only indirectly (via webpack config which is CJS anyway). The bundled output currently uses `__dirname` in 2 locations within the extension source. If migrating, these would need replacement.

### 4.3 tsyringe / reflect-metadata (CRITICAL RISK)

This is the **single biggest blocker** for Ptah's ESM migration.

**Current Ptah usage:**

- 638 occurrences of `@injectable`, `@inject()`, or `@singleton` across 171 files
- `reflect-metadata` is imported at the top of `main.ts` and `container.ts`
- The webpack config explicitly loads `reflect-metadata` as the FIRST entry point
- tsyringe relies on `emitDecoratorMetadata` TypeScript compiler option

**ESM Compatibility Issues:**

1. **esbuild does NOT support `emitDecoratorMetadata`**: esbuild explicitly refuses to implement this TypeScript feature. If Ptah switches from webpack+ts-loader to esbuild for building, tsyringe's automatic type-based injection breaks entirely. You would need to add explicit `@inject(TOKEN)` to every constructor parameter.

2. **reflect-metadata import timing**: In CommonJS, `import 'reflect-metadata'` at the top of the entry file runs synchronously before anything else. In ESM, import order is less deterministic for side-effect-only imports. The webpack config currently ensures reflect-metadata loads FIRST via the entry array -- this guarantee is harder to maintain in ESM.

3. **Dynamic require within tsyringe**: tsyringe internally uses patterns that may emit `require()` calls (or expect them to work), which fail in pure ESM mode with "Dynamic require of 'X' is not supported".

4. **Workaround for esbuild**: The `esbuild-shake-tsyringe-tree` plugin exists but is focused on tree-shaking, not full ESM compatibility. The recommended esbuild workaround is to add a banner:
   ```javascript
   banner: {
     js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);";
   }
   ```
   However, this is a hack that papers over the real issue.

**Conclusion on tsyringe**: With 638 decorator usages across 171 files, migrating away from tsyringe or refactoring to explicit token injection is a massive undertaking. This alone makes ESM migration impractical for Ptah in its current architecture.

### 4.4 Extension Activation Model

The VS Code extension activation model works the same in ESM:

- `activate()` must be exported (via `export function activate()`)
- `deactivate()` must be exported (via `export function deactivate()`)
- Activation events in package.json are unchanged
- The extension host awaits the `activate()` promise just as before

No breaking changes here.

---

## 5. Bundler Support

### Current Ptah Build Setup

- **Bundler**: Webpack 5 with ts-loader
- **Output format**: CommonJS (`libraryTarget: 'commonjs2'`)
- **Key behavior**: Bundles all `@ptah-extension/*` internal libraries and `@anthropic-ai/claude-agent-sdk` (which is ESM-only), externalizes other npm packages

### esbuild for ESM VS Code Extensions

The official VS Code documentation recommends esbuild over webpack for new extensions. The standard configuration:

```javascript
// For CommonJS output (recommended, current standard)
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
};

// For ESM output (if targeting ESM extension host)
const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  // Required for ESM with CJS dependencies:
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};
```

**esbuild limitations for Ptah:**

- Does NOT support `emitDecoratorMetadata` (breaks tsyringe auto-injection)
- This is a deliberate design decision by esbuild's author (Issue #257, explicitly marked as "won't fix")
- Would require either: (a) pre-compiling with tsc then bundling with esbuild, or (b) migrating away from decorator-based DI

### Webpack for ESM

Webpack can output ESM via:

```javascript
output: {
  library: { type: 'module' },
  module: true,
}
experiments: {
  outputModule: true,
}
```

However, `ts-loader` with `emitDecoratorMetadata: true` still works, so webpack remains the safer bundler for tsyringe-heavy codebases.

### Nx Executor Support

The `@nx/esbuild:esbuild` executor supports ESM output:

```json
{
  "executor": "@nx/esbuild:esbuild",
  "options": {
    "format": ["esm"],
    "platform": "node"
  }
}
```

By default, the Nx esbuild executor uses ESM format. It can also output both formats simultaneously: `"format": ["esm", "cjs"]`.

However, the same `emitDecoratorMetadata` limitation applies -- Nx's esbuild executor uses esbuild under the hood and does not support this TypeScript feature.

---

## 6. Comparative Analysis: Migration Options

| Approach                                | Effort    | Risk                     | Benefit                           | Recommended?                                    |
| --------------------------------------- | --------- | ------------------------ | --------------------------------- | ----------------------------------------------- |
| **Stay on CJS + Webpack** (current)     | None      | None                     | Stable, proven                    | YES (for now)                                   |
| **Switch to esbuild, keep CJS output**  | Medium    | Medium (tsyringe breaks) | Faster builds                     | Only if migrating away from tsyringe            |
| **Native ESM extension**                | Very High | Very High                | Tree-shaking at host level        | NO (tsyringe blocks this)                       |
| **Hybrid: CJS wrapper + ESM internals** | High      | Medium                   | Can use ESM-only deps natively    | Unnecessary -- webpack already handles ESM deps |
| **esbuild with tsc pre-compile**        | Medium    | Low                      | Fast bundling + decorator support | Worth evaluating separately                     |

---

## 7. Specific Impact on Ptah

### What Ptah Already Does Well

1. **ESM-only dependencies are already handled**: The webpack config bundles `@anthropic-ai/claude-agent-sdk` (ESM-only) into the CJS output. This works perfectly.
2. **Tree-shaking is already effective**: The webpack externals function selectively bundles/externalizes dependencies.
3. **Source code already uses ESM syntax**: All Ptah source files use `import`/`export` statements; TypeScript compiles these to CommonJS.

### What Would Break

1. **tsyringe** (638 decorator usages, 171 files) -- the decorator metadata pipeline is incompatible with pure ESM toolchains
2. **reflect-metadata load ordering** -- currently guaranteed by webpack entry array
3. **`__dirname` usage** -- 2 occurrences in extension source need replacement
4. **Test infrastructure** -- all 20+ spec files importing `reflect-metadata` would need updates
5. **`vscode` engine version** -- must bump from `^1.74.0` to `^1.100.0`

### What Would Improve (Marginally)

1. **Startup time**: Minimal gain -- the extension is already bundled into a single file
2. **Native ESM dependency handling**: Already handled by webpack bundling
3. **Future-proofing**: VS Code is moving toward ESM, but CJS will be supported indefinitely

---

## 8. Strategic Recommendation

### Short-term (Now - 6 months)

**Do nothing.** The current webpack + CJS setup works correctly, handles ESM-only dependencies, and is compatible with tsyringe's decorator requirements. There is no pressing need to migrate.

### Medium-term (6-12 months)

**Consider migrating from webpack to esbuild with tsc pre-compilation** for faster build times. This would involve:

1. Run `tsc` first to compile TypeScript (preserving `emitDecoratorMetadata`)
2. Run esbuild on the compiled JavaScript for bundling
3. Keep CJS output format
4. This gives you esbuild's speed while preserving tsyringe compatibility

### Long-term (12+ months)

**If and when TypeScript implements the [TC39 Decorator Metadata proposal](https://github.com/tc39/proposal-decorator-metadata)** (Stage 3), consider migrating from `emitDecoratorMetadata` (TS-specific) to standard decorator metadata. This would unblock esbuild and native ESM simultaneously. Monitor:

- TypeScript issue tracking standard decorators
- tsyringe's adoption of standard decorator metadata
- VS Code's web worker extension host ESM support

---

## Sources

### Official VS Code Documentation

- [VS Code 1.100 Release Notes (April 2025)](https://code.visualstudio.com/updates/v1_100) -- ESM extension support announcement
- [VS Code 1.101 Release Notes (May 2025)](https://code.visualstudio.com/updates/v1_101) -- Real-world ESM extension (GitHub Issue Notebooks)
- [VS Code 1.108 Release Notes (December 2025)](https://code.visualstudio.com/updates/v1_108) -- ESM ASAR restore
- [VS Code 1.112 Release Notes (March 2026)](https://code.visualstudio.com/updates/v1_112) -- Current latest stable
- [VS Code Bundling Extensions Guide](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [VS Code Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)

### Microsoft GitHub

- [Issue #130367: Enable consuming of ES modules in extensions](https://github.com/microsoft/vscode/issues/130367)
- [Issue #135450: Explore enabling ESM based extensions](https://github.com/microsoft/vscode/issues/135450)
- [Issue #285297: require(esm) breaks vscode module interception](https://github.com/microsoft/vscode/issues/285297)
- [jrieken/vscode-esm-sample-extension](https://github.com/jrieken/vscode-esm-sample-extension) -- Official ESM sample
- [PR #246726: Migrate github-extension to ESM](https://github.com/microsoft/vscode/pull/246726)
- [tsyringe Issue #180: Usage without Reflect](https://github.com/microsoft/tsyringe/issues/180)

### esbuild

- [esbuild Issue #257: Support emitting decorator metadata](https://github.com/evanw/esbuild/issues/257) -- Explicitly won't fix
- [esbuild Issue #3680: Warning for emitDecoratorMetadata](https://github.com/evanw/esbuild/issues/3680)

### Community & Analysis

- [Jan Miksovsky: Writing a VS Code extension in ES modules (March 2025)](https://jan.miksovsky.com/posts/2025/03-17-vs-code-extension)
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [DevClass: VS Code migration to ESM (October 2024)](https://devclass.com/2024/10/14/vs-code-migration-to-ecmascript-modules-massively-improves-startup-performance-but-extensions-left-behind-for-now/)
- [Nx esbuild Executor Documentation](https://nx.dev/docs/technologies/build-tools/esbuild/executors)
- [ES Modules \_\_dirname Fix Guide](https://devin-rosario.medium.com/es-modules-dirname-fix-complete-guide-2025-b068a076712c)
