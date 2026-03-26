# Development Tasks - TASK_2025_223

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- axios already in root package.json (^1.6.0, line 96): VERIFIED
- axios import pattern is `import axios from 'axios'` (default import): VERIFIED in ptah-license-server-e2e
- esbuild `thirdParty: false` means npm packages resolve from node_modules at runtime: VERIFIED in both project.json files
- All 7 fetch call sites exist at documented file:line locations: VERIFIED by reading each file
- Electron net.fetch workaround exists at main.ts lines 10 and 51-58: VERIFIED
- `net` is only used for the fetch workaround (no other usages): VERIFIED

### Risks Identified

| Risk                                                                       | Severity | Mitigation                                                              |
| -------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| axios error shape differs from fetch (error.response vs response.ok)       | LOW      | Each pattern (A-E) documents exact error handling transformation        |
| URLSearchParams handling (axios auto-detects vs fetch needs .toString())   | LOW      | Pattern C explicitly documents removing .toString()                     |
| Copilot token exchange reads error body as text, axios returns parsed data | LOW      | Pattern E documents using `error.response.data` with stringify fallback |

### Edge Cases to Handle

- [x] Copilot error body may be string or parsed JSON -> use typeof check in Pattern E
- [x] Health check (Pattern D) treats ALL errors as failure -> simple try/catch, no AxiosError inspection needed
- [x] OpenRouter prefetch returns early on non-ok -> move to catch block, return 0 on AxiosError
- [x] License service has AbortController+setTimeout pattern (not AbortSignal.timeout) -> remove both, use axios timeout

---

## Batch 1: Dependency Setup + Electron Cleanup

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: None

This batch handles all build configuration changes and the Electron workaround removal. No library source code is modified here -- only project.json externals, app package.json dependencies, and the Electron main.ts cleanup.

---

### Task 1.1: Add axios to VS Code extension esbuild external list

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json`
**Spec Reference**: implementation-plan.md: lines 362-379 (Build Externalization - VS Code Extension)

**Implementation Details**:

- Add `"axios"` to the `external` array (currently lines 35-44)
- Place it after the last existing entry (`"tree-sitter-typescript"`)
- This ensures esbuild does not attempt to resolve axios at build time; it will be loaded from node_modules at runtime

---

### Task 1.2: Add axios to VS Code extension runtime dependencies

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Spec Reference**: implementation-plan.md: lines 383-397 (Runtime dependency - VS Code)
**Dependencies**: None (independent of Task 1.1)

**Implementation Details**:

- Add `"axios": "^1.6.0"` to the `dependencies` object (currently lines 564-573)
- This ensures axios is installed in the dist/node_modules during the pre-package step (`npm install --omit=dev`)

---

### Task 1.3: Add axios to Electron esbuild external list

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-electron\project.json`
**Spec Reference**: implementation-plan.md: lines 399-415 (Build Externalization - Electron)

**Implementation Details**:

- Add `"axios"` to the `external` array in the `build-main` target (currently lines 32-59)
- Place it after the last existing entry (`"p-queue"`)

---

### Task 1.4: Add axios to Electron runtime dependencies

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-electron\package.json`
**Spec Reference**: implementation-plan.md: lines 417-424 (Runtime dependency - Electron)
**Dependencies**: None (independent of Task 1.3)

**Implementation Details**:

- Add `"axios": "^1.6.0"` to the `dependencies` object (currently lines 12-36)

---

### Task 1.5: Remove net.fetch workaround from Electron main.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts`
**Spec Reference**: implementation-plan.md: lines 430-455 (Cleanup - Electron main.ts Workaround Removal)
**Dependencies**: Task 1.3, Task 1.4 (axios must be externalized and declared as dependency before removing the old workaround)

**Implementation Details**:

1. Remove `net` from the electron import destructure (line 10):
   - Before: `import { app, BrowserWindow, safeStorage, dialog, ipcMain, net } from 'electron';`
   - After: `import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';`
2. Remove the entire PHASE 0 block (lines 51-58): the comment block and `globalThis.fetch = net.fetch as typeof globalThis.fetch;`

**Quality Requirements**:

