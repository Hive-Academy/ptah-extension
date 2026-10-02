VERDICT: APPROVED

Score: 9/10

# Code Logic Review — Batch A3.4: DI Registration and Host Start

Read in full:

- [register.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts) (51 lines)
- [register.spec.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts) (109 lines, 4 tests)
- [start.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts) (71 lines)
- [start.spec.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts) (135 lines, 6 tests)
- [index.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/index.ts) (51 lines)
- [implementation-plan.md:486-496, 540-541](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L486-L496)
- [batches.md:715-752](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/batches.md#L715-L752) (Batch A3.4)
- [task-specs/src/lib/di/register.ts:73-86](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/task-specs/src/lib/di/register.ts#L73-L86)
- [task-specs/src/lib/di/start-index.ts:13-17, 81-133](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/task-specs/src/lib/di/start-index.ts#L13-L17)
- [check-degradation.ts:1-60, 100-110](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/tools/degradation-audit/check-degradation.ts#L1-L60)

Read-only review: no source files were modified, and no test or build commands were executed.

---

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 0        |
| Nit issues          | 3        |
| Failure modes found | 3        |

---

## Verification of Prompt Checks

### (a) Conditional Registration on SQLite Connection & Zero Side Effects — PASS

- **Guarded Registration**: In [register.ts:34-36](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L34-L36), `registerSessionOrganizationServices` checks:
  ```typescript
  if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)) {
    return;
  }
  ```
  If `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is absent (such as in `apps/ptah-extension-vscode`, where SQLite is intentionally excluded per `phase-2-libraries.ts:81-87`), nothing is bound.
- **Recursive Container Lookup (`recursive: true`)**: Passing `true` to `container.isRegistered(token, true)` ensures parent container registrations are searched when child containers are used during testing or host activation scoping. This is superior to the task-specs default (`recursive: false`).
- **Zero Side Effects**: `registerSessionOrganizationServices` contains no calls to `container.resolve()`, initiates no I/O, opens no connections, and sets up no subscriptions. Subscribing is strictly deferred to `startSessionOrganization()`. This satisfies CONVENTIONS.md §5 and §9.

### (b) Singleton Registration & Identity Proof (`SERVICE === RECORDER`) — PASS

- **Singletons**:
  - `SESSION_ORGANIZATION_TOKENS.STORE` is registered via `container.registerSingleton` to `SessionOrganizationStore` ([register.ts:38-41](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L38-L41)).
  - `SESSION_ORGANIZATION_TOKENS.SERVICE` is registered via `container.registerSingleton` to `SessionOrganizationService` ([register.ts:42-45](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L42-L45)).
  - `SessionOrganizationCaptureService` is registered via `container.registerSingleton` ([register.ts:49](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L49)).
- **Instance Identity**:
  - `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` is bound via `useToken: SESSION_ORGANIZATION_TOKENS.SERVICE` ([register.ts:46-48](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L46-L48)).
  - Because `SESSION_ORGANIZATION_TOKENS.SERVICE` is registered as a singleton in tsyringe, resolving `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` routes directly through `SESSION_ORGANIZATION_TOKENS.SERVICE` and retrieves the exact cached singleton instance.
  - In [register.spec.ts:80-84](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts#L80-L84), instance identity is strictly asserted:
    ```typescript
    const service = c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE);
    expect(c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)).toBe(service);
    ```
    This guarantees writes from recorder producers and queries/event listeners from RPC handlers operate on the exact same service object and event stream.

### (c) `startSessionOrganization`: Error Swallowing, Degradation Marker & Registration Guard — PASS

- **`isRegistered(SessionOrganizationCaptureService, true)` Pre-check**:
  In tsyringe, calling `container.resolve(ConcreteClass)` on an `@injectable()` class that was never registered causes tsyringe to automatically construct the class and attempt to resolve its dependencies. Checking `!container.isRegistered(SessionOrganizationCaptureService, true)` ([start.ts:38-44](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L38-L44)) avoids this accidental auto-construction when `registerSessionOrganizationServices` was not run (e.g., when SQLite was unavailable).
- **Error Swallowing**:
  Resolution errors or exceptions during `capture.start()` are caught in [start.ts:49-55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L49-L55) and forwarded to `report(container, ...)`. Host activation is never aborted, fulfilling the pattern established in `task-specs/src/lib/di/start-index.ts:13-17`.
- **Return Value**:
  Returns an `IDisposable` ([start.ts:48](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L48)) whose `dispose()` calls `capture.dispose()`. When start fails or is skipped, a `NOOP_DISPOSABLE` (`{ dispose: () => undefined }`) is returned.
- **Degradation Audit Marker Validation**:
  In [start.ts:66-68](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L66-L68):
  ```typescript
  } catch {
    // degradation-audit: optional-capability - this is the failure reporter
    // itself; with no working output channel there is nowhere left to report
    // to, and start must never abort host activation.
  }
  ```
  Validation against [check-degradation.ts:27-29, 102-107](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/tools/degradation-audit/check-degradation.ts#L27-L29):
  - Kind: `optional-capability` (valid: `optional-capability` or `reported`).
  - Separator: `-` (valid: `-`, `–`, or `—`).
  - Reason: `this is the failure reporter itself; with no working output channel there is nowhere left to report to, and start must never abort host activation.` (non-empty).
  - Position: Inside leading lines of the `catch` block (Zone 2). Fully conformant.

### (d) Risk R-TL11: Late Recorder Registration & Early Resolution Check — PASS

- **Context**: R-TL11 concerns capture producers (`SDK_WORKTREE_HOOK_HANDLER`, `SDK_SESSION_FORK_SERVICE`, `PtahAPIBuilder`) that take the recorder via optional constructor injection `{ isOptional: true }`. If any producer is resolved before `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` is bound, it permanently holds `undefined`.
- **Registration Analysis**: In [register.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts), `registerSessionOrganizationServices` contains only token registrations (`registerSingleton`, `register`). It performs zero resolutions. It does NOT resolve `SDK_WORKTREE_HOOK_HANDLER`, `SDK_SESSION_FORK_SERVICE`, `PtahAPIBuilder`, or any other class.
- Therefore, calling `registerSessionOrganizationServices` introduces zero risk of prematurely resolving any producer. Once wired into host phase 2 (Batch A5.1), the recorder token is bound before downstream consumers are resolved.

### (e) Spec Suite Verification & Dependency Realism — PASS

- **`register.spec.ts`**:
  - `binds nothing when the SQLite connection is not registered` ([register.spec.ts:41-54](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts#L41-L54)): Verifies all 4 tokens return `false` on `isRegistered(..., true)`.
  - `binds store, service, capture service and recorder with the connection` ([register.spec.ts:56-73](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts#L56-L73)): Verifies every token resolves to its expected type.
  - `resolves the recorder port and the service to the same singleton` ([register.spec.ts:75-91](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts#L75-L91)): Direct object identity checks (`toBe(service)`).
  - `has no side effects: registering subscribes to nothing` ([register.spec.ts:93-107](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.spec.ts#L93-L107)): Confirms resolving the classes triggers no subscriptions.
- **`start.spec.ts`**:
  - Realistic Dependencies: Uses the real `SessionIdResolvedCallbackRegistry` ([start.spec.ts:38-42](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L38-L42)).
  - Subscription verification: Tests `expect(h.registry.size).toBe(1)` after start, and `expect(h.registry.size).toBe(0)` after `handle.dispose()` ([start.spec.ts:71, 82](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L71-L82)). These cannot pass vacuously.
  - Error isolation: Verifies graceful degradation and single-line logging when:
    1. The lib is not registered ([start.spec.ts:85-97](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L85-L97)).
    2. A dependency fails during resolution ([start.spec.ts:99-118](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L99-L118)).
    3. Subscribing throws ([start.spec.ts:120-127](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L120-L127)).
    4. No output channel exists ([start.spec.ts:129-133](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L129-L133)).

### (f) Barrel Exports — PASS

- [src/index.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/index.ts) is 51 lines (well below the 150-line ceiling).
- Exports only implemented units: tokens, `registerSessionOrganizationServices`, `startSessionOrganization`, `SessionOrganizationCaptureService` (with its 3 `Pick` types), `SessionOrganizationService` (with error and summary types), and `SessionOrganizationStore` (with data types).
- Confirmed error-free by TypeScript compiler diagnostics (`ptah_get_diagnostics`: 0 errors, 0 warnings).

---

## Five Logic Questions

### 1. How does this fail silently?

- **Unregistered SQLite connection**: When `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is not registered, `registerSessionOrganizationServices` quietly exits ([register.ts:34-36](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L34-L36)). When `startSessionOrganization` subsequently runs, it writes one log line to `IOutputChannel` (`[SessionOrganization] capture not started: not registered (no SQLite connection)`) and returns `NOOP_DISPOSABLE`. Host activation succeeds with capture disabled. This silent degradation is intentional and required.
- **Dependency resolution or subscription throw**: If any dependency resolution fails or `capture.start()` throws, `startSessionOrganization` catches the error, logs a single line to `IOutputChannel` ([start.ts:50-55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L50-L55)), and returns `NOOP_DISPOSABLE`. Callers cannot programmatically distinguish successful initialization from non-fatal failure via the returned `IDisposable`.
- **OutputChannel unavailable or throwing**: In `report()`, any exception thrown while resolving `PLATFORM_TOKENS.OUTPUT_CHANNEL` or executing `appendLine()` is silently discarded per `degradation-audit: optional-capability` ([start.ts:65-69](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L65-L69)).

### 2. What user action produces unexpected behaviour?

- **Host re-activation without container recreation**: If `startSessionOrganization` is invoked twice on the same DI container instance:
  1. The first call resolves the singleton `capture` and registers listeners.
  2. The second call invokes `capture.start()`, which early-exits via `if (this.started) return;` and returns a second disposable handle.
  3. If caller 1 disposes its handle, `capture.dispose()` releases all host subscriptions. Caller 2's handle now points to an already-disposed service. In production, `startSessionOrganization` is called once per host lifetime in boot phase 2.

### 3. What input data produces a wrong answer?

- **Container with unregistered connection token**: If a container without `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is passed, `registerSessionOrganizationServices` does not register the services. Subsequent calls to resolve `SESSION_ORGANIZATION_TOKENS.SERVICE` or `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` throw tsyringe unhandled token errors.

### 4. What happens when a dependency fails?

- **Missing `OUTPUT_CHANNEL`**: `report()` checks `isRegistered(PLATFORM_TOKENS.OUTPUT_CHANNEL, true)`. If missing, `report()` returns cleanly without logging or throwing.
- **Throwing `SDK_SESSION_METADATA_STORE` or `SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY`**: Captured by `startSessionOrganization`'s `try/catch`. Logged to `IOutputChannel` without terminating startup.
- **Unopened SQLite Connection at Boot**: As verified in A3.3, `SessionOrganizationService` guards its operations with `isAvailable()` (`this.store.isReady()`). Even if `startSessionOrganization` subscribes before `openAndMigrate` runs, lifecycle events that arrive early are safely dropped or logged non-fatally.

### 5. What is missing that the requirements never mentioned?

- **Constructor Alias for `SessionOrganizationService`**: `container.registerSingleton(SESSION_ORGANIZATION_TOKENS.SERVICE, SessionOrganizationService)` registers the token, but does not alias the class constructor `SessionOrganizationService` to the token. If an external consumer resolves by class constructor (`container.resolve(SessionOrganizationService)`), tsyringe constructs a new instance rather than returning the singleton. In ptah, consumers are instructed to resolve via `SESSION_ORGANIZATION_TOKENS.SERVICE` or `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER`.
- **Try/catch inside returned disposable**: In [start.ts:48](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L48), `{ dispose: () => capture.dispose() }` does not wrap `capture.dispose()` in a try/catch block. While `capture.dispose()` currently does not throw, the `task-specs` pattern uses `composeDisposables` with internal best-effort try-catch.

---

## Failure Modes

### 1. Host Without SQLite Persistence

- **Trigger**: Host activation in `apps/ptah-extension-vscode` or an environment without `persistence-sqlite`.
- **Symptom**: `registerSessionOrganizationServices` does not bind tokens; `startSessionOrganization` logs `[SessionOrganization] capture not started: not registered (no SQLite connection)` and returns `NOOP_DISPOSABLE`.
- **Evidence**: [register.ts:34-36](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L34-L36), [start.ts:38-44](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L38-L44).
- **Current handling**: Clean non-fatal fallback.
- **Recommendation**: Expected behavior.

### 2. Dependency Resolution Failure at Startup

- **Trigger**: A host dependency (such as `SDK_SESSION_METADATA_STORE` or `PLATFORM_TOKENS.OUTPUT_CHANNEL`) fails to resolve during `container.resolve(SessionOrganizationCaptureService)`.
- **Symptom**: Resolution throws an error.
- **Evidence**: [start.ts:49-55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L49-L55), [start.spec.ts:99-118](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L99-L118).
- **Current handling**: Caught, logged as non-fatal to `IOutputChannel`, returns `NOOP_DISPOSABLE`.
- **Recommendation**: Expected behavior.

### 3. Output Channel Absent or Throwing During Report

- **Trigger**: `report()` called in an environment without `IOutputChannel` or where `appendLine()` throws.
- **Symptom**: Log message cannot be delivered.
- **Evidence**: [start.ts:60-69](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L60-L69), [start.spec.ts:129-133](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.spec.ts#L129-L133).
- **Current handling**: Silently dropped per `degradation-audit: optional-capability` marker.
- **Recommendation**: Expected behavior.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues (Nits)

### 1. Class constructor `SessionOrganizationService` not aliased to `SESSION_ORGANIZATION_TOKENS.SERVICE` (Nit)

- **File**: [register.ts:42-45](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/register.ts#L42-L45)
- **Scenario**: If code or a test resolves `container.resolve(SessionOrganizationService)` directly rather than `container.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE)`, tsyringe auto-constructs a second service instance because the class constructor is not explicitly aliased to the token.
- **Impact**: In ptah, internal and RPC consumers inject `SESSION_ORGANIZATION_TOKENS.SERVICE` or `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER`, so accidental class resolution is unlikely.
- **Fix**: Optionally register `container.register(SessionOrganizationService, { useToken: SESSION_ORGANIZATION_TOKENS.SERVICE })` as in `task-specs/src/lib/di/register.ts:89-92`.

### 2. Assumed "(no SQLite connection)" in diagnostic log message (Nit)

- **File**: [start.ts:41](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L41)
- **Scenario**: When `SessionOrganizationCaptureService` is not registered, the log says: `'capture not started: not registered (no SQLite connection)'`.
- **Impact**: If `registerSessionOrganizationServices` was inadvertently omitted in host boot code even when SQLite was available, the log message would misattribute the cause to missing SQLite.
- **Fix**: Rephrase to `'capture not started: not registered'` or dynamically check `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)`.

### 3. Disposable wrapper lacks error boundary (Nit)

- **File**: [start.ts:48](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/di/start.ts#L48)
- **Scenario**: `return { dispose: () => capture.dispose() };` delegates directly to `capture.dispose()`.
- **Impact**: While `capture.dispose()` is currently non-throwing, defensive best-effort disposal (wrapping in `try { capture.dispose(); } catch {}`) aligns with `task-specs/src/lib/di/start-index.ts:63-68`.
- **Fix**: Wrap `capture.dispose()` in `try/catch`.

---

## Data Flow

1. **Host Boot Registration Flow**:
   - Entry: `registerSessionOrganizationServices(container)`.
   - SQLite Check: `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)` [OK].
   - If false: Exits immediately without side effects [OK].
   - If true: Registers `SESSION_ORGANIZATION_TOKENS.STORE` (singleton), `SESSION_ORGANIZATION_TOKENS.SERVICE` (singleton), `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` (`useToken`), and `SessionOrganizationCaptureService` (singleton) [OK].
2. **Host Activation Start Flow**:
   - Entry: `startSessionOrganization(container)`.
   - Pre-check: `container.isRegistered(SessionOrganizationCaptureService, true)` [OK].
   - If false: Calls `report(...)` and returns `NOOP_DISPOSABLE` [OK].
   - Resolution: `container.resolve(SessionOrganizationCaptureService)` inside `try/catch` [OK].
   - Activation: `capture.start()` registers host-wide listeners on metadata store and session-id-resolved registry [OK].
   - Return: Returns `{ dispose: () => capture.dispose() }` [OK].
   - Error catch: Logs non-fatal failure to `IOutputChannel` and returns `NOOP_DISPOSABLE` [OK].

---

## Requirements Fulfilment

| Requirement                                                                               | Status   | Gap  |
| ----------------------------------------------------------------------------------------- | -------- | ---- |
| Bind only when `SQLITE_CONNECTION` is registered (implementation-plan.md:491)             | COMPLETE | None |
| Store, service and capture service singletons (batches.md:716-720)                        | COMPLETE | None |
| RECORDER port aliased to SERVICE via `useToken` (implementation-plan.md:489)              | COMPLETE | None |
| Service and recorder resolve to same instance (batches.md:729-730)                        | COMPLETE | None |
| Registration has no side effects (CONVENTIONS.md §5)                                      | COMPLETE | None |
| `startSessionOrganization` swallows errors into `IOutputChannel` (start-index.ts pattern) | COMPLETE | None |
| Degradation audit marker validity (tools/degradation-audit/check-degradation.ts)          | COMPLETE | None |
| R-TL11 immunity: no early resolution of producers                                         | COMPLETE | None |
| Specs: Connection toggling, identity check, non-vacuous assertions                        | COMPLETE | None |
| Barrel exports: valid symbols, under 150 lines (index.ts: 51 lines)                       | COMPLETE | None |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case                                                | Handled | How                                                      | Concern |
| --------------------------------------------------- | ------- | -------------------------------------------------------- | ------- |
| `PERSISTENCE_TOKENS.SQLITE_CONNECTION` unregistered | YES     | Early exit in `register`, logged non-fatal in `start`    | None    |
| `OUTPUT_CHANNEL` unregistered                       | YES     | Guarded with `isRegistered`, returns without throw       | None    |
| Dependency throws during resolution                 | YES     | Caught in `startSessionOrganization`, logged non-fatally | None    |
| `capture.start()` throws during subscription        | YES     | Caught in `startSessionOrganization`, logged non-fatally | None    |
| Child container hierarchy                           | YES     | Uses `recursive: true` for container lookups             | None    |
| Double start on same container                      | YES     | Idempotent inside `capture.start()`                      | None    |
| Double dispose on returned disposable               | YES     | Idempotent inside `capture.dispose()`                    | None    |

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: Calling `container.resolve(SessionOrganizationService)` by class constructor instead of token produces a duplicate service instance.
- **What a robust implementation would add**: Add `container.register(SessionOrganizationService, { useToken: SESSION_ORGANIZATION_TOKENS.SERVICE });` in `register.ts`.
