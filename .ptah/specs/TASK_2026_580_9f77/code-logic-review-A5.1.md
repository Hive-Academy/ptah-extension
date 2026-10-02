VERDICT: APPROVED

Score: 9.5/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 1

---

### Scope & Review Context

Batch A5.1 implements the host wiring for Session Organization on Electron and CLI (TASK_2026_580, plan component 9, risk R-TL11).

Reviewed files:

- [phase-2-libraries.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/phase-2-libraries.ts) (MODIFY: lines 79-85, 398-405)
- [container.smoke.spec.ts (Electron)](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/container.smoke.spec.ts) (MODIFY: lines 226, 234-253, 468-574)
- [register-thoth-libraries.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts) (MODIFY: lines 30-36, 156-164)
- [container.smoke.spec.ts (CLI)](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-cli/src/di/container.smoke.spec.ts) (MODIFY: lines 18-35, 314-491)

All other uncommitted files in the worktree belong to other batches (C2.2) and were excluded from this review. No code was modified during this review.

---

### Verification Summary

1. **Electron Smoke Spec Execution**:
   - `node ./node_modules/jest/bin/jest.js --config apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts -t "Session organization"`
   - Result: **1 suite passed, 2 passed, 14 skipped, 0 failed** (31.2s).
2. **CLI Smoke Spec Execution**:
   - `node ./node_modules/jest/bin/jest.js --config apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/di/container.smoke.spec.ts -t "Session organization"`
   - Result: **1 suite passed, 2 passed, 7 skipped, 0 failed** (40.0s).

---

### Detailed Code-Logic Analysis

#### 1. Host Registration Ordering & Cardinality

Both hosts wire session organization exactly once and in the strictly required sequence:

1. `registerSdkServices` (which binds `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` alongside metadata store and lifecycle registries)
2. `registerPersistenceSqliteServices` (which binds `PERSISTENCE_TOKENS.SQLITE_CONNECTION`)
3. `startTaskSpecsIndex`
4. `registerSessionOrganizationServices`
5. `startSessionOrganization`

