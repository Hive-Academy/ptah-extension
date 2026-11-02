## Project-Specific Guidance

### Project Context
Ptah is an AI coding-assistant platform delivered as an Nx monorepo (Nx 23.2.1, TypeScript 6.0.3, Node 24). It ships one product to several hosts:
- **VS Code extension** (`apps/ptah-extension-vscode`, engine ^1.100.0) with an **Angular 22 webview** (`apps/ptah-extension-webview`)
- **Electron desktop app** (`apps/ptah-electron`, Electron 44)
- **Headless CLI** (`apps/ptah-cli`, Commander) and an **Ink/React TUI** (`apps/ptah-tui`)
- **NestJS 12 license server** (`apps/ptah-license-server`) on PostgreSQL via Prisma 7, with Paddle billing, WorkOS auth, Resend email and Sentry
- **Angular SSR landing page**, **Astro Starlight docs** and a **Remotion video studio**

The core domain is agent orchestration: `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@openai/codex-sdk`, `@cursor/sdk`, `@agentclientprotocol/sdk` and `@modelcontextprotocol/sdk`. The hosts also expose a local MCP HTTP server with `ptah_*` tools. Supporting systems:
- Code intelligence: `web-tree-sitter`, SQLite via `better-sqlite3` + `sqlite-vec`
- Terminals: `node-pty`
- Browser automation: CDP
- Messaging gateways: Slack, Discord, Telegram
- Local ML and speech: transformers, kokoro, whisper

DI uses tsyringe on the backends and Angular `inject()` on the frontends. Zod validates schemas, and Tailwind with DaisyUI handles styling. Jest 30 is the unit runner and Playwright runs e2e.

### Framework Guidelines
**Angular (webview, `libs/frontend/*`, `libs/web/*`)**
- Write standalone components with `ChangeDetectionStrategy.OnPush`, `inject()`, `input()`/`input.required()` and `output()`. Never add `@Input`/`@Output`, `NgModule` or constructor injection.
- Hold state in signals (`signal`/`computed`/`effect`) inside data-access stores. Bridge RxJS 7.8 with `toSignal`/`toObservable`. For big features, split smart and presentational components and extract a store rather than growing a component (see `provider-setup-wizard.component.ts`). Apply the **angular-frontend-patterns** skill.
- Never use `[innerHTML]` with untrusted content. Sanitize markdown (`marked`) with DOMPurify, and never render raw errors or secrets.
- Talk to the host only through `ClaudeRpcService` and `MESSAGE_HANDLERS` multi-providers that `MessageRouterService` collects. Do not call transports directly.
- Test with `jest-preset-angular`.

**NestJS (`libs/api/*`)**
- Keep the layering module → controller → service. Controllers must not inject `PrismaService`. Type requests with `RequestUser`, never `as any`.
- Keep helmet, validation and throttling on. Use the **nestjs-backend-patterns**, **resilient-nestjs-patterns** and **webhook-architecture** (Paddle) skills.

**Extension host / Electron / CLI (tsyringe)**
- Load `reflect-metadata` first. Register through per-lib `di/tokens.ts` + `registration.ts`.
- Use constructor injection. Call `container.resolve` only in the composition roots (`apps/*/src/di/phase-0..4-*.ts`, `cli-engine/container.ts`).

_(section shortened to fit the prompt budget)_

### Coding Standards
- **Type safety:** the base `tsconfig` has `strict: false`, but every project should opt into `strict`, and all new code must compile under it. Do not use `any`, `@ts-ignore` or `as unknown as X`. Use `unknown` in catch blocks and narrow it. At every boundary (tool args, IPC payloads, RPC params, webhooks), parse with Zod instead of casting.
- **Logging:** use the injected `Logger` (`TOKENS.LOGGER`), never `console.*` in libs. Pass real `Error` objects to `logger.error`. Never cast context objects to `Error`, because that drops data.
- **Error handling:** never swallow errors silently. Any intentional swallow needs the suppression comment the `tools/degradation-audit` ratchet expects. Do not raise its baselines.
- **SOLID:** keep files and functions small. The file-size lint rule only warns, but treat it as a hard limit for new code. Split god files (`git-info.service.ts`, `protocol-dispatcher.ts`, `tab-manager.service.ts`, `router.ts`) behind their existing facades instead of extending them. Define contracts as interfaces, not concrete classes.
- **Naming:** use kebab-case files with role suffixes (`*.service.ts`, `*.store.ts`, `*-rpc.handlers.ts`, `*.component.ts`, `*.spec.ts`). Use `Symbol.for` DI tokens in `di/tokens.ts`.
- **Imports:** import only from a lib's public `src/index.ts` alias (`@ptah-extension/*`, `@ptah-api/*`). No deep `/src/` paths and no relative cross-project imports.
- **Security:** allowlist URL schemes before any `openExternal`, validate paths with `isInsideRoot`, and never log secrets.

_(section shortened to fit the prompt budget)_

### Architecture Notes
**Nx monorepo:** 13 apps and about 86 libs. Apps are thin composition roots, and logic lives in libs. The lib groups are:
- `libs/backend`: Node / extension host
- `libs/frontend`: Angular webview
- `libs/api`: NestJS
- `libs/web`: landing site
- `libs/api-contracts`
- `libs/shared`

**Module boundaries:** `@nx/enforce-module-boundaries` is set to error on two axes:
- `scope:{shared,extension,webview,electron,cli,api,web,api-contracts,e2e}`
- `type:{app,feature,data-access,ui,util,core,tool}`

The lib graph is acyclic. Keep it that way: before you add an import, check the dependency direction with `ptah_get_dependents`/`ptah_get_dependencies`. Use `type:app` (not `type:application`) and `platform:angular` tags, and apply the **nx-workspace-architect** skill for tagging and new libs.

**Ports & adapters for hosts:**
- `libs/backend/platform-core` defines about 34 interfaces (file system, secret storage, workspace, process spawner, user interaction…) bound to `PLATFORM_TOKENS`.
- `platform-vscode`, `platform-electron` and `platform-cli` implement them, each with its own `registration.ts`.
- New host capabilities start as a port in `platform-core` plus an adapter in each platform lib. Never import `vscode` or `electron` into host-neutral libs.

**vscode-core:** despite its name, it is the shared infrastructure core (`Logger`, `TOKENS`, `RpcHandler`). Do not add more VS Code-specific value imports to its public surface. Put host-neutral code in host-neutral libs.

**Phased DI:** the VS Code and Electron roots compose in `phase-0-platform → phase-1-infra → phase-2-libraries → phase-3-handlers → phase-4-app`. Four specs guard this: `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts` and `surface-composition.spec.ts`. When you register a service or an RPC method, update these guards. The CLI composes in `libs/backend/cli-engine/src/lib/container.ts`.

**Host↔UI RPC:**
- The contract lives in `libs/shared/src/lib/types/rpc.types.ts`.
- Handlers live in `libs/backend/rpc-handlers/src/lib/handlers` (one file per sub-domain), with an allowlist via `ALLOWED_METHOD_PREFIXES`.
- Transports are Electron `ipc-bridge.ts` (validate the sender) and VS Code webview messaging.
- On the frontend, use `ClaudeRpcService`.

_(section shortened to fit the prompt budget)_
