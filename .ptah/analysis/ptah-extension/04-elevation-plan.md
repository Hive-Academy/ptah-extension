# 04 — Elevation Plan: ptah-extension

> Phase 4. Builds on `01-project-profile.md` and `02-architecture-assessment.md`.
> `03-quality-audit.md` was committed as an empty skeleton (every section is a heading only, score "_Pending._"), so the quality metrics this plan relies on were re-measured in this phase with `git grep` over tracked, non-spec, non-generated sources:
>
> | Metric | Value | Note |
> |---|---|---|
> | `: any` / `as any` | 97 hits in 54 files | Low; top files are mocks (`platform-vscode/__mocks__/vscode.ts` 20, `vscode-core/src/__mocks__/vscode-mocks.ts` 7) and `vscode-lm-tools/.../mcp-core/mcp-response-formatter.ts` (8) |
> | `@ts-ignore` / `@ts-nocheck` | 19 | |
> | `eslint-disable` | 79 | |
> | `console.*` in `libs/backend` | ~263 | Top: `thoth-runtime/src/lib/boot-thoth-runtime.ts` (28), `thoth-runtime/src/lib/start-thoth-cron.ts` (16) — bypasses the `Logger` used 821× elsewhere |
> | `tsconfig.base.json` `strict` | `false` (line 273) | Most projects opt in per-project; 4 libs do not: `auth-providers-tokens`, `memory-contracts`, `settings-core`, `voice-contracts` |
> | Coverage thresholds | Present in a subset of backend `jest.config.ts` (`agent-generation`, `agent-sdk`, `platform-cli`, `platform-core`, `platform-electron`, …) | Not uniform |
>
> Ordering inside each tier: highest impact ÷ effort first. Every item cites the file(s) and pattern from phases 1–2. Verification for every item follows `CLAUDE.md`: scoped `npx nx test|lint|typecheck <project> --parallel=1`, never workspace-wide.

---

## Priority Tier 1: Quick Wins (< 1 hour each)

### 1.1 Re-run and complete the Phase 3 quality audit
- **What / why**: `03-quality-audit.md` contains only headings. Downstream planning (this document included) had to re-derive metrics. A filled audit is the baseline every later tier measures against.
- **Files**: `.ptah/analysis/ptah-extension/03-quality-audit.md`
- **Before**
  ```markdown
  ## Overall Quality Score

  _Pending._
  ```
- **After**
  ```markdown
  ## Overall Quality Score
  7.5 / 10 — strong boundaries (0 lib cycles, scope×type enforced as error),
  low `any` usage (97 hits / 54 files); weaknesses: god files (9 > 2,300 lines),
  232 service-locator sites, vscode-core as universal dependency.
  ```
- **Impact**: Restores the analysis chain; gives a measurable baseline for Tiers 2–4.

### 1.2 Merge duplicate `type:app` / `type:application` tags
- **What / why**: Two `sourceTag` entries express the same rule (`eslint.config.mjs:385` and `:397`). Duplicate tags let a project silently pick the wrong one; one constraint is enough.
- **Files**: `eslint.config.mjs`, any `project.json` carrying `type:application` (find with `git grep -l '"type:application"' -- '**/project.json'`)
- **Before**
  ```js
  { sourceTag: 'type:application',
    onlyDependOnLibsWithTags: ['type:feature','type:data-access','type:ui','type:util'] },
  // ...
  { sourceTag: 'type:app',
    onlyDependOnLibsWithTags: ['type:feature','type:data-access','type:ui','type:util', /* … */] },
  ```
- **After**
  ```js
  { sourceTag: 'type:app',
    onlyDependOnLibsWithTags: ['type:feature','type:data-access','type:ui','type:util', /* … */] },
  ```
  plus `"type:application"` → `"type:app"` in the affected `project.json` files; also drop the bare `angular` tag where `platform:angular` is already present.
- **Impact**: One source of truth for app-level constraints. Skill: **nx-workspace-architect** (tag taxonomy).

### 1.3 Retire the transitional `scope:landing` / `scope:app` allowances
- **What / why**: Phase 2 found the license server only composes `@ptah-api/*` modules (`apps/ptah-license-server/src/app/app.module.ts`) and the landing app keeps only `pages/download`. The "being decomposed" allowances in `eslint.config.mjs` now only widen what can be imported.
- **Files**: `eslint.config.mjs` (`scope:landing`, `scope:app` depConstraints)
- **Before**
  ```js
  // landing app is being decomposed into libs/web/* — temporarily allowed
  { sourceTag: 'scope:landing', onlyDependOnLibsWithTags: ['scope:landing','scope:web','scope:shared','scope:api-contracts', /* transitional */] },
  ```
- **After**
  ```js
  { sourceTag: 'scope:landing', onlyDependOnLibsWithTags: ['scope:web','scope:shared','scope:api-contracts'] },
  ```
