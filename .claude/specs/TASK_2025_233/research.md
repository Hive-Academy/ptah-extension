# Sentry Integration Research Report -- TASK_2025_233

**Date**: 2026-03-28
**Researcher**: Research Expert Agent
**Confidence Level**: 90% (based on 20+ sources including official docs, GitHub issues, npm registry)
**Status**: COMPLETE

---

## 1. Executive Summary

Ptah requires Sentry integration across 4 distinct runtimes: VS Code extension host (Node.js), Electron (main + renderer), Angular webview (browser), and NestJS license server. Each runtime has different SDK requirements and initialization constraints. The key strategic insight is that the VS Code extension host is a **shared environment** where standard `Sentry.init()` must NOT be used -- a manual client approach is required to avoid global state pollution with other extensions.

All `@sentry/*` JavaScript packages version together at **v10.x** (current latest: 10.44.0 as of 2026-03-28). The `@sentry/electron` package versions independently at **7.x** (latest: 7.7.1).

---

## 2. Recommended Packages and Versions

| Runtime               | Package                  | Version    | Notes                                                  |
| --------------------- | ------------------------ | ---------- | ------------------------------------------------------ |
| VS Code Extension     | `@sentry/node`           | `^10.44.0` | Manual client instantiation only -- no `Sentry.init()` |
| Electron Main         | `@sentry/electron`       | `^7.7.1`   | Wraps `@sentry/node` for main process                  |
| Electron Renderer     | `@sentry/electron`       | `^7.7.1`   | Combined with `@sentry/angular` init                   |
| Angular Webview       | `@sentry/angular`        | `^10.44.0` | Supports Angular 14-20+, standalone components         |
| NestJS Server         | `@sentry/nestjs`         | `^10.44.0` | Dedicated NestJS integration with auto-instrumentation |
| Source Maps (esbuild) | `@sentry/esbuild-plugin` | `^4.9.0`   | For extension, electron main, license server           |
| Source Maps (CLI)     | `@sentry/cli`            | latest     | Fallback for Angular CLI builds                        |

### Important Version Constraint

All `@sentry/*` packages from the JavaScript monorepo (`@sentry/node`, `@sentry/angular`, `@sentry/nestjs`, `@sentry/browser`) MUST be the same version. Mixing versions causes runtime conflicts. The `@sentry/electron` package versions independently.

---

## 3. Per-Runtime Initialization Patterns

### 3.1 VS Code Extension Host (Node.js)

**CRITICAL CONSTRAINT**: The VS Code extension host is a **shared environment**. Multiple extensions run in the same Node.js process and share global state. Using `Sentry.init()` pollutes the global `__SENTRY__` variable and conflicts with other extensions that also use Sentry.

