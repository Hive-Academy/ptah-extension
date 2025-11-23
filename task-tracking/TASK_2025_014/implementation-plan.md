# Implementation Plan - TASK_2025_014

## Executive Summary

This refactoring eliminates architectural complexity by migrating from a dual-storage system to a single source of truth. We will remove SessionManager's in-memory storage, use Claude CLI .jsonl files directly, normalize all message formats to `contentBlocks: Array`, eliminate duplicate event emissions, and fix chunk handling issues.

**Core Principle**: **SIMPLIFICATION** - One storage system, one message format, one event per action.

**Impact**: 7x message duplication eliminated, frozen chunk rendering fixed, type safety improved, complexity reduced by ~40%.

---

## Current Architecture (Problems)

### Problem 1: Dual Storage System

```
┌─────────────────────────────────────────────────────────┐
│  CURRENT STATE (BROKEN)                                  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  SessionManager                   Claude CLI             │
│  ┌─────────────────┐             ┌──────────────┐      │
│  │ In-Memory Map   │             │ .jsonl files │      │
│  │ <SessionId,     │             │ (actual data)│      │
│  │  ChatSession>   │             └──────────────┘      │
│  └─────────────────┘                     ▲              │
│         │                                 │              │
│         │                                 │              │
│         ▼                                 │              │
│  ┌─────────────────┐                     │              │
│  │ VS Code State   │                     │              │
│  │ workspace.state │                     │              │
│  └─────────────────┘                     │              │
│         │                                 │              │
│         └─────────CONFLICT────────────────┘              │
│                                                           │
│  ❌ Two sources of truth                                 │
│  ❌ Sync issues between systems                          │
│  ❌ Message format inconsistency (content vs contentBlocks) │
│  ❌ Duplicate event emissions (7x message rendering)     │
└─────────────────────────────────────────────────────────┘
```

### Problem 2: Message Format Inconsistency

**From context.md (lines 14-32)**:

```typescript
// Claude CLI Actual Format (from .jsonl files)
{"role":"user","content":"simple string"}                           // Format A: String
{"role":"user","content":[{"type":"text","text":"..."}]}            // Format B: Array

// SessionManager Creates
contentBlocks: [{type:'text',text}]  // ✅ CORRECT

// ChatValidationService Expects
content: string  // ❌ WRONG (line 124)

// MessageProcessingService Assumes
contentBlocks.map()  // ❌ CRASHES on null (line 176)

// Result: Old messages (content: string) crash UI
```

### Problem 3: Duplicate Event Emissions

**From log analysis (vscode-app-1763677356626.log lines 72-133)**:

```
chat:sessionInit         → emitted 2x (lines 91, 94)
chat:sessionEnd          → emitted 2x (lines 118, 121)
chat:messageComplete     → emitted 2x (lines 114, 128)
chat:messageAdded        → emitted AFTER streaming (line 123) - duplicates chunks!
chat:tokenUsageUpdated   → emitted 3x (lines 76, 117, 124)

Result: Message rendered 7+ times in UI
```

### Problem 4: Chunk Handling Issues

**From chat.service.ts analysis**:

```typescript
// chatState.setClaudeMessages() called in 3 DIFFERENT places:
Line 540  // onMessageChunk handler
Line 656  // onMessageComplete handler
Line 805  // onSessionInit handler

// Result: Same message added multiple times, no deduplication at UI layer
```

---

## Target Architecture (Solution)

```
┌─────────────────────────────────────────────────────────┐
│  TARGET STATE (SIMPLIFIED)                               │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  SessionManager                   Claude CLI             │
│  ┌─────────────────┐             ┌──────────────┐      │
│  │ REMOVED         │             │ .jsonl files │      │
│  │ (no in-memory)  │             │ (ONLY source)│      │
│  │                 │             └──────────────┘      │
│  │ Only tracks:    │                     ▲              │
│  │ - currentId     │                     │              │
│  └─────────────────┘                     │              │
│         │                                 │              │
│         └─────────READ ONLY───────────────┘              │
│                                                           │
│  SessionProxy (Enhanced)          MessageNormalizer      │
│  ┌─────────────────┐             ┌──────────────┐      │
│  │ Parse .jsonl    │────────────▶│ Normalize    │      │
│  │ Get messages    │             │ to content-  │      │
│  │ Stream read     │             │ Blocks       │      │
│  └─────────────────┘             └──────────────┘      │
│                                                           │
│  ✅ Single source of truth (.jsonl files)                │
│  ✅ Consistent message format (contentBlocks)            │
│  ✅ Single event emission per action                     │
│  ✅ No chunk duplication                                 │
└─────────────────────────────────────────────────────────┘
```

---

## Component Designs

### A. JsonlSessionParser Enhancement

**Current State** (jsonl-session-parser.ts:1-289):

- Only extracts METADATA (name, timestamp, count)
- Does NOT parse full messages
- Used only for session list display

**Target State**:

- Parse full message history from .jsonl files
- Handle both `content: string` and `content: Array` formats
- Normalize to `contentBlocks: Array` via MessageNormalizer
- Streaming read optimization (readline, not full file load)

**New Method**:

```typescript
/**
 * Parse all messages from JSONL file with normalization
 *
 * Performance: Streaming read (< 1s for 1000 messages)
 * Memory: Efficient (readline, not full file load)
 *
 * @param filePath - Absolute path to .jsonl file
 * @returns Array of StrictChatMessage with normalized contentBlocks
 */
static async parseSessionMessages(
  filePath: string
): Promise<StrictChatMessage[]> {
  const messages: StrictChatMessage[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;

      const jsonlLine = JSON.parse(line);

      // Skip non-message lines (summary, file-history-snapshot)
      if (jsonlLine.type && jsonlLine.type !== 'user' && jsonlLine.type !== 'assistant') {
        continue;
      }

      // Extract message from JSONL structure
      const message = jsonlLine.message || jsonlLine;

      // Normalize content format
      const normalized = MessageNormalizer.normalize(message);

      messages.push({
        id: MessageId.create(), // Generate ID from uuid or create new
        sessionId: SessionId.create(), // Extract from filePath
        type: message.role as 'user' | 'assistant',
        contentBlocks: normalized.contentBlocks,
        timestamp: new Date(jsonlLine.timestamp).getTime(),
        files: jsonlLine.message?.files,
        streaming: false,
        isComplete: true,
      });
    }

    return messages;
  } finally {
    reader.close();
    stream.destroy();
  }
}
```

