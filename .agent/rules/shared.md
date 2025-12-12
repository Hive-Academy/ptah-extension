---
glob: 'libs/shared/**/*.ts'
---

# shared - Type System & Contracts Foundation

**Active**: Working in `libs/shared/**/*.ts`

## Purpose

Foundation library defining type system, message protocol (94 types), and contracts shared between frontend and backend. NO implementation code allowed.

## Responsibilities

✅ **Type Definitions**: All interfaces, types, enums
✅ **Branded Types**: Compile-time ID safety (SessionId, MessageId)
✅ **Message Protocol**: 94 RPC message types (frontend ↔ backend)
✅ **Error Types**: Result<T,E>, domain error types
✅ **Provider Abstractions**: AI provider interfaces

❌ **NOT**: Services, components, business logic, utilities (implementation)

## Critical Rules

### 1. NO Implementation Code

```typescript
// ✅ Good - Types only
export interface ChatMessage {
  id: MessageId;
  sessionId: SessionId;
  content: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export enum MessageType {
  Text = 'text',
  Code = 'code',
  Image = 'image',
}

// ❌ Bad - Implementation
export class ChatService {
  // NO! Goes to backend/frontend
  sendMessage() {}
}

export function formatMessage(msg: ChatMessage): string {
  // NO!
  return `${msg.role}: ${msg.content}`;
}
```

### 2. Branded Types for Type Safety

```typescript
// Prevents mixing different ID types at compile time
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type RequestId = Brand<string, 'RequestId'>;

// Usage
const sessionId: SessionId = 'session-123' as SessionId;
const messageId: MessageId = 'msg-456' as MessageId;

// ✅ Type safe - compiler error!
const wrongAssignment: SessionId = messageId; // Error!
```

### 3. No Re-Exports

```typescript
// ❌ Bad - Re-exporting from other libs creates circular deps
import { Logger } from '@ptah-extension/vscode-core';
export { Logger }; // NO!

// ✅ Good - Define types here
export interface ILogger {
  info(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
}
```

## Directory Structure

```
libs/shared/src/lib/
├── types/
│   ├── rpc.types.ts           # RPC message protocol (94 types)
│   ├── session.types.ts       # Session types
│   ├── message.types.ts       # Chat message types
│   ├── provider.types.ts      # AI provider abstractions
│   ├── error.types.ts         # Error types
│   ├── file.types.ts          # File/workspace types
│   └── common.types.ts        # Brand, Result, utility types
├── enums/
│   ├── message-role.enum.ts   # Message roles
│   ├── project-type.enum.ts   # Project types
│   └── file-type.enum.ts      # File types
└── index.ts                   # Public exports
```

## Key Types

### Brand Type (Inline Nominal Typing)

```typescript
// libs/shared/src/lib/types/common.types.ts

declare const __brand: unique symbol;

export type Brand<T, TBrand extends string> = T & {
  [__brand]: TBrand;
};

// Create branded types
export type SessionId = Brand<string, 'SessionId'>;
export type MessageId = Brand<string, 'MessageId'>;

// Helper to create branded values
export function createSessionId(value: string): SessionId {
  return value as SessionId;
}
```

### Result Type (Explicit Error Handling)

```typescript
// libs/shared/src/lib/types/common.types.ts

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export const Result = {
  ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },

  err<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },

  isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
    return result.ok === true;
  },

  isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
    return result.ok === false;
  },
};

// Usage
function loadFile(path: string): Result<FileData, FileError> {
  if (!exists(path)) {
    return Result.err({ code: 'NOT_FOUND', path });
  }
  return Result.ok(data);
}

const result = loadFile('/path');
if (Result.isOk(result)) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

### RPC Message Protocol (94 Types)

```typescript
// libs/shared/src/lib/types/rpc.types.ts

// Base message
export interface RpcMessage {
  type: string;
  requestId?: RequestId;
  correlationId?: CorrelationId;
  timestamp: number;
}

// Chat messages (frontend → backend)
export interface ChatStartMessage extends RpcMessage {
  type: 'chat:start';
  payload: {
    message: string;
    model: string;
    files?: string[];
    images?: string[];
  };
}

export interface ChatContinueMessage extends RpcMessage {
  type: 'chat:continue';
  payload: {
    sessionId: SessionId;
    message: string;
  };
}

export interface ChatStopMessage extends RpcMessage {
  type: 'chat:stop';
  payload: {
    sessionId: SessionId;
  };
}

// Chat responses (backend → frontend)
export interface ChatStreamingMessage extends RpcMessage {
  type: 'chat:streaming';
  payload: {
    sessionId: SessionId;
    token: string;
  };
}

export interface ChatCompleteMessage extends RpcMessage {
  type: 'chat:complete';
  payload: {
    sessionId: SessionId;
    messageId: MessageId;
  };
}

