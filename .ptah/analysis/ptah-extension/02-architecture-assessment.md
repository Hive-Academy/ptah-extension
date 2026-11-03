# 02 — Architecture Assessment: ptah-extension

> Phase 2. Builds on `01-project-profile.md`. Evidence was gathered from `eslint.config.mjs` (module-boundary rules), `tsconfig.base.json` path aliases, a static import graph over every non-spec `.ts/.tsx` file in `libs/{backend,frontend,api,web}/*/src`, and targeted reads of composition roots, adapters and stores. Branch: `fix/settled-text-markdown-handoff-skill`.

---

## Folder Structure Assessment

### Nx (monorepo) — **follows conventions**
| Nx convention | Observed | Verdict |
|---|---|---|
| `apps/` thin, `libs/` hold logic | 13 apps (1,540 files) vs 86 libs (6,439 files). Host apps keep mostly composition code (`apps/ptah-extension-vscode/src/di/phase-0..4-*.ts`, `activation/`, `providers/`). | Follows |
| Libraries grouped by scope folder | `libs/backend`, `libs/frontend`, `libs/api`, `libs/web`, `libs/api-contracts`, `libs/shared` | Follows |
| `scope:*` + `type:*` tags with `@nx/enforce-module-boundaries` | Both dimensions enforced as `error` in `eslint.config.mjs:285-420`; one suppression only (`apps/ptah-license-server/prisma/seed/prisma-client.ts:35`) | Follows (strong) |
| One public entry per lib (`src/index.ts`) | All 115 aliases point to `src/index.ts` (plus sub-entry `@ptah-extension/shared/angular`). No `@ptah-extension/<lib>/src/...` deep imports found. | Follows |
| Relative cross-project imports avoided | Only `apps/ptah-license-server/prisma/seed/prisma-client.ts:36` reaches `../../../../libs/api/core/src/lib/generated-prisma-client/client` | Follows (one documented exception) |

Deviations:
- **Naming of type tags is inconsistent**: both `type:app` and `type:application` exist as separate `sourceTag` entries (`eslint.config.mjs` ~385 and ~395), and some libs carry a bare `angular` tag next to `platform:angular`.
- **Migrations in flight**: `scope:landing` and `scope:app` constraints carry comments saying the landing app and license server are "being decomposed" into `libs/web/*` and `libs/api/*`. The license server is now effectively empty (`apps/ptah-license-server/src/app/app.module.ts` only composes `@ptah-api/*` modules; `src/admin/` holds just a spec). The landing app retains only `pages/download`. The transitional tag allowances can be retired.

### Angular (webview, landing, `libs/frontend`, `libs/web`) — **follows conventions**
- Angular style guide (v17+): standalone components, `inject()`, signal inputs, OnPush. Observed: 428 `@Component` files, **0** `standalone: false`, 425 with `ChangeDetectionStrategy.OnPush`, `inject(` in 416 files vs `constructor(private` in 7, `input()/input.required()` in 338 files vs `@Input()` in 1, `@Output()` 0. `NgModule` survives in 8 files only.
- Feature/ui/data-access/util library split is applied: `libs/frontend/ui` (`type:ui`), `libs/frontend/chat-state` (`type:data-access`), `libs/frontend/chat-types` (`type:util`), feature libs such as `chat`, `marketplace`, `git-ui`.
- Misplacement: state services for many features live in `libs/frontend/core/src/lib/services` (`model-state.service.ts`, `auth-state.service.ts`, `autopilot-state.service.ts`, `plan-limits.store.ts`, `providers-settings-state.service.ts`, `ptah-cli-state.service.ts`). `core` is tagged `type:core` and has fan-in 20 — it is drifting into a "shared kitchen" for feature state that would sit better in data-access libs.

### NestJS (`ptah-license-server`, `libs/api/*`) — **partially follows**
- Canonical Nest layout (module → controller → service → data layer) is followed per domain (`libs/api/billing/src/lib/{paddle,subscription}`, `libs/api/core/src/lib/{prisma,config,sentry,common}`).
- No repository layer: 44 services inject `PrismaService` directly, and **4 of 39 controllers** bypass services and call Prisma themselves:
  - `libs/api/licensing/src/lib/license/controllers/license.controller.ts:48,145,163,276`
  - `libs/api/licensing/src/lib/auth-endpoints/auth.controller.ts`
  - `libs/api/marketing/src/lib/marketing/controllers/admin-marketing.controller.ts`
  - `libs/api/marketing/src/lib/marketing/controllers/public-marketing.controller.ts`
