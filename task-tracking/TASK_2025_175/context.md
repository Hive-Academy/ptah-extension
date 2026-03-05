# TASK_2025_175: Fix Agent Interruption Race Condition in Yolo Mode

## Task Type: BUGFIX

## Workflow: Partial (Architect → Team-Leader → Developers → QA)

## Priority: P0 - Critical

## User Report

Agent in yolo mode (autonomous/background) ignores interruption. UI shows session as closed, but the agent creates a new chat session and continues working in the background.

## Root Causes Identified

### RC1: `interrupt()` not awaited before `abort()`

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:307-320`

- `interrupt()` is fire-and-forget (`.catch()` only)
- `abort()` is called immediately after, killing the process before interrupt can complete
- SDK best practice: `await interrupt()` THEN `abort()`

### RC2: `interrupt()` errors silently swallowed

**File**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:311`

- Errors logged at DEBUG level only
- If interrupt fails, nobody knows and session continues

### RC3: Background agents not cleaned up on abort

**File**: `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts:335-350`

- `markAsBackground()` sets flag but `stopWatching()` is never called for background agents on abort
- Watchers continue indefinitely, tailing files and emitting events

### RC4: `stop()` returns before process actually exits

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts:783-808`

- For SDK agents: `abort()` returns immediately without waiting
- `agent:exited` event emitted before process is actually dead
- Status set to 'stopped' optimistically

### RC5: Session watcher not integrated with abort flow

- When a session is aborted, nobody tells `AgentSessionWatcher` to stop watching background agents
- The watcher continues emitting events to a "dead" session

## Claude Agent SDK Best Practices (v0.2.42)

Three-tier termination:

1. **`interrupt()`** - Graceful stop (async, preferred, MUST await)
2. **`abortController.abort()`** - Force terminate (sync, after interrupt)
3. **`close()`** - Emergency cleanup (sync, last resort)

Correct sequence:

```
1. cleanupPendingPermissions()
2. markAllInterrupted()
3. await query.interrupt()     ← MUST AWAIT
4. abortController.abort()     ← AFTER interrupt completes
5. Delete from activeSessions
```

## Files to Modify

1. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
2. `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`
3. `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`
4. `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

## Acceptance Criteria

- [ ] `interrupt()` is properly awaited with timeout before `abort()`
- [ ] `abort()` only called after interrupt completes or times out
- [ ] Background agents properly terminated when parent session aborted
- [ ] `stop()` waits for actual process exit before returning
- [ ] Session watcher cleaned up for all agent types on abort
- [ ] No zombie processes after interruption
- [ ] Proper error logging (WARN/ERROR, not DEBUG) for interrupt failures
