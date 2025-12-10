# Requirements Document - TASK_2025_063

## Introduction

The SDK Permission & User Interaction System currently implements a subset of native Claude Code CLI behavior for tool permissions. This task addresses four critical gaps between our implementation and the native CLI experience, specifically focusing on permission blocking behavior, user input capabilities, question handling, and mid-stream message injection.

### Business Context

Ptah Extension aims to provide a native VS Code experience that matches Claude Code CLI's functionality while adding visual richness. Permission and user interaction systems are foundational to this goal - users expect the same level of control and interaction they have with the CLI. Current implementation diverges from CLI behavior in ways that reduce user control and interrupt workflow.

### Value Proposition

- **Enhanced User Control**: Eliminate arbitrary timeouts, allow command modification before execution
- **Complete Feature Parity**: Implement missing AskUserQuestion tool for clarifying questions
- **Improved UX**: Block UI appropriately during permission requests (matching CLI behavior)
- **Better Collaboration**: Enable mid-stream user responses during long-running operations

## Scope Definition

### In Scope

1. **Permission Timeout Removal**

   - Remove 30-second auto-deny timeout
   - Implement indefinite blocking (wait for user response)
   - Match native CLI behavior exactly

2. **Custom Input for Permissions**

   - Add text input field to permission cards
   - Allow users to modify tool parameters before approval
   - Support for editing bash commands, file paths, etc.

3. **AskUserQuestion Tool Implementation**

   - Create new UI component for question prompts
   - Implement backend handler for AskUserQuestion tool
   - Support both free-form text and multiple choice options
   - Integrate with SDK streaming pipeline

4. **User Message Injection**
   - Support mid-stream message injection during active streaming
   - Enable course-correction and context provision
   - Implement via SDK's async generator user message stream

### Out of Scope

- Permission rule persistence across sessions (future enhancement)
- Batch permission approval UI (future enhancement)
- Permission analytics/telemetry (separate task)
- Undo/rollback for approved permissions (separate task)
- UI redesign of existing permission cards beyond adding input field

## Requirements

### Requirement 1: Remove Permission Timeout Mechanism

**User Story:** As a developer reviewing a Claude-generated bash command, I want unlimited time to review and decide on permission approval, so that I don't feel rushed or have commands auto-denied while I'm carefully reviewing them.

#### Acceptance Criteria

1. WHEN a dangerous tool (Write, Edit, Bash, NotebookEdit) requests permission THEN the permission prompt SHALL display without any timeout mechanism
2. WHEN a permission prompt is shown THEN the request SHALL block SDK execution indefinitely until user responds
3. WHEN user responds to permission request THEN SDK execution SHALL resume immediately with user's decision
4. WHEN multiple permission requests are pending THEN all SHALL remain active until user responds (no auto-deny)
5. WHEN session is interrupted or disposed THEN all pending permission requests SHALL be cleanly rejected with "Session ended" reason

**Technical Details:**

- Remove `PERMISSION_TIMEOUT_MS = 30000` constant from `SdkPermissionHandler`
- Remove `setTimeout()` logic in `awaitResponse()` method
- Remove countdown timer display from `PermissionRequestCardComponent`
- Update `PermissionRequest` interface to make `timeoutAt` optional (for backward compatibility)
- Add session cleanup handler to reject all pending permissions on dispose

### Requirement 2: Add Custom Input to Permission Prompts

**User Story:** As a developer using Claude Code, I want to modify tool inputs (like bash commands or file paths) before approving permission, so that I can fix minor issues without denying and re-prompting.

#### Acceptance Criteria

1. WHEN permission prompt is shown THEN a text input field SHALL display the current tool input parameters
2. WHEN tool input is bash command THEN text input SHALL be editable textarea with syntax highlighting (optional)
3. WHEN tool input is file path THEN text input SHALL be single-line with path validation
4. WHEN tool input is complex object THEN text input SHALL display JSON with formatting (optional: JSON editor)
5. WHEN user modifies input and clicks "Allow" THEN modified input SHALL be sent to backend in `modifiedInput` field
6. WHEN backend receives modified input THEN SDK SHALL execute tool with modified parameters instead of original
7. WHEN user clicks "Deny" THEN no modification SHALL be sent (original behavior)

**Technical Details:**

- Extend `PermissionRequestCardComponent` template to add collapsible input section
- Add signal for input modification state (`modifiedInput`)
- Update `respond()` method to include modified input in response
- Modify `SdkPermissionHandler.requestUserPermission()` to use `modifiedInput` if provided
- Add input validation for common tool types (bash command safety checks, path validation)