- Generated Prisma client is committed under `libs/api/core/src/lib/generated-prisma-client/` — acceptable for Prisma 7, but it forces the relative-import exception in the seed script.

### Node extension host / Electron / CLI (`libs/backend`, host apps) — **partially follows**
No framework canon exists here; the project's own conventions (per-lib `di/tokens.ts`, `registration.ts`, `implementations/`) are applied in 20 libs. Divergences:
- `libs/backend/vscode-core` is named and tagged as a VS Code library but is the de facto **infrastructure core for all three hosts** (see Coupling Analysis). Its index re-exports VS Code value-importing wrappers (`api-wrappers/command-manager.ts`, `webview-manager.ts`, `config/config-manager.ts`, `error-handling/error-handler.ts`) next to host-neutral `Logger`, `TOKENS`, `RpcHandler`.
- `libs/backend/cli-engine` holds the CLI container (`src/lib/container.ts`) — a composition root inside a library, while VS Code and Electron keep theirs in `apps/*/src/di/`.
- `libs/shared` contains Angular code under `src/angular/` exposed as `@ptah-extension/shared/angular`, inside a `scope:shared`/`type:util` lib also consumed by Node backends.

### Other apps
- `ptah-tui` (Ink/React): `components/`, `context/`, `hooks/`, `transport/`, `lib/` — idiomatic React layout. Follows.
- `ptah-docs` (Astro Starlight), `ptah-video-studio` (Remotion): standard generator layouts. Follows.

**Overall rating: follows conventions**, with partial adherence in the NestJS data layer and in the naming/placement of backend core libs.

---

## Detected Patterns

| Pattern | Evidence | Confidence |
|---|---|---|
| **Nx layered monorepo (scope × type matrix)** | `eslint.config.mjs:285-420` depConstraints for `scope:{shared,extension,webview,electron,cli,api,web,api-contracts,e2e}` and `type:{app,feature,data-access,ui,util,core,tool}`; import graph has **0** cycles between libraries (Tarjan SCC over 84 libs) | High |
| **Ports & Adapters (Hexagonal) for host platforms** | Ports: 34 interfaces in `libs/backend/platform-core/src/interfaces/` (`file-system-provider.interface.ts`, `secret-storage.interface.ts`, `workspace-provider.interface.ts`, `process-spawner.interface.ts`, …) bound to `PLATFORM_TOKENS` (`platform-core/src/di/tokens.ts:11`, 36 tokens). Adapters: `libs/backend/platform-electron/src/implementations/electron-*.ts` (file system, secret storage, editor, http server, workspace…), `platform-vscode/src/implementations/`, `platform-cli/src/implementations/`, each with `registration.ts` | High |
| **Dependency Injection with tokens (tsyringe)** | `vscode-core/src/di/tokens.ts` (85 `Symbol.for` tokens), `platform-core/src/di/tokens.ts` (36), 20 libs with their own `di/tokens.ts`; `Logger` imported 821× and `TOKENS` 399× across libs | High |
| **Phased composition root** | `apps/ptah-extension-vscode/src/di/phase-0-platform.ts` → `phase-1-infra.ts` → `phase-2-libraries.ts` → `phase-3-handlers.ts` → `phase-4-app.ts`; mirrored in `apps/ptah-electron/src/di/phase-0..4-*.ts`; each guarded by `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts` | High |
| **RPC / message-bus between host and UI** | Backend: `RpcHandler`, `RpcUserError`, `ALLOWED_METHOD_PREFIXES` (`vscode-core/src/messaging`), 112 handler files in `libs/backend/rpc-handlers/src/lib/handlers`, `register-shared-rpc-handlers.ts`, `rpc-allowlist.spec.ts`. Contract: `libs/shared/src/lib/types/rpc.types.ts` (4,224 lines). Transport adapters: `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `apps/ptah-extension-vscode/src/services/rpc`. Frontend: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`, `message-router.service.ts` | High |
| **Multi-provider handler registration (Observer)** | Frontend `MESSAGE_HANDLERS` multi-token (`core/src/lib/services/message-router.types.ts`) collected by `MessageRouterService`; 32 classes `implements MessageHandler` (e.g. `AutopilotStateService`, `PlanLimitsStore`, `GatewayStateService`, `ChangeSetStore`) | High |
| **Signal store / service-with-a-signal (Angular)** | 30+ `*Store` / `*StateService` classes: `chat/src/lib/services/chat.store.ts:69`, `chat-streaming/src/lib/agent-monitor.store.ts:658`, `canvas/src/lib/canvas.store.ts:80`, `marketplace/src/lib/data/marketplace-inventory.store.ts:260`; `signal(` in 320 files, `computed(` 357, `linkedSignal` 19 | High |
| **Component-based UI, smart/presentational split** | `libs/frontend/ui` (`type:ui`, ng-packagr) and `chat-ui` consumed by feature libs; `chat-ui` depends on `core`, `ui`, `markdown`, `chat-types` only | Medium-High |
| **Modular monolith (NestJS)** | `app.module.ts` composes 20+ domain modules from `@ptah-api/{licensing,billing,marketing,admin,audit,membership,member-hub,forum,learning,community}`; shared kernel `@ptah-api/core` (Prisma, Sentry, config); wire contracts in `libs/api-contracts/community` (`scope:api-contracts` depends only on itself) | High |
| **Facade** | `core/src/lib/services/agent-discovery.facade.ts`, `command-discovery.facade.ts`; `HarnessBuilderStateService implements HarnessSurfaceFacade` | Medium |
| **Shim / Anti-corruption layer for `vscode` API** | `libs/backend/cli-engine/src/lib/shims/vscode-shim.ts`, `apps/ptah-electron/src/shims/vscode-shim.ts` — let non-VS Code hosts load libraries that runtime-import `vscode` | High |
| **Worker-process offloading** | `platform-electron/src/implementations/electron-state-storage-worker-{host,loop,protocol,runtime}.ts`; Electron/CLI worker builds (embedder, integrity, workspace-watch-host, voice) | High |
| **Service Locator (anti-pattern alongside DI)** | `container.resolve(...)` / `DI_CONTAINER` used in **73 non-DI files / 232 sites** in `libs/backend`, e.g. `agent-sdk/src/lib/helpers/plugin-loader.service.ts`, `agent-sdk/src/lib/wiring/session-metadata-events.ts`, `agent-generation/src/lib/services/orchestrator.service.ts`, `cli-agent-runtime/src/lib/cli-agents/harness-cli-detector.ts` | High |
| DDD | Not applied. API domains are module-per-feature with anemic Prisma models; no aggregates/value objects. | High (absent) |

