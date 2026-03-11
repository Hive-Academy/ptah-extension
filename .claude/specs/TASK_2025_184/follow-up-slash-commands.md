# TASK_2025_184: Follow-Up Slash Command Support

## Problem Statement

Slash commands (e.g., `/compact`, `/ptah-core:orchestrate`) only work as the **first message** in a new session. They do NOT work as follow-up messages in an ongoing conversation. This is because the Claude Agent SDK only parses slash commands from the raw `string` prompt passed to `query()`, not from `SDKUserMessage` objects delivered via `streamInput()`.

**Current behavior:**

- User starts session with `/ptah-core:orchestrate` → Works (raw string prompt)
- User sends "Hello", then later sends `/compact` → BROKEN (sent as literal text)

**Expected behavior (like Claude CLI):**

- Slash commands work at any point in the conversation

## Root Cause: SDK Architecture Constraint

The SDK has a fundamental limitation:

| Input Method                                       | Slash Command Parsing | Use Case               |
| -------------------------------------------------- | --------------------- | ---------------------- |
| `query({ prompt: "/compact" })`                    | YES                   | Initial message only   |
| `query({ prompt: AsyncIterable<SDKUserMessage> })` | NO                    | Multi-message sessions |
| `sdkQuery.streamInput(iterable)`                   | NO                    | Follow-up messages     |

There is **no** `executeCommand()` or `sendCommand()` method on the `Query` interface. The only way to trigger command parsing is via the initial `string` prompt.

### SDK Non-Interactive Command Availability

Commands that work in SDK mode (`supportsNonInteractive: true`):

- `/compact` — Compact conversation to reduce token usage
- `/context` — Monitor token usage
- `/cost` — Show API cost estimates
- `/release-notes` — Show release notes
- All plugin commands (type: `prompt`) — e.g., `/ptah-core:orchestrate`
- All custom commands (`.claude/commands/*.md`)

Commands that do NOT work in SDK mode:

- `/clear`, `/color`, `/copy`, `/keybindings`, `/rename`, `/install-slack-app`

## Proposed Solution: Application-Level Command Interception

Since the SDK can't parse follow-up commands, we intercept them at the application level and either:

1. **Start a new SDK query** for the command (transparent to the user)
2. **Handle the command natively** without the SDK (for simple commands)

### Architecture

```
User sends "/compact" as follow-up
       |
       v
[Frontend: ChatInputComponent]
  → Detects slash command
  → Sends to backend via RPC
       |
       v
[Backend: ChatRpcHandlers]
  → Intercepts slash command BEFORE sending to SDK
  → Routes to SlashCommandInterceptor
       |
       v
[SlashCommandInterceptor]
  → Matches command against known handlers
  → Dispatches to appropriate handler
       |
       +--→ [SDK Command Handler] — for /compact, /review, plugin commands
       |     → Ends current session gracefully
       |     → Starts new query({ prompt: "/compact", options: { resume: sessionId } })
       |     → Reconnects stream to frontend
       |
       +--→ [Native Command Handler] — for /clear, /context, /cost
             → Handles locally without SDK
             → /clear → reset frontend state, start new session
             → /context → read token stats from session metadata
             → /cost → read cost from session metadata
```

### Implementation Plan

#### Phase 1: Command Interception Layer

**New file:** `libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts`

```typescript
export interface SlashCommandResult {
  handled: boolean;
  action: 'new-query' | 'native' | 'passthrough';
  commandName?: string;
  args?: string;
}

@injectable()
export class SlashCommandInterceptor {
  /**
   * Parse and classify a potential slash command.
   * Returns handling instructions for the caller.
   */
  intercept(content: string, sessionId: SessionId): SlashCommandResult {
    if (!/^\/[a-zA-Z]/.test(content.trim())) {
      return { handled: false, action: 'passthrough' };
    }

    const { commandName, args } = this.parseCommand(content);

    // Commands we handle natively (don't need SDK)
    if (this.isNativeCommand(commandName)) {
      return { handled: true, action: 'native', commandName, args };
    }

    // SDK commands — need a new query to parse them
    return { handled: true, action: 'new-query', commandName, args };
  }

  private parseCommand(content: string): { commandName: string; args: string } {
    const trimmed = content.trim();
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      return { commandName: trimmed.slice(1), args: '' };
    }
    return {
      commandName: trimmed.slice(1, spaceIndex),
      args: trimmed.slice(spaceIndex + 1).trim(),
    };
  }

  private isNativeCommand(name: string): boolean {
    return ['clear', 'context', 'cost'].includes(name);
  }
}
```

#### Phase 2: New Query for SDK Commands

When a follow-up slash command needs SDK processing (e.g., `/compact`, `/ptah-core:orchestrate`):

**Modified:** `chat-rpc.handlers.ts` — `registerChatContinue` handler

```typescript
// In the chat:continue RPC handler:
const interceptResult = this.commandInterceptor.intercept(prompt, sessionId);

if (interceptResult.action === 'new-query') {
  // End current query gracefully (don't destroy session)
  await this.sdkAdapter.interruptCurrentQuery(sessionId);

  // Start a new query with the command as a string prompt
  // The SDK will parse the slash command and execute it
  // Use resume: sessionId to maintain conversation context
  const stream = await this.sdkAdapter.executeSlashCommand(sessionId, prompt);

  // Reconnect the stream to the frontend (same tabId, same sessionId)
  await this.streamFlatEvents(stream, tabId, sessionId);
  return;
}

if (interceptResult.action === 'native') {
  await this.handleNativeCommand(interceptResult, sessionId, tabId);
  return;
}

// Default: send as regular message
await this.sdkAdapter.sendMessageToSession(sessionId, prompt, options);
```