**Evidence**:

- Pattern source: jsonl-session-parser.ts:139-158 (readFirstLine streaming pattern)
- JSONL format: context.md:16-22 (example .jsonl structure)

### B. SessionProxy Enhancement

**Current State** (session-proxy.ts:91-100):

- `getSessionDetails()` reads .jsonl files but only returns raw data
- No message parsing logic
- No normalization layer

**Target State**:

- Add `getSessionMessages(sessionId): StrictChatMessage[]` method
- Read from .jsonl, parse via JsonlSessionParser
- Apply normalization layer (MessageNormalizer)
- Cache strategy (optional LRU cache for performance)

**New Method**:

```typescript
/**
 * Get all messages for a session (normalized format)
 *
 * Reads .jsonl file, parses messages, normalizes to contentBlocks format
 *
 * Performance: < 1s for sessions with 1000 messages (streaming read)
 * Cache: Optional LRU cache (future enhancement)
 *
 * @param sessionId - Session ID (filename without .jsonl)
 * @param workspaceRoot - Optional workspace root
 * @returns Array of normalized StrictChatMessage
 *
 * @example
 * const messages = await sessionProxy.getSessionMessages(sessionId);
 * // All messages have contentBlocks: Array format
 */
async getSessionMessages(
  sessionId: SessionId,
  workspaceRoot?: string
): Promise<StrictChatMessage[]> {
  try {
    const sessionsDir = this.getSessionsDirectory(workspaceRoot);
    const filePath = path.join(sessionsDir, `${sessionId}.jsonl`);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist - return empty array (not an error)
      return [];
    }

    // Parse messages from .jsonl with normalization
    const messages = await JsonlSessionParser.parseSessionMessages(filePath);

    // Update sessionId for all messages (extracted from filename)
    return messages.map(msg => ({
      ...msg,
      sessionId: sessionId as SessionId,
    }));
  } catch (error) {
    console.error(`SessionProxy.getSessionMessages failed for ${sessionId}:`, error);
    return []; // Graceful degradation
  }
}
```

**Evidence**:

- Pattern source: session-proxy.ts:59-89 (listSessions method structure)
- Error handling: session-proxy.ts:84-88 (graceful degradation pattern)

### C. SessionManager Refactoring

**Current State** (session-manager.ts:140-155):

- Maintains in-memory `Map<SessionId, StrictChatSession>`
- Persists to VS Code workspace state
- Duplicates Claude CLI storage

**Target State**:

- Remove in-memory `Map<SessionId, StrictChatSession>`
- Remove VS Code workspace state persistence
- Delegate all reads to SessionProxy
- Only track current session ID (pointer)

**Refactored Class**:

```typescript
/**
 * SessionManager - Simplified session coordinator
 *
 * REFACTORED: No longer maintains in-memory storage
 * Delegates to SessionProxy (reads .jsonl files)
 * Only tracks current session ID
 */
@injectable()
export class SessionManager {
  // REMOVED: private sessions: Map<SessionId, StrictChatSession> = new Map();
  // REMOVED: VS Code workspace state persistence

  // KEEP: Current session tracking only
  private currentSessionId?: SessionId;

  constructor(@inject(TOKENS.EVENT_BUS) private readonly eventBus: IEventBus, @inject(TOKENS.SESSION_PROXY) private readonly sessionProxy: SessionProxy) {
    // No loadSessions() - read from .jsonl on demand
  }

  /**
   * Get current active session (reads from .jsonl)
   */
  async getCurrentSession(): Promise<StrictChatSession | null> {
    if (!this.currentSessionId) {
      return null;
    }

    // Read from SessionProxy (single source of truth)
    const sessionSummary = await this.sessionProxy.getSessionById(this.currentSessionId);
    if (!sessionSummary) {
      return null;
    }

    // Get messages from .jsonl (normalized)
    const messages = await this.sessionProxy.getSessionMessages(this.currentSessionId);

    return {
      id: this.currentSessionId,
      name: sessionSummary.name,
      workspaceId: sessionSummary.workspaceId,
      messages, // From .jsonl (contentBlocks format)
      createdAt: sessionSummary.createdAt,
      lastActiveAt: sessionSummary.lastActiveAt,
      updatedAt: sessionSummary.lastActiveAt,
      messageCount: messages.length,
      tokenUsage: this.calculateTokenUsage(messages),
    };
  }

  /**
   * Get all sessions (reads from .jsonl directory)
   */
  async getAllSessions(): Promise<StrictChatSession[]> {
    const summaries = await this.sessionProxy.listSessions();

    // Convert summaries to full sessions (without messages for performance)
    return summaries.map((summary) => ({
      id: summary.id,
      name: summary.name,
      workspaceId: summary.workspaceId,
      messages: [], // Don't load all messages for session list (performance)
      createdAt: summary.createdAt,
      lastActiveAt: summary.lastActiveAt,
      updatedAt: summary.lastActiveAt,
      messageCount: summary.messageCount,
      tokenUsage: {
        input: 0,
        output: 0,
        total: 0,
        percentage: 0,
        maxTokens: 200000,
      },
    }));
  }

  /**
   * Switch to a different session
   */
  async switchToSession(sessionId: SessionId): Promise<void> {
    // Verify session exists
    const session = await this.sessionProxy.getSessionById(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const previousSessionId = this.currentSessionId;
    this.currentSessionId = sessionId;

    // Emit events (SINGLE emission - no duplicates)
    if (previousSessionId) {
      this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_END, {
        sessionId: previousSessionId,
      });
    }

    this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_INIT, {
      sessionId,
    });
  }

  // REMOVED: addUserMessage(), addAssistantMessage()
  // Messages are written directly to .jsonl by Claude CLI
  // Frontend only READS messages via SessionProxy

  // REMOVED: saveSessions() - no in-memory state to persist
  // REMOVED: loadSessions() - read from .jsonl on demand
}
```

**Evidence**:

- Current structure: session-manager.ts:140-155 (in-memory Map)
- Event patterns: session-manager.ts:197-198 (single event emission)

