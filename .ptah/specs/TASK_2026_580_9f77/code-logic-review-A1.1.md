VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch A1.1)

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

Batch A1.1 introduces the foundational TypeScript domain contracts and RPC signatures for the session organization feature (TASK_2026_580). The additions comprise:

1. `libs/shared/src/lib/types/session-organization.types.ts`: Const tuples, union types, `SessionOrganizationSummary`, `SessionTaskLinkSummary`, `SessionPrLinkSummary`, and `SESSION_ORGANIZATION_DEFAULTS`.
2. `libs/shared/src/lib/types/session-organization.types.spec.ts`: Unit test suite pinning tuple elements, ordering, uniqueness, and default values.
3. `libs/shared/src/index.ts`: Root re-export of `session-organization.types`.
4. `libs/shared/src/lib/types/rpc/rpc-session.types.ts`: Extended `SessionListParams`, optional `SessionListResult.organizationAvailable`, mutation results (`SessionOrganizationMutationResult`), params/results for `setOrganization`, `linkTask`, `unlinkTask`, `addPrLink`, `removePrLink`, `listForTasks`, and `TaskLinkedSession`.
5. `libs/shared/src/lib/types/execution/node.ts`: Optional `organization?: SessionOrganizationSummary` and `livePhase?: SessionTurnPhase` on `ChatSessionSummary`.

Diagnostics verification via `ptah_get_diagnostics` reported 0 errors and 0 warnings across all changed and sibling files.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Unavailability vs Missing Data**: Under `SessionListResult`, `organizationAvailable?: boolean` is optional (doc: "absent means false"). If an older backend, a mock provider, or VS Code (which does not host the SQLite organization store) returns a result without this property, consumers checking `Boolean(result.organizationAvailable)` or `result.organizationAvailable === true` correctly treat it as unavailable rather than throwing runtime errors or assuming false data.
- **Task Deletion Detection**: In `SessionTaskLinkSummary.missing: boolean`, a deleted task folder on disk does not cause task-session links to silently vanish or cause RPC calls to fail; it explicitly tags the reference so UI can render a "missing" indicator.
- **Non-GitHub PR Parsing**: In `SessionPrLinkSummary`, `number` and `repo` are typed `number | null` and `string | null`. Non-GitHub URLs or unparseable URLs safely return `null` instead of throwing or fabricating invalid repo identifiers.

### 2. What user action produces unexpected behaviour?

- **Attempting to claim 'agent' link source from frontend**: In `SessionLinkTaskParams`, `source` is typed as `Exclude<SessionTaskLinkSource, 'agent'>`. If an RPC client or webview attempt were made to link a task as an agent action, TypeScript prevents it at compile time. Agent task links are reserved for MCP tool invocations (`ptah_session_link_task`).
- **Query Mode Activation**: In `SessionListParams`, adding any organization query filter activates query mode (per lane constraint L3/L4), altering default sorting (pinned items sort first) and filtering (archived sessions excluded unless explicitly requested). Because all query fields are strictly optional, normal non-query list requests remain unaffected.

### 3. What input data produces a wrong answer?

- **Tri-state Booleans (`pinned`, `hasPr`)**: `SessionListParams.pinned?: boolean` and `SessionListParams.hasPr?: boolean` distinguish `true` (filter for true), `false` (filter for false), and `undefined` (do not filter). Callers must avoid coercing falsy values to `false` when they intend "no filter".
- **Nullable `updatedAt`**: In `SessionOrganizationSummary`, `updatedAt: number | null` evaluates to `null` when no stored record exists yet. Callers cannot confuse an unwritten default row with a row updated at epoch 0 (`0`).

### 4. What happens when a dependency fails?

- **Host Lacks SQLite Store**: In hosts without the organization store (e.g. VS Code), mutations return `{ ok: false, reason: 'organization-unavailable', message: string }`, and `session:listForTasks` returns `{ available: false }`. Callers handling `SessionOrganizationMutationResult` are forced by the discriminated union to handle the failure branch before accessing `.organization`.
- **Session Not Found**: Handled by `{ ok: false, reason: 'session-not-found', message: string }`.
- **Unloaded Session Phase**: In `TaskLinkedSession.livePhase: SessionTurnPhase | null`, if a session is not loaded in memory or has no active turn in the host, `livePhase` cleanly reports `null`.

