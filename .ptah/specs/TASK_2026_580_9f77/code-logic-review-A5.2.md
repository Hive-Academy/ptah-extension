VERDICT: APPROVED

Score: 9.5/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 1

---

### Scope & Review Context

Batch A5.2 implements the VS Code host proof for session organization being unavailable (TASK_2026_580, plan component 9, D5, AC7 narrowed).

Reviewed file:

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts` (new file, untracked)

Unchanged file considered under deviation review:

- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`

All other uncommitted files in the worktree belong to other batches (A5.1, C0.2) and were excluded from this review.

---

### Verification Summary

1. **Test Execution**:
   - `node ./node_modules/jest/bin/jest.js --config apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts`:
     - **1 suite passed, 11 tests passed, 0 failed** (47.2s).
2. **Source Scan Verification**:
   - Evaluated `srcRoot` path calculation (`path.join(__dirname, '..')` from `src/di`) against actual directory structure.
   - Verified that `fs.readdirSync(srcRoot, { recursive: true })` filtered for `.ts` and non-spec files traverses **32 production TypeScript files** (including `activation/bootstrap.ts`, `di/phase-0-platform.ts`, `di/phase-2-libraries.ts`, `main.ts`, etc.).
   - Confirmed no production files in `apps/ptah-extension-vscode/src` reference `@ptah-extension/session-organization`, `registerSessionOrganizationServices`, or `startSessionOrganization`.

---

### Detailed Code-Logic Analysis

#### 1. RPC Plan & Surface Coverage

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:127-136`:
  - Drives `resolveRpcHandlerPlan(createVscodeRpcHostProfile(makeLogger()))`.
  - Asserts that `sessionOrganization` is planned as a library-owned handler (`{ key: 'sessionOrganization', ctor: SessionOrganizationRpcHandlers, libOwned: true }`).
- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:138-143`:
  - Drives `deriveRpcSurface(profile)`.
  - Proves all six methods in `SessionOrganizationRpcHandlers.METHODS` (`session:setOrganization`, `session:linkTask`, `session:unlinkTask`, `session:addPrLink`, `session:removePrLink`, `session:listForTasks`) are registered in the served RPC surface on VS Code.

#### 2. Handler Resolution & Unbound Services

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:81-122, 147-165`:
  - `compose()` creates a container with real `vscode-core` registrations and mock dependencies for `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `SDK_TOKENS.SDK_SESSION_METADATA_STORE`, and `SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY`.
  - `c.resolve(step.ctor).register()` executes without error, confirming clean resolution.
  - Formally verifies that `c.isRegistered(SESSION_ORGANIZATION_TOKENS.SERVICE, true)` is `false` and `c.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, true)` is `false`.
  - Confirms all six methods are registered on the host `RpcHandler`.

#### 3. Subscription Absence Proof

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:161-164`:
  - `SessionOrganizationRpcHandlers` (`libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts:128-142`) injects `SESSION_ORGANIZATION_TOKENS.SERVICE` with `{ isOptional: true }`.
  - In constructor, event subscription is guarded: `if (this.organization) { this.organization.onDidChange(...) }`.
  - Because `SERVICE` is not registered in the container, `this.organization` is `undefined`.
  - The handler logs `this.logger.debug('Session organization RPC handlers registered', { methods: [...], available: this.organization !== undefined })` (`session-organization-rpc.handlers.ts:173-176`).
  - Spec asserts `logger.debug` was called with `expect.objectContaining({ available: false })`.
  - **Adequacy Assessment**: The proof is adequate and sound. Because no service instance exists in the container, no event emitter exists to spy on. Verifying that the service token is unregistered in DI, that registration emitted `available: false`, and that constructor execution succeeded without throwing proves that no subscription was attached or attempted.

#### 4. Mutation Handling & Short-Circuit Authorization

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:48-57, 167-186`:
  - Table-driven test covers all 5 mutation methods:
    1. `session:setOrganization`
    2. `session:linkTask`
    3. `session:unlinkTask`
    4. `session:addPrLink`
    5. `session:removePrLink`
  - Each call yields `response.success === true` with payload `{ ok: false, reason: 'organization-unavailable', message: expect.any(String) }`.
  - Asserts `expect(metadataStore.get).not.toHaveBeenCalled()`.
  - This proves the handler checks `if (!organization) return UNAVAILABLE` prior to session authorization (`authorizeSession`), preventing metadata reads on unavailable hosts.

