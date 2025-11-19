# Task Description: Complete Message Streaming & Event Handling Fix

## Overview

Comprehensive fix for the message streaming and event handling system spanning both backend (Claude CLI integration) and frontend (Angular signal-based state management).

## Scope

### Backend (Parser & Launcher) - COMPLETED ✅

- Fix JSONL stream parser to handle ALL Claude CLI events
- Wire up missing event handlers in launcher
- Ensure proper session lifecycle management

### Frontend (State Management & Components) - IN PROGRESS

- Eliminate duplicate event processing
- Consolidate state management
- Implement event deduplication
- Add automatic cleanup mechanisms
- Refactor component state access

## Out of Scope

- UI/UX redesign
- New features beyond fixing existing functionality
- Performance optimizations beyond eliminating duplicates
- Migration of existing sessions/data

## Requirements

### Functional Requirements

**FR-1**: Messages sent to Claude CLI MUST receive responses
**FR-2**: Streaming MUST work in real-time (chunks appear as generated)
**FR-3**: "Claude is typing..." indicator MUST stop when streaming completes
**FR-4**: Messages MUST appear exactly once in the UI
**FR-5**: Thinking indicator MUST clear when thinking completes
**FR-6**: Session state MUST be consistent across services
**FR-7**: Event processing MUST be idempotent (no duplicates)
**FR-8**: State MUST auto-cleanup when events complete

### Non-Functional Requirements

**NFR-1**: Event processing latency < 50ms
**NFR-2**: No memory leaks from uncleaned subscriptions
**NFR-3**: Change detection cycles reduced by 40%
**NFR-4**: Code maintainability improved (single source of truth)
**NFR-5**: Test coverage > 80% for event handlers

## Constraints

- Must maintain backward compatibility with existing sessions
- Cannot break existing VS Code extension APIs
- Must work with Claude CLI 2.0.45+
- Angular 20+ signal-based architecture required
- No external dependencies beyond existing stack

## Assumptions

- Claude CLI is installed and authenticated
- VS Code webview messaging works correctly
- EventBus implementation is sound
- Users are on Windows (primary target platform)

## Dependencies

- TASK_2025_006 (Event Relay System) must be completed
- Claude CLI version 2.0.42+ installed
- Node.js 18+ for child process spawning
- Angular 20+ for signal support

## Success Metrics

### Backend

- ✅ All 6 Claude CLI event types parsed (system, assistant, tool, permission, stream_event, result)
- ✅ All 9 callback types handled (sessionInit, content, thinking, tool, permission, agentStart, agentActivity, agentComplete, messageStop, result, error)
- ✅ Process lifecycle managed (spawn → stream → close)

### Frontend

- 🎯 0 duplicate message renders (currently: 2x per message)
- 🎯 Typing indicator clears within 1 second of completion
- 🎯 Event processing reduced from 2-3 handlers per event to 1
- 🎯 Signal update cycles reduced by 40%
- 🎯 Component state sources reduced from 7 to 1

## Risk Assessment

| Risk                       | Probability | Impact   | Mitigation                                    |
| -------------------------- | ----------- | -------- | --------------------------------------------- |
| Breaking existing sessions | Medium      | High     | Implement backward-compatible state migration |
| Performance regression     | Low         | Medium   | Benchmark before/after, optimize if needed    |
| New bugs introduced        | Medium      | High     | Comprehensive testing, phased rollout         |
| User data loss             | Low         | Critical | No data deletion, only state consolidation    |
| Extension crashes          | Low         | High     | Error boundaries, graceful degradation        |

## Rollback Plan

If critical issues arise:

1. Revert backend parser changes (restore previous version)
2. Revert frontend state changes (restore dual collections temporarily)
3. Keep event deduplication (low risk, high value)
4. Keep cleanup registry (low risk, high value)
5. Defer component refactor to future task
