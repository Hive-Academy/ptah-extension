# Implementation Progress - TASK_PRV_004

**Task**: Extract Claude Domain Services to libs/backend/claude-domain/
**Started**: 2025-10-09
**Current Phase**: Backend Development (Phase 4)

## Implementation Checklist

### Step 1: Foundation Work (Type Setup & Core Modules)

- [x] Create `libs/shared/src/lib/types/claude-domain.types.ts` with permission & tool event types
- [x] Create `libs/backend/claude-domain/src/detector/claude-cli-detector.ts`
- [x] Create `libs/backend/claude-domain/src/session/session-manager.ts`
- [x] Create `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`
- [ ] Unit tests for detector, session manager, parser

### Step 2: Core Functionality (Launcher & Permissions)

- [x] Create `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`
- [x] Create `libs/backend/claude-domain/src/cli/process-manager.ts`
- [x] Create `libs/backend/claude-domain/src/permissions/permission-service.ts`
- [x] Create `libs/backend/claude-domain/src/permissions/permission-rules.store.ts`
- [x] Create `libs/backend/claude-domain/src/events/claude-domain.events.ts`
- [ ] Unit tests for launcher, permissions, events

### Step 3: DI Container Integration (MONSTER Week 5)

- [x] Create `libs/backend/claude-domain/src/index.ts` barrel exports
- [x] Update `libs/shared/src/index.ts` to export new claude-domain types
- [x] Add claude-domain tokens to `libs/backend/vscode-core/src/di/tokens.ts`
- [x] Register claude-domain services in `libs/backend/vscode-core/src/di/container.ts`
- [ ] Update `libs/backend/ai-providers-core` to use claude-domain via DI
- [ ] Wire claude-domain events into EventBus for webview communication

### Step 4: Testing & Validation

- [ ] Run `npm run typecheck:all` - no new errors
- [ ] Run `npm run lint:all` - no violations
- [ ] Run `npm run test:all` - ≥80% coverage for new modules
- [ ] Run `npm run build:extension` - successful build
- [ ] Manual smoke test: streaming responses
- [ ] Manual smoke test: permission prompts
- [ ] Manual smoke test: session resume
- [ ] Manual smoke test: WSL detection (if applicable)

## Type/Schema Decisions

### Reused Types (from libs/shared)

- ✅ `SessionId` - from `branded.types.ts`
- ✅ `MessageId` - from `branded.types.ts`
- ✅ `StrictChatMessage` - from `message.types.ts`
- ✅ `ProviderHealth` - from `ai-provider.types.ts`
- ✅ `AISessionConfig` - from `ai-provider.types.ts`

### New Types (to create)

- `ClaudePermissionRule` - permission rule schema
- `ClaudePermissionDecision` - allow/deny/always_allow decision
- `ClaudeToolEvent` - typed tool lifecycle events
- `ClaudeContentChunk` - streaming content chunks
- `ClaudeThinkingEvent` - thinking/reasoning content

## Files Modified

- [x] `libs/shared/src/lib/types/claude-domain.types.ts` - Created comprehensive permission, tool event, and CLI types
- [x] `libs/shared/src/index.ts` - Exported new claude-domain types
- [x] `libs/backend/claude-domain/src/detector/claude-cli-detector.ts` - Created WSL-aware detector + @injectable
- [x] `libs/backend/claude-domain/src/session/session-manager.ts` - Session lifecycle management with resume support + @injectable
- [x] `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` - JSONL parser with event callbacks
- [x] `libs/backend/claude-domain/src/cli/process-manager.ts` - Child process lifecycle management + @injectable
- [x] `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts` - Main orchestrator integrating all services
- [x] `libs/backend/claude-domain/src/permissions/permission-service.ts` - YOLO mode + always-allow rules + @injectable
- [x] `libs/backend/claude-domain/src/permissions/permission-rules.store.ts` - Permission persistence abstraction
- [x] `libs/backend/claude-domain/src/events/claude-domain.events.ts` - Typed event publishers + @injectable
- [x] `libs/backend/claude-domain/src/index.ts` - Barrel exports for all public APIs
- [x] `libs/backend/vscode-core/src/di/tokens.ts` - Added 6 new DI tokens for claude-domain
- [x] `libs/backend/vscode-core/src/di/container.ts` - Registered all claude-domain services with TSyringe

## Current Focus

✅ **Steps 1-2 Complete**: Foundation & core functionality built
🔄 **Step 3 In Progress**: DI container integration (60% complete)
⏭️ **Next**: Update ai-providers-core to consume claude-domain via DI

## Context

**MONSTER Architecture Status**:

- ✅ Weeks 1-4: TSyringe DI, RxJS EventBus, VS Code API wrappers, Provider infrastructure - COMPLETE
- 🔄 Week 5: Claude Domain Separation - IN PROGRESS (foundation complete, integration pending)

**What We Built**:

- `libs/backend/claude-domain/` with 11 modules (~1,800 LOC)
- WSL-aware CLI detection, session management with resume, YOLO permissions
- JSONL stream parsing, typed events, process lifecycle management

**What's Next**:

- Register claude-domain services in DI container (not shim old services)
- Wire into NEW provider system via TSyringe dependency injection
- Integrate events with RxJS EventBus for webview communication

## Blockers

None at this time.

## Time Tracking

- Pre-implementation review: 10 min
- Type setup & Step 1 (foundation): 2 hours
- Step 2 (core functionality): 2.5 hours
- **Total so far**: ~5 hours
- **Remaining**: Step 3 DI integration (~1.5 hours), Step 4 testing (~1 hour)
