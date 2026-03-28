# Requirements Document - TASK_2025_233: Sentry Integration

## Introduction

Ptah is an AI coding orchestra distributed across four distinct runtimes: a VS Code extension (Node.js), an Electron desktop app, an Angular 20 webview SPA, and a NestJS license server. Today, error visibility is limited to local console logs and the VS Code `ErrorHandler` class in `vscode-core`. There is no centralized error tracking, no alerting on regressions, and no performance telemetry for key operations like RPC calls, agent sessions, or API requests.

Integrating Sentry across all four applications will provide:

- **Centralized error visibility** -- unhandled exceptions, promise rejections, and explicitly captured errors flow to a single dashboard
- **Performance tracing** -- quantify RPC round-trip times, API latency, agent session durations, and chat message handling
- **Release health** -- correlate errors with specific extension/server versions and track regression rates
- **Source-mapped stack traces** -- readable traces for minified Angular and Electron renderer bundles

The landing page (`ptah-landing-page`) is explicitly out of scope.

---

## Scope Boundaries

### In Scope

| Area                               | Details                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Error capture                      | Unhandled exceptions, promise rejections, explicit `captureException` calls in all 4 runtimes |
| Performance tracing                | Sentry transactions/spans for RPC, API, agent SDK, chat message pipelines                     |
| Source map upload                  | Angular webview production build, Electron renderer (if separate bundle)                      |
| Privacy scrubbing                  | `beforeSend` hook stripping PII, API keys, user code content                                  |
| Opt-in telemetry                   | User-facing setting to disable Sentry entirely                                                |
| DSN configuration                  | Per-runtime DSN injection (env var, VS Code setting, build-time, Electron config)             |
| Existing error handler integration | Wire Sentry into `vscode-core/ErrorHandler` and Angular `WebviewErrorHandler`                 |
| Release tagging                    | Attach extension/app version + environment to every event                                     |

### Out of Scope

| Area                                | Rationale                                               |
| ----------------------------------- | ------------------------------------------------------- |
| Landing page (`ptah-landing-page`)  | Not a production application for end users              |
| Session replay / screen recording   | Privacy concern; not needed for debugging               |
| User feedback widget                | Adds UI complexity; can be added later                  |
| Custom Sentry dashboards / alerts   | Post-integration operational concern                    |
| Backward-compatible Sentry wrappers | Each app integrates directly; no abstraction library    |
| Profiling (continuous)              | Sentry profiling is heavy; tracing spans are sufficient |

---

## Requirements

### Requirement 1: VS Code Extension Error Capture (`ptah-extension-vscode`)

**User Story:** As the Ptah development team, I want unhandled exceptions and explicitly captured errors from the VS Code extension host to appear in Sentry, so that I can diagnose production issues without requiring user-submitted logs.

**Runtime:** Node.js (VS Code extension host process)
**SDK:** `@sentry/node`
**Entry point:** `apps/ptah-extension-vscode/src/main.ts` (`activate()`)

#### Acceptance Criteria

1. WHEN the extension activates THEN Sentry SHALL be initialized before any other service, using `@sentry/node` with DSN from VS Code setting `ptah.telemetry.sentryDsn` (fallback to a hardcoded production DSN)
2. WHEN the user sets `ptah.telemetry.enabled` to `false` THEN Sentry SHALL NOT initialize and SHALL NOT send any events
3. WHEN an unhandled exception or promise rejection occurs in the extension host THEN Sentry SHALL capture the error with stack trace, extension version, and environment tag
4. WHEN `ErrorHandler.handleError()` is called in `vscode-core` THEN the error SHALL be forwarded to `Sentry.captureException()` with the `ErrorContext` as Sentry context (service, operation, metadata)
5. WHEN a performance-sensitive operation starts (RPC call dispatch, agent session creation, SDK streaming) THEN a Sentry transaction/span SHALL be created and finished when the operation completes
6. WHEN any Sentry event is about to be sent THEN a `beforeSend` hook SHALL strip: API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), file paths containing user workspace content, user email addresses, and any header values
7. WHEN the extension deactivates THEN `Sentry.close()` SHALL be called to flush pending events

