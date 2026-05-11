# ptah-extension-vscode

[Back to Main](../../CLAUDE.md)

## Purpose

The VS Code extension host application. Activates inside the extension host process, wires the tsyringe DI graph, runs a license gate, registers RPC handlers, and hosts the Angular webview SPA built from `apps/ptah-extension-webview`.

## Boundaries

**Belongs here**: extension activation/deactivation, the phased DI bootstrap, VS Code-specific command/provider registration, webview HTML generation, the VS Code webview event queue.
**Does NOT belong**: business logic (lives in `libs/backend/*`), Angular UI (lives in `apps/ptah-extension-webview`), shared RPC handler classes (`libs/backend/rpc-handlers`), Electron-only glue.

## Entry Points

- `src/main.ts` — `activate()` / `deactivate()` exported to VS Code. Imports `reflect-metadata` first, then delegates to `bootstrapVscode` -> `wireRuntimeVscode` -> `registerPostInit`.
- `package.json` (at app root) — VS Code extension manifest copied into the VSIX by `build-esbuild`.

## Key Wiring

- `src/di/container.ts` — thin orchestrator. `DIContainer.setupMinimal()` runs phase-0 + phase-1-minimal for the license gate; `DIContainer.setup()` runs phases 0-4. Phases live in sibling files `phase-0-platform.ts` through `phase-4-app.ts`.
- `src/activation/bootstrap.ts` — minimal DI -> Sentry init -> license verify (blocking) -> full DI -> logger + RPC registration. Calls `fixPath()` from `@ptah-extension/agent-sdk` on Linux/macOS so GUI-launched VS Code finds nvm/npm-global bins.
- `src/activation/wire-runtime.ts`, `src/activation/post-init.ts` — finishes IPC, plugin activation, CLI/skill sync, agent adapters.
- `src/activation/license-gate.ts` — blocks activation when license invalid.
- `src/services/rpc/`, `src/providers/angular-webview.provider.ts`, `src/services/webview-html-generator.ts` — webview boot + RPC bridge.
- `src/commands/` — `license-commands.ts`, `settings-commands.ts` register VS Code commands.
- Deactivation cleans up `SkillJunctionService` junctions, `PtahCliRegistry` adapters, and flushes Sentry.

## Library Dependencies

- `@ptah-extension/vscode-core` — DI tokens (`TOKENS`), Logger, LicenseService, SentryService
- `@ptah-extension/agent-sdk` — `SDK_TOKENS`, `PtahCliRegistry`, `SkillJunctionService`, `fixPath`
- `@ptah-extension/persistence-sqlite` — `PERSISTENCE_TOKENS`, `SqliteConnectionService`
- Backend feature libs registered through the phase modules: `rpc-handlers`, `workspace-intelligence`, `agent-generation`, `llm-abstraction`, `vscode-lm-tools`, `platform-core`, `platform-vscode`

## Build & Run

- `nx build ptah-extension-vscode` — chains `build-esbuild` -> `post-build-copy` (runs `scripts/copy-wasm.js` and `scripts/copy-webview.js`).
- `nx serve ptah-extension-vscode` — dev build then `@nx/js:node`.
- `nx run ptah-extension-vscode:package` — runs `pre-package` (copies `.vscodeignore` + repo `README.md`) then `npx @vscode/vsce package` inside `dist/apps/ptah-extension-vscode`.
- Bundle output: `dist/apps/ptah-extension-vscode/main.mjs` (ESM with `createRequire` banner, externals `vscode`). Production config injects the Sentry DSN via `__SENTRY_DSN__` define.

## Guidelines

- Never inline tsyringe registrations in `main.ts`. Add to the correct `phase-N-*.ts` and gate with `isRegistered`.
- `reflect-metadata` MUST be the first import in any file that uses tsyringe decorators (see `src/main.ts:2`).
- License gate is blocking — anything that should run regardless of license state belongs in `bootstrapVscode` before `handleLicenseBlocking`.
- New RPC namespaces require both the type declaration AND the runtime `ALLOWED_METHOD_PREFIXES` entry (see user memory note).

## Marketplace / Deployment Notes

Read the root `CLAUDE.md` "VS Code Marketplace Publishing Rules" section before any publish. Hard rules enforced here:

- The VSIX must NOT contain `LICENSE.md`, `assets/plugins/**`, `templates/**`, or any `*.py` file (see `.vscodeignore`).
- README copy in `pre-package` uses the repo root `README.md` — keep it free of `copilot|codex|claude|openai|anthropic` strings.
- Plugins and templates ship from GitHub via `ContentDownloadService` at runtime; never re-add them as build assets in `project.json`.
- Bundled JS in `main.mjs` is NOT scanned, so trademarked strings there are safe.