- **Impact**: Locks in the completed decomposition; prevents logic drifting back into `apps/`. Verify with `npx nx lint ptah-landing-page` and `npx nx lint ptah-license-server`.

### 1.4 Turn on `strict` in the four non-strict contract libs
- **What / why**: `tsconfig.base.json:273` sets `strict: false`; every other project opts in, but `auth-providers-tokens`, `memory-contracts`, `voice-contracts` and `settings-core` do not. The three `*-contracts`/`*-tokens` libs are the abstractions consumers depend on (Phase 2 "loose-coupling examples"), so they should be the strictest.
- **Files**: `libs/backend/{auth-providers-tokens,memory-contracts,voice-contracts,settings-core}/tsconfig.json`
- **Before**
  ```json
  { "extends": "../../../tsconfig.base.json", "compilerOptions": { } }
  ```
- **After**
  ```json
  { "extends": "../../../tsconfig.base.json", "compilerOptions": { "strict": true } }
  ```
- **Impact**: Contract libs are tiny (6–16 files, 0 specs) so errors are few; prevents `undefined` leaks across every consumer. Verify each with `npx nx typecheck <lib>`.

### 1.5 Route `thoth-runtime` console output through `Logger`
- **What / why**: `boot-thoth-runtime.ts` (28 `console.*`) and `start-thoth-cron.ts` (16) bypass the injected `Logger` (821 imports elsewhere), so their output never reaches the host output channel or Sentry.
- **Files**: `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`, `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`
- **Before**
  ```ts
  console.log('[thoth] booting runtime', opts.workspaceRoot);
  console.error('[thoth] cron failed', err);
  ```
- **After**
  ```ts
  const logger = deps.logger; // Logger injected via TOKENS.LOGGER
  logger.info('[thoth] booting runtime', { workspaceRoot: opts.workspaceRoot });
  logger.error('[thoth] cron failed', err);
  ```
  If a pre-container boot path genuinely has no logger, keep `console.*` there only and document it.
- **Impact**: Diagnosable cron/runtime failures in all three hosts. Follow with an ESLint `no-console` rule scoped to `libs/backend/**` (Tier 2.4).

---

## Priority Tier 2: Small Improvements (1-4 hours each)

### 2.1 Add a host-neutral backend tag so VS Code leakage is lint-detectable
- **What / why**: Phase 2: `scope:electron` and `scope:cli` may import `scope:extension`, and host-neutral libs (`agent-sdk`, `rpc-handlers`, `persistence-sqlite`, …) are tagged `scope:extension`. The rule therefore cannot catch runtime `vscode` imports such as `libs/backend/auth-providers/src/lib/providers/copilot/vscode-copilot-auth.service.ts:14` (`import * as vscode from 'vscode'`).
- **Files**: `eslint.config.mjs`; `project.json` of the 31 `libs/backend/*` libs
- **Before**
  ```js
  { sourceTag: 'scope:electron', onlyDependOnLibsWithTags: ['scope:electron','scope:extension','scope:shared'] },
  ```
- **After**
  ```js
  // host-neutral backend libs: agent-sdk, rpc-handlers, persistence-sqlite, workspace-intelligence, ...
  { sourceTag: 'scope:backend', onlyDependOnLibsWithTags: ['scope:backend','scope:shared'] },
  { sourceTag: 'scope:extension', onlyDependOnLibsWithTags: ['scope:extension','scope:backend','scope:shared'] },
  { sourceTag: 'scope:electron', onlyDependOnLibsWithTags: ['scope:electron','scope:backend','scope:shared'] },
  { sourceTag: 'scope:cli', onlyDependOnLibsWithTags: ['scope:cli','scope:backend','scope:shared'] },
  ```
  Complement with `no-restricted-imports: ['error', { paths: ['vscode'] }]` for `scope:backend` libs (allow `import type`). Start with the tag on libs that have zero runtime `vscode` imports; leave `vscode-core`, `vscode-lm-tools`, `platform-vscode`, `auth-providers` as `scope:extension` until Tier 3.1/4.1.
- **Impact**: Converts the "runtime crash in Electron/CLI" failure mode into a lint error. Skill: **nx-workspace-architect**.

### 2.2 Move Prisma calls out of the 4 NestJS controllers
- **What / why**: `license.controller.ts:48,145,163,276`, `auth.controller.ts`, `admin-marketing.controller.ts`, `public-marketing.controller.ts` inject `PrismaService` directly, splitting business rules between controller and service.
- **Files**: `libs/api/licensing/src/lib/license/controllers/license.controller.ts`, `libs/api/licensing/src/lib/auth-endpoints/auth.controller.ts`, `libs/api/marketing/src/lib/marketing/controllers/{admin,public}-marketing.controller.ts`
- **Before** (`license.controller.ts` ~145)
  ```ts
  @Get('me') @UseGuards(JwtAuthGuard)
  async getMyLicense(@Req() req: Request) {
    const user = req.user as { id: string; email: string };
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!fullUser) return { plan: null, status: 'none', message: 'User not found', checkoutEnabled };
    const license = await this.prisma.license.findFirst({
      where: { userId: user.id, status: 'active' }, orderBy: { createdAt: 'desc' },
    });
    // ...
  ```
