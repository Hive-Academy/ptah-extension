# Claude Domain Library Documentation

## Overview

The **Claude Domain Library** (`libs/backend/claude-domain`) is the core module responsible for integrating with the Claude CLI. It handles reading JSONL message files, parsing session data, and communicating with the UI layer.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Claude Domain Library                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐         ┌─────────────────────────────────────────┐    │
│  │   JSONL Files   │         │           JsonlSessionParser            │    │
│  │  (~/. claude/    │ ──────► │  • parseSessionFile() - metadata        │    │
│  │   projects/     │         │  • parseSessionMessages() - all msgs    │    │
│  │   {workspace}/  │         │  • Uses streaming (readline)            │    │
│  │   {session}.     │         │  • Memory efficient                     │    │
│  │   jsonl)        │         └─────────────────────────────────────────┘    │
│  └─────────────────┘                           │                             │
│                                                ▼                             │
│                               ┌─────────────────────────────────────────┐    │
│                               │         MessageNormalizer               │    │
│                               │  • Converts content → contentBlocks     │    │
│                               │  • Handles:  text, tool_use, thinking    │    │
│                               │  • Graceful error handling              │    │
│                               └─────────────────────────────────────────┘    │
│                                                │                             │
│                                                ▼                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     StrictChatMessage[]                              │    │
│  │  { id, sessionId, type, contentBlocks[], timestamp, streaming }     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                │                             │
│        ┌───────────────────────────────────────┼────────────────────────┐    │
│        ▼                                       ▼                        ▼    │
│  ┌───────────────┐                   ┌───────────────┐          ┌──────────┐│
│  │ClaudeProcess  │                   │ClaudeFileService          │ EventBus ││
│  │(Real-time CLI)│                   │(Frontend Direct)│         │(Events)  ││
│  └───────────────┘                   └───────────────┘          └──────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. JSONL File Format

Claude CLI stores conversation data in JSONL (JSON Lines) format. Each session has a dedicated `.jsonl` file.

### File Location

```
~/.claude/projects/{encodedWorkspace}/{sessionId}.jsonl
```

**Examples:**

- Windows: `C:\Users\username\. claude\projects\d--projects-ptah\abc-123.jsonl`
- Unix: `/home/username/.claude/projects/d--projects-ptah/abc-123.jsonl`

### JSONL Structure

```jsonl
{"type":"summary","summary":"Implement feature X","leafUuid":"msg-123"}
{"uuid":"msg-1","sessionId":"abc-123","timestamp":"2025-01-21T10:30:00.000Z","message": {"role":"user","content":"Hello"}}
{"uuid":"msg-2","sessionId":"abc-123","timestamp":"2025-01-21T10:31:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi there! "}]}}
```

| Line Type               | Description                     |
| ----------------------- | ------------------------------- |
| `summary`               | First line - session name/title |
| `user`                  | User messages                   |
| `assistant`             | Claude responses                |
| `queue-operation`       | Internal operations (skipped)   |
| `file-history-snapshot` | File state (skipped)            |

---

## 2. Core Components

### 2.1 JsonlSessionParser

**Location:** `libs/backend/claude-domain/src/session/jsonl-session-parser.ts`

The main parser for reading and parsing JSONL session files.

#### Key Methods

##### `parseSessionFile(filePath: string): Promise<SessionUIData>`

Extracts session metadata efficiently (< 10ms per file).

```typescript
const metadata = await JsonlSessionParser.parseSessionFile('C:\\Users\\user\\.claude\\projects\\workspace\\session-123.jsonl');
// Returns: { name, messageCount, lastActiveAt, createdAt, tokenUsage, isActive }
```

**Strategy:**

1. Read **first line** → Session name (from summary)
2. Read **last line** → Last activity timestamp
3. Count lines → Message count (excluding summary)

##### `parseSessionMessages(filePath: string): Promise<StrictChatMessage[]>`

Parses all messages from a session file with content normalization.

```typescript
const messages = await JsonlSessionParser.parseSessionMessages('C:\\Users\\user\\.claude\\projects\\workspace\\session-123.jsonl');
// Returns: [{ id, sessionId, type, contentBlocks, timestamp, streaming, isComplete }]
```

**Processing Flow:**

```
JSONL Line → JSON. parse() → Filter (user/assistant only) → MessageNormalizer → StrictChatMessage
```

#### Parsing Logic

```typescript
// For each JSONL line:
for await (const line of reader) {
  const jsonlLine = JSON.parse(line);

  // Skip non-message types
  if (jsonlLine.type !== 'user' && jsonlLine.type !== 'assistant') {
    continue;
  }

  // Normalize content format
  const normalized = MessageNormalizer.normalize(jsonlLine.message);

  // Build StrictChatMessage
  const message: StrictChatMessage = {
    id: jsonlLine.uuid,
    sessionId: extractedFromFilename,
    type: jsonlLine.message.role,
    contentBlocks: normalized.contentBlocks,
    timestamp: new Date(jsonlLine.timestamp).getTime(),
    streaming: false,
    isComplete: true,
  };
}
```

