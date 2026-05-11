# Ptah

## Overview

Ptah is an "AI coding orchestra" delivered as a VS Code extension, Electron desktop app, and headless CLI — all sharing a hexagonal Nx monorepo core powered by `@anthropic-ai/claude-agent-sdk` with adapter SDKs for Copilot and Codex.

## Architecture

**Pattern**: Nx monorepo + hexagonal (ports & adapters) + feature-sliced Angular libs.

```
ptah-extension/
├── apps/                              # 10 runtime targets
│   ├── ptah-extension-vscode/         # VS Code extension host (esbuild → main.mjs)
│   ├── ptah-extension-webview/        # Angular 21 webview shell (Zone-based)
│   ├── ptah-electron/                 # Electron 40 desktop app
│   ├── ptah-electron-e2e/             # Playwright _electron.launch
│   ├── ptah-cli/                      # @hive-academy/ptah-cli (JSON-RPC stdio)
│   ├── ptah-license-server/           # NestJS 11 + Prisma + Paddle + WorkOS + Resend
│   ├── ptah-license-server-e2e/       # Jest e2e
│   ├── ptah-landing-page/             # Angular marketing site
│   ├── ptah-docs/                     # Astro Starlight (docs.ptah.live)
│   └── infra-test/                    # MCP/trial-cron probes
│
├── libs/backend/                      # 16 runtime-agnostic libs (DI: tsyringe)
│   ├── platform-core/                 # ★ Port interfaces + 16 PLATFORM_TOKENS
│   ├── platform-{cli,electron,vscode} #   Adapter trio (mutually exclusive)
│   ├── agent-sdk/                     # Claude/Codex SDK wrapper, compaction
│   ├── agent-generation/              # Setup-wizard generation pipeline
│   ├── workspace-intelligence/        # AST + symbol indexer + analysis
│   ├── rpc-handlers/                  # 30+ handlers (dual-registration rule)
│   ├── vscode-core/                   # Logger, RpcHandler, License, FeatureGate
│   ├── vscode-lm-tools/               # Code-exec MCP + browser/web capabilities
│   ├── persistence-sqlite/            # ~/.ptah/ptah.db + migrations + IEmbedder
│   ├── memory-contracts/              # Zero-dep memory port interfaces
│   ├── memory-curator/                # Letta-style memory + IndexingControl
│   ├── messaging-gateway/             # Telegram/Discord/Slack + voice
│   ├── cron-scheduler/                # SQLite-backed slot-claim cron
│   └── skill-synthesis/               # Trajectory extraction + judge
│
├── libs/frontend/                     # 21 Angular 21 libs (signals, OnPush)
│   ├── core/                          # VSCodeService, MESSAGE_HANDLERS, RPC client
│   ├── ui/                            # Floating-UI primitives (Native*) + legacy CDK
│   ├── markdown/                      # ★ Single XSS chokepoint (DOMPurify + marked)
│   ├── editor/                        # Monaco + xterm + node-pty bridge
│   ├── chat/                          # Orchestrator + ChatStore facade
│   ├── chat-{state,streaming,routing,ui,types,execution-tree}/
│   ├── canvas/                        # Multi-tile orchestra (gridstack, 9-tile cap)
│   ├── dashboard/                     # Card-driven home
│   ├── setup-wizard/                  # 7-step premium-gated onboarding
│   ├── harness-builder/               # Streamed harness builder
│   ├── thoth-shell/                   # 4-tab inner chrome (Memory/Skills/Cron/Gateway)
│   ├── memory-curator-ui/             # Electron-only Memory tab
│   ├── cron-scheduler-ui/             # Electron-only Schedules tab
│   ├── messaging-gateway-ui/          # Electron-only Gateway tab
│   ├── skill-synthesis-ui/            # Skills tab (VS Code + Electron)
│   └── webview-e2e-harness/           # Playwright harness w/ postmessage bridge
│
└── libs/shared/                       # Cross-side types, RPC contracts, messages
```

**Hexagonal rule**: backend libs depend on `platform-core` interfaces. Concrete adapters live in `platform-{vscode,electron,cli}`. Add a new runtime by adding a fourth adapter family — never by branching inside an existing one.

**Frontend ↔ backend isolation**: frontend libs MUST NOT import backend libs and vice versa. `libs/shared` is the one bridge.

## Tech Stack

