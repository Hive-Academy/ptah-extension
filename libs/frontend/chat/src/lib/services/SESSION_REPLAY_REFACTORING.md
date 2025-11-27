# Session Replay Service - Refactoring Plan

## Current State (Post-Fix)

The `session-replay.service.ts` (~765 lines) now correctly handles:

- Agent grouping by `agentId` (not slug - slug is session-scoped!)
- Timestamp-based correlation between Task tool_uses and agents
- Warmup agent filtering
- Interrupted agent detection

## Key Insight

**Slug is SESSION-scoped, NOT agent-scoped!**
All agents spawned within a Claude CLI session share the same slug.
We must use `agentId` to distinguish between different agent invocations.

## Issues to Address

1. **14 `any` type warnings** - Raw JSONL fields accessed without types
2. **Repeated iteration patterns** - Similar loops across methods
3. **Long method** - `replaySession()` is still ~160 lines
4. **Inline type definitions** - Map types defined inline repeatedly

## Recommended Refactoring (Balanced Approach)

### 1. Add `RawJSONLMessage` Type (in shared library)

```typescript
// libs/shared/src/lib/types/raw-jsonl.types.ts

/**
 * Extended JSONL message with raw fields from Claude CLI.
 * These fields are not in the base JSONLMessage interface but
 * appear in actual session files.
 */
export interface RawJSONLMessage extends JSONLMessage {
  // Session/message identity
  uuid?: string;
  sessionId?: string;
  parentUuid?: string;

  // Agent-related (SESSION-SCOPED - all agents share same slug!)
  slug?: string;
  agentId?: string;
  isSidechain?: boolean;

  // Metadata
  isMeta?: boolean;
  timestamp?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  userType?: string;

  // Tool linking
  toolUseResult?: unknown;
}
```

**Benefit**: Eliminates all 14 `any` type warnings with one interface.

### 2. Extract Type Definitions to `chat.types.ts`

Move inline types to the existing types file:

```typescript
// Add to chat.types.ts

/**
 * Processed agent data ready for UI rendering
 */
export interface ProcessedAgentData {
  agentId: string;
  timestamp: number;
  summaryContent: string | null;
  executionMessages: JSONLMessage[];
}

/**
 * Task tool_use extracted from main session
 */
export interface TaskToolUse {
  toolUseId: string;
  timestamp: number;
  subagentType: string;
}
```

**Benefit**: Cleaner method signatures, reusable types.

### 3. Keep Single Service, Improve Structure

**DO NOT split into multiple services.** Instead, organize with clear sections:

```typescript
@Injectable({ providedIn: 'root' })
export class SessionReplayService {
  // ============================================================================
  // PUBLIC API
  // ============================================================================

  replaySession(mainMessages, agentSessions): ReplayResult {}

  // ============================================================================
  // PHASE 1: AGENT DATA EXTRACTION
  // ============================================================================

  private buildAgentDataMap(agentSessions): Map<string, ProcessedAgentData> {}
  private classifyAgentMessages(messages): ClassifiedAgentMessages {}

  // ============================================================================
  // PHASE 2: TASK EXTRACTION & CORRELATION
  // ============================================================================

  private extractTaskToolUses(mainMessages): TaskToolUse[] {}
  private extractTaskToolResults(mainMessages): Set<string> {}
  private correlateAgentsToTasks(tasks, agents): Map<string, string> {}

  // ============================================================================
  // PHASE 3: MESSAGE BUILDING
  // ============================================================================

  private processMainMessages(messages, context): ExecutionChatMessage[] {}
  private createAgentBubble(block, agentId, context): ExecutionChatMessage {}
  private createAssistantMessageFromTree(tree, id): ExecutionChatMessage {}

  // ============================================================================
  // PHASE 4: EXECUTION NODE PROCESSING
  // ============================================================================

  private processAgentExecutionMessages(messages, nodeMaps): ExecutionNode[] {}

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private extractTextContent(content): string {}
  private generateId(): string {}
}
```

**Benefit**: Clear organization without service proliferation.

### 4. Consider Future: Shared Parser (Optional)

If we find `JsonlMessageProcessor` and `SessionReplayService` duplicating parsing logic,
we could extract a small `JSONLParserUtils` class with static methods:

```typescript
// Only if duplication becomes a problem
export class JSONLParserUtils {
  static extractTextContent(content: unknown): string {}
  static extractToolResults(messages: RawJSONLMessage[]): Map<string, string> {}
  static hasToolUse(message: RawJSONLMessage): boolean {}
}
```

**Note**: Don't do this preemptively. Only if real duplication emerges.

## What NOT to Do

- ❌ Don't create separate `AgentCorrelator` service
- ❌ Don't create separate `MessageBuilder` service
- ❌ Don't create separate `JSONLParser` service
- ❌ Don't over-abstract for hypothetical future needs

## Implementation Priority

1. **High**: Add `RawJSONLMessage` type to eliminate `any` warnings
2. **Medium**: Move inline types to `chat.types.ts`
3. **Low**: Reorganize methods with section comments (already mostly done)
4. **Optional**: Extract `JSONLParserUtils` only if duplication found

## Estimated Effort

- Type definitions: ~30 minutes
- Refactoring methods: ~1 hour
- Testing: ~30 minutes

Total: ~2 hours (if needed)

## Decision

The current code is functional and well-organized with clear phases.
The main win would be adding `RawJSONLMessage` to get type safety.
Other refactoring is nice-to-have, not critical.
