# Tasks - TASK_2025_181: Fix Slash Command Handling in Claude Agent SDK Integration

**Total Tasks**: 13 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- SessionStartHookInput.source includes 'clear': Verified at claude-sdk.types.ts:1269
- isSessionStartHook type guard exists: Verified at claude-sdk.types.ts:1391-1395
- CompactionHookHandler pattern is correct: Verified at compaction-hook-handler.ts:96-211
- QueryFunction accepts string | AsyncIterable: Verified at claude-sdk.types.ts:1683-1686
- assertNever in StreamingHandlerService enforces exhaustive switch: Verified at streaming-handler.service.ts:504
- expandPluginCommand method exists at chat-rpc.handlers.ts:1306-1367: Verified

### Risks Identified

| Risk                                                                                                   | Severity | Mitigation                                                                                              |
| ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| SDK streamInput may not accept strings at runtime despite type update                                  | HIGH     | Test at runtime; if fails, keep SDKUserMessage for follow-ups and only fix initial prompt (Component 1) |
| Timing of streamInput call after query start                                                           | MED      | messageQueue + resolveNext pattern already handles queued messages before stream connection             |
| expandPluginCommand removal may break custom plugin commands                                           | LOW      | SDK handles plugin commands natively via pluginPaths config                                             |
| Hook merge may clobber if both CompactionHookHandler and SessionStartHookHandler register SessionStart | MED      | CompactionHookHandler uses PreCompact (not SessionStart), so no conflict                                |

### Edge Cases to Handle

- [ ] Empty prompt with slash command (just "/clear" with no other text) -> Handled in Task 2.1
- [ ] Prompt with attachments AND slash command prefix -> Should use SDKUserMessage path (attachments need structured format)
- [ ] streamInput error handling for string prompt path -> Handled in Task 2.2

---

## Batch 1: SessionStart Hook Handler + DI Registration

**Developer**: backend-developer
**Status**: done
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create SessionStartHookHandler

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-start-hook-handler.ts (CREATE)
**Spec Reference**: implementation-plan.md Component 4
**Pattern to Follow**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\compaction-hook-handler.ts (entire file)

**Description**:
Create a new file `session-start-hook-handler.ts` following the exact pattern of `CompactionHookHandler`.

**Implementation Details**:

- Export `SessionClearedCallback` type: `(data: { sessionId: string; newSessionId?: string; timestamp: number }) => void`
- Class: `SessionStartHookHandler` with `@injectable()` decorator
- Constructor: inject `TOKENS.LOGGER` (Logger)
- Method: `createHooks(sessionId: string, onSessionCleared?: SessionClearedCallback): Partial<Record<HookEvent, HookCallbackMatcher[]>>`
- Hook event: `SessionStart` (not PreCompact)
- Use `isSessionStartHook()` type guard from claude-sdk.types.ts:1391
- Only invoke callback when `input.source === 'clear'`
- Pass `input.session_id` as `newSessionId` to callback (SessionStartHookInput has `session_id` field at claude-sdk.types.ts:1270)
- Always return `{ continue: true }`, never throw
- Wrap callback invocation in try/catch (fire-and-forget pattern from compaction-hook-handler.ts:179-189)

**Imports**:

- `injectable, inject` from 'tsyringe'
- `Logger, TOKENS` from '@ptah-extension/vscode-core'
- `SessionStartHookInput, HookCallbackMatcher, HookEvent, HookJSONOutput, HookInput` from '../types/sdk-types/claude-sdk.types'
- `isSessionStartHook` from '../types/sdk-types/claude-sdk.types'

**Quality Requirements**:

- Must follow CompactionHookHandler pattern exactly
- Hook must NEVER throw
- Must always return `{ continue: true }`

---

### Task 1.2: Add DI Token for SessionStartHookHandler

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 4 DI section

**Description**:
Add a new DI token for the SessionStartHookHandler.

**Implementation Details**:

- Add after line 54 (SDK_COMPACTION_HOOK_HANDLER):

```typescript
  // SessionStart hook handler for /clear detection (TASK_2025_181)
  SDK_SESSION_START_HOOK_HANDLER: Symbol.for('SdkSessionStartHookHandler'),
```

