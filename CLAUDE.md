# Ptah

## Overview

Ptah is an "AI coding orchestra" delivered as a VS Code extension, Electron desktop app, and headless CLI — all sharing a hexagonal Nx monorepo core powered by `@anthropic-ai/claude-agent-sdk` with adapter SDKs for Copilot and Codex.

## Architecture

**Pattern**: Nx monorepo + hexagonal (ports & adapters) + feature-sliced Angular libs.

```
ptah-extension/
├── apps/                              # 13 Nx projects (9 shipping + 4 e2e)
│   ├── ptah-extension-vscode/         # VS Code extension host (esbuild → main.mjs)
│   ├── ptah-extension-webview/        # Angular 21 webview shell (Zone-based)
│   ├── ptah-electron/                 # Electron 40 desktop app
│   ├── ptah-cli/                      # @hive-academy/ptah-cli (JSON-RPC stdio)
│   ├── ptah-tui/                      # Ink TUI → tui.mjs inside @hive-academy/ptah-cli
│   ├── ptah-license-server/           # NestJS 11 + Prisma + Paddle + WorkOS + Resend
│   ├── ptah-landing-page/             # Angular marketing site
│   ├── ptah-docs/                     # Astro Starlight (docs.ptah.live)
│   ├── ptah-video-studio/             # Remotion compositor (tooling; never shipped)
│   └── *-e2e/                         # ptah-electron | ptah-extension-vscode |
│                                      # ptah-landing-page | ptah-license-server
│
├── libs/backend/                      # 27 runtime-agnostic libs (DI: tsyringe)
│   ├── platform-core/                 # ★ Port interfaces + 22 PLATFORM_TOKENS
│   ├── platform-{cli,electron,vscode} #   Adapter trio (mutually exclusive)
│   ├── agent-sdk/                     # Claude/Codex SDK wrapper, compaction
│   ├── auth-providers/                # Auth strategies + provider trees (one-way → agent-sdk)
│   ├── auth-providers-tokens/         # Zero-dep AUTH_PROVIDERS_TOKENS
│   ├── cli-agent-runtime/             # Rival-CLI orchestration + cross-CLI MCP install
│   ├── cli-engine/                    # In-process backend host for ptah-cli / ptah-tui
│   ├── agent-generation/              # Setup-wizard generation pipeline
│   ├── workspace-intelligence/        # AST + symbol indexer + analysis
│   ├── rpc-handlers/                  # 30+ handlers (dual-registration rule)
│   ├── vscode-core/                   # Logger, RpcHandler, License, FeatureGate
│   ├── vscode-lm-tools/               # Code-exec MCP + browser/web capabilities
│   ├── settings-core/                 # ~/.ptah/settings.json store + secret envelopes
│   ├── output-styles/                 # Output-style discovery + activation decision
│   ├── persistence-sqlite/            # ~/.ptah/ptah.db + migrations + IEmbedder
│   ├── memory-contracts/              # Zero-dep memory port interfaces
│   ├── memory-curator/                # Letta-style memory + IndexingControl
│   ├── messaging-gateway/             # Telegram/Discord/Slack + voice
│   ├── gateway-chat-bridge/           # Gateway inbound → agent session → outbound
│   ├── voice-contracts/               # Zero-dep voice ports + error taxonomy
│   ├── voice-providers/               # Whisper/Kokoro + cloud voice adapters
│   ├── cron-scheduler/                # SQLite-backed slot-claim cron
│   ├── task-specs/                    # .ptah/specs/ task.md frontmatter contract
│   ├── skill-synthesis/               # Trajectory extraction + judge
│   └── thoth-runtime/                 # Runtime-agnostic Thoth channel boot + cron
│
├── libs/api/                          # 15 NestJS libs — ptah-license-server ONLY
├── libs/api-contracts/                # 1 lib (community) — member/admin wire contracts
│
├── libs/frontend/                     # 25 Angular 21 libs (signals, OnPush)
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
│   ├── marketplace/                   # Plugins / Smithery / OAuth surfaces
│   ├── tribunal-panel/                # Multi-vendor tribunal wizard + tile host
│   ├── tasks-ui/                      # Six-column Kanban over .ptah/specs/
│   ├── workspace-indexing/            # Shared indexing panel (breaks chat ↔ memory cycle)
│   ├── thoth-shell/                   # 4-tab inner chrome (Memory/Skills/Cron/Gateway)
│   ├── memory-curator-ui/             # Electron-only Memory tab
│   ├── cron-scheduler-ui/             # Electron-only Schedules tab
│   ├── messaging-gateway-ui/          # Electron-only Gateway tab
│   ├── skill-synthesis-ui/            # Skills tab (VS Code + Electron)
│   └── webview-e2e-harness/           # Playwright harness w/ postmessage bridge
│
├── libs/web/                          # 10 Angular libs — ptah-landing-page ONLY
│
├── libs/shared/                       # Cross-side types, RPC contracts, messages
└── libs/showcase-manifest/            # Scene/beat manifest types (e2e capture ↔ Remotion)
```

