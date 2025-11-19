# Task Context for TASK_2025_008

## User Intent

Implement critical frontend event handling fixes based on comprehensive architectural analysis. This is a REFACTORING task with all research and architecture work already completed.

## Problem Statement

Three critical issues were identified through architectural analysis of event flow between backend (claude-domain) and frontend (Angular webview):

1. **Event Namespace Mismatch** (CRITICAL): Backend publishes `claude:*` events but frontend expects `chat:*` events, causing ALL streaming events to be dropped at WebviewMessageBridge
2. **Missing Type System Fields** (CRITICAL): StrictChatSession missing 5 fields, StrictChatMessage missing 3 fields - blocks all IMPLEMENTATION_PLAN phases
3. **Missing Frontend Subscriptions** (IMPORTANT): ChatService not subscribed to TOKEN_USAGE_UPDATED event

## Conversation Summary

**Research Completed**:

- EVENT_FLOW_RESEARCH.md - Complete event flow tracing with evidence
- EVENT_HANDLING_ENHANCEMENT_ARCHITECTURE.md - Architecture blueprint
- Requirements Gap Analysis - IMPLEMENTATION_PLAN validation

**Key Architectural Decision**: User confirmed single source of truth approach - eliminate dual namespaces, use CHAT_MESSAGE_TYPES directly in backend.

**Critical Path Tasks (4-7 hours total)**:

1. Event Namespace Unification (2-3h) - Change backend to use CHAT_MESSAGE_TYPES directly
2. Type System Foundation (1-2h) - Add 8 missing fields to StrictChatSession/StrictChatMessage
3. Frontend Subscriptions (1-2h) - Add TOKEN_USAGE_UPDATED subscription

**Files to Modify**:

- libs/backend/claude-domain/src/events/claude-domain.events.ts (namespace fix)
- libs/shared/src/lib/types/message.types.ts (type system)
- libs/frontend/core/src/lib/services/chat.service.ts (subscriptions)

**Parallel Execution Strategy**:

- Batch 1 (Backend namespace) and Batch 2 (Type system) can run PARALLEL (no dependencies)
- Batch 3 (Frontend subscriptions) must run SEQUENTIAL after Batch 1 (depends on namespace unification)

## Technical Context

- Branch: feature/008
- Created: 2025-11-19
- Task Type: REFACTORING
- Priority: CRITICAL
- Effort Estimate: 4-7 hours
- Research Phase: COMPLETE (skip PM and Architect)

## Execution Strategy

**REFACTORING_STREAMLINED** (Research Complete):

1. Skip project-manager (requirements clear from research)
2. Skip software-architect (architecture already defined)
3. team-leader MODE 1 (DECOMPOSITION - create tasks.md with 3 atomic batches)
4. team-leader MODE 2 (ITERATIVE ASSIGNMENT - parallel execution for Batch 1+2, sequential for Batch 3)
5. team-leader MODE 3 (COMPLETION - final verification)
6. User chooses QA (senior-tester and/or code-reviewer)
7. modernization-detector (future work analysis)

## Referenced Documentation

- task-tracking/TASK_2025_007/EVENT_FLOW_RESEARCH.md
- task-tracking/TASK_2025_007/EVENT_HANDLING_ENHANCEMENT_ARCHITECTURE.md
- libs/backend/claude-domain/src/events/claude-domain.events.ts
- libs/shared/src/lib/types/message.types.ts
- libs/frontend/core/src/lib/services/chat.service.ts
