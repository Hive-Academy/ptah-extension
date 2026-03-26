# Implementation Plan - TASK_2025_223

## Replace raw fetch() with axios across all backend libraries

## Codebase Investigation Summary

### Libraries Discovered

- **axios** (^1.6.0): Already installed in root `package.json` (line 96). Used in `ptah-license-server-e2e` tests (`import axios from 'axios'`). Not yet used in any backend library.
- **vscode-core**: Contains `LicenseService` with 1 fetch call site (license verification POST).
- **agent-sdk**: Contains 4 fetch call sites across 3 files (provider models GET x2, Codex OAuth POST, Copilot token GET).
- **llm-abstraction**: Contains 2 fetch call sites across 2 files (MCP health check GET, Codex CLI token refresh POST).

### All fetch() Call Sites (7 total)

| #   | File                                                                              | Line | Method | Purpose                                | Timeout                               |
| --- | --------------------------------------------------------------------------------- | ---- | ------ | -------------------------------------- | ------------------------------------- |
| 1   | `libs/backend/vscode-core/src/services/license.service.ts`                        | 438  | POST   | License verification                   | 5000ms (AbortController + setTimeout) |
| 2   | `libs/backend/agent-sdk/src/lib/provider-models.service.ts`                       | 291  | GET    | Provider model listing (authenticated) | 10000ms (AbortSignal.timeout)         |
| 3   | `libs/backend/agent-sdk/src/lib/provider-models.service.ts`                       | 580  | GET    | OpenRouter pricing prefetch (no auth)  | 15000ms (AbortSignal.timeout)         |
| 4   | `libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts`             | 395  | POST   | Codex OAuth token refresh              | 10000ms (AbortSignal.timeout)         |
| 5   | `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts`         | 242  | GET    | Copilot token exchange                 | 15000ms (AbortSignal.timeout)         |
| 6   | `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`  | 1476 | GET    | MCP server health check (localhost)    | 2000ms (AbortSignal.timeout)          |
| 7   | `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` | 355  | POST   | Codex CLI token refresh                | 10000ms (AbortSignal.timeout)         |

### Build Configuration

- **VS Code extension** (`apps/ptah-extension-vscode/project.json`): Uses `@nx/esbuild:esbuild` with `thirdParty: false` and explicit `external` array (line 35-44). Currently externalizes: vscode, claude-agent-sdk, copilot-sdk, codex-sdk, reflect-metadata, tsyringe, tree-sitter variants.
- **Electron main** (`apps/ptah-electron/project.json`): Uses `@nx/esbuild:esbuild` with `thirdParty: false` and explicit `external` array (line 32-59). Contains ~28 externalized packages.
- Both builds use `bundle: true` with `thirdParty: false`, meaning all workspace libs are bundled but npm packages are NOT bundled (they resolve from `node_modules` at runtime).

### Electron Workaround to Remove

`apps/ptah-electron/src/main.ts` lines 10, 52-58:

- Imports `net` from `electron` (line 10)
- Sets `globalThis.fetch = net.fetch as typeof globalThis.fetch` (line 58)
- `net` is ONLY used for this workaround (verified: only 3 occurrences of `net` in file, all related to this)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Direct replacement of all `fetch()` calls with `axios`, leveraging axios's built-in features to simplify code.

**Rationale**: axios uses Node.js `http`/`https` modules internally, which correctly inherit proxy and certificate settings on all platforms (VS Code extension host, Electron main process, standalone Node.js). This eliminates the need for the `globalThis.fetch = net.fetch` workaround entirely.

**Evidence**: axios is already a dependency (`package.json:96`) and used in the codebase (`ptah-license-server-e2e`). The existing import pattern is `import axios from 'axios'`.

### Key Behavioral Differences (fetch vs axios)

These differences affect how each call site must be migrated:

1. **Error handling**: `fetch` only rejects on network errors; non-2xx responses require manual `response.ok` check. `axios` throws `AxiosError` on any non-2xx status, with `error.response` containing status/data.

2. **JSON parsing**: `fetch` requires `await response.json()`. `axios` auto-parses JSON responses (configurable via `responseType`).

3. **Timeout**: `fetch` requires `AbortController` + `setTimeout` or `AbortSignal.timeout()`. `axios` has built-in `timeout` option (milliseconds).

