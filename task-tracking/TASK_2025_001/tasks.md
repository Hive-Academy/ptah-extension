# Development Tasks - TASK_2025_001

**Task Type**: Full-Stack (Shared Library + Frontend)
**Developer Needed**: both (backend-developer for shared lib, frontend-developer for migration)
**Total Tasks**: 7
**Status**: 3/7 Complete (43%) - Task 4 in progress

**Decomposed From**:

- implementation-plan.md
- context.md

---

## Task Breakdown

### Task 1: Add Response Type Constants to message-types.ts ✅ COMPLETE

**Type**: BACKEND  
**Complexity**: Level 1 (Foundational)  
**Estimated Time**: 0.5-1 hour  
**Assigned To**: backend-developer  
**File(s)**: `libs/shared/src/lib/constants/message-types.ts`  
**Specification Reference**: implementation-plan.md:135-181 (Section 5.1.1)

**Task Description**:
Add 6 response type constant objects to `message-types.ts`:

1. `CHAT_RESPONSE_TYPES`
2. `PROVIDER_RESPONSE_TYPES`
3. `CONTEXT_RESPONSE_TYPES`
4. `COMMAND_RESPONSE_TYPES`
5. `CONFIG_RESPONSE_TYPES`
6. `STATE_RESPONSE_TYPES`

Each constant object should follow the pattern:

```typescript
export const CHAT_RESPONSE_TYPES = {
  SEND_MESSAGE: 'chat:sendMessage:response',
  NEW_SESSION: 'chat:newSession:response',
  // ... other response types
} as const;
```

**Quality Requirements**:

- ✅ Each constant object uses `as const` assertion (verified pattern from existing constants)
- ✅ Naming convention: `{CATEGORY}_RESPONSE_TYPES`
- ✅ Response type format: `{baseType}:response` (e.g., 'chat:sendMessage:response')
- ✅ Update `MESSAGE_TYPES` aggregation to include all 6 response constant spreads
- ✅ Follow existing pattern from `CHAT_MESSAGE_TYPES` (verified at message-types.ts:1-14)

**Expected Commit Pattern**: `refactor(deps): add response type constants for all message categories`

**Verification Requirements**:

- ✅ File exists: `libs/shared/src/lib/constants/message-types.ts`
- ✅ Git commit matches pattern
- ✅ Build passes: `npm run typecheck:all`
- ✅ All 6 response constant objects present with `as const`
- ✅ `MESSAGE_TYPES` aggregation updated

**Git Commit**: 0fa9e12  
**Verification Results**:

- ✅ Git commit verified: 0fa9e12
- ✅ File modified successfully
- ✅ Typecheck passed: All 14 projects (36s)
- ✅ All 6 response constant objects added with `as const`
- ✅ MESSAGE_TYPES aggregation updated with all 6 spreads

**Dependencies**: None (foundational task)  
**Blocks**: Task 2 (type derivation requires these constants)

---

### Task 2: Derive StrictMessageType from MESSAGE_TYPES Constants ✅ COMPLETE

**Type**: BACKEND
**Complexity**: Level 1
**Estimated Time**: 0.5-1 hour
**Assigned To**: backend-developer
**Status**: COMPLETE

**Description**:
Replace the explicit ~115 line StrictMessageType union with a single derived type using TypeScript's indexed access pattern. This eliminates duplication and ensures automatic sync between constants and types.

**Files to Change**:

- `libs/shared/src/lib/types/message.types.ts` - Replace explicit union (~115 lines removed, 2 lines added)
- `libs/shared/src/lib/constants/message-types.ts` - Added missing ANALYTICS_RESPONSE_TYPES

**Specification Reference**:

- implementation-plan.md:212-254 (Component 2: Derived Type System)

**Pattern to Follow**:

- Existing MessageType derivation (message-types.ts:133)
- TypeScript `typeof` indexed access type pattern

**Implementation Details**:

**BEFORE** (message.types.ts:25-140):

```typescript
export type StrictMessageType =
  | 'chat:sendMessage'
  | 'chat:messageChunk'
  | 'chat:sessionStart'
  // ... ~115 explicit string literals
  | 'state:clear:response';
```