---

### Task 1.3: Register SessionStartHookHandler in DI Container

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\register.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 4 DI section

**Description**:
Register the SessionStartHookHandler as a singleton in the DI container.

**Implementation Details**:

- Import `SessionStartHookHandler` in the imports from `'../helpers'` (will be available after Task 1.4)
- Add registration after the CompactionHookHandler registration (after line 230):

```typescript
// SessionStart hook handler - detects /clear and notifies frontend (TASK_2025_181)
container.register(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER, { useClass: SessionStartHookHandler }, { lifecycle: Lifecycle.Singleton });
```

---

### Task 1.4: Export SessionStartHookHandler from Barrel Files

**Status**: done
**Files**:

- D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts (MODIFY)
- D:\projects\ptah-extension\libs\backend\agent-sdk\src\index.ts (MODIFY)

**Description**:
Add barrel exports for the new handler so it can be imported by other modules.

**Implementation Details**:

In `helpers/index.ts`, add after the CompactionHookHandler exports (after line 41):

```typescript
export { SessionStartHookHandler, type SessionClearedCallback } from './session-start-hook-handler';
```

In `src/index.ts`, add the SessionClearedCallback type export. Since SessionStartHookHandler is exported via helpers barrel, and helpers barrel is exported via index.ts already (via SdkQueryOptionsBuilder, etc.), we need to add the explicit re-export:

```typescript
export type { SessionClearedCallback } from './lib/helpers';
```

Add this near the CompactionStartCallback re-export at line 56.

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`
- No TypeScript errors in the agent-sdk library

---

## Batch 2: String-Based Prompts + Callback Plumbing

**Developer**: backend-developer
**Status**: done
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Update SdkQueryOptionsBuilder for String Prompts and SessionStart Hooks

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts (MODIFY)
**Spec Reference**: implementation-plan.md Components 1 and 4

**Description**:
Modify SdkQueryOptionsBuilder to:

1. Accept an optional `initialPromptString` field in `QueryOptionsInput`
2. Accept an optional `onSessionCleared` callback in `QueryOptionsInput`
3. Update `QueryConfig` to support string prompts and indicate prompt type
4. Inject SessionStartHookHandler and create SessionStart hooks
5. Pass onSessionCleared through createHooks

**Implementation Details**:

1. Add import for SessionStartHookHandler and SessionClearedCallback:

```typescript
import { SessionStartHookHandler, type SessionClearedCallback } from './session-start-hook-handler';
```

2. Add to `QueryOptionsInput` interface (after line 252):

```typescript
  /** Initial prompt as plain string (no attachments) - enables SDK slash command parsing (TASK_2025_181) */
  initialPromptString?: string;
  /** Callback when /clear command resets the session (TASK_2025_181) */
  onSessionCleared?: SessionClearedCallback;
```

3. Update `QueryConfig` interface (lines 294-299):

```typescript
export interface QueryConfig {
  /** Prompt for SDK: plain string (enables slash commands) OR async iterable (has attachments) */
  prompt: string | AsyncIterable<SDKUserMessage>;
  /** Whether prompt is a string (caller needs to call streamInput for follow-ups) */
  promptIsString: boolean;
  /** SDK query options */
  options: SdkQueryOptions;
}
```

4. Add constructor injection for SessionStartHookHandler (after line 324):

```typescript
    @inject(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER)
    private readonly sessionStartHookHandler: SessionStartHookHandler,
