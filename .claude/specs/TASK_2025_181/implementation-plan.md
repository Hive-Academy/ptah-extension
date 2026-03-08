# Implementation Plan - TASK_2025_181: Fix Slash Command Handling in Claude Agent SDK Integration

## Codebase Investigation Summary

### Libraries Discovered

- **agent-sdk** (`libs/backend/agent-sdk/`): SDK integration layer with session lifecycle, query building, message factory, stream transformation

  - Key exports: `SdkAgentAdapter`, `SessionLifecycleManager`, `SdkQueryOptionsBuilder`, `SdkMessageFactory`
  - Documentation: `libs/backend/agent-sdk/CLAUDE.md`
  - Hook pattern: `CompactionHookHandler` (verified at `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`)

- **shared** (`libs/shared/`): Foundation types including `FlatStreamEventUnion` discriminated union

  - Event types defined at: `libs/shared/src/lib/types/execution-node.types.ts:1032-1049`
  - `assertNever` exhaustiveness check at: `libs/shared/src/lib/utils/assert-never.ts:28`

- **chat** (`libs/frontend/chat/`): Frontend streaming handler service
  - Compaction flow model at: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts:451-488`

### Patterns Identified

**Pattern 1: SDK Hook Callback**

- Evidence: `CompactionHookHandler` at `compaction-hook-handler.ts:96-211`
- Creates `Partial<Record<HookEvent, HookCallbackMatcher[]>>` that gets merged in `SdkQueryOptionsBuilder.createHooks()`
- Hook returns `{ continue: true }` and NEVER throws
- Uses callback pattern (fire-and-forget) to notify callers

**Pattern 2: FlatStreamEventUnion Extension**

- Evidence: `CompactionStartEvent` / `CompactionCompleteEvent` at `execution-node.types.ts:919-937`
- New event types: define interface extending `FlatStreamEvent`, add to union, add `eventType` literal
- Frontend switch/case in `StreamingHandlerService.processStreamEvent()` handles each type
- `assertNever` default case enforces exhaustiveness

**Pattern 3: Query Prompt Types**

- Evidence: `QueryFunction` at `claude-sdk.types.ts:1683-1686`
- `query({ prompt: string | AsyncIterable<SDKUserMessage> })` - SDK accepts both
- Plain strings enable SDK slash command parsing; SDKUserMessage does NOT
- `Query.streamInput(stream: AsyncIterable<SDKUserMessage>)` at `claude-sdk.types.ts:1674`

**Pattern 4: SDK Hook Events**

- Evidence: `HookEvent` type at `claude-sdk.types.ts:1060-1072`
- `SessionStart` hook fires with `source: 'startup' | 'resume' | 'clear' | 'compact'`
- `SessionStartHookInput` at `claude-sdk.types.ts:1267-1271`
- Type guard `isSessionStartHook()` at `claude-sdk.types.ts:1391-1395`

### Integration Points

- `SdkQueryOptionsBuilder.build()` returns `QueryConfig` with `prompt` and `options` properties
- `SessionLifecycleManager.executeQuery()` calls `queryFn({ prompt: queryOptions.prompt, options: ... })`
- `SessionLifecycleManager.sendMessage()` queues `SDKUserMessage` into `session.messageQueue`
- `StreamingHandlerService.processStreamEvent()` switches on `event.eventType` with `assertNever`

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: String-first prompt delivery with hook-based clear detection

**Rationale**: The SDK parses slash commands only from plain string prompts. By sending the initial prompt as a string (when no attachments are present), the SDK can natively handle both built-in commands (`/clear`, `/compact`) and plugin commands (`/orchestrate`, user commands). The `expandPluginCommand` workaround becomes unnecessary and should be deleted. For the `/clear` command specifically, we add a `SessionStart` hook to detect `source: 'clear'` and emit a frontend reset event.

**Evidence**:

- `QueryFunction` accepts `prompt: string | AsyncIterable<SDKUserMessage>` (claude-sdk.types.ts:1683)
- `SessionStartHookInput.source` includes `'clear'` (claude-sdk.types.ts:1269)
- `CompactionHookHandler` provides the established pattern for hook creation (compaction-hook-handler.ts:96-211)
- `expandPluginCommand` manually expands plugin templates, duplicating SDK's native functionality (chat-rpc.handlers.ts:1306-1367)

---

## Component Specifications

### Component 1: String-Based Initial Prompt in executeQuery

**Purpose**: Send the initial prompt as a plain string to `query({ prompt: "..." })` so the SDK can parse slash commands natively.

**Pattern**: Conditional prompt type selection based on attachments
**Evidence**: `executeQuery()` at session-lifecycle-manager.ts:512-623, `QueryFunction` at claude-sdk.types.ts:1683

**Current Flow (Broken)**:

1. `executeQuery()` always creates `SDKUserMessage` via `messageFactory.createUserMessage()`
2. Pushes SDKUserMessage to `session.messageQueue`
3. `createUserMessageStream()` yields SDKUserMessage objects
4. Passes `AsyncIterable<SDKUserMessage>` as `prompt` to `query()`
5. SDK receives message object, never parses slash commands

**New Flow**:

1. If `initialPrompt` has no files and no images (plain text), pass `initialPrompt.content` as `prompt: string` directly to `query()`
2. If `initialPrompt` has attachments, use the existing `SDKUserMessage` + `AsyncIterable` flow
3. The AsyncIterable stream is still created and passed as the `streamInput()` for follow-up messages

**Key Design Decision**: The `query()` function can only receive ONE prompt argument. Currently it receives the `AsyncIterable<SDKUserMessage>` as the prompt (which serves double duty as both the initial message delivery and the follow-up message channel). The fix requires separating these concerns:

- **Initial prompt**: Passed as a plain string via `query({ prompt: stringPrompt })`
- **Follow-up messages**: Delivered via `sdkQuery.streamInput(asyncIterable)` after the query starts

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

**Changes to `session-lifecycle-manager.ts`**:

```typescript
// executeQuery() - Step 3: Change initial prompt handling
// BEFORE:
if (initialPrompt && initialPrompt.content.trim()) {
  const session = this.getActiveSession(sessionId);
  if (session) {
    const sdkUserMessage = await this.messageFactory.createUserMessage({...});
    session.messageQueue.push(sdkUserMessage);
  }
}

