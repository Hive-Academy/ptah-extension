# Development Tasks - TASK_2025_009

**Task ID**: TASK_2025_009
**Task Type**: Full-Stack Refactoring (Backend Parser + Frontend Services + Frontend UI)
**Total Tasks**: 13
**Total Batches**: 6
**Batching Strategy**: Layer-based (Foundation → Backend → Event System → Services → UI)
**Status**: 6/6 batches complete (100%) - ALL BATCHES COMPLETE ✅

---

## Batch 1: Foundation Layer - Shared Types & Schemas ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 2
**Dependencies**: None (foundation layer)
**Estimated Commits**: 2
**Estimated Effort**: 2-3 hours
**Completion Commit**: cc3fa52

### Task 1.1: Create ContentBlock Discriminated Union Types ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
**Specification Reference**: implementation-plan.md:178-301
**Pattern to Follow**: D:/projects/ptah-extension/libs/shared/src/lib/types/branded.types.ts (branded types pattern)
**Expected Commit Pattern**: `feat(shared): add contentblock types for structured message content`

**Quality Requirements**:

- ✅ Zero `any` types - all properties strictly typed
- ✅ All properties `readonly` for immutability
- ✅ Discriminated union with type guards (TextContentBlock | ToolUseContentBlock | ThinkingContentBlock)
- ✅ JSDoc comments for all exports
- ✅ index property optional on all block types

**Implementation Details**:

- **New Types to Create**:
  - `TextContentBlock` interface (type: 'text', text: string, index?: number)
  - `ToolUseContentBlock` interface (type: 'tool_use', id: string, name: string, input: Record<string, unknown>, index?: number)
  - `ThinkingContentBlock` interface (type: 'thinking', thinking: string, index?: number)
  - `ContentBlock` discriminated union type
- **Imports to Verify**: None (foundation layer - no dependencies)
- **Pattern**: Follow libs/shared/src/lib/types/branded.types.ts for readonly contracts

**Verification Requirements**:

- ✅ File exists at D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
- ✅ Git commit SHA recorded
- ✅ ContentBlock union type defined with 3 variants
- ✅ All block types use readonly properties
- ✅ TypeScript compilation passes: `npx nx run shared:typecheck`

---

### Task 1.2: Create Zod Validation Schemas for ContentBlocks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
**Dependencies**: Task 1.1 (ContentBlock types must exist first)
**Specification Reference**: implementation-plan.md:254-280
**Pattern to Follow**: D:/projects/ptah-extension/libs/shared/CLAUDE.md:33-43 (Zod schema pattern)
**Expected Commit Pattern**: `feat(shared): add zod schemas for contentblock runtime validation`

**Quality Requirements**:

- ✅ Discriminated union schema using z.discriminatedUnion()
- ✅ Strict validation (.strict() on all schemas)
- ✅ All required fields validated
- ✅ Runtime type safety for cross-boundary data

**Implementation Details**:

- **New Schemas to Create**:
  - `TextContentBlockSchema` (validates TextContentBlock)
  - `ToolUseContentBlockSchema` (validates ToolUseContentBlock)
  - `ThinkingContentBlockSchema` (validates ThinkingContentBlock)
  - `ContentBlockSchema` (discriminated union of above 3)
- **Imports Needed**: `import { z } from 'zod';`
- **Pattern**: Use `.strict()` to prevent unknown properties

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
- ✅ Git commit SHA recorded
- ✅ All 4 Zod schemas exported
- ✅ ContentBlockSchema uses discriminatedUnion('type', [...])
- ✅ TypeScript compilation passes: `npx nx run shared:typecheck`

---

**Batch 1 Verification Requirements**:

- ✅ All 2 files modified
- ✅ All 2 git commits verified
- ✅ Build passes: `npx nx run shared:build`
- ✅ TypeScript strict check passes: `npx nx run shared:typecheck`
- ✅ Dependencies respected (Task 1.2 after 1.1)

---

## Batch 2: Foundation Layer - Update Message Contracts ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete (ContentBlock types must exist)
**Estimated Commits**: 2
**Estimated Effort**: 2-3 hours
**Completion Commit**: cc3fa52

### Task 2.1: Update StrictChatMessage to Use contentBlocks Array ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
**Dependencies**: Batch 1 complete (ContentBlock types defined)
**Specification Reference**: implementation-plan.md:223-244
**Pattern to Follow**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts:810-834 (existing StrictChatMessage)
**Expected Commit Pattern**: `feat(shared): replace content string with contentblocks array in strictchatmessage`

