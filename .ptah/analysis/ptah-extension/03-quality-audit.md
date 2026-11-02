# 03 — Quality Audit: ptah-extension

> Phase 3. Builds on `01-project-profile.md` and `02-architecture-assessment.md`. Evidence from targeted reads and repository-wide greps over non-generated sources in `apps/` and `libs/`.

---

## Overall Quality Score

**Score: 74 / 100**

Justification: for a ~4,000-file, multi-host TypeScript monorepo, the day-to-day code hygiene is excellent — near-zero `any`, no `@ts-nocheck`, no truly empty catches, uniform modern Angular, enforced module boundaries and an acyclic dependency graph. The score is held down by one high-severity security gap on the local MCP server, a shared-logger defect that silently drops error detail at 40 sites, thin tests on the revenue/identity paths of the license server, and a set of 2.4k–4.2k-line god files.

| Factor | Effect | Evidence |
|---|---|---|
| Type discipline (≈25 real `any`, 1 `@ts-ignore`, `unknown` catches) | ++ | Type Safety |
| Error-handling governance (`tools/degradation-audit` ratchet, justified swallows only) | ++ | Error Handling |
| Framework adoption (standalone/OnPush/signals ≈100%; Nest helmet/validation/throttling; Electron sandboxing) | ++ | Framework Compliance |
| Test volume and structure (2,678 specs, smoke/contract/e2e layers) | + | Test Coverage |
| Unauthenticated localhost MCP server reachable from browsers (S1) | −− | Security S1 |
| `Logger.error` drops context `error`, masked by 40 `as unknown as Error` casts | − | Type Safety / A1 |
| License-server billing/identity/auth specs at 0.3 ratio; low, uneven coverage thresholds | − | Test Coverage |
| `strict: false` base config; `settings-core` non-strict | − | Type Safety |
| God files and a 3,182-line function | − | Anti-Patterns A4 |
| Remote URLs to `shell.openExternal` without scheme check (S2) | − | Security S2 |

### Top fixes by return
1. Authenticate the MCP HTTP server (token + Origin/Host/Content-Type checks) — S1.
2. Fix `Logger.error` merge order and delete the 40 casts; add a spec — A1.
3. Scheme-allowlist `IUserInteraction.openExternal` in every platform adapter — S2.
4. Unit-test license-server guards, `SubscriptionController`, subscription event listener and `auth.controller.ts`.
5. Flip `tsconfig.base.json` to `strict: true`.

---

## File-Level Findings

### `libs/backend/vscode-core/src/logging/logger.ts`
- **Why**: imported 821× across backend libs (Phase 2) — a defect here is a defect everywhere.
- **High** — `error()` (`:156-184`) builds `{ ...actualContext, error: actualError }`, so a context object's own `error` key is overwritten with `undefined` whenever the second argument is not an `Error`. 40 call sites hit exactly this (see Type Safety).
- **Medium** — `Logger` is a concrete class used as the type contract; the CLI registers `CliLoggerAdapter as unknown as Logger` (`libs/backend/cli-engine/src/lib/container.ts:450`), so the adapter is never checked against the contract it replaces. Extract an `ILogger` interface in a host-neutral lib.
- Good: structured `LogContext`, level gating (`shouldLog`), single `logWithContext` funnel.

### `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts`
- **Why**: the only network-listening surface in the desktop/extension hosts; fronts `execute_code` and every `ptah_*` tool.
- **High** — no credential, `Origin`, `Host` or `Content-Type` checks; accepts browser simple requests (S1).
- Good: `MAX_BODY_SIZE` cap with 413, caller identity taken only from the URL with reserved `_caller*` body fields stripped (`:395-410`), early-close abort signal, closed URL grammar pinned by spec.

### `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (4,158 lines)
- **Why**: largest backend file; central tool router.
- **Medium** — god file mixing protocol (initialize/tools/list), tool routing, budgets and approval handling. `approval_prompt` auto-allows when no `WebviewManager` exists (Electron) — a policy decision buried in a router (`:984-1000`).
- **Low** — `args as unknown as ExecuteCodeParams` / `ApprovalPromptParams` (`:976, 986`): tool args are cast, not schema-parsed, at the dispatcher boundary. The RPC layer uses Zod elsewhere (`SmitheryServerKeySchema.parse(params)`), so this is inconsistent.

### `libs/backend/vscode-core/src/services/git-info.service.ts` (3,864 lines)
- **Why**: 14 importers; all git mutations (stage, discard, commit, stash, hunk apply) flow through it.
- **High** — 22 of the 40 lossy `as unknown as Error` log calls.
- **Medium** — SRP: ~110 functions covering status caching, worktrees, diff, hunk apply, branches, stash, tags, remotes. `applyHunksLocked` alone spans `:2154-2501` (~350 lines). Split into `GitStatusReader`, `GitIndexMutator`, `GitHunkApplier`, `GitStashService`, `GitRefsReader` behind the existing facade.
- Good: path validation (`validatePaths`, `validatePathSegment`, `isInsideRoot` `:212-228`), single-flight read cache with generation counters, mutating-command classifier, restore-after-failed-apply logic.