- The `net` import must be fully removed (it has no other usages in main.ts)
- The PHASE 0 comment block must be fully removed (all 7 lines from `// ========` through `globalThis.fetch = ...`)
- The PHASE 1 comment block that follows must remain intact

---

### Task 1.6: Verify builds pass after setup changes

**Status**: IMPLEMENTED
**Dependencies**: Tasks 1.1-1.5

**Verification Commands**:

```bash
nx typecheck ptah-extension-vscode
nx typecheck ptah-electron
nx build ptah-extension-vscode
nx build-main ptah-electron
```

**Quality Requirements**:

- All four commands must exit with code 0
- No new TypeScript errors introduced

---

**Batch 1 Verification**:

- All 5 files modified at correct locations
- `nx build ptah-extension-vscode` passes
- `nx build-main ptah-electron` passes
- code-logic-reviewer approved

---

## Batch 2: Migrate vscode-core (License Service)

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

This batch migrates the single most critical fetch call site: the license verification POST in vscode-core. Uses **Pattern A** (POST with JSON body).

**Migration Pattern**: Pattern A - POST with JSON body

- Remove AbortController + setTimeout + clearTimeout boilerplate
- Use `axios.post()` with `timeout` option
- Remove `JSON.stringify()` (axios serializes automatically)
- Remove `response.ok` check (axios throws on non-2xx)
- Replace `response.json()` with `{ data }` destructure
- Use `axios.isAxiosError()` for typed error handling

---

### Task 2.1: Replace fetch with axios in license.service.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
**Spec Reference**: implementation-plan.md: lines 76-143 (Pattern A)
**Pattern to Follow**: implementation-plan.md Pattern A (POST with JSON body)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file (with other imports)
- At line 432-469 (the fetch call site in the verification method):
  1. Remove the `AbortController` creation (line 432) and `setTimeout` (lines 433-435)
  2. Remove the `clearTimeout(timeoutId)` call (line 448) and the one in the catch block
  3. Replace `fetch(url, { method: 'POST', headers, body: JSON.stringify(...), signal })` with `axios.post(url, data, { headers, timeout })`
  4. Replace `if (!response.ok)` check with catch block using `axios.isAxiosError(error) && error.response`
  5. Replace `await response.json()` with `{ data: responseJson }` destructure from axios response
- Preserve ALL downstream logic unchanged: signature verification, community fallback, license status parsing

**Quality Requirements**:

- The `LicenseService.NETWORK_TIMEOUT_MS` constant must still be used (pass to axios `timeout` option)
- Error message format must match: `License verification failed: ${status} ${statusText}`
- All signature verification logic (lines 458+) must remain completely unchanged
- No AbortController, AbortSignal, setTimeout, or clearTimeout references should remain in the method

**Validation Notes**:

- This is the most critical migration: license verification in production Electron
- The error handling inversion (response.ok check -> catch block) must preserve the exact same error message string

---

### Task 2.2: Verify vscode-core typecheck passes

**Status**: IMPLEMENTED
**Dependencies**: Task 2.1

**Verification Commands**:

```bash
nx typecheck vscode-core
nx lint vscode-core
```

---

**Batch 2 Verification**:

- license.service.ts has no remaining `fetch(` calls
- No AbortController/AbortSignal/setTimeout boilerplate remains
- `nx typecheck vscode-core` passes
- code-logic-reviewer approved

---

## Batch 3: Migrate agent-sdk (4 call sites across 3 files)

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

This batch migrates all 4 fetch call sites in the agent-sdk library. Uses Patterns B, C, and E.

---

