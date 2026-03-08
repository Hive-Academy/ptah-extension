# Requirements Document - TASK_2025_102

## Introduction

This task implements a "Deny with Message" permission option for the Claude Agent SDK integration. Currently, users can only Allow, Always Allow, or Deny permissions. This enhancement adds a 4th option that allows users to deny a permission while providing feedback to Claude, enabling the agent to adjust its approach without stopping execution entirely.

Additionally, this task fixes two related bugs discovered during log analysis:

1. Current "Deny" button doesn't stop execution (missing `interrupt: true`)
2. Session abort doesn't cleanup pending permissions (causes unhandled promise rejection)

**Business Value**: Users gain fine-grained control over agent behavior by communicating preferences directly, improving the human-AI collaboration experience.

---

## Requirements

### Requirement 1: Deny with Message UI Component

**User Story:** As a user viewing a permission request, I want a button to deny with a message, so that I can guide Claude's behavior without completely blocking execution.

#### Acceptance Criteria

1. WHEN permission request card is displayed THEN a 4th button labeled "Deny with Message" SHALL appear after the existing Deny button
2. WHEN user clicks "Deny with Message" button THEN a popover SHALL open with:
   - Text input field (placeholder: "Explain why or suggest alternatives...")
   - Send icon button (lucide-angular `Send` icon)
3. WHEN popover is open THEN clicking outside or pressing Escape SHALL close the popover without action
4. WHEN user enters text and clicks Send THEN popover SHALL close and response SHALL be sent to backend
5. WHEN user submits with empty message THEN a default message "User denied without explanation" SHALL be used
6. WHEN styling is applied THEN component SHALL use existing DaisyUI/Tailwind patterns matching permission-request-card.component.ts

### Requirement 2: Permission Response Type Extension

**User Story:** As the system processing permission responses, I want to distinguish between hard deny and deny-with-message, so that I can handle them appropriately at the SDK level.

#### Acceptance Criteria

1. WHEN PermissionResponse type is extended THEN `decision` field SHALL support values: `'allow' | 'deny' | 'always_allow' | 'deny_with_message'`
2. WHEN Zod schema is updated THEN PermissionResponseSchema SHALL validate the new decision type
3. WHEN deny_with_message decision is received THEN `reason` field SHALL contain the user's message

### Requirement 3: Backend Permission Handler Updates

**User Story:** As the backend handling permission responses, I want to correctly translate user decisions to SDK PermissionResult, so that Claude receives accurate feedback.

#### Acceptance Criteria

1. WHEN user clicks "Deny" (hard deny) THEN backend SHALL return `{ behavior: 'deny', message: 'User denied permission', interrupt: true }`
2. WHEN user clicks "Deny with Message" THEN backend SHALL return `{ behavior: 'deny', message: <user_message>, interrupt: false }`
3. WHEN backend logs permission response THEN it SHALL include decision type and interrupt flag for debugging

### Requirement 4: Session Abort Cleanup

**User Story:** As a user who aborts a session, I want pending permission requests to be cleaned up, so that I don't see errors in the console.

#### Acceptance Criteria

1. WHEN session is aborted THEN all pending permission requests for that session SHALL be resolved with deny + interrupt
2. WHEN late permission response arrives after abort THEN handler SHALL log warning and discard without throwing
3. WHEN cleanup occurs THEN no "Operation aborted" unhandled promise rejection SHALL appear in console

---

## Non-Functional Requirements

### Performance Requirements

- **Popover Rendering**: Open within 16ms (one frame) after button click
- **Message Transmission**: Backend response within 100ms of user action

### Accessibility Requirements

- **Keyboard Navigation**: Popover SHALL be focusable and navigable with Tab key
- **ARIA Labels**: Input field SHALL have `aria-label="Message to Claude"`
- **Focus Management**: On popover open, input SHALL receive focus; on close, focus SHALL return to trigger button

### Compatibility Requirements

- **DaisyUI Theme**: All new components SHALL use DaisyUI classes for VS Code theme compatibility
- **Angular Signals**: State management SHALL use Angular signals (not RxJS BehaviorSubject)
- **Standalone Components**: All new components SHALL be standalone (no NgModule)

---

## Technical Implementation Notes

### SDK PermissionResult Mapping

