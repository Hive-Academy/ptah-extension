# TASK_2025_232: Bundle SDK Dependencies — Remove Externals, Minify for Marketplace

## User Request

The Claude Agent SDK, Copilot SDK, and Codex SDK are marked as `external` in esbuild, which means they ship as raw unminified `node_modules/` in the VSIX. This causes:

1. **Users asked to install SDKs** — Runtime resolution (`resolveAndImportSdk`) fails because `node_modules/` wasn't properly included in previous VSIX builds
2. **Marketplace scanner flags** — 3237 unminified JS files in `node_modules/` (56MB uncompressed) triggers "suspicious content" warnings
3. **Bloated VSIX** — 12.68 MB with `node_modules/` vs 4.3 MB without
4. **Previous suspension** — VS Code Marketplace previously suspended the extension for similar issues

## Strategy

- **Type**: DEVOPS / REFACTORING
- **Workflow**: Partial (Architect -> Team-Leader -> Developers)
- **Complexity**: Medium

## Goal

Remove `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`, and `@openai/codex-sdk` from the `external` array in esbuild config so they get **bundled and minified into `main.mjs`**. This eliminates the `node_modules/` folder from the VSIX entirely.

Only `vscode` and native modules (`tree-sitter-*`) should remain external.

## Current State

### esbuild config (`apps/ptah-extension-vscode/project.json` lines 35-43):

```json
"external": [
  "vscode",
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
  "@openai/codex-sdk",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

### Why they were externalized (TASK_2025_197, TASK_2025_221):

- SDKs contain dynamic `import()` or `require()` that esbuild can't resolve
- SDKs had native module dependencies (now confirmed: only tree-sitter needs this)
- Claude SDK vendor/ dir is 43MB (CLI binary) — but `.vscodeignore` already strips this
- ESM/CJS interop issues at bundle time

### Runtime resolution pattern (`sdk-resolver.ts`, `sdk-module-loader.ts`):

- `SdkModuleLoader.resolveAndImportSdk()` — tries bare import, then walks CLI binary's node_modules tree
- `resolveAndImportSdk()` in llm-abstraction — same pattern for Copilot/Codex
- These exist ONLY because the SDKs are external. If bundled, they're dead code.

## Risks & Investigation Needed

1. **Dynamic imports inside SDKs** — If the SDKs use `require()` or `import()` to load optional sub-modules at runtime, esbuild can't bundle those. Need to check each SDK's source.

2. **Claude Agent SDK complexity** — It's the largest (47MB installed). It may have:
   - Native bindings (vendor/ dir)
   - Dynamic `require()` for optional features
   - Worker threads or subprocess spawning
   - The SDK's own `query()` function spawns a Claude Code subprocess — the JS API itself should be bundleable

3. **Copilot SDK** — Pure JS (258KB), likely bundleable without issues

4. **Codex SDK** — Small (80KB), ESM-only (`@openai/codex-sdk`), likely bundleable

5. **`pathToClaudeCodeExecutable` after bundling** — The CLI path resolution in `SdkModuleLoader` and `SdkAgentAdapter` may need adjustment since the SDK will be bundled, not in `node_modules/`

6. **Tree-shaking** — Bundling may pull in unused SDK code. Test final bundle size.

## Expected Outcome

```json
"external": [
  "vscode",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

- VSIX: ~4-5 MB (no `node_modules/`)
- All SDK JS APIs bundled + minified in `main.mjs`
- Runtime SDK resolution code (`resolveAndImportSdk`, `sdk-resolver.ts`) becomes dead code — can be removed or kept as fallback
- `pathToClaudeCodeExecutable` still works (resolved from CLI detector, not from bundled SDK)
- Marketplace scanner happy (single minified bundle, no raw source)

## Key Files

- `apps/ptah-extension-vscode/project.json` — esbuild external config
- `apps/ptah-extension-vscode/.vscodeignore` — can be simplified if no node_modules
- `apps/ptah-extension-vscode/package.json` — dependencies section
- `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts` — runtime SDK resolution
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` — runtime SDK resolution
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts` — Copilot/Codex SDK usage
- Root `package.json` — `npm run package` script

## Packaging Flow (Current vs Target)

### Current (broken):

```
esbuild (externals) → main.mjs (4MB, no SDKs)
  + npm install --production → node_modules/ (56MB)
  + .vscodeignore strips binaries → VSIX (12.7MB, 3237 files)
  → Marketplace scanner flags unminified JS
```

### Target:

```
esbuild (no SDK externals) → main.mjs (~5MB, SDKs bundled + minified)
  + no node_modules needed → VSIX (~5MB, ~240 files)
  → Clean marketplace scan
```

## Verification Checklist

- [ ] `npm run build:all` succeeds
- [ ] `vsce package` produces VSIX without `--no-dependencies`
- [ ] VSIX < 6 MB
- [ ] No `node_modules/` folder in VSIX
- [ ] Extension activates in clean VS Code install
- [ ] Chat works (Claude Agent SDK query)
- [ ] Setup wizard analysis works (InternalQueryService)
- [ ] Ptah CLI agents work (PtahCliRegistry.spawnAgent)
- [ ] Copilot SDK provider works (if copilot CLI installed)
- [ ] Codex SDK provider works (if codex CLI installed)
- [ ] No marketplace scanner warnings on `vsce ls`