- **After**
  ```ts
  @Get('me') @UseGuards(JwtAuthGuard)
  getMyLicense(@Req() req: Request) {
    const user = req.user as AuthenticatedUser;
    return this.licenseQueries.getLicenseSummaryForUser(user.id);
  }

  // license-queries.service.ts
  @Injectable()
  export class LicenseQueriesService {
    constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
    async getLicenseSummaryForUser(userId: string): Promise<LicenseSummaryDto> { /* moved body */ }
  }
  ```
- **Impact**: Controllers become thin and unit-testable without a DB; `licensing` (5 specs) and `marketing` (5 specs) gain service-level tests. Skill: **nestjs-backend-patterns** (layering/repositories).

### 2.3 Unify Angular store naming (`*Store`)
- **What / why**: Phase 2: same pattern named `*Store`, `*StateService`, `*Registry` (`AuthStateService`, `ModelStateService`, `CronStateService` vs `ChatStore`, `CanvasStore`). Pick `*Store` for signal stores that implement `MessageHandler`.
- **Files**: `libs/frontend/core/src/lib/services/{model-state,auth-state,autopilot-state,providers-settings-state,ptah-cli-state}.service.ts`, other `*StateService` classes listed in Phase 2
- **Before**
  ```ts
  @Injectable({ providedIn: 'root' })
  export class ModelStateService implements MessageHandler { /* signals */ }
  ```
- **After**
  ```ts
  @Injectable({ providedIn: 'root' })
  export class ModelStore implements MessageHandler { /* signals */ }
  ```
  Use `ptah.ide.actions.rename` (LSP rename) per class; one class per commit. Document the convention in the frontend `CLAUDE.md`.
- **Impact**: Discoverability across 30+ stores; prepares Tier 3.4. Skill: **angular-frontend-patterns**.

### 2.4 Enforce `no-console` in backend libraries
- **What / why**: ~263 `console.*` calls in `libs/backend` despite a DI `Logger`. After 1.5 removes the largest cluster, lock the rest.
- **Files**: `eslint.config.mjs` (backend override block)
- **Before**: no `no-console` rule for `libs/backend/**`.
- **After**
  ```js
  {
    files: ['libs/backend/**/src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/workers/**', '**/*-worker-*.ts'],
    rules: { 'no-console': ['warn', { allow: [] }] },
  },
  ```
  Start as `warn`, burn down per lib (`npx nx lint <lib>`), then flip to `error`. Exclude worker entry points that write to stdout by protocol (e.g. `electron-state-storage-worker-*.ts`).
- **Impact**: Uniform, Sentry-visible logging across hosts.

### 2.5 Make coverage thresholds uniform for core backend libs
- **What / why**: `coverageThreshold` exists only in some `jest.config.ts` files (`agent-sdk`, `agent-generation`, `platform-*`). High fan-in libs (`vscode-core` fan-in 20, `settings-core` 11, `shared` 112 specs) should not regress silently. Contract libs have 0 specs (`memory-contracts`, `voice-contracts`, `auth-providers-tokens`) — acceptable since they are types/tokens.
- **Files**: `libs/backend/{vscode-core,settings-core,rpc-handlers,persistence-sqlite}/jest.config.ts`, `libs/shared/jest.config.ts`
- **Before**
  ```ts
  export default { displayName: 'vscode-core', preset: '../../../jest.preset.js', /* no threshold */ };
  ```
- **After**
  ```ts
  export default {
    displayName: 'vscode-core', preset: '../../../jest.preset.js',
    coverageThreshold: { global: { lines: <current - 2>, branches: <current - 2> } },
  };
  ```
  Set each to the current measured value minus a small margin (ratchet, not a target). Measured by `nightly-coverage.yml`, not locally.
- **Impact**: Regression guard on the most depended-on libs. Skill: delegate to **senior-tester**.

---

## Priority Tier 3: Medium Efforts (1-2 days each)

