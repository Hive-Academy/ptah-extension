# Implementation Plan - TASK_2025_233: Sentry Integration (Electron + NestJS)

## Scope

Two applications only:

1. **ptah-electron** -- Electron desktop app (main process error capture + performance tracing)
2. **ptah-license-server** -- NestJS backend API

Plus a shared PII scrubber in `libs/shared/`.

Out of scope: ptah-extension-vscode, ptah-extension-webview, Angular/webview Sentry, source map CI pipeline.

---

## Codebase Investigation Summary

### Electron App (`apps/ptah-electron/`)

| Aspect               | Finding                                                                                       | Evidence                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Entry point          | `src/main.ts` -- imports `reflect-metadata` first, then Electron APIs                         | `main.ts:1-2`                                                  |
| Build format         | ESM (`outputFileName: "main.mjs"`, `format: ["esm"]`)                                         | `project.json:15-19`                                           |
| Externals array      | Already has 26 entries (electron, electron-updater, reflect-metadata, etc.)                   | `project.json:32-62`                                           |
| Preload build        | CJS format (`format: ["cjs"]`), only `electron` external                                      | `project.json:102-123`                                         |
| Preload security     | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`                           | `main-window.ts:72-74`                                         |
| Electron version     | 35.7.5                                                                                        | `electron-builder.yml:4`                                       |
| App version source   | `package.json` version `0.1.1` + `app.getVersion()`                                           | `apps/ptah-electron/package.json:3`, `application-menu.ts:206` |
| State storage        | `PLATFORM_TOKENS.STATE_STORAGE` resolved from DI, used for `ptah.workspaces`, `window.bounds` | `main.ts:161,573`                                              |
| Quit handler         | `app.on('will-quit', ...)` exists at `main.ts:699` for skill junction cleanup                 | `main.ts:699-708`                                              |
| Single instance lock | `app.requestSingleInstanceLock()` gates all app logic                                         | `main.ts:37-39`                                                |
| `.map` exclusion     | `electron-builder.yml` already excludes `**/*.map`                                            | `electron-builder.yml:13`                                      |

### NestJS License Server (`apps/ptah-license-server/`)

| Aspect                | Finding                                                                                     | Evidence                        |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| Entry point           | `src/main.ts` -- `bootstrap()` function calls `NestFactory.create(AppModule, ...)`          | `main.ts:19-32`                 |
| Build format          | CJS (`format: ["cjs"]`), esbuild                                                            | `project.json:18`               |
| Externals array       | 8 entries (`@workos-inc/node`, `@paddle/paddle-node-sdk`, `resend`, `@prisma/client`, etc.) | `project.json:25-35`            |
| Source maps (prod)    | Disabled (`sourcemap: false` in production config)                                          | `project.json:49-53`            |
| Source maps (dev)     | Enabled (`sourcemap: true`)                                                                 | `project.json:45-48`            |
| Global modules        | `ConfigModule.forRoot({ isGlobal: true })`, `ThrottlerModule`, `EventEmitterModule`         | `app.module.ts:40-57`           |
| Global guards         | `ThrottlerGuard` via `APP_GUARD`                                                            | `app.module.ts:73-76`           |
| No exception filters  | No custom global exception filters found                                                    | Glob search: 0 filter files     |
| Existing guards       | `JwtAuthGuard`, `QueryTokenGuard`, `AdminApiKeyGuard`                                       | Glob search in `src/**/`        |
| Dockerfile            | Multi-stage build, production image runs `node main.js`                                     | `Dockerfile:135`                |
| Docker Compose (prod) | `license-server` reads `env_file: .env.prod`                                                | `docker-compose.prod.yml:62-63` |
| Deployment            | DigitalOcean Droplet (not App Platform)                                                     | `docker-compose.prod.yml:1-12`  |
| Port                  | 3000 (via `ConfigService.get('PORT')`)                                                      | `main.ts:86`                    |
| Log levels            | Production: `['log', 'error', 'warn']`                                                      | `main.ts:26-30`                 |

### Shared Library (`libs/shared/`)

| Aspect             | Finding                                                                    | Evidence                   |
| ------------------ | -------------------------------------------------------------------------- | -------------------------- |
| Zero dependencies  | Pure TypeScript types and utilities only                                   | `CLAUDE.md` boundary rules |
| Existing utils dir | `libs/shared/src/lib/utils/` with 12 files                                 | Glob results               |
| No telemetry dir   | `libs/shared/src/lib/telemetry/` does not exist                            | Glob returned empty        |
| Export barrel      | `libs/shared/src/index.ts` -- exports types, type-guards, utils, constants | `index.ts:1-38`            |
| Import alias       | `@ptah-extension/shared`                                                   | `tsconfig.base.json:53`    |

---

## NPM Packages to Install

### dependencies (root `package.json`)

| Package            | Version    | Used By                      |
| ------------------ | ---------- | ---------------------------- |
| `@sentry/electron` | `^7.7.1`   | ptah-electron (main process) |
| `@sentry/nestjs`   | `^10.44.0` | ptah-license-server          |

### devDependencies (root `package.json`)

None required for this reduced scope. Source map upload CI is deferred.

### Electron app dependencies (`apps/ptah-electron/package.json`)

Add `@sentry/electron` to the Electron app's own `package.json` so electron-builder bundles it:

```json
"@sentry/electron": "^7.7.1"
```

**Important version note**: `@sentry/electron` (v7.x) versions independently from the `@sentry/*` JavaScript monorepo packages (v10.x). These are compatible. When the VS Code extension and Angular webview are added later (future task), they will use `@sentry/node@^10.44.0` and `@sentry/angular@^10.44.0` respectively, and those must all share the same v10.x version.

---

## Implementation Order

1. **Phase 1**: Shared PII scrubber (`libs/shared/`)
2. **Phase 2**: NestJS license server integration
3. **Phase 3**: Electron main process integration

Server first because it has the simplest integration path and fastest feedback loop (can `curl` endpoints and verify events in Sentry immediately).

---

## Phase 1: Shared PII Scrubber

### New Files

#### `libs/shared/src/lib/telemetry/sentry-scrubber.ts` (CREATE)

This file has **zero Sentry SDK dependency**. It operates on plain objects matching the Sentry Event shape, so it can be imported by any runtime without pulling in a specific SDK.

````typescript
/**
 * Sentry PII Scrubber -- shared across all runtimes.
 *
 * ZERO dependency on any @sentry/* package. Operates on plain event objects
 * conforming to the Sentry Event interface shape.
 *
 * Usage:
 *   import { createBeforeSend } from '@ptah-extension/shared';
 *   Sentry.init({ beforeSend: createBeforeSend() });
 */