**Hexagonal rule**: backend libs depend on `platform-core` interfaces. Concrete adapters live in `platform-{vscode,electron,cli}`. Add a new runtime by adding a fourth adapter family — never by branching inside an existing one.

**Frontend ↔ backend isolation**: frontend libs MUST NOT import backend libs and vice versa. `libs/shared` is the one bridge.

**Product ↔ platform isolation**: `libs/api/**` and `libs/web/**` are the **web product** (license server + landing page). They MUST NOT import `libs/backend/**` or `libs/frontend/**`, and neither imports the other — `libs/api-contracts/**` is their one bridge. Two exceptions, both deliberate: `libs/frontend/markdown`, which the member panel consumes as the single XSS chokepoint, and `@ptah-extension/shared/testing` — a test-only secondary entry point (`freezeTime()` and friends) imported by `libs/api` spec files and never by production code.

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
cp .env.example .env                 # DATABASE_URL lives here — repo root, not the app dir
npm install                          # Triggers postinstall (electron native rebuild)
npm run docker:db:start              # Postgres for license server
npm run prisma:migrate:dev           # Prisma migrations
```

**`DATABASE_URL` comes from the repo-root `.env`**, not from
`apps/ptah-license-server/.env` (which does not exist — its `.env.example` is an
admin/marketing subset with no `DATABASE_URL` in it). Skip the first line and every
`prisma:*` script fails with `Error: Connection url is empty`, which reads like a
dead database but is a missing env file. Pinned by
`apps/ptah-license-server/src/common/prisma-config-env.spec.ts`.

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
- **File size**: soft ceiling 700 lines (`eslint.config.mjs` `max-lines`, warn-level — TASK_2026_268); past 1000 means a deliberate look, not an alarm. Line count alone is not the signal — a contract barrel or exhaustive type union can be long and correct. When a split is warranted, use the **facade rule**: the public class keeps its name, DI token and method signatures; the extracted concern becomes a collaborator injected into it (worked example: `SkillSynthesisService` / `StageHandlersService`, TASK_2026_256). Guardrails against fragment sprawl: the extracted piece must pass a nameability test (no `helpers`/`utils`/`common`/`misc`); no file under ~150 lines created just to satisfy the cap; a split pushing a constructor past ~8 injected deps cut in the wrong place; prefer 2–3 collaborators over 6 fragments.
- **Windows paths**: always use complete absolute Windows paths for Read/Write — there's a Claude Code bug with relative paths in this workspace.

## Task Specs (`.ptah/specs/`)

- **Carrier**: each `TASK_YYYY_NNN/` folder MUST contain `task.md` — YAML frontmatter (`status`, `type`, `title`) + short body. A folder without it is invisible to the Tasks board.
- **Prose**: user intent and narrative go in `context.md`. The team-leader batch breakdown goes in `tasks.md`. Never put prose in the carrier.
- **`description` is ALWAYS a `>-` block scalar** — a plain YAML scalar ends at the first colon-space, so a description quoting code makes the whole carrier unparseable and the task vanishes from the board. Three carriers were dark for exactly this (repaired 2026-08-09). Same rule for `title` when it contains a colon.
- **Status change**: `Edit` exactly the `status:` line in `task.md` (`backlog | in_progress | in_review | blocked | done | cancelled`). Never rewrite the whole carrier with `Write`.
- **ID allocation**: folder scan of `.ptah/specs/TASK_*` — highest `NNN` for the current year + 1, zero-padded. NEVER derive the ID from `registry.md` (it is generated and can be stale).
- **Folder name is the canonical ID**: a mismatched `id:` field inside the frontmatter is a warning; do not "fix" it by renaming folders.

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
- [ptah-tui](./apps/ptah-tui/CLAUDE.md) — Ink TUI on `cli-engine`; not its own npm package — builds to `tui.mjs` inside `@hive-academy/ptah-cli`, launched by `ptah tui` (hence `private: true`)
- [ptah-license-server](./apps/ptah-license-server/CLAUDE.md) — NestJS license API
- [ptah-license-server-e2e](./apps/ptah-license-server-e2e/CLAUDE.md) — License e2e
- [ptah-landing-page](./apps/ptah-landing-page/CLAUDE.md) — Angular marketing
- ptah-landing-page-e2e — Playwright marketing-site tests
- [ptah-extension-vscode-e2e](./apps/ptah-extension-vscode-e2e/CLAUDE.md) — VS Code e2e
- [ptah-docs](./apps/ptah-docs/CLAUDE.md) — Astro Starlight docs
- ptah-video-studio — Remotion compositor + selfshot pipeline (tooling only)

### Backend Libs

- [platform-core](./libs/backend/platform-core/CLAUDE.md) — ★ Ports + 22 PLATFORM_TOKENS
- [platform-cli](./libs/backend/platform-cli/CLAUDE.md) — CLI adapters
- [platform-electron](./libs/backend/platform-electron/CLAUDE.md) — Electron adapters
- [platform-vscode](./libs/backend/platform-vscode/CLAUDE.md) — VS Code adapters
- [agent-sdk](./libs/backend/agent-sdk/CLAUDE.md) — Claude/Codex SDK wrapper
- [auth-providers](./libs/backend/auth-providers/CLAUDE.md) — Auth strategies + provider trees
- auth-providers-tokens — Zero-dep `AUTH_PROVIDERS_TOKENS` (no CLAUDE.md yet)
- [cli-agent-runtime](./libs/backend/cli-agent-runtime/CLAUDE.md) — Rival-CLI orchestration + MCP install
- [cli-engine](./libs/backend/cli-engine/CLAUDE.md) — In-process backend host for ptah-cli / ptah-tui
- [agent-generation](./libs/backend/agent-generation/CLAUDE.md) — Generation pipeline
- [workspace-intelligence](./libs/backend/workspace-intelligence/CLAUDE.md) — AST + symbols
- [rpc-handlers](./libs/backend/rpc-handlers/CLAUDE.md) — RPC handler classes
- [vscode-core](./libs/backend/vscode-core/CLAUDE.md) — Logger, License, RPC infra
- [vscode-lm-tools](./libs/backend/vscode-lm-tools/CLAUDE.md) — Code-exec MCP + browser
- settings-core — `~/.ptah/settings.json` store + secret envelopes (no CLAUDE.md yet)
- [output-styles](./libs/backend/output-styles/CLAUDE.md) — Output-style discovery + activation
- [persistence-sqlite](./libs/backend/persistence-sqlite/CLAUDE.md) — SQLite + migrations
- [memory-contracts](./libs/backend/memory-contracts/CLAUDE.md) — Memory port interfaces
- [memory-curator](./libs/backend/memory-curator/CLAUDE.md) — Letta-style memory
- [messaging-gateway](./libs/backend/messaging-gateway/CLAUDE.md) — Telegram/Discord/Slack
- [gateway-chat-bridge](./libs/backend/gateway-chat-bridge/CLAUDE.md) — Gateway ↔ agent session
- [voice-contracts](./libs/backend/voice-contracts/CLAUDE.md) — Zero-dep voice ports
- [voice-providers](./libs/backend/voice-providers/CLAUDE.md) — Whisper/Kokoro + cloud voice
- [cron-scheduler](./libs/backend/cron-scheduler/CLAUDE.md) — SQLite cron loop
- [task-specs](./libs/backend/task-specs/CLAUDE.md) — `.ptah/specs/` task.md contract
- [skill-synthesis](./libs/backend/skill-synthesis/CLAUDE.md) — Trajectory extraction
- thoth-runtime — Runtime-agnostic Thoth channel boot + cron start (no CLAUDE.md yet)

### API Libs

`@ptah-api/*` — NestJS libs consumed **only** by `apps/ptah-license-server`. None has a
per-lib `CLAUDE.md` yet; each entry below is the whole of its documentation.

- admin — Admin controllers: licenses, users, waitlist, records, stats
- audit — Append-only admin audit log
- billing — Paddle checkout + webhooks + subscription state
- community — Cohorts, Builders sessions (Google Calendar), packs registry, Circle provisioning
- core — `PrismaService`, config, Sentry, and the gitignored generated Prisma client
- email — Resend provider + transactional email services
- forum — Native community forum: categories, topics, posts, reactions, read state, search
- identity — WorkOS SSO, JWT guards, admin-email allowlist
- learning — Native course platform: courses, modules, lessons, progress, lesson comments
- licensing — Ed25519 license issue/verify, auth endpoints, license events
- marketing — Contact, waitlist and marketing-session capture
- member-hub — The two aggregate endpoints `/members` needs before it can render
- membership — ★ The single definition of "paid Builders member" + cohort lookup + request guard
- notifications — Member-owned in-app notification inbox (poll-only; no email, no SSE)
- youtube — The one outbound YouTube Data API v3 call, made at authoring time only

### API Contracts

- api-contracts/community — ★ Member/admin wire contracts (the member/admin split): forum, courses, live + private sessions, packs, notifications (no CLAUDE.md yet)

### Web Libs

`@ptah-web/*` — Angular libs consumed **only** by `apps/ptah-landing-page`. None has a
per-lib `CLAUDE.md` yet; each entry below is the whole of its documentation.

- account — Contact, profile and session pages for signed-in users
- admin — Admin panel: overview, users, builders, groups, waitlist, marketing, failed webhooks
- auth — Sign-in / sign-up page, auth services and guards config
- core — Guards, interceptors, API services, app state, runtime config
- landing — Public marketing page sections + console demo
- legal — Terms, privacy and refund pages
- members — The Ptah Builders member panel, mounted at `/members`
- panel-ui — ★ Primitives shared by the member AND admin panels: layout, nav, detail drawer, stat tile, status badge, thread row, selection toolbar, empty state
- pricing — Pricing page, plan models and comparison
- ui — Shared site chrome: navigation, footer, countdown, session calendar

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
- marketplace — Plugins / Smithery / OAuth surfaces (no CLAUDE.md yet)
- tribunal-panel — Multi-vendor tribunal wizard + tile host (no CLAUDE.md yet)
- [tasks-ui](./libs/frontend/tasks-ui/CLAUDE.md) — Six-column Kanban over `.ptah/specs/`
- workspace-indexing — Shared indexing panel, breaks chat ↔ memory cycle (no CLAUDE.md yet)
- [thoth-shell](./libs/frontend/thoth-shell/CLAUDE.md) — 4-tab inner chrome (Electron)
- [memory-curator-ui](./libs/frontend/memory-curator-ui/CLAUDE.md) — Memory tab (Electron)
- [cron-scheduler-ui](./libs/frontend/cron-scheduler-ui/CLAUDE.md) — Schedules tab (Electron)
- [messaging-gateway-ui](./libs/frontend/messaging-gateway-ui/CLAUDE.md) — Gateway tab (Electron)
- [skill-synthesis-ui](./libs/frontend/skill-synthesis-ui/CLAUDE.md) — Skills tab
- [webview-e2e-harness](./libs/frontend/webview-e2e-harness/CLAUDE.md) — Playwright harness

### Shared

- [shared](./libs/shared/CLAUDE.md) — Cross-side types, RPC contracts, messages
- showcase-manifest — Scene/beat/shot manifest types bridging the e2e capture harness and the Remotion compositor (no CLAUDE.md yet)

## Use caveman skill to talk percisly and on point
