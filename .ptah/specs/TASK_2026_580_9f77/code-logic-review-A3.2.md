VERDICT: REVISE

Score: 8/10

# Code Logic Review — TASK_2026_580_9f77 (Batch A3.2)

## Summary

| Metric              | Value  |
| ------------------- | ------ |
| Overall score       | 8/10   |
| Assessment          | REVISE |
| Blocking issues     | 0      |
| Serious issues      | 1      |
| Moderate issues     | 1      |
| Minor / Nit issues  | 2      |
| Failure modes found | 1      |

Score justification: Batch A3.2 implements `SessionOrganizationService` (the adapter for the `ISessionOrganizationRecorder` port and the RPC query/mutation API), `parsePrUrl` utility, and DI tokens `SESSION_ORGANIZATION_TOKENS`. The implementation exhibits high architectural discipline: the D3 metadata precedence (`metadata.workspaceId` over `workspaceRootHint`), tab-id dropping before any store touch, live connection availability checks, clean event dispatching with isolated listener error handling, and robust test flushing using `setImmediate` are all exemplary.
However, one serious contract breach was identified: `addPrLink` evaluates `parsePrUrl(input.url)` synchronously before validating `typeof input.url === 'string'`. Because `parsePrUrl` performs `raw.trim()` without a string typecheck, passing `{ url: undefined }` (or `{}` without `url`) throws an unhandled synchronous `TypeError` out of `addPrLink`. Because Batch B1 callers do NOT wrap recorder calls in try/catch, this violates the fundamental "never throws" port contract. A score of 8/10 reflects sound underlying design that requires one targeted revision to achieve full contract adherence.

---

## Verification of the Requested Checks

### (1) NEVER THROWS

- **Audit of recorder methods**:
  - `recordWorktree`: Evaluates `invalidId(input.sessionId)`, `invalidText(input.worktreePath)`, and `invalidOptionalText(input.branch)`. All check `typeof value === 'string'`. If `input` is `{}` or has missing/non-string properties, `invalid !== null` is detected and `this.capture` logs and returns synchronously. No throw.
  - `recordLineage`: Evaluates `invalidId`, `invalidOptionalText`, and `invalidOptionalMember`. All check `typeof value === 'string'`. Malformed inputs drop cleanly. No throw.
  - `linkTask`: Evaluates `invalidId`, `invalidText`, and `invalidMember`. All check `typeof value === 'string'`. No throw.
  - `recordAgentStartedSession`: Evaluates all path, branch, and session fields with `invalidId` and `invalidText`. No throw.
  - **`addPrLink` (FAILURE)**: [session-organization.service.ts:287](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L287) calls `const parsed = parsePrUrl(input.url)`. In [pr-url.ts:45](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L45), `raw.trim()` executes without checking `typeof raw === 'string'`. Passing `service.addPrLink({ sessionId: '...', url: undefined as any, source: 'agent' })` or `service.addPrLink({} as any)` causes an unhandled synchronous `TypeError: Cannot read properties of undefined (reading 'trim')` to escape `addPrLink`.
- **Detached async execution**: `runCapture` ([session-organization.service.ts:587-616](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L587-L616)) is wrapped in an all-encompassing `try { ... } catch (error: unknown) { this.log(...) }`. It catches metadata resolution rejections, readiness check failures, store execution exceptions, and listener failures. Because `runCapture` never rejects, `void this.runCapture(...)` cannot produce an unhandled promise rejection.
- **Sync validation helpers**:
  - `invalidText`: checks `typeof value === 'string' && value.trim().length > 0`. Safe on undefined/null/primitives.
  - `invalidOptionalText`: returns `null` on `undefined`, delegates to `invalidText` otherwise. Safe.
  - `invalidId`: short-circuits on `invalidText`, so string `.length` and regex tests run only on confirmed non-empty strings. Safe.
  - `invalidMember` / `invalidOptionalMember`: checks `typeof value === 'string' && vocabulary.includes(value)`. Safe.
  - `withParent`: constructed via array literal `parentSessionId !== undefined ? [sessionId, parentSessionId] : [sessionId]`. Safe.
  - `parsePrUrl`: **not safe** when `raw` is non-string or undefined.

### (2) Tab-Id Guard and D3