/** Minimal subset of the Sentry Event shape we need to scrub. */
export interface SentryEventLike {
  user?: {
    email?: string;
    ip_address?: string;
    username?: string;
    [key: string]: unknown;
  };
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: {
        frames?: Array<{
          filename?: string;
          abs_path?: string;
          [key: string]: unknown;
        }>;
      };
      [key: string]: unknown;
    }>;
  };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  request?: {
    headers?: Record<string, string>;
    data?: unknown;
    cookies?: unknown;
    [key: string]: unknown;
  };
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScrubberConfig {
  /** Maximum length for error messages before truncation. Default: 200 */
  maxMessageLength?: number;
  /** Additional regex patterns to redact (applied to all string values). */
  extraPatterns?: RegExp[];
}

/** Regex patterns for sensitive data. */
const SENSITIVE_PATTERNS: RegExp[] = [
  // API keys (Anthropic, OpenAI, generic)
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /key-[a-zA-Z0-9_-]{20,}/g,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._-]+/g,
  // JWT tokens (3-part base64 dot-separated)
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Database connection strings
  /postgresql:\/\/[^\s"']+/gi,
  /postgres:\/\/[^\s"']+/gi,
  /redis:\/\/[^\s"']+/gi,
  // Paddle keys
  /pdl_[a-z]+_[a-zA-Z0-9]+/g,
  // License keys (common UUID-like patterns prefixed with known markers)
  /ptah-lic-[a-f0-9-]{36}/gi,
];

/** Headers that must never be sent to Sentry. */
const REDACTED_HEADERS = ['authorization', 'cookie', 'x-admin-api-key', 'x-api-key'];

/**
 * Scrub a single string value by replacing sensitive patterns with [REDACTED].
 */
function scrubString(value: string, extraPatterns: RegExp[]): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  for (const pattern of extraPatterns) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Normalize file paths to strip user-specific segments.
 *
 * - Windows: C:\Users\john\... -> C:\Users\<user>\...
 * - Unix:    /home/john/...    -> /home/<user>/...
 * - macOS:   /Users/john/...   -> /Users/<user>/...
 */
function scrubFilePath(filepath: string): string {
  return filepath
    .replace(/([A-Z]:\\Users\\)[^\\]+/gi, '$1<user>')
    .replace(/(\/home\/)[^/]+/g, '$1<user>')
    .replace(/(\/Users\/)[^/]+/g, '$1<user>');
}

/**
 * Truncate long error messages that may contain user code snippets.
 */
function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + ' [truncated]';
}

/**
 * Factory function that returns a Sentry-compatible `beforeSend` callback.
 *
 * The returned function accepts a Sentry Event (any version) and returns
 * the scrubbed event, or null to drop it entirely.
 *
 * @example
 * ```typescript
 * import { createBeforeSend } from '@ptah-extension/shared';
 * Sentry.init({ beforeSend: createBeforeSend() });
 * ```
 */
export function createBeforeSend(config?: ScrubberConfig) {
  const maxLen = config?.maxMessageLength ?? 200;
  const extraPatterns = config?.extraPatterns ?? [];

  return function beforeSend<T extends SentryEventLike>(event: T): T | null {
    // 1. Strip PII from user context
    if (event.user) {
      delete event.user.email;
      delete event.user.ip_address;
      delete event.user.username;
    }

    // 2. Scrub stack trace file paths and truncate exception messages
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        // Truncate error messages that may embed user code
        if (ex.value) {
          ex.value = truncateMessage(scrubString(ex.value, extraPatterns), maxLen);
        }

        if (ex.stacktrace?.frames) {
          for (const frame of ex.stacktrace.frames) {
            if (frame.filename) {
              frame.filename = scrubFilePath(frame.filename);
            }
            if (frame.abs_path) {
              frame.abs_path = scrubFilePath(frame.abs_path);
            }
          }
        }
      }
    }

    // 3. Scrub breadcrumbs
    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        if (crumb.message) {
          crumb.message = scrubString(crumb.message, extraPatterns);
        }
        if (crumb.data) {
          for (const key of Object.keys(crumb.data)) {
            const val = crumb.data[key];
            if (typeof val === 'string') {
              crumb.data[key] = scrubString(val, extraPatterns);
            }
          }
        }
      }
    }

    // 4. Strip sensitive request data (NestJS server events)
    if (event.request) {
      // Remove request body entirely (may contain user data)
      delete event.request.data;
      // Remove cookies
      delete event.request.cookies;
      // Redact sensitive headers
      if (event.request.headers) {
        for (const header of REDACTED_HEADERS) {
          if (event.request.headers[header]) {
            event.request.headers[header] = '[REDACTED]';
          }
        }
      }
    }

    // 5. Scrub string values in extra context
    if (event.extra) {
      for (const key of Object.keys(event.extra)) {
        const val = event.extra[key];
        if (typeof val === 'string') {
          event.extra[key] = scrubString(val, extraPatterns);
        }
      }
    }

    return event;
  };
}
````