---

### 2.2 MessageNormalizer

**Location:** `libs/shared/src/lib/utils/message-normalizer.ts`

Converts various message content formats to a unified `contentBlocks[]` array.

#### Supported Content Types

| Input Format                                       | Output ContentBlock                                         |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `content:  "string"`                               | `[{ type: 'text', text: 'string' }]`                        |
| `content: [{ type: 'text', text: '...' }]`         | Passed through                                              |
| `content: [{ type: 'thinking', thinking: '...' }]` | `[{ type: 'thinking', thinking: '...' }]`                   |
| `content: [{ type: 'tool_use', ...  }]`            | `[{ type: 'tool_use', id, name, input }]`                   |
| `content: [{ type: 'tool_result', ... }]`          | `[{ type: 'tool_result', tool_use_id, content, is_error }]` |
| `content: null/undefined`                          | `[{ type: 'text', text: '' }]`                              |

#### Usage Example

```typescript
import { MessageNormalizer } from '@ptah-extension/shared';

// String content (legacy format)
const result1 = MessageNormalizer.normalize({
  role: 'user',
  content: 'Hello world',
});
// → { contentBlocks: [{ type:  'text', text: 'Hello world' }] }

// Array content (Claude CLI format)
const result2 = MessageNormalizer.normalize({
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Analyzing the question...' },
    { type: 'text', text: 'Here is my response.' },
    { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/test.ts' } },
  ],
});
// → { contentBlocks: [... all three blocks normalized... ] }
```

---

### 2.3 ClaudeProcess

**Location:** `libs/backend/claude-domain/src/cli/claude-process.ts`

Event-driven wrapper for spawning Claude CLI processes in real-time.

#### Philosophy

```
Direct spawn pattern - no complex state machines:
1. Spawn claude CLI with --output-format stream-json
2. Write prompt to stdin, close stdin
3. Parse stdout JSONL line-by-line
4. Emit events for each message
```

#### Events Emitted

| Event     | Payload          | Description                     |
| --------- | ---------------- | ------------------------------- |
| `message` | `JSONLMessage`   | JSONL message received from CLI |
| `error`   | `Error`          | Process or parse error          |
| `close`   | `number \| null` | Process exit code               |

#### Usage Example

```typescript
import { ClaudeProcess } from '@ptah-extension/claude-domain';

const claudeProcess = new ClaudeProcess('/usr/local/bin/claude', '/project/path');

// Listen for messages
claudeProcess.on('message', (msg: JSONLMessage) => {
  console.log('Received:', msg);
  // Forward to UI...
});

claudeProcess.on('error', (err) => {
  console.error('Process error:', err);
});

claudeProcess.on('close', (code) => {
  console.log('Process exited with code:', code);
});

// Start new conversation
await claudeProcess.start('Explain this code', { model: 'sonnet' });

// Or resume existing session
await claudeProcess.resume('session-123', 'Continue where we left off');
```

#### JSONL Parsing (Real-time)

```typescript
private processChunk(chunk: Buffer | string): void {
  this.buffer += chunk. toString('utf8');
  const lines = this.buffer.split('\n');

  // Keep incomplete line in buffer
  this.buffer = lines.pop() || '';

  // Parse complete lines
  for (const line of lines) {
    if (line.trim()) {
      const parsed = JSON.parse(line) as JSONLMessage;
      this.emit('message', parsed);
    }
  }
}
```

---

### 2.4 ClaudeFileService (Frontend)

**Location:** `libs/frontend/core/src/lib/services/claude-file. service.ts`

Direct JSONL file reader for the frontend (Angular) - bypasses backend caching.

#### Benefits

- No caching layers (eliminates message duplication)
- No backend roundtrip (faster session loading)
- Single source of truth (`.jsonl` files)
- Simpler architecture (1 hop vs 15+)

#### Usage Example

```typescript
import { ClaudeFileService } from '@ptah-extension/frontend-core';

@Component({... })
export class ChatComponent {
  constructor(private claudeFileService: ClaudeFileService) {}

  async loadSession(sessionId: SessionId) {
    const messages = await this.claudeFileService.readSessionFile(sessionId);
    // messages:  StrictChatMessage[]
  }
}
```

---

## 3. Data Flow: File → UI

### Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW:  JSONL → UI                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. SESSION FILE                                                         │
│     ~/. claude/projects/{workspace}/{session}.jsonl                       │
│                          │                                               │
│                          ▼                                               │
│  2. JSONL PARSING (Backend:  JsonlSessionParser)                          │
│     ┌─────────────────────────────────────────────────────────────┐      │
│     │ • createReadStream() + readline interface                    │      │
│     │ • For each line: JSON.parse()                                │      │
│     │ • Filter:  only 'user' and 'assistant' types                  │      │
│     │ • Normalize: MessageNormalizer.normalize(message)            │      │
│     └─────────────────────────────────────────────────────────────┘      │
│                          │                                               │
│                          ▼                                               │
│  3. MESSAGE NORMALIZATION                                                │
│     ┌─────────────────────────────────────────────────────────────┐      │
│     │ content:  string  →  contentBlocks:  [{type:'text', text}]    │      │
│     │ content: Array   →  contentBlocks: [... mapped blocks]       │      │
│     │ content: null    →  contentBlocks: [{type:'text', text:''}] │      │
│     └─────────────────────────────────────────────────────────────┘      │
│                          │                                               │
│                          ▼                                               │
│  4. STRICT CHAT MESSAGE                                                  │
│     ┌─────────────────────────────────────────────────────────────┐      │
│     │ {                                                            │      │
│     │   id: MessageId,                                             │      │
│     │   sessionId: SessionId,                                      │      │
│     │   type: 'user' | 'assistant',                                │      │
│     │   contentBlocks: ContentBlock[],                             │      │
│     │   timestamp: number,                                         │      │
│     │   streaming: false,                                          │      │
│     │   isComplete: true                                           │      │
│     │ }                                                            │      │
│     └─────────────────────────────────────────────────────────────┘      │
│                          │                                               │
│          ┌───────────────┴───────────────┐                               │
│          ▼                               ▼                               │
│  5A. BACKEND → FRONTEND            5B. FRONTEND DIRECT                   │
│      (RPC/Events)                       (ClaudeFileService)              │
│      ┌────────────────┐                 ┌────────────────────┐           │
│      │ EventBus emit  │                 │ VS Code FS API     │           │
│      │ webview. post() │                 │ Parse JSONL inline │           │
│      └────────────────┘                 └────────────────────┘           │
│                          │                                               │
│                          ▼                                               │
│  6. ANGULAR UI COMPONENTS                                                │
│     ┌─────────────────────────────────────────────────────────────┐      │
│     │ ChatMessageComponent renders contentBlocks                   │      │
│     │ • TextContentBlock → <p>text</p>                            │      │
│     │ • ThinkingContentBlock → <details>thinking</details>        │      │
│     │ • ToolUseContentBlock → <code-block>tool call</code-block>  │      │
│     └─────────────────────────────────────────────────────────────┘      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. ContentBlock Types

```typescript
// Text content
interface TextContentBlock {
  type: 'text';
  text: string;
}

// Thinking/reasoning (Claude's internal thought process)
interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
}

// Tool usage request
interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Tool execution result
interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

// Union type
type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock | ToolResultContentBlock;
```

---

## 5. Error Handling

### JsonlSessionParser

- **Corrupt lines:** Logged and skipped (graceful failure)
- **Empty files:** Returns empty array
- **Invalid JSON:** Warning logged, line skipped

### ClaudeProcess

- **Parse errors:** Emits `error` event with details
- **Process errors:** Emits `error` event
- **Timeout:** Manual `kill()` required

### ClaudeFileService

- **File not found:** Returns empty array
- **Read errors:** Logged, returns empty array

---

## 6. Exports Summary

```typescript
// From @ptah-extension/claude-domain
export { JsonlSessionParser } from './session/jsonl-session-parser';
export { ClaudeProcess } from './cli/claude-process';
export type { ClaudeProcessOptions } from './cli/claude-process';

// From @ptah-extension/shared
export { MessageNormalizer } from './utils/message-normalizer';
export type { ContentBlock, TextContentBlock, ThinkingContentBlock, ToolUseContentBlock, ToolResultContentBlock } from './types/content-block. types';

// From @ptah-extension/frontend-core
export { ClaudeFileService } from './services/claude-file.service';
```

---

## 7. Performance Characteristics

| Operation                             | Performance          | Memory                         |
| ------------------------------------- | -------------------- | ------------------------------ |
| `parseSessionFile()`                  | < 10ms               | Minimal (first+last line only) |
| `parseSessionMessages()`              | < 1s for 1000 msgs   | Streaming (readline)           |
| `ClaudeProcess.parseLine()`           | < 1ms per line       | Buffer-based                   |
| `ClaudeFileService.readSessionFile()` | Depends on file size | Full file in memory            |

---

## 8. Testing

```bash
# Run unit tests
nx test claude-domain
nx test shared

# Build
nx build claude-domain
```

**Test Coverage Target:** 80% minimum