---

## Pattern Consistency

### Applied correctly
- **Boundary enforcement is real, not aspirational.** Both tag dimensions are `error`; there is a single eslint suppression in product code, no deep `src/` imports, and the library dependency graph is acyclic. Comment at `eslint.config.mjs:250` records that `rpc-handlers` was retagged `type:util → type:feature` to make the `type:*` rule pass cleanly — the team fixes tags rather than waiving rules.
- **Ports & adapters are symmetric across hosts.** Each `platform-*` lib exposes `registration.ts` + `implementations/` + `settings/`; Electron and VS Code containers follow the same phase-0 → phase-4 order, and smoke specs assert the resolvable surface for each host.
- **Explicit runtime-boundary contract.** `vscode-core/src/di/register-platform-agnostic.ts:4-9` documents that the file "must NOT import `vscode` at runtime. Only `import type` is permitted", separating host-neutral registrations from `di/register.ts` (VS Code only).
- **Modern Angular is uniform.** Standalone + OnPush + `inject()` + signal inputs are near-universal (outliers: 7 constructor-injection files, 1 `@Input`, 8 `NgModule`).
- **API contracts isolated.** `scope:api-contracts` may depend only on itself; `scope:web` cannot reach `scope:api`.

### Where patterns break down
| Violation | Evidence | Impact |
|---|---|---|
| Hexagonal core depends on a host-named library | `vscode-core` is imported by 20 libs and both non-VS Code apps (`apps/ptah-electron/src`: 27 files, `apps/ptah-cli/src`: 2, `libs/backend/cli-engine`: 13). Its barrel `vscode-core/src/index.ts` re-exports `CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager` which value-import `vscode` | Electron/CLI need `vscode-shim.ts` to avoid load-time crashes; any new runtime `import * as vscode` in a re-exported file breaks non-VS Code hosts at runtime, not compile time |
| Cross-cutting infra in the wrong lib | `Logger` (821 imports), `TOKENS`, `RpcHandler`, `SentryService`, `GitInfoService` (`vscode-core/src/services/git-info.service.ts`, 3,864 lines) live in `vscode-core`, not `platform-core` | Every backend lib inherits a VS Code-named dependency for logging |
| Platform leakage into feature libs | Runtime `vscode` imports in `libs/backend/auth-providers/src/lib/providers/copilot/vscode-copilot-auth.service.ts:14` and `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-capabilities.vscode.ts:12` (type-only in `agent-generation/.../webview-lifecycle.service.ts:20`) | These libs are tagged `scope:extension` and are loaded by Electron/CLI via the `scope:electron`/`scope:cli → scope:extension` allowance |
| `scope:extension` doubles as "shared backend" | `eslint.config.mjs`: `scope:electron` and `scope:cli` may import `scope:extension`. Libraries such as `agent-sdk`, `rpc-handlers`, `persistence-sqlite` are host-neutral yet tagged `scope:extension` | The tag no longer expresses "VS Code only"; the rule cannot catch a VS Code-only lib leaking into Electron |
| Service locator inside DI | 232 `container.resolve` sites in 73 non-DI files | Hidden dependencies; constructor signatures understate real coupling; smoke specs are the only safety net |
| Controller → ORM | 4 NestJS controllers inject `PrismaService` directly (listed above) | Business rules split between controllers and services in `licensing` and `marketing` |
| Composition root in a library | `libs/backend/cli-engine/src/lib/container.ts` (fan-out 25 libs, highest in workspace) | CLI wiring is a `type:feature` lib, unlike VS Code/Electron where wiring is in `apps/` |
| Mixed-runtime shared lib | `libs/shared/src/angular/` inside a `scope:shared` util lib used by Node | Angular types become reachable from the backend graph; relies on the sub-entry being imported only by webview code |
| God files | `shared/src/lib/types/rpc.types.ts` (4,224), `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts` (4,158), `vscode-core/src/services/git-info.service.ts` (3,864), `apps/ptah-cli/src/cli/router.ts` (3,350), `rpc-handlers/.../skills-synthesis-rpc.handlers.ts` (3,160), `chat-state/src/lib/tab-manager.service.ts` (3,006), `chat-streaming/src/lib/agent-monitor.store.ts` (2,713), `tasks-ui/.../tasks-store.service.ts` (2,575), `chat/.../provider-setup-wizard.component.ts` (2,388) | SRP violations; high merge-conflict and review cost; `tab-manager.service.ts` is guarded by 10+ dedicated spec files, a symptom of size |