### `apps/ptah-cli/src/cli/router.ts` (3,350 lines)
- **Why**: entry for every CLI command.
- **Medium** — `buildRouter()` is a **single 3,182-line function** (`:167-3349`) that declares every Commander command inline even though handlers already live in `./commands/*.js` (30 modules). Move each command's `.command()/.option()` declarations next to its handler (`registerAgentCommand(program)` etc.).

### `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (3,148 lines)
- **Why**: owns every chat tab's lifecycle; consumed by `chat`, `chat-streaming`, `tribunal-panel`.
- **Medium** — SRP; guarded by 10+ dedicated spec files, a symptom of size. Persistence (`tab-persistence.ts`) and workspace partitioning are already split out — continue with session binding and streaming-state sub-stores.

### `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts` (2,388 lines)
- **Why**: largest component; handles provider secrets.
- **Medium** — a 2.4k-line component (20 signals/computed/effects) mixing wizard state machine and presentation. Extract a `ProviderSetupWizardStore` and per-step presentational components.
- Good: explicit rule in header (`:22`) — never `[innerHTML]`, never render raw errors or secrets.

### `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` (3,160 lines)
- **Why**: largest RPC handler; 47 `registerMethod` calls in one class.
- **Medium** — split per sub-domain (queue, lanes, clones, scorecards), as the other 111 handler files already are.

### `libs/api/licensing/src/lib/auth-endpoints/auth.controller.ts`
- **Why**: authentication endpoints of the paid license server.
- **Medium** — no unit spec; `req.user as any` (`:593`) although `RequestUser` exists in `libs/api/identity/src/lib/interfaces/request-user.interface.ts`; Prisma injected into a controller (Phase 2).

### `libs/api/licensing/src/lib/license/controllers/license.controller.ts` (311 lines)
- **Medium** — three direct Prisma queries in a controller (`:145, 163, 276`); license lookup rules split between controller and `LicenseService`.

### `apps/ptah-extension-vscode/src/main.ts`
- **Medium** — process-wide `unhandledRejection`/`uncaughtException` listeners registered before anything else (`:3-18`); console-only, not scoped to Ptah.
- Good: `reflect-metadata` loaded first; phased DI root (`src/di/phase-0..4`).

### `apps/ptah-electron/src/ipc/ipc-bridge.ts`
- **Low** — `ipcMain.on('rpc', …)` (`:309`) does not check `event.senderFrame.url`; message shape is cast field-by-field (`rpcData['method'] as string | undefined`) rather than schema-parsed. Exposure is limited because only the main window has the preload.

### `libs/backend/settings-core` (53 files)
- **Medium** — compiled without `strict`; spec ratio 0.17; consumed by 11 libs.

### `tools/degradation-audit/check-degradation.ts` (880 lines)
- **Why**: the repo's own control for swallowed errors.
- Strength — AST-based, ratcheted per directory (`baseline.json`, 300 accepted sites in 54 projects), with parse-strict suppression comments and orphan detection.

---

## Anti-Pattern Inventory

| # | Anti-pattern | Location | Severity | Suggested fix |
|---|---|---|---|---|
| A1 | **Cast-to-silence** (`{…} as unknown as Error`) that changes runtime meaning | 40 sites: `git-info.service.ts` (22), `git-rpc.handlers.ts` (7), `cli-engine/src/lib/container.ts` (6), `settings-rpc.handlers.ts` (4), `git/git-remote-sync.ts` (1) | High | Remove casts; fix `Logger.error` merge order; add a spec |
| A2 | **Unauthenticated local service** ("attribution, not authentication") | `vscode-lm-tools/.../mcp-http/http-server.handler.ts` | High | Per-launch token, Origin/Host/Content-Type checks, random port |
| A3 | **Unvalidated external URL hand-off** | `mcp-oauth.service.ts:349`, `mcp-directory-rpc.handlers.ts:1048`, `electron-user-interaction.ts:88` | Medium | Scheme allowlist inside `IUserInteraction.openExternal` |
| A4 | **God function / god file** | `apps/ptah-cli/src/cli/router.ts` `buildRouter` (3,182 lines); `protocol-dispatcher.ts` (4,158); `rpc.types.ts` (4,224); `git-info.service.ts` (3,864); `skills-synthesis-rpc.handlers.ts` (3,160); `tab-manager.service.ts` (3,148); `agent-monitor.store.ts` (2,713); `tasks-store.service.ts` (2,575); `provider-setup-wizard.component.ts` (2,388) | Medium | Split by sub-domain behind existing facades; the file-size rule is `warn` only (`eslint.config.mjs` ~517) — add a stricter ceiling for new files |
| A5 | **Service locator inside DI** | 232 `container.resolve` sites in 73 library files (Phase 2), e.g. `agent-rpc.handlers.ts:812-819` resolving Sentry with an inline structural type | Medium | Constructor injection; restrict `container.resolve` to composition roots via `no-restricted-syntax` |
| A6 | **Concrete class as contract** | `Logger` class cast from `CliLoggerAdapter` (`cli-engine/src/lib/container.ts:450`); fakes cast `as unknown as RealType` in `*.test-support.ts` | Medium | Interfaces for cross-host contracts (`ILogger`), as the `platform-core` ports already do |
| A7 | **Unsafe-by-default compiler config** | `tsconfig.base.json` `strict: false`; `settings-core` and 3 contract libs never opt in | Medium | Flip the base default |
| A8 | **Controller → ORM** | `license.controller.ts:145,163,276`, `auth.controller.ts`, `admin-marketing.controller.ts`, `public-marketing.controller.ts` | Medium | Move queries into services or a repository |
| A9 | **Process-global hooks in a shared host** | `apps/ptah-extension-vscode/src/main.ts:3-18` | Medium | Scope to Ptah stacks; forward to Sentry |
| A10 | **Unparsed arguments at a trust boundary** | `protocol-dispatcher.ts:976,986`; `ipc-bridge.ts:318-325` | Low | Zod-parse, as RPC handlers already do |
| A11 | **Silent UI failure** (comment-only catches on settings save paths) | `libs/frontend/chat/src/lib/settings/pro-features/*.component.ts`, `settings/ptah-ai/*.component.ts` (~12 sites) | Low | Error signal + inline message |
| A12 | **Stray `console.*` in libraries** | 1,034 calls / 244 files (many legitimate in CLI/TUI/preboot) | Low | `no-console` for `libs/**` with an allowlist for worker/preboot entries |
| A13 | **Legacy structural directives** | `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts`, `overlays/dropdown/dropdown.component.ts` | Low | Migrate to `@if/@for` |
| A14 | **Inconsistent store naming** | `*Store` vs `*StateService` vs `*Registry` (Phase 2) | Low | One suffix for signal stores |

