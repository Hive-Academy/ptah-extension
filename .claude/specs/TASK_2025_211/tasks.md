# Development Tasks - TASK_2025_211: Fix 6 Pre-Existing Extension Bugs

**Total Tasks**: 6 | **Batches**: 3 | **Status**: 0/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `addStats()` method at line 206-224 confirmed to only update the exact sessionId passed, no parent propagation: VERIFIED
- `SessionLifecycleManager.endSession()` at line 311 uses `this.activeSessions.get(sessionId)` keyed by tab ID, not SDK UUID: VERIFIED
- `tabIdToRealId` Map exists at line 179 but has no reverse lookup in `endSession()`: VERIFIED
- `LlmService.initializeDefaultProvider()` at line 82-123 logs at `warn` level on failure: VERIFIED
- `watchSubagentDirectories()` at line 556-560 populates sessionIds only from `activeWatches`: VERIFIED
- `ExecutionTreeBuilderService.collectTools()` at line 482 checks only `isTaskTool || toolName === 'Task'`: VERIFIED
- `SkillJunctionService` at line 181-204 already handles symlinks and real directories but may miss SDK-created entries: VERIFIED

### Risks Identified

| Risk                                                                                     | Severity | Mitigation                                                                              |
| ---------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Bug 1: Parent session may not have child in `cliSessions` yet when stats arrive (timing) | LOW      | Propagation silently skips if parent not found; stats still exist on child              |
| Bug 4: `readdirSync` may pick up non-session UUID-like directories                       | LOW      | `watchSubagentDirectories` handles missing `subagents/` gracefully                      |
| Bug 6: SDK may use unknown tool names for subagent dispatch in future versions           | MED      | Use data-driven detection (check input for `subagent_type`) rather than hardcoded names |

### Edge Cases to Handle