```

5. Update `build()` method to destructure new fields and use initialPromptString:

- Destructure `initialPromptString` and `onSessionCleared` from input
- Pass `onSessionCleared` to `createHooks()`
- Change return value: `prompt: initialPromptString ?? userMessageStream`
- Add: `promptIsString: !!initialPromptString`

6. Update `createHooks()` signature and body (lines 630-667):

- Add `onSessionCleared?: SessionClearedCallback` parameter
- Create sessionStartHooks: `this.sessionStartHookHandler.createHooks(sessionId ?? '', onSessionCleared)`
- Merge into mergedHooks: `...sessionStartHooks`
- Add logging for SessionStart hook

---

### Task 2.2: Update SessionLifecycleManager for String Prompts and Callback Plumbing

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts (MODIFY)
**Spec Reference**: implementation-plan.md Components 1, 2, and 5

**Description**:
Modify SessionLifecycleManager to:

1. Add `onSessionCleared` to `ExecuteQueryConfig`
2. Change initial prompt handling to pass string vs SDKUserMessage based on attachments
3. Call `streamInput()` for string prompt sessions to enable follow-up messages
4. Change `sendMessage()` to push strings for plain text (enabling slash command parsing)
5. Update `messageQueue` type and `createUserMessageStream` return type

**Implementation Details**:

1. Import SessionClearedCallback type:

```typescript
import type { SessionClearedCallback } from './session-start-hook-handler';
```

2. Add `onSessionCleared` to `ExecuteQueryConfig` interface (after line 121):

```typescript
  /** Callback when /clear resets the session (TASK_2025_181) */
  onSessionCleared?: SessionClearedCallback;
```

3. Update `ActiveSession.messageQueue` type (line 69):

```typescript
  messageQueue: (string | SDKUserMessage)[];