---

## Framework Best Practices Compliance

### Angular 22 (webview, landing, `libs/frontend/*`, `libs/web/*`)
| Best practice | Evidence | Status |
|---|---|---|
| Standalone components, no NgModules | 0 `standalone: false`; `NgModule` in 8 files (Phase 2) | Followed |
| `OnPush` everywhere | 425 / 428 components | Followed |
| `inject()` over constructor DI | 416 files vs 7 constructor-injection files | Followed |
| Signal inputs / outputs / model | `input()` in 338 files, `output()` in 252, `model()` in 7; `@Input` 1, `@Output` 0 | Followed |
| Built-in control flow (`@if/@for`) | `@for` in 274 files; `*ngIf/*ngFor` survives only in `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts` and `overlays/dropdown/dropdown.component.ts` | Followed (2 outdated) |
| Zoneless change detection | Webview uses `provideZonelessChangeDetection()` by default with a runtime zone fallback (`apps/ptah-extension-webview/src/app/app.config.ts:139-141`) but still ships `zone.js` in `polyfills` (`project.json:15`). Landing page is zone-based (`provideZoneChangeDetection`). | Partially followed — the fallback keeps zone.js in the bundle; landing could go zoneless |
| No deprecated `allowSignalWrites` | 0 occurrences | Followed |
| Subscription cleanup | 74 files call `.subscribe(`; 30 use `takeUntilDestroyed`, `DestroyRef` in 135 | Mostly followed — spot-check the remaining manual subscriptions in `libs/web/*` |
| `resource()` / `httpResource()` for async reads | 0 usages; `libs/web` still hand-rolls HTTP + RxJS (37 files) | Not adopted (outdated, not a violation) |
| Global `ErrorHandler` | `WebviewErrorHandler` in webview `app.config.ts:151` | Followed (webview); it only `console.error`s — no telemetry hand-off |
| Sanitization (never bypass) | Webview: 0 `bypassSecurityTrust*`; one DOMPurify chokepoint in `libs/frontend/markdown` | Followed |
| Store size / state colocation | `tab-manager.service.ts` 3,148 lines, `agent-monitor.store.ts` 2,713, `tasks-store.service.ts` 2,575; feature state in `frontend/core` | Violated (SRP), see Anti-Patterns |

### NestJS 12 (`ptah-license-server`, `libs/api/*`)
| Best practice | Evidence | Status |
|---|---|---|
| Global validation with whitelist | `ValidationPipe({ whitelist: true, … })` in `apps/ptah-license-server/src/main.ts:66`, plus per-route `dtoPipe(Dto)` | Followed |
| Security middleware | `helmet`, `cookieParser`, CORS pinned to `FRONTEND_URL` (`main.ts:34-76`) | Followed |
| Rate limiting | `@nestjs/throttler` in 38 files; dedicated `AdminThrottlerGuard` | Followed |
| Guards for authz | `JwtAuthGuard`, `AdminGuard`, `AdminApiKeyGuard` (constant-time compare) | Followed |
| Controllers thin; data access in services/repositories | 4 controllers inject `PrismaService` (e.g. `license.controller.ts:145,163,276`) | Violated |
| Typed request user | `identity/src/lib/interfaces/request-user.interface.ts` exists, yet `auth.controller.ts:593` uses `req.user as any` | Violated (locally) |
| Config validation at boot | `JWT_SECRET` throws if unset (`identity.module.ts:70-73`) | Followed |
| Event-driven side effects | `@nestjs/event-emitter` for subscription events (`subscription-event.listener.ts`) — untested | Followed, untested |