4. **Request body**: `fetch` requires `JSON.stringify()` for JSON bodies. `axios` auto-serializes objects.

5. **URL-encoded bodies**: `fetch` with `URLSearchParams.toString()` becomes `axios` with `URLSearchParams` directly (axios detects the type and sets Content-Type automatically).

6. **Response structure**: `fetch` returns `Response` with `.ok`, `.status`, `.statusText`, `.json()`. `axios` returns `AxiosResponse` with `.data`, `.status`, `.statusText`, `.headers`.

### Electron Configuration

**No Electron-specific adapter is needed.** axios uses Node.js `http`/`https` modules which work correctly in Electron's main process. Unlike `fetch()` (which in Electron uses Node's native implementation and bypasses Chromium's network stack), Node's `http`/`https` modules respect system proxy settings via environment variables (`HTTP_PROXY`, `HTTPS_PROXY`). axios additionally supports proxy configuration directly. This is why the `globalThis.fetch = net.fetch` workaround is no longer necessary.

---

## Migration Patterns

### Pattern A: POST with JSON body (license.service.ts)

**Before** (fetch):

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => {
  controller.abort();
}, LicenseService.NETWORK_TIMEOUT_MS);

try {
  const response = await fetch(`${this.licenseServerUrl}/api/v1/licenses/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenseKey }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`License verification failed: ${response.status} ${response.statusText}`);
  }

  const responseJson = await response.json();
  // ... use responseJson
} catch (fetchError) {
  clearTimeout(timeoutId);
  throw fetchError;
}
```

**After** (axios):

```typescript
import axios from 'axios';

// No AbortController needed — axios has built-in timeout
try {
  const { data: responseJson } = await axios.post(
    `${this.licenseServerUrl}/api/v1/licenses/verify`,
    { licenseKey },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: LicenseService.NETWORK_TIMEOUT_MS,
    },
  );

  // axios auto-parses JSON, auto-throws on non-2xx
  // ... use responseJson directly
} catch (error) {
  // axios wraps HTTP errors in AxiosError with error.response
  if (axios.isAxiosError(error) && error.response) {
    throw new Error(`License verification failed: ${error.response.status} ${error.response.statusText}`);
  }
  throw error;
}
```

**Key changes**:

- Remove `AbortController` + `setTimeout` + `clearTimeout` boilerplate
- Use `axios.post()` with `timeout` option
- Remove `JSON.stringify()` — axios serializes automatically
- Remove `response.ok` check — axios throws on non-2xx
- Replace `response.json()` with `{ data }` destructure
- Use `axios.isAxiosError()` for typed error handling

### Pattern B: GET with auth headers (provider-models.service.ts, copilot-auth.service.ts)

**Before** (fetch):

```typescript
const response = await fetch(provider.modelsEndpoint as string, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Ptah-Extension/1.0',
  },
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${provider.name} API key is invalid or expired.`);
  }
  throw new Error(`${provider.name} API error: ${response.status} ${response.statusText}`);
}

const data = (await response.json()) as ModelsApiResponse;
```

**After** (axios):

```typescript
import axios from 'axios';

try {
  const { data } = await axios.get<ModelsApiResponse>(provider.modelsEndpoint as string, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Ptah-Extension/1.0',
    },
    timeout: 10_000,
  });

  // data is already typed as ModelsApiResponse
} catch (error) {
  if (axios.isAxiosError(error) && error.response) {
    if (error.response.status === 401 || error.response.status === 403) {
      throw new Error(`${provider.name} API key is invalid or expired.`);
    }
    throw new Error(`${provider.name} API error: ${error.response.status} ${error.response.statusText}`);
  }
  throw error;
}
```

**Key changes**:

- Use `axios.get<T>()` with generic type for auto-typed response
- Replace `AbortSignal.timeout()` with `timeout` option
- Move status-specific error handling into catch block using `axios.isAxiosError()`

### Pattern C: POST with URL-encoded body (codex-auth.service.ts, codex-cli.adapter.ts)

**Before** (fetch):

```typescript
const response = await fetch(REFRESH_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  }).toString(),
  signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
});

if (!response.ok) {
  this.logger.warn(`[CodexAuth] Token refresh failed: HTTP ${response.status}`);
  return null;
}