#### Phase 3: SdkAgentAdapter Methods

**Modified:** `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

```typescript
/**
 * Execute a slash command within an existing session.
 * Starts a new SDK query with the command as a string prompt,
 * resuming the existing session to maintain conversation context.
 */
async executeSlashCommand(
  sessionId: SessionId,
  command: string
): Promise<AsyncIterable<FlatStreamEventUnion>> {
  // The session's conversation history is preserved via SDK's native
  // session resumption. The command string is passed as the prompt,
  // which the SDK will parse for slash commands.
  return this.sessionLifecycle.executeSlashCommandQuery(sessionId, command);
}
```

#### Phase 4: SessionLifecycleManager Method

**Modified:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

```typescript
/**
 * Execute a slash command as a new query within an existing session.
 *
 * This works by:
 * 1. Interrupting the current query (if running)
 * 2. Starting a new query with resume: sessionId
 * 3. Passing the command as a raw string prompt (SDK parses it)
 * 4. Connecting streamInput for subsequent follow-up messages
 */
async executeSlashCommandQuery(
  sessionId: SessionId,
  command: string
): Promise<ExecuteQueryResult> {
  // Interrupt existing query
  await this.interruptSession(sessionId);

  // Re-execute with the command as string prompt
  return this.executeQuery({
    sessionId,
    resumeSessionId: sessionId as string, // Resume same session
    initialPrompt: { content: command, files: [], images: [] },
    // ... other config from the existing session
  });
}
```

The key insight: `executeQuery` already handles slash commands correctly for new sessions (passes string prompt when `isSlashCommand=true`). We just need to allow this path for existing sessions too via resume.

#### Phase 5: Native Command Handlers

**New file:** `libs/backend/agent-sdk/src/lib/helpers/native-command-handlers.ts`

```typescript
@injectable()
export class NativeCommandHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager
  ) {}

  async handleClear(sessionId: SessionId): Promise<void> {
    // End the current session, frontend will start a new one
    await this.sessionLifecycle.endSession(sessionId);
  }

  async handleContext(sessionId: SessionId): Promise<TokenUsageInfo> {
    // Read from session metadata — no SDK call needed
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    return {
      inputTokens: session?.stats?.inputTokens ?? 0,
      outputTokens: session?.stats?.outputTokens ?? 0,
      // ...
    };
  }

  async handleCost(sessionId: SessionId): Promise<CostInfo> {
    // Read from session metadata
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    return {
      totalCost: session?.stats?.totalCost ?? 0,
      // ...
    };
  }
}
```

### Affected Files

| File                                                                        | Change                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts`       | NEW — Command parsing and routing                   |
| `libs/backend/agent-sdk/src/lib/helpers/native-command-handlers.ts`         | NEW — Handlers for /clear, /context, /cost          |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                       | ADD `executeSlashCommand()` method                  |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`       | ADD `executeSlashCommandQuery()` method             |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | MODIFY `registerChatContinue` to intercept commands |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                               | ADD tokens for new services                         |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                             | REGISTER new services                               |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`                           | EXPORT new services                                 |

### Edge Cases

| Scenario                              | Handling                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `/compact` as follow-up               | Intercept → new query with resume → SDK executes compact       |
| `/ptah-core:orchestrate` as follow-up | Intercept → new query with resume → SDK loads plugin command   |
| `/clear` as follow-up                 | Native handler → end session → frontend starts new             |
| `/unknown-command` as follow-up       | New query → SDK reports unknown command in response            |
| Command while agent is thinking       | Interrupt current execution first, then execute command        |
| Command with file attachments         | Treat as regular message (can't combine files + string prompt) |
| Rapid command spam                    | Queue commands, process sequentially                           |

### Frontend Changes

The frontend needs no changes — commands are intercepted at the RPC handler level. The chat input already passes commands through as-is (the `normalizeSlashCommand` dead code was removed).

The only frontend consideration: after a `/clear` native command, the backend should send a `CHAT_ERROR` or `SESSION_ENDED` message so the frontend can reset its state and prompt the user to start a new session.

### Testing Strategy

1. **Unit tests for SlashCommandInterceptor**: Verify parsing, classification, and edge cases
2. **Unit tests for NativeCommandHandlers**: Verify /clear, /context, /cost behavior
3. **Integration test**: Send `/compact` as follow-up, verify new query is started with resume
4. **Integration test**: Send `/ptah-core:orchestrate` as follow-up, verify plugin command executes
5. **Integration test**: Send `/clear` as follow-up, verify session ends cleanly

### Risks and Mitigations

| Risk                               | Mitigation                                                            |
| ---------------------------------- | --------------------------------------------------------------------- |
| New query interrupts mid-response  | Only intercept commands when session is idle (not actively streaming) |
| Resume session loses context       | SDK resumes from JSONL file, all history preserved                    |
| streamInput on new query conflicts | Previous query's streamInput is aborted via AbortController           |
| Command execution latency          | New query has SDK startup overhead (~50-100ms) — acceptable           |

### Dependencies

- Current implementation of `executeQuery()` with `isSlashCommand` string prompt path
- SDK's session resumption via `resume` option in `query()`
- AbortController-based session interruption

### Success Criteria

- [ ] User can send `/compact` at any point in a conversation and it executes
- [ ] User can send `/ptah-core:orchestrate` as a follow-up and the plugin command runs
- [ ] User can send `/clear` to reset the session at any time
- [ ] Regular messages after a command continue working normally
- [ ] No data loss (conversation history preserved across command execution)
- [ ] No visible interruption to the user (seamless transition)
