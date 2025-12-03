# Requirements Document - TASK_2025_040

## Introduction

This feature enables users to continue interacting with the chat interface while Claude is streaming a response, and provides graceful interrupt capabilities. Currently, the chat input is disabled during streaming, preventing users from queuing follow-up messages or stopping long-running responses.

**Business Value**: Improves user productivity by eliminating wait times and provides control over resource-intensive operations. This addresses a critical UX friction point that impacts daily workflow efficiency.

**Project Context**: Extends existing chat functionality in Ptah VS Code extension by adding queue management and session control. Builds on established TabState architecture and ChatStore patterns.

## Requirements

### Requirement 1: Message Queue During Streaming

**User Story:** As a user actively working with Claude, I want to type and queue my next message while Claude is responding, so that I can maintain my workflow momentum without waiting.

#### Acceptance Criteria

1. WHEN Claude is streaming a response AND user types and sends a message THEN the message SHALL be queued as `TabState.queuedContent` (single string field)
2. WHEN user sends additional messages while streaming THEN new content SHALL be appended to existing queued content separated by newlines
3. WHEN queued content exists THEN a visual indicator SHALL display the queued message above the chat input
4. WHEN Claude completes the response normally AND queued content exists THEN the system SHALL automatically call `continueConversation()` with the queued content
5. WHEN queued content is sent automatically THEN the `queuedContent` field SHALL be cleared
6. WHEN streaming state changes THEN chat input SHALL remain enabled (remove existing disable constraint)
7. WHEN queue operation fails THEN error SHALL be logged and user SHALL receive visual feedback

### Requirement 2: Stop/Interrupt Functionality

**User Story:** As a user receiving an unexpectedly long or incorrect response, I want to stop Claude mid-response, so that I can save time and system resources.

#### Acceptance Criteria

1. WHEN user clicks Stop button during streaming THEN backend SHALL send SIGINT signal to Claude CLI process (not `kill()`)
2. WHEN SIGINT is sent THEN the current message SHALL be finalized with existing content
3. WHEN process is interrupted THEN tab status SHALL transition to 'loaded' state
4. WHEN stop completes THEN the chat input SHALL be re-enabled for new messages
5. WHEN SIGINT fails THEN system SHALL fall back to `process.kill()` and log warning
6. WHEN stop operation completes THEN frontend SHALL receive confirmation via `chat:complete` event

### Requirement 3: Stop with Queue Behavior

**User Story:** As a user who has queued a message but then stops Claude's response, I want my queued content restored to the input field, so that I can review and edit it before sending.

#### Acceptance Criteria

1. WHEN user clicks Stop AND queued content exists THEN queued content SHALL be moved to the chat input textarea
2. WHEN queued content is moved to input THEN the `queuedContent` field SHALL be cleared
3. WHEN queued content is restored THEN it SHALL NOT auto-send after stop completes
4. WHEN input is populated from queue THEN user SHALL be able to edit before manually sending
5. WHEN user clicks Stop AND no queued content exists THEN input SHALL remain empty
6. WHEN stop+queue operation fails THEN queued content SHALL be preserved (no data loss)

## Non-Functional Requirements

### Performance Requirements

- **Queue Update Latency**: Queue updates < 50ms for smooth UX
- **Stop Response Time**: SIGINT delivery < 100ms from button click
- **UI Update**: Visual queue indicator renders within 1 frame (16ms)

### User Experience Requirements

- **No Data Loss**: Queued content must persist across all state transitions
- **Visual Feedback**: Clear indication when content is queued (e.g., "Message queued..." badge)
- **Graceful Degradation**: If stop fails, user retains ability to queue and send new messages
- **State Clarity**: User always understands whether input will send immediately or queue

### Reliability Requirements

- **Error Handling**: If SIGINT fails, fall back to `kill()` and log warning
- **State Recovery**: Queue state survives unexpected process termination
- **Multi-Tab Safety**: Queue operations correctly target the active tab

## Technical Implementation

### Data Model Changes

**TabState Interface** (`libs/frontend/chat/src/lib/services/chat.types.ts`):