### Task 3.1: Replace fetch with axios in provider-models.service.ts (2 call sites)

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts`
**Spec Reference**: implementation-plan.md: lines 144-200 (Pattern B)
**Pattern to Follow**: implementation-plan.md Pattern B (GET with auth headers)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file

- **Call site 1** - `fetchDynamicModels()` (line 291): GET with auth headers
  1. Replace `fetch(provider.modelsEndpoint, { method: 'GET', headers: {...}, signal: AbortSignal.timeout(10_000) })` with `axios.get<ModelsApiResponse>(provider.modelsEndpoint, { headers: {...}, timeout: 10_000 })`
  2. Move the `if (!response.ok)` block (lines 301-309) into a catch block
  3. In the catch block: check `axios.isAxiosError(error) && error.response`, then check status 401/403 for the invalid key message, otherwise throw generic API error
  4. Replace `(await response.json()) as ModelsApiResponse` with `{ data }` destructure (typed via generic)

- **Call site 2** - `prefetchPricing()` (line 580): GET without auth
  1. Replace `fetch(openRouter.modelsEndpoint, { method: 'GET', headers: {...}, signal: AbortSignal.timeout(15_000) })` with `axios.get<ModelsApiResponse>(openRouter.modelsEndpoint, { headers: {...}, timeout: 15_000 })`
  2. Move the `if (!response.ok)` block (lines 589-593) into a catch block that logs the warning and returns 0
  3. Replace `(await response.json()) as ModelsApiResponse` with `{ data }` destructure

**Quality Requirements**:

- Both call sites must use `axios.get<ModelsApiResponse>()` with the generic type parameter
- Preserve exact error messages for 401/403 status handling
- The retry loop in `prefetchPricing()` must remain intact (only the fetch-to-axios swap inside it)

---

### Task 3.2: Replace fetch with axios in codex-auth.service.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-auth.service.ts`
**Spec Reference**: implementation-plan.md: lines 202-258 (Pattern C)
**Pattern to Follow**: implementation-plan.md Pattern C (POST with URL-encoded body)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file
- At `doRefreshAccessToken()` (line 395):
  1. Replace `fetch(REFRESH_URL, { method: 'POST', headers, body: new URLSearchParams({...}).toString(), signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })` with `axios.post(REFRESH_URL, new URLSearchParams({...}), { headers, timeout: REFRESH_TIMEOUT_MS })`
  2. Remove `.toString()` from URLSearchParams (axios accepts it directly)
  3. Move the `if (!response.ok)` block (lines 406-411) into a catch block: `if (axios.isAxiosError(error) && error.response)` -> log warning, return null
  4. Replace `(await response.json()) as {...}` with typed `axios.post<{...}>()` and `{ data: body }` destructure

**Quality Requirements**:

- The explicit `Content-Type: application/x-www-form-urlencoded` header must be preserved
- The `REFRESH_TIMEOUT_MS` constant must be used in axios timeout
- Return `null` on HTTP errors (preserve existing behavior)

---

### Task 3.3: Replace fetch with axios in copilot-auth.service.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts`
**Spec Reference**: implementation-plan.md: lines 305-356 (Pattern E)
**Pattern to Follow**: implementation-plan.md Pattern E (GET with response body on error)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file
- At `exchangeToken()` (line 242):
  1. Replace `fetch(COPILOT_TOKEN_URL, { method: 'GET', headers: {...}, signal: AbortSignal.timeout(15_000) })` with `axios.get<CopilotTokenResponse>(COPILOT_TOKEN_URL, { headers: {...}, timeout: 15_000 })`
  2. Move the entire `if (!response.ok)` block (lines 252-268) into a catch block
  3. In the catch block: extract error body from `error.response.data` using `typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)` (because the original code used `response.text()` which always returns string)
  4. Preserve status-specific logging: 401 -> "GitHub token may be invalid or expired", 403 -> "Copilot subscription may not be active"
  5. Replace `const tokenResponse: CopilotTokenResponse = await response.json()` with `{ data: tokenResponse }` destructure

**Quality Requirements**:

- Error body extraction must handle both string and parsed JSON responses (axios auto-parses JSON)
- All three logger.error calls in the error path must be preserved with identical messages
- The `return false` on error must be preserved
- The `getExtensionVersion()` call in the User-Agent header must remain

**Validation Notes**:

- This is the most complex migration due to the error body reading difference between fetch (response.text()) and axios (error.response.data which may be pre-parsed)

---

### Task 3.4: Verify agent-sdk typecheck passes

**Status**: IMPLEMENTED
**Dependencies**: Tasks 3.1, 3.2, 3.3

**Verification Commands**:

```bash
nx typecheck agent-sdk
nx lint agent-sdk
```

---

**Batch 3 Verification**:

- All 3 source files have no remaining `fetch(` calls
- No AbortSignal.timeout references remain
- `nx typecheck agent-sdk` passes
- code-logic-reviewer approved

---