| UI Decision       | SDK behavior | SDK interrupt | SDK message              |
| ----------------- | ------------ | ------------- | ------------------------ |
| allow             | 'allow'      | N/A           | N/A                      |
| always_allow      | 'allow'      | N/A           | N/A                      |
| deny              | 'deny'       | true          | 'User denied permission' |
| deny_with_message | 'deny'       | false         | <user provided message>  |

### Key Files to Modify

**Shared Types** (libs/shared):

- `src/lib/types/permission.types.ts` - Add 'deny_with_message' to PermissionResponse.decision

**Frontend** (libs/frontend/chat):

- `src/lib/components/molecules/permission-request-card.component.ts` - Add popover trigger button
- NEW: `src/lib/components/molecules/deny-message-popover.component.ts` - Popover with input

**Backend** (libs/backend/agent-sdk):

- `src/lib/sdk-permission-handler.ts` - Update handleResponse() to set interrupt flag correctly

### Component Structure

```
permission-request-card.component.ts
  +-- deny-message-popover.component.ts (new)
      +-- NativePopoverComponent (from @ptah-extension/ui)
      +-- Text input
      +-- Send button
```

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder  | Impact | Interest                    | Success Criteria                   |
| ------------ | ------ | --------------------------- | ---------------------------------- |
| End Users    | High   | Provide feedback to Claude  | Can deny with message in <3 clicks |
| Claude Agent | High   | Receive actionable feedback | Gets message in tool result        |

### Secondary Stakeholders

| Stakeholder | Impact | Interest             | Success Criteria             |
| ----------- | ------ | -------------------- | ---------------------------- |
| Dev Team    | Medium | Clean implementation | Follows existing patterns    |
| QA Team     | Low    | Testable behavior    | Clear success/failure states |

---

## Risk Assessment

### Technical Risks

| Risk                                  | Probability | Impact | Mitigation                                               |
| ------------------------------------- | ----------- | ------ | -------------------------------------------------------- |
| Popover positioning issues in webview | Medium      | Medium | Use NativePopoverComponent (already tested in webview)   |
| SDK message format mismatch           | Low         | High   | Use exact PermissionResult type from claude-sdk.types.ts |

### Integration Risks

| Risk                            | Probability | Impact | Mitigation                                               |
| ------------------------------- | ----------- | ------ | -------------------------------------------------------- |
| Existing permission flow breaks | Low         | High   | Preserve existing decision types, add new one additively |

---

## Acceptance Test Scenarios

### Scenario 1: Deny with Message Flow

```gherkin
Feature: Deny with Message
  As a user
  I want to deny a permission with feedback
  So that Claude can adjust its approach

  Scenario: User denies with custom message
    Given a permission request is displayed for Bash command
    When I click "Deny with Message" button
    Then a popover opens with text input
    When I type "Try using npm instead of yarn"
    And I click the Send button
    Then the popover closes
    And Claude receives my message
    And Claude continues execution (not interrupted)

  Scenario: User denies without entering message
    Given a permission request is displayed
    When I click "Deny with Message" button
    And I click Send without typing anything
    Then Claude receives "User denied without explanation"
    And Claude continues execution
```

### Scenario 2: Hard Deny Stops Execution

```gherkin
Feature: Hard Deny Interrupts
  As a user
  I want Deny to stop execution
  So that Claude doesn't keep asking permissions

  Scenario: User clicks Deny
    Given a permission request is displayed
    When I click the "Deny" button
    Then Claude stops execution immediately
    And no further permission requests appear
```

### Scenario 3: Session Abort Cleanup

```gherkin
Feature: Abort Cleanup
  As a user
  I want clean session abort
  So that I don't see errors

  Scenario: User aborts during permission request
    Given a permission request is pending
    When I abort the session
    Then the permission request is resolved as denied
    And no console errors appear
```

---

## Definition of Done

- [ ] 'deny_with_message' added to PermissionResponse.decision type
- [ ] Zod schema updated and validated
- [ ] DenyMessagePopoverComponent created with proper styling
- [ ] Permission request card has 4th button
- [ ] Backend sets interrupt: true for 'deny' decision
- [ ] Backend sets interrupt: false for 'deny_with_message' decision
- [ ] Session abort cleans up pending permissions
- [ ] No TypeScript errors (npm run typecheck:all passes)
- [ ] No linting errors (npm run lint:all passes)
- [ ] Manual testing confirms all scenarios pass
