# Development Tasks - TASK_2025_109

**Total Tasks**: 12 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [x] SubagentRegistry.getResumableBySession() exists and returns SubagentRecord[] - Verified in subagent-rpc.handlers.ts
- [x] chat:continue RPC handler has access to SubagentRegistryService - Verified injection in ChatRpcHandlers
- [x] Frontend inline-agent-bubble.component.ts has Resume button and isResumable() - Verified in code
- [x] Frontend chat.store.ts has handleSubagentResume() method - Verified in code
- [x] RpcMethodRegistry has 'chat:subagent-resume' entry - Verified in rpc.types.ts

### Risks Identified

| Risk                                                   | Severity | Mitigation                                                          |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------- |
| Context injection timing (before vs after user prompt) | LOW      | Inject at start of prompt processing in chat:continue               |
| Interrupted agent context format                       | LOW      | Use clear format: `[System: Interrupted agents: agentId: X (Type)]` |

### Edge Cases to Handle

- [x] No interrupted agents -> No context injection (handled naturally)
- [x] Multiple interrupted agents -> List all in context string
- [x] User continues session without mentioning agents -> Claude sees context, decides action

---

## Batch 1: Context Injection (Backend) - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add context injection in chat:continue handler - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts
**Spec Reference**: context.md:27-36, task-description.md:66-76
**Pattern to Follow**: Existing SubagentRegistryService usage in chat:resume handler (line 257-258)

**Quality Requirements**:

- Query interrupted subagents using SubagentRegistryService.getResumableBySession()
- Create context string in format: `[System: Previously interrupted agents available for resumption: agentId: X (Type). You can resume them by including their agentId in your response.]`
- Prepend context to user prompt BEFORE sending to SDK
- Only inject if there are interrupted subagents (length > 0)

**Implementation Details**:

- Imports: SubagentRegistryService already injected
- Location: Inside registerChatContinue() method, before sendMessageToSession() call
- Key Logic:
  ```typescript
  const resumableSubagents = this.subagentRegistry.getResumableBySession(sessionId);
  if (resumableSubagents.length > 0) {
    const agentContext = resumableSubagents.map((s) => `agentId: ${s.agentId} (${s.agentType})`).join(', ');
    const contextPrefix = `[System: Previously interrupted agents available for resumption: ${agentContext}. You can resume them by including their agentId in your response.]\n\n`;
    prompt = contextPrefix + prompt;
  }
  ```

---

### Task 1.2: Add context injection in chat:start handler for session resume - N/A

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts
**Spec Reference**: context.md:27-36

**Validation Result**: NOT NEEDED

- chat:start ONLY creates NEW sessions (verified in code)
- chat:continue handles all session resumption
- Context injection in chat:continue is sufficient

---

**Batch 1 Verification**:

- [ ] Context injection works in chat:continue
- [ ] Build passes: `npx nx build ptah-extension-vscode`
- [ ] code-logic-reviewer approved

---

## Batch 2: Remove Backend Resume Infrastructure - IN PROGRESS

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Remove resume methods from subagent-rpc.handlers.ts - IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\subagent-rpc.handlers.ts
**Spec Reference**: context.md:77-78

**Quality Requirements**:

- Remove registerSubagentResume() method (lines 87-165)
- Remove streamSubagentEventsToWebview() method (lines 178-293)
- Remove the call to registerSubagentResume() in register() method (line 66)
- Update register() method to only register 'chat:subagent-query'
- Update the logger.debug message for registered methods (line 69-71)
- Keep registerSubagentQuery() - it's still needed for querying subagent state

**Implementation Details**:

- Remove imports that are only used by resume: SubagentResumeParams, SubagentResumeResult from @ptah-extension/shared
- Keep: SubagentQueryParams, SubagentQueryResult, FlatStreamEventUnion (used by query)
- Update constructor injection - keep all (registry needed for query)

---

### Task 2.2: Remove resumeSubagent() from sdk-agent-adapter.ts - IN PROGRESS

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
**Spec Reference**: context.md:79

**Quality Requirements**:

- Remove the resumeSubagent() method (lines 500-559)
- Keep all other methods intact
- No changes to imports (SubagentRecord still used by other parts)

**Implementation Details**:

- This is a clean removal of one method
- No other code references this method after subagent-rpc.handlers removal

---

### Task 2.3: Remove SubagentResumeParams and SubagentResumeResult from types - PENDING

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\subagent-registry.types.ts
**Spec Reference**: context.md:79

**Quality Requirements**:

- Remove SubagentResumeParams interface (lines 80-84)
- Remove SubagentResumeResult interface (lines 88-94)
- Keep SubagentStatus, SubagentRecord, SubagentQueryParams, SubagentQueryResult

**Implementation Details**:

- These interfaces are only used by the resume RPC which is being removed

---

### Task 2.4: Remove chat:subagent-resume from RPC registry - PENDING

**File**: D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts
**Spec Reference**: context.md:81

**Quality Requirements**:

- Remove the 'chat:subagent-resume' entry from RpcMethodRegistry interface (lines 782-786)
- Remove 'chat:subagent-resume' from RPC_METHOD_NAMES array (line 866)
- Remove import of SubagentResumeParams, SubagentResumeResult from subagent-registry.types import (line 17-21)
- Keep 'chat:subagent-query' entry (lines 787-790) and in RPC_METHOD_NAMES array

**Implementation Details**:

- Update the import statement to only import what's needed
- Compile will verify no other code references removed types

---

**Batch 2 Verification**:

- [ ] All files exist at paths
- [ ] Build passes: `npx nx build ptah-extension-vscode`
- [ ] Build passes: `npx nx build shared`
- [ ] code-logic-reviewer approved
- [ ] No TypeScript errors about missing types

---

## Batch 3: Remove Frontend Resume UI - PENDING

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 2

### Task 3.1: Remove Resume button from inline-agent-bubble.component.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts
**Spec Reference**: context.md:86, task-description.md:28-29

**Quality Requirements**:

- Remove the Resume button template section (lines 110-127)
- Remove isResumable() computed signal (lines 371-374)
- Remove isResuming signal (line 243)
- Remove onResumeClick() method (lines 470-489)
- Remove resumeRequested output (line 220)
- Remove PlayCircle import from lucide-angular (line 21)
- Keep StopCircle import (used for "Stopped" badge)
- Keep isInterrupted() computed signal (line 365)
- Keep the "Stopped" badge display (lines 105-109)

**Implementation Details**:

- The "Stopped" badge should remain to show visual feedback
- Only the Resume button and related methods are removed

---

### Task 3.2: Delete resume-notification-banner.component.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\resume-notification-banner.component.ts
**Spec Reference**: context.md:87

**Quality Requirements**:

- DELETE the entire file (142 lines)
- This component is no longer needed

**Implementation Details**:

- Verify no other imports reference this file before deletion

---

### Task 3.3: Remove handleSubagentResume from chat.store.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Spec Reference**: context.md:88

**Quality Requirements**:

- Remove handleSubagentResume() method (lines 416-440)
- Remove refreshResumableSubagents() method (lines 393-409)
- Remove \_resumableSubagents signal (line 144)
- Remove resumableSubagents readonly accessor (line 145)
- Remove SubagentRecord import from @ptah-extension/shared (line 10)

**Implementation Details**:

- The subagent state is no longer needed in frontend
- Context injection handles resumption transparently

---

### Task 3.4: Remove resumeRequested output from execution-node.component.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts
**Spec Reference**: context.md:89

**Quality Requirements**:

- Remove resumeRequested output declaration (line 140)
- Remove (resumeRequested) event bindings in template (lines 79, 90, 104)
- Keep permissionResponded output and bindings

**Implementation Details**:

- Search for all `resumeRequested` references in the template
- Remove the output and all bindings

---

**Batch 3 Verification**:

- [ ] All files exist at paths (except deleted file)
- [ ] Build passes: `npx nx build chat`
- [ ] code-logic-reviewer approved
- [ ] "Stopped" badge still displays for interrupted agents

---

## Batch 4: Cleanup Exports and References - PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 3

### Task 4.1: Remove ResumeNotificationBannerComponent from exports - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts
**Spec Reference**: context.md:97

**Quality Requirements**:

- Remove the export line for resume-notification-banner.component (line 40)
- Keep all other exports

**Implementation Details**:

- Single line removal

---

### Task 4.2: Remove resume-related code from chat-view.component.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
**Spec Reference**: context.md:90

**Quality Requirements**:

- Remove ResumeNotificationBannerComponent from imports array (line 19)
- Remove onResumeAll() method (lines 184-193)

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
**Quality Requirements**:

- Remove the entire resume notification banner section (lines 13-21)
- Keep all other template content

---

### Task 4.3: Remove resumeSubagent wrapper from claude-rpc.service.ts - PENDING

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\claude-rpc.service.ts
**Spec Reference**: context.md:91

**Quality Requirements**:

- Remove resumeSubagent() method (lines 271-285)
- Remove SubagentResumeResult import from @ptah-extension/shared (line 16)
- Keep querySubagents() method (still used) and SubagentQueryResult import

**Implementation Details**:

- The querySubagents method is kept for potential future use
- Only the resume wrapper is removed

---

**Batch 4 Verification**:

- [ ] All files modified correctly
- [ ] Build passes: `npx nx build chat`
- [ ] Build passes: `npx nx build core`
- [ ] code-logic-reviewer approved
- [ ] Full typecheck passes: `npx nx run-many --target=typecheck --all`

---

## Status Icons Reference

| Status      | Meaning                         | Who Sets              |
| ----------- | ------------------------------- | --------------------- |
| PENDING     | Not started                     | team-leader (initial) |
| IN PROGRESS | Assigned to developer           | team-leader           |
| IMPLEMENTED | Developer done, awaiting verify | developer             |
| COMPLETE    | Verified and committed          | team-leader           |
| FAILED      | Verification failed             | team-leader           |