const body = (await response.json()) as { access_token?: string; ... };
```

**After** (axios):

```typescript
import axios from 'axios';

try {
  const { data: body } = await axios.post<{
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  }>(
    REFRESH_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: REFRESH_TIMEOUT_MS,
    },
  );

  // body is already typed and parsed
} catch (error) {
  if (axios.isAxiosError(error) && error.response) {
    this.logger.warn(`[CodexAuth] Token refresh failed: HTTP ${error.response.status}`);
    return null;
  }
  throw error;
}
```

**Key changes**:

- Pass `URLSearchParams` directly (no `.toString()`) — axios detects the type
- Use generic type parameter for typed response
- Non-2xx now caught in catch block

### Pattern D: Simple GET health check (agent-process-manager.service.ts)

**Before** (fetch):

```typescript
const response = await fetch(`http://localhost:${configuredPort}/health`, {
  signal: AbortSignal.timeout(2000),
});

if (response.ok) {
  this.mcpHealthCache = { port: configuredPort, timestamp: Date.now() };
  return configuredPort;
}
```

**After** (axios):

```typescript
import axios from 'axios';

try {
  await axios.get(`http://localhost:${configuredPort}/health`, {
    timeout: 2000,
  });

  // If we reach here, status was 2xx
  this.mcpHealthCache = { port: configuredPort, timestamp: Date.now() };
  return configuredPort;
} catch {
  // Any error (network, non-2xx) means health check failed
  this.mcpHealthCache = { port: undefined, timestamp: Date.now() };
  return undefined;
}
```

**Key changes**:

- Simplest migration: success = 2xx, any error = failure

### Pattern E: GET for Copilot token exchange with response body on error (copilot-auth.service.ts)

**Before** (fetch):

```typescript
const response = await fetch(COPILOT_TOKEN_URL, {
  method: 'GET',
  headers: {
    Authorization: `token ${githubToken}`,
    Accept: 'application/json',
    'User-Agent': `ptah-extension/${getExtensionVersion()}`,
  },
  signal: AbortSignal.timeout(15_000),
});

if (!response.ok) {
  const body = await response.text();
  this.logger.error(`[CopilotAuth] Token exchange failed: HTTP ${response.status} — ${body}`);
  // status-specific messages...
  return false;
}

const tokenResponse: CopilotTokenResponse = await response.json();
```

**After** (axios):

```typescript
import axios from 'axios';