export interface ChatErrorMessage extends RpcMessage {
  type: 'chat:error';
  payload: {
    sessionId?: SessionId;
    error: {
      code: string;
      message: string;
    };
  };
}

// Session messages
export interface SessionCreateMessage extends RpcMessage {
  type: 'session:create';
  payload: {
    name?: string;
  };
}

export interface SessionDeleteMessage extends RpcMessage {
  type: 'session:delete';
  payload: {
    sessionId: SessionId;
  };
}

// ... 86 more message types
```

### Session Types

```typescript
// libs/shared/src/lib/types/session.types.ts

export interface SessionData {
  id: SessionId;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionMetadata {
  model: string;
  tokenCount: number;
  cost: number;
}

export interface CreateSessionOptions {
  name?: string;
  model?: string;
}
```

### Message Types

```typescript
// libs/shared/src/lib/types/message.types.ts

export interface ChatMessage {
  id: MessageId;
  sessionId: SessionId;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
}

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

export interface MessageMetadata {
  model?: string;
  tokenCount?: number;
  attachments?: FileAttachment[];
}

export interface FileAttachment {
  path: string;
  name: string;
  type: string;
  size: number;
}
```

### Provider Types

```typescript
// libs/shared/src/lib/types/provider.types.ts

export interface AIProvider {
  name: string;
  id: string;
  models: AIModel[];
}

export interface AIModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapability[];
}

export enum ModelCapability {
  Chat = 'chat',
  Vision = 'vision',
  FunctionCalling = 'function_calling',
  Streaming = 'streaming',
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
}
```

### Error Types

```typescript
// libs/shared/src/lib/types/error.types.ts

export interface AppError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: number;
  correlationId?: CorrelationId;
}

export interface FileError extends AppError {
  code: 'FILE_NOT_FOUND' | 'PERMISSION_DENIED' | 'INVALID_FORMAT';
  path: string;
}

export interface SessionError extends AppError {
  code: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'INVALID_SESSION';
  sessionId: SessionId;
}

export interface ProviderError extends AppError {
  code: 'PROVIDER_UNAVAILABLE' | 'API_ERROR' | 'RATE_LIMITED';
  provider: string;
}
```

## Type Guards

```typescript
// Type guards for runtime type checking

export function isChatStartMessage(msg: RpcMessage): msg is ChatStartMessage {
  return msg.type === 'chat:start';
}

export function isChatStreamingMessage(msg: RpcMessage): msg is ChatStreamingMessage {
  return msg.type === 'chat:streaming';
}

export function isFileError(error: AppError): error is FileError {
  return 'path' in error;
}
```

## JSDoc Documentation

ALL types must have JSDoc comments for IntelliSense:

````typescript
/**
 * Represents a chat session with an AI assistant.
 *
 * @property id - Unique session identifier
 * @property name - Human-readable session name
 * @property createdAt - Unix timestamp of creation
 * @property updatedAt - Unix timestamp of last update
 * @property messageCount - Number of messages in session
 *
 * @example
 * ```typescript
 * const session: SessionData = {
 *   id: createSessionId('sess-123'),
 *   name: 'Project Planning',
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   messageCount: 0
 * };
 * ```
 */
export interface SessionData {
  id: SessionId;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}
````

## Backward Compatibility

When modifying message protocol:

1. **Add new fields as optional** first
2. **Deprecate old fields** with JSDoc @deprecated
3. **Remove deprecated fields** after 2 releases
4. **Version message types** if breaking changes needed

```typescript
export interface ChatMessageV2 {
  id: MessageId;
  /** @deprecated Use content.text instead */
  text?: string;
  content: {
    text: string;
    attachments?: FileAttachment[];
  };
}
```

## Testing

### Type Tests (using tsd)

```typescript
import { expectType, expectError } from 'tsd';
import { SessionId, MessageId, Result } from './common.types';

// Branded types prevent mixing
const sessionId: SessionId = 'sess-123' as SessionId;
const messageId: MessageId = 'msg-456' as MessageId;

expectError<SessionId>(messageId); // Should error!

// Result type guards work
const result: Result<number, string> = Result.ok(42);
if (Result.isOk(result)) {
  expectType<number>(result.value); // value is number
} else {
  expectType<string>(result.error); // error is string
}
```

## Rules

1. **NO implementation code** - Types/interfaces/enums only
2. **Branded types for IDs** - SessionId, MessageId, etc.
3. **No re-exports** - Never re-export from other libs
4. **JSDoc all exports** - For IntelliSense
5. **Backward compat** - Version or deprecate changes
6. **Type guards** - Provide for complex types
7. **Explicit over implicit** - `MessageRole.User` not `'user'`

## Commands

```bash
nx test shared
nx build shared
nx typecheck shared
```