#### `libs/shared/src/lib/telemetry/sentry-scrubber.spec.ts` (CREATE)

```typescript
import { createBeforeSend, SentryEventLike } from './sentry-scrubber';

describe('createBeforeSend', () => {
  const beforeSend = createBeforeSend();

  it('should strip user PII fields', () => {
    const event: SentryEventLike = {
      user: {
        email: 'john@example.com',
        ip_address: '192.168.1.1',
        username: 'john',
        id: 'user-123',
      },
    };
    const result = beforeSend(event);
    expect(result?.user?.email).toBeUndefined();
    expect(result?.user?.ip_address).toBeUndefined();
    expect(result?.user?.username).toBeUndefined();
    expect(result?.user?.id).toBe('user-123');
  });

  it('should redact API keys in exception messages', () => {
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            value: 'Error: Invalid key sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
          },
        ],
      },
    };
    const result = beforeSend(event);
    expect(result?.exception?.values?.[0].value).toContain('[REDACTED]');
    expect(result?.exception?.values?.[0].value).not.toContain('sk-ant-api03');
  });

  it('should redact email addresses in breadcrumbs', () => {
    const event: SentryEventLike = {
      breadcrumbs: [{ message: 'User john@example.com logged in' }],
    };
    const result = beforeSend(event);
    expect(result?.breadcrumbs?.[0].message).toContain('[REDACTED]');
    expect(result?.breadcrumbs?.[0].message).not.toContain('john@example.com');
  });

  it('should normalize Windows file paths in stack traces', () => {
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: 'C:\\Users\\john\\projects\\ptah\\src\\main.ts' }],
            },
          },
        ],
      },
    };
    const result = beforeSend(event);
    expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe('C:\\Users\\<user>\\projects\\ptah\\src\\main.ts');
  });

  it('should normalize Unix file paths in stack traces', () => {
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: '/home/john/projects/ptah/src/main.ts' }],
            },
          },
        ],
      },
    };
    const result = beforeSend(event);
    expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe('/home/<user>/projects/ptah/src/main.ts');
  });

  it('should normalize macOS file paths', () => {
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ filename: '/Users/john/code/ptah/main.ts' }],
            },
          },
        ],
      },
    };
    const result = beforeSend(event);
    expect(result?.exception?.values?.[0].stacktrace?.frames?.[0].filename).toBe('/Users/<user>/code/ptah/main.ts');
  });

  it('should truncate long error messages', () => {
    const longMessage = 'x'.repeat(500);
    const event: SentryEventLike = {
      exception: { values: [{ value: longMessage }] },
    };
    const result = beforeSend(event);
    const msg = result?.exception?.values?.[0].value ?? '';
    expect(msg.length).toBeLessThanOrEqual(212); // 200 + ' [truncated]'
    expect(msg).toContain('[truncated]');
  });

  it('should strip request body and sensitive headers', () => {
    const event: SentryEventLike = {
      request: {
        headers: {
          authorization: 'Bearer abc123',
          'content-type': 'application/json',
          'x-admin-api-key': 'secret',
        },
        data: { password: 'secret' },
        cookies: 'session=abc',
      },
    };
    const result = beforeSend(event);
    expect(result?.request?.data).toBeUndefined();
    expect(result?.request?.cookies).toBeUndefined();
    expect(result?.request?.headers?.['authorization']).toBe('[REDACTED]');
    expect(result?.request?.headers?.['x-admin-api-key']).toBe('[REDACTED]');
    expect(result?.request?.headers?.['content-type']).toBe('application/json');
  });

  it('should redact database connection strings', () => {
    const event: SentryEventLike = {
      breadcrumbs: [
        {
          message: 'DB error',
          data: { url: 'postgresql://user:pass@host:5432/db' },
        },
      ],
    };
    const result = beforeSend(event);
    expect(result?.breadcrumbs?.[0].data?.['url']).toContain('[REDACTED]');
  });

  it('should handle custom extra patterns', () => {
    const custom = createBeforeSend({
      extraPatterns: [/custom-secret-[a-z]+/g],
    });
    const event: SentryEventLike = {
      extra: { info: 'key is custom-secret-abc' },
    };
    const result = custom(event);
    expect(result?.extra?.['info']).toContain('[REDACTED]');
  });

  it('should pass through events with no sensitive data', () => {
    const event: SentryEventLike = {
      exception: {
        values: [{ value: 'TypeError: Cannot read property x of undefined' }],
      },
    };
    const result = beforeSend(event);
    expect(result?.exception?.values?.[0].value).toBe('TypeError: Cannot read property x of undefined');
  });

  it('should redact JWT tokens in breadcrumbs', () => {
    const event: SentryEventLike = {
      breadcrumbs: [{ message: 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' }],
    };
    const result = beforeSend(event);
    expect(result?.breadcrumbs?.[0].message).toContain('[REDACTED]');
    expect(result?.breadcrumbs?.[0].message).not.toContain('eyJ');
  });
});
```