## Batch 4: Migrate llm-abstraction (2 call sites) + Final Verification

**Status**: IMPLEMENTED
**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

This batch migrates the final 2 fetch call sites in llm-abstraction and runs full cross-project verification.

---

### Task 4.1: Replace fetch with axios in agent-process-manager.service.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: implementation-plan.md: lines 266-299 (Pattern D)
**Pattern to Follow**: implementation-plan.md Pattern D (Simple GET health check)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file
- At the MCP health check (line 1476):
  1. Replace `fetch(`http://localhost:${configuredPort}/health`, { signal: AbortSignal.timeout(2000) })` with `axios.get(`http://localhost:${configuredPort}/health`, { timeout: 2000 })`
  2. Remove the `if (response.ok)` check -- if axios.get succeeds (no throw), it means 2xx
  3. Move the success logic (mcpHealthCache assignment + logger.info + return) to immediately after the axios.get call
  4. The existing catch block should remain but now catches both network errors AND non-2xx status codes (which is correct behavior for a health check)

**Quality Requirements**:

- Success path: set mcpHealthCache with port + timestamp, log info, return configuredPort
- Failure path: set mcpHealthCache with undefined port + timestamp (preserve existing failure behavior)
- No AxiosError inspection needed -- any error means health check failed

---

### Task 4.2: Replace fetch with axios in codex-cli.adapter.ts

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`
**Spec Reference**: implementation-plan.md: lines 202-258 (Pattern C - same as codex-auth.service.ts)
**Pattern to Follow**: implementation-plan.md Pattern C (POST with URL-encoded body)

**Implementation Details**:

- Add `import axios from 'axios';` at the top of the file
- At `doRefreshAccessToken()` (line 355):
  1. Replace `fetch(CodexCliAdapter.REFRESH_URL, { method: 'POST', headers, body: new URLSearchParams({...}).toString(), signal: AbortSignal.timeout(10_000) })` with `axios.post(CodexCliAdapter.REFRESH_URL, new URLSearchParams({...}), { headers, timeout: 10_000 })`
  2. Remove `.toString()` from URLSearchParams
  3. Move the `if (!response.ok) return null;` (line 366) into a catch block: `if (axios.isAxiosError(error) && error.response) return null;`
  4. Replace `(await response.json()) as {...}` with typed `axios.post<{...}>()` and `{ data: body }` destructure

**Quality Requirements**:

- The explicit `Content-Type: application/x-www-form-urlencoded` header must be preserved
- Return `null` on HTTP errors (same behavior as before)
- The atomic file write logic after token refresh (lines 376+) must remain completely unchanged

---

### Task 4.3: Full cross-project verification

**Status**: IMPLEMENTED
**Dependencies**: Tasks 4.1, 4.2, and all prior batches

**Verification Commands**:

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

**Quality Requirements**:

- All typecheck commands pass
- All build commands pass
- All lint commands pass
- Zero remaining `fetch(` calls in the 7 migrated files (grep verification)

---

**Batch 4 Verification**:

- All 2 source files have no remaining `fetch(` calls
- `nx typecheck llm-abstraction` passes
- Full cross-project typecheck, build, and lint pass
- Zero raw fetch() calls remain in any backend library
- code-logic-reviewer approved

---

## Files Affected Summary

**MODIFY (10 files)**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json` -- add axios to esbuild external
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json` -- add axios to runtime dependencies
- `D:\projects\ptah-extension\apps\ptah-electron\project.json` -- add axios to esbuild external
- `D:\projects\ptah-extension\apps\ptah-electron\package.json` -- add axios to runtime dependencies
- `D:\projects\ptah-extension\apps\ptah-electron\src\main.ts` -- remove net import and globalThis.fetch workaround
- `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts` -- replace 1 fetch with axios (Pattern A)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts` -- replace 2 fetch calls with axios (Pattern B)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\codex-provider\codex-auth.service.ts` -- replace 1 fetch with axios (Pattern C)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\copilot-provider\copilot-auth.service.ts` -- replace 1 fetch with axios (Pattern E)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` -- replace 1 fetch with axios (Pattern D)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts` -- replace 1 fetch with axios (Pattern C)

**CREATE**: None
**DELETE**: None