### Electron 44 (`apps/ptah-electron`)
| Best practice (Electron security checklist) | Evidence | Status |
|---|---|---|
| `contextIsolation`, `sandbox`, no `nodeIntegration` | `windows/main-window.ts:125-133`, `electron-browser-capabilities.ts:387-390` | Followed |
| Restrict navigation and new windows | `will-navigate` + `setWindowOpenHandler` + `navigation-policy.ts` | Followed |
| Validate `shell.openExternal` input | Not validated on the OAuth / Smithery paths (S2) | Violated |
| Validate the sender of IPC messages | `ipc-bridge.ts:309` (`ipcMain.on('rpc', …)`) does not check `event.senderFrame.url`. Only the main window has a preload today, so exposure is limited; it is defense-in-depth | Partially followed |
| Heavy work off the main process | Worker processes for state storage, embedder, integrity, workspace watch, voice | Followed (strong) |

### VS Code extension API
| Best practice | Evidence | Status |
|---|---|---|
| Webview CSP with nonces, no `unsafe-eval` | `webview-html-generator.ts:280-300` | Followed |
| Lazy activation events | `onWebviewPanel`, `onView`, `onCommand` (Phase 1) | Followed |
| Don't install process-wide handlers in the shared extension host | `apps/ptah-extension-vscode/src/main.ts:3-18` | Violated |
| Disposables tracked | DI-managed managers (`CommandManager`, `WebviewManager`) | Followed |

### Nx 23
- `@nx/enforce-module-boundaries` with scope × type tags as `error`, acyclic graph, CI uses `nx affected` with sharding — **followed**.
- Base tsconfig `strict: false` with per-project opt-in — outdated default (Nx generators now emit strict).
- Type-aware lint (`no-floating-promises`) rejected for performance; compensated by `tools/degradation-audit` — pragmatic deviation, documented in `eslint.config.mjs:503-515`.

### React / Ink (`ptah-tui`) and Remotion (`ptah-video-studio`)
- TUI uses context + hooks idiomatically; 0.25 spec ratio; several comment-only catches in `hooks/use-sessions.ts:280,300,355` and `hooks/use-chat.ts:282` — acceptable for a terminal UI but they hide session-load failures from the user.
- Video studio: no tests (acceptable for a content-rendering tool).

---

## Type Safety Assessment

Population: 3,918 non-spec, non-generated `.ts/.tsx` files under `apps/` and `libs/`.

| Signal | Count | Assessment |
|---|---|---|
| Explicit `any` (`: any`, `any[]`, `<any>`, excluding comments and `__mocks__`) | ~25 real sites in 12 files | Very low. Concentrated in `vscode-lm-tools/.../mcp-core/mcp-response-formatter.ts` (7× `blocks: any[]`), `chrome-launcher-browser-capabilities.ts` (4), `vscode-core/src/api-wrappers/webview-manager.ts` (3) |
| `as any` | 4 product sites | `libs/api/licensing/.../auth.controller.ts:593` (`req.user as any`), `libs/api/identity/.../workos-user.service.ts:230`, `libs/web/admin/.../issue-comp-license-modal.ts:232`; the rest are mocks |
| `as unknown as` (double cast) | **385 sites / 170 files** | The real escape hatch of this codebase. ~40% are in test-support files (`*.test-support.ts`, `testing/`, fakes), which is acceptable. Product hotspots: `vscode-core/src/services/git-info.service.ts` (22), `memory-curator/src/lib/code-symbol.store.ts` (16, `better-sqlite3` transaction typing), `rpc-handlers/.../git-rpc.handlers.ts` (7), `cli-engine/src/lib/container.ts` (7), `api/admin/src/lib/admin.service.ts` (7, Prisma delegate erased to `Record<string, …>` then `as never`) |
| `@ts-ignore` / `@ts-expect-error` | 1 real directive | `workspace-intelligence/src/ast/wasm-bundle-dir.ts:23` (documented `import.meta` / CJS seam). All other hits are prose in rule detectors and prompts |
| `@ts-nocheck` | 0 | — |
| Non-null assertions (`x!.`, `x!)`) | ~85 | Low for the size of the codebase |
| `catch (e: any)` | 0 | `catch` bindings are `unknown` or omitted (959 binding-less `catch {}` clauses) |

