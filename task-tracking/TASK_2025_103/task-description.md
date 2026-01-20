# Requirements Document - TASK_2025_103

## Introduction

This document defines the requirements for adding subagent resumption capability to the Ptah Extension. Currently, when a user interrupts a session or VS Code reloads, any running subagent executions are lost and must be restarted from scratch. This creates poor user experience, wastes API tokens, and disrupts complex multi-agent workflows.

The Claude SDK provides native subagent resumption via the `resume: sessionId` parameter combined with the prompt `Resume agent ${agentId}`. This feature will leverage that capability to enable users to continue interrupted subagent executions seamlessly.

**Business Value**: Users can resume complex, long-running agent workflows without losing progress, reducing API costs and improving productivity.

## Requirements

### Requirement 1: Backend Subagent Registry

**User Story:** As a user with interrupted agent sessions, I want the extension to track which subagents were running, so that I can choose to resume them later.

#### Acceptance Criteria

1. WHEN a SubagentStart hook fires THEN the system SHALL store a SubagentRecord with (parentSessionId, agentId, agentType, startTime, status: 'running')
2. WHEN a SubagentStop hook fires THEN the system SHALL update the corresponding SubagentRecord status to 'completed'
3. WHEN a session is aborted/interrupted THEN the system SHALL mark all running subagents under that session as status: 'interrupted'
4. WHEN the system queries resumable subagents for a sessionId THEN the system SHALL return all SubagentRecords with status: 'interrupted'
5. WHEN a SubagentRecord has status 'interrupted' AND was started more than 24 hours ago THEN the system SHALL consider it 'expired' and non-resumable

### Requirement 2: Backend Subagent Resume RPC Handler

**User Story:** As a frontend developer, I want an RPC endpoint to resume a specific subagent, so that the UI can trigger resumption with a single call.

#### Acceptance Criteria

1. WHEN `subagent:resume` RPC is called with (parentSessionId, agentId) THEN the system SHALL invoke SDK query with `resume: parentSessionId` parameter
2. WHEN `subagent:resume` RPC is called THEN the prompt SHALL be `Resume agent ${agentId} and continue where you left off`
3. WHEN `subagent:resume` succeeds THEN the system SHALL update SubagentRecord status to 'running'
4. WHEN `subagent:resume` fails THEN the system SHALL return error details AND keep SubagentRecord status as 'interrupted'
5. WHEN streaming events arrive from resumed subagent THEN the system SHALL route them to the webview with original tabId correlation

### Requirement 3: Backend Resumable Subagents Query

**User Story:** As a frontend developer, I want to query which subagents are resumable for a session, so that I can display resume options in the UI.

#### Acceptance Criteria

1. WHEN `subagent:list-resumable` RPC is called with sessionId THEN the system SHALL return array of ResumableSubagent objects
2. WHEN ResumableSubagent is returned THEN it SHALL include (agentId, agentType, agentDescription, interruptedAt, summaryPreview)
3. WHEN no resumable subagents exist for sessionId THEN the system SHALL return empty array
4. WHEN subagent was interrupted more than 24 hours ago THEN it SHALL NOT be included in resumable list

### Requirement 4: Frontend Resume Button on Agent Bubbles

**User Story:** As a user viewing an interrupted agent execution, I want to see a "Resume" button on the agent bubble, so that I can continue where the agent left off.

#### Acceptance Criteria

1. WHEN an agent ExecutionNode has status 'interrupted' THEN the UI SHALL display a "Resume" button in the agent bubble header
2. WHEN user clicks "Resume" button THEN the UI SHALL call `subagent:resume` RPC with (parentSessionId, agentId)
3. WHEN resume is in progress THEN the UI SHALL show loading state on the button AND disable further clicks
4. WHEN resume succeeds THEN the UI SHALL update agent status to 'streaming' AND display incoming content
5. WHEN resume fails THEN the UI SHALL show error toast AND keep "Resume" button enabled for retry
6. WHEN agent was interrupted more than 24 hours ago THEN the "Resume" button SHALL be disabled with tooltip "Agent session expired"

### Requirement 5: Frontend Session Resumption Indicator

**User Story:** As a user loading a historical session with interrupted agents, I want to be notified that agents can be resumed, so that I know continuation is possible.

#### Acceptance Criteria

1. WHEN session is loaded AND contains interrupted subagents THEN the UI SHALL display a notification banner
2. WHEN notification banner is displayed THEN it SHALL show count of resumable agents (e.g., "2 agent tasks can be resumed")
3. WHEN user clicks notification banner THEN the UI SHALL scroll to first interrupted agent bubble
4. WHEN user dismisses notification THEN it SHALL not appear again for this session until page reload

### Requirement 6: Streaming State Continuation

**User Story:** As a user resuming an agent, I want to see the conversation continue seamlessly from where it stopped, so that context is preserved.

#### Acceptance Criteria

1. WHEN subagent is resumed THEN existing ExecutionNode children SHALL be preserved in the tree
2. WHEN new streaming events arrive after resume THEN they SHALL be appended to existing agent children
3. WHEN agent resumes with new text content THEN it SHALL appear after any previously displayed content
4. WHEN agent resumes with new tool calls THEN they SHALL be added to the agent's children array

## Non-Functional Requirements

### Performance Requirements

- **Resume Latency**: Resume operation SHALL complete (first streaming event) within 3 seconds of user click
- **Query Latency**: `subagent:list-resumable` SHALL return within 100ms for sessions with up to 10 interrupted subagents
- **Memory Usage**: SubagentRegistry SHALL use less than 5MB for tracking up to 1000 subagent records

