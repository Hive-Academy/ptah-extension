VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` Batch A4.1

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nits        | 3        |
| Failure modes found | 4        |

## Five logic questions

### 1. How does this fail silently?

- In [session-rpc.handlers.ts:530-555](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L530-L555), if `this.organization.queryWorkspace` or `countChildren` throws (e.g. SQLite database contention or corruption), `readOrganization` catches the error, logs it to `this.logger.error`, reports it to `this.sentryService.captureException`, and returns `undefined`. `applySessionListQuery` then executes with `orgMap = undefined`, skipping all organization filters (`status`, `priority`, `taskId`, `pinned`, `hasPr`) and sort enhancements, returning `organizationAvailable: false`. The RPC succeeds with HTTP/RPC status ok, presenting legacy un-enriched rows. This is an intentional graceful degradation safeguard.
- In [session-rpc.handlers.ts:561-594](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L561-L594), if `this.taskIndex.list(workspacePath)` throws (e.g. invalid task specs directory permissions or read failure), `findMissingTaskIds` catches the error, logs a warning with `[SessionOrganization] session:list could not read the task index`, and returns `new Set()`. Every linked task on the returned page is marked `missing: false`, so tasks deleted from disk are not flagged as missing.
- In [session-organization-rpc.schema.ts:27-42](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts#L27-L42), `SessionListQueryParamsSchema` uses default Zod strip behavior. If a consumer sends misspelled query parameters (e.g. `{ statuses: ['active'] }` or `{ task_id: 'TASK_001' }`), the unrecognized keys are stripped without error. If no recognized query fields remain, [session-list-query.ts:60-62](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L60-L62) evaluates `isSessionListQueryMode` as `false`, silently executing the legacy query without filtering.
- In [session-list-query.ts:174-184](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L174-L184), sessions lacking an organization row in SQLite default to `status: 'active'`, `priority: 'normal'`, `pinned: false`. Filtering by `status: ['active']` or `pinned: false` silently matches them.

### 2. What user action produces unexpected behaviour?

- In [session-list-query.ts:112, 200-202](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L112), passing an empty status array `{ status: [] }` (e.g. when a user unchecks all status filters in the UI) sets `isSessionListQueryMode(query)` to `true` (because `status !== undefined`), but `nonEmptySet([])` returns `undefined`. Line 117 (`statuses ? !statuses.has(status) : status === 'archived'`) evaluates the `undefined` branch, excluding only `archived` sessions and returning all other sessions (`active`, `waiting`, `done`). A user expecting "zero checkboxes checked = zero items shown" sees all non-archived sessions.
- In [session-list-query.ts:147-154, 192-198](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L147-L154), when selecting `groupBy: 'parent'`, parent groups are sorted by `compareNullableText(parentKeyOf(a), parentKeyOf(b))` where `parentKeyOf` is the parent's `sessionId` UUID. The parent groups are arranged in alphanumeric UUID order rather than chronological or activity order.
- If a parent session is filtered out (e.g. parent is archived or doesn't match the priority filter), its active child sessions are still grouped under the parent's UUID key, but without the parent row heading the group.
- Searching via `text` matches only the session's display `name` (case-insensitive substring); it does not search task names or PR titles.

### 3. What input data produces a wrong answer?

- When sorting by `name`, [session-list-query.ts:205-210](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L205-L210) uses character code comparison (`al < bl ? -1 : 1`) rather than `localeCompare`. Non-ASCII accented characters (e.g. `É`, `ö`) sort after ASCII characters rather than beside their base Latin letters. This is documented and deterministic.
- If a session is linked to multiple tasks and none is marked `role: 'primary'`, [session-list-query.ts:187-190](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L187-L190) selects `tasks[0]`. Grouping under `groupBy: 'task'` depends on the array insertion order of the linked tasks.

### 4. What happens when a dependency fails?

- If `SessionOrganizationService` is absent from DI (VS Code host): `this.organization` is `null`. In [session-rpc.handlers.ts:403-407](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L403-L407), `organizationAvailable` evaluates to `false`, `readOrganization` returns `undefined`, and `applySessionListQuery` operates without organization maps (ignoring status/priority/pinned/task/PR filters and sort keys). Sessions are returned without `organization` summaries, and `organizationAvailable: false` is returned.
- If `SessionOrganizationService.queryWorkspace` or `countChildren` throws: [session-rpc.handlers.ts:530-555](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L530-L555) catches the error, logs via `this.logger.error`, reports to Sentry, and returns `undefined`. The RPC answers with today's un-enriched list and `organizationAvailable: false`.
- If `TaskIndexService.list` throws: [session-rpc.handlers.ts:581-593](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L581-L593) catches the error, logs a warning via `this.logger.warn`, and treats all linked tasks as existing (`missing: false`).
- If `SessionMetadataStore.getForWorkspace` throws: Uncaught in local helper; propagates to outer catch block ([session-rpc.handlers.ts:483-495](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L483-L495)), which logs `RPC: session:list failed` and throws sanitized `new Error('Failed to list sessions: ...')`.
- If SQLite native binding fails in the perf spec: [session-list.perf.spec.ts:174-179, 294-296](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list.perf.spec.ts#L174-L179) throws an explicit `Error('No SQLite binding loaded ...')` during `beforeAll` and asserts `opener !== null`, causing the test suite to fail immediately rather than silently skipping.

### 5. What is missing that the requirements never mentioned?

- Interaction between `groupBy` and pagination (`offset`, `limit`): Sorting groups items contiguously, but pagination slices flat rows across group boundaries. A single group can be split across pages.
- Behavior for empty filter arrays: The specification states that `status` filters exclude archived rows unless explicitly listed, but did not define whether `status: []` means "match nothing" or "no filter applied (excluding archived)". The implementation chooses the latter.
- Group sorting order when `groupBy: 'parent'`: The specification did not define how parent groups themselves should be ordered relative to each other.

---

## Failure modes

### FM-1: SQLite read failure during `session:list`

- Trigger: SQLite file locking, I/O error, or data corruption during `queryWorkspace` or `countChildren`.
- Symptom: Call completes with `organizationAvailable: false`; organization filters are skipped and returned sessions lack organization metadata.
- Evidence: [session-rpc.handlers.ts:530-555](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L530-L555), verified by unit test [session-rpc.handlers.spec.ts:2847-2863](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2847-L2863).
- Current handling: `readOrganization` catches the error, logs `[SessionOrganization] session:list could not read organization`, sends exception to Sentry, and returns `undefined`.
- Recommendation: Robust degradation; preserves core session list access.

### FM-2: Task index failure during missing task check

- Trigger: Corrupt task file or inaccessible `.ptah/tasks` directory during `taskIndex.list()`.
- Symptom: Tasks that have been deleted from disk are displayed as normal links instead of being flagged with `missing: true`.
- Evidence: [session-rpc.handlers.ts:581-593](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L581-L593), verified by [session-rpc.handlers.spec.ts:2828-2845](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2828-L2845).
- Current handling: `findMissingTaskIds` catches the error, logs a warning with `[SessionOrganization] session:list could not read the task index`, and returns `new Set()`.
- Recommendation: Appropriate; task chip decoration failure should never abort the session list RPC.

### FM-3: Unrecognized query parameter keys silently stripped

- Trigger: Consumer sends misspelled query keys, e.g. `{ statuses: ['active'] }` or `{ task_id: '...' }`.
- Symptom: The invalid keys are stripped without error, executing the query without those filters.
- Evidence: [session-organization-rpc.schema.ts:27-42](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts#L27-L42).
- Current handling: Zod `z.object({...})` strips unknown keys.
- Recommendation: Standard for extensible RPC parameters. Known valid keys are strictly validated against shared enums and max constraints.

### FM-4: VS Code host execution without organization service

- Trigger: Running `session:list` on VS Code where `SessionOrganizationService` is not registered.
- Symptom: Organization features unavailable; returns legacy session list.
- Evidence: [session-rpc.handlers.ts:196-197, 403-407](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L196-L197), verified by [session-rpc.handlers.spec.ts:2721-2743](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2721-L2743).
- Current handling: `organization` is injected with `{ isOptional: true }` and defaults to `null`. `organizationAvailable` evaluates to `false`, and legacy rows are returned untouched.
- Recommendation: Exemplary platform boundary isolation.

---

## Numbered findings

### Finding 1: Parent group ordering relies on UUID string comparison rather than sort key

- Severity: Minor / Nit
- File: [libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts:147-154](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L147-L154)
- Scenario: A user requests `groupBy: 'parent'` with `sort: 'lastActive'`.
- Impact: While the parent leads each group and children are correctly sorted within the group, the parent groups themselves are ordered alphabetically by parent `sessionId` UUID, rather than by `lastActiveAt` of the parent session.
- Fix: Acknowledge as Executor deviation #4. In a future iteration, parent groups can be ordered by the parent's `compareSort` value before falling back to UUID comparison.

### Finding 2: Unrecognized query parameter keys silently stripped

- Severity: Minor / Nit
- File: [libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts:27-42](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts#L27-L42)
- Scenario: Client passes a typo in query parameters, e.g. `{ statuses: ['active'] }`.
- Impact: The parameter is stripped without error. If no other query parameter is present, query mode is disabled and all sessions are returned.
- Fix: Schema intentionally leaves `.strict()` off because `session:list` receives legacy pagination parameters (`workspacePath`, `limit`, `offset`, `since`) which are parsed separately by `SessionRpcHandlers`.

### Finding 3: Empty status array `status: []` behaves as unconstrained filter (excluding archived) rather than zero matches

- Severity: Minor / Nit
- File: [libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts:112, 117](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L112)
- Scenario: Client passes `{ status: [] }`.
- Impact: `isSessionListQueryMode` is `true`, but `nonEmptySet(query.status)` returns `undefined`. `status === 'archived'` is excluded, but all other statuses (`active`, `waiting`, `done`) are returned.
- Fix: Documented as Executor deviation #4 and tested in `session-list-query.spec.ts:120-123`.

---

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Finding 1 (Minor / Nit): Parent group ordering uses UUID string collation.
- Finding 2 (Minor / Nit): Unrecognized parameter stripping in non-strict schema.
- Finding 3 (Minor / Nit): `status: []` matches all non-archived statuses.

---

## Analysis of specific review aspects

### (a) Verdict on Executor Deviations

1. **Deviation 1 (`organizationAvailable: false` on deferred session import spec): APPROVED.**
   `organizationAvailable` is now guaranteed to be present as a boolean on every `session:list` result. Updating the legacy spec assertion ([session-rpc.handlers.spec.ts:2914-2924](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2914-L2924)) ensures exact match with the new RPC response contract.
2. **Deviation 2 (`listTaskLinks` omitted in favor of `queryWorkspace`): APPROVED.**
   `queryWorkspace` returns a complete `ReadonlyMap<string, StoredOrganization>` with all linked tasks and PR links populated in a single query. Calling `listTaskLinks` per session or task would add redundant I/O.
3. **Deviation 3 (Graceful degradation and Sentry capture on organization read throw): APPROVED.**
   Trapping SQLite throws in `readOrganization` ([session-rpc.handlers.ts:530-555](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L530-L555)) and falling back to `organizationAvailable: false` ensures that transient database errors never break core session listing.
4. **Deviation 4 (Grouping, sort rules, and empty filter semantics): APPROVED.**
   Applying `groupBy` only when organization data exists, grouping tasks by primary task (unlinked last), ordering parents before children, sorting `created` newest-first, and sorting `name` case-insensitively are sound, deterministic choices thoroughly verified in [session-list-query.spec.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.spec.ts).
5. **Deviation 5 (Schema covers only new fields): APPROVED.**
   Keeping `workspacePath`, `limit`, `offset`, and `since` handling in `SessionRpcHandlers` avoids breaking backward compatibility and prevents duplicate validation logic.
6. **Deviation 6 (Perf spec stubs transcripts and uses `synchronous = OFF` for seeding): APPROVED.**
   Stubbing transcript directory checks prevents developer environment disk I/O from skewing measurements. Using `synchronous = OFF` exclusively during the setup phase keeps test execution within reasonable limits without altering read query performance.

### (b) Backward compatibility

- When no new parameters are provided, [session-list-query.ts:60-62, 73-75](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts#L73-L75) immediately returns `{ rows: [...rows], total: rows.length }`.
- Legacy ordering (`lastActiveAt` descending from `metadataStore.getForWorkspace`) is preserved.
- Archived sessions remain in their default positions and are counted in `total`.
- Pinned sessions are not prioritized to the top unless query mode is active.
- Verified in [session-rpc.handlers.spec.ts:2758-2777](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2758-L2777).

### (c) Pagination and page-only enrichment

- All query filters and sorting are applied to the full dataset before `offset` and `limit` slicing in [session-rpc.handlers.ts:408-417](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L408-L417).
- `total` accurately reflects the filtered count, and `hasMore = offset + limit < total`.
- Organization summaries, child counts, and task missing status are enriched exclusively for the paginated slice `paginated = allSessions.slice(offset, offset + limit)` ([session-rpc.handlers.ts:463-471](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L463-L471)).
- `findMissingTaskIds` inspects only page session links. When no page row has linked tasks, `taskIndex.list` is skipped entirely, as verified in [session-rpc.handlers.spec.ts:2811-2826](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2811-L2826).

### (d) Validation and error handling

- Parameter validation runs via `this.parseSessionListQuery(params)` in [session-rpc.handlers.ts:380](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L380) _before_ the handler's `try` block.
- On invalid input, it throws `new RpcUserError(..., 'INVALID_PARAMS')` ([session-rpc.handlers.ts:518-522](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L518-L522)), ensuring the error code is not wrapped in a generic `Error` and the store read is skipped.
- Verified in [session-rpc.handlers.spec.ts:2875-2892](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2875-L2892).

### (e) Optional injection and VS Code compatibility

- `SESSION_ORGANIZATION_TOKENS.SERVICE` and `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE` are marked with `{ isOptional: true }` in the constructor ([session-rpc.handlers.ts:196-200](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L196-L200)).
- On hosts lacking either or both tokens (such as VS Code), handler instantiation succeeds without errors, `organizationAvailable` evaluates to `false`, and no store calls are attempted.
- Verified in [session-rpc.handlers.spec.ts:2721-2743](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts#L2721-L2743).

### (f) AC1 Performance Verification (`session-list.perf.spec.ts`)

- Real `SessionOrganizationStore` and `SessionOrganizationService` tested over a temporary SQLite file with migrations 1 through 50 applied.
- Seeded with 500 session organization rows, 250 task links, and 100 PR links across diverse status and priority combinations.
- Runs 20 iterations with `{ status: ['active', 'waiting'], priority: ['urgent', 'high'], sort: 'priority' }`.
- Asserts p95 < 200 ms and verifies filtered `total`.
- The suite fails explicitly if neither `better-sqlite3` nor `node:sqlite` can be loaded.
- Verified passing in test execution (`18.581 s` runtime).

---

## Data flow

1. Frontend sends `session:list` with optional query fields (`status`, `priority`, `taskId`, `pinned`, `hasPr`, `text`, `sort`, `groupBy`). [OK]
2. `parseSessionListQuery` validates query params with `SessionListQueryParamsSchema` before `try` block; rejects invalid input with `INVALID_PARAMS`. [OK]
3. Workspace authorization is checked via `isAuthorizedWorkspace`. [OK]
4. `metadataStore.getForWorkspace(workspacePath)` retrieves lightweight session metadata. [OK]
5. If `since` is supplied, filters rows by `lastActiveAt >= since`. [OK]
6. `readOrganization(workspacePath)` queries `SessionOrganizationService.queryWorkspace` and `countChildren`:
   - If service is absent or store closed: returns `undefined`. [OK]
   - If query fails: logs error, reports to Sentry, returns `undefined`. [OK]
   - If successful: returns organization map and child counts. [OK]
7. `applySessionListQuery(sinceSessions, organization?.map, query)`:
   - If not in query mode: returns rows and total as-is. [OK]
   - In query mode: filters by organization attributes and text, sorts by pinned, group, sort key, and ties by `lastActiveAt`. [OK]
8. Slices `allSessions.slice(offset, offset + limit)` for pagination. [OK]
9. If page rows contain task links, calls `this.taskIndex.list(workspacePath)` once to determine missing tasks. [OK]
10. Maps page rows with `organization` summary, `childCount`, `missing` flags, and `livePhase` from `turnState`. [OK]
11. Returns `{ sessions, total, hasMore, organizationAvailable }`. [OK]
12. In `finally` block, logs warning if total elapsed time exceeds `200 ms`. [OK]

---

## Requirements fulfilment

| Requirement                                                   | Status   | Gap  |
| ------------------------------------------------------------- | -------- | ---- |
| Task A4.1.1: `applySessionListQuery` pure query function      | COMPLETE | None |
| Query mode triggered by any new param                         | COMPLETE | None |
| Backward compatibility without query mode                     | COMPLETE | None |
| Archived excluded unless explicitly listed in query mode (L3) | COMPLETE | None |
| Pinned sorted first when organization available (L4)          | COMPLETE | None |
| Grouping by status, task, parent, none (L5)                   | COMPLETE | None |
| Sorting by priority, created, name, lastActive                | COMPLETE | None |
| Task A4.1.2: `SessionRpcHandlers.session:list` enrichment     | COMPLETE | None |
| Optional DI for organization service and task index           | COMPLETE | None |
| Zod validation with `INVALID_PARAMS` error code               | COMPLETE | None |
| `organizationAvailable` always returned in result             | COMPLETE | None |
| Page-only enrichment for organization, childCount, missing    | COMPLETE | None |
| Single `taskIndex.list` read only when page has links         | COMPLETE | None |
| Slow call warning logged when > 200 ms (L13)                  | COMPLETE | None |
| AC1 perf spec with 500 sessions, 250 tasks, 100 PRs           | COMPLETE | None |
| Perf spec asserts p95 < 200 ms and fails instead of skips     | COMPLETE | None |

---

## Edge cases

| Case                                  | Handled | How                                                             | Concern                                 |
| ------------------------------------- | ------- | --------------------------------------------------------------- | --------------------------------------- |
| No query params (legacy caller)       | YES     | Bypass filter/sort; returns original rows, order, total         | None                                    |
| Organization service absent (VS Code) | YES     | Injected optional; returns flag false, un-enriched              | None                                    |
| SQLite queryWorkspace throws          | YES     | Catches in `readOrganization`, logs, Sentry, flag false         | Degrades cleanly                        |
| Task index read throws                | YES     | Catches in `findMissingTaskIds`, marks none missing             | Degrades cleanly                        |
| Page has no linked tasks              | YES     | Skips `taskIndex.list` completely                               | None                                    |
| Empty `status: []`                    | YES     | Matches all non-archived statuses                               | Minor semantic decision (Finding 3)     |
| Accented character names              | YES     | Case-insensitive code unit comparison (`compareText`)           | Deterministic                           |
| Parent group without parent row       | YES     | Children group under parent UUID key without parent row leading | Handled                                 |
| Parent group ordering                 | YES     | Orders parent groups by parent UUID string                      | Minor cosmetic ordering nit (Finding 1) |
| Call takes > 200 ms                   | YES     | Logs `[SessionOrganization]` warning in `finally`               | None                                    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None in Batch A4.1 scope. Performance comfortably exceeds AC1 budget (p95 < 200 ms), backward compatibility is verified, and graceful degradation paths protect both VS Code and SQLite failure scenarios.
- What a robust implementation would add: Ordering parent groups by the parent session's `lastActiveAt` or sort key rather than UUID string collation (Finding 1).
