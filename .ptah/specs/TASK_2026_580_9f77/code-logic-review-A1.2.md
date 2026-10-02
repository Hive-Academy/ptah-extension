VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch A1.2)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nit issues  | 1        |
| Failure modes found | 0        |

Batch A1.2 implements the shared contract additions for push messages, Git worktree notifications, and agent adapter callbacks required for session organization (TASK_2026_580_9f77). The changes comprise:

1. `libs/shared/src/lib/types/messages/message-constants.ts`: Added `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED = 'session:organizationChanged'`.
2. `libs/shared/src/lib/types/messages/payload-map.ts`: Added `SessionOrganizationChangedPayload` (`{ workspaceRoot: string; sessionIds: string[]; reason: 'user' | 'capture' | 'delete' }`) and registered `'session:organizationChanged'` in `MessagePayloadMap`.
3. `libs/shared/src/lib/types/rpc/rpc-git.types.ts`: Added optional `sessionId?: string` to `GitWorktreeChangedNotification`.
4. `libs/shared/src/lib/types/agent-adapter.types.ts`: Added optional `worktreePath?: string` to `WorktreeCreatedCallback` data.

Diagnostics verification via `ptah_get_diagnostics` confirmed 0 errors and 0 warnings across all modified files and sibling definitions.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Invalidation Push Semantics**: `SessionOrganizationChangedPayload` conveys changed session IDs as an invalidation notification (`{ workspaceRoot, sessionIds, reason }`). If a broadcaster sends an empty array `sessionIds: []` or IDs for deleted sessions, the frontend will re-read `session:list` without raising errors. Because this is designed as a cache-invalidation signal rather than an authoritative data payload, silent re-queries are safe and expected.
- **Unassociated Worktree Operations**: In `GitWorktreeChangedNotification`, `sessionId` is optional. If an agent creates a worktree via an SDK hook or MCP tool but the session ID cannot be resolved (or is omitted), `sessionId` is `undefined`. Downstream linkers (such as `SessionOrganizationService`) will safely treat it as an unlinked worktree (identical to user-initiated RPC worktrees) rather than failing or crashing.

### 2. What user action produces unexpected behaviour?

- **Rapid Successive Mutations**: Multiple rapid mutations (e.g. bulk status changes or automated worktree captures) emit multiple `session:organizationChanged` events. Because the payload contains IDs only, frontend handlers (scheduled in Batch C0.2 / C1.2) must debounce or coalesce re-reads of `session:list` to avoid UI thrashing or redundant network roundtrips.
- **Session Deletion Invalidation**: A session deletion produces `reason: 'delete'`, causing the webview to reload the session list; if an active session tab is open, its local organization metadata will be cleanly reset on the subsequent refresh.

### 3. What input data produces a wrong answer?