- **Metadata first**: `resolveRoot` ([session-organization.service.ts:690-699](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L690-L699)) calls `await this.metadata.get(sessionId)`. If metadata is missing or null, `{ ok: false, reason: 'no-metadata' }` is returned immediately.
- **Drop before store**: For all five recorder methods, a missing metadata entry logs `[SessionOrganization] <call> dropped for <sessionId>: session id has no metadata (likely a tab id or a session not bound yet)` and returns before invoking any store method.
- **Hint never repairs missing metadata**: If `metadata` is null, the hint is never evaluated.
- **Precedence**: `const raw = nonBlank(metadata.workspaceId) ?? nonBlank(hint)`. Metadata `workspaceId` takes precedence over hint; hint is used only if `metadata.workspaceId` is empty or undefined.
- **`recordAgentStartedSession`**: Passes `input.workspaceRoot` as the hint to `capture`. If child metadata exists, child `metadata.workspaceId` takes precedence (matching 584 D3 and plan lines 1408–1418, where child `metadata.workspaceId` = parent root = `workspaceRoot`).
- **Normalization**: All roots reaching the store pass through `normalizeWorkspaceRoot` ([session-organization.service.ts:698](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L698)), including query roots (`queryWorkspace`, `countChildren`, `listTaskLinks`) and `removeSession`.

### (3) Ordering of Detached Writes (R-TL12 Out-of-Scope Assessment)

- **Scenario (a): `recordWorktree` followed by `linkTask` for the same session**:
  - `recordWorktree` updates `session_organization` (`worktree_path`, `branch`, `updated_at`).
  - `linkTask` inserts into `session_task_links` and ensures default `session_organization` row exists.
  - Because they touch orthogonal columns and tables, these operations commute. Even if the metadata read for `linkTask` resolves before `recordWorktree`, the resulting database state is identical.
- **Scenario (b): Capture metadata read starts before session deletion**:
  - If `metadata.get(sessionId)` resolves before the session is deleted from `SessionMetadataStore`, the capture executes after `removeSession` deleted the rows.
  - This creates an orphaned row in SQLite.
  - **Harm assessment**: Completely harmless per plan failure table ([implementation-plan.md:1233](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L1233)) and Decision D4 ([implementation-plan.md:135](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L135)). `session:list` joins from `SessionMetadataStore` metadata rows. Because the session is deleted from metadata, the SQLite orphan row is never queried or surfaced to the UI.
- **Scenario (c): Capture under `oldId` racing `rekeySession(oldId, newId)`**:
  - If `metadata.get(oldId)` resolves after rekey deleted or moved the metadata record, the no-metadata guard drops the capture cleanly.
  - If `metadata.get(oldId)` resolved before rekey, the capture inserts under `oldId`. The subsequent or concurrent rekey transaction either rekeys it or leaves it as an unreferenced orphan.
- **Ruling / Recommendation**: Accept and note as documented residual behavior. No task needed.

### (4) Mutations