### Compiler strictness
- `tsconfig.base.json` sets `"strict": false`; strictness is opted into per project in `tsconfig.lib.json` / `tsconfig.app.json`. Almost all projects opt in.
- **Projects with no `strict: true` anywhere in their tsconfig chain:** `libs/backend/settings-core` (fan-in 11, 53 source files — the settings schema and read/write path every backend lib consumes), `libs/backend/auth-providers-tokens`, `libs/backend/memory-contracts`, `libs/backend/voice-contracts`, `libs/showcase-manifest`, `apps/ptah-docs`, `apps/ptah-license-server-e2e`. The three `*-contracts`/`*-tokens` libs are mostly type declarations, so the practical risk sits in `settings-core`, where `strictNullChecks` is off.
- Fix: flip `tsconfig.base.json` to `strict: true` so the default is safe and an opt-out is the visible exception; failing that, add `strict: true` to `settings-core/tsconfig.lib.json` first.

### Unsafe cast that hides a real defect — **high**
`Logger.error(message, errorOrContext?: Error | Record<string, unknown>)` (`libs/backend/vscode-core/src/logging/logger.ts:156`) treats a non-`Error` second argument as context and then builds `{ ...actualContext, error: actualError }`. **40 call sites** pass a context object that contains an `error` field and force it through `as unknown as Error`:

| File | Sites |
|---|---|
| `libs/backend/vscode-core/src/services/git-info.service.ts` (e.g. `:1194-1198`, `stageFiles`) | 22 |
| `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts` | 7 |
| `libs/backend/cli-engine/src/lib/container.ts` | 6 |
| `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts` | 4 |
| `libs/backend/vscode-core/src/services/git/git-remote-sync.ts` | 1 |

Because the object is not `instanceof Error`, `actualError` is `undefined`, and the spread is followed by `error: actualError`, so **the caller's `error` field is overwritten with `undefined`**. Every one of these failure logs (git stage/commit/push failures, settings writes, CLI container boot) is emitted without its error. The cast was never needed — a plain object literal already satisfies `Record<string, unknown>` — so it only served to silence the reader, not the compiler. Fix: drop the casts and make the logger merge as `{ error: actualError, ...actualContext }` (or only set `error` when defined); add a unit test that a context `error` survives.

### Generic usage quality
- DI resolution is typed at call sites (`container.resolve<T>(TOKEN)`), but the type argument is an unchecked assertion — tokens are bare `Symbol.for(...)` values with no phantom type, so a wrong `T` compiles. Typed tokens (`InjectionToken<T>`-style branded symbols) would move this to compile time; the per-host `container.smoke.spec.ts` / `expected-resolvable.ts` specs currently compensate at test time.
- `agent-rpc.handlers.ts:812-819` resolves Sentry with an inline structural type instead of the exported service type — a pattern that recurs wherever a lib avoids a value import.
- RPC contract (`libs/shared/src/lib/types/rpc.types.ts`) gives end-to-end typed params/results across host ↔ webview, which is the strongest generic design in the repo.

**Verdict:** type hygiene is well above average for a codebase of this size (near-zero `any`, `unknown` catches, almost no suppressions). The weak points are the base `strict: false` default, `settings-core` running non-strict, and the double-cast habit, which in the logger case masks a live bug.

---

## Error Handling Evaluation

### Empty / comment-only catch blocks
| Kind | Count | Notes |
|---|---|---|
| Truly empty `catch {}` (no statement, no comment) | **0** in TS sources | Only hit is a PowerShell string in `agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:184` (`try { … } catch { }` per pid, intentional and documented) |
| Comment-only `catch { // reason }` | ~103 | Almost all carry a one-line justification. Typical and acceptable: `chat/.../app-shell.component.ts:647` (localStorage unavailable), `rpc-handlers/.../agent-rpc.handlers.ts:821` ("Observability must never break an RPC call"). Clusters worth a second look: `frontend/chat/src/lib/settings/**` (≈12 settings panels swallow RPC/save failures with a comment — the user may see no feedback that a save failed), `cli-agent-runtime/.../acp/acp-process-transport.ts:143,301,367`, `tool-output-reducers/.../spool.ts:250,254`, `skill-synthesis/.../spec-extractor.ts:192,196` |
| `.catch(() => undefined)` / `.catch(() => {})` | 59 sites / 41 files | Mostly best-effort cleanup (`unlink(tempPath).catch(() => undefined)` in `agent-generation/.../user-layer-fs-ops.ts:124,149`, `source-hash.ts:109`) and write-chain serialization (`session-metadata-store.ts:1545`, `sdk-agent-adapter.ts:435`) — correct uses. `gateway-chat-bridge.ts:366-369` swallows the enqueue promise, but `runTurn` has its own `try/catch` + reporter, so it is safe |
| `void promise` statements | 843 / 352 files | Explicit fire-and-forget markers. Fine as a convention, but there is no type-aware rule backing it |