- **Unvalidated Mutation Reason**: In `SessionOrganizationChangedPayload`, `reason` is statically typed as `'user' | 'capture' | 'delete'`. If an invalid string arrives across an untyped boundary (e.g. external IPC), runtime TypeScript checks do not validate it unless bounded by Zod runtime schemas (enforced in Batch A4.2).
- **Workspace Path Normalization**: `workspaceRoot` must match the normalized workspace path used by the frontend receiver; path discrepancies (such as Windows lowercase drive letter `c:\` vs uppercase `C:\`) could prevent matching if not normalized prior to broadcast (handled via normalized workspace roots per plan Component 3).

### 4. What happens when a dependency fails?

- **Type-only definitions**: The files under review contain purely type-level contracts and string constants with zero runtime logic, subprocesses, or I/O dependencies.
- **Message Router Protection**: If a malformed payload or unhandled event is received by `MessageRouterService` in `libs/frontend/core`, the router isolates the exception and forwards it to Angular's `ErrorHandler` without wedging the inbound queue.

### 5. What is missing that the requirements never mentioned?

- **Agent MCP Worktree Invocations in JSDoc**: While `GitWorktreeChangedNotification.sessionId`'s JSDoc states that `sessionId` is "Present only for SDK-hook-driven notifications", plan Component 8 specifically details that agent-driven MCP tool invocations (`ptah_git_worktree_add`) will also attach the caller's SDK session ID to the broadcast. This discrepancy is captured as Finding 1 below.

---

## Specific Scope Verifications

### (a) Payload shape and message key match plan (:280-282)

- **Key**: `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED = 'session:organizationChanged'` matches plan line 280 verbatim and follows the neighbouring pattern of `SESSION_MCP_STATUS: 'session:mcpStatus'`.
- **Payload**: `SessionOrganizationChangedPayload` matches plan lines 281-282 verbatim:
  - `readonly workspaceRoot: string;`
  - `readonly sessionIds: string[];`
  - `readonly reason: 'user' | 'capture' | 'delete';`
- **Payload Map Entry**: Registered under key `'session:organizationChanged'` in `MessagePayloadMap` (line 383), maintaining exact key alignment with `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED`.

### (b) Exhaustiveness and routability checks

- A sweep across `libs/shared` and `libs/frontend/core` confirmed:
  - `MessagePayloadMap` is used to parameterize generic envelopes (`StrictMessage<T>`, `MessageRequest<T>`, `RoutableMessage<T>`). No exhaustive `Record<keyof MessagePayloadMap, ...>` or strict switch statement requires immediate updating in Batch A1.2.
  - In `libs/frontend/core/src/lib/services/message-router.service.ts`, messages are dispatched dynamically via `Map<string, MessageHandler[]>`. Unhandled message types are silently ignored without throwing or wedging the message queue.
  - Individual handlers declare their handled message types via `readonly handledMessageTypes = [...] as const`. Batch C0.2 will add the frontend listener and routing; Batch A4.2 will add the backend broadcaster. No immediate frontend edits are required in A1.2.

### (c) JSDoc accuracy on `GitWorktreeChangedNotification.sessionId`

- The current JSDoc on `GitWorktreeChangedNotification.sessionId` in [`rpc-git.types.ts:225-230`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/shared/src/lib/types/rpc/rpc-git.types.ts#L225-L230) states:
  > _"Present only for SDK-hook-driven notifications whose session id is known; absent for RPC-driven (user-initiated) worktree operations."_
- Per plan Component 8 (lines 790-801) and Decision D9 (line 140), agent calls to the MCP tool `ptah_git_worktree_add` will also resolve and forward the caller's SDK session ID into the worktree change broadcast.
- The comment is incomplete because it omits agent-initiated MCP operations. Classified as **Minor / Nit** (documentation accuracy only; see Finding 1 for exact replacement wording).

### (d) `worktreePath` on `WorktreeCreatedCallback` & Twin Types

- In `agent-adapter.types.ts:105`, `worktreePath?: string` is strictly optional (`?`).
- Existing callback implementations and consumers continue to compile without error due to TypeScript parameter contravariance.
- Note on twin types:
  - `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:50-55` defines the agent-sdk twin type (scheduled for update in Batch B1).
  - `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:31-36` defines a local `WorktreeCreatedData` interface (scheduled for update in Batch B3.1).
  - Neither twin breaks because `worktreePath` on the shared contract is optional and unreferenced by those local types until those batches land.

### (e) Additive and backwards-compatible changes

- All four modifications are purely additive and declare optional fields or new keys:
  - New key on `MESSAGE_TYPES` object constant.
  - New payload interface and mapping in `MessagePayloadMap`.
  - Optional `sessionId?: string` on `GitWorktreeChangedNotification`.
  - Optional `worktreePath?: string` on `WorktreeCreatedCallback`.
- Zero existing consumers break; clean diagnostics verified.

---

## Numbered Findings

### 1. [Minor / Nit] Incomplete JSDoc description on `GitWorktreeChangedNotification.sessionId`

- **File**: [`libs/shared/src/lib/types/rpc/rpc-git.types.ts:225-230`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/shared/src/lib/types/rpc/rpc-git.types.ts#L225-L230)
- **Scenario**: Developer reads JSDoc to understand when `sessionId` is present on `GitWorktreeChangedNotification`.
- **Current text**:
  ```ts
  /**
   * The real SDK session id whose agent created or removed the worktree.
   * Present only for SDK-hook-driven notifications whose session id is known;
   * absent for RPC-driven (user-initiated) worktree operations.
   */
  sessionId?: string;
  ```
- **Impact**: Inaccurate documentation. Per implementation-plan.md Component 8 (lines 790-801) and D9 (line 140), `sessionId` is also supplied when an agent invokes the MCP tool `ptah_git_worktree_add` via `buildGitNamespace` and `PtahAPIBuilder.buildWorktreeChangeHandler`.
- **Recommended replacement**:
  ```ts
  /**
   * The real SDK session id whose agent created or removed the worktree.
   * Present for SDK-hook-driven notifications and agent MCP tool operations
   * (`ptah_git_worktree_add`) whose session id is known; absent for
   * RPC-driven (user-initiated) worktree operations.
   */
  sessionId?: string;
  ```

---

## Requirements Fulfilment

| Requirement                                   | Status   | Evidence / Notes                                                                          |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED`  | COMPLETE | `message-constants.ts:161` (`'session:organizationChanged'`)                              |
| `SessionOrganizationChangedPayload` interface | COMPLETE | `payload-map.ts:274-278` (`workspaceRoot`, `sessionIds`, `reason`)                        |
| `MessagePayloadMap` mapping                   | COMPLETE | `payload-map.ts:383` (`'session:organizationChanged': SessionOrganizationChangedPayload`) |
| `GitWorktreeChangedNotification.sessionId?`   | COMPLETE | `rpc-git.types.ts:230` (`sessionId?: string`)                                             |
| `WorktreeCreatedCallback.worktreePath?`       | COMPLETE | `agent-adapter.types.ts:105` (`worktreePath?: string`)                                    |
| Self-contained blocks for 584 merge (R-TL7)   | COMPLETE | Edits are clean contiguous additions following `session:mcpStatus`                        |

---

## Edge Cases

| Case                                                    | Handled | How                                                              | Concern                          |
| ------------------------------------------------------- | ------- | ---------------------------------------------------------------- | -------------------------------- |
| Existing consumers omitting `sessionId`                 | YES     | Optional field (`sessionId?: string`)                            | None                             |
| Existing callbacks omitting `worktreePath`              | YES     | Optional field (`worktreePath?: string`)                         | None                             |
| Frontend receiving push before handler added            | YES     | `MessageRouterService` drops unregistered message types silently | None; C0.2 will wire the handler |
| Concurrent 584 edits to message constants / payload map | YES     | Follows R-TL7 isolation beside `session:mcpStatus`               | None                             |

---

## Data Flow

1. **Worktree Creation via SDK hook / MCP tool**: Agent action occurs -> `wireWorktreeCallbacks` / `buildGitNamespace` attaches `sessionId` and `worktreePath` [OK].
2. **Notification Broadcast**: Broadcast via `git:worktreeChanged` with `sessionId?: string` [OK].
3. **Organization Invalidation**: Backend `SessionOrganizationRpcHandlers` broadcasts `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED` with `SessionOrganizationChangedPayload` [OK].
4. **Webview Receipt**: Webview receives event via `MessageRouterService` -> dispatches to handlers registered under `handledMessageTypes` (Batch C0.2) -> triggers `session:list` reload [OK].

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: None for Batch A1.2. Downstream batches must ensure normalized workspace roots and debounce multi-event push bursts in the frontend.
- **What a robust implementation would add**: Update JSDoc on `GitWorktreeChangedNotification.sessionId` to acknowledge agent MCP invocations (Finding 1).