**Known Issue (GitHub #9543)**: The global `__SENTRY__` variable causes the second extension using Sentry to crash or send events to the wrong project.

**Known Issue (GitHub #14840)**: Using Sentry with VS Code extensions can cause CPU and memory overload in the extension host.

**Recommended Approach -- Manual Client Instantiation**:

```typescript
// libs/shared or a new sentry utility
import { NodeClient, Scope, makeNodeTransport, defaultStackParser } from '@sentry/node';

let sentryClient: NodeClient | undefined;
let sentryScope: Scope | undefined;

export function initSentryForExtension(dsn: string, release: string): void {
  sentryClient = new NodeClient({
    dsn,
    release,
    environment: process.env.NODE_ENV || 'production',
    transport: makeNodeTransport,
    stackParser: defaultStackParser,
    // NO integrations that use global state
    integrations: [],
    // Disable performance tracing in extension host (too expensive)
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubPII(event);
    },
  });

  sentryScope = new Scope();
  sentryScope.setClient(sentryClient);
  sentryClient.init();
}

export function captureExtensionException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryClient || !sentryScope) return;
  if (context) {
    sentryScope.setContext('ptah', context);
  }
  sentryScope.captureException(error);
}

export function destroySentryClient(): void {
  sentryClient?.close();
  sentryClient = undefined;
  sentryScope = undefined;
}
```

**Initialization Point**: In `apps/ptah-extension-vscode/src/main.ts`, after DI container setup but before heavy service initialization. Call `destroySentryClient()` in the `deactivate()` function.

**Lazy Initialization**: Yes, Sentry can be lazily initialized. Defer initialization until after extension activation completes to avoid slowing down startup. The manual client approach naturally supports this since no global hooks are installed.

**Performance Considerations**:

- Set `tracesSampleRate: 0` to disable performance monitoring entirely in the extension host
- Disable all default integrations (no breadcrumbs, no global error handlers, no HTTP instrumentation)
- Use manual `captureException()` calls only in try/catch blocks
- Call `client.close()` in `deactivate()` to flush pending events

### 3.2 Electron App (Main + Renderer)

The Ptah Electron app uses Electron 35 with `contextIsolation: true` and a preload script. The `@sentry/electron` SDK (v7.x) supports Electron >= 23.0.0, so Electron 35 is fully supported.

**Main Process** (`apps/ptah-electron/src/main.ts`):

```typescript
// MUST be first import after reflect-metadata
import * as Sentry from '@sentry/electron/main';

Sentry.init({
  dsn: '__DSN__',
  release: `ptah-electron@${app.getVersion()}`,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubPII(event);
  },
});
```

**Preload Script** (`apps/ptah-electron/src/preload.ts`):

```typescript
// Add near the top of the preload script
import '@sentry/electron/preload';
```

This is necessary because `contextIsolation: true` means Sentry cannot automatically capture errors from the preload context without this explicit import.

**Renderer Process** (Angular webview, combined with `@sentry/angular`):

```typescript
import { init as sentryElectronInit } from '@sentry/electron/renderer';
import { init as sentryAngularInit } from '@sentry/angular';

sentryElectronInit(
  {
    dsn: '__DSN__',
    release: `ptah-electron@${/* version from ptahConfig */}`,
    tracesSampleRate: 0.1,
  },
  sentryAngularInit  // Pass Angular init as second parameter to combine SDKs
);
```

**Native Crash Reporting**: The `@sentry/electron` SDK automatically captures native crashes (minidumps) via Electron's built-in `crashReporter`. When any Electron process crashes, the SDK uploads minidumps on next restart (or immediately for renderer crashes). The default `SentryMinidump` integration provides full context with breadcrumbs and user data. No additional configuration needed.

**Source Maps for Renderer**: The renderer loads the Angular webview build via `file://` protocol from the `renderer/` directory. Source maps need to be embedded or uploaded to Sentry with the correct release tag.

### 3.3 Angular Webview (Browser -- VS Code + Electron)

The Ptah webview uses Angular 21.2.6 (in `package.json`) with `provideZoneChangeDetection({ eventCoalescing: true })` -- this is zone-BASED, not zoneless, despite the CLAUDE.md references to zoneless.

`@sentry/angular` officially supports Angular 14 to 20+. The SDK provides standalone-compatible provider functions.

**Initialization** (`apps/ptah-extension-webview/src/main.ts`):

```typescript
import * as Sentry from '@sentry/angular';

Sentry.init({
  dsn: '__DSN__',
  release: 'ptah-webview@__VERSION__',
  environment: window.ptahConfig?.isElectron ? 'electron' : 'vscode',
  tracesSampleRate: 0.1,
  integrations: [Sentry.browserTracingIntegration()],
  beforeSend(event) {
    return scrubPII(event);
  },
});
```

**IMPORTANT**: For the Electron renderer, do NOT call `Sentry.init()` from `@sentry/angular` directly. Instead use the combined `@sentry/electron/renderer` + `@sentry/angular` pattern from section 3.2. For the VS Code webview, the Angular init is used directly but may need adaptation since VS Code webviews are also a constrained environment (sandboxed iframe with CSP).

**VS Code Webview Constraint**: The webview runs inside a sandboxed iframe with a strict Content Security Policy. The `@sentry/angular` browser SDK sends events via XHR/fetch which may be blocked by CSP. Two options:

1. Add Sentry's ingest domain to the CSP `connect-src` directive in the webview HTML generator
2. Use the RPC bridge to relay errors from the webview to the extension host for reporting

Option 2 (RPC bridge) is recommended to avoid CSP issues and reduce the number of Sentry clients. The webview would capture errors locally and send them to the extension host via the existing RPC layer, where the extension's Sentry client reports them.

**Angular Provider Configuration** (`app.config.ts`):

```typescript
import { ErrorHandler } from '@angular/core';
import { createErrorHandler, TraceService } from '@sentry/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    // Replace WebviewErrorHandler with Sentry's error handler
    { provide: ErrorHandler, useValue: createErrorHandler({ showDialog: false }) },
    // TraceService for performance (optional -- skip for VS Code webview)
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {},
      deps: [TraceService],
      multi: true,
    },
    // ... existing providers
  ],
};
```

**Zoneless Compatibility**: The current codebase uses `provideZoneChangeDetection` (zone-based). If migrated to zoneless in the future, `@sentry/angular`'s `TraceService` should still work since it uses `APP_INITIALIZER` and does not depend on Zone.js internals for error capture. The `createErrorHandler` is framework-agnostic and works with both zone and zoneless Angular apps.

### 3.4 NestJS License Server

The `@sentry/nestjs` package provides first-class NestJS integration with automatic HTTP instrumentation, exception filter integration, and performance tracing.

**Step 1: Create `instrument.ts`** (MUST be imported before any other modules):

```typescript
// apps/ptah-license-server/src/instrument.ts
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node'; // optional

Sentry.init({
  dsn: '__DSN__',
  release: `ptah-license-server@${process.env.npm_package_version}`,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.2,
  integrations: [
    // nodeProfilingIntegration(),  // optional profiling
  ],
  beforeSend(event) {
    return scrubPII(event);
  },
});
```

**Step 2: Import in `main.ts`** (FIRST import):

```typescript
// apps/ptah-license-server/src/main.ts
import './instrument'; // MUST be first import

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// ... rest of imports
```

**Step 3: Add SentryModule to AppModule**:

```typescript
import { SentryModule } from '@sentry/nestjs/setup';

@Module({
  imports: [
    SentryModule.forRoot(),
    // ... other modules
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter, // from '@sentry/nestjs/setup'
    },
  ],
})
export class AppModule {}
```

**Automatic Instrumentation Provided**:

- HTTP request/response spans via OpenTelemetry
- NestJS controller/guard/interceptor spans via `@opentelemetry/instrumentation-nestjs-core`
- Database spans (if Prisma instrumentation is added)
- Custom spans via `@SentryTraced()` decorator
- Cron monitoring via `@SentryCron()` decorator (useful for trial reminder cron jobs)

**Exception Filter Behavior**: `SentryGlobalFilter` catches unhandled exceptions and reports them to Sentry. `HttpException` and its derivatives are NOT captured by default (they are control flow, not bugs). This is correct behavior for an API server.

---

## 4. Source Map Upload Strategy

### 4.1 Overview

| App               | Bundler                                           | Source Map Plugin         | Upload Trigger      |
| ----------------- | ------------------------------------------------- | ------------------------- | ------------------- |
| VS Code Extension | esbuild (Nx)                                      | `@sentry/esbuild-plugin`  | CI production build |
| Electron Main     | esbuild (Nx)                                      | `@sentry/esbuild-plugin`  | CI production build |
| Electron Preload  | esbuild (Nx)                                      | `@sentry/esbuild-plugin`  | CI production build |
| Angular Webview   | `@angular/build:application` (esbuild internally) | `sentry-cli` (post-build) | CI production build |
| License Server    | esbuild (Nx)                                      | `@sentry/esbuild-plugin`  | CI production build |

### 4.2 esbuild Plugin Configuration (Extension, Electron, License Server)

For projects using `@nx/esbuild:esbuild`, the `@sentry/esbuild-plugin` can be configured in the Nx `project.json`:

```json
{
  "targets": {
    "build-esbuild": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "plugins": [
          {
            "path": "@sentry/esbuild-plugin",
            "options": {
              "org": "ptah",
              "project": "ptah-extension-vscode",
              "authToken": "${SENTRY_AUTH_TOKEN}",
              "release": { "name": "${SENTRY_RELEASE}" },
              "sourcemaps": {
                "filesToDeleteAfterUpload": ["./dist/**/*.map"]
              }
            }
          }
        ]
      }
    }
  }
}
```

**Important Limitations**:

- The esbuild plugin does NOT upload source maps in watch/development mode (only production builds)
- The esbuild plugin does NOT fully support `splitting: true` -- not an issue since Ptah's esbuild configs don't use splitting
- Source maps must be enabled in the build config (`sourcemap: true` or `"hidden"`)

### 4.3 Angular Webview Source Maps

The Angular webview uses `@angular/build:application` which uses esbuild internally but does NOT expose a plugin array for esbuild plugins. Two approaches:

**Option A: `sentry-cli` Post-Build Upload (Recommended)**

Add a post-build Nx target:

```json
{
  "upload-sourcemaps": {
    "executor": "nx:run-commands",
    "dependsOn": ["build"],
    "options": {
      "command": "sentry-cli sourcemaps upload --org ptah --project ptah-webview --release ${SENTRY_RELEASE} dist/apps/ptah-extension-webview/browser/"
    }
  }
}
```

Then delete `.map` files before packaging:

```bash
find dist/apps/ptah-extension-webview/browser/ -name '*.map' -delete
```

**Option B: Nx Angular esbuild Plugin Registration**

If using `@nx/angular:browser-esbuild` executor (not currently used -- Ptah uses `@angular/build:application`), you can register the plugin directly in `project.json`. This would require changing the executor.

### 4.4 Source Map Security

Source maps expose original source code. After upload to Sentry:

1. Delete `.map` files from dist before packaging (`.vsix`, Electron app, Docker image)
2. Configure `filesToDeleteAfterUpload` in the esbuild plugin
3. Never serve `.map` files in production (license server: configure Express to deny `*.map` requests)

### 4.5 Authentication

All source map uploads require a Sentry auth token. Store as:

- CI environment variable: `SENTRY_AUTH_TOKEN`
- Local development: `.env.sentry-build-plugin` file (add to `.gitignore`)

---

## 5. Privacy and Data Scrubbing

### 5.1 beforeSend Hook (SDK-Level Scrubbing)

Apply consistently across all runtimes:

```typescript
function scrubPII(event: Sentry.Event): Sentry.Event | null {
  // Remove user email/IP
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  // Scrub file paths (may contain usernames)
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.stacktrace?.frames) {
        for (const frame of exception.stacktrace.frames) {
          if (frame.filename) {
            // Normalize Windows paths: C:\Users\john\... -> C:\Users\<redacted>\...
            frame.filename = frame.filename.replace(/([A-Z]:\\Users\\)[^\\]+/gi, '$1<redacted>');
            // Normalize Unix paths: /home/john/... -> /home/<redacted>/...
            frame.filename = frame.filename.replace(/(\/home\/)[^/]+/g, '$1<redacted>');
          }
        }
      }
    }
  }

  // Scrub API keys and tokens from breadcrumbs and extra data
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9_-]{20,}/g, // Anthropic/OpenAI API keys
    /key_[a-zA-Z0-9_-]{20,}/g, // Generic API keys
    /Bearer\s+[a-zA-Z0-9._-]+/g, // Bearer tokens
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email addresses
  ];

  const scrubString = (str: string): string => {
    for (const pattern of sensitivePatterns) {
      str = str.replace(pattern, '[REDACTED]');
    }
    return str;
  };

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = scrubString(crumb.message);
      if (crumb.data) {
        for (const key of Object.keys(crumb.data)) {
          if (typeof crumb.data[key] === 'string') {
            crumb.data[key] = scrubString(crumb.data[key]);
          }
        }
      }
    }
  }

  return event;
}
```

### 5.2 Server-Side Scrubbing (Sentry Dashboard)

Enable in Sentry project settings:

- **Security & Privacy > Data Scrubbing**: Enable "Scrub data" and "Scrub IP addresses"
- **Advanced Data Scrubbing**: Add rules for credit card numbers, SSN patterns
- **Safe Fields**: Whitelist fields that should never be scrubbed (e.g., `release`, `environment`)

### 5.3 Specific Data to Protect

| Data Type                    | Where It Appears             | Scrubbing Method                               |
| ---------------------------- | ---------------------------- | ---------------------------------------------- |
| API keys (Anthropic, OpenAI) | Error messages, breadcrumbs  | `beforeSend` regex                             |
| License keys                 | Error context                | `beforeSend` regex                             |
| User file paths              | Stack traces                 | `beforeSend` path normalization                |
| Email addresses              | User context, error messages | `beforeSend` regex + strip `user.email`        |
| Workspace content            | Breadcrumbs, error context   | Do not attach workspace file content to events |
| Database URLs                | Server error messages        | `beforeSend` regex for connection strings      |

---

## 6. Configuration Pattern Recommendations

### 6.1 Sentry Project Structure

Create **4 separate Sentry projects** (one per runtime):

| Sentry Project          | Slug                  | Runtime                           |
| ----------------------- | --------------------- | --------------------------------- |
| Ptah VS Code Extension  | `ptah-vscode`         | Extension host Node.js            |
| Ptah Desktop (Electron) | `ptah-electron`       | Electron main + renderer          |
| Ptah Webview            | `ptah-webview`        | Angular browser (VS Code webview) |
| Ptah License Server     | `ptah-license-server` | NestJS server                     |

Each project gets its own DSN. This allows per-runtime alerting, dashboards, and issue triage.

### 6.2 Environment Tags

```typescript
// Derive environment consistently
function getSentryEnvironment(): string {
  if (process.env.NODE_ENV === 'development') return 'development';
  if (process.env.NODE_ENV === 'staging') return 'staging';
  return 'production';
}
```

For the webview, derive from `window.ptahConfig`:

- `isElectron && development` -> `'electron-dev'`
- `isElectron && production` -> `'electron-prod'`
- `isVSCode && development` -> `'vscode-dev'`
- `isVSCode && production` -> `'vscode-prod'`

### 6.3 Release Naming Convention

```
ptah-vscode@1.5.0+build.123
ptah-electron@1.5.0+build.123
ptah-webview@1.5.0+build.123
ptah-license-server@1.5.0+build.123
```

Use the package version from `package.json` plus a CI build number for uniqueness. Source maps are keyed by release name, so this must match between build-time upload and runtime initialization.

### 6.4 DSN Management

Store DSNs as:

- **VS Code Extension**: Hardcoded in source (DSNs are not secret -- they are public keys)
- **Electron**: Hardcoded in source
- **License Server**: Environment variable `SENTRY_DSN` (for flexibility across environments)
- **Webview**: Injected via build-time environment file replacement or via RPC from host

### 6.5 Sample Rates

| Runtime                   | Error Rate       | Traces Rate  | Rationale                           |
| ------------------------- | ---------------- | ------------ | ----------------------------------- |
| VS Code Extension         | 1.0 (all errors) | 0 (disabled) | Performance-sensitive; no tracing   |
| Electron Main             | 1.0              | 0.1 (10%)    | Moderate tracing for debugging      |
| Electron Renderer         | 1.0              | 0.1 (10%)    | Moderate tracing                    |
| Angular Webview (VS Code) | 1.0              | 0 (disabled) | CSP constraints; use RPC bridge     |
| License Server            | 1.0              | 0.2 (20%)    | Server-side can afford more tracing |

---

## 7. Known Gotchas and Limitations

### 7.1 VS Code Extension Host

1. **Global State Conflict**: `Sentry.init()` MUST NOT be used. Manual `NodeClient` instantiation is mandatory.
2. **CPU/Memory Overhead**: Issue #14840 reports significant overhead. Disable all automatic integrations. Use manual capture only.
3. **Extension Deactivation**: Must call `client.close()` in `deactivate()` to flush pending events and free resources.
4. **No Global Error Handlers**: Cannot use `onuncaughtexception` or `onunhandledrejection` integrations (they are global and would conflict).

### 7.2 Electron

1. **TypeScript Version Mismatch**: `@sentry/electron` renderer combined with `@sentry/angular` may have TypeScript definition conflicts. Pin all `@sentry/*` packages to the same version.
2. **Preload Script**: Must import `@sentry/electron/preload` when using `contextIsolation: true` (Ptah uses this).
3. **ESM Format**: The Electron main process builds as ESM (`outputFileName: "main.mjs"`). Verify `@sentry/electron/main` works with ESM imports.
4. **Native Crash Context**: Native crashes (minidumps) may not include full JavaScript context. The default `SentryMinidump` integration provides the best context; `ElectronMinidump` provides less.

### 7.3 Angular Webview

1. **VS Code CSP**: The webview iframe has strict Content Security Policy. `@sentry/angular` sends events via fetch/XHR which may be blocked. Consider the RPC bridge approach (relay errors through extension host).
2. **No Router**: `@sentry/angular`'s `TraceService` tracks route changes. Since Ptah uses signal-based navigation (no Angular Router), the `TraceService` will not provide route-based spans. Custom instrumentation needed if route-level tracing is desired.
3. **Error Handler Replacement**: The existing `WebviewErrorHandler` in `app.config.ts` filters security errors and CSP violations. Sentry's `createErrorHandler` should wrap or replace this, preserving the filtering logic.

### 7.4 NestJS License Server

1. **Import Order**: `instrument.ts` MUST be imported before ANY other module in `main.ts`. This is critical for auto-instrumentation to work.
2. **HttpException Not Captured**: By design, `SentryGlobalFilter` does not capture `HttpException` (4xx errors). Only unhandled/unexpected exceptions are reported. This is correct behavior.
3. **Filter Registration Order**: `SentryGlobalFilter` must be registered BEFORE any other exception filters in the providers array.
4. **Prisma Instrumentation**: For database span tracing, add `@sentry/prisma` or `@opentelemetry/instrumentation-prisma` integration separately.

### 7.5 Source Maps

1. **esbuild Splitting**: The esbuild plugin does not support `splitting: true`. Ptah does not use splitting, so this is not an issue.
2. **Watch Mode**: The esbuild plugin does NOT upload source maps during development/watch mode. This is expected -- only production builds upload.
3. **Angular Build Executor**: `@angular/build:application` does not expose an esbuild plugin array. Use `sentry-cli` for post-build upload or switch to `@nx/angular:browser-esbuild`.
4. **Release Matching**: The release name at upload time MUST exactly match the release name in `Sentry.init()`. Use environment variables to ensure consistency.

---

## 8. Shared Utility Recommendations

Create a shared Sentry configuration library to avoid duplication:

```
libs/shared/src/lib/sentry/
  sentry-scrubber.ts      -- scrubPII function (shared across all runtimes)
  sentry-config.ts        -- DSN constants, release helper, environment detection
  sentry-types.ts         -- SentryConfig interface
```

This keeps the scrubbing logic DRY and ensures consistent PII handling across all 4 runtimes.

---

## 9. Implementation Priority

| Priority | Task                       | Effort | Impact                                 |
| -------- | -------------------------- | ------ | -------------------------------------- |
| 1        | NestJS License Server      | Low    | High -- server errors are critical     |
| 2        | Electron Main Process      | Medium | High -- desktop app crash reporting    |
| 3        | VS Code Extension Host     | Medium | High -- extension stability monitoring |
| 4        | Angular Webview (Electron) | Medium | Medium -- renderer error visibility    |
| 5        | Angular Webview (VS Code)  | High   | Medium -- CSP complexity               |
| 6        | Source Map Upload CI       | Medium | High -- meaningful stack traces        |

---

## 10. Architect Focus Areas

Based on this research, the software architect should focus on:

1. **Shared Sentry utility library design** -- where to place `scrubPII`, DSN config, and whether to create a dedicated `@ptah-extension/sentry` library or add to `@ptah-extension/shared`
2. **VS Code webview Sentry strategy** -- decide between direct `@sentry/angular` init (requires CSP changes) vs. RPC bridge relay (simpler, one Sentry client)
3. **CI pipeline integration** -- source map upload steps for each app's build target
4. **Electron renderer initialization** -- the combined `@sentry/electron/renderer` + `@sentry/angular` init pattern and where it lives relative to Angular bootstrap
5. **DSN and token management** -- how DSNs are stored/injected and how auth tokens are provided in CI

---

## Sources

- [Sentry VS Code Extension GitHub](https://github.com/getsentry/sentry-vscode)
- [VS Code Extension + Sentry Conflict -- Issue #9543](https://github.com/getsentry/sentry-javascript/issues/9543)
- [VS Code Extension + Sentry CPU/Memory -- Issue #14840](https://github.com/getsentry/sentry-javascript/issues/14840)
- [Best Approach for VS Code Extension -- Issue #3564](https://github.com/getsentry/sentry-javascript/issues/3564)
- [Shared Environments / Browser Extensions -- Sentry Docs](https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/)
- [@sentry/electron -- npm](https://www.npmjs.com/package/@sentry/electron)
- [@sentry/electron -- GitHub](https://github.com/getsentry/sentry-electron)
- [Sentry Electron Docs](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [Electron Native Crash Reporting -- Sentry Docs](https://docs.sentry.io/platforms/javascript/guides/electron/features/native-crash-reporting/)
- [ElectronMinidump Integration](https://docs.sentry.io/platforms/javascript/guides/electron/configuration/integrations/electronminidump/)
- [@sentry/angular -- npm](https://www.npmjs.com/package/@sentry/angular)
- [Sentry Angular Docs](https://docs.sentry.io/platforms/javascript/guides/angular/)
- [Sentry Angular Manual Setup](https://docs.sentry.io/platforms/javascript/guides/angular/manual-setup/)
- [Sentry Angular Error Handler](https://docs.sentry.io/platforms/javascript/guides/angular/features/error-handler/)
- [@sentry/nestjs -- npm](https://www.npmjs.com/package/@sentry/nestjs)
- [Sentry NestJS Docs](https://docs.sentry.io/platforms/javascript/guides/nestjs/)
- [Sentry NestJS Auto-Instrumentation](https://docs.sentry.io/platforms/javascript/guides/nestjs/tracing/instrumentation/automatic-instrumentation/)
- [@sentry/esbuild-plugin -- npm](https://www.npmjs.com/package/@sentry/esbuild-plugin)
- [Sentry esbuild Source Maps](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/esbuild/)
- [Sentry Nx Angular Source Maps](https://docs.sentry.io/platforms/javascript/guides/angular/sourcemaps/uploading/angular-nx/)
- [Sentry CLI Source Maps](https://docs.sentry.io/platforms/javascript/guides/angular/sourcemaps/uploading/cli/)
- [Scrubbing Sensitive Data -- Sentry JS Docs](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/)
- [Advanced Data Scrubbing -- Sentry Docs](https://docs.sentry.io/security-legal-pii/scrubbing/advanced-datascrubbing/)
- [Sentry Performance Overhead](https://docs.sentry.io/product/insights/performance-overhead/)
- [Sentry DSN Explainer](https://docs.sentry.io/concepts/key-terms/dsn-explainer/)
- [NestJS Sentry Recipe](https://docs.nestjs.com/recipes/sentry)