#### `libs/shared/src/lib/telemetry/index.ts` (CREATE)

```typescript
export { createBeforeSend } from './sentry-scrubber';
export type { SentryEventLike, ScrubberConfig } from './sentry-scrubber';
```

### Modified Files

#### `libs/shared/src/index.ts` (MODIFY)

Add telemetry export at the end of the file:

```typescript
// Telemetry
export * from './lib/telemetry';
```

---

## Phase 2: NestJS License Server Integration

### New Files

#### `apps/ptah-license-server/src/instrument.ts` (CREATE)

This file MUST be imported as the very first import in `main.ts`. It initializes Sentry before NestJS boots so that automatic HTTP instrumentation hooks are installed.

```typescript
/**
 * Sentry instrumentation for the license server.
 *
 * CRITICAL: This file MUST be the first import in main.ts.
 * Sentry hooks into Node.js HTTP module at import time for automatic
 * request/response tracing. If imported after NestFactory.create(),
 * HTTP spans will not be captured.
 */
import * as Sentry from '@sentry/nestjs';
import { createBeforeSend } from '@ptah-extension/shared';

const dsn = process.env['SENTRY_DSN'];
const isEnabled = process.env['SENTRY_ENABLED'] !== 'false';

if (dsn && isEnabled) {
  Sentry.init({
    dsn,
    release: `ptah-license-server@${process.env['npm_package_version'] || '0.0.0'}`,
    environment: process.env['NODE_ENV'] || 'development',

    // Capture all errors, sample 10% of transactions
    sampleRate: 1.0,
    tracesSampleRate: 0.1,

    // Privacy: no PII by default
    sendDefaultPii: false,

    // Limit breadcrumb volume
    maxBreadcrumbs: 50,

    // PII scrubber
    beforeSend: createBeforeSend() as Parameters<typeof Sentry.init>[0] extends { beforeSend?: infer B } ? B : never,

    // Integrations: rely on defaults from @sentry/nestjs
    // which include HTTP, Express, and NestJS instrumentation
  });

  console.log('[Sentry] Initialized for ptah-license-server');
} else {
  console.log(`[Sentry] Disabled (dsn=${dsn ? 'set' : 'unset'}, enabled=${isEnabled})`);
}
```

**Note on `beforeSend` typing**: The `createBeforeSend()` function returns a generic `(event: T) => T | null`. Sentry's `init()` expects its own `Event` type. The generic signature is compatible because `SentryEventLike` is a structural subset of Sentry's `Event`. If TypeScript raises a type error, the developer should use a type assertion: `beforeSend: createBeforeSend() as any`. This is safe because the scrubber only deletes/replaces properties that exist on the real Event type.

### Modified Files

#### `apps/ptah-license-server/src/main.ts` (MODIFY)

**Change 1**: Add `instrument.ts` as the FIRST import (before all NestJS imports).

Current first import (line 12):

```typescript
import { Logger, ValidationPipe } from '@nestjs/common';
```

New first import (insert before line 12):

```typescript
import './instrument';
```

**Change 2**: Add `Sentry.close()` before the process exits. Add after `bootstrap()` call at the bottom of the file (after line 99):

```typescript
// Graceful shutdown: flush Sentry events before process exits
process.on('SIGTERM', async () => {
  const Sentry = await import('@sentry/nestjs');
  await Sentry.close(2000);
  process.exit(0);
});
```

Full resulting `main.ts` top section:

```typescript
import './instrument'; // MUST be first import -- Sentry hooks into Node.js HTTP

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import cookieParser = require('cookie-parser');
// ... rest unchanged ...
```

#### `apps/ptah-license-server/src/app/app.module.ts` (MODIFY)

**Change 1**: Import `SentryModule` and `SentryGlobalFilter`.

Add to imports section:

```typescript
import { SentryModule } from '@sentry/nestjs/setup';
```

Add to the `@Module` decorator's `imports` array (as the FIRST import, before `ConfigModule`):

```typescript
SentryModule.forRoot(),
```

**Change 2**: Register `SentryGlobalFilter` as a global exception filter. This must be registered BEFORE the `ThrottlerGuard` in the providers array.

Add import:

```typescript
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
```

Add to the `providers` array (BEFORE the ThrottlerGuard entry):

```typescript
{
  provide: APP_FILTER,
  useClass: SentryGlobalFilter,
},
```

This requires importing `APP_FILTER` from `@nestjs/core`:

```typescript
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
```