### D. Message Normalization Layer

**Purpose**: Convert legacy `content: string` messages to `contentBlocks: Array` format

**New Utility Class**:

```typescript
/**
 * MessageNormalizer - Convert all message formats to contentBlocks
 *
 * Handles:
 * - content: string → contentBlocks: [{type:'text',text}]
 * - content: Array → contentBlocks: Array (map types)
 * - Edge cases: empty, malformed, tool_use, thinking blocks
 *
 * Location: libs/shared/src/lib/utils/message-normalizer.ts
 */
export class MessageNormalizer {
  /**
   * Normalize any message format to contentBlocks: Array
   *
   * @param message - Message with content: string OR content: Array
   * @returns Normalized message with contentBlocks: Array
   */
  static normalize(message: { role: string; content: string | unknown[] }): {
    contentBlocks: ContentBlock[];
  } {
    // Case 1: String content (legacy format)
    if (typeof message.content === 'string') {
      return {
        contentBlocks: [
          {
            type: 'text',
            text: message.content,
          },
        ],
      };
    }

    // Case 2: Array content (Claude CLI format)
    if (Array.isArray(message.content)) {
      return {
        contentBlocks: message.content.map((block) => this.normalizeContentBlock(block)),
      };
    }

    // Case 3: Empty/null/undefined content
    return {
      contentBlocks: [
        {
          type: 'text',
          text: '',
        },
      ],
    };
  }

  /**
   * Normalize individual content block
   *
   * Maps Claude API types to our ContentBlock union
   */
  private static normalizeContentBlock(block: unknown): ContentBlock {
    if (!block || typeof block !== 'object') {
      return { type: 'text', text: '' };
    }

    const obj = block as Record<string, unknown>;

    // Text block
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return { type: 'text', text: obj.text };
    }

    // Tool use block
    if (obj.type === 'tool_use') {
      return {
        type: 'tool_use',
        id: String(obj.id || ''),
        name: String(obj.name || ''),
        input: obj.input as Record<string, unknown>,
      };
    }

    // Thinking block
    if (obj.type === 'thinking' && typeof obj.thinking === 'string') {
      return { type: 'thinking', thinking: obj.thinking };
    }

    // Tool result block
    if (obj.type === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: String(obj.tool_use_id || ''),
        content: String(obj.content || ''),
        is_error: Boolean(obj.is_error),
      };
    }

    // Unknown type - default to text
    return { type: 'text', text: JSON.stringify(block) };
  }

  /**
   * Validate contentBlocks structure (defensive check)
   */
  static isValidContentBlocks(contentBlocks: unknown): contentBlocks is ContentBlock[] {
    if (!Array.isArray(contentBlocks)) {
      return false;
    }

    return contentBlocks.every((block) => block && typeof block === 'object' && 'type' in block && typeof block.type === 'string');
  }
}
```

**Evidence**:

- Content format examples: context.md:16-22 (Claude CLI formats)
- Current crash point: message-processing.service.ts:176 (contentBlocks.map without null check)

### E. Event Publisher Cleanup

**Current State**: Duplicate emissions causing 7x rendering

**Root Causes** (from context.md:35-45):

- `chat:sessionInit` emitted 2x
- `chat:sessionEnd` emitted 2x
- `chat:messageComplete` emitted 2x
- `chat:messageAdded` emitted AFTER streaming (duplicates chunks)
- `chat:tokenUsageUpdated` emitted 3x

**Target State**: Single emission per event type

**Changes Required**:

1. **SessionManager.switchToSession()** (refactored above):

   - Emit `sessionEnd` once (if previous session exists)
   - Emit `sessionInit` once (for new session)

2. **ChatOrchestrationService** (message-handler.service.ts):

   - Remove duplicate `sessionInit` emission
   - Remove duplicate `sessionEnd` emission

3. **Message Streaming**:

   - Emit `messageChunk` during streaming ✅ KEEP
   - Emit `messageComplete` when streaming ends ✅ KEEP
   - Remove `messageAdded` emission after streaming ❌ REMOVE (already sent via chunks)

4. **Token Usage**:
   - Emit `tokenUsageUpdated` ONCE per message completion
   - Remove duplicate emissions from SessionManager

**Implementation Strategy**:

```typescript
// BEFORE (in chat-orchestration.service.ts or message-handler.service.ts)
this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_INIT, { sessionId }); // Emission 1
// ... later ...
this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_INIT, { sessionId }); // Emission 2 ❌ DUPLICATE

// AFTER
this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_INIT, { sessionId }); // Single emission ✅

// SEARCH for duplicate emissions:
// Grep("publish.*SESSION_INIT" in libs/backend/claude-domain)
// Grep("publish.*MESSAGE_ADDED" in libs/backend/claude-domain)
```

**Verification**:

- Audit all `eventBus.publish()` calls in claude-domain
- Ensure each event type emitted exactly once per action
- Log event emissions during testing (count per event type)

**Evidence**:

- Duplicate events: context.md:35-45 (log analysis)
- Event emission: session-manager.ts:197-198, 420-429, 481-489

### F. Frontend State Management

**Current State** (chat.service.ts):

- `chatState.setClaudeMessages()` called in 3 places (lines 540, 656, 805)
- No deduplication at state layer
- Results in duplicate rendering

**Target State**: Single entry point for message updates

**Refactored Pattern**:

```typescript
// In chat.service.ts

// REMOVE duplicate calls:
// Line 540: onMessageChunk → REMOVE setClaudeMessages (chunks handled separately)
// Line 656: onMessageComplete → KEEP setClaudeMessages (final state update)
// Line 805: onSessionInit → KEEP setClaudeMessages (load session messages)

// ADD deduplication at state layer:
private updateMessages(messages: ProcessedClaudeMessage[]) {
  const existing = this.chatState.claudeMessages();

  // Deduplicate by message ID
  const deduped = this.deduplicateMessages(existing, messages);

  this.chatState.setClaudeMessages(deduped);
}

private deduplicateMessages(
  existing: ProcessedClaudeMessage[],
  incoming: ProcessedClaudeMessage[]
): ProcessedClaudeMessage[] {
  const messageMap = new Map<MessageId, ProcessedClaudeMessage>();

  // Add existing messages
  existing.forEach(msg => messageMap.set(msg.id, msg));

  // Overwrite with incoming (newer data)
  incoming.forEach(msg => messageMap.set(msg.id, msg));

  return Array.from(messageMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );
}

// Update event handlers:
private setupEventHandlers() {
  // Chunks: Update streaming state only, not message list
  this.vscode.onMessageType('chat:messageChunk').subscribe((payload) => {
    // Update streaming chunk display (separate from message list)
    // DO NOT call setClaudeMessages here
  });

  // Complete: Update message list with final message
  this.vscode.onMessageType('chat:messageComplete').subscribe((payload) => {
    const messages = this.chatState.claudeMessages();
    messages.push(payload.message); // Add completed message
    this.updateMessages(messages); // Deduplicated update
  });

  // Session init: Load all session messages
  this.vscode.onMessageType('chat:sessionInit').subscribe(async (payload) => {
    // Fetch messages from backend (via SessionProxy)
    const messages = await this.fetchSessionMessages(payload.sessionId);
    this.updateMessages(messages); // Deduplicated update
  });
}
```

**Evidence**:

- Current duplicate calls: context.md:47-52 (chat.service.ts analysis)
- Deduplication added: context.md:52 (service layer deduplication exists but insufficient)

### G. Validation Updates

**Current State** (chat-validation.service.ts:124):

- Expects `content: string` format
- Rejects `contentBlocks: Array` format
- Causes validation errors for new messages

**Target State**: Accept `contentBlocks: Array` format

**Updated Validation**:

```typescript
// In chat-validation.service.ts

validateChatMessage(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    errors.push('Message must be an object');
    return { isValid: false, errors, warnings };
  }

  const chatMsg = data as Record<string, unknown>;

  // Validate required fields
  if (!chatMsg['id'] || typeof chatMsg['id'] !== 'string') {
    errors.push('Message ID is required and must be a string');
  }

  if (!chatMsg['sessionId'] || typeof chatMsg['sessionId'] !== 'string') {
    errors.push('Session ID is required and must be a string');
  }

  if (
    !chatMsg['type'] ||
    !['user', 'assistant', 'system'].includes(chatMsg['type'] as string)
  ) {
    errors.push('Type is required and must be user, assistant, or system');
  }

  // Validate content based on type
  const msgType = chatMsg['type'] as string;
  if (msgType === 'user' || msgType === 'assistant') {
    // UPDATED: Accept contentBlocks: Array (NEW FORMAT)
    if (chatMsg['contentBlocks']) {
      // Validate contentBlocks structure
      if (!Array.isArray(chatMsg['contentBlocks'])) {
        errors.push('contentBlocks must be an array');
      } else if (chatMsg['contentBlocks'].length === 0) {
        warnings.push('contentBlocks array is empty');
      }
    }
    // DEPRECATED: Accept content: string (LEGACY FORMAT - for backward compatibility)
    else if (chatMsg['content']) {
      if (typeof chatMsg['content'] !== 'string') {
        errors.push('content must be a string (legacy format)');
      }
      warnings.push('Using legacy content format - migrate to contentBlocks');
    }
    // NEITHER format present
    else {
      errors.push('Either contentBlocks or content is required');
    }
  }

  // Validate timestamps
  if (
    chatMsg['timestamp'] !== undefined &&
    typeof chatMsg['timestamp'] !== 'number'
  ) {
    warnings.push('Timestamp should be a number');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
```

**Evidence**:

- Current validation: chat-validation.service.ts:124 (expects content: string)
- Context: context.md:27 (validation rejects contentBlocks)

### H. Message Processing Defensive Checks

**Current State** (message-processing.service.ts:176):

- `contentBlocks.map()` without null check
- Crashes on old messages with `content: string`

**Target State**: Defensive null checks, normalization fallback

**Updated Processing**:

```typescript
// In message-processing.service.ts

convertToProcessedMessage(
  strictMessage: StrictChatMessage
): ProcessedClaudeMessage {
  const tokenUsage = strictMessage.metadata?.['tokenUsage'] as
    | { input: number; output: number; total: number }
    | undefined;

  // DEFENSIVE: Ensure contentBlocks exists and is array
  const contentBlocks = strictMessage.contentBlocks || [];

  // DEFENSIVE: If contentBlocks is empty, try to normalize from legacy content field
  if (contentBlocks.length === 0 && strictMessage.content) {
    // Legacy message with content: string
    const normalized = MessageNormalizer.normalize({
      role: strictMessage.type,
      content: strictMessage.content,
    });
    contentBlocks = normalized.contentBlocks;
  }

  return {
    id: strictMessage.id,
    sessionId: strictMessage.sessionId,
    timestamp: strictMessage.timestamp,
    type: strictMessage.type,
    content: contentBlocks.map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      } else if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      } else if (block.type === 'thinking') {
        return { type: 'thinking', text: block.thinking };
      } else if (block.type === 'tool_result') {
        const contentString =
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: contentString,
          is_error: block.is_error,
        };
      } else {
        return { type: 'text', text: '' };
      }
    }),
    isComplete: strictMessage.isComplete,
    isStreaming: strictMessage.streaming,
    filePaths: strictMessage.files as string[] | undefined,
    tokenUsage: tokenUsage
      ? {
          input: tokenUsage.input,
          output: tokenUsage.output,
          total: tokenUsage.total,
        }
      : undefined,
  };
}
```

**Evidence**:

- Current crash: message-processing.service.ts:176 (contentBlocks.map without check)
- Context: context.md:28-29 (crashes on old messages)

---

## Data Migration Strategy

**Key Insight**: No actual data migration needed!

**Why**:

- Claude CLI .jsonl files already exist (canonical source)
- Migration is READ logic only (parse .jsonl correctly)
- Old SessionManager data (VS Code workspace state) will be ignored/deprecated

**Migration Steps**:

1. **Phase 1**: Add .jsonl reading capability (additive, no breaking changes)

   - Implement JsonlSessionParser.parseSessionMessages()
   - Implement SessionProxy.getSessionMessages()
   - Implement MessageNormalizer utility
   - Test with existing .jsonl files

2. **Phase 2**: Update consumers to use new capabilities

   - Update SessionManager to delegate to SessionProxy
   - Update frontend to request messages from backend
   - Add defensive checks in validation/processing