### 5. What is missing that the requirements never mentioned?

- **Empty Patch in `SessionSetOrganizationParams`**: All fields other than `sessionId` (`priority`, `status`, `pinned`) are optional. While the JSDoc states "At least one field besides `sessionId`", the pure TypeScript interface does not syntactically prevent `{ sessionId: '...' }`. Runtime boundary validation (e.g. Zod in A4.2) must enforce this semantic rule.

---

## Evaluation of Executor's Open Choices

1. **`sessionId` typed as plain `string` in RPC params**:
   - _Evidence_: `rpc-session.types.ts:147,162,179,189,201,210`. In the same file, `SessionCliSessionsParams.sessionId: string`, `SessionCliOutputPageParams.sessionId: string`, `SessionStatsEntry.sessionId: string`, `SessionStatsBatchParams.sessionIds: string[]`, and `SessionStatusParams.sessionId: string` all use `string`.
   - _Verdict_: **ACCEPTED**. Matches existing recent RPC conventions in `rpc-session.types.ts`. Avoids unnecessary and artificial `as SessionId` branding casts across webview, CLI, and MCP IPC boundaries where runtime types are raw strings.

2. **`SessionLinkTaskParams.role` required and `source` typed `Exclude<SessionTaskLinkSource, 'agent'>`**:
   - _Evidence_: `rpc-session.types.ts:165,170`.
   - _Verdict_: **ACCEPTED**. Every link must have a designated role (`primary` or `related`), so making `role` required prevents ambiguity. Disallowing `'agent'` at the RPC boundary enforces lane constraint L11: agent links originate solely from the MCP tool `ptah_session_link_task` on the backend, not the webview UI.

3. **Explicit Named Types `SessionTaskLinkSummary` and `SessionPrLinkSummary`**:
   - _Evidence_: `session-organization.types.ts:92-113`.
   - _Verdict_: **ACCEPTED**. Replacing anonymous inline object types from the plan draft with named interfaces provides cleaner reuse in `TaskLinkedSession` and test fixtures without structural divergence.

4. **No New Barrel Line in `libs/shared/src/index.ts` for `rpc-session.types.ts`**:
   - _Evidence_: `libs/shared/src/lib/types/rpc.types.ts:12` exports `* from './rpc/rpc-session.types'`, and `libs/shared/src/index.ts:16` exports `* from './lib/types/rpc.types'`.
   - _Verdict_: **ACCEPTED**. All types in `rpc-session.types.ts` are already re-exported transitively through the main RPC barrel. Adding another direct barrel export would introduce redundant export statements.

---

## Requirements Fulfilment