---

## Dependency Flow

### Direction of library dependencies
Static graph (non-spec sources, `@ptah-*` aliases mapped to libraries):

| Highest fan-in (depended on) | Libs | Highest fan-out (depends on) | Libs |
|---|---|---|---|
| `backend/platform-core` | 25 | `backend/cli-engine` | 25 |
| `backend/vscode-core` | 20 | `backend/rpc-handlers` | 22 |
| `frontend/core` | 20 | `frontend/chat` | 11 |
| `frontend/chat-state` | 12 | `backend/cli-agent-runtime` | 9 |
| `api/core` | 12 | `backend/vscode-lm-tools` | 9 |
| `backend/agent-sdk` | 11 | `frontend/tribunal-panel` | 9 |
| `backend/settings-core` | 11 | `backend/gateway-chat-bridge`, `skill-synthesis`, `thoth-runtime`, `frontend/dashboard` | 8 |
| `frontend/ui`, `frontend/chat-types` | 11 each | | |

- **No cycles**: Tarjan SCC finds zero strongly-connected components among libraries; no mutual pairs.
- The stable/abstract libs (`platform-core`, `api/core`, `chat-types`, `ui`) sit at the bottom with high fan-in and low fan-out — correct per the Stable Dependencies Principle.
- `vscode-core` is the exception: high fan-in **and** concrete (value-imports `vscode`). It should be abstract to be that stable.
- `frontend/core` has fan-out 0 to other frontend libs — a clean leaf, despite carrying feature state.

### Hub analysis
- `rpc-handlers` imports: `vscode-core` (282), `shared` (274), `platform-core` (174), `agent-sdk` (113), `settings-core` (42), `auth-providers` (39), `cli-agent-runtime` (36), `agent-generation` (20), `harness-sync` (19), plus 13 more libs. It is the backend's integration layer — expected for an RPC façade, but it is a `type:feature` that knows every other feature.
- `agent-sdk` depends only on `vscode-core` (233), `shared` (158), `platform-core` (55) and four small contract libs — appropriately low-level for its fan-in of 11.
- `frontend/chat` → `chat-ui, chat-state, core, ui, markdown, chat-streaming, chat-types, chat-routing, notification-center, declarative-dashboard, chat-execution-tree` — a feature that aggregates sibling features (allowed by `type:feature → type:feature`).

