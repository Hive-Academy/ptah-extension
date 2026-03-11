---
alwaysOn: true
---

# Ptah Extension - Global Architecture & Standards

> **Always active** - Core architectural rules, conventions, and patterns.

## 🎯 Project Overview

**Ptah**: VS Code extension providing visual Claude Code CLI interface.

**Key Features**: Chat (streaming, sessions, attachments), @/@/ autocomplete, workspace intelligence (context optimization), setup wizard, performance dashboard, MCP server.

**Stack**: Angular 20.1+ (standalone, zoneless), TypeScript 5.8, Nx 21.4, Jest 30, tsyringe DI, DaisyUI + CDK

## 🏗️ Architecture

**Pattern**: Nx monorepo, strict layered architecture

```
Apps (2) → Features (5 frontend + 7 backend) → Foundation (1 shared)
```

### Layers

```
Applications (2)
├─ ptah-extension-vscode (VS Code extension)
└─ ptah-extension-webview (Angular SPA)

Backend (7)
├─ vscode-core (DI, EventBus, Logger, API wrappers)
├─ agent-sdk (Claude Agent SDK)
├─ llm-abstraction (multi-provider LLM)
├─ workspace-intelligence (file indexing, context optimization)
├─ agent-generation, template-generation
└─ vscode-lm-tools (MCP server)

Frontend (5)
├─ core (AppStateManager, VSCodeService, ChatService)
├─ chat (11 components: input, bubbles, streaming, sessions)
├─ ui (CDK Overlay: Dropdown, Popover, Autocomplete)
├─ dashboard, setup-wizard

Foundation (1)
└─ shared (types, 94 RPC messages, Result<T,E>)
```

### Constraints (ENFORCED)

- ❌ Frontend ≠ Backend (strict separation)
- ✅ All import types from `@ptah-extension/shared`
- ✅ No circular deps (Nx enforced)
- ✅ Flow: Apps → Features → Core → Foundation

**Validate**: `nx graph` | `nx affected:graph` | `nx lint --fix`

## 📋 File Organization

### Backend

**Location**: `libs/backend/<domain>/src/lib/services/`  
**Pattern**: Injectable with DI tokens  
**Example**: `libs/backend/agent-sdk/src/lib/services/session-manager.service.ts`

### Frontend

**Location**: `libs/frontend/<domain>/src/lib/components/<name>/`  
**Pattern**: Standalone + OnPush  
**Example**: `libs/frontend/chat/src/lib/components/chat-input/chat-input.component.ts`

### Shared

**Location**: `libs/shared/src/lib/types/<domain>.types.ts`  
**Pattern**: Types only, NO implementation  
**Example**: `libs/shared/src/lib/types/rpc.types.ts` (94 message types)

### Tests

**Location**: Co-located `*.spec.ts`  
**Coverage**: 80% min  
**Example**: `message-sender.service.spec.ts`

## 🎨 Naming

| Type          | Convention         | Example                            |
| ------------- | ------------------ | ---------------------------------- |
| Files         | kebab-case         | `message-sender.service.ts`        |
| Classes       | PascalCase         | `MessageSenderService`             |
| Functions     | camelCase          | `sendMessage()`                    |
| Constants     | UPPER_SNAKE        | `MAX_TOKEN_LIMIT`                  |
| Interfaces    | PascalCase, NO "I" | `ChatMessage` (not `IChatMessage`) |
| Branded Types | PascalCase         | `SessionId`, `MessageId`           |

### Branded Types (Type Safety)

```typescript
type SessionId = Brand<string, 'SessionId'>;
type MessageId = Brand<string, 'MessageId'>;

const sessionId: SessionId = 'sess-123' as SessionId;
const messageId: MessageId = 'msg-456' as MessageId;

// ❌ Compile error - prevents bugs!
const wrong: SessionId = messageId;
```

## 🔧 Commands

### Build

```bash
npm install                    # Install
npm run build:all              # All projects
nx build <project>             # Specific
npm run dev                    # Watch all
```

### Test

```bash
npm run test:all               # All
nx test <library>              # Specific
nx affected:test               # Affected only
nx test <lib> --coverage       # With coverage
```

### Lint

```bash
npm run lint:all               # All
npm run lint:fix               # Auto-fix
nx typecheck:affected          # Type-check
```

### Graph

```bash
nx graph                       # Full graph
nx affected:graph              # Affected
```

## 📝 Commits (ENFORCED)

**Format**: `<type>(<scope>): <subject>`

**Types**: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert  
**Scopes**: webview|vscode|vscode-lm-tools|deps|ci|docs|hooks|scripts

**Rules**: lowercase, 3-72 chars, no period, imperative

**Examples**:

```bash
✅ feat(webview): add semantic search
✅ fix(vscode): resolve webview timeout
✅ chore(deps): update @angular/core to v20.1.2

❌ feat: Add search                # No scope
❌ feat(webview): Add search.       # Period
❌ feat(webview): Added search      # Past tense
```

**Hooks**: lint-staged, typecheck:affected, commitlint  
**NEVER --no-verify without user approval**

### Hook Failure Protocol

When hook fails, ask user:

1. Fix Issue (lint/type/format errors)
2. Bypass Hook (--no-verify for unrelated errors)
3. Stop & Report (critical issues)