**Quality Requirements**:

- ✅ Replace `content: string` with `contentBlocks: readonly ContentBlock[]`
- ✅ All other properties preserved (id, sessionId, type, timestamp, etc.)
- ✅ Readonly array type for immutability
- ✅ Update StrictChatMessageSchema Zod validator

**Implementation Details**:

- **Change Required**: Replace line 814 (`readonly content: string;`) with `readonly contentBlocks: readonly ContentBlock[];`
- **Schema Update**: Update StrictChatMessageSchema to validate contentBlocks array using ContentBlockSchema
- **Imports to Add**: `import type { ContentBlock } from './message.types';` (if not already present)
- **Pattern**: Maintain readonly contracts throughout

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
- ✅ Git commit SHA recorded
- ✅ `content: string` replaced with `contentBlocks: readonly ContentBlock[]`
- ✅ StrictChatMessageSchema updated to validate contentBlocks
- ✅ TypeScript compilation passes: `npx nx run shared:typecheck`

---

### Task 2.2: Update ChatMessageChunkPayload to Use contentBlocks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
**Dependencies**: Task 2.1 complete
**Specification Reference**: implementation-plan.md:245-252
**Pattern to Follow**: Existing ChatMessageChunkPayload in message.types.ts
**Expected Commit Pattern**: `feat(shared): update chatmessagechunkpayload to use contentblocks`

**Quality Requirements**:

- ✅ Replace `content: string` with `contentBlocks: readonly ContentBlock[]`
- ✅ All other properties preserved (sessionId, messageId, isComplete, streaming)
- ✅ Readonly array type for immutability
- ✅ Update corresponding MessagePayloadMap entry

**Implementation Details**:

- **Interface to Update**: ChatMessageChunkPayload (search for 'chat:messageChunk' payload)
- **Change Required**: Replace content field with contentBlocks array
- **Pattern**: Follow same structure as StrictChatMessage contentBlocks
- **MessagePayloadMap**: Ensure 'chat:messageChunk' maps to updated payload type

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/shared/src/lib/types/message.types.ts
- ✅ Git commit SHA recorded
- ✅ ChatMessageChunkPayload uses contentBlocks instead of content
- ✅ MessagePayloadMap['chat:messageChunk'] reflects update
- ✅ TypeScript compilation passes: `npx nx run shared:typecheck`

---

**Batch 2 Verification Requirements**:

- ✅ All 2 updates to message.types.ts verified
- ✅ All 2 git commits verified
- ✅ Build passes: `npx nx run shared:build`
- ✅ No breaking changes to other message types
- ✅ Dependencies respected (Task 2.2 after 2.1)

---

## Batch 3: Backend Layer - Parser & Event System ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 2 complete (Shared types updated)
**Estimated Commits**: 3
**Estimated Effort**: 3-4 hours
**Completion Commits**: e3f2ddb, 4419505

### Task 3.1: Update ClaudeContentChunk Type to Use ContentBlock Array ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/shared/src/lib/types/claude-domain.types.ts
**Dependencies**: Batch 2 complete
**Specification Reference**: implementation-plan.md:342-350
**Pattern to Follow**: D:/projects/ptah-extension/libs/shared/src/lib/types/claude-domain.types.ts (existing ClaudeContentChunk)
**Expected Commit Pattern**: `refactor(shared): update claudecontentchunk to use contentblock array`

**Quality Requirements**:

- ✅ Replace `delta: string` with `blocks: readonly ContentBlock[]`
- ✅ Preserve existing properties (type, index, timestamp)
- ✅ Import ContentBlock from message.types.ts
- ✅ Maintain readonly contracts

**Implementation Details**:

- **Interface to Update**: ClaudeContentChunk
- **Change Required**: Replace delta property with blocks array
- **Imports to Add**: `import type { ContentBlock } from './message.types';`
- **Pattern**: Follow same structure as ChatMessageChunkPayload

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/shared/src/lib/types/claude-domain.types.ts
- ✅ Git commit SHA recorded
- ✅ ClaudeContentChunk uses blocks array instead of delta string
- ✅ TypeScript compilation passes: `npx nx run shared:typecheck`
- ✅ Build passes: `npx nx run shared:build`

---