### 3.1 Extract host-neutral infra out of `vscode-core` (step 1: `Logger`, `TOKENS`, RPC)
- **What / why**: `vscode-core` is imported by 20 libs + Electron (27 files) + CLI; its barrel (`libs/backend/vscode-core/src/index.ts`) exports `Logger` (821 imports), `TOKENS` (399), `RpcHandler`/`RpcUserError`/`ALLOWED_METHOD_PREFIXES` next to `CommandManager`, `WebviewManager`, `OutputManager`, `StatusBarManager`, `FileSystemManager` which value-import `vscode`. Hence `apps/ptah-electron/src/shims/vscode-shim.ts` and `libs/backend/cli-engine/src/lib/shims/vscode-shim.ts`.
- **Files**: new `libs/backend/backend-core` (or move into `libs/backend/platform-core`); `libs/backend/vscode-core/src/{logging,di/tokens.ts,messaging}`; `vscode-core/src/index.ts`
- **Before** (`vscode-core/src/index.ts`)
  ```ts
  export { TOKENS } from './di/tokens';
  export { Logger } from './logging';
  export { CommandManager, WebviewManager, OutputManager, StatusBarManager, FileSystemManager } from './api-wrappers';
  export { RpcHandler, RpcUserError, ALLOWED_METHOD_PREFIXES } from './messaging';
  ```
  ```ts
  // consumer, e.g. auth-providers
  import { Logger, TOKENS } from '@ptah-extension/vscode-core';
  ```
- **After**
  ```ts
  // libs/backend/backend-core/src/index.ts  (scope:backend, type:core — no 'vscode' import allowed)
  export { TOKENS } from './di/tokens';
  export { Logger } from './logging';
  export { RpcHandler, RpcUserError, ALLOWED_METHOD_PREFIXES } from './messaging';

  // libs/backend/vscode-core/src/index.ts  (scope:extension — VS Code adapters only)
  export { CommandManager, WebviewManager, OutputManager, StatusBarManager, FileSystemManager } from './api-wrappers';
  ```
  ```ts
  import { Logger, TOKENS } from '@ptah-extension/backend-core';
  ```
- **Migration steps**
  1. Create `backend-core` with the Nx lib generator, tags `scope:backend,type:core`, `strict: true`, `no-restricted-imports` for `vscode` (value imports).
  2. `git mv` `vscode-core/src/logging`, `di/tokens.ts`, `messaging/` into it; keep `vscode-core` re-exporting them **temporarily** so the move is a no-op for consumers (single commit, `npx nx test vscode-core` + `npx nx test backend-core`).
  3. Codemod consumers with `ts-morph` (already a devDependency; precedent in `tools/migration`) — rewrite `@ptah-extension/vscode-core` imports of moved symbols to `@ptah-extension/backend-core`, one scope folder per commit.
  4. Remove the temporary re-exports from `vscode-core/src/index.ts`.
  5. Re-run the host smoke specs (`container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`) for `ptah-extension-vscode` and `ptah-electron` individually; the `di-lint` pre-push gate will validate wiring.
- **Impact**: 821 `Logger` imports and 399 `TOKENS` imports stop depending on a VS Code-named lib; prerequisite for 4.1. Skill: **humanize-library** for the split; delegate via **orchestration** (`software-architect` → `backend-developer`).

### 3.2 Split `libs/shared/src/lib/types/rpc.types.ts` (4,224 lines, 180 exported types) per domain
- **What / why**: Single merge hotspot edited by every RPC addition across backend, webview, Electron, CLI. 112 handler files in `rpc-handlers/src/lib/handlers` already define the domain seams.
- **Files**: `libs/shared/src/lib/types/rpc.types.ts` → `libs/shared/src/lib/types/rpc/*.rpc.types.ts`
- **Before**
  ```ts
  // rpc.types.ts (4,224 lines)
  export interface SkillsSynthesisListParams { ... }
  export interface GitStatusParams { ... }
  export interface ChatSendParams { ... }
  // ... 177 more
  export type RpcMethodMap = { 'skills:list': ...; 'git:status': ...; 'chat:send': ...; /* ... */ };
  ```
- **After**
  ```ts
  // rpc/skills.rpc.types.ts
  export interface SkillsSynthesisListParams { ... }
  export type SkillsRpcMethods = { 'skills:list': { params: SkillsSynthesisListParams; result: ... } };

  // rpc/index.ts
  export * from './skills.rpc.types';
  export * from './git.rpc.types';
  export type RpcMethodMap = SkillsRpcMethods & GitRpcMethods & ChatRpcMethods /* & ... */;

  // rpc.types.ts — now a 1-line barrel
  export * from './rpc';
  ```
- **Migration steps**
  1. Group the 180 types by method prefix (the same prefixes as `ALLOWED_METHOD_PREFIXES`).
  2. Move one domain per commit with `ts-morph`; keep `rpc.types.ts` as a barrel so no consumer changes.
  3. Re-compose `RpcMethodMap` as an intersection; `rpc-allowlist.spec.ts` and `rpc-surface.spec.ts` prove nothing was dropped.
  4. `npx nx typecheck shared`, then `npx nx test rpc-handlers --parallel=1`.
- **Impact**: Removes the #1 merge-conflict file; enables per-domain ownership.