#### Technical Constraints

- **Lazy initialization**: Sentry MUST be initialized asynchronously after `activate()` begins, NOT at module import time, to avoid slowing extension host startup
- **Bundle impact**: `@sentry/node` MUST be listed in `external` in the esbuild config (`project.json`) since it uses native Node.js APIs that should not be bundled
- **Extension host isolation**: VS Code extension host runs multiple extensions; Sentry's global error handlers must not interfere with other extensions. Use `Sentry.init({ integrations: [] })` to disable default global handlers if needed, and rely on explicit capture via the `ErrorHandler` integration

---

### Requirement 2: Electron Desktop App Error Capture (`ptah-electron`)

**User Story:** As the Ptah development team, I want crash reports and error events from the Electron main process and renderer process to appear in Sentry, so that I can diagnose desktop-app-specific issues.

**Runtime:** Electron (main process: Node.js, renderer: Chromium)
**SDK:** `@sentry/electron`
**Entry point (main):** `apps/ptah-electron/src/main.ts` (before `app.whenReady()`)
**Entry point (renderer):** Angular webview bootstrap (shared with Requirement 3)

#### Acceptance Criteria

1. WHEN the Electron app starts THEN `@sentry/electron` SHALL be initialized in the main process BEFORE `app.whenReady()` with DSN from environment variable `SENTRY_DSN` or a hardcoded production DSN
2. WHEN an unhandled exception or native crash occurs in the main process THEN Sentry SHALL capture it with process type (`main`), app version, OS info, and architecture
3. WHEN an error occurs in the renderer process THEN the renderer's Sentry client (Angular integration, Requirement 3) SHALL capture it with process type (`renderer`)
4. WHEN the user configures telemetry opt-out (stored in Electron's global state storage via `PLATFORM_TOKENS.STATE_STORAGE` key `ptah.telemetry.enabled`) THEN Sentry SHALL NOT send events from either process
5. WHEN a Sentry event is about to be sent THEN the same privacy scrubbing rules from Requirement 1 SHALL apply
6. WHEN the app quits (`will-quit` event) THEN `Sentry.close()` SHALL be called to flush pending events

#### Technical Constraints

- `@sentry/electron` provides both main and renderer integration; for the renderer, the Angular-specific hooks (Requirement 3) supplement the base Electron renderer integration
- `@sentry/electron` MUST be added to the `external` array in `apps/ptah-electron/project.json` (esbuild config) since it uses native Electron APIs
- The preload script (`preload.ts`) MUST NOT import Sentry directly; Sentry hooks for the renderer are loaded in the Angular app context

---

### Requirement 3: Angular Webview Error Capture (`ptah-extension-webview`)

**User Story:** As the Ptah development team, I want Angular-specific errors (component lifecycle, change detection, template errors) from the webview to appear in Sentry with Angular context, so that I can diagnose UI issues.

**Runtime:** Browser (Chromium webview in VS Code or Electron renderer)
**SDK:** `@sentry/angular`
**Entry point:** `apps/ptah-extension-webview/src/app/app.config.ts` (Angular providers)

#### Acceptance Criteria

1. WHEN the Angular application bootstraps THEN `@sentry/angular` SHALL be initialized with DSN retrieved from the host environment (VS Code: via RPC call to get config; Electron: via `window.ptahConfig`)
2. WHEN initialization occurs THEN `Sentry.createErrorHandler()` SHALL replace the current `WebviewErrorHandler` in `app.config.ts` while preserving the existing CSP and History API error suppression logic
3. WHEN an Angular component throws during lifecycle or template rendering THEN Sentry SHALL capture the error with Angular component name and route (signal-based view name)
4. WHEN an HTTP/RPC call fails THEN a Sentry breadcrumb SHALL be recorded with the RPC method name (not the payload)
5. WHEN a Sentry event is about to be sent THEN the privacy scrubbing rules SHALL strip any user code content embedded in error messages and any chat message text
6. WHEN running in development mode (`environment.production === false`) THEN Sentry SHALL NOT be initialized (only log to console)

#### Technical Constraints

- The webview runs inside a VS Code webview panel OR an Electron BrowserWindow. The DSN delivery mechanism differs:
  - **VS Code context**: Request DSN from extension host via RPC (e.g., `config:getSentryDsn`)
  - **Electron context**: Read from `window.ptahConfig.sentryDsn` (injected via preload)
- Source maps MUST be uploaded to Sentry for production builds. The Angular build (`@angular/build:application`) does NOT generate source maps in production by default. The build pipeline must:
  1. Enable source maps for production builds (`sourceMap: { scripts: true, hidden: true }`)
  2. Upload them via `@sentry/cli` or `@sentry/webpack-plugin` as a post-build step
  3. NOT include source maps in the distributed package (hidden source maps)
- The `@sentry/angular` package provides `TraceDirective` and `TraceModule` for component-level tracing; evaluate whether this adds value given the webview's signal-based navigation (no Angular Router)

---

### Requirement 4: License Server Error Capture (`ptah-license-server`)

**User Story:** As the Ptah development team, I want API errors, unhandled exceptions, and request performance data from the license server to appear in Sentry, so that I can monitor server health and debug production issues.

**Runtime:** Node.js (NestJS 11)
**SDK:** `@sentry/nestjs` (or `@sentry/node` with NestJS-specific integrations)
**Entry point:** `apps/ptah-license-server/src/main.ts` (before `NestFactory.create()`)

#### Acceptance Criteria

1. WHEN the NestJS application bootstraps THEN Sentry SHALL be initialized BEFORE `NestFactory.create()` with DSN from environment variable `SENTRY_DSN`
2. WHEN an unhandled exception occurs in any controller or service THEN Sentry SHALL capture it with request context (HTTP method, URL, status code -- NO request body, NO auth headers)
3. WHEN an HTTP request is processed THEN Sentry SHALL create a transaction with the NestJS route pattern (e.g., `POST /api/v1/licenses/verify`) and record timing
4. WHEN a Prisma database query fails THEN Sentry SHALL capture the error with the query operation name (NOT the SQL or parameters)
5. WHEN a Paddle webhook is processed THEN the transaction SHALL be tagged with `webhook: true` and the event type
6. WHEN the `SENTRY_DSN` environment variable is not set THEN Sentry SHALL NOT initialize (no-op in local development)
7. WHEN any Sentry event is about to be sent THEN the `beforeSend` hook SHALL strip: authorization headers, JWT tokens, license keys, user emails, database connection strings, and request bodies

#### Technical Constraints

- `@sentry/nestjs` (Sentry v8+) provides `SentryModule.forRoot()` for NestJS integration, including automatic HTTP transaction tracing and exception capture. Prefer this over manual `@sentry/node` setup
- The license server uses `ConfigModule.forRoot({ isGlobal: true })` -- DSN should be loaded via `ConfigService.get('SENTRY_DSN')`
- The global `ThrottlerGuard` and `ValidationPipe` are already registered. Sentry's global exception filter must be compatible (typically registered with lower priority)
- Production builds use esbuild with `sourcemap: false`. Source maps should be enabled for production and uploaded to Sentry, then excluded from the Docker image
- The server runs on DigitalOcean; `SENTRY_DSN` will be added as an environment variable in `.do/app.yaml`

---

### Requirement 5: Privacy and Data Scrubbing

**User Story:** As a Ptah user, I want assurance that my code, API keys, and personal information are never sent to third-party error tracking services, so that my privacy is protected.

#### Acceptance Criteria

1. WHEN any Sentry event is constructed THEN the `beforeSend` callback SHALL remove/redact:
   - API keys (any string matching `sk-*`, `key-*`, or known env var names)
   - File path segments containing user workspace directories
   - Email addresses (regex match)
   - Authorization header values
   - Request/response bodies
   - Chat message content and user prompts
   - License keys
   - Database connection strings
2. WHEN Sentry SDK data scrubbing (`sendDefaultPii: false`) is configured THEN default PII (IP address, user agent with OS info beyond what is needed) SHALL NOT be sent
3. WHEN error messages contain user code snippets (common in template/parser errors) THEN the message SHALL be truncated to the first 200 characters with `[truncated]` suffix

#### Implementation Guidance

Create a shared `beforeSend` function in a utility file that all four runtimes import. This is the ONE piece of shared infrastructure justified by the requirement to apply identical scrubbing rules everywhere.

**Suggested location:** `libs/shared/src/lib/telemetry/sentry-scrubber.ts`

This file:

- Exports a `createBeforeSend()` factory function
- Takes a configuration object (runtime-specific patterns to scrub)
- Returns a Sentry `beforeSend` callback
- Has zero Sentry SDK dependency (operates on plain event objects)

---

### Requirement 6: Telemetry Opt-In/Opt-Out

**User Story:** As a Ptah user, I want to control whether error and performance data is sent to Sentry, so that I have agency over my telemetry footprint.

#### Acceptance Criteria

1. WHEN using the VS Code extension THEN `ptah.telemetry.enabled` (boolean, default: `true`) SHALL control Sentry initialization. The setting SHALL be added to `contributes.configuration` in `apps/ptah-extension-vscode/package.json`
2. WHEN using the Electron app THEN the telemetry preference SHALL be stored in global state storage (`ptah.telemetry.enabled` key) and exposed in the settings UI
3. WHEN the user changes the telemetry setting THEN the change SHALL take effect on next restart (Sentry cannot be re-initialized at runtime without side effects)
4. WHEN the license server starts THEN telemetry SHALL be controlled by the `SENTRY_ENABLED` environment variable (default: `true` in production, `false` in development)
5. WHEN the VS Code global telemetry setting (`telemetry.telemetryLevel`) is `off` THEN Ptah SHALL also disable Sentry regardless of `ptah.telemetry.enabled`

---

## Non-Functional Requirements

### Performance Requirements

- **Extension host startup impact**: Sentry initialization MUST add less than 50ms to extension activation time. Achieve this by lazy-loading `@sentry/node` after critical services are initialized
- **Memory overhead**: Sentry SDK MUST NOT increase baseline memory by more than 5MB in the extension host or Electron main process
- **Event throughput**: Sentry SHOULD use a sample rate of 0.1 (10%) for performance transactions in production to limit volume. Error events should have 1.0 sample rate (capture all errors)
- **Bundle size (webview)**: `@sentry/angular` adds ~30-40KB gzipped. This MUST stay within the existing budget of 2.2MB max initial bundle (`project.json` budget)

### Security Requirements

- **DSN protection**: Sentry DSNs are NOT secrets (they are client-side identifiers) but should not be committed in source code comments. Store in VS Code settings, environment variables, or build-time injection
- **No PII**: `sendDefaultPii: false` on all Sentry clients
- **Data scrubbing**: The `beforeSend` hook is the last line of defense; Sentry's server-side data scrubbing should also be configured in the Sentry project settings

### Reliability Requirements

- **Graceful degradation**: If Sentry initialization fails (network error, invalid DSN), the application MUST continue functioning normally. All Sentry calls must be wrapped in try-catch or use the SDK's built-in no-op behavior
- **No runtime dependency**: The application MUST work identically whether Sentry is enabled or disabled. Zero behavioral changes based on Sentry state

### Scalability Requirements

- **Rate limiting**: Use Sentry's `maxBreadcrumbs: 50` and `tracesSampleRate: 0.1` to avoid flooding the Sentry quota
- **Event deduplication**: Enable Sentry's built-in dedup integration to collapse repeated errors

---

## Technical Architecture Decisions

### SDK Selection Per Runtime

| App                    | SDK Package              | Rationale                                                       |
| ---------------------- | ------------------------ | --------------------------------------------------------------- |
| ptah-extension-vscode  | `@sentry/node` (v8+)     | Standard Node.js SDK; no browser or Electron APIs needed        |
| ptah-electron (main)   | `@sentry/electron` (v5+) | Handles main process, native crashes, preload context           |
| ptah-extension-webview | `@sentry/angular` (v8+)  | Angular-specific error handler, component tracing               |
| ptah-license-server    | `@sentry/nestjs` (v8+)   | NestJS module with automatic HTTP tracing and exception filters |

### DSN Configuration Strategy

| App                    | DSN Source                                 | Mechanism                                                                                         |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| ptah-extension-vscode  | VS Code setting `ptah.telemetry.sentryDsn` | `vscode.workspace.getConfiguration('ptah.telemetry').get('sentryDsn')`, fallback to hardcoded DSN |
| ptah-electron          | Environment variable `SENTRY_DSN`          | `process.env['SENTRY_DSN']`, fallback to hardcoded DSN                                            |
| ptah-extension-webview | Injected by host                           | VS Code: RPC `config:getSentryDsn`; Electron: `window.ptahConfig.sentryDsn`                       |
| ptah-license-server    | Environment variable `SENTRY_DSN`          | `ConfigService.get('SENTRY_DSN')` via NestJS ConfigModule                                         |

### Shared Infrastructure

**Minimal sharing** -- only the `beforeSend` scrubber is shared. Each app has its own Sentry initialization because:

- SDKs differ per runtime
- Configuration sources differ
- Integration hooks differ (NestJS modules vs Angular providers vs tsyringe DI)
- Keeping initialization colocated with each app makes the integration auditable and maintainable

### Source Map Upload Strategy

| App                    | Build Tool  | Source Map Strategy                                                                                                                       |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ptah-extension-vscode  | esbuild     | Enable `sourcemap: true` in production config, upload via `@sentry/cli` post-build, exclude `.map` files from `.vsix` via `.vscodeignore` |
| ptah-electron (main)   | esbuild     | Enable `sourcemap: true` in production config, upload via `@sentry/cli` post-build, exclude `.map` files from electron-builder            |
| ptah-extension-webview | Angular CLI | Enable `sourceMap: { scripts: true, hidden: true }` in production config, upload via `@sentry/cli` post-build                             |
| ptah-license-server    | esbuild     | Enable `sourcemap: true` in production config, upload via `@sentry/cli` post-build, exclude `.map` files from Docker image                |

### Tracing Instrumentation Targets

| App                    | Operations to Trace                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ptah-extension-vscode  | RPC handler dispatch (`rpc-handler.ts`), agent session lifecycle, SDK streaming, command execution                              |
| ptah-electron          | IPC bridge dispatch, workspace restoration, plugin loading                                                                      |
| ptah-extension-webview | RPC calls to host, chat message send/receive, view navigation changes                                                           |
| ptah-license-server    | HTTP request/response cycle (automatic via NestJS integration), Prisma queries, Paddle webhook processing, license verification |

---

## Dependencies

### NPM Packages to Add

| Package            | Version | Target                            |
| ------------------ | ------- | --------------------------------- |
| `@sentry/node`     | ^8.x    | ptah-extension-vscode             |
| `@sentry/electron` | ^5.x    | ptah-electron                     |
| `@sentry/angular`  | ^8.x    | ptah-extension-webview            |
| `@sentry/nestjs`   | ^8.x    | ptah-license-server               |
| `@sentry/cli`      | ^2.x    | devDependency (source map upload) |

### Build Configuration Changes

1. **ptah-extension-vscode** (`project.json`): Add `@sentry/node` to `external` array in esbuild config
2. **ptah-electron** (`project.json`): Add `@sentry/electron` to `external` array in esbuild config
3. **ptah-extension-webview** (`project.json`): Enable hidden source maps in production build config
4. **ptah-license-server** (`project.json`): Enable source maps in production build config (currently disabled)

### Infrastructure

- **Sentry project**: Create 4 Sentry projects (one per app) under a single Sentry organization
- **Sentry auth token**: Generate org-level auth token for source map upload (CI secret)
- **CI pipeline**: Add source map upload step after build in GitHub Actions

---

## Risk Assessment

| Risk                                       | Probability | Impact   | Mitigation                                                                                       |
| ------------------------------------------ | ----------- | -------- | ------------------------------------------------------------------------------------------------ |
| Extension host startup regression (>50ms)  | Medium      | High     | Lazy-load Sentry after critical init; benchmark with `console.time`                              |
| Privacy data leak via Sentry               | Low         | Critical | Comprehensive `beforeSend` scrubbing; automated tests for scrubber; Sentry server-side scrubbing |
| Bundle size exceeds webview budget         | Low         | Medium   | Monitor with Angular budget checks; `@sentry/angular` is ~35KB gzipped                           |
| Sentry SDK conflicts with VS Code host     | Low         | High     | Use explicit integration list (`integrations: []`); test with other extensions active            |
| Source map upload breaks CI                | Medium      | Low      | Make upload a non-blocking CI step; builds succeed even if upload fails                          |
| `@sentry/electron` version incompatibility | Medium      | Medium   | Pin to a specific minor version; test with the Electron version used in `electron-builder.yml`   |

---

## Estimated Effort

| Component                               | Effort   | Notes                                                                                   |
| --------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Shared scrubber utility (`libs/shared`) | 2h       | `beforeSend` factory + unit tests                                                       |
| VS Code extension integration           | 4h       | Init in `main.ts`, wire into `ErrorHandler`, add VS Code setting, esbuild externals     |
| Electron integration                    | 4h       | Main process init, renderer DSN injection via preload, state-based opt-out              |
| Angular webview integration             | 3h       | Replace `WebviewErrorHandler`, DSN retrieval from host, production build source maps    |
| License server integration              | 3h       | NestJS `SentryModule`, env config, Prisma error context, Docker/deploy config           |
| Source map upload pipeline              | 3h       | CI step for all 4 apps, auth token setup, `.vscodeignore` / electron-builder exclusions |
| Testing and validation                  | 3h       | Verify events appear in Sentry, test opt-out, test scrubbing, test graceful degradation |
| **Total**                               | **~22h** | ~3 developer days                                                                       |

---

## Success Criteria

1. Unhandled exceptions in all 4 runtimes appear in Sentry within 30 seconds with readable stack traces
2. Performance transactions for RPC calls, API requests, and agent sessions appear in Sentry with timing data
3. No PII, API keys, or user code content appears in any Sentry event (verified by manual inspection of 50+ test events)
4. Extension host activation time does not regress by more than 50ms (measured via `console.time` in CI)
5. Webview bundle size stays within the 2.2MB budget
6. Telemetry opt-out completely disables all Sentry event transmission
7. All 4 apps function identically with Sentry disabled (DSN unset or opt-out enabled)

---

## Implementation Sequence (Recommended)

1. **Phase 1**: Shared scrubber utility + unit tests
2. **Phase 2**: License server (simplest runtime, fastest feedback loop for verifying Sentry events)
3. **Phase 3**: VS Code extension (core ErrorHandler integration)
4. **Phase 4**: Angular webview (depends on DSN delivery from Phase 3)
5. **Phase 5**: Electron app (combines main process + renderer patterns from Phases 3 and 4)
6. **Phase 6**: Source map upload CI pipeline
7. **Phase 7**: End-to-end validation across all runtimes