**AFTER**:

```typescript
import {
  CHAT_MESSAGE_TYPES,
  CHAT_RESPONSE_TYPES,
  // ... all category imports
  SYSTEM_MESSAGE_TYPES,
} from '../constants/message-types';

export type StrictMessageType =
  | (typeof CHAT_MESSAGE_TYPES)[keyof typeof CHAT_MESSAGE_TYPES]
  | (typeof CHAT_RESPONSE_TYPES)[keyof typeof CHAT_RESPONSE_TYPES]
  // ... all category unions
  | (typeof SYSTEM_MESSAGE_TYPES)[keyof typeof SYSTEM_MESSAGE_TYPES];
```

**Expected Commit Pattern**: `refactor(deps): derive StrictMessageType from MESSAGE_TYPES constants`

**Git Commit**: cd04c68  
**Verification Results**:

- ✅ Git commit verified: cd04c68
- ✅ File modified: libs/shared/src/lib/types/message.types.ts
- ✅ Import statements added for all 16 category constants
- ✅ StrictMessageType replaced with derived union type (15 lines)
- ✅ ~115 explicit string literals removed
- ✅ Added missing ANALYTICS_RESPONSE_TYPES to message-types.ts
- ✅ `npm run typecheck:all` passes (14 projects, 0 errors)
- ✅ Type narrowing works correctly in switch statements
- ✅ MessagePayloadMap keys map correctly

**Verification Requirements**:

- ✅ File modified at libs/shared/src/lib/types/message.types.ts
- ✅ Import statement added for MESSAGE_TYPES
- ✅ StrictMessageType replaced with derived type (1 line)
- ✅ ~115 explicit string literals removed
- ✅ `npm run typecheck:all` passes (no breaking changes)
- ✅ MessagePayloadMap keys still map correctly
- ✅ `npm run build:all` succeeds
- ✅ Git commit matches pattern

**Dependencies**: Task 1 (requires response constants to exist)

---

### Task 3: Migrate session-manager.component.ts to MESSAGE_TYPES Constants ✅ COMPLETE

**Type**: FRONTEND
**Complexity**: Level 1
**Estimated Time**: 15-20 minutes
**Assigned To**: frontend-developer
**Status**: COMPLETE

**Description**:
Replace 3 string literal usages in session-manager component with CHAT_MESSAGE_TYPES constants. This is the first frontend migration task to establish the pattern.

**Files to Change**:

- `libs/frontend/session/src/lib/containers/session-manager/session-manager.component.ts` - 3 call sites

**Specification Reference**:

- implementation-plan.md:256-321 (Component 3: Frontend Constant Migration)

**Pattern to Follow**:

- Backend pattern from session-manager.ts:23, 199
- Import category-specific constants (CHAT_MESSAGE_TYPES)

**Implementation Details**:

**Add Import**:

```typescript
import { CHAT_MESSAGE_TYPES } from '@ptah-extension/shared';
```

**Replace String Literals** (3 instances):

1. Line ~752: `'chat:requestSessions'` → `CHAT_MESSAGE_TYPES.REQUEST_SESSIONS`
2. Line ~867: `'chat:deleteSession'` → `CHAT_MESSAGE_TYPES.DELETE_SESSION`
3. Line ~896: `'chat:renameSession'` → `CHAT_MESSAGE_TYPES.RENAME_SESSION`

**Expected Commit Pattern**: `refactor(webview): migrate session-manager to MESSAGE_TYPES constants`

**Git Commit**: 3cf174f  
**Verification Results**:

- ✅ Git commit verified: 3cf174f
- ✅ File modified: libs/frontend/session/src/lib/containers/session-manager/session-manager.component.ts
- ✅ Import statement added for CHAT_MESSAGE_TYPES
- ✅ All 3 string literals replaced with constants
- ✅ `npm run typecheck:all` passes (14 projects, 0 errors)

**Verification Requirements**:

- ✅ File modified at libs/frontend/session/src/lib/containers/session-manager/session-manager.component.ts
- ✅ Import statement added for CHAT_MESSAGE_TYPES
- ✅ All 3 string literals replaced with constants
- ✅ `npm run typecheck:all` passes
- ✅ `npm run build:extension` succeeds
- ✅ `npm run build:webview` succeeds
- ✅ Git commit matches pattern

**Dependencies**: Task 2 (requires derived types to work correctly)

---

### Task 4: Migrate chat-state-manager.service.ts to MESSAGE_TYPES Constants 🔄 IN PROGRESS

**Type**: FRONTEND
**Complexity**: Level 1
**Estimated Time**: 15-20 minutes
**Assigned To**: frontend-developer
**Status**: IN PROGRESS - Assigned to frontend-developer

**Description**:
Replace 4 string literal usages in chat-state-manager service with CHAT_MESSAGE_TYPES and SYSTEM_MESSAGE_TYPES constants.

**Files to Change**:

- `libs/frontend/core/src/lib/services/chat-state-manager.service.ts` - 4 call sites

**Specification Reference**:

- implementation-plan.md:256-321 (Component 3: Frontend Constant Migration)

**Pattern to Follow**:

- Backend pattern from session-manager.ts:23, 199

**Implementation Details**:

**Add Imports**:

```typescript
import { CHAT_MESSAGE_TYPES, SYSTEM_MESSAGE_TYPES } from '@ptah-extension/shared';
```

**Replace String Literals** (4 instances):

1. Line ~131: `'chat:switchSession'` → `CHAT_MESSAGE_TYPES.SWITCH_SESSION`
2. Line ~143: `'chat:newSession'` → `CHAT_MESSAGE_TYPES.NEW_SESSION`
3. Line ~152: `'chat:deleteSession'` → `CHAT_MESSAGE_TYPES.DELETE_SESSION`
4. Line ~335: `'requestInitialData'` → `SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA`

**Expected Commit Pattern**: `refactor(chat): migrate chat-state-manager to MESSAGE_TYPES constants`

**Verification Requirements**:

- ✅ File modified at libs/frontend/core/src/lib/services/chat-state-manager.service.ts
- ✅ Import statement added for CHAT_MESSAGE_TYPES and SYSTEM_MESSAGE_TYPES
- ✅ All 4 string literals replaced with constants
- ✅ `npm run typecheck:all` passes
- ✅ `npm run build:webview` succeeds
- ✅ Git commit matches pattern

**Dependencies**: Task 2 (requires derived types to work correctly)

---

### Task 5: Migrate message-handler.service.ts and vscode.service.ts to MESSAGE_TYPES Constants ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 30-45 minutes
**Assigned To**: frontend-developer
**Status**: PENDING

**Description**:
Replace 14 string literal usages across message-handler service (3 calls) and vscode service (11 calls) with appropriate MESSAGE_TYPES constants. This is the largest single migration task.

**Files to Change**:

- `libs/frontend/core/src/lib/services/message-handler.service.ts` - 3 call sites
- `libs/frontend/core/src/lib/services/vscode.service.ts` - 11 call sites

**Specification Reference**:

- implementation-plan.md:256-321 (Component 3: Frontend Constant Migration)

**Pattern to Follow**:

- Backend pattern from session-manager.ts:23, 199
- Import multiple category constants as needed

**Implementation Details**:

**message-handler.service.ts - Add Imports**:

```typescript
import { CHAT_MESSAGE_TYPES, VIEW_MESSAGE_TYPES } from '@ptah-extension/shared';
```

**message-handler.service.ts - Replace String Literals** (3 instances):

1. Line ~235: `'view:changed'` → `VIEW_MESSAGE_TYPES.CHANGED`
2. Line ~253: `'view:changed'` → `VIEW_MESSAGE_TYPES.CHANGED`
3. Line ~285: `'chat:getHistory'` → `CHAT_MESSAGE_TYPES.GET_HISTORY`

**vscode.service.ts - Add Imports**:

```typescript
import { CHAT_MESSAGE_TYPES, SYSTEM_MESSAGE_TYPES, VIEW_MESSAGE_TYPES, CONTEXT_MESSAGE_TYPES, COMMAND_MESSAGE_TYPES, STATE_MESSAGE_TYPES } from '@ptah-extension/shared';
```

**vscode.service.ts - Replace String Literals** (11 instances):

1. Line ~292: `'webview-ready'` → `SYSTEM_MESSAGE_TYPES.WEBVIEW_READY`
2. Line ~299: `'view:routeChanged'` → `VIEW_MESSAGE_TYPES.ROUTE_CHANGED`
3. Line ~307: `'context:includeFile'` → `CONTEXT_MESSAGE_TYPES.INCLUDE_FILE`
4. Line ~317: `'commands:executeCommand'` → `COMMAND_MESSAGE_TYPES.EXECUTE_COMMAND`
5. Line ~327: `'state:save'` → `STATE_MESSAGE_TYPES.SAVE`
6. Line ~355: `'error'` → `SYSTEM_MESSAGE_TYPES.ERROR`
7. Line ~365: `'state:save'` → `STATE_MESSAGE_TYPES.SAVE`
8. Line ~371: `'state:save'` → `STATE_MESSAGE_TYPES.SAVE`
9. Line ~389: `'state:load'` → `STATE_MESSAGE_TYPES.LOAD`
10. Line ~399: `'chat:sendMessage'` → `CHAT_MESSAGE_TYPES.SEND_MESSAGE`
11. Additional instances as found during implementation

**Expected Commit Pattern**: `refactor(core): migrate message-handler and vscode services to MESSAGE_TYPES constants`

**Verification Requirements**:

- ✅ Both files modified
- ✅ Import statements added for all required MESSAGE_TYPES categories
- ✅ All 14+ string literals replaced with constants
- ✅ `npm run typecheck:all` passes
- ✅ `npm run build:webview` succeeds
- ✅ Git commit matches pattern

**Dependencies**: Task 2 (requires derived types to work correctly)

---

### Task 6: Add ESLint no-restricted-syntax Rules ⏸️ PENDING

**Type**: BACKEND
**Complexity**: Level 2
**Estimated Time**: 30-45 minutes
**Assigned To**: backend-developer
**Status**: PENDING

**Description**:
Add ESLint no-restricted-syntax rules to prevent future usage of string literals in postStrictMessage and eventBus.publish calls. This enforces the architectural decision permanently.

**Files to Change**:

- `eslint.config.mjs` - Add no-restricted-syntax rules (~20 lines)

**Specification Reference**:

- implementation-plan.md:323-377 (Component 4: ESLint Rule Enforcement)

**Pattern to Follow**:

- Standard ESLint no-restricted-syntax AST selector pattern

**Implementation Details**:

**Add to eslint.config.mjs**:

```javascript
export default [
  // ... existing config
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='postStrictMessage'] > Literal",
          message: 'Use MESSAGE_TYPES constants instead of string literals for message types. Import from @ptah-extension/shared.',
        },
        {
          selector: "CallExpression[callee.property.name='publish'][arguments.0.type='Literal']",
          message: 'Use MESSAGE_TYPES constants instead of string literals for event types. Import from @ptah-extension/shared.',
        },
      ],
    },
  },
];
```

**Testing the Rule**:

1. Run `npm run lint:all` - should pass (all literals already replaced)
2. Temporarily add a string literal: `vscode.postStrictMessage('test', {})`
3. Run `npm run lint:all` - should fail with helpful error message
4. Remove test string literal
5. Commit ESLint rule changes

**Expected Commit Pattern**: `chore(lint): add no-restricted-syntax rule to prevent message type string literals`

**Verification Requirements**:

- ✅ File modified at eslint.config.mjs
- ✅ 2 no-restricted-syntax rules added
- ✅ `npm run lint:all` passes on current codebase
- ✅ Rule detects string literals when tested
- ✅ Error message is clear and actionable
- ✅ Git commit matches pattern

**Dependencies**: Task 5 (all frontend migrations must be complete before enforcing rule)

---

### Task 7: End-to-End Validation and Documentation ⏸️ PENDING