## 🧠 Core Patterns

### 1. Error Handling (Backend)

**Use**: `Result<T, E>` - NO thrown exceptions

```typescript
import { Result } from '@ptah-extension/shared';

function loadFile(path: string): Result<Data, FileError> {
  if (!exists(path)) {
    return Result.err({ code: 'NOT_FOUND', path });
  }
  return Result.ok(parseFile(path));
}

// Usage
const result = loadFile('/path');
if (Result.isOk(result)) {
  process(result.value);
} else {
  handleError(result.error);
}
```

### 2. State Management (Frontend)

**Use**: Signals - NOT RxJS BehaviorSubject

```typescript
import { signal } from '@angular/core';

export class ChatService {
  private readonly _messages = signal<Message[]>([]);
  readonly messages = this._messages.asReadonly();

  addMessage(msg: Message): void {
    this._messages.update(msgs => [...msgs, msg]);
  }
}

// ❌ Bad - RxJS (avoid!)
private messages$ = new BehaviorSubject<Message[]>([]);
```

### 3. Dependency Injection (Backend)

**Use**: tsyringe with TOKENS from vscode-core

```typescript
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

@injectable()
export class SessionService {
  constructor(@inject(TOKENS.logger) private logger: Logger, @inject(TOKENS.eventBus) private eventBus: EventBus) {}

  async create(): Promise<Result<SessionId, Error>> {
    this.logger.info('Creating session');
    const result = await this.doCreate();

    if (Result.isOk(result)) {
      this.eventBus.publish('session:created', { id: result.value });
    }
    return result;
  }
}

// Register
container.registerSingleton(TOKENS.sessionService, SessionService);
```

### 4. EventBus Pattern (Backend)

```typescript
// Publish
this.eventBus.publish('session:created', {
  sessionId: id,
  timestamp: Date.now(),
});

// Subscribe
this.eventBus.subscribe('session:created', (data) => {
  this.onSessionCreated(data);
});

// Naming: <domain>:<action> (past tense)
// session:created, message:sent, stream:started
```

### 5. VS Code Communication (Frontend)

```typescript
import { VSCodeService } from '@ptah-extension/core';

export class ChatComponent {
  private readonly vscode = inject(VSCodeService);

  sendMessage(msg: string): void {
    this.vscode.postMessage({
      type: 'chat:start',
      payload: { message: msg, model: this.model() },
    });
  }

  ngOnInit(): void {
    this.vscode.onMessage<StreamingResponse>('chat:streaming', (res) => this.appendToken(res.token));
  }
}
```

## 🗺️ Quick Reference

### Find Code

| Feature              | Location                                        |
| -------------------- | ----------------------------------------------- |
| Extension activation | `apps/ptah-extension-vscode/src/extension.ts`   |
| Webview bootstrap    | `apps/ptah-extension-webview/src/main.ts`       |
| Chat UI              | `libs/frontend/chat/src/lib/components/`        |
| CDK components       | `libs/frontend/ui/src/lib/overlays/`            |
| Frontend services    | `libs/frontend/core/src/lib/services/`          |
| Backend services     | `libs/backend/<domain>/src/lib/services/`       |
| Types                | `libs/shared/src/lib/types/`                    |
| RPC protocol         | `libs/shared/src/lib/types/rpc.types.ts`        |
| DI tokens            | `libs/backend/vscode-core/src/lib/di/tokens.ts` |

### Imports

```typescript
// Foundation
'@ptah-extension/shared'; // Types, 94 RPC messages

// Backend
'@ptah-extension/vscode-core'; // DI, EventBus, Logger
'@ptah-extension/agent-sdk'; // Claude Agent SDK
'@ptah-extension/llm-abstraction'; // Multi-provider LLM
'@ptah-extension/workspace-intelligence'; // File indexing
'@ptah-extension/vscode-lm-tools'; // MCP server

// Frontend
'@ptah-extension/core'; // Services, state
'@ptah-extension/chat'; // Chat UI
'@ptah-extension/ui'; // CDK Overlay
'@ptah-extension/dashboard'; // Metrics
'@ptah-extension/setup-wizard'; // Setup
```

### Common Tasks

| Task                | Start Here                                      |
| ------------------- | ----------------------------------------------- |
| Add chat feature    | `libs/frontend/chat/` + `libs/frontend/core/`   |
| Add backend service | `libs/backend/<domain>/services/` + register DI |
| Add UI component    | `libs/frontend/ui/src/lib/`                     |
| Add RPC message     | `libs/shared/src/lib/types/rpc.types.ts`        |
| Add DI token        | `libs/backend/vscode-core/src/lib/di/tokens.ts` |

## 📊 Stats

- **Projects**: 15 (2 apps, 13 libs)
- **Backend**: 7 libs
- **Frontend**: 5 libs
- **Shared**: 1 lib
- **Files**: ~360 TS files, ~145 spec files
- **Coverage**: 80% min
- **RPC Messages**: 94 types
- **DI Tokens**: 60+

---

**Per-library docs**: See library-specific .md files (vscode-core.md, chat.md, ui.md, shared.md, workspace-int.md, core.md) that activate via glob patterns.