### Security Requirements

- **Session Isolation**: Subagent records SHALL only be accessible from their parent session context
- **No Sensitive Data Storage**: SubagentRegistry SHALL NOT store prompts, outputs, or API keys
- **Timeout Enforcement**: Expired subagent records (24+ hours) SHALL be automatically purged

### Reliability Requirements

- **Graceful Degradation**: If SubagentRegistry is unavailable, normal session operations SHALL continue without resume capability
- **Error Recovery**: If resume fails due to SDK error, the UI SHALL preserve original interrupted state
- **State Consistency**: SubagentRegistry state SHALL survive VS Code window reload via in-memory caching (not persistence)

### User Experience Requirements

- **Discoverability**: Resume button SHALL be visually distinct (primary button style) on interrupted agents
- **Feedback**: All resume operations SHALL show visual feedback within 200ms of user interaction
- **Clarity**: Error messages SHALL explain why resume failed in user-friendly language

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder         | Impact Level | Involvement      | Success Criteria                         |
| ------------------- | ------------ | ---------------- | ---------------------------------------- |
| End Users           | High         | Testing/Feedback | Can resume agents without confusion      |
| Frontend Developers | High         | Implementation   | Clear API contract, predictable behavior |
| Backend Developers  | High         | Implementation   | Clean SDK integration, proper lifecycle  |

### Secondary Stakeholders

| Stakeholder | Impact Level | Involvement | Success Criteria                       |
| ----------- | ------------ | ----------- | -------------------------------------- |
| QA/Testing  | Medium       | Validation  | All edge cases covered, no regressions |
| DevOps      | Low          | Monitoring  | No memory leaks, proper cleanup        |

## Risk Assessment

### Technical Risks

| Risk                                 | Probability | Impact | Mitigation                            | Contingency                      |
| ------------------------------------ | ----------- | ------ | ------------------------------------- | -------------------------------- |
| SDK resume API changes               | Low         | High   | Pin SDK version, monitor changelog    | Fallback to restart-from-scratch |
| Memory leak in registry              | Medium      | Medium | Implement 24-hour TTL cleanup         | Manual registry reset command    |
| Race condition on concurrent resumes | Medium      | Medium | Use mutex/lock on resume operation    | Queue resume requests            |
| Lost events during resume            | Low         | High   | Buffer events during state transition | Manual retry with full reload    |

### Business Risks

| Risk                               | Probability | Impact | Mitigation                                  |
| ---------------------------------- | ----------- | ------ | ------------------------------------------- |
| Low adoption if not discoverable   | Medium      | Medium | Clear visual indicator, notification banner |
| Confusion about resume limitations | Medium      | Low    | Tooltip explanations, documentation         |

## Dependencies

### Internal Dependencies

- **AgentSessionWatcherService**: Provides SubagentStart/SubagentStop hook events
- **ChatRpcHandlers**: Template for RPC handler registration pattern
- **StreamTransformer**: Handles SDK event transformation for resumed streams
- **ExecutionTreeBuilderService**: Must handle appending to existing agent nodes

### External Dependencies

- **Claude SDK**: Requires `resume: sessionId` parameter support (verified in SDK docs)
- **SDK Version**: ^0.2.0 (current) supports subagent resumption natively

## Out of Scope

The following items are explicitly NOT part of this task:

1. **Persistent Storage**: SubagentRegistry is in-memory only; no database/file persistence for subagent records
2. **Cross-Session Resume**: Cannot resume subagent from one session in a different session
3. **Partial State Restoration**: Does not restore UI scroll position or collapsed state on resume
4. **Batch Resume**: No "Resume All" functionality for multiple interrupted agents
5. **Resume Queue Management**: No priority ordering for multiple resume operations
6. **Offline Resume**: Requires active network connection to Claude API
7. **Resume Notification Persistence**: Notification banner state is not persisted across reloads

## Success Metrics

| Metric              | Target                           | Measurement Method              |
| ------------------- | -------------------------------- | ------------------------------- |
| Resume Success Rate | > 95%                            | Error logs / successful resumes |
| Resume Latency P95  | < 3 seconds                      | Performance monitoring          |
| User Adoption       | > 50% of interrupted sessions    | Usage analytics (future)        |
| Bug Reports         | < 3 critical bugs in first month | Issue tracker                   |

## Technical Context Summary

Based on codebase analysis, the implementation will:

1. **Create SubagentRegistryService** in `libs/backend/vscode-core/src/services/`

   - Listen to AgentSessionWatcherService events (agent-start, agent-stop)
   - Maintain Map<parentSessionId, SubagentRecord[]> structure
   - Provide query API for resumable subagents

2. **Add RPC handlers** in `apps/ptah-extension-vscode/src/services/rpc/handlers/`

   - `subagent:resume` - Invokes SDK with resume parameter
   - `subagent:list-resumable` - Returns resumable subagents for session

3. **Update SdkAgentAdapter** in `libs/backend/agent-sdk/`

   - Add `resumeSubagent(parentSessionId, agentId)` method
   - Construct proper SDK query with resume option

4. **Update InlineAgentBubbleComponent** in `libs/frontend/chat/`

   - Add "Resume" button conditional on status === 'interrupted'
   - Handle click with RPC call and state updates

5. **Update ChatStore** in `libs/frontend/chat/`
   - Add resumable subagents signal for session
   - Handle notification banner visibility state
