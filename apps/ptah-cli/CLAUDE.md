# ptah-cli (`@hive-academy/ptah-cli`)

[Back to Main](../../CLAUDE.md)

## Purpose

Headless Node CLI that hosts the full Ptah agent backend in-process and exposes it via a `commander` subcommand router and a JSON-RPC 2.0 stdio session (`ptah interact`). No UI shell — the legacy Ink/React TUI is gone. Designed to be driven by external A2A bridges (OpenClaw/NemoClaw), CI, and scripted refactors.

## Boundaries

**Belongs here**: argv parsing + router, JSON-RPC server / encoder / NDJSON I/O, push-event pipe, approval + chat bridges, OAuth URL openers, CLI DI bootstrap, CLI-specific platform adapters, the `vscode` module shim, CLI RPC method registration.
**Does NOT belong**: React/Ink UI (deleted), business logic (backend libs), Anthropic-compatible HTTP proxy (out of scope here).

## Entry Points

- `src/main.ts` — installs SIGINT/SIGTERM handlers (exit 130/143), runs `checkSchemaVersionSkew()` against `PTAH_HOST_SCHEMA_VERSION`, then `buildRouter().parseAsync(process.argv)`. Calls `fixPath()` for nvm/npm-global PATH repair on Linux/macOS.
- `src/cli/router.ts` — commander wiring; declares every subcommand and `GlobalOptions`.

## Key Wiring

- `src/di/container.ts` + `src/cli/bootstrap/with-engine.ts` — `withEngine({ mode, requireSdk })`. `mode: 'minimal'` skips RPC handler phase (used by pre-bootstrap config commands). `requireSdk: false` skips SDK init for chicken-and-egg auth flows.
- `src/transport/cli-message-transport.ts` — in-process `transport.call(method, params)`.
- `src/transport/cli-webview-manager-adapter.ts` — push-event `EventEmitter`.
- `src/transport/cli-fire-and-forget-handler.ts` — permission/question response handler.
- `src/services/cli-rpc-method-registration.service.ts` — registers shared RPC handlers against the in-process transport (with a CLI-specific exclusion list).
- `src/cli/jsonrpc/` — `server.ts`, `encoder.ts`, `types.ts` (`JSONRPC_SCHEMA_VERSION`, `PtahNotification`, `PtahErrorCode`, `ExitCode`).
- `src/cli/io/` — NDJSON `stdin-reader` / `stdout-writer` (Windows-pipe drain aware).
- `src/cli/session/` — `chat-bridge.ts` (turn semantics on top of fire-and-forget chat RPCs), `approval-bridge.ts` (honors `PTAH_AUTO_APPROVE=true`).
- `src/cli/oauth/` — JSON-RPC + stderr URL openers.
- `src/cli/wizard/phase-runner.ts` — composable Setup Wizard phase orchestration.
- `src/shims/vscode-shim.ts` — minimal `vscode` shim; `tsconfig.build.json` maps the `vscode` module to it.

## Library Dependencies

- `@ptah-extension/platform-core`, `@ptah-extension/platform-cli`
- `@ptah-extension/vscode-core`, `@ptah-extension/agent-sdk`, `@ptah-extension/agent-generation`, `@ptah-extension/llm-abstraction`, `@ptah-extension/vscode-lm-tools`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/rpc-handlers`, `@ptah-extension/shared`
- External: `commander`, `tsyringe`, `reflect-metadata`, plus the three AI provider SDKs and the same heavy externals as Electron (better-sqlite3, sqlite-vec, web-tree-sitter, croner, ulid, grammy, discord.js, @slack/bolt, ffmpeg-static, nodejs-whisper, @xenova/transformers, etc.).

## Build & Run

- `nx build ptah-cli` — esbuild ESM bundle to `dist/apps/ptah-cli/main.mjs` with `createRequire` + `__filename` + `__dirname` banner so the ESM bundle behaves like CJS for `require()`-using deps. `deleteOutputPath: true`.
- `nx dev ptah-cli` — `npx tsx apps/ptah-cli/src/main.ts`.
- `nx serve ptah-cli` — build then `node dist/apps/ptah-cli/main.mjs`.
- `nx test ptah-cli` (jest); `nx run ptah-cli:e2e` (separate `jest.e2e.config.cjs`, `--runInBand`).
- `nx run ptah-cli:publish:dry-run` / `:publish` — runs from `dist/apps/ptah-cli`. Distribution is gated by the `publish-cli` GitHub workflow on `cli-v*` tag flow.
- `package.json` declares `"bin": { "ptah": "./main.mjs" }`. Assets copied into dist: `package.json`, `README.md`, `docs/jsonrpc-schema.md`, `docs/migration.md`, repo-root `LICENSE.md`.

## Guidelines

- Default output is NDJSON JSON-RPC 2.0. Never assume `process.stdout.isTTY`. `--human` opts into a pretty formatter; respect `NO_COLOR`, `FORCE_COLOR`, `PTAH_NO_TTY=1`.
- Always `await` stdout drain before `process.exit` in JSON-RPC paths (Windows pipes are async). `StdoutWriter` handles this; the `interact` shutdown explicitly races drain against a 5s cap.
- Approval-gated requests time out at 5 minutes -> exit code 3 (`auth_required`). `PTAH_AUTO_APPROVE=true` bypasses for unattended runs.
- `ptah agent-cli` only accepts `--cli glm` and `--cli gemini`; the allowlist ignores `PTAH_AGENT_CLI_OVERRIDE`.
- Auth/config bootstrap commands pass `requireSdk: false` to `withEngine` so they can run before the SDK is configured.
- New RPC namespaces need entries in both `rpc.types.ts` AND `rpc-handler.ts ALLOWED_METHOD_PREFIXES` (see user memory).

## JSON-RPC Schema

Canonical types live in `src/cli/jsonrpc/types.ts`. Human-facing schema doc: `apps/ptah-cli/docs/jsonrpc-schema.md`. Migration notes: `apps/ptah-cli/docs/migration.md`.