### 3.3 Decompose the 2–3k-line backend god files
- **What / why**: `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts` (4,158), `vscode-core/src/services/git-info.service.ts` (3,864), `apps/ptah-cli/src/cli/router.ts` (3,350), `rpc-handlers/.../skills-synthesis-rpc.handlers.ts` (3,160).
- **Files**: as listed
- **Before** (`protocol-dispatcher.ts`, shape)
  ```ts
  export class ProtocolDispatcher {
    async dispatch(req: McpRequest) {
      switch (req.method) {
        case 'tools/list': /* 150 lines */
        case 'tools/call': /* 600 lines */
        case 'resources/list': /* ... */
        // ...
      }
    }
  }
  ```
- **After**
  ```ts
  // mcp-core/methods/tools-call.method.ts
  export const toolsCallMethod: McpMethod<'tools/call'> = { name: 'tools/call', handle: async (req, ctx) => { /* ... */ } };

  // protocol-dispatcher.ts (< 300 lines)
  const METHODS = new Map([toolsListMethod, toolsCallMethod, resourcesListMethod].map(m => [m.name, m]));
  export class ProtocolDispatcher {
    dispatch(req: McpRequest) {
      const m = METHODS.get(req.method);
      return m ? m.handle(req, this.ctx) : mcpMethodNotFound(req);
    }
  }
  ```
  Same table-of-handlers split applies to `cli/router.ts` (one file per command group) and `skills-synthesis-rpc.handlers.ts` (one handler class per method prefix, as the other 111 handler files already are). `git-info.service.ts` splits into `GitStatusReader`, `GitLogReader`, `GitDiffReader` behind the existing `GitInfoService` facade.
- **Migration steps** (per file, one file per PR)
  1. Pin behaviour: confirm existing specs pass (`npx nx test vscode-lm-tools`), add characterization tests for any untested branch.
  2. Extract handlers mechanically (no logic changes), keep the original class as facade.
  3. Run the lib's tests; for `cli/router.ts` also run `npx nx test ptah-cli`.
- **Impact**: Review cost and conflict rate drop; each method/command becomes independently testable. Skill: **humanize-library** (behaviour-preserving split); **resilient-nestjs-patterns** has the "splitting a complex service" pattern applicable to the facade approach.

### 3.4 Decompose the frontend mega-stores and move feature state out of `frontend/core`
- **What / why**: `chat-state/src/lib/tab-manager.service.ts` (3,006; guarded by 10+ spec files), `chat-streaming/src/lib/agent-monitor.store.ts` (2,713), `tasks-ui/.../tasks-store.service.ts` (2,575), `chat/.../provider-setup-wizard.component.ts` (2,388). Separately, `frontend/core` (fan-in 20) holds feature state (`model-state`, `auth-state`, `autopilot-state`, `plan-limits.store`, `providers-settings-state`, `ptah-cli-state`).
- **Files**: as listed; new `libs/frontend/*-data-access` libs (tag `type:data-access`)
- **Before**
  ```ts
  @Injectable({ providedIn: 'root' })
  export class TabManagerService {
    readonly tabs = signal<Tab[]>([]);
    // persistence, workspace partitioning, ordering, streaming attach, closing, restore … 3,006 lines
  }
  ```
- **After**
  ```ts
  @Injectable({ providedIn: 'root' }) export class TabCollectionStore { readonly tabs = signal<Tab[]>([]); /* add/remove/reorder */ }
  @Injectable({ providedIn: 'root' }) export class TabRestoreService { private readonly tabs = inject(TabCollectionStore); /* restore/persist via tab-persistence.ts */ }
  @Injectable({ providedIn: 'root' }) export class TabStreamingBinder { /* attach/detach streams */ }

  // Facade keeps the public API stable for consumers
  @Injectable({ providedIn: 'root' }) export class TabManagerService {
    private readonly col = inject(TabCollectionStore);
    readonly tabs = this.col.tabs;
    // delegates
  }
  ```
- **Migration steps**
  1. Map the existing 10+ `tab-manager*.spec.ts` files to responsibilities; they become the split plan.
  2. Extract one collaborator per commit behind the unchanged `TabManagerService` facade; `npx jest -c libs/frontend/chat-state/jest.config.ts --maxWorkers=2`.
  3. Repeat for `agent-monitor.store.ts` and `tasks-store.service.ts`.
  4. Create `libs/frontend/settings-data-access` (or per-feature data-access libs); move the six `core` state services there, renamed per 2.3; update imports with LSP rename/`ts-morph`.
  5. `npx nx lint` on each changed frontend lib to confirm `type:data-access → data-access, util` holds.
- **Impact**: `frontend/core` returns to a true core; stores stay under ~800 lines. Skill: **angular-frontend-patterns**, **humanize-library**.