### Systemic controls (strong)
- **`tools/degradation-audit/check-degradation.ts`** — an AST inventory of `catch-return-sentinel`, `promise-catch-sentinel`, `empty-catch`, `floating-promise` and malformed/orphaned suppressions, with a **per-directory ratchet** (`baseline.json`: 300 accepted sites across 54 projects; top: `apps/ptah-cli` 29, `frontend/marketplace` 28, `backend/auth-providers` 24, `backend/memory-curator` 20). Suppression requires `// degradation-audit: <kind> — <reason>`. This is an unusually mature control.
- `apps/ptah-electron/src/activation/wire-runtime.ts:205-225` documents the replacement of a silent `.catch(() => undefined)` on the startup boot with a counted `critical` report — evidence that the ratchet is being paid down.
- Webview has a global Angular `ErrorHandler` (`apps/ptah-extension-webview/src/app/app.config.ts:151`, `WebviewErrorHandler`); `MessageRouterService` routes handler throws to `ErrorHandler` (tested in `message-router.service.spec.ts`).
- RPC boundary: `RpcUserError` separates user-facing failures from internal ones; Sentry capture is wrapped so telemetry cannot break a call.

### Gaps
| Severity | Issue | Location | Fix |
|---|---|---|---|
| High | Error detail dropped from 40 failure logs (see Type Safety: `Logger.error` overwrites the context `error` field) | `vscode-core/src/logging/logger.ts:180-183` + 40 call sites | Merge order fix + remove casts |
| Medium | Floating-promise detection is structural and scoped to 3 directories only (`apps/ptah-electron/src`, `thoth-runtime`, `persistence-sqlite`); `@typescript-eslint/no-floating-promises` was rejected for cost (`eslint.config.mjs:503-515`) | Rest of `libs/backend/*`, all of `libs/frontend/*` | Run the type-aware rule in CI only (nightly or affected-only), not in the pre-commit lint |
| Medium | Process-wide `unhandledRejection` / `uncaughtException` listeners in the VS Code extension host only `console.error` | `apps/ptah-extension-vscode/src/main.ts:3-18` | The extension host is shared with other extensions: these listeners also capture foreign extensions' failures and never reach Sentry or the Ptah output channel. Filter by stack origin and forward Ptah's own to `SentryService` once DI is up |
| Low | Comment-only catches in settings panels give no UI feedback on failed saves | `libs/frontend/chat/src/lib/settings/pro-features/*.component.ts`, `settings/ptah-ai/*.component.ts` | Surface an inline error state or toast |
| Low | Raw `console.*` calls: 1,034 sites in 244 files | Mostly CLI/TUI output and Electron preboot code, but also library code that has a `Logger` available | Restrict `no-console` to `libs/**` excluding preboot/worker entry files |

**Verdict:** error handling is deliberate and policed — no silent empty catches, every swallow is justified, and a ratcheting AST audit exists. The one systemic defect is in the shared logger itself.

---

## Security Concerns

| # | Severity | Concern | Location | Mitigation |
|---|---|---|---|---|
| S1 | **High** | **Unauthenticated localhost MCP server is reachable by any web page (CSRF / DNS-rebinding).** The Code-Execution MCP server listens on a predictable port (default `51820`, `http-mcp-server.service.ts:370`), checks no credential (documented at `http-server.handler.ts:264-269`: "attribution, not authentication"), does not validate `Origin`, `Host` or `Content-Type`, and `JSON.parse`s any POST body (`http-server.handler.ts:383-410`). A browser `fetch('http://localhost:51820/', {method:'POST', mode:'no-cors', body: JSON.stringify({jsonrpc:'2.0', id:1, method:'tools/call', params:{name:'execute_code', …}})})` is a CORS "simple request" (`text/plain`, no preflight), so the call executes even though the response is unreadable. `execute_code` exposes the `ptah.*` namespaces (files, git, agent spawn, harness, browser — `namespace-builders/*`); on Electron, `approval_prompt` auto-allows when there is no `WebviewManager` (`protocol-dispatcher.ts:984-1000`). The `Access-Control-Allow-Origin: http://localhost` header (`:343`) does not stop the request; it only hides the reply. Chromium's Local Network Access prompt mitigates part of this in recent Chrome, not in every browser or for DNS rebinding. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts`, `http-mcp-server.service.ts` | (1) Generate a per-launch random bearer token, inject it into the MCP URL/headers handed to spawned agents, reject requests without it. (2) Reject any request carrying an `Origin` header and any `Host` other than `localhost:<port>` / `127.0.0.1:<port>`. (3) Require `Content-Type: application/json`, which forces a preflight from browsers. (4) Use a random port by default |
| S2 | **Medium** | **Remote-supplied URLs reach `shell.openExternal` without a scheme allowlist.** MCP OAuth: `authorization_endpoint` is read from the remote server's metadata (`mcp-oauth-metadata.ts:361`), passed through `new URL()` only (`mcp-oauth.service.ts:538-549`), then opened (`:349`). Smithery `setupUrl` from the remote API is opened as-is (`mcp-directory-rpc.handlers.ts:1048`). On Electron both reach `shell.openExternal` (`electron-user-interaction.ts:88-95`, `activation/bootstrap.ts:255`), which will hand `file:`, `smb:`, `ms-*:` or other registered protocol handlers to the OS — the class of issue Electron's security checklist warns about. The main window already has a scheme-checking `navigation-policy.ts`; this path bypasses it. | `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/*`, `libs/backend/platform-electron/src/implementations/electron-user-interaction.ts` | Enforce `https:` (plus `http://localhost` for loopback) inside `IUserInteraction.openExternal` in every platform adapter, so all callers inherit it; reuse `navigation-policy.ts` |
| S3 | Medium | Process-wide `uncaughtException` / `unhandledRejection` hooks in the shared VS Code extension host | `apps/ptah-extension-vscode/src/main.ts:3-18` | They log other extensions' error text (which may include paths/tokens) to the console under the Ptah prefix. Scope to Ptah-originated stacks |
| S4 | Low | `req.user as any` in an authenticated endpoint; falls back `user.userId \|\| user.id` | `libs/api/licensing/src/lib/auth-endpoints/auth.controller.ts:593-597` | Type `req.user` via a `JwtPayload` interface and a custom `@CurrentUser()` decorator so a payload-shape change fails to compile instead of issuing a ticket for `undefined` |
| S5 | Low | `bypassSecurityTrustHtml` on email bodies | `libs/web/admin/src/lib/marketing/components/email-preview-frame/email-preview-frame.ts:87-92` | Already sanitized (`cleanBody()`) and rendered in a sandboxed iframe per the file header; acceptable. Keep the iframe `sandbox` attribute free of `allow-scripts` + `allow-same-origin` together |
| S6 | Low | `[innerHTML]="block.html"` for streaming markdown blocks | `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:246` | Each block passes DOMPurify before binding (comments `:233-240`); Angular's sanitizer runs too. Acceptable; keep a spec that a `<img onerror>` block is stripped |