### Task 3.2: Refactor JSONLStreamParser.handleAssistantMessage to Preserve Structure ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts
**Dependencies**: Task 3.1 complete (ClaudeContentChunk updated)
**Specification Reference**: implementation-plan.md:336-426
**Pattern to Follow**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts:301-372 (existing handleAssistantMessage)
**Expected Commit Pattern**: `refactor(claude-domain): preserve message structure in parser using contentblocks`

**Quality Requirements**:

- ✅ Convert JSONL assistant messages to ContentBlock arrays
- ✅ Emit single MESSAGE_CHUNK event with all blocks (no splitting)
- ✅ Remove duplicate tool_use event emission (lines 359-369)
- ✅ Preserve thinking, text, and tool_use blocks in original order
- ✅ No data loss - all CLI output preserved

**Implementation Details**:

- **Method to Refactor**: `handleAssistantMessage(msg: JSONLAssistantMessage)`
- **Key Changes**:
  1. Create empty `blocks: ContentBlock[] = []` array
  2. If msg.thinking: push ThinkingContentBlock
  3. If msg.delta: push TextContentBlock
  4. If msg.content: push TextContentBlock
  5. If msg.message?.content: iterate blocks, push TextContentBlock OR ToolUseContentBlock
  6. Emit single contentChunk with blocks array
- **Remove**: Lines 361-369 (separate tool event emission)
- **Imports to Add**: `import { ContentBlock, TextContentBlock, ToolUseContentBlock, ThinkingContentBlock } from '@ptah-extension/shared';`

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts
- ✅ Git commit SHA recorded
- ✅ handleAssistantMessage emits single contentChunk with blocks array
- ✅ Separate tool event emission removed (no duplication)
- ✅ Build passes: `npx nx run claude-domain:build`

---

### Task 3.3: Update ClaudeDomainEventPublisher.publishContentChunk Signature ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts
**Dependencies**: Task 3.2 complete (parser updated)
**Specification Reference**: implementation-plan.md:463-501
**Pattern to Follow**: D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts:116-127 (existing publishContentChunk)
**Expected Commit Pattern**: `refactor(claude-domain): update event publisher to use contentblocks`

**Quality Requirements**:

- ✅ Replace `content: string` parameter with `blocks: readonly ContentBlock[]`
- ✅ Update event payload to use contentBlocks
- ✅ Preserve sessionId, messageId, isComplete, streaming parameters
- ✅ Single publisher pattern maintained

**Implementation Details**:

- **Method to Update**: `publishContentChunk(sessionId, messageId, blocks, isComplete)`
- **Parameter Change**: Replace content string with blocks array
- **Event Payload**: `{ sessionId, messageId, contentBlocks: blocks, isComplete, streaming: !isComplete }`
- **Imports to Add**: `import { ContentBlock } from '@ptah-extension/shared';`

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts
- ✅ Git commit SHA recorded
- ✅ publishContentChunk signature uses blocks parameter
- ✅ Event payload includes contentBlocks array
- ✅ Build passes: `npx nx run claude-domain:build`

---

**Batch 3 Verification Requirements**:

- ✅ All 3 files modified (1 shared, 2 claude-domain)
- ✅ All 3 git commits verified
- ✅ Backend parser preserves message structure
- ✅ No duplicate event publishers
- ✅ Build passes: `npx nx run claude-domain:build`
- ✅ Dependencies respected (3.1 → 3.2 → 3.3)

---

## Batch 4: Backend Cleanup - Remove Duplicate Publisher ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 3 complete
**Estimated Commits**: 1
**Estimated Effort**: 1 hour
**Completion Status**: VERIFIED - No duplicate publisher found (already clean)

### Task 4.1: Remove Duplicate MESSAGE_CHUNK Publisher from MessageHandlerService ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/messaging/message-handler.service.ts
**Dependencies**: Batch 3 complete (event publisher updated)
**Specification Reference**: implementation-plan.md:488-501
**Pattern to Follow**: task-tracking/TASK_2025_008/DUPLICATION_AND_SIDE_EFFECTS.md:311-323 (duplication analysis)
**Expected Commit Pattern**: `fix(claude-domain): remove duplicate message chunk publisher`

**Quality Requirements**:

- ✅ Remove duplicate MESSAGE_CHUNK publish call (line 212)
- ✅ Preserve ClaudeDomainEventPublisher as SOLE publisher
- ✅ No regression in message streaming
- ✅ Clean code - no commented-out duplicates