### 3.5 Move the CLI composition root into `apps/ptah-cli`
- **What / why**: `libs/backend/cli-engine/src/lib/container.ts` has the highest fan-out in the workspace (25 libs) and is a composition root inside a `type:feature` lib, unlike VS Code/Electron which keep `apps/*/src/di/phase-0..4-*.ts`.
- **Files**: `libs/backend/cli-engine/src/lib/container.ts` → `apps/ptah-cli/src/di/phase-{0..4}-*.ts`
- **Before**
  ```ts
  // libs/backend/cli-engine/src/lib/container.ts
  export function createCliContainer() {
    registerPlatformCli(container); registerAgentSdk(container); registerRpcHandlers(container); /* 22 more */
    return container;
  }
  ```
- **After**
  ```ts
  // apps/ptah-cli/src/di/container.ts
  import { registerPhase0Platform } from './phase-0-platform';
  // ...
  export function createCliContainer() {
    registerPhase0Platform(container); registerPhase1Infra(container); registerPhase2Libraries(container);
    registerPhase3Handlers(container); registerPhase4App(container);
    return container;
  }
  ```
- **Migration steps**
  1. Copy the phase layout and `container.smoke.spec.ts` / `expected-resolvable.ts` pattern from `apps/ptah-electron/src/di`.
  2. Move registrations; keep `cli-engine` exporting adapters, transport and shims only.
  3. `npx nx test ptah-cli --parallel=1`, `npx nx test cli-engine --parallel=1`; pre-push `di-lint` validates.
- **Impact**: Same wiring model across all three hosts; `cli-engine` fan-out drops sharply.

---

## Priority Tier 4: Large Initiatives (1+ week each)

### 4.1 Complete the "de-VS-Code the core" migration and delete the `vscode-shim`s
- **What / why**: After 3.1, remaining `vscode-core` content that non-VS Code hosts consume (`SentryService`, `GitInfoService`, `IAuthSecretsService`, `ConfigManager`, `ErrorHandler`) must become host-neutral or move behind `platform-core` ports, and feature libs must stop runtime-importing `vscode` (`auth-providers/.../vscode-copilot-auth.service.ts:14`, `vscode-lm-tools/.../namespace-builders/ide-capabilities.vscode.ts:12`). End state: `apps/ptah-electron/src/shims/vscode-shim.ts` and `libs/backend/cli-engine/src/lib/shims/vscode-shim.ts` are deleted.
- **Files**: `libs/backend/vscode-core/src/{services,config,error-handling}`, `libs/backend/platform-core/src/interfaces/`, `libs/backend/platform-{vscode,electron,cli}/src/implementations/`, the two `vscode-shim.ts` files, the two feature-lib files above
- **Before**
  ```ts
  // auth-providers/.../copilot/vscode-copilot-auth.service.ts
  import * as vscode from 'vscode';
  const session = await vscode.authentication.getSession('github', scopes, { silent: true });
  ```
- **After**
  ```ts
  // platform-core/src/interfaces/host-auth-session.interface.ts
  export interface IHostAuthSessionProvider { getGithubSession(scopes: string[]): Promise<HostAuthSession | undefined>; }

  // platform-vscode/src/implementations/vscode-host-auth-session.ts  (only place that imports vscode)
  // platform-electron / platform-cli: return undefined → base-class device-code flow

  // auth-providers (now scope:backend)
  constructor(@inject(PLATFORM_TOKENS.HOST_AUTH_SESSION) private readonly hostAuth: IHostAuthSessionProvider) {}
  const session = await this.hostAuth.getGithubSession(scopes);
  ```
- **Migration steps**
  1. Inventory every runtime `vscode` import outside `vscode-core/api-wrappers`, `platform-vscode` and `apps/ptah-extension-vscode` (`git grep -n "from 'vscode'" -- 'libs/**/*.ts' ':!*.spec.ts'`, excluding `import type`).
  2. For each, add a `platform-core` port + three adapters (pattern already proven by 34 existing ports).
  3. Move `SentryService`, `ConfigManager`, `ErrorHandler` into `backend-core` with ports for VS Code-specific behaviour.
  4. Split `GitInfoService` (after 3.3) into `backend-core` (host-neutral git CLI reader).
  5. Retag freed libs `scope:backend` (2.1); `vscode-core` becomes `scope:extension` only, unreachable from `scope:electron`/`scope:cli` by lint.
  6. Delete both `vscode-shim.ts` files; run Electron and CLI smoke specs and the `validate-deps` pre-push gate.
- **Dependencies / prerequisites**: 2.1 (tag), 3.1 (backend-core), 3.3 (`git-info.service.ts` split), 3.5 (CLI root in app).
- **Risk assessment**
  | Risk | Likelihood | Mitigation |
  |---|---|---|
  | Runtime crash in Electron/CLI from a missed `vscode` import | Medium | Lint rule from 2.1 + Electron E2E (`electron-e2e.yml`) + `cli-e2e.yml` before shim deletion |
  | DI resolution failures after token moves | Medium | Existing `container.smoke.spec.ts` / `expected-resolvable.ts` per host; `di-lint` pre-push |
  | Long-lived branch conflicts with feature work | High | Ship as many small PRs (one port per PR); never a single migration branch |