- **Language**: TypeScript 5.9 (strict, `catch (error: unknown)`)
- **Frameworks**: Angular 21 (signals, zoneless in libs / Zone in webview shell, OnPush mandatory), NestJS 11, Electron 40
- **AI**: `@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`, `@openai/codex-sdk`, Tavily, Exa
- **Persistence**: better-sqlite3, sqlite-vec, Prisma 7 + PostgreSQL (license server only)
- **DI**: tsyringe (`Symbol.for(...)` tokens, `register.ts` per lib)
- **UI**: Tailwind 3, daisyui 4, lucide-angular, gsap / @hive-academy/angular-gsap, Monaco, xterm.js, gridstack
- **Validation**: Zod 4 at all external boundaries
- **Build**: Nx 22.6, esbuild, ng-packagr, electron-builder, Astro 6

## Setup

```bash
npm install                          # Triggers postinstall (electron native rebuild)
npm run docker:db:start              # Postgres for license server
npm run prisma:migrate:dev           # Prisma migrations
```

## Development Commands

```bash
npm run dev                          # Watch extension + webview
npm run build:all                    # Build everything
npm run lint:all
npm run typecheck:all                # nx affected -t typecheck
npm run test                         # Jest across extension/webview/shared
npm run electron:serve               # Electron dev
npm run cli:dev                      # Headless CLI
nx serve ptah-license-server         # NestJS API
nx graph                             # Visualize dep graph
```

## Coding Standards