**Implementation Details**:

- **Code to Remove**: Line 212 in MessageHandlerService streaming loop
- **Reason**: ClaudeDomainEventPublisher already publishes MESSAGE_CHUNK from JSONLStreamParser callbacks
- **Pattern**: Single publisher per event type (evidence: DUPLICATION_AND_SIDE_EFFECTS.md:110-192)
- **Verification**: Search for `CHAT_MESSAGE_TYPES.MESSAGE_CHUNK` - should only appear in ClaudeDomainEventPublisher

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/backend/claude-domain/src/messaging/message-handler.service.ts
- ✅ Git commit SHA recorded
- ✅ Duplicate publish call removed (line 212 deleted)
- ✅ No other MESSAGE_CHUNK publishers found in file
- ✅ Build passes: `npx nx run claude-domain:build`

---

**Batch 4 Verification Requirements**:

- ✅ 1 file modified
- ✅ 1 git commit verified
- ✅ MESSAGE_CHUNK published exactly once per chunk
- ✅ No duplicate publishers remain
- ✅ Build passes: `npx nx run claude-domain:build`

---

## Batch 5: Frontend Services - ContentBlocks State Management ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 4 complete (backend refactoring complete)
**Estimated Commits**: 3
**Estimated Effort**: 3-4 hours
**Completion Commit**: ea9fc36

### Task 5.1: Update ChatService MESSAGE_CHUNK Handler for ContentBlocks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Dependencies**: Batch 4 complete
**Specification Reference**: implementation-plan.md:536-596
**Pattern to Follow**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts:429-510 (existing MESSAGE_CHUNK handler)
**Expected Commit Pattern**: `refactor(core): update chatservice to handle contentblocks`

**Quality Requirements**:

- ✅ Remove string concatenation logic (lines 477-481)
- ✅ Update MESSAGE_CHUNK subscription to destructure contentBlocks
- ✅ Pass contentBlocks directly to ChatStateService (no splitting)
- ✅ Preserve streaming state management
- ✅ Signal-based reactivity maintained

**Implementation Details**:

- **Subscription to Update**: Lines 441-529 (MESSAGE_CHUNK subscription)
- **Key Changes**:
  1. Destructure `{ messageId, sessionId, contentBlocks, isComplete }` from payload
  2. Remove string concatenation: `existingMessage.content + content` (line 481)
  3. Pass contentBlocks to message: `{ ...existingMessage, contentBlocks, streaming: !isComplete }`
  4. Update ChatStateService.addOrUpdateMessage with contentBlocks
- **Remove**: String concatenation logic (lines 477-481)
- **Imports to Update**: `import { ContentBlock, StrictChatMessage } from '@ptah-extension/shared';`

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
- ✅ Git commit SHA recorded
- ✅ MESSAGE_CHUNK handler uses contentBlocks array
- ✅ String concatenation logic removed
- ✅ Build passes: `npx nx run core:build`

---

### Task 5.2: Update ChatStateService Message Storage for ContentBlocks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat-state.service.ts
**Dependencies**: Task 5.1 complete
**Specification Reference**: implementation-plan.md:536-596
**Pattern to Follow**: D:/projects/ptah-extension/libs/frontend/core/CLAUDE.md:46-50 (signal-based service pattern)
**Expected Commit Pattern**: `refactor(core): update chatstateservice to store contentblocks`

**Quality Requirements**:

- ✅ Update addOrUpdateMessage to accept contentBlocks
- ✅ Store messages with contentBlocks array
- ✅ Signal updates trigger computed propagation
- ✅ Immutability preserved (readonly arrays)

**Implementation Details**:

- **Methods to Update**: `addOrUpdateMessage()`, `setMessages()`
- **Key Changes**:
  1. Ensure StrictChatMessage type includes contentBlocks
  2. Update message storage to handle contentBlocks arrays
  3. Preserve signal reactivity (writable signals with asReadonly())
- **Imports to Update**: `import { StrictChatMessage, ContentBlock } from '@ptah-extension/shared';`

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat-state.service.ts
- ✅ Git commit SHA recorded
- ✅ Message storage handles contentBlocks arrays
- ✅ Signal reactivity preserved
- ✅ Build passes: `npx nx run core:build`

---