- **Impact**: Hexagonal architecture becomes enforceable rather than conventional; removes a whole class of host-only runtime bugs. Skill: **orchestration** (architect → team-leader → backend-developer, reviewed by code-logic-reviewer); **ddd-architecture** is *not* needed here.

### 4.2 Replace library-level service locator calls with constructor injection
- **What / why**: 232 `container.resolve` / `DI_CONTAINER` sites in 73 non-DI files (`agent-sdk/.../plugin-loader.service.ts`, `agent-sdk/.../wiring/session-metadata-events.ts`, `agent-generation/.../orchestrator.service.ts`, `cli-agent-runtime/.../harness-cli-detector.ts`). Hidden dependencies make constructors lie and leave the smoke specs as the only safety net.
- **Files**: the 73 files; `tools/di-lint` (extend)
- **Before**
  ```ts
  export function wireSessionMetadataEvents() {
    const store = container.resolve<SessionMetadataStore>(SDK_TOKENS.SESSION_METADATA_STORE);
    const logger = container.resolve<Logger>(TOKENS.LOGGER);
    store.onChange(e => logger.debug('meta', e));
  }
  ```
- **After**
  ```ts
  @injectable()
  export class SessionMetadataEventsWiring {
    constructor(
      @inject(SDK_TOKENS.SESSION_METADATA_STORE) private readonly store: SessionMetadataStore,
      @inject(TOKENS.LOGGER) private readonly logger: Logger,
    ) {}
    wire(): void { this.store.onChange(e => this.logger.debug('meta', e)); }
  }
  // resolved once in apps/*/src/di/phase-4-app.ts
  ```
  For genuinely lazy/optional dependencies use an injected factory token (`() => T`) instead of the global container.
- **Migration steps**
  1. Add a `di-lint` (or ESLint `no-restricted-syntax`) check that flags `container.resolve` outside `**/di/**`, `apps/*/src/di/**`, `**/registration.ts`; start as a baseline allowlist of the current 232 sites so new ones fail.
  2. Burn down by lib, highest count first; one lib per PR; `npx nx test <lib> --parallel=1`.
  3. Remove allowlist entries as they are fixed; flip to zero-tolerance.
- **Dependencies / prerequisites**: none hard; easier after 3.1 (tokens in `backend-core`) and 3.5 (CLI root in app).
- **Risk assessment**
  | Risk | Likelihood | Mitigation |
  |---|---|---|
  | Circular constructor dependencies surfaced by explicit injection | Medium | tsyringe `delay()` or factory tokens; these cycles exist today, just hidden |
  | Registration order changes (singleton created earlier) | Low-Medium | Phased roots already order registration; smoke specs per host |
- **Impact**: Real dependency graph visible to tooling and reviewers; unit tests no longer need a global container.

### 4.3 Split `rpc-handlers` per domain to cut its 22-lib fan-out
- **What / why**: `rpc-handlers` (358 files, fan-out 22, imports `vscode-core` 282×, `agent-sdk` 113×) is a `type:feature` that knows every other feature; any backend change touches it.
- **Files**: `libs/backend/rpc-handlers/src/lib/handlers/*` (112 files), `register-shared-rpc-handlers.ts`, `rpc-allowlist.spec.ts`
- **Before**
  ```ts
  // register-shared-rpc-handlers.ts
  registerSkillsSynthesisRpcHandlers(c); registerGitRpcHandlers(c); registerChatRpcHandlers(c); /* 100+ */
  ```
- **After**
  ```ts
  // each feature lib owns its handlers, e.g. libs/backend/skill-synthesis/src/rpc/register-skills-rpc.ts
  export function registerSkillsRpc(c: DependencyContainer) { /* ... */ }

  // apps/*/src/di/phase-3-handlers.ts composes them
  registerSkillsRpc(container); registerGitRpc(container); registerChatRpc(container);
  ```
- **Migration steps**
  1. Prerequisite 3.2 (per-domain RPC types) so each handler group imports only its domain types.
  2. Move handler groups into the owning feature lib (or a `<feature>-rpc` lib if the feature lib must stay RPC-agnostic), one domain per PR.
  3. Keep `rpc-allowlist.spec.ts` and `rpc-surface.spec.ts` green per host after each move.
  4. Once empty, delete `rpc-handlers` or keep it as the shared `RpcHandler` plumbing only.