```typescript
export interface TabState {
  // ... existing fields

  /** Single queued message content (appended on multiple sends) */
  queuedContent?: string | null;
}
```

### Service Methods

**ChatStore** (`libs/frontend/chat/src/lib/services/chat.store.ts`):

- `queueOrAppendMessage(content: string): void` - Add/append to queue
- `clearQueuedContent(): void` - Clear queue for active tab
- `moveQueueToInput(): string | null` - Return queue content and clear
- Modify `handleChatComplete()` - Auto-send queue after completion
- Modify `abortCurrentMessage()` - Handle queue→input flow on stop

**ChatInputComponent** (`libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`):

- Remove `isDisabled` constraint from send button
- Modify `handleSend()` - Smart routing: queue if streaming, send if not
- Add method to accept content from `moveQueueToInput()` after stop

**Backend RPC** (`libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts`):

- Change `chat:abort` to use `process.kill('SIGINT')` instead of `process.kill()`
- Consider renaming to `chat:stop` for clarity

## Out of Scope

The following capabilities are explicitly **NOT** part of this implementation (YAGNI):

- ❌ Array-based queue (`QueuedMessage[]`) - single string suffices
- ❌ Cancel individual queued messages - only one item exists
- ❌ Queue persistence across sessions - in-memory only
- ❌ Queue priority or reordering - single FIFO item
- ❌ Dedicated QueuedMessageComponent - inline template
- ❌ Complex queue management service - ChatStore methods suffice

## Dependencies

### Existing Services to Reuse

- `TabManager.updateTab()` - Update `queuedContent` field (DRY)
- `ChatStore.continueConversation()` - Auto-send queue with `--resume` flag
- `ChatStore.finalizeCurrentMessage()` - Finalize on stop
- `SessionManager.setStatus()` - Reset status after stop

### External Dependencies

- Claude CLI SIGINT support (verified in context research)
- Node.js `child_process` SIGINT signal delivery

## Success Metrics

- [ ] User can type and send while Claude is streaming
- [ ] Multiple sends while streaming append to single queued message
- [ ] Queued content displays with clear visual indicator
- [ ] Stop button sends SIGINT (not kill) to Claude CLI
- [ ] Stop with queued content moves content to input field (not auto-send)
- [ ] Queue auto-sends when Claude finishes normally
- [ ] No data loss during queue/stop operations
- [ ] Zero regression in existing chat functionality

## Stakeholder Analysis

### Primary Stakeholders

**End Users (VS Code Extension Users)**

- **Needs**: Efficient workflow, no input blocking, control over long responses
- **Pain Points**: Currently cannot queue messages, must wait for completion
- **Success Criteria**: Can type/queue during streaming, can stop unwanted responses
- **Impact Level**: High - directly affects daily productivity

**Development Team**

- **Needs**: Clean implementation following YAGNI/DRY/SOLID principles
- **Constraints**: Must maintain existing TabState patterns, no breaking changes
- **Success Criteria**: Code changes < 150 lines, zero new dependencies, passes all tests
- **Impact Level**: Medium - implementation complexity is low-medium

### Secondary Stakeholders

**Quality Assurance**

- **Needs**: Clear test scenarios, no regression in existing chat functionality
- **Success Criteria**: All 4 acceptance scenarios pass, zero data loss cases
- **Impact Level**: Medium - requires thorough edge case testing

**Product/UX Team**

- **Needs**: Clear visual feedback for queue state, intuitive stop behavior
- **Success Criteria**: User feedback shows reduced frustration with input blocking
- **Impact Level**: Low-Medium - enhancement to existing feature

## Risks and Mitigations

### Technical Risks

| Risk                                     | Probability | Impact | Score | Mitigation Strategy                                                                     |
| ---------------------------------------- | ----------- | ------ | ----- | --------------------------------------------------------------------------------------- |
| SIGINT fails on Windows                  | Medium      | High   | 6     | Test on Windows, implement fallback to `process.kill()`, add platform-specific handling |
| Race condition: stop + queue + auto-send | Medium      | High   | 6     | Atomic state updates in ChatStore, use effect cleanup in Angular components             |
| Queue state lost on crash                | Low         | Medium | 3     | Document as known limitation (in-memory only), consider future persistence              |
| Multi-tab queue confusion                | Low         | Medium | 3     | Per-tab queue in TabState (already scoped correctly), add tab ID to logs                |
| Input focus issues after stop+queue      | Low         | Low    | 1     | Explicit `textarea.focus()` after content restore, test across browsers                 |