3. **Phase 3**: Remove old code (breaking changes)

   - Remove SessionManager in-memory Map
   - Remove VS Code workspace state persistence
   - Remove addUserMessage(), addAssistantMessage() methods

4. **Phase 4**: Cleanup and optimization
   - Add LRU cache for recently accessed sessions (optional)
   - Performance benchmarks
   - Remove deprecated code paths

**Graceful Handling of Old Data**:

```typescript
// Warn users if old SessionManager data found in workspace state
async migrateWorkspaceState() {
  const oldSessions = this.storage.get<StrictChatSession[]>(SESSIONS_KEY);

  if (oldSessions && oldSessions.length > 0) {
    console.warn('Found old session data in workspace state (pre-TASK_2025_014)');
    console.warn('Sessions are now read from .jsonl files only');
    console.warn('Old data will be ignored. Use Claude CLI for session management.');

    // Optionally: Clear old data
    await this.storage.set(SESSIONS_KEY, undefined);
  }
}
```

---

## Performance Optimization

### .jsonl Streaming Read

**Current**: JsonlSessionParser only reads first + last line
**Target**: Read all messages efficiently via streaming

**Optimization**:

```typescript
// Use readline for streaming (not fs.readFile)
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// Memory: Minimal (stream buffer only, ~8KB)
// Performance: < 1s for 1000 messages
const stream = createReadStream(filePath, { encoding: 'utf8' });
const reader = createInterface({ input: stream });

for await (const line of reader) {
  // Process line by line (streaming)
  // No full file load into memory
}
```

**Evidence**: jsonl-session-parser.ts:139-158 (existing streaming pattern)

### Lazy Loading

**Pattern**: Only load messages when session is opened

```typescript
// Session list: Don't load messages (use metadata only)
async getAllSessions(): Promise<StrictChatSession[]> {
  const summaries = await this.sessionProxy.listSessions();

  return summaries.map(summary => ({
    ...summary,
    messages: [], // Empty - not loaded yet
  }));
}

// Session switch: Load messages on demand
async switchToSession(sessionId: SessionId): Promise<void> {
  // Only load messages for active session
  const messages = await this.sessionProxy.getSessionMessages(sessionId);
  // ...
}
```

### LRU Cache (Optional Enhancement)

**Future Optimization**: Cache recently accessed sessions

```typescript
import LRU from 'lru-cache';

class SessionProxy {
  private messageCache = new LRU<SessionId, StrictChatMessage[]>({
    max: 10, // Cache last 10 sessions
    ttl: 1000 * 60 * 5, // 5 minutes
  });

  async getSessionMessages(sessionId: SessionId): Promise<StrictChatMessage[]> {
    // Check cache first
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return cached;
    }

    // Read from .jsonl
    const messages = await JsonlSessionParser.parseSessionMessages(filePath);

    // Cache for next access
    this.messageCache.set(sessionId, messages);

    return messages;
  }
}
```

**Note**: Implement in Phase 4 (optimization) if performance tests show need

---

## Testing Strategy

### Unit Tests

**A. MessageNormalizer Tests**:

```typescript
describe('MessageNormalizer', () => {
  it('should normalize string content to contentBlocks', () => {
    const result = MessageNormalizer.normalize({
      role: 'user',
      content: 'Hello world',
    });

    expect(result.contentBlocks).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('should normalize array content to contentBlocks', () => {
    const result = MessageNormalizer.normalize({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Response' },
        { type: 'thinking', thinking: 'Analysis...' },
      ],
    });

    expect(result.contentBlocks).toHaveLength(2);
    expect(result.contentBlocks[0].type).toBe('text');
    expect(result.contentBlocks[1].type).toBe('thinking');
  });

  it('should handle empty content', () => {
    const result = MessageNormalizer.normalize({
      role: 'user',
      content: '',
    });

    expect(result.contentBlocks).toEqual([{ type: 'text', text: '' }]);
  });

  it('should handle tool_use blocks', () => {
    const result = MessageNormalizer.normalize({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool-123',
          name: 'read_file',
          input: { path: '/test.ts' },
        },
      ],
    });

    expect(result.contentBlocks[0]).toEqual({
      type: 'tool_use',
      id: 'tool-123',
      name: 'read_file',
      input: { path: '/test.ts' },
    });
  });
});
```

**B. JsonlSessionParser Tests**:

```typescript
describe('JsonlSessionParser', () => {
  it('should parse session messages from .jsonl file', async () => {
    const messages = await JsonlSessionParser.parseSessionMessages('test-fixtures/example.jsonl');

    expect(messages).toHaveLength(15);
    expect(messages[0].type).toBe('user');
    expect(messages[0].contentBlocks).toBeDefined();
    expect(Array.isArray(messages[0].contentBlocks)).toBe(true);
  });

  it('should normalize legacy string content messages', async () => {
    // Test .jsonl with {"role":"user","content":"string"}
    const messages = await JsonlSessionParser.parseSessionMessages('test-fixtures/legacy-format.jsonl');

    messages.forEach((msg) => {
      expect(msg.contentBlocks).toBeDefined();
      expect(msg.contentBlocks.length).toBeGreaterThan(0);
    });
  });

  it('should handle corrupt .jsonl lines gracefully', async () => {
    const messages = await JsonlSessionParser.parseSessionMessages('test-fixtures/corrupt.jsonl');

    // Should skip corrupt lines, return valid messages only
    expect(messages).toBeDefined();
  });
});
```

### Integration Tests

**C. SessionProxy Integration**:

```typescript
describe('SessionProxy (Integration)', () => {
  it('should read messages from actual .jsonl file', async () => {
    const sessionProxy = container.resolve(SessionProxy);
    const messages = await sessionProxy.getSessionMessages('0a32ee44-4d5c-409a-8047-3ee94a591dcb' as SessionId);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].contentBlocks).toBeDefined();
  });

  it('should return empty array for non-existent session', async () => {
    const sessionProxy = container.resolve(SessionProxy);
    const messages = await sessionProxy.getSessionMessages('non-existent-id' as SessionId);

    expect(messages).toEqual([]);
  });
});
```

**D. SessionManager Delegation**:

```typescript
describe('SessionManager (Refactored)', () => {
  it('should delegate to SessionProxy for message reads', async () => {
    const sessionManager = container.resolve(SessionManager);
    const session = await sessionManager.getCurrentSession();

    // Messages should come from .jsonl (via SessionProxy)
    expect(session?.messages).toBeDefined();
    expect(session?.messages.length).toBeGreaterThan(0);
    expect(session?.messages[0].contentBlocks).toBeDefined();
  });

  it('should not maintain in-memory session storage', () => {
    const sessionManager = container.resolve(SessionManager);

    // @ts-expect-error - private field should not exist
    expect(sessionManager.sessions).toBeUndefined();
  });
});
```

### E2E Tests

**E. Session Switching (No Regression)**:

```typescript
describe('Session Switching E2E', () => {
  it('should switch sessions without message duplication', async () => {
    // Load session 1
    await chatService.switchToSession(sessionId1);
    const messages1 = chatService.messages();

    // Switch to session 2
    await chatService.switchToSession(sessionId2);
    const messages2 = chatService.messages();

    // Verify no duplication
    expect(messages2).not.toEqual(messages1);
    expect(messages2.length).toBeGreaterThan(0);

    // Verify contentBlocks format
    messages2.forEach((msg) => {
      expect(msg.contentBlocks).toBeDefined();
      expect(Array.isArray(msg.contentBlocks)).toBe(true);
    });
  });
});
```

**F. Event Emission (No Duplicates)**:

```typescript
describe('Event Emission E2E', () => {
  it('should emit sessionInit exactly once', async () => {
    const events: string[] = [];

    eventBus.on('chat:sessionInit').subscribe(() => {
      events.push('sessionInit');
    });

    await chatService.switchToSession(sessionId);

    expect(events.filter((e) => e === 'sessionInit')).toHaveLength(1);
  });

  it('should not emit messageAdded after streaming completes', async () => {
    const events: string[] = [];

    eventBus.on('chat:messageChunk').subscribe(() => {
      events.push('chunk');
    });

    eventBus.on('chat:messageComplete').subscribe(() => {
      events.push('complete');
    });

    eventBus.on('chat:messageAdded').subscribe(() => {
      events.push('added');
    });

    await chatService.sendMessage('Test');

    // Should have chunks + complete, but NOT added
    expect(events.includes('chunk')).toBe(true);
    expect(events.includes('complete')).toBe(true);
    expect(events.includes('added')).toBe(false);
  });
});
```

### Performance Tests

**G. .jsonl Reading Performance**:

```typescript
describe('Performance Tests', () => {
  it('should load session list in < 500ms', async () => {
    const start = performance.now();

    const sessions = await sessionProxy.listSessions();

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('should load 1000 messages in < 1s', async () => {
    const start = performance.now();

    const messages = await sessionProxy.getSessionMessages(largeSessionId);

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(1000);
    expect(messages.length).toBeGreaterThanOrEqual(1000);
  });

  it('should stream read without full file load', async () => {
    const memoryBefore = process.memoryUsage().heapUsed;

    const messages = await JsonlSessionParser.parseSessionMessages(
      'large-session.jsonl' // 10MB file
    );

    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryIncrease = (memoryAfter - memoryBefore) / 1024 / 1024; // MB

    // Memory increase should be < 5MB (streaming, not full load)
    expect(memoryIncrease).toBeLessThan(5);
    expect(messages.length).toBeGreaterThan(0);
  });
});
```

---

## Implementation Phases

### Phase 1: Foundation (Additive - No Breaking Changes)

**Goal**: Add new capabilities without breaking existing functionality

**Tasks**:

1. **Create MessageNormalizer utility**

   - Location: `libs/shared/src/lib/utils/message-normalizer.ts`
   - Implement `normalize()` method
   - Add unit tests (10+ test cases)
   - Export from `libs/shared/src/index.ts`

2. **Enhance JsonlSessionParser**

   - Add `parseSessionMessages()` method
   - Integrate MessageNormalizer
   - Add unit tests (real .jsonl fixtures)
   - Update existing `parseSessionFile()` if needed

3. **Enhance SessionProxy**
   - Add `getSessionMessages()` method
   - Use JsonlSessionParser internally
   - Add integration tests
   - Document public API

**Success Criteria**:

- All new methods tested and passing
- Existing tests still pass (no regressions)
- No breaking changes to public APIs

**Estimated Duration**: 4-6 hours

---

### Phase 2: Consumer Updates (Integration)

**Goal**: Update consumers to use new .jsonl reading capabilities

**Tasks**:

1. **Refactor SessionManager**

   - Remove in-memory `Map<SessionId, StrictChatSession>`
   - Remove VS Code workspace state persistence
   - Delegate reads to SessionProxy
   - Keep only `currentSessionId` tracking
   - Update `getCurrentSession()` to read from .jsonl
   - Update `getAllSessions()` to read from .jsonl
   - Add migration warning for old workspace state

2. **Update ChatOrchestrationService**

   - Use SessionProxy for message history
   - Remove duplicate event emissions
   - Update `getHistory()` to read from .jsonl

3. **Update Frontend ChatService**
   - Request messages from backend (via SessionProxy)
   - Add deduplication layer
   - Remove duplicate `setClaudeMessages()` calls
   - Update event handlers (chunk vs complete)

**Success Criteria**:

- SessionManager has no in-memory storage
- All session reads go through SessionProxy
- Frontend displays messages from .jsonl
- No duplicate event emissions

**Estimated Duration**: 6-8 hours

---

### Phase 3: Validation & Processing Updates

**Goal**: Update validation and processing to handle contentBlocks format

**Tasks**:

1. **Update ChatValidationService**

   - Accept `contentBlocks: Array` format
   - Deprecate `content: string` validation (backward compat)
   - Add warnings for legacy format
   - Update tests

2. **Update MessageProcessingService**

   - Add defensive null checks
   - Integrate MessageNormalizer fallback
   - Handle legacy messages gracefully
   - Update tests

3. **Cleanup Event Emissions**
   - Audit all `eventBus.publish()` calls
   - Remove duplicate emissions
   - Verify single emission per event
   - Add event counting tests

**Success Criteria**:

- Validation accepts contentBlocks format
- Processing handles null/empty contentBlocks
- Legacy messages normalized on read
- No duplicate event emissions (verified by tests)