// AFTER:
// Determine if initial prompt has attachments
const hasAttachments = initialPrompt &&
  ((initialPrompt.files && initialPrompt.files.length > 0) ||
   (initialPrompt.images && initialPrompt.images.length > 0));

// If plain text only, pass as string prompt to SDK (enables slash command parsing)
// If has attachments, queue as SDKUserMessage (attachments need structured format)
if (initialPrompt && initialPrompt.content.trim() && hasAttachments) {
  const session = this.getActiveSession(sessionId);
  if (session) {
    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content: initialPrompt.content,
      sessionId,
      files: initialPrompt.files,
      images: initialPrompt.images,
    });
    session.messageQueue.push(sdkUserMessage);
  }
}

// Step 5: Create user message stream for FOLLOW-UP messages only
const userMessageStream = this.createUserMessageStream(sessionId, abortController);

// Step 6: Build query options - pass string prompt separately
const queryOptions = await this.queryOptionsBuilder.build({
  userMessageStream,
  // NEW: Pass initial prompt string separately when no attachments
  initialPromptString: (!hasAttachments && initialPrompt?.content.trim())
    ? initialPrompt.content
    : undefined,
  abortController,
  // ... rest of params unchanged
});

// Step 7: Start SDK query
const sdkQuery: Query = queryFn({
  prompt: queryOptions.prompt, // Now string OR AsyncIterable depending on case
  options: queryOptions.options as Options,
});

