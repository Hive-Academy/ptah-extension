# Batch 1 Implementation Report — TASK_2026_155

**Scope**: agent-sdk core — F1 permission-level threading (Tasks 1.1–1.3) + F2 unroutable permission deny-timeout (Task 1.4). Batches 2 and 3 NOT touched.
**Status**: All four tasks IMPLEMENTED. Typecheck + existing test suite green. No new tests added (Batch 3). No commit.

---

## Files Changed

### Task 1.1 — shared adapter config surface

`libs/shared/src/lib/types/agent-adapter.types.ts`

- Added `import type { PermissionLevel } from './model-autopilot.types';` (line ~16).
- Added optional `permissionLevel?: PermissionLevel;` (with doc comment) to `AgentSessionStartConfig` (after `pluginPaths`) and to `AgentSessionResumeConfig` (after `tabId`).

### Task 1.2 — ExecuteQueryConfig + executor seed

`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

- Added `type PermissionLevel` to the `@ptah-extension/shared` import group.
- Added `permissionLevel?: PermissionLevel;` (with doc comment) to `ExecuteQueryConfig` (after `enhancedPromptsContent`).

`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`

- Destructured `permissionLevel` from `config` in `executeQuery` (~line 88).
- Seed line (~line 141) changed from
  `const currentLevel = this.permissionHandler.getPermissionLevel();`
  to `const currentLevel = permissionLevel ?? this.permissionHandler.getPermissionLevel();`
  (updated the surrounding comment). `rec.permissionLevel = currentLevel;`, `permissionLevelResolver`, and the `initialPermissionMode` derivation via `PERMISSION_MODE_MAP` are all UNCHANGED — so `'yolo'` still maps to SDK `'default'`, never `'bypassPermissions'`.

### Task 1.3 — SdkAgentAdapter start/resume

`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

- Added `type PermissionLevel` to the `@ptah-extension/shared` import group.
- `startChatSession` (~line 414): added `permissionLevel?: PermissionLevel;` to the inline config literal, destructured it, and forwarded `permissionLevel` into `sessionLifecycle.executeQuery({...})`.
- `resumeSession` (~line 517): added `permissionLevel?: PermissionLevel;` to the inline config literal, added `const permissionLevel = config?.permissionLevel;`, and forwarded it into `executeQuery({...})`. The "already active, returning existing stream" early-return branch was left untouched (session already seeded).

### Task 1.4 — F2 unroutable deny-timeout

`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

- Import: `import { v4 as uuidv4, validate as isUuid } from 'uuid';` (uuid ^11.1.0 exports `validate`).
- Module constant: `const UNROUTABLE_PERMISSION_TIMEOUT_MS = 60_000;` (below the `PendingRequest` interface, with a doc comment).
- New private helper `isRoutablePermissionRequest(sessionId?, tabId?): boolean` — routable when a defined `sessionId` OR `tabId` passes `isUuid(...)`.
- `requestUserPermission`: replaced `const timeoutAt = 0;` with a routable-aware computation — routable ⇒ `0` (unchanged), unroutable ⇒ `startTime + UNROUTABLE_PERMISSION_TIMEOUT_MS`. Passes `isRoutable ? undefined : UNROUTABLE_PERMISSION_TIMEOUT_MS` as a new 5th arg to `awaitResponse`.
- `awaitResponse`: added `timeoutMs?` param. When a positive timeout is supplied, arms a `setTimeout` that (if still pending) deletes the id from `pendingRequests` + `pendingRequestContext`, logs a warn (`requestId`, `toolName`, `timeoutMs`), and resolves `{ id, decision: 'deny', reason: ... }`. The timer is cleared via a `clearTimer()` closure invoked BOTH in the stored `resolve` wrapper (real response) AND in `onAbort` (abort) — so whichever settles first cancels the timer (no late deny, no leak). When `timeoutMs` is `undefined` (routable), behavior is byte-identical to before.

---

## Decisions Taken (where tasks.md left latitude)

### 1. Type used for `permissionLevel`: `PermissionLevel`, not `AgentPermissionLevel`

tasks.md Task 1.1/1.3 name `AgentPermissionLevel`; Task 1.2 names `PermissionLevel`. The orchestrator explicitly authorized reusing `PermissionLevel`. I used `PermissionLevel` (`'ask' | 'auto-edit' | 'yolo' | 'plan'`, from `model-autopilot.types.ts`) uniformly across all four new fields, because:

- `SessionRecord.permissionLevel` is typed `PermissionLevel` (session-registry.service.ts:61), and the executor assigns `rec.permissionLevel = currentLevel`. If the config field were the superset `AgentPermissionLevel` (which also contains SDK-only `'default' | 'acceptEdits' | 'bypassPermissions'`), the assignment would not typecheck, and forwarding adapter→`executeQuery` would fail (superset ⊄ subset).
- Using the frontend-only `PermissionLevel` makes it a COMPILE ERROR to ever pass the SDK `'bypassPermissions'` alias down the interactive session-start path — which is exactly the load-bearing invariant the whole fix depends on (permission-mode-map.ts comment). This is stricter and safer than the wider type.

### 2. Unroutable classification: valid-UUID presence check on `sessionId`/`tabId`

Per the note in my instructions, `sessionId`/`tabId` reaching `requestUserPermission` are branded types the options builder only populates from `SessionId.safeParse` / `TabId.safeParse` (sdk-query-options-builder.ts:571–592 passes `routingSessionId ?? undefined` and `routingTabId ?? undefined`) — a non-UUID `gw-<id>` routing id becomes `undefined`. So at this layer "unroutable" is effectively "both absent". I implemented `isRoutablePermissionRequest` as `(sessionId && isUuid(sessionId)) || (tabId && isUuid(tabId))`: the presence check alone would suffice given the upstream guarantee, but the explicit `isUuid` check is cheap defense-in-depth, matches tasks.md's "strict UUID check" wording verbatim, and keeps the classification correct even if some future caller passes a non-UUID branded value. A valid-UUID `sessionId` with absent `tabId` is correctly classified routable (the required edge case).

### 3. Timer cleanup reuses the existing `resolve` wrapper

The timeout callback calls the stored `pending.resolve(...)` (after deleting from the maps), which runs the same `clearTimer()` + `removeEventListener` cleanup used by the normal path — keeping cleanup DRY and guaranteeing no double-resolve.

---

## Verification

Run from worktree root `D:/projects/ptah-extension/.claude-worktrees/fix/gateway-turn-hang`.

**`npx nx run-many -t typecheck --projects=shared,agent-sdk --skip-nx-cache`**
→ `Successfully ran target typecheck for 2 projects` (both `@ptah-extension/shared` and `@ptah-extension/agent-sdk` passed).

**`npx nx test agent-sdk --skip-nx-cache`**
→ `Test Suites: 58 passed, 58 total` / `Tests: 690 passed, 690 total` / `Time: ~81 s`. `Successfully ran target test`. (The "worker failed to exit gracefully" line is a pre-existing Jest teardown warning unrelated to these changes; all tests green.)

No new tests were written (Batch 3 owns tests). No commit made (team-leader owns commits).