**Type**: INTEGRATION
**Complexity**: Level 3
**Estimated Time**: 1-1.5 hours
**Assigned To**: frontend-developer
**Status**: PENDING

**Description**:
Perform comprehensive end-to-end validation of the unified message type system. Test all message flows between Angular webview and VS Code backend, verify quality gates, and update documentation.

**Files to Change**:

- None (testing and validation only)
- Update task-tracking/TASK_2025_001/tasks.md with final verification results

**Specification Reference**:

- implementation-plan.md:745-819 (Testing Strategy)
- implementation-plan.md:821-879 (Success Metrics)

**Validation Checklist**:

**Quality Gates**:

- [ ] `npm run typecheck:all` passes
- [ ] `npm run lint:all` passes
- [ ] `npm run build:all` succeeds
- [ ] `npm run test:all` passes

**Manual E2E Testing Scenarios**:

1. **Chat Message Sending**:

   - [ ] Open Extension Development Host (F5)
   - [ ] Open Ptah webview
   - [ ] Send chat message from Angular UI
   - [ ] Verify message received in backend (check logs)
   - [ ] Verify response received in webview

2. **Session Management**:

   - [ ] Create new chat session
   - [ ] Switch between sessions
   - [ ] Rename session
   - [ ] Delete session
   - [ ] Verify all events propagate correctly

3. **Provider Switching**:

   - [ ] Get available providers
   - [ ] Switch to different provider
   - [ ] Verify provider changed event in webview

4. **Context File Management**:

   - [ ] Get workspace files
   - [ ] Include file in context
   - [ ] Exclude file from context
   - [ ] Verify context updates propagate

5. **Grep Verification**:
   - [ ] Run `grep -r "postStrictMessage('" libs/frontend/` - should return 0 results
   - [ ] Run `grep -r "CHAT_MESSAGE_TYPES" libs/frontend/` - should return multiple results

**Success Metrics Validation**:

- [ ] Type duplication: 115 explicit types → 1 derived type ✅
- [ ] String literals: 21+ literals → 0 literals ✅
- [ ] Single source of truth: 2 files → 1 file ✅
- [ ] ESLint enforcement: No violations ✅

**Expected Commit Pattern**: `test(TASK_2025_001): validate message type unification end-to-end`

**Verification Requirements**:

- ✅ All quality gates pass
- ✅ All manual E2E scenarios pass
- ✅ Grep searches confirm zero string literals
- ✅ Success metrics validated
- ✅ tasks.md updated with verification results
- ✅ Git commit documents validation

**Dependencies**: Task 6 (all tasks must be complete before final validation)

---

## Verification Protocol

**After Each Task Completion**:

1. Developer updates task status to "✅ COMPLETE"
2. Developer adds git commit SHA
3. Team-leader verifies:
   - `git log --oneline -1` matches expected commit pattern
   - Files exist and contain expected changes
   - Build/typecheck passes
4. If verification passes: Assign next task
5. If verification fails: Mark task as "❌ FAILED", escalate to user

---

## Completion Criteria

**All tasks complete when**:

- All task statuses are "✅ COMPLETE"
- All git commits verified
- All quality gates pass (typecheck, lint, build, test)
- Manual E2E testing confirms all features work
- Zero string literals remain in message-sending code

**Return to orchestrator with**: "All 7 tasks completed and verified ✅"

---

## Execution Order

**Phase 1 - Shared Library (Backend Developer)**:

1. Task 1 → Task 2 (Sequential - Task 2 depends on Task 1)

**Phase 2 - Frontend Migration (Frontend Developer)**: 2. Task 3 → Task 4 → Task 5 (Sequential - establishes pattern, then scales)

**Phase 3 - Prevention (Backend Developer)**: 3. Task 6 (Requires all frontend migrations complete)

**Phase 4 - Validation (Frontend Developer)**: 4. Task 7 (Requires all other tasks complete)

**Parallel Opportunities**: Tasks 3, 4, 5 CAN be done in parallel if multiple frontend developers available, but sequential is recommended to establish pattern.