### Business Risks

| Risk                                      | Probability | Impact   | Score | Mitigation Strategy                                                       |
| ----------------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------------- |
| User confusion about queue vs send        | Medium      | Medium   | 4     | Clear visual indicator ("Message queued..."), user testing before release |
| Breaking existing chat workflows          | Low         | Critical | 7     | Comprehensive regression testing, feature flag for rollback               |
| Performance degradation with large queues | Low         | Low      | 1     | String concatenation is O(n), acceptable for user-typed content           |

### Implementation Risks

| Risk                       | Probability | Impact | Score | Mitigation Strategy                                                      |
| -------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------ |
| Violating YAGNI principle  | Low         | Medium | 3     | Strict code review, reject any array/complex queue implementations       |
| Breaking TabState contract | Low         | High   | 5     | Unit tests for TabState updates, verify no breaking changes to consumers |
| Inconsistent stop behavior | Medium      | Medium | 4     | Document stop+queue behavior clearly, add integration tests              |

## SMART Criteria Validation

### Requirement 1: Message Queue During Streaming

- **Specific**: Queue single string field in TabState, append with newlines, visual indicator, auto-send via continueConversation()
- **Measurable**: Queue operation < 50ms, visual indicator renders within 16ms, zero message loss
- **Achievable**: Extends existing TabState pattern, reuses continueConversation() method, simple string operations
- **Relevant**: Directly addresses user pain point of blocked input during streaming, improves workflow efficiency
- **Time-bound**: Estimated 2-3 hours implementation (TabState + ChatStore methods + UI indicator)

### Requirement 2: Stop/Interrupt Functionality

- **Specific**: SIGINT signal to Claude CLI process, finalize current message, reset to loaded state
- **Measurable**: SIGINT delivery < 100ms, fallback to kill() if SIGINT fails, process cleanup verified
- **Achievable**: Simple change from `process.kill()` to `process.kill('SIGINT')`, reuse existing finalization logic
- **Relevant**: Critical user control feature, prevents wasted time on unwanted responses
- **Time-bound**: Estimated 1-2 hours implementation (RPC method change + error handling + testing)

### Requirement 3: Stop with Queue Behavior

- **Specific**: Move queued content to input textarea, clear queue, disable auto-send, enable user editing
- **Measurable**: Content transfer < 50ms, zero data loss, user can edit before manual send
- **Achievable**: Coordinate between ChatStore and ChatInputComponent, atomic state updates
- **Relevant**: Preserves user intent while giving control, prevents accidental sends after interruption
- **Time-bound**: Estimated 2 hours implementation (coordination logic + state management + edge case handling)

**Total Estimated Effort**: 5-7 hours (small, focused feature per user guidance)

## Quality Gates

Before delegation to implementation team, verify:

- [x] All requirements follow SMART criteria (validated above)
- [x] Acceptance criteria in proper WHEN/THEN/SHALL format
- [x] Stakeholder analysis complete with impact assessment
- [x] Risk assessment with mitigation strategies and scores
- [x] Success metrics clearly defined and measurable
- [x] Dependencies identified and documented (existing services to reuse)
- [x] Non-functional requirements specified (performance, UX, reliability)
- [x] Out of scope explicitly documented (YAGNI compliance)
- [x] Technical implementation approach documented
- [x] No backward compatibility planning (direct implementation only)

**Validation Status**: PASSED - Requirements are complete, actionable, and follow professional standards.

## Reference Documentation

- Original research: `docs/future-enhancements/message-queue-and-session-control.md`
- Context document: `task-tracking/TASK_2025_040/context.md`
- Claude CLI behavior: spawn-per-turn, `stdin.end()` trigger, `--resume` flag