Full resulting `app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
// ... existing imports ...

@Module({
  imports: [
    SentryModule.forRoot(), // Sentry must be first
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    EventEmitterModule.forRoot(),
    PrismaModule,
    // ... existing feature modules ...
  ],
  providers: [
    // Sentry exception filter (must be before other filters/guards)
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    // Rate limiting
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

#### `apps/ptah-license-server/project.json` (MODIFY)

**Change 1**: Add `@sentry/nestjs` to the `external` array.

Current externals (line 25-35):

```json
"external": [
  "@workos-inc/node",
  "@paddle/paddle-node-sdk",
  "resend",
  "@prisma/client",
  "@prisma/adapter-pg",
  "pg",
  "@nestjs/microservices",
  "@nestjs/websockets",
  "@nestjs/platform-socket.io"
]
```

Add `@sentry/nestjs` to the array:

```json
"external": [
  "@workos-inc/node",
  "@paddle/paddle-node-sdk",
  "resend",
  "@prisma/client",
  "@prisma/adapter-pg",
  "pg",
  "@nestjs/microservices",
  "@nestjs/websockets",
  "@nestjs/platform-socket.io",
  "@sentry/nestjs"
]
```

**Why external?**: `@sentry/nestjs` uses OpenTelemetry instrumentation hooks that patch Node.js built-in modules at import time. Bundling these with esbuild breaks the patching mechanism. The package must be resolved from `node_modules` at runtime.

#### `apps/ptah-license-server/Dockerfile` (MODIFY)

**Change**: In Stage 2 (deps), add `@sentry/nestjs` to the `npm install` command so it is available at runtime in the production image.

Current (line 73-81):

```bash
RUN npm install --omit=dev \
    @workos-inc/node \
    @nestjs/config \
    @nestjs/jwt \
    @paddle/paddle-node-sdk \
    resend \
    pg \
    prisma
```

Updated:

```bash
RUN npm install --omit=dev \
    @workos-inc/node \
    @nestjs/config \
    @nestjs/jwt \
    @paddle/paddle-node-sdk \
    @sentry/nestjs \
    resend \
    pg \
    prisma
```

### Deployment Configuration

#### `.env.example` (MODIFY)

Add Sentry section at the bottom of the file (after the Magic Link section):

```env
# =============================================================================
# SENTRY ERROR TRACKING
# =============================================================================
# Sentry captures unhandled exceptions and performance data for monitoring.
#
# SETUP:
#   1. Create a Sentry project at https://sentry.io/
#   2. Copy the DSN from Project Settings -> Client Keys (DSN)
#   3. Paste it below
#
# Leave SENTRY_DSN unset to disable Sentry entirely (recommended for local dev).
# Set SENTRY_ENABLED=false to explicitly disable even if DSN is present.
#
# SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
# SENTRY_ENABLED=true
```

#### `.env.prod` (manual step -- document only)

The operator must add these environment variables to `.env.prod` on the DigitalOcean Droplet:

```env
SENTRY_DSN=<actual DSN from Sentry project ptah-license-server>
SENTRY_ENABLED=true
```

---

## Phase 3: Electron Main Process Integration

### New Files

#### `apps/ptah-electron/src/sentry.ts` (CREATE)

Encapsulates Sentry initialization logic for the Electron main process. Separated from `main.ts` to keep the entry point clean and to support the telemetry opt-out flow.

```typescript
/**
 * Sentry initialization for the Electron main process.
 *
 * Called from main.ts BEFORE app.whenReady(). Must be imported after
 * reflect-metadata but before any Electron API usage for crash reporting
 * to capture native crashes from the earliest point.
 *
 * @sentry/electron handles:
 * - Main process unhandled exceptions and promise rejections
 * - Native crash reporting (minidumps via Electron's crashReporter)
 * - Breadcrumb collection (console, network, Electron events)
 *
 * Telemetry opt-out: If stateStorage has 'ptah.telemetry.enabled' === false,
 * Sentry is not initialized. The check requires reading a JSON file from
 * the userData directory synchronously (before app.whenReady).
 */
import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createBeforeSend } from '@ptah-extension/shared';

// Hardcoded DSN for the Electron Sentry project.
// DSNs are public client identifiers, not secrets.
// Can be overridden via SENTRY_DSN env var for testing.
const ELECTRON_SENTRY_DSN = process.env['SENTRY_DSN'] || '';

/**
 * Check telemetry opt-out from the global state storage JSON file.
 *
 * State storage is persisted at <userData>/ptah-global-state.json by
 * ElectronGlobalStateStorage (platform-electron library). We read it
 * directly here because the DI container is not yet initialized when
 * Sentry must be initialized (before app.whenReady).
 *
 * Returns true if telemetry is enabled (default), false if opted out.
 */
function isTelemetryEnabled(): boolean {
  try {
    // app.getPath('userData') works before app.whenReady() on all platforms
    const statePath = path.join(app.getPath('userData'), 'ptah-global-state.json');
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    // The key used by the settings UI to control telemetry
    const enabled = state['ptah.telemetry.enabled'];
    return enabled !== false; // default to enabled if key is missing
  } catch {
    // File doesn't exist yet (first launch) or parse error -- default enabled
    return true;
  }
}