### Controls that are in place (verified)
- **License server** (`apps/ptah-license-server/src/main.ts`): `helmet`, `cookie-parser`, global `ValidationPipe({ whitelist: true, … })`, CORS pinned to `FRONTEND_URL`; `@nestjs/throttler` used in 38 API files.
- **Secrets compared in constant time**: `admin-api-key.guard.ts:66` (`timingSafeEqual` over SHA-256 digests), `resend-webhook.guard.ts:75`. Paddle webhooks verified through the SDK's `Webhooks.unmarshal()` (`paddle-webhook.service.ts:45-83`). `JWT_SECRET` has no fallback — boot fails if unset (`identity.module.ts:70-73`).
- **Electron renderer hardening**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` on the main window (`windows/main-window.ts:125-133`) and the automation browser (`electron-browser-capabilities.ts:387-390`); `will-navigate` + `setWindowOpenHandler` with a navigation policy (`main-window.ts:72-80`, `navigation-policy.ts`).
- **VS Code webview CSP**: nonce-only `script-src`, no `unsafe-eval` (`webview-html-generator.ts:280-300`). `style-src 'unsafe-inline'` remains (documented as required).
- **Process spawning**: no `shell: true` anywhere in product code; `cross-spawn` with argument arrays (`cli-adapter.utils.ts`, `cli-user-interaction.ts:152`).
- **`execute_code` sandbox**: runs in a `vm.createContext(Object.create(null))` realm with a blocked `require` (`code-execution.engine.ts:87-175, 401`). Note that `node:vm` is not a security boundary; it contains accidents, not a hostile caller — which is why S1 matters.
- **XSS discipline in Angular**: no `bypassSecurityTrustHtml` in the webview; the codebase documents "never `[innerHTML]`" in ~30 components and routes rendered markdown through one DOMPurify chokepoint (`libs/frontend/markdown`). `semgrep.yml` runs in CI.
- No `eval(` / `new Function(` in product sources outside the sandbox engine.

---

## Test Coverage Analysis

### What is tested
- **Volume**: 2,678 `*.spec|test.ts(x)` files against 3,918 non-spec sources (ratio ≈ 0.68). Most backend and frontend libs sit at 0.5–1.2 specs per source file.
- **Composition-root safety nets**: per-host `container.smoke.spec.ts`, `expected-resolvable.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `rpc-allowlist.spec.ts` — they catch the DI and RPC-registration regressions that the service-locator pattern would otherwise hide.
- **Platform contract tests**: `libs/backend/platform-core/src/testing/contracts/run-http-server-provider-contract.ts` (and siblings) run one behavioural suite against every host adapter — a strong pattern for the ports-and-adapters design.
- **Concurrency/race specs** for the riskiest stateful code: `http-mcp-server.service.concurrency.spec.ts`, cross-process `file-settings-manager` specs, 10+ spec files around `tab-manager.service.ts`, the state-storage worker protocol.
- **E2E layers**: `ptah-extension-vscode-e2e` (`@vscode/test-electron`), `ptah-electron-e2e`, webview e2e via `libs/frontend/webview-e2e-harness`, `cli-e2e.yml`/`jest.e2e.config.cjs` + PTY suite, `ptah-landing-page-e2e` (Playwright + axe), `ptah-license-server-e2e` (`auth-flow`, `license-verify`, `paddle-webhook`), and testcontainers Postgres in `libs/api/billing/src/testing/testcontainers/`.
- **CI**: sharded `nx affected -t test` on PRs (`ci.yml:137-141`) plus a nightly full coverage sweep (`nightly-coverage.yml`). **0** snapshot assertions (`toMatchSnapshot`) — tests assert behaviour, not rendered blobs.

### What is critically untested
| Severity | Gap | Evidence |
|---|---|---|
| High | **Revenue and identity paths in the license server** have the lowest spec ratios of any shipped code: `api/licensing` 0.31, `api/identity` 0.31, `api/billing` 0.36, `api/marketing` 0.19, `api/admin` 0.29. No unit spec for `licensing/.../auth-endpoints/auth.controller.ts`, `billing/.../subscription/subscription.controller.ts`, `billing/.../subscription/events/subscription-event.listener.ts`, `identity/.../guards/admin.guard.ts`, `identity/.../guards/admin-throttler.guard.ts`, `identity/.../services/sync/user-sync.service.ts`, `identity/.../services/workos/workos-user.service.ts` | The three license-server e2e specs cover the happy paths only; guards and subscription state transitions are where authorization and billing bugs live |
| High | **MCP HTTP transport has no hostile-request tests**: `http-server.handler.spec.ts` (43 cases) asserts the CORS header value (`:353`) but nothing about `Origin`, `Host`, `Content-Type` or credentials — consistent with finding S1 | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.spec.ts` |
| Medium | **Logger context merging is untested**: no spec asserts that a context `error` field survives `Logger.error(msg, ctx)`, which is how the 40-site data loss in Type Safety went unnoticed | `libs/backend/vscode-core/src/logging/logger.ts:156-184` |
| Medium | `libs/backend/settings-core` — 46 sources, 8 specs (0.17), **and** non-strict TS; it is the settings read/write path for 11 libs | |
| Medium | `apps/ptah-extension-vscode` — 47 sources, 14 specs (0.30), including `main.ts` global handlers and `webview-html-generator.ts` CSP | |
| Low | Zero specs: `apps/ptah-video-studio` (100 files), `libs/web/landing` (22); low: `libs/web/core` (0.15), `libs/api-contracts/community` (0.10, mostly schemas) | Marketing surfaces — lower risk |

### Test quality
- **Coverage thresholds are uneven**: only 23 of 65 Jest configs set `coverageThreshold`, and where set they are low (`agent-sdk`: 50% statements / 35% branches). The nightly sweep reports coverage but cannot fail most projects.
- Test-support code is well factored (`*.test-support.ts`, `testing/` folders, `fake-sdk-process-spawner.ts`, `mock-rpc-service.ts`), but it is where ~40% of the `as unknown as` casts live — fakes are cast to real types rather than implementing the port interfaces, so a port change does not break the fake at compile time.
- `jest.config` per lib maps `vscode` to a shared `__mocks__/vscode.ts`; the mock itself uses `as any` (`libs/backend/vscode-core/src/__mocks__/vscode-mocks.ts`), so VS Code API drift is invisible to tests.
- Strong specification culture: many specs are named after acceptance criteria / task IDs, and regressions are pinned by dedicated specs (e.g. `apps/ptah-electron/src/activation/wire-runtime.ts` boot-failure reporter).

---

## Strengths

- **Type safety culture**: ≈25 explicit `any` sites in 3,918 product files, one `@ts-ignore` (documented), zero `@ts-nocheck`, zero `catch (e: any)`; Zod at RPC boundaries; a single typed RPC contract shared by host, webview, Electron and CLI.
- **Errors are never silently dropped by accident**: no truly empty `catch {}` in TS sources; every comment-only catch carries a reason; `tools/degradation-audit` inventories swallowed failures by AST and ratchets them per directory with parse-strict suppression markers; past swallows have been replaced by counted `critical` reports (`apps/ptah-electron/src/activation/wire-runtime.ts:205-225`).
- **Architectural guardrails that are enforced, not aspirational**: Nx scope × type boundaries as `error`, acyclic library graph, ports-and-adapters across three hosts with shared contract test suites, phased composition roots guarded by smoke/surface specs.
- **Modern Angular, uniformly**: standalone + OnPush + `inject()` + signal inputs/outputs + built-in control flow at ~100%; zoneless change detection in the webview; one DOMPurify chokepoint and a documented "never `[innerHTML]`" convention across ~30 components.
- **Security fundamentals on the server and desktop**: helmet, whitelisting `ValidationPipe`, pinned CORS, throttling, constant-time secret comparison, SDK-verified Paddle webhooks, fail-fast `JWT_SECRET`; Electron windows sandboxed with context isolation and navigation policy; nonce-only webview CSP; no `shell: true` and argument-array spawning everywhere; semgrep in CI.
- **Testing depth where concurrency bites**: dedicated race/concurrency specs (MCP server, cross-process settings, state-storage worker), e2e suites for every host plus testcontainers Postgres, behavioural assertions with zero snapshot tests, sharded `nx affected` CI plus a nightly coverage sweep.
- **Self-documenting code**: decisions, rejected alternatives and task IDs are recorded next to the code they govern (e.g. `eslint.config.mjs:503-515` on `no-floating-promises`; `http-server.handler.ts:264-269` stating its own trust limits), which made several findings in this audit directly verifiable.