- **Electron host** ([`phase-2-libraries.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/phase-2-libraries.ts)):
  - Line 198: `registerSdkServices(container, logger);`
  - Line 362: `registerPersistenceSqliteServices(container, logger);`
  - Line 397: `startTaskSpecsIndex(container, logger);`
  - Lines 404–405:
    ```ts
    registerSessionOrganizationServices(container);
    startSessionOrganization(container);
    ```
  - `PtahAPIBuilder` is registered in phase 3 ([`phase-3-storage.ts:68`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/phase-3-storage.ts)), which is invoked by [`ElectronDIContainer.setup`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/container.ts#L43-L44) strictly after `registerPhase2Libraries`.
  - Capture producers (`WorktreeHookHandler`, `SessionForkService`) registered as lazy singletons during `registerSdkServices` are not referenced or resolved anywhere within phase 2 prior to line 404.

- **CLI host** ([`register-thoth-libraries.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts) & [`container.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-engine/src/lib/container.ts)):
  - In `container.ts:640`: `registerSdkServices(container, logger);`
  - In `container.ts:716`: `registerThothLibraries(container, logger);`
  - Inside `register-thoth-libraries.ts`:
    - Line 105: `registerPersistenceSqliteServices(container, logger);`
    - Line 154: `startTaskSpecsIndex(container, logger);`
    - Lines 162–163:
      ```ts
      registerSessionOrganizationServices(container);
      startSessionOrganization(container);
      ```
  - In `container.ts:785`: `registerVsCodeLmToolsServices(container, logger);` runs in phase 4, after `registerThothLibraries`.
  - Neither `SDK_WORKTREE_HOOK_HANDLER`, `SDK_SESSION_FORK_SERVICE`, nor `PTAH_API_BUILDER` is resolved prior to session organization registration.

#### 2. Non-Fatal Start and Error Reporting

`startSessionOrganization` ([`libs/backend/session-organization/src/lib/di/start.ts:35-53`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts)):

- Checks whether `SessionOrganizationCaptureService` is registered. If missing, writes to `IOutputChannel` and returns `NOOP_DISPOSABLE`.
- Wraps resolution and `capture.start()` in a `try / catch (error: unknown)` boundary.
- Any thrown error is trapped and reported to `IOutputChannel` via `report(container, \`capture not started (non-fatal): \${describe(error)}\`)`.
- `report()` itself checks for `PLATFORM_TOKENS.OUTPUT_CHANNEL` and wraps `appendLine` in a `try / catch` to ensure it never throws into the host activation flow.
- Neither `phase-2-libraries.ts` nor `register-thoth-libraries.ts` can abort activation if session organization startup fails.

#### 3. Handling When SQLite is Unavailable

If SQLite registration fails or is skipped (e.g. native bindings fail to load, file permission error in `resolvePtahDbPath()`, or running on a host without SQLite):

- The `try / catch` blocks in `phase-2-libraries.ts:313-390` and `register-thoth-libraries.ts:60-130` swallow the error and log a warning; `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is never registered.
- `registerSessionOrganizationServices(container)` inspects `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)`. Finding it absent, it immediately returns without registering any singletons or tokens.
- `startSessionOrganization(container)` finds `SessionOrganizationCaptureService` unregistered, emits a non-fatal message to `IOutputChannel`, and returns `NOOP_DISPOSABLE`.
- At runtime:
  - Capture producers (`WorktreeHookHandler`, `SessionForkService`, `PtahAPIBuilder`) inject `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` with `{ isOptional: true }`. They receive `null` or `undefined` and safely bypass capture operations without throwing.
  - `SessionOrganizationRpcHandlers` injects `SESSION_ORGANIZATION_TOKENS.SERVICE` with `{ isOptional: true }`. All mutation RPCs return `{ ok: false, error: 'organization-unavailable' }`, and `session:listForTasks` returns `{ available: false }`.
  - `SessionRpcHandlers` receives `undefined` for `SESSION_ORGANIZATION_TOKENS.SERVICE` and returns `{ organizationAvailable: false }` for `session:list`.
- The system degrades cleanly without crashes.

#### 4. Risk R-TL11 & Producer Injection Proof

Risk R-TL11 addresses the hazard of singletons taking `SESSION_ORGANIZATION_RECORDER` as an optional constructor argument and being resolved before the recorder is registered.

- In both smoke specs ([`phase-2-libraries.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/container.smoke.spec.ts#L487-L574) and [`container.smoke.spec.ts (CLI)`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-cli/src/di/container.smoke.spec.ts#L324-L414)):
  - The runtime tests register services in real production order: `registerSdkServices`, stub `PERSISTENCE_TOKENS.SQLITE_CONNECTION`, register and start session organization, register `registerVsCodeLmToolsServices`, and resolve:
    - `c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)`
    - `c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE)`
    - `c.resolve(SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER)`
    - `c.resolve(SDK_TOKENS.SDK_SESSION_FORK_SERVICE)`
    - `c.resolve(TOKENS.PTAH_API_BUILDER)`
  - Asserts that all three producers hold the exact same bound instance (`recorder === service`).
  - Asserts that `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` has `size > 0` after start, confirming active PR capture subscription.
  - Asserts that no error was emitted to `IOutputChannel`.
- Evaluation of Test Mechanics:
  - **Reading private fields via `<{ recorder: unknown }>`**: This is necessary because neither producer class exposes a public getter for the optional recorder port. Reading the JS property directly is safe and guarantees the DI constructor assignment executed as expected. If the property is renamed or unbound, the test fails closed.
  - **Use of `{}` stubs for unrelated dependencies**: Stubs are required because booting the full production container is prohibited in Jest (native bindings, worker threads, UI lifecycle). Stubs satisfy tsyringe parameter resolution for unrelated services (`TOKENS.WORKSPACE_ANALYZER_SERVICE`, `TOKENS.FILE_SYSTEM_MANAGER`, etc.). None of these stubbed dependencies consume or rebind the recorder.
  - **Composite Proof**: Because synthetic containers cannot detect if an omitted dependency in production transitively resolves a producer early, the tests combine runtime verification with static AST/source order analysis. The source checks assert that `SDK_WORKTREE_HOOK_HANDLER`, `SDK_SESSION_FORK_SERVICE`, and `PTAH_API_BUILDER` do not appear anywhere in phase 2.

#### 5. Evaluation of Deviations

1. **CLI smoke spec modified rather than created**:
   - `batches.md` originally stated `CREATE, only if R-TL11 needs it: apps/ptah-cli/src/di/container.smoke.spec.ts`.
   - The file already existed in the repository (containing DI smoke tests for workspace watcher and watchdog from TASK_2026_437).
   - Adding a new `describe` block to the existing spec rather than duplicating container testing infrastructure is standard practice and correct.
2. **CLI order test reads `cli-engine` source via filesystem**:
   - `registerThothLibraries` is an internal engine implementation detail and is deliberately not exported in `@ptah-extension/cli-engine`'s public barrel (`libs/backend/cli-engine/src/index.ts`).
   - Reading the file directly via `fs.readFileSync` avoids leaking internal DI helpers into the public library surface while still verifying call order invariants.
3. **SessionOrganizationPostToolUseSource export deferred**:
   - `SessionOrganizationPostToolUseSource` is used internally within `session-organization-capture.service.ts`.
   - Neither host container smoke test requires this type (both import `PostToolUseCallbackRegistry` directly from `@ptah-extension/agent-sdk`).
   - Deferring barrel export to the batch owning `session-organization/src/index.ts` adheres to library boundary disciplines.

---

### Findings

#### Minor Finding 1: Potential Vacuous Pass in Electron Source-Order Check

- **Location**: [`apps/ptah-electron/src/di/container.smoke.spec.ts:328-330`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-electron/src/di/container.smoke.spec.ts#L328-L330)
- **Evidence**:
  ```ts
  const orchestrator = fs.readFileSync(path.join(__dirname, 'container.ts'), 'utf8');
  expect(orchestrator.indexOf('registerPhase2Libraries(root')).toBeLessThan(orchestrator.indexOf('registerPhase3Storage(root'));
  ```
- **Analysis**:
  In lines 297–301 of the same file, the helper `at(call)` guards against `-1`:
  ```ts
  const at = (call: string): number => {
    const index = phase2.indexOf(call);
    expect(index).toBeGreaterThan(-1);
    return index;
  };
  ```
  However, for `orchestrator`, `indexOf` is called directly without asserting `> -1`. If `registerPhase2Libraries(root` was renamed or refactored (e.g. to `registerPhase2Libraries(container`), `indexOf` would return `-1`. Because `-1 < orchestrator.indexOf('registerPhase3Storage(root')` evaluates to `true`, the assertion would pass vacuously.
  (Note: In the CLI spec [`apps/ptah-cli/src/di/container.smoke.spec.ts:70-73`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-cli/src/di/container.smoke.spec.ts#L70-L73), the author generalized `at(source, call)` with `expect(index).toBeGreaterThan(-1)`, preventing this issue).
- **Impact**: Minor. The production string currently matches, and the adjacent runtime spec proves the recorder is bound. A subsequent cleanup can apply `at()` to `orchestrator` as well.

---

### Conclusion

Batch A5.1 satisfies all architectural, DI ordering, error boundary, and risk R-TL11 requirements. The implementations on Electron and CLI are clean, robust against missing SQLite, and verified by passing test suites.
