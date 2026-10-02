VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Batch A4.2 implements `SessionOrganizationRpcHandlers`, the RPC manifest entry, RPC method registry entries, and parameter/mutation Zod schemas for session organization (TASK_2026_580).

Reviewed files:

1. `libs/shared/src/lib/types/rpc.types.ts`
2. `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`
3. `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts`
4. `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.spec.ts`
5. `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
6. `libs/backend/rpc-handlers/src/lib/handlers/index.ts`
7. `libs/backend/rpc-handlers/src/index.ts`

---

### Verification Summary

1. **Test Suites**:
   - `npx nx test @ptah-extension/rpc-handlers --testPathPattern=session-organization-rpc.handlers.spec.ts`:
     - 116 passed suites out of 117 (3490 passed tests).
     - The only failing suite is the known pre-existing failure `harness-skill-selection-rpc.service.spec.ts` ("never writes state.json", TASK_2026_589), completely untouched and out of scope.
     - All 28 tests in `session-organization-rpc.handlers.spec.ts` passed cleanly.
2. **Typecheck & Lint**:
   - `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers`: PASSED (4/4 tasks succeeded).
3. **RPC Surface Contract Tests**:
   - `npx nx run-many -t test -p ptah-electron ptah-extension-vscode @ptah-extension/cli-engine --testPathPattern=rpc-surface`:
     - `cli-engine:test`: PASSED.
     - `ptah-extension-vscode:test`: PASSED.
     - `ptah-electron:test`: PASSED.
     - Manifest coverage invariants (`assertManifestInvariants(RPC_HANDLER_MANIFEST)`) passed on all target platforms.
4. **Degradation Audit & Formatting**:
   - `npx nx run degradation-audit:lint --skip-nx-cache`: PASSED (`libs/backend/rpc-handlers: 1 ok (baseline 1)`).
   - `npx prettier --check` on all 7 touched files: PASSED clean.

---

### Detailed Code-Logic Analysis

#### 1. Zod Boundary Validation

- **Schema definitions** (`session-organization-rpc.schema.ts:55-125`):
  - `SessionIdParamSchema`: Enforces UUID regex (`UUID_REGEX`) matching SDK session ID format.
  - `PrUrlParamSchema`: Enforces `min(1)` and `max(SESSION_PR_URL_MAX_LENGTH)` (2048 chars, per plan L14 and `pr-url.ts`).
  - `SessionSetOrganizationParamsSchema`: Refined to require at least one of `priority`, `status`, or `pinned` (`session-organization-rpc.schema.ts:74-88`).
  - `SessionLinkTaskParamsSchema`: Restricts `source` to `WEBVIEW_TASK_LINK_SOURCES` (`'user' | 'board-start'`), defaulting to `'user'`, rejecting `'agent'` (`session-organization-rpc.schema.ts:91-97`).
  - `SessionListForTasksParamsSchema`: Caps `taskIds` to `SESSION_LIST_FOR_TASKS_MAX_IDS` (1000) and requires non-empty `workspacePath` (`session-organization-rpc.schema.ts:119-125`).
- **Validation timing**:
  - `parse` runs before any service invocation (`session-organization-rpc.handlers.ts:194, 227-231`).
  - Non-object or `null` parameters safely fail `safeParse(null)` and throw `RpcUserError('Invalid <method> params (params)', 'INVALID_PARAMS')` (`session-organization-rpc.handlers.ts:355-364`).

#### 2. Optional Service Handling (Absent vs. Present)

- **Absent Service (e.g. VS Code host)**:
  - All three collaborators (`SessionOrganizationService`, `TaskIndexService`, `WebviewManager`) are marked `{ isOptional: true }` (`session-organization-rpc.handlers.ts:128-135`).
  - `onDidChange` is conditionally subscribed only when `this.organization` is truthy (`session-organization-rpc.handlers.ts:137-141`). When absent, no listeners are attached.
  - Mutation methods return `{ ok: false, reason: 'organization-unavailable', message: ... }` (`session-organization-rpc.handlers.ts:84-88, 196`).
  - `session:listForTasks` returns `{ available: false }` (`session-organization-rpc.handlers.ts:233-235`).
- **Present Service (Electron, CLI)**:
  - Subscribes exactly once in constructor. Host lifetime governs the subscription, which is cleaned up when the service disposes (`session-organization-rpc.handlers.ts:32-33, 137-141`).

#### 3. Workspace Authorization & Not-Found Handling

- **Mutation authorization** (`session-organization-rpc.handlers.ts:198-199, 297-311`):
  - Fetches metadata from `SessionMetadataStore.get(sessionId)`.
  - Missing metadata immediately returns `NOT_FOUND` (`{ ok: false, reason: 'session-not-found', message: 'Session not found' }`).
  - Verifies `metadata.workspaceId` against `isAuthorizedWorkspace(workspacePath, this.workspace)`. If unauthorized, throws `RpcUserError("Access denied: the session's workspace is not an open folder.", 'UNAUTHORIZED_WORKSPACE')`.
- **List authorization** (`session-organization-rpc.handlers.ts:236-241`):
  - Validates `parsed.workspacePath` with `isAuthorizedWorkspace`. If unauthorized, throws `RpcUserError('Access denied: workspace path is not an open folder.', 'UNAUTHORIZED_WORKSPACE')`.

#### 4. Error Mapping & Information Sanitization

- `sanitize` (`session-organization-rpc.handlers.ts:373-383`):
  - Pre-existing `RpcUserError` instances pass through unmodified.
  - Domain validation error `SessionOrganizationInputError` maps to `RpcUserError(error.message, 'INVALID_PARAMS')`.
  - All other unexpected errors (e.g. SQLite exceptions, disk I/O, internal store failures) are logged in full server-side via `this.logger.error`, and returned to the caller as generic `new Error('${method} failed')`. No SQL syntax, DB paths, or raw stack traces leak to the client.

#### 5. Task `missing` Flag Enrichment

- `withMissingTasks` (`session-organization-rpc.handlers.ts:317-347`):
  - Guarded: skipped when `summary.tasks` is empty or `this.taskIndex` is absent.
  - Executes a single `taskIndex.list(workspaceRoot)` call across all tasks in the summary.
  - Treats both `index.tasks` IDs and `index.excluded` folder names as existing on disk (`missing: false`).
  - Swallowed failure logs a warning and leaves `missing: false`, annotated with a valid degradation-audit marker (`optional-capability`).

#### 6. Broadcast Resilience

- `broadcastChanged` (`session-organization-rpc.handlers.ts:385-401`):
  - Emits `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED` via `WebviewManager.broadcastMessage`.
  - Catches broadcast rejection, logs with `this.logger.error`, and resolves cleanly without rethrowing.
  - Annotated with a valid degradation-audit marker (`reported`).

#### 7. `session:listForTasks` Grouping & Ordering

- `groupByTask` (`session-organization-rpc.handlers.ts:266-290`):
  - Primary sort puts `role === 'primary'` first (`Number(b.role === 'primary') - Number(a.role === 'primary')`).
  - Secondary sort orders by `createdAt` descending (`b.createdAt - a.createdAt`), placing newer links ahead.
  - Enriches each entry with session name from metadata, live turn phase from `turnState`, and PR links from `organization.queryWorkspace`.
  - Fast path: returns `{ available: true, links: {} }` immediately when `links.length === 0` (`session-organization-rpc.handlers.ts:247`).

---

### Evaluation of Executor Deviations

1. **UUID Check on `sessionId` (`SessionIdParamSchema`)**:
   - _Deviation_: Added `regex(UUID_REGEX)` on session IDs in Zod schema.
   - _Judgment_: **ACCEPTED**. Session IDs in Ptah are UUIDs formatted via `SessionId.from`. Enforcing this format at the boundary prevents invalid parameters from propagating to metadata lookups or persistence queries.
2. **1000 `taskIds` Cap on `session:listForTasks` (`SESSION_LIST_FOR_TASKS_MAX_IDS`)**:
   - _Deviation_: Constrained `taskIds` array length to 1000 items.
   - _Judgment_: **ACCEPTED**. Prudent RPC boundary defence against memory consumption or unbounded database queries.
3. **`UNAUTHORIZED_WORKSPACE` for Non-Open-Folder Sessions**:
   - _Deviation_: Validates `metadata.workspaceId` against open folders in `authorizeSession`.
   - _Judgment_: **ACCEPTED**. Matches existing `SessionRpcHandlers.authorizeSessionAccess` semantics (`session-rpc.handlers.ts:281-294`), maintaining consistent security boundary semantics across handlers.
4. **Validate-Before-Unavailable Order**:
   - _Deviation_: Parses schema before checking `if (!this.organization) return UNAVAILABLE`.
   - _Judgment_: **ACCEPTED**. Boundary protocol errors (`INVALID_PARAMS`) should be deterministic regardless of whether a capability is supported or loaded, preventing malformed calls from behaving differently across hosts.
5. **Orphan Links Omitted in `groupByTask`**:
   - _Deviation_: When `names.get(link.sessionId)` is undefined (session deleted or belongs to another workspace), the link is omitted (`if (name === undefined) continue`).
   - _Judgment_: **ACCEPTED** (R-TL12). Excludes orphaned records from polluting task cards with missing session names.

---

### Degradation-Audit Marker Check

Two swallowing catches are present in `session-organization-rpc.handlers.ts`:

1. Line 331:
   `// degradation-audit: optional-capability - the missing flag is a label on a task chip; an unreadable index marks no task missing rather than failing a mutation that has already been committed.`
   - Type: `optional-capability`
   - Valid reason: Missing flag is non-critical presentation data; an unreadable index should not fail a mutation that was already committed.
2. Line 394:
   `// degradation-audit: reported - a failed push is logged as an error; the change is committed and the next session:list read shows it.`
   - Type: `reported`
   - Valid reason: Push notifications over webview broadcast are best-effort; failures are logged and state remains consistent on subsequent queries.

Both markers comply with repository standards and pass `degradation-audit:lint`.

---

### Conclusion

Batch A4.2 is fully verified, conforms to the architecture and specification requirements, passes all target tests and RPC surface invariants, adheres to boundary isolation rules, and introduces zero regressions or defects.