**Estimated Duration**: 3-4 hours

---

### Phase 4: Cleanup & Optimization

**Goal**: Remove deprecated code, add optimizations

**Tasks**:

1. **Remove Deprecated Code**

   - Remove `addUserMessage()` from SessionManager
   - Remove `addAssistantMessage()` from SessionManager
   - Remove workspace state save/load logic
   - Remove unused imports/types

2. **Performance Optimization**

   - Benchmark .jsonl reading performance
   - Add LRU cache if needed (optional)
   - Optimize streaming read
   - Profile memory usage

3. **Documentation**
   - Update CLAUDE.md files
   - Add migration guide
   - Document new architecture
   - Update API docs

**Success Criteria**:

- No deprecated code remains
- Performance benchmarks pass (< 500ms list, < 1s messages)
- Documentation up to date

**Estimated Duration**: 2-3 hours

---

## Rollout Plan

### Phase 1: Development (Branch)

- Create feature branch `feature/TASK_2025_014`
- Implement all phases sequentially
- Run full test suite after each phase
- No merge to main until all phases complete

### Phase 2: Testing (Pre-merge)

- Run full test suite (unit + integration + e2e)
- Performance benchmarks
- Manual testing (session switching, message rendering)
- Verify no regressions

### Phase 3: Code Review

- Senior developer review
- Architecture review
- Performance review
- Security review (if applicable)

### Phase 4: Merge & Deploy

- Merge to main
- Monitor for issues
- Rollback plan ready

---

## Risk Assessment & Mitigation

### High Risk: Data Loss

**Risk**: Messages lost during migration if .jsonl reading fails

**Mitigation**:

- No actual data migration (read-only changes)
- .jsonl files are canonical source (unchanged)
- Old workspace state preserved (just not read)
- Rollback: Revert to old SessionManager implementation

**Rollback Procedure**:

```bash
git revert <commit-sha>  # Revert refactoring commit
npm run build:all         # Rebuild
# Old in-memory SessionManager restored
```

### Medium Risk: Breaking Existing Sessions

**Risk**: Format conversion fails for some messages

**Mitigation**:

- MessageNormalizer handles all edge cases
- Defensive null checks in processing
- Graceful degradation (empty message vs crash)
- Extensive unit tests for normalization

**Fallback**:

```typescript
// If normalization fails, return safe default
if (!normalized.contentBlocks || normalized.contentBlocks.length === 0) {
  return {
    contentBlocks: [{ type: 'text', text: '[Message format error]' }],
  };
}
```

### Medium Risk: Performance Degradation

**Risk**: .jsonl reading slower than in-memory access

**Mitigation**:

- Streaming read (not full file load)
- Lazy loading (only load on session switch)
- Optional LRU cache (Phase 4)
- Performance benchmarks in tests

**Monitoring**:

- Session list load time: < 500ms
- Message load time: < 1s for 1000 messages
- Memory usage: < 5MB increase per session

### Low Risk: Event System Breaking Other Features

**Risk**: Removing duplicate events breaks subscribers

**Mitigation**:

- Audit all event subscribers
- Update frontend event handlers
- Test all event-driven features
- Comprehensive event emission tests

**Verification**:

```typescript
// Count event emissions during test
const eventCounts = new Map<string, number>();

eventBus.on('*').subscribe((event) => {
  const count = eventCounts.get(event.type) || 0;
  eventCounts.set(event.type, count + 1);
});

// Verify exactly 1 emission per action
expect(eventCounts.get('chat:sessionInit')).toBe(1);
```

### Low Risk: UI Rendering Issues

**Risk**: Message deduplication breaks rendering

**Mitigation**:

- Comprehensive e2e tests
- Manual testing of chat UI
- Verify message order preserved
- Test streaming + complete rendering

**Verification**:

- Messages render in correct order
- No duplicate messages visible
- Streaming works smoothly
- Session switching works

---

## Success Metrics

### Functional Metrics

✅ **Storage Unification**:

- SessionManager in-memory Map removed
- All message reads go through SessionProxy
- .jsonl files are single source of truth

✅ **Message Format Normalization**:

- All messages have `contentBlocks: Array` format
- Legacy `content: string` messages normalized on read
- No validation errors for contentBlocks format

✅ **Event Deduplication**:

- `sessionInit` emitted exactly 1x per session switch
- `sessionEnd` emitted exactly 1x per session switch
- `messageComplete` emitted exactly 1x per message
- `messageAdded` NOT emitted after streaming
- `tokenUsageUpdated` emitted exactly 1x per message

✅ **Chunk Handling**:

- No frozen chunks during streaming
- No 7x duplication rendering
- Messages render incrementally and smoothly

### Performance Metrics

✅ **Session List Loading**:

- Load time: < 500ms for 50 sessions
- Memory usage: < 2MB

✅ **Message Loading**:

- Load time: < 1s for 1000 messages
- Memory usage: < 5MB increase
- Streaming read (not full file load)

### Quality Metrics

✅ **Test Coverage**:

- Unit tests: 80%+ coverage
- Integration tests: All critical paths covered
- E2E tests: Session switching, message rendering, event emission

✅ **Type Safety**:

- No `any` types introduced
- All message formats typed correctly
- Branded types (SessionId, MessageId) preserved

✅ **No Regressions**:

- All existing tests pass
- Chat functionality works as before
- Session management works as before

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer** for Phases 1-3, **frontend-developer** for Phase 2-3 (integration)

**Rationale**:

**Backend Developer**:

- Phase 1: Create MessageNormalizer, enhance JsonlSessionParser, enhance SessionProxy (backend utilities)
- Phase 2: Refactor SessionManager, update ChatOrchestrationService (backend services)
- Phase 3: Cleanup event emissions (backend event system)

**Frontend Developer**:

- Phase 2: Update ChatService to use new SessionProxy API (frontend integration)
- Phase 3: Update ChatValidationService, MessageProcessingService (frontend validation/processing)
- Phase 3: Update event handlers, add deduplication (frontend state management)

**Or**: **Both** developers working in parallel:

- Backend developer: Phases 1, 2 (SessionManager refactoring), 3 (event cleanup)
- Frontend developer: Phase 2 (ChatService integration), Phase 3 (validation/processing)