**UI Design Requirements:**

- Input section starts collapsed, expands on "Edit" button click
- Visual indicator when input has been modified (dirty state)
- Restore original button to reset modifications
- Character count/length indicator for long inputs

### Requirement 3: Implement AskUserQuestion Tool Handler

**User Story:** As a developer using Claude Code, I want Claude to ask me clarifying questions when it encounters ambiguity, so that I can provide specific guidance without interrupting the entire workflow.

#### Acceptance Criteria

1. WHEN Claude invokes AskUserQuestion tool THEN a question prompt card SHALL display in the chat UI
2. WHEN question card is shown THEN it SHALL be visually distinct from permission requests (different color/icon)
3. WHEN question is multiple choice THEN radio buttons or dropdown SHALL display the options
4. WHEN question is free-form THEN a text input field SHALL be provided
5. WHEN user submits answer THEN answer SHALL be sent to SDK as tool_result with `{ answer: string }` format
6. WHEN SDK receives answer THEN Claude SHALL continue execution with the provided answer
7. WHEN question is displayed THEN it SHALL NOT require permission approval (auto-approved tool)
8. WHEN multiple questions are asked sequentially THEN each SHALL block until answered (no batching)

**Technical Details:**

- Add `AskUserQuestion` to auto-approved tool list in `SdkPermissionHandler` (no permission needed)
- Create `QuestionPromptCardComponent` (similar to `PermissionRequestCardComponent` but simpler)
- Add question handling to `StreamTransformer` to emit question nodes
- Extend `ExecutionNode` interface with optional `questionText` and `questionOptions` fields
- Add RPC handler for `chat:question-response` message type
- Implement question-response flow in `SdkRpcHandlers`

**Message Flow:**

```
SDK: tool_use(AskUserQuestion, { question: "Which file?" })
  → Backend: Auto-approve, emit 'chat:question' event
  → Frontend: Show QuestionPromptCardComponent
  → User: Types answer
  → Frontend: Send 'chat:question-response' event
  → Backend: Return tool_result({ answer: "src/main.ts" })
  → SDK: Continue execution
```

### Requirement 4: User Message Injection Mid-Stream

**User Story:** As a developer watching Claude work through a complex task, I want to send additional messages or corrections while Claude is still working, so that I can provide real-time guidance without interrupting and restarting.

#### Acceptance Criteria

1. WHEN SDK session is actively streaming THEN chat input field SHALL remain enabled (not disabled)
2. WHEN user types message during streaming THEN message SHALL be queued for injection
3. WHEN user submits message during streaming THEN message SHALL be injected via SDK's user message stream
4. WHEN message is injected THEN Claude SHALL receive it immediately and incorporate into current turn
5. WHEN multiple messages are sent rapidly THEN all SHALL be queued and delivered in order
6. WHEN session completes normally THEN any remaining queued messages SHALL be handled as new turn

**Technical Details:**

- Verify `UserMessageStreamFactory` already supports queueing (it does - uses `messageQueue`)
- Ensure chat input component doesn't disable during streaming
- Add visual indicator when message will be injected mid-stream vs new turn
- Test with SDK to ensure mid-stream injection doesn't break conversation state

**Edge Cases:**

- Message injected during permission wait → Should queue until permission resolved
- Message injected during tool execution → Should be delivered after current tool completes
- Session interrupted while message queued → Message should be discarded with warning

## Non-Functional Requirements

### Performance Requirements

- **Permission Response Time**: User response propagates to SDK within 100ms of button click
- **Question Display Latency**: Question prompts appear within 50ms of SDK tool invocation
- **Message Injection Latency**: User messages injected within 200ms of submission
- **UI Responsiveness**: Permission/question cards render without blocking main thread (< 16ms)

### Security Requirements

- **Input Sanitization**: All modified tool inputs MUST be sanitized before execution (redact secrets, validate paths)
- **Command Safety**: Modified bash commands MUST be validated for dangerous patterns (rm -rf, sudo, etc.)
- **XSS Prevention**: User-modified inputs MUST be escaped before display in UI
- **Permission Validation**: Backend MUST re-validate tool parameters after modification (defense in depth)

### Usability Requirements

- **Visual Distinction**: Question prompts MUST be clearly distinguishable from permission requests (color, icon, title)
- **Keyboard Accessibility**: All permission/question interactions MUST support keyboard-only navigation (Tab, Enter, Escape)
- **Screen Reader Support**: Permission/question cards MUST have proper ARIA labels and roles
- **Error Messages**: Clear feedback when permission/question submission fails