#### 5. List Handling

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:188-200`:
  - Calls `session:listForTasks` with valid params.
  - Asserts `response.success === true` and `response.data === { available: false }`.
  - Asserts `expect(metadataStore.getForWorkspace).not.toHaveBeenCalled()`.
  - Proves `session:listForTasks` immediately returns `{ available: false }` without querying workspace metadata.

#### 6. Parameter Validation Precedence

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:202-213`:
  - Sends `session:setOrganization` with `{ sessionId: SESSION_ID }` (missing required fields `priority`, `status`, or `pinned`).
  - Asserts `response.success === false` and `response.errorCode === 'INVALID_PARAMS'`.
  - Proves Zod schema parsing executes before the availability check, returning a standard validation error to clients rather than hiding schema defects behind `organization-unavailable`.

#### 7. Source Scan & Vacuity Check

- `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:221-237`:
  - Scans `srcRoot = path.join(__dirname, '..')`, resolving to `apps/ptah-extension-vscode/src`.
  - Filters all non-spec `.ts` files and checks for occurrences of `@ptah-extension/session-organization`, `registerSessionOrganizationServices`, or `startSessionOrganization`.
  - Asserts `offenders === []`.
  - Checked against vacuity: `readdirSync` traverses 32 production files. The scan cannot pass vacuously due to wrong root or empty directory on the current tree.

#### 8. Deviation Evaluation: `expected-resolvable.ts`

- **Plan Reference**: `batches.md` Task A5.2.1 notes:
  `expected-resolvable.ts (MODIFY, only if needed: R-TL10)`
- **Evaluation**:
  - `expected-resolvable.ts` lists handlers tested by `container.smoke.spec.ts` against `buildMinimalContainer()`.
  - `buildMinimalContainer()` only registers tokens required by the 6 pre-existing factory-wired shared handlers (addressing historical incident v0.1.45). It does not register `SDK_TOKENS.SDK_SESSION_METADATA_STORE` or `SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY`.
  - `SessionOrganizationRpcHandlers` has non-optional constructor parameters for `SDK_SESSION_METADATA_STORE` and `SDK_SESSION_TURN_STATE_REGISTRY`.
  - Adding `SessionOrganizationRpcHandlers` to `expected-resolvable.ts` would cause `container.smoke.spec.ts` to fail unless `container.smoke.spec.ts` was also updated with mock registrations for those SDK tokens (which was not in scope for A5.2).
  - Furthermore, `session-organization-unavailable.spec.ts` directly verifies that `SessionOrganizationRpcHandlers` cleanly resolves within the VS Code host configuration (`c.resolve(step.ctor).register()`).
  - **Verdict on Deviation**: Accepted and correct. The condition "only if needed: R-TL10" applies, and leaving `expected-resolvable.ts` unmodified preserves `container.smoke.spec.ts` integrity without expanding batch scope.

---

### Findings

#### [Minor] Advisory: Source Scan Cardinality Assertion Missing

- **File**: `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts:224-235`
- **Finding**: The scan filters files into `offenders` and asserts `expect(offenders).toEqual([])`. If `fs.readdirSync` failed or returned an empty array (e.g. if the directory structure changed or `{ recursive: true }` behaved unexpectedly), `offenders` would be `[]` and the test would vacuously pass.
- **Evidence**:
  ```typescript
  const offenders = (fs.readdirSync(srcRoot, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .filter((file) => { ... });
  expect(offenders).toEqual([]);
  ```
- **Remediation Suggestion**: In a future test-hardening pass, retain the filtered list of scanned files `const candidateFiles = ...` and assert `expect(candidateFiles.length).toBeGreaterThan(0)` before filtering for offenders. (Non-blocking; verified 32 files are currently scanned).

---

### Conclusion

Batch A5.2 satisfies all acceptance criteria: it proves that `sessionOrganization` is planned and served on VS Code, resolves without bound service or recorder, creates no change subscriptions, reports mutations as `organization-unavailable` without metadata access, returns `{ available: false }` for task listing, enforces parameter validation before availability checks, and verifies zero production registrations of session organization in the VS Code host.