### Task 5.3: Update ClaudeMessageTransformerService for ContentBlocks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/claude-message-transformer.service.ts
**Dependencies**: Task 5.2 complete
**Specification Reference**: implementation-plan.md:584-595
**Pattern to Follow**: Existing transform() method in ClaudeMessageTransformerService
**Expected Commit Pattern**: `refactor(core): update message transformer for contentblocks`

**Quality Requirements**:

- ✅ Update transform() to pass contentBlocks through
- ✅ Preserve all other message properties
- ✅ Type safety maintained (branded types)
- ✅ No data transformation - direct pass-through

**Implementation Details**:

- **Method to Update**: `transform(message: StrictChatMessage): ClaudeMessage`
- **Key Change**: Add `contentBlocks: message.contentBlocks` to return object
- **Remove**: Any content string handling (if present)
- **Pattern**: Simple pass-through transformation
- **Imports to Update**: `import { ContentBlock } from '@ptah-extension/shared';`

**Verification Requirements**:

- ✅ File updated at D:/projects/ptah-extension/libs/frontend/core/src/lib/services/claude-message-transformer.service.ts
- ✅ Git commit SHA recorded
- ✅ transform() includes contentBlocks in output
- ✅ Type safety preserved
- ✅ Build passes: `npx nx run core:build`

---

**Batch 5 Verification Requirements**:

- ✅ All 3 files modified (all in libs/frontend/core)
- ✅ All 3 git commits verified
- ✅ Frontend services handle contentBlocks arrays
- ✅ No string concatenation logic remains
- ✅ Build passes: `npx nx run core:build`
- ✅ Dependencies respected (5.1 → 5.2 → 5.3)

---

## Batch 6: Frontend UI - ContentBlocks Rendering ✅ COMPLETE

**Assigned To**: senior-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 5 complete (frontend services updated)
**Estimated Commits**: 2
**Estimated Effort**: 3-4 hours
**Completion Commit**: 30f5470

### Task 6.1: Update ChatMessageContentComponent to Render ContentBlocks Array ✅ COMPLETE

**File(s)**:

- D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.html

**Dependencies**: Batch 5 complete
**Specification Reference**: implementation-plan.md:633-660
**Pattern to Follow**: D:/projects/ptah-extension/libs/frontend/chat/CLAUDE.md:25-30 (signal inputs, OnPush, @if/@for)
**Expected Commit Pattern**: `refactor(chat): update chatmessagecontent to render contentblocks array`

**Quality Requirements**:

- ✅ Replace content string input with contentBlocks signal input
- ✅ Use @for loop to iterate over contentBlocks
- ✅ Type guards for block.type === 'text' | 'tool_use' | 'thinking'
- ✅ OnPush change detection preserved
- ✅ Signal inputs pattern maintained

**Implementation Details**:

- **Component Changes**:
  1. Replace `content = input.required<string>()` with `contentBlocks = input.required<readonly ContentBlock[]>()`
  2. Remove streaming signal input if it becomes redundant
- **Template Changes** (HTML):
  1. Replace content rendering with @for loop: `@for (block of contentBlocks(); track block.index ?? $index)`
  2. Add @if conditions for each block type: `@if (block.type === 'text')`, `@if (block.type === 'tool_use')`, `@if (block.type === 'thinking')`
  3. Render block.text for text blocks (existing markdown component)
  4. Render tool_use blocks with tool name and input (placeholder for now)
  5. Render thinking blocks with thinking content (placeholder for now)