| Requirement                                                | Status   | Evidence / Notes                                                                                 |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `SESSION_PRIORITIES` order & const                         | COMPLETE | `session-organization.types.ts:20` (`['urgent', 'high', 'normal', 'low']`)                       |
| `SESSION_WORKFLOW_STATUSES` order & const                  | COMPLETE | `session-organization.types.ts:24-30` (`['active', 'waiting', 'in_review', 'done', 'archived']`) |
| `SESSION_TASK_LINK_ROLES`                                  | COMPLETE | `session-organization.types.ts:34` (`['primary', 'related']`)                                    |
| `SESSION_TASK_LINK_SOURCES`                                | COMPLETE | `session-organization.types.ts:38-42` (`['board-start', 'agent', 'user']`)                       |
| `SESSION_PR_LINK_SOURCES`                                  | COMPLETE | `session-organization.types.ts:46` (`['agent', 'user']`)                                         |
| `SESSION_PR_STATES`                                        | COMPLETE | `session-organization.types.ts:50` (`['open', 'draft', 'merged', 'closed']`)                     |
| `SESSION_STARTED_BY`                                       | COMPLETE | `session-organization.types.ts:54` (`['user', 'agent']`)                                         |
| `SESSION_LIST_SORTS`                                       | COMPLETE | `session-organization.types.ts:58-63` (`['lastActive', 'priority', 'created', 'name']`)          |
| `SESSION_LIST_GROUPS`                                      | COMPLETE | `session-organization.types.ts:67-72` (`['none', 'status', 'task', 'parent']`)                   |
| `SESSION_ORGANIZATION_DEFAULTS`                            | COMPLETE | `session-organization.types.ts:79-89` (`normal`, `active`, `false`, `user`)                      |
| `SessionOrganizationSummary` structure & nullability       | COMPLETE | `session-organization.types.ts:116-131`                                                          |
| Spec pins tuple order & uniqueness                         | COMPLETE | `session-organization.types.spec.ts:14-75`                                                       |
| `SessionListParams` extended                               | COMPLETE | `rpc-session.types.ts:100-116`                                                                   |
| `SessionListResult.organizationAvailable` optional (R-TL2) | COMPLETE | `rpc-session.types.ts:128`                                                                       |
| `SessionOrganizationMutationResult`                        | COMPLETE | `rpc-session.types.ts:136-142`                                                                   |
| Params & Results for new RPC methods                       | COMPLETE | `rpc-session.types.ts:144-234`                                                                   |
| `ChatSessionSummary` optional extensions                   | COMPLETE | `node.ts:259-261`                                                                                |
| Barrel export in `libs/shared/src/index.ts`                | COMPLETE | `index.ts:40`                                                                                    |
| No circular dependencies                                   | COMPLETE | `node.ts` uses type-only imports; `session-organization.types.ts` has zero imports               |

---

## Edge Cases

| Case                                                          | Handled | How                                                                                                                  | Concern                          |
| ------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Existing callers compiling without changes                    | YES     | All extensions to existing interfaces (`SessionListParams`, `SessionListResult`, `ChatSessionSummary`) are optional. | None; verified with diagnostics. |
| Host without SQLite organization support                      | YES     | `organizationAvailable?: boolean` and mutation failure discriminated unions.                                         | None.                            |
| Circular imports between `node.ts` and `stream-background.ts` | YES     | `import type` utilized; runtime code has no circular references.                                                     | None.                            |
| Non-GitHub PR URLs                                            | YES     | `SessionPrLinkSummary` allows `number: null` and `repo: null`.                                                       | None.                            |
| Missing linked task folders                                   | YES     | `SessionTaskLinkSummary.missing: boolean`.                                                                           | None.                            |

---

## Numbered Findings

### 1. [Nit] `SessionSetOrganizationParams` allows empty patch object at compile time

- **File**: [`libs/shared/src/lib/types/rpc/rpc-session.types.ts:145-151`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/shared/src/lib/types/rpc/rpc-session.types.ts#L145-L151)
- **Scenario**: A caller invoking `session:setOrganization` passes `{ sessionId: 'xyz' }` with none of `priority`, `status`, or `pinned`.
- **Impact**: Allowed by TypeScript compiler despite the JSDoc stating "At least one field besides sessionId".
- **Fix**: Non-blocking. Ensure the runtime handler / Zod schema in Batch A4.2 validates that at least one patch property is provided, or treats an empty patch as a harmless no-op returning the unchanged summary.

### 2. [Nit] Import placement before top header comment in `rpc-session.types.ts`

- **File**: [`libs/shared/src/lib/types/rpc/rpc-session.types.ts:1-2`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/shared/src/lib/types/rpc/rpc-session.types.ts#L1-L2)
- **Scenario**: `import type { ContextCapacity } from '../../utils/pricing.utils';` is placed on line 1 above the file JSDoc block.
- **Impact**: Cosmetic only; no logic or runtime effect.
- **Fix**: Purely cosmetic; can be moved below the file-level JSDoc header comment during routine formatting.

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: Downstream RPC handlers forgetting to validate that at least one field is supplied to `session:setOrganization` (mitigated by Zod validation in Batch A4.2).
- **What a robust implementation would add**: The contracts are already precise, comprehensive, and fully backwards-compatible.
