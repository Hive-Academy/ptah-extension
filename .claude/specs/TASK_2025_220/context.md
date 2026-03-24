# TASK_2025_220: Nx Build Pipeline Refactoring

## Task Type: REFACTORING

## Workflow: Partial (Architect -> Team-Leader -> QA)

## Created: 2026-03-24

## User Request

Refactor the Nx build pipelines for both `ptah-extension-vscode` and `ptah-electron` to use proper Nx configurations instead of fragile manual copy scripts. Both apps need well-defined build pipelines that handle asset copying, package.json generation, and all packaging prerequisites through Nx's built-in capabilities rather than ad-hoc Node.js copy scripts.

## Current Problems

### 1. ptah-extension-vscode

- `post-build-copy` target has 8 inline Node.js commands doing `fs.cpSync` / `fs.copyFileSync`
- `package` target has 5 more inline commands for `.vscodeignore`, `README.md`, `LICENSE`, `npm install`, `vsce package`
- No `generatePackageJson` — manually copies source `package.json` which includes dev metadata
- Webpack externalizes many packages, then `npm install --omit=dev` in dist reinstalls them — bloated VSIX (50MB node_modules, 1898 files)

### 2. ptah-electron

- `copy-assets.js` script (124 lines) handles: icons, plugins, templates, package.json, electron-builder.yml
- `copy-renderer.js` script copies webview output
- `package.json` wasn't being copied to dist (just fixed with a script addition)
- `electron-builder.yml` wasn't being copied (just fixed with a script addition)
- Build pipeline relies on manual `dependsOn` ordering between scripts

### 3. CI Workflows

- `publish-extension.yml` — no version bumping (just fixed), runs from dist folder
- `publish-electron.yml` — `--config` path was wrong relative to `--project` (just fixed)

## Goals

1. Replace inline `node -e` commands and copy scripts with Nx `assets` configuration
2. Use Nx's `generatePackageJson` where applicable for clean dependency management
3. Ensure `dependsOn` chains are correct and explicit
4. Reduce VSIX size by properly managing what goes into dist
5. Make the build pipeline self-documenting through proper Nx configuration
6. Keep CI workflows aligned with the new Nx targets

## Constraints

- Must not break local development (`nx serve`, F5 debug, `nx serve ptah-electron`)
- Must not break CI publishing (both extension and electron)
- Both apps have cross-project dependencies (webview build, plugin assets, templates)
- Webpack externals strategy for vscode extension must be preserved
- Electron build has platform-specific packaging (win/mac/linux)