- [ ] Bug 1: Orphan child sessions (no parent found) should not throw errors -> Handled in Task 2.1
- [ ] Bug 3: Multiple tab IDs mapping to same real UUID (shouldn't happen, but first match is correct) -> Handled in Task 1.2
- [ ] Bug 4: Sessions directory not existing yet when `readdirSync` is called -> Handled in Task 2.2
- [ ] Bug 6: Regular tools with `subagent_type` in input accidentally classified as agent dispatch -> Low risk, `subagent_type` is a reliable signal

---

## Batch 1: Independent Backend Fixes

**Status**: PENDING
**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Bug 5 - Graceful LLM provider initialization

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\llm.service.ts`
**Spec Reference**: implementation-plan.md: Bug 5 section (lines 278-349)
**Pattern to Follow**: Existing error/warn logging pattern in the same method

**Quality Requirements**:

- Downgrade `logger.warn` to `logger.debug` in both the `else` branch (line 108) and `catch` block (line 116)
- Add descriptive message indicating this is expected in SDK-only mode
- Do NOT remove the try/catch structure or change the control flow
- The success path (lines 98-106) must remain unchanged

**Validation Notes**:

- The LLM abstraction is vestigial after TASK_2025_209 -- empty import map is the correct state
- This fix only changes log severity, zero functional impact

**Implementation Details**:

- In `initializeDefaultProvider()` method (line 82-123):
  - Line 108: Change `this.logger.warn` to `this.logger.debug`, update message to indicate SDK-only mode expectation
  - Line 116: Change `this.logger.warn` to `this.logger.debug`, update message similarly

**Acceptance Criteria**:

- No "No import map entry for provider: vscode-lm" warning appears at startup in logs
- Debug-level log confirms provider initialization was skipped (visible only with debug logging enabled)
- No functional regression -- LlmService still initializes successfully if a provider IS available

---

### Task 1.2: Bug 3 - Session abort reverse lookup

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
**Spec Reference**: implementation-plan.md: Bug 3 section (lines 155-214)
**Pattern to Follow**: Existing `tabIdToRealId` usage at line 331-332

**Quality Requirements**:

- Add reverse lookup in `endSession()` method when direct `activeSessions.get(sessionId)` fails
- Iterate `tabIdToRealId` entries to find matching real UUID and resolve to tab ID
- Reassign `sessionId` to the found tab ID for downstream cleanup operations
- Preserve the existing warning log if neither lookup succeeds

**Validation Notes**:

- `tabIdToRealId` is a small Map (one entry per active session), iteration is negligible overhead
- The rest of `endSession()` after the lookup (permission cleanup, subagent marking, abort) uses `sessionId` -- reassigning it to tab ID ensures all cleanup works correctly

**Implementation Details**:

- In `endSession()` method at line 311-312:
  - After `const session = this.activeSessions.get(sessionId as string);`
  - If `!session`, add a for-loop over `this.tabIdToRealId.entries()`
  - Check if `realId === (sessionId as string)`
  - If match found, get session from `activeSessions.get(tabId)` and reassign `sessionId = tabId as SessionId`
  - Change `const session` to `let session` to allow reassignment after reverse lookup

**Acceptance Criteria**:

- Clicking Stop button no longer produces "Cannot end session - not found" warning in logs
- Session abort still works correctly (the actual abort mechanism is unaffected)
- If neither direct nor reverse lookup finds a session, the existing warning is still logged

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build llm-abstraction` and `npx nx build agent-sdk`
- code-logic-reviewer approved
- No stubs, TODOs, or placeholder code

---

## Batch 2: Subagent-Related Fixes

**Status**: PENDING
**Developer**: backend-developer (Tasks 2.1, 2.2) + frontend-developer (Task 2.3)
**Tasks**: 3 | **Dependencies**: None (all affect different layers)

### Task 2.1: Bug 1 - Cost aggregation from subagents to parent session

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
**Spec Reference**: implementation-plan.md: Bug 1 section (lines 26-112)
**Pattern to Follow**: Existing `addStats()` method at line 206-224, `enqueueWrite` serialization pattern

**Quality Requirements**:

- After updating the child session's stats in `addStats()`, check if `metadata.isChildSession` is true
- If child session, find the parent session by scanning `getAll()` for a session whose `cliSessions` array contains a reference with matching `sdkSessionId`
- Add the same stats delta to the parent session using `_saveInternal()`
- Log the propagation at info level
- Handle edge cases: no parent found (silently skip), orphan sessions (no error)

**Validation Notes**:

- The `enqueueWrite` serialization queue prevents concurrent update races
- Parent lookup scans `cliSessions` which is a small array (typically 1-5 entries)
- If `addCliSession()` hasn't been called yet (timing), propagation silently skips -- acceptable since child stats still exist

**Implementation Details**:

- Modify `addStats()` (line 206-224): after `_saveInternal()` call, add child-to-parent propagation
- Add private method `propagateStatsToParent(childSessionId, stats)`:
  - Call `this.getAll()` to get all sessions
  - Find parent by checking `session.cliSessions?.some(ref => ref.sdkSessionId === childSessionId)`
  - If found, call `_saveInternal()` with updated parent cost/tokens
  - Log at info level: `[SessionMetadataStore] Propagated subagent stats to parent {parentSessionId}`

**Acceptance Criteria**:

- Parent session header shows aggregated cost (parent + all child sessions)
- Multiple subagents' costs are all reflected in the parent's totalCost
- No errors thrown if parent session not found (orphan child)
- Existing addStats behavior for non-child sessions is unchanged

---

### Task 2.2: Bug 4 - Subagent watcher directory scanning fix

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\agent-session-watcher.service.ts`
**Spec Reference**: implementation-plan.md: Bug 4 section (lines 217-275)
**Pattern to Follow**: Existing `watchSubagentDirectories()` method at line 556-611

**Quality Requirements**:

- In `watchSubagentDirectories()`, after collecting sessionIds from `activeWatches`, also scan `sessionsDir` for UUID-named directories
- Use `fs.readdirSync(sessionsDir, { withFileTypes: true })` to find directories
- Add a private `isUuidLike(name: string): boolean` method using regex
- Wrap the directory scan in try/catch (proceed with activeWatches only if scan fails)
- Do NOT change the rest of the method logic

**Validation Notes**:

- `readdirSync` on a small directory (1-5 session dirs) is fast (<1ms)
- Non-session UUID-like directories are handled gracefully since the existing code checks for `subagents/` subdirectory existence
- This is a read-only addition, no risk of data corruption

**Implementation Details**:

- In `watchSubagentDirectories()` at line 556-560:
  - After existing `sessionIds` set construction from `activeWatches`
  - Add try/catch block to scan `sessionsDir` with `readdirSync`
  - For each directory entry that `isDirectory()` and `isUuidLike(entry.name)`, add to `sessionIds`
- Add private method `isUuidLike(name: string): boolean`:
  - Match UUID format: `/^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{12})?$/i`
  - Also match hex-only format: `/^[0-9a-f]{12,}$/i`

**Acceptance Criteria**:

- First subagent's streaming text appears in UI immediately (not only after second subagent)
- Existing behavior for second+ subagents remains unchanged
- No errors if sessions directory doesn't exist yet

---

### Task 2.3: Bug 6 - Subagent tool detection broadening in ExecutionTreeBuilder

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`
**Spec Reference**: implementation-plan.md: Bug 6 section (lines 353-420)
**Pattern to Follow**: Existing `collectTools()` method at line 478-482