// Step 7b: NEW - For string prompt, connect follow-up stream via streamInput
if (queryOptions.promptIsString) {
  // streamInput provides the channel for subsequent messages
  sdkQuery.streamInput(userMessageStream).catch((err) => {
    this.logger.warn('[SessionLifecycle] streamInput error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
```

**Changes to `sdk-query-options-builder.ts`**:

```typescript
// QueryOptionsInput - add new field
export interface QueryOptionsInput {
  // ... existing fields
  /** Initial prompt as plain string (no attachments) - enables SDK slash command parsing */
  initialPromptString?: string;
}

// QueryConfig - change prompt type
export interface QueryConfig {
  /** Prompt for SDK: plain string (enables slash commands) OR async iterable (has attachments) */
  prompt: string | AsyncIterable<SDKUserMessage>;
  /** Whether prompt is a string (caller needs to call streamInput for follow-ups) */
  promptIsString: boolean;
  /** SDK query options */
  options: SdkQueryOptions;
}

// build() method - handle string prompt
async build(input: QueryOptionsInput): Promise<QueryConfig> {
  const { initialPromptString, userMessageStream, ...rest } = input;
  // ... existing option building logic unchanged ...

  return {
    // If initialPromptString provided, use it directly (enables slash command parsing)
    // Otherwise use the AsyncIterable (for messages with attachments)
    prompt: initialPromptString ?? userMessageStream,
    promptIsString: !!initialPromptString,
    options: { /* unchanged */ },
  };
}
```

**Quality Requirements**:

- Plain text prompts (including slash commands) MUST be passed as strings
- Messages with file/image attachments MUST still use SDKUserMessage format
- `streamInput()` MUST be called after query starts for string-prompt sessions to enable follow-up messages
- Existing tests must pass (no behavioral change for regular text messages)

---

### Component 2: String-Based Follow-Up Messages in sendMessage

**Purpose**: Enable slash commands in follow-up messages (chat:continue) by handling them as string prompts.

**Pattern**: The AsyncIterable `messageQueue` currently only accepts `SDKUserMessage` objects. Since the SDK's `streamInput()` method also only accepts `AsyncIterable<SDKUserMessage>`, we cannot send raw strings through it.

**Key Insight**: For follow-up messages, the SDK's slash command parsing happens at a different level than the initial `query()` prompt. The SDK v0.2.25 `streamInput()` only accepts `SDKUserMessage`. However, the SDK internally checks messages for slash commands if they arrive as the content of an SDKUserMessage with plain text content.

**CORRECTION**: Re-examining the context.md: "V2 send() accepts string | SDKUserMessage - string path parses slash commands". The `streamInput()` accepts `AsyncIterable<SDKUserMessage>` but individual SDKUserMessages with plain text content DO get slash command parsing. The actual issue is that our `createUserMessage()` wraps content as `{ message: { role: 'user', content: "text" } }` which IS a valid SDKUserMessage structure.

**Re-analysis of the root cause**: The SDK parses slash commands from the `prompt` parameter of `query()` when it's a string. For the initial message, switching to string prompt fixes this. For follow-up messages through `streamInput()` / the AsyncIterable, the SDK may or may not parse slash commands from SDKUserMessage content. The context.md states clearly that the SDK only parses commands from plain strings.

**Design Decision**: For follow-up messages, we change the `messageQueue` type from `SDKUserMessage[]` to `(string | SDKUserMessage)[]` and update `createUserMessageStream` to yield the appropriate type. However, `streamInput()` only accepts `AsyncIterable<SDKUserMessage>`, so this approach won't work for the stream.

**Alternative approach**: Instead of modifying the stream mechanism, handle slash commands at the `sendMessage()` level. When the content is a slash command (starts with `/`) AND has no attachments, we don't queue it as an SDKUserMessage. Instead, we handle it by restarting/modifying the query. But this is overly complex.

**FINAL APPROACH**: The simplest correct approach based on the SDK architecture:

1. For **initial prompt** (chat:start): Pass as string to `query({ prompt })` - FIXED by Component 1
2. For **built-in slash commands** in follow-ups (chat:continue with `/clear`, `/compact`): These trigger SDK hooks (SessionStart with source `'clear'`/`'compact'`). The SDK handles them when the initial query was started with proper configuration. The issue is that currently we expand these commands BEFORE sending to the SDK. By removing `expandPluginCommand` (Component 3), we let the SDK receive the raw `/clear` text. Since the SDK receives it as SDKUserMessage content through the async iterable, and the SDK knows how to parse commands from message content within an active session, this should work.
3. For **plugin slash commands** in follow-ups (chat:continue with `/orchestrate`): The SDK has `pluginPaths` configured and handles plugin command resolution internally within an active session.

**CRITICAL REALIZATION**: After re-reading the context.md problem analysis more carefully: "SDK only parses slash commands from plain strings, not from SDKUserMessage.message.content". This means even within `streamInput()`, SDKUserMessage objects don't get command parsing. The SDK distinguishes between `string` and `SDKUserMessage` at the type level.

**REVISED FINAL APPROACH**: The `sendMessage()` method needs to differentiate:

- **Slash commands without attachments**: Cannot be sent through the existing AsyncIterable<SDKUserMessage> channel. Instead, we need a different delivery mechanism.
- **Regular messages or messages with attachments**: Use the existing SDKUserMessage + AsyncIterable flow.

For slash commands in follow-up messages, the cleanest solution is:

1. Detect slash commands in `sendMessage()` (content starts with `/`, no files/images)
2. For built-in commands like `/clear`: The SDK handles them through the SessionStart hook when it restarts the session. We emit the slash command as a string by calling `sdkQuery.interrupt()` and then starting a new query with `prompt: "/clear"`. BUT this is overly complex and dangerous.

**SIMPLEST CORRECT APPROACH**: Keep the focus on what's actually broken vs working:

- `/clear`, `/compact` etc in chat:continue - BROKEN (SDK ignores them in SDKUserMessage)
- `/orchestrate` in chat:continue - Works via `expandPluginCommand` workaround (but should work natively)

The fix: Change the `ActiveSession.messageQueue` type and `createUserMessageStream` to support yielding both strings and SDKUserMessage objects. Update the type of the AsyncIterable from `AsyncIterable<SDKUserMessage>` to `AsyncIterable<string | SDKUserMessage>`. This requires updating our local `Query` interface since the actual SDK `streamInput()` accepts `AsyncIterable<SDKUserMessage>`.

**WAIT** - we need to check if the actual SDK (not our type copy) accepts `string | SDKUserMessage` in the stream. The context.md says "V2 send() accepts string | SDKUserMessage". Let me check if `streamInput` was updated.

Since we copied SDK types at version 0.2.25 and the context says "V2 send()", this might be a newer API. We should update our type definitions to match.

**PRACTICAL SOLUTION**: Given the constraints, the most pragmatic approach is:

1. **Initial prompt** (chat:start): Pass as string to `query({ prompt })` - no AsyncIterable needed for the initial message
2. **Follow-up messages** (chat:continue):
   - Change `messageQueue` to `(string | SDKUserMessage)[]`
   - Update `createUserMessageStream()` to yield `string | SDKUserMessage`
   - Update `QueryConfig.prompt` type to `string | AsyncIterable<string | SDKUserMessage>`
   - When sending a slash command without attachments: push the raw string to messageQueue
   - When sending with attachments: push SDKUserMessage as before
3. **Update SDK types**: If the SDK doesn't accept `AsyncIterable<string | SDKUserMessage>` for `streamInput()`, we still pass it. At runtime the SDK should handle strings in the iterable. We update our local type copy to match.

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` (MODIFY - update streamInput type)

**Changes to `session-lifecycle-manager.ts`**:

In `ActiveSession` interface:

```typescript
// BEFORE:
messageQueue: SDKUserMessage[];

// AFTER:
messageQueue: (string | SDKUserMessage)[];
```

In `createUserMessageStream()`:

```typescript
// BEFORE:
createUserMessageStream(...): AsyncIterable<SDKUserMessage> { ... yield message; }

// AFTER:
createUserMessageStream(...): AsyncIterable<string | SDKUserMessage> { ... yield message; }
```

In `sendMessage()`:

```typescript
async sendMessage(
  sessionId: SessionId,
  content: string,
  files?: string[],
  images?: InlineImageAttachment[]
): Promise<void> {
  const session = this.activeSessions.get(sessionId as string);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const hasAttachments = (files && files.length > 0) || (images && images.length > 0);

  if (hasAttachments) {
    // Messages with attachments need SDKUserMessage format
    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content, sessionId, files, images,
    });
    session.messageQueue.push(sdkUserMessage);
  } else {
    // Plain text messages (including slash commands) sent as strings
    // This enables SDK slash command parsing for /clear, /compact, /help, plugin commands
    session.messageQueue.push(content);
  }

  // Wake iterator
  if (session.resolveNext) {
    session.resolveNext();
    session.resolveNext = null;
  }
}
```

**Changes to `claude-sdk.types.ts`**:

```typescript
// Update streamInput to accept string | SDKUserMessage
streamInput(stream: AsyncIterable<string | SDKUserMessage>): Promise<void>;

// Update QueryFunction prompt type
export type QueryFunction = (params: {
  prompt: string | AsyncIterable<string | SDKUserMessage>;
  options?: Options;
}) => Query;
```

---

### Component 3: Delete expandPluginCommand

**Purpose**: Remove the manual plugin command expansion workaround. The SDK handles plugin commands natively when receiving string prompts.

**Pattern**: Direct removal
**Evidence**: `expandPluginCommand` at chat-rpc.handlers.ts:1306-1367, called at lines 543 and 702

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (MODIFY)

**Changes**:

1. **Delete the `expandPluginCommand` method** (lines 1306-1367)

2. **Remove call in `registerChatStart()`** (lines 539-544):

```typescript
// BEFORE:
const expandedPrompt = prompt
  ? await this.expandPluginCommand(prompt, pluginPaths)
  : prompt;
// ... later:
prompt: expandedPrompt,

// AFTER:
// Pass prompt directly - SDK handles slash commands natively via string prompt
// ... later:
prompt: prompt,
```

3. **Remove call in `registerChatContinue()`** (lines 698-706):

```typescript
// BEFORE:
const expandedContinuePrompt = prompt.trim().startsWith('/') ? await this.expandPluginCommand(prompt, this.resolvePluginPaths(true)) : prompt;
// ... later uses expandedContinuePrompt

// AFTER:
// Remove the expansion entirely. Pass prompt directly to sendMessage.
// SDK handles slash commands natively when receiving strings.
// ... use prompt directly
```

4. **Update the `enhancedPrompt` variable**: The `isSlashCommand` check and subagent context injection logic (lines 714-817) should still work since it checks `expandedContinuePrompt.trim().startsWith('/')`. After removing expansion, this checks the original `prompt` which is correct -- slash commands like `/clear` should skip subagent injection.

```typescript
// BEFORE:
let enhancedPrompt = expandedContinuePrompt;
const isSlashCommand = expandedContinuePrompt.trim().startsWith('/');

// AFTER:
let enhancedPrompt = prompt;
const isSlashCommand = prompt.trim().startsWith('/');
```

5. **Remove `fs` and `path` imports** if no longer used elsewhere in the file. Check: `fs` is used in `hasSubagentTranscript()` (line 121), `path` is used in `hasSubagentTranscript()` (line 139). So keep these imports.

**Quality Requirements**:

- All plugin commands (`/orchestrate`, user `.claude/commands/`) work via SDK's native handling
- Built-in commands (`/clear`, `/compact`, `/help`) work via SDK's native handling
- No behavioral change for non-slash-command messages
- The subagent context injection still correctly skips slash commands

---

### Component 4: SessionStart Hook for /clear Detection

**Purpose**: Detect when the SDK processes a `/clear` command and emit a frontend event to reset the tab state (clear messages, streaming state, dedup state).

**Pattern**: Follows `CompactionHookHandler` pattern exactly
**Evidence**: `CompactionHookHandler` at compaction-hook-handler.ts:76-211, `SessionStartHookInput` at claude-sdk.types.ts:1267-1271

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/session-start-hook-handler.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)
- `libs/backend/agent-sdk/src/index.ts` (MODIFY - export new handler)

**New File: `session-start-hook-handler.ts`**:

```typescript
/**
 * SessionStartHookHandler - Handles SDK SessionStart hooks
 *
 * Detects when the SDK restarts a session due to /clear command
 * and notifies the frontend to reset tab state.
 *
 * SessionStart hook fires with source:
 * - 'startup': New session started
 * - 'resume': Session resumed from disk
 * - 'clear': /clear command processed - conversation cleared
 * - 'compact': After compaction completes
 *
 * We only care about 'clear' to reset frontend state.
 *
 * @see TASK_2025_181 - Fix slash command handling
 */

import { injectable, inject } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SessionStartHookInput, HookCallbackMatcher, HookEvent, HookJSONOutput, HookInput } from '../types/sdk-types/claude-sdk.types';
import { isSessionStartHook } from '../types/sdk-types/claude-sdk.types';

export type SessionClearedCallback = (data: { sessionId: string; newSessionId?: string; timestamp: number }) => void;

@injectable()
export class SessionStartHookHandler {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  createHooks(sessionId: string, onSessionCleared?: SessionClearedCallback): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const capturedCallback = onSessionCleared;

    return {
      SessionStart: [
        {
          hooks: [
            async (input: HookInput, _toolUseId: string | undefined, _options: { signal: AbortSignal }): Promise<HookJSONOutput> => {
              try {
                if (!isSessionStartHook(input)) {
                  return { continue: true };
                }

                this.logger.info('[SessionStartHookHandler] SessionStart hook fired', {
                  source: input.source,
                  sessionId,
                });

                if (input.source === 'clear' && capturedCallback) {
                  capturedCallback({
                    sessionId,
                    newSessionId: input.session_id,
                    timestamp: Date.now(),
                  });
                }
              } catch (error) {
                this.logger.error('[SessionStartHookHandler] Error in SessionStart hook', error instanceof Error ? error : new Error(String(error)));
              }

              return { continue: true };
            },
          ],
        },
      ],
    };
  }
}
```

**Changes to `sdk-query-options-builder.ts`**:

1. Import `SessionStartHookHandler` and inject it
2. Add `onSessionCleared` callback to `QueryOptionsInput`
3. Create SessionStart hooks in `createHooks()` and merge with existing hooks

```typescript
// In QueryOptionsInput:
export interface QueryOptionsInput {
  // ... existing fields
  /** Callback when /clear command resets the session (TASK_2025_181) */
  onSessionCleared?: SessionClearedCallback;
}

// In constructor:
constructor(
  // ... existing deps
  @inject(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER)
  private readonly sessionStartHookHandler: SessionStartHookHandler,
) {}

// In createHooks():
private createHooks(
  cwd: string,
  sessionId?: string,
  onCompactionStart?: CompactionStartCallback,
  onSessionCleared?: SessionClearedCallback  // NEW
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const subagentHooks = this.subagentHookHandler.createHooks(cwd);
  const compactionHooks = this.compactionHookHandler.createHooks(
    sessionId ?? '', onCompactionStart
  );
  // NEW: SessionStart hooks for /clear detection
  const sessionStartHooks = this.sessionStartHookHandler.createHooks(
    sessionId ?? '', onSessionCleared
  );

  const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    ...subagentHooks,
    ...compactionHooks,
    ...sessionStartHooks,
  };

  return mergedHooks;
}
```

4. Pass `onSessionCleared` through `build()` to `createHooks()`

**Changes to DI (`tokens.ts` and `register.ts`)**:

```typescript
// tokens.ts - add:
SDK_SESSION_START_HOOK_HANDLER: 'SdkSessionStartHookHandler',
  // register.ts - add:
  container.registerSingleton(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER, SessionStartHookHandler);
```

---

### Component 5: SessionLifecycleManager - onSessionCleared Callback Plumbing

**Purpose**: Pass the `onSessionCleared` callback from `executeQuery()` through to `SdkQueryOptionsBuilder`.

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (MODIFY)

**Changes to `ExecuteQueryConfig`**:

```typescript
export interface ExecuteQueryConfig {
  // ... existing fields
  /** Callback when /clear resets the session (TASK_2025_181) */
  onSessionCleared?: SessionClearedCallback;
}
```

**Changes to `executeQuery()`**:

```typescript
// Destructure new field
const { onSessionCleared, ...rest } = config;

// Pass to queryOptionsBuilder.build()
const queryOptions = await this.queryOptionsBuilder.build({
  // ... existing fields
  onSessionCleared,
});
```

---

### Component 6: ChatRpcHandlers - Wire onSessionCleared Callback

**Purpose**: When `/clear` is detected via the SessionStart hook, emit a `session_cleared` event to the frontend to reset the tab.

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (MODIFY)

**Changes**: In both `registerChatStart()` and `registerChatContinue()` (resume path), pass `onSessionCleared` callback to `startChatSession()` / `resumeSession()` which flows to `executeQuery()`:

```typescript
// In startChatSession config:
const stream = await this.sdkAdapter.startChatSession({
  // ... existing fields
  onSessionCleared: (data) => {
    this.logger.info('[RPC] Session cleared via /clear command', {
      sessionId: data.sessionId,
      newSessionId: data.newSessionId,
      tabId,
    });
    // Emit session_cleared event to frontend
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
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
      })
      .catch((err) => {
        this.logger.error('[RPC] Failed to broadcast session_cleared', err instanceof Error ? err : new Error(String(err)));
      });
  },
});
```

This requires plumbing `onSessionCleared` through `SdkAgentAdapter.startChatSession()` and `resumeSession()` to `SessionLifecycleManager.executeQuery()`.

**Additional Changes to `SdkAgentAdapter`**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)
- Add `onSessionCleared` to the config parameter of `startChatSession()` and `resumeSession()`
- Pass through to `executeQuery()` config

---

### Component 7: Frontend - session_cleared Event Type and Handler

**Purpose**: Add `session_cleared` event type to `FlatStreamEventUnion` and handle it in `StreamingHandlerService` to reset the tab.

**Pattern**: Follows `CompactionCompleteEvent` pattern
**Evidence**: `CompactionCompleteEvent` at execution-node.types.ts:931-937, handler at streaming-handler.service.ts:464-488

**Files Affected**:

- `libs/shared/src/lib/types/execution-node.types.ts` (MODIFY)
- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` (MODIFY)

**Changes to `execution-node.types.ts`**:

1. Add `'session_cleared'` to `FlatStreamEventType` union (around line 743):

```typescript
| 'session_cleared'
```

2. Add `SessionClearedEvent` interface (after `CompactionCompleteEvent`):

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

3. Add `SessionClearedEvent` to `FlatStreamEventUnion` (around line 1049):

```typescript
| SessionClearedEvent
```

4. Export `SessionClearedEvent` from the shared library barrel exports.

**Changes to `streaming-handler.service.ts`**:

Add a case for `'session_cleared'` in the `processStreamEvent()` switch statement, modeled after `compaction_complete`:

```typescript
case 'session_cleared': {
  // TASK_2025_181: /clear command processed by SDK
  // Reset streaming state, clear messages, and clear deduplication
  console.log(
    '[StreamingHandlerService] Session cleared via /clear command',
    { sessionId: event.sessionId, newSessionId: event.newSessionId }
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
  if (event.newSessionId) {
    this.tabManager.updateTab(targetTab.id, {
      claudeSessionId: event.newSessionId,
    });
    this.sessionManager.setSessionId(event.newSessionId);
  }

  return {
    tabId: targetTab.id,
    sessionCleared: true,
  };
}
```

Update the return type of `processStreamEvent()` to include `sessionCleared?`:

```typescript
processStreamEvent(...): {
  tabId: string;
  queuedContent?: string;
  compactionSessionId?: string;
  compactionComplete?: boolean;
  sessionCleared?: boolean;  // NEW
} | null {
```

---

## Risk Assessment

### Low Risk

1. **Deleting `expandPluginCommand`** - Straightforward removal. SDK handles plugin commands natively via `pluginPaths` configuration. Only risk: if any plugin command templates use `$ARGUMENTS` in a way the SDK doesn't replicate, but the SDK's native plugin system is the intended way.

2. **Adding SessionStart hook** - Follows the exact same pattern as `CompactionHookHandler`. Hook always returns `{ continue: true }` and never throws.

3. **Adding `session_cleared` event** - Follows `CompactionCompleteEvent` pattern exactly. The `assertNever` in `StreamingHandlerService` will catch if we miss the case.

### Medium Risk

4. **Changing prompt delivery to string** - The most impactful change. The current `AsyncIterable<SDKUserMessage>` flow is well-tested. Switching initial prompts to strings requires:

   - Calling `streamInput()` after query creation for follow-up message delivery
   - Ensuring the timing is correct (streamInput must be called before the first follow-up)
   - Race condition: what if a follow-up message is sent before `streamInput()` is called?

   **Mitigation**: The `preRegisterActiveSession()` + `messageQueue` pattern already handles this. Messages queued before `streamInput()` connects will be drained when the stream starts iterating.

5. **Updating SDK type definitions** - Changing `streamInput()` to accept `string | SDKUserMessage` and `QueryFunction` prompt type. If the actual SDK at runtime doesn't accept these types, it will fail silently or error.

   **Mitigation**: Test with actual SDK. If `streamInput()` rejects strings, we may need to keep SDKUserMessage for follow-ups and only fix the initial prompt (which already accepts string).

### High Risk

6. **Follow-up slash commands via AsyncIterable** - If the SDK's `streamInput()` does NOT accept plain strings at runtime (despite our type update), then follow-up slash commands (`/clear` in chat:continue for an already-active session) will still fail.

   **Mitigation**: If this is the case, we have two fallback strategies:

   - (a) For `/clear` specifically: detect it in `sendMessage()` and call `sdkQuery.interrupt()` followed by starting a new query with `prompt: "/clear"`. This is complex but works.
   - (b) Accept that follow-up built-in commands only work for the initial message, and document this limitation.

   **Recommendation**: Start with updating the types and testing at runtime. If it fails, implement fallback (a) for `/clear` and `/compact` only.

---

## Testing Strategy

### Unit Tests

1. **SessionLifecycleManager.executeQuery()** - Test that:

   - Plain text prompt results in string being passed to `query()`
   - Prompt with files results in `AsyncIterable<SDKUserMessage>` being passed to `query()`
   - `streamInput()` is called when prompt is a string

2. **SessionLifecycleManager.sendMessage()** - Test that:

   - Plain text message pushes raw string to messageQueue
   - Message with files pushes SDKUserMessage to messageQueue
   - Messages starting with `/` are pushed as strings (not SDKUserMessage)

3. **SessionStartHookHandler** - Test that:

   - Hook returns `{ continue: true }` always
   - Callback is invoked when `source === 'clear'`
   - Callback is NOT invoked for `source === 'startup'`, `'resume'`, `'compact'`
   - Hook doesn't throw even if callback throws

4. **SdkQueryOptionsBuilder** - Test that:
   - `promptIsString` is true when `initialPromptString` is provided
   - `promptIsString` is false when `initialPromptString` is not provided
   - SessionStart hooks are included in merged hooks

### Integration Tests

5. **End-to-end slash command flow**:

   - Send `/clear` as initial message in chat:start -> verify SDK receives string prompt
   - Send `/clear` as follow-up in chat:continue -> verify message queue receives string
   - Send `/orchestrate task` with plugins configured -> verify SDK processes command natively
   - Send regular text -> verify no behavioral change

6. **Frontend event handling**:
   - Verify `session_cleared` event resets tab messages to empty
   - Verify `session_cleared` event resets streaming state
   - Verify `session_cleared` event clears deduplication

### Manual Tests

7. Send `/clear` in an active session -> conversation should clear
8. Send `/compact` -> compaction should trigger
9. Send `/help` -> help text should appear
10. Send `/orchestrate` -> plugin command should execute
11. Send regular message with file attachment -> attachment should be included
12. Send regular message without attachment -> message should work normally

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary), with frontend-developer for Component 7

**Rationale**:

- 6 of 7 components are backend TypeScript changes (session lifecycle, SDK hooks, query options, type definitions)
- Component 7 (frontend event handling) is a small addition following established patterns
- A backend developer can handle the frontend changes given they follow the `compaction_complete` pattern exactly

### Complexity Assessment

**Complexity**: MEDIUM-HIGH
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Component 1 (String-based initial prompt): 1.5 hours - most complex, involves prompt/stream separation
- Component 2 (String-based follow-up messages): 1 hour - messageQueue type change + sendMessage logic
- Component 3 (Delete expandPluginCommand): 0.5 hours - straightforward removal
- Component 4 (SessionStart hook): 0.5 hours - follows CompactionHookHandler pattern
- Component 5 (Callback plumbing): 0.5 hours - pass-through additions
- Component 6 (Wire callback in ChatRpcHandlers): 0.5 hours - callback setup
- Component 7 (Frontend event type + handler): 0.5 hours - follows compaction_complete pattern

### Files Affected Summary

**CREATE**:

- `libs/backend/agent-sdk/src/lib/helpers/session-start-hook-handler.ts`

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts` (minor - reduced usage, no code changes needed)
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
- `libs/shared/src/lib/types/execution-node.types.ts`
- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

**DELETE** (methods only, not files):

- `expandPluginCommand` method from chat-rpc.handlers.ts

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **SDK runtime behavior**: Test that `query({ prompt: "/clear" })` actually triggers the SessionStart hook with `source: 'clear'`. This is the core assumption.

2. **streamInput accepts strings**: Test at runtime that `sdkQuery.streamInput(asyncIterable)` works when the iterable yields plain strings alongside SDKUserMessage objects. If it doesn't, fall back to SDKUserMessage-only for follow-ups.

3. **All imports verified**:

   - `isSessionStartHook` from claude-sdk.types.ts:1391
   - `SessionStartHookInput` from claude-sdk.types.ts:1267
   - `HookEvent`, `HookCallbackMatcher`, `HookJSONOutput`, `HookInput` from claude-sdk.types.ts
   - `CompactionHookHandler` pattern from compaction-hook-handler.ts

4. **assertNever exhaustiveness**: After adding `'session_cleared'` to `FlatStreamEventUnion`, the `assertNever` default case in `StreamingHandlerService.processStreamEvent()` will cause a TypeScript compile error until the case is handled. This is by design.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (CompactionHookHandler, FlatStreamEventUnion, QueryFunction)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined per component
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Risk assessment with mitigations
- [x] Testing strategy defined
