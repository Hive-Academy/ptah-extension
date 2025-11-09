# libs/shared - Type System & Cross-Boundary Contracts

## Purpose

The **shared library** is the central type system layer providing unified contracts between the extension host and Angular webview. It contains **zero implementation logic** - only types, interfaces, and validation schemas.

## Key Responsibilities

- **Branded Types**: SessionId, MessageId, CorrelationId for compile-time safety
- **Message Protocol**: 94 distinct message types with strict payloads
- **Chat Data Models**: StrictChatMessage, StrictChatSession (replaces deprecated loose types)
- **AI Provider Abstractions**: IAIProvider, IProviderManager for multi-provider support
- **Claude Domain Types**: Permissions, tools, streaming events
- **UI Component Contracts**: Dashboard metrics, dropdown options, webview config

## Architecture

```
libs/shared/src/lib/types/
├── branded.types.ts          # Type-safe IDs (SessionId, MessageId, CorrelationId)
├── message.types.ts          # 94 message types + payloads (extension ↔ webview)
├── ai-provider.types.ts      # Multi-provider abstraction layer
├── claude-domain.types.ts    # Claude CLI integration types
├── command-builder.types.ts  # Command template execution
├── webview-ui.types.ts       # UI component contracts
└── common.types.ts           # DEPRECATED - legacy types
```

## Core Type Exports

### Branded Types (ID Safety)

```typescript
import { SessionId, MessageId, CorrelationId } from '@ptah-extension/shared';

// Smart constructors with validation
const sessionId = SessionId.create(); // New UUID v4
const parsed = SessionId.from(rawId); // Parse with validation
const isValid = SessionId.validate(data); // Type guard

// Zod schemas for runtime validation
SessionIdSchema.parse(data);
```

### Message Protocol

```typescript
import { StrictMessage, StrictMessageType, MessagePayloadMap } from '@ptah-extension/shared';

// Type-safe message with discriminated payload
interface StrictMessage<T extends keyof MessagePayloadMap> {
  readonly id: CorrelationId;
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly metadata: MessageMetadata;
}

// Example usage
const msg: StrictMessage<'chat:sendMessage'> = {
  id: CorrelationId.create(),
  type: 'chat:sendMessage',
  payload: { content: 'Hello', correlationId: ... },
  metadata: { ...}
};
```

### Chat Data Models

```typescript
import { StrictChatMessage, StrictChatSession } from '@ptah-extension/shared';

// Use Strict* types (NOT deprecated ChatMessage/ChatSession)
interface StrictChatMessage {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly type: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: number; // NOT Date object
  readonly streaming?: boolean;
  readonly files?: readonly string[];
}

interface StrictChatSession {
  readonly id: SessionId;
  readonly name: string;
  readonly messages: readonly StrictChatMessage[];
  readonly tokenUsage: { input; output; total; percentage };
}
```

### AI Provider Abstractions

```typescript
import { IAIProvider, ProviderId, ProviderCapabilities } from '@ptah-extension/shared';

// Provider interface for Claude CLI, VS Code LM, etc.
interface IAIProvider {
  readonly providerId: ProviderId;
  initialize(): Promise<boolean>;
  startChatSession(sessionId: SessionId): Promise<Readable>;
  sendMessageToSession(sessionId, content): Promise<void>;
  getHealth(): ProviderHealth;
}
```

## Dependencies

**External (minimal by design)**:

- `uuid` (^11.1.0): UUID v4 generation
- `zod` (^3.25.76): Runtime schema validation

**No Re-exports**: This library does NOT re-export types from other workspace libraries to prevent circular dependencies.

## Import Pattern

```typescript
// Import from barrel export
import { SessionId, StrictChatMessage, IAIProvider, type StrictMessageType } from '@ptah-extension/shared';
```

## Type Safety Principles

1. **Zero Loose Types**: No `any`, `object`, or `unknown` without validation
2. **Branded Types**: Prevents SessionId/MessageId mixing at compile time
3. **Readonly Contracts**: All properties readonly for immutability
4. **Discriminated Unions**: Safe pattern matching with type guards
5. **Zod Validation**: Runtime validation bridges static typing and dynamic data

## Validation Examples

```typescript
// Type guard for discriminated unions
import { isSystemMessage, isRoutableMessage } from '@ptah-extension/shared';

if (isSystemMessage(msg)) {
  // msg is narrowed to SystemMessage
}

// Zod schema validation
import { StrictChatSessionSchema } from '@ptah-extension/shared';

const session = StrictChatSessionSchema.parse(data); // Throws on invalid
const result = StrictChatSessionSchema.safeParse(data); // Returns Result<T>
```

## Message Protocol Domains

**94 distinct message types across 7 domains**:

- **chat** (19 types): sendMessage, messageChunk, sessionStart, sessionEnd, etc.
- **providers** (10 types): switch, healthCheck, error, etc.
- **context** (7 types): includeFile, searchFiles, suggestions, etc.
- **commands** (4 types): executeCommand, selectFile, etc.
- **analytics** (2 types): trackEvent, getData
- **config** (4 types): get, set, update, refresh
- **state** (3 types): load, save, clear

## Testing

```bash
nx test shared              # Unit tests for validators
nx run shared:typecheck     # TypeScript strict compilation
nx run shared:lint          # ESLint validation
```

## Build Output

- **Format**: CommonJS (for Node.js compatibility)
- **Output**: `dist/libs/shared/`
- **Type Declarations**: Full `.d.ts` generation

## Migration Notes

**DEPRECATED Types** (replace with Strict\* variants):

- ❌ `ChatMessage` → ✅ `StrictChatMessage`
- ❌ `ChatSession` → ✅ `StrictChatSession`
- ❌ `string` (for IDs) → ✅ `SessionId`, `MessageId`

## Architectural Constraints

1. **Contract-Only**: Never add runtime logic to this library
2. **No Re-exports**: Don't re-export types from other workspace libs
3. **Immutable**: All types readonly
4. **Validated**: Provide Zod schemas for all cross-boundary types
5. **Documented**: All exports have JSDoc comments

## File Locations

- **Source**: `libs/shared/src/lib/types/`
- **Entry Point**: `libs/shared/src/index.ts`
- **Build Config**: `libs/shared/project.json`
- **Package**: `@ptah-extension/shared`