- **Dependencies / prerequisites**: 3.1, 3.2, 2.1.
- **Risk assessment**
  | Risk | Likelihood | Mitigation |
  |---|---|---|
  | Missing handler registration in one host | Medium | `rpc-surface.spec.ts` / `surface-composition.spec.ts` per host |
  | Feature-to-feature imports increase (`type:feature → feature` allowed) | Medium | Handlers depend on contracts/tokens libs only; add review checklist item |
- **Impact**: Backend changes become local to their domain; parallel teams stop colliding in one lib.

---

## Summary Matrix

| # | Item | Tier | Effort | Impact | Files |
|---|------|------|--------|--------|-------|
| 1.1 | Complete Phase 3 quality audit | 1 | < 1h | Medium | `.ptah/analysis/ptah-extension/03-quality-audit.md` |
| 1.2 | Merge `type:app`/`type:application` tags | 1 | < 1h | Low-Medium | `eslint.config.mjs:385,397`, `project.json`s |
| 1.3 | Retire transitional `scope:landing`/`scope:app` allowances | 1 | < 1h | Medium | `eslint.config.mjs` |
| 1.4 | `strict: true` in 4 contract/core libs | 1 | < 1h | Medium | `libs/backend/{auth-providers-tokens,memory-contracts,voice-contracts,settings-core}/tsconfig.json` |
| 1.5 | `thoth-runtime` console → `Logger` | 1 | < 1h | Medium | `thoth-runtime/src/lib/boot-thoth-runtime.ts`, `start-thoth-cron.ts` |
| 2.1 | `scope:backend` tag + `vscode` import ban | 2 | 2-4h | High | `eslint.config.mjs`, 31 backend `project.json` |
| 2.2 | Prisma out of 4 NestJS controllers | 2 | 2-4h | Medium-High | `libs/api/licensing/.../license.controller.ts`, `auth.controller.ts`, `libs/api/marketing/.../*-marketing.controller.ts` |
| 2.3 | Unify store naming to `*Store` | 2 | 2-4h | Medium | `libs/frontend/core/src/lib/services/*-state.service.ts` |
| 2.4 | `no-console` for `libs/backend` | 2 | 1-3h | Medium | `eslint.config.mjs` |
| 2.5 | Coverage ratchet on high fan-in libs | 2 | 1-2h | Medium | `libs/backend/{vscode-core,settings-core,rpc-handlers,persistence-sqlite}/jest.config.ts`, `libs/shared/jest.config.ts` |
| 3.1 | Extract `Logger`/`TOKENS`/RPC into `backend-core` | 3 | 1-2d | High | `libs/backend/vscode-core/src/{index.ts,logging,di/tokens.ts,messaging}` |
| 3.2 | Split `rpc.types.ts` per domain | 3 | 1-2d | High | `libs/shared/src/lib/types/rpc.types.ts` |
| 3.3 | Decompose backend god files | 3 | 1-2d each | Medium-High | `protocol-dispatcher.ts`, `git-info.service.ts`, `apps/ptah-cli/src/cli/router.ts`, `skills-synthesis-rpc.handlers.ts` |
| 3.4 | Decompose frontend mega-stores; feature state out of `core` | 3 | 1-2d each | Medium-High | `tab-manager.service.ts`, `agent-monitor.store.ts`, `tasks-store.service.ts`, `libs/frontend/core/src/lib/services` |
| 3.5 | CLI composition root into `apps/ptah-cli` | 3 | 1-2d | Medium | `libs/backend/cli-engine/src/lib/container.ts`, `apps/ptah-cli/src/di/` |
| 4.1 | De-VS-Code the core; delete `vscode-shim`s | 4 | 2-3w | Very High | `vscode-core`, `platform-*`, `auth-providers/.../vscode-copilot-auth.service.ts`, `vscode-lm-tools/.../ide-capabilities.vscode.ts`, both `vscode-shim.ts` |
| 4.2 | Replace 232 `container.resolve` sites with constructor DI | 4 | 1-2w | High | 73 files in `libs/backend` (e.g. `agent-sdk/.../plugin-loader.service.ts`, `wiring/session-metadata-events.ts`), `tools/di-lint` |
| 4.3 | Split `rpc-handlers` per domain | 4 | 1-2w | High | `libs/backend/rpc-handlers/src/lib/handlers/*`, `register-shared-rpc-handlers.ts` |

### Recommended sequence
1. Tier 1 (all) → 2.1 → 2.4 → 2.2 → 2.3 → 2.5
2. 3.1 → 3.2 → 3.5 → 3.3 / 3.4 (parallelizable, file-disjoint)
3. 4.1 (needs 2.1, 3.1, 3.3, 3.5) and 4.2 (independent, incremental) → 4.3 (needs 3.1, 3.2)

Run Tier 3–4 items through the **orchestration** skill (architect → team-leader batches → developers → code-logic/code-style reviewers), respecting the `CLAUDE.md` rule of one heavy scoped check at a time.
