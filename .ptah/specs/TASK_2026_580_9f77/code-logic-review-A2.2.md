VERDICT: APPROVED

# Code Logic Review — TASK_2026_580_9f77 (Batch A2.2)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nit issues  | 2        |
| Failure modes found | 0        |

Score justification: Batch A2.2 introduces the `ISessionOrganizationRecorder` port in `platform-core` together with its DI token `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` and barrel export. The port faithfully satisfies the architectural requirements of Component 3 (lines 387–415) and Decision D2 of `implementation-plan.md`. Method signatures, optionality, and field names match plan lines 392–399 and the cross-task contract with TASK_2026_584 (lines 1408–1463) with 100% fidelity. Hexagonal decoupling is maintained: only type-only imports from `@ptah-extension/shared` are consumed, preserving the `scope:shared` / `type:util` ESLint boundary lattice without introducing any runtime edge to SQLite or feature libraries. Scoped TypeScript diagnostic checks report 0 errors and 0 warnings. A score of 9.5/10 reflects flawless contract design, separated from 10.0 only by two minor observations regarding primitive string typing and path normalization obligations in downstream adapters.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Intentional swallowed error contract**: The port interface specifies that all methods return `void` and never throw ([session-organization-recorder.interface.ts:11-12](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts#L11-L12)). If the underlying adapter fails to write (e.g. database locked, closed, or disk full), the failure is logged and dropped without interrupting agent tool execution or chat stream turns. This is by design: secondary metadata capture must never crash the primary execution path.
- **Tab ID vs SDK UUID silent key mismatch**: The contract explicitly mandates that all session IDs (`sessionId`, `parentSessionId`, `forkOfSessionId`) must be SDK session UUIDs, never webview tab IDs ([session-organization-recorder.interface.ts:8-10](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts#L8-L10)). Because TypeScript types all IDs as primitive `string`, a caller passing a tab ID would compile cleanly; however, the record stored in SQLite would be keyed by tab ID and would silently fail to join against queries using real SDK session IDs.
- **Unresolved `workspaceRootHint`**: In `recordWorktree`, `recordLineage`, `linkTask`, and `addPrLink`, `workspaceRootHint` is optional ([session-organization-recorder.interface.ts:29,37,46,55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts#L29)). If a caller omits the hint before `SessionMetadataStore` has persisted the session's metadata record, the adapter cannot resolve the workspace root and will silently drop the write.

### 2. What user action produces unexpected behaviour?

- **User runs in VS Code extension host**: In the VS Code extension host, SQLite is unavailable, so `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` is unregistered by design (Decision D5). Capture producers injecting `{ isOptional: true }` receive `undefined` and skip recording. Users expecting organization facts (task links, worktree links, PR associations) to persist across sessions in VS Code will observe that these records are not stored. This is documented, intended degradation.
- **Child session started before parent ID resolves**: In `recordLineage` or `recordAgentStartedSession`, if an agent starts a subagent session while its own parent SDK ID is still resolving, passing an undefined or missing `parentSessionId` causes the lineage record to have a `NULL` parent in storage, permanently disconnecting lineage for that session unless rebound.

### 3. What input data produces a wrong answer?

- **Unnormalized path formats**: In `recordWorktree` (`worktreePath: string`) and `recordAgentStartedSession` (`worktreePath: string`, `workspaceRoot: string`), paths are typed as plain strings. Variations such as Windows backslashes (`\`) vs POSIX slashes (`/`), trailing slashes, or differing drive letter casing (`c:` vs `C:`) could produce mismatched lookup keys in SQL queries if the downstream adapter fails to normalize them. Downstream adapters must consistently pipe paths through `normalizeWorkspaceRoot`.
- **Accidental passage of webview tab ID as `parentSessionId` in TASK_2026_584**: If the caller passes `parentTabId` rather than looking up `lifecycle.find(parentTabId)?.realSessionId`, the recorded parent session ID will point to a tab ID that cannot match any SDK session record.

### 4. What happens when a dependency fails?

- **Zero runtime dependencies**: `platform-core` has no runtime dependencies for this interface; types are imported strictly via `import type` from `@ptah-extension/shared`.
- **Missing adapter registration in DI**: If a consumer injects `SESSION_ORGANIZATION_RECORDER` without `{ isOptional: true }` in an environment where no adapter is registered (e.g. VS Code host or isolated unit tests), tsyringe throws a DI resolution exception.
- **Adapter database failure**: Per the port contract, any persistence error inside `@ptah-extension/session-organization` is caught, logged, and discarded without re-throwing to the caller.

### 5. What is missing that the requirements never mentioned?

- **No unlinking/deletion methods on recorder port**: The port provides capture methods only (`record*`, `linkTask`, `addPrLink`). Interactive deletions/unlinks (such as `session:unlinkTask` or `session:removePrLink`) and session deletion cascades are deliberately omitted from the recorder port, as they are owned by `SessionOrganizationService` in `libs/backend/session-organization` and invoked via RPC handlers or metadata store change listeners.
- **Session ID rotation handling**: When an SDK session ID rotates on the first turn (Revision 2 `previousSessionId`), the recorder port provides no `rekey` method. This is correct: `SessionOrganizationCaptureService` directly subscribes to `SessionIdResolvedCallbackRegistry` to rekey the store, avoiding unnecessary pollution of the recorder port interface.

---

## Failure Modes

No active failure modes found. As a pure TypeScript interface and DI token definition, the code introduces no runtime execution bugs or side effects.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### 1. Primitive string typing for session identifiers

- File: [session-organization-recorder.interface.ts:28,36,38,39,45,54,67,69](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts#L28)
- Severity: Minor / Nit
- Scenario: `sessionId`, `parentSessionId`, and `forkOfSessionId` are typed as `string`. Callers holding webview tab IDs could inadvertently pass them, bypassing compile-time type checking.
- Impact: Key mismatch in SQL storage if callers ignore header contract documentation.
- Recommendation: The header comment clearly specifies that tab IDs must never be passed. Adapter implementations should include runtime validation (e.g. asserting non-empty UUID pattern or logging a warning if a tab ID pattern is passed).

### 2. Path normalization contract for downstream adapters

- File: [session-organization-recorder.interface.ts:30,68,70](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/interfaces/session-organization-recorder.interface.ts#L30)
- Severity: Minor / Nit
- Scenario: `worktreePath` and `workspaceRoot` accept arbitrary string paths. In Windows and multi-platform environments, path formatting discrepancies could cause query joins to fail.
- Impact: Adapter must enforce canonical normalization before SQL writes.
- Recommendation: Ensure Batch A3.1 (`SessionOrganizationStore` / `SessionOrganizationService`) unit tests explicitly verify path normalization via `normalizeWorkspaceRoot` for all input paths passed to these methods.

---

## Data Flow

```
[Capture Producer] (SDK hooks / MCP tools / SessionSpawner)
        │
        ▼ (resolves optional PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)
[ISessionOrganizationRecorder Port] (libs/backend/platform-core)
        │
        ▼ (implemented by adapter)
[SessionOrganizationService / Store] (libs/backend/session-organization)
        │
        ▼ (synchronous SQLite transaction)
[SQLite Persistence] (tables: session_organization, session_task_links, session_pr_links)
```

1. **Producer resolution**: Producer resolves `SESSION_ORGANIZATION_RECORDER` with `{ isOptional: true }`. If absent (VS Code host), execution completes without action. [OK]
2. **Method invocation**: Producer calls `recordWorktree`, `recordLineage`, `linkTask`, `addPrLink`, or `recordAgentStartedSession` with SDK UUIDs and input arguments. [OK]
3. **Adapter execution**: Adapter normalizes workspace/worktree paths, resolves workspace root via metadata if hint is omitted, and persists records synchronously. [OK]
4. **Error handling**: Any adapter failure is trapped and logged; returns `void`. [OK]

---

## Requirements Fulfilment

| Requirement                                                                                    | Status   | Gap                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Component 3: `ISessionOrganizationRecorder` port definition (`implementation-plan.md:392-399`) | COMPLETE | None. All 5 methods match plan names, types, and optionality exactly.                                                                            |
| Component 3: DI token `SESSION_ORGANIZATION_RECORDER` (`di/tokens.ts:65-73`)                   | COMPLETE | None. Uses `Symbol.for('PlatformSessionOrganizationRecorder')`.                                                                                  |
| Component 3: Type export in barrel (`src/index.ts:121`)                                        | COMPLETE | None. Type-only export placed with interface definitions.                                                                                        |
| Coordination with TASK_2026_584 (`implementation-plan.md:1408-1463`)                           | COMPLETE | None. `recordAgentStartedSession` accepts all 584 fields: `sessionId`, `workspaceRoot`, `parentSessionId?`, `worktreePath`, `branch`, `taskId?`. |
| Precedent & Header Contract (`memory-writer.interface.ts:1-9`)                                 | COMPLETE | None. Specifies SDK UUID requirement, no-throw void semantics, and optional injection behaviour.                                                 |
| Boundary Lattice & Clean Architecture (`eslint.config.mjs`)                                    | COMPLETE | None. Only `import type` from `@ptah-extension/shared`. No runtime imports or backward dependencies.                                             |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case                            | Handled | How                                                                               | Concern                               |
| ------------------------------- | ------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| Host has no SQLite (VS Code)    | YES     | Token is unregistered; callers inject `{ isOptional: true }` and skip             | None                                  |
| Database closed or write fails  | YES     | Contract specifies methods never throw and return void; adapter logs and drops    | None                                  |
| Unresolved parent session ID    | YES     | `parentSessionId?` is optional in `recordLineage` and `recordAgentStartedSession` | Lineage omitted when unknown          |
| Session branch unknown          | YES     | `branch?` is optional in `recordWorktree`                                         | None                                  |
| Child session always has branch | YES     | `branch: string` is required in `recordAgentStartedSession` matching 584 contract | None                                  |
| Workspace root hint absent      | YES     | `workspaceRootHint?: string` is optional; adapter resolves from session metadata  | If metadata missing, write is dropped |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Downstream callers passing webview tab IDs instead of SDK UUIDs, which would bypass type checking and produce orphan records in storage.
- What a robust implementation would add: Runtime validation in the adapter (Batch A3.1) ensuring session IDs conform to UUID v4 format before executing database writes.