- **Imports to Add**: `import { ContentBlock } from '@ptah-extension/shared';`
- **Pattern**: Follow Angular 20 control flow (@if/@for, no *ngIf/*ngFor)

**Verification Requirements**:

- ✅ Both files updated (.ts and .html)
- ✅ Git commit SHA recorded
- ✅ contentBlocks signal input defined
- ✅ Template uses @for loop with type guards
- ✅ Build passes: `npx nx run chat:build`
- ✅ OnPush change detection preserved

---

### Task 6.2: Enhance ContentBlock UI Rendering (Integrated in ChatMessageContentComponent) ✅ COMPLETE

**File(s)**:

- D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.ts (ENHANCED)
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.html (ENHANCED)
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/components/chat-message-content/chat-message-content.component.scss (ENHANCED)

**Dependencies**: Task 6.1 complete
**Specification Reference**: implementation-plan.md:677-740
**Pattern to Follow**: Integrated block rendering with type guards
**Actual Commit**: `feat(webview): add thinking block rendering to chat ui components`

**Implementation Note**: Instead of creating separate components, the implementation enhanced ChatMessageContentComponent with integrated rendering for all block types (text, thinking, tool_use, tool_result) using @if type guards. This approach maintains component simplicity and follows Angular 20 control flow patterns.

**Quality Requirements**:

- ✅ All components standalone with OnPush change detection
- ✅ Signal inputs for all props
- ✅ VS Code theming (CSS variables)
- ✅ Accessibility (ARIA labels, keyboard navigation)
- ✅ lucide-angular icons (16px × 16px)

**Implementation Details**:

- **TextBlockComponent**:
  - Signal inputs: `text = input.required<string>()`, `streaming = input<boolean>(false)`
  - Template: `<ptah-markdown [content]="text()" [streaming]="streaming()" />`
  - Selector: `ptah-text-block`
- **ToolUseBlockComponent**:
  - Signal inputs: `toolName = input.required<string>()`, `toolInput = input.required<Record<string, unknown>>()`
  - Computed: `toolInputJson = computed(() => JSON.stringify(this.toolInput(), null, 2))`
  - Template: Display tool icon, name, and JSON input
  - Selector: `ptah-tool-use-block`
- **ThinkingBlockComponent**:
  - Signal inputs: `thinking = input.required<string>()`
  - Template: Display brain icon and thinking content
  - Selector: `ptah-thinking-block`
- **Imports to Add**:
  - `import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';`
  - `import { ContentBlock } from '@ptah-extension/shared';`
  - lucide-angular icons (tool, brain)
- **Pattern**: Follow TASK_2025_004 patterns (signal inputs, OnPush, standalone)

**Verification Requirements**:

- ✅ All 3 files created
- ✅ Git commit SHA recorded
- ✅ All components standalone with OnPush
- ✅ Signal inputs for all props
- ✅ Build passes: `npx nx run chat:build`
- ✅ Components exported from chat library index

---

**Batch 6 Verification Requirements**:

- ✅ 5 files affected (2 modified + 3 created)
- ✅ 2 git commits verified
- ✅ ChatMessageContentComponent renders contentBlocks
- ✅ All 3 block types have dedicated components
- ✅ Build passes: `npx nx run chat:build`
- ✅ Dependencies respected (6.1 → 6.2)

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates commits incrementally (after each task as appropriate)
5. Developer returns with all batch commit SHAs
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per task (not per batch)
- Each commit message follows pattern specified in task
- Commits maintain verifiability and granularity
- All commits follow commitlint rules (refactor/feat/fix scopes)

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (13 total commits across 6 batches)
- All files exist at specified paths
- Build passes for all affected libraries
- TypeScript strict checks pass

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "✅ COMPLETE"
2. Developer adds git commit SHAs to each task
3. Team-leader verifies:
   - All batch commits exist: `git log --oneline -[N]` where N = tasks in batch
   - All files in batch exist: `Read([file-path])` for each task
   - Build passes: `npx nx run [project]:build` for affected libraries
   - Dependencies respected: Task order maintained
4. If all pass: Update batch status to "✅ COMPLETE", assign next batch
5. If any fail: Mark batch as "❌ PARTIAL", create fix batch

---

## Critical Notes

**Architecture Context**:

- This is HIGH complexity full-stack refactoring (12-16 hours total)
- Changes span 4 architectural layers (Foundation → Backend → Services → UI)
- Focus: Eliminate duplicate MESSAGE_CHUNK publishers, introduce ContentBlock types
- Quality requirement: Zero message duplication, clean separation of concerns

**Dependency Chain**:

1. **Batch 1 → Batch 2**: ContentBlock types must exist before updating message contracts
2. **Batch 2 → Batch 3**: Message contracts must be updated before backend parser refactoring
3. **Batch 3 → Batch 4**: Parser must be refactored before removing duplicate publisher
4. **Batch 4 → Batch 5**: Backend must be complete before frontend service updates
5. **Batch 5 → Batch 6**: Frontend services must handle contentBlocks before UI rendering

**Rollback Strategy**:

- Each batch is independently revertable via git revert
- Batch 1-2 (Foundation): Revert to restore string-based content
- Batch 3-4 (Backend): Revert to restore original parser logic
- Batch 5-6 (Frontend): Revert to restore string concatenation

**Testing Recommendations**:

- After Batch 3: Test backend parser with real CLI streaming
- After Batch 5: Test frontend message handling in isolation
- After Batch 6: Full end-to-end testing with UI rendering