### Layer boundary assessment
| Boundary | Rule | Status |
|---|---|---|
| webview ↔ backend | `scope:webview` → `shared, webview` only | Clean; contract via `@ptah-extension/shared` RPC types |
| web ↔ api | `scope:web` → `shared, web, api-contracts` | Clean |
| api-contracts | depends on itself only | Clean |
| electron/cli → extension | allowed | Permitted by rule, but semantically the VS Code leakage path (see above) |
| `type:data-access` → `data-access, util` | enforced | Clean (`chat-state`) |
| `type:feature` → `feature` | allowed | Permits feature-to-feature chains (`chat → notification-center`, `rpc-handlers → 20 features`); no cycles today, but the rule offers no protection against lateral sprawl |

---

## Coupling Analysis

### Tight-coupling hotspots
1. **`vscode-core` as universal dependency** — 20 libs + Electron + CLI. Symbols imported: `Logger` (821), `TOKENS` (399), `SentryService` (51), `RpcHandler` (48), `RpcUserError` (31), `IAuthSecretsService` (24), `ConfigManager` (19), `GitInfoService` (14). Any change to its barrel ripples workspace-wide; runtime-safety for non-VS Code hosts depends on shims.
2. **`rpc-handlers`** — 22 library dependencies, 112 handler files, `skills-synthesis-rpc.handlers.ts` at 3,160 lines. Changes in almost any backend feature touch this lib.
3. **`cli-engine`** — fan-out 25; owns the CLI container, adapters, transport and shims together.
4. **`libs/shared/src/lib/types/rpc.types.ts`** — single 4,224-line contract file shared by backend, webview, Electron and CLI. Every RPC addition edits it, creating a merge hotspot.
5. **Global token registries** — `vscode-core/src/di/tokens.ts` (85 tokens) and `platform-core/src/di/tokens.ts` (36) are imported by nearly every backend file; tokens for feature services live in the infrastructure lib instead of with their owners.
6. **Service-locator calls** — 232 `container.resolve` sites make coupling invisible to the import graph.
7. **NestJS controllers on Prisma** — 4 controllers bound to the schema.

### Loose-coupling examples
- `platform-core` interfaces + `PLATFORM_TOKENS` let `agent-sdk`, `persistence-sqlite`, `workspace-intelligence` run unchanged in three hosts; adapters swapped in `phase-0-platform.ts` of each host.
- Small contract libs split from implementations: `memory-contracts` / `memory-curator`, `voice-contracts` / `voice-providers`, `auth-providers-tokens` / `auth-providers` — consumers depend on tokens only (`agent-sdk` uses `auth-providers-tokens` ×10, never `auth-providers`).
- Frontend `MESSAGE_HANDLERS` multi-provider decouples the message router from the 32 stores that consume push messages.
- `libs/api-contracts/community` decouples `libs/web/*` from `libs/api/*`.
- `chat-ui` (presentational) depends only on `core`, `ui`, `markdown`, `chat-types`, `declarative-dashboard`, `chat-streaming` — no dependency on `chat`.

---

## State Management

### Webview / landing (Angular)
- **Primary mechanism: Angular Signals in injectable stores.** `signal(` in 320 files, `computed(` 357, `effect(` 154, `linkedSignal` 19. No NgRx, no `@ngrx/signals`, no `resource()`.
- **RxJS is marginal in `libs/frontend`**: 12 files import `rxjs`; `BehaviorSubject` in 2, `toSignal` in 3. In `libs/web` it is mixed: 42 files with signals, 37 with RxJS (HTTP-driven landing/admin features).
- **Store naming is inconsistent**: `*Store` (`ChatStore`, `CanvasStore`, `AgentMonitorStore`, `MarketplaceInventoryStore`, `NotificationCenterStore`) vs `*StateService` (`AuthStateService`, `ModelStateService`, `CronStateService`, `MemoryStateService`, `SetupWizardStateService`) vs `*Registry` (`ConversationRegistryService`, `SessionLivenessRegistry`) for the same pattern.
- **Server push ingestion** is uniform: stores implement `MessageHandler` and are registered under `MESSAGE_HANDLERS` (32 implementers).
- **Persistence**: `chat-state/src/lib/tab-persistence.ts` (with backoff) and `tab-workspace-partition.service.ts` persist tab state per workspace via RPC.
- **Concern**: very large stores concentrate state (`tab-manager.service.ts` 3,006 lines; `agent-monitor.store.ts` 2,713; `tasks-store.service.ts` 2,575). Feature state also accumulates in `frontend/core` rather than per-feature data-access libs.