try {
  const { data: tokenResponse } = await axios.get<CopilotTokenResponse>(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/json',
      'User-Agent': `ptah-extension/${getExtensionVersion()}`,
    },
    timeout: 15_000,
  });

  // tokenResponse is already typed and parsed
} catch (error) {
  if (axios.isAxiosError(error) && error.response) {
    const body = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
    this.logger.error(`[CopilotAuth] Token exchange failed: HTTP ${error.response.status} — ${body}`);
    // status-specific messages...
    return false;
  }
  // Network error or other
  throw error;
}
```

---

## Build Externalization

### VS Code Extension (`apps/ptah-extension-vscode/project.json`)

Add `"axios"` to the `external` array (line 35-44):

```json
"external": [
  "vscode",
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
  "@openai/codex-sdk",
  "reflect-metadata",
  "tsyringe",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript",
  "axios"
]
```

**Rationale**: With `thirdParty: false`, esbuild does NOT bundle npm packages by default — they're expected to be in `node_modules` at runtime. However, the `external` array explicitly marks packages that should be resolved at runtime. Since `axios` is imported by bundled library code, it must be in the external list to prevent esbuild from attempting to resolve it at build time.

**Runtime dependency**: `axios` must also be added to `apps/ptah-extension-vscode/package.json` dependencies so it's installed in the `dist/` `node_modules` during the `pre-package` step (`npm install --omit=dev`):

```json
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "^0.2.81",
  "@github/copilot-sdk": "^0.1.25",
  "@openai/codex-sdk": "^0.104.0",
  "axios": "^1.6.0",
  "reflect-metadata": "^0.2.2",
  "tsyringe": "^4.10.0",
  "tree-sitter": "^0.21.1",
  "tree-sitter-javascript": "^0.23.1",
  "tree-sitter-typescript": "^0.23.2"
}
```

### Electron App (`apps/ptah-electron/project.json`)

Add `"axios"` to the `external` array in the `build-main` target (line 32-59):

```json
"external": [
  "electron",
  "electron-updater",
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
  "@openai/codex-sdk",
  "reflect-metadata",
  "tsyringe",
  ... existing entries ...,
  "axios"
]
```

**Runtime dependency**: Also add to `apps/ptah-electron/package.json`:

```json
"dependencies": {
  ... existing entries ...,
  "axios": "^1.6.0"
}
```

---

## Cleanup

### Electron main.ts Workaround Removal

In `apps/ptah-electron/src/main.ts`:

1. **Remove `net` from the electron import** (line 10):

   ```typescript
   // Before:
   import { app, BrowserWindow, safeStorage, dialog, ipcMain, net } from 'electron';

   // After:
   import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';
   ```

2. **Remove the entire PHASE 0 block** (lines 51-58):
   ```typescript
   // Remove these lines entirely:
   // ========================================
   // PHASE 0: Use Electron's net.fetch for all network requests
   // ========================================
   // Node.js's native fetch bypasses Chromium's network stack — it ignores
   // system proxy settings, custom certificates, and authentication challenges.
   // Electron's net.fetch uses Chromium's networking, which handles all of these.
   // This is critical for license verification and any other HTTPS calls.
   globalThis.fetch = net.fetch as typeof globalThis.fetch;
   ```

---

## Batch Plan

### Batch 1: Dependency & Build Setup

**Files**:

- `package.json` (VERIFY — axios already at ^1.6.0, no change needed)
- `apps/ptah-extension-vscode/project.json` (MODIFY — add `"axios"` to external list)
- `apps/ptah-extension-vscode/package.json` (MODIFY — add `"axios": "^1.6.0"` to dependencies)
- `apps/ptah-electron/project.json` (MODIFY — add `"axios"` to external list)
- `apps/ptah-electron/package.json` (MODIFY — add `"axios": "^1.6.0"` to dependencies)

**Verification**: Run `npm install` to ensure no conflicts. Run `nx build ptah-extension-vscode` and `nx build-main ptah-electron` to verify builds succeed with the new external.

### Batch 2: Migrate vscode-core (License Service)

**Files**:

- `libs/backend/vscode-core/src/services/license.service.ts` (MODIFY — replace fetch with axios, Pattern A)

**Scope**: 1 call site. This is the most critical migration (license verification in production Electron).

**Key changes**:

- Add `import axios from 'axios'`
- Replace AbortController/setTimeout/clearTimeout with axios `timeout` option
- Replace `response.ok` check with axios error handling
- Replace `response.json()` with `{ data }` destructure
- Preserve all signature verification logic (unchanged)
- Preserve all community fallback logic (unchanged)

**Verification**: `nx typecheck vscode-core` should pass. Manual test: license verification works in VS Code extension host.

### Batch 3: Migrate agent-sdk (4 call sites)

**Files**:

- `libs/backend/agent-sdk/src/lib/provider-models.service.ts` (MODIFY — 2 call sites, Pattern B)
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts` (MODIFY — 1 call site, Pattern C)
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` (MODIFY — 1 call site, Pattern E)

**Scope**: 4 call sites across 3 files.

**Key changes per file**:

`provider-models.service.ts`:

- Add `import axios from 'axios'`
- `fetchDynamicModels()` (line 291): Replace fetch GET with `axios.get<ModelsApiResponse>()`, handle 401/403 in catch block
- `prefetchPricing()` (line 580): Replace fetch GET with `axios.get<ModelsApiResponse>()`, handle non-ok in catch block

`codex-auth.service.ts`:

- Add `import axios from 'axios'`
- `doRefreshAccessToken()` (line 395): Replace fetch POST with `axios.post()` using URLSearchParams body, move non-ok handling to catch block

`copilot-auth.service.ts`:

- Add `import axios from 'axios'`
- `exchangeToken()` (line 242): Replace fetch GET with `axios.get<CopilotTokenResponse>()`, move error body reading to catch block

**Verification**: `nx typecheck agent-sdk` should pass.

### Batch 4: Migrate llm-abstraction (2 call sites)

**Files**:

- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` (MODIFY — 1 call site, Pattern D)
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY — 1 call site, Pattern C)

**Scope**: 2 call sites across 2 files.

**Key changes**:

`agent-process-manager.service.ts`:

- Add `import axios from 'axios'`
- MCP health check (line 1476): Replace with `axios.get()`, simplify to try/catch where success = 2xx, failure = any error

`codex-cli.adapter.ts`:

- Add `import axios from 'axios'`
- `doRefreshAccessToken()` (line 355): Same pattern as codex-auth.service.ts (Pattern C), URL-encoded POST

**Verification**: `nx typecheck llm-abstraction` should pass.

### Batch 5: Electron Cleanup

**Files**:

- `apps/ptah-electron/src/main.ts` (MODIFY — remove `net` import and globalThis.fetch workaround)

**Scope**: Remove 2 things:

1. Remove `net` from the electron import destructure (line 10)
2. Remove the entire PHASE 0 block (lines 51-58)

**Verification**: `nx typecheck ptah-electron` should pass. `nx build-main ptah-electron` should succeed. Manual test: Electron app starts and license verification works.

### Batch 6: Full Build Verification

**No file changes.** Run comprehensive checks:

```bash
# Typecheck all affected projects
nx typecheck vscode-core
nx typecheck agent-sdk
nx typecheck llm-abstraction
nx typecheck ptah-electron
nx typecheck ptah-extension-vscode

# Build all affected projects
nx build ptah-extension-vscode
nx build-main ptah-electron

# Lint all affected projects
nx lint vscode-core
nx lint agent-sdk
nx lint llm-abstraction
```

---

## Files Affected Summary

**MODIFY** (10 files):

- `apps/ptah-extension-vscode/project.json` — add axios to esbuild external list
- `apps/ptah-extension-vscode/package.json` — add axios to runtime dependencies
- `apps/ptah-electron/project.json` — add axios to esbuild external list
- `apps/ptah-electron/package.json` — add axios to runtime dependencies
- `apps/ptah-electron/src/main.ts` — remove net import and globalThis.fetch workaround
- `libs/backend/vscode-core/src/services/license.service.ts` — replace 1 fetch with axios
- `libs/backend/agent-sdk/src/lib/provider-models.service.ts` — replace 2 fetch calls with axios
- `libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts` — replace 1 fetch with axios
- `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` — replace 1 fetch with axios
- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` — replace 1 fetch with axios
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` — replace 1 fetch with axios

**CREATE**: None.
**DELETE**: None.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**: All changes are in Node.js backend libraries. No UI/Angular work. Pure HTTP client replacement with build config updates.

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

**Breakdown**:

- Batch 1 (build setup): ~15 min
- Batch 2 (license service): ~20 min
- Batch 3 (agent-sdk, 4 sites): ~40 min
- Batch 4 (llm-abstraction, 2 sites): ~20 min
- Batch 5 (Electron cleanup): ~10 min
- Batch 6 (full verification): ~15 min

### Critical Verification Points

**Before implementation, developer must verify**:

1. **axios import pattern**: Use `import axios from 'axios'` (default import, verified from `apps/ptah-license-server-e2e/src/support/test-setup.ts:2`)
2. **axios is already in root package.json**: `"axios": "^1.6.0"` at line 96 — no npm install of a new package needed
3. **Error handling inversion**: fetch requires checking `response.ok`; axios throws on non-2xx. Every call site's error handling must be restructured accordingly
4. **URLSearchParams**: axios accepts `URLSearchParams` directly as request body and auto-sets `Content-Type: application/x-www-form-urlencoded` — but the existing explicit header should be preserved for clarity
5. **No `AbortSignal.timeout()` needed**: axios `timeout` option replaces all `AbortSignal.timeout()` and `AbortController + setTimeout` patterns
6. **Localhost health check**: The MCP health check (`agent-process-manager.service.ts`) hits localhost, so the proxy/cert concern doesn't apply — but migrating it anyway for consistency and to eliminate all raw fetch usage

### Architecture Delivery Checklist

- [x] All 7 fetch call sites identified with file:line citations
- [x] Migration patterns documented (5 patterns covering all variations)
- [x] Build externalization specified for both VS Code and Electron
- [x] Runtime dependency additions specified for both app package.json files
- [x] Electron workaround cleanup documented
- [x] No new patterns invented — follows existing axios usage from e2e tests
- [x] Work grouped into 6 logical batches
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 2-3 hours)