### Reliability Requirements

- **No Lost Responses**: Permission/question responses MUST be delivered exactly once (idempotency)
- **Graceful Degradation**: If permission handler fails, MUST default to deny (fail-safe)
- **Session Cleanup**: All pending permissions/questions MUST be rejected on session disposal
- **Recovery**: System MUST recover gracefully from backend disconnection during permission wait

## Dependencies and Constraints

### Technical Dependencies

1. **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`)

   - Version: Latest (^2.0.0)
   - Usage: `canUseTool` callback, `query` API, async user message stream
   - Constraint: SDK's `canUseTool` is async but blocking - must await response

2. **Backend Permission System**

   - `SdkPermissionHandler` - Core permission logic
   - `SdkRpcHandlers` - RPC event routing
   - Constraint: Must not break existing permission rule system

3. **Frontend Components**

   - `PermissionRequestCardComponent` - Existing permission UI
   - `ChatViewComponent` - Container for new question prompts
   - Constraint: Must maintain existing visual design system (DaisyUI)

4. **Shared Types**
   - `permission.types.ts` - Permission request/response interfaces
   - `execution-node.types.ts` - ExecutionNode structure
   - Constraint: Must maintain backward compatibility with existing message types

### Integration Points

1. **SDK → Backend**: `canUseTool` callback receives tool name and input
2. **Backend → Frontend**: `permission:request` and `chat:question` events
3. **Frontend → Backend**: `chat:permission-response` and `chat:question-response` events
4. **Backend → SDK**: Return modified input via `canUseTool` response

### Architectural Constraints

- **No Breaking Changes**: Existing permission flow MUST continue to work during phased implementation
- **Event-Driven**: All permission/question handling MUST use event-based RPC (no direct calls)
- **Signal-Based State**: Frontend MUST use Angular signals (no RxJS BehaviorSubject)
- **Immutable Updates**: All state updates MUST use immutable patterns (no mutations)

## Risk Assessment

### Technical Risks

| Risk                                                              | Probability | Impact   | Score | Mitigation Strategy                                                                        |
| ----------------------------------------------------------------- | ----------- | -------- | ----- | ------------------------------------------------------------------------------------------ |
| SDK blocking behavior breaks UI responsiveness                    | Medium      | High     | 6     | Implement permission handling off main thread, add timeout fallback for emergencies only   |
| Modified input bypasses security validation                       | Low         | Critical | 7     | Implement defense-in-depth: frontend validation + backend re-validation + SDK sanitization |
| AskUserQuestion conflicts with existing tool rendering            | Low         | Medium   | 4     | Create separate rendering path for questions, use distinct ExecutionNode type              |
| Mid-stream message injection causes conversation state corruption | Medium      | High     | 6     | Extensive testing with SDK, implement message queueing with state validation               |
| Indefinite permission wait causes memory leaks                    | Low         | Medium   | 3     | Implement proper cleanup on session disposal, add memory monitoring tests                  |

### Business Risks

| Risk                                            | Probability | Impact | Mitigation                                                                                    |
| ----------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------------------- |
| Feature complexity delays release               | Medium      | Medium | Break into batches: (1) Timeout removal, (2) Custom input, (3) AskUserQuestion, (4) Injection |
| User confusion between permissions vs questions | Low         | Low    | Strong visual distinction, clear labeling, user education in docs                             |
| Modified commands cause accidental damage       | Low         | High   | Add confirmation dialog for dangerous modifications, implement command safety checks          |

### Dependency Risks

- **SDK API Changes**: Claude Agent SDK may change `canUseTool` interface in future versions
  - Mitigation: Pin SDK version, monitor changelog, implement adapter pattern
- **VS Code API Constraints**: Webview messaging may have size limits for large inputs
  - Mitigation: Implement chunking for large tool inputs, add size validation

## Success Metrics

### Functional Success Criteria

- ✅ All permission requests block indefinitely (no auto-deny timeouts)
- ✅ Users can modify tool inputs in 100% of permission scenarios
- ✅ AskUserQuestion tool displays and collects answers correctly
- ✅ Mid-stream message injection works in 100% of streaming scenarios

### Quality Metrics

- **Test Coverage**: ≥ 90% for new code (permission handler, question component)
- **Bug Density**: < 1 bug per 500 lines of new code
- **Performance**: No regressions in permission response time (maintain < 100ms)
- **Accessibility**: 100% WCAG 2.1 Level AA compliance for new components

### User Experience Metrics (Post-Release)

- **Permission Modification Rate**: % of permissions where user edits input before approval
- **Question Response Time**: Average time users take to answer AskUserQuestion prompts
- **Mid-Stream Message Rate**: % of sessions where users inject messages during streaming
- **Permission Denial Rate**: Should remain similar to current rate (validates timeout wasn't needed)

## Implementation Notes

### Phased Rollout Recommendation

**Phase 1 (Critical - P0):**

- Remove permission timeout (Requirement 1)
- Add basic custom input field (Requirement 2 - minimal)
- High risk if not done: Users lose trust in permission system

**Phase 2 (High Priority - P1):**

- Implement AskUserQuestion handler (Requirement 3)
- Enhance custom input with validation (Requirement 2 - complete)
- Medium risk: Missing feature parity with CLI

**Phase 3 (Nice-to-Have - P2):**

- User message injection (Requirement 4)
- Low risk: Advanced feature, not critical for basic workflow

### Testing Strategy

1. **Unit Tests**

   - `SdkPermissionHandler`: Mock timeout removal, test modified input propagation
   - `QuestionPromptCardComponent`: Test answer submission, validation
   - `PermissionRequestCardComponent`: Test input modification state

2. **Integration Tests**

   - End-to-end permission flow: SDK → Backend → Frontend → Backend → SDK
   - Question handling flow: SDK AskUserQuestion → UI → Response → SDK
   - Message injection: User message during streaming → SDK receives

3. **Manual QA Scenarios**
   - Leave permission prompt open for 5+ minutes (no timeout)
   - Modify bash command to fix typo, verify modified command executes
   - Claude asks "Which file?" → User answers → Claude continues with answer
   - Inject message mid-stream during long tool execution

### Documentation Requirements

- Update `CLAUDE.md` for `agent-sdk` library with new permission behaviors
- Add JSDoc comments to all new methods and interfaces
- Create user guide section: "Understanding Permissions and Questions"
- Add troubleshooting guide for common permission/question issues

## Stakeholder Analysis

### Primary Stakeholders

**End Users (Developers using Ptah Extension)**

- **Impact Level**: Critical - directly affects daily workflow
- **Needs**: Fast permission decisions, ability to fix typos, clear questions
- **Success Criteria**: Can work as efficiently as native CLI
- **Involvement**: Beta testing, feedback on question UI clarity

**Extension Maintainers**

- **Impact Level**: High - new code to maintain
- **Needs**: Clean architecture, good test coverage, clear documentation
- **Success Criteria**: No increase in support tickets, easy to debug issues
- **Involvement**: Code review, architecture validation

### Secondary Stakeholders

**Anthropic Claude Team**

- **Impact Level**: Low - we're adapting to their SDK
- **Needs**: Proper SDK usage, no abuse of permission system
- **Success Criteria**: Extension demonstrates best practices for SDK integration
- **Involvement**: Consultation on SDK usage patterns (if needed)

**VS Code Extension Users (General)**

- **Impact Level**: Medium - sets expectations for Claude extensions
- **Needs**: Consistent UX across Claude-based extensions
- **Success Criteria**: Ptah Extension matches or exceeds CLI UX
- **Involvement**: None (indirect feedback via reviews)

## Appendix: Related Research

### Native CLI Behavior Analysis (from context.md)

**Permission System:**

- Blocks execution indefinitely - no timeout
- User must explicitly approve or deny
- Can use Ctrl+C to interrupt if stuck

**AskUserQuestion Tool:**

- Added in Claude Code v2.0.21
- Does NOT require permission (communication tool)
- Schema: `{ question: string }` → `{ answer: string }`
- Blocks execution until user responds

**User Message Injection:**

- SDK supports via async generator
- Messages are queued and delivered when SDK reads next yield
- Used for course-correction and providing additional context

### Alternative Approaches Considered

**Approach 1: Keep timeout but make it configurable**

- **Rejected**: Adds complexity without solving core issue (users shouldn't be timed out)

**Approach 2: Batch permission approvals**

- **Deferred**: Good future enhancement but adds significant complexity
- **Reason**: Single permission at a time matches CLI behavior better

**Approach 3: Separate window for questions**

- **Rejected**: Disrupts flow, webview is better for inline questions
- **Reason**: Questions should appear in conversation context

**Approach 4: Voice input for questions**

- **Rejected**: Out of scope, requires speech recognition integration
- **Reason**: Nice-to-have but not critical for MVP

## Version History

| Version | Date       | Author          | Changes                       |
| ------- | ---------- | --------------- | ----------------------------- |
| 1.0     | 2025-12-10 | Project Manager | Initial requirements document |