- **Type safety**: `catch (error: unknown)`, narrow with `instanceof Error` before `.message`. No `@ts-ignore` without `@ts-expect-error + reason`.
- **Validation**: Zod schemas at every external boundary (HTTP, IPC, file I/O, AI tool args). Trust internal types past that.
- **SOLID**: New libs own one concern (do NOT replicate the agent-sdk monolith). Backend depends on `platform-core` ports, never adapters.
- **Naming**: `kebab-case.ts` files; `I`-prefix for platform ports; DI tokens `UPPER_SNAKE` as `Symbol.for(...)`; adapters `{platform}-{capability}.ts`.
- **Angular**: signals + `inject()`, `ChangeDetectionStrategy.OnPush` mandatory, no `[innerHTML]` on AI markdown (route through `libs/frontend/markdown`).
- **NestJS**: read env via `ConfigService`, never `process.env[...]` directly. Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`. Never expose raw `error.message` to clients.
- **RPC dual-registration**: new RPC namespace requires BOTH `libs/shared/.../rpc.types.ts` (compile-time) AND `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46` `ALLOWED_METHOD_PREFIXES` (runtime guard).
- **Windows paths**: always use complete absolute Windows paths for Read/Write — there's a Claude Code bug with relative paths in this workspace.

## VS Code Marketplace (BLOCKING)

Scanner rejects extensions containing trademarked AI product names (`copilot`, `codex`, `claude`, `openai`, `anthropic`) in **non-JS files**. Rules:

- JS bundles (`main.mjs`, webview chunks, WASM) pass — these names are safe there.
- `LICENSE.md`, plugin/template markdown, and verbose READMEs are flagged. `.vscodeignore` excludes them.
- Plugins + templates download at runtime via `ContentDownloadService` from GitHub — **never** re-add them as VSIX assets.
- Provider settings with trademarked keys moved to `~/.ptah/settings.json` (transparent via `IWorkspaceProvider.getConfiguration()`). Never re-add to `package.json contributes.configuration`.
- **Once an extension ID fails marketplace validation, that ID is permanently burned.** Test throwaway IDs first.

## Module Index

### Apps

- [ptah-extension-vscode](./apps/ptah-extension-vscode/CLAUDE.md) — VS Code extension host
- [ptah-extension-webview](./apps/ptah-extension-webview/CLAUDE.md) — Angular webview shell (Zone-based)
- [ptah-electron](./apps/ptah-electron/CLAUDE.md) — Electron desktop app
- [ptah-electron-e2e](./apps/ptah-electron-e2e/CLAUDE.md) — Playwright electron tests
- [ptah-cli](./apps/ptah-cli/CLAUDE.md) — Headless JSON-RPC CLI
- [ptah-license-server](./apps/ptah-license-server/CLAUDE.md) — NestJS license API
- [ptah-license-server-e2e](./apps/ptah-license-server-e2e/CLAUDE.md) — License e2e
- [ptah-landing-page](./apps/ptah-landing-page/CLAUDE.md) — Angular marketing
- [ptah-docs](./apps/ptah-docs/CLAUDE.md) — Astro Starlight docs
- [infra-test](./apps/infra-test/CLAUDE.md) — MCP/trial probes

### Backend Libs

- [platform-core](./libs/backend/platform-core/CLAUDE.md) — ★ Ports + PLATFORM_TOKENS
- [platform-cli](./libs/backend/platform-cli/CLAUDE.md) — CLI adapters
- [platform-electron](./libs/backend/platform-electron/CLAUDE.md) — Electron adapters
- [platform-vscode](./libs/backend/platform-vscode/CLAUDE.md) — VS Code adapters
- [agent-sdk](./libs/backend/agent-sdk/CLAUDE.md) — Claude/Codex SDK wrapper
- [agent-generation](./libs/backend/agent-generation/CLAUDE.md) — Generation pipeline
- [workspace-intelligence](./libs/backend/workspace-intelligence/CLAUDE.md) — AST + symbols
- [rpc-handlers](./libs/backend/rpc-handlers/CLAUDE.md) — RPC handler classes
- [vscode-core](./libs/backend/vscode-core/CLAUDE.md) — Logger, License, RPC infra
- [vscode-lm-tools](./libs/backend/vscode-lm-tools/CLAUDE.md) — Code-exec MCP + browser
- [persistence-sqlite](./libs/backend/persistence-sqlite/CLAUDE.md) — SQLite + migrations
- [memory-contracts](./libs/backend/memory-contracts/CLAUDE.md) — Memory port interfaces
- [memory-curator](./libs/backend/memory-curator/CLAUDE.md) — Letta-style memory
- [messaging-gateway](./libs/backend/messaging-gateway/CLAUDE.md) — Telegram/Discord/Slack
- [cron-scheduler](./libs/backend/cron-scheduler/CLAUDE.md) — SQLite cron loop
- [skill-synthesis](./libs/backend/skill-synthesis/CLAUDE.md) — Trajectory extraction

### Frontend Libs

- [core](./libs/frontend/core/CLAUDE.md) — VSCodeService, MESSAGE_HANDLERS, RPC
- [ui](./libs/frontend/ui/CLAUDE.md) — Floating-UI Native\* primitives
- [markdown](./libs/frontend/markdown/CLAUDE.md) — ★ DOMPurify XSS chokepoint
- [editor](./libs/frontend/editor/CLAUDE.md) — Monaco + xterm + git
- [chat](./libs/frontend/chat/CLAUDE.md) — Chat orchestrator + ChatStore
- [chat-state](./libs/frontend/chat-state/CLAUDE.md) — TabManager + ConversationRegistry
- [chat-streaming](./libs/frontend/chat-streaming/CLAUDE.md) — Streaming write path
- [chat-routing](./libs/frontend/chat-routing/CLAUDE.md) — StreamRouter + SurfaceRegistry
- [chat-ui](./libs/frontend/chat-ui/CLAUDE.md) — Presentational atoms + molecules
- [chat-types](./libs/frontend/chat-types/CLAUDE.md) — Framework-agnostic types
- [chat-execution-tree](./libs/frontend/chat-execution-tree/CLAUDE.md) — Execution tree builder
- [canvas](./libs/frontend/canvas/CLAUDE.md) — Multi-tile orchestra (gridstack)
- [dashboard](./libs/frontend/dashboard/CLAUDE.md) — Card-driven home
- [setup-wizard](./libs/frontend/setup-wizard/CLAUDE.md) — 7-step onboarding
- [harness-builder](./libs/frontend/harness-builder/CLAUDE.md) — Streamed harness builder
- [thoth-shell](./libs/frontend/thoth-shell/CLAUDE.md) — 4-tab inner chrome (Electron)
- [memory-curator-ui](./libs/frontend/memory-curator-ui/CLAUDE.md) — Memory tab (Electron)
- [cron-scheduler-ui](./libs/frontend/cron-scheduler-ui/CLAUDE.md) — Schedules tab (Electron)
- [messaging-gateway-ui](./libs/frontend/messaging-gateway-ui/CLAUDE.md) — Gateway tab (Electron)
- [skill-synthesis-ui](./libs/frontend/skill-synthesis-ui/CLAUDE.md) — Skills tab
- [webview-e2e-harness](./libs/frontend/webview-e2e-harness/CLAUDE.md) — Playwright harness

### Shared

- [shared](./libs/shared/CLAUDE.md) — Cross-side types, RPC contracts, messages