```

4. Update `createUserMessageStream` return type (line 422):

```typescript
  createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<string | SDKUserMessage> {
```

5. Update `executeQuery()` method (lines 512-623):

- Destructure `onSessionCleared` from config
- Step 3: Determine if initial prompt has attachments:
  ```typescript
  const hasAttachments = initialPrompt && ((initialPrompt.files && initialPrompt.files.length > 0) || (initialPrompt.images && initialPrompt.images.length > 0));
  ```
- Only queue SDKUserMessage if hasAttachments; otherwise skip (string goes via queryOptions)
- Pass `initialPromptString` and `onSessionCleared` to queryOptionsBuilder.build()
- After Step 7 (sdkQuery creation), if `queryOptions.promptIsString`, call:
  ```typescript
  sdkQuery.streamInput(userMessageStream).catch((err) => {
    this.logger.warn('[SessionLifecycle] streamInput error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  ```

6. Update `sendMessage()` method (lines 634-669):

- Check for attachments
- If no attachments: push raw string content to messageQueue
- If has attachments: create SDKUserMessage and push (existing flow)

**Validation Notes**:

- The `streamInput()` type on Query interface (line 56 of this file) does NOT currently have a `streamInput` method. Need to add it.
- Update the local `Query` interface to include `streamInput`:
  ```typescript
  streamInput(stream: AsyncIterable<string | SDKUserMessage>): Promise<void>;
  ```

**Quality Requirements**:

- Plain text prompts (including slash commands) MUST be passed as strings
- Messages with file/image attachments MUST still use SDKUserMessage format
- streamInput MUST be called after query starts for string-prompt sessions
- Existing message queue/iterator pattern must continue to work

---

### Task 2.3: Update SDK Types for String Support in streamInput

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\sdk-types\claude-sdk.types.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 2

**Description**:
Update the SDK type definitions to accept `string | SDKUserMessage` in streamInput and QueryFunction.

**Implementation Details**:

1. Update `streamInput` on the Query interface (line 1674):

```typescript
  streamInput(stream: AsyncIterable<string | SDKUserMessage>): Promise<void>;
```

2. Update `QueryFunction` type (lines 1683-1686):

```typescript
export type QueryFunction = (params: { prompt: string | AsyncIterable<string | SDKUserMessage>; options?: Options }) => Query;
```

---

### Task 2.4: Update SdkAgentAdapter to Pass onSessionCleared Through

**Status**: done
**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 6 (SdkAgentAdapter portion)

**Description**:
Add `onSessionCleared` callback parameter to `startChatSession()` and `resumeSession()` config types, and pass through to `executeQuery()`.

**Implementation Details**:

1. Import SessionClearedCallback type:

```typescript
import type { SessionClearedCallback } from './helpers';
```

2. Add `onSessionCleared` to `startChatSession()` config type (after line 368):

```typescript
      /** Callback when /clear command resets the session (TASK_2025_181) */
      onSessionCleared?: SessionClearedCallback;
```

3. Destructure and pass in startChatSession (around line 377):

```typescript
const { tabId, isPremium = false, mcpServerRunning = true, enhancedPromptsContent, pluginPaths, onSessionCleared } = config;
```

Then pass `onSessionCleared` to executeQuery config (after line 407):

```typescript
        onSessionCleared,
```

4. Add same `onSessionCleared` field to `resumeSession()` config type (after line 487):

```typescript
      /** Callback when /clear command resets the session (TASK_2025_181) */
      onSessionCleared?: SessionClearedCallback;
```

5. Pass through in resumeSession executeQuery call (after line 543):

```typescript
        onSessionCleared: config?.onSessionCleared,
```

**Batch 2 Verification**:

- All modified files compile: `npx nx build agent-sdk`
- No TypeScript errors
- QueryConfig.promptIsString is properly returned from build()
- streamInput is called for string prompt paths

---

## Batch 3: Delete expandPluginCommand + Wire Callback in ChatRpcHandlers

**Developer**: backend-developer
**Status**: done
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Delete expandPluginCommand and Remove Its Usage

**Status**: done
**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 3

**Description**:
Remove the `expandPluginCommand` method and all its call sites. The SDK handles plugin commands natively when receiving string prompts.

**Implementation Details**:

1. In `registerChatStart()` (lines 539-544): Remove the expandPluginCommand call:

   - Delete: `const expandedPrompt = prompt ? await this.expandPluginCommand(prompt, pluginPaths) : prompt;`
   - Change line 558 from `prompt: expandedPrompt,` to `prompt: prompt,` (or just `prompt,`)

2. In `registerChatContinue()` (lines 698-706): Remove the expandPluginCommand call:

   - Delete the entire block:
     ```
     const expandedContinuePrompt = prompt.trim().startsWith('/')
       ? await this.expandPluginCommand(prompt, this.resolvePluginPaths(true))
       : prompt;
     ```
   - Update line 714 from `let enhancedPrompt = expandedContinuePrompt;` to `let enhancedPrompt = prompt;`
   - Update line 715 from `const isSlashCommand = expandedContinuePrompt.trim().startsWith('/');` to `const isSlashCommand = prompt.trim().startsWith('/');`

3. Delete the entire `expandPluginCommand` method (lines 1306-1367)

4. Verify that `fs` and `path` imports are still needed by other methods (yes: `hasSubagentTranscript` uses both)

**Quality Requirements**:

- All plugin commands work via SDK's native handling
- Built-in commands (/clear, /compact, /help) work via SDK
- Subagent context injection still correctly skips slash commands
- No unused imports remain

---

### Task 3.2: Wire onSessionCleared Callback in ChatRpcHandlers

**Status**: done
**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 6

**Description**:
Pass `onSessionCleared` callback to `startChatSession()` and `resumeSession()` calls so that when /clear is detected, a `session_cleared` event is emitted to the frontend.

**Implementation Details**:

1. In `registerChatStart()` - add `onSessionCleared` to the `startChatSession()` config (after line 564):

```typescript
            onSessionCleared: (data) => {
              this.logger.info('[RPC] Session cleared via /clear command', {
                sessionId: data.sessionId,
                newSessionId: data.newSessionId,
                tabId,
              });
              // Emit session_cleared event to frontend
              this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
                tabId,
                sessionId: data.sessionId,
                event: {
                  id: `evt_clear_${Date.now()}`,
                  eventType: 'session_cleared',
                  timestamp: data.timestamp,
                  sessionId: data.sessionId,
                  messageId: '',
                  newSessionId: data.newSessionId,
                },
              }).catch((err) => {
                this.logger.error('[RPC] Failed to broadcast session_cleared',
                  err instanceof Error ? err : new Error(String(err))
                );
              });
            },
```

2. In `registerChatContinue()` - the resumeSession call (around line 670) also needs the callback. Add `onSessionCleared` to the resumeSession config with similar logic, using `tabId` from params.

**Batch 3 Verification**:

- Build passes: `npx nx build ptah-extension-vscode`
- expandPluginCommand method is fully deleted
- onSessionCleared callback is wired in both chat:start and chat:continue paths
- No TypeScript errors

---

## Batch 4: Frontend session_cleared Event Type and Handler

**Developer**: backend-developer
**Status**: done
**Tasks**: 3 | **Dependencies**: Batch 3

### Task 4.1: Add session_cleared to StreamEventType Union

**Status**: done
**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 7

**Description**:
Add `'session_cleared'` to the `StreamEventType` union and create the `SessionClearedEvent` interface.

**Implementation Details**:

1. Add `'session_cleared'` to `StreamEventType` union (after line 747, before the semicolon):

```typescript
  | 'session_cleared'
```

2. Add `SessionClearedEvent` interface after `CompactionCompleteEvent` (after line 937):

```typescript
/**
 * Session cleared event - notifies UI that /clear command was processed
 * TASK_2025_181: Fix slash command handling
 *
 * Emitted when the SDK processes /clear and fires SessionStart hook with source='clear'.
 * Frontend should:
 * - Clear all messages from the tab
 * - Reset streaming state
 * - Clear deduplication state
 * - Update session ID if a new one was assigned
 */
export interface SessionClearedEvent extends FlatStreamEvent {
  readonly eventType: 'session_cleared';
  /** New session ID assigned after clear (if available) */
  readonly newSessionId?: string;
}
```

3. Add `SessionClearedEvent` to `FlatStreamEventUnion` (after line 1049, before the semicolon):

```typescript
  | SessionClearedEvent
```

---

### Task 4.2: Export SessionClearedEvent from Shared Library

**Status**: done
**File**: D:\projects\ptah-extension\libs\shared\src\index.ts (MODIFY - if needed)
**Spec Reference**: implementation-plan.md Component 7

**Description**:
Ensure `SessionClearedEvent` is exported from the shared library barrel. Since `execution-node.types.ts` likely has a wildcard or named export in the shared index, verify and add if missing.

**Implementation Details**:

- Check if execution-node.types.ts exports are already covered by existing barrel exports
- If `SessionClearedEvent` is part of the `FlatStreamEventUnion` and types are already exported, this may be a no-op
- If explicit named exports are used, add `SessionClearedEvent` to the list

---

### Task 4.3: Handle session_cleared in StreamingHandlerService

**Status**: done
**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts (MODIFY)
**Spec Reference**: implementation-plan.md Component 7

**Description**:
Add a `case 'session_cleared'` handler in the `processStreamEvent()` switch statement, modeled after `compaction_complete` (lines 464-488).

**Implementation Details**:

Add after the `compaction_complete` case (after line 488) and before `background_agent_started`:

```typescript
        case 'session_cleared': {
          // TASK_2025_181: /clear command processed by SDK
          // Reset streaming state, clear messages, and clear deduplication
          console.log(
            '[StreamingHandlerService] Session cleared via /clear command',
            { sessionId: event.sessionId, newSessionId: (event as SessionClearedEvent).newSessionId }
          );

          // Reset streaming state to fresh (same as compaction_complete)
          this.tabManager.updateTab(targetTab.id, {
            streamingState: createEmptyStreamingState(),
            // Clear all messages (unlike compaction which keeps them)
            messages: [],
          });

          // Clear deduplication state
          this.deduplication.cleanupSession(event.sessionId);

          // Update session ID if a new one was assigned
          const clearedEvent = event as SessionClearedEvent;
          if (clearedEvent.newSessionId) {
            this.tabManager.updateTab(targetTab.id, {
              claudeSessionId: clearedEvent.newSessionId,
            });
            this.sessionManager.setSessionId(clearedEvent.newSessionId);
          }

          return {
            tabId: targetTab.id,
            sessionCleared: true,
          };
        }
```

Also add `SessionClearedEvent` to the imports from `@ptah-extension/shared`.

Update the return type of `processStreamEvent()` to include `sessionCleared?: boolean` if it uses a typed return. Check the existing return type and add if needed.

**Quality Requirements**:

- assertNever default case must compile (session_cleared is handled)
- Tab messages are cleared (not just streaming state)
- Deduplication state is cleaned up
- Session ID is updated if SDK provides a new one

**Batch 4 Verification**:

- Build passes: `npx nx build shared` and `npx nx build chat`
- TypeScript compiles without errors (assertNever exhaustiveness check passes)
- session_cleared case is handled in the switch statement
