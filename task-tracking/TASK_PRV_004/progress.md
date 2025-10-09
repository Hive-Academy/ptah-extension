# Implementation Progress - TASK_PRV_004

**Task**: Extract Claude Domain Services to libs/backend/claude-domain/  
**Started**: 2025-10-09  
**Current Phase**: Backend Development (Phase 4)

## Implementation Checklist

### Step 1: Foundation Work (Type Setup & Core Modules)

- [x] Create `libs/shared/src/lib/types/claude-domain.types.ts` with permission & tool event types
- [x] Create `libs/backend/claude-domain/src/detector/claude-cli-detector.ts`
- [ ] Create `libs/backend/claude-domain/src/session/session-manager.ts`
- [ ] Create `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`
- [ ] Unit tests for detector, session manager, parser

### Step 2: Core Functionality (Launcher & Permissions)

- [ ] Create `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`
- [ ] Create `libs/backend/claude-domain/src/cli/process-manager.ts`
- [ ] Create `libs/backend/claude-domain/src/permissions/permission-service.ts`
- [ ] Create `libs/backend/claude-domain/src/permissions/permission-rules.store.ts`
- [ ] Create `libs/backend/claude-domain/src/events/claude-domain.events.ts`
- [ ] Unit tests for launcher, permissions, events

### Step 3: Integration (Wire into Extension)

- [ ] Create `libs/backend/claude-domain/src/index.ts` barrel exports
- [ ] Update `libs/shared/src/index.ts` to export new claude-domain types
- [ ] Modify `apps/ptah-extension-vscode/src/services/claude-cli.service.ts` (deprecation shim)
- [ ] Modify `apps/ptah-extension-vscode/src/services/claude-cli-detector.service.ts` (alias)
- [ ] Modify `apps/ptah-extension-vscode/src/services/ai-providers/provider-factory.ts`
- [ ] Modify `apps/ptah-extension-vscode/src/services/ai-providers/claude-cli-provider-adapter.ts`
- [ ] Modify `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts`

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
- [x] `libs/backend/claude-domain/src/detector/claude-cli-detector.ts` - Created WSL-aware detector

## Current Focus

Step 1 in progress: Creating session manager and JSONL parser

## Blockers

None at this time.

## Time Tracking

- Pre-implementation review: 10 min
- Type setup: (in progress)