**Quality Requirements**:

- Broaden the Task tool detection at line 482 to also match `dispatch_agent` and `dispatch_subagent` tool names
- Add a secondary check: if tool input contains `"subagent_type"`, treat as agent dispatch
- Use `let` instead of direct `if` to allow the secondary check to set the flag
- Preserve the existing logic for `toolName === 'Task'` and `isTaskTool`
- Do NOT change the agent node building logic inside the if-block

**Validation Notes**:

- The `subagent_type` input check is the most reliable signal for agent dispatch (data-driven, not hardcoded)
- Risk of false positive is very low -- regular tools do not have `subagent_type` in their input
- The existing `toolName === 'Task'` check is preserved for backward compatibility

**Implementation Details**:

- At line 482, replace the simple if-check with a multi-condition detection:
  - `let isAgentDispatchTool = toolStart.isTaskTool || toolStart.toolName === 'Task' || toolStart.toolName === 'dispatch_agent' || toolStart.toolName === 'dispatch_subagent'`
  - If still false, check `state.toolInputAccumulators` for the tool's input key and look for `"subagent_type"` string
  - Use the `isAgentDispatchTool` variable in the subsequent if-block

**Acceptance Criteria**:

- Subagent content renders inside InlineAgentBubble (colored avatar + agent header)
- Subagent content does NOT render inside a tool execution container with "Input" toggle
- Regular (non-subagent) tool calls still render normally with tool wrapper
- Existing `Task` tool name detection still works

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build agent-sdk`, `npx nx build vscode-core`, `npx nx build chat`
- code-logic-reviewer approved
- Edge cases from validation handled (orphan sessions, missing directories, false positive tool detection)

---

## Batch 3: Plugin Deduplication (Cosmetic)

**Status**: PENDING
**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None

### Task 3.1: Bug 2 - Skill junction deduplication

**Status**: IMPLEMENTED
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\skill-junction.service.ts`
**Spec Reference**: implementation-plan.md: Bug 2 section (lines 115-152)
**Pattern to Follow**: Existing entry-type checks at lines 181-204

**Quality Requirements**:

- Enhance the existing entry-type checks to also skip entries that exist as regular files (not just directories and symlinks)
- The current code handles: symlinks (check target), real directories (skip), but may not handle all SDK-created entry types
- Add broader existence check: if entry exists in ANY form and is not a symlink pointing to wrong target, skip it
- Increment `result.skipped++` for skipped entries
- Log at debug level (not info) since this is now expected behavior

**Validation Notes**:

- This is a cosmetic fix -- the duplication doesn't cause incorrect behavior
- The SDK creates entries when `pluginPaths` is provided; SkillJunctionService may create duplicate entries
- Timing-dependent: if SDK creates entries after SkillJunctionService runs, some duplicates may still occur (acceptable)

**Implementation Details**:

- In the junction creation loop (around line 175-204):
  - After the existing `existingStat.isDirectory()` check at line 193
  - The existing `else` block at line 201 already handles "regular file or other entry" by skipping
  - Verify the logic covers all cases: the key fix may be ensuring the command-copying logic (separate from junction creation) also deduplicates
  - Check the command file copying section for similar duplication issues

**Acceptance Criteria**:

- Log output shows fewer "created" entries and more "skipped" entries
- No duplicate skills/commands visible to Claude Agent
- Existing skills/commands still work correctly (no broken symlinks)
- No functional regression in plugin loading

---

**Batch 3 Verification**:

- File exists at path
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved
- Plugin loading still works correctly

---

## Summary

| Batch | Name                      | Tasks                   | Developer                              | Status  |
| ----- | ------------------------- | ----------------------- | -------------------------------------- | ------- |
| 1     | Independent Backend Fixes | 2 (Bug 5, Bug 3)        | backend-developer                      | PENDING |
| 2     | Subagent-Related Fixes    | 3 (Bug 1, Bug 4, Bug 6) | backend-developer + frontend-developer | PENDING |
| 3     | Plugin Deduplication      | 1 (Bug 2)               | backend-developer                      | PENDING |