### Backend hosts
- Singleton services in tsyringe containers hold in-memory state; durable state goes through `platform-core` storage ports (`state-storage.interface.ts`, `workspace-scoped-state-storage.interface.ts`, `async-state-storage.interface.ts`) with host adapters (Electron uses a worker-process store: `electron-state-storage-worker-*.ts`), plus SQLite via `persistence-sqlite`, and file settings via `platform-core/src/file-settings-manager.ts` (cross-process tested).
- Consistent: every host goes through the same ports.

### License server
- Stateless NestJS + PostgreSQL via Prisma; `@nestjs/event-emitter` and `@nestjs/schedule` for async flows. Consistent.

### TUI
- React context + hooks (`apps/ptah-tui/src/context`, `hooks`; 6 files use `createContext`/`useReducer`). Consistent and idiomatic for Ink.

**Consistency verdict:** high within each runtime (signals in Angular, DI singletons + storage ports in Node). The main inconsistency is naming and placement of stores, not mechanism.

---

## Pattern Comparison

| Area | Uses | Recommended for this stack | Gap |
|---|---|---|---|
| Monorepo | Nx scope × type tags enforced as errors; acyclic lib graph | Nx module boundaries with scope + type tags | Minimal. Clean up duplicate `type:app`/`type:application`; drop transitional `scope:landing`/`scope:app` allowances now that the apps are emptied; add a `scope:backend-shared` (or `platform:node`) tag so host-neutral backend libs are not `scope:extension` |
| Multi-host backend | Ports & adapters via `platform-core` + `platform-{vscode,electron,cli}` | Hexagonal with a host-neutral core; host APIs only in adapters | `vscode-core` mixes host-neutral infra (Logger, TOKENS, RPC, Sentry, Git) with VS Code adapters. Split into a neutral core (or move into `platform-core`) and a VS Code adapter lib; remove the need for `vscode-shim.ts` |
| DI | tsyringe with symbol tokens, phased roots, smoke specs | Constructor injection only; locator restricted to composition roots | 232 `container.resolve` calls in 73 library files; tokens centralised in `vscode-core` rather than owned per lib |
| Composition root | `apps/*/src/di` for VS Code & Electron | Composition in the app | CLI root lives in `libs/backend/cli-engine/src/lib/container.ts` |
| Host ↔ UI comms | Typed RPC with allowlist, handlers per domain, message-router on the client | Typed RPC/contract-first | `rpc.types.ts` should be split per domain (mirroring the 112 handler files); `rpc-handlers` could be split per domain to cut its 22-lib fan-out |
| Angular UI | Standalone, OnPush, signals, `inject()`, signal inputs, feature/ui/data-access/util libs | Same (Angular 17–22 guidance) | Near-full adoption. Gaps: one naming convention for stores; move feature state from `frontend/core` into data-access libs; break up 2–3k-line stores/components; consider `resource()`/`httpResource` for the RxJS-heavy `libs/web` HTTP flows |
| NestJS server | Modular monolith, domain modules, shared `api/core`, contracts lib | Controller → Service → Repository; DTO validation at boundary | No repository/data-access abstraction; 4 controllers call Prisma directly |
| Domain modelling | Anemic models, service-centric | DDD only where domain complexity warrants (billing/licensing could) | Optional; not a priority given current size |
| Size discipline | 9 non-generated files > 2,300 lines | SRP, files typically < 500–800 lines | Largest offenders listed under Pattern Consistency |

### Priority gaps
1. **De-VS-Code the core**: relocate `Logger`, `TOKENS`, `RpcHandler`, `SentryService`, `GitInfoService` out of `vscode-core` into a host-neutral lib; keep `api-wrappers/*` and `register.ts` in a VS Code-only adapter lib tagged so `scope:electron`/`scope:cli` cannot import it.
2. **Retag host-neutral backend libs** so the lint rule can catch VS Code leakage (`auth-providers` Copilot service, `vscode-lm-tools` IDE capabilities).
3. **Reduce service-locator usage** in libraries; inject dependencies explicitly.
4. **Split mega-contracts and mega-files** (`rpc.types.ts`, `protocol-dispatcher.ts`, `git-info.service.ts`, `tab-manager.service.ts`, `cli/router.ts`).
5. **Move Prisma calls out of controllers** in `licensing` and `marketing`.