/**
 * Initialize Sentry for the Electron main process.
 *
 * Must be called in main.ts BEFORE app.whenReady() and AFTER
 * reflect-metadata import.
 *
 * Returns true if Sentry was initialized, false if skipped.
 */
export function initSentry(): boolean {
  if (!ELECTRON_SENTRY_DSN) {
    console.log('[Sentry] Disabled -- no DSN configured');
    return false;
  }

  if (!isTelemetryEnabled()) {
    console.log('[Sentry] Disabled -- user opted out via telemetry setting');
    return false;
  }

  try {
    Sentry.init({
      dsn: ELECTRON_SENTRY_DSN,
      release: `ptah-electron@${app.getVersion()}`,
      environment: process.env['NODE_ENV'] || 'production',

      // Capture all errors, sample 10% of performance transactions
      sampleRate: 1.0,
      tracesSampleRate: 0.1,

      // Privacy
      sendDefaultPii: false,
      maxBreadcrumbs: 50,

      // PII scrubber
      beforeSend: createBeforeSend() as Parameters<typeof Sentry.init>[0] extends { beforeSend?: infer B } ? B : never,
    });

    console.log(`[Sentry] Initialized for ptah-electron@${app.getVersion()}`);
    return true;
  } catch (error) {
    // Sentry init failure must NEVER crash the app
    console.error('[Sentry] Initialization failed (non-fatal):', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Flush pending Sentry events and close the client.
 * Call from the will-quit handler.
 *
 * @param timeoutMs Maximum time to wait for flush (default: 2000ms)
 */
export async function closeSentry(timeoutMs = 2000): Promise<void> {
  try {
    await Sentry.close(timeoutMs);
  } catch {
    // Swallow -- we're quitting anyway
  }
}
```

### Modified Files

#### `apps/ptah-electron/src/main.ts` (MODIFY)

**Change 1**: Import and call `initSentry()` AFTER `reflect-metadata` but BEFORE `app.whenReady()`.

Current lines 1-3:

```typescript
// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';
```

Insert after line 2 (after `import 'reflect-metadata'`), before the Electron imports:

```typescript
import { initSentry, closeSentry } from './sentry';
```

Then, after the single-instance lock check but BEFORE `app.whenReady()`, call `initSentry()`. The ideal location is after line 40 (`if (!gotLock) { app.quit(); } else {`), at the beginning of the `else` block:

Insert after line 41 (`let mainWindow: BrowserWindow | null = null;`) -- before any async code:

```typescript
// Initialize Sentry for crash reporting (before app.whenReady)
// Must be synchronous and early for native crash capture.
const sentryInitialized = initSentry();
```

**Change 2**: Add `closeSentry()` to the `will-quit` handler.

Current `will-quit` handler (lines 699-708):

```typescript
app.on('will-quit', () => {
  try {
    skillJunctionRef?.deactivateSync();
  } catch (error) {
    console.warn('[Ptah Electron] Skill junction cleanup failed (non-fatal):', error instanceof Error ? error.message : String(error));
  }
});
```

Replace with:

```typescript
app.on('will-quit', () => {
  try {
    skillJunctionRef?.deactivateSync();
  } catch (error) {
    console.warn('[Ptah Electron] Skill junction cleanup failed (non-fatal):', error instanceof Error ? error.message : String(error));
  }

  // Flush pending Sentry events (fire-and-forget; will-quit is sync)
  if (sentryInitialized) {
    closeSentry().catch(() => {
      /* swallow -- we're quitting */
    });
  }
});
```

**Note**: `closeSentry()` is async but `will-quit` is synchronous. The flush is best-effort. Electron gives a brief grace period before force-quitting. In practice, most events will have been transmitted already. If exact delivery is critical, the app could use `app.on('before-quit')` with `event.preventDefault()` and re-quit after flush, but that adds complexity for minimal gain.

#### `apps/ptah-electron/src/preload.ts` (MODIFY)

**Change**: Add `@sentry/electron/preload` import near the top of the file.

This import is required when `contextIsolation: true` (confirmed in `main-window.ts:72`). It sets up the IPC channel between the renderer's Sentry client and the main process's Sentry client, enabling error context to flow between processes.

Current first line:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
```

Insert BEFORE this line:

```typescript
import '@sentry/electron/preload';
```

The preload file should now begin:

```typescript
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer } from 'electron';
```

**Build consideration**: The preload is built as CJS with only `electron` as external. `@sentry/electron` must also be added as external for the preload build target.

#### `apps/ptah-electron/project.json` (MODIFY)

**Change 1**: Add `@sentry/electron` to the `build-main` target's `external` array.

Add after `"node-pty"` (last current entry at line 62):

```json
"@sentry/electron"
```

**Change 2**: Add `@sentry/electron` to the `build-preload` target's `external` array.

Current preload externals (line 122):

```json
"external": ["electron"]
```

Change to:

```json
"external": ["electron", "@sentry/electron"]
```

#### `apps/ptah-electron/package.json` (MODIFY)

Add `@sentry/electron` to dependencies so electron-builder bundles it into the distributable:

```json
"@sentry/electron": "^7.7.1"
```

This is in addition to adding it to the root `package.json`. The Electron app's own `package.json` is what electron-builder reads to determine which `node_modules` to include in the asar archive.

---

## Build Configuration Summary

### Root `package.json` -- New Dependencies

```
dependencies:
  @sentry/electron: ^7.7.1
  @sentry/nestjs: ^10.44.0
```

### `apps/ptah-electron/package.json` -- New Dependencies

```
dependencies:
  @sentry/electron: ^7.7.1
```

### `apps/ptah-electron/project.json` -- Externals Changes

```
build-main.options.external += "@sentry/electron"
build-preload.options.external += "@sentry/electron"
```

### `apps/ptah-license-server/project.json` -- Externals Changes

```
build.options.external += "@sentry/nestjs"
```

---

## DSN Management

| App                 | DSN Source                                  | Details                                                                                                                           |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ptah-electron       | Hardcoded in `sentry.ts` + env var override | Set `ELECTRON_SENTRY_DSN` constant in `sentry.ts` once the Sentry project is created. `SENTRY_DSN` env var overrides for testing. |
| ptah-license-server | `process.env['SENTRY_DSN']`                 | Set in `.env.prod` on the Droplet. Unset in local dev = Sentry disabled.                                                          |

**Important**: The developer must create two Sentry projects after this task is implemented:

1. `ptah-electron` -- for the Electron app
2. `ptah-license-server` -- for the NestJS backend

Each project gets its own DSN. The Electron DSN goes into `sentry.ts` as the `ELECTRON_SENTRY_DSN` constant. The server DSN goes into `.env.prod`.

---

## Telemetry Opt-Out

### Electron (`ptah-electron`)

- **Storage key**: `ptah.telemetry.enabled` in `<userData>/ptah-global-state.json`
- **Default**: `true` (telemetry enabled)
- **Read method**: Synchronous file read in `sentry.ts` before `app.whenReady()`
- **Change takes effect**: Next app restart (Sentry cannot be re-initialized at runtime)
- **State storage pattern**: Matches existing usage of `PLATFORM_TOKENS.STATE_STORAGE` for `ptah.workspaces` and `window.bounds` (evidence: `main.ts:161,573`)

**Note**: This task does NOT implement the UI for changing the telemetry setting. It only reads the key. A settings UI can set this key via the existing `PLATFORM_TOKENS.STATE_STORAGE` interface in a future task.

### NestJS License Server

- **Environment variable**: `SENTRY_ENABLED` (default: `true`)
- **Logic**: If `SENTRY_ENABLED=false` OR `SENTRY_DSN` is unset, Sentry does not initialize
- **Local development**: `SENTRY_DSN` is not in `.env.example` by default, so Sentry is naturally disabled in local dev

---

## Files Affected Summary

### CREATE (5 files)

| File                                                    | Description                           |
| ------------------------------------------------------- | ------------------------------------- |
| `libs/shared/src/lib/telemetry/sentry-scrubber.ts`      | PII scrubber factory function         |
| `libs/shared/src/lib/telemetry/sentry-scrubber.spec.ts` | Unit tests for scrubber               |
| `libs/shared/src/lib/telemetry/index.ts`                | Barrel export                         |
| `apps/ptah-license-server/src/instrument.ts`            | Sentry init for NestJS (first import) |
| `apps/ptah-electron/src/sentry.ts`                      | Sentry init for Electron main process |

### MODIFY (8 files)

| File                                             | Change                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `libs/shared/src/index.ts`                       | Add `export * from './lib/telemetry'`                            |
| `apps/ptah-license-server/src/main.ts`           | Add `import './instrument'` as first import; add SIGTERM handler |
| `apps/ptah-license-server/src/app/app.module.ts` | Add `SentryModule.forRoot()` and `SentryGlobalFilter`            |
| `apps/ptah-license-server/project.json`          | Add `@sentry/nestjs` to externals                                |
| `apps/ptah-license-server/Dockerfile`            | Add `@sentry/nestjs` to production npm install                   |
| `apps/ptah-electron/src/main.ts`                 | Import and call `initSentry()`, add `closeSentry()` to will-quit |
| `apps/ptah-electron/src/preload.ts`              | Add `import '@sentry/electron/preload'`                          |
| `apps/ptah-electron/project.json`                | Add `@sentry/electron` to build-main and build-preload externals |

### MODIFY (2 config files)

| File                              | Change                                                         |
| --------------------------------- | -------------------------------------------------------------- |
| `package.json` (root)             | Add `@sentry/electron` and `@sentry/nestjs` to dependencies    |
| `apps/ptah-electron/package.json` | Add `@sentry/electron` to dependencies                         |
| `.env.example`                    | Add `SENTRY_DSN` and `SENTRY_ENABLED` documentation            |
| `.gitignore`                      | Add `.env.sentry-build-plugin` (for future source map uploads) |

---

## Testing Approach

### Phase 1: Scrubber Unit Tests

Run the scrubber test suite:

```bash
nx test shared --testPathPattern=sentry-scrubber
```

Verify:

- API keys are redacted
- Email addresses are redacted
- File paths are normalized
- Long messages are truncated
- Request bodies and headers are stripped
- JWT tokens are redacted
- Database connection strings are redacted
- Events with no sensitive data pass through unchanged

### Phase 2: NestJS License Server

**Local verification** (requires a Sentry project with DSN):

1. Set `SENTRY_DSN` in `.env` for local dev
2. Start the server: `nx serve ptah-license-server`
3. Trigger an error:
   ```bash
   curl -X POST http://localhost:3000/api/v1/licenses/verify \
     -H 'Content-Type: application/json' \
     -d '{"key": "invalid"}'
   ```
4. Check Sentry dashboard for the error event
5. Verify no PII in the event (no request body, no auth headers)

**Verify opt-out**:

1. Unset `SENTRY_DSN` -- confirm log says `[Sentry] Disabled`
2. Set `SENTRY_ENABLED=false` with DSN set -- confirm log says `[Sentry] Disabled`

**Verify automatic tracing**:

1. With DSN set, make a few API requests
2. Check Sentry Performance tab for HTTP transaction spans
3. Verify route patterns (e.g., `POST /api/v1/licenses/verify`)

### Phase 3: Electron Main Process

**Local verification** (requires a Sentry project with DSN):

1. Set `SENTRY_DSN` env var or hardcode DSN in `sentry.ts`
2. Build and launch: `npm run electron:serve`
3. Check console for `[Sentry] Initialized for ptah-electron@0.1.1`
4. Force an error in the main process (e.g., throw in a test IPC handler)
5. Check Sentry dashboard for the error event
6. Verify the event has:
   - `release: ptah-electron@0.1.1`
   - No user PII
   - Normalized file paths

**Verify opt-out**:

1. Set `ptah.telemetry.enabled: false` in `<userData>/ptah-global-state.json`
2. Restart the app
3. Confirm log says `[Sentry] Disabled -- user opted out`

**Verify preload integration**:

1. Check console for no errors related to `@sentry/electron/preload`
2. Verify the preload script loads without issues

---

## Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in Node.js / Electron main process (no Angular/UI work)
- NestJS module registration follows standard NestJS patterns
- Electron main process is Node.js code
- The scrubber is pure TypeScript with no framework dependencies
- No browser APIs, no UI components, no CSS

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Phase 1 (Scrubber + tests): 1.5 hours
- Phase 2 (NestJS integration): 1.5 hours
- Phase 3 (Electron integration): 1.5 hours
- Testing and verification: 1 hour

---

## Architectural Decisions

### Decision 1: Scrubber in `libs/shared/` (not a separate library)

**Chosen approach**: Add `libs/shared/src/lib/telemetry/sentry-scrubber.ts` to the existing shared library.

**Rationale**: The shared library has zero dependencies and is the foundation layer imported by all apps. The scrubber also has zero Sentry SDK dependency (operates on plain objects), so it fits the shared library's boundary rules. Creating a separate `@ptah-extension/sentry` library would be over-engineering for a single utility file.

**Evidence**: The shared library already contains cross-cutting utilities (`pricing.utils.ts`, `session-totals.utils.ts`, `retry.utils.ts`) that follow the same pattern -- pure functions with no framework dependencies.

### Decision 2: Separate `sentry.ts` for Electron (not inline in `main.ts`)

**Chosen approach**: Create `apps/ptah-electron/src/sentry.ts` as a dedicated module.

**Rationale**: `main.ts` is already 710 lines with 7 initialization phases. Adding 80+ lines of Sentry logic inline would further bloat it. A separate module also makes the telemetry opt-out logic testable in isolation.

### Decision 3: Synchronous state file read for Electron telemetry opt-out

**Chosen approach**: Read `ptah-global-state.json` directly with `fs.readFileSync` in `sentry.ts`.

**Rationale**: Sentry MUST be initialized BEFORE `app.whenReady()` for crash reporting to capture native crashes from the earliest point. The DI container is not available until Phase 2 of `main.ts` (after `app.whenReady()`). Direct file read is the only option.

**Evidence**: The state file path convention comes from `PLATFORM_TOKENS.STATE_STORAGE` implementation in `platform-electron` library. The file is at `<userData>/ptah-global-state.json`.

### Decision 4: `instrument.ts` pattern for NestJS (not inline in `main.ts`)

**Chosen approach**: Create `apps/ptah-license-server/src/instrument.ts` imported as the first line of `main.ts`.

**Rationale**: This is the official `@sentry/nestjs` pattern documented by Sentry. The instrument file must be imported before ANY other module so that Sentry's OpenTelemetry hooks can patch Node.js HTTP and Express modules before they are loaded. Inline initialization in `bootstrap()` would be too late.

**Evidence**: Sentry NestJS docs explicitly require this pattern. The research document confirms it at Section 3.4.

### Decision 5: `SentryGlobalFilter` replaces (not supplements) default error handling

**Chosen approach**: Register `SentryGlobalFilter` via `APP_FILTER`.

**Rationale**: The license server currently has NO custom global exception filters (confirmed via Glob search). `SentryGlobalFilter` correctly does NOT capture `HttpException` (4xx errors are control flow, not bugs), only unexpected/unhandled exceptions. This matches the desired behavior.

**Evidence**: Glob search for `*filter*` in `apps/ptah-license-server/src/` returned zero results.

### Decision 6: No `@sentry/electron/preload` import guard

**Chosen approach**: Unconditionally import `@sentry/electron/preload` in `preload.ts`.

**Rationale**: The import is a no-op if Sentry was not initialized in the main process. There is no performance cost and no side effects when Sentry is disabled. Adding a conditional import would require IPC communication with the main process before the preload script can expose `window.vscode`, which would add unnecessary complexity.