- **Discriminated result**: `SessionOrganizationMutationResult` returned for all mutation methods (`setOrganization`, `linkSessionTask`, `unlinkSessionTask`, `addSessionPrLink`, `removeSessionPrLink`).
- **Session not found**: When metadata is missing, returns `{ ok: false, reason: 'session-not-found', message: 'Session not found' }` ([session-organization.service.ts:631-635](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L631-L635)).
- **Unavailable when closed**: If store is unavailable before or during write, catches closed connection and returns `{ ok: false, reason: 'organization-unavailable', message: 'Session organization storage is not available' }` ([session-organization.service.ts:628, 657](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L628)).
- **Error rethrowing**: Other storage errors (e.g. `SQLITE_FULL`, disk failure) are logged and rethrown for RPC handlers to sanitize.
- **Change events on real change**: `unlinkSessionTask` and `removeSessionPrLink` check store return value (`removed === true`) before emitting. `setOrganization` and `linkSessionTask` always record changes and emit.
- **Executor deviations**:
  - Distinct method names (`linkSessionTask` / `addSessionPrLink` vs port's `linkTask` / `addPrLink`): **Sound**. Port methods are `void` and synchronous; mutation methods return `Promise<SessionOrganizationMutationResult>`.
  - `SessionOrganizationInputError`: **Sound**. Enables RPC handlers in A4.2 to cleanly map invalid parameters to `INVALID_PARAMS`.
  - Tasks carry `missing: false`: **Sound**. The service has no task-index dependency; A4.2 handler enriches this flag.
  - Stricter validation (credential rejection, `www.github.com` canonicalization, 256-char single-line session ID): **Sound**. Defensive security and data hygiene.

### (5) PR URL Parser (`pr-url.ts`)

- Rules checked:
  - `https:` only: [pr-url.ts:55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L55) verifies `parsed.protocol === 'https:'`. Tested in spec :84-86.
  - Max length 2048: [pr-url.ts:46](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L46). Tested in spec :90, 95-100.
  - Canonicalization: Lowercase host, strips port, trailing slash, subpaths (`/files`, `/commits`), query, and fragment. Tested in spec :12-32.
  - Non-GitHub https URLs: Stored trimmed with `repo: null, number: null`. Tested in spec :44-77.
  - Credentials: URLs with `username` or `password` rejected. Tested in spec :88-89.
  - Defect: Lacks `typeof raw === 'string'` check before `raw.trim()`.

### (6) DI Tokens & Exports (`tokens.ts`, `index.ts`)

- `SESSION_ORGANIZATION_TOKENS.STORE` uses `Symbol.for('SessionOrganizationStore')`.
- `SESSION_ORGANIZATION_TOKENS.SERVICE` uses `Symbol.for('SessionOrganizationService')`.
- Tokens follow CONVENTIONS.md §4 (namespaced identifier matches symbol key, globally interned, frozen as const).
- `index.ts` exports only existing tokens, classes, functions, and types from `src/lib`. Barrel is 39 lines (well within the 150-line limit).

### (7) Spec Quality

- Fake store and fake metadata reader accurately simulate the contracts.
- In `session-organization.service.spec.ts:105`, `const flush = (): Promise<void> => new Promise((r) => setImmediate(r));`.
- Every test exercising detached recorder execution awaits `flush()`, guaranteeing macrotask completion after all metadata promise microtasks settle before assertions run.
- Zero vacuous tests: assertions verify mock call arguments, change events, output channel logs, and rejection errors.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Malformed PR URL on `addPrLink`**: If a caller passes `url: undefined` to `addPrLink`, it does not fail silently—it crashes the caller synchronously with a `TypeError` ([session-organization.service.ts:287](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L287)).
- **Unbound or tab-id session capture**: An SDK session invoked before `SessionMetadataStore` has recorded its metadata (e.g. before initial binding) is dropped silently from the store's perspective and logged to `IOutputChannel` ([session-organization.service.ts:596-599](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L596-L599)). This is the intentional D3 / tab-id guard design.
- **Tolerant query reads during store outage**: If SQLite closes mid-session, `queryWorkspace` returns an empty `Map` and `listTaskLinks` returns `[]` ([session-organization.service.ts:677, 683](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L677)), allowing `session:list` to render active sessions without organization decorators.

### 2. What user action produces unexpected behaviour?

- **Submitting duplicate/identical organization patch**: If a user invokes `session:setOrganization` with the exact priority and status already set, the service executes `upsertOrganization` and emits `onDidChange` with `reason: 'user'` ([session-organization.service.ts:384-387, 640](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L384-L387)), triggering UI re-renders and updating `updated_at` even though data was unchanged.
- **Attempting to reset a PR state to null by re-adding**: If a PR link was previously recorded with `state: 'open'`, calling `session:addSessionPrLink` without a `state` field will NOT clear the state to `null` due to SQLite's `COALESCE` upsert. Clearing requires explicit removal followed by re-add. This behavior is now documented in JSDoc per A3.1 F4.

### 3. What input data produces a wrong answer?

- **Multi-line `parentSessionId` or `forkOfSessionId`**: Unlike `sessionId` (validated by `invalidId` which checks `/[\\r\\n]/`), `parentSessionId` and `forkOfSessionId` in `recordLineage` ([session-organization.service.ts:221-222](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L221-L222)) and `recordAgentStartedSession` (:332) are validated by `invalidOptionalText`, which permits multi-line strings or strings > 256 characters to be stored.

### 4. What happens when a dependency fails?

- **`metadata.get(sessionId)` rejects**: Caught by `runCapture` ([session-organization.service.ts:613](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L613)), logged to `IOutputChannel`, and discarded. Capture fails safely without affecting the host.
- **Database connection closes during mutation**: Caught by `mutate` ([session-organization.service.ts:657](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L657)), which returns `{ ok: false, reason: 'organization-unavailable', message: ... }`.
- **Change event listener throws**: `emitChange` ([session-organization.service.ts:704-708](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L704-L708)) wraps each listener call in `try/catch`. A faulty listener logs to output channel and does not starve other listeners or abort committed writes.

### 5. What is missing that the requirements never mentioned?

- **Typecheck guard on `parsePrUrl` raw input**: `parsePrUrl` assumes TypeScript compile-time typing guarantees `raw` is a string; at runtime in Node.js, unchecked objects or missing fields pass `undefined` and throw `TypeError`.

---

## Failure Modes

### FM-1: Synchronous TypeError crash on malformed `addPrLink` call

- Trigger: A caller invokes `addPrLink` with an object missing `url` or having `url: undefined` (e.g. `service.addPrLink({ sessionId: '...', source: 'agent' } as any)`).
- Symptom: Process or calling thread throws an uncaught `TypeError: Cannot read properties of undefined (reading 'trim')` synchronously.
- Evidence: [session-organization.service.ts:287](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L287) and [pr-url.ts:45](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L45).
- Current handling: `addPrLink` does not check `typeof input.url === 'string'` before passing it to `parsePrUrl`. In `parsePrUrl`, `raw.trim()` executes immediately outside any try/catch block.
- Recommendation: Add `if (typeof raw !== 'string') return null;` at the beginning of `parsePrUrl`.

---

## Serious Issues

### 1. `parsePrUrl` throws synchronously on non-string input, breaking recorder "never throws" contract

- File: [libs/backend/session-organization/src/lib/utils/pr-url.ts:44-46](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L44-L46) and [libs/backend/session-organization/src/lib/session-organization.service.ts:286-295](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L286-L295)
- Scenario: Calling `addPrLink({ sessionId: '0b6c2a52-...', url: undefined as any, source: 'agent' })` evaluates `parsePrUrl(input.url)` before computing `invalid`. In `parsePrUrl(raw)`, `raw.trim()` throws `TypeError`. The same issue affects `addSessionPrLink` (:435) and `removeSessionPrLink` (:466), which throw `TypeError` instead of rejecting with `SessionOrganizationInputError`.
- Impact: Because Batch B1 callers do NOT wrap recorder calls in try/catch, an uncaught synchronous throw will crash caller execution workflows (such as agent PostToolUse hooks).
- Fix:
  In `pr-url.ts`:
  ```ts
  export function parsePrUrl(raw: unknown): ParsedPrUrl | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > PR_URL_MAX_LENGTH) return null;
    ...
  ```
  And in `pr-url.spec.ts`, add test cases for `undefined`, `null`, and non-string inputs returning `null`.

---

## Moderate and Minor Issues

### 2. Moderate — Detached capture write ordering across session deletion and rekeying (R-TL12)

- File: [libs/backend/session-organization/src/lib/session-organization.service.ts:587-616](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L587-L616)
- Scenario: `runCapture` awaits `resolveRoot` before executing `write`. A metadata delete cascade or session rekey occurring during this microtask window can create an orphaned row in SQLite.
- Impact: Per plan failure table (:1233) and Decision D4 (:135), orphaned rows are harmless because queries join starting from metadata.
- Fix: Accept and note as documented design tradeoff.

### 3. Minor — Lineage and child session parent IDs lack `invalidId` format checks

- File: [libs/backend/session-organization/src/lib/session-organization.service.ts:221-222, 332](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L221-L222)
- Scenario: `recordLineage` and `recordAgentStartedSession` validate `parentSessionId` and `forkOfSessionId` using `invalidOptionalText` rather than `invalidId`. A multi-line string or string > 256 characters is accepted.
- Fix: Create `invalidOptionalId(value: unknown, field: string)` that delegates to `invalidId` when `value !== undefined`.

### 4. Nit — `setOrganization` emits change event on no-op identical update

- File: [libs/backend/session-organization/src/lib/session-organization.service.ts:384-387](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L384-L387)
- Scenario: `setOrganization` returns `true` unconditionally from its mutation callback, firing `onDidChange` even when priority, status, and pinned values match what is already stored.
- Fix: Optional optimization; leave as is or compare with existing row before returning `true`.

---

## Data Flow

1. Entry: Caller invokes one of 5 recorder methods (`recordWorktree`, `recordLineage`, `linkTask`, `addPrLink`, `recordAgentStartedSession`).
   - Sync validation check (`invalidId`, `invalidText`, etc.): **[GAP on `addPrLink`: line 287 crashes before line 288 runs if `url` is undefined]**.
   - If invalid: logged to `IOutputChannel` with `[SessionOrganization]` prefix and dropped immediately: **OK**.
2. Async detached dispatch: `void this.runCapture(...)` spawned: **OK**.
3. Root resolution: `resolveRoot` awaits `metadata.get(sessionId)`: **OK**.
   - If metadata missing: logged and dropped (tab-id guard): **OK**.
   - If metadata present: `metadata.workspaceId` chosen over `hint`: **OK**.
   - Normalized via `normalizeWorkspaceRoot`: **OK**.
4. Readiness check: `this.isAvailable()` checks `store.isReady()`: **OK**.
   - If closed: logged and dropped: **OK**.
5. Storage execution: `write(root, now)` runs synchronously against SQLite: **OK**.
6. Event notification: `emitChange` notifies registered listeners inside individual `try/catch` blocks: **OK**.

---

## Requirements Fulfilment

| Requirement                                                        | Status   | Gap                                                                       |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| `ISessionOrganizationRecorder` port implementation (plan :387-415) | PARTIAL  | `addPrLink` throws synchronously when `url` is undefined or not a string. |
| Never throws contract (plan :391-405, batches A3.2 & B1)           | PARTIAL  | Breached by `addPrLink` for non-string `url`.                             |
| Tab-id guard on all 5 recorder methods (D3, A2.2 note)             | COMPLETE | Drops without store touch when metadata is missing.                       |
| Metadata precedence & root normalization (D3, L9)                  | COMPLETE | Metadata `workspaceId` overrides hint; all roots normalized.              |
| Unavailable no-op & db getter catch (L8, plan :513)                | COMPLETE | Readiness checked live; closed connection caught cleanly.                 |
| PR URL parser rules (L14, plan :458-461)                           | COMPLETE | `https:`, 2048 max, credential rejection, GitHub canonicalization.        |
| JSDoc on PR re-add COALESCE semantics (A3.1 F4)                    | COMPLETE | Added to `addPrLink` and `addSessionPrLink`.                              |
| Change events on committed writes (plan :462-463)                  | COMPLETE | `onDidChange` fired on real changes; listeners isolated.                  |
| DI tokens convention (CONVENTIONS.md §4)                           | COMPLETE | `Symbol.for` keys match identifier, uniquely interned.                    |
| Spec quality & flush coverage                                      | COMPLETE | Fake store/metadata; all tests flush detached promises before assertions. |

---

## Edge Cases

| Case                                       | Handled | How                                                           | Concern                          |
| ------------------------------------------ | ------- | ------------------------------------------------------------- | -------------------------------- |
| Tab ID passed to recorder method           | YES     | `metadata.get(tabId)` returns null; dropped and logged        | None                             |
| Tab ID passed with workspace hint          | YES     | Hint ignored when metadata is missing; dropped                | None                             |
| Store closed before write                  | YES     | `isAvailable()` false; dropped and logged                     | None                             |
| Store closes mid-mutation                  | YES     | Catches db throw, returns `organization-unavailable`          | None                             |
| Listener throws during `onDidChange`       | YES     | Wrapped in `try/catch` per listener, logged                   | None                             |
| PR URL with credentials (`user:pass@`)     | YES     | Rejected by `parsePrUrl`                                      | None                             |
| PR URL with trailing slash, /files, query  | YES     | Canonicalized to `https://github.com/<owner>/<repo>/pull/<n>` | None                             |
| `addPrLink` called with non-string `url`   | NO      | `parsePrUrl` calls `raw.trim()` without typecheck             | Synchronous TypeError throws out |
| Rekey / delete race with in-flight capture | YES     | Harmless orphan row per plan :1233                            | None                             |

---

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Synchronous `TypeError` throwing from `addPrLink` on malformed input, crashing unshielded callers in Batch B1.
- What a robust implementation would add:
  1. Add `if (typeof raw !== 'string') return null;` at the beginning of `parsePrUrl` in [pr-url.ts:44](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/utils/pr-url.ts#L44).
  2. Add unit tests in `pr-url.spec.ts` asserting `parsePrUrl(undefined as any)`, `parsePrUrl(null as any)`, and `parsePrUrl(123 as any)` return `null`.
  3. Add unit test in `session-organization.service.spec.ts` asserting `service.addPrLink({ sessionId: SESSION, url: undefined as any, source: 'agent' })` drops cleanly and never throws.