### Complexity Assessment

**Complexity**: **HIGH**

**Estimated Effort**: **12-16 hours**

**Breakdown**:

- Phase 1 (Foundation): 4-6 hours (backend)
- Phase 2 (Integration): 6-8 hours (backend + frontend)
- Phase 3 (Validation): 3-4 hours (frontend)
- Phase 4 (Cleanup): 2-3 hours (both)

**Total**: 15-21 hours (HIGH complexity due to cross-layer refactoring)

### Files Affected Summary

**CREATE**:

- `libs/shared/src/lib/utils/message-normalizer.ts` (new utility)
- `libs/shared/src/lib/utils/message-normalizer.spec.ts` (tests)

**MODIFY**:

- `libs/backend/claude-domain/src/session/jsonl-session-parser.ts` (add parseSessionMessages)
- `libs/backend/claude-domain/src/session/session-proxy.ts` (add getSessionMessages)
- `libs/backend/claude-domain/src/session/session-manager.ts` (major refactoring - remove in-memory)
- `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts` (use SessionProxy, remove duplicate events)
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (remove duplicate emissions)
- `libs/frontend/core/src/lib/services/chat.service.ts` (update event handlers, deduplication)
- `libs/frontend/core/src/lib/services/chat-validation.service.ts` (accept contentBlocks)
- `libs/frontend/core/src/lib/services/message-processing.service.ts` (defensive checks)

**REWRITE** (Direct Replacement):

- None (refactoring, not replacement)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `SessionProxy` from `@ptah-extension/claude-domain` (session-proxy.ts)
   - `JsonlSessionParser` from `@ptah-extension/claude-domain` (jsonl-session-parser.ts)
   - `MessageNormalizer` from `@ptah-extension/shared` (to be created)
   - `ContentBlock` from `@ptah-extension/shared` (existing)

2. **All patterns verified from examples**:

   - Streaming read: jsonl-session-parser.ts:139-158
   - Event emission: session-manager.ts:197-198
   - SessionProxy pattern: session-proxy.ts:59-89

3. **Library documentation consulted**:

   - `libs/backend/claude-domain/CLAUDE.md` (SessionManager, SessionProxy)
   - `libs/frontend/core/CLAUDE.md` (ChatService, validation)
   - `libs/shared/CLAUDE.md` (type system)

4. **No hallucinated APIs**:
   - All decorators verified: `@injectable()` from tsyringe
   - All base classes verified: SessionProxy, JsonlSessionParser exist
   - All events verified: CHAT_MESSAGE_TYPES from shared

### Architecture Delivery Checklist

- ✅ All components specified with evidence
- ✅ All patterns verified from codebase
- ✅ All imports/decorators verified as existing
- ✅ Quality requirements defined
- ✅ Integration points documented
- ✅ Files affected list complete
- ✅ Developer type recommended
- ✅ Complexity assessed
- ✅ No step-by-step implementation (team-leader's job)

---

## Appendix: Evidence Citations

### Codebase Investigation Evidence

1. **SessionManager in-memory storage**:

   - Source: session-manager.ts:140-155
   - Evidence: `private sessions: Map<SessionId, StrictChatSession> = new Map();`

2. **Message format in SessionManager**:

   - Source: session-manager.ts:393, 452
   - Evidence: `contentBlocks: [{type:'text',text}]` (correct format)

3. **Validation rejects contentBlocks**:

   - Source: chat-validation.service.ts:124
   - Evidence: `if (!chatMsg['content'] || typeof chatMsg['content'] !== 'string')`

4. **MessageProcessingService crash**:

   - Source: message-processing.service.ts:176
   - Evidence: `strictMessage.contentBlocks.map()` (no null check)

5. **Duplicate event emissions**:

   - Source: context.md:35-45 (log analysis)
   - Evidence: `sessionInit emitted 2x, messageComplete emitted 2x`

6. **Duplicate setClaudeMessages calls**:

   - Source: context.md:47-52 (chat.service.ts analysis)
   - Evidence: Called at lines 540, 656, 805

7. **Streaming read pattern**:

   - Source: jsonl-session-parser.ts:139-158
   - Evidence: `createReadStream`, `createInterface`, `for await (const line of reader)`

8. **SessionProxy pattern**:
   - Source: session-proxy.ts:59-89
   - Evidence: `listSessions()` graceful error handling, streaming approach

### Architecture Decisions Justification

1. **Single source of truth (.jsonl)**:

   - Reasoning: Claude CLI is authoritative, no sync issues
   - Evidence: context.md:10-12 (dual storage problem)

2. **MessageNormalizer utility**:

   - Reasoning: Centralized normalization logic, reusable
   - Pattern: Shared utilities in `libs/shared/src/lib/utils/`

3. **Streaming read for .jsonl**:

   - Reasoning: Performance, memory efficiency
   - Evidence: jsonl-session-parser.ts:139-158 (existing pattern)

4. **Remove SessionManager in-memory**:

   - Reasoning: Eliminates complexity, single source of truth
   - Breaking change: Acceptable (internal refactoring, no API change)

5. **Event deduplication**:

   - Reasoning: Fix 7x rendering issue
   - Evidence: context.md:35-45 (log analysis proves duplicates)

6. **Frontend deduplication layer**:
   - Reasoning: Defense-in-depth, prevent UI issues
   - Pattern: Deduplication by MessageId Map

---

## Conclusion

This implementation plan provides a comprehensive architecture for eliminating dual storage, normalizing message formats, removing duplicate events, and fixing chunk handling. The refactoring follows a phased approach with clear success criteria, extensive testing, and risk mitigation strategies.

**Key Principles**:

- ✅ **SIMPLIFICATION**: One storage system, one format, one event per action
- ✅ **EVIDENCE-BASED**: All decisions backed by codebase analysis
- ✅ **TYPE-SAFE**: Maintain strict typing throughout
- ✅ **PERFORMANCE-OPTIMIZED**: Streaming reads, lazy loading, caching
- ✅ **WELL-TESTED**: Unit, integration, e2e, performance tests
- ✅ **GRACEFUL**: Defensive checks, fallbacks, error handling

The architecture is ready for team-leader decomposition into atomic, git-verifiable tasks.
