# Task Context - TASK_2025_106

## User Intent

Refactor session-history-reader.service.ts by extracting responsibilities into child services while maintaining the existing public API. The file has grown to 1,278 lines with distinct responsibilities: JSONL reading, agent session loading, correlation logic, event factory methods, replay/conversion, stats aggregation, and utilities. Split into focused child services following single responsibility principle.

## Conversation Summary

User identified the file as "quite massive" and wants it split into child services without changing the actual service API. The goal is to extract different responsibilities into child services.

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-01-19
- Type: REFACTORING
- Complexity: Medium (single file → multiple services, clear patterns)

## Target File

- **Path**: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- **Size**: 1,278 lines
- **Current State**: Monolithic service with multiple responsibilities

## Identified Responsibilities (to Extract)

1. **JSONL Reading** - `readJsonlMessages()`, `findSessionsDirectory()`, `convertToSessionHistoryMessage()`
2. **Agent Session Loading** - `loadAgentSessions()`, `buildAgentDataMap()`
3. **Correlation Logic** - `extractTaskToolUses()`, `correlateAgentsToTasks()`, `extractAllToolResults()`
4. **Event Factory** - All `create*` methods (MessageStart, TextDelta, ThinkingDelta, ToolStart, AgentStart, ToolResult, MessageComplete)
5. **Replay/Conversion** - `replayToStreamEvents()`, `processAgentMessages()`
6. **Stats Aggregation** - `aggregateUsageStats()`
7. **Utilities** - `extractTextContent()`, `generateId()`

## Execution Strategy

REFACTORING workflow: software-architect → team-leader (3 modes) → QA
